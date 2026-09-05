import { THRESHOLDS } from "./thresholds";
import type { Signal, VerdictLabel } from "./types";

/** Signals that carry a numeric risk and a non-zero weight; advisory signals never count. */
export function scorableSignals(signals: Signal[]): Signal[] {
  return signals.filter((s) => s.status === "ok" && s.risk !== null && !s.advisory && s.weight > 0);
}

/**
 * score = 100 * ( sum(risk_i * weight_i) / sum(weight_i) ) over signals where risk_i !== null.
 * Unavailable and skipped signals are excluded from numerator and denominator.
 */
export function computeScore(signals: Signal[]): number {
  const usable = scorableSignals(signals);
  const denom = usable.reduce((a, s) => a + s.weight, 0);
  if (denom === 0) return 0;
  const num = usable.reduce((a, s) => a + (s.risk as number) * s.weight, 0);
  return round2(100 * (num / denom));
}

export type Stage1Decision =
  | { kind: "final"; verdict: Extract<VerdictLabel, "ALLOW" | "BLOCK" | "INSUFFICIENT_SIGNAL">; score: number }
  | { kind: "escalate"; score: number };

/**
 * How many Stage 1 signals must return before a score is trustworthy.
 *
 * Normally MIN_STAGE1_SIGNALS. When fewer adapters were applicable to this target at all (a bare
 * address has no origin URL and no counterparty), the requirement drops to the number that could
 * have answered, never below MIN_STAGE1_FLOOR. Skipped adapters are excluded because a skip is a
 * property of the target, not a failure of the network.
 */
export function requiredStage1Signals(stage1: Signal[]): number {
  const applicable = stage1.filter((s) => s.status !== "skipped" && !s.advisory).length;
  return Math.max(THRESHOLDS.MIN_STAGE1_FLOOR, Math.min(THRESHOLDS.MIN_STAGE1_SIGNALS, applicable));
}

/** Stage 1 outcome per THRESHOLDS. Advisory signals do not count toward the minimum. */
export function decideStage1(stage1: Signal[]): Stage1Decision {
  const returned = stage1.filter((s) => s.status === "ok" && !s.advisory).length;
  const score = computeScore(stage1);
  if (returned < requiredStage1Signals(stage1)) return { kind: "final", verdict: "INSUFFICIENT_SIGNAL", score };
  if (score < THRESHOLDS.ALLOW_BELOW) return { kind: "final", verdict: "ALLOW", score };
  if (score > THRESHOLDS.BLOCK_ABOVE) return { kind: "final", verdict: "BLOCK", score };
  return { kind: "escalate", score };
}

/** Final outcome after Stage 2, computed over all available signals from both stages. */
export function decideStage2(all: Signal[]): { verdict: Extract<VerdictLabel, "WARN" | "BLOCK">; score: number } {
  const score = computeScore(all);
  return { verdict: score < THRESHOLDS.STAGE2_WARN_BELOW ? "WARN" : "BLOCK", score };
}

/** Weighted contribution of each scorable signal, for the "reasons" list ordered by contribution. */
export function contributions(signals: Signal[]): { signal: Signal; contribution: number }[] {
  const usable = scorableSignals(signals);
  const denom = usable.reduce((a, s) => a + s.weight, 0);
  if (denom === 0) return [];
  return usable
    .map((s) => ({ signal: s, contribution: round2((100 * (s.risk as number) * s.weight) / denom) }))
    .sort((a, b) => b.contribution - a.contribution);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
