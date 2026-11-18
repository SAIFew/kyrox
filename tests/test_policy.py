"""Comprehensive unit, integration, audit, and security regression tests for
KYROX Day 11 Feature Drop #2: Safety Policy (``tools/policy.py``, ``tools/tx.py``,
``tools/log.py``, and ``server.py``).

Covers all 26 mandatory Day 11 verification scenarios:
- Policy Unit Tests (1-14): 10 tAAPL allowed, 49/50 tAAPL boundary allowed,
  50.01/100 tAAPL denied, 100 tTSLA denied, 10 tNVDA allowed, unknown tickers
  and dataset-expansion attempts denied, zero/negative/NaN/Infinity/invalid/boolean
  amounts denied, excess decimal precision denied, and requires_human_approval=True
  retained across every allowed and denied result.
- Integration & Regression Tests (15-26): prepare_transaction and simulate_transaction
  independent pre-RPC policy enforcement, proof that calldata construction,
  prepare_transaction, eth_call, and eth_estimateGas do not execute on policy denial,
  unknown ticker/invalid address/wrong chain ID/unconfigured or zero contract rejection,
  structured JSONL audit logging for both allowed and denied decisions, fail-closed
  behavior on audit write failure, secret redaction, intent integrity verification,
  and non-custodial unsigned transaction invariants.
"""

from __future__ import annotations

import ast
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

from hexbytes import HexBytes
import pytest
from web3 import Web3

import server
from tools.errors import (
    DEFAULT_MAX_TOKEN_AMOUNT,
    REDACTED_PLACEHOLDER,
    ConfigurationError,
    ErrorCode,
    PolicyViolationError,
)
from tools.log import get_audit_logger
import tools.policy as policy_module
from tools.policy import (
    CANONICAL_APPROVED_TICKERS,
    HARD_MAX_TOKEN_AMOUNT,
    POLICY_VERSION,
    PolicyDecision,
    check_policy,
    evaluate_transaction_policy,
    get_approved_tickers,
    get_approved_tickers_canonical,
    get_max_token_amount,
    get_max_tx_amount,
    validate_approved_ticker,
)
import tools.tx as tx_module
from tools.tx import (
    BASE_SEPOLIA_CHAIN_ID,
    ERC20_TRANSFER_SELECTOR,
    decode_erc20_transfer_calldata,
    encode_erc20_transfer_calldata,
    prepare_transaction,
    simulate_prepared_transaction_intent,
    simulate_transaction,
    verify_prepared_transaction_intent,
)
from tools.wallet import ZERO_ADDRESS

PROJECT_ROOT = Path(__file__).resolve().parent.parent

SAMPLE_SENDER_LOWER = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f"
SAMPLE_SENDER_CHECKSUM = Web3.to_checksum_address(SAMPLE_SENDER_LOWER)

SAMPLE_RECIPIENT_LOWER = "0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5"
SAMPLE_RECIPIENT_CHECKSUM = Web3.to_checksum_address(SAMPLE_RECIPIENT_LOWER)

MOCK_AAPL_ADDRESS = "0x1111111111111111111111111111111111111111"
MOCK_TSLA_ADDRESS = "0x2222222222222222222222222222222222222222"
MOCK_NVDA_ADDRESS = "0x3333333333333333333333333333333333333333"
MOCK_EXTRA_ADDRESS = "0x4444444444444444444444444444444444444444"

SAMPLE_RAW_PRIVATE_KEY = (
    "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"
)
SAMPLE_SEED_PHRASE = (
    "abandon ability able about above absent absorb abstract absurd abuse access accident"
)

MOCK_CONFIGURED_STOCKS: list[dict[str, Any]] = [
    {
        "ticker": "tAAPL",
        "stock": "Test Apple",
        "reference_value": 230.0,
        "decimals": 18,
        "token_address": MOCK_AAPL_ADDRESS,
    },
    {
        "ticker": "tTSLA",
        "stock": "Test Tesla",
        "reference_value": 250.0,
        "decimals": 18,
        "token_address": MOCK_TSLA_ADDRESS,
    },
    {
        "ticker": "tNVDA",
        "stock": "Test Nvidia",
        "reference_value": 140.0,
        "decimals": 18,
        "token_address": MOCK_NVDA_ADDRESS,
    },
]


