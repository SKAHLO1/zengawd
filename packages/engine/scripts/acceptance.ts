/**
 * Runs the acceptance scenarios from the spec against the live network and prints the evidence
 * straight out of the database (not from the in-memory verdict), so each claim is checkable.
 *
 * Usage: pnpm --filter @zengawd/engine tsx scripts/acceptance.ts
 */
import { and, eq, getDb, intentRequests, verdicts as verdictsTable } from "@zengawd/db";
import { recordVerdictOnchain } from "../src/attest";
import { runGuard } from "../src/pipeline";
import type { GuardTarget } from "../src/types";

const USER = "0x000000000000000000000000000000000000dEaD" as const;
const db = await getDb();

const scenarios: { name: string; expect: string; target: GuardTarget }[] = [
  {
    name: "blue-chip contract (USDC on Ethereum)",
    expect: "ALLOW without any Stage 2 intent",
    target: { chainId: 1, from: USER, to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", calldata: "0x", value: 0n },
  },
  {
    // A scam *token* (Etherscan name tag "Scam Inu"), so the token-specific adapters apply.
    name: "known-malicious token (Etherscan tag: Scam Inu)",
    expect: "BLOCK backed by >= 5 real Telegraph responses with settlement hashes",
    target: { chainId: 1, from: USER, to: "0xdb6f6c8b940110617cf66e50c271e2278c8a32df", calldata: "0x", value: 0n },
  },
  {
    // Full transaction shape: an unlimited approve to a spender, from a phishing origin, with a lure.
    // All seven Stage 1 adapters are applicable here.
    name: "unlimited approve from a phishing origin, with a lure message",
    expect: "escalation to Stage 2, verdicts.escalated = true",
    target: {
      chainId: 1,
      from: USER,
      to: "0x6c94954d0b265f657a4a1b35dfaa8b73d1a3f199",
      calldata: "0x095ea7b3000000000000000000000000101ce0cedd142f199c9ef61739ae59b6611a0fc0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      value: 0n,
      originUrl: "https://claim-airdrop-rewards.info",
      lureText: "URGENT: Your wallet was selected for the official airdrop. Connect and verify your seed phrase within 10 minutes or you forfeit 4.2 ETH. Support will never ask twice.",
    },
  },
];

for (const s of scenarios) {
  console.log(`\n${"=".repeat(90)}\n${s.name}\n  expect: ${s.expect}\n${"=".repeat(90)}`);
  const v = await runGuard(s.target);

  // Evidence read back from the database, joined to the telemetry rows this verdict produced.
  const [row] = await db.select().from(verdictsTable).where(eq(verdictsTable.id, v.id)).limit(1);
  const reqs = await db.select().from(intentRequests).where(eq(intentRequests.verdictId, v.id));
  const served = reqs.filter((r) => r.status === "ok");
  const settled = served.filter((r) => r.settlementTxHash);
  const stage2 = reqs.filter((r) => r.requestedConfidence === 0.8);

  console.log(`verdict            ${row?.verdict}  score ${row?.score}  escalated=${row?.escalated}`);
  console.log(`verdict hash       ${row?.verdictHash}`);
  console.log(`intent requests    ${reqs.length} total, ${served.length} served, ${settled.length} with a settlement tx`);
  console.log(`stage 2 requests   ${stage2.length} ${stage2.length === 0 ? "(none - resolved at Stage 1)" : ""}`);
  console.log(`distinct miners    ${new Set(served.map((r) => r.minerId)).size}`);
  console.log(`cost               $${row?.totalCostUsd ?? 0}`);
  for (const r of reqs) {
    const tag = r.status === "ok" ? "ok  " : "----";
    console.log(`  ${tag} ${r.intent.padEnd(22)} miner=${(r.minerId ?? "-").padEnd(10)} ${String(r.latencyMs).padStart(6)}ms  tx=${r.settlementTxHash?.slice(0, 18) ?? "-"}`);
  }
  for (const sig of v.signals.filter((x) => x.status !== "ok")) {
    console.log(`  why-not ${sig.id}: ${sig.reason}`);
  }

  const att = await recordVerdictOnchain(v);
  if (att.txHash) {
    await db.update(verdictsTable).set({ onchainTxHash: att.txHash }).where(eq(verdictsTable.id, v.id));
  }
  console.log(`onchain attestation ${att.txHash ?? att.skipped ?? att.error}`);
}

const all = await db.select().from(intentRequests);
const miners = new Set(all.filter((r) => r.minerId).map((r) => r.minerId));
console.log(`\n${"=".repeat(90)}`);
console.log(`telemetry so far: ${all.length} intent requests, ${miners.size} distinct miners: ${[...miners].join(", ")}`);
console.log(`settlement hashes: ${all.filter((r) => r.settlementTxHash).length}`);
void and;
