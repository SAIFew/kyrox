"""Structured, redacted JSONL audit logging for KYROX MCP tools and services.

Features:
- ISO-8601 UTC timestamps (``YYYY-MM-DDTHH:MM:SS.ffffffZ``).
- Recursive sensitive-data redaction across arguments, context, and errors.
- Thread-safe concurrent writes with deterministic size-based log rotation.
- Automatic log-directory creation and recovery on missing directories.
- Clean MCP ``stdio`` separation (never writes to ``stdout``; fallback to ``stderr``).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
import functools
import inspect
import json
import os
from pathlib import Path
import sys
import threading
import time
from typing import Any, TypeVar

from tools.errors import (
    REDACTED_PLACEHOLDER,
    ErrorClassification,
    ErrorCode,
    classify_error_message,
    classify_exception,
    is_sensitive_key,
    redact_sensitive_data,
    redact_text,
)

PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent
DEFAULT_LOG_DIR: Path = PROJECT_ROOT / "logs"
DEFAULT_LOG_FILENAME: str = "audit.jsonl"
DEFAULT_MAX_BYTES: int = 5 * 1024 * 1024  # 5 MiB
DEFAULT_BACKUP_COUNT: int = 5

F = TypeVar("F", bound=Callable[..., Any])

_LOGGER_LOCK = threading.RLock()
_ACTIVE_LOGGER: AuditLogger | None = None
_ACTIVE_CONFIG_KEY: tuple[str, str, int, int] | None = None
_LAST_ENV_SIGNATURE: tuple[str, str, str, str] | None = None


def _current_env_signature() -> tuple[str, str, str, str]:
    """Capture a snapshot of the KYROX_LOG_* environment variables."""
    return (
        os.getenv("KYROX_LOG_DIR", "").strip(),
        os.getenv("KYROX_LOG_FILE", "").strip(),
        os.getenv("KYROX_LOG_MAX_BYTES", "").strip(),
        os.getenv("KYROX_LOG_BACKUP_COUNT", "").strip(),
    )


def utc_now_iso() -> str:
    """Return the current UTC timestamp in ISO-8601 format with a ``Z`` suffix."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _resolve_env_log_config(
    log_dir: Path | str | None = None,
    filename: str | None = None,
    max_bytes: int | None = None,
    backup_count: int | None = None,
) -> tuple[Path, str, int, int]:
    """Resolve logger configuration from explicit arguments or environment variables."""
    if log_dir is not None:
        resolved_dir = Path(log_dir)
    else:
        env_dir = os.getenv("KYROX_LOG_DIR", "").strip()
        resolved_dir = Path(env_dir) if env_dir else DEFAULT_LOG_DIR

    resolved_filename = (
        filename.strip()
        if isinstance(filename, str) and filename.strip()
        else os.getenv("KYROX_LOG_FILE", "").strip() or DEFAULT_LOG_FILENAME
    )

    if max_bytes is not None:
        resolved_max_bytes = max(0, int(max_bytes))
    else:
        env_max = os.getenv("KYROX_LOG_MAX_BYTES", "").strip()
        try:
            resolved_max_bytes = max(0, int(env_max)) if env_max else DEFAULT_MAX_BYTES
        except ValueError:
            resolved_max_bytes = DEFAULT_MAX_BYTES

    if backup_count is not None:
        resolved_backups = max(0, int(backup_count))
    else:
        env_backups = os.getenv("KYROX_LOG_BACKUP_COUNT", "").strip()
        try:
            resolved_backups = (
                max(0, int(env_backups)) if env_backups else DEFAULT_BACKUP_COUNT
            )
        except ValueError:
            resolved_backups = DEFAULT_BACKUP_COUNT

    return resolved_dir, resolved_filename, resolved_max_bytes, resolved_backups