def _read_jsonl_entries(log_file: Path) -> list[dict[str, Any]]:
    assert log_file.is_file(), f"Expected audit log file at {log_file}"
    return [
        json.loads(line)
        for line in log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _make_isolated_mock_web3(
    *,
    chain_id: int = BASE_SEPOLIA_CHAIN_ID,
    bytecode: bytes | str = b"\x60\x80\x60\x40",
    decimals: int = 18,
    pending_nonce: int = 5,
    block_number: int = 19_500_000,
    estimated_gas: int = 51842,
) -> MagicMock:
    """Create an isolated MOCK TEST FIXTURE Web3 provider for Day 11 integration tests."""
    w3 = MagicMock()
    w3.is_connected.return_value = True
    w3.eth.chain_id = chain_id
    w3.eth.get_code.return_value = bytecode
    w3.eth.get_transaction_count.return_value = pending_nonce
    w3.eth.block_number = block_number
    w3.eth.call.return_value = HexBytes("0x" + ("00" * 31) + "01")
    w3.eth.estimate_gas.return_value = estimated_gas

    w3.eth.send_transaction.side_effect = AssertionError(
        "FORBIDDEN: send_transaction must never be called"
    )
    w3.eth.send_raw_transaction.side_effect = AssertionError(
        "FORBIDDEN: send_raw_transaction must never be called"
    )
    w3.eth.sign_transaction.side_effect = AssertionError(
        "FORBIDDEN: sign_transaction must never be called"
    )
    w3.eth.account.sign_transaction.side_effect = AssertionError(
        "FORBIDDEN: account.sign_transaction must never be called"
    )

    def _contract_side_effect(address: str, abi: list[dict[str, Any]]) -> MagicMock:
        checksum_addr = Web3.to_checksum_address(address)
        contract_mock = MagicMock()
        contract_mock.functions.decimals.return_value.call.return_value = decimals

        def _transfer_side_effect(recipient: str, base_units: int) -> MagicMock:
            transfer_mock = MagicMock()
            encoded = encode_erc20_transfer_calldata(
                checksum_addr, recipient, base_units
            )
            transfer_mock.build_transaction.side_effect = lambda tx_params: {
                "from": tx_params["from"],
                "to": checksum_addr,
                "data": encoded,
                "value": tx_params.get("value", 0),
                "nonce": tx_params["nonce"],
                "chainId": tx_params["chainId"],
                "gas": 65000,
            }
            return transfer_mock

        contract_mock.functions.transfer.side_effect = _transfer_side_effect
        return contract_mock

    w3.eth.contract.side_effect = _contract_side_effect
    return w3


# ===========================================================================
# PHASE 6 — POLICY UNIT TESTS (ITEMS 1–14)
# ===========================================================================


def test_1_taapl_with_10_tokens_passes_amount_and_ticker_policy() -> None:
    """Requirement 1: tAAPL with 10 tokens passes amount and ticker policy."""
    decision = evaluate_transaction_policy(ticker="tAAPL", amount=10)
    assert isinstance(decision, PolicyDecision)
    assert decision.allowed is True
    assert decision.passed is True
    assert decision["allowed"] is True
    assert decision["passed"] is True
    assert decision.ticker == "tAAPL"
    assert decision.amount_decimal == "10"
    assert decision.amount_base_units == 10 * 10**18
    assert decision.max_amount == "50"
    assert decision.reasons == ()
    assert decision.error_code is None
    assert decision.requires_human_approval is True


@pytest.mark.parametrize(
    ("amount_input", "expected_str"),
    [
        (10, "10"),
        (49, "49"),
        ("49.999999999999999999", "49.999999999999999999"),
        (50, "50"),
        (50.0, "50"),
        ("50", "50"),
        (Decimal("50.00"), "50"),
    ],
)
def test_2_taapl_with_50_tokens_passes_inclusive_amount_boundary(
    amount_input: Any, expected_str: str
) -> None:
    """Requirement 2: tAAPL with 10, 49, and 50 tokens passes the inclusive amount boundary."""
    assert DEFAULT_MAX_TOKEN_AMOUNT == Decimal("50")
    assert HARD_MAX_TOKEN_AMOUNT == Decimal("50")
    assert get_max_tx_amount() == Decimal("50")
    assert get_max_token_amount() == Decimal("50")

    decision = evaluate_transaction_policy(ticker="tAAPL", amount=amount_input)
    assert decision.allowed is True
    assert decision.passed is True
    assert decision.ticker == "tAAPL"
    assert decision.amount_decimal == expected_str
    assert decision.max_amount == "50"
    assert decision.requires_human_approval is True


@pytest.mark.parametrize("over_limit_amount", [50.01, "50.01", "50.0001", 100, "100", Decimal("100")])
def test_3_taapl_with_100_and_50_01_tokens_is_denied(
    over_limit_amount: Any,
) -> None:
    """Requirement 3: tAAPL with 100 tokens (and 50.01 boundary) is denied with a clear reason."""
    decision = evaluate_transaction_policy(ticker="tAAPL", amount=over_limit_amount)
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.error_code == ErrorCode.POLICY_REJECTED.value
    assert decision.error_category == "policy"
    assert decision.max_amount == "50"
    assert decision.requires_human_approval is True
    assert len(decision.reasons) == 1
    assert "exceeds maximum allowed limit (50)" in decision.reasons[0]


def test_4_ttsla_with_100_tokens_is_denied() -> None:
    """Requirement 4: tTSLA with 100 tokens is denied."""
    decision = evaluate_transaction_policy(ticker="tTSLA", amount=100)
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.ticker == "tTSLA"
    assert decision.amount_decimal == "100"
    assert decision.max_amount == "50"
    assert decision.error_code == ErrorCode.POLICY_REJECTED.value
    assert "exceeds maximum allowed limit (50)" in (decision.reason or "")
    assert decision.requires_human_approval is True


def test_5_tnvda_with_10_tokens_passes() -> None:
    """Requirement 5: tNVDA with 10 tokens passes (along with all 3 approved tickers)."""
    for approved_ticker in ("tNVDA", "tAAPL", "tTSLA", "tnvda", "  tTSLA  "):
        decision = evaluate_transaction_policy(ticker=approved_ticker, amount=10)
        assert decision.allowed is True
        assert decision.passed is True
        assert decision.ticker in CANONICAL_APPROVED_TICKERS
        assert decision.amount_decimal == "10"
        assert decision.requires_human_approval is True


@pytest.mark.parametrize(
    "unknown_ticker",
    ["UNKNOWN", "AAPL", "TSLA", "NVDA", "tMSFT", "tGOOG", "tAMZN", "BTC", "ETH", "   ", ""],
)
def test_6_unknown_ticker_is_denied_and_config_cannot_expand_allowlist(
    unknown_ticker: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirement 6: Unknown ticker is denied; strict case & config bounds verified."""
    assert CANONICAL_APPROVED_TICKERS == ("tAAPL", "tTSLA", "tNVDA")
    assert get_approved_tickers_canonical() == ("tAAPL", "tTSLA", "tNVDA")
    assert get_approved_tickers() == frozenset({"taapl", "ttsla", "tnvda"})

    decision = evaluate_transaction_policy(ticker=unknown_ticker, amount=10)
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.requires_human_approval is True
    assert len(decision.reasons) == 1

    # Strict case mode rejects non-canonical casing while allowing exact canonical case
    strict_bad = evaluate_transaction_policy(
        ticker="taapl", amount=10, strict_ticker_case=True
    )
    assert strict_bad.allowed is False
    assert strict_bad.error_code == ErrorCode.POLICY_REJECTED.value
    strict_ok = evaluate_transaction_policy(
        ticker="tAAPL", amount=10, strict_ticker_case=True
    )
    assert strict_ok.allowed is True

    # Environment variable KYROX_APPROVED_TICKERS cannot expand allowlist beyond tAAPL, tTSLA, tNVDA
    monkeypatch.setenv("KYROX_APPROVED_TICKERS", "tAAPL,tMSFT")
    with pytest.raises(ConfigurationError, match="not in the approved Day 11 ticker allowlist"):
        get_approved_tickers()
    decision_bad_cfg = evaluate_transaction_policy(ticker="tAAPL", amount=10)
    assert decision_bad_cfg.allowed is False
    assert decision_bad_cfg.error_code == ErrorCode.INVALID_CONFIGURATION.value

    # Environment variable KYROX_MAX_TOKEN_AMOUNT / KYROX_MAX_TX_AMOUNT cannot raise limit above 50
    monkeypatch.delenv("KYROX_APPROVED_TICKERS", raising=False)
    for env_var in ("KYROX_MAX_TOKEN_AMOUNT", "KYROX_MAX_TX_AMOUNT"):
        monkeypatch.setenv(env_var, "100")
        with pytest.raises(ConfigurationError, match="exceeds the Day 11 safety policy maximum"):
            get_max_tx_amount()
        dec_over_cfg = evaluate_transaction_policy(ticker="tAAPL", amount=10)
        assert dec_over_cfg.allowed is False
        assert dec_over_cfg.error_code == ErrorCode.INVALID_CONFIGURATION.value
        monkeypatch.delenv(env_var, raising=False)

    # Tightening KYROX_MAX_TOKEN_AMOUNT below 50 (e.g. 25) is honored
    monkeypatch.setenv("KYROX_MAX_TOKEN_AMOUNT", "25")
    assert get_max_token_amount() == Decimal("25")
    assert evaluate_transaction_policy(ticker="tAAPL", amount=25).allowed is True
    denied_30 = evaluate_transaction_policy(ticker="tAAPL", amount=30)
    assert denied_30.allowed is False
    assert denied_30.max_amount == "25"
    assert "exceeds maximum allowed limit (25)" in (denied_30.reason or "")


@pytest.mark.parametrize("zero_amount", [0, 0.0, "0", "0.0", "0.000000", Decimal("0")])
def test_7_zero_amount_is_denied(zero_amount: Any) -> None:
    """Requirement 7: Zero amount is denied."""
    decision = evaluate_transaction_policy(ticker="tAAPL", amount=zero_amount)
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.error_code == ErrorCode.INVALID_AMOUNT.value
    assert "greater than zero" in (decision.reason or "").lower()
    assert decision.requires_human_approval is True


@pytest.mark.parametrize("negative_amount", [-1, -0.01, -50, "-1", "-0.0001", Decimal("-10")])
def test_8_negative_amount_is_denied(negative_amount: Any) -> None:
    """Requirement 8: Negative amount is denied."""
    decision = evaluate_transaction_policy(ticker="tAAPL", amount=negative_amount)
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.error_code == ErrorCode.INVALID_AMOUNT.value
    assert "greater than zero" in (decision.reason or "").lower()
    assert decision.requires_human_approval is True


@pytest.mark.parametrize("nan_amount", [float("nan"), "NaN", "nan", "sNaN", Decimal("NaN")])
def test_9_nan_amount_is_denied(nan_amount: Any) -> None:
    """Requirement 9: NaN is denied."""
    decision = evaluate_transaction_policy(ticker="tAAPL", amount=nan_amount)
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.error_code == ErrorCode.INVALID_AMOUNT.value
    assert decision.requires_human_approval is True


@pytest.mark.parametrize(
    "inf_amount",
    [
        float("inf"),
        float("-inf"),
        "Infinity",
        "-Infinity",
        "inf",
        "-inf",
        Decimal("Infinity"),
        Decimal("-Infinity"),
    ],
)
def test_10_positive_and_negative_infinity_are_denied(inf_amount: Any) -> None:
    """Requirement 10: Positive and negative infinity are denied."""
    decision = evaluate_transaction_policy(ticker="tAAPL", amount=inf_amount)
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.error_code == ErrorCode.INVALID_AMOUNT.value
    assert "nan and infinity are not allowed" in (decision.reason or "").lower()
    assert decision.requires_human_approval is True


@pytest.mark.parametrize(
    "invalid_numeric",
    ["", "   ", "abc", "10tAAPL", "12.34.56", None, [10], {"amount": 10}, object()],
)
def test_11_invalid_numeric_input_is_denied(invalid_numeric: Any) -> None:
    """Requirement 11: Invalid numeric input is denied."""
    decision = evaluate_transaction_policy(ticker="tAAPL", amount=invalid_numeric)
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.error_code in (
        ErrorCode.INVALID_AMOUNT.value,
        ErrorCode.EMPTY_INPUT.value,
    )
    assert decision.requires_human_approval is True


@pytest.mark.parametrize("bool_amount", [True, False])
def test_12_boolean_input_is_not_accepted_as_amount(bool_amount: bool) -> None:
    """Requirement 12: Boolean input is not accepted as an amount."""
    decision = evaluate_transaction_policy(ticker="tAAPL", amount=bool_amount)
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.error_code == ErrorCode.INVALID_AMOUNT.value
    assert decision.requires_human_approval is True


@pytest.mark.parametrize(
    ("decimals", "excess_amount"),
    [
        (18, "1.0000000000000000001"),  # 19 decimal places on 18-decimal token
        (6, "1.1234567"),               # 7 decimal places on 6-decimal token
        (0, "1.5"),                     # 1 decimal place on 0-decimal token
    ],
)
def test_13_excess_token_precision_is_denied(
    decimals: int, excess_amount: str
) -> None:
    """Requirement 13: Excess token precision is denied."""
    decision = evaluate_transaction_policy(
        ticker="tAAPL",
        amount=excess_amount,
        decimals=decimals,
    )
    assert decision.allowed is False
    assert decision.passed is False
    assert decision.error_code == ErrorCode.DECIMAL_PRECISION_ERROR.value
    assert "excessive decimal precision" in (decision.reason or "").lower()
    assert decision.requires_human_approval is True


def test_14_every_result_retains_requires_human_approval_true_and_blocks_overrides() -> None:
    """Requirement 14: Every result retains requires_human_approval=true; agent overrides blocked."""
    allowed_res = check_policy(ticker="tAAPL", amount=10)
    assert allowed_res.allowed is True
    assert allowed_res.requires_human_approval is True
    assert allowed_res.to_dict()["requires_human_approval"] is True

    denied_res = check_policy(ticker="tAAPL", amount=100)
    assert denied_res.allowed is False
    assert denied_res.requires_human_approval is True
    assert denied_res.to_dict()["requires_human_approval"] is True
    assert denied_res.to_error_response()["requires_human_approval"] is True
    assert denied_res.to_error_response()["policy"]["requires_human_approval"] is True

    # Attempting to bypass human approval (requires_human_approval=False or human_approved=True)
    # is rejected by policy while STILL retaining requires_human_approval=True on the decision!
    override_1 = evaluate_transaction_policy(
        ticker="tAAPL",
        amount=10,
        requires_human_approval=False,
    )
    assert override_1.allowed is False
    assert override_1.error_code == ErrorCode.POLICY_REJECTED.value
    assert override_1.requires_human_approval is True

    override_2 = evaluate_transaction_policy(
        ticker="tAAPL",
        amount=10,
        human_approved=True,
    )
    assert override_2.allowed is False
    assert override_2.error_code == ErrorCode.POLICY_REJECTED.value
    assert override_2.requires_human_approval is True

    # Even direct PolicyDecision instantiation forces requires_human_approval=True
    forced = PolicyDecision(allowed=True, passed=True, requires_human_approval=False)
    assert forced.requires_human_approval is True


# ===========================================================================
# PHASE 6 — INTEGRATION TESTS (ITEMS 15–26)
# ===========================================================================


@pytest.mark.parametrize(
    ("ticker", "denied_amount"),
    [
        ("tAAPL", 100),
        ("tTSLA", 100),
        ("tNVDA", 100),
        ("tAAPL", "50.01"),
    ],
)
def test_15_prepare_transaction_rejects_100_tokens_before_transaction_construction(
    ticker: str,
    denied_amount: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirement 15: prepare_transaction rejects 100 tokens before transaction construction."""
    get_web3_spy = MagicMock()
    encode_spy = MagicMock(wraps=encode_erc20_transfer_calldata)
    build_envelope_spy = MagicMock(wraps=tx_module._build_unsigned_transfer_envelope)

    monkeypatch.setattr(tx_module, "get_web3", get_web3_spy)
    monkeypatch.setattr(tx_module, "encode_erc20_transfer_calldata", encode_spy)
    monkeypatch.setattr(tx_module, "_build_unsigned_transfer_envelope", build_envelope_spy)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker=ticker,
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=denied_amount,
    )

    assert "error" in result
    assert "exceeds maximum allowed limit (50)" in result["error"]
    assert result["status"] == "rejected"
    assert result["signed"] is False
    assert result["broadcast"] is False
    assert result["requires_human_approval"] is True
    assert result["policy"]["allowed"] is False
    assert result["policy"]["passed"] is False
    assert result["policy"]["requires_human_approval"] is True
    assert result["policy"]["max_amount"] == "50"
    assert result["policy"]["error_code"] == ErrorCode.POLICY_REJECTED.value
    assert "unsigned_tx" not in result
    assert "data" not in result
    assert "calldata" not in result

    # Prove transaction construction and RPC connection were NEVER invoked
    encode_spy.assert_not_called()
    build_envelope_spy.assert_not_called()
    get_web3_spy.assert_not_called()


@pytest.mark.parametrize(
    ("ticker", "denied_amount"),
    [
        ("tAAPL", 100),
        ("tTSLA", 100),
        ("tNVDA", 100),
        ("tAAPL", "50.01"),
    ],
)
def test_16_17_18_simulate_transaction_rejects_100_tokens_before_prepare_eth_call_and_estimate_gas(
    ticker: str,
    denied_amount: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirements 16, 17, 18:
    - simulate_transaction rejects 100 tokens before RPC calls and before prepare_transaction.
    - eth_call has NOT executed after policy rejection.
    - estimate_gas has NOT executed after policy rejection.
    """
    mock_w3 = _make_isolated_mock_web3()
    get_web3_spy = MagicMock(return_value=mock_w3)
    prepare_spy = MagicMock(wraps=tx_module.prepare_transaction)
    encode_spy = MagicMock(wraps=encode_erc20_transfer_calldata)

    monkeypatch.setattr(tx_module, "get_web3", get_web3_spy)
    monkeypatch.setattr(tx_module, "prepare_transaction", prepare_spy)
    monkeypatch.setattr(tx_module, "encode_erc20_transfer_calldata", encode_spy)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.simulate_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker=ticker,
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=denied_amount,
    )

    assert "error" in result
    assert "exceeds maximum allowed limit (50)" in result["error"]
    assert result["status"] == "rejected"
    assert result["signed"] is False
    assert result["broadcast"] is False
    assert result["requires_human_approval"] is True
    assert result["policy"]["allowed"] is False
    assert result["policy"]["passed"] is False
    assert result["policy"]["requires_human_approval"] is True
    assert result["policy"]["max_amount"] == "50"
    assert result["policy"]["error_code"] == ErrorCode.POLICY_REJECTED.value
    assert "would_succeed" not in result
    assert "estimated_gas" not in result
    assert "unsigned_tx" not in result

    # Prove prepare_transaction, calldata construction, get_web3, eth_call, and estimate_gas NEVER ran
    prepare_spy.assert_not_called()
    encode_spy.assert_not_called()
    get_web3_spy.assert_not_called()
    mock_w3.eth.call.assert_not_called()
    mock_w3.eth.estimate_gas.assert_not_called()


def test_19_unknown_tickers_and_arbitrary_dataset_entries_rejected_by_both_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirement 19: Unknown tickers (even if added to dataset) are rejected by both tools before RPC."""
    # Inject an arbitrary extra ticker 'tMSFT' with a valid contract address into the dataset
    expanded_dataset = [
        *MOCK_CONFIGURED_STOCKS,
        {
            "ticker": "tMSFT",
            "stock": "Test Microsoft",
            "reference_value": 420.0,
            "decimals": 18,
            "token_address": MOCK_EXTRA_ADDRESS,
        },
    ]
    mock_w3 = _make_isolated_mock_web3()
    get_web3_spy = MagicMock(return_value=mock_w3)
    monkeypatch.setattr(tx_module, "get_web3", get_web3_spy)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: expanded_dataset)

    for bad_ticker in ("UNKNOWN", "AAPL", "tMSFT", "BTC"):
        res_prep = server.prepare_transaction(
            from_wallet=SAMPLE_SENDER_CHECKSUM,
            ticker=bad_ticker,
            to=SAMPLE_RECIPIENT_CHECKSUM,
            amount=10,
        )
        assert "error" in res_prep
        assert res_prep["policy"]["allowed"] is False
        assert res_prep["policy"]["error_code"] == ErrorCode.POLICY_REJECTED.value
        assert res_prep["requires_human_approval"] is True
        assert "unsigned_tx" not in res_prep

        res_sim = server.simulate_transaction(
            from_wallet=SAMPLE_SENDER_CHECKSUM,
            ticker=bad_ticker,
            to=SAMPLE_RECIPIENT_CHECKSUM,
            amount=10,
        )
        assert "error" in res_sim
        assert res_sim["policy"]["allowed"] is False
        assert res_sim["policy"]["error_code"] == ErrorCode.POLICY_REJECTED.value
        assert res_sim["requires_human_approval"] is True
        assert "would_succeed" not in res_sim

    get_web3_spy.assert_not_called()
    mock_w3.eth.call.assert_not_called()
    mock_w3.eth.estimate_gas.assert_not_called()


def test_20_invalid_addresses_cannot_bypass_policy_in_either_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirement 20: Invalid, zero, bad-checksum, non-allowlisted, or contract-self addresses rejected."""
    mock_w3 = _make_isolated_mock_web3()
    get_web3_spy = MagicMock(return_value=mock_w3)
    monkeypatch.setattr(tx_module, "get_web3", get_web3_spy)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    bad_checksum = SAMPLE_SENDER_CHECKSUM[:-1] + (
        "f" if SAMPLE_SENDER_CHECKSUM[-1] == "F" else "F"
    )

    for sender, recipient in (
        ("0x1234", SAMPLE_RECIPIENT_CHECKSUM),
        (ZERO_ADDRESS, SAMPLE_RECIPIENT_CHECKSUM),
        (bad_checksum, SAMPLE_RECIPIENT_CHECKSUM),
        (SAMPLE_SENDER_CHECKSUM, "0x1234"),
        (SAMPLE_SENDER_CHECKSUM, ZERO_ADDRESS),
        (SAMPLE_SENDER_CHECKSUM, bad_checksum),
        (SAMPLE_SENDER_CHECKSUM, MOCK_AAPL_ADDRESS),  # Self-transfer to token contract
    ):
        for tool_fn in (server.prepare_transaction, server.simulate_transaction):
            res = tool_fn(
                from_wallet=sender,
                ticker="tAAPL",
                to=recipient,
                amount=10,
            )
            assert "error" in res
            assert res["policy"]["allowed"] is False
            assert res["requires_human_approval"] is True
            assert "unsigned_tx" not in res
            assert "would_succeed" not in res

    get_web3_spy.assert_not_called()
    mock_w3.eth.call.assert_not_called()
    mock_w3.eth.estimate_gas.assert_not_called()


@pytest.mark.parametrize("wrong_chain_id", [8453, 1, 11155111, 42161, 10])
def test_21_incorrect_chain_ids_cannot_bypass_policy(
    wrong_chain_id: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirement 21: Incorrect chain IDs (including Base Mainnet 8453) are rejected."""
    # 1. Policy unit check
    pol = evaluate_transaction_policy(
        ticker="tAAPL", amount=10, chain_id=wrong_chain_id
    )
    assert pol.allowed is False
    assert pol.chain_verified is False
    assert pol.error_code == ErrorCode.UNSUPPORTED_CHAIN_ID.value
    assert pol.requires_human_approval is True

    # 2. Both transaction tools reject wrong chain ID before contract/simulation calls
    mock_w3 = _make_isolated_mock_web3(chain_id=wrong_chain_id)
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    for tool_fn in (server.prepare_transaction, server.simulate_transaction):
        res = tool_fn(
            from_wallet=SAMPLE_SENDER_CHECKSUM,
            ticker="tAAPL",
            to=SAMPLE_RECIPIENT_CHECKSUM,
            amount=10,
        )
        assert "error" in res
        assert "84532" in res["error"]
        assert res["policy"]["allowed"] is False
        assert res["policy"]["chain_verified"] is False
        assert res["policy"]["error_code"] == ErrorCode.UNSUPPORTED_CHAIN_ID.value
        assert res["requires_human_approval"] is True
        assert "unsigned_tx" not in res
        assert "would_succeed" not in res

    mock_w3.eth.contract.assert_not_called()
    mock_w3.eth.call.assert_not_called()
    mock_w3.eth.estimate_gas.assert_not_called()


def test_22_unconfigured_or_zero_token_contracts_cannot_bypass_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirement 22: Packaged blank token_address ('') and zero token contract are rejected."""
    mock_w3 = _make_isolated_mock_web3()
    get_web3_spy = MagicMock(return_value=mock_w3)
    monkeypatch.setattr(tx_module, "get_web3", get_web3_spy)

    # 1. Default packaged data/stocks.json (token_address == "")
    for tool_fn in (server.prepare_transaction, server.simulate_transaction):
        res_blank = tool_fn(
            from_wallet=SAMPLE_SENDER_CHECKSUM,
            ticker="tAAPL",
            to=SAMPLE_RECIPIENT_CHECKSUM,
            amount=10,
        )
        assert "error" in res_blank
        assert "not configured in the stock dataset" in res_blank["error"]
        assert res_blank["policy"]["allowed"] is False
        assert res_blank["policy"]["error_code"] == ErrorCode.MISSING_CONFIGURATION.value
        assert res_blank["requires_human_approval"] is True

    # 2. Zero address configured as token_address
    monkeypatch.setattr(
        tx_module,
        "load_stocks",
        lambda: [
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": 230.0,
                "token_address": ZERO_ADDRESS,
            }
        ],
    )
    for tool_fn in (server.prepare_transaction, server.simulate_transaction):
        res_zero = tool_fn(
            from_wallet=SAMPLE_SENDER_CHECKSUM,
            ticker="tAAPL",
            to=SAMPLE_RECIPIENT_CHECKSUM,
            amount=10,
        )
        assert "error" in res_zero
        assert "zero address" in res_zero["error"].lower()
        assert res_zero["policy"]["allowed"] is False
        assert res_zero["policy"]["error_code"] == ErrorCode.ZERO_ADDRESS_NOT_ALLOWED.value
        assert res_zero["requires_human_approval"] is True

    get_web3_spy.assert_not_called()


def test_23_audit_records_exist_for_both_allowed_and_denied_outcomes_and_fail_closed_on_audit_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirement 23 & Phase 4:
    - Both ALLOWED and DENIED policy decisions are recorded in audit.jsonl with structured metadata.
    - High-impact transaction/policy operations fail closed if audit logging fails.
    """
    logger = get_audit_logger()
    mock_w3 = _make_isolated_mock_web3()
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # 1. Direct policy evaluation: ALLOWED (10 tAAPL) and DENIED (100 tAAPL)
    pol_ok = evaluate_transaction_policy(ticker="tAAPL", amount=10)
    assert pol_ok.allowed is True
    pol_denied = evaluate_transaction_policy(ticker="tAAPL", amount=100)
    assert pol_denied.allowed is False

    # 2. prepare_transaction: ALLOWED (10 tAAPL) and DENIED (100 tAAPL)
    prep_ok = server.prepare_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert prep_ok["status"] == "prepared"
    prep_denied = server.prepare_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 100
    )
    assert prep_denied["status"] == "rejected"

    # 3. simulate_transaction: ALLOWED (10 tNVDA) and DENIED (100 tTSLA)
    sim_ok = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tNVDA", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert sim_ok["would_succeed"] is True
    sim_denied = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tTSLA", SAMPLE_RECIPIENT_CHECKSUM, 100
    )
    assert sim_denied["status"] == "rejected"

    entries = _read_jsonl_entries(logger.log_file)
    assert len(entries) == 6

    # Verify allowed entries (indices 0, 2, 4)
    for idx, expected_tool, expected_ticker in (
        (0, "evaluate_transaction_policy", "tAAPL"),
        (2, "prepare_transaction", "tAAPL"),
        (4, "simulate_transaction", "tNVDA"),
    ):
        entry = entries[idx]
        assert entry["tool"] == expected_tool
        assert entry["status"] == "ok"
        ctx = entry["context"]
        assert ctx["allowed"] is True
        assert ctx["passed"] is True
        assert ctx["decision"] == "allowed"
        assert ctx["ticker"] == expected_ticker
        assert ctx["amount_decimal"] == "10"
        assert ctx["normalized_amount"] == "10"
        assert ctx["max_amount"] == "50"
        assert ctx["effective_max_amount"] == "50"
        assert ctx["reasons"] == []
        assert ctx["denial_reasons"] == []
        assert ctx["requires_human_approval"] is True
        assert ctx["policy_version"] == POLICY_VERSION

    # Verify denied entries (indices 1, 3, 5)
    for idx, expected_tool, expected_ticker in (
        (1, "evaluate_transaction_policy", "tAAPL"),
        (3, "prepare_transaction", "tAAPL"),
        (5, "simulate_transaction", "tTSLA"),
    ):
        entry = entries[idx]
        assert entry["tool"] == expected_tool
        assert entry["status"] == "error"
        assert entry["error_code"] == ErrorCode.POLICY_REJECTED.value
        assert entry["error_category"] == "policy"
        ctx = entry["context"]
        assert ctx["allowed"] is False
        assert ctx["passed"] is False
        assert ctx["decision"] == "denied"
        assert ctx["ticker"] == expected_ticker
        assert ctx["amount_decimal"] == "100"
        assert ctx["normalized_amount"] == "100"
        assert ctx["max_amount"] == "50"
        assert ctx["effective_max_amount"] == "50"
        assert len(ctx["reasons"]) == 1
        assert "exceeds maximum allowed limit (50)" in ctx["reasons"][0]
        assert ctx["requires_human_approval"] is True
        assert ctx["policy_version"] == POLICY_VERSION

    # 4. Fail-closed verification: when audit writing fails on an otherwise valid 10 tAAPL request,
    # neither evaluate_transaction_policy, prepare_transaction, nor simulate_transaction may allow it!
    def _failing_open(*_args: Any, **_kwargs: Any) -> Any:
        raise OSError("Simulated disk full failure on audit.jsonl")

    monkeypatch.setattr(Path, "open", _failing_open)

    pol_fail_closed = evaluate_transaction_policy(ticker="tAAPL", amount=10)
    assert pol_fail_closed.allowed is False
    assert pol_fail_closed.passed is False
    assert pol_fail_closed.requires_human_approval is True
    assert pol_fail_closed.error_code == ErrorCode.INTERNAL_ERROR.value
    assert "audit logging failed" in (pol_fail_closed.reason or "").lower()

    prep_fail_closed = server.prepare_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in prep_fail_closed
    assert prep_fail_closed["status"] == "rejected"
    assert prep_fail_closed["signed"] is False
    assert prep_fail_closed["requires_human_approval"] is True
    assert prep_fail_closed["policy"]["allowed"] is False
    assert "unsigned_tx" not in prep_fail_closed

    sim_fail_closed = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in sim_fail_closed
    assert sim_fail_closed["status"] == "rejected"
    assert sim_fail_closed["signed"] is False
    assert sim_fail_closed["requires_human_approval"] is True
    assert sim_fail_closed["policy"]["allowed"] is False
    assert "would_succeed" not in sim_fail_closed


