import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import { getDb, newId, nowIso, watchedApprovals, watchedUsers } from "@zengawd/db";
import { revocationCalldata, scanApprovals } from "@zengawd/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** GET /api/approvals?address=0x…&chainId=1 — live scan merged with the watcher's last risk state. */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const address = url.searchParams.get("address") ?? "";
  const chainId = Number(url.searchParams.get("chainId") ?? "1");
  if (!isAddress(address)) return NextResponse.json({ error: "address required" }, { status: 400 });
  const owner = getAddress(address);
  const db = getDb();
  let live;
  try {
    live = await scanApprovals(chainId, owner);
  } catch (e) {
    return NextResponse.json({ error: `scan failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const watched = db.select().from(watchedApprovals).where(and(eq(watchedApprovals.userAddress, owner), eq(watchedApprovals.chainId, chainId))).all();
  const user = db.select().from(watchedUsers).where(eq(watchedUsers.userAddress, owner)).get() ?? null;
  const rows = live.map((a) => {
    const w = watched.find((x) => x.tokenAddress === a.token && x.spenderAddress === a.spender);
    return {
      ...a,
      lastBlock: a.lastBlock.toString(),
      lastVerdict: w?.lastVerdict ?? null,
      lastScore: w?.lastScore ?? null,
      lastCheckedAt: w?.lastCheckedAt ?? null,
      lastVerdictId: w?.lastVerdictId ?? null,
      revocationRecommendedAt: w?.revocationRecommendedAt ?? null,
      revocationTxHash: w?.revocationTxHash ?? null,
      revokeCalldata: revocationCalldata(a.standard, a.spender),
    };
  });
  return NextResponse.json({ owner, chainId, registered: Boolean(user), autoRevokeEnabled: user?.autoRevokeEnabled ?? false, safeAddress: user?.safeAddress ?? null, approvals: rows });
}

type RegisterBody = { address?: string; chainId?: number; action?: "register" | "optInAutoRevoke" | "optOutAutoRevoke"; safeAddress?: string };

/** POST registers a wallet for watching, or records the explicit auto-revoke opt-in / opt-out. */
export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as RegisterBody;
  if (!body.address || !isAddress(body.address)) return NextResponse.json({ error: "address required" }, { status: 400 });
  const owner = getAddress(body.address);
  const chainId = Number(body.chainId ?? 1);
  const db = getDb();
  const existing = db.select().from(watchedUsers).where(eq(watchedUsers.userAddress, owner)).get();
  const action = body.action ?? "register";
  if (action === "register") {
    if (!existing) db.insert(watchedUsers).values({ userAddress: owner, chainId, autoRevokeEnabled: false, createdAt: nowIso() }).run();
    else db.update(watchedUsers).set({ chainId }).where(eq(watchedUsers.userAddress, owner)).run();
    return NextResponse.json({ ok: true, registered: true, autoRevokeEnabled: existing?.autoRevokeEnabled ?? false });
  }
  if (!existing) return NextResponse.json({ error: "register the address first" }, { status: 400 });
  if (action === "optInAutoRevoke") {
    if (!body.safeAddress || !isAddress(body.safeAddress)) return NextResponse.json({ error: "auto-revocation requires a Safe address that has enabled ZengawdGuardModule" }, { status: 400 });
    db.update(watchedUsers).set({ autoRevokeEnabled: true, autoRevokeOptInAt: nowIso(), safeAddress: getAddress(body.safeAddress) }).where(eq(watchedUsers.userAddress, owner)).run();
    return NextResponse.json({ ok: true, autoRevokeEnabled: true });
  }
  db.update(watchedUsers).set({ autoRevokeEnabled: false, safeAddress: null }).where(eq(watchedUsers.userAddress, owner)).run();
  return NextResponse.json({ ok: true, autoRevokeEnabled: false });
}

export function newWatchId(): string {
  return newId();
}
