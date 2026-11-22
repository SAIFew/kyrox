"""Read-only Base Sepolia ERC-20 wallet balance and portfolio valuation reader for KYROX."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation, localcontext
import math
import os
from typing import Any
from urllib.parse import urlsplit

from dotenv import load_dotenv
from web3 import Web3

from tools.errors import (
    AddressValidationError,
    ChainIdMismatchError,
    ConfigurationError,
    ContractCallError,
    DatasetSchemaError,
    DecimalPrecisionError,
    EmptyInputError,
    ErrorCode,
    KyroxError,
    RpcConnectionError,
    RpcTimeoutError,
    ValidationError,
    is_timeout_exception,
    redact_text,
)
from tools.stocks import load_stocks

DEFAULT_BASE_RPC_URL: str = "https://sepolia.base.org"
DEFAULT_RPC_TIMEOUT_SECONDS: float = 10.0
MAX_RPC_TIMEOUT_SECONDS: float = 120.0
BASE_SEPOLIA_CHAIN_ID: int = 84532
BASE_SEPOLIA_CHAIN_NAME: str = "base-sepolia"
ZERO_ADDRESS: str = "0x0000000000000000000000000000000000000000"
MAX_UINT256: int = (1 << 256) - 1
DECIMAL_CALCULATION_PRECISION: int = 100
DEFAULT_CURRENCY: str = "USD"
DEFAULT_ENVIRONMENT: str = "mock"
DEFAULT_VALUATION_BASIS: str = "mock_reference_value"
DEFAULT_VALUATION_SOURCE: str = "mock_fixture"
MOCK_VALUATION_WARNING: str = (
    "Reference values are static mock demonstration fixtures on Base Sepolia "
    "(chainId: 84532) and do not represent live equity market prices or real share ownership."
)

# Strictly read-only ERC-20 ABI subset.
# Never expose transfer, transferFrom, approve, increaseAllowance, or signing methods.
ERC20_ABI: list[dict[str, Any]] = [
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def validate_rpc_url(rpc_url: str) -> str:
    """Validate that an RPC endpoint URL uses HTTP(S) and has a valid hostname."""
    if not isinstance(rpc_url, str) or not rpc_url.strip():
        raise ConfigurationError(
            "Missing required configuration: BASE_RPC_URL must not be empty.",
            code=ErrorCode.MISSING_CONFIGURATION,
        )

    candidate = rpc_url.strip()
    if any(ch.isspace() for ch in candidate):
        raise ConfigurationError(
            f"Invalid BASE_RPC_URL configuration: URL must not contain whitespace ({redact_text(candidate)}).",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    parsed = urlsplit(candidate)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        raise ConfigurationError(
            f"Invalid BASE_RPC_URL configuration: expected http(s) URL with hostname, got {redact_text(candidate)!r}.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    return candidate


def get_rpc_url(*, require_explicit: bool = False) -> str:
    """Resolve and validate the Base Sepolia RPC URL from environment configuration."""
    load_dotenv()
    configured_url = os.getenv("BASE_RPC_URL", "")
    if isinstance(configured_url, str) and configured_url.strip():
        return validate_rpc_url(configured_url.strip())

    if require_explicit:
        raise ConfigurationError(
            "Missing required configuration: BASE_RPC_URL is not set.",
            code=ErrorCode.MISSING_CONFIGURATION,
        )

    return DEFAULT_BASE_RPC_URL


def get_rpc_timeout() -> float:
    """Resolve and validate the HTTP RPC timeout in seconds from environment configuration."""
    raw_timeout = os.getenv("BASE_RPC_TIMEOUT", "")
    if not isinstance(raw_timeout, str) or not raw_timeout.strip():
        return DEFAULT_RPC_TIMEOUT_SECONDS

    try:
        timeout_val = float(raw_timeout.strip())
    except ValueError as exc:
        raise ConfigurationError(
            f"Invalid BASE_RPC_TIMEOUT configuration: {redact_text(raw_timeout.strip())!r} is not a number.",
            code=ErrorCode.INVALID_CONFIGURATION,
        ) from exc

    if not math.isfinite(timeout_val) or timeout_val <= 0 or timeout_val > MAX_RPC_TIMEOUT_SECONDS:
        raise ConfigurationError(
            f"Invalid BASE_RPC_TIMEOUT configuration: must be between 0 and {MAX_RPC_TIMEOUT_SECONDS} seconds.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    return timeout_val


def get_web3(
    rpc_url: str | None = None,
    *,
    timeout: float | None = None,
) -> Web3:
    """Create a Web3 HTTP client targeting the configured Base Sepolia RPC endpoint."""
    resolved_url = (
        validate_rpc_url(rpc_url.strip())
        if isinstance(rpc_url, str) and rpc_url.strip()
        else get_rpc_url()
    )
    resolved_timeout = timeout if timeout is not None else get_rpc_timeout()
    if (
        isinstance(resolved_timeout, bool)
        or not isinstance(resolved_timeout, (int, float))
        or not math.isfinite(float(resolved_timeout))
        or float(resolved_timeout) <= 0
    ):
        raise ConfigurationError(
            f"Invalid RPC timeout: expected positive finite number, got {resolved_timeout!r}.",
            code=ErrorCode.INVALID_CONFIGURATION,
        )

    provider = Web3.HTTPProvider(
        resolved_url,
        request_kwargs={"timeout": float(resolved_timeout)},
    )
    return Web3(provider)


def _has_invalid_mixed_case_checksum(address: str) -> bool:
    """Return ``True`` if ``address`` uses mixed case that violates EIP-55 checksum rules."""
    hex_body = address[2:] if address.lower().startswith("0x") else address
    if not hex_body.islower() and not hex_body.isupper():
        return not Web3.is_checksum_address(address)
    return False


def validate_wallet_address(wallet: str) -> str:
    """Validate a public Ethereum wallet address and return its checksummed form.

    Rejects empty strings, non-strings, malformed hex addresses, the zero/burn
    address (``0x0000...0000``), and mixed-case addresses with corrupted EIP-55
    checksums.

    Args:
        wallet: Public Ethereum address string.

    Returns:
        The EIP-55 checksummed wallet address.

    Raises:
        ValueError (AddressValidationError / EmptyInputError): If the wallet input is invalid.
    """
    if not isinstance(wallet, str) or not wallet.strip():
        raise EmptyInputError("Wallet address must not be empty.")

    candidate = wallet.strip()
    if not Web3.is_address(candidate):
        raise AddressValidationError(
            f"Invalid Ethereum wallet address: {redact_text(candidate)}",
            code=ErrorCode.INVALID_WALLET_ADDRESS,
        )

    if candidate.lower() == ZERO_ADDRESS:
        raise AddressValidationError(
            f"Invalid Ethereum wallet address: zero address ({ZERO_ADDRESS}) is not allowed.",
            code=ErrorCode.ZERO_ADDRESS_NOT_ALLOWED,
        )

    if _has_invalid_mixed_case_checksum(candidate):
        raise AddressValidationError(
            f"Invalid Ethereum wallet address: invalid EIP-55 checksum for {redact_text(candidate)}",
            code=ErrorCode.INVALID_ADDRESS_CHECKSUM,
        )

    return Web3.to_checksum_address(candidate)


def validate_contract_address(token_address: str, ticker: str = "") -> str | None:
    """Validate a stock record's ``token_address`` field.

    Blank addresses return ``None`` so unconfigured tokens can be skipped cleanly.
    Any non-empty malformed address, zero address, or invalid mixed-case checksum
    raises ``AddressValidationError`` (``ValueError``) rather than failing silently.

    Args:
        token_address: Raw ``token_address`` value from the stock catalogue.
        ticker: Stock ticker label for clear error attribution.

    Returns:
        Checksummed contract address, or ``None`` if the input is blank.

    Raises:
        ValueError (AddressValidationError): If ``token_address`` is invalid.
    """
    label = ticker.strip() if isinstance(ticker, str) and ticker.strip() else "stock"
    if not isinstance(token_address, str):
        raise AddressValidationError(
            f"Invalid token contract address for {label}: expected string, "
            f"got {type(token_address).__name__}.",
            code=ErrorCode.INVALID_CONTRACT_ADDRESS,
        )

    candidate = token_address.strip()
    if not candidate:
        return None

    if not Web3.is_address(candidate):
        raise AddressValidationError(
            f"Invalid token contract address for {label}: {redact_text(candidate)}",
            code=ErrorCode.INVALID_CONTRACT_ADDRESS,
        )

    if candidate.lower() == ZERO_ADDRESS:
        raise AddressValidationError(
            f"Invalid token contract address for {label}: zero address ({ZERO_ADDRESS}) is not allowed.",
            code=ErrorCode.ZERO_ADDRESS_NOT_ALLOWED,
        )

    if _has_invalid_mixed_case_checksum(candidate):
        raise AddressValidationError(
            f"Invalid token contract address for {label}: invalid EIP-55 checksum for {redact_text(candidate)}",
            code=ErrorCode.INVALID_ADDRESS_CHECKSUM,
        )

    return Web3.to_checksum_address(candidate)


def verify_base_sepolia_connection(w3: Web3) -> int:
    """Verify that the Web3 provider is connected to Base Sepolia (chainId 84532).

    Args:
        w3: Configured ``Web3`` instance.

    Returns:
        Verified chain ID (``84532``).

    Raises:
        ConnectionError (RpcConnectionError / RpcTimeoutError): If the RPC provider is
            unreachable, times out, or fails to respond.
        ValueError (ChainIdMismatchError): If the connected network is not Base Sepolia (``84532``).
    """
    try:
        is_connected = bool(w3.is_connected())
    except Exception as exc:
        safe_detail = redact_text(str(exc))
        if is_timeout_exception(exc):
            raise RpcTimeoutError(
                f"Unable to connect to Base Sepolia RPC provider (request timed out): {safe_detail}"
            ) from exc
        raise RpcConnectionError(
            f"Unable to connect to Base Sepolia RPC provider: {safe_detail}"
        ) from exc

    if not is_connected:
        raise RpcConnectionError("Unable to connect to Base Sepolia RPC provider.")

    try:
        raw_chain_id = w3.eth.chain_id
        if isinstance(raw_chain_id, bool) or not isinstance(raw_chain_id, int):
            chain_id = int(raw_chain_id)
        else:
            chain_id = raw_chain_id
    except Exception as exc:
        safe_detail = redact_text(str(exc))
        if is_timeout_exception(exc):
            raise RpcTimeoutError(
                f"Unable to read chain ID from Base Sepolia RPC provider (request timed out): {safe_detail}"
            ) from exc
        raise RpcConnectionError(
            f"Unable to read chain ID from Base Sepolia RPC provider: {safe_detail}"
        ) from exc

    if chain_id != BASE_SEPOLIA_CHAIN_ID:
        raise ChainIdMismatchError(
            f"Connected to unsupported chain ID {chain_id}; "
            f"expected Base Sepolia ({BASE_SEPOLIA_CHAIN_ID})."
        )

    return chain_id


def normalize_raw_balance_decimal(raw_balance: int, decimals: int) -> Decimal:
    """Validate and normalize a raw uint256 token balance into an exact ``Decimal``.

    Uses a 100-digit decimal context so 256-bit integers (up to 78 decimal digits)
    and up to 77 token decimals never suffer precision loss or binary float drift.

    Args:
        raw_balance: Raw uint256 balance returned by ``balanceOf(wallet)``.
        decimals: Token decimals returned by ``decimals()``.

    Returns:
        Exact human-readable token balance as ``Decimal``.

    Raises:
        ValueError (DecimalPrecisionError): If ``raw_balance`` or ``decimals`` is out of valid bounds.
    """
    if isinstance(raw_balance, bool) or not isinstance(raw_balance, int) or raw_balance < 0:
        raise DecimalPrecisionError(
            f"Invalid raw token balance: expected non-negative integer, got {raw_balance!r}."
        )

    if raw_balance > MAX_UINT256:
        raise DecimalPrecisionError(
            f"Invalid raw token balance: {raw_balance} exceeds uint256 maximum ({MAX_UINT256})."
        )

    if isinstance(decimals, bool) or not isinstance(decimals, int) or decimals < 0 or decimals > 77:
        raise DecimalPrecisionError(
            f"Invalid token decimals: expected integer between 0 and 77, got {decimals!r}."
        )

    if raw_balance == 0:
        return Decimal(0)

    with localcontext() as ctx:
        ctx.prec = DECIMAL_CALCULATION_PRECISION
        exact_value = Decimal(raw_balance) / (Decimal(10) ** Decimal(decimals))
        return exact_value.normalize()


def format_decimal_str(value: Decimal, *, min_fraction_digits: int = 0) -> str:
    """Format an exact ``Decimal`` as a fixed-point string without scientific notation."""
    with localcontext() as ctx:
        ctx.prec = DECIMAL_CALCULATION_PRECISION
        fixed = format(value, "f")

    if "." in fixed:
        int_part, frac_part = fixed.split(".", 1)
        stripped_frac = frac_part.rstrip("0")
        if len(stripped_frac) < min_fraction_digits:
            stripped_frac = stripped_frac.ljust(min_fraction_digits, "0")
        return f"{int_part}.{stripped_frac}" if stripped_frac else int_part

    if min_fraction_digits > 0:
        return f"{fixed}.{'0' * min_fraction_digits}"
    return fixed


def _decimal_to_json_number(value: Decimal) -> int | float:
    """Convert an exact ``Decimal`` into a JSON-compatible number."""
    with localcontext() as ctx:
        ctx.prec = DECIMAL_CALCULATION_PRECISION
        integral = value.to_integral_value()
        if value == integral and abs(value) >= Decimal(10**15):
            return int(integral)
        return float(value)


def convert_raw_balance(raw_balance: int, decimals: int) -> int | float:
    """Convert raw integer base units into human-readable token units using ``Decimal``.

    Exact whole-token quantities return an ``int`` (e.g. ``1000``) with zero
    floating-point conversion. Fractional token quantities are computed via
    ``Decimal`` and returned as ``float`` for standard JSON serialization.

    Args:
        raw_balance: Raw uint256 balance returned by ``balanceOf(wallet)``.
        decimals: Token decimals returned by ``decimals()``.

    Returns:
        Human-readable token balance as ``int`` (when exact integer) or ``float``.

    Raises:
        ValueError (DecimalPrecisionError): If ``raw_balance`` or ``decimals`` is out of valid bounds.
    """
    if isinstance(raw_balance, bool) or not isinstance(raw_balance, int) or raw_balance < 0:
        raise DecimalPrecisionError(
            f"Invalid raw token balance: expected non-negative integer, got {raw_balance!r}."
        )

    if raw_balance > MAX_UINT256:
        raise DecimalPrecisionError(
            f"Invalid raw token balance: {raw_balance} exceeds uint256 maximum ({MAX_UINT256})."
        )

    if isinstance(decimals, bool) or not isinstance(decimals, int) or decimals < 0 or decimals > 77:
        raise DecimalPrecisionError(
            f"Invalid token decimals: expected integer between 0 and 77, got {decimals!r}."
        )

    if raw_balance == 0:
        return 0

    scale_int = 10**decimals
    quotient, remainder = divmod(raw_balance, scale_int)
    if remainder == 0:
        return quotient

    with localcontext() as ctx:
        ctx.prec = DECIMAL_CALCULATION_PRECISION
        exact_value = Decimal(raw_balance) / (Decimal(10) ** Decimal(decimals))
    return float(exact_value)


def _verify_contract_bytecode(w3: Web3, checksum_address: str, ticker: str) -> None:
    """Ensure deployed contract bytecode exists at ``checksum_address`` when inspectable."""
    try:
        code = w3.eth.get_code(checksum_address)
    except Exception as exc:
        safe_detail = redact_text(str(exc))
        if is_timeout_exception(exc):
            raise RpcTimeoutError(
                f"Unable to verify contract bytecode for {ticker} at {checksum_address} (request timed out): {safe_detail}"
            ) from exc
        raise RpcConnectionError(
            f"Unable to verify contract bytecode for {ticker} at {checksum_address}: {safe_detail}"
        ) from exc

    if isinstance(code, (bytes, bytearray)) and len(code) == 0:
        raise ValidationError(
            f"No contract bytecode found for {ticker} at {checksum_address}.",
            code=ErrorCode.MISSING_CONTRACT_BYTECODE,
        )
    if isinstance(code, str) and code.strip().lower() in ("", "0x", "0x0"):
        raise ValidationError(
            f"No contract bytecode found for {ticker} at {checksum_address}.",
            code=ErrorCode.MISSING_CONTRACT_BYTECODE,
        )


def get_balances(wallet: str) -> dict[str, Any]:
    """Read tokenized stock balances for a public wallet on Base Sepolia.

    Zero-balance holdings and unconfigured (blank) token contract addresses are
    omitted from the returned ``balances`` list. Malformed wallet addresses,
    zero addresses, invalid mixed-case checksums, malformed non-empty contract
    addresses, RPC connectivity/timeout failures, and chain ID mismatches return
    a structured ``{"error": ...}`` dictionary with sensitive details redacted.

    Args:
        wallet: Public Ethereum wallet address to inspect.

    Returns:
        A structured dictionary containing ``wallet`` (checksummed), ``chain``
        (``"base-sepolia"``), and ``balances`` (list of ``{"ticker", "balance"}``),
        or ``{"error": "..."}`` when validation or RPC communication fails.
    """
    try:
        checksum_wallet = validate_wallet_address(wallet)
    except ValueError as exc:
        return {"error": redact_text(str(exc))}

    try:
        stocks = load_stocks()
    except FileNotFoundError:
        raise
    except ValueError as exc:
        return {"error": redact_text(str(exc))}

    configured_tokens: list[tuple[str, str]] = []
    seen_addresses: dict[str, str] = {}
    try:
        for record in stocks:
            ticker = record["ticker"]
            raw_token_address = record.get("token_address", "")
            checksum_token_address = validate_contract_address(
                raw_token_address, ticker=ticker
            )
            if checksum_token_address is None:
                continue
            if checksum_token_address in seen_addresses:
                first_ticker = seen_addresses[checksum_token_address]
                raise ValidationError(
                    f"Duplicate token contract address configured for {ticker} "
                    f"and {first_ticker}: {checksum_token_address}",
                    code=ErrorCode.DUPLICATE_CONTRACT_ADDRESS,
                )
            seen_addresses[checksum_token_address] = ticker
            configured_tokens.append((ticker, checksum_token_address))
    except ValueError as exc:
        return {"error": redact_text(str(exc))}

    try:
        w3 = get_web3()
        verify_base_sepolia_connection(w3)
    except (KyroxError, ConnectionError, TimeoutError, ValueError) as exc:
        return {"error": redact_text(str(exc))}
    except Exception as exc:
        return {
            "error": f"Unable to connect to Base Sepolia RPC provider: {redact_text(str(exc))}"
        }

    balances: list[dict[str, Any]] = []
    for ticker, checksum_token_address in configured_tokens:
        try:
            _verify_contract_bytecode(w3, checksum_token_address, ticker)
            contract = w3.eth.contract(
                address=checksum_token_address,
                abi=ERC20_ABI,
            )
            raw_balance = contract.functions.balanceOf(checksum_wallet).call()
            decimals = contract.functions.decimals().call()
            human_balance = convert_raw_balance(raw_balance, decimals)
        except (KyroxError, ConnectionError, TimeoutError, ValueError) as exc:
            return {"error": redact_text(str(exc))}
        except Exception as exc:
            safe_exc = redact_text(str(exc))
            if is_timeout_exception(exc):
                err = RpcTimeoutError(
                    f"Failed to read token balance for {ticker} "
                    f"at {checksum_token_address} (request timed out): {safe_exc}"
                )
                return {"error": err.message}
            contract_err = ContractCallError(
                f"Failed to read token balance for {ticker} "
                f"at {checksum_token_address}: {safe_exc}"
            )
            return {"error": contract_err.message}

        if raw_balance > 0:
            balances.append(
                {
                    "ticker": ticker,
                    "balance": human_balance,
                }
            )

    return {
        "wallet": checksum_wallet,
        "chain": BASE_SEPOLIA_CHAIN_NAME,
        "balances": balances,
    }


def _qualify_reference_valuation(
    record: Mapping[str, Any],
    ticker: str,
) -> tuple[Decimal | None, float | None, str, str | None]:
    """Validate and qualify a stock record's reference valuation and currency.

    Returns:
        Tuple of ``(reference_decimal, reference_float, currency, unpriced_warning)``.
        When a holding has a missing or stale reference value, ``reference_decimal``
        and ``reference_float`` are ``None`` and ``unpriced_warning`` explains why.

    Raises:
        ValidationError: If ``currency`` or a provided ``reference_value`` is invalid.
    """
    raw_currency = record.get("currency", DEFAULT_CURRENCY)
    if raw_currency is None:
        currency = DEFAULT_CURRENCY
    elif not isinstance(raw_currency, str) or not raw_currency.strip():
        raise ValidationError(
            f"Invalid currency for {ticker}: currency must be a non-empty string.",
            code=ErrorCode.CURRENCY_MISMATCH,
        )
    else:
        currency = raw_currency.strip().upper()
        if not currency.isalpha() or len(currency) < 2 or len(currency) > 10:
            raise ValidationError(
                f"Invalid currency for {ticker}: {redact_text(raw_currency.strip())!r} is not a valid currency code.",
                code=ErrorCode.CURRENCY_MISMATCH,
            )

    if record.get("unpriced") is True or record.get("priceable") is False:
        return (
            None,
            None,
            currency,
            f"Holding {ticker} is marked unpriced and is excluded from total_value.",
        )

    if record.get("stale") is True or record.get("is_stale") is True:
        return (
            None,
            None,
            currency,
            f"Holding {ticker} has a stale reference value and is excluded from total_value.",
        )

    raw_ref = record.get("reference_value")
    if raw_ref is None:
        return (
            None,
            None,
            currency,
            f"Holding {ticker} has no qualifying reference value and is excluded from total_value.",
        )

    if isinstance(raw_ref, bool) or not isinstance(raw_ref, (int, float, Decimal)):
        raise ValidationError(
            f"Invalid reference_value for {ticker}: expected positive finite number, got {raw_ref!r}.",
            code=ErrorCode.INVALID_REFERENCE_VALUE,
        )

    if isinstance(raw_ref, float) and not math.isfinite(raw_ref):
        raise ValidationError(
            f"Invalid reference_value for {ticker}: reference_value must be a finite number.",
            code=ErrorCode.INVALID_REFERENCE_VALUE,
        )

    try:
        ref_dec = Decimal(str(raw_ref))
    except InvalidOperation as exc:
        raise ValidationError(
            f"Invalid reference_value for {ticker}: {raw_ref!r} is not a valid decimal number.",
            code=ErrorCode.INVALID_REFERENCE_VALUE,
        ) from exc

    if not ref_dec.is_finite() or ref_dec <= Decimal(0):
        raise ValidationError(
            f"Invalid reference_value for {ticker}: reference_value must be a positive number, got {raw_ref!r}.",
            code=ErrorCode.INVALID_REFERENCE_VALUE,
        )

    return ref_dec, float(ref_dec), currency, None


def get_portfolio(wallet: str) -> dict[str, Any]:
    """Read tokenized stock balances on Base Sepolia and compute a structured portfolio valuation.

    Follows strict financial and security invariants:
    - Validates wallet format, rejects the zero address, and verifies EIP-55 checksums.
    - Enforces Base Sepolia (``chainId == 84532``) before any contract call.
    - Validates dataset tickers, stock names, contract addresses, duplicate protections,
      optional configured decimals, currencies, and reference valuations.
    - Reads ERC-20 ``balanceOf(wallet)`` and ``decimals()`` using a strictly read-only ABI.
    - Verifies on-chain ``decimals()`` against dataset ``decimals`` when configured.
    - Uses exact ``Decimal`` arithmetic (100-digit context) for all balance normalization,
      position valuations, and compatible single-currency aggregation.
    - Explicitly exposes unpriced holdings and currency-mismatch conditions without
      inventing prices or summing incompatible currencies.

    Args:
        wallet: Public Ethereum wallet address to inspect on Base Sepolia.

    Returns:
        A structured portfolio dictionary or ``{"error": "..."}`` on validation/RPC failure.
    """
    try:
        checksum_wallet = validate_wallet_address(wallet)
    except ValueError as exc:
        return {"error": redact_text(str(exc))}

    try:
        stocks = load_stocks()
    except FileNotFoundError:
        raise
    except ValueError as exc:
        return {"error": redact_text(str(exc))}

    if not isinstance(stocks, list):
        return {
            "error": f"Invalid stock data structure: expected list, got {type(stocks).__name__}."
        }

    configured_tokens: list[dict[str, Any]] = []
    seen_tickers: dict[str, int] = {}
    seen_addresses: dict[str, str] = {}
    try:
        for idx, record in enumerate(stocks):
            if not isinstance(record, Mapping):
                raise DatasetSchemaError(
                    f"Invalid stock record at index {idx}: expected object, got {type(record).__name__}."
                )

            raw_ticker = record.get("ticker")
            if not isinstance(raw_ticker, str) or not raw_ticker.strip():
                raise DatasetSchemaError(
                    f"Invalid stock record at index {idx}: 'ticker' must be a non-empty string."
                )
            ticker = raw_ticker.strip()
            normalized_ticker = ticker.lower()
            if normalized_ticker in seen_tickers:
                first_idx = seen_tickers[normalized_ticker]
                raise DatasetSchemaError(
                    f"Invalid stock record at index {idx}: duplicate stock ticker "
                    f"'{ticker}' (already defined at index {first_idx}).",
                    code=ErrorCode.DUPLICATE_TICKER,
                )
            seen_tickers[normalized_ticker] = idx

            raw_stock_name = record.get("stock")
            if not isinstance(raw_stock_name, str) or not raw_stock_name.strip():
                raise DatasetSchemaError(
                    f"Invalid stock record for {ticker}: 'stock' must be a non-empty string."
                )
            stock_name = raw_stock_name.strip()

            configured_decimals = record.get("decimals")
            if configured_decimals is not None:
                if (
                    isinstance(configured_decimals, bool)
                    or not isinstance(configured_decimals, int)
                    or configured_decimals < 0
                    or configured_decimals > 77
                ):
                    raise DecimalPrecisionError(
                        f"Invalid configured token decimals for {ticker}: expected integer between 0 and 77, "
                        f"got {configured_decimals!r}."
                    )

            ref_dec, ref_float, currency, unpriced_warning = _qualify_reference_valuation(
                record, ticker
            )

            if "token_address" not in record:
                raise AddressValidationError(
                    f"Invalid token contract address for {ticker}: missing 'token_address' field.",
                    code=ErrorCode.INVALID_CONTRACT_ADDRESS,
                )
            raw_token_address = record.get("token_address")
            checksum_token_address = validate_contract_address(
                raw_token_address, ticker=ticker  # type: ignore[arg-type]
            )
            if checksum_token_address is None:
                continue

            if checksum_token_address in seen_addresses:
                first_ticker = seen_addresses[checksum_token_address]
                raise ValidationError(
                    f"Duplicate token contract address configured for {ticker} "
                    f"and {first_ticker}: {checksum_token_address}",
                    code=ErrorCode.DUPLICATE_CONTRACT_ADDRESS,
                )
            seen_addresses[checksum_token_address] = ticker

            raw_source = record.get("source") or record.get("valuation_source")
            valuation_source = (
                raw_source.strip()
                if isinstance(raw_source, str) and raw_source.strip()
                else DEFAULT_VALUATION_SOURCE
            )

            configured_tokens.append(
                {
                    "ticker": ticker,
                    "stock": stock_name,
                    "token_address": checksum_token_address,
                    "configured_decimals": configured_decimals,
                    "ref_dec": ref_dec,
                    "ref_float": ref_float,
                    "currency": currency,
                    "unpriced_warning": unpriced_warning,
                    "valuation_source": valuation_source,
                }
            )
    except ValueError as exc:
        return {"error": redact_text(str(exc))}

    try:
        w3 = get_web3()
        verify_base_sepolia_connection(w3)
    except (KyroxError, ConnectionError, TimeoutError, ValueError) as exc:
        return {"error": redact_text(str(exc))}
    except Exception as exc:
        return {
            "error": f"Unable to connect to Base Sepolia RPC provider: {redact_text(str(exc))}"
        }

    holdings: list[dict[str, Any]] = []
    priced_values_dec: list[Decimal] = []
    priced_currencies: set[str] = set()
    unpriced_holdings: list[str] = []
    warnings: list[str] = []

    for token_meta in configured_tokens:
        ticker = token_meta["ticker"]
        checksum_token_address = token_meta["token_address"]
        configured_decimals = token_meta["configured_decimals"]

        try:
            _verify_contract_bytecode(w3, checksum_token_address, ticker)
            contract = w3.eth.contract(
                address=checksum_token_address,
                abi=ERC20_ABI,
            )
            raw_balance = contract.functions.balanceOf(checksum_wallet).call()
            decimals = contract.functions.decimals().call()

            if (
                isinstance(decimals, bool)
                or not isinstance(decimals, int)
                or decimals < 0
                or decimals > 77
            ):
                raise DecimalPrecisionError(
                    f"Invalid token decimals for {ticker} at {checksum_token_address}: "
                    f"expected integer between 0 and 77, got {decimals!r}."
                )

            if configured_decimals is not None and decimals != configured_decimals:
                raise DecimalPrecisionError(
                    f"Token decimals mismatch for {ticker} at {checksum_token_address}: "
                    f"contract reported {decimals}, dataset configured {configured_decimals}.",
                    code=ErrorCode.DECIMAL_MISMATCH,
                )

            balance_dec = normalize_raw_balance_decimal(raw_balance, decimals)
            human_balance = convert_raw_balance(raw_balance, decimals)
        except (KyroxError, ConnectionError, TimeoutError, ValueError) as exc:
            return {"error": redact_text(str(exc))}
        except Exception as exc:
            safe_exc = redact_text(str(exc))
            if is_timeout_exception(exc):
                err = RpcTimeoutError(
                    f"Failed to read token balance for {ticker} "
                    f"at {checksum_token_address} (request timed out): {safe_exc}"
                )
                return {"error": err.message}
            contract_err = ContractCallError(
                f"Failed to read token balance for {ticker} "
                f"at {checksum_token_address}: {safe_exc}"
            )
            return {"error": contract_err.message}

        if raw_balance == 0:
            continue

        ref_dec: Decimal | None = token_meta["ref_dec"]
        ref_float: float | None = token_meta["ref_float"]
        currency: str = token_meta["currency"]
        valuation_source: str = token_meta["valuation_source"]
        balance_decimal_str = format_decimal_str(balance_dec)

        if ref_dec is not None and ref_float is not None:
            with localcontext() as ctx:
                ctx.prec = DECIMAL_CALCULATION_PRECISION
                position_value_dec = balance_dec * ref_dec

            priced_values_dec.append(position_value_dec)
            priced_currencies.add(currency)
            holdings.append(
                {
                    "ticker": ticker,
                    "stock": token_meta["stock"],
                    "token_address": checksum_token_address,
                    "raw_balance": raw_balance,
                    "decimals": decimals,
                    "balance": human_balance,
                    "balance_decimal": balance_decimal_str,
                    "reference_value": ref_float,
                    "currency": currency,
                    "value": _decimal_to_json_number(position_value_dec),
                    "value_decimal": format_decimal_str(
                        position_value_dec, min_fraction_digits=2
                    ),
                    "priced": True,
                    "valuation_status": "priced",
                    "valuation_source": valuation_source,
                }
            )
        else:
            unpriced_holdings.append(ticker)
            if token_meta["unpriced_warning"]:
                warnings.append(token_meta["unpriced_warning"])
            holdings.append(
                {
                    "ticker": ticker,
                    "stock": token_meta["stock"],
                    "token_address": checksum_token_address,
                    "raw_balance": raw_balance,
                    "decimals": decimals,
                    "balance": human_balance,
                    "balance_decimal": balance_decimal_str,
                    "reference_value": None,
                    "currency": currency,
                    "value": None,
                    "value_decimal": None,
                    "priced": False,
                    "valuation_status": "unpriced",
                    "valuation_source": valuation_source,
                }
            )

    portfolio_currency: str | None
    total_value: int | float | None
    total_value_decimal: str | None

    if not holdings:
        portfolio_currency = DEFAULT_CURRENCY
        total_value = 0.0
        total_value_decimal = "0.00"
        if not stocks:
            warnings.append(
                "Stock catalogue dataset is empty; no token contracts were queried."
            )
        elif not configured_tokens:
            warnings.append(
                "No deployed token contract addresses are configured in the stock dataset; "
                "all unconfigured entries were skipped."
            )
    elif not priced_values_dec:
        portfolio_currency = None
        total_value = None
        total_value_decimal = None
        warnings.append(
            "All held positions are unpriced; aggregate portfolio total_value cannot be calculated."
        )
    elif len(priced_currencies) > 1:
        sorted_currencies = ", ".join(sorted(priced_currencies))
        portfolio_currency = None
        total_value = None
        total_value_decimal = None
        warnings.append(
            f"Mixed valuation currencies detected ({sorted_currencies}); "
            "incompatible currencies cannot be summed into a single total_value."
        )
    else:
        portfolio_currency = next(iter(priced_currencies))
        with localcontext() as ctx:
            ctx.prec = DECIMAL_CALCULATION_PRECISION
            total_dec = sum(priced_values_dec, Decimal(0))
        total_value = _decimal_to_json_number(total_dec)
        total_value_decimal = format_decimal_str(total_dec, min_fraction_digits=2)

    warnings.append(MOCK_VALUATION_WARNING)

    return {
        "wallet": checksum_wallet,
        "chain": BASE_SEPOLIA_CHAIN_NAME,
        "chain_id": BASE_SEPOLIA_CHAIN_ID,
        "environment": DEFAULT_ENVIRONMENT,
        "valuation_basis": DEFAULT_VALUATION_BASIS,
        "currency": portfolio_currency,
        "holdings": holdings,
        "total_value": total_value,
        "total_value_decimal": total_value_decimal,
        "holding_count": len(holdings),
        "priced_holding_count": len(priced_values_dec),
        "unpriced_holdings": unpriced_holdings,
        "warnings": warnings,
    }
