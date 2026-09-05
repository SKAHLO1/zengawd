import { getAddress, isAddress, isHex, parseTransaction, zeroAddress, type Address, type Hex } from "viem";
import type { GuardTarget } from "./types";

export type GuardInput = {
  chainId: number;
  from: Address;
  /** Token address, contract address, dApp URL, raw signed tx hex, or a JSON tx object. */
  input: string;
  lureText?: string;
};

export type ParsedInput =
  | { kind: "address"; address: Address }
  | { kind: "url"; url: string }
  | { kind: "tx"; to: Address; data: Hex; value: bigint; chainId: number | null; originUrl?: string };

/** Classify the single free-form guard input. Throws on unrecognised input. */
export function parseGuardInput(raw: string): ParsedInput {
  const s = raw.trim();
  if (!s) throw new Error("input is empty");
  if (isAddress(s)) return { kind: "address", address: getAddress(s) };
  if (/^https?:\/\//i.test(s)) {
    new URL(s); // validates
    return { kind: "url", url: s };
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) {
    return { kind: "url", url: `https://${s}` };
  }
  if (s.startsWith("{")) {
    const obj = JSON.parse(s) as Record<string, unknown>;
    const to = typeof obj.to === "string" && isAddress(obj.to) ? getAddress(obj.to) : null;
    if (!to) throw new Error("tx JSON needs a valid `to` address");
    const dataRaw = (obj.data ?? obj.input ?? obj.calldata ?? "0x") as string;
    if (!isHex(dataRaw)) throw new Error("tx JSON `data` must be hex");
    const value = parseBig(obj.value);
    const chainId = typeof obj.chainId === "number" ? obj.chainId : typeof obj.chainId === "string" ? Number(obj.chainId) : null;
    const originUrl = typeof obj.origin === "string" ? obj.origin : typeof obj.originUrl === "string" ? obj.originUrl : undefined;
    return { kind: "tx", to, data: dataRaw as Hex, value, chainId, ...(originUrl ? { originUrl } : {}) };
  }
  if (isHex(s) && s.length > 10) {
    const tx = parseTransaction(s as Hex);
    if (!tx.to) throw new Error("raw transaction has no `to` (contract creation is not guarded)");
    return { kind: "tx", to: getAddress(tx.to), data: (tx.data ?? "0x") as Hex, value: tx.value ?? 0n, chainId: tx.chainId ?? null };
  }
  throw new Error("input must be an address, a URL, a raw transaction, or a JSON transaction object");
}

/** Build the GuardTarget from a classified input. URL-only targets carry the zero address as callee. */
export function buildGuardTarget(g: GuardInput): { target: GuardTarget; parsed: ParsedInput } {
  const parsed = parseGuardInput(g.input);
  const lure = g.lureText?.trim() ? { lureText: g.lureText.trim() } : {};
  switch (parsed.kind) {
    case "address":
      return { parsed, target: { chainId: g.chainId, from: g.from, to: parsed.address, calldata: "0x", value: 0n, ...lure } };
    case "url":
      return { parsed, target: { chainId: g.chainId, from: g.from, to: zeroAddress, calldata: "0x", value: 0n, originUrl: parsed.url, ...lure } };
    case "tx":
      return {
        parsed,
        target: {
          chainId: parsed.chainId ?? g.chainId,
          from: g.from,
          to: parsed.to,
          calldata: parsed.data,
          value: parsed.value,
          ...(parsed.originUrl ? { originUrl: parsed.originUrl } : {}),
          ...lure,
        },
      };
  }
}

function parseBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.floor(v));
  if (typeof v === "string" && v.trim()) return v.startsWith("0x") ? BigInt(v) : BigInt(v);
  return 0n;
}

export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
