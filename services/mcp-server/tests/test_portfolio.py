"""Comprehensive unit and FastMCP integration tests for KYROX get_portfolio."""

from __future__ import annotations

from collections.abc import Coroutine
from decimal import Decimal
import json
import pathlib
from typing import Any, TypeVar
from unittest.mock import MagicMock

import pytest
from web3 import Web3

import server
from tools.errors import REDACTED_PLACEHOLDER, ErrorCode
from tools.log import get_audit_logger
import tools.stocks as stocks_module
import tools.wallet as wallet_module
from tools.wallet import (
    BASE_SEPOLIA_CHAIN_ID,
    MAX_UINT256,
    format_decimal_str,
    get_portfolio,
    normalize_raw_balance_decimal,
)

T = TypeVar("T")

SAMPLE_LOWER_WALLET = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f"
SAMPLE_CHECKSUM_WALLET = Web3.to_checksum_address(SAMPLE_LOWER_WALLET)

MOCK_AAPL_ADDRESS = "0x1111111111111111111111111111111111111111"
MOCK_TSLA_ADDRESS = "0x2222222222222222222222222222222222222222"
MOCK_NVDA_ADDRESS = "0x3333333333333333333333333333333333333333"
UNKNOWN_EXTERNAL_TOKEN = "0x9999999999999999999999999999999999999999"

SAMPLE_RAW_PRIVATE_KEY = (
    "0x" + ("ab" * 32)
)
SAMPLE_SEED_PHRASE = (
    "abandon ability able about above absent absorb abstract absurd abuse access accident"
)

CONFIGURED_THREE_STOCKS: list[dict[str, Any]] = [
    {
        "ticker": "tAAPL",
        "stock": "Test Apple",
        "reference_value": 230.0,
        "token_address": MOCK_AAPL_ADDRESS,
    },
    {
        "ticker": "tTSLA",
        "stock": "Test Tesla",
        "reference_value": 250.0,
        "token_address": MOCK_TSLA_ADDRESS,
    },
    {
        "ticker": "tNVDA",
        "stock": "Test Nvidia",
        "reference_value": 140.0,
        "token_address": MOCK_NVDA_ADDRESS,
    },
]


def _run_sync_coroutine(coro: Coroutine[Any, Any, T]) -> T:
    """Drive a non-blocking FastMCP coroutine to completion without socketpair."""
    try:
        coro.send(None)
    except StopIteration as stop:
        return stop.value
    finally:
        coro.close()
    raise RuntimeError("Coroutine yielded unexpectedly")


def _make_mock_web3(
    *,
    is_connected: bool = True,
    chain_id: int = BASE_SEPOLIA_CHAIN_ID,
    token_configs: dict[str, tuple[Any, Any]] | None = None,
    bytecode: bytes | str = b"\x60\x80\x60\x40",
) -> MagicMock:
    """Construct a mocked Web3 instance for deterministic offline portfolio tests."""
    w3 = MagicMock()
    w3.is_connected.return_value = is_connected
    w3.eth.chain_id = chain_id
    w3.eth.get_code.return_value = bytecode

    configs = {
        Web3.to_checksum_address(addr): val
        for addr, val in (token_configs or {}).items()
    }

    def _contract_side_effect(address: str, abi: list[dict[str, Any]]) -> MagicMock:
        checksum_addr = Web3.to_checksum_address(address)
        raw_balance, decimals = configs.get(checksum_addr, (0, 18))
        contract_mock = MagicMock()
        contract_mock.functions.balanceOf.return_value.call.return_value = raw_balance
        contract_mock.functions.decimals.return_value.call.return_value = decimals
        return contract_mock

    w3.eth.contract.side_effect = _contract_side_effect
    return w3


# ---------------------------------------------------------------------------
# 1. Valid Wallet with Multiple Supported Holdings
# ---------------------------------------------------------------------------