class AuditLogger:
    """Thread-safe structured JSONL audit logger with rotation and secret redaction."""

    def __init__(
        self,
        log_dir: Path | str | None = None,
        *,
        filename: str = DEFAULT_LOG_FILENAME,
        max_bytes: int = DEFAULT_MAX_BYTES,
        backup_count: int = DEFAULT_BACKUP_COUNT,
    ) -> None:
        resolved_dir, resolved_name, resolved_max, resolved_backups = (
            _resolve_env_log_config(
                log_dir=log_dir,
                filename=filename,
                max_bytes=max_bytes,
                backup_count=backup_count,
            )
        )
        self._lock = _LOGGER_LOCK
        self._log_dir: Path = resolved_dir
        self._filename: str = resolved_name
        self._max_bytes: int = resolved_max
        self._backup_count: int = resolved_backups
        self._ensure_log_dir()

    @property
    def log_dir(self) -> Path:
        """Directory where JSONL audit logs are stored."""
        return self._log_dir

    @property
    def log_file(self) -> Path:
        """Active JSONL audit log file path."""
        return self._log_dir / self._filename

    @property
    def max_bytes(self) -> int:
        """Maximum size in bytes before the active log file is rotated."""
        return self._max_bytes

    @property
    def backup_count(self) -> int:
        """Number of rotated backup log files retained."""
        return self._backup_count

    def _ensure_log_dir(self) -> None:
        """Ensure the target log directory exists on disk."""
        try:
            self._log_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            sys.stderr.write(
                f"[KYROX-AUDIT-WARN] Unable to create log directory "
                f"{redact_text(str(self._log_dir))}: {redact_text(str(exc))}\n"
            )

    def _rotate_if_needed(self, incoming_byte_length: int) -> None:
        """Rotate ``audit.jsonl`` to ``audit.jsonl.1``..``audit.jsonl.N`` when full."""
        if self._max_bytes <= 0:
            return

        target = self.log_file
        try:
            if not target.is_file():
                return
            current_size = target.stat().st_size
        except OSError:
            return

        if current_size == 0 or (current_size + incoming_byte_length) <= self._max_bytes:
            return

        if self._backup_count <= 0:
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
            return

        oldest = Path(f"{target}.{self._backup_count}")
        try:
            if oldest.exists():
                oldest.unlink()
        except OSError:
            pass

        for idx in range(self._backup_count - 1, 0, -1):
            src = Path(f"{target}.{idx}")
            dst = Path(f"{target}.{idx + 1}")
            try:
                if src.exists():
                    os.replace(src, dst)
            except OSError:
                pass

        first_backup = Path(f"{target}.1")
        try:
            if target.exists():
                os.replace(target, first_backup)
        except OSError:
            pass

    def log_event(
        self,
        *,
        tool: str,
        status: str,
        args: Mapping[str, Any] | None = None,
        duration_ms: float | None = None,
        error_code: ErrorCode | str | None = None,
        error_category: str | None = None,
        retryable: bool = False,
        error_message: str | None = None,
        context: Mapping[str, Any] | None = None,
        event: str = "tool_call",
        level: str | None = None,
    ) -> dict[str, Any]:
        """Write a single redacted JSONL audit entry and return the recorded dict."""
        normalized_status = "ok" if status == "ok" else "error"
        resolved_code: str | None
        if isinstance(error_code, ErrorCode):
            resolved_code = error_code.value
        elif isinstance(error_code, str) and error_code.strip():
            resolved_code = error_code.strip()
        else:
            resolved_code = None

        if level is not None:
            resolved_level = level.upper()
        elif normalized_status == "ok":
            resolved_level = "INFO"
        elif resolved_code in (
            ErrorCode.INTERNAL_ERROR.value,
            ErrorCode.STOCK_DATA_MISSING.value,
            ErrorCode.STOCK_DATA_CORRUPTED.value,
            ErrorCode.STOCK_SCHEMA_INVALID.value,
            ErrorCode.DUPLICATE_TICKER.value,
        ):
            resolved_level = "ERROR"
        else:
            resolved_level = "WARNING"

        entry: dict[str, Any] = {
            "timestamp": utc_now_iso(),
            "level": resolved_level,
            "event": redact_text(str(event)),
            "tool": redact_text(str(tool)),
            "status": normalized_status,
            "duration_ms": round(max(0.0, float(duration_ms or 0.0)), 3),
            "args": redact_sensitive_data(dict(args) if args else {}),
            "error_code": resolved_code,
            "error_category": redact_text(error_category) if error_category else None,
            "retryable": bool(retryable) if normalized_status == "error" else False,
            "error_message": (
                redact_text(str(error_message))
                if error_message is not None
                else None
            ),
            "context": redact_sensitive_data(dict(context) if context else {}),
        }

        serialized_line = json.dumps(entry, ensure_ascii=False) + "\n"
        encoded_line = serialized_line.encode("utf-8")

        with self._lock:
            self._ensure_log_dir()
            self._rotate_if_needed(len(encoded_line))
            try:
                with self.log_file.open("ab") as fh:
                    fh.write(encoded_line)
                    fh.flush()
            except OSError as exc:
                sys.stderr.write(
                    f"[KYROX-AUDIT-FALLBACK] {redact_text(str(exc))} | "
                    f"{serialized_line}"
                )

        return entry


def configure_audit_logger(
    log_dir: Path | str | None = None,
    *,
    filename: str | None = None,
    max_bytes: int | None = None,
    backup_count: int | None = None,
) -> AuditLogger:
    """Configure or update the process-wide singleton ``AuditLogger`` idempotently."""
    global _ACTIVE_LOGGER, _ACTIVE_CONFIG_KEY, _LAST_ENV_SIGNATURE
    resolved_dir, resolved_name, resolved_max, resolved_backups = (
        _resolve_env_log_config(
            log_dir=log_dir,
            filename=filename,
            max_bytes=max_bytes,
            backup_count=backup_count,
        )
    )
    config_key = (
        str(resolved_dir.resolve()),
        resolved_name,
        resolved_max,
        resolved_backups,
    )
    with _LOGGER_LOCK:
        if _ACTIVE_LOGGER is not None and _ACTIVE_CONFIG_KEY == config_key:
            _ACTIVE_LOGGER._ensure_log_dir()
            _LAST_ENV_SIGNATURE = _current_env_signature()
            return _ACTIVE_LOGGER

        _ACTIVE_LOGGER = AuditLogger(
            log_dir=resolved_dir,
            filename=resolved_name,
            max_bytes=resolved_max,
            backup_count=resolved_backups,
        )
        _ACTIVE_CONFIG_KEY = config_key
        _LAST_ENV_SIGNATURE = _current_env_signature()
        return _ACTIVE_LOGGER


