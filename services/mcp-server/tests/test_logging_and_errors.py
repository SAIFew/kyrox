"""Comprehensive unit and integration tests for KYROX structured logging,
recursive secret redaction, centralized error classification, and concurrency.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
import json
from pathlib import Path
import shutil
from typing import Any
from unittest.mock import MagicMock

import pytest
from web3 import Web3

import server
from tools.errors import (
    REDACTED_PLACEHOLDER,
    AddressValidationError,
    ChainIdMismatchError,
    ConfigurationError,
    ContractCallError,
    DataFileNotFoundError,
    DatasetCorruptedError,
    DatasetSchemaError,
    DecimalPrecisionError,
    EmptyInputError,
    ErrorCode,
    PolicyViolationError,
    RpcConnectionError,
    RpcTimeoutError,
    TickerNotFoundError,
    ValidationError,
    classify_error_message,
    classify_exception,
    is_sensitive_key,
    redact_sensitive_data,
    redact_text,
    validate_token_amount,
)
from tools.log import (
    AuditLogger,
    audit_tool_call,
    configure_audit_logger,
    get_audit_logger,
    reset_audit_logger,
)
import tools.stocks as stocks_module
import tools.wallet as wallet_module

SAMPLE_RAW_PRIVATE_KEY = (
    "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"
)
SAMPLE_BARE_PRIVATE_KEY = (
    "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"
)
SAMPLE_SEED_PHRASE = (
    "abandon ability able about above absent absorb abstract absurd abuse access accident"
)
SAMPLE_PEM_KEY = (
    "-----BEGIN EC PRIVATE KEY-----\n"
    "MHcCAQEEIIG3fakeprivatekeymaterialforunitredactiontest==\n"
    "-----END EC PRIVATE KEY-----"
)
SAMPLE_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IktZUk9YIn0."
    "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
)
SAMPLE_PUBLIC_WALLET = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"
SAMPLE_PUBLIC_TOKEN = "0x1111111111111111111111111111111111111111"


def _read_jsonl_entries(log_file: Path) -> list[dict[str, Any]]:
    """Read and parse all JSONL lines from ``log_file``."""
    assert log_file.is_file(), f"Expected audit log file at {log_file}"
    lines = [
        line.strip()
        for line in log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    return [json.loads(line) for line in lines]


# ---------------------------------------------------------------------------
# 1. Structured JSONL Audit Logging on Successful & Error Operations
# ---------------------------------------------------------------------------


def test_successful_tool_operations_write_valid_jsonl_audit_logs() -> None:
    logger = get_audit_logger()

    greeting = server.hello_kyrox("Saif")
    assert greeting == "Hello Saif, KYROX is live."

    stock = server.get_stock_info("tAAPL")
    assert stock["ticker"] == "tAAPL"

    stocks = server.list_stocks()
    assert len(stocks) == 3

    entries = _read_jsonl_entries(logger.log_file)
    assert len(entries) == 3

    expected_tools = ["hello_kyrox", "get_stock_info", "list_stocks"]
    for entry, expected_tool in zip(entries, expected_tools, strict=True):
        assert entry["tool"] == expected_tool
        assert entry["status"] == "ok"
        assert entry["level"] == "INFO"
        assert entry["event"] == "tool_call"
        assert entry["error_code"] is None
        assert entry["error_category"] is None
        assert entry["retryable"] is False
        assert entry["error_message"] is None
        assert isinstance(entry["duration_ms"], float)
        assert entry["duration_ms"] >= 0.0
        # Verify ISO-8601 UTC timestamp with Z suffix
        ts = entry["timestamp"]
        assert isinstance(ts, str) and ts.endswith("Z")
        parsed_ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        assert parsed_ts.tzinfo is not None


def test_expected_tool_errors_record_error_codes_and_retryability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = get_audit_logger()

    # 1. Empty ticker -> EMPTY_INPUT (non-retryable)
    res_empty = server.get_stock_info("   ")
    assert res_empty == {"error": "Ticker must not be empty."}

    # 2. Unknown ticker -> TICKER_NOT_FOUND (non-retryable)
    res_unknown = server.get_stock_info("UNKNOWN")
    assert res_unknown == {"error": "Ticker UNKNOWN not found."}

    # 3. Zero wallet address -> ZERO_ADDRESS_NOT_ALLOWED (non-retryable)
    res_zero = server.get_wallet_balances(
        "0x0000000000000000000000000000000000000000"
    )
    assert "zero address" in res_zero["error"]

    # 4. RPC timeout -> RPC_TIMEOUT (retryable)
    w3_timeout = MagicMock()
    w3_timeout.is_connected.side_effect = TimeoutError("RPC connection timed out")
    monkeypatch.setattr(wallet_module, "get_web3", lambda: w3_timeout)
    monkeypatch.setattr(
        wallet_module,
        "load_stocks",
        lambda: [
            {
                "ticker": "tAAPL",
                "stock": "Test Apple",
                "reference_value": 230.0,
                "token_address": SAMPLE_PUBLIC_TOKEN,
            }
        ],
    )
    res_timeout = server.get_wallet_balances(SAMPLE_PUBLIC_WALLET)
    assert "Unable to connect to Base Sepolia RPC provider" in res_timeout["error"]

    entries = _read_jsonl_entries(logger.log_file)
    assert len(entries) == 4

    assert entries[0]["error_code"] == ErrorCode.EMPTY_INPUT.value
    assert entries[0]["retryable"] is False

    assert entries[1]["error_code"] == ErrorCode.TICKER_NOT_FOUND.value
    assert entries[1]["retryable"] is False

    assert entries[2]["error_code"] == ErrorCode.ZERO_ADDRESS_NOT_ALLOWED.value
    assert entries[2]["retryable"] is False

    assert entries[3]["error_code"] == ErrorCode.RPC_TIMEOUT.value
    assert entries[3]["retryable"] is True


def test_unexpected_internal_exception_does_not_leak_stack_trace_or_secrets() -> None:
    logger = get_audit_logger()

    @audit_tool_call("simulated_internal_tool")
    def _failing_tool(wallet: str) -> dict[str, Any]:
        raise RuntimeError(
            f"Database crash with url https://admin:topsecret@db.internal:5432 "
            f"and key {SAMPLE_RAW_PRIVATE_KEY}"
        )

    response = _failing_tool(SAMPLE_PUBLIC_WALLET)
    assert "error" in response
    assert "Traceback" not in response["error"]
    assert "topsecret" not in response["error"]
    assert SAMPLE_RAW_PRIVATE_KEY not in response["error"]
    assert REDACTED_PLACEHOLDER in response["error"]

    entries = _read_jsonl_entries(logger.log_file)
    assert len(entries) == 1
    entry = entries[0]
    assert entry["tool"] == "simulated_internal_tool"
    assert entry["status"] == "error"
    assert entry["level"] == "ERROR"
    assert entry["error_code"] == ErrorCode.INTERNAL_ERROR.value
    assert entry["retryable"] is False
    assert entry["context"]["exception_type"] == "RuntimeError"
    assert "topsecret" not in json.dumps(entry)
    assert SAMPLE_RAW_PRIVATE_KEY not in json.dumps(entry)


def test_hello_kyrox_rejects_empty_name_and_logs_error() -> None:
    logger = get_audit_logger()
    with pytest.raises(ValueError, match="must not be empty"):
        server.hello_kyrox("   ")

    entries = _read_jsonl_entries(logger.log_file)
    assert len(entries) == 1
    assert entries[0]["tool"] == "hello_kyrox"
    assert entries[0]["status"] == "error"
    assert entries[0]["error_code"] == ErrorCode.EMPTY_INPUT.value


# ---------------------------------------------------------------------------
# 2. Recursive Sensitive-Data Redaction Tests
# ---------------------------------------------------------------------------


def test_recursive_redaction_across_nested_structures_and_types() -> None:
    payload: dict[str, Any] = {
        "wallet": SAMPLE_PUBLIC_WALLET,
        "token_address": SAMPLE_PUBLIC_TOKEN,
        "ticker": "tAAPL",
        "private_key": SAMPLE_RAW_PRIVATE_KEY,
        "nested_credentials": {
            "seed_phrase": SAMPLE_SEED_PHRASE,
            "mnemonic": "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
            "keystore_password": "super-secret-password-123",
            "api_key": "sk-proj-1234567890abcdefghijklmnop",
            "auth_token": "Bearer secret_oauth_token_value_999",
            "jwt": SAMPLE_JWT,
            "pem": SAMPLE_PEM_KEY,
            "deep_list": [
                {
                    "rpc_credentials": "https://user:pass123@sepolia.base.org",
                    "rpc_url": "https://base-sepolia.g.alchemy.com/v2/alcht_998877665544332211secret?api_key=q_secret_123",
                    "inline_note": f"leaked bare key {SAMPLE_BARE_PRIVATE_KEY} and seed={SAMPLE_SEED_PHRASE}",
                },
                ("tuple_secret_check", f"Authorization: Bearer {SAMPLE_JWT}"),
            ],
        },
    }

    redacted = redact_sensitive_data(payload)

    # Safe public blockchain fields must remain intact
    assert redacted["wallet"] == SAMPLE_PUBLIC_WALLET
    assert redacted["token_address"] == SAMPLE_PUBLIC_TOKEN
    assert redacted["ticker"] == "tAAPL"

    # Sensitive keys must be completely replaced with [REDACTED]
    assert redacted["private_key"] == REDACTED_PLACEHOLDER
    nested = redacted["nested_credentials"]
    assert nested["seed_phrase"] == REDACTED_PLACEHOLDER
    assert nested["mnemonic"] == REDACTED_PLACEHOLDER
    assert nested["keystore_password"] == REDACTED_PLACEHOLDER
    assert nested["api_key"] == REDACTED_PLACEHOLDER
    assert nested["auth_token"] == REDACTED_PLACEHOLDER
    assert nested["jwt"] == REDACTED_PLACEHOLDER
    assert nested["pem"] == REDACTED_PLACEHOLDER

    # Deep list and tuple values must be recursively scrubbed
    deep_dict = nested["deep_list"][0]
    assert deep_dict["rpc_credentials"] == REDACTED_PLACEHOLDER
    assert "alcht_998877665544332211secret" not in deep_dict["rpc_url"]
    assert "q_secret_123" not in deep_dict["rpc_url"]
    assert REDACTED_PLACEHOLDER in deep_dict["rpc_url"]
    assert SAMPLE_BARE_PRIVATE_KEY not in deep_dict["inline_note"]
    assert "abandon ability" not in deep_dict["inline_note"]

    deep_tuple = nested["deep_list"][1]
    assert isinstance(deep_tuple, tuple)
    assert SAMPLE_JWT not in deep_tuple[1]

    serialized = json.dumps(redacted)
    for forbidden in (
        SAMPLE_RAW_PRIVATE_KEY,
        SAMPLE_BARE_PRIVATE_KEY,
        SAMPLE_SEED_PHRASE,
        "super-secret-password-123",
        "sk-proj-1234567890abcdefghijklmnop",
        "secret_oauth_token_value_999",
        SAMPLE_JWT,
        "MHcCAQEEIIG3fakeprivatekeymaterialforunitredactiontest",
        "user:pass123",
        "alcht_998877665544332211secret",
        "q_secret_123",
    ):
        assert forbidden not in serialized


def test_accidental_secret_in_tool_arguments_is_redacted_in_response_and_logs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = get_audit_logger()

    # 1. Caller accidentally passes a 64-hex private key as the wallet address
    res_pk = server.get_wallet_balances(SAMPLE_RAW_PRIVATE_KEY)
    assert "error" in res_pk
    assert SAMPLE_RAW_PRIVATE_KEY not in res_pk["error"]
    assert SAMPLE_BARE_PRIVATE_KEY not in res_pk["error"]
    assert REDACTED_PLACEHOLDER in res_pk["error"]

    # 2. Caller accidentally passes a 12-word seed phrase as the wallet address
    res_seed = server.get_wallet_balances(SAMPLE_SEED_PHRASE)
    assert "error" in res_seed
    assert "abandon ability" not in res_seed["error"]
    assert REDACTED_PLACEHOLDER in res_seed["error"]

    # 3. RPC provider raises an error containing embedded URL credentials and API keys
    w3_leaking = MagicMock()
    w3_leaking.is_connected.side_effect = RuntimeError(
        "HTTPSConnectionPool: url https://dev:my_rpc_pass@sepolia.base.org/v3/infura_secret_token_123456?api_key=secret999"
    )
    monkeypatch.setattr(wallet_module, "get_web3", lambda: w3_leaking)
    monkeypatch.setattr(wallet_module, "load_stocks", lambda: [])
    res_rpc = server.get_wallet_balances(SAMPLE_PUBLIC_WALLET)
    assert "error" in res_rpc
    assert "my_rpc_pass" not in res_rpc["error"]
    assert "infura_secret_token_123456" not in res_rpc["error"]
    assert "secret999" not in res_rpc["error"]

    raw_log_text = logger.log_file.read_text(encoding="utf-8")
    for secret in (
        SAMPLE_RAW_PRIVATE_KEY,
        SAMPLE_BARE_PRIVATE_KEY,
        SAMPLE_SEED_PHRASE,
        "my_rpc_pass",
        "infura_secret_token_123456",
        "secret999",
    ):
        assert secret not in raw_log_text


def test_circular_reference_redaction_does_not_recurse_infinitely() -> None:
    circular: dict[str, Any] = {"wallet": SAMPLE_PUBLIC_WALLET}
    circular["self"] = circular
    redacted = redact_sensitive_data(circular)
    assert redacted["wallet"] == SAMPLE_PUBLIC_WALLET
    assert redacted["self"] == "[CIRCULAR_REFERENCE]"


def test_is_sensitive_key_distinguishes_secrets_from_public_token_metadata() -> None:
    for secret_key in (
        "private_key",
        "PRIVATE_KEY",
        "seed_phrase",
        "mnemonic",
        "password",
        "api_key",
        "X-API-Key",
        "auth_token",
        "access_token",
        "refresh_token",
        "rpc_secret",
        "keystore_password",
        "Authorization",
        "token",
        "secret",
    ):
        assert is_sensitive_key(secret_key) is True, f"Expected {secret_key} to be sensitive"

    for safe_key in (
        "token_address",
        "token_decimals",
        "token_symbol",
        "token_balance",
        "wallet",
        "wallet_address",
        "public_key",
        "ticker",
        "chain_id",
    ):
        assert is_sensitive_key(safe_key) is False, f"Expected {safe_key} to be safe"


# ---------------------------------------------------------------------------
# 3. Log Rotation, Missing Directory Recovery, Idempotency & Concurrency
# ---------------------------------------------------------------------------


def test_log_rotation_rotates_files_and_respects_backup_count(
    tmp_path: Path,
) -> None:
    rot_dir = tmp_path / "rotation_logs"
    logger = AuditLogger(
        log_dir=rot_dir,
        filename="audit.jsonl",
        max_bytes=350,
        backup_count=2,
    )

    for idx in range(12):
        logger.log_event(
            tool="get_stock_info",
            status="ok",
            args={"ticker": f"tSYM{idx}"},
            duration_ms=1.25,
        )

    active = rot_dir / "audit.jsonl"
    backup_1 = rot_dir / "audit.jsonl.1"
    backup_2 = rot_dir / "audit.jsonl.2"
    backup_3 = rot_dir / "audit.jsonl.3"

    assert active.is_file()
    assert backup_1.is_file()
    assert backup_2.is_file()
    assert not backup_3.exists()

    for file_path in (active, backup_1, backup_2):
        entries = _read_jsonl_entries(file_path)
        assert len(entries) >= 1
        for entry in entries:
            assert entry["tool"] == "get_stock_info"
            assert entry["status"] == "ok"


def test_missing_log_directory_created_and_recreated_if_deleted(
    tmp_path: Path,
) -> None:
    nested_dir = tmp_path / "deep" / "nested" / "logs"
    assert not nested_dir.exists()

    logger = AuditLogger(log_dir=nested_dir)
    assert nested_dir.is_dir()

    logger.log_event(tool="hello_kyrox", status="ok", args={"name": "Saif"})
    assert logger.log_file.is_file()

    # Delete the entire directory while the logger instance is active
    shutil.rmtree(nested_dir)
    assert not nested_dir.exists()

    # Subsequent write must automatically recreate the directory and succeed
    logger.log_event(tool="list_stocks", status="ok")
    assert logger.log_file.is_file()
    entries = _read_jsonl_entries(logger.log_file)
    assert len(entries) == 1
    assert entries[0]["tool"] == "list_stocks"


def test_repeated_logger_initialization_is_idempotent(
    tmp_path: Path,
) -> None:
    log_dir = tmp_path / "idempotent_logs"
    first = configure_audit_logger(log_dir=log_dir)
    for _ in range(5):
        again = configure_audit_logger(log_dir=log_dir)
        assert again is first
        assert get_audit_logger() is first

    first.log_event(tool="hello_kyrox", status="ok", args={"name": "Saif"})
    entries = _read_jsonl_entries(first.log_file)
    assert len(entries) == 1


def test_concurrent_logging_is_thread_safe_across_workers(
    tmp_path: Path,
) -> None:
    conc_dir = tmp_path / "concurrent_logs"
    logger = AuditLogger(
        log_dir=conc_dir,
        filename="audit.jsonl",
        max_bytes=20000,
        backup_count=5,
    )

    worker_count = 8
    events_per_worker = 25
    total_expected = worker_count * events_per_worker

    def _worker(worker_id: int) -> None:
        for i in range(events_per_worker):
            logger.log_event(
                tool=f"worker_{worker_id}",
                status="ok" if i % 2 == 0 else "error",
                args={"worker": worker_id, "seq": i, "api_key": "secret_val"},
                error_code=ErrorCode.RPC_TIMEOUT if i % 2 == 1 else None,
                retryable=bool(i % 2 == 1),
                duration_ms=0.5,
            )

    with ThreadPoolExecutor(max_workers=worker_count) as pool:
        futures = [pool.submit(_worker, wid) for wid in range(worker_count)]
        for fut in futures:
            fut.result()

    all_entries: list[dict[str, Any]] = []
    for candidate in sorted(conc_dir.glob("audit.jsonl*")):
        all_entries.extend(_read_jsonl_entries(candidate))

    assert len(all_entries) == total_expected
    for entry in all_entries:
        assert entry["args"]["api_key"] == REDACTED_PLACEHOLDER


# ---------------------------------------------------------------------------
# 4. Centralized Error Taxonomy & Token Amount Validation Tests
# ---------------------------------------------------------------------------


def test_exception_hierarchy_preserves_stdlib_compatibility_and_classifications() -> None:
    err_empty = EmptyInputError("Ticker must not be empty.")
    assert isinstance(err_empty, ValueError)
    assert err_empty.code == ErrorCode.EMPTY_INPUT
    assert err_empty.retryable is False

    err_missing = DataFileNotFoundError("Stock data file not found: stocks.json")
    assert isinstance(err_missing, FileNotFoundError)
    assert err_missing.code == ErrorCode.STOCK_DATA_MISSING
    assert err_missing.retryable is False

    err_corrupt = DatasetCorruptedError("Invalid JSON in stock data file")
    assert isinstance(err_corrupt, ValueError)
    assert err_corrupt.code == ErrorCode.STOCK_DATA_CORRUPTED

    err_schema = DatasetSchemaError("Invalid stock record at index 0")
    assert isinstance(err_schema, ValueError)
    assert err_schema.code == ErrorCode.STOCK_SCHEMA_INVALID

    err_addr = AddressValidationError("Invalid Ethereum wallet address: 0x123")
    assert isinstance(err_addr, ValueError)
    assert err_addr.code == ErrorCode.INVALID_WALLET_ADDRESS

    err_cfg = ConfigurationError("Invalid BASE_RPC_URL configuration")
    assert isinstance(err_cfg, ValueError)
    assert err_cfg.code == ErrorCode.INVALID_CONFIGURATION

    err_chain = ChainIdMismatchError("Connected to unsupported chain ID 1")
    assert isinstance(err_chain, ValueError)
    assert err_chain.code == ErrorCode.UNSUPPORTED_CHAIN_ID

    err_rpc = RpcConnectionError("Unable to connect to Base Sepolia RPC provider.")
    assert isinstance(err_rpc, ConnectionError)
    assert err_rpc.code == ErrorCode.RPC_CONNECTION_FAILED
    assert err_rpc.retryable is True

    err_timeout = RpcTimeoutError("RPC request timed out.")
    assert isinstance(err_timeout, ConnectionError)
    assert isinstance(err_timeout, TimeoutError)
    assert err_timeout.code == ErrorCode.RPC_TIMEOUT
    assert err_timeout.retryable is True

    err_contract = ContractCallError("Execution reverted")
    assert isinstance(err_contract, RuntimeError)
    assert err_contract.code == ErrorCode.CONTRACT_CALL_FAILED
    assert err_contract.retryable is False

    err_ticker = TickerNotFoundError("Ticker XYZ not found.")
    assert err_ticker.to_response(include_metadata=True) == {
        "error": "Ticker XYZ not found.",
        "error_code": "TICKER_NOT_FOUND",
        "retryable": False,
        "category": "not_found",
    }


def test_validate_token_amount_precision_and_bounds() -> None:
    dec_val, base_units = validate_token_amount("12.5", decimals=18)
    assert dec_val == Decimal("12.5")
    assert base_units == 125 * 10**17

    dec_int, units_int = validate_token_amount(50, decimals=6)
    assert dec_int == Decimal(50)
    assert units_int == 50 * 10**6

    dec_custom, units_custom = validate_token_amount(
        100, decimals=6, max_amount=Decimal("100")
    )
    assert dec_custom == Decimal(100)
    assert units_custom == 100 * 10**6

    # Reject zero, negative, NaN, Infinity, booleans, empty strings
    for invalid_amt in (0, "0", -5, "-0.01", float("nan"), float("inf"), True, False, None, "abc"):
        with pytest.raises(ValidationError):
            validate_token_amount(invalid_amt, decimals=18)  # type: ignore[arg-type]

    with pytest.raises(EmptyInputError):
        validate_token_amount("   ", decimals=18)

    # Reject excessive decimal precision (e.g. 7 decimal places for a 6-decimal token)
    with pytest.raises(DecimalPrecisionError, match="Excessive decimal precision") as exc_prec:
        validate_token_amount("1.1234567", decimals=6)
    assert exc_prec.value.code == ErrorCode.DECIMAL_PRECISION_ERROR

    # Reject amount exceeding default 50-token policy max_amount and custom max_amount
    with pytest.raises(PolicyViolationError, match="exceeds maximum allowed limit") as exc_default_pol:
        validate_token_amount(100, decimals=6)
    assert exc_default_pol.value.code == ErrorCode.POLICY_REJECTED

    with pytest.raises(PolicyViolationError, match="exceeds maximum allowed limit") as exc_pol:
        validate_token_amount("5000", decimals=18, max_amount=Decimal("1000"))
    assert exc_pol.value.code == ErrorCode.POLICY_REJECTED
