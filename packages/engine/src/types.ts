import type { Address, Hex } from "viem";

export type GuardTarget = {
  chainId: number;
  /** the signing user */
  from: Address;
  /** contract being called */
  to: Address;
  calldata: Hex;
  value: bigint;
  /** dApp origin, if known */
  originUrl?: string;
  /** DM / airdrop / support message, if supplied */
  lureText?: string;
};

export type ActionKind = "transfer" | "approve" | "setApprovalForAll" | "swap" | "call" | "none";

export type DecodedAction = {
  kind: ActionKind;
  selector: Hex;
  functionName: string | null;
  /** ERC-20 / ERC-721 contract the action concerns (the callee for transfer/approve). */
  token: Address | null;
  spender: Address | null;
  recipient: Address | null;
  amount: bigint | null;
  /** approve() with an effectively unlimited allowance, or setApprovalForAll(true). */
  unlimited: boolean;
  args: readonly unknown[] | null;
};

/** Local facts about the callee, read from the chain RPC (not from a miner). */
export type ContractFacts = {
  isContract: boolean;
  codeSize: number;
  isErc20: boolean;
  isErc721: boolean;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
};

export type SignalStatus = "ok" | "unavailable" | "skipped";

export type Signal = {
  id: string;
  intent: string;
  /** 0..1, null when unavailable or skipped */
  risk: number | null;
  /** static base weight */
  weight: number;
  /** one plain-English sentence */
  rationale: string;
  /** raw miner response, stored verbatim */
  evidence: unknown;
  status: SignalStatus;
  stage: 1 | 2;
  /** FRAUD_DETECTION: displayed, never scored */
  advisory: boolean;
  minerId: string | null;
  minerName: string | null;
  latencyMs: number;
  costUsd: number | null;
  txHash: string | null;
  signalHash: string | null;
  confidence: number | null;
  /** Why the signal is unavailable or skipped. */
  reason: string | null;
};

export type VerdictLabel = "ALLOW" | "WARN" | "BLOCK" | "INSUFFICIENT_SIGNAL";

export type Verdict = {
  id: string;
  target: GuardTarget;
  decoded: DecodedAction;
  facts: ContractFacts | null;
  verdict: VerdictLabel;
  score: number;
  escalated: boolean;
  signals: Signal[];
  stage1Score: number | null;
  stage1LatencyMs: number;
  stage2LatencyMs: number | null;
  totalCostUsd: number | null;
  createdAt: string;
  /** keccak256 of the canonical JSON (chainId, from, to, calldata, verdict, score, createdAt) */
  verdictHash: Hex;
  onchainTxHash: string | null;
};

/** JSON-safe form of a Verdict (bigint value rendered as decimal string). */
export type VerdictJson = Omit<Verdict, "target" | "decoded"> & {
  target: Omit<GuardTarget, "value"> & { value: string };
  decoded: Omit<DecodedAction, "amount" | "args"> & { amount: string | null; args: unknown[] | null };
};
