import { NextResponse } from "next/server";

import { MCP_TOOLS, callTool } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "kyrox-preview", title: "KYROX Market Bridge", version: "1.0.0" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, Accept",
};

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcError(id: string | number | null, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { headers: { ...CORS, "MCP-Protocol-Version": PROTOCOL_VERSION } },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json(
    {
      server: {
        ...SERVER_INFO,
        transport: "streamable-http (JSON responses)",
        protocolVersion: PROTOCOL_VERSION,
      },
      endpoint: "/api/mcp",
      tools: MCP_TOOLS,
      boundary: {
        readOnly: true,
        signing: false,
        broadcasting: false,
        arbitraryCalldata: false,
        note: "The bridge exposes read and quote tools only. The user's wallet remains the sole signer.",
      },
    },
    { headers: CORS },
  );
}

export async function POST(request: Request) {
  let body: RpcRequest | RpcRequest[];
  try {
    body = (await request.json()) as RpcRequest | RpcRequest[];
  } catch {
    return rpcError(null, -32_700, "Parse error");
  }

  if (Array.isArray(body)) {
    const responses = body.map((entry) => handle(entry));
    return NextResponse.json(
      responses.filter((entry) => entry !== null),
      { headers: { ...CORS, "MCP-Protocol-Version": PROTOCOL_VERSION } },
    );
  }

  const result = handle(body);
  if (result === null) return new NextResponse(null, { status: 202, headers: CORS });
  return NextResponse.json(result, {
    headers: { ...CORS, "MCP-Protocol-Version": PROTOCOL_VERSION },
  });
}

function handle(request: RpcRequest): Record<string, unknown> | null {
  const id = request.id ?? null;
  const method = request.method ?? "";
  const params = request.params ?? {};

  if (id === null && method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion:
            typeof params["protocolVersion"] === "string"
              ? params["protocolVersion"]
              : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "KYROX preview bridge. Read-only market data and deterministic quotes. No tool can sign, send, transfer, or build arbitrary calldata.",
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: MCP_TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          })),
        },
      };
    case "tools/call": {
      const name = typeof params["name"] === "string" ? params["name"] : "";
      const args =
        params["arguments"] !== null && typeof params["arguments"] === "object"
          ? (params["arguments"] as Record<string, unknown>)
          : {};
      if (!MCP_TOOLS.some((tool) => tool.name === name)) {
        return { jsonrpc: "2.0", id, error: { code: -32_602, message: `Unknown tool: ${name}` } };
      }
      try {
        const output = callTool(name, args);
        const isError = typeof output === "object" && output !== null && "error" in output;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
            isError,
          },
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : "Tool execution failed.",
              },
            ],
            isError: true,
          },
        };
      }
    }
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32_601, message: `Method not found: ${method}` },
      };
  }
}
