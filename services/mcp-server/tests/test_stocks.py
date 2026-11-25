"""Unit and MCP integration tests for KYROX stock tools (get_stock_info and list_stocks)."""

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
    assert len(records) == 7
    assert records == [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "token_address": "",
        },
        {
            "ticker": "tNVDA",
            "stock": "Test NVIDIA",
            "reference_value": 140.0,
            "token_address": "",
        },
        {
            "ticker": "tMSFT",
            "stock": "Test Microsoft",
            "reference_value": 415.0,
            "token_address": "",
        },
        {
            "ticker": "tGOOGL",
            "stock": "Test Google",
            "reference_value": 180.0,
            "token_address": "",
        },
        {
            "ticker": "tAMZN",
            "stock": "Test Amazon",
            "reference_value": 200.0,
            "token_address": "",
        },
        {
            "ticker": "tTSLA",
            "stock": "Test Tesla",
            "reference_value": 250.0,
            "token_address": "",
        },
        {
            "ticker": "tMETA",
            "stock": "Test Meta",
            "reference_value": 520.0,
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
        assert len(records) == 7
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
            "tNVDA",
            {
                "ticker": "tNVDA",
                "stock": "Test NVIDIA",
                "reference_value": 140.0,
                "token_address": "",
            },
        ),
        (
            "tMSFT",
            {
                "ticker": "tMSFT",
                "stock": "Test Microsoft",
                "reference_value": 415.0,
                "token_address": "",
            },
        ),
        (
            "tGOOGL",
            {
                "ticker": "tGOOGL",
                "stock": "Test Google",
                "reference_value": 180.0,
                "token_address": "",
            },
        ),
        (
            "tAMZN",
            {
                "ticker": "tAMZN",
                "stock": "Test Amazon",
                "reference_value": 200.0,
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
            "tMETA",
            {
                "ticker": "tMETA",
                "stock": "Test Meta",
                "reference_value": 520.0,
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
    assert server.get_stock_info("tNVDA") == {
        "ticker": "tNVDA",
        "stock": "Test NVIDIA",
        "reference_value": 140.0,
        "token_address": "",
    }
    assert server.get_stock_info("tMSFT") == {
        "ticker": "tMSFT",
        "stock": "Test Microsoft",
        "reference_value": 415.0,
        "token_address": "",
    }
    assert server.get_stock_info("tGOOGL") == {
        "ticker": "tGOOGL",
        "stock": "Test Google",
        "reference_value": 180.0,
        "token_address": "",
    }
    assert server.get_stock_info("tAMZN") == {
        "ticker": "tAMZN",
        "stock": "Test Amazon",
        "reference_value": 200.0,
        "token_address": "",
    }
    assert server.get_stock_info("tTSLA") == {
        "ticker": "tTSLA",
        "stock": "Test Tesla",
        "reference_value": 250.0,
        "token_address": "",
    }
    assert server.get_stock_info("tMETA") == {
        "ticker": "tMETA",
        "stock": "Test Meta",
        "reference_value": 520.0,
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


def test_list_stocks_returns_all_configured_records_with_exact_fields() -> None:
    raw_records = load_stocks()
    result = server.list_stocks()

    assert isinstance(result, list)
    assert len(result) == len(raw_records) == 7

    for summary, original in zip(result, raw_records, strict=True):
        assert set(summary.keys()) == {"ticker", "name", "reference_value"}
        assert summary["ticker"] == original["ticker"]
        assert summary["name"] == original["stock"]
        assert summary["reference_value"] == original["reference_value"]

    assert result == [
        {"ticker": "tAAPL", "name": "Test Apple", "reference_value": 230.0},
        {"ticker": "tNVDA", "name": "Test NVIDIA", "reference_value": 140.0},
        {"ticker": "tMSFT", "name": "Test Microsoft", "reference_value": 415.0},
        {"ticker": "tGOOGL", "name": "Test Google", "reference_value": 180.0},
        {"ticker": "tAMZN", "name": "Test Amazon", "reference_value": 200.0},
        {"ticker": "tTSLA", "name": "Test Tesla", "reference_value": 250.0},
        {"ticker": "tMETA", "name": "Test Meta", "reference_value": 520.0},
    ]


def test_list_stocks_reflects_custom_data_source_and_preserves_order(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    custom_path = tmp_path / "custom_stocks.json"
    custom_payload = [
        {
            "ticker": "tMSFT",
            "stock": "Test Microsoft",
            "reference_value": 415.5,
            "token_address": "0x0000000000000000000000000000000000000001",
        },
        {
            "ticker": "tGOOG",
            "stock": "Test Alphabet",
            "reference_value": 180.25,
            "token_address": "0x0000000000000000000000000000000000000002",
        },
    ]
    custom_path.write_text(json.dumps(custom_payload), encoding="utf-8")
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", custom_path)

    result = server.list_stocks()
    assert result == [
        {"ticker": "tMSFT", "name": "Test Microsoft", "reference_value": 415.5},
        {"ticker": "tGOOG", "name": "Test Alphabet", "reference_value": 180.25},
    ]


def test_list_stocks_empty_dataset_returns_empty_list(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    empty_path = tmp_path / "empty_stocks.json"
    empty_path.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", empty_path)

    assert load_stocks() == []
    assert server.list_stocks() == []


def test_fastmcp_tool_discovery_and_invocation() -> None:
    tools = _run_sync_coroutine(server.mcp.list_tools())
    tool_by_name = {tool.name: tool for tool in tools}
    tool_names = set(tool_by_name.keys())
    assert "hello_kyrox" in tool_names
    assert "get_stock_info" in tool_names
    assert "list_stocks" in tool_names

    list_stocks_tool = tool_by_name["list_stocks"]
    assert not list_stocks_tool.inputSchema.get("required")

    # Test 0: list_stocks via FastMCP
    content_list, structured_list = _run_sync_coroutine(
        server.mcp.call_tool("list_stocks", {})
    )
    expected_list = [
        {"ticker": "tAAPL", "name": "Test Apple", "reference_value": 230.0},
        {"ticker": "tNVDA", "name": "Test NVIDIA", "reference_value": 140.0},
        {"ticker": "tMSFT", "name": "Test Microsoft", "reference_value": 415.0},
        {"ticker": "tGOOGL", "name": "Test Google", "reference_value": 180.0},
        {"ticker": "tAMZN", "name": "Test Amazon", "reference_value": 200.0},
        {"ticker": "tTSLA", "name": "Test Tesla", "reference_value": 250.0},
        {"ticker": "tMETA", "name": "Test Meta", "reference_value": 520.0},
    ]
    assert structured_list == {"result": expected_list}
    assert [json.loads(block.text) for block in content_list] == expected_list

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
        "stock": "Test NVIDIA",
        "reference_value": 140.0,
        "token_address": "",
    }
    assert structured_nvda == expected_nvda
    assert json.loads(content_nvda[0].text) == expected_nvda

    # Test 3b: tMSFT (newly added seven-asset catalogue entry)
    content_msft, structured_msft = _run_sync_coroutine(
        server.mcp.call_tool("get_stock_info", {"ticker": "tMSFT"})
    )
    expected_msft = {
        "ticker": "tMSFT",
        "stock": "Test Microsoft",
        "reference_value": 415.0,
        "token_address": "",
    }
    assert structured_msft == expected_msft
    assert json.loads(content_msft[0].text) == expected_msft

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

    # Ensure server.get_stock_info and server.list_stocks do not silently swallow FileNotFoundError
    with pytest.raises(FileNotFoundError, match="Stock data file not found"):
        server.get_stock_info("tAAPL")

    with pytest.raises(FileNotFoundError, match="Stock data file not found"):
        server.list_stocks()


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

    with pytest.raises(ValueError, match="Invalid JSON in stock data file"):
        server.list_stocks()


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

    with pytest.raises(ValueError, match=expected_message):
        server.list_stocks()


# ---------------------------------------------------------------------------
# D. Extended Day 7 Stock Validation & Cache Invalidation Tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "duplicate_tickers",
    [
        ("tAAPL", "tAAPL"),
        ("tAAPL", "taapl"),
        ("tTSLA", "  ttsla  "),
    ],
)
def test_load_stocks_duplicate_tickers_rejected_case_insensitively(
    tmp_path: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
    duplicate_tickers: tuple[str, str],
) -> None:
    dup_path = tmp_path / "duplicate_stocks.json"
    first_ticker, second_ticker = duplicate_tickers
    payload = [
        {
            "ticker": first_ticker,
            "stock": "Test First",
            "reference_value": 100.0,
            "token_address": "",
        },
        {
            "ticker": second_ticker,
            "stock": "Test Second",
            "reference_value": 200.0,
            "token_address": "",
        },
    ]
    dup_path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", dup_path)

    with pytest.raises(ValueError, match="duplicate stock ticker") as exc_info:
        load_stocks()
    assert getattr(exc_info.value, "code", None) == "DUPLICATE_TICKER"


@pytest.mark.parametrize(
    ("bad_value", "expected_match"),
    [
        (0, "must be a positive number"),
        (0.0, "must be a positive number"),
        (-150.5, "must be a positive number"),
        ("230.0", "must be a number"),
        (False, "must be a number"),
        (None, "must be a number"),
    ],
)
def test_load_stocks_rejects_non_positive_and_non_numeric_reference_values(
    tmp_path: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
    bad_value: Any,
    expected_match: str,
) -> None:
    bad_path = tmp_path / "bad_numeric_stocks.json"
    payload = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": bad_value,
            "token_address": "",
        }
    ]
    bad_path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", bad_path)

    with pytest.raises(ValueError, match=expected_match):
        load_stocks()


@pytest.mark.parametrize("non_finite_literal", ["NaN", "Infinity", "-Infinity"])
def test_load_stocks_rejects_nan_and_infinity_in_json(
    tmp_path: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
    non_finite_literal: str,
) -> None:
    nan_path = tmp_path / "nan_stocks.json"
    raw_json = (
        '[{"ticker": "tAAPL", "stock": "Test Apple", '
        f'"reference_value": {non_finite_literal}, "token_address": ""}}]'
    )
    nan_path.write_text(raw_json, encoding="utf-8")
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", nan_path)

    with pytest.raises(ValueError, match="must be a finite number"):
        load_stocks()


def test_load_stocks_rejects_blank_stock_name(
    tmp_path: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad_name_path = tmp_path / "bad_name.json"
    payload = [
        {
            "ticker": "tAAPL",
            "stock": "   ",
            "reference_value": 230.0,
            "token_address": "",
        }
    ]
    bad_name_path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", bad_name_path)

    with pytest.raises(ValueError, match="'stock' must be a non-empty string"):
        load_stocks()


def test_stocks_cache_hits_and_auto_invalidates_on_file_update(
    tmp_path: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_file = tmp_path / "cached_stocks.json"
    initial_payload = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 230.0,
            "token_address": "",
        }
    ]
    cache_file.write_text(json.dumps(initial_payload), encoding="utf-8")
    monkeypatch.setattr(stocks_module, "STOCKS_FILE", cache_file)
    stocks_module.invalidate_stocks_cache()

    before_stats = stocks_module.get_stocks_cache_stats()
    first_read = load_stocks()
    after_miss_stats = stocks_module.get_stocks_cache_stats()
    assert after_miss_stats["misses"] == before_stats["misses"] + 1

    # Mutating returned record must not corrupt cached dataset
    first_read[0]["reference_value"] = 999999.0

    second_read = load_stocks()
    after_hit_stats = stocks_module.get_stocks_cache_stats()
    assert after_hit_stats["hits"] == after_miss_stats["hits"] + 1
    assert second_read[0]["reference_value"] == 230.0

    # Updating file content on disk must automatically invalidate cache
    updated_payload = [
        {
            "ticker": "tAAPL",
            "stock": "Test Apple",
            "reference_value": 245.0,
            "token_address": "",
        }
    ]
    cache_file.write_text(json.dumps(updated_payload), encoding="utf-8")
    third_read = load_stocks()
    assert third_read[0]["reference_value"] == 245.0

    # Explicit cache invalidation forces a fresh miss on next read
    stocks_module.invalidate_stocks_cache()
    post_invalidate_stats = stocks_module.get_stocks_cache_stats()
    load_stocks()
    final_stats = stocks_module.get_stocks_cache_stats()
    assert final_stats["misses"] == post_invalidate_stats["misses"] + 1