def test_portfolio_valid_wallet_with_multiple_supported_holdings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (1000 * 10**18, 18),  # 1,000 * 230.0 = 230,000.00
            MOCK_TSLA_ADDRESS: (1000 * 10**18, 18),  # 1,000 * 250.0 = 250,000.00
            MOCK_NVDA_ADDRESS: (1000 * 10**18, 18),  # 1,000 * 140.0 = 140,000.00
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    result = get_portfolio(SAMPLE_LOWER_WALLET)

    assert result["wallet"] == SAMPLE_CHECKSUM_WALLET
    assert result["chain"] == "base-sepolia"
    assert result["chain_id"] == 84532
    assert result["environment"] == "mock"
    assert result["valuation_basis"] == "mock_reference_value"
    assert result["currency"] == "USD"
    assert result["holding_count"] == 3
    assert result["priced_holding_count"] == 3
    assert result["unpriced_holdings"] == []
    assert result["total_value"] == 620000.0
    assert result["total_value_decimal"] == "620000.00"
    assert any("mock demonstration fixtures" in w for w in result["warnings"])

    holdings = result["holdings"]
    assert len(holdings) == 3
    assert holdings[0]["ticker"] == "tAAPL"
    assert holdings[0]["stock"] == "Test Apple"
    assert holdings[0]["balance"] == 1000
    assert holdings[0]["reference_value"] == 230.0
    assert holdings[0]["value"] == 230000.0
    assert holdings[0]["value_decimal"] == "230000.00"
    assert holdings[0]["priced"] is True
    assert holdings[0]["valuation_status"] == "priced"

    assert holdings[1]["ticker"] == "tTSLA"
    assert holdings[1]["value"] == 250000.0

    assert holdings[2]["ticker"] == "tNVDA"
    assert holdings[2]["value"] == 140000.0


# ---------------------------------------------------------------------------
# 2. Valid Wallet with One Holding
# ---------------------------------------------------------------------------


def test_portfolio_valid_wallet_with_single_holding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (0, 18),
            MOCK_TSLA_ADDRESS: (25 * 10**17, 18),  # 2.5 tTSLA @ 250.0 = 625.00
            MOCK_NVDA_ADDRESS: (0, 18),
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert result["holding_count"] == 1
    assert result["priced_holding_count"] == 1
    assert result["currency"] == "USD"
    assert result["total_value"] == 625.0
    assert result["total_value_decimal"] == "625.00"
    assert len(result["holdings"]) == 1
    holding = result["holdings"][0]
    assert holding["ticker"] == "tTSLA"
    assert holding["balance"] == 2.5
    assert holding["balance_decimal"] == "2.5"
    assert holding["value"] == 625.0
    assert holding["value_decimal"] == "625.00"


# ---------------------------------------------------------------------------
# 3. Empty Wallet
# ---------------------------------------------------------------------------


def test_portfolio_empty_wallet_returns_zero_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (0, 18),
            MOCK_TSLA_ADDRESS: (0, 18),
            MOCK_NVDA_ADDRESS: (0, 18),
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert result["wallet"] == SAMPLE_CHECKSUM_WALLET
    assert result["holdings"] == []
    assert result["holding_count"] == 0
    assert result["priced_holding_count"] == 0
    assert result["unpriced_holdings"] == []
    assert result["currency"] == "USD"
    assert result["total_value"] == 0.0
    assert result["total_value_decimal"] == "0.00"


# ---------------------------------------------------------------------------
# 4 & 19. Wallet with Unpriced Assets & Missing Reference Value
# ---------------------------------------------------------------------------


