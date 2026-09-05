import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findRepoRoot } from "@zengawd/db";

let loaded = false;
/** Load the repository-root .env once (no-op if absent). Never logs values. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const path = resolve(findRepoRoot(), ".env");
  if (existsSync(path)) loadDotenv({ path, override: false });
}

export type TelegraphConfig = {
  /** Base URL of the Telegraph node. Engine lives under `${nodeUrl}/engine`. */
  nodeUrl: string;
  /** CAIP-2 network used for x402 payment. Live docs: Base Sepolia = eip155:84532. */
  paymentNetwork: `${string}:${string}`;
  /**
   * Whether to send a `context` object at all (routing hints and adapter hints).
   *
   * Defaults to **false**. The live node merges `context` into the body it forwards to the miner,
   * and miners with a closed input schema reject unknown keys outright:
   * `422 Unrecognized keys: "deadline_ms", "min_confidence"`. The query text is self-contained, and
   * confidence and deadline are enforced client-side, so sending context only loses signals.
   * See DECISIONS.md 2.9.
   */
  sendRoutingHints: boolean;
};

export function getConfig(): TelegraphConfig {
  loadEnv();
  const nodeUrl = (process.env.TELEGRAPH_NODE_URL || "https://devnode.telegraphprotocol.com").replace(/\/+$/, "");
  const paymentNetwork = (process.env.TELEGRAPH_PAYMENT_NETWORK || "eip155:84532") as `${string}:${string}`;
  const sendRoutingHints = (process.env.TELEGRAPH_SEND_ROUTING_HINTS ?? "false") === "true";
  return { nodeUrl, paymentNetwork, sendRoutingHints };
}

/** The payment key is read lazily and only here. It is never logged or returned to callers. */
export function getPaymentPrivateKey(): `0x${string}` | undefined {
  loadEnv();
  const k = process.env.TELEGRAPH_EVM_PRIVATE_KEY?.trim();
  if (!k) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("TELEGRAPH_EVM_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string");
  return k as `0x${string}`;
}
