#!/usr/bin/env python3
"""Build wheel and sdist for services/mcp-server, verify archives, and test isolated installation."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MCP_DIR = REPO_ROOT / "services" / "mcp-server"


def run(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> str:
    merged_env = {k: v for k, v in os.environ.items() if k not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}}
    merged_env["PYTHONDONTWRITEBYTECODE"] = "1"
    if env:
        merged_env.update(env)
    res = subprocess.run(cmd, cwd=str(cwd), env=merged_env, text=True, capture_output=True, check=True)
    return res.stdout


def main() -> None:
    tmp_root = Path(tempfile.mkdtemp(prefix="kyrox-mcp-pkg-verify-"))
    try:
        dist_dir = tmp_root / "dist"
        outside_dir = tmp_root / "outside"
        outside_dir.mkdir(parents=True, exist_ok=True)
        venv_dir = tmp_root / "isolated-venv"

        run([sys.executable, "-m", "build", "--outdir", str(dist_dir)], cwd=MCP_DIR)
        for d in ["build", "dist", "kyrox_mcp.egg-info", ".pytest_cache"]:
            p = MCP_DIR / d
            if p.exists():
                shutil.rmtree(p)
        for pyc in MCP_DIR.rglob("__pycache__"):
            shutil.rmtree(pyc)

        wheel_path = next(dist_dir.glob("*.whl"))
        sdist_path = next(dist_dir.glob("*.tar.gz"))

        with zipfile.ZipFile(wheel_path) as zf:
            w_names = set(zf.namelist())
            assert "server.py" in w_names and "data/stocks.json" in w_names
            assert "kyrox_mcp-0.1.0.dist-info/entry_points.txt" in w_names
            assert not any("MockStock.sol" in n for n in w_names)

        with tarfile.open(sdist_path, "r:gz") as tf:
            s_names = set(tf.getnames())
            assert "kyrox_mcp-0.1.0/contracts/MockStock.sol" in s_names
            assert "kyrox_mcp-0.1.0/LICENSE" in s_names

        run([sys.executable, "-m", "venv", str(venv_dir)], cwd=outside_dir)
        v_pip = venv_dir / "bin" / "pip"
        v_py = venv_dir / "bin" / "python"
        v_exe = venv_dir / "bin" / "kyrox-mcp"

        run([str(v_pip), "install", str(wheel_path)], cwd=outside_dir)
        run([str(v_pip), "check"], cwd=outside_dir)

        loc = run(
            [str(v_py), "-c", "import server, tools; print(server.__file__, tools.__file__)"],
            cwd=outside_dir,
        ).strip()
        assert str(venv_dir) in loc

        env = {k: v for k, v in os.environ.items() if k not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}}
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        proc = subprocess.Popen(
            [str(v_exe)],
            cwd=str(outside_dir),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        assert proc.stdin and proc.stdout
        proc.stdin.write(
            json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "ci-verify", "version": "1.0.0"},
                },
            }) + "\n"
        )
        proc.stdin.flush()
        init_frame = json.loads(proc.stdout.readline())
        assert init_frame["result"]["serverInfo"]["name"] == "KYROX"

        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}) + "\n")
        proc.stdin.flush()
        tools_frame = json.loads(proc.stdout.readline())
        assert len(tools_frame["result"]["tools"]) == 7

        proc.stdin.close()
        assert proc.wait(timeout=10) == 0
        print(f"Verified wheel ({wheel_path.name}), sdist ({sdist_path.name}), isolated pip install, and STDIO handshake.")
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


if __name__ == "__main__":
    main()
