import { NextResponse } from "next/server";

import { MCP_TOOLS, callTool, mcpTools } from "@/lib/mcp/server";
import { isDemoMode } from "@/lib/demo/mode";
import { clientIp, rateLimit } from "@/lib/server/http";
import { isPlainObject, readJson, RequestError } from "@/lib/server/request";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "kyrox-market-bridge", title: "KYROX Market Bridge", version: "1.0.0" };
const ALL_TOOL_NAMES = new Set(MCP_TOOLS.map((tool) => tool.name));
const MAX_BATCH_SIZE = 20;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, Accept",
};

function headers(protocolVersion = false): Record<string, string> {
  return {
    ...CORS,
    ...(protocolVersion ? { "MCP-Protocol-Version": PROTOCOL_VERSION } : {}),
  };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  status = 200,
): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status, headers: headers(true) },
  );
}

function rateLimited(): NextResponse {
  return NextResponse.json(
    { error: "Too many MCP requests.", code: "rate_limited" },
    { status: 429, headers: headers(true) },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  if (!rateLimit(`mcp-discovery:${clientIp(req)}`, 120)) {
    return rateLimited();
  }
  const demo = isDemoMode();
  return NextResponse.json(
    {
      server: {
        ...SERVER_INFO,
        transport: "streamable-http (JSON responses)",
        protocolVersion: PROTOCOL_VERSION,
      },
      endpoint: "/api/mcp",
      tools: mcpTools(),
      boundary: {
        readOnly: true,
        signing: false,
        broadcasting: false,
        arbitraryCalldata: false,
        note: demo
          ? "The preview bridge exposes simulated read and quote tools only. The user's wallet remains the sole signer."
          : "Live discovery exposes only protocol status. Authenticated market and quote operations are not claimed by this bridge.",
      },
    },
    { headers: headers(true) },
  );
}

export async function POST(request: Request) {
  if (!rateLimit(`mcp-call:${clientIp(request)}`, 60)) return rateLimited();

  let body: unknown;
  try {
    body = await readJson(request, { maximumBytes: 65_536 });
  } catch (err) {
    if (err instanceof RequestError) return rpcError(null, -32_700, "Parse error", err.status);
    return rpcError(null, -32_700, "Parse error", 400);
  }

  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, -32_600, "Invalid Request", 400);
    if (body.length > MAX_BATCH_SIZE) {
      return rpcError(null, -32_600, "MCP batch size exceeds the supported limit.", 413);
    }
    const responses = body.map((entry) => handle(entry)).filter((entry) => entry !== null);
    if (responses.length === 0)
      return new NextResponse(null, { status: 202, headers: headers(true) });
    return NextResponse.json(responses, {
      status: responses.some(isInvalidRpcRequest) ? 400 : 200,
      headers: headers(true),
    });
  }

  if (!isPlainObject(body)) return rpcError(null, -32_600, "Invalid Request", 400);
  const result = handle(body);
  if (result === null) return new NextResponse(null, { status: 202, headers: headers(true) });
  return NextResponse.json(result, {
    status: isInvalidRpcRequest(result) ? 400 : 200,
    headers: headers(true),
  });
}

function isInvalidRpcRequest(result: Record<string, unknown>): boolean {
  if (!("error" in result) || typeof result.error !== "object" || result.error === null)
    return false;
  if (!("code" in result.error)) return false;
  return result.error.code === -32_600 || result.error.code === -32_602;
}

function validId(value: unknown): value is string | number | null {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function handle(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid Request" } };
  }
  const idValue = value["id"] ?? null;
  const id = validId(idValue) ? idValue : null;
  const methodValue = value["method"];
  const paramsValue = "params" in value ? value["params"] : {};
  if (
    value["jsonrpc"] !== "2.0" ||
    typeof methodValue !== "string" ||
    !validId(idValue) ||
    !isPlainObject(paramsValue)
  ) {
    return { jsonrpc: "2.0", id, error: { code: -32_600, message: "Invalid Request" } };
  }
  const method = methodValue;
  const params = paramsValue;
  if (!("id" in value) && method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: isDemoMode()
            ? "KYROX preview bridge. Simulated read-only market data and deterministic quotes. No tool can sign, send, transfer, or build arbitrary calldata."
            : "KYROX live bridge. Only protocol status is available; market and quote tools are intentionally not advertised. No tool can sign, send, transfer, or build arbitrary calldata.",
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: mcpTools().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          })),
        },
      };
    case "tools/call": {
      const name = params["name"];
      if (typeof name !== "string") {
        return { jsonrpc: "2.0", id, error: { code: -32_602, message: "Tool name is required." } };
      }
      const argsValue = "arguments" in params ? params["arguments"] : {};
      if (!isPlainObject(argsValue)) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32_602, message: "Tool arguments must be an object." },
        };
      }
      if (!ALL_TOOL_NAMES.has(name)) {
        return { jsonrpc: "2.0", id, error: { code: -32_602, message: `Unknown tool: ${name}` } };
      }
      try {
        const output = callTool(name, argsValue);
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
      } catch {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: "Tool execution failed." }],
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
