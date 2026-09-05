import { keccak256, stringToHex, type Hex } from "viem";
import type { GuardTarget, VerdictLabel } from "./types";

export type VerdictHashInput = {
  chainId: number;
  from: string;
  to: string;
  calldata: string;
  verdict: VerdictLabel;
  score: number;
  createdAt: string;
};

/**
 * Deterministic serialisation: exactly these seven keys, alphabetical order, no whitespace,
 * addresses and calldata lower-cased, score as a JSON number.
 */
export function canonicalVerdictJson(input: VerdictHashInput): string {
  const ordered = {
    calldata: input.calldata.toLowerCase(),
    chainId: input.chainId,
    createdAt: input.createdAt,
    from: input.from.toLowerCase(),
    score: input.score,
    to: input.to.toLowerCase(),
    verdict: input.verdict,
  };
  const keys = Object.keys(ordered).sort();
  return "{" + keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(ordered[k as keyof typeof ordered])}`).join(",") + "}";
}

export function verdictHash(input: VerdictHashInput): Hex {
  return keccak256(stringToHex(canonicalVerdictJson(input)));
}

export function hashInputFromTarget(t: GuardTarget, verdict: VerdictLabel, score: number, createdAt: string): VerdictHashInput {
  return { chainId: t.chainId, from: t.from, to: t.to, calldata: t.calldata, verdict, score, createdAt };
}
