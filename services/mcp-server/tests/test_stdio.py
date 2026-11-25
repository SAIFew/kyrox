"""MCP STDIO protocol integrity and tool registration tests for KYROX."""

from __future__ import annotations

from collections.abc import Coroutine, Iterator
from contextlib import contextmanager
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
from typing import Any, TypeVar

import pytest

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


class StdioClient:
    """Bounded interactive STDIO reader that drains both child pipes."""

    def __init__(self, command: list[str], cwd: Path, env: dict[str, str]) -> None:
        self.process = subprocess.Popen(
            command,
            cwd=str(cwd),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        if self.process.stdin is None or self.process.stdout is None or self.process.stderr is None:
            self.process.kill()
            raise RuntimeError("STDIO pipes were not created")
        self._stdout: queue.Queue[str | None] = queue.Queue()
        self._stderr_lines: list[str] = []
        self._stdout_thread = threading.Thread(
            target=self._pump_stdout,
            args=(self.process.stdout,),
            daemon=True,
        )
        self._stderr_thread = threading.Thread(
            target=self._pump_stderr,
            args=(self.process.stderr,),
            daemon=True,
        )
        self._stdout_thread.start()
        self._stderr_thread.start()
        self._finished = False

    def _pump_stdout(self, stream: Any) -> None:
        try:
            for line in stream:
                self._stdout.put(line)
        except (OSError, ValueError):
            pass
        finally:
            self._stdout.put(None)

    def _pump_stderr(self, stream: Any) -> None:
        try:
            for line in stream:
                self._stderr_lines.append(line)
        except (OSError, ValueError):
            pass

    @property
    def stderr(self) -> str:
        return "".join(self._stderr_lines)

    def send_raw(self, line: str) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(line + "\n")
        self.process.stdin.flush()

    def send_json(self, payload: dict[str, Any]) -> None:
        self.send_raw(json.dumps(payload, separators=(",", ":")))

    def read_line(self, timeout: float = 10) -> str:
        try:
            line = self._stdout.get(timeout=timeout)
        except queue.Empty as exc:
            raise AssertionError(
                f"Timed out after {timeout}s waiting for MCP stdout. stderr: {self.stderr}"
            ) from exc
        if line is None:
            raise AssertionError(f"MCP STDIO closed before a response. stderr: {self.stderr}")
        return line

    def read_json(self, timeout: float = 10) -> dict[str, Any]:
        line = self.read_line(timeout)
        try:
            frame = json.loads(line)
        except json.JSONDecodeError as exc:
            raise AssertionError(f"Non-JSON data on MCP stdout: {line!r}") from exc
        if not isinstance(frame, dict):
            raise AssertionError(f"MCP stdout frame was not an object: {frame!r}")
        return frame

    def read_response(self, request_id: int | None, timeout: float = 10) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(
                    f"Timed out after {timeout}s waiting for response id={request_id}. "
                    f"stderr: {self.stderr}"
                )
            frame = self.read_json(remaining)
            # Logging/error notifications may precede a JSON-RPC response and
            # intentionally have no id. They are not the response itself.
            if "id" not in frame:
                continue
            if frame["id"] == request_id:
                return frame
            raise AssertionError(f"Unexpected response id {frame['id']} while waiting for {request_id}")

    def finish(self, timeout: float = 10) -> int:
        if self._finished:
            return self.process.returncode if self.process.returncode is not None else -1
        if self.process.stdin is not None:
            try:
                self.process.stdin.close()
            except BrokenPipeError:
                pass
        try:
            code = self.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            self.process.kill()
            self.process.wait(timeout=5)
            raise AssertionError(
                f"MCP server did not exit within {timeout}s. stderr: {self.stderr}"
            ) from exc
        self._stdout_thread.join(timeout=5)
        self._stderr_thread.join(timeout=5)
        extra: list[str] = []
        while True:
            try:
                line = self._stdout.get_nowait()
            except queue.Empty:
                break
            if line is not None:
                extra.append(line)
        if extra:
            raise AssertionError(f"Unexpected extra MCP stdout frames: {extra!r}")
        self._finished = True
        return code

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream is not None:
                try:
                    stream.close()
                except (OSError, ValueError):
                    pass
        self._stdout_thread.join(timeout=1)
        self._stderr_thread.join(timeout=1)


@contextmanager
def _stdio_client(
    tmp_path: Path,
    *,
    cwd: Path = PROJECT_ROOT,
    command: list[str] | None = None,
) -> Iterator[StdioClient]:
    env = dict(os.environ)
    env["KYROX_LOG_DIR"] = str(tmp_path / "stdio_logs")
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    client = StdioClient(
        command or [sys.executable, str(PROJECT_ROOT / "server.py")],
        cwd,
        env,
    )
    try:
        yield client
    finally:
        client.stop()


def _initialize(client: StdioClient, client_name: str = "kyrox-pytest-stdio") -> None:
    client.send_json(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": client_name, "version": "0.1.0"},
            },
        }
    )
    response = client.read_json()
    assert response["result"]["serverInfo"]["name"] == "KYROX"
    client.send_json({"jsonrpc": "2.0", "method": "notifications/initialized"})


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
        json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "get_stock_info", "arguments": {"ticker": "tAAPL"}},
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

    stdout_lines: list[str] = []
    with _stdio_client(tmp_path) as client:
        for raw_line in requests_lines:
            client.send_raw(raw_line)
            message = json.loads(raw_line)
            if "id" in message:
                stdout_lines.append(client.read_line().strip())
        assert client.finish() == 0, client.stderr

    assert len(stdout_lines) == 8
    parsed_messages: dict[int, dict[str, Any]] = {}
    for line in stdout_lines:
        message = json.loads(line)
        assert message.get("jsonrpc") == "2.0"
        if "id" in message:
            parsed_messages[int(message["id"])] = message

    assert parsed_messages[1]["result"]["serverInfo"] == {"name": "KYROX", "version": "0.1.0"}
    listed_tools = {tool["name"] for tool in parsed_messages[2]["result"]["tools"]}
    assert {
        "hello_kyrox",
        "get_stock_info",
        "list_stocks",
        "get_wallet_balances",
        "get_portfolio",
        "prepare_transaction",
        "simulate_transaction",
    }.issubset(listed_tools)

    stock_payload = json.loads(parsed_messages[3]["result"]["content"][0]["text"])
    assert stock_payload["ticker"] == "tAAPL"
    assert stock_payload["reference_value"] == 230.0

    portfolio_error = json.loads(parsed_messages[4]["result"]["content"][0]["text"])
    assert "error" in portfolio_error
    assert "zero address" in portfolio_error["error"].lower()

    for message_id in (5, 6):
        tool_error = json.loads(parsed_messages[message_id]["result"]["content"][0]["text"])
        assert "error" in tool_error
        assert "not configured in the stock dataset" in tool_error["error"]
        assert tool_error["requires_human_approval"] is True

    for message_id in (7, 8):
        policy_error = json.loads(parsed_messages[message_id]["result"]["content"][0]["text"])
        assert "error" in policy_error
        assert "exceeds maximum allowed limit (50)" in policy_error["error"]
        assert policy_error["requires_human_approval"] is True
        assert policy_error["policy"]["allowed"] is False


