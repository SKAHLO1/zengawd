/**
 * Calibration job: issues the same benchmark payload for every intent the engine uses at requested
 * confidence 0.5, 0.6, 0.7, 0.8 and 0.9, and records the routing outcome in calibration_runs.
 * Usage: pnpm calibrate            (one sweep)
 *        pnpm calibrate --loop     (repeat every CALIBRATION_INTERVAL_MS, default 1 h)
 *        pnpm calibrate --intents TOKEN_HOLDER_COUNT,URL_SCAN
 */
import { calibrationRuns, getDb, newId, nowIso } from "@zengawd/db";
import { loadEnv, requestIntent, getTelegraphClient } from "@zengawd/telegraph";
import { ALL_ADAPTERS, buildContext } from "../src/adapters";
import { decodeCalldata } from "../src/decode";
import type { ContractFacts, GuardTarget } from "../src/types";

loadEnv();
const LEVELS = [0.5, 0.6, 0.7, 0.8, 0.9];
const DEADLINE_MS = 12_000;
const args = process.argv.slice(2);
const loop = args.includes("--loop");
const onlyIntents = args.includes("--intents") ? (args[args.indexOf("--intents") + 1] ?? "").split(",").filter(Boolean) : null;
const intervalMs = Number(process.env.CALIBRATION_INTERVAL_MS ?? "3600000");

/** Fixed benchmark subject: USDC on Ethereum, the Uniswap origin, and a canned lure. Identical every sweep. */
const BENCH_TARGET: GuardTarget = {
  chainId: 1,
  from: "0x000000000000000000000000000000000000dEaD",
  to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  calldata: "0x",
  value: 0n,
  originUrl: "https://app.uniswap.org",
  lureText: "Congratulations! Your wallet has been selected for an exclusive airdrop. Connect now to claim before it expires in 10 minutes.",
};
const BENCH_FACTS: ContractFacts = { isContract: true, codeSize: 1, isErc20: true, isErc721: false, symbol: "USDC", name: "USD Coin", decimals: 6 };

async function sweep(): Promise<void> {
  const db = getDb();
  const ctx = buildContext(BENCH_TARGET, decodeCalldata(BENCH_TARGET.to, BENCH_TARGET.calldata), BENCH_FACTS);
  const adapters = ALL_ADAPTERS.filter((a) => !onlyIntents || onlyIntents.includes(a.intent));
  const client = getTelegraphClient();
  for (const adapter of adapters) {
    const live = await client.catalog.minerCount(adapter.intent);
    const q = adapter.query(ctx);
    for (const confidence of LEVELS) {
      const payload: Record<string, unknown> = { query: q.query };
      if (q.context) payload.context = q.context;
      const r = await requestIntent({ intent: adapter.intent, payload, minConfidence: confidence, deadlineMs: DEADLINE_MS });
      const minerId = r.status === "ok" ? r.minerId : (r.minerId ?? null);
      db.insert(calibrationRuns)
        .values({ id: newId(), intent: adapter.intent, confidence, minerId, status: r.status, latencyMs: r.latencyMs, costUsd: r.status === "ok" ? r.costUsd : null, intentRequestId: null, createdAt: nowIso() })
        .run();
      console.log(`${adapter.intent.padEnd(22)} conf=${confidence} live=${live ?? "?"} -> ${r.status.padEnd(11)} miner=${minerId ?? "-"} ${r.latencyMs}ms${r.status === "unavailable" ? `  (${r.reason})` : ""}`);
    }
  }
}

for (;;) {
  console.log(`[calibrate ${new Date().toISOString()}] sweep start`);
  await sweep();
  if (!loop) break;
  await new Promise((r) => setTimeout(r, intervalMs));
}
