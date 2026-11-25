"""Unit and MCP integration tests for KYROX Base Sepolia wallet balance tool."""

from __future__ import annotations

from collections.abc import Coroutine
import json
import pathlib
from typing import Any, TypeVar
from unittest.mock import MagicMock

import pytest
from web3 import Web3

import server
import tools.stocks as stocks_module
import tools.wallet as wallet_module
from tools.wallet import (
    BASE_SEPOLIA_CHAIN_ID,
    ERC20_ABI,
    convert_raw_balance,
    get_balances,
    validate_contract_address,
    validate_wallet_address,
    verify_base_sepolia_connection,
)

T = TypeVar("T")

SAMPLE_LOWER_WALLET = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f"
SAMPLE_CHECKSUM_WALLET = Web3.to_checksum_address(SAMPLE_LOWER_WALLET)

MOCK_AAPL_ADDRESS = "0x1111111111111111111111111111111111111111"
MOCK_TSLA_ADDRESS = "0x2222222222222222222222222222222222222222"
MOCK_NVDA_ADDRESS = "0x3333333333333333333333333333333333333333"

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
    token_configs: dict[str, tuple[int, int]] | None = None,
    bytecode: bytes = b"\x60\x80\x60\x40",
) -> MagicMock:
    """Construct a mocked Web3 instance for deterministic offline testing.

    Args:
        is_connected: Return value for ``w3.is_connected()``.
        chain_id: Value for ``w3.eth.chain_id``.
        token_configs: Mapping of checksummed contract address to
            ``(raw_balance, decimals)``.
        bytecode: Bytecode returned by ``w3.eth.get_code()``.
    """
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
# 1. Valid Wallet Address
# ---------------------------------------------------------------------------


def test_valid_wallet_address_is_accepted_and_checksum_normalized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert validate_wallet_address(SAMPLE_LOWER_WALLET) == SAMPLE_CHECKSUM_WALLET
    assert (
        validate_wallet_address(f"  {SAMPLE_LOWER_WALLET}  ")
        == SAMPLE_CHECKSUM_WALLET
    )

    mock_w3 = _make_mock_web3(token_configs={})
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(wallet_module, "load_stocks", lambda: [])

    result = get_balances(SAMPLE_LOWER_WALLET)
    assert result["wallet"] == SAMPLE_CHECKSUM_WALLET
    assert result["chain"] == "base-sepolia"
    assert result["balances"] == []


