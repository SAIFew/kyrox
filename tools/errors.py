"""Centralized error handling, validation exceptions, and secret redaction for KYROX.

Provides:
- Standardized ``ErrorCode`` taxonomy and retryability classifications.
- Structured ``KyroxError`` exception hierarchy preserving stdlib compatibility
  (``ValueError``, ``FileNotFoundError``, ``ConnectionError``, ``TimeoutError``).
- Recursive sensitive-data redaction for dictionaries, sequences, and free text.
- Deterministic token-amount and decimal-precision validation helpers.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from enum import Enum
import math
import re
from typing import Any

REDACTED_PLACEHOLDER: str = "[REDACTED]"
MAX_REDACTION_DEPTH: int = 32
MAX_TOKEN_DECIMALS: int = 77
DEFAULT_MAX_TOKEN_AMOUNT: Decimal = Decimal("1000000000")  # 1 billion tokens

# Public blockchain metadata field names that contain "token" or "key" but are NOT secrets.
# Their values are still scanned by pattern-based value redaction.
SAFE_PUBLIC_FIELD_NAMES: frozenset[str] = frozenset(
    {
        "token_address",
        "token_addresses",
        "token_contract",
        "token_contracts",
        "token_decimals",
        "token_symbol",
        "token_name",
        "token_balance",
        "token_balances",
        "token_configs",
        "tokens",
        "configured_tokens",
        "public_key",
        "public_address",
        "wallet",
        "wallet_address",
        "sender",
        "recipient",
        "to",
        "from",
        "ticker",
        "stock",
        "name",
        "chain",
        "chain_id",
        "reference_value",
        "balance",
        "balances",
        "holdings",
        "portfolio",
        "unpriced_holdings",
        "unpriced_tokens",
        "warnings",
        "total_value",
        "total_value_decimal",
        "currency",
        "valuation_basis",
        "valuation_source",
        "valuation_status",
        "environment",
        "decimals",
        "raw_balance",
        "balance_decimal",
        "value",
        "value_decimal",
        "priced",
        "holding_count",
        "priced_holding_count",
        "from_wallet",
        "to_wallet",
        "contract_address",
        "amount",
        "amount_decimal",
        "amount_base_units",
        "raw_amount",
        "chain_id_hex",
        "data",
        "calldata",
        "function",
        "nonce",
        "nonce_strategy",
        "nonce_note",
        "unsigned_tx",
        "chainId",
        "chainid",
        "gas",
        "maxFeePerGas",
        "maxfeepergas",
        "maxPriorityFeePerGas",
        "maxpriorityfeepergas",
        "gasPrice",
        "gasprice",
        "intent_id",
        "intent_hash",
        "prepared_at",
        "expires_at",
        "ttl_seconds",
        "signed",
        "broadcast",
        "requires_human_approval",
        "requires_external_signature",
        "signing_mode",
        "policy",
        "passed",
        "chain_verified",
        "allowed_chain_id",
        "ticker_approved",
        "contract_verified",
        "recipient_allowed",
        "max_amount",
        "next_steps",
        "instructions",
        "status",
        "decimals_source",
        "would_succeed",
        "simulation_status",
        "simulation_outcome",
        "simulated_at",
        "block_identifier",
        "block_number",
        "block_number_hex",
        "eth_call_succeeded",
        "erc20_transfer_returned",
        "return_data",
        "estimated_gas",
        "gas_estimate",
        "gas_units",
        "gas_note",
        "simulation_note",
        "failure_reason",
        "revert_reason",
        "revert_type",
        "error_code",
        "error_category",
        "retryable",
    }
)

EXACT_SENSITIVE_FIELD_NAMES: frozenset[str] = frozenset(
    {
        "key",
        "token",
        "secret",
        "password",
        "passwd",
        "pwd",
        "passphrase",
        "mnemonic",
        "seed",
        "bearer",
        "jwt",
        "authorization",
        "auth",
        "cookie",
        "set_cookie",
        "credentials",
        "credential",
        "keystore",
        "apikey",
        "x_api_key",
        "privatekey",
        "seedphrase",
    }
)

SENSITIVE_FIELD_SUBSTRINGS: tuple[str, ...] = (
    "private_key",
    "priv_key",
    "privkey",
    "signing_key",
    "secret_key",
    "client_secret",
    "api_secret",
    "webhook_secret",
    "seed_phrase",
    "recovery_phrase",
    "recovery_code",
    "mnemonic",
    "passphrase",
    "password",
    "passwd",
    "keystore",
    "api_key",
    "apikey",
    "access_key",
    "alchemy_key",
    "infura_key",
    "quicknode_key",
    "rpc_key",
    "rpc_secret",
    "rpc_token",
    "rpc_password",
    "rpc_credentials",
    "auth_token",
    "access_token",
    "refresh_token",
    "bearer_token",
    "id_token",
    "session_token",
    "secret_token",
    "api_token",
    "jwt_token",
    "session_id",
    "env_secret",
)

# Compiled regex patterns for free-text and value-level secret redaction.
_PEM_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)"
)
_URL_USERINFO_RE = re.compile(r"(https?://)([^/\s:@]+:[^/\s@]+)@")
_URL_QUERY_SECRET_RE = re.compile(
    r"(?i)([?&](?:api_?key|apikey|key|token|access_?token|auth_?token|secret|"
    r"client_?secret|password|passwd|pwd|sig|signature)=)([^&\s#\"'<>]+)"
)
_RPC_PATH_TOKEN_RE = re.compile(
    r"(?i)(https?://[^\s/\"'<>]+/(?:v[123]|rpc|api|key)/)([A-Za-z0-9_\-]{12,})"
)
_AUTH_SCHEME_RE = re.compile(
    r"(?i)\b(Bearer|Basic)\s+([A-Za-z0-9._\-+/=]{8,})"
)
_JWT_RE = re.compile(
    r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"
)
_API_KEY_PREFIX_RE = re.compile(
    r"\b(?:sk-[A-Za-z0-9_-]{12,}|pk_(?:live|test)_[A-Za-z0-9]{12,}|"
    r"rk_(?:live|test)_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|"
    r"github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{25,}|"
    r"xox[baprs]-[A-Za-z0-9-]{10,})\b"
)
_XPRV_RE = re.compile(r"\bxprv[A-Za-z0-9]{70,}\b")
# Matches 64-hex-character private keys (with or without 0x) without matching 40-hex EVM addresses.
_HEX_PRIVATE_KEY_RE = re.compile(
    r"(?<![A-Fa-f0-9xX])(?:0[xX])?[A-Fa-f0-9]{64}(?![A-Fa-f0-9])"
)
# Standalone 12..24 lowercase alphabetic word sequences (BIP-39 seed phrase shape).
_STANDALONE_SEED_PHRASE_RE = re.compile(
    r"^\s*[a-z]{3,12}(?:\s+[a-z]{3,12}){11,23}\s*$"
)
_LABELED_SEED_PHRASE_RE = re.compile(
    r"(?i)\b(seed(?:_?phrase)?|mnemonic|recovery_?phrase)\s*([:=])\s*"
    r"(?:\"[^\"]+\"|'[^']+'|(?:[a-z]{3,12}(?:\s+|$)){6,24})"
)
_INLINE_SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(private_?key|priv_?key|signing_?key|secret(?:_?key)?|client_?secret|"
    r"password|passwd|pwd|passphrase|api_?key|apikey|auth_?token|access_?token|"
    r"refresh_?token|bearer_?token|rpc_?key|rpc_?token|rpc_?secret)\s*([:=])\s*"
    r"(\"[^\"]*\"|'[^']*'|[^\s,;)\"'<>]+)"
)


def _normalize_key_name(key: str) -> str:
    """Normalize a field or environment variable name for sensitivity matching."""
    return re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_")


def is_sensitive_key(key: Any) -> bool:
    """Return ``True`` if ``key`` names a secret, credential, or private key field."""
    if not isinstance(key, str):
        return False

    normalized = _normalize_key_name(key)
    if not normalized or normalized in SAFE_PUBLIC_FIELD_NAMES:
        return False

    if normalized in EXACT_SENSITIVE_FIELD_NAMES:
        return True

    if any(sub in normalized for sub in SENSITIVE_FIELD_SUBSTRINGS):
        return True

    tokens = set(normalized.split("_"))
    if "secret" in tokens or "mnemonic" in tokens or "password" in tokens or "passwd" in tokens:
        return True
    if "private" in tokens and "key" in tokens:
        return True
    if "seed" in tokens and ("phrase" in tokens or "words" in tokens or "key" in tokens):
        return True

    return False


def redact_text(text: str) -> str:
    """Redact private keys, seed phrases, tokens, API keys, and URL credentials from text."""
    if not isinstance(text, str) or not text:
        return text

    if _STANDALONE_SEED_PHRASE_RE.match(text):
        return REDACTED_PLACEHOLDER

    sanitized = _PEM_PRIVATE_KEY_RE.sub(REDACTED_PLACEHOLDER, text)
    sanitized = _URL_USERINFO_RE.sub(rf"\1{REDACTED_PLACEHOLDER}@", sanitized)
    sanitized = _URL_QUERY_SECRET_RE.sub(rf"\1{REDACTED_PLACEHOLDER}", sanitized)
    sanitized = _RPC_PATH_TOKEN_RE.sub(rf"\1{REDACTED_PLACEHOLDER}", sanitized)
    sanitized = _LABELED_SEED_PHRASE_RE.sub(
        rf"\1\2{REDACTED_PLACEHOLDER}", sanitized
    )
    sanitized = _INLINE_SECRET_ASSIGNMENT_RE.sub(
        rf"\1\2{REDACTED_PLACEHOLDER}", sanitized
    )
    sanitized = _AUTH_SCHEME_RE.sub(rf"\1 {REDACTED_PLACEHOLDER}", sanitized)
    sanitized = _JWT_RE.sub(REDACTED_PLACEHOLDER, sanitized)
    sanitized = _API_KEY_PREFIX_RE.sub(REDACTED_PLACEHOLDER, sanitized)
    sanitized = _XPRV_RE.sub(REDACTED_PLACEHOLDER, sanitized)
    sanitized = _HEX_PRIVATE_KEY_RE.sub(REDACTED_PLACEHOLDER, sanitized)
    return sanitized


def redact_sensitive_data(
    value: Any,
    *,
    _depth: int = 0,
    _seen: set[int] | None = None,
) -> Any:
    """Recursively redact sensitive keys and secret patterns across arbitrary data structures."""
    if _depth > MAX_REDACTION_DEPTH:
        return "[TRUNCATED_DEPTH]"

    if value is None or isinstance(value, bool):
        return value

    if isinstance(value, int):
        return value

    if isinstance(value, float):
        if not math.isfinite(value):
            return str(value)
        return value

    if isinstance(value, Decimal):
        if not value.is_finite():
            return str(value)
        return str(value)

    if isinstance(value, str):
        return redact_text(value)

    if isinstance(value, (bytes, bytearray)):
        try:
            decoded = bytes(value).decode("utf-8")
            return redact_text(decoded)
        except UnicodeDecodeError:
            return f"<bytes:{len(value)}>"

    seen = _seen if _seen is not None else set()
    obj_id = id(value)

    if isinstance(value, Mapping):
        if obj_id in seen:
            return "[CIRCULAR_REFERENCE]"
        next_seen = seen | {obj_id}
        redacted_dict: dict[str, Any] = {}
        for k, v in value.items():
            key_str = str(k)
            if is_sensitive_key(key_str):
                redacted_dict[key_str] = REDACTED_PLACEHOLDER
            elif (
                _normalize_key_name(key_str) == "intent_hash"
                and isinstance(v, str)
                and bool(re.fullmatch(r"0x[0-9a-f]{64}", v))
                and value.get("signed") is False
            ):
                redacted_dict[key_str] = v
            elif (
                _normalize_key_name(key_str) == "return_data"
                and isinstance(v, str)
                and v in ("0x" + ("0" * 64), "0x" + ("0" * 63) + "1")
                and value.get("signed") is False
            ):
                redacted_dict[key_str] = v
            else:
                redacted_dict[key_str] = redact_sensitive_data(
                    v, _depth=_depth + 1, _seen=next_seen
                )
        return redacted_dict

    if isinstance(value, tuple):
        if obj_id in seen:
            return ("[CIRCULAR_REFERENCE]",)
        next_seen = seen | {obj_id}
        return tuple(
            redact_sensitive_data(item, _depth=_depth + 1, _seen=next_seen)
            for item in value
        )

    if isinstance(value, (list, set, frozenset)) or (
        isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray))
    ):
        if obj_id in seen:
            return ["[CIRCULAR_REFERENCE]"]
        next_seen = seen | {obj_id}
        return [
            redact_sensitive_data(item, _depth=_depth + 1, _seen=next_seen)
            for item in value
        ]

    if isinstance(value, BaseException):
        return redact_text(str(value))

    return redact_text(str(value))


class ErrorCode(str, Enum):
    """Standardized machine-readable error codes for KYROX operations."""

    EMPTY_INPUT = "EMPTY_INPUT"
    INVALID_INPUT = "INVALID_INPUT"
    TICKER_NOT_FOUND = "TICKER_NOT_FOUND"
    STOCK_DATA_MISSING = "STOCK_DATA_MISSING"
    STOCK_DATA_CORRUPTED = "STOCK_DATA_CORRUPTED"
    STOCK_SCHEMA_INVALID = "STOCK_SCHEMA_INVALID"
    DUPLICATE_TICKER = "DUPLICATE_TICKER"
    INVALID_WALLET_ADDRESS = "INVALID_WALLET_ADDRESS"
    ZERO_ADDRESS_NOT_ALLOWED = "ZERO_ADDRESS_NOT_ALLOWED"
    INVALID_ADDRESS_CHECKSUM = "INVALID_ADDRESS_CHECKSUM"
    INVALID_CONTRACT_ADDRESS = "INVALID_CONTRACT_ADDRESS"
    DUPLICATE_CONTRACT_ADDRESS = "DUPLICATE_CONTRACT_ADDRESS"
    MISSING_CONTRACT_BYTECODE = "MISSING_CONTRACT_BYTECODE"
    MISSING_CONFIGURATION = "MISSING_CONFIGURATION"
    INVALID_CONFIGURATION = "INVALID_CONFIGURATION"
    RPC_CONNECTION_FAILED = "RPC_CONNECTION_FAILED"
    RPC_TIMEOUT = "RPC_TIMEOUT"
    UNSUPPORTED_CHAIN_ID = "UNSUPPORTED_CHAIN_ID"
    CONTRACT_CALL_FAILED = "CONTRACT_CALL_FAILED"
    INVALID_AMOUNT = "INVALID_AMOUNT"
    DECIMAL_PRECISION_ERROR = "DECIMAL_PRECISION_ERROR"
    DECIMAL_MISMATCH = "DECIMAL_MISMATCH"
    CURRENCY_MISMATCH = "CURRENCY_MISMATCH"
    INVALID_REFERENCE_VALUE = "INVALID_REFERENCE_VALUE"
    POLICY_REJECTED = "POLICY_REJECTED"
    INTENT_EXPIRED = "INTENT_EXPIRED"
    INTENT_TAMPERED = "INTENT_TAMPERED"
    INSUFFICIENT_TOKEN_BALANCE = "INSUFFICIENT_TOKEN_BALANCE"
    SIMULATION_REVERTED = "SIMULATION_REVERTED"
    ERC20_TRANSFER_FALSE = "ERC20_TRANSFER_FALSE"
    MALFORMED_PROVIDER_RESPONSE = "MALFORMED_PROVIDER_RESPONSE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


RETRYABLE_ERROR_CODES: frozenset[ErrorCode] = frozenset(
    {
        ErrorCode.RPC_CONNECTION_FAILED,
        ErrorCode.RPC_TIMEOUT,
    }
)


@dataclass(frozen=True)
class ErrorClassification:
    """Normalized classification of a tool or service error."""

    code: ErrorCode
    message: str
    retryable: bool
    category: str
    exception_type: str | None = None

    def to_response(self, *, include_metadata: bool = False) -> dict[str, Any]:
        """Convert to a standardized KYROX error response dictionary."""
        safe_msg = redact_text(self.message)
        if not include_metadata:
            return {"error": safe_msg}
        return {
            "error": safe_msg,
            "error_code": self.code.value,
            "retryable": self.retryable,
            "category": self.category,
        }


class KyroxError(Exception):
    """Base exception for structured KYROX domain and infrastructure errors."""

    default_code: ErrorCode = ErrorCode.INTERNAL_ERROR
    default_category: str = "internal"

    def __init__(
        self,
        message: str,
        *,
        code: ErrorCode | None = None,
        retryable: bool | None = None,
        category: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        safe_message = redact_text(str(message))
        super().__init__(safe_message)
        resolved_code = code if code is not None else self.default_code
        self.message: str = safe_message
        self.code: ErrorCode = resolved_code
        self.retryable: bool = (
            retryable
            if retryable is not None
            else (resolved_code in RETRYABLE_ERROR_CODES)
        )
        self.category: str = category if category is not None else self.default_category
        self.context: dict[str, Any] = (
            redact_sensitive_data(context) if isinstance(context, dict) else {}
        )

    def to_classification(self) -> ErrorClassification:
        """Return the ``ErrorClassification`` for this exception."""
        return ErrorClassification(
            code=self.code,
            message=self.message,
            retryable=self.retryable,
            category=self.category,
            exception_type=type(self).__name__,
        )

    def to_response(self, *, include_metadata: bool = False) -> dict[str, Any]:
        """Format this exception as a caller-safe tool error dictionary."""
        return self.to_classification().to_response(include_metadata=include_metadata)


class ValidationError(KyroxError, ValueError):
    """Raised when user input or domain parameters fail validation."""

    default_code = ErrorCode.INVALID_INPUT
    default_category = "validation"


class EmptyInputError(ValidationError):
    """Raised when a required string input is empty or whitespace-only."""

    default_code = ErrorCode.EMPTY_INPUT
    default_category = "validation"


class TickerNotFoundError(ValidationError):
    """Raised when a requested stock ticker does not exist in the catalogue."""

    default_code = ErrorCode.TICKER_NOT_FOUND
    default_category = "not_found"


class DataFileNotFoundError(KyroxError, FileNotFoundError):
    """Raised when a required dataset file (such as ``data/stocks.json``) is missing."""

    default_code = ErrorCode.STOCK_DATA_MISSING
    default_category = "dataset"


class DatasetCorruptedError(ValidationError):
    """Raised when a JSON dataset file cannot be parsed."""

    default_code = ErrorCode.STOCK_DATA_CORRUPTED
    default_category = "dataset"


class DatasetSchemaError(ValidationError):
    """Raised when a dataset violates structural or field-level invariants."""

    default_code = ErrorCode.STOCK_SCHEMA_INVALID
    default_category = "dataset"


class AddressValidationError(ValidationError):
    """Raised when a wallet or contract EVM address is invalid, zero, or has a bad checksum."""

    default_code = ErrorCode.INVALID_WALLET_ADDRESS
    default_category = "validation"


class ConfigurationError(ValidationError):
    """Raised when environment or runtime configuration is missing or invalid."""

    default_code = ErrorCode.INVALID_CONFIGURATION
    default_category = "configuration"


class ChainIdMismatchError(ValidationError):
    """Raised when the connected RPC endpoint is not Base Sepolia (chainId 84532)."""

    default_code = ErrorCode.UNSUPPORTED_CHAIN_ID
    default_category = "validation"


class DecimalPrecisionError(ValidationError):
    """Raised when a token balance or transaction amount has invalid precision or bounds."""

    default_code = ErrorCode.DECIMAL_PRECISION_ERROR
    default_category = "validation"


class PolicyViolationError(ValidationError):
    """Raised when an operation violates a transaction policy constraint."""

    default_code = ErrorCode.POLICY_REJECTED
    default_category = "policy"


class RpcConnectionError(KyroxError, ConnectionError):
    """Raised when communication with the Base Sepolia RPC endpoint fails."""

    default_code = ErrorCode.RPC_CONNECTION_FAILED
    default_category = "rpc"


class RpcTimeoutError(RpcConnectionError, TimeoutError):
    """Raised when a Base Sepolia RPC request times out."""

    default_code = ErrorCode.RPC_TIMEOUT
    default_category = "rpc"


class ContractCallError(KyroxError, RuntimeError):
    """Raised when an on-chain ERC-20 read call reverts or returns invalid data."""

    default_code = ErrorCode.CONTRACT_CALL_FAILED
    default_category = "contract"


class MalformedProviderResponseError(ValidationError):
    """Raised when an RPC provider returns a malformed, non-conforming, or undecodable payload."""

    default_code = ErrorCode.MALFORMED_PROVIDER_RESPONSE
    default_category = "rpc"


class SimulationRevertError(ContractCallError):
    """Raised when an EVM simulation dry-run (``eth_call`` or ``eth_estimateGas``) reverts."""

    default_code = ErrorCode.SIMULATION_REVERTED
    default_category = "simulation"


class InsufficientTokenBalanceError(SimulationRevertError):
    """Raised when an EVM simulation dry-run reverts due to insufficient ERC-20 token balance."""

    default_code = ErrorCode.INSUFFICIENT_TOKEN_BALANCE
    default_category = "simulation"


class Erc20FalseReturnError(ContractCallError):
    """Raised when an ERC-20 transfer dry-run completes without reverting but returns ``false``."""

    default_code = ErrorCode.ERC20_TRANSFER_FALSE
    default_category = "simulation"


def is_timeout_exception(exc: BaseException) -> bool:
    """Return ``True`` if ``exc`` represents a network or RPC timeout."""
    if isinstance(exc, TimeoutError):
        return True
    exc_type_name = type(exc).__name__.lower()
    if "timeout" in exc_type_name:
        return True
    msg_lower = str(exc).lower()
    return "timed out" in msg_lower or "timeout" in msg_lower


def classify_error_message(
    message: str,
    *,
    exception_type: str | None = None,
) -> ErrorClassification:
    """Classify a tool error message string into a structured ``ErrorClassification``."""
    safe_msg = redact_text(str(message))
    lower = safe_msg.lower()

    if "must not be empty" in lower or "cannot be empty" in lower:
        code = ErrorCode.EMPTY_INPUT
        category = "validation"
    elif "not found" in lower and "ticker" in lower:
        code = ErrorCode.TICKER_NOT_FOUND
        category = "not_found"
    elif "stock data file not found" in lower:
        code = ErrorCode.STOCK_DATA_MISSING
        category = "dataset"
    elif "invalid json in stock data file" in lower:
        code = ErrorCode.STOCK_DATA_CORRUPTED
        category = "dataset"
    elif "duplicate stock ticker" in lower:
        code = ErrorCode.DUPLICATE_TICKER
        category = "dataset"
    elif "invalid stock record" in lower or "invalid stock data structure" in lower:
        code = ErrorCode.STOCK_SCHEMA_INVALID
        category = "dataset"
    elif "zero address" in lower:
        code = ErrorCode.ZERO_ADDRESS_NOT_ALLOWED
        category = "validation"
    elif "checksum" in lower:
        code = ErrorCode.INVALID_ADDRESS_CHECKSUM
        category = "validation"
    elif (
        "invalid ethereum wallet address" in lower
        or "invalid sender wallet address" in lower
        or "invalid recipient wallet address" in lower
    ):
        code = ErrorCode.INVALID_WALLET_ADDRESS
        category = "validation"
    elif "duplicate token contract address" in lower:
        code = ErrorCode.DUPLICATE_CONTRACT_ADDRESS
        category = "validation"
    elif "no contract bytecode found" in lower:
        code = ErrorCode.MISSING_CONTRACT_BYTECODE
        category = "contract"
    elif "invalid token contract address" in lower:
        code = ErrorCode.INVALID_CONTRACT_ADDRESS
        category = "validation"
    elif (
        "missing required configuration" in lower
        or "not configured in the stock dataset" in lower
    ):
        code = ErrorCode.MISSING_CONFIGURATION
        category = "configuration"
    elif "configuration" in lower and "invalid" in lower:
        code = ErrorCode.INVALID_CONFIGURATION
        category = "configuration"
    elif "timed out" in lower or "timeout" in lower:
        code = ErrorCode.RPC_TIMEOUT
        category = "rpc"
    elif (
        "unable to connect to base sepolia rpc" in lower
        or "unable to read chain id" in lower
        or "unable to verify contract bytecode" in lower
        or "unable to read pending nonce" in lower
        or "unable to read latest block number" in lower
        or "unable to simulate transfer" in lower
        or "unable to estimate gas" in lower
    ):
        code = ErrorCode.RPC_CONNECTION_FAILED
        category = "rpc"
    elif (
        "malformed rpc provider response" in lower
        or "malformed provider response" in lower
        or "invalid pending nonce returned by rpc provider" in lower
    ):
        code = ErrorCode.MALFORMED_PROVIDER_RESPONSE
        category = "rpc"
    elif "unsupported chain id" in lower:
        code = ErrorCode.UNSUPPORTED_CHAIN_ID
        category = "validation"
    elif "decimals mismatch" in lower or "decimal mismatch" in lower:
        code = ErrorCode.DECIMAL_MISMATCH
        category = "validation"
    elif (
        "currency mismatch" in lower
        or "mixed valuation currencies" in lower
        or "invalid currency" in lower
    ):
        code = ErrorCode.CURRENCY_MISMATCH
        category = "validation"
    elif "invalid reference_value" in lower or "invalid reference value" in lower:
        code = ErrorCode.INVALID_REFERENCE_VALUE
        category = "validation"
    elif (
        "invalid token decimals" in lower
        or "unable to establish verified token decimals" in lower
        or "invalid raw token balance" in lower
        or "precision" in lower
    ):
        code = ErrorCode.DECIMAL_PRECISION_ERROR
        category = "validation"
    elif "intent has expired" in lower or "intent expired" in lower:
        code = ErrorCode.INTENT_EXPIRED
        category = "policy"
    elif (
        "intent tampered" in lower
        or "intent_hash mismatch" in lower
        or "transaction target mismatch" in lower
    ):
        code = ErrorCode.INTENT_TAMPERED
        category = "policy"
    elif (
        "policy rejection" in lower
        or "exceeds maximum allowed limit" in lower
        or "only accepts unsigned intents" in lower
    ):
        code = ErrorCode.POLICY_REJECTED
        category = "policy"
    elif "invalid transaction amount" in lower:
        code = ErrorCode.INVALID_AMOUNT
        category = "validation"
    elif (
        "insufficient" in lower
        and (
            "balance" in lower
            or "erc20insufficientbalance" in lower
            or "exceeds balance" in lower
        )
    ) or "transfer amount exceeds balance" in lower:
        code = ErrorCode.INSUFFICIENT_TOKEN_BALANCE
        category = "simulation"
    elif "returned false" in lower and "transfer" in lower:
        code = ErrorCode.ERC20_TRANSFER_FALSE
        category = "simulation"
    elif (
        "evm simulation reverted" in lower
        or "gas estimation reverted" in lower
        or "execution reverted" in lower
    ):
        code = ErrorCode.SIMULATION_REVERTED
        category = "simulation"
    elif (
        "failed to read token balance" in lower
        or "failed to read token decimals" in lower
        or "failed to build transfer transaction" in lower
    ):
        code = ErrorCode.CONTRACT_CALL_FAILED
        category = "contract"
    else:
        code = ErrorCode.INVALID_INPUT
        category = "validation"

    return ErrorClassification(
        code=code,
        message=safe_msg,
        retryable=code in RETRYABLE_ERROR_CODES,
        category=category,
        exception_type=exception_type,
    )


def classify_exception(exc: BaseException, *, tool_name: str = "") -> ErrorClassification:
    """Classify any raised exception into a safe, redacted ``ErrorClassification``."""
    if isinstance(exc, KyroxError):
        return exc.to_classification()

    exc_type = type(exc).__name__
    safe_msg = redact_text(str(exc)).strip()

    if isinstance(exc, FileNotFoundError):
        return ErrorClassification(
            code=ErrorCode.STOCK_DATA_MISSING,
            message=safe_msg or "Required data file not found.",
            retryable=False,
            category="dataset",
            exception_type=exc_type,
        )

    if is_timeout_exception(exc):
        return ErrorClassification(
            code=ErrorCode.RPC_TIMEOUT,
            message=safe_msg or "RPC request timed out.",
            retryable=True,
            category="rpc",
            exception_type=exc_type,
        )

    if isinstance(exc, ConnectionError):
        return ErrorClassification(
            code=ErrorCode.RPC_CONNECTION_FAILED,
            message=safe_msg or "Unable to connect to Base Sepolia RPC provider.",
            retryable=True,
            category="rpc",
            exception_type=exc_type,
        )

    if isinstance(exc, ValueError):
        classified = classify_error_message(safe_msg, exception_type=exc_type)
        return classified

    label = f" in {tool_name}" if tool_name else ""
    fallback_msg = (
        f"Unexpected internal error{label}: {safe_msg}"
        if safe_msg
        else f"Unexpected internal error{label}."
    )
    return ErrorClassification(
        code=ErrorCode.INTERNAL_ERROR,
        message=fallback_msg,
        retryable=False,
        category="internal",
        exception_type=exc_type,
    )


def validate_token_amount(
    amount: int | float | str | Decimal,
    *,
    decimals: int = 18,
    max_amount: Decimal = DEFAULT_MAX_TOKEN_AMOUNT,
) -> tuple[Decimal, int]:
    """Validate a human-readable token amount and convert it to exact integer base units.

    Rejects booleans, non-numeric inputs, ``NaN``, ``Infinity``, zero or negative
    amounts, amounts exceeding ``max_amount``, and fractional values with more
    decimal places than ``decimals``.

    Args:
        amount: Human-readable token quantity (``int``, ``Decimal``, ``str``, or finite ``float``).
        decimals: Token decimals between 0 and 77.
        max_amount: Maximum allowed token quantity per operation.

    Returns:
        Tuple of ``(normalized_decimal_amount, base_units_int)``.

    Raises:
        ValidationError / DecimalPrecisionError / PolicyViolationError: On invalid input.
    """
    if isinstance(decimals, bool) or not isinstance(decimals, int) or decimals < 0 or decimals > MAX_TOKEN_DECIMALS:
        raise DecimalPrecisionError(
            f"Invalid token decimals: expected integer between 0 and {MAX_TOKEN_DECIMALS}, got {decimals!r}.",
            code=ErrorCode.DECIMAL_PRECISION_ERROR,
        )

    if isinstance(amount, bool) or amount is None:
        raise ValidationError(
            "Invalid transaction amount: amount must be a valid positive number.",
            code=ErrorCode.INVALID_AMOUNT,
        )

    if isinstance(amount, float):
        if not math.isfinite(amount):
            raise ValidationError(
                "Invalid transaction amount: NaN and Infinity are not allowed.",
                code=ErrorCode.INVALID_AMOUNT,
            )
        amount_str = str(amount)
    elif isinstance(amount, (int, Decimal)):
        amount_str = str(amount)
    elif isinstance(amount, str):
        amount_str = amount.strip()
        if not amount_str:
            raise EmptyInputError(
                "Transaction amount must not be empty.",
                code=ErrorCode.EMPTY_INPUT,
            )
    else:
        raise ValidationError(
            f"Invalid transaction amount: unsupported type {type(amount).__name__}.",
            code=ErrorCode.INVALID_AMOUNT,
        )

    try:
        dec_value = Decimal(amount_str)
    except InvalidOperation as exc:
        raise ValidationError(
            f"Invalid transaction amount: {redact_text(amount_str)!r} is not a valid decimal number.",
            code=ErrorCode.INVALID_AMOUNT,
        ) from exc

    if not dec_value.is_finite():
        raise ValidationError(
            "Invalid transaction amount: NaN and Infinity are not allowed.",
            code=ErrorCode.INVALID_AMOUNT,
        )

    if dec_value <= Decimal(0):
        raise ValidationError(
            "Invalid transaction amount: amount must be greater than zero.",
            code=ErrorCode.INVALID_AMOUNT,
        )

    normalized = dec_value.normalize()
    exponent = normalized.as_tuple().exponent
    decimal_places = -exponent if isinstance(exponent, int) and exponent < 0 else 0
    if decimal_places > decimals:
        raise DecimalPrecisionError(
            f"Excessive decimal precision: {decimal_places} decimal places exceeds token decimals ({decimals}).",
            code=ErrorCode.DECIMAL_PRECISION_ERROR,
        )

    if dec_value > max_amount:
        raise PolicyViolationError(
            f"Transaction amount {dec_value} exceeds maximum allowed limit ({max_amount}).",
            code=ErrorCode.POLICY_REJECTED,
        )

    scale = Decimal(10) ** Decimal(decimals)
    base_units = int((dec_value * scale).to_integral_exact())
    return dec_value, base_units

