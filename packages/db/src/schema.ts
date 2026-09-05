import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

/**
 * Schema mirrors section 9 of the Zengawd spec column-for-column.
 * Dialect: SQLite (see DECISIONS.md: Postgres was unavailable in the dev environment).
 * JSONB columns are stored as TEXT holding verbatim JSON. They are never truncated at write time.
 */

export const intentRequests = sqliteTable(
  "intent_requests",
  {
    id: text("id").primaryKey(),
    verdictId: text("verdict_id"),
    intent: text("intent").notNull(),
    requestedConfidence: real("requested_confidence").notNull(),
    deadlineMs: integer("deadline_ms").notNull(),
    /** "ok" | "unavailable" */
    status: text("status").notNull(),
    minerId: text("miner_id"),
    minerName: text("miner_name"),
    returnedConfidence: real("returned_confidence"),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: real("cost_usd"),
    settlementTxHash: text("settlement_tx_hash"),
    signalHash: text("signal_hash"),
    /** Verbatim JSON of what was sent to the node. */
    requestPayload: text("request_payload").notNull(),
    /** Verbatim JSON of what the node returned (status, headers, body) or the failure reason. */
    responsePayload: text("response_payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("intent_requests_intent_idx").on(t.intent),
    index("intent_requests_created_idx").on(t.createdAt),
    index("intent_requests_verdict_idx").on(t.verdictId),
  ],
);

export const verdicts = sqliteTable(
  "verdicts",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    userAddress: text("user_address").notNull(),
    targetAddress: text("target_address").notNull(),
    selector: text("selector").notNull(),
    calldata: text("calldata").notNull(),
    verdict: text("verdict").notNull(),
    score: real("score").notNull(),
    escalated: integer("escalated", { mode: "boolean" }).notNull(),
    verdictHash: text("verdict_hash").notNull(),
    onchainTxHash: text("onchain_tx_hash"),
    stage1LatencyMs: integer("stage1_latency_ms").notNull(),
    stage2LatencyMs: integer("stage2_latency_ms"),
    totalCostUsd: real("total_cost_usd"),
    /** Full Verdict object (signals included) as verbatim JSON, for the UI and the audit trail. */
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("verdicts_user_idx").on(t.userAddress), index("verdicts_created_idx").on(t.createdAt)],
);

export const watchedApprovals = sqliteTable(
  "watched_approvals",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    userAddress: text("user_address").notNull(),
    tokenAddress: text("token_address").notNull(),
    spenderAddress: text("spender_address").notNull(),
    /** "ERC20" | "ERC721" */
    tokenStandard: text("token_standard").notNull(),
    /** Current allowance (ERC20, decimal string) or "true" for ApprovalForAll. */
    allowance: text("allowance").notNull(),
    lastVerdictId: text("last_verdict_id"),
    lastVerdict: text("last_verdict"),
    lastScore: real("last_score"),
    lastCheckedAt: text("last_checked_at"),
    autoRevokeEnabled: integer("auto_revoke_enabled", { mode: "boolean" }).notNull().default(false),
    /** Set when the watcher flips ALLOW to BLOCK; cleared when revoked. */
    revocationRecommendedAt: text("revocation_recommended_at"),
    revocationTxHash: text("revocation_tx_hash"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("watched_user_idx").on(t.userAddress)],
);

export const watchedUsers = sqliteTable("watched_users", {
  userAddress: text("user_address").primaryKey(),
  chainId: integer("chain_id").notNull(),
  /** Explicit, separately-recorded opt-in. Defaults to false. */
  autoRevokeEnabled: integer("auto_revoke_enabled", { mode: "boolean" }).notNull().default(false),
  autoRevokeOptInAt: text("auto_revoke_opt_in_at"),
  safeAddress: text("safe_address"),
  createdAt: text("created_at").notNull(),
});

export const calibrationRuns = sqliteTable(
  "calibration_runs",
  {
    id: text("id").primaryKey(),
    intent: text("intent").notNull(),
    confidence: real("confidence").notNull(),
    /** null when the request was unavailable */
    minerId: text("miner_id"),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: real("cost_usd"),
    intentRequestId: text("intent_request_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("calibration_intent_idx").on(t.intent)],
);

export type IntentRequestRow = typeof intentRequests.$inferSelect;
export type NewIntentRequestRow = typeof intentRequests.$inferInsert;
export type VerdictRow = typeof verdicts.$inferSelect;
export type NewVerdictRow = typeof verdicts.$inferInsert;
export type WatchedApprovalRow = typeof watchedApprovals.$inferSelect;
export type NewWatchedApprovalRow = typeof watchedApprovals.$inferInsert;
export type WatchedUserRow = typeof watchedUsers.$inferSelect;
export type CalibrationRunRow = typeof calibrationRuns.$inferSelect;
export type NewCalibrationRunRow = typeof calibrationRuns.$inferInsert;