def test_24_secret_redaction_in_policy_decisions_and_audit_logs() -> None:
    """Requirement 24: Private keys, seed phrases, and credentials are redacted in policy and logs."""
    logger = get_audit_logger()

    dec_pk = evaluate_transaction_policy(
        ticker=f"tAAPL_{SAMPLE_RAW_PRIVATE_KEY}",
        amount=10,
        from_wallet=SAMPLE_RAW_PRIVATE_KEY,
        to=SAMPLE_SEED_PHRASE,
        require_addresses=True,
    )
    assert dec_pk.allowed is False
    assert SAMPLE_RAW_PRIVATE_KEY not in json.dumps(dec_pk.to_error_response())
    assert SAMPLE_SEED_PHRASE not in json.dumps(dec_pk.to_error_response())

    res_sim_pk = server.simulate_transaction(
        from_wallet=SAMPLE_RAW_PRIVATE_KEY,
        ticker="tAAPL",
        to=SAMPLE_SEED_PHRASE,
        amount=10,
    )
    assert "error" in res_sim_pk
    assert SAMPLE_RAW_PRIVATE_KEY not in json.dumps(res_sim_pk)
    assert SAMPLE_SEED_PHRASE not in json.dumps(res_sim_pk)
    assert REDACTED_PLACEHOLDER in res_sim_pk["error"]

    raw_log = logger.log_file.read_text(encoding="utf-8")
    assert SAMPLE_RAW_PRIVATE_KEY not in raw_log
    assert SAMPLE_SEED_PHRASE not in raw_log


