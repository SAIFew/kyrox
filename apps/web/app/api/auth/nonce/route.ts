import { isAddress } from "viem";

import { authStore } from "@/lib/server/store-singleton";
import { issueNonce } from "@/lib/server/auth";
import { clientIp, error, json, rateLimit, sameOrigin } from "@/lib/server/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  if (!rateLimit(`nonce:${clientIp(req)}`, 8))
    return error("Too many authentication attempts.", 429, "rate_limited");

  let address: string | undefined;
  try {
    const body = (await req.json()) as { address?: string };
    address = body.address;
  } catch {
    return error("Malformed JSON body.", 400, "bad_json");
  }
  if (!isAddress(address ?? ""))
    return error("A valid wallet address is required.", 400, "address");

  const message = await issueNonce(authStore(), address?.toLowerCase() ?? null);
  return json({ message });
}
