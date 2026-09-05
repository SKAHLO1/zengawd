import { describe, expect, it } from "vitest";
import { openDb, verdicts, intentRequests } from "@zengawd/db";
import type { IntentRequest, IntentResult } from "@zengawd/telegraph";
import { runGuard, type RequestIntentFn } from "./pipeline";
import { THRESHOLDS } from "./thresholds";
import type { ContractFacts, GuardTarget } from "./types";

const TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const USER = "0x1111111111111111111111111111111111111111" as const;

const tokenFacts: ContractFacts = { isContract: true, codeSize: 100, isErc20: true, isErc721: false, symbol: "TKN", name: "Token", decimals: 18 };

const target: GuardTarget = { chainId: 1, from: USER, to: TOKEN, calldata: "0x", value: 0n, originUrl: "https://example.org", lureText: "Claim your airdrop now!!!" };

/** Mocked network: every intent answers with a shape the adapters can read. Only allowed in *.test.ts. */
function mockNetwork(answers: Record<string, unknown | null>, seen: IntentRequest[] = []): RequestIntentFn {
  return (async (req: IntentRequest): Promise<IntentResult<unknown>> => {
    seen.push(req);
    const data = answers[req.intent];
    if (data === undefined || data === null) return { status: "unavailable", reason: "mock unavailable", latencyMs: 5 };
    return { status: "ok", data, confidence: 0.9, minerId: `miner-${req.intent}`, minerName: req.intent.toLowerCase(), latencyMs: 10, costUsd: 0.01, txHash: `0x${req.intent}`, signalHash: null, routedAt: new Date().toISOString(), reasoning: null, warnings: [] };
  }) as RequestIntentFn;
}

// Shapes mirror what the live miners actually return, including echoing back the subject
// (contract_address / symbol), which the adapters verify before trusting a figure.
const subject = { contract_address: TOKEN, symbol: "TKN" };

const benign = {
  ONCHAIN_TX_LOOKUP: { ...subject, deployed_at: "2020-01-01T00:00:00Z", tx_count: 5_000_000 },
  TOKEN_HOLDER_COUNT: { ...subject, holders: 3_000_000, confidence: 0.95 },
  TVL_LOOKUP: { ...subject, kind: "token", tvl_usd: 500_000_000 },
  WALLET_BALANCE_CHECK: { balance: 12.5 },
  CRYPTO_PRICE: { ...subject, price_usd: 1.0 },
  URL_SCAN: { verdict: "clean" },
  SSL_VERIFICATION: { valid: true, not_before: "2025-01-01T00:00:00Z" },
};

const malicious = {
  ONCHAIN_TX_LOOKUP: { ...subject, deployed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), tx_count: 3 },
  TOKEN_HOLDER_COUNT: { ...subject, holders: 12 },
  TVL_LOOKUP: { ...subject, kind: "token", tvl_usd: 1_500 },
  WALLET_BALANCE_CHECK: { balance: 0 },
  CRYPTO_PRICE: { error: "not found" },
  URL_SCAN: { malicious: true },
  SSL_VERIFICATION: { valid: true, not_before: new Date(Date.now() - 3 * 86_400_000).toISOString() },
};

