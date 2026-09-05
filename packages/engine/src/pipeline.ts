import { getDb, newId, nowIso, verdicts as verdictsTable, type Db } from "@zengawd/db";
import { requestIntent as defaultRequestIntent, type IntentRequest, type IntentResult, type RequestOptions } from "@zengawd/telegraph";
import { zeroAddress } from "viem";
import { buildContext, STAGE1_ADAPTERS, STAGE2_ADAPTERS, type Adapter, type AdapterContext } from "./adapters";
import { decodeCalldata } from "./decode";
import { readContractFacts } from "./facts";
import { hashInputFromTarget, verdictHash } from "./hash";
import { decideStage1, decideStage2 } from "./scoring";
import { THRESHOLDS } from "./thresholds";
import type { ContractFacts, GuardTarget, Signal, Verdict, VerdictJson } from "./types";

export type RequestIntentFn = <T = unknown>(req: IntentRequest, opts?: RequestOptions) => Promise<IntentResult<T>>;

export type PipelineDeps = {
  requestIntent?: RequestIntentFn;
  readFacts?: (chainId: number, address: `0x${string}`) => Promise<ContractFacts>;
  db?: Db | null;
  /** Skip Stage 2 even when the band is ambiguous (watcher uses Stage 1 only). */
  stage1Only?: boolean;
  onSignal?: (signal: Signal) => void;
};

/** Run the full guard pipeline for a target: Stage 1 fan-out, escalation, Stage 2 fan-out, persist. */
export async function runGuard(target: GuardTarget, deps: PipelineDeps = {}): Promise<Verdict> {
  const requestIntent = deps.requestIntent ?? (defaultRequestIntent as RequestIntentFn);
  const readFacts = deps.readFacts ?? readContractFacts;
  const db = deps.db === undefined ? await getDb() : deps.db;
  const verdictId = newId();
  const createdAt = nowIso();

  const decoded = decodeCalldata(target.to, target.calldata);
  const subject = decoded.token ?? (target.to !== zeroAddress ? target.to : null);
  let facts: ContractFacts | null = null;
  if (subject) {
    try {
      facts = await readFacts(target.chainId, subject);
    } catch {
      facts = null;
    }
  }
  const ctx = buildContext(target, decoded, facts);

  const t1 = Date.now();
  const stage1 = await Promise.all(STAGE1_ADAPTERS.map((a) => runAdapter(a, ctx, requestIntent, verdictId, deps.onSignal)));
  const stage1LatencyMs = Date.now() - t1;
  const d1 = decideStage1(stage1);

  let signals = stage1;
  let stage2LatencyMs: number | null = null;
  let escalated = false;
  let label: Verdict["verdict"];
  let score: number;
  if (d1.kind === "final" || deps.stage1Only) {
    label = d1.kind === "final" ? d1.verdict : "BLOCK";
    score = d1.score;
    if (d1.kind === "escalate") {
      // stage1Only: ambiguous without Stage 2 is treated conservatively as BLOCK for execution.
      label = "BLOCK";
    }
  } else {
    escalated = true;
    const t2 = Date.now();
    const stage2 = await Promise.all(STAGE2_ADAPTERS.map((a) => runAdapter(a, ctx, requestIntent, verdictId, deps.onSignal)));
    stage2LatencyMs = Date.now() - t2;
    signals = [...stage1, ...stage2];
    const d2 = decideStage2(signals);
    label = d2.verdict;
    score = d2.score;
  }

  const costs = signals.map((s) => s.costUsd).filter((c): c is number => typeof c === "number");
  const totalCostUsd = costs.length ? round4(costs.reduce((a, b) => a + b, 0)) : null;
  const hash = verdictHash(hashInputFromTarget(target, label, score, createdAt));

  const verdict: Verdict = {
    id: verdictId,
    target,
    decoded,
    facts,
    verdict: label,
    score,
    escalated,
    signals,
    stage1Score: d1.score,
    stage1LatencyMs,
    stage2LatencyMs,
    totalCostUsd,
    createdAt,
    verdictHash: hash,
    onchainTxHash: null,
  };

  if (db) {
    await db
      .insert(verdictsTable)
      .values({
        id: verdictId,
        chainId: target.chainId,
        userAddress: target.from,
        targetAddress: target.to,
        selector: decoded.selector,
        calldata: target.calldata,
        verdict: label,
        score,
        escalated,
        verdictHash: hash,
        onchainTxHash: null,
        stage1LatencyMs,
        stage2LatencyMs,
        totalCostUsd,
        payload: JSON.stringify(verdictToJson(verdict)),
        createdAt,
      });
  }
  return verdict;
}

