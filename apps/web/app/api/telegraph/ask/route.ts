import { NextResponse } from "next/server";
import { desc, and, eq } from "drizzle-orm";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { getDb, verdicts } from "@zengawd/db";
import { buildGuardTarget, runGuard, verdictToJson } from "@zengawd/engine";
import { attestVerdict } from "@/lib/server/attest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Telegraph miner surface: serves TRANSACTION_RISK_ASSESSMENT / FRAUD_DETECTION to the network.
 *
 * Unlike /api/guard (operator-facing, always runs the full paid pipeline), this route is cache-first.
 * A fresh run spends real USDC from the x402 burner on up to 13 intents, so live runs are gated by
 * TELEGRAPH_MINER_LIVE and a per-hour budget; otherwise a stale or absent verdict answers
 * INSUFFICIENT_SIGNAL rather than spending. Never returns a fabricated score.
 */
type Body = { query?: string; target?: string; chainId?: number | string; from?: string };

const CACHE_TTL_SEC = Number(process.env.TELEGRAPH_MINER_CACHE_TTL_SEC ?? 900);
const LIVE_ENABLED = process.env.TELEGRAPH_MINER_LIVE === "true";
const MAX_LIVE_PER_HOUR = Number(process.env.TELEGRAPH_MINER_MAX_LIVE_PER_HOUR ?? 6);
const DEFAULT_CHAIN_ID = Number(process.env.TELEGRAPH_MINER_CHAIN_ID ?? 1);

/** In-process budget. Per instance by design: a cold instance may run one extra, never a runaway loop. */
const liveRuns: number[] = [];

function liveBudgetLeft(): number {
  const cutoff = Date.now() - 3_600_000;
  while (liveRuns.length && liveRuns[0]! < cutoff) liveRuns.shift();
  return MAX_LIVE_PER_HOUR - liveRuns.length;
}

/** First address, then first URL, mentioned anywhere in the query. */
function subjectFromQuery(q: string): string | null {
  const addr = q.match(/0x[0-9a-fA-F]{40}/)?.[0];
  if (addr && isAddress(addr)) return getAddress(addr);
  const url = q.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  return url ?? null;
}

function answer(fields: Record<string, unknown>): NextResponse {
  return NextResponse.json({ intent: "TRANSACTION_RISK_ASSESSMENT", ...fields });
}

function insufficient(reason: string, extra: Record<string, unknown> = {}): NextResponse {
  return answer({ label: "INSUFFICIENT_SIGNAL", score: null, confidence: 0, reason, cached: false, ...extra });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const chainId = Number(body.chainId ?? DEFAULT_CHAIN_ID);
  if (!Number.isInteger(chainId) || chainId <= 0) return NextResponse.json({ error: "chainId must be a positive integer" }, { status: 400 });

  const subject = (body.target?.trim() || "") || subjectFromQuery(query);
  if (!subject) {
    return insufficient("Query names no contract address, wallet address or URL to evaluate.", { target: null, chainId });
  }

  let built: ReturnType<typeof buildGuardTarget>;
  const from = body.from && isAddress(body.from) ? (getAddress(body.from) as Address) : (zeroAddress as Address);
  try {
    built = buildGuardTarget({ chainId, from, input: subject });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  // URL-only targets all carry the zero address as callee, so they share no cache key: never serve them from cache.
  const cacheable = built.target.to !== zeroAddress;
  const cached = !cacheable
    ? undefined
    : getDb()
    .select()
    .from(verdicts)
    .where(and(eq(verdicts.targetAddress, built.target.to), eq(verdicts.chainId, chainId)))
    .orderBy(desc(verdicts.createdAt))
    .limit(1)
    .get();

  if (cached) {
    const ageSec = (Date.now() - Date.parse(cached.createdAt)) / 1000;
    if (ageSec <= CACHE_TTL_SEC) return served(cached.verdict, cached.score, cached.payload, cached.verdictHash, cached.onchainTxHash, true, Math.round(ageSec), subject, chainId);
  }

  if (!LIVE_ENABLED) {
    return insufficient("No verdict within cache TTL; live scoring is disabled on this instance (TELEGRAPH_MINER_LIVE).", { target: subject, chainId });
  }
  if (liveBudgetLeft() <= 0) {
    return insufficient(`No verdict within cache TTL; hourly live-scoring budget of ${MAX_LIVE_PER_HOUR} is exhausted.`, { target: subject, chainId });
  }

  liveRuns.push(Date.now());
  const verdict = await runGuard(built.target);
  const attestation = await attestVerdict(verdict);
  const json = verdictToJson({ ...verdict, onchainTxHash: attestation.txHash });
  return served(verdict.verdict, verdict.score, JSON.stringify(json), verdict.verdictHash, attestation.txHash, false, 0, subject, chainId);
}

function served(
  label: string,
  score: number,
  payload: string,
  verdictHash: string,
  onchainTxHash: string | null,
  fromCache: boolean,
  ageSeconds: number,
  target: string,
  chainId: number,
): NextResponse {
  let reason = "";
  let signalCount = 0;
  let attempted = 0;
  try {
    const parsed = JSON.parse(payload) as { signals?: { status: string; rationale: string; advisory: boolean }[] };
    const all = parsed.signals ?? [];
    // Coverage over signals that were actually applicable: skipped adapters are not evidence either way.
    attempted = all.filter((s) => s.status !== "skipped").length;
    const ok = all.filter((s) => s.status === "ok");
    signalCount = ok.length;
    reason = ok
      .filter((s) => !s.advisory)
      .slice(0, 3)
      .map((s) => s.rationale)
      .join(" ");
  } catch {
    reason = "";
  }
  if (!reason) reason = `Composite risk score ${score} of 100 across ${signalCount} returned signals.`;

  // Confidence is evidence coverage, not risk: how many applicable signals actually answered.
  const confidence = attempted > 0 ? Math.round((signalCount / attempted) * 100) / 100 : 0;

  return NextResponse.json({
    intent: "TRANSACTION_RISK_ASSESSMENT",
    label,
    score,
    confidence,
    reason,
    target,
    chainId,
    signalCount,
    verdictHash,
    attestationTx: onchainTxHash,
    cached: fromCache,
    ageSeconds,
  });
}
