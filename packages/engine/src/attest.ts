import { createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv } from "@zengawd/telegraph";
import { publicClient, rpcUrl } from "./chains";
import { VERDICT_CODES } from "./thresholds";
import type { Verdict } from "./types";

export const POLICY_ABI = parseAbi([
  "struct StoredVerdict { bytes32 verdictHash; uint8 verdictCode; uint16 score; uint64 issuedAt; }",
  "function recordVerdict(address user, address target, bytes4 selector, StoredVerdict v)",
  "function checkAllowed(address user, address target, bytes4 selector) view returns (bool allowed, uint8 code, uint16 score)",
  "function setMaxVerdictAge(uint64 seconds_)",
  "function attestor() view returns (address)",
  "function maxVerdictAge() view returns (uint64)",
]);

export type AttestationResult = {
  txHash: Hex | null;
  chainId: number | null;
  policy: Address | null;
  /** Why no transaction was sent. */
  skipped: string | null;
  error: string | null;
};

export type AttestorConfig = { privateKey: Hex; policy: Address; chainId: number };

/** Attestor configuration is read from the environment at call time and never returned to a browser. */
export function attestorConfig(): AttestorConfig | null {
  loadEnv();
  const pk = process.env.ZENGAWD_ATTESTOR_PRIVATE_KEY?.trim();
  const policy = process.env.ZENGAWD_POLICY_ADDRESS?.trim();
  const chainId = Number(process.env.ZENGAWD_POLICY_CHAIN_ID ?? "84532");
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk) || !policy || !/^0x[0-9a-fA-F]{40}$/.test(policy)) return null;
  return { privateKey: pk as Hex, policy: policy as Address, chainId };
}

/** Write the verdict hash, code and score to ZengawdPolicy. The full payload never goes onchain. */
export async function recordVerdictOnchain(verdict: Verdict, cfg: AttestorConfig | null = attestorConfig()): Promise<AttestationResult> {
  if (!cfg) return { txHash: null, chainId: null, policy: null, skipped: "attestor not configured (ZENGAWD_ATTESTOR_PRIVATE_KEY / ZENGAWD_POLICY_ADDRESS)", error: null };
  const account = privateKeyToAccount(cfg.privateKey);
  const pc = publicClient(cfg.chainId);
  const wallet = createWalletClient({ account, chain: pc.chain, transport: http(rpcUrl(cfg.chainId), { timeout: 15_000 }) });
  const selector = verdict.decoded.selector as Hex;
  const stored = {
    verdictHash: verdict.verdictHash,
    verdictCode: VERDICT_CODES[verdict.verdict],
    score: Math.max(0, Math.min(10_000, Math.round(verdict.score * 100))),
    issuedAt: BigInt(Math.floor(Date.parse(verdict.createdAt) / 1000)),
  };
  try {
    const hash = await wallet.writeContract({
      address: cfg.policy,
      abi: POLICY_ABI,
      functionName: "recordVerdict",
      args: [verdict.target.from, verdict.target.to, selector, stored],
      chain: pc.chain ?? null,
    });
    return { txHash: hash, chainId: cfg.chainId, policy: cfg.policy, skipped: null, error: null };
  } catch (e) {
    return { txHash: null, chainId: cfg.chainId, policy: cfg.policy, skipped: null, error: e instanceof Error ? e.message.split("\n")[0] ?? e.message : String(e) };
  }
}

export async function checkAllowedOnchain(user: Address, target: Address, selector: Hex, cfg: AttestorConfig | null = attestorConfig()): Promise<{ allowed: boolean; code: number; score: number } | null> {
  if (!cfg) return null;
  const pc = publicClient(cfg.chainId);
  const [allowed, code, score] = await pc.readContract({ address: cfg.policy, abi: POLICY_ABI, functionName: "checkAllowed", args: [user, target, selector] });
  return { allowed, code, score };
}
