"""Comprehensive unit, security, serialization, and FastMCP integration tests for
KYROX Day 9 unsigned ERC-20 transaction preparation (``prepare_transaction``).

All positive transaction-building tests in this module use deterministic MOCK TEST
FIXTURES (``_make_mock_web3``) and are explicitly distinct from live Base Sepolia
network execution.
"""

from __future__ import annotations

import ast
from collections.abc import Coroutine
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import pathlib
from typing import Any, TypeVar
from unittest.mock import MagicMock, PropertyMock

from hexbytes import HexBytes
import pytest
from web3 import Web3
from web3.exceptions import (
    ContractCustomError,
    ContractLogicError,
    ContractPanicError,
    ProviderConnectionError,
    Web3RPCError,
)
from web3.providers.base import JSONBaseProvider
from web3.types import RPCEndpoint, RPCResponse

import server
from tools.errors import (
    REDACTED_PLACEHOLDER,
    ErrorCode,
    PolicyViolationError,
    redact_sensitive_data,
)
from tools.log import get_audit_logger
import tools.stocks as stocks_module
import tools.tx as tx_module
from tools.tx import (
    BASE_SEPOLIA_CHAIN_ID,
    BASE_SEPOLIA_CHAIN_ID_HEX,
    ERC20_INSUFFICIENT_BALANCE_SELECTOR,
    ERC20_TRANSFER_ABI,
    ERC20_TRANSFER_SELECTOR,
    FORBIDDEN_SIMULATION_CALL_KEYS,
    MAX_GAS_ESTIMATE_UNITS,
    SIMULATION_BLOCK_IDENTIFIER,
    SIMULATION_CALL_ALLOWED_KEYS,
    SOLIDITY_ERROR_STRING_SELECTOR,
    build_simulation_call_object,
    compute_intent_hash,
    decode_erc20_transfer_calldata,
    encode_erc20_transfer_calldata,
    prepare_transaction,
    simulate_prepared_transaction_intent,
    simulate_transaction,
    validate_recipient_address,
    validate_sender_address,
    verify_prepared_transaction_intent,
)
import tools.wallet as wallet_module
from tools.wallet import MAX_UINT256, ZERO_ADDRESS

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
T = TypeVar("T")

SAMPLE_SENDER_LOWER = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f"
SAMPLE_SENDER_CHECKSUM = Web3.to_checksum_address(SAMPLE_SENDER_LOWER)

SAMPLE_RECIPIENT_LOWER = "0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5"
SAMPLE_RECIPIENT_CHECKSUM = Web3.to_checksum_address(SAMPLE_RECIPIENT_LOWER)

MOCK_AAPL_ADDRESS = "0x1111111111111111111111111111111111111111"
MOCK_TSLA_ADDRESS = "0x2222222222222222222222222222222222222222"
MOCK_NVDA_ADDRESS = "0x3333333333333333333333333333333333333333"

SAMPLE_RAW_PRIVATE_KEY = (
    "0x" + ("ab" * 32)
)
SAMPLE_SEED_PHRASE = (
    "abandon ability able about above absent absorb abstract absurd abuse access accident"
)

# MOCK TEST FIXTURE stock catalogue with deterministic mock contract addresses
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
    decimals_by_token: dict[str, Any] | None = None,
    sender_balances_by_token: dict[str, int] | None = None,
    bytecode: bytes | str = b"\x60\x80\x60\x40",
    pending_nonce: Any = 7,
    block_number: Any = 19_500_000,
    block_number_side_effect: Any = None,
    include_fee_fields: bool = True,
    use_hexbytes_data: bool = False,
    eth_call_return: Any = HexBytes("0x" + ("00" * 31) + "01"),
    eth_call_side_effect: Any = None,
    estimated_gas: Any = 52000,
    estimate_gas_side_effect: Any = None,
    insufficient_balance_revert_style: str = "oz_v5",
) -> MagicMock:
    """Construct a deterministic MOCK TEST FIXTURE Web3 instance for offline testing."""
    w3 = MagicMock()
    w3.is_connected.return_value = is_connected
    w3.eth.chain_id = chain_id
    w3.eth.get_code.return_value = bytecode
    w3.eth.get_transaction_count.return_value = pending_nonce
    if block_number_side_effect is not None:
        block_prop = PropertyMock(side_effect=block_number_side_effect)
    else:
        block_prop = PropertyMock(return_value=block_number)
    type(w3.eth).block_number = block_prop
    w3._block_number_property_mock = block_prop

    # Ensure signing and broadcasting methods fail immediately if ever invoked
    w3.eth.send_transaction.side_effect = AssertionError(
        "FORBIDDEN: send_transaction must never be called"
    )
    w3.eth.send_raw_transaction.side_effect = AssertionError(
        "FORBIDDEN: send_raw_transaction must never be called"
    )
    w3.eth.account.sign_transaction.side_effect = AssertionError(
        "FORBIDDEN: account.sign_transaction must never be called"
    )
    w3.eth.sign_transaction.side_effect = AssertionError(
        "FORBIDDEN: sign_transaction must never be called"
    )

    decimals_map = {
        Web3.to_checksum_address(addr): dec
        for addr, dec in (decimals_by_token or {}).items()
    }
    balances_map = {
        Web3.to_checksum_address(addr): bal
        for addr, bal in (sender_balances_by_token or {}).items()
    }

    if eth_call_side_effect is not None:
        w3.eth.call.side_effect = eth_call_side_effect
    elif sender_balances_by_token is not None:
        def _balance_checked_eth_call(
            tx_params: dict[str, Any],
            block_identifier: str = "latest",
        ) -> Any:
            target_contract = Web3.to_checksum_address(str(tx_params["to"]))
            sender_addr = Web3.to_checksum_address(str(tx_params["from"]))
            _, requested_units = decode_erc20_transfer_calldata(
                target_contract, str(tx_params["data"])
            )
            available_units = balances_map.get(target_contract, 0)
            if requested_units > available_units:
                if insufficient_balance_revert_style == "oz_v5":
                    encoded_args = Web3().codec.encode(
                        ["address", "uint256", "uint256"],
                        [sender_addr, available_units, requested_units],
                    )
                    revert_hex = ERC20_INSUFFICIENT_BALANCE_SELECTOR + encoded_args.hex()
                    raise ContractCustomError(
                        f"execution reverted: custom error {revert_hex}",
                        data=revert_hex,
                    )
                raise ContractLogicError(
                    "execution reverted: ERC20: transfer amount exceeds balance"
                )
            return eth_call_return

        w3.eth.call.side_effect = _balance_checked_eth_call
    else:
        w3.eth.call.return_value = eth_call_return

    if estimate_gas_side_effect is not None:
        w3.eth.estimate_gas.side_effect = estimate_gas_side_effect
    else:
        w3.eth.estimate_gas.return_value = estimated_gas

    def _contract_side_effect(address: str, abi: list[dict[str, Any]]) -> MagicMock:
        checksum_addr = Web3.to_checksum_address(address)
        token_decimals = decimals_map.get(checksum_addr, 18)
        contract_mock = MagicMock()
        contract_mock.functions.decimals.return_value.call.return_value = token_decimals
        if checksum_addr in balances_map:
            contract_mock.functions.balanceOf.return_value.call.return_value = (
                balances_map[checksum_addr]
            )

        def _transfer_side_effect(recipient: str, base_units: int) -> MagicMock:
            transfer_call_mock = MagicMock()
            encoded_hex = encode_erc20_transfer_calldata(
                checksum_addr, recipient, base_units
            )
            data_field: str | HexBytes = (
                HexBytes(encoded_hex) if use_hexbytes_data else encoded_hex
            )

            def _build_tx_side_effect(tx_params: dict[str, Any]) -> dict[str, Any]:
                envelope: dict[str, Any] = {
                    "from": tx_params["from"],
                    "to": checksum_addr,
                    "data": data_field,
                    "value": tx_params.get("value", 0),
                    "nonce": tx_params["nonce"],
                    "chainId": tx_params["chainId"],
                }
                if include_fee_fields:
                    envelope["gas"] = 65000
                    envelope["maxFeePerGas"] = 1_500_000_000
                    envelope["maxPriorityFeePerGas"] = 100_000_000
                return envelope

            transfer_call_mock.build_transaction.side_effect = _build_tx_side_effect
            return transfer_call_mock

        contract_mock.functions.transfer.side_effect = _transfer_side_effect
        return contract_mock

    w3.eth.contract.side_effect = _contract_side_effect
    return w3


# ===========================================================================
# A. SUCCESSFUL PREPARATION TESTS (MOCK TEST FIXTURE)
# ===========================================================================


