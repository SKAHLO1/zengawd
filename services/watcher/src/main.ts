/**
 * Zengawd watcher: a long-running process that
 *  1. enumerates outstanding ERC-20 / ERC-721 approvals for every registered user address,
 *  2. re-runs the Stage 1 pipeline against each token/spender pair on a fixed interval,
 *  3. records a new verdict onchain and emits a revocation recommendation when a pair flips ALLOW -> BLOCK,
 *  4. submits the revocation only when the user explicitly opted in AND delegated via the Safe module.
 *
 * Usage: pnpm watcher            (loop, WATCHER_INTERVAL_MS)
 *        pnpm watcher:once       (single pass)
 */
import { and, eq, getDb, newId, nowIso, watchedApprovals, watchedUsers } from "@zengawd/db";
import { loadEnv } from "@zengawd/telegraph";
import { approvalCalldata, recordVerdictOnchain, runGuard, scanApprovals, type GuardTarget, type OutstandingApproval, type Verdict } from "@zengawd/engine";
import { submitAutoRevocation } from "./revoke";

loadEnv();
const once = process.argv.includes("--once");
const intervalMs = Number(process.env.WATCHER_INTERVAL_MS ?? "600000");
const log = (m: string) => console.log(`[watcher ${new Date().toISOString()}] ${m}`);

export async function pass(): Promise<void> {
  const db = await getDb();
  const users = await db.select().from(watchedUsers);
  if (users.length === 0) {
    log("no registered users (register one via POST /api/approvals/register)");
    return;
  }
  for (const u of users) {
    const owner = u.userAddress as `0x${string}`;
    let outstanding: OutstandingApproval[];
    try {
      outstanding = await scanApprovals(u.chainId, owner);
    } catch (e) {
      log(`scan failed for ${owner} on ${u.chainId}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    log(`${owner} chain ${u.chainId}: ${outstanding.length} outstanding approvals`);
    await syncRows(u.chainId, owner, outstanding);

    const rows = await db.select().from(watchedApprovals).where(and(eq(watchedApprovals.userAddress, owner), eq(watchedApprovals.chainId, u.chainId)));
    for (const row of rows) {
      if (!outstanding.some((o) => o.token === row.tokenAddress && o.spender === row.spenderAddress)) continue; // revoked meanwhile
      const target: GuardTarget = {
        chainId: row.chainId,
        from: owner,
        to: row.tokenAddress as `0x${string}`,
        calldata: approvalCalldata(row.tokenStandard as "ERC20" | "ERC721", row.spenderAddress as `0x${string}`, row.allowance),
        value: 0n,
      };
      let verdict: Verdict;
      try {
        verdict = await runGuard(target, { stage1Only: true });
      } catch (e) {
        log(`pipeline failed for ${row.tokenAddress}/${row.spenderAddress}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const previous = row.lastVerdict;
      const flipped = previous === "ALLOW" && (verdict.verdict === "BLOCK" || verdict.verdict === "INSUFFICIENT_SIGNAL");
      log(`${row.tokenStandard} ${row.tokenAddress} -> ${row.spenderAddress}: ${previous ?? "new"} -> ${verdict.verdict} (${verdict.score})${flipped ? "  FLIPPED" : ""}`);

      let onchainTx: string | null = null;
      if (flipped) {
        const att = await recordVerdictOnchain(verdict);
        onchainTx = att.txHash;
        log(`  verdict recorded onchain: ${att.txHash ?? att.skipped ?? att.error}`);
      }

      const update: Partial<typeof watchedApprovals.$inferInsert> = {
        lastVerdictId: verdict.id,
        lastVerdict: verdict.verdict,
        lastScore: verdict.score,
        lastCheckedAt: nowIso(),
      };
      if (flipped) {
        update.revocationRecommendedAt = nowIso();
        log(`  REVOCATION RECOMMENDED for ${row.tokenAddress} spender ${row.spenderAddress}`);
        if (u.autoRevokeEnabled && u.safeAddress) {
          const tx = await submitAutoRevocation(row.chainId, u.safeAddress as `0x${string}`, row.tokenAddress as `0x${string}`, row.spenderAddress as `0x${string}`, row.tokenStandard as "ERC20" | "ERC721");
          log(`  auto-revocation: ${tx.txHash ?? tx.error}`);
          if (tx.txHash) update.revocationTxHash = tx.txHash;
        } else {
          log("  auto-revocation not enabled for this user (opt-in is off or no Safe delegated); recommendation only");
        }
      }
      await db.update(watchedApprovals).set(update).where(eq(watchedApprovals.id, row.id));
      void onchainTx;
    }
  }
}

async function syncRows(chainId: number, owner: `0x${string}`, outstanding: OutstandingApproval[]): Promise<void> {
  const db = await getDb();
  const existing = await db.select().from(watchedApprovals).where(and(eq(watchedApprovals.userAddress, owner), eq(watchedApprovals.chainId, chainId)));
  for (const o of outstanding) {
    const hit = existing.find((e) => e.tokenAddress === o.token && e.spenderAddress === o.spender);
    if (hit) {
      if (hit.allowance !== o.allowance) await db.update(watchedApprovals).set({ allowance: o.allowance }).where(eq(watchedApprovals.id, hit.id));
      continue;
    }
    await db
      .insert(watchedApprovals)
      .values({ id: newId(), chainId, userAddress: owner, tokenAddress: o.token, spenderAddress: o.spender, tokenStandard: o.standard, allowance: o.allowance, createdAt: nowIso() });
  }
  for (const e of existing) {
    if (!outstanding.some((o) => o.token === e.tokenAddress && o.spender === e.spenderAddress)) {
      await db.delete(watchedApprovals).where(eq(watchedApprovals.id, e.id));
    }
  }
}

async function main(): Promise<void> {
  log(`starting (${once ? "single pass" : `every ${intervalMs} ms`})`);
  for (;;) {
    const started = Date.now();
    try {
      await pass();
    } catch (e) {
      log(`pass failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (once) return;
    const wait = Math.max(1000, intervalMs - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
}

if (process.argv[1] && /main\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
