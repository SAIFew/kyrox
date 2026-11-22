"""MCP STDIO protocol integrity and tool registration tests for KYROX."""

from __future__ import annotations

from collections.abc import Coroutine
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any, TypeVar

import server

PROJECT_ROOT = Path(__file__).resolve().parent.parent
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


def test_all_registered_mcp_tools_have_read_only_non_destructive_annotations() -> None:
    tools = _run_sync_coroutine(server.mcp.list_tools())
    tool_by_name = {tool.name: tool for tool in tools}
    expected_tools = {
        "hello_kyrox",
        "get_stock_info",
        "list_stocks",
        "get_wallet_balances",
        "get_portfolio",
        "prepare_transaction",
        "simulate_transaction",
    }
    assert set(tool_by_name.keys()) == expected_tools

    for name, tool in tool_by_name.items():
        assert tool.annotations is not None, f"Tool {name} missing annotations"
        assert tool.annotations.readOnlyHint is True, f"Tool {name} must be readOnlyHint=True"
        assert tool.annotations.destructiveHint is False, f"Tool {name} must be destructiveHint=False"
        assert tool.annotations.idempotentHint is True, f"Tool {name} must be idempotentHint=True"


def test_stdio_protocol_framing_and_clean_stdout(tmp_path: Path) -> None:
    """Spawn server.py over STDIO and verify JSON-RPC initialize, tools/list, and tools/call."""
    env = dict(os.environ)
    env["KYROX_LOG_DIR"] = str(tmp_path / "stdio_logs")

    requests_lines = [
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "kyrox-pytest-stdio", "version": "0.1.0"},
                },
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "get_stock_info",
                    "arguments": {"ticker": "tAAPL"},
                },
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": "get_portfolio",
                    "arguments": {"wallet": "0x0000000000000000000000000000000000000000"},
                },
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": "prepare_transaction",
                    "arguments": {
                        "from_wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
                        "ticker": "tAAPL",
                        "to": "0x2222222222222222222222222222222222222222",
                        "amount": 10,
                    },
                },
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 6,
                "method": "tools/call",
                "params": {
                    "name": "simulate_transaction",
                    "arguments": {
                        "from_wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
                        "ticker": "tAAPL",
                        "to": "0x2222222222222222222222222222222222222222",
                        "amount": 10,
                    },
                },
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/call",
                "params": {
                    "name": "prepare_transaction",
                    "arguments": {
                        "from_wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
                        "ticker": "tAAPL",
                        "to": "0x2222222222222222222222222222222222222222",
                        "amount": 100,
                    },
                },
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 8,
                "method": "tools/call",
                "params": {
                    "name": "simulate_transaction",
                    "arguments": {
                        "from_wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
                        "ticker": "tAAPL",
                        "to": "0x2222222222222222222222222222222222222222",
                        "amount": 100,
                    },
                },
            }
        ),
    ]
    stdin_payload = "\n".join(requests_lines) + "\n"

    proc = subprocess.Popen(
        [sys.executable, str(PROJECT_ROOT / "server.py")],
        cwd=str(PROJECT_ROOT),
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )

    stdout_lines: list[str] = []
    try:
        assert proc.stdin is not None
        assert proc.stdout is not None
        for raw_line in requests_lines:
            proc.stdin.write(raw_line + "\n")
            proc.stdin.flush()
            msg_obj = json.loads(raw_line)
            if "id" in msg_obj:
                resp_line = proc.stdout.readline().strip()
                assert resp_line, f"Expected JSON-RPC response for id={msg_obj['id']}"
                stdout_lines.append(resp_line)
        proc.stdin.close()
        proc.wait(timeout=10)
    finally:
        if proc.poll() is None:
            proc.kill()

    assert len(stdout_lines) == 8

    parsed_messages: dict[int, dict[str, Any]] = {}
    for line in stdout_lines:
        # Every single line on stdout MUST be valid JSON-RPC (no banners or logs)
        msg = json.loads(line)
        assert msg.get("jsonrpc") == "2.0"
        if "id" in msg:
            parsed_messages[int(msg["id"])] = msg

    assert 1 in parsed_messages
    assert parsed_messages[1]["result"]["serverInfo"]["name"] == "KYROX"
    assert parsed_messages[1]["result"]["serverInfo"]["version"] == "0.1.0"

    assert 2 in parsed_messages
    listed_tools = {t["name"] for t in parsed_messages[2]["result"]["tools"]}
    assert {
        "hello_kyrox",
        "get_stock_info",
        "list_stocks",
        "get_wallet_balances",
        "get_portfolio",
        "prepare_transaction",
        "simulate_transaction",
    }.issubset(listed_tools)

    assert 3 in parsed_messages
    stock_payload = json.loads(parsed_messages[3]["result"]["content"][0]["text"])
    assert stock_payload["ticker"] == "tAAPL"
    assert stock_payload["reference_value"] == 230.0

    assert 4 in parsed_messages
    portfolio_err = json.loads(parsed_messages[4]["result"]["content"][0]["text"])
    assert "error" in portfolio_err
    assert "zero address" in portfolio_err["error"].lower()

    assert 5 in parsed_messages
    tx_err = json.loads(parsed_messages[5]["result"]["content"][0]["text"])
    assert "error" in tx_err
    assert "not configured in the stock dataset" in tx_err["error"]
    assert tx_err["requires_human_approval"] is True

    assert 6 in parsed_messages
    sim_err = json.loads(parsed_messages[6]["result"]["content"][0]["text"])
    assert "error" in sim_err
    assert "not configured in the stock dataset" in sim_err["error"]
    assert sim_err["requires_human_approval"] is True

    assert 7 in parsed_messages
    tx_policy_err = json.loads(parsed_messages[7]["result"]["content"][0]["text"])
    assert "error" in tx_policy_err
    assert "exceeds maximum allowed limit (50)" in tx_policy_err["error"]
    assert tx_policy_err["requires_human_approval"] is True
    assert tx_policy_err["policy"]["allowed"] is False

    assert 8 in parsed_messages
    sim_policy_err = json.loads(parsed_messages[8]["result"]["content"][0]["text"])
    assert "error" in sim_policy_err
    assert "exceeds maximum allowed limit (50)" in sim_policy_err["error"]
    assert sim_policy_err["requires_human_approval"] is True
    assert sim_policy_err["policy"]["allowed"] is False


