"""Stock data loading, schema validation, caching, and ticker lookup helpers for KYROX."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import threading
from typing import Any

from tools.errors import (
    DataFileNotFoundError,
    DatasetCorruptedError,
    DatasetSchemaError,
    ErrorCode,
)

STOCKS_FILE: Path = Path(__file__).resolve().parent.parent / "data" / "stocks.json"
REQUIRED_STOCK_FIELDS: frozenset[str] = frozenset(
    {"ticker", "stock", "reference_value", "token_address"}
)

_CACHE_LOCK = threading.RLock()
_CACHE_KEY: tuple[str, int, int, bytes] | None = None
_CACHED_RECORDS: list[dict[str, Any]] | None = None
_CACHE_STATS: dict[str, int] = {"hits": 0, "misses": 0, "invalidations": 0}


def invalidate_stocks_cache() -> None:
    """Explicitly invalidate the in-memory stock dataset cache."""
    global _CACHE_KEY, _CACHED_RECORDS
    with _CACHE_LOCK:
        _CACHE_KEY = None
        _CACHED_RECORDS = None
        _CACHE_STATS["invalidations"] += 1


clear_stocks_cache = invalidate_stocks_cache


def get_stocks_cache_stats() -> dict[str, int]:
    """Return a snapshot of stock dataset cache hit/miss/invalidation counters."""
    with _CACHE_LOCK:
        return dict(_CACHE_STATS)


def _validate_stock_record(record: Any, index: int) -> dict[str, Any]:
    """Validate that a single parsed JSON entry matches the stock record schema."""
    if not isinstance(record, dict):
        raise DatasetSchemaError(
            f"Invalid stock record at index {index}: expected object, got {type(record).__name__}."
        )

    missing_fields = REQUIRED_STOCK_FIELDS - record.keys()
    if missing_fields:
        missing_list = ", ".join(sorted(missing_fields))
        raise DatasetSchemaError(
            f"Invalid stock record at index {index}: missing required field(s): {missing_list}."
        )

    ticker = record.get("ticker")
    if not isinstance(ticker, str) or not ticker.strip():
        raise DatasetSchemaError(
            f"Invalid stock record at index {index}: 'ticker' must be a non-empty string."
        )

    stock_name = record.get("stock")
    if not isinstance(stock_name, str) or not stock_name.strip():
        raise DatasetSchemaError(
            f"Invalid stock record at index {index}: 'stock' must be a non-empty string."
        )

    reference_value = record.get("reference_value")
    if isinstance(reference_value, bool) or not isinstance(reference_value, (int, float)):
        raise DatasetSchemaError(
            f"Invalid stock record at index {index}: 'reference_value' must be a number."
        )

    if not math.isfinite(reference_value):
        raise DatasetSchemaError(
            f"Invalid stock record at index {index}: 'reference_value' must be a finite number."
        )

    if reference_value <= 0:
        raise DatasetSchemaError(
            f"Invalid stock record at index {index}: 'reference_value' must be a positive number."
        )

    token_address = record.get("token_address")
    if not isinstance(token_address, str):
        raise DatasetSchemaError(
            f"Invalid stock record at index {index}: 'token_address' must be a string."
        )

    return dict(record)


def load_stocks(
    file_path: Path | str | None = None,
    *,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    """Load and validate stock records from the local JSON data file.

    Uses a thread-safe cache keyed by resolved path, file modification time,
    byte size, and SHA-256 content digest so on-disk updates or path changes
    automatically invalidate cached entries. Returns defensive copies so caller
    mutations never affect cached state.

    Args:
        file_path: Optional override path to the stocks JSON file. Defaults to
            ``data/stocks.json`` resolved relative to the repository root.
        use_cache: Whether to consult and populate the in-memory cache.

    Returns:
        A list of validated stock record dictionaries.

    Raises:
        DataFileNotFoundError (FileNotFoundError): If the stock data file does not exist.
        DatasetCorruptedError / DatasetSchemaError (ValueError): If the file contains
            malformed JSON, an invalid data structure, non-finite numbers, or duplicate tickers.
    """
    global _CACHE_KEY, _CACHED_RECORDS
    target_path = Path(file_path) if file_path is not None else STOCKS_FILE

    if not target_path.is_file():
        with _CACHE_LOCK:
            if _CACHE_KEY is not None and _CACHE_KEY[0] == str(target_path.resolve()):
                _CACHE_KEY = None
                _CACHED_RECORDS = None
        raise DataFileNotFoundError(f"Stock data file not found: {target_path}")

    resolved_str = str(target_path.resolve())
    stat_info = target_path.stat()
    raw_bytes = target_path.read_bytes()
    content_digest = hashlib.sha256(raw_bytes).digest()
    candidate_key = (
        resolved_str,
        stat_info.st_mtime_ns,
        stat_info.st_size,
        content_digest,
    )

    if use_cache:
        with _CACHE_LOCK:
            if _CACHE_KEY == candidate_key and _CACHED_RECORDS is not None:
                _CACHE_STATS["hits"] += 1
                return [dict(item) for item in _CACHED_RECORDS]

    try:
        raw_text = raw_bytes.decode("utf-8")
        parsed_data = json.loads(raw_text)
    except UnicodeDecodeError as exc:
        raise DatasetCorruptedError(
            f"Invalid UTF-8 encoding in stock data file {target_path}: {exc}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise DatasetCorruptedError(
            f"Invalid JSON in stock data file {target_path}: {exc.msg}"
        ) from exc

    if not isinstance(parsed_data, list):
        raise DatasetSchemaError(
            f"Invalid stock data structure in {target_path}: expected a JSON list, "
            f"got {type(parsed_data).__name__}."
        )

    seen_tickers: dict[str, int] = {}
    validated_records: list[dict[str, Any]] = []
    for idx, item in enumerate(parsed_data):
        validated = _validate_stock_record(item, idx)
        normalized_ticker = validated["ticker"].strip().lower()
        if normalized_ticker in seen_tickers:
            first_idx = seen_tickers[normalized_ticker]
            raise DatasetSchemaError(
                f"Invalid stock record at index {idx}: duplicate stock ticker "
                f"'{validated['ticker'].strip()}' (already defined at index {first_idx}).",
                code=ErrorCode.DUPLICATE_TICKER,
            )
        seen_tickers[normalized_ticker] = idx
        validated_records.append(validated)

    if use_cache:
        with _CACHE_LOCK:
            if _CACHE_KEY is not None and _CACHE_KEY != candidate_key:
                _CACHE_STATS["invalidations"] += 1
            _CACHE_KEY = candidate_key
            _CACHED_RECORDS = [dict(item) for item in validated_records]
            _CACHE_STATS["misses"] += 1

    return [dict(item) for item in validated_records]


def find_stock(ticker: str) -> dict[str, Any] | None:
    """Find a stock record by ticker using case-insensitive matching.

    Args:
        ticker: The stock ticker symbol to look up (e.g., ``"tAAPL"``).

    Returns:
        The matching stock record dictionary with its original stored values,
        or ``None`` if the input is blank or no matching ticker exists.
    """
    if not isinstance(ticker, str):
        return None

    normalized_ticker = ticker.strip()
    if not normalized_ticker:
        return None

    normalized_lower = normalized_ticker.lower()
    for record in load_stocks():
        if record["ticker"].strip().lower() == normalized_lower:
            return dict(record)

    return None