def test_prepare_transaction_success_full_envelope_and_calldata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify successful unsigned ERC-20 transfer preparation using a mock provider."""
    mock_w3 = _make_mock_web3(
        decimals_by_token={MOCK_AAPL_ADDRESS: 18},
        pending_nonce=12,
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = prepare_transaction(
        from_wallet=SAMPLE_SENDER_LOWER,
        ticker="taapl",
        to=SAMPLE_RECIPIENT_LOWER,
        amount="12.5",
    )

    assert "error" not in result
    assert result["status"] == "prepared"
    assert result["signed"] is False
    assert result["broadcast"] is False
    assert result["requires_human_approval"] is True
    assert result["requires_external_signature"] is True
    assert result["signing_mode"] == "external_wallet_only"

    # Asset & chain metadata
    assert result["ticker"] == "tAAPL"
    assert result["stock"] == "Test Apple"
    assert result["chain"] == "base-sepolia"
    assert result["chain_id"] == 84532
    assert result["chain_id_hex"] == BASE_SEPOLIA_CHAIN_ID_HEX == "0x14a34"
    assert result["environment"] == "mock"

    # Address mapping: outer tx 'to' is TOKEN CONTRACT; 'to'/'recipient' is RECIPIENT WALLET
    assert result["from_wallet"] == SAMPLE_SENDER_CHECKSUM
    assert result["sender"] == SAMPLE_SENDER_CHECKSUM
    assert result["to"] == SAMPLE_RECIPIENT_CHECKSUM
    assert result["recipient"] == SAMPLE_RECIPIENT_CHECKSUM
    assert result["token_address"] == MOCK_AAPL_ADDRESS
    assert result["contract_address"] == MOCK_AAPL_ADDRESS

    # Exact amount & base units
    expected_base_units = 125 * 10**17  # 12.5 * 10**18
    assert result["decimals"] == 18
    assert result["decimals_source"] == "contract_and_dataset"
    assert result["amount"] == 12.5
    assert result["amount_decimal"] == "12.5"
    assert result["amount_base_units"] == expected_base_units
    assert result["raw_amount"] == str(expected_base_units)

    # Calldata verification
    expected_calldata = encode_erc20_transfer_calldata(
        MOCK_AAPL_ADDRESS,
        SAMPLE_RECIPIENT_CHECKSUM,
        expected_base_units,
    )
    assert result["function"] == "transfer(address,uint256)"
    assert result["data"] == expected_calldata
    assert result["calldata"] == expected_calldata
    assert result["data"].startswith(ERC20_TRANSFER_SELECTOR)
    decoded_recipient, decoded_amount = decode_erc20_transfer_calldata(
        MOCK_AAPL_ADDRESS, result["data"]
    )
    assert decoded_recipient == SAMPLE_RECIPIENT_CHECKSUM
    assert decoded_amount == expected_base_units

    # Unsigned transaction envelope
    unsigned_tx = result["unsigned_tx"]
    assert unsigned_tx["from"] == SAMPLE_SENDER_CHECKSUM
    assert unsigned_tx["to"] == MOCK_AAPL_ADDRESS
    assert unsigned_tx["to"] != SAMPLE_RECIPIENT_CHECKSUM
    assert unsigned_tx["data"] == expected_calldata
    assert unsigned_tx["value"] == 0
    assert unsigned_tx["nonce"] == 12
    assert unsigned_tx["chainId"] == 84532
    assert unsigned_tx["gas"] == 65000
    assert unsigned_tx["maxFeePerGas"] == 1_500_000_000
    assert unsigned_tx["maxPriorityFeePerGas"] == 100_000_000

    # Nonce strategy & intent verification
    assert result["nonce"] == 12
    assert result["nonce_strategy"] == "pending"
    assert "snapshot" in result["nonce_note"].lower()
    mock_w3.eth.get_transaction_count.assert_called_once_with(
        SAMPLE_SENDER_CHECKSUM, "pending"
    )
    assert verify_prepared_transaction_intent(result)["intent_hash"] == result["intent_hash"]

    # Zero signing or broadcasting calls
    mock_w3.eth.send_transaction.assert_not_called()
    mock_w3.eth.send_raw_transaction.assert_not_called()
    mock_w3.eth.account.sign_transaction.assert_not_called()
    mock_w3.eth.sign_transaction.assert_not_called()


@pytest.mark.parametrize(
    ("ticker", "token_addr", "decimals", "amount_input", "expected_dec_str", "expected_base_units"),
    [
        ("tAAPL", MOCK_AAPL_ADDRESS, 18, 10, "10", 10 * 10**18),
        ("tTSLA", MOCK_TSLA_ADDRESS, 6, "0.123456", "0.123456", 123456),
        ("tNVDA", MOCK_NVDA_ADDRESS, 8, Decimal("1.5"), "1.5", 150_000_000),
        ("tAAPL", MOCK_AAPL_ADDRESS, 0, 42, "42", 42),
        ("tTSLA", MOCK_TSLA_ADDRESS, 18, "0.000000000000000001", "0.000000000000000001", 1),
    ],
)
def test_prepare_transaction_supports_custom_decimals_and_exact_amounts(
    ticker: str,
    token_addr: str,
    decimals: int,
    amount_input: int | float | str | Decimal,
    expected_dec_str: str,
    expected_base_units: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    custom_stocks = [
        {
            "ticker": ticker,
            "stock": f"Test {ticker}",
            "reference_value": 100.0,
            "decimals": decimals,
            "token_address": token_addr,
        }
    ]
    mock_w3 = _make_mock_web3(
        decimals_by_token={token_addr: decimals},
        include_fee_fields=False,
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: custom_stocks)

    result = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker=ticker,
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=amount_input,
    )

    assert result["status"] == "prepared"
    assert result["signed"] is False
    assert result["decimals"] == decimals
    assert result["amount_decimal"] == expected_dec_str
    assert result["amount_base_units"] == expected_base_units
    assert result["unsigned_tx"]["to"] == token_addr
    assert "gas" not in result["unsigned_tx"]
    assert "maxFeePerGas" not in result["unsigned_tx"]


# ===========================================================================
# B. INVALID INPUT TESTS
# ===========================================================================


@pytest.mark.parametrize("empty_ticker", ["", "   ", "\t\n", None])
def test_prepare_transaction_rejects_missing_ticker(
    empty_ticker: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    get_web3_mock = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_mock)

    result = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker=empty_ticker,
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in result
    assert "ticker must not be empty" in result["error"].lower()
    get_web3_mock.assert_not_called()


@pytest.mark.parametrize("unknown_ticker", ["UNKNOWN", "AAPL", "tDOGE", "BTC"])
def test_prepare_transaction_rejects_unsupported_ticker(
    unknown_ticker: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    get_web3_mock = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_mock)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker=unknown_ticker,
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in result
    assert "not found" in result["error"].lower()
    get_web3_mock.assert_not_called()


@pytest.mark.parametrize(
    "bad_sender",
    [
        "",
        "   ",
        None,
        "0x12345",
        "not_a_wallet",
        "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        SAMPLE_SENDER_CHECKSUM[:-1]
        + ("f" if SAMPLE_SENDER_CHECKSUM[-1] == "F" else "F"),
    ],
)
def test_prepare_transaction_rejects_invalid_sender_address(
    bad_sender: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    get_web3_mock = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_mock)

    result = prepare_transaction(
        from_wallet=bad_sender,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in result
    assert "from_wallet" in result["error"]
    get_web3_mock.assert_not_called()


@pytest.mark.parametrize(
    "bad_recipient",
    [
        "",
        "   ",
        None,
        "0x12345",
        "not_a_recipient",
        "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        SAMPLE_RECIPIENT_CHECKSUM[:-1]
        + ("e" if SAMPLE_RECIPIENT_CHECKSUM[-1] == "E" else "E"),
    ],
)
def test_prepare_transaction_rejects_invalid_recipient_address(
    bad_recipient: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    get_web3_mock = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_mock)

    result = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=bad_recipient,
        amount=10,
    )
    assert "error" in result
    assert "(to)" in result["error"]
    get_web3_mock.assert_not_called()


def test_prepare_transaction_rejects_zero_address_for_sender_recipient_and_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_web3_mock = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_mock)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # 1. Zero sender
    res_sender = prepare_transaction(
        from_wallet=ZERO_ADDRESS,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in res_sender
    assert "zero address" in res_sender["error"].lower()

    # 2. Zero recipient
    res_recipient = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=ZERO_ADDRESS,
        amount=10,
    )
    assert "error" in res_recipient
    assert "zero address" in res_recipient["error"].lower()

    # 3. Zero token contract
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
    res_contract = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in res_contract
    assert "zero address" in res_contract["error"].lower()
    get_web3_mock.assert_not_called()


@pytest.mark.parametrize(
    "bad_contract",
    [
        "0xINVALID",
        "0x1234",
        SAMPLE_SENDER_CHECKSUM[:-1]
        + ("f" if SAMPLE_SENDER_CHECKSUM[-1] == "F" else "F"),
        12345,
    ],
)
def test_prepare_transaction_rejects_invalid_token_contract_address(
    bad_contract: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    get_web3_mock = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_mock)
    monkeypatch.setattr(
        tx_module,
        "load_stocks",
        lambda: [
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": 230.0,
                "token_address": bad_contract,
            }
        ],
    )

    result = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in result
    assert "token contract address" in result["error"].lower()
    get_web3_mock.assert_not_called()


@pytest.mark.parametrize(
    "bad_amount",
    [
        0,
        0.0,
        "0",
        "0.000",
        Decimal("0"),
        -1,
        -0.0001,
        "-25.5",
        Decimal("-10"),
        float("nan"),
        float("inf"),
        float("-inf"),
        "NaN",
        "Infinity",
        "-Infinity",
        Decimal("NaN"),
        Decimal("Infinity"),
        Decimal("-Infinity"),
        True,
        False,
        None,
        "",
        "   ",
        "not_a_number",
        [10],
        {"amount": 10},
    ],
)
def test_prepare_transaction_rejects_zero_negative_nan_infinity_and_boolean_amounts(
    bad_amount: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    get_web3_mock = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_mock)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=bad_amount,
    )
    assert "error" in result
    get_web3_mock.assert_not_called()


def test_prepare_transaction_rejects_excessive_decimal_precision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1. 19 decimal places for an 18-decimal token
    mock_w3_18 = _make_mock_web3(decimals_by_token={MOCK_AAPL_ADDRESS: 18})
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3_18)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    res_19 = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount="1.0000000000000000001",
    )
    assert "error" in res_19
    assert "excessive decimal precision" in res_19["error"].lower()

    # 2. 7 decimal places for a 6-decimal token discovered on-chain
    stocks_no_cfg_decimals = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "token_address": MOCK_AAPL_ADDRESS,
        }
    ]
    mock_w3_6 = _make_mock_web3(decimals_by_token={MOCK_AAPL_ADDRESS: 6})
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3_6)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: stocks_no_cfg_decimals)

    res_7 = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount="1.1234567",
    )
    assert "error" in res_7
    assert "excessive decimal precision" in res_7["error"].lower()


@pytest.mark.parametrize("bad_decimals", [None, True, False, -1, 78, "18"])
def test_prepare_transaction_rejects_missing_or_invalid_contract_decimals(
    bad_decimals: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    stocks_no_cfg_decimals = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "token_address": MOCK_AAPL_ADDRESS,
        }
    ]
    mock_w3 = _make_mock_web3(decimals_by_token={MOCK_AAPL_ADDRESS: bad_decimals})
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: stocks_no_cfg_decimals)

    result = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in result
    assert "decimals" in result["error"].lower()


def test_prepare_transaction_rejects_contract_and_dataset_decimals_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = get_audit_logger()
    # Dataset says 18 decimals, contract reports 6 decimals
    mock_w3 = _make_mock_web3(decimals_by_token={MOCK_AAPL_ADDRESS: 6})
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in result
    assert "decimals mismatch" in result["error"].lower()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.DECIMAL_MISMATCH.value


def test_prepare_transaction_rejects_unconfigured_blank_contract_in_packaged_dataset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When data/stocks.json has blank token_address (''), preparation rejects safely."""
    logger = get_audit_logger()
    get_web3_mock = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_mock)

    result = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in result
    assert "not configured in the stock dataset" in result["error"]
    get_web3_mock.assert_not_called()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.MISSING_CONFIGURATION.value