def test_stdio_server_runs_from_external_working_directory(tmp_path: Path) -> None:
    """Verify server.py starts and serves packaged stock data when cwd is outside the repo root."""
    external_cwd = tmp_path / "external_workdir"
    external_cwd.mkdir(parents=True, exist_ok=True)

    with _stdio_client(tmp_path, cwd=external_cwd) as client:
        _initialize(client, "kyrox-external-cwd-test")
        client.send_json({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        tools_message = client.read_json()
        client.send_json(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "hello_kyrox", "arguments": {"name": "Developer"}},
            }
        )
        greeting_message = client.read_json()
        client.send_json(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {"name": "list_stocks", "arguments": {}},
            }
        )
        stocks_message = client.read_json()
        assert client.finish() == 0, client.stderr

    assert tools_message["result"]["tools"]
    assert len(tools_message["result"]["tools"]) == 7
    for tool_entry in tools_message["result"]["tools"]:
        assert tool_entry["inputSchema"]["type"] == "object"
    assert greeting_message["result"]["content"][0]["text"] == "Hello Developer, KYROX is live."
    stocks_content = stocks_message["result"]["content"]
    assert len(stocks_content) == 7
    assert json.loads(stocks_content[0]["text"])["ticker"] == "tAAPL"
    assert json.loads(stocks_content[0]["text"])["reference_value"] == 230.0


