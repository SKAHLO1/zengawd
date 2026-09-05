import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { buildGuardTarget, runGuard, verdictToJson } from "@zengawd/engine";
import { attestVerdict } from "@/lib/server/attest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Body = { chainId?: number; from?: string; input?: string; lureText?: string };

/** Run the guard pipeline. All Telegraph calls and the attestor signature happen here, server-side. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const chainId = Number(body.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) return NextResponse.json({ error: "chainId required" }, { status: 400 });
  if (!body.from || !isAddress(body.from)) return NextResponse.json({ error: "from must be a wallet address" }, { status: 400 });
  if (!body.input?.trim()) return NextResponse.json({ error: "input required" }, { status: 400 });

  let built: ReturnType<typeof buildGuardTarget>;
  try {
    built = buildGuardTarget({ chainId, from: body.from, input: body.input, ...(body.lureText ? { lureText: body.lureText } : {}) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const verdict = await runGuard(built.target);
  const attestation = await attestVerdict(verdict);
  return NextResponse.json({ verdict: verdictToJson({ ...verdict, onchainTxHash: attestation.txHash }), parsed: built.parsed.kind, attestation });
}
