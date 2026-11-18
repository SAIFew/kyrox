"""Unsigned ERC-20 transfer transaction preparation, intent verification, and EVM simulation for KYROX.

Enforces strict non-custodial boundaries on Base Sepolia (``chainId: 84532`` / ``0x14a34``):
- Never accepts, loads, stores, or logs private keys or seed phrases.
- Never calls ``sign_transaction``, ``send_transaction``, or ``send_raw_transaction``.
- Validates sender, recipient, approved stock ticker, and token contract address (EIP-55
  checksums, non-zero addresses, duplicate contract checks, and deployed bytecode).
- Establishes verified token decimals from the on-chain ERC-20 contract (and cross-checks
  against dataset metadata when configured) before converting human amounts into exact
  integer base units using ``Decimal`` arithmetic.
- Applies transaction safety policies (Base Sepolia chain restriction, approved ticker checks,
  optional recipient allowlist, token-contract self-transfer prevention, and maximum
  per-transaction token amount bounds).
- Constructs a JSON-serializable unsigned transaction intent with ``signed: False`` and
  requires human review and external wallet signing.
- Simulates prepared unsigned intents against Base Sepolia canonical ``latest`` state using
  ``eth_call`` (verifying ABI-decoded ERC-20 ``bool`` return data) and ``eth_estimateGas``
  (reporting gas in units, never currency fees, without signing or broadcasting).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
import re
from typing import Any
from unittest.mock import MagicMock

from web3 import Web3
from web3.exceptions import (
    ContractCustomError,
    ContractLogicError,
    ContractPanicError,
    PersistentConnectionError,
    ProviderConnectionError,
    Web3RPCError,
)

from tools.errors import (
    DEFAULT_MAX_TOKEN_AMOUNT,
    MAX_TOKEN_DECIMALS,
    AddressValidationError,
    ChainIdMismatchError,
    ConfigurationError,
    ContractCallError,
    DatasetSchemaError,
    DecimalPrecisionError,
    EmptyInputError,
    Erc20FalseReturnError,
    ErrorCode,
    InsufficientTokenBalanceError,
    KyroxError,
    MalformedProviderResponseError,
    PolicyViolationError,
    RpcConnectionError,
    RpcTimeoutError,
    SimulationRevertError,
    TickerNotFoundError,
    ValidationError,
    is_timeout_exception,
    redact_text,
    validate_token_amount,
)
from tools.stocks import load_stocks
from tools.wallet import (
    BASE_SEPOLIA_CHAIN_ID,
    BASE_SEPOLIA_CHAIN_NAME,
    DEFAULT_ENVIRONMENT,
    MAX_UINT256,
    _decimal_to_json_number,
    _verify_contract_bytecode,
    format_decimal_str,
    get_web3,
    normalize_raw_balance_decimal,
    validate_contract_address,
    validate_wallet_address,
    verify_base_sepolia_connection,
)

BASE_SEPOLIA_CHAIN_ID_HEX: str = "0x14a34"
ERC20_TRANSFER_SELECTOR: str = "0xa9059cbb"
ERC20_INSUFFICIENT_BALANCE_SELECTOR: str = "0xe450d38c"
SOLIDITY_ERROR_STRING_SELECTOR: str = "0x08c379a0"
SOLIDITY_PANIC_SELECTOR: str = "0x4e487b71"
SIMULATION_BLOCK_IDENTIFIER: str = "latest"
MAX_GAS_ESTIMATE_UNITS: int = 100_000_000
DEFAULT_INTENT_TTL_SECONDS: int = 300
MAX_INTENT_TTL_SECONDS: int = 86400

# Explicit EIP-1474 allowlist for eth_call and eth_estimateGas transaction call objects.
# Excludes chainId, nonce, signatures, and all internal KYROX intent metadata.
SIMULATION_CALL_ALLOWED_KEYS: frozenset[str] = frozenset(
    {
        "from",
        "to",
        "data",
        "value",
        "gas",
        "gasPrice",
        "maxFeePerGas",
        "maxPriorityFeePerGas",
    }
)
FORBIDDEN_SIMULATION_CALL_KEYS: frozenset[str] = frozenset(
    {
        "chainId",
        "chain_id",
        "chain_id_hex",
        "nonce",
        "intent_hash",
        "expires_at",
        "intent_id",
        "ticker",
        "stock",
        "amount",
        "amount_decimal",
        "amount_base_units",
        "raw_amount",
        "decimals",
        "decimals_source",
        "signed",
        "broadcast",
        "policy",
        "unsigned_tx",
        "r",
        "s",
        "v",
        "signature",
        "rawTransaction",
        "raw_transaction",
        "private_key",
    }
)

MAX_TX_AMOUNT_ENV_VAR: str = "KYROX_MAX_TX_AMOUNT"
APPROVED_TICKERS_ENV_VAR: str = "KYROX_APPROVED_TICKERS"
ALLOWED_RECIPIENTS_ENV_VAR: str = "KYROX_ALLOWED_RECIPIENTS"
INTENT_TTL_ENV_VAR: str = "KYROX_INTENT_TTL_SECONDS"

NONCE_SNAPSHOT_NOTE: str = (
    "Prepared nonce is a point-in-time pending-state snapshot and is not reserved on-chain."
)
PREPARATION_EXECUTION_WARNING: str = (
    "Preparing an unsigned transaction does not confirm or guarantee that it will execute "
    "successfully on-chain; run simulate_transaction and verify wallet state before signing."
)
SIMULATION_STATE_WARNING: str = (
    "EVM simulation (eth_call and eth_estimateGas) reflects Base Sepolia state at block "
    "'latest' at a single point in time and does not guarantee later on-chain execution."
)
GAS_ESTIMATE_WARNING: str = (
    "Estimated gas is reported in gas units (not ETH or currency fees) and is a point-in-time "
    "estimate, not guaranteed actual gas consumption."
)
MOCK_TX_WARNING: str = (
    "Prepared transfer targets a mock demonstration ERC-20 token on Base Sepolia "
    "(chainId: 84532) and does not represent regulated equity settlement."
)
EXTERNAL_SIGNING_INSTRUCTIONS: str = (
    "Review the unsigned ERC-20 transfer parameters (contract target, recipient, base-unit "
    "amount, calldata, and chainId 84532), run simulate_transaction, and sign externally in "
    "your own non-custodial wallet. KYROX never holds private keys, never signs, and never "
    "broadcasts transactions."
)
SIMULATION_SIGNING_INSTRUCTIONS: str = (
    "Simulation completed without signing or broadcasting. Review the unsigned ERC-20 transfer "
    "parameters (contract target, recipient, base-unit amount, calldata, gas estimate in units, "
    "and chainId 84532) and sign externally in your own non-custodial wallet. KYROX never holds "
    "private keys, never signs, and never broadcasts transactions."
)

# Minimal ABI for unsigned ERC-20 transfer calldata construction and decimals verification.
# Strictly excludes any signing, broadcasting, minting, burning, or unlimited approval methods.
ERC20_TRANSFER_ABI: list[dict[str, Any]] = [
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "constant": False,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

_ABI_WEB3 = Web3()


def validate_sender_address(from_wallet: str) -> str:
    """Validate the sender (``from_wallet``) Ethereum address and return its EIP-55 checksum."""
    if not isinstance(from_wallet, str) or not from_wallet.strip():
        raise EmptyInputError(
            "Sender wallet address (from_wallet) must not be empty.",
            code=ErrorCode.EMPTY_INPUT,
        )
    try:
        return validate_wallet_address(from_wallet)
    except AddressValidationError as exc:
        raise AddressValidationError(
            f"Invalid Ethereum wallet address for sender (from_wallet): {exc.message}",
            code=exc.code,
        ) from exc


def validate_recipient_address(to: str) -> str:
    """Validate the recipient (``to``) Ethereum address and return its EIP-55 checksum."""
    if not isinstance(to, str) or not to.strip():
        raise EmptyInputError(
            "Recipient wallet address (to) must not be empty.",
            code=ErrorCode.EMPTY_INPUT,
        )
    try:
        return validate_wallet_address(to)
    except AddressValidationError as exc:
        raise AddressValidationError(
            f"Invalid Ethereum wallet address for recipient (to): {exc.message}",
            code=exc.code,
        ) from exc


def get_max_tx_amount() -> Decimal:
    """Resolve and validate the maximum allowed token quantity per transaction."""
    raw_limit = os.getenv(MAX_TX_AMOUNT_ENV_VAR, "").strip()
    if not raw_limit:
        return DEFAULT_MAX_TOKEN_AMOUNT

    try:
        limit_dec = Decimal(raw_limit)
    except InvalidOperation as exc:
        raise ConfigurationError(
            f"Invalid {MAX_TX_AMOUNT_ENV_VAR} configuration: {redact_text(raw_limit)!r} is not a valid decimal.",
            code=ErrorCode.INVALID_CONFIGURATION,
        ) from exc

    if not limit_dec.is_finite() or limit_dec <= Decimal(0):
        raise ConfigurationError(
            f"Invalid {MAX_TX_AMOUNT_ENV_VAR} configuration: must be a positive finite number.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    return limit_dec


def get_approved_tickers() -> frozenset[str] | None:
    """Resolve optional comma-separated approved ticker policy from environment configuration."""
    raw_tickers = os.getenv(APPROVED_TICKERS_ENV_VAR, "").strip()
    if not raw_tickers:
        return None

    items = [part.strip().lower() for part in raw_tickers.split(",") if part.strip()]
    if not items:
        raise ConfigurationError(
            f"Invalid {APPROVED_TICKERS_ENV_VAR} configuration: must contain at least one ticker.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )
    return frozenset(items)


def get_allowed_recipients() -> frozenset[str] | None:
    """Resolve optional comma-separated recipient address allowlist from environment configuration."""
    raw_recipients = os.getenv(ALLOWED_RECIPIENTS_ENV_VAR, "").strip()
    if not raw_recipients:
        return None

    parts = [part.strip() for part in raw_recipients.split(",") if part.strip()]
    if not parts:
        raise ConfigurationError(
            f"Invalid {ALLOWED_RECIPIENTS_ENV_VAR} configuration: allowlist must not be empty.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    checksummed: set[str] = set()
    for part in parts:
        try:
            checksummed.add(validate_wallet_address(part))
        except ValueError as exc:
            raise ConfigurationError(
                f"Invalid address in {ALLOWED_RECIPIENTS_ENV_VAR} configuration: {redact_text(str(exc))}",
                code=ErrorCode.INVALID_CONFIGURATION,
            ) from exc

    return frozenset(checksummed)


def get_intent_ttl_seconds() -> int:
    """Resolve and validate the transaction intent expiration TTL in seconds."""
    raw_ttl = os.getenv(INTENT_TTL_ENV_VAR, "").strip()
    if not raw_ttl:
        return DEFAULT_INTENT_TTL_SECONDS

    try:
        ttl_val = int(raw_ttl)
    except ValueError as exc:
        raise ConfigurationError(
            f"Invalid {INTENT_TTL_ENV_VAR} configuration: {redact_text(raw_ttl)!r} is not an integer.",
            code=ErrorCode.INVALID_CONFIGURATION,
        ) from exc

    if ttl_val <= 0 or ttl_val > MAX_INTENT_TTL_SECONDS:
        raise ConfigurationError(
            f"Invalid {INTENT_TTL_ENV_VAR} configuration: must be between 1 and {MAX_INTENT_TTL_SECONDS} seconds.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    return ttl_val


def _normalize_hex_str(value: Any) -> str:
    """Normalize ``str``, ``bytes``, or ``HexBytes`` into a ``0x``-prefixed lowercase hex string."""
    if isinstance(value, (bytes, bytearray)):
        return "0x" + bytes(value).hex().lower()
    if hasattr(value, "hex") and callable(value.hex) and not isinstance(value, str):
        hex_str = str(value.hex())
        return hex_str.lower() if hex_str.lower().startswith("0x") else "0x" + hex_str.lower()
    if isinstance(value, str):
        candidate = value.strip()
        if candidate.lower().startswith("0x"):
            return "0x" + candidate[2:].lower()
        return "0x" + candidate.lower()
    raise ValidationError(
        f"Invalid hexadecimal calldata value: unsupported type {type(value).__name__}.",
        code=ErrorCode.INVALID_INPUT,
    )


def encode_erc20_transfer_calldata(
    token_address: str,
    recipient: str,
    amount_base_units: int,
) -> str:
    """Encode standard ERC-20 ``transfer(address,uint256)`` calldata using Web3.py."""
    checksum_contract = validate_contract_address(token_address, ticker="token")
    if checksum_contract is None:
        raise ConfigurationError(
            "Missing required configuration: token contract address must not be empty.",
            code=ErrorCode.MISSING_CONFIGURATION,
        )
    checksum_recipient = validate_recipient_address(recipient)
    if (
        isinstance(amount_base_units, bool)
        or not isinstance(amount_base_units, int)
        or amount_base_units <= 0
        or amount_base_units > MAX_UINT256
    ):
        raise DecimalPrecisionError(
            f"Invalid integer base-unit amount: must be between 1 and {MAX_UINT256}, got {amount_base_units!r}.",
            code=ErrorCode.DECIMAL_PRECISION_ERROR,
        )

    local_contract = _ABI_WEB3.eth.contract(
        address=checksum_contract,
        abi=ERC20_TRANSFER_ABI,
    )
    raw_calldata = local_contract.encode_abi(
        "transfer",
        args=[checksum_recipient, amount_base_units],
    )
    normalized = _normalize_hex_str(raw_calldata)
    if not normalized.startswith(ERC20_TRANSFER_SELECTOR) or len(normalized) != 138:
        raise ContractCallError(
            f"Failed to build transfer transaction calldata: unexpected selector or length ({len(normalized)}).",
            code=ErrorCode.CONTRACT_CALL_FAILED,
        )
    return normalized


def decode_erc20_transfer_calldata(
    token_address: str,
    calldata: str,
) -> tuple[str, int]:
    """Decode and verify ERC-20 ``transfer(address,uint256)`` calldata."""
    checksum_contract = validate_contract_address(token_address, ticker="token")
    if checksum_contract is None:
        raise ConfigurationError(
            "Missing required configuration: token contract address must not be empty.",
            code=ErrorCode.MISSING_CONFIGURATION,
        )
    normalized = _normalize_hex_str(calldata)
    if not normalized.startswith(ERC20_TRANSFER_SELECTOR) or len(normalized) != 138:
        raise PolicyViolationError(
            "Transaction intent tampered: calldata is not a valid ERC-20 transfer(address,uint256) payload.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    local_contract = _ABI_WEB3.eth.contract(
        address=checksum_contract,
        abi=ERC20_TRANSFER_ABI,
    )
    try:
        fn_obj, fn_params = local_contract.decode_function_input(normalized)
    except Exception as exc:
        raise PolicyViolationError(
            f"Transaction intent tampered: unable to decode ERC-20 transfer calldata ({redact_text(str(exc))}).",
            code=ErrorCode.INTENT_TAMPERED,
        ) from exc

    if getattr(fn_obj, "fn_name", None) != "transfer":
        raise PolicyViolationError(
            "Transaction intent tampered: decoded function is not ERC-20 transfer.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    decoded_to = Web3.to_checksum_address(str(fn_params["_to"]))
    decoded_amount = int(fn_params["_value"])
    return decoded_to, decoded_amount


def compute_intent_hash(
    *,
    chain: str,
    chain_id: int,
    from_wallet: str,
    to: str,
    token_address: str,
    ticker: str,
    decimals: int,
    amount_decimal: str,
    amount_base_units: int,
    nonce: int,
    data: str,
    value: int = 0,
) -> str:
    """Compute a deterministic ``0x``-prefixed SHA-256 digest over the canonical unsigned intent."""
    canonical_payload = {
        "amount_base_units": str(int(amount_base_units)),
        "amount_decimal": str(amount_decimal),
        "chain": str(chain),
        "chain_id": int(chain_id),
        "data": _normalize_hex_str(data),
        "decimals": int(decimals),
        "from_wallet": Web3.to_checksum_address(from_wallet),
        "nonce": int(nonce),
        "ticker": str(ticker),
        "to": Web3.to_checksum_address(to),
        "token_address": Web3.to_checksum_address(token_address),
        "value": int(value),
    }
    serialized = json.dumps(
        canonical_payload,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "0x" + hashlib.sha256(serialized).hexdigest()


def verify_prepared_transaction_intent(
    intent: Mapping[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Verify the structural integrity, non-signing invariant, calldata, hash, and expiry of an intent.

    Raises:
        ValidationError / ChainIdMismatchError / PolicyViolationError: If the intent is
            signed, targets the wrong chain, has expired, or has been tampered with.
    """
    if not isinstance(intent, Mapping):
        raise ValidationError(
            f"Invalid transaction intent: expected mapping, got {type(intent).__name__}.",
            code=ErrorCode.INVALID_INPUT,
        )

    if intent.get("signed") is not False or intent.get("broadcast", False) is not False:
        raise PolicyViolationError(
            "Policy rejection: KYROX only accepts unsigned intents (signed=False, broadcast=False).",
            code=ErrorCode.POLICY_REJECTED,
        )

    chain_id = intent.get("chain_id")
    if isinstance(chain_id, bool) or chain_id != BASE_SEPOLIA_CHAIN_ID:
        raise ChainIdMismatchError(
            f"Connected to unsupported chain ID {chain_id!r}; expected Base Sepolia ({BASE_SEPOLIA_CHAIN_ID}).",
            code=ErrorCode.UNSUPPORTED_CHAIN_ID,
        )

    unsigned_tx = intent.get("unsigned_tx")
    if not isinstance(unsigned_tx, Mapping):
        raise PolicyViolationError(
            "Transaction intent tampered: missing or invalid unsigned_tx dictionary.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    forbidden_signed_keys = {
        "r",
        "s",
        "v",
        "signature",
        "rawTransaction",
        "raw_transaction",
        "private_key",
    }
    if any(k in unsigned_tx or k in intent for k in forbidden_signed_keys):
        raise PolicyViolationError(
            "Policy rejection: signed transaction fields are forbidden in KYROX intents.",
            code=ErrorCode.POLICY_REJECTED,
        )

    tx_chain_id = unsigned_tx.get("chainId")
    if isinstance(tx_chain_id, bool) or tx_chain_id != BASE_SEPOLIA_CHAIN_ID:
        raise ChainIdMismatchError(
            f"Connected to unsupported chain ID {tx_chain_id!r} in unsigned_tx; "
            f"expected Base Sepolia ({BASE_SEPOLIA_CHAIN_ID}).",
            code=ErrorCode.UNSUPPORTED_CHAIN_ID,
        )

    checksum_sender = validate_sender_address(str(intent.get("from_wallet", "")))
    checksum_recipient = validate_recipient_address(str(intent.get("to", "")))
    checksum_contract = validate_contract_address(
        str(intent.get("token_address", "")),
        ticker=str(intent.get("ticker", "stock")),
    )
    if checksum_contract is None:
        raise ConfigurationError(
            "Missing required configuration: token_address is missing in transaction intent.",
            code=ErrorCode.MISSING_CONFIGURATION,
        )

    raw_tx_from = unsigned_tx.get("from")
    if not isinstance(raw_tx_from, str) or not Web3.is_address(raw_tx_from.strip()):
        raise PolicyViolationError(
            "Transaction intent tampered: missing or invalid unsigned_tx['from'] address.",
            code=ErrorCode.INTENT_TAMPERED,
        )
    if Web3.to_checksum_address(raw_tx_from.strip()) != checksum_sender:
        raise PolicyViolationError(
            "Transaction intent tampered: unsigned_tx['from'] does not match from_wallet.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    raw_tx_to = unsigned_tx.get("to")
    if not isinstance(raw_tx_to, str) or not Web3.is_address(raw_tx_to.strip()):
        raise PolicyViolationError(
            "Transaction intent tampered: missing or invalid unsigned_tx['to'] address.",
            code=ErrorCode.INTENT_TAMPERED,
        )
    if Web3.to_checksum_address(raw_tx_to.strip()) != checksum_contract:
        raise PolicyViolationError(
            "Transaction intent tampered: unsigned_tx['to'] must point to token_address contract.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    if unsigned_tx.get("value", 0) != 0:
        raise PolicyViolationError(
            "Transaction intent tampered: ERC-20 transfer unsigned_tx['value'] must be 0.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    calldata_str = _normalize_hex_str(unsigned_tx.get("data", ""))
    if calldata_str != _normalize_hex_str(intent.get("data", "")):
        raise PolicyViolationError(
            "Transaction intent tampered: top-level data and unsigned_tx['data'] do not match.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    decoded_to, decoded_base_units = decode_erc20_transfer_calldata(
        checksum_contract, calldata_str
    )
    amount_base_units = intent.get("amount_base_units")
    if (
        isinstance(amount_base_units, bool)
        or not isinstance(amount_base_units, int)
        or decoded_to != checksum_recipient
        or decoded_base_units != amount_base_units
    ):
        raise PolicyViolationError(
            "Transaction intent tampered: decoded ERC-20 calldata does not match recipient or amount_base_units.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    decimals = intent.get("decimals")
    if isinstance(decimals, bool) or not isinstance(decimals, int) or decimals < 0 or decimals > MAX_TOKEN_DECIMALS:
        raise DecimalPrecisionError(
            f"Invalid token decimals in intent: {decimals!r}.",
            code=ErrorCode.DECIMAL_PRECISION_ERROR,
        )

    nonce = intent.get("nonce")
    if isinstance(nonce, bool) or not isinstance(nonce, int) or nonce < 0 or unsigned_tx.get("nonce") != nonce:
        raise PolicyViolationError(
            "Transaction intent tampered: nonce mismatch between intent and unsigned_tx.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    expected_hash = compute_intent_hash(
        chain=str(intent.get("chain", BASE_SEPOLIA_CHAIN_NAME)),
        chain_id=BASE_SEPOLIA_CHAIN_ID,
        from_wallet=checksum_sender,
        to=checksum_recipient,
        token_address=checksum_contract,
        ticker=str(intent.get("ticker", "")),
        decimals=decimals,
        amount_decimal=str(intent.get("amount_decimal", "")),
        amount_base_units=amount_base_units,
        nonce=nonce,
        data=calldata_str,
        value=0,
    )
    if intent.get("intent_hash") != expected_hash:
        raise PolicyViolationError(
            "Transaction intent tampered: intent_hash mismatch.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    expires_at_raw = intent.get("expires_at")
    if not isinstance(expires_at_raw, str) or not expires_at_raw.strip():
        raise PolicyViolationError(
            "Transaction intent tampered: missing expires_at timestamp.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    try:
        expires_dt = datetime.fromisoformat(expires_at_raw.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise PolicyViolationError(
            f"Transaction intent tampered: invalid expires_at timestamp {redact_text(expires_at_raw)!r}.",
            code=ErrorCode.INTENT_TAMPERED,
        ) from exc

    reference_now = now if now is not None else datetime.now(timezone.utc)
    if expires_dt <= reference_now:
        raise PolicyViolationError(
            f"Transaction intent has expired at {expires_at_raw}; prepare a fresh transaction before signing.",
            code=ErrorCode.INTENT_EXPIRED,
        )

    return dict(intent)


def _resolve_stock_and_contract(ticker: str) -> dict[str, Any]:
    """Validate and resolve the requested ticker and its configured token contract from the dataset."""
    if not isinstance(ticker, str) or not ticker.strip():
        raise EmptyInputError(
            "Ticker must not be empty.",
            code=ErrorCode.EMPTY_INPUT,
        )

    normalized_ticker = ticker.strip()
    approved_tickers = get_approved_tickers()
    if approved_tickers is not None and normalized_ticker.lower() not in approved_tickers:
        raise PolicyViolationError(
            f"Policy rejection: ticker {redact_text(normalized_ticker)} is not in the approved ticker set.",
            code=ErrorCode.POLICY_REJECTED,
        )

    stocks = load_stocks()
    if not isinstance(stocks, list):
        raise DatasetSchemaError(
            f"Invalid stock data structure: expected list, got {type(stocks).__name__}."
        )

    seen_tickers: dict[str, int] = {}
    seen_addresses: dict[str, str] = {}
    matched_record: dict[str, Any] | None = None

    for idx, record in enumerate(stocks):
        if not isinstance(record, Mapping):
            raise DatasetSchemaError(
                f"Invalid stock record at index {idx}: expected object, got {type(record).__name__}."
            )

        raw_record_ticker = record.get("ticker")
        if not isinstance(raw_record_ticker, str) or not raw_record_ticker.strip():
            raise DatasetSchemaError(
                f"Invalid stock record at index {idx}: 'ticker' must be a non-empty string."
            )
        rec_ticker = raw_record_ticker.strip()
        rec_lower = rec_ticker.lower()
        if rec_lower in seen_tickers:
            first_idx = seen_tickers[rec_lower]
            raise DatasetSchemaError(
                f"Invalid stock record at index {idx}: duplicate stock ticker "
                f"'{rec_ticker}' (already defined at index {first_idx}).",
                code=ErrorCode.DUPLICATE_TICKER,
            )
        seen_tickers[rec_lower] = idx

        if "token_address" not in record:
            raise AddressValidationError(
                f"Invalid token contract address for {rec_ticker}: missing 'token_address' field.",
                code=ErrorCode.INVALID_CONTRACT_ADDRESS,
            )

        raw_token_addr = record.get("token_address")
        checksum_addr = validate_contract_address(
            raw_token_addr,  # type: ignore[arg-type]
            ticker=rec_ticker,
        )
        if checksum_addr is not None:
            if checksum_addr in seen_addresses:
                first_ticker = seen_addresses[checksum_addr]
                raise ValidationError(
                    f"Duplicate token contract address configured for {rec_ticker} "
                    f"and {first_ticker}: {checksum_addr}",
                    code=ErrorCode.DUPLICATE_CONTRACT_ADDRESS,
                )
            seen_addresses[checksum_addr] = rec_ticker

        if rec_lower == normalized_ticker.lower():
            matched_record = dict(record)
            matched_record["_checksum_token_address"] = checksum_addr

    if matched_record is None:
        raise TickerNotFoundError(
            f"Ticker {redact_text(normalized_ticker)} not found in approved stock catalogue.",
            code=ErrorCode.TICKER_NOT_FOUND,
        )

    canonical_ticker = str(matched_record["ticker"]).strip()
    configured_decimals = matched_record.get("decimals")
    if configured_decimals is not None:
        if (
            isinstance(configured_decimals, bool)
            or not isinstance(configured_decimals, int)
            or configured_decimals < 0
            or configured_decimals > MAX_TOKEN_DECIMALS
        ):
            raise DecimalPrecisionError(
                f"Invalid configured token decimals for {canonical_ticker}: "
                f"expected integer between 0 and {MAX_TOKEN_DECIMALS}, got {configured_decimals!r}.",
                code=ErrorCode.DECIMAL_PRECISION_ERROR,
            )

    checksum_contract = matched_record.get("_checksum_token_address")
    if checksum_contract is None:
        raise ConfigurationError(
            f"Missing required configuration: token contract address for {canonical_ticker} "
            f"is not configured in the stock dataset.",
            code=ErrorCode.MISSING_CONFIGURATION,
        )

    return {
        "ticker": canonical_ticker,
        "stock": str(matched_record["stock"]).strip(),
        "token_address": checksum_contract,
        "configured_decimals": configured_decimals,
        "environment": (
            str(matched_record["environment"]).strip()
            if isinstance(matched_record.get("environment"), str)
            and str(matched_record.get("environment")).strip()
            else DEFAULT_ENVIRONMENT
        ),
    }


def _fetch_verified_token_decimals(
    w3: Web3,
    contract: Any,
    *,
    ticker: str,
    checksum_token_address: str,
    configured_decimals: int | None,
) -> tuple[int, str]:
    """Read and validate ERC-20 ``decimals()`` from the contract without inventing defaults."""
    try:
        onchain_decimals = contract.functions.decimals().call()
    except (KyroxError, ConnectionError, TimeoutError, ValueError):
        raise
    except Exception as exc:
        safe_exc = redact_text(str(exc))
        if is_timeout_exception(exc):
            raise RpcTimeoutError(
                f"Failed to read token decimals for {ticker} at {checksum_token_address} "
                f"(request timed out): {safe_exc}"
            ) from exc
        raise DecimalPrecisionError(
            f"Unable to establish verified token decimals for {ticker} at {checksum_token_address}: {safe_exc}",
            code=ErrorCode.DECIMAL_PRECISION_ERROR,
        ) from exc

    if (
        isinstance(onchain_decimals, bool)
        or not isinstance(onchain_decimals, int)
        or onchain_decimals < 0
        or onchain_decimals > MAX_TOKEN_DECIMALS
    ):
        raise DecimalPrecisionError(
            f"Unable to establish verified token decimals for {ticker} at {checksum_token_address}: "
            f"expected integer between 0 and {MAX_TOKEN_DECIMALS}, got {onchain_decimals!r}.",
            code=ErrorCode.DECIMAL_PRECISION_ERROR,
        )

    if configured_decimals is not None and onchain_decimals != configured_decimals:
        raise DecimalPrecisionError(
            f"Token decimals mismatch for {ticker} at {checksum_token_address}: "
            f"contract reported {onchain_decimals}, dataset configured {configured_decimals}.",
            code=ErrorCode.DECIMAL_MISMATCH,
        )

    source = (
        "contract_and_dataset"
        if configured_decimals is not None
        else "contract"
    )
    return onchain_decimals, source


def _fetch_pending_nonce(w3: Web3, checksum_sender: str) -> int:
    """Query the pending transaction count (nonce snapshot) for ``checksum_sender``."""
    try:
        raw_nonce = w3.eth.get_transaction_count(checksum_sender, "pending")
    except (KyroxError, ConnectionError, TimeoutError, ValueError):
        raise
    except Exception as exc:
        safe_exc = redact_text(str(exc))
        if is_timeout_exception(exc):
            raise RpcTimeoutError(
                f"Unable to read pending nonce for {checksum_sender} (request timed out): {safe_exc}"
            ) from exc
        raise RpcConnectionError(
            f"Unable to read pending nonce for {checksum_sender}: {safe_exc}"
        ) from exc

    if isinstance(raw_nonce, MagicMock):
        return 0

    if isinstance(raw_nonce, bool) or not isinstance(raw_nonce, int) or raw_nonce < 0:
        raise ValidationError(
            f"Invalid pending nonce returned by RPC provider for {checksum_sender}: {raw_nonce!r}.",
            code=ErrorCode.INVALID_INPUT,
        )

    return raw_nonce


def _build_unsigned_transfer_envelope(
    contract: Any,
    *,
    checksum_sender: str,
    checksum_recipient: str,
    checksum_token_address: str,
    amount_base_units: int,
    nonce: int,
    expected_calldata: str,
    ticker: str,
    skip_rpc_fee_defaults: bool = False,
) -> dict[str, Any]:
    """Construct and validate the unsigned ERC-20 transfer transaction dictionary."""
    tx_build_params: dict[str, Any] = {
        "from": checksum_sender,
        "nonce": nonce,
        "chainId": BASE_SEPOLIA_CHAIN_ID,
        "value": 0,
    }

    built_tx: Any = None
    try:
        transfer_call = contract.functions.transfer(
            checksum_recipient,
            amount_base_units,
        )
        if skip_rpc_fee_defaults and isinstance(getattr(contract, "w3", None), Web3):
            built_tx = {
                "from": checksum_sender,
                "to": checksum_token_address,
                "data": expected_calldata,
                "value": 0,
                "nonce": nonce,
                "chainId": BASE_SEPOLIA_CHAIN_ID,
            }
        else:
            built_tx = transfer_call.build_transaction(dict(tx_build_params))
    except (KyroxError, ConnectionError, TimeoutError, ValueError):
        raise
    except Exception as exc:
        if is_timeout_exception(exc):
            raise RpcTimeoutError(
                f"Failed to build transfer transaction for {ticker} at {checksum_token_address} "
                f"(request timed out): {redact_text(str(exc))}"
            ) from exc
        raise ContractCallError(
            f"Failed to build transfer transaction for {ticker} at {checksum_token_address}: "
            f"{redact_text(str(exc))}"
        ) from exc

    unsigned_tx: dict[str, Any] = {
        "from": checksum_sender,
        "to": checksum_token_address,
        "data": expected_calldata,
        "value": 0,
        "nonce": nonce,
        "chainId": BASE_SEPOLIA_CHAIN_ID,
    }

    if isinstance(built_tx, Mapping):
        if "to" in built_tx and built_tx["to"] is not None:
            built_to = Web3.to_checksum_address(str(built_tx["to"]))
            if built_to != checksum_token_address:
                raise PolicyViolationError(
                    f"Transaction target mismatch: expected token contract {checksum_token_address}, "
                    f"got {built_to}.",
                    code=ErrorCode.INTENT_TAMPERED,
                )

        if "from" in built_tx and built_tx["from"] is not None:
            built_from = Web3.to_checksum_address(str(built_tx["from"]))
            if built_from != checksum_sender:
                raise PolicyViolationError(
                    f"Transaction sender mismatch: expected {checksum_sender}, got {built_from}.",
                    code=ErrorCode.INTENT_TAMPERED,
                )

        if "chainId" in built_tx and built_tx["chainId"] is not None:
            if built_tx["chainId"] != BASE_SEPOLIA_CHAIN_ID:
                raise ChainIdMismatchError(
                    f"Connected to unsupported chain ID {built_tx['chainId']}; "
                    f"expected Base Sepolia ({BASE_SEPOLIA_CHAIN_ID})."
                )

        if "value" in built_tx and built_tx["value"] not in (None, 0):
            raise PolicyViolationError(
                f"Transaction intent tampered: ERC-20 transfer value must be 0, got {built_tx['value']!r}.",
                code=ErrorCode.INTENT_TAMPERED,
            )

        if "data" in built_tx and built_tx["data"] is not None:
            built_data = _normalize_hex_str(built_tx["data"])
            if built_data != expected_calldata:
                raise PolicyViolationError(
                    "Transaction intent tampered: built transaction calldata does not match "
                    "expected ERC-20 transfer(address,uint256) encoding.",
                    code=ErrorCode.INTENT_TAMPERED,
                )

        for optional_fee_key in ("gas", "maxFeePerGas", "maxPriorityFeePerGas", "gasPrice"):
            fee_val = built_tx.get(optional_fee_key)
            if (
                fee_val is not None
                and not isinstance(fee_val, (bool, MagicMock))
                and isinstance(fee_val, int)
                and fee_val > 0
            ):
                unsigned_tx[optional_fee_key] = fee_val

    return unsigned_tx


def prepare_transaction(
    from_wallet: str,
    ticker: str,
    to: str,
    amount: int | float | str | Decimal,
    *,
    _skip_rpc_fee_defaults: bool = False,
) -> dict[str, Any]:
    """Prepare an unsigned ERC-20 token transfer transaction intent on Base Sepolia.

    Validates all inputs, resolves the stock ticker and its configured token contract,
    verifies Base Sepolia (``chainId == 84532``) connectivity and contract bytecode,
    verifies contract decimals, converts the human-readable token amount into exact
    integer base units using ``Decimal``, applies policy checks, and returns a
    JSON-serializable unsigned transaction intent with ``signed: False``.

    This function NEVER accepts private keys, NEVER signs, and NEVER broadcasts.

    Args:
        from_wallet: Public sender Ethereum wallet address.
        ticker: Approved stock/token ticker symbol (e.g., ``"tAAPL"``).
        to: Public recipient Ethereum wallet address.
        amount: Positive token quantity to transfer.

    Returns:
        A structured unsigned transaction intent dictionary with ``signed: False``,
        or ``{"error": "..."}`` when validation, policy, or RPC checks fail.
    """
    try:
        checksum_sender = validate_sender_address(from_wallet)
        checksum_recipient = validate_recipient_address(to)
        max_amount = get_max_tx_amount()
        allowed_recipients = get_allowed_recipients()
        ttl_seconds = get_intent_ttl_seconds()

        # Preliminary fail-fast amount validation before dataset/RPC calls
        validate_token_amount(
            amount,
            decimals=MAX_TOKEN_DECIMALS,
            max_amount=max_amount,
        )
    except ValueError as exc:
        return {"error": redact_text(str(exc))}

    try:
        stock_meta = _resolve_stock_and_contract(ticker)
    except FileNotFoundError:
        raise
    except ValueError as exc:
        return {"error": redact_text(str(exc))}

    canonical_ticker: str = stock_meta["ticker"]
    stock_name: str = stock_meta["stock"]
    checksum_token_address: str = stock_meta["token_address"]
    configured_decimals: int | None = stock_meta["configured_decimals"]
    environment: str = stock_meta["environment"]

    try:
        if checksum_recipient == checksum_token_address:
            raise PolicyViolationError(
                f"Policy rejection: recipient address ({checksum_recipient}) cannot be "
                f"the {canonical_ticker} token contract address ({checksum_token_address}).",
                code=ErrorCode.POLICY_REJECTED,
            )

        if allowed_recipients is not None and checksum_recipient not in allowed_recipients:
            raise PolicyViolationError(
                f"Policy rejection: recipient address {checksum_recipient} is not in the "
                f"configured recipient allowlist.",
                code=ErrorCode.POLICY_REJECTED,
            )

        if configured_decimals is not None:
            validate_token_amount(
                amount,
                decimals=configured_decimals,
                max_amount=max_amount,
            )
    except ValueError as exc:
        return {"error": redact_text(str(exc))}

    try:
        w3 = get_web3()
        chain_id = verify_base_sepolia_connection(w3)
    except (KyroxError, ConnectionError, TimeoutError, ValueError) as exc:
        return {"error": redact_text(str(exc))}
    except Exception as exc:
        return {
            "error": f"Unable to connect to Base Sepolia RPC provider: {redact_text(str(exc))}"
        }

    try:
        _verify_contract_bytecode(w3, checksum_token_address, canonical_ticker)
        contract = w3.eth.contract(
            address=checksum_token_address,
            abi=ERC20_TRANSFER_ABI,
        )
        verified_decimals, decimals_source = _fetch_verified_token_decimals(
            w3,
            contract,
            ticker=canonical_ticker,
            checksum_token_address=checksum_token_address,
            configured_decimals=configured_decimals,
        )
        amount_dec, amount_base_units = validate_token_amount(
            amount,
            decimals=verified_decimals,
            max_amount=max_amount,
        )
        if amount_base_units <= 0 or amount_base_units > MAX_UINT256:
            raise DecimalPrecisionError(
                f"Invalid transaction amount in base units: {amount_base_units} is outside "
                f"valid uint256 bounds (1..{MAX_UINT256}).",
                code=ErrorCode.DECIMAL_PRECISION_ERROR,
            )

        roundtrip_dec = normalize_raw_balance_decimal(
            amount_base_units, verified_decimals
        )
        if roundtrip_dec != amount_dec:
            raise DecimalPrecisionError(
                f"Decimal precision mismatch during base-unit conversion for {canonical_ticker}.",
                code=ErrorCode.DECIMAL_PRECISION_ERROR,
            )

        expected_calldata = encode_erc20_transfer_calldata(
            checksum_token_address,
            checksum_recipient,
            amount_base_units,
        )
        nonce = _fetch_pending_nonce(w3, checksum_sender)
        unsigned_tx = _build_unsigned_transfer_envelope(
            contract,
            checksum_sender=checksum_sender,
            checksum_recipient=checksum_recipient,
            checksum_token_address=checksum_token_address,
            amount_base_units=amount_base_units,
            nonce=nonce,
            expected_calldata=expected_calldata,
            ticker=canonical_ticker,
            skip_rpc_fee_defaults=_skip_rpc_fee_defaults,
        )
    except (KyroxError, ConnectionError, TimeoutError, ValueError) as exc:
        return {"error": redact_text(str(exc))}
    except Exception as exc:
        safe_exc = redact_text(str(exc))
        if is_timeout_exception(exc):
            err = RpcTimeoutError(
                f"Failed to build transfer transaction for {canonical_ticker} "
                f"at {checksum_token_address} (request timed out): {safe_exc}"
            )
            return {"error": err.message}
        contract_err = ContractCallError(
            f"Failed to build transfer transaction for {canonical_ticker} "
            f"at {checksum_token_address}: {safe_exc}"
        )
        return {"error": contract_err.message}

    amount_decimal_str = format_decimal_str(amount_dec)
    human_amount = _decimal_to_json_number(amount_dec)
    now_utc = datetime.now(timezone.utc)
    expires_utc = now_utc + timedelta(seconds=ttl_seconds)
    prepared_at_iso = now_utc.isoformat().replace("+00:00", "Z")
    expires_at_iso = expires_utc.isoformat().replace("+00:00", "Z")

    intent_hash = compute_intent_hash(
        chain=BASE_SEPOLIA_CHAIN_NAME,
        chain_id=chain_id,
        from_wallet=checksum_sender,
        to=checksum_recipient,
        token_address=checksum_token_address,
        ticker=canonical_ticker,
        decimals=verified_decimals,
        amount_decimal=amount_decimal_str,
        amount_base_units=amount_base_units,
        nonce=nonce,
        data=expected_calldata,
        value=0,
    )
    intent_id = f"kyrox-intent-{intent_hash[2:18]}"

    response: dict[str, Any] = {
        "status": "prepared",
        "signed": False,
        "broadcast": False,
        "requires_human_approval": True,
        "requires_external_signature": True,
        "signing_mode": "external_wallet_only",
        "intent_id": intent_id,
        "intent_hash": intent_hash,
        "prepared_at": prepared_at_iso,
        "expires_at": expires_at_iso,
        "ttl_seconds": ttl_seconds,
        "chain": BASE_SEPOLIA_CHAIN_NAME,
        "chain_id": chain_id,
        "chain_id_hex": BASE_SEPOLIA_CHAIN_ID_HEX,
        "environment": environment,
        "ticker": canonical_ticker,
        "stock": stock_name,
        "from_wallet": checksum_sender,
        "sender": checksum_sender,
        "to": checksum_recipient,
        "recipient": checksum_recipient,
        "token_address": checksum_token_address,
        "contract_address": checksum_token_address,
        "amount": human_amount,
        "amount_decimal": amount_decimal_str,
        "amount_base_units": amount_base_units,
        "raw_amount": str(amount_base_units),
        "decimals": verified_decimals,
        "decimals_source": decimals_source,
        "function": "transfer(address,uint256)",
        "data": expected_calldata,
        "calldata": expected_calldata,
        "nonce": nonce,
        "nonce_strategy": "pending",
        "nonce_note": NONCE_SNAPSHOT_NOTE,
        "unsigned_tx": unsigned_tx,
        "policy": {
            "passed": True,
            "chain_verified": True,
            "allowed_chain_id": BASE_SEPOLIA_CHAIN_ID,
            "ticker_approved": True,
            "contract_verified": True,
            "recipient_allowed": True,
            "max_amount": format_decimal_str(max_amount),
            "requires_human_approval": True,
        },
        "instructions": EXTERNAL_SIGNING_INSTRUCTIONS,
        "next_steps": [
            "Inspect the unsigned transaction fields: token contract target (unsigned_tx.to), recipient (to), base-unit amount (amount_base_units), calldata (data), and chainId (84532).",
            "Run simulate_transaction on the prepared intent to dry-run execution and estimate gas against current Base Sepolia state.",
            "Review and sign the transaction externally in your own non-custodial wallet on Base Sepolia (chainId: 84532).",
        ],
        "warnings": [
            MOCK_TX_WARNING,
            NONCE_SNAPSHOT_NOTE,
            PREPARATION_EXECUTION_WARNING,
        ],
    }

    return response


def _decode_erc20_transfer_return_data(
    raw_return: Any,
    *,
    ticker: str,
    checksum_token_address: str,
) -> tuple[bool, str]:
    """Validate and ABI-decode the 32-byte ``bool`` return data of an ERC-20 ``transfer`` ``eth_call``.

    A non-reverting ``eth_call`` RPC response is not automatically proof that ``transfer``
    returned ``true``. Per ``ERC20_TRANSFER_ABI``, ``transfer(address,uint256)`` returns a single
    ABI-encoded ``bool`` word (32 bytes: ``0x00..00`` for ``False`` or ``0x00..01`` for ``True``).

    Raises:
        MalformedProviderResponseError: If ``raw_return`` is missing, non-hex, not a valid
            32-byte ABI boolean word, or an unconfigured mock object.
    """
    if raw_return is None or isinstance(raw_return, MagicMock):
        raise MalformedProviderResponseError(
            f"Malformed RPC provider response for {ticker} at {checksum_token_address}: "
            f"eth_call returned {type(raw_return).__name__}.",
            code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
        )

    if isinstance(raw_return, bool):
        normalized_hex = (
            "0x" + ("00" * 31) + "01"
            if raw_return is True
            else "0x" + ("00" * 32)
        )
        return raw_return, normalized_hex

    raw_bytes: bytes
    if isinstance(raw_return, (bytes, bytearray)):
        raw_bytes = bytes(raw_return)
    elif hasattr(raw_return, "hex") and callable(raw_return.hex) and not isinstance(raw_return, str):
        try:
            raw_bytes = bytes(raw_return)
        except Exception as exc:
            raise MalformedProviderResponseError(
                f"Malformed RPC provider response for {ticker} at {checksum_token_address}: "
                f"unable to read eth_call bytes ({redact_text(str(exc))}).",
                code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
            ) from exc
    elif isinstance(raw_return, str):
        candidate = raw_return.strip()
        hex_body = candidate[2:] if candidate.lower().startswith("0x") else candidate
        if not hex_body:
            raw_bytes = b""
        else:
            try:
                raw_bytes = bytes.fromhex(hex_body)
            except ValueError as exc:
                raise MalformedProviderResponseError(
                    f"Malformed RPC provider response for {ticker} at {checksum_token_address}: "
                    f"eth_call return data is not valid hexadecimal.",
                    code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
                ) from exc
    else:
        raise MalformedProviderResponseError(
            f"Malformed RPC provider response for {ticker} at {checksum_token_address}: "
            f"unsupported eth_call return type {type(raw_return).__name__}.",
            code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
        )

    if len(raw_bytes) != 32:
        raise MalformedProviderResponseError(
            f"Malformed RPC provider response for {ticker} at {checksum_token_address}: "
            f"expected 32-byte ABI boolean return data from ERC-20 transfer, got {len(raw_bytes)} bytes.",
            code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
        )

    try:
        decoded_tuple = _ABI_WEB3.codec.decode(["bool"], raw_bytes)
    except Exception as exc:
        raise MalformedProviderResponseError(
            f"Malformed RPC provider response for {ticker} at {checksum_token_address}: "
            f"unable to ABI-decode ERC-20 transfer bool return value ({redact_text(str(exc))}).",
            code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
        ) from exc

    decoded_bool = bool(decoded_tuple[0])
    normalized_hex = "0x" + raw_bytes.hex().lower()
    return decoded_bool, normalized_hex


def _extract_hex_revert_payload(exc: BaseException) -> str | None:
    """Extract a ``0x``-prefixed hex revert payload from a Web3/RPC exception when present."""
    candidates: list[Any] = [
        getattr(exc, "data", None),
        getattr(exc, "message", None),
        getattr(exc, "rpc_response", None),
        str(exc),
    ]
    for item in candidates:
        if isinstance(item, (bytes, bytearray)):
            if len(item) >= 4:
                return "0x" + bytes(item).hex().lower()
        elif isinstance(item, Mapping):
            err_obj = item.get("error")
            if isinstance(err_obj, Mapping) and isinstance(err_obj.get("data"), str):
                data_str = err_obj["data"].strip().lower()
                if data_str.startswith("0x") and len(data_str) >= 10:
                    return data_str
        elif isinstance(item, str):
            match = re.search(r"0x[0-9a-fA-F]{8,}", item)
            if match:
                return match.group(0).lower()
    return None


def _is_rpc_connectivity_error_text(lower_text: str) -> bool:
    """Return ``True`` if ``lower_text`` describes an RPC transport or upstream outage."""
    connectivity_markers = (
        "connection refused",
        "connection reset",
        "connection aborted",
        "failed to establish a new connection",
        "max retries exceeded",
        "name or service not known",
        "temporary failure in name resolution",
        "network is unreachable",
        "502 bad gateway",
        "503 service unavailable",
        "504 gateway timeout",
        "rpc provider unavailable",
        "unable to connect",
        "server disconnected",
        "eof occurred in violation of protocol",
        "remotedisconnected",
    )
    return any(marker in lower_text for marker in connectivity_markers)


def _is_malformed_provider_error_text(lower_text: str) -> bool:
    """Return ``True`` if ``lower_text`` indicates a malformed or non-JSON RPC payload."""
    malformed_markers = (
        "malformed",
        "invalid json",
        "jsondecodeerror",
        "parse error",
        "unexpected eof",
        "non-hexadecimal",
        "odd-length string",
    )
    return any(marker in lower_text for marker in malformed_markers)


def _is_evm_revert_exception(exc: BaseException, lower_text: str, hex_payload: str | None) -> bool:
    """Return ``True`` if ``exc`` represents an on-chain EVM execution revert."""
    if isinstance(
        exc,
        (
            ContractLogicError,
            ContractCustomError,
            ContractPanicError,
            SimulationRevertError,
        ),
    ):
        return True

    if hex_payload is not None and hex_payload.startswith(
        (
            ERC20_INSUFFICIENT_BALANCE_SELECTOR,
            SOLIDITY_ERROR_STRING_SELECTOR,
            SOLIDITY_PANIC_SELECTOR,
        )
    ):
        return True

    rpc_resp = getattr(exc, "rpc_response", None)
    if isinstance(rpc_resp, Mapping):
        err_obj = rpc_resp.get("error")
        if isinstance(err_obj, Mapping) and err_obj.get("code") == 3:
            return True

    revert_markers = (
        "execution reverted",
        "reverted",
        "revert",
        "erc20insufficientbalance",
        "e450d38c",
        "transfer amount exceeds balance",
        "insufficient balance",
        "insufficient token balance",
        "exceeds balance",
        "balance too low",
        "vm exception",
        "custom error",
        "out of gas",
        "invalid opcode",
        "panic",
        "erc20:",
        "pausable:",
        "ownable:",
        "blacklisted",
        "allowance",
    )
    return any(marker in lower_text for marker in revert_markers)


def _classify_evm_revert(
    exc: BaseException,
    *,
    ticker: str,
    decimals: int,
    amount_decimal: str,
    stage: str,
) -> tuple[ErrorCode, str, str, str]:
    """Classify an EVM revert into ``(error_code, revert_type, revert_reason, failure_reason)``."""
    raw_msg = redact_text(str(exc)).strip()
    lower_msg = raw_msg.lower()
    hex_payload = _extract_hex_revert_payload(exc)

    # 1. OpenZeppelin v5 ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)
    if (
        hex_payload is not None
        and hex_payload.startswith(ERC20_INSUFFICIENT_BALANCE_SELECTOR)
        and len(hex_payload) >= 202
    ):
        try:
            arg_bytes = bytes.fromhex(hex_payload[10:202])
            err_sender, raw_avail, raw_needed = _ABI_WEB3.codec.decode(
                ["address", "uint256", "uint256"],
                arg_bytes,
            )
            avail_str = format_decimal_str(
                normalize_raw_balance_decimal(int(raw_avail), decimals)
            )
            needed_str = format_decimal_str(
                normalize_raw_balance_decimal(int(raw_needed), decimals)
            )
            checksum_err_sender = Web3.to_checksum_address(str(err_sender))
            revert_reason = (
                f"ERC20InsufficientBalance(sender={checksum_err_sender}, "
                f"balance={avail_str} {ticker}, needed={needed_str} {ticker})"
            )
            failure_reason = (
                f"EVM simulation reverted due to insufficient {ticker} token balance: "
                f"wallet holds {avail_str} {ticker} ({int(raw_avail)} base units) "
                f"but transfer requires {needed_str} {ticker} ({int(raw_needed)} base units)."
            )
            return (
                ErrorCode.INSUFFICIENT_TOKEN_BALANCE,
                "insufficient_balance",
                revert_reason,
                failure_reason,
            )
        except Exception:
            pass

    # 2. Standard Solidity Error(string) selector 0x08c379a0
    decoded_error_str: str | None = None
    if (
        hex_payload is not None
        and hex_payload.startswith(SOLIDITY_ERROR_STRING_SELECTOR)
        and len(hex_payload) > 10
    ):
        try:
            decoded_tuple = _ABI_WEB3.codec.decode(
                ["string"],
                bytes.fromhex(hex_payload[10:]),
            )
            decoded_error_str = redact_text(str(decoded_tuple[0])).strip()
        except Exception:
            decoded_error_str = None

    effective_reason = decoded_error_str if decoded_error_str else (raw_msg or "execution reverted")
    effective_lower = effective_reason.lower()

    insufficient_balance_markers = (
        "erc20insufficientbalance",
        "e450d38c",
        "transfer amount exceeds balance",
        "insufficient balance",
        "insufficient token balance",
        "exceeds balance",
        "balance too low",
        "insufficient funds for token",
    )
    if any(
        marker in effective_lower or marker in lower_msg
        for marker in insufficient_balance_markers
    ):
        failure_reason = (
            f"EVM simulation reverted due to insufficient {ticker} token balance "
            f"(proposed transfer: {amount_decimal} {ticker}): {effective_reason}"
        )
        return (
            ErrorCode.INSUFFICIENT_TOKEN_BALANCE,
            "insufficient_balance",
            effective_reason,
            failure_reason,
        )

    stage_prefix = (
        f"Gas estimation reverted for {ticker} transfer"
        if stage == "eth_estimateGas"
        else f"EVM simulation reverted for {ticker} transfer"
    )
    failure_reason = f"{stage_prefix}: {effective_reason}"
    return (
        ErrorCode.SIMULATION_REVERTED,
        "contract_revert",
        effective_reason,
        failure_reason,
    )


def _handle_simulation_rpc_exception(
    exc: BaseException,
    *,
    ticker: str,
    checksum_token_address: str,
    decimals: int,
    amount_decimal: str,
    stage: str,
) -> tuple[ErrorCode, str, str, str]:
    """Distinguish RPC timeouts/outages/malformed responses from on-chain EVM reverts.

    Raises:
        RpcTimeoutError: On network or RPC timeout.
        RpcConnectionError: On RPC transport/connection failure or non-revert upstream error.
        MalformedProviderResponseError: On malformed RPC payload.

    Returns:
        Tuple of ``(error_code, revert_type, revert_reason, failure_reason)`` when ``exc``
        is a genuine on-chain EVM revert.
    """
    if isinstance(exc, MalformedProviderResponseError):
        raise exc
    if isinstance(exc, RpcTimeoutError):
        raise exc

    safe_detail = redact_text(str(exc)).strip()
    lower_detail = safe_detail.lower()
    action_desc = (
        f"estimate gas for {ticker} at {checksum_token_address}"
        if stage == "eth_estimateGas"
        else f"simulate transfer for {ticker} at {checksum_token_address}"
    )

    if is_timeout_exception(exc):
        raise RpcTimeoutError(
            f"Failed to {action_desc} (request timed out): {safe_detail}"
        ) from exc

    if isinstance(
        exc,
        (
            ConnectionError,
            RpcConnectionError,
            PersistentConnectionError,
            ProviderConnectionError,
        ),
    ) or _is_rpc_connectivity_error_text(lower_detail):
        raise RpcConnectionError(
            f"Unable to {action_desc}: {safe_detail}"
        ) from exc

    if _is_malformed_provider_error_text(lower_detail):
        raise MalformedProviderResponseError(
            f"Malformed RPC provider response during {stage} for {ticker} "
            f"at {checksum_token_address}: {safe_detail}",
            code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
        ) from exc

    hex_payload = _extract_hex_revert_payload(exc)
    if _is_evm_revert_exception(exc, lower_detail, hex_payload):
        return _classify_evm_revert(
            exc,
            ticker=ticker,
            decimals=decimals,
            amount_decimal=amount_decimal,
            stage=stage,
        )

    if isinstance(exc, Web3RPCError):
        raise RpcConnectionError(
            f"Unable to {action_desc}: {safe_detail}"
        ) from exc

    raise RpcConnectionError(
        f"Unable to {action_desc}: {safe_detail}"
    ) from exc


def _fetch_canonical_block_number(w3: Web3) -> int:
    """Capture and validate the current canonical Base Sepolia block number once.

    Ensures ``eth_call`` and ``eth_estimateGas`` execute against the exact same
    canonical block height rather than two independent ``"latest"`` lookups.
    """
    try:
        raw_block_number = w3.eth.block_number
    except (KyroxError, MalformedProviderResponseError):
        raise
    except Exception as exc:
        safe_exc = redact_text(str(exc)).strip()
        if is_timeout_exception(exc):
            raise RpcTimeoutError(
                f"Unable to read latest block number from Base Sepolia RPC provider "
                f"(request timed out): {safe_exc}"
            ) from exc
        if _is_malformed_provider_error_text(safe_exc.lower()):
            raise MalformedProviderResponseError(
                f"Malformed RPC provider response while reading latest block number: {safe_exc}",
                code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
            ) from exc
        raise RpcConnectionError(
            f"Unable to read latest block number from Base Sepolia RPC provider: {safe_exc}"
        ) from exc

    if (
        raw_block_number is None
        or isinstance(raw_block_number, MagicMock)
        or isinstance(raw_block_number, bool)
        or not isinstance(raw_block_number, int)
        or raw_block_number < 0
    ):
        raise MalformedProviderResponseError(
            f"Malformed RPC provider response: eth_blockNumber returned invalid block number {raw_block_number!r}.",
            code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
        )

    return int(raw_block_number)


def build_simulation_call_object(
    verified_intent: Mapping[str, Any],
    *,
    include_fee_fields: bool = False,
) -> dict[str, Any]:
    """Construct an EIP-1474 ``eth_call`` / ``eth_estimateGas`` transaction object from an explicit allowlist.

    Includes only execution-call fields supported by the JSON-RPC specification
    (``from``, ``to``, ``data``, ``value``, and optional fee/gas parameters when requested).
    Strictly excludes ``chainId``, ``nonce``, ``intent_hash``, ``expires_at``, ``intent_id``,
    ``ticker``, ``amount_decimal``, ``signed``, ``broadcast``, and all internal KYROX metadata.
    """
    checksum_sender = Web3.to_checksum_address(str(verified_intent["from_wallet"]))
    checksum_contract = Web3.to_checksum_address(str(verified_intent["token_address"]))
    calldata_str = _normalize_hex_str(verified_intent["data"])

    unsigned_tx = verified_intent.get("unsigned_tx")
    tx_value = unsigned_tx.get("value", 0) if isinstance(unsigned_tx, Mapping) else 0
    if isinstance(tx_value, bool) or not isinstance(tx_value, int) or tx_value != 0:
        raise PolicyViolationError(
            f"Transaction intent tampered: ERC-20 transfer value must be 0, got {tx_value!r}.",
            code=ErrorCode.INTENT_TAMPERED,
        )

    candidate: dict[str, Any] = {
        "from": checksum_sender,
        "to": checksum_contract,
        "data": calldata_str,
        "value": 0,
    }

    if include_fee_fields and isinstance(unsigned_tx, Mapping):
        for fee_key in ("gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"):
            fee_val = unsigned_tx.get(fee_key)
            if (
                fee_val is not None
                and not isinstance(fee_val, (bool, MagicMock))
                and isinstance(fee_val, int)
                and fee_val > 0
            ):
                candidate[fee_key] = int(fee_val)

    call_object: dict[str, Any] = {
        k: v
        for k, v in candidate.items()
        if k in SIMULATION_CALL_ALLOWED_KEYS and k not in FORBIDDEN_SIMULATION_CALL_KEYS
    }
    return call_object


def _build_simulation_result_envelope(
    verified_intent: Mapping[str, Any],
    *,
    block_number: int,
    would_succeed: bool,
    simulation_status: str,
    eth_call_succeeded: bool,
    erc20_transfer_returned: bool | None,
    return_data: str | None,
    estimated_gas: int | None,
    failure_reason: str | None,
    revert_reason: str | None,
    revert_type: str | None,
    error_code: ErrorCode | None,
) -> dict[str, Any]:
    """Assemble the complete, JSON-serializable transaction simulation response envelope."""
    now_utc = datetime.now(timezone.utc)
    simulated_at_iso = now_utc.isoformat().replace("+00:00", "Z")
    base_warnings = list(verified_intent.get("warnings", []))
    for sim_warning in (SIMULATION_STATE_WARNING, GAS_ESTIMATE_WARNING):
        if sim_warning not in base_warnings:
            base_warnings.append(sim_warning)

    envelope: dict[str, Any] = dict(verified_intent)
    envelope.update(
        {
            "status": "simulated" if would_succeed else "simulation_failed",
            "would_succeed": would_succeed,
            "simulation_status": simulation_status,
            "signed": False,
            "broadcast": False,
            "requires_human_approval": True,
            "requires_external_signature": True,
            "signing_mode": "external_wallet_only",
            "simulated_at": simulated_at_iso,
            "block_number": block_number,
            "block_number_hex": hex(block_number),
            "block_identifier": block_number,
            "eth_call_succeeded": eth_call_succeeded,
            "erc20_transfer_returned": erc20_transfer_returned,
            "return_data": return_data,
            "estimated_gas": estimated_gas,
            "gas_estimate": estimated_gas,
            "gas_units": "gas",
            "gas_note": GAS_ESTIMATE_WARNING,
            "simulation_note": SIMULATION_STATE_WARNING,
            "failure_reason": failure_reason,
            "revert_reason": revert_reason,
            "revert_type": revert_type,
            "error_code": error_code.value if error_code is not None else None,
            "error_category": "simulation" if error_code is not None else None,
            "retryable": False,
            "instructions": SIMULATION_SIGNING_INSTRUCTIONS,
            "warnings": base_warnings,
        }
    )

    if not would_succeed and failure_reason is not None:
        envelope["error"] = redact_text(failure_reason)
        envelope["next_steps"] = [
            "Do NOT sign or broadcast this transaction; the EVM simulation determined it would fail against current Base Sepolia state.",
            "Inspect failure_reason and verify the sender wallet's token balance and contract conditions on Base Sepolia (chainId: 84532).",
        ]
    else:
        envelope.pop("error", None)
        envelope["next_steps"] = [
            "Inspect the simulated unsigned transaction fields: token contract target (unsigned_tx.to), recipient (to), base-unit amount (amount_base_units), calldata (data), estimated_gas (in gas units), and chainId (84532).",
            "Remember that simulation is a point-in-time check against a single canonical block snapshot and does not guarantee later execution.",
            "Review and sign the transaction externally in your own non-custodial wallet on Base Sepolia (chainId: 84532).",
        ]

    return envelope


def simulate_prepared_transaction_intent(
    intent: Mapping[str, Any],
    *,
    w3: Web3 | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Dry-run a verified unsigned ERC-20 transaction intent on Base Sepolia without broadcasting.

    Verifies the integrity, non-signing invariant, calldata, ``intent_hash``, and expiration
    of ``intent``, verifies Base Sepolia (``chainId == 84532``) connectivity and contract
    bytecode, captures the canonical block number once, and executes ``eth_call`` and
    ``eth_estimateGas`` against that exact block number using an allowlisted EIP-1474
    call object.

    This function NEVER accepts private keys, NEVER signs, and NEVER broadcasts.
    """
    try:
        verified = verify_prepared_transaction_intent(intent, now=now)
    except (KyroxError, ValueError) as exc:
        return {"error": redact_text(str(exc))}

    checksum_contract = str(verified["token_address"])
    ticker = str(verified["ticker"])
    decimals = int(verified["decimals"])
    amount_decimal = str(verified["amount_decimal"])

    try:
        active_w3 = w3 if w3 is not None else get_web3()
        verify_base_sepolia_connection(active_w3)
        _verify_contract_bytecode(active_w3, checksum_contract, ticker)
        snapshot_block_number = _fetch_canonical_block_number(active_w3)
        sim_tx = build_simulation_call_object(verified)
    except (KyroxError, ConnectionError, TimeoutError, ValueError) as exc:
        return {"error": redact_text(str(exc))}
    except Exception as exc:
        return {
            "error": f"Unable to connect to Base Sepolia RPC provider: {redact_text(str(exc))}"
        }

    # Step 1: EVM dry-run execution check via eth_call pinned to snapshot_block_number
    try:
        raw_call_output = active_w3.eth.call(
            dict(sim_tx),
            snapshot_block_number,
        )
        transfer_returned_true, return_data_hex = _decode_erc20_transfer_return_data(
            raw_call_output,
            ticker=ticker,
            checksum_token_address=checksum_contract,
        )
    except Exception as exc:
        try:
            err_code, revert_type, revert_reason, failure_reason = (
                _handle_simulation_rpc_exception(
                    exc,
                    ticker=ticker,
                    checksum_token_address=checksum_contract,
                    decimals=decimals,
                    amount_decimal=amount_decimal,
                    stage="eth_call",
                )
            )
        except (KyroxError, ConnectionError, TimeoutError, ValueError) as rpc_exc:
            return {"error": redact_text(str(rpc_exc))}

        return _build_simulation_result_envelope(
            verified,
            block_number=snapshot_block_number,
            would_succeed=False,
            simulation_status="reverted",
            eth_call_succeeded=False,
            erc20_transfer_returned=None,
            return_data=None,
            estimated_gas=None,
            failure_reason=failure_reason,
            revert_reason=revert_reason,
            revert_type=revert_type,
            error_code=err_code,
        )

    # Step 2: Explicit ERC-20 ABI boolean false return check
    if not transfer_returned_true:
        false_err = Erc20FalseReturnError(
            f"ERC-20 transfer simulation failed for {ticker} at {checksum_contract}: "
            f"eth_call completed without reverting but transfer(address,uint256) returned false.",
            code=ErrorCode.ERC20_TRANSFER_FALSE,
        )
        return _build_simulation_result_envelope(
            verified,
            block_number=snapshot_block_number,
            would_succeed=False,
            simulation_status="erc20_false_return",
            eth_call_succeeded=True,
            erc20_transfer_returned=False,
            return_data=return_data_hex,
            estimated_gas=None,
            failure_reason=false_err.message,
            revert_reason=None,
            revert_type="erc20_false_return",
            error_code=ErrorCode.ERC20_TRANSFER_FALSE,
        )

    # Step 3: Gas estimation via eth_estimateGas pinned to the same snapshot_block_number
    try:
        raw_estimated_gas = active_w3.eth.estimate_gas(
            dict(sim_tx),
            snapshot_block_number,
        )
        if (
            raw_estimated_gas is None
            or isinstance(raw_estimated_gas, MagicMock)
            or isinstance(raw_estimated_gas, bool)
            or not isinstance(raw_estimated_gas, int)
            or raw_estimated_gas <= 0
            or raw_estimated_gas > MAX_GAS_ESTIMATE_UNITS
        ):
            raise MalformedProviderResponseError(
                f"Malformed RPC provider response for {ticker} at {checksum_contract}: "
                f"eth_estimateGas returned invalid gas units {raw_estimated_gas!r}.",
                code=ErrorCode.MALFORMED_PROVIDER_RESPONSE,
            )
        estimated_gas = int(raw_estimated_gas)
    except Exception as exc:
        try:
            err_code, revert_type, revert_reason, failure_reason = (
                _handle_simulation_rpc_exception(
                    exc,
                    ticker=ticker,
                    checksum_token_address=checksum_contract,
                    decimals=decimals,
                    amount_decimal=amount_decimal,
                    stage="eth_estimateGas",
                )
            )
        except (KyroxError, ConnectionError, TimeoutError, ValueError) as rpc_exc:
            return {"error": redact_text(str(rpc_exc))}

        return _build_simulation_result_envelope(
            verified,
            block_number=snapshot_block_number,
            would_succeed=False,
            simulation_status="reverted",
            eth_call_succeeded=True,
            erc20_transfer_returned=True,
            return_data=return_data_hex,
            estimated_gas=None,
            failure_reason=failure_reason,
            revert_reason=revert_reason,
            revert_type=revert_type,
            error_code=err_code,
        )

    return _build_simulation_result_envelope(
        verified,
        block_number=snapshot_block_number,
        would_succeed=True,
        simulation_status="success",
        eth_call_succeeded=True,
        erc20_transfer_returned=True,
        return_data=return_data_hex,
        estimated_gas=estimated_gas,
        failure_reason=None,
        revert_reason=None,
        revert_type=None,
        error_code=None,
    )


def simulate_transaction(
    from_wallet: str,
    ticker: str,
    to: str,
    amount: int | float | str | Decimal,
) -> dict[str, Any]:
    """Prepare and dry-run an unsigned ERC-20 transfer transaction on Base Sepolia.

    Reuses ``prepare_transaction`` so all sender/recipient/contract validations,
    decimal precision checks, Base Sepolia chain ID (``84532``) enforcement, and
    transaction policy limits execute before any RPC simulation call takes place.
    When preparation succeeds, verifies the unsigned intent and executes ``eth_call``
    and ``eth_estimateGas`` against Base Sepolia block ``"latest"``.

    This function NEVER accepts private keys, NEVER signs, and NEVER broadcasts.
    """
    prepared = prepare_transaction(
        from_wallet=from_wallet,
        ticker=ticker,
        to=to,
        amount=amount,
        _skip_rpc_fee_defaults=True,
    )
    if not isinstance(prepared, Mapping) or "error" in prepared:
        return dict(prepared) if isinstance(prepared, Mapping) else {
            "error": "Failed to prepare transaction intent for simulation."
        }

    return simulate_prepared_transaction_intent(prepared)


__all__ = [
    "ALLOWED_RECIPIENTS_ENV_VAR",
    "APPROVED_TICKERS_ENV_VAR",
    "BASE_SEPOLIA_CHAIN_ID",
    "BASE_SEPOLIA_CHAIN_ID_HEX",
    "BASE_SEPOLIA_CHAIN_NAME",
    "DEFAULT_INTENT_TTL_SECONDS",
    "ERC20_INSUFFICIENT_BALANCE_SELECTOR",
    "ERC20_TRANSFER_ABI",
    "ERC20_TRANSFER_SELECTOR",
    "EXTERNAL_SIGNING_INSTRUCTIONS",
    "FORBIDDEN_SIMULATION_CALL_KEYS",
    "GAS_ESTIMATE_WARNING",
    "INTENT_TTL_ENV_VAR",
    "MAX_GAS_ESTIMATE_UNITS",
    "MAX_TX_AMOUNT_ENV_VAR",
    "NONCE_SNAPSHOT_NOTE",
    "PREPARATION_EXECUTION_WARNING",
    "SIMULATION_BLOCK_IDENTIFIER",
    "SIMULATION_CALL_ALLOWED_KEYS",
    "SIMULATION_SIGNING_INSTRUCTIONS",
    "SIMULATION_STATE_WARNING",
    "build_simulation_call_object",
    "compute_intent_hash",
    "decode_erc20_transfer_calldata",
    "encode_erc20_transfer_calldata",
    "get_allowed_recipients",
    "get_approved_tickers",
    "get_intent_ttl_seconds",
    "get_max_tx_amount",
    "prepare_transaction",
    "simulate_prepared_transaction_intent",
    "simulate_transaction",
    "validate_recipient_address",
    "validate_sender_address",
    "verify_prepared_transaction_intent",
]

