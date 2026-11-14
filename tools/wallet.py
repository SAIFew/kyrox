"""Read-only Base Sepolia ERC-20 wallet balance reader for KYROX."""

from __future__ import annotations

from decimal import Decimal
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
