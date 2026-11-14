"""Shared pytest fixtures for the KYROX automated test suite."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
import pytest

from tools.log import reset_audit_logger
from tools.stocks import invalidate_stocks_cache


@pytest.fixture(autouse=True)
def _isolate_audit_logs_and_cache(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[None]:
    """Direct audit logs to an isolated temporary directory per test and reset caches."""
    test_log_dir = tmp_path / "kyrox_audit_logs"
    monkeypatch.setenv("KYROX_LOG_DIR", str(test_log_dir))
    reset_audit_logger()
    invalidate_stocks_cache()
    yield
    reset_audit_logger()
    invalidate_stocks_cache()

