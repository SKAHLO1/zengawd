/**
 * End-to-end check against the live Telegraph testnet node:
 * declares one intent, pays via x402, and prints the resulting `intent_requests` row.
 * Usage: pnpm --filter @zengawd/telegraph live-check [INTENT] ["query"]
 */
import { desc, getDb, intentRequests } from "@zengawd/db";
import { requestIntent, getTelegraphClient } from "../src/index";

const intent = process.argv[2] ?? "TOKEN_HOLDER_COUNT";
const query =
  process.argv[3] ??
  "How many distinct addresses hold the ERC-20 token 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (USDC) on ethereum?";

const client = getTelegraphClient();
const count = await client.catalog.minerCount(intent);
console.log(`node=${client.nodeUrl} intent=${intent} live_miners=${count}`);

const result = await requestIntent({ intent, payload: { query }, minConfidence: 0.6, deadlineMs: 20_000 });
console.log(JSON.stringify(result, null, 2));

const liveDb = await getDb();
const [row] = await liveDb.select().from(intentRequests).orderBy(desc(intentRequests.createdAt)).limit(1);
if (!row) throw new Error("no intent_requests row written");
console.log("\nintent_requests row:");
console.log(
  JSON.stringify(
    { id: row.id, status: row.status, minerId: row.minerId, minerName: row.minerName, latencyMs: row.latencyMs, costUsd: row.costUsd, tx: row.settlementTxHash, signal: row.signalHash, confidence: row.returnedConfidence },
    null,
    2,
  ),
);