def test_stdio_server_runs_from_external_working_directory(tmp_path: Path) -> None:
    """Verify server.py starts and serves packaged stock data when cwd is outside the repo root."""
    external_cwd = tmp_path / "external_workdir"
    external_cwd.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["KYROX_LOG_DIR"] = str(tmp_path / "external_stdio_logs")

    requests_lines = [
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "kyrox-external-cwd-test", "version": "0.1.0"},
                },
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "hello_kyrox",
                    "arguments": {"name": "Developer"},
                },
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": "list_stocks",
                    "arguments": {},
                },
            }
        ),
    ]

    proc = subprocess.Popen(
        [sys.executable, str(PROJECT_ROOT / "server.py")],
        cwd=str(external_cwd),
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )

    parsed_messages: dict[int, dict[str, Any]] = {}
    try:
        assert proc.stdin is not None
        assert proc.stdout is not None
        for raw_line in requests_lines:
            proc.stdin.write(raw_line + "\n")
            proc.stdin.flush()
            msg_obj = json.loads(raw_line)
            if "id" in msg_obj:
                resp_line = proc.stdout.readline().strip()
                assert resp_line
                msg = json.loads(resp_line)
                assert msg.get("jsonrpc") == "2.0"
                parsed_messages[int(msg["id"])] = msg
        proc.stdin.close()
        proc.wait(timeout=10)
    finally:
        if proc.poll() is None:
            proc.kill()

    assert parsed_messages[1]["result"]["serverInfo"] == {
        "name": "KYROX",
        "version": "0.1.0",
    }
    tools_list = parsed_messages[2]["result"]["tools"]
    assert len(tools_list) == 7
    for tool_entry in tools_list:
        assert "inputSchema" in tool_entry
        assert tool_entry["inputSchema"]["type"] == "object"

    greeting_text = parsed_messages[3]["result"]["content"][0]["text"]
    assert greeting_text == "Hello Developer, KYROX is live."

    stocks_content = parsed_messages[4]["result"]["content"]
    assert len(stocks_content) == 3
    first_stock = json.loads(stocks_content[0]["text"])
    assert first_stock["ticker"] == "tAAPL"
    assert first_stock["reference_value"] == 230.0

