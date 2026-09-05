"use client";

import { createWalletClient, custom, getAddress, type Address, type EIP1193Provider, type Hex } from "viem";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export type WalletState = { address: Address; chainId: number };

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

/** Connect an injected (EIP-1193) wallet. Nothing is persisted in browser storage. */
export async function connectWallet(): Promise<WalletState> {
  if (!window.ethereum) throw new Error("No injected wallet found. Install MetaMask or another EIP-1193 wallet.");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const chainHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  const first = accounts[0];
  if (!first) throw new Error("wallet returned no accounts");
  return { address: getAddress(first), chainId: Number.parseInt(chainHex, 16) };
}

export function onWalletChange(cb: (s: Partial<WalletState>) => void): () => void {
  const eth = window.ethereum;
  if (!eth) return () => {};
  const onAccounts = (accs: unknown) => {
    const a = Array.isArray(accs) && typeof accs[0] === "string" ? getAddress(accs[0]) : undefined;
    cb(a ? { address: a } : {});
  };
  const onChain = (hex: unknown) => cb({ chainId: typeof hex === "string" ? Number.parseInt(hex, 16) : undefined });
  eth.on("accountsChanged", onAccounts);
  eth.on("chainChanged", onChain);
  return () => {
    eth.removeListener("accountsChanged", onAccounts);
    eth.removeListener("chainChanged", onChain);
  };
}

/** Send a transaction from the connected wallet (used for approval revocation). */
export async function sendFromWallet(from: Address, to: Address, data: Hex): Promise<Hex> {
  if (!window.ethereum) throw new Error("no injected wallet");
  const client = createWalletClient({ account: from, transport: custom(window.ethereum) });
  return client.sendTransaction({ account: from, to, data, chain: null });
}