def test_25_26_intent_integrity_and_unsigned_transaction_behavior_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirements 25 & 26:
    - 10 tAAPL with isolated mocked provider fixture passes policy, prepares unsigned intent,
      and simulates cleanly with signed=False, broadcast=False, requires_human_approval=True.
    - Existing transaction-intent integrity checks reject tampered and expired intents.
    - Source files contain zero signing or broadcasting primitives.
    """
    mock_w3 = _make_isolated_mock_web3()
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    prepared = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_LOWER,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_LOWER,
        amount=10,
    )
    assert "error" not in prepared
    assert prepared["status"] == "prepared"
    assert prepared["signed"] is False
    assert prepared["broadcast"] is False
    assert prepared["requires_human_approval"] is True
    assert prepared["policy"]["allowed"] is True
    assert prepared["policy"]["passed"] is True
    assert prepared["policy"]["max_amount"] == "50"
    assert prepared["policy"]["requires_human_approval"] is True
    assert prepared["unsigned_tx"]["to"] == MOCK_AAPL_ADDRESS
    assert prepared["unsigned_tx"]["from"] == SAMPLE_SENDER_CHECKSUM
    assert prepared["unsigned_tx"]["data"].startswith(ERC20_TRANSFER_SELECTOR)
    decoded_to, decoded_units = decode_erc20_transfer_calldata(
        MOCK_AAPL_ADDRESS, prepared["unsigned_tx"]["data"]
    )
    assert decoded_to == SAMPLE_RECIPIENT_CHECKSUM
    assert decoded_units == 10 * 10**18

    # Verify intent integrity and tamper detection
    assert verify_prepared_transaction_intent(prepared)["intent_hash"] == prepared["intent_hash"]

    tampered_ticker = json.loads(json.dumps(prepared))
    tampered_ticker["ticker"] = "tMSFT"
    with pytest.raises(PolicyViolationError):
        verify_prepared_transaction_intent(tampered_ticker)

    expired_res = simulate_prepared_transaction_intent(
        prepared,
        w3=mock_w3,
        now=datetime.now(timezone.utc) + timedelta(hours=2),
    )
    assert "error" in expired_res
    assert expired_res["policy"]["error_code"] == ErrorCode.INTENT_EXPIRED.value
    assert expired_res["requires_human_approval"] is True

    # AST check across tools/policy.py, tools/tx.py, and server.py
    forbidden_calls = {
        "sign_transaction",
        "send_transaction",
        "send_raw_transaction",
        "from_key",
        "from_mnemonic",
    }
    for rel_path in ("tools/policy.py", "tools/tx.py", "server.py"):
        source = (PROJECT_ROOT / rel_path).read_text(encoding="utf-8")
        tree = ast.parse(source, filename=rel_path)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                assert node.func.attr not in forbidden_calls