async function runAdapter(adapter: Adapter, ctx: AdapterContext, requestIntent: RequestIntentFn, verdictId: string, onSignal?: (s: Signal) => void): Promise<Signal> {
  const base: Signal = {
    id: adapter.id,
    intent: adapter.intent,
    risk: null,
    weight: adapter.weight,
    rationale: "",
    evidence: null,
    status: "skipped",
    stage: adapter.stage,
    advisory: adapter.advisory,
    minerId: null,
    minerName: null,
    latencyMs: 0,
    costUsd: null,
    txHash: null,
    signalHash: null,
    confidence: null,
    reason: null,
  };
  const skip = adapter.skip(ctx);
  if (skip) {
    const s = { ...base, status: "skipped" as const, reason: skip, rationale: `Skipped: ${skip}.` };
    onSignal?.(s);
    return s;
  }
  const stageCfg = adapter.stage === 1 ? THRESHOLDS.STAGE1 : THRESHOLDS.STAGE2;
  const q = adapter.query(ctx);
  const payload: Record<string, unknown> = { query: q.query };
  if (q.context) payload.context = q.context;
  const req = { intent: adapter.intent, payload, minConfidence: stageCfg.minConfidence, deadlineMs: stageCfg.deadlineMs };

  // Re-declare the intent when the network fails to answer: probabilistic routing usually picks a
  // different miner on the next attempt. Structural refusals are final and never retried.
  let result = await requestIntent(req, { verdictId });
  for (let attempt = 1; attempt < THRESHOLDS.ADAPTER_ATTEMPTS && result.status === "unavailable"; attempt++) {
    if (!isRetryable(result.reason)) break;
    result = await requestIntent(req, { verdictId });
  }

  let signal: Signal;
  if (result.status === "unavailable") {
    // An adapter may recognise a semantic refusal (e.g. "unsupported asset") as real evidence.
    const salvaged = adapter.interpretError?.(result.reason, ctx) ?? null;
    signal =
      salvaged && !("unavailable" in salvaged)
        ? {
            ...base,
            status: "ok",
            risk: clamp(salvaged.risk),
            rationale: salvaged.rationale,
            evidence: { interpretedFrom: "upstream refusal", reason: result.reason },
            latencyMs: result.latencyMs,
            minerId: result.minerId ?? null,
            txHash: result.txHash ?? null,
          }
        : {
            ...base,
            status: "unavailable",
            reason: result.reason,
            rationale: `Unavailable: ${result.reason}.`,
            latencyMs: result.latencyMs,
            minerId: result.minerId ?? null,
            txHash: result.txHash ?? null,
          };
  } else {
    const interp = adapter.interpret(result.data, ctx);
    const common = {
      ...base,
      evidence: result.data,
      minerId: result.minerId,
      minerName: result.minerName,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      txHash: result.txHash,
      signalHash: result.signalHash,
      confidence: result.confidence,
    };
    if ("unavailable" in interp) {
      signal = { ...common, status: "unavailable", reason: interp.unavailable, rationale: `Unavailable: ${interp.unavailable}.` };
    } else {
      signal = { ...common, status: "ok", risk: clamp(interp.risk), rationale: interp.rationale };
    }
  }
  onSignal?.(signal);
  return signal;
}

/**
 * A reason worth re-declaring the intent for. Structural refusals are properties of the network or
 * the request itself and would fail identically on a second attempt, so paying again is waste.
 */
function isRetryable(reason: string): boolean {
  return !/no live miners|not in the canonical catalog|payload\.query|minConfidence must|deadlineMs must/i.test(reason);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function verdictToJson(v: Verdict): VerdictJson {
  return {
    ...v,
    target: { ...v.target, value: v.target.value.toString() },
    decoded: {
      ...v.decoded,
      amount: v.decoded.amount === null ? null : v.decoded.amount.toString(),
      args: v.decoded.args ? JSON.parse(JSON.stringify(v.decoded.args, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) : null,
    },
  };
}