@pytest.mark.parametrize("empty_bytecode", [b"", "0x", "0x0"])
def test_prepare_transaction_rejects_missing_deployed_contract_bytecode(
    empty_bytecode: bytes | str, monkeypatch: pytest.MonkeyPatch
) -> None:
    logger = get_audit_logger()
    mock_w3 = _make_mock_web3(bytecode=empty_bytecode)
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in result
    assert "No contract bytecode found for tAAPL" in result["error"]

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.MISSING_CONTRACT_BYTECODE.value


# ===========================================================================
# C. SECURITY & POLICY BEHAVIOUR TESTS
# ===========================================================================


@pytest.mark.parametrize("wrong_chain_id", [8453, 1, 11155111, 42161, 10])
def test_prepare_transaction_rejects_wrong_chain_id_including_base_mainnet_8453(
    wrong_chain_id: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    logger = get_audit_logger()
    mock_w3 = _make_mock_web3(chain_id=wrong_chain_id)
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in result
    assert str(wrong_chain_id) in result["error"]
    assert "84532" in result["error"]
    mock_w3.eth.contract.assert_not_called()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.UNSUPPORTED_CHAIN_ID.value


def test_prepare_transaction_enforces_maximum_amount_policy_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = get_audit_logger()
    monkeypatch.setenv("KYROX_MAX_TX_AMOUNT", "50")
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # Exactly 50 tokens succeeds
    res_ok = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount="50",
    )
    assert res_ok["status"] == "prepared"
    assert res_ok["policy"]["max_amount"] == "50"

    # 50.0001 tokens is blocked by policy before RPC
    get_web3_blocked = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_blocked)
    res_over = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount="50.0001",
    )
    assert "error" in res_over
    assert "exceeds maximum allowed limit (50)" in res_over["error"]
    get_web3_blocked.assert_not_called()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.POLICY_REJECTED.value


def test_prepare_transaction_enforces_recipient_allowlist_and_approved_tickers_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = get_audit_logger()
    other_wallet = "0x4444444444444444444444444444444444444444"
    monkeypatch.setenv("KYROX_ALLOWED_RECIPIENTS", SAMPLE_RECIPIENT_LOWER)
    monkeypatch.setenv("KYROX_APPROVED_TICKERS", "tAAPL,tTSLA")

    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # 1. Allowed recipient & approved ticker succeeds
    res_ok = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=5,
    )
    assert res_ok["status"] == "prepared"

    # 2. Non-allowlisted recipient is blocked by policy
    res_bad_recipient = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=other_wallet,
        amount=5,
    )
    assert "error" in res_bad_recipient
    assert "recipient allowlist" in res_bad_recipient["error"]

    # 3. Unapproved ticker (tNVDA excluded from KYROX_APPROVED_TICKERS) is blocked by policy
    res_bad_ticker = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tNVDA",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=5,
    )
    assert "error" in res_bad_ticker
    assert "approved ticker set" in res_bad_ticker["error"]

    # 4. Recipient equal to token contract address is blocked by policy
    monkeypatch.delenv("KYROX_ALLOWED_RECIPIENTS", raising=False)
    res_self_contract = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=MOCK_AAPL_ADDRESS,
        amount=5,
    )
    assert "error" in res_self_contract
    assert "cannot be the tAAPL token contract address" in res_self_contract["error"]

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.POLICY_REJECTED.value
    assert entries[-2]["error_code"] == ErrorCode.POLICY_REJECTED.value
    assert entries[-3]["error_code"] == ErrorCode.POLICY_REJECTED.value


def test_verify_prepared_transaction_intent_detects_tampering_and_expiration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    intent = prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount="10",
    )
    assert verify_prepared_transaction_intent(intent)["intent_id"] == intent["intent_id"]

    # 1. Tamper signed=True -> POLICY_REJECTED
    tampered_signed = json.loads(json.dumps(intent))
    tampered_signed["signed"] = True
    with pytest.raises(PolicyViolationError) as exc_signed:
        verify_prepared_transaction_intent(tampered_signed)
    assert exc_signed.value.code == ErrorCode.POLICY_REJECTED

    # 2. Tamper amount_base_units -> INTENT_TAMPERED
    tampered_amount = json.loads(json.dumps(intent))
    tampered_amount["amount_base_units"] += 1
    with pytest.raises(PolicyViolationError) as exc_amt:
        verify_prepared_transaction_intent(tampered_amount)
    assert exc_amt.value.code == ErrorCode.INTENT_TAMPERED

    # 3. Tamper recipient address -> INTENT_TAMPERED
    tampered_to = json.loads(json.dumps(intent))
    tampered_to["to"] = "0x4444444444444444444444444444444444444444"
    with pytest.raises(PolicyViolationError) as exc_to:
        verify_prepared_transaction_intent(tampered_to)
    assert exc_to.value.code == ErrorCode.INTENT_TAMPERED

    # 4. Tamper unsigned_tx.to -> INTENT_TAMPERED
    tampered_target = json.loads(json.dumps(intent))
    tampered_target["unsigned_tx"]["to"] = SAMPLE_RECIPIENT_CHECKSUM
    with pytest.raises(PolicyViolationError) as exc_target:
        verify_prepared_transaction_intent(tampered_target)
    assert exc_target.value.code == ErrorCode.INTENT_TAMPERED

    # 5. Tamper intent_hash -> INTENT_TAMPERED
    tampered_hash = json.loads(json.dumps(intent))
    tampered_hash["intent_hash"] = "0x" + ("a" * 64)
    with pytest.raises(PolicyViolationError) as exc_hash:
        verify_prepared_transaction_intent(tampered_hash)
    assert exc_hash.value.code == ErrorCode.INTENT_TAMPERED

    # 6. Expired intent -> INTENT_EXPIRED
    future_now = datetime.now(timezone.utc) + timedelta(hours=2)
    with pytest.raises(PolicyViolationError) as exc_exp:
        verify_prepared_transaction_intent(intent, now=future_now)
    assert exc_exp.value.code == ErrorCode.INTENT_EXPIRED


def test_prepare_transaction_handles_rpc_failures_timeouts_and_redacts_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = get_audit_logger()
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # 1. Disconnected RPC
    disc_w3 = _make_mock_web3(is_connected=False)
    monkeypatch.setattr(tx_module, "get_web3", lambda: disc_w3)
    res_disc = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in res_disc
    assert "Unable to connect to Base Sepolia RPC provider" in res_disc["error"]

    # 2. Pending nonce RPC timeout
    timeout_w3 = _make_mock_web3()
    timeout_w3.eth.get_transaction_count.side_effect = TimeoutError(
        "eth_getTransactionCount timed out"
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: timeout_w3)
    res_timeout = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "error" in res_timeout
    assert "timed out" in res_timeout["error"].lower()

    # 3. Accidental private key / seed phrase in arguments + leaked RPC secret in exception
    leaking_w3 = _make_mock_web3()
    leaking_w3.is_connected.side_effect = RuntimeError(
        f"RPC failed at https://user:secretpass123@sepolia.base.org/v3/alcht_998877665544332211 "
        f"with key {SAMPLE_RAW_PRIVATE_KEY}"
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: leaking_w3)
    res_leak = server.prepare_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=10,
    )
    assert "secretpass123" not in res_leak["error"]
    assert "alcht_998877665544332211" not in res_leak["error"]
    assert SAMPLE_RAW_PRIVATE_KEY not in res_leak["error"]
    assert REDACTED_PLACEHOLDER in res_leak["error"]

    res_pk = server.prepare_transaction(
        from_wallet=SAMPLE_RAW_PRIVATE_KEY,
        ticker="tAAPL",
        to=SAMPLE_SEED_PHRASE,
        amount=10,
    )
    assert SAMPLE_RAW_PRIVATE_KEY not in res_pk["error"]
    assert "abandon ability" not in res_pk["error"]

    raw_log = logger.log_file.read_text(encoding="utf-8")
    assert SAMPLE_RAW_PRIVATE_KEY not in raw_log
    assert SAMPLE_SEED_PHRASE not in raw_log
    assert "secretpass123" not in raw_log
    assert "alcht_998877665544332211" not in raw_log


def test_source_code_contains_zero_signing_broadcasting_or_private_key_primitives() -> None:
    """AST inspection verifying tools/tx.py and server.py never call sign or send methods."""
    forbidden_attr_names = {
        "sign_transaction",
        "send_transaction",
        "send_raw_transaction",
        "from_key",
        "from_mnemonic",
        "encrypt",
        "decrypt",
    }
    for rel_path in ("tools/tx.py", "server.py"):
        source = (PROJECT_ROOT / rel_path).read_text(encoding="utf-8")
        tree = ast.parse(source, filename=rel_path)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                assert node.func.attr not in forbidden_attr_names, (
                    f"Forbidden signing/broadcasting call {node.func.attr!r} found in {rel_path}"
                )

    function_names = {entry.get("name") for entry in ERC20_TRANSFER_ABI}
    assert function_names == {"decimals", "transfer"}


# ===========================================================================
# D. SERIALIZATION TESTS
# ===========================================================================


