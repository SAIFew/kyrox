"""KYROX Model Context Protocol (MCP) server entrypoint.

Exposes KYROX tools over MCP stdio transport using FastMCP with centralized
structured JSONL audit logging and error handling.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import StrictFloat, StrictInt, StrictStr

from tools.errors import EmptyInputError, redact_text
from tools.log import audit_tool_call
from tools.stocks import find_stock, load_stocks
from tools.tx import (
    prepare_transaction as _prepare_erc20_transaction,
    simulate_transaction as _simulate_erc20_transaction,
)
from tools.wallet import get_balances, get_portfolio as _get_wallet_portfolio

mcp = FastMCP("KYROX")

READ_ONLY_LOCAL_ANNOTATIONS = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=False,
)
READ_ONLY_ONCHAIN_ANNOTATIONS = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)


@mcp.tool(annotations=READ_ONLY_LOCAL_ANNOTATIONS)
@audit_tool_call("hello_kyrox", reraise_exceptions=(ValueError,))
def hello_kyrox(name: str) -> str:
    """Return a connectivity greeting from the KYROX MCP server.

    Args:
        name: The caller or user name to greet.

    Returns:
        A formatted greeting confirming the KYROX MCP server is live.
    """
    if not isinstance(name, str) or not name.strip():
        raise EmptyInputError("Caller name must not be empty.")
    safe_name = redact_text(name.strip())
    return f"Hello {safe_name}, KYROX is live."


@mcp.tool(annotations=READ_ONLY_LOCAL_ANNOTATIONS)
@audit_tool_call("get_stock_info", reraise_exceptions=(FileNotFoundError, ValueError))
def get_stock_info(ticker: str) -> dict[str, Any]:
    """Retrieve stock information for a given ticker symbol.

    Args:
        ticker: The stock ticker symbol to look up (e.g., "tAAPL").

    Returns:
        The matching stock record dictionary, or an error dictionary when
        the ticker is blank or not found.
    """
    if not isinstance(ticker, str) or not ticker.strip():
        return {"error": "Ticker must not be empty."}

    normalized_ticker = ticker.strip()
    stock = find_stock(normalized_ticker)
    if stock is None:
        safe_ticker = redact_text(normalized_ticker)
        return {"error": f"Ticker {safe_ticker} not found."}

    return stock


@mcp.tool(annotations=READ_ONLY_LOCAL_ANNOTATIONS)
@audit_tool_call("list_stocks", reraise_exceptions=(FileNotFoundError, ValueError))
def list_stocks() -> list[dict[str, Any]]:
    """Return a list of all available stocks in KYROX.

    Returns:
        A list of stock summary dictionaries containing ``ticker``, ``name``,
        and ``reference_value`` in source order.
    """
    stocks = load_stocks()
    return [
        {
            "ticker": s["ticker"],
            "name": s["stock"],
            "reference_value": s["reference_value"],
        }
        for s in stocks
    ]


@mcp.tool(annotations=READ_ONLY_ONCHAIN_ANNOTATIONS)
@audit_tool_call("get_wallet_balances", reraise_exceptions=(FileNotFoundError,))
def get_wallet_balances(wallet: str) -> dict[str, Any]:
    """Read tokenized stock balances for a public wallet on Base Sepolia.

    Args:
        wallet: Public Ethereum wallet address to inspect on Base Sepolia.

    Returns:
        A dictionary containing the checksummed ``wallet``, ``chain``
        (``"base-sepolia"``), and non-zero token ``balances``, or an ``error``
        dictionary when validation or RPC communication fails.
    """
    return get_balances(wallet)


@mcp.tool(annotations=READ_ONLY_ONCHAIN_ANNOTATIONS)
@audit_tool_call("get_portfolio", reraise_exceptions=(FileNotFoundError,))
def get_portfolio(wallet: str) -> dict[str, Any]:
    """Read tokenized stock holdings and compute a structured portfolio valuation on Base Sepolia.

    Args:
        wallet: Public Ethereum wallet address to inspect on Base Sepolia.

    Returns:
        A structured portfolio dictionary containing ``wallet``, ``chain``
        (``"base-sepolia"``), ``chain_id`` (``84532``), ``environment``
        (``"mock"``), ``valuation_basis`` (``"mock_reference_value"``),
        ``currency``, ``holdings``, ``total_value``, ``total_value_decimal``,
        ``unpriced_holdings``, and ``warnings``, or an ``error`` dictionary
        when validation or RPC communication fails.
    """
    return _get_wallet_portfolio(wallet)


@mcp.tool(annotations=READ_ONLY_ONCHAIN_ANNOTATIONS)
@audit_tool_call(
    "prepare_transaction",
    reraise_exceptions=(FileNotFoundError,),
    fail_closed=True,
)
def prepare_transaction(
    from_wallet: str,
    ticker: str,
    to: str,
    amount: StrictInt | StrictFloat | StrictStr,
) -> dict[str, Any]:
    """Prepare an UNSIGNED ERC-20 token transfer transaction intent on Base Sepolia (NO SIGNING, NO BROADCASTING).

    Constructs an unsigned ERC-20 ``transfer(to, amount_base_units)`` transaction
    envelope targeting the configured token contract on Base Sepolia
    (``chainId: 84532``). Always returns ``signed: false`` for external human
    wallet review and signing. KYROX never accepts private keys, performs NO
    SIGNING, and performs NO BROADCASTING.

    Args:
        from_wallet: Public sender Ethereum wallet address on Base Sepolia.
        ticker: Approved tokenized-stock ticker symbol (e.g., ``"tAAPL"``).
        to: Public recipient Ethereum wallet address on Base Sepolia.
        amount: Positive token amount to transfer (integer, number, or decimal string).

    Returns:
        A structured unsigned transaction intent dictionary with ``signed: False``,
        ``unsigned_tx``, ``data`` calldata, ``amount_base_units``, ``intent_hash``,
        and ``expires_at``, or an ``error`` dictionary when validation, policy, or
        RPC checks fail.
    """
    return _prepare_erc20_transaction(from_wallet, ticker, to, amount)


@mcp.tool(annotations=READ_ONLY_ONCHAIN_ANNOTATIONS)
@audit_tool_call(
    "simulate_transaction",
    reraise_exceptions=(FileNotFoundError,),
    fail_closed=True,
)
def simulate_transaction(
    from_wallet: str,
    ticker: str,
    to: str,
    amount: StrictInt | StrictFloat | StrictStr,
) -> dict[str, Any]:
    """Simulate an UNSIGNED ERC-20 token transfer transaction on Base Sepolia using eth_call and eth_estimateGas (NO SIGNING, NO BROADCASTING).

    Prepares and verifies the unsigned ERC-20 ``transfer(to, amount_base_units)``
    transaction intent on Base Sepolia (``chainId: 84532``), enforces policy bounds,
    executes a read-only ``eth_call`` dry run against canonical block ``"latest"``
    (verifying the ABI-decoded ERC-20 ``bool`` return value), and estimates gas units
    via ``eth_estimateGas``. Always returns ``signed: false`` and ``broadcast: false``.
    KYROX never accepts private keys, performs NO SIGNING, and performs NO BROADCASTING.

    Args:
        from_wallet: Public sender Ethereum wallet address on Base Sepolia.
        ticker: Approved tokenized-stock ticker symbol (e.g., ``"tAAPL"``).
        to: Public recipient Ethereum wallet address on Base Sepolia.
        amount: Positive token amount to transfer (integer, number, or decimal string).

    Returns:
        A structured simulation result dictionary with ``would_succeed``,
        ``estimated_gas`` (in gas units when applicable), ``failure_reason``,
        ``signed: False``, ``broadcast: False``, and ``unsigned_tx``, or an
        ``error`` dictionary when validation, policy, or RPC checks fail.
    """
    return _simulate_erc20_transaction(from_wallet, ticker, to, amount)


def main() -> None:
    """Start the KYROX MCP server using STDIO transport."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
