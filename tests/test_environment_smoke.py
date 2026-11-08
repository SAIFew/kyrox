"""KYROX environment and security hygiene smoke tests.

Verifies that:
1. Python interpreter meets the >=3.11 (3.13 preferred) 64-bit requirement.
2. MCP SDK is pinned to the v1 compatibility line (>=1.28,<2) and FastMCP imports cleanly.
3. Core playbook dependencies (web3, requests, python-dotenv, pytest) import cleanly.
4. .env.example contains only safe placeholders and no private-key or secret fields.
"""

from __future__ import annotations

import importlib.metadata as metadata
import pathlib
import platform
import sys

from mcp.server.fastmcp import FastMCP
import dotenv
import pytest
import requests
import web3


PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent


def test_python_version_and_architecture() -> None:
    assert sys.version_info >= (3, 11), f"Python 3.11+ required, got {sys.version}"
    arch_bits, _ = platform.architecture()
    assert arch_bits == "64bit", f"64-bit Python required, got {arch_bits}"


def test_mcp_sdk_v1_compatibility_line() -> None:
    mcp_version = metadata.version("mcp")
    major, minor, *_ = [int(part) for part in mcp_version.split(".")[:2]]
    assert major == 1 and minor >= 28, (
        f"Expected mcp>=1.28,<2 for v1 FastMCP compatibility, got {mcp_version}"
    )
    assert FastMCP is not None


def test_core_dependencies_importable() -> None:
    assert hasattr(web3, "Web3")
    assert hasattr(requests, "Session")
    assert hasattr(dotenv, "load_dotenv")
    assert hasattr(pytest, "main")


def test_env_example_contains_no_private_key_fields() -> None:
    env_example = PROJECT_ROOT / ".env.example"
    assert env_example.is_file(), ".env.example must exist"
    content = env_example.read_text(encoding="utf-8")
    forbidden_markers = ("PRIVATE_KEY", "SEED_PHRASE", "MNEMONIC", "PASSWORD", "SECRET_KEY")
    for marker in forbidden_markers:
        assert marker not in content.upper(), f"Forbidden secret marker {marker} in .env.example"
