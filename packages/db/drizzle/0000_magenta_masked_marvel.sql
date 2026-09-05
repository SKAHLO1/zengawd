CREATE TABLE "calibration_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"intent" text NOT NULL,
	"confidence" double precision NOT NULL,
	"miner_id" text,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_usd" double precision,
	"intent_request_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"verdict_id" text,
	"intent" text NOT NULL,
	"requested_confidence" double precision NOT NULL,
	"deadline_ms" integer NOT NULL,
	"status" text NOT NULL,
	"miner_id" text,
	"miner_name" text,
	"returned_confidence" double precision,
	"latency_ms" integer NOT NULL,
	"cost_usd" double precision,
	"settlement_tx_hash" text,
	"signal_hash" text,
	"request_payload" text NOT NULL,
	"response_payload" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"user_address" text NOT NULL,
	"target_address" text NOT NULL,
	"selector" text NOT NULL,
	"calldata" text NOT NULL,
	"verdict" text NOT NULL,
	"score" double precision NOT NULL,
	"escalated" boolean NOT NULL,
	"verdict_hash" text NOT NULL,
	"onchain_tx_hash" text,
	"stage1_latency_ms" integer NOT NULL,
	"stage2_latency_ms" integer,
	"total_cost_usd" double precision,
	"payload" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"user_address" text NOT NULL,
	"token_address" text NOT NULL,
	"spender_address" text NOT NULL,
	"token_standard" text NOT NULL,
	"allowance" text NOT NULL,
	"last_verdict_id" text,
	"last_verdict" text,
	"last_score" double precision,
	"last_checked_at" text,
	"auto_revoke_enabled" boolean DEFAULT false NOT NULL,
	"revocation_recommended_at" text,
	"revocation_tx_hash" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_users" (
	"user_address" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"auto_revoke_enabled" boolean DEFAULT false NOT NULL,
	"auto_revoke_opt_in_at" text,
	"safe_address" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "calibration_intent_idx" ON "calibration_runs" USING btree ("intent");--> statement-breakpoint
CREATE INDEX "intent_requests_intent_idx" ON "intent_requests" USING btree ("intent");--> statement-breakpoint
CREATE INDEX "intent_requests_created_idx" ON "intent_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "intent_requests_verdict_idx" ON "intent_requests" USING btree ("verdict_id");--> statement-breakpoint
CREATE INDEX "verdicts_user_idx" ON "verdicts" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "verdicts_created_idx" ON "verdicts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "watched_user_idx" ON "watched_approvals" USING btree ("user_address");