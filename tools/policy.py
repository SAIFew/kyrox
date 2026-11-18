"""Deterministic safety policy engine for KYROX transaction preparation and simulation.

Enforces Day 11 non-custodial transaction safety controls before any unsigned transaction
construction or EVM simulation RPC call takes place:
1. Maximum transaction amount: ``50`` tokens by default (inclusive boundary ``<= 50``;
   configurable via ``KYROX_MAX_TOKEN_AMOUNT`` or ``KYROX_MAX_TX_AMOUNT`` up to the
   Day 11 hard ceiling of ``50`` tokens).
2. Approved ticker allowlist: strictly ``tAAPL``, ``tTSLA``, and ``tNVDA`` (optional
   subset restriction via ``KYROX_APPROVED_TICKERS``; arbitrary dataset entries or
   environment settings cannot expand the allowlist beyond these three tickers).
3. Positive, finite ``Decimal`` token amounts and token-decimal precision bounds.
4. Mandatory human approval (``requires_human_approval = True`` on every decision).
5. Base Sepolia chain ID enforcement (``84532``; Base Mainnet ``8453`` and all other
   chains rejected), EIP-55 sender/recipient/contract address validation, zero-address
   rejection, token-contract self-transfer prevention, and optional recipient allowlisting.
6. Structured JSONL audit logging for both ALLOWED and DENIED policy decisions with
   fail-closed semantics on audit failure.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import os
import time
from typing import Any

from tools.errors import (
    DEFAULT_MAX_TOKEN_AMOUNT,
    MAX_TOKEN_DECIMALS,
    AddressValidationError,
    ChainIdMismatchError,
    ConfigurationError,
    DecimalPrecisionError,
    EmptyInputError,
    ErrorClassification,
    ErrorCode,
    KyroxError,
    PolicyViolationError,
    ValidationError,
    classify_error_message,
    classify_exception,
    redact_text,
    validate_token_amount,
)
from tools.log import get_audit_logger, is_in_audited_tool_call
from tools.wallet import (
    BASE_SEPOLIA_CHAIN_ID,
    format_decimal_str,
    validate_contract_address,
    validate_wallet_address,
)

POLICY_VERSION: str = "v0.1-day11"
HARD_MAX_TOKEN_AMOUNT: Decimal = DEFAULT_MAX_TOKEN_AMOUNT  # 50 tokens
CANONICAL_APPROVED_TICKERS: tuple[str, ...] = ("tAAPL", "tTSLA", "tNVDA")
CANONICAL_TICKER_MAP: dict[str, str] = {
    ticker.lower(): ticker for ticker in CANONICAL_APPROVED_TICKERS
}
DEFAULT_APPROVED_TICKERS: frozenset[str] = frozenset(CANONICAL_TICKER_MAP.keys())

MAX_TX_AMOUNT_ENV_VAR: str = "KYROX_MAX_TX_AMOUNT"
MAX_TOKEN_AMOUNT_ENV_VAR: str = "KYROX_MAX_TOKEN_AMOUNT"
APPROVED_TICKERS_ENV_VAR: str = "KYROX_APPROVED_TICKERS"
ALLOWED_RECIPIENTS_ENV_VAR: str = "KYROX_ALLOWED_RECIPIENTS"


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


def _parse_single_max_amount_env(env_var: str, raw_value: str) -> Decimal:
    """Parse and validate a single max-amount environment variable value."""
    try:
        limit_dec = Decimal(raw_value)
    except InvalidOperation as exc:
        raise ConfigurationError(
            f"Invalid {env_var} configuration: {redact_text(raw_value)!r} is not a valid decimal.",
            code=ErrorCode.INVALID_CONFIGURATION,
        ) from exc

    if not limit_dec.is_finite() or limit_dec <= Decimal(0):
        raise ConfigurationError(
            f"Invalid {env_var} configuration: must be a positive finite number.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    if limit_dec > HARD_MAX_TOKEN_AMOUNT:
        raise ConfigurationError(
            f"Invalid {env_var} configuration: {limit_dec} exceeds the Day 11 safety policy "
            f"maximum ({HARD_MAX_TOKEN_AMOUNT}).",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    return limit_dec


def get_max_tx_amount() -> Decimal:
    """Resolve and validate the maximum allowed token quantity per transaction.

    Defaults to ``DEFAULT_MAX_TOKEN_AMOUNT`` (``50`` tokens). Honors
    ``KYROX_MAX_TOKEN_AMOUNT`` and ``KYROX_MAX_TX_AMOUNT`` when configured,
    rejecting invalid, non-positive, non-finite, conflicting, or above-ceiling
    (``> 50``) values so configuration can tighten but never weaken the Day 11 cap.
    """
    raw_token_limit = os.getenv(MAX_TOKEN_AMOUNT_ENV_VAR, "").strip()
    raw_tx_limit = os.getenv(MAX_TX_AMOUNT_ENV_VAR, "").strip()

    parsed_token_limit = (
        _parse_single_max_amount_env(MAX_TOKEN_AMOUNT_ENV_VAR, raw_token_limit)
        if raw_token_limit
        else None
    )
    parsed_tx_limit = (
        _parse_single_max_amount_env(MAX_TX_AMOUNT_ENV_VAR, raw_tx_limit)
        if raw_tx_limit
        else None
    )

    if (
        parsed_token_limit is not None
        and parsed_tx_limit is not None
        and parsed_token_limit != parsed_tx_limit
    ):
        raise ConfigurationError(
            f"Invalid configuration: {MAX_TOKEN_AMOUNT_ENV_VAR} ({parsed_token_limit}) "
            f"and {MAX_TX_AMOUNT_ENV_VAR} ({parsed_tx_limit}) must not conflict.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    if parsed_token_limit is not None:
        return parsed_token_limit
    if parsed_tx_limit is not None:
        return parsed_tx_limit
    return DEFAULT_MAX_TOKEN_AMOUNT


get_max_token_amount = get_max_tx_amount


def get_approved_tickers() -> frozenset[str]:
    """Resolve the active lowercase approved ticker allowlist.

    Defaults to the canonical Day 11 allowlist (``{"taapl", "ttsla", "tnvda"}``).
    When ``KYROX_APPROVED_TICKERS`` is set, validates that it is non-empty and a
    subset of the canonical Day 11 tickers so configuration cannot expand the
    intended allowlist.
    """
    raw_tickers = os.getenv(APPROVED_TICKERS_ENV_VAR, "").strip()
    if not raw_tickers:
        return DEFAULT_APPROVED_TICKERS

    items = [part.strip() for part in raw_tickers.split(",") if part.strip()]
    if not items:
        raise ConfigurationError(
            f"Invalid {APPROVED_TICKERS_ENV_VAR} configuration: must contain at least one ticker.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    lowered: set[str] = set()
    for item in items:
        item_lower = item.lower()
        if item_lower not in DEFAULT_APPROVED_TICKERS:
            allowed_str = ", ".join(CANONICAL_APPROVED_TICKERS)
            raise ConfigurationError(
                f"Invalid {APPROVED_TICKERS_ENV_VAR} configuration: ticker "
                f"{redact_text(item)!r} is not in the approved Day 11 ticker allowlist "
                f"({allowed_str}).",
                code=ErrorCode.INVALID_CONFIGURATION,
            )
        lowered.add(item_lower)

    return frozenset(lowered)


def get_approved_tickers_canonical() -> tuple[str, ...]:
    """Return the active approved tickers in canonical case order (``tAAPL``, ``tTSLA``, ``tNVDA``)."""
    approved_lower = get_approved_tickers()
    return tuple(
        ticker
        for ticker in CANONICAL_APPROVED_TICKERS
        if ticker.lower() in approved_lower
    )


def validate_approved_ticker(
    ticker: Any,
    *,
    strict_case: bool = False,
) -> str:
    """Validate that ``ticker`` is in the approved Day 11 ticker allowlist and return its canonical symbol."""
    if not isinstance(ticker, str) or not ticker.strip():
        raise EmptyInputError(
            "Ticker must not be empty.",
            code=ErrorCode.EMPTY_INPUT,
        )

    normalized = ticker.strip()
    lower = normalized.lower()
    approved_canonical = get_approved_tickers_canonical()
    approved_lower = {t.lower() for t in approved_canonical}
    approved_display = ", ".join(approved_canonical)

    if lower not in CANONICAL_TICKER_MAP:
        raise PolicyViolationError(
            f"Policy rejection: ticker {redact_text(normalized)} is not in the approved "
            f"ticker set ({approved_display}); ticker not found in approved stock catalogue.",
            code=ErrorCode.POLICY_REJECTED,
        )

    if lower not in approved_lower:
        raise PolicyViolationError(
            f"Policy rejection: ticker {redact_text(normalized)} is not in the approved "
            f"ticker set ({approved_display}).",
            code=ErrorCode.POLICY_REJECTED,
        )

    canonical = CANONICAL_TICKER_MAP[lower]
    if strict_case and normalized != canonical:
        raise PolicyViolationError(
            f"Policy rejection: ticker {redact_text(normalized)} must match canonical "
            f"ticker case ({canonical}).",
            code=ErrorCode.POLICY_REJECTED,
        )

    return canonical


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


@dataclass(frozen=True)
class PolicyDecision(Mapping[str, Any]):
    """Immutable, mapping-compatible result of a KYROX transaction policy evaluation."""

    allowed: bool
    passed: bool
    requires_human_approval: bool = True
    ticker: str | None = None
    allowed_tickers: tuple[str, ...] = CANONICAL_APPROVED_TICKERS
    amount_decimal: str | None = None
    amount_base_units: int | None = None
    decimals: int = 18
    max_amount: str = "50"
    allowed_chain_id: int = BASE_SEPOLIA_CHAIN_ID
    chain_verified: bool = True
    ticker_approved: bool = False
    contract_verified: bool = True
    recipient_allowed: bool = True
    from_wallet: str | None = None
    to: str | None = None
    token_address: str | None = None
    reasons: tuple[str, ...] = ()
    error_code: str | None = None
    error_category: str | None = None
    retryable: bool = False
    policy_version: str = POLICY_VERSION

    def __post_init__(self) -> None:
        # Invariant: every transaction policy result MUST retain requires_human_approval=True.
        object.__setattr__(self, "requires_human_approval", True)
        object.__setattr__(self, "passed", bool(self.allowed))

    @property
    def reason(self) -> str | None:
        """Primary denial reason when ``allowed`` is ``False``, or ``None`` when allowed."""
        return self.reasons[0] if self.reasons else None

    def to_dict(self) -> dict[str, Any]:
        """Serialize this policy decision to a JSON-compatible dictionary."""
        return {
            "passed": self.passed,
            "allowed": self.allowed,
            "requires_human_approval": True,
            "chain_verified": self.chain_verified,
            "allowed_chain_id": self.allowed_chain_id,
            "ticker": self.ticker,
            "ticker_approved": self.ticker_approved,
            "allowed_tickers": list(self.allowed_tickers),
            "contract_verified": self.contract_verified,
            "recipient_allowed": self.recipient_allowed,
            "amount_decimal": self.amount_decimal,
            "max_amount": self.max_amount,
            "reasons": list(self.reasons),
            "error_code": self.error_code,
            "error_category": self.error_category,
            "policy_version": self.policy_version,
        }

    def to_error_response(self) -> dict[str, Any]:
        """Build a standardized KYROX tool rejection dictionary from a denied policy decision."""
        primary_reason = (
            self.reasons[0]
            if self.reasons
            else "Policy rejection: transaction request denied by safety policy."
        )
        safe_msg = redact_text(primary_reason)
        return {
            "error": safe_msg,
            "error_code": self.error_code or ErrorCode.POLICY_REJECTED.value,
            "error_category": self.error_category or "policy",
            "retryable": self.retryable,
            "status": "rejected",
            "signed": False,
            "broadcast": False,
            "requires_human_approval": True,
            "requires_external_signature": True,
            "signing_mode": "external_wallet_only",
            "policy": self.to_dict(),
        }

    def __getitem__(self, key: str) -> Any:
        mapping = self.to_dict()
        if key in mapping:
            return mapping[key]
        if hasattr(self, key):
            return getattr(self, key)
        raise KeyError(key)

    def __iter__(self) -> Iterator[str]:
        return iter(self.to_dict())

    def __len__(self) -> int:
        return len(self.to_dict())


def _try_extract_safe_amount_str(amount: Any) -> str | None:
    """Attempt to extract a clean decimal string from ``amount`` for denial context."""
    if isinstance(amount, bool) or amount is None:
        return None
    if isinstance(amount, (int, Decimal)):
        try:
            dec = Decimal(str(amount))
            return format_decimal_str(dec) if dec.is_finite() else None
        except Exception:
            return None
    if isinstance(amount, float):
        try:
            dec = Decimal(str(amount))
            return format_decimal_str(dec) if dec.is_finite() else None
        except Exception:
            return None
    if isinstance(amount, str) and amount.strip():
        try:
            dec = Decimal(amount.strip())
            return format_decimal_str(dec) if dec.is_finite() else None
        except Exception:
            return None
    return None


def _try_extract_safe_ticker_str(ticker: Any) -> str | None:
    """Extract a redacted ticker string for policy context."""
    if not isinstance(ticker, str) or not ticker.strip():
        return None
    candidate = ticker.strip()
    canonical = CANONICAL_TICKER_MAP.get(candidate.lower())
    return canonical if canonical is not None else redact_text(candidate)


def _record_policy_audit_event(
    decision: PolicyDecision,
    *,
    tool_name: str,
    raw_args: Mapping[str, Any],
    duration_ms: float,
    fail_closed: bool,
) -> PolicyDecision:
    """Write a structured policy decision audit entry and fail closed if logging fails."""
    logger = get_audit_logger()
    policy_dict = decision.to_dict()
    audit_context: dict[str, Any] = {
        "policy": policy_dict,
        "allowed": decision.allowed,
        "passed": decision.passed,
        "decision": "allowed" if decision.allowed else "denied",
        "ticker": decision.ticker,
        "amount_decimal": decision.amount_decimal,
        "normalized_amount": decision.amount_decimal,
        "max_amount": decision.max_amount,
        "effective_max_amount": decision.max_amount,
        "reasons": list(decision.reasons),
        "denial_reasons": list(decision.reasons),
        "requires_human_approval": True,
        "policy_version": decision.policy_version,
    }
    if decision.amount_base_units is not None:
        audit_context["amount_base_units"] = decision.amount_base_units
    if decision.from_wallet is not None:
        audit_context["from_wallet"] = decision.from_wallet
    if decision.to is not None:
        audit_context["to"] = decision.to
    if decision.token_address is not None:
        audit_context["token_address"] = decision.token_address

    try:
        logger.log_event(
            tool=tool_name,
            event="policy_decision",
            status="ok" if decision.allowed else "error",
            args=raw_args,
            duration_ms=duration_ms,
            error_code=None if decision.allowed else decision.error_code,
            error_category=None if decision.allowed else decision.error_category,
            retryable=False,
            error_message=None if decision.allowed else decision.reason,
            context=audit_context,
            fail_closed=fail_closed and decision.allowed,
        )
    except Exception as audit_exc:
        if fail_closed and decision.allowed:
            raw_detail = redact_text(str(audit_exc)).strip()
            if raw_detail.lower().startswith("audit logging failed"):
                safe_msg = raw_detail
            else:
                safe_msg = (
                    f"Audit logging failed for {redact_text(tool_name)}; "
                    f"failing closed: {raw_detail}"
                )
            return PolicyDecision(
                allowed=False,
                passed=False,
                requires_human_approval=True,
                ticker=decision.ticker,
                allowed_tickers=decision.allowed_tickers,
                amount_decimal=decision.amount_decimal,
                amount_base_units=None,
                decimals=decision.decimals,
                max_amount=decision.max_amount,
                allowed_chain_id=decision.allowed_chain_id,
                chain_verified=decision.chain_verified,
                ticker_approved=decision.ticker_approved,
                contract_verified=decision.contract_verified,
                recipient_allowed=decision.recipient_allowed,
                from_wallet=decision.from_wallet,
                to=decision.to,
                token_address=decision.token_address,
                reasons=(safe_msg,),
                error_code=ErrorCode.INTERNAL_ERROR.value,
                error_category="audit",
                retryable=False,
                policy_version=decision.policy_version,
            )

    return decision


def evaluate_transaction_policy(
    ticker: Any,
    amount: Any,
    *,
    from_wallet: str | None = None,
    to: str | None = None,
    token_address: str | None = None,
    decimals: int = 18,
    chain_id: int | None = None,
    require_addresses: bool = False,
    require_contract: bool = False,
    strict_ticker_case: bool = False,
    requires_human_approval: bool = True,
    human_approved: bool = False,
    tool_name: str = "evaluate_transaction_policy",
    audit: bool = True,
    fail_closed_on_audit_error: bool = True,
) -> PolicyDecision:
    """Evaluate KYROX Day 11 transaction safety policy deterministically without RPC calls.

    Enforces:
    - Mandatory human approval (rejects any attempt by an agent to bypass ``requires_human_approval``
      or claim pre-granted autonomous execution approval).
    - Approved tickers (``tAAPL``, ``tTSLA``, ``tNVDA``).
    - Positive, finite ``Decimal`` amount and token decimal precision bounds.
    - Maximum transaction amount (``50`` tokens default, inclusive boundary).
    - Optional sender, recipient, token contract, recipient allowlist, and Base Sepolia
      (``chainId: 84532``) checks when supplied.
    """
    start = time.perf_counter()
    raw_args: dict[str, Any] = {
        "ticker": ticker,
        "amount": amount,
    }
    if from_wallet is not None or require_addresses:
        raw_args["from_wallet"] = from_wallet
    if to is not None or require_addresses:
        raw_args["to"] = to
    if token_address is not None or require_contract:
        raw_args["token_address"] = token_address
    if chain_id is not None:
        raw_args["chain_id"] = chain_id

    max_amount_dec = DEFAULT_MAX_TOKEN_AMOUNT
    approved_tickers = CANONICAL_APPROVED_TICKERS
    allowed_recipients: frozenset[str] | None = None
    checksum_sender: str | None = None
    checksum_recipient: str | None = None
    checksum_contract: str | None = None
    canonical_ticker: str | None = _try_extract_safe_ticker_str(ticker)
    amount_decimal_str: str | None = _try_extract_safe_amount_str(amount)
    amount_base_units: int | None = None
    ticker_approved = False
    chain_verified = True
    contract_verified = True
    recipient_allowed = True

    try:
        max_amount_dec = get_max_tx_amount()
        approved_tickers = get_approved_tickers_canonical()
        allowed_recipients = get_allowed_recipients()

        if requires_human_approval is not True or human_approved is not False:
            raise PolicyViolationError(
                "Policy rejection: every KYROX transaction requires external human approval "
                "(requires_human_approval=True); autonomous approval overrides are forbidden.",
                code=ErrorCode.POLICY_REJECTED,
            )

        if require_addresses or from_wallet is not None:
            checksum_sender = validate_sender_address(from_wallet)  # type: ignore[arg-type]

        if require_addresses or to is not None:
            checksum_recipient = validate_recipient_address(to)  # type: ignore[arg-type]

        amount_dec, amount_base_units = validate_token_amount(
            amount,
            decimals=decimals,
            max_amount=max_amount_dec,
        )
        amount_decimal_str = format_decimal_str(amount_dec)

        canonical_ticker = validate_approved_ticker(
            ticker,
            strict_case=strict_ticker_case,
        )
        ticker_approved = True

        if chain_id is not None:
            if isinstance(chain_id, bool) or not isinstance(chain_id, int) or chain_id != BASE_SEPOLIA_CHAIN_ID:
                chain_verified = False
                raise ChainIdMismatchError(
                    f"Connected to unsupported chain ID {chain_id!r}; "
                    f"expected Base Sepolia ({BASE_SEPOLIA_CHAIN_ID}).",
                    code=ErrorCode.UNSUPPORTED_CHAIN_ID,
                )

        if require_contract or token_address is not None:
            checksum_contract = validate_contract_address(
                token_address,  # type: ignore[arg-type]
                ticker=canonical_ticker or "stock",
            )
            if checksum_contract is None:
                contract_verified = False
                raise ConfigurationError(
                    f"Missing required configuration: token contract address for "
                    f"{canonical_ticker or 'stock'} is not configured in the stock dataset.",
                    code=ErrorCode.MISSING_CONFIGURATION,
                )

        if checksum_recipient is not None and checksum_contract is not None:
            if checksum_recipient == checksum_contract:
                recipient_allowed = False
                raise PolicyViolationError(
                    f"Policy rejection: recipient address ({checksum_recipient}) cannot be "
                    f"the {canonical_ticker} token contract address ({checksum_contract}).",
                    code=ErrorCode.POLICY_REJECTED,
                )

        if checksum_recipient is not None and allowed_recipients is not None:
            if checksum_recipient not in allowed_recipients:
                recipient_allowed = False
                raise PolicyViolationError(
                    f"Policy rejection: recipient address {checksum_recipient} is not in the "
                    f"configured recipient allowlist.",
                    code=ErrorCode.POLICY_REJECTED,
                )

        decision = PolicyDecision(
            allowed=True,
            passed=True,
            requires_human_approval=True,
            ticker=canonical_ticker,
            allowed_tickers=approved_tickers,
            amount_decimal=amount_decimal_str,
            amount_base_units=amount_base_units,
            decimals=decimals,
            max_amount=format_decimal_str(max_amount_dec),
            allowed_chain_id=BASE_SEPOLIA_CHAIN_ID,
            chain_verified=chain_verified,
            ticker_approved=True,
            contract_verified=contract_verified,
            recipient_allowed=recipient_allowed,
            from_wallet=checksum_sender,
            to=checksum_recipient,
            token_address=checksum_contract,
            reasons=(),
            error_code=None,
            error_category=None,
            retryable=False,
            policy_version=POLICY_VERSION,
        )
    except Exception as exc:
        classification: ErrorClassification = (
            exc.to_classification()
            if isinstance(exc, KyroxError)
            else classify_exception(exc, tool_name=tool_name)
        )
        safe_decimals = (
            decimals
            if not isinstance(decimals, bool)
            and isinstance(decimals, int)
            and 0 <= decimals <= MAX_TOKEN_DECIMALS
            else 18
        )
        decision = PolicyDecision(
            allowed=False,
            passed=False,
            requires_human_approval=True,
            ticker=canonical_ticker,
            allowed_tickers=approved_tickers,
            amount_decimal=amount_decimal_str,
            amount_base_units=None,
            decimals=safe_decimals,
            max_amount=format_decimal_str(max_amount_dec),
            allowed_chain_id=BASE_SEPOLIA_CHAIN_ID,
            chain_verified=chain_verified,
            ticker_approved=ticker_approved,
            contract_verified=contract_verified,
            recipient_allowed=recipient_allowed,
            from_wallet=checksum_sender,
            to=checksum_recipient,
            token_address=checksum_contract,
            reasons=(classification.message,),
            error_code=classification.code.value,
            error_category=classification.category,
            retryable=classification.retryable,
            policy_version=POLICY_VERSION,
        )

    duration_ms = (time.perf_counter() - start) * 1000.0
    if audit and not is_in_audited_tool_call():
        decision = _record_policy_audit_event(
            decision,
            tool_name=tool_name,
            raw_args=raw_args,
            duration_ms=duration_ms,
            fail_closed=fail_closed_on_audit_error,
        )

    return decision


check_policy = evaluate_transaction_policy


def build_policy_rejection_response(
    exc_or_message: BaseException | str,
    *,
    ticker: Any = None,
    amount: Any = None,
    max_amount: Decimal | None = None,
    approved_tickers: tuple[str, ...] | None = None,
    chain_verified: bool = True,
    ticker_approved: bool = False,
    contract_verified: bool = True,
    recipient_allowed: bool = True,
) -> dict[str, Any]:
    """Construct a structured policy/validation rejection response dictionary."""
    if isinstance(exc_or_message, KyroxError):
        classification = exc_or_message.to_classification()
    elif isinstance(exc_or_message, BaseException):
        classification = classify_exception(exc_or_message)
    else:
        classification = classify_error_message(str(exc_or_message))

    if max_amount is not None:
        max_amount_str = format_decimal_str(max_amount)
    else:
        try:
            max_amount_str = format_decimal_str(get_max_tx_amount())
        except Exception:
            max_amount_str = format_decimal_str(DEFAULT_MAX_TOKEN_AMOUNT)

    if approved_tickers is not None:
        resolved_tickers = approved_tickers
    else:
        try:
            resolved_tickers = get_approved_tickers_canonical()
        except Exception:
            resolved_tickers = CANONICAL_APPROVED_TICKERS

    decision = PolicyDecision(
        allowed=False,
        passed=False,
        requires_human_approval=True,
        ticker=_try_extract_safe_ticker_str(ticker),
        allowed_tickers=resolved_tickers,
        amount_decimal=_try_extract_safe_amount_str(amount),
        amount_base_units=None,
        max_amount=max_amount_str,
        allowed_chain_id=BASE_SEPOLIA_CHAIN_ID,
        chain_verified=chain_verified,
        ticker_approved=ticker_approved,
        contract_verified=contract_verified,
        recipient_allowed=recipient_allowed,
        reasons=(classification.message,),
        error_code=classification.code.value,
        error_category=classification.category,
        retryable=classification.retryable,
        policy_version=POLICY_VERSION,
    )
    return decision.to_error_response()


__all__ = [
    "ALLOWED_RECIPIENTS_ENV_VAR",
    "APPROVED_TICKERS_ENV_VAR",
    "CANONICAL_APPROVED_TICKERS",
    "CANONICAL_TICKER_MAP",
    "DEFAULT_APPROVED_TICKERS",
    "DEFAULT_MAX_TOKEN_AMOUNT",
    "HARD_MAX_TOKEN_AMOUNT",
    "MAX_TOKEN_AMOUNT_ENV_VAR",
    "MAX_TX_AMOUNT_ENV_VAR",
    "POLICY_VERSION",
    "PolicyDecision",
    "build_policy_rejection_response",
    "check_policy",
    "evaluate_transaction_policy",
    "get_allowed_recipients",
    "get_approved_tickers",
    "get_approved_tickers_canonical",
    "get_max_token_amount",
    "get_max_tx_amount",
    "validate_approved_ticker",
    "validate_recipient_address",
    "validate_sender_address",
]
