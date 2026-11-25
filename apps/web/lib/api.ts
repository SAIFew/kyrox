export const UNAUTHORIZED_EVENT = "kyrox:unauthorized";

function notifyUnauthorized(error: ApiError): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(UNAUTHORIZED_EVENT, {
      detail: { message: error.message, status: error.status, code: error.code },
    }),
  );
}

export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = null;
  if (contentType.includes("application/json")) {
    try {
      payload = (await response.json()) as unknown;
    } catch (error) {
      if (response.ok) throw error;
    }
  }
  if (!response.ok) {
    const record =
      payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const error = new ApiError(
      typeof record["error"] === "string"
        ? record["error"]
        : `Request failed (${response.status}).`,
      response.status,
      typeof record["code"] === "string" ? record["code"] : "request_failed",
    );
    if (error.status === 401) notifyUnauthorized(error);
    throw error;
  }
  return payload as T;
}