def test_stdio_rejects_malformed_requests_and_remains_usable(tmp_path: Path) -> None:
    protocol_notifications = [
        "{not valid json",
        "[]",
        json.dumps({"jsonrpc": "1.0", "id": 10, "method": "tools/list"}),
        json.dumps({"jsonrpc": "2.0", "id": 11}),
        json.dumps({"jsonrpc": "2.0", "id": 12, "method": 42}),
        json.dumps({"jsonrpc": "2.0", "id": 13, "method": "tools/list", "params": []}),
    ]
    malformed_tool_calls = [
        json.dumps({"jsonrpc": "2.0", "id": 20, "method": "tools/call", "params": {}}),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 21,
                "method": "tools/call",
                "params": {"name": "does_not_exist", "arguments": {}},
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 22,
                "method": "tools/call",
                "params": {"name": "get_stock_info", "arguments": []},
            }
        ),
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 23,
                "method": "tools/call",
                "params": {"name": "get_stock_info", "arguments": {}},
            }
        ),
    ]

    with _stdio_client(tmp_path) as client:
        _initialize(client, "kyrox-malformed-request-test")
        for raw in protocol_notifications:
            client.send_raw(raw)
            notification = client.read_json()
            assert notification["method"] == "notifications/message", notification
            assert notification["params"]["level"] == "error", notification

        client.send_raw(json.dumps({"jsonrpc": "2.0", "id": 14, "method": "does/not/exist"}))
        unknown_method = client.read_response(14)
        assert isinstance(unknown_method["error"]["code"], int)
        assert unknown_method["error"]["code"] < 0

        for index, raw in enumerate(malformed_tool_calls):
            client.send_raw(raw)
            response = client.read_response(20 + index)
            if "error" in response:
                assert isinstance(response["error"]["code"], int), response
            else:
                assert response["result"]["isError"] is True, response

        # Notifications have no response. A bounded read must fail quickly rather
        # than hanging the suite, and the server must still answer afterwards.
        client.send_json({"jsonrpc": "2.0", "method": "notifications/initialized"})
        with pytest.raises(AssertionError, match="Timed out"):
            client.read_json(timeout=0.05)
        client.send_json({"jsonrpc": "2.0", "id": 99, "method": "tools/list", "params": {}})
        assert client.read_json()["id"] == 99
        assert client.finish() == 0, client.stderr


def test_stdio_reader_drains_large_stderr_without_deadlocking(tmp_path: Path) -> None:
    script = (
        "import sys; "
        "sys.stderr.write(('diagnostic' + chr(10)) * 20000); "
        "sys.stderr.flush(); "
        "print('{\"ok\": true}'); "
        "sys.stdout.flush()"
    )
    with _stdio_client(
        tmp_path,
        command=[sys.executable, "-c", script],
    ) as client:
        assert json.loads(client.read_line(timeout=5)) == {"ok": True}
        assert client.finish(timeout=5) == 0
        assert len(client.stderr) > 200_000
