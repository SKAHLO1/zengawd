import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { base, baseSepolia, mainnet, arbitrum, optimism, polygon, bsc } from "viem/chains";
import { loadEnv } from "@zengawd/telegraph";

const CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [polygon.id]: polygon,
  [bsc.id]: bsc,
};

/** Names used when phrasing intent queries for miners (must be plain and unambiguous). */
export const CHAIN_NAMES: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  84532: "base sepolia",
  42161: "arbitrum",
  10: "optimism",
  137: "polygon",
  56: "bsc",
};

export const DEFAULT_RPC: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://mainnet.base.org",
  84532: "https://sepolia.base.org",
  42161: "https://arb1.arbitrum.io/rpc",
  10: "https://mainnet.optimism.io",
  137: "https://polygon-rpc.com",
  56: "https://bsc-dataseed.binance.org",
};

export function chainName(chainId: number): string {
  return CHAIN_NAMES[chainId] ?? `chain ${chainId}`;
}

export function rpcUrl(chainId: number): string {
  loadEnv();
  const env = process.env[`RPC_URL_${chainId}`];
  const url = env && env.trim() ? env.trim() : DEFAULT_RPC[chainId];
  if (!url) throw new Error(`no RPC configured for chain ${chainId} (set RPC_URL_${chainId})`);
  return url;
}

const clients = new Map<number, PublicClient>();

/** Public client with an explicit per-request timeout (spec: every external call has a timeout). */
export function publicClient(chainId: number, timeoutMs = 8000): PublicClient {
  const key = chainId;
  const cached = clients.get(key);
  if (cached) return cached;
  const chain = CHAINS[chainId];
  const client = createPublicClient({
    ...(chain ? { chain } : {}),
    transport: http(rpcUrl(chainId), { timeout: timeoutMs, retryCount: 1 }),
  }) as PublicClient;
  clients.set(key, client);
  return client;
}

export function explorerTxUrl(chainId: number, txHash: string): string {
  const bases: Record<number, string> = {
    1: "https://etherscan.io/tx/",
    8453: "https://basescan.org/tx/",
    84532: "https://sepolia.basescan.org/tx/",
    42161: "https://arbiscan.io/tx/",
    10: "https://optimistic.etherscan.io/tx/",
    137: "https://polygonscan.com/tx/",
    56: "https://bscscan.com/tx/",
  };
  return `${bases[chainId] ?? "https://blockscan.com/tx/"}${txHash}`;
}