def test_portfolio_with_partial_unpriced_and_missing_reference_value_holdings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stocks_with_unpriced = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "token_address": MOCK_AAPL_ADDRESS,
        },
        {
            "ticker": "tTSLA",
            "stock": "Test Tesla",
            "reference_value": None,  # Missing reference value (#19)
            "token_address": MOCK_TSLA_ADDRESS,
        },
        {
            "ticker": "tNVDA",
            "stock": "Test Nvidia",
            "reference_value": 140.0,
            "stale": True,  # Stale reference value (#4)
            "token_address": MOCK_NVDA_ADDRESS,
        },
    ]
    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (10 * 10**18, 18),  # 10 * 230 = 2300.00
            MOCK_TSLA_ADDRESS: (5 * 10**18, 18),   # unpriced (missing ref)
            MOCK_NVDA_ADDRESS: (8 * 10**18, 18),   # unpriced (stale ref)
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: stocks_with_unpriced
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert result["holding_count"] == 3
    assert result["priced_holding_count"] == 1
    assert result["unpriced_holdings"] == ["tTSLA", "tNVDA"]
    assert result["currency"] == "USD"
    assert result["total_value"] == 2300.0
    assert result["total_value_decimal"] == "2300.00"

    by_ticker = {h["ticker"]: h for h in result["holdings"]}
    assert by_ticker["tAAPL"]["priced"] is True
    assert by_ticker["tAAPL"]["value"] == 2300.0

    assert by_ticker["tTSLA"]["priced"] is False
    assert by_ticker["tTSLA"]["valuation_status"] == "unpriced"
    assert by_ticker["tTSLA"]["reference_value"] is None
    assert by_ticker["tTSLA"]["value"] is None
    assert by_ticker["tTSLA"]["value_decimal"] is None

    assert by_ticker["tNVDA"]["priced"] is False
    assert by_ticker["tNVDA"]["reference_value"] is None
    assert by_ticker["tNVDA"]["value"] is None

    joined_warnings = " | ".join(result["warnings"])
    assert "tTSLA" in joined_warnings
    assert "tNVDA" in joined_warnings


def test_portfolio_when_all_held_assets_are_unpriced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    unpriced_only_stocks = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "unpriced": True,
            "token_address": MOCK_AAPL_ADDRESS,
        }
    ]
    mock_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (100 * 10**18, 18)}
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: unpriced_only_stocks
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert result["holding_count"] == 1
    assert result["priced_holding_count"] == 0
    assert result["unpriced_holdings"] == ["tAAPL"]
    assert result["currency"] is None
    assert result["total_value"] is None
    assert result["total_value_decimal"] is None
    assert any("All held positions are unpriced" in w for w in result["warnings"])


# ---------------------------------------------------------------------------
# 5 & 6. Invalid Wallet Format & Zero Wallet Address
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_wallet",
    [
        "",
        "   ",
        "0x12345",
        "not_a_wallet",
        "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        SAMPLE_CHECKSUM_WALLET[:-1]
        + ("f" if SAMPLE_CHECKSUM_WALLET[-1] == "F" else "F"),
    ],
)
def test_portfolio_rejects_invalid_wallet_format_before_rpc(
    bad_wallet: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    get_web3_mock = MagicMock()
    monkeypatch.setattr(wallet_module, "get_web3", get_web3_mock)

    result = get_portfolio(bad_wallet)
    assert "error" in result
    assert "holdings" not in result
    get_web3_mock.assert_not_called()


def test_portfolio_rejects_zero_wallet_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_web3_mock = MagicMock()
    monkeypatch.setattr(wallet_module, "get_web3", get_web3_mock)

    result = get_portfolio("0x0000000000000000000000000000000000000000")
    assert "error" in result
    assert "zero address" in result["error"].lower()
    get_web3_mock.assert_not_called()


# ---------------------------------------------------------------------------
# 7, 8 & 9. Unknown Token, Missing Token Contract, Invalid Contract Address
# ---------------------------------------------------------------------------


def test_portfolio_ignores_unknown_external_tokens_not_in_dataset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (10 * 10**18, 18),
            UNKNOWN_EXTERNAL_TOKEN: (999999 * 10**18, 18),
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS[:1]
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert [h["ticker"] for h in result["holdings"]] == ["tAAPL"]
    assert result["total_value"] == 2300.0
    assert mock_w3.eth.contract.call_count == 1


def test_portfolio_skips_blank_token_contracts_and_rejects_missing_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Default packaged stocks.json has blank token_address fields -> skipped cleanly with warning
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)

    result_blank = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert result_blank["holdings"] == []
    assert result_blank["total_value"] == 0.0
    assert any(
        "No deployed token contract addresses are configured" in w
        for w in result_blank["warnings"]
    )
    mock_w3.eth.contract.assert_not_called()

    # Record missing the 'token_address' key altogether -> error
    monkeypatch.setattr(
        wallet_module,
        "load_stocks",
        lambda: [{"ticker": "tAAPL", "stock": "Test Apple", "reference_value": 230.0}],
    )
    result_missing_key = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result_missing_key
    assert "token_address" in result_missing_key["error"]


