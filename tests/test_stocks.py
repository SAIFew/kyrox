"""Unit and MCP integration tests for KYROX Day 4 stock information tool."""

from __future__ import annotations

from collections.abc import Coroutine
import json
import os
import pathlib
from typing import Any, TypeVar

import pytest

import server
import tools.stocks as stocks_module
from tools.stocks import find_stock, load_stocks


PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
T = TypeVar("T")


def _run_sync_coroutine(coro: Coroutine[Any, Any, T]) -> T:
    """Drive a non-blocking FastMCP coroutine to completion without socketpair."""
    try:
        coro.send(None)
    except StopIteration as stop:
        return stop.value
    finally:
        coro.close()
    raise RuntimeError("Coroutine yielded unexpectedly")


# ---------------------------------------------------------------------------
# A. Stock Lookup Function Tests
# ---------------------------------------------------------------------------


def test_load_stocks_returns_all_expected_mock_records() -> None:
    records = load_stocks()
    assert len(records) == 3
    assert records == [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "token_address": "",
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
            "token_address": "",
        },
    ]


def test_load_stocks_is_independent_of_current_working_directory(
    tmp_path: pathlib.Path,
) -> None:
    original_cwd = pathlib.Path.cwd()
    try:
        os.chdir(tmp_path)
        records = load_stocks()
        assert len(records) == 3
        assert records[0]["ticker"] == "tAAPL"
    finally:
        os.chdir(original_cwd)


@pytest.mark.parametrize(
    ("ticker_input", "expected_record"),
    [
        (
            "tAAPL",
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": 230.0,
                "token_address": "",
            },
        ),
        (
            "tTSLA",
            {
                "ticker": "tTSLA",
                "stock": "Test Tesla",
                "reference_value": 250.0,
                "token_address": "",
            },
        ),
        (
            "tNVDA",
            {
                "ticker": "tNVDA",
                "stock": "Test Nvidia",
                "reference_value": 140.0,
                "token_address": "",
            },
        ),
        (
            "taapl",
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": 230.0,
                "token_address": "",
            },
        ),
        (
            "  tTsLa  ",
            {
                "ticker": "tTSLA",
                "stock": "Test Tesla",
                "reference_value": 250.0,
                "token_address": "",
            },
        ),
    ],
)
def test_find_stock_valid_and_case_insensitive(
    ticker_input: str, expected_record: dict[str, Any]
) -> None:
    result = find_stock(ticker_input)
    assert result == expected_record


@pytest.mark.parametrize("invalid_input", ["XYZ", " XYZ ", "", "   "])
def test_find_stock_unknown_and_blank_inputs(invalid_input: str) -> None:
    assert find_stock(invalid_input) is None


# ---------------------------------------------------------------------------
# B. MCP Tool Tests (Direct, FastMCP Tool Registry, and Stdio Client/Server)
# ---------------------------------------------------------------------------


def test_get_stock_info_valid_tickers() -> None:
    assert server.get_stock_info("tAAPL") == {
        "ticker": "tAAPL",
        "stock": "Test Apple",
        "reference_value": 230.0,
        "token_address": "",
    }
    assert server.get_stock_info("tTSLA") == {
        "ticker": "tTSLA",
        "stock": "Test Tesla",
        "reference_value": 250.0,
        "token_address": "",
    }
    assert server.get_stock_info("tNVDA") == {
        "ticker": "tNVDA",
        "stock": "Test Nvidia",
        "reference_value": 140.0,
        "token_address": "",
    }
    assert server.get_stock_info("taapl") == {
        "ticker": "tAAPL",
        "stock": "Test Apple",
        "reference_value": 230.0,
        "token_address": "",
    }


def test_get_stock_info_invalid_and_empty_tickers() -> None:
    assert server.get_stock_info("XYZ") == {"error": "Ticker XYZ not found."}
    assert "error" in server.get_stock_info("")
    assert "error" in server.get_stock_info("   ")


def test_hello_kyrox_regression() -> None:
    assert server.hello_kyrox("Saif") == "Hello Saif, KYROX is live."