def test_prepare_transaction_response_is_strictly_json_serializable_including_hexbytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ensure HexBytes, Decimal, and int values serialize cleanly to JSON without custom encoders."""
    mock_w3 = _make_mock_web3(use_hexbytes_data=True)
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = prepare_transaction(
        from_wallet=SAMPLE_SENDER_LOWER,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_LOWER,
        amount=Decimal("25.75"),
    )

    serialized = json.dumps(result)
    deserialized = json.loads(serialized)
    assert deserialized == result
    assert isinstance(result["data"], str)
    assert isinstance(result["unsigned_tx"]["data"], str)
    assert not isinstance(result["unsigned_tx"]["data"], (bytes, bytearray, HexBytes))
    assert isinstance(result["amount_base_units"], int)
    assert isinstance(result["amount_decimal"], str)
    assert deserialized["signed"] is False

    # Verify redact_sensitive_data preserves the entire prepared intent including intent_hash
    redacted = redact_sensitive_data(result)
    assert redacted["intent_hash"] == result["intent_hash"]
    assert redacted["unsigned_tx"]["data"] == result["unsigned_tx"]["data"]


# ===========================================================================
# E. MCP INTEGRATION TESTS
# ===========================================================================


def test_fastmcp_registers_prepare_transaction_once_with_unsigned_description_and_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tools = _run_sync_coroutine(server.mcp.list_tools())
    matching = [t for t in tools if t.name == "prepare_transaction"]
    assert len(matching) == 1, "prepare_transaction must be registered exactly once"

    tx_tool = matching[0]
    assert tx_tool.description is not None
    desc_upper = tx_tool.description.upper()
    assert "UNSIGNED" in desc_upper
    assert "NO SIGNING" in desc_upper

    input_schema = tx_tool.inputSchema
    assert input_schema.get("required") == ["from_wallet", "ticker", "to", "amount"]
    props = input_schema.get("properties", {})
    assert set(props.keys()) == {"from_wallet", "ticker", "to", "amount"}
    assert props["from_wallet"].get("type") == "string"
    assert props["ticker"].get("type") == "string"
    assert props["to"].get("type") == "string"

    assert tx_tool.annotations is not None
    assert tx_tool.annotations.readOnlyHint is True
    assert tx_tool.annotations.destructiveHint is False
    assert tx_tool.annotations.idempotentHint is True

    # Invoke via FastMCP call_tool with mock provider
    mock_w3 = _make_mock_web3(pending_nonce=3)
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    content_blocks, structured_output = _run_sync_coroutine(
        server.mcp.call_tool(
            "prepare_transaction",
            {
                "from_wallet": SAMPLE_SENDER_LOWER,
                "ticker": "tTSLA",
                "to": SAMPLE_RECIPIENT_LOWER,
                "amount": "15.25",
            },
        )
    )
    assert structured_output["status"] == "prepared"
    assert structured_output["signed"] is False
    assert structured_output["ticker"] == "tTSLA"
    assert structured_output["unsigned_tx"]["to"] == MOCK_TSLA_ADDRESS
    assert structured_output["to"] == SAMPLE_RECIPIENT_CHECKSUM
    assert structured_output["amount_base_units"] == 1525 * 10**16
    assert json.loads(content_blocks[0].text) == structured_output

    # Verify FastMCP rejects boolean amount at tool boundary
    with pytest.raises(Exception):
        _run_sync_coroutine(
            server.mcp.call_tool(
                "prepare_transaction",
                {
                    "from_wallet": SAMPLE_SENDER_CHECKSUM,
                    "ticker": "tAAPL",
                    "to": SAMPLE_RECIPIENT_CHECKSUM,
                    "amount": True,
                },
            )
        )


def test_prepare_transaction_additional_edge_cases_and_config_validation(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 1. Duplicate contract addresses across tickers rejected
    dup_stocks = [
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
    ]
    monkeypatch.setattr(tx_module, "load_stocks", lambda: dup_stocks)
    res_dup = server.prepare_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in res_dup
    assert "Duplicate token contract address" in res_dup["error"]

    # 2. Invalid policy/TTL environment variables rejected cleanly
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)
    for env_key, bad_val in (
        ("KYROX_MAX_TX_AMOUNT", "-5"),
        ("KYROX_MAX_TX_AMOUNT", "not_a_decimal"),
        ("KYROX_ALLOWED_RECIPIENTS", "0xINVALID"),
        ("KYROX_INTENT_TTL_SECONDS", "0"),
        ("KYROX_INTENT_TTL_SECONDS", "not_an_int"),
    ):
        monkeypatch.setenv(env_key, bad_val)
        res_cfg = server.prepare_transaction(
            SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
        )
        assert "error" in res_cfg
        assert env_key in res_cfg["error"]
        monkeypatch.delenv(env_key, raising=False)

    # 3. Missing stocks.json file propagates FileNotFoundError
    missing_file = tmp_path / "missing_stocks.json"
    monkeypatch.undo()
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", missing_file)
    with pytest.raises(FileNotFoundError, match="Stock data file not found"):
        server.prepare_transaction(
            SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
        )


# ===========================================================================
# F. DAY 10: SUCCESSFUL TRANSACTION SIMULATION & 10 tAAPL PUBLIC DEMO
# ===========================================================================


def test_simulate_transaction_success_10_taapl_public_demo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Day 10 Requirement 1 & 4: 10 tAAPL simulation with 1,000 tAAPL balance."""
    logger = get_audit_logger()
    monkeypatch.setenv("KYROX_MAX_TX_AMOUNT", "50")
    mock_w3 = _make_mock_web3(
        decimals_by_token={MOCK_AAPL_ADDRESS: 18},
        sender_balances_by_token={MOCK_AAPL_ADDRESS: 1000 * 10**18},
        pending_nonce=9,
        estimated_gas=51842,
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.simulate_transaction(
        from_wallet=SAMPLE_SENDER_LOWER,
        ticker="taapl",
        to=SAMPLE_RECIPIENT_LOWER,
        amount=10,
    )

    assert "error" not in result
    assert result["status"] == "simulated"
    assert result["would_succeed"] is True
    assert result["simulation_status"] == "success"
    assert result["signed"] is False
    assert result["broadcast"] is False
    assert result["requires_human_approval"] is True
    assert result["requires_external_signature"] is True

    # Gas estimate & pinned block snapshot context
    assert result["estimated_gas"] == 51842
    assert result["gas_estimate"] == 51842
    assert result["gas_units"] == "gas"
    assert result["block_number"] == 19_500_000
    assert result["block_number_hex"] == "0x1298be0"
    assert result["block_identifier"] == 19_500_000
    assert result["eth_call_succeeded"] is True
    assert result["erc20_transfer_returned"] is True
    assert result["return_data"] == "0x" + ("00" * 31) + "01"
    assert result["failure_reason"] is None
    assert result["revert_reason"] is None
    assert result["error_code"] is None

    # Sender, recipient, contract, and calldata verification
    expected_base_units = 10 * 10**18
    expected_calldata = encode_erc20_transfer_calldata(
        MOCK_AAPL_ADDRESS,
        SAMPLE_RECIPIENT_CHECKSUM,
        expected_base_units,
    )
    assert result["from_wallet"] == SAMPLE_SENDER_CHECKSUM
    assert result["to"] == SAMPLE_RECIPIENT_CHECKSUM
    assert result["token_address"] == MOCK_AAPL_ADDRESS
    assert result["unsigned_tx"]["from"] == SAMPLE_SENDER_CHECKSUM
    assert result["unsigned_tx"]["to"] == MOCK_AAPL_ADDRESS
    assert result["unsigned_tx"]["data"] == expected_calldata
    assert result["amount"] == 10
    assert result["amount_decimal"] == "10"
    assert result["amount_base_units"] == expected_base_units

    expected_sim_tx = {
        "from": SAMPLE_SENDER_CHECKSUM,
        "to": MOCK_AAPL_ADDRESS,
        "data": expected_calldata,
        "value": 0,
    }
    assert mock_w3._block_number_property_mock.call_count == 1
    mock_w3.eth.call.assert_called_once_with(expected_sim_tx, 19_500_000)
    mock_w3.eth.estimate_gas.assert_called_once_with(expected_sim_tx, 19_500_000)

    # Zero signing or broadcasting
    mock_w3.eth.send_transaction.assert_not_called()
    mock_w3.eth.send_raw_transaction.assert_not_called()
    mock_w3.eth.account.sign_transaction.assert_not_called()
    mock_w3.eth.sign_transaction.assert_not_called()

    # JSON serializable & audit log verified
    assert json.loads(json.dumps(result)) == result
    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["tool"] == "simulate_transaction"
    assert entries[-1]["status"] == "ok"
    assert entries[-1]["context"]["would_succeed"] is True
    assert entries[-1]["context"]["estimated_gas"] == 51842
    assert entries[-1]["context"]["signed"] is False


# ===========================================================================
# G. DAY 10: INSUFFICIENT-BALANCE SIMULATION (1,000 tAAPL vs 5,000 tAAPL)
# ===========================================================================


@pytest.mark.parametrize("revert_style", ["oz_v5", "oz_v4"])
def test_simulate_insufficient_balance_1000_vs_5000_taapl_via_underlying_simulator(
    revert_style: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Day 10 Requirement 2 & Part 5:
    Sender balance = 1,000 tAAPL, Proposed transfer = 5,000 tAAPL.
    Runs through the underlying simulator without bypassing or changing the public
    50-token policy limit, identifying the EVM insufficient-balance revert.
    """
    # Keep public policy limit at 50 tokens to prove we do NOT weaken production policy
    monkeypatch.setenv("KYROX_MAX_TX_AMOUNT", "50")

    mock_w3 = _make_mock_web3(
        decimals_by_token={MOCK_AAPL_ADDRESS: 18},
        sender_balances_by_token={MOCK_AAPL_ADDRESS: 1000 * 10**18},
        insufficient_balance_revert_style=revert_style,
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)

    # Construct the verified unsigned 5,000 tAAPL intent fixture
    amount_5000_base = 5000 * 10**18
    calldata_5000 = encode_erc20_transfer_calldata(
        MOCK_AAPL_ADDRESS,
        SAMPLE_RECIPIENT_CHECKSUM,
        amount_5000_base,
    )
    now_utc = datetime.now(timezone.utc)
    expires_iso = (now_utc + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    intent_hash = compute_intent_hash(
        chain="base-sepolia",
        chain_id=BASE_SEPOLIA_CHAIN_ID,
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        to=SAMPLE_RECIPIENT_CHECKSUM,
        token_address=MOCK_AAPL_ADDRESS,
        ticker="tAAPL",
        decimals=18,
        amount_decimal="5000",
        amount_base_units=amount_5000_base,
        nonce=7,
        data=calldata_5000,
        value=0,
    )
    controlled_5000_intent: dict[str, Any] = {
        "status": "prepared",
        "signed": False,
        "broadcast": False,
        "intent_id": f"kyrox-intent-{intent_hash[2:18]}",
        "intent_hash": intent_hash,
        "prepared_at": now_utc.isoformat().replace("+00:00", "Z"),
        "expires_at": expires_iso,
        "ttl_seconds": 300,
        "chain": "base-sepolia",
        "chain_id": BASE_SEPOLIA_CHAIN_ID,
        "chain_id_hex": BASE_SEPOLIA_CHAIN_ID_HEX,
        "environment": "mock",
        "ticker": "tAAPL",
        "stock": "Test Apple",
        "from_wallet": SAMPLE_SENDER_CHECKSUM,
        "sender": SAMPLE_SENDER_CHECKSUM,
        "to": SAMPLE_RECIPIENT_CHECKSUM,
        "recipient": SAMPLE_RECIPIENT_CHECKSUM,
        "token_address": MOCK_AAPL_ADDRESS,
        "contract_address": MOCK_AAPL_ADDRESS,
        "amount": 5000,
        "amount_decimal": "5000",
        "amount_base_units": amount_5000_base,
        "raw_amount": str(amount_5000_base),
        "decimals": 18,
        "decimals_source": "contract_and_dataset",
        "function": "transfer(address,uint256)",
        "data": calldata_5000,
        "calldata": calldata_5000,
        "nonce": 7,
        "nonce_strategy": "pending",
        "unsigned_tx": {
            "from": SAMPLE_SENDER_CHECKSUM,
            "to": MOCK_AAPL_ADDRESS,
            "data": calldata_5000,
            "value": 0,
            "nonce": 7,
            "chainId": BASE_SEPOLIA_CHAIN_ID,
        },
    }

    sim_result = simulate_prepared_transaction_intent(
        controlled_5000_intent,
        w3=mock_w3,
    )

    assert sim_result["status"] == "simulation_failed"
    assert sim_result["would_succeed"] is False
    assert sim_result["simulation_status"] == "reverted"
    assert sim_result["revert_type"] == "insufficient_balance"
    assert sim_result["error_code"] == ErrorCode.INSUFFICIENT_TOKEN_BALANCE.value
    assert sim_result["eth_call_succeeded"] is False
    assert sim_result["estimated_gas"] is None
    assert sim_result["signed"] is False
    assert sim_result["broadcast"] is False
    assert "insufficient" in sim_result["failure_reason"].lower()
    assert "taapl" in sim_result["failure_reason"].lower()
    assert sim_result["error"] == sim_result["failure_reason"]
    if revert_style == "oz_v5":
        assert "1000 tAAPL" in sim_result["failure_reason"]
        assert "5000 tAAPL" in sim_result["failure_reason"]

    # eth_estimateGas must not be called when eth_call reverts
    mock_w3.eth.call.assert_called_once()
    mock_w3.eth.estimate_gas.assert_not_called()
    mock_w3.eth.send_transaction.assert_not_called()
    mock_w3.eth.send_raw_transaction.assert_not_called()


def test_simulate_transaction_insufficient_balance_within_policy_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify public simulate_transaction also reports insufficient balance when amount <= policy limit."""
    logger = get_audit_logger()
    monkeypatch.setenv("KYROX_MAX_TX_AMOUNT", "50")
    # Wallet only holds 5 tAAPL, tries to transfer 25 tAAPL (passes 50-token policy, reverts on-chain)
    mock_w3 = _make_mock_web3(
        decimals_by_token={MOCK_AAPL_ADDRESS: 18},
        sender_balances_by_token={MOCK_AAPL_ADDRESS: 5 * 10**18},
        insufficient_balance_revert_style="oz_v5",
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.simulate_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount="25",
    )

    assert result["would_succeed"] is False
    assert result["status"] == "simulation_failed"
    assert result["error_code"] == ErrorCode.INSUFFICIENT_TOKEN_BALANCE.value
    assert result["estimated_gas"] is None
    assert result["signed"] is False
    assert "5 tAAPL" in result["failure_reason"]
    assert "25 tAAPL" in result["failure_reason"]

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["tool"] == "simulate_transaction"
    assert entries[-1]["status"] == "error"
    assert entries[-1]["error_code"] == ErrorCode.INSUFFICIENT_TOKEN_BALANCE.value
    assert entries[-1]["context"]["would_succeed"] is False


# ===========================================================================
# H. DAY 10 & DAY 11: PUBLIC POLICY REJECTION BEFORE RPC
# ===========================================================================


def test_simulate_transaction_public_policy_rejects_over_limit_before_rpc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Day 10 Requirement 3 & Part 5:
    Calling the public simulate_transaction tool with an amount exceeding the configured
    policy maximum blocks the request BEFORE any RPC connection or simulation takes place.
    """
    logger = get_audit_logger()
    monkeypatch.setenv("KYROX_MAX_TX_AMOUNT", "50")
    get_web3_blocked = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_blocked)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # 1. 5,000 tAAPL blocked by 50-token policy limit before RPC
    res_5000 = server.simulate_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=5000,
    )
    assert "error" in res_5000
    assert "exceeds maximum allowed limit (50)" in res_5000["error"]
    assert "would_succeed" not in res_5000
    get_web3_blocked.assert_not_called()

    # 2. 50.0001 tAAPL blocked by 50-token policy limit before RPC
    res_boundary = server.simulate_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount="50.0001",
    )
    assert "error" in res_boundary
    assert "exceeds maximum allowed limit (50)" in res_boundary["error"]
    get_web3_blocked.assert_not_called()

    # 3. Exceeding DEFAULT_MAX_TOKEN_AMOUNT (1,000,000,000) when env var is unset
    monkeypatch.delenv("KYROX_MAX_TX_AMOUNT", raising=False)
    res_default_over = server.simulate_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount="1000000001",
    )
    assert "error" in res_default_over
    assert "exceeds maximum allowed limit" in res_default_over["error"]
    get_web3_blocked.assert_not_called()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(entries) == 3
    for entry in entries:
        assert entry["tool"] == "simulate_transaction"
        assert entry["status"] == "error"
        assert entry["error_code"] == ErrorCode.POLICY_REJECTED.value
        assert entry["error_category"] == "policy"


def test_simulate_transaction_enforces_ticker_and_recipient_policies_before_rpc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_web3_blocked = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_blocked)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)
    monkeypatch.setenv("KYROX_APPROVED_TICKERS", "tAAPL")
    monkeypatch.setenv("KYROX_ALLOWED_RECIPIENTS", SAMPLE_RECIPIENT_LOWER)

    # Disallowed ticker
    res_ticker = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tNVDA", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in res_ticker
    assert "approved ticker set" in res_ticker["error"]

    # Disallowed recipient
    res_recipient = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM,
        "tAAPL",
        "0x4444444444444444444444444444444444444444",
        10,
    )
    assert "error" in res_recipient
    assert "recipient allowlist" in res_recipient["error"]

    # Token contract self-transfer
    monkeypatch.delenv("KYROX_ALLOWED_RECIPIENTS", raising=False)
    res_self = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", MOCK_AAPL_ADDRESS, 10
    )
    assert "error" in res_self
    assert "cannot be the tAAPL token contract address" in res_self["error"]
    get_web3_blocked.assert_not_called()


# ===========================================================================
# I. DAY 10: MANDATORY REGRESSIONS (AMOUNTS, ADDRESSES, CHAIN, REVERTS, FALSE,
#    RPC TIMEOUT/ERROR, MALFORMED PROVIDER, EXPIRED/TAMPERED INTENT)
# ===========================================================================


@pytest.mark.parametrize(
    "bad_amount",
    [
        0,
        0.0,
        "0",
        Decimal("0"),
        -1,
        -0.5,
        "-10",
        Decimal("-1"),
        float("nan"),
        float("inf"),
        float("-inf"),
        "NaN",
        "Infinity",
        "-Infinity",
        Decimal("NaN"),
        Decimal("Infinity"),
        Decimal("-Infinity"),
        True,
        False,
        None,
        "",
        "   ",
        "invalid_number",
    ],
)
def test_simulate_transaction_rejects_invalid_amounts_before_rpc(
    bad_amount: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_web3_blocked = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_blocked)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = simulate_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount=bad_amount,
    )
    assert "error" in result
    assert "would_succeed" not in result
    get_web3_blocked.assert_not_called()


def test_simulate_transaction_rejects_excessive_precision_addresses_unknown_ticker_and_null_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_web3_blocked = MagicMock()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_blocked)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # 1. Excessive decimal precision (19 decimals on 18-decimal token)
    res_prec = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM,
        "tAAPL",
        SAMPLE_RECIPIENT_CHECKSUM,
        "1.0000000000000000001",
    )
    assert "error" in res_prec
    assert "excessive decimal precision" in res_prec["error"].lower()

    # 2. Invalid EIP-55 checksum on sender and recipient
    bad_checksum_sender = SAMPLE_SENDER_CHECKSUM[:-1] + (
        "f" if SAMPLE_SENDER_CHECKSUM[-1] == "F" else "F"
    )
    res_chk = server.simulate_transaction(
        bad_checksum_sender, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in res_chk
    assert "checksum" in res_chk["error"].lower()

    # 3. Zero addresses for sender and recipient
    res_zero_from = server.simulate_transaction(
        ZERO_ADDRESS, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "zero address" in res_zero_from["error"].lower()

    res_zero_to = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", ZERO_ADDRESS, 10
    )
    assert "zero address" in res_zero_to["error"].lower()

    # 4. Unknown ticker
    res_unknown = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tUNKNOWN", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "not found" in res_unknown["error"].lower()
    get_web3_blocked.assert_not_called()

    # 5. Packaged dataset with blank/null token_address
    monkeypatch.undo()
    monkeypatch.setattr(tx_module, "get_web3", get_web3_blocked)
    res_blank = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "not configured in the stock dataset" in res_blank["error"]
    get_web3_blocked.assert_not_called()


@pytest.mark.parametrize("wrong_chain_id", [8453, 1, 11155111, 10])
def test_simulate_transaction_rejects_chain_mismatch(
    wrong_chain_id: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3(chain_id=wrong_chain_id)
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in result
    assert "84532" in result["error"]
    assert "would_succeed" not in result
    mock_w3.eth.call.assert_not_called()
    mock_w3.eth.estimate_gas.assert_not_called()


def test_simulate_transaction_handles_erc20_false_return_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Part 4.E & Part 6.5: ABI-decoded false return is NOT classified as success."""
    logger = get_audit_logger()
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    for false_payload in (
        HexBytes("0x" + ("00" * 32)),
        b"\x00" * 32,
        "0x" + ("00" * 32),
        False,
    ):
        mock_w3 = _make_mock_web3(eth_call_return=false_payload)
        monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)

        result = server.simulate_transaction(
            SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
        )
        assert result["would_succeed"] is False
        assert result["status"] == "simulation_failed"
        assert result["simulation_status"] == "erc20_false_return"
        assert result["eth_call_succeeded"] is True
        assert result["erc20_transfer_returned"] is False
        assert result["return_data"] == "0x" + ("00" * 32)
        assert result["estimated_gas"] is None
        assert result["error_code"] == ErrorCode.ERC20_TRANSFER_FALSE.value
        assert "returned false" in result["failure_reason"].lower()
        assert result["signed"] is False
        mock_w3.eth.estimate_gas.assert_not_called()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.ERC20_TRANSFER_FALSE.value


def test_simulate_transaction_handles_other_contract_reverts_and_estimate_gas_reverts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Part 4.F Case 3: Contract-level reverts distinct from insufficient balance."""
    logger = get_audit_logger()
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # 1. Pausable contract revert via ContractLogicError
    mock_w3_paused = _make_mock_web3(
        eth_call_side_effect=ContractLogicError("execution reverted: Pausable: paused")
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3_paused)
    res_paused = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert res_paused["would_succeed"] is False
    assert res_paused["simulation_status"] == "reverted"
    assert res_paused["revert_type"] == "contract_revert"
    assert res_paused["error_code"] == ErrorCode.SIMULATION_REVERTED.value
    assert res_paused["estimated_gas"] is None
    assert "Pausable: paused" in res_paused["failure_reason"]
    mock_w3_paused.eth.estimate_gas.assert_not_called()

    # 2. ABI-encoded Solidity Error(string) selector 0x08c379a0
    encoded_err_str = Web3().codec.encode(["string"], ["Transfer restricted: compliance lock"])
    error_hex = SOLIDITY_ERROR_STRING_SELECTOR + encoded_err_str.hex()
    mock_w3_abi_err = _make_mock_web3(
        eth_call_side_effect=ContractCustomError(
            f"execution reverted: {error_hex}", data=error_hex
        )
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3_abi_err)
    res_abi_err = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert res_abi_err["would_succeed"] is False
    assert res_abi_err["error_code"] == ErrorCode.SIMULATION_REVERTED.value
    assert "Transfer restricted: compliance lock" in res_abi_err["failure_reason"]

    # 3. ContractPanicError during eth_call
    mock_w3_panic = _make_mock_web3(
        eth_call_side_effect=ContractPanicError("execution reverted: Panic(0x11)")
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3_panic)
    res_panic = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert res_panic["would_succeed"] is False
    assert res_panic["error_code"] == ErrorCode.SIMULATION_REVERTED.value

    # 4. eth_call succeeds, but eth_estimateGas reverts
    mock_w3_gas_rev = _make_mock_web3(
        estimate_gas_side_effect=ContractLogicError(
            "execution reverted: gas estimation blocked by hook"
        )
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3_gas_rev)
    res_gas_rev = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert res_gas_rev["would_succeed"] is False
    assert res_gas_rev["eth_call_succeeded"] is True
    assert res_gas_rev["estimated_gas"] is None
    assert res_gas_rev["error_code"] == ErrorCode.SIMULATION_REVERTED.value
    assert "Gas estimation reverted" in res_gas_rev["failure_reason"]

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.SIMULATION_REVERTED.value


def test_simulate_transaction_distinguishes_rpc_timeouts_and_outages_from_reverts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Part 4.F Cases 9 & 10:
    A provider outage or timeout must NEVER be represented as an insufficient-balance
    failure or normal EVM revert.
    """
    logger = get_audit_logger()
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # 1. Timeout during eth_call -> RPC_TIMEOUT (retryable=True)
    w3_call_timeout = _make_mock_web3(
        eth_call_side_effect=TimeoutError("eth_call RPC request timed out after 10s")
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: w3_call_timeout)
    res_call_timeout = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in res_call_timeout
    assert "would_succeed" not in res_call_timeout
    assert "timed out" in res_call_timeout["error"].lower()
    assert "insufficient" not in res_call_timeout["error"].lower()

    # 2. Timeout during eth_estimateGas -> RPC_TIMEOUT (retryable=True)
    w3_gas_timeout = _make_mock_web3(
        estimate_gas_side_effect=TimeoutError("eth_estimateGas timed out")
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: w3_gas_timeout)
    res_gas_timeout = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in res_gas_timeout
    assert "would_succeed" not in res_gas_timeout
    assert "timed out" in res_gas_timeout["error"].lower()

    # 3. ConnectionError / ProviderConnectionError during eth_call -> RPC_CONNECTION_FAILED
    w3_conn_err = _make_mock_web3(
        eth_call_side_effect=ProviderConnectionError(
            "503 Service Unavailable from https://user:secretpass@sepolia.base.org/v2/alcht_1234567890123456"
        )
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: w3_conn_err)
    res_conn_err = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in res_conn_err
    assert "would_succeed" not in res_conn_err
    assert "insufficient" not in res_conn_err["error"].lower()
    assert "secretpass" not in res_conn_err["error"]
    assert "alcht_1234567890123456" not in res_conn_err["error"]

    # 4. Non-revert Web3RPCError (-32603 internal upstream error) -> RPC_CONNECTION_FAILED
    w3_rpc_err = _make_mock_web3(
         estimate_gas_side_effect=Web3RPCError("Upstream RPC internal failure -32603")
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: w3_rpc_err)
    res_rpc_err = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in res_rpc_err
    assert "would_succeed" not in res_rpc_err

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-4]["error_code"] == ErrorCode.RPC_TIMEOUT.value
    assert entries[-4]["retryable"] is True
    assert entries[-3]["error_code"] == ErrorCode.RPC_TIMEOUT.value
    assert entries[-3]["retryable"] is True
    assert entries[-2]["error_code"] == ErrorCode.RPC_CONNECTION_FAILED.value
    assert entries[-2]["retryable"] is True
    assert entries[-1]["error_code"] == ErrorCode.RPC_CONNECTION_FAILED.value
    assert entries[-1]["retryable"] is True