@pytest.mark.parametrize(
    "invalid_contract",
    [
        "0xINVALID",
        "0x0000000000000000000000000000000000000000",
        SAMPLE_CHECKSUM_WALLET[:-1]
        + ("f" if SAMPLE_CHECKSUM_WALLET[-1] == "F" else "F"),
        12345,
    ],
)
def test_portfolio_rejects_invalid_contract_addresses(
    invalid_contract: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module,
        "load_stocks",
        lambda: [
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": 230.0,
                "token_address": invalid_contract,
            }
        ],
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    mock_w3.eth.contract.assert_not_called()


def test_portfolio_rejects_duplicate_contract_addresses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module,
        "load_stocks",
        lambda: [
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": 230.0,
                "token_address": MOCK_AAPL_ADDRESS,
            },
            {
                "ticker": "tTSLA",
                "stock": "Test Tesla",
                "reference_value": 250.0,
                "token_address": MOCK_AAPL_ADDRESS.lower(),
            },
        ],
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "Duplicate token contract address" in result["error"]


# ---------------------------------------------------------------------------
# 10, 11 & 12. Missing Bytecode, RPC Connection Failure, Incorrect Chain ID
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("empty_code", [b"", "0x", "0x0"])
def test_portfolio_rejects_contract_with_no_bytecode(
    empty_code: bytes | str, monkeypatch: pytest.MonkeyPatch
) -> None:
    mock_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (100 * 10**18, 18)},
        bytecode=empty_code,
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS[:1]
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "No contract bytecode found for tAAPL" in result["error"]


def test_portfolio_handles_rpc_connection_and_timeout_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    disconnected_w3 = _make_mock_web3(is_connected=False)
    monkeypatch.setattr(wallet_module, "get_web3", lambda: disconnected_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS[:1]
    )

    res_disc = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in res_disc
    assert "Unable to connect to Base Sepolia RPC provider" in res_disc["error"]

    # Contract call timeout
    timeout_w3 = _make_mock_web3()
    timeout_contract = MagicMock()
    timeout_contract.functions.balanceOf.return_value.call.side_effect = TimeoutError(
        "eth_call timed out"
    )
    timeout_w3.eth.contract.side_effect = lambda address, abi: timeout_contract
    monkeypatch.setattr(wallet_module, "get_web3", lambda: timeout_w3)

    res_timeout = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in res_timeout
    assert "timed out" in res_timeout["error"].lower()