def test_fastmcp_tool_discovery_and_invocation() -> None:
    tools = _run_sync_coroutine(server.mcp.list_tools())
    tool_names = {tool.name for tool in tools}
    assert "hello_kyrox" in tool_names
    assert "get_stock_info" in tool_names

    # Test 1: tAAPL
    content_aapl, structured_aapl = _run_sync_coroutine(
        server.mcp.call_tool("get_stock_info", {"ticker": "tAAPL"})
    )
    expected_aapl = {
        "ticker": "tAAPL",
        "stock": "Test Apple",
        "reference_value": 230.0,
        "token_address": "",
    }
    assert structured_aapl == expected_aapl
    assert json.loads(content_aapl[0].text) == expected_aapl

    # Test 2: tTSLA
    content_tsla, structured_tsla = _run_sync_coroutine(
        server.mcp.call_tool("get_stock_info", {"ticker": "tTSLA"})
    )
    expected_tsla = {
        "ticker": "tTSLA",
        "stock": "Test Tesla",
        "reference_value": 250.0,
        "token_address": "",
    }
    assert structured_tsla == expected_tsla
    assert json.loads(content_tsla[0].text) == expected_tsla

    # Test 3: tNVDA
    content_nvda, structured_nvda = _run_sync_coroutine(
        server.mcp.call_tool("get_stock_info", {"ticker": "tNVDA"})
    )
    expected_nvda = {
        "ticker": "tNVDA",
        "stock": "Test Nvidia",
        "reference_value": 140.0,
        "token_address": "",
    }
    assert structured_nvda == expected_nvda
    assert json.loads(content_nvda[0].text) == expected_nvda

    # Test 4: Case-insensitive taapl
    content_lower, structured_lower = _run_sync_coroutine(
        server.mcp.call_tool("get_stock_info", {"ticker": "taapl"})
    )
    assert structured_lower == expected_aapl
    assert json.loads(content_lower[0].text) == expected_aapl

    # Test 5: Invalid ticker XYZ
    content_xyz, structured_xyz = _run_sync_coroutine(
        server.mcp.call_tool("get_stock_info", {"ticker": "XYZ"})
    )
    expected_xyz = {"error": "Ticker XYZ not found."}
    assert structured_xyz == expected_xyz
    assert json.loads(content_xyz[0].text) == expected_xyz

    # Test 6: Existing tool regression hello_kyrox
    content_hello, structured_hello = _run_sync_coroutine(
        server.mcp.call_tool("hello_kyrox", {"name": "Builder"})
    )
    assert content_hello[0].text == "Hello Builder, KYROX is live."
    assert structured_hello == {"result": "Hello Builder, KYROX is live."}


# ---------------------------------------------------------------------------
# C. Error Handling Tests
# ---------------------------------------------------------------------------


def test_load_stocks_missing_file_raises_file_not_found(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    missing_path = tmp_path / "does_not_exist.json"
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", missing_path)

    with pytest.raises(FileNotFoundError, match="Stock data file not found"):
        load_stocks()

    # Ensure server.get_stock_info does not silently swallow FileNotFoundError into "not found"
    with pytest.raises(FileNotFoundError, match="Stock data file not found"):
        server.get_stock_info("tAAPL")


def test_load_stocks_malformed_json_raises_value_error(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    malformed_path = tmp_path / "malformed.json"
    malformed_path.write_text("{invalid json", encoding="utf-8")
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", malformed_path)

    with pytest.raises(ValueError, match="Invalid JSON in stock data file"):
        load_stocks()

    with pytest.raises(ValueError, match="Invalid JSON in stock data file"):
        server.get_stock_info("tAAPL")


@pytest.mark.parametrize(
    ("invalid_payload", "expected_message"),
    [
        ({"ticker": "tAAPL"}, "expected a JSON list"),
        (["not_a_dict"], "expected object"),
        ([{"ticker": "tAAPL"}], "missing required field"),
        (
            [
                {
                    "ticker": "   ",
                    "stock": "Test Apple",
                    "reference_value": 230.0,
                    "token_address": "",
                }
            ],
            "'ticker' must be a non-empty string",
        ),
        (
            [
                {
                    "ticker": "tAAPL",
                    "stock": "Test Apple",
                    "reference_value": True,
                    "token_address": "",
                }
            ],
            "'reference_value' must be a number",
        ),
        (
            [
                {
                    "ticker": "tAAPL",
                    "stock": "Test Apple",
                    "reference_value": 230.0,
                    "token_address": None,
                }
            ],
            "'token_address' must be a string",
        ),
    ],
)
def test_load_stocks_invalid_structure_raises_value_error(
    tmp_path: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
    invalid_payload: Any,
    expected_message: str,
) -> None:
    bad_structure_path = tmp_path / "bad_structure.json"
    bad_structure_path.write_text(json.dumps(invalid_payload), encoding="utf-8")
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", bad_structure_path)

    with pytest.raises(ValueError, match=expected_message):
        load_stocks()

