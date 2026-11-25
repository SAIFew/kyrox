#!/usr/bin/env python3
"""Build and verify MCP archives in isolation without touching source-tree artifacts."""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
MCP_DIR = REPO_ROOT / "services" / "mcp-server"


def run(
    cmd: list[str],
    cwd: Path,
    env: dict[str, str] | None = None,
    *,
    timeout: float = 300,
) -> str:
    merged_env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}
    }
    merged_env["PYTHONDONTWRITEBYTECODE"] = "1"
    if env:
        merged_env.update(env)
    result = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=merged_env,
        text=True,
        capture_output=True,
        check=True,
        timeout=timeout,
    )
    return result.stdout


class BoundedStdio:
    """Interactive STDIO client with bounded reads and continuously drained stderr."""

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
            self.stop()
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

    def send(self, payload: dict[str, Any]) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        self.process.stdin.flush()

    def read_json(self, timeout: float = 10) -> dict[str, Any]:
        try:
            line = self._stdout.get(timeout=timeout)
        except queue.Empty as exc:
            raise AssertionError(
                f"Timed out after {timeout}s waiting for a JSON-RPC frame. stderr: {self.stderr}"
            ) from exc
        if line is None:
            raise AssertionError(f"MCP STDIO closed before a response. stderr: {self.stderr}")
        try:
            frame = json.loads(line)
        except json.JSONDecodeError as exc:
            raise AssertionError(f"Non-JSON data on MCP stdout: {line!r}") from exc
        if not isinstance(frame, dict):
            raise AssertionError(f"MCP stdout frame was not an object: {frame!r}")
        return frame

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
            raise AssertionError(f"MCP server did not exit within {timeout}s. stderr: {self.stderr}") from exc
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


def main() -> None:
    tmp_root = Path(tempfile.mkdtemp(prefix="kyrox-mcp-pkg-verify-"))
    client: BoundedStdio | None = None
    try:
        source_copy = tmp_root / "source"
        dist_dir = tmp_root / "dist"
        outside_dir = tmp_root / "outside"
        outside_dir.mkdir(parents=True, exist_ok=True)
        venv_dir = tmp_root / "isolated-venv"

        # setuptools writes build/, dist/, and egg-info into its working tree.
        # Build a disposable copy so pre-existing source artifacts are never
        # deleted or overwritten by this verifier.
        shutil.copytree(
            MCP_DIR,
            source_copy,
            ignore=shutil.ignore_patterns(
                "build",
                "dist",
                "*.egg-info",
                "__pycache__",
                ".pytest_cache",
                ".venv",
                "logs",
            ),
        )
        run([sys.executable, "-m", "build", "--outdir", str(dist_dir)], cwd=source_copy)

        wheel_path = next(dist_dir.glob("*.whl"))
        sdist_path = next(dist_dir.glob("*.tar.gz"))

        with zipfile.ZipFile(wheel_path) as archive:
            wheel_names = set(archive.namelist())
            assert "server.py" in wheel_names and "data/stocks.json" in wheel_names
            assert "kyrox_mcp-0.1.0.dist-info/entry_points.txt" in wheel_names
            assert not any("MockStock.sol" in name for name in wheel_names)

        with tarfile.open(sdist_path, "r:gz") as archive:
            sdist_names = set(archive.getnames())
            assert "kyrox_mcp-0.1.0/contracts/MockStock.sol" in sdist_names
            assert "kyrox_mcp-0.1.0/LICENSE" in sdist_names

        run([sys.executable, "-m", "venv", str(venv_dir)], cwd=outside_dir)
        venv_pip = venv_dir / "bin" / "pip"
        venv_python = venv_dir / "bin" / "python"
        venv_executable = venv_dir / "bin" / "kyrox-mcp"

        run([str(venv_pip), "install", str(wheel_path)], cwd=outside_dir)
        run([str(venv_pip), "check"], cwd=outside_dir)

        installed = run(
            [
                str(venv_python),
                "-c",
                "import server, tools; print(server.__file__, tools.__file__)",
            ],
            cwd=outside_dir,
        ).strip()
        assert str(venv_dir) in installed

        env = {
            key: value
            for key, value in os.environ.items()
            if key not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}
        }
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["KYROX_LOG_DIR"] = str(tmp_root / "stdio-logs")
        client = BoundedStdio([str(venv_executable)], outside_dir, env)
        try:
            client.send(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "ci-verify", "version": "1.0.0"},
                    },
                }
            )
            init_frame = client.read_json()
            assert init_frame["result"]["serverInfo"]["name"] == "KYROX"

            client.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
            client.send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
            tools_frame = client.read_json()
            assert len(tools_frame["result"]["tools"]) == 7
            assert client.finish() == 0, client.stderr
        finally:
            client.stop()

        print(
            f"Verified wheel ({wheel_path.name}), sdist ({sdist_path.name}), "
            "isolated pip install, and bounded STDIO handshake."
        )
    finally:
        if client is not None:
            client.stop()
        shutil.rmtree(tmp_root, ignore_errors=True)


if __name__ == "__main__":
    main()