@pytest.mark.parametrize("wrong_chain_id", [8453, 1, 11155111, 10])
def test_portfolio_rejects_incorrect_chain_id_including_base_mainnet(
    wrong_chain_id: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    mock_w3 = _make_mock_web3(chain_id=wrong_chain_id)
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert str(wrong_chain_id) in result["error"]
    assert "84532" in result["error"]
    mock_w3.eth.contract.assert_not_called()


# ---------------------------------------------------------------------------
# 13 & 14. Invalid Token Decimals & Contract/Dataset Decimal Mismatch
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_decimals", [-1, 78, True, False, "18", None])
def test_portfolio_rejects_invalid_onchain_or_configured_decimals(
    bad_decimals: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 1. On-chain contract returns invalid decimals
    mock_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (100, bad_decimals)}
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS[:1]
    )

    res_onchain = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in res_onchain
    assert "decimals" in res_onchain["error"].lower()

    # 2. Dataset record specifies invalid non-None decimals
    if bad_decimals is not None:
        monkeypatch.setattr(
            wallet_module,
            "load_stocks",
            lambda: [
                {
                    "ticker": "tAAPL",
                    "stock": "Test Apple",
                    "reference_value": 230.0,
                    "decimals": bad_decimals,
                    "token_address": MOCK_AAPL_ADDRESS,
                }
            ],
        )
        res_dataset = get_portfolio(SAMPLE_CHECKSUM_WALLET)
        assert "error" in res_dataset
        assert "decimals" in res_dataset["error"].lower()


def test_portfolio_enforces_contract_and_dataset_decimal_consistency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = get_audit_logger()
    stocks_with_decimals = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "decimals": 18,
            "token_address": MOCK_AAPL_ADDRESS,
        }
    ]
    # Contract reports 6 decimals while dataset expects 18 -> mismatch error
    mismatch_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (100 * 10**6, 6)}
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mismatch_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: stocks_with_decimals
    )

    res_mismatch = server.get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in res_mismatch
    assert "decimals mismatch" in res_mismatch["error"].lower()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.DECIMAL_MISMATCH.value

    # Matching decimals (18 == 18) succeeds
    match_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (10 * 10**18, 18)}
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: match_w3)
    res_ok = server.get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert res_ok["total_value"] == 2300.0


# ---------------------------------------------------------------------------
# 15, 16, 17 & 18. Raw Balance Bounds, Large Balances & Decimal Precision
# ---------------------------------------------------------------------------


def test_portfolio_rejects_negative_and_above_uint256_raw_balances(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValueError, match="expected non-negative integer"):
        normalize_raw_balance_decimal(-1, 18)

    with pytest.raises(ValueError, match="exceeds uint256 maximum"):
        normalize_raw_balance_decimal(MAX_UINT256 + 1, 18)

    for invalid_raw in (-1, MAX_UINT256 + 1):
        mock_w3 = _make_mock_web3(
            token_configs={MOCK_AAPL_ADDRESS: (invalid_raw, 18)}
        )
        monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
        monkeypatch.setattr(
            wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS[:1]
        )
        res = get_portfolio(SAMPLE_CHECKSUM_WALLET)
        assert "error" in res
        assert "raw token balance" in res["error"].lower()


def test_portfolio_handles_max_uint256_and_very_large_balances_with_exact_decimal_precision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # MAX_UINT256 with 0 decimals and reference_value 2.0 -> exact 2 * MAX_UINT256
    stocks_large = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 2.0,
            "token_address": MOCK_AAPL_ADDRESS,
        }
    ]
    mock_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (MAX_UINT256, 0)}
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(wallet_module, "load_stocks", lambda: stocks_large)

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    expected_total_int = MAX_UINT256 * 2
    assert result["holdings"][0]["balance"] == MAX_UINT256
    assert result["holdings"][0]["balance_decimal"] == str(MAX_UINT256)
    assert result["total_value"] == expected_total_int
    assert result["total_value_decimal"] == f"{expected_total_int}.00"


