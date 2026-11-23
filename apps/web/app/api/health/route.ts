import { NextResponse } from "next/server";

import { isDemoMode } from "@/lib/demo/mode";
import { environmentInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "kyrox-web",
    mode: isDemoMode() ? "demo" : "live",
    environment: environmentInfo(),
    now: new Date().toISOString(),
  });
}