@pytest.mark.parametrize(
    "bad_call_return",
    [
        b"",
        "0x",
        b"\x01\x02\x03\x04",
        b"\x00" * 31 + b"\x02",
        "0xnot_hex_data",
        None,
        12345,
        ["0x01"],
        MagicMock(),
    ],
)
def test_simulate_transaction_rejects_malformed_eth_call_provider_responses(
    bad_call_return: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Part 4.F Case 11: Malformed eth_call responses are caught and classified."""
    logger = get_audit_logger()
    mock_w3 = _make_mock_web3(eth_call_return=bad_call_return)
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in result
    assert "would_succeed" not in result
    assert "malformed rpc provider response" in result["error"].lower()
    mock_w3.eth.estimate_gas.assert_not_called()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.MALFORMED_PROVIDER_RESPONSE.value
    assert entries[-1]["retryable"] is False


@pytest.mark.parametrize(
    "bad_gas_return",
    [
        0,
        -1,
        -50000,
        True,
        False,
        None,
        "52000",
        MAX_GAS_ESTIMATE_UNITS + 1,
        MagicMock(),
    ],
)
def test_simulate_transaction_rejects_malformed_estimate_gas_responses_without_inventing_gas(
    bad_gas_return: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Part 4.C & 4.F Case 11: Never invent a gas estimate on invalid provider output."""
    logger = get_audit_logger()
    mock_w3 = _make_mock_web3(estimated_gas=bad_gas_return)
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in result
    assert "would_succeed" not in result
    assert "malformed rpc provider response" in result["error"].lower()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-1]["error_code"] == ErrorCode.MALFORMED_PROVIDER_RESPONSE.value