def test_portfolio_decimal_precision_without_binary_float_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1.000000000000000001 tAAPL (10**18 + 1 wei) @ 200.0 = 200.0000000000000002
    # Plus 0.1 tTSLA @ 1.0 + 0.2 tNVDA @ 1.0 -> exact Decimal addition
    precision_stocks = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 200.0,
            "token_address": MOCK_AAPL_ADDRESS,
        },
        {
            "ticker": "tTSLA",
            "stock": "Test Tesla",
            "reference_value": 1.0,
            "token_address": MOCK_TSLA_ADDRESS,
        },
        {
            "ticker": "tNVDA",
            "stock": "Test Nvidia",
            "reference_value": 1.0,
            "token_address": MOCK_NVDA_ADDRESS,
        },
    ]
    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (10**18 + 1, 18),
            MOCK_TSLA_ADDRESS: (10**17, 18),      # 0.1
            MOCK_NVDA_ADDRESS: (2 * 10**17, 18),  # 0.2
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(wallet_module, "load_stocks", lambda: precision_stocks)

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    by_ticker = {h["ticker"]: h for h in result["holdings"]}
    assert by_ticker["tAAPL"]["balance_decimal"] == "1.000000000000000001"
    assert by_ticker["tAAPL"]["value_decimal"] == "200.0000000000000002"
    assert result["total_value_decimal"] == "200.3000000000000002"
    assert format_decimal_str(Decimal("12.3400"), min_fraction_digits=2) == "12.34"


# ---------------------------------------------------------------------------
# 20 & 21. Invalid Reference Value & Mixed Valuation Currencies
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_ref",
    [0, 0.0, -25.0, float("nan"), float("inf"), float("-inf"), True, False, "230.0"],
)
def test_portfolio_rejects_invalid_reference_values(
    bad_ref: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    mock_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (10 * 10**18, 18)}
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module,
        "load_stocks",
        lambda: [
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": bad_ref,
                "token_address": MOCK_AAPL_ADDRESS,
            }
        ],
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "reference_value" in result["error"]


def test_portfolio_mixed_valuation_currencies_never_summed_into_single_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mixed_currency_stocks = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "currency": "USD",
            "token_address": MOCK_AAPL_ADDRESS,
        },
        {
            "ticker": "tTSLA",
            "stock": "Test Tesla",
            "reference_value": 210.0,
            "currency": "EUR",
            "token_address": MOCK_TSLA_ADDRESS,
        },
    ]
    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (10 * 10**18, 18),  # 2,300.00 USD
            MOCK_TSLA_ADDRESS: (10 * 10**18, 18),  # 2,100.00 EUR
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: mixed_currency_stocks
    )

    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert result["holding_count"] == 2
    assert result["priced_holding_count"] == 2
    assert result["holdings"][0]["currency"] == "USD"
    assert result["holdings"][0]["value"] == 2300.0
    assert result["holdings"][1]["currency"] == "EUR"
    assert result["holdings"][1]["value"] == 2100.0

    # Mixed currencies must NOT be summed into a single total_value
    assert result["currency"] is None
    assert result["total_value"] is None
    assert result["total_value_decimal"] is None
    assert any(
        "Mixed valuation currencies detected (EUR, USD)" in w
        for w in result["warnings"]
    )


@pytest.mark.parametrize("bad_currency", ["", "   ", 123, "US$", "U"])
def test_portfolio_rejects_invalid_currency_codes(
    bad_currency: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module,
        "load_stocks",
        lambda: [
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": 230.0,
                "currency": bad_currency,
                "token_address": MOCK_AAPL_ADDRESS,
            }
        ],
    )
    result = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "currency" in result["error"].lower()


# ---------------------------------------------------------------------------
# 22 & 23. Empty Dataset, Duplicate Tickers & KYROX_STOCKS_FILE Override
# ---------------------------------------------------------------------------


def test_portfolio_empty_dataset_and_duplicate_tickers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(wallet_module, "load_stocks", lambda: [])

    empty_res = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert empty_res["holdings"] == []
    assert empty_res["total_value"] == 0.0
    assert any("dataset is empty" in w for w in empty_res["warnings"])

    # Duplicate tickers (case-insensitive)
    monkeypatch.setattr(
        wallet_module,
        "load_stocks",
        lambda: [
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": 230.0,
                "token_address": MOCK_AAPL_ADDRESS,
            },
            {
                "ticker": "  taapl ",
                "stock": "Duplicate Apple",
                "reference_value": 235.0,
                "token_address": MOCK_TSLA_ADDRESS,
            },
        ],
    )
    dup_res = get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert "error" in dup_res
    assert "duplicate stock ticker" in dup_res["error"]


