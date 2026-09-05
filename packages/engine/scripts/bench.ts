/**
 * Accuracy harness: runs the full live pipeline over fixtures/malicious.json and fixtures/benign.json.
 * Usage: pnpm bench [--limit N] [--only malicious|benign]
 * Writes bench-results/latest.json and prints the summary that is published in README.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuard } from "../src/pipeline";
import type { GuardTarget, Verdict } from "../src/types";

type Fixture = { address: `0x${string}`; chainId: number; label: "malicious" | "benign"; name: string; source: string };

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1] || 0) || Infinity;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const BENCH_USER = "0x000000000000000000000000000000000000dEaD" as const;

const load = (f: string): Fixture[] => JSON.parse(readFileSync(resolve(here, "../fixtures", f), "utf8")) as Fixture[];
let fixtures = [...(only === "benign" ? [] : load("malicious.json")), ...(only === "malicious" ? [] : load("benign.json"))];
fixtures = fixtures.slice(0, Number.isFinite(limit) ? limit : fixtures.length);

type Row = { fixture: Fixture; verdict: Verdict["verdict"]; score: number; escalated: boolean; costUsd: number | null; ok: number; unavailable: number; ms: number; id: string };
const rows: Row[] = [];

console.log(`bench: ${fixtures.length} fixtures, live Telegraph network`);
for (const f of fixtures) {
  const target: GuardTarget = { chainId: f.chainId, from: BENCH_USER, to: f.address, calldata: "0x", value: 0n };
  const t0 = Date.now();
  const v = await runGuard(target);
  const row: Row = {
    fixture: f,
    verdict: v.verdict,
    score: v.score,
    escalated: v.escalated,
    costUsd: v.totalCostUsd,
    ok: v.signals.filter((s) => s.status === "ok").length,
    unavailable: v.signals.filter((s) => s.status === "unavailable").length,
    ms: Date.now() - t0,
    id: v.id,
  };
  rows.push(row);
  console.log(`${f.label.padEnd(9)} ${v.verdict.padEnd(19)} ${String(v.score).padStart(6)} esc=${v.escalated ? "y" : "n"} ok=${row.ok} unavail=${row.unavailable} cost=${v.totalCostUsd ?? "n/a"} ${row.ms}ms  ${f.name}`);
}

const decided = rows.filter((r) => r.verdict !== "INSUFFICIENT_SIGNAL");
const flagged = (r: Row) => r.verdict === "BLOCK" || r.verdict === "WARN";
const tp = decided.filter((r) => r.fixture.label === "malicious" && flagged(r)).length;
const fn = decided.filter((r) => r.fixture.label === "malicious" && !flagged(r)).length;
const fp = decided.filter((r) => r.fixture.label === "benign" && flagged(r)).length;
const tn = decided.filter((r) => r.fixture.label === "benign" && !flagged(r)).length;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const costs = rows.map((r) => r.costUsd).filter((c): c is number => typeof c === "number");
const summary = {
  ranAt: new Date().toISOString(),
  fixtures: rows.length,
  insufficient: rows.length - decided.length,
  precision: tp + fp ? tp / (tp + fp) : null,
  recall: tp + fn ? tp / (tp + fn) : null,
  falsePositiveRate: fp + tn ? fp / (fp + tn) : null,
  escalationRate: rows.length ? rows.filter((r) => r.escalated).length / rows.length : null,
  meanCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
  meanLatencyMs: rows.length ? Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length) : null,
  confusion: { tp, fp, fn, tn },
};
console.log("\n=== bench summary ===");
console.log(`fixtures            ${summary.fixtures} (insufficient signal: ${summary.insufficient})`);
console.log(`precision           ${summary.precision === null ? "n/a" : pct(summary.precision)}`);
console.log(`recall              ${summary.recall === null ? "n/a" : pct(summary.recall)}`);
console.log(`false-positive rate ${summary.falsePositiveRate === null ? "n/a" : pct(summary.falsePositiveRate)}`);
console.log(`escalation rate     ${summary.escalationRate === null ? "n/a" : pct(summary.escalationRate)}`);
console.log(`mean cost / verdict ${summary.meanCostUsd === null ? "n/a" : `$${summary.meanCostUsd.toFixed(4)}`}`);
console.log(`mean latency        ${summary.meanLatencyMs ?? "n/a"} ms`);
console.log(`confusion           tp=${tp} fp=${fp} fn=${fn} tn=${tn}`);

const outDir = resolve(here, "../bench-results");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "latest.json"), JSON.stringify({ summary, rows: rows.map((r) => ({ ...r, fixture: { address: r.fixture.address, label: r.fixture.label, name: r.fixture.name } })) }, null, 2));
console.log(`\nwritten ${resolve(outDir, "latest.json")}`);
