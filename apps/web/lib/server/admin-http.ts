import { AdminError } from "./admin.js";
import { error, routeError } from "./http.js";

export async function adminErrorResponse(err: unknown, correlationId: string): Promise<Response> {
  if (err instanceof AdminError) {
    return error(err.message, err.status, err.code, correlationId);
  }
  return routeError(err, "admin_unavailable", correlationId);
}

export function queryParam(req: Request, name: string, maximum = 128): string | null {
  const value = new URL(req.url).searchParams.get(name);
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maximum);
}
