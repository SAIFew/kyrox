"""KYROX Model Context Protocol (MCP) server entrypoint.

Exposes KYROX tools over MCP stdio transport using FastMCP.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from tools.stocks import find_stock

mcp = FastMCP("KYROX")


@mcp.tool()
def hello_kyrox(name: str) -> str:
    """Return a connectivity greeting from the KYROX MCP server.

    Args:
        name: The caller or user name to greet.

    Returns:
        A formatted greeting confirming the KYROX MCP server is live.
    """
    return f"Hello {name}, KYROX is live."


@mcp.tool()
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
        return {"error": f"Ticker {normalized_ticker} not found."}

    return stock


def main() -> None:
    """Start the KYROX MCP server using STDIO transport."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()