def get_audit_logger() -> AuditLogger:
    """Return the active ``AuditLogger``, re-syncing if environment settings changed."""
    with _LOGGER_LOCK:
        if (
            _ACTIVE_LOGGER is not None
            and _LAST_ENV_SIGNATURE == _current_env_signature()
        ):
            _ACTIVE_LOGGER._ensure_log_dir()
            return _ACTIVE_LOGGER
        return configure_audit_logger()


def reset_audit_logger() -> None:
    """Reset the cached logger singleton so the next call re-reads environment settings."""
    global _ACTIVE_LOGGER, _ACTIVE_CONFIG_KEY, _LAST_ENV_SIGNATURE
    with _LOGGER_LOCK:
        _ACTIVE_LOGGER = None
        _ACTIVE_CONFIG_KEY = None
        _LAST_ENV_SIGNATURE = None


def _summarize_result(result: Any) -> dict[str, Any]:
    """Build a compact, non-sensitive summary of a successful tool return value."""
    if isinstance(result, dict):
        summary: dict[str, Any] = {"result_type": "dict"}
        if "ticker" in result:
            summary["ticker"] = result["ticker"]
        if "wallet" in result:
            summary["wallet"] = result["wallet"]
        if "chain" in result:
            summary["chain"] = result["chain"]
        if isinstance(result.get("balances"), list):
            summary["balance_count"] = len(result["balances"])
        return summary

    if isinstance(result, list):
        return {"result_type": "list", "item_count": len(result)}

    if isinstance(result, str):
        return {"result_type": "str", "length": len(result)}

    return {"result_type": type(result).__name__}


def _bind_call_arguments(
    func: Callable[..., Any],
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> dict[str, Any]:
    """Bind positional and keyword arguments to parameter names for structured logging."""
    try:
        sig = inspect.signature(func)
        bound = sig.bind_partial(*args, **kwargs)
        return dict(bound.arguments)
    except Exception:
        fallback: dict[str, Any] = {}
        if args:
            fallback["positional_args"] = list(args)
        if kwargs:
            fallback.update(kwargs)
        return fallback


def audit_tool_call(
    tool_name: str | None = None,
    *,
    reraise_exceptions: tuple[type[BaseException], ...] = (),
) -> Callable[[F], F]:
    """Decorator that wraps a KYROX tool with structured JSONL audit logging and error handling."""

    def decorator(func: F) -> F:
        resolved_tool_name = tool_name or func.__name__

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            bound_args = _bind_call_arguments(func, args, kwargs)
            logger = get_audit_logger()

            try:
                result = func(*args, **kwargs)
            except BaseException as exc:
                duration_ms = (time.perf_counter() - start) * 1000.0
                if isinstance(exc, Exception):
                    classification: ErrorClassification = classify_exception(
                        exc, tool_name=resolved_tool_name
                    )
                    logger.log_event(
                        tool=resolved_tool_name,
                        status="error",
                        args=bound_args,
                        duration_ms=duration_ms,
                        error_code=classification.code,
                        error_category=classification.category,
                        retryable=classification.retryable,
                        error_message=classification.message,
                        context={"exception_type": type(exc).__name__},
                    )
                    if reraise_exceptions and isinstance(exc, reraise_exceptions):
                        raise
                    return classification.to_response()
                raise

            duration_ms = (time.perf_counter() - start) * 1000.0
            if isinstance(result, dict) and "error" in result:
                raw_error = str(result.get("error", ""))
                classification = classify_error_message(raw_error)
                safe_result = dict(result)
                safe_result["error"] = classification.message
                logger.log_event(
                    tool=resolved_tool_name,
                    status="error",
                    args=bound_args,
                    duration_ms=duration_ms,
                    error_code=classification.code,
                    error_category=classification.category,
                    retryable=classification.retryable,
                    error_message=classification.message,
                    context={"response_type": "error_dict"},
                )
                return safe_result

            logger.log_event(
                tool=resolved_tool_name,
                status="ok",
                args=bound_args,
                duration_ms=duration_ms,
                context=_summarize_result(result),
            )
            return result

        return wrapper  # type: ignore[return-value]

    return decorator


__all__ = [
    "AuditLogger",
    "DEFAULT_BACKUP_COUNT",
    "DEFAULT_LOG_DIR",
    "DEFAULT_LOG_FILENAME",
    "DEFAULT_MAX_BYTES",
    "REDACTED_PLACEHOLDER",
    "audit_tool_call",
    "configure_audit_logger",
    "get_audit_logger",
    "is_sensitive_key",
    "redact_sensitive_data",
    "redact_text",
    "reset_audit_logger",
    "utc_now_iso",
]
