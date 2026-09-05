import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, verdicts } from "@zengawd/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return ctx.params.then(({ id }) => {
    const row = getDb().select().from(verdicts).where(eq(verdicts.id, id)).get();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ...row, payload: JSON.parse(row.payload) as unknown });
  });
}
