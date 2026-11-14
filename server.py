"""KYROX Model Context Protocol (MCP) server entrypoint.

Exposes KYROX tools over MCP stdio transport using FastMCP with centralized
structured JSONL audit logging and error handling.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from tools.errors import EmptyInputError, redact_text
from tools.log import audit_tool_call
from tools.stocks import find_stock, load_stocks
from tools.wallet import get_balances

mcp = FastMCP("KYROX")


@mcp.tool()
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


@mcp.tool()
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


@mcp.tool()
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


@mcp.tool()
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


def main() -> None:
    """Start the KYROX MCP server using STDIO transport."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