def test_kyrox_stocks_file_env_override_works_without_modifying_packaged_dataset(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    custom_file = tmp_path / "local_demo_stocks.json"
    custom_file.write_text(
        json.dumps(CONFIGURED_THREE_STOCKS),
        encoding="utf-8",
    )
    monkeypatch.setenv("KYROX_STOCKS_FILE", str(custom_file))
    stocks_module.invalidate_stocks_cache()

    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (1000 * 10**18, 18),
            MOCK_TSLA_ADDRESS: (1000 * 10**18, 18),
            MOCK_NVDA_ADDRESS: (1000 * 10**18, 18),
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)

    result = server.get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert result["total_value"] == 620000.0
    assert result["holding_count"] == 3


# ---------------------------------------------------------------------------
# 24, 25 & 26. Structured Errors, Audit-Log Redaction & MCP Tool Registration
# ---------------------------------------------------------------------------


def test_portfolio_audit_logging_and_secret_redaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = get_audit_logger()

    # 1. Accidental private key passed to get_portfolio
    res_pk = server.get_portfolio(SAMPLE_RAW_PRIVATE_KEY)
    assert "error" in res_pk
    assert SAMPLE_RAW_PRIVATE_KEY not in res_pk["error"]
    assert REDACTED_PLACEHOLDER in res_pk["error"]

    # 2. Accidental seed phrase passed to get_portfolio
    res_seed = server.get_portfolio(SAMPLE_SEED_PHRASE)
    assert "error" in res_seed
    assert "abandon ability" not in res_seed["error"]
    assert REDACTED_PLACEHOLDER in res_seed["error"]

    # 3. Successful portfolio call logged with context summary
    mock_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (10 * 10**18, 18)}
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS[:1]
    )
    res_ok = server.get_portfolio(SAMPLE_CHECKSUM_WALLET)
    assert res_ok["total_value"] == 2300.0

    raw_log = logger.log_file.read_text(encoding="utf-8")
    assert SAMPLE_RAW_PRIVATE_KEY not in raw_log
    assert SAMPLE_SEED_PHRASE not in raw_log

    entries = [json.loads(line) for line in raw_log.splitlines() if line.strip()]
    assert len(entries) == 3
    assert entries[2]["tool"] == "get_portfolio"
    assert entries[2]["status"] == "ok"
    assert entries[2]["context"]["holding_count"] == 1
    assert entries[2]["context"]["currency"] == "USD"
    assert entries[2]["context"]["unpriced_count"] == 0


def test_fastmcp_registers_get_portfolio_with_read_only_annotations_and_invokes_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tools = _run_sync_coroutine(server.mcp.list_tools())
    tool_by_name = {tool.name: tool for tool in tools}

    assert "get_portfolio" in tool_by_name
    portfolio_tool = tool_by_name["get_portfolio"]
    input_schema = portfolio_tool.inputSchema
    assert input_schema.get("required") == ["wallet"]
    assert set(input_schema.get("properties", {}).keys()) == {"wallet"}
    assert input_schema["properties"]["wallet"].get("type") == "string"

    assert portfolio_tool.annotations is not None
    assert portfolio_tool.annotations.readOnlyHint is True
    assert portfolio_tool.annotations.destructiveHint is False
    assert portfolio_tool.annotations.idempotentHint is True

    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (1000 * 10**18, 18),
            MOCK_TSLA_ADDRESS: (1000 * 10**18, 18),
            MOCK_NVDA_ADDRESS: (1000 * 10**18, 18),
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    content_blocks, structured_output = _run_sync_coroutine(
        server.mcp.call_tool("get_portfolio", {"wallet": SAMPLE_LOWER_WALLET})
    )
    assert structured_output["wallet"] == SAMPLE_CHECKSUM_WALLET
    assert structured_output["total_value"] == 620000.0
    assert json.loads(content_blocks[0].text) == structured_output