describe("runGuard", () => {
  it("ALLOWs a benign target without running Stage 2", async () => {
    const db = openDb(":memory:");
    const seen: IntentRequest[] = [];
    const v = await runGuard(target, { db, requestIntent: mockNetwork(benign, seen), readFacts: async () => tokenFacts });
    expect(v.verdict).toBe("ALLOW");
    expect(v.escalated).toBe(false);
    expect(v.score).toBeLessThan(THRESHOLDS.ALLOW_BELOW);
    expect(seen.every((r) => r.minConfidence === THRESHOLDS.STAGE1.minConfidence)).toBe(true);
    expect(seen.map((r) => r.intent)).not.toContain("TWITTER_SEARCH");
    expect(db.select().from(verdicts).all()[0]?.verdict).toBe("ALLOW");
    expect(v.verdictHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("BLOCKs a malicious target at Stage 1", async () => {
    const v = await runGuard(target, { db: null, requestIntent: mockNetwork(malicious), readFacts: async () => tokenFacts });
    expect(v.verdict).toBe("BLOCK");
    expect(v.escalated).toBe(false);
    expect(v.score).toBeGreaterThan(THRESHOLDS.BLOCK_ABOVE);
  });

  it("escalates an ambiguous target, runs Stage 2, and scores FRAUD_DETECTION at zero weight", async () => {
    const ambiguous = { ...benign, TOKEN_HOLDER_COUNT: { ...subject, holders: 300 }, TVL_LOOKUP: { ...subject, kind: "token", tvl_usd: 50_000 }, WALLET_BALANCE_CHECK: { balance: 0 }, URL_SCAN: { verdict: "suspicious" } };
    const stage2 = {
      TWITTER_SEARCH: null,
      NEWS_SEARCH: { articles: [{ title: "Token launches" }] },
      FACT_CHECK: { verdict: "unverifiable" },
      AI_TEXT_DETECTION: { answer: 1 },
      CONTENT_MODERATION: { risk_level: "high" },
      FRAUD_DETECTION: { risk_tier: "critical", risk_score: 0.99 },
    };
    const seen: IntentRequest[] = [];
    const v = await runGuard(target, { db: null, requestIntent: mockNetwork({ ...ambiguous, ...stage2 }, seen), readFacts: async () => tokenFacts });
    expect(v.escalated).toBe(true);
    expect(["WARN", "BLOCK"]).toContain(v.verdict);
    const fraud = v.signals.find((s) => s.id === "fraudCorroboration");
    expect(fraud?.advisory).toBe(true);
    expect(fraud?.weight).toBe(0);
    expect(fraud?.risk).toBe(0.9);
    // Six Stage 2 adapters; the one that never answers is re-declared up to the attempt limit.
    const stage2Reqs = seen.filter((r) => r.minConfidence === THRESHOLDS.STAGE2.minConfidence);
    expect(stage2Reqs.length).toBe(5 + THRESHOLDS.ADAPTER_ATTEMPTS);
    expect(new Set(stage2Reqs.map((r) => r.intent)).size).toBe(6);
    // removing the advisory signal must not change the score
    const without = v.signals.filter((s) => s.id !== "fraudCorroboration");
    const { computeScore } = await import("./scoring");
    expect(computeScore(without)).toBe(v.score);
  });

  it("re-declares an intent whose first answer was unavailable, and keeps the second answer", async () => {
    const seen: IntentRequest[] = [];
    let holderCalls = 0;
    const rq: RequestIntentFn = (async (req: IntentRequest): Promise<IntentResult<unknown>> => {
      seen.push(req);
      if (req.intent === "TOKEN_HOLDER_COUNT" && holderCalls++ === 0) {
        return { status: "unavailable", reason: "miner 7302 reported confidence 0.300 below requested 0.6", latencyMs: 9 };
      }
      return mockNetwork(benign)(req);
    }) as RequestIntentFn;
    const v = await runGuard(target, { db: null, requestIntent: rq, readFacts: async () => tokenFacts });
    expect(seen.filter((r) => r.intent === "TOKEN_HOLDER_COUNT")).toHaveLength(2);
    const holder = v.signals.find((s) => s.id === "holderConcentration");
    expect(holder?.status).toBe("ok");
  });

  it("does not pay twice for a structural refusal", async () => {
    const seen: IntentRequest[] = [];
    const rq: RequestIntentFn = (async (req: IntentRequest): Promise<IntentResult<unknown>> => {
      seen.push(req);
      if (req.intent === "TVL_LOOKUP") return { status: "unavailable", reason: "no live miners for intent TVL_LOOKUP", latencyMs: 1 };
      return mockNetwork(benign)(req);
    }) as RequestIntentFn;
    await runGuard(target, { db: null, requestIntent: rq, readFacts: async () => tokenFacts });
    expect(seen.filter((r) => r.intent === "TVL_LOOKUP")).toHaveLength(1);
  });

  it("returns INSUFFICIENT_SIGNAL when fewer than four Stage 1 signals return", async () => {
    const v = await runGuard(target, { db: null, requestIntent: mockNetwork({ TOKEN_HOLDER_COUNT: { holders: 5 }, URL_SCAN: { malicious: true } }), readFacts: async () => tokenFacts });
    expect(v.verdict).toBe("INSUFFICIENT_SIGNAL");
    expect(v.signals.filter((s) => s.status === "unavailable").length).toBeGreaterThan(0);
  });

  it("records skipped signals for missing inputs, never hides them", async () => {
    const bare: GuardTarget = { chainId: 1, from: USER, to: TOKEN, calldata: "0x", value: 0n };
    const v = await runGuard(bare, { db: null, requestIntent: mockNetwork(benign), readFacts: async () => tokenFacts });
    const skipped = v.signals.filter((s) => s.status === "skipped").map((s) => s.id);
    expect(skipped).toEqual(expect.arrayContaining(["originScan", "originCert"]));
    expect(v.signals.length).toBe(7);
  });

  it("links every intent_requests row to the verdict id", async () => {
    const db = openDb(":memory:");
    const linked: (string | undefined)[] = [];
    const rq: RequestIntentFn = (async (req: IntentRequest, opts?: { verdictId?: string }) => {
      linked.push(opts?.verdictId);
      return mockNetwork(benign)(req);
    }) as RequestIntentFn;
    const v = await runGuard(target, { db, requestIntent: rq, readFacts: async () => tokenFacts });
    expect(linked.every((id) => id === v.id)).toBe(true);
    expect(db.select().from(intentRequests).all()).toHaveLength(0); // mock does not write; the real client does
  });
});
