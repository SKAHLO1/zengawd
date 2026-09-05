import { NextResponse } from "next/server";
import { eq, getDb, verdicts } from "@zengawd/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const db = await getDb();
  const [row] = await db.select().from(verdicts).where(eq(verdicts.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...row, payload: JSON.parse(row.payload) as unknown });
}
