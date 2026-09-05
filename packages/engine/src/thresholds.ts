/**
 * Every escalation threshold and stage parameter lives here and nowhere else (spec 5.3).
 */
export const THRESHOLDS = {
  /** Stage 1 score strictly below this -> ALLOW, stop. */
  ALLOW_BELOW: 25,
  /** Stage 1 score strictly above this -> BLOCK, stop. */
  BLOCK_ABOVE: 65,
  /** After Stage 2, combined score below this -> WARN, else BLOCK. */
  STAGE2_WARN_BELOW: 40,
  /** Fewer than this many Stage 1 signals returned -> INSUFFICIENT_SIGNAL. */
  MIN_STAGE1_SIGNALS: 4,
  /**
   * Absolute floor when fewer than MIN_STAGE1_SIGNALS adapters were even applicable to the target.
   *
   * A signal skipped for a missing input (no origin URL, no counterparty in empty calldata) is not a
   * network failure, and the spec separates "skipped" from "unavailable" for exactly that reason.
   * A bare contract address structurally offers fewer than four applicable Stage 1 checks, so the
   * flat floor alone would make every address-only verdict INSUFFICIENT_SIGNAL. The requirement is
   * therefore min(MIN_STAGE1_SIGNALS, applicable), never below this floor. See DECISIONS.md 2.7.
   */
  MIN_STAGE1_FLOOR: 2,
  STAGE1: { minConfidence: 0.6, deadlineMs: 4000 },
  STAGE2: { minConfidence: 0.8, deadlineMs: 12000 },
  /**
   * How many times an adapter re-declares its intent when the first answer is unavailable.
   *
   * Telegraph routes probabilistically, so a second declaration of the same intent is usually served
   * by a different miner. Measured per-call availability is roughly 55-65%, and a verdict needs
   * several signals at once, so a single attempt leaves most verdicts short of the Stage 1 minimum.
   * Each attempt is a separate paid request and writes its own `intent_requests` row.
   * Structural refusals (no live miners, non-canonical intent) are never retried. See DECISIONS.md 2.10.
   */
  ADAPTER_ATTEMPTS: 3,
} as const;

export const VERDICT_CODES = { ALLOW: 0, WARN: 1, BLOCK: 2, INSUFFICIENT_SIGNAL: 3 } as const;