# ---------------------------------------------------------------------------
# 2. Invalid Wallet Address
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "invalid_wallet",
    [
        "0x12345",
        "not_an_ethereum_address",
        "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        "71c7656ec7ab88b098defb751b7401b5f6d8976",  # 39 hex chars
    ],
)
def test_invalid_wallet_address_returns_clear_validation_error(
    invalid_wallet: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(ValueError, match="Invalid Ethereum wallet address"):
        validate_wallet_address(invalid_wallet)

    # Ensure get_web3 is never called when wallet validation fails
    get_web3_mock = MagicMock()
    monkeypatch.setattr(wallet_module, "get_web3", get_web3_mock)

    result = get_balances(invalid_wallet)
    assert "error" in result
    assert "Invalid Ethereum wallet address" in result["error"]
    get_web3_mock.assert_not_called()


# ---------------------------------------------------------------------------
# 3. Empty Wallet Address
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("empty_input", ["", "   ", "\t\n"])
def test_empty_wallet_address_is_rejected(
    empty_input: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(ValueError, match="Wallet address must not be empty"):
        validate_wallet_address(empty_input)

    get_web3_mock = MagicMock()
    monkeypatch.setattr(wallet_module, "get_web3", get_web3_mock)

    result = get_balances(empty_input)
    assert result == {"error": "Wallet address must not be empty."}
    get_web3_mock.assert_not_called()


# ---------------------------------------------------------------------------
# 4. Correct Network (Base Sepolia chainId 84532)
# ---------------------------------------------------------------------------


def test_correct_network_chain_id_84532_is_accepted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3(is_connected=True, chain_id=84532)
    assert verify_base_sepolia_connection(mock_w3) == 84532

    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(wallet_module, "load_stocks", lambda: [])

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert result == {
        "wallet": SAMPLE_CHECKSUM_WALLET,
        "chain": "base-sepolia",
        "balances": [],
    }


# ---------------------------------------------------------------------------
# 5. Incorrect Network
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("wrong_chain_id", [1, 8453, 11155111, 42161])
def test_incorrect_network_chain_id_is_rejected(
    wrong_chain_id: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    mock_w3 = _make_mock_web3(
        is_connected=True,
        chain_id=wrong_chain_id,
        token_configs={MOCK_AAPL_ADDRESS: (1000 * 10**18, 18)},
    )
    with pytest.raises(ValueError, match="expected Base Sepolia"):
        verify_base_sepolia_connection(mock_w3)

    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert str(wrong_chain_id) in result["error"]
    assert "84532" in result["error"]
    mock_w3.eth.contract.assert_not_called()


# ---------------------------------------------------------------------------
# 6. RPC Unavailable
# ---------------------------------------------------------------------------


def test_rpc_unavailable_returns_error_not_fake_zero_balances(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    disconnected_w3 = _make_mock_web3(
        is_connected=False,
        token_configs={MOCK_AAPL_ADDRESS: (1000 * 10**18, 18)},
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: disconnected_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "balances" not in result
    assert "Unable to connect to Base Sepolia RPC provider" in result["error"]
    disconnected_w3.eth.contract.assert_not_called()


def test_rpc_connection_exception_returns_clear_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raising_w3 = MagicMock()
    raising_w3.is_connected.side_effect = RuntimeError("Connection timed out")
    monkeypatch.setattr(wallet_module, "get_web3", lambda: raising_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "balances" not in result
    assert "Unable to connect to Base Sepolia RPC provider" in result["error"]


# ---------------------------------------------------------------------------
# 7. Blank Contract Address
# ---------------------------------------------------------------------------


def test_blank_contract_addresses_are_skipped_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert validate_contract_address("", ticker="tAAPL") is None
    assert validate_contract_address("   ", ticker="tTSLA") is None

    partial_stocks = [
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
            "token_address": "",
        },
        {
            "ticker": "tNVDA",
            "stock": "Test Nvidia",
            "reference_value": 140.0,
            "token_address": "   ",
        },
    ]
    mock_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (1000 * 10**18, 18)}
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(wallet_module, "load_stocks", lambda: partial_stocks)

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert result == {
        "wallet": SAMPLE_CHECKSUM_WALLET,
        "chain": "base-sepolia",
        "balances": [{"ticker": "tAAPL", "balance": 1000}],
    }
    assert mock_w3.eth.contract.call_count == 1


# ---------------------------------------------------------------------------
# 8. Malformed Contract Address & Missing Bytecode
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_token_address",
    ["0xINVALID", "ACTUAL_APPLE_CONTRACT_ADDRESS", "0x1234"],
)
def test_malformed_non_empty_contract_address_generates_clear_error(
    bad_token_address: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(ValueError, match="Invalid token contract address for tAAPL"):
        validate_contract_address(bad_token_address, ticker="tAAPL")

    bad_stocks = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "token_address": bad_token_address,
        }
    ]
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(wallet_module, "load_stocks", lambda: bad_stocks)

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "tAAPL" in result["error"]
    assert bad_token_address in result["error"]
    mock_w3.eth.contract.assert_not_called()


def test_duplicate_contract_addresses_across_tickers_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    duplicate_stocks = [
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
    mock_w3 = _make_mock_web3()
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(wallet_module, "load_stocks", lambda: duplicate_stocks)

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "Duplicate token contract address" in result["error"]


def test_empty_contract_bytecode_returns_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3(
        token_configs={MOCK_AAPL_ADDRESS: (1000 * 10**18, 18)},
        bytecode=b"",
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS[:1]
    )

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "No contract bytecode found for tAAPL" in result["error"]


# ---------------------------------------------------------------------------
# 9. Decimals Conversion
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw_balance", "decimals", "expected"),
    [
        (1000 * 10**18, 18, 1000),
        (1000 * 10**6, 6, 1000),
        (500 * 10**8, 8, 500),
        (42, 0, 42),
        (15 * 10**17, 18, 1.5),
        (1250000, 6, 1.25),
        (0, 18, 0),
    ],
)
def test_decimals_conversion_uses_actual_token_decimals(
    raw_balance: int, decimals: int, expected: int | float
) -> None:
    converted = convert_raw_balance(raw_balance, decimals)
    assert converted == expected
    if isinstance(expected, int):
        assert isinstance(converted, int)


def test_get_balances_respects_custom_token_decimals_per_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_w3 = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (250 * 10**6, 6),       # 250 with 6 decimals
            MOCK_TSLA_ADDRESS: (125 * 10**7, 8),       # 12.5 with 8 decimals
            MOCK_NVDA_ADDRESS: (1000 * 10**18, 18),    # 1000 with 18 decimals
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert result == {
        "wallet": SAMPLE_CHECKSUM_WALLET,
        "chain": "base-sepolia",
        "balances": [
            {"ticker": "tAAPL", "balance": 250},
            {"ticker": "tTSLA", "balance": 12.5},
            {"ticker": "tNVDA", "balance": 1000},
        ],
    }


# ---------------------------------------------------------------------------
# 10. Three-Token Balance Test (tAAPL=1000, tTSLA=1000, tNVDA=1000)
# ---------------------------------------------------------------------------


def test_three_token_deployment_wallet_returns_1000_each(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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

    result = get_balances(SAMPLE_LOWER_WALLET)
    assert result == {
        "wallet": SAMPLE_CHECKSUM_WALLET,
        "chain": "base-sepolia",
        "balances": [
            {"ticker": "tAAPL", "balance": 1000},
            {"ticker": "tTSLA", "balance": 1000},
            {"ticker": "tNVDA", "balance": 1000},
        ],
    }
    for entry in result["balances"]:
        assert isinstance(entry["balance"], int)


# ---------------------------------------------------------------------------
# 11. Zero Balance Handling
# ---------------------------------------------------------------------------


def test_zero_balance_tokens_are_omitted_consistently(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Case A: one token has 0 balance, two have non-zero balance
    mock_w3_partial = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (1000 * 10**18, 18),
            MOCK_TSLA_ADDRESS: (0, 18),
            MOCK_NVDA_ADDRESS: (500 * 10**18, 18),
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3_partial)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )

    partial_result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert partial_result == {
        "wallet": SAMPLE_CHECKSUM_WALLET,
        "chain": "base-sepolia",
        "balances": [
            {"ticker": "tAAPL", "balance": 1000},
            {"ticker": "tNVDA", "balance": 500},
        ],
    }

    # Case B: all tokens have 0 balance
    mock_w3_zero = _make_mock_web3(
        token_configs={
            MOCK_AAPL_ADDRESS: (0, 18),
            MOCK_TSLA_ADDRESS: (0, 18),
            MOCK_NVDA_ADDRESS: (0, 18),
        }
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: mock_w3_zero)

    zero_result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert zero_result == {
        "wallet": SAMPLE_CHECKSUM_WALLET,
        "chain": "base-sepolia",
        "balances": [],
    }


# ---------------------------------------------------------------------------
# 12. Existing Tool Regression & Security Boundary (Read-Only ABI)
# ---------------------------------------------------------------------------


def test_existing_tools_regression() -> None:
    assert server.hello_kyrox("Saif") == "Hello Saif, KYROX is live."

    stock_info = server.get_stock_info("tAAPL")
    assert stock_info["ticker"] == "tAAPL"
    assert stock_info["stock"] == "Test Apple"
    assert stock_info["reference_value"] == 230.0

    stocks_list = server.list_stocks()
    assert stocks_list == [
        {"ticker": "tAAPL", "name": "Test Apple", "reference_value": 230.0},
        {"ticker": "tNVDA", "name": "Test NVIDIA", "reference_value": 140.0},
        {"ticker": "tMSFT", "name": "Test Microsoft", "reference_value": 415.0},
        {"ticker": "tGOOGL", "name": "Test Google", "reference_value": 180.0},
        {"ticker": "tAMZN", "name": "Test Amazon", "reference_value": 200.0},
        {"ticker": "tTSLA", "name": "Test Tesla", "reference_value": 250.0},
        {"ticker": "tMETA", "name": "Test Meta", "reference_value": 520.0},
    ]


def test_erc20_abi_is_strictly_read_only() -> None:
    function_names = {entry.get("name") for entry in ERC20_ABI}
    assert function_names == {"balanceOf", "decimals"}
    forbidden_methods = {
        "transfer",
        "transferFrom",
        "approve",
        "increaseAllowance",
        "decreaseAllowance",
        "mint",
        "burn",
    }
    assert function_names.isdisjoint(forbidden_methods)
    for entry in ERC20_ABI:
        assert entry.get("stateMutability") == "view"
        assert entry.get("constant") is True


# ---------------------------------------------------------------------------
# 13 & 14. MCP Tool Registration & Invocation via FastMCP
# ---------------------------------------------------------------------------


def test_fastmcp_registers_get_wallet_balances_with_required_wallet_argument() -> None:
    tools = _run_sync_coroutine(server.mcp.list_tools())
    tool_by_name = {tool.name: tool for tool in tools}

    assert "get_wallet_balances" in tool_by_name
    wallet_tool = tool_by_name["get_wallet_balances"]
    input_schema = wallet_tool.inputSchema
    assert input_schema.get("required") == ["wallet"]
    properties = input_schema.get("properties", {})
    assert set(properties.keys()) == {"wallet"}
    assert properties["wallet"].get("type") == "string"


def test_fastmcp_invokes_get_wallet_balances_and_returns_structured_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
        server.mcp.call_tool(
            "get_wallet_balances", {"wallet": SAMPLE_LOWER_WALLET}
        )
    )
    expected_payload = {
        "wallet": SAMPLE_CHECKSUM_WALLET,
        "chain": "base-sepolia",
        "balances": [
            {"ticker": "tAAPL", "balance": 1000},
            {"ticker": "tTSLA", "balance": 1000},
            {"ticker": "tNVDA", "balance": 1000},
        ],
    }
    assert structured_output == expected_payload
    assert json.loads(content_blocks[0].text) == expected_payload

    # Also verify invalid wallet error propagation through FastMCP
    err_blocks, err_structured = _run_sync_coroutine(
        server.mcp.call_tool("get_wallet_balances", {"wallet": "invalid_wallet"})
    )
    assert "error" in err_structured
    assert json.loads(err_blocks[0].text) == err_structured


def test_missing_stocks_file_propagates_file_not_found(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    missing_path = tmp_path / "missing_stocks.json"
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", missing_path)

    with pytest.raises(FileNotFoundError, match="Stock data file not found"):
        server.get_wallet_balances(SAMPLE_CHECKSUM_WALLET)


# ---------------------------------------------------------------------------
# 15. Extended Day 7 Wallet Validation, Configuration & Failure Tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "zero_addr",
    [
        "0x0000000000000000000000000000000000000000",
        "  0x0000000000000000000000000000000000000000  ",
    ],
)
def test_zero_address_rejected_for_wallet_and_contract(
    zero_addr: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(ValueError, match="zero address") as wallet_exc:
        validate_wallet_address(zero_addr)
    assert getattr(wallet_exc.value, "code", None) == "ZERO_ADDRESS_NOT_ALLOWED"

    result = get_balances(zero_addr)
    assert "error" in result
    assert "zero address" in result["error"]

    with pytest.raises(ValueError, match="zero address") as contract_exc:
        validate_contract_address(zero_addr, ticker="tAAPL")
    assert getattr(contract_exc.value, "code", None) == "ZERO_ADDRESS_NOT_ALLOWED"


def test_invalid_mixed_case_eip55_checksum_rejected_for_wallet_and_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Flip the last uppercase 'F' of a valid EIP-55 address to lowercase 'f'
    corrupted_checksum = SAMPLE_CHECKSUM_WALLET[:-1] + (
        "f" if SAMPLE_CHECKSUM_WALLET[-1] == "F" else "F"
    )
    with pytest.raises(ValueError, match="invalid EIP-55 checksum") as wallet_exc:
        validate_wallet_address(corrupted_checksum)
    assert getattr(wallet_exc.value, "code", None) == "INVALID_ADDRESS_CHECKSUM"

    result = get_balances(corrupted_checksum)
    assert "error" in result
    assert "checksum" in result["error"].lower()

    with pytest.raises(ValueError, match="invalid EIP-55 checksum") as contract_exc:
        validate_contract_address(corrupted_checksum, ticker="tAAPL")
    assert getattr(contract_exc.value, "code", None) == "INVALID_ADDRESS_CHECKSUM"

    # All-uppercase and all-lowercase hex bodies remain accepted and normalized
    all_upper = "0x" + SAMPLE_LOWER_WALLET[2:].upper()
    assert validate_wallet_address(all_upper) == SAMPLE_CHECKSUM_WALLET
    assert validate_contract_address(all_upper, ticker="tAAPL") == SAMPLE_CHECKSUM_WALLET


@pytest.mark.parametrize(
    "bad_rpc_url",
    [
        "ftp://sepolia.base.org",
        "not-a-valid-url",
        "https://",
        "https://sepolia.base.org/path with spaces",
    ],
)
def test_invalid_rpc_url_configuration_rejected(
    bad_rpc_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BASE_RPC_URL", bad_rpc_url)
    with pytest.raises(ValueError, match="Invalid BASE_RPC_URL configuration"):
        wallet_module.get_rpc_url()

    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS
    )
    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "Invalid BASE_RPC_URL configuration" in result["error"]


def test_missing_explicit_rpc_url_and_invalid_timeout_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(wallet_module, "load_dotenv", lambda: False)
    monkeypatch.delenv("BASE_RPC_URL", raising=False)
    assert wallet_module.get_rpc_url() == wallet_module.DEFAULT_BASE_RPC_URL

    with pytest.raises(ValueError, match="Missing required configuration") as exc_info:
        wallet_module.get_rpc_url(require_explicit=True)
    assert getattr(exc_info.value, "code", None) == "MISSING_CONFIGURATION"

    for bad_timeout in ("0", "-5", "999", "NaN", "not_a_float"):
        monkeypatch.setenv("BASE_RPC_TIMEOUT", bad_timeout)
        with pytest.raises(ValueError, match="Invalid BASE_RPC_TIMEOUT configuration"):
            wallet_module.get_rpc_timeout()


def test_rpc_timeout_during_chain_id_or_contract_call_is_classified_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    w3_chain_timeout = MagicMock()
    w3_chain_timeout.is_connected.return_value = True
    type(w3_chain_timeout.eth).chain_id = property(
        lambda _self: (_ for _ in ()).throw(TimeoutError("Read timed out"))
    )

    with pytest.raises(TimeoutError, match="request timed out") as exc_info:
        verify_base_sepolia_connection(w3_chain_timeout)
    assert getattr(exc_info.value, "code", None) == "RPC_TIMEOUT"
    assert getattr(exc_info.value, "retryable", None) is True

    # Contract balanceOf call timeout
    w3_call_timeout = _make_mock_web3()
    contract_mock = MagicMock()
    contract_mock.functions.balanceOf.return_value.call.side_effect = TimeoutError(
        "eth_call timed out after 10s"
    )
    w3_call_timeout.eth.contract.side_effect = lambda address, abi: contract_mock
    monkeypatch.setattr(wallet_module, "get_web3", lambda: w3_call_timeout)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS[:1]
    )

    result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert "error" in result
    assert "timed out" in result["error"].lower()


def test_token_contract_revert_and_invalid_decimals_handled_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Case 1: contract call reverts
    w3_revert = _make_mock_web3()
    reverting_contract = MagicMock()
    reverting_contract.functions.balanceOf.return_value.call.side_effect = RuntimeError(
        "execution reverted: ERC20: invalid account"
    )
    w3_revert.eth.contract.side_effect = lambda address, abi: reverting_contract
    monkeypatch.setattr(wallet_module, "get_web3", lambda: w3_revert)
    monkeypatch.setattr(
        wallet_module, "load_stocks", lambda: CONFIGURED_THREE_STOCKS[:1]
    )

    revert_result = get_balances(SAMPLE_CHECKSUM_WALLET)
    assert "error" in revert_result
    assert "Failed to read token balance for tAAPL" in revert_result["error"]

    # Case 2: invalid raw_balance / decimals bounds in convert_raw_balance
    for bad_raw in (-1, True, False, "100", None):
        with pytest.raises(ValueError, match="Invalid raw token balance"):
            convert_raw_balance(bad_raw, 18)  # type: ignore[arg-type]

    for bad_dec in (-1, 78, True, False, "18", None):
        with pytest.raises(ValueError, match="Invalid token decimals"):
            convert_raw_balance(1000, bad_dec)  # type: ignore[arg-type]


