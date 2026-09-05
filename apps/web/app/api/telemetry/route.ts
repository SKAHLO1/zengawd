import { NextResponse } from "next/server";
import { readTail, readTelemetry } from "@/lib/server/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public, unauthenticated telemetry. `?tail=1` returns only the latest 100 requests for live polling. */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  if (url.searchParams.get("tail")) return NextResponse.json({ tail: await readTail(100), generatedAt: new Date().toISOString() });
  return NextResponse.json(await readTelemetry());
}
