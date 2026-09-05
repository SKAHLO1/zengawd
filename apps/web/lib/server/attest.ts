import { eq } from "drizzle-orm";
import { getDb, verdicts } from "@zengawd/db";
import { recordVerdictOnchain, type AttestationResult, type Verdict } from "@zengawd/engine";

/**
 * Record the verdict hash/code/score in ZengawdPolicy with the server-held attestor key.
 * Skipped (with an explicit reason) when the attestor or policy address is not configured.
 */
export async function attestVerdict(verdict: Verdict): Promise<AttestationResult> {
  const result = await recordVerdictOnchain(verdict);
  if (result.txHash) {
    getDb().update(verdicts).set({ onchainTxHash: result.txHash }).where(eq(verdicts.id, verdict.id)).run();
  }
  return result;
}
