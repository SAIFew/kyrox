"""Stock data loading and ticker lookup helpers for KYROX."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

STOCKS_FILE: Path = Path(__file__).resolve().parent.parent / "data" / "stocks.json"
REQUIRED_STOCK_FIELDS: frozenset[str] = frozenset(
    {"ticker", "stock", "reference_value", "token_address"}
)


def _validate_stock_record(record: Any, index: int) -> dict[str, Any]:
    """Validate that a single parsed JSON entry matches the stock record schema."""
    if not isinstance(record, dict):
        raise ValueError(
            f"Invalid stock record at index {index}: expected object, got {type(record).__name__}."
        )

    missing_fields = REQUIRED_STOCK_FIELDS - record.keys()
    if missing_fields:
        missing_list = ", ".join(sorted(missing_fields))
        raise ValueError(
            f"Invalid stock record at index {index}: missing required field(s): {missing_list}."
        )

    ticker = record.get("ticker")
    if not isinstance(ticker, str) or not ticker.strip():
        raise ValueError(
            f"Invalid stock record at index {index}: 'ticker' must be a non-empty string."
        )

    stock_name = record.get("stock")
    if not isinstance(stock_name, str) or not stock_name.strip():
        raise ValueError(
            f"Invalid stock record at index {index}: 'stock' must be a non-empty string."
        )

    reference_value = record.get("reference_value")
    if isinstance(reference_value, bool) or not isinstance(reference_value, (int, float)):
        raise ValueError(
            f"Invalid stock record at index {index}: 'reference_value' must be a number."
        )

    token_address = record.get("token_address")
    if not isinstance(token_address, str):
        raise ValueError(
            f"Invalid stock record at index {index}: 'token_address' must be a string."
        )

    return dict(record)


def load_stocks(file_path: Path | str | None = None) -> list[dict[str, Any]]:
    """Load and validate stock records from the local JSON data file.

    Args:
        file_path: Optional override path to the stocks JSON file. Defaults to
            ``data/stocks.json`` resolved relative to the repository root.

    Returns:
        A list of validated stock record dictionaries.

    Raises:
        FileNotFoundError: If the stock data file does not exist.
        ValueError: If the file contains malformed JSON or an invalid data structure.
    """
    target_path = Path(file_path) if file_path is not None else STOCKS_FILE

    if not target_path.is_file():
        raise FileNotFoundError(f"Stock data file not found: {target_path}")

    try:
        raw_text = target_path.read_text(encoding="utf-8")
        parsed_data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Invalid JSON in stock data file {target_path}: {exc.msg}"
        ) from exc

    if not isinstance(parsed_data, list):
        raise ValueError(
            f"Invalid stock data structure in {target_path}: expected a JSON list, "
            f"got {type(parsed_data).__name__}."
        )

    return [_validate_stock_record(item, idx) for idx, item in enumerate(parsed_data)]


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

