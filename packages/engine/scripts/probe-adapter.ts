/**
 * Run a single adapter against one target on the live network and show how the router classified it,
 * what the miner returned, and what the adapter made of it. Cheap way to validate query phrasing
 * before spending on a full bench.
 *
 * Usage: pnpm --filter @zengawd/engine tsx scripts/probe-adapter.ts liquidityDepth 0xA0b8...
 */
import { requestIntent } from "@zengawd/telegraph";
import { ALL_ADAPTERS, buildContext } from "../src/adapters";
import { decodeCalldata } from "../src/decode";
import { readContractFacts } from "../src/facts";
import { THRESHOLDS } from "../src/thresholds";
import type { GuardTarget } from "../src/types";

const adapterId = process.argv[2] ?? "liquidityDepth";
const address = (process.argv[3] ?? "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") as `0x${string}`;
const chainId = Number(process.argv[4] ?? 1);

const adapter = ALL_ADAPTERS.find((a) => a.id === adapterId);
if (!adapter) throw new Error(`unknown adapter ${adapterId}. Known: ${ALL_ADAPTERS.map((a) => a.id).join(", ")}`);

const target: GuardTarget = { chainId, from: "0x000000000000000000000000000000000000dEaD", to: address, calldata: "0x", value: 0n };
const facts = await readContractFacts(chainId, address);
const ctx = buildContext(target, decodeCalldata(address, "0x"), facts);

const skip = adapter.skip(ctx);
if (skip) {
  console.log(`skipped: ${skip}`);
  process.exit(0);
}
const q = adapter.query(ctx);
const cfg = adapter.stage === 1 ? THRESHOLDS.STAGE1 : THRESHOLDS.STAGE2;
console.log(`adapter  ${adapter.id}  intent ${adapter.intent}`);
console.log(`subject  ${facts.name ?? "?"} (${facts.symbol ?? "?"}) ${address}`);
console.log(`query    ${q.query}\n`);

const r = await requestIntent({ intent: adapter.intent, payload: { query: q.query }, minConfidence: cfg.minConfidence, deadlineMs: cfg.deadlineMs });
if (r.status !== "ok") {
  console.log(`result   unavailable: ${r.reason}`);
  const salvaged = adapter.interpretError?.(r.reason, ctx);
  console.log(`salvage  ${salvaged ? JSON.stringify(salvaged) : "none"}`);
  process.exit(0);
}
console.log(`served   miner ${r.minerId} (${r.minerName}) in ${r.latencyMs}ms, $${r.costUsd}, tx ${r.txHash}`);
console.log(`data     ${JSON.stringify(r.data).slice(0, 600)}\n`);
console.log(`verdict  ${JSON.stringify(adapter.interpret(r.data, ctx))}`);
