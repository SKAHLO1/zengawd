import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import { decodeCalldata } from "./decode";
import { canonicalVerdictJson, verdictHash } from "./hash";
import { computeScore, decideStage1, decideStage2, requiredStage1Signals } from "./scoring";
import { THRESHOLDS } from "./thresholds";
import type { Signal } from "./types";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const SPENDER = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

describe("decodeCalldata", () => {
  it("decodes approve with unlimited allowance", () => {
    const data = encodeFunctionData({
      abi: parseAbi(["function approve(address,uint256)"]),
      functionName: "approve",
      args: [SPENDER, 2n ** 256n - 1n],
    });
    const d = decodeCalldata(USDC, data);
    expect(d.kind).toBe("approve");
    expect(d.selector).toBe("0x095ea7b3");
    expect(d.token).toBe(USDC);
    expect(d.spender).toBe(SPENDER);
    expect(d.unlimited).toBe(true);
  });

  it("decodes setApprovalForAll", () => {
    const data = encodeFunctionData({
      abi: parseAbi(["function setApprovalForAll(address,bool)"]),
      functionName: "setApprovalForAll",
      args: [SPENDER, true],
    });
    const d = decodeCalldata(USDC, data);
    expect(d.kind).toBe("setApprovalForAll");
    expect(d.selector).toBe("0xa22cb465");
    expect(d.unlimited).toBe(true);
  });

  it("decodes a V2 swap and extracts the input token", () => {
    const data = encodeFunctionData({
      abi: parseAbi(["function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"]),
      functionName: "swapExactTokensForTokens",
      args: [1000n, 1n, [USDC, SPENDER], SPENDER, 0n],
    });
    const d = decodeCalldata(SPENDER, data);
    expect(d.kind).toBe("swap");
    expect(d.token).toBe(USDC);
    expect(d.amount).toBe(1000n);
  });

  it("marks unknown selectors as arbitrary calls and empty calldata as none", () => {
    expect(decodeCalldata(USDC, "0xdeadbeef00").kind).toBe("call");
    expect(decodeCalldata(USDC, "0x").kind).toBe("none");
  });
});

describe("verdictHash", () => {
  const input = {
    chainId: 8453,
    from: "0xAbC0000000000000000000000000000000000001",
    to: USDC,
    calldata: "0x095EA7B3" as const,
    verdict: "BLOCK" as const,
    score: 71.5,
    createdAt: "2026-09-05T00:00:00.000Z",
  };
  it("is stable across key order and casing", () => {
    const shuffled = { createdAt: input.createdAt, score: input.score, verdict: input.verdict, calldata: "0x095ea7b3" as const, to: USDC.toLowerCase(), from: input.from.toLowerCase(), chainId: 8453 };
    expect(verdictHash(input)).toBe(verdictHash(shuffled));
    expect(canonicalVerdictJson(input)).toBe(
      '{"calldata":"0x095ea7b3","chainId":8453,"createdAt":"2026-09-05T00:00:00.000Z","from":"0xabc0000000000000000000000000000000000001","score":71.5,"to":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","verdict":"BLOCK"}',
    );
  });
  it("changes when any field changes", () => {
    expect(verdictHash(input)).not.toBe(verdictHash({ ...input, score: 71.6 }));
    expect(verdictHash(input)).not.toBe(verdictHash({ ...input, verdict: "ALLOW" }));
  });
});

function sig(id: string, risk: number | null, weight: number, status: Signal["status"] = risk === null ? "unavailable" : "ok", advisory = false): Signal {
  return {
    id, intent: id.toUpperCase(), risk, weight, rationale: "", evidence: null, status, stage: 1, advisory,
    minerId: null, minerName: null, latencyMs: 0, costUsd: null, txHash: null, signalHash: null, confidence: null, reason: null,
  };
}

describe("scoring", () => {
  it("excludes unavailable, skipped and advisory signals from numerator and denominator", () => {
    const s = [sig("a", 1, 0.5), sig("b", 0, 0.5), sig("c", null, 0.9), sig("d", 1, 0.9, "skipped"), sig("fraud", 1, 0, "ok", true)];
    expect(computeScore(s)).toBe(50);
  });
  it("returns INSUFFICIENT_SIGNAL below the Stage 1 minimum", () => {
    const s = [sig("a", 0.9, 0.2), sig("b", 0.9, 0.2), sig("c", 0.9, 0.2), sig("d", null, 0.2)];
    expect(decideStage1(s)).toEqual({ kind: "final", verdict: "INSUFFICIENT_SIGNAL", score: 90 });
  });

  it("requires only as many signals as were applicable, never below the floor", () => {
    // Bare-address shape: three adapters skipped for missing inputs, two answered.
    const s = [
      sig("a", 0.1, 0.2),
      sig("b", 0.1, 0.2),
      sig("c", 0.9, 0.2, "skipped"),
      sig("d", 0.9, 0.2, "skipped"),
      sig("e", 0.9, 0.2, "skipped"),
    ];
    expect(requiredStage1Signals(s)).toBe(2);
    expect(decideStage1(s)).toMatchObject({ kind: "final", verdict: "ALLOW" });
  });

  it("still demands the full minimum when all adapters were applicable", () => {
    const s = [sig("a", 0.1, 0.2), sig("b", 0.1, 0.2), sig("c", null, 0.2), sig("d", null, 0.2), sig("e", null, 0.2)];
    expect(requiredStage1Signals(s)).toBe(4);
    expect(decideStage1(s)).toMatchObject({ kind: "final", verdict: "INSUFFICIENT_SIGNAL" });
  });

  it("never drops below the floor even when only one adapter was applicable", () => {
    const s = [sig("a", 0.1, 0.2), sig("b", 0.9, 0.2, "skipped"), sig("c", 0.9, 0.2, "skipped")];
    expect(requiredStage1Signals(s)).toBe(2);
    expect(decideStage1(s)).toMatchObject({ kind: "final", verdict: "INSUFFICIENT_SIGNAL" });
  });
  it("applies ALLOW / BLOCK / escalate bands from THRESHOLDS", () => {
    const four = (r: number) => [sig("a", r, 1), sig("b", r, 1), sig("c", r, 1), sig("d", r, 1)];
    expect(decideStage1(four((THRESHOLDS.ALLOW_BELOW - 1) / 100))).toMatchObject({ kind: "final", verdict: "ALLOW" });
    expect(decideStage1(four((THRESHOLDS.BLOCK_ABOVE + 1) / 100))).toMatchObject({ kind: "final", verdict: "BLOCK" });
    expect(decideStage1(four(0.5))).toMatchObject({ kind: "escalate", score: 50 });
    expect(decideStage2(four((THRESHOLDS.STAGE2_WARN_BELOW - 1) / 100))).toMatchObject({ verdict: "WARN" });
    expect(decideStage2(four(THRESHOLDS.STAGE2_WARN_BELOW / 100))).toMatchObject({ verdict: "BLOCK" });
  });
});
