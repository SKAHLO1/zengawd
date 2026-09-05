"use client";

import { useCallback, useEffect, useState } from "react";
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

/** Connect an injected (EIP-1193) wallet. Prompts the user. Nothing is persisted in browser storage. */
export async function connectWallet(): Promise<WalletState> {
  if (!window.ethereum) throw new Error("No injected wallet found. Install MetaMask or another EIP-1193 wallet.");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const first = accounts[0];
  if (!first) throw new Error("wallet returned no accounts");
  return { address: getAddress(first), chainId: await readChainId() };
}

/**
 * Read an already-authorised account without prompting (`eth_accounts`).
 * Returns null when the wallet is locked or this origin was never authorised.
 */
export async function restoreWallet(): Promise<WalletState | null> {
  if (!window.ethereum) return null;
  try {
    const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
    const first = accounts[0];
    if (!first) return null;
    return { address: getAddress(first), chainId: await readChainId() };
  } catch {
    return null;
  }
}

async function readChainId(): Promise<number> {
  const hex = (await window.ethereum!.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(hex, 16);
}

/**
 * Subscribe to wallet events. `null` means the wallet disconnected or locked.
 * Not every injected provider implements `on`/`removeListener`, so both are feature-detected.
 */
export function onWalletChange(cb: (s: Partial<WalletState> | null) => void): () => void {
  const eth = window.ethereum;
  if (!eth || typeof eth.on !== "function") return () => {};
  const onAccounts = (accs: unknown) => {
    const a = Array.isArray(accs) && typeof accs[0] === "string" ? getAddress(accs[0]) : undefined;
    cb(a ? { address: a } : null);
  };
  const onChain = (hex: unknown) => cb({ chainId: typeof hex === "string" ? Number.parseInt(hex, 16) : undefined });
  eth.on("accountsChanged", onAccounts);
  eth.on("chainChanged", onChain);
  return () => {
    if (typeof eth.removeListener !== "function") return;
    eth.removeListener("accountsChanged", onAccounts);
    eth.removeListener("chainChanged", onChain);
  };
}

export type UseWallet = {
  wallet: WalletState | null;
  /** False until the client has mounted, so the button never renders differently on the server. */
  available: boolean;
  connect: () => Promise<WalletState>;
};

/**
 * Wallet state for a client component.
 *
 * Availability is resolved in an effect rather than during render: `window.ethereum` does not exist on
 * the server, so calling it inline made the server emit `disabled` and the client emit enabled — a
 * hydration mismatch that makes React 19 discard and re-render the tree, wiping any state set in
 * between (the "connect succeeds but the UI never updates" symptom).
 */
export function useWallet(): UseWallet {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!hasInjectedWallet()) return;
    setAvailable(true);
    // An already-authorised account should show without a second click.
    void restoreWallet().then((w) => {
      if (w) setWallet((current) => current ?? w);
    });
    return onWalletChange((s) => {
      if (s === null) {
        setWallet(null);
        return;
      }
      setWallet((current) => {
        if (current) return { ...current, ...s };
        // An event can arrive before any connect resolved; only a full state is usable.
        return s.address !== undefined && s.chainId !== undefined ? { address: s.address, chainId: s.chainId } : current;
      });
    });
  }, []);

  const connect = useCallback(async () => {
    const w = await connectWallet();
    setWallet(w);
    return w;
  }, []);

  return { wallet, available, connect };
}

/** Send a transaction from the connected wallet (used for approval revocation). */
export async function sendFromWallet(from: Address, to: Address, data: Hex): Promise<Hex> {
  if (!window.ethereum) throw new Error("no injected wallet");
  const client = createWalletClient({ account: from, transport: custom(window.ethereum) });
  return client.sendTransaction({ account: from, to, data, chain: null });
}
