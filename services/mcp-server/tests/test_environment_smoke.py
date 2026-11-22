"""KYROX environment, packaging, configuration, and security hygiene smoke tests.

Verifies that:
1. Python interpreter meets the >=3.11 (3.13 preferred) 64-bit requirement.
2. MCP SDK is pinned to the v1 compatibility line (>=1.28,<2) and FastMCP imports cleanly.
3. Core playbook dependencies (web3, requests, python-dotenv, pytest) import cleanly.
4. .env.example contains only safe placeholders, documents actual KYROX runtime
   variables, excludes obsolete variables, and has no private-key or secret fields.
5. pyproject.toml, MANIFEST.in, requirements.txt, requirements-dev.txt, and
   requirements-lock.txt follow packaging and cross-platform dependency rules.
6. .gitignore protects .env, .venv/, logs/, build/dist artifacts, and key files.
7. Public README.md documents all 7 registered tools and contains no personal local paths.
"""

from __future__ import annotations

import importlib.metadata as metadata
import pathlib
import platform
import sys
import tomllib

from mcp.server.fastmcp import FastMCP
import dotenv
import pytest
import requests
import web3

import server
import tools


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


def test_env_example_documents_actual_variables_and_excludes_obsolete() -> None:
    env_example = PROJECT_ROOT / ".env.example"
    content = env_example.read_text(encoding="utf-8")
    assert "BASE_RPC_URL=https://sepolia.base.org" in content
    assert "BASE_STOCKS_API_URL" not in content, "Obsolete BASE_STOCKS_API_URL must not appear in .env.example"

    expected_documented_vars = (
        "BASE_RPC_URL",
        "BASE_RPC_TIMEOUT",
        "KYROX_STOCKS_FILE",
        "KYROX_MAX_TOKEN_AMOUNT",
        "KYROX_MAX_TX_AMOUNT",
        "KYROX_APPROVED_TICKERS",
        "KYROX_ALLOWED_RECIPIENTS",
        "KYROX_INTENT_TTL_SECONDS",
        "KYROX_LOG_DIR",
        "KYROX_LOG_FILE",
        "KYROX_LOG_MAX_BYTES",
        "KYROX_LOG_BACKUP_COUNT",
    )
    for var_name in expected_documented_vars:
        assert var_name in content, f"Expected runtime variable {var_name} documented in .env.example"


def test_pyproject_toml_metadata_and_entrypoints() -> None:
    pyproject_path = PROJECT_ROOT / "pyproject.toml"
    assert pyproject_path.is_file(), "pyproject.toml must exist"
    data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))

    project = data["project"]
    assert project["name"] == "kyrox-mcp"
    assert project["version"] == "0.1.0"
    assert server.__version__ == "0.1.0"
    assert tools.__version__ == "0.1.0"
    assert project["requires-python"] == ">=3.11"
    assert project["license"] == "Apache-2.0"

    deps = project["dependencies"]
    assert "mcp[cli]>=1.28,<2" in deps
    assert "web3>=8.0,<9" in deps
    assert "requests>=2.32,<3" in deps
    assert "python-dotenv>=1.0,<2" in deps
    assert not any("pytest" in d for d in deps), "pytest must be in dev extras, not runtime dependencies"
    assert not any("pywin32" in d for d in deps), "pywin32 must not be a mandatory cross-platform runtime dependency"

    dev_deps = project["optional-dependencies"]["dev"]
    assert any(d.startswith("pytest") for d in dev_deps)

    scripts = project["scripts"]
    assert scripts["kyrox-mcp"] == "server:main"

    setuptools_cfg = data["tool"]["setuptools"]
    assert "server" in setuptools_cfg["py-modules"]
    assert "tools" in setuptools_cfg["packages"]
    assert "data" in setuptools_cfg["packages"]
    assert "stocks.json" in setuptools_cfg["package-data"]["data"]


def test_requirements_files_separation_and_platform_markers() -> None:
    req_txt = (PROJECT_ROOT / "requirements.txt").read_text(encoding="utf-8")
    req_dev_txt = (PROJECT_ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
    req_lock_txt = (PROJECT_ROOT / "requirements-lock.txt").read_text(encoding="utf-8")
    manifest_in = (PROJECT_ROOT / "MANIFEST.in").read_text(encoding="utf-8")

    assert "mcp[cli]>=1.28,<2" in req_txt
    assert "web3>=8.0,<9" in req_txt
    assert "requests>=2.32,<3" in req_txt
    assert "python-dotenv>=1.0,<2" in req_txt
    assert "pytest" not in req_txt
    assert "pywin32" not in req_txt

    assert "-r requirements.txt" in req_dev_txt
    assert "pytest>=8.0,<10" in req_dev_txt

    assert 'pywin32==312 ; sys_platform == "win32"' in req_lock_txt

    assert "recursive-include data *.json" in manifest_in
    assert "recursive-include tools *.py" in manifest_in
    assert "prune planning" in manifest_in
    assert "prune docs" in manifest_in
    assert "prune logs" in manifest_in


def test_gitignore_protects_secrets_envs_logs_and_build_artifacts() -> None:
    gitignore = (PROJECT_ROOT / ".gitignore").read_text(encoding="utf-8")
    required_entries = (
        ".venv/",
        ".env",
        "!.env.example",
        "logs/",
        "build/",
        "dist/",
        "*.egg-info/",
        "planning/",
        "docs/",
        "AGENTS.md",
    )
    for entry in required_entries:
        assert entry in gitignore, f"Expected {entry!r} in .gitignore"


def test_readme_documents_all_seven_tools_and_no_private_paths() -> None:
    readme = (PROJECT_ROOT / "README.md").read_text(encoding="utf-8")
    expected_tools = (
        "hello_kyrox",
        "list_stocks",
        "get_stock_info",
        "get_wallet_balances",
        "get_portfolio",
        "prepare_transaction",
        "simulate_transaction",
    )
    for tool_name in expected_tools:
        assert tool_name in readme, f"Tool {tool_name} must be documented in README.md"

    assert "The Six MCP Tools" not in readme, "Stale 'Six MCP Tools' heading must not remain in README.md"
    assert "C:\\Users\\Lenovo" not in readme
    assert "D:\\Projects\\kyro-mcp" not in readme
