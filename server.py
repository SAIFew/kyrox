"""KYROX Model Context Protocol (MCP) server entrypoint.

Exposes KYROX tools over MCP stdio transport using FastMCP.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

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


def main() -> None:
    """Start the KYROX MCP server using STDIO transport."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()

