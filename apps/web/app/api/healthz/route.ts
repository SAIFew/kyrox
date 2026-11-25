export const dynamic = "force-dynamic";

/** Liveness only: the Node process can answer requests. No dependency probes. */
export async function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
