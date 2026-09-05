/**
 * Public types of the Telegraph client. Shapes follow section 4 of the spec.
 *
 * `payload` convention (documented in DECISIONS.md):
 *   - `payload.query`   (string, required)  natural-language question phrased for `intent`.
 *   - `payload.context` (object, optional)  structured hints merged into the routed request body
 *                                           by the Engine (live docs: POST /engine/v1/ask `context`).
 * Nothing in `payload` selects a miner. There is no miner parameter anywhere.
 */
export type IntentRequest = {
  intent: string;
  payload: Record<string, unknown>;
  /** 0..1 */
  minConfidence: number;
  deadlineMs: number;
};

export type IntentOk<T> = {
  status: "ok";
  data: T;
  /**
   * Confidence reported by the serving miner, read through its declared
   * `signal_mapping.confidence_field`. `null` when the miner declares no confidence field
   * or reports a value outside 0..1 (see DECISIONS.md).
   */
  confidence: number | null;
  minerId: string;
  minerName: string | null;
  latencyMs: number;
  costUsd: number | null;
  txHash: string | null;
  signalHash: string | null;
  routedAt: string;
  /** Router's stated reasoning, when present. */
  reasoning: string | null;
  warnings: string[];
};

export type IntentUnavailable = {
  status: "unavailable";
  reason: string;
  latencyMs: number;
  /** Populated when the network answered but the answer was rejected client-side (wrong intent, low confidence). */
  minerId?: string;
  txHash?: string | null;
};

export type IntentResult<T = unknown> = IntentOk<T> | IntentUnavailable;

/** Shape of a successful POST /engine/v1/ask body, per the live docs. */
export type EngineAskResponse = {
  miner_id?: string | number;
  miner_name?: string;
  endpoint?: string;
  result?: unknown;
  cost_usd?: number;
  duration_ms?: number;
  timestamp?: string;
  reasoning?: string;
  intent?: string;
  signal_hash?: string;
  warnings?: string[];
  error?: string;
};

export type IntentCatalogEntry = {
  intent_id: string;
  intent_name?: string;
  miner_count: number;
  description?: string;
  canonical?: boolean;
};

export type MinerCatalogEntry = {
  id: string | number;
  slug: string;
  name?: string;
  description?: string;
  supported_intents?: string[];
  signal_mapping?: { confidence_field?: string; label_field?: string; reason_field?: string };
  activation_status?: string;
  min_price_usdc?: number;
  endpoints?: { path: string; method: string; description?: string }[];
  scores?: { intent_id: string; epoch_id: number; rank: number; score: number; scored_at: string }[];
};
