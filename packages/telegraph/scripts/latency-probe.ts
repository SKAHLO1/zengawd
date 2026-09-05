/**
 * Measure the real end-to-end latency of a paid intent call, split into the phases we control.
 * Used to decide whether the spec's Stage 1 / Stage 2 deadlines are achievable on the live network.
 * Usage: pnpm --filter @zengawd/telegraph tsx scripts/latency-probe.ts [count]
 */
import { createPaidFetch } from "../src/payment";

const NODE = process.env.TELEGRAPH_NODE_URL ?? "https://devnode.telegraphprotocol.com";
const count = Number(process.argv[2] ?? 3);

const probes = [
  { intent: "CRYPTO_PRICE", query: "What is the current price of bitcoin in US dollars?" },
  { intent: "TOKEN_HOLDER_COUNT", query: "How many distinct addresses hold the ERC-20 token 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (USDC) on ethereum?" },
  { intent: "URL_SCAN", query: "Scan the URL https://app.uniswap.org for malware or phishing. Is this link malicious?" },
];

const rows: { intent: string; challengeMs: number; totalMs: number; status: number; miner: string | null }[] = [];

for (let i = 0; i < count; i++) {
  for (const p of probes) {
    let challengeMs = 0;
    const t0 = Date.now();
    const traced: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (res.status === 402 && challengeMs === 0) challengeMs = Date.now() - t0;
      return res;
    };
    const { paidFetch } = createPaidFetch(traced);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await paidFetch(`${NODE}/engine/v1/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: p.query }),
        signal: ctrl.signal,
      });
      const body = (await res.json()) as { miner_id?: string | number };
      const totalMs = Date.now() - t0;
      rows.push({ intent: p.intent, challengeMs, totalMs, status: res.status, miner: body.miner_id ? String(body.miner_id) : null });
      console.log(`${p.intent.padEnd(20)} challenge=${String(challengeMs).padStart(6)}ms  total=${String(totalMs).padStart(6)}ms  settle+serve=${String(totalMs - challengeMs).padStart(6)}ms  http=${res.status} miner=${body.miner_id ?? "-"}`);
    } catch (e) {
      console.log(`${p.intent.padEnd(20)} FAILED ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

const totals = rows.map((r) => r.totalMs).sort((a, b) => a - b);
const challenges = rows.map((r) => r.challengeMs).sort((a, b) => a - b);
const pick = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.ceil((p / 100) * arr.length) - 1)] ?? 0;
console.log(`\nn=${rows.length}`);
console.log(`challenge (unpaid 402)  p50=${pick(challenges, 50)}ms  p95=${pick(challenges, 95)}ms`);
console.log(`total (settled answer)  p50=${pick(totals, 50)}ms  p95=${pick(totals, 95)}ms  min=${totals[0]}ms  max=${totals[totals.length - 1]}ms`);