def test_simulate_prepared_transaction_intent_rejects_expired_tampered_and_incomplete_intents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Part 4.F Case 12 & Part 6.5: Expired, tampered, and missing-field intents fail before RPC."""
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    valid_intent = prepare_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, "10"
    )
    mock_w3.eth.call.reset_mock()
    mock_w3.eth.estimate_gas.reset_mock()

    # 1. Expired intent -> INTENT_EXPIRED
    future_now = datetime.now(timezone.utc) + timedelta(hours=1)
    res_expired = simulate_prepared_transaction_intent(
        valid_intent, w3=mock_w3, now=future_now
    )
    assert "error" in res_expired
    assert "expired" in res_expired["error"].lower()

    # 2. Modified intent_hash -> INTENT_TAMPERED
    tampered_hash = json.loads(json.dumps(valid_intent))
    tampered_hash["intent_hash"] = "0x" + ("b" * 64)
    res_hash = simulate_prepared_transaction_intent(tampered_hash, w3=mock_w3)
    assert "error" in res_hash
    assert "intent_hash mismatch" in res_hash["error"]

    # 3. Modified calldata -> INTENT_TAMPERED
    tampered_data = json.loads(json.dumps(valid_intent))
    tampered_data["unsigned_tx"]["data"] = ERC20_TRANSFER_SELECTOR + ("0" * 128)
    res_data = simulate_prepared_transaction_intent(tampered_data, w3=mock_w3)
    assert "error" in res_data
    assert "tampered" in res_data["error"].lower()

    # 4. Missing required transaction fields -> rejected before eth_call
    for missing_key in (
        "unsigned_tx",
        "expires_at",
        "from_wallet",
        "to",
        "token_address",
        "data",
        "nonce",
        "amount_base_units",
    ):
        incomplete = json.loads(json.dumps(valid_intent))
        incomplete.pop(missing_key, None)
        res_inc = simulate_prepared_transaction_intent(incomplete, w3=mock_w3)
        assert "error" in res_inc, f"Expected error when missing {missing_key}"

    for missing_tx_key in ("from", "to", "data", "nonce", "chainId"):
        incomplete_tx = json.loads(json.dumps(valid_intent))
        incomplete_tx["unsigned_tx"].pop(missing_tx_key, None)
        res_inc_tx = simulate_prepared_transaction_intent(incomplete_tx, w3=mock_w3)
        assert "error" in res_inc_tx, f"Expected error when unsigned_tx missing {missing_tx_key}"

    mock_w3.eth.call.assert_not_called()
    mock_w3.eth.estimate_gas.assert_not_called()


# ===========================================================================
# J. DAY 10: STRICT NO-BROADCAST & READ-ONLY PROVIDER VERIFICATION
# ===========================================================================


def test_simulate_transaction_works_with_strict_read_only_provider_without_signing_or_send_attributes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Part 6.6:
    Use a restricted read-only provider exposing ONLY read/simulation methods
    (no send_transaction, send_raw_transaction, sign_transaction, or account attributes).
    """

    class _ReadOnlyTransferFn:
        def __init__(self, contract_address: str, recipient: str, base_units: int) -> None:
            self._contract_address = contract_address
            self._recipient = recipient
            self._base_units = base_units

        def build_transaction(self, tx_params: dict[str, Any]) -> dict[str, Any]:
            return {
                "from": tx_params["from"],
                "to": self._contract_address,
                "data": encode_erc20_transfer_calldata(
                    self._contract_address, self._recipient, self._base_units
                ),
                "value": tx_params.get("value", 0),
                "nonce": tx_params["nonce"],
                "chainId": tx_params["chainId"],
            }

    class _ReadOnlyDecimalsFn:
        @staticmethod
        def call() -> int:
            return 18

    class _ReadOnlyContractFunctions:
        def __init__(self, contract_address: str) -> None:
            self._contract_address = contract_address

        @staticmethod
        def decimals() -> _ReadOnlyDecimalsFn:
            return _ReadOnlyDecimalsFn()

        def transfer(self, recipient: str, base_units: int) -> _ReadOnlyTransferFn:
            return _ReadOnlyTransferFn(self._contract_address, recipient, base_units)

    class _ReadOnlyContract:
        def __init__(self, contract_address: str) -> None:
            self.functions = _ReadOnlyContractFunctions(contract_address)

    class _StrictReadOnlyEth:
        """Exposes ONLY chain_id, block_number, get_code, get_transaction_count, contract, call, estimate_gas."""

        chain_id = BASE_SEPOLIA_CHAIN_ID
        block_number = 19_500_000

        @staticmethod
        def get_code(address: str) -> bytes:
            return b"\x60\x80\x60\x40"

        @staticmethod
        def get_transaction_count(address: str, block_identifier: str = "pending") -> int:
            return 4

        @staticmethod
        def contract(address: str, abi: list[dict[str, Any]]) -> _ReadOnlyContract:
            return _ReadOnlyContract(Web3.to_checksum_address(address))

        @staticmethod
        def call(tx: dict[str, Any], block_identifier: int = 19_500_000) -> HexBytes:
            assert block_identifier == 19_500_000
            assert set(tx.keys()) == {"from", "to", "data", "value"}
            assert "chainId" not in tx
            assert "nonce" not in tx
            assert tx["from"] == SAMPLE_SENDER_CHECKSUM
            assert tx["to"] == MOCK_AAPL_ADDRESS
            return HexBytes("0x" + ("00" * 31) + "01")

        @staticmethod
        def estimate_gas(tx: dict[str, Any], block_identifier: int = 19_500_000) -> int:
            assert block_identifier == 19_500_000
            assert set(tx.keys()) == {"from", "to", "data", "value"}
            assert "chainId" not in tx
            assert "nonce" not in tx
            assert tx["from"] == SAMPLE_SENDER_CHECKSUM
            assert tx["to"] == MOCK_AAPL_ADDRESS
            return 51200

    class _StrictReadOnlyWeb3:
        def __init__(self) -> None:
            self.eth = _StrictReadOnlyEth()

        @staticmethod
        def is_connected() -> bool:
            return True

    strict_w3 = _StrictReadOnlyWeb3()
    assert not hasattr(strict_w3.eth, "send_transaction")
    assert not hasattr(strict_w3.eth, "send_raw_transaction")
    assert not hasattr(strict_w3.eth, "sign_transaction")
    assert not hasattr(strict_w3.eth, "account")

    monkeypatch.setattr(tx_module, "get_web3", lambda: strict_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.simulate_transaction(
        from_wallet=SAMPLE_SENDER_CHECKSUM,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_CHECKSUM,
        amount="10",
    )
    assert result["would_succeed"] is True
    assert result["estimated_gas"] == 51200
    assert result["signed"] is False
    assert result["broadcast"] is False


# ===========================================================================
# K. DAY 10: FASTMCP INTEGRATION TESTS FOR SIMULATE_TRANSACTION
# ===========================================================================


def test_fastmcp_registers_simulate_transaction_and_executes_success_and_failure_flows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Part 6.7: MCP registration, schema, annotations, success, revert, and error envelope."""
    tools = _run_sync_coroutine(server.mcp.list_tools())
    matching = [t for t in tools if t.name == "simulate_transaction"]
    assert len(matching) == 1, "simulate_transaction must be registered exactly once"

    sim_tool = matching[0]
    assert sim_tool.description is not None
    desc_upper = sim_tool.description.upper()
    assert "UNSIGNED" in desc_upper
    assert "ETH_CALL" in desc_upper
    assert "ETH_ESTIMATEGAS" in desc_upper
    assert "NO SIGNING" in desc_upper
    assert "NO BROADCASTING" in desc_upper

    input_schema = sim_tool.inputSchema
    assert input_schema.get("required") == ["from_wallet", "ticker", "to", "amount"]
    props = input_schema.get("properties", {})
    assert set(props.keys()) == {"from_wallet", "ticker", "to", "amount"}
    assert props["from_wallet"].get("type") == "string"
    assert props["ticker"].get("type") == "string"
    assert props["to"].get("type") == "string"

    assert sim_tool.annotations is not None
    assert sim_tool.annotations.readOnlyHint is True
    assert sim_tool.annotations.destructiveHint is False
    assert sim_tool.annotations.idempotentHint is True
    assert sim_tool.annotations.openWorldHint is True

    # 1. Successful FastMCP call (10 tAAPL with 1,000 tAAPL balance)
    mock_w3 = _make_mock_web3(
        sender_balances_by_token={MOCK_AAPL_ADDRESS: 1000 * 10**18},
        estimated_gas=52100,
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    content_blocks, structured_ok = _run_sync_coroutine(
        server.mcp.call_tool(
            "simulate_transaction",
            {
                "from_wallet": SAMPLE_SENDER_LOWER,
                "ticker": "tAAPL",
                "to": SAMPLE_RECIPIENT_LOWER,
                "amount": 10,
            },
        )
    )
    assert structured_ok["status"] == "simulated"
    assert structured_ok["would_succeed"] is True
    assert structured_ok["estimated_gas"] == 52100
    assert structured_ok["signed"] is False
    assert structured_ok["broadcast"] is False
    assert json.loads(content_blocks[0].text) == structured_ok

    # 2. Failure FastMCP call: EVM insufficient balance revert
    monkeypatch.setenv("KYROX_MAX_TX_AMOUNT", "50")
    mock_w3_low = _make_mock_web3(
        sender_balances_by_token={MOCK_AAPL_ADDRESS: 5 * 10**18},
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3_low)
    fail_blocks, structured_fail = _run_sync_coroutine(
        server.mcp.call_tool(
            "simulate_transaction",
            {
                "from_wallet": SAMPLE_SENDER_CHECKSUM,
                "ticker": "tAAPL",
                "to": SAMPLE_RECIPIENT_CHECKSUM,
                "amount": "20",
            },
        )
    )
    assert structured_fail["would_succeed"] is False
    assert structured_fail["estimated_gas"] is None
    assert structured_fail["error_code"] == ErrorCode.INSUFFICIENT_TOKEN_BALANCE.value
    assert "error" in structured_fail
    assert json.loads(fail_blocks[0].text) == structured_fail

    # 3. Failure FastMCP call: Policy rejection (amount > 50)
    policy_blocks, structured_policy = _run_sync_coroutine(
        server.mcp.call_tool(
            "simulate_transaction",
            {
                "from_wallet": SAMPLE_SENDER_CHECKSUM,
                "ticker": "tAAPL",
                "to": SAMPLE_RECIPIENT_CHECKSUM,
                "amount": 5000,
            },
        )
    )
    assert "error" in structured_policy
    assert "exceeds maximum allowed limit (50)" in structured_policy["error"]
    assert "would_succeed" not in structured_policy
    assert json.loads(policy_blocks[0].text) == structured_policy

    # 4. FastMCP schema rejects boolean numeric amount
    with pytest.raises(Exception):
        _run_sync_coroutine(
            server.mcp.call_tool(
                "simulate_transaction",
                {
                    "from_wallet": SAMPLE_SENDER_CHECKSUM,
                    "ticker": "tAAPL",
                    "to": SAMPLE_RECIPIENT_CHECKSUM,
                    "amount": False,
                },
            )
        )


# ===========================================================================
# L. DAY 10 RPC CORRECTNESS PATCH: SINGLE BLOCK SNAPSHOT PINNING &
#    TRANSPORT-LEVEL EIP-1474 CALL OBJECT VERIFICATION
# ===========================================================================


def test_simulate_pins_both_eth_call_and_estimate_gas_to_single_block_snapshot_even_when_chain_advances(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Issue 1:
    - Block number is retrieved once per simulation.
    - Both eth_call and eth_estimateGas receive the exact same integer block number.
    - A changing latest block cannot cause the two operations to use different block identifiers.
    - Failed simulations also record the pinned block_number.
    """
    # Configure block_number to advance on every read (19_500_101 -> 19_500_102 -> 19_500_103)
    advancing_w3 = _make_mock_web3(
        sender_balances_by_token={MOCK_AAPL_ADDRESS: 1000 * 10**18},
        block_number_side_effect=[19_500_101, 19_500_102, 19_500_103],
        estimated_gas=51900,
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: advancing_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    res_ok = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert res_ok["would_succeed"] is True
    assert res_ok["block_number"] == 19_500_101
    assert res_ok["block_number_hex"] == hex(19_500_101)
    assert res_ok["block_identifier"] == 19_500_101

    # Prove block_number was accessed ONLY ONCE during the simulation
    assert advancing_w3._block_number_property_mock.call_count == 1
    call_args = advancing_w3.eth.call.call_args
    gas_args = advancing_w3.eth.estimate_gas.call_args
    assert call_args is not None and gas_args is not None
    assert call_args.args[1] == 19_500_101
    assert gas_args.args[1] == 19_500_101
    assert call_args.args[1] == gas_args.args[1]

    # Also verify that a failed simulation (revert) records the pinned block_number
    revert_w3 = _make_mock_web3(
        sender_balances_by_token={MOCK_AAPL_ADDRESS: 2 * 10**18},
        block_number_side_effect=[19_600_222, 19_600_223],
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: revert_w3)
    res_fail = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert res_fail["would_succeed"] is False
    assert res_fail["block_number"] == 19_600_222
    assert res_fail["block_number_hex"] == hex(19_600_222)
    assert res_fail["block_identifier"] == 19_600_222
    assert revert_w3._block_number_property_mock.call_count == 1


def test_simulate_block_number_lookup_failures_and_malformed_blocks_classified_as_rpc_errors_not_reverts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Issue 1:
    - Block lookup failure is classified as an RPC failure (RPC_TIMEOUT / RPC_CONNECTION_FAILED),
      never as an EVM revert, and never falls back to 'latest'.
    - Malformed block numbers (-1, bool, None, str, MagicMock) are rejected with MALFORMED_PROVIDER_RESPONSE.
    """
    logger = get_audit_logger()
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    # 1. Timeout during eth_blockNumber
    w3_bn_timeout = _make_mock_web3(
        block_number_side_effect=TimeoutError("eth_blockNumber timed out")
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: w3_bn_timeout)
    res_timeout = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in res_timeout
    assert "would_succeed" not in res_timeout
    assert "timed out" in res_timeout["error"].lower()
    w3_bn_timeout.eth.call.assert_not_called()
    w3_bn_timeout.eth.estimate_gas.assert_not_called()

    # 2. Connection error during eth_blockNumber
    w3_bn_conn = _make_mock_web3(
        block_number_side_effect=ProviderConnectionError("RPC upstream 503 on eth_blockNumber")
    )
    monkeypatch.setattr(tx_module, "get_web3", lambda: w3_bn_conn)
    res_conn = server.simulate_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    assert "error" in res_conn
    assert "would_succeed" not in res_conn
    assert "unable to read latest block number" in res_conn["error"].lower()
    w3_bn_conn.eth.call.assert_not_called()
    w3_bn_conn.eth.estimate_gas.assert_not_called()

    entries = [
        json.loads(line)
        for line in logger.log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert entries[-2]["error_code"] == ErrorCode.RPC_TIMEOUT.value
    assert entries[-2]["retryable"] is True
    assert entries[-1]["error_code"] == ErrorCode.RPC_CONNECTION_FAILED.value
    assert entries[-1]["retryable"] is True

    # 3. Malformed block numbers rejected without calling eth_call or falling back to 'latest'
    for bad_bn in (-1, True, False, None, "19500000", MagicMock()):
        w3_bad_bn = _make_mock_web3(block_number=bad_bn)
        monkeypatch.setattr(tx_module, "get_web3", lambda: w3_bad_bn)
        res_bad = server.simulate_transaction(
            SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
        )
        assert "error" in res_bad
        assert "would_succeed" not in result if "result" in locals() else "would_succeed" not in res_bad
        assert "malformed rpc provider response" in res_bad["error"].lower()
        w3_bad_bn.eth.call.assert_not_called()
        w3_bad_bn.eth.estimate_gas.assert_not_called()


def test_build_simulation_call_object_enforces_strict_eip1474_allowlist_and_excludes_chain_id_and_nonce(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Issue 2:
    build_simulation_call_object constructs an allowlisted EIP-1474 execution object
    and never includes chainId, nonce, intent_hash, expires_at, or KYROX metadata.
    """
    mock_w3 = _make_mock_web3(include_fee_fields=True)
    monkeypatch.setattr(tx_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    intent = prepare_transaction(
        SAMPLE_SENDER_CHECKSUM, "tAAPL", SAMPLE_RECIPIENT_CHECKSUM, 10
    )
    verified = verify_prepared_transaction_intent(intent)

    # Default execution call object: strictly from, to, data, value
    call_obj = build_simulation_call_object(verified)
    assert set(call_obj.keys()) == {"from", "to", "data", "value"}
    assert set(call_obj.keys()).issubset(SIMULATION_CALL_ALLOWED_KEYS)
    assert set(call_obj.keys()).isdisjoint(FORBIDDEN_SIMULATION_CALL_KEYS)
    for forbidden_key in (
        "chainId",
        "nonce",
        "intent_hash",
        "expires_at",
        "intent_id",
        "ticker",
        "amount_decimal",
        "signed",
        "broadcast",
    ):
        assert forbidden_key not in call_obj

    # Optional fee fields mode still strictly excludes chainId, nonce, and metadata
    call_obj_with_fees = build_simulation_call_object(verified, include_fee_fields=True)
    assert set(call_obj_with_fees.keys()).issubset(SIMULATION_CALL_ALLOWED_KEYS)
    assert "chainId" not in call_obj_with_fees
    assert "nonce" not in call_obj_with_fees
    assert call_obj_with_fees["gas"] == 65000
    assert call_obj_with_fees["maxFeePerGas"] == 1_500_000_000
    assert call_obj_with_fees["maxPriorityFeePerGas"] == 100_000_000


def test_simulate_transaction_transport_level_json_rpc_payload_inspection_via_recording_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Issue 1 & Issue 2 at the actual Web3.py 8 JSON-RPC transport boundary:
    Uses a real Web3(RecordingJsonRpcProvider()) instance so Web3.py 8's middleware
    and formatting pipeline formats every outgoing request.
    Proves:
    1. Correct sender ('from') is transmitted.
    2. Correct token contract ('to') is transmitted.
    3. Exact prepared calldata ('data') is transmitted.
    4. Value ('0x0') is transmitted.
    5. The exact same hex block number is transmitted to both eth_call and eth_estimateGas.
    6. chainId, nonce, and KYROX metadata are absent from the execution-call object.
    7. Base Sepolia chainId 84532 is verified and no signing/broadcasting method is called.
    """

    class _RecordingJsonRpcProvider(JSONBaseProvider):
        def __init__(self) -> None:
            super().__init__()
            self.requests: list[tuple[str, Any]] = []
            self._next_block = 0x1298BE0  # 19,500,000

        def is_connected(self, show_traceback: bool = False) -> bool:
            return True

        def make_request(self, method: RPCEndpoint, params: Any) -> RPCResponse:
            method_str = str(method)
            if method_str in (
                "eth_sendTransaction",
                "eth_sendRawTransaction",
                "eth_sign",
                "eth_signTransaction",
                "personal_sign",
            ):
                raise AssertionError(f"FORBIDDEN RPC method invoked: {method_str}")

            self.requests.append((method_str, params))
            if method_str == "eth_chainId":
                return {"jsonrpc": "2.0", "id": 1, "result": BASE_SEPOLIA_CHAIN_ID_HEX}
            if method_str == "eth_getCode":
                return {"jsonrpc": "2.0", "id": 1, "result": "0x60806040"}
            if method_str == "eth_getTransactionCount":
                return {"jsonrpc": "2.0", "id": 1, "result": "0x9"}
            if method_str == "eth_blockNumber":
                # Increment on every call to prove eth_blockNumber is only called once
                current_hex = hex(self._next_block)
                self._next_block += 1
                return {"jsonrpc": "2.0", "id": 1, "result": current_hex}
            if method_str == "eth_call":
                call_tx = params[0]
                call_data = str(call_tx.get("data") or call_tx.get("input") or "")
                # decimals() selector 0x313ce567 -> return 18 (0x12)
                if call_data.startswith("0x313ce567"):
                    return {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "result": "0x" + ("00" * 31) + "12",
                    }
                # transfer(address,uint256) selector 0xa9059cbb -> return True (0x01)
                return {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": "0x" + ("00" * 31) + "01",
                }
            if method_str == "eth_estimateGas":
                return {"jsonrpc": "2.0", "id": 1, "result": hex(51842)}
            if method_str == "eth_gasPrice":
                return {"jsonrpc": "2.0", "id": 1, "result": hex(1_000_000_000)}
            if method_str == "eth_maxPriorityFeePerGas":
                return {"jsonrpc": "2.0", "id": 1, "result": hex(100_000_000)}
            if method_str == "eth_getBlockByNumber":
                return {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "number": hex(19_500_000),
                        "baseFeePerGas": hex(500_000_000),
                        "gasLimit": hex(30_000_000),
                    },
                }
            return {"jsonrpc": "2.0", "id": 1, "result": "0x1"}

    recording_provider = _RecordingJsonRpcProvider()
    real_w3 = Web3(recording_provider)
    monkeypatch.setattr(tx_module, "get_web3", lambda: real_w3)
    monkeypatch.setattr(tx_module, "load_stocks", lambda: MOCK_CONFIGURED_STOCKS)

    result = server.simulate_transaction(
        from_wallet=SAMPLE_SENDER_LOWER,
        ticker="tAAPL",
        to=SAMPLE_RECIPIENT_LOWER,
        amount="10",
    )

    assert result["would_succeed"] is True
    assert result["estimated_gas"] == 51842
    assert result["block_number"] == 19_500_000
    assert result["block_number_hex"] == "0x1298be0"
    assert result["block_identifier"] == 19_500_000
    assert result["signed"] is False
    assert result["broadcast"] is False

    expected_calldata = encode_erc20_transfer_calldata(
        MOCK_AAPL_ADDRESS,
        SAMPLE_RECIPIENT_CHECKSUM,
        10 * 10**18,
    )

    # Filter recorded requests for simulation transfer eth_call and eth_estimateGas
    block_number_calls = [
        (m, p) for m, p in recording_provider.requests if m == "eth_blockNumber"
    ]
    assert len(block_number_calls) == 1

    transfer_eth_calls = [
        (m, p)
        for m, p in recording_provider.requests
        if m == "eth_call"
        and str(p[0].get("data", "")).startswith(ERC20_TRANSFER_SELECTOR)
    ]
    estimate_gas_calls = [
        (m, p) for m, p in recording_provider.requests if m == "eth_estimateGas"
    ]
    assert len(transfer_eth_calls) == 1
    assert len(estimate_gas_calls) == 1

    _, eth_call_params = transfer_eth_calls[0]
    _, estimate_gas_params = estimate_gas_calls[0]

    call_tx_obj, call_block_hex = eth_call_params[0], eth_call_params[1]
    gas_tx_obj, gas_block_hex = estimate_gas_params[0], estimate_gas_params[1]

    # 1. Correct sender transmitted
    assert call_tx_obj["from"] == SAMPLE_SENDER_CHECKSUM
    assert gas_tx_obj["from"] == SAMPLE_SENDER_CHECKSUM

    # 2. Correct token contract address transmitted
    assert call_tx_obj["to"] == MOCK_AAPL_ADDRESS
    assert gas_tx_obj["to"] == MOCK_AAPL_ADDRESS

    # 3. Exact prepared calldata transmitted
    assert call_tx_obj["data"] == expected_calldata
    assert gas_tx_obj["data"] == expected_calldata

    # 4. Value is correct ('0x0')
    assert call_tx_obj["value"] == "0x0"
    assert gas_tx_obj["value"] == "0x0"

    # 5. Same explicit block number transmitted to both RPC methods
    assert call_block_hex == "0x1298be0"
    assert gas_block_hex == "0x1298be0"
    assert call_block_hex == gas_block_hex

    # 6. chainId, nonce, and KYROX metadata are absent from execution-call objects
    assert set(call_tx_obj.keys()) == {"from", "to", "data", "value"}
    assert set(gas_tx_obj.keys()) == {"from", "to", "data", "value"}
    for forbidden in (
        "chainId",
        "nonce",
        "intent_hash",
        "expires_at",
        "intent_id",
        "ticker",
        "amount_decimal",
        "signed",
        "broadcast",
    ):
        assert forbidden not in call_tx_obj
        assert forbidden not in gas_tx_obj

    # 7. Chain ID verified and zero signing/broadcasting methods called
    called_methods = {m for m, _ in recording_provider.requests}
    assert "eth_chainId" in called_methods
    assert called_methods.isdisjoint(
        {
            "eth_sendTransaction",
            "eth_sendRawTransaction",
            "eth_sign",
            "eth_signTransaction",
            "personal_sign",
        }
    )



