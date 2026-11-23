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
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : null;
  if (!response.ok) {
    const record =
      payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    throw new ApiError(
      typeof record["error"] === "string"
        ? record["error"]
        : `Request failed (${response.status}).`,
      response.status,
      typeof record["code"] === "string" ? record["code"] : "request_failed",
    );
  }
  return payload as T;
}
