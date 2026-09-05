import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { getConfig, getPaymentPrivateKey } from "./config";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Build a fetch that transparently answers x402 `402 Payment Required` challenges:
 * decode PAYMENT-REQUIRED, sign an EIP-3009 USDC transfer to `accepts[].payTo`, retry with
 * PAYMENT-SIGNATURE. (Live docs: "Paying with x402".) The private key never leaves this module.
 */
export function createPaidFetch(baseFetch: FetchLike = fetch): { paidFetch: FetchLike; payerAddress: `0x${string}` | null } {
  const pk = getPaymentPrivateKey();
  if (!pk) {
    // No key: requests still go out and the 402 is surfaced as `unavailable` by the client.
    return { paidFetch: baseFetch, payerAddress: null };
  }
  const account = privateKeyToAccount(pk);
  const { paymentNetwork } = getConfig();
  const client = new x402Client().register(paymentNetwork, new ExactEvmScheme(toClientEvmSigner(account)));
  const paidFetch = wrapFetchWithPayment(baseFetch as typeof globalThis.fetch, client) as FetchLike;
  return { paidFetch, payerAddress: account.address };
}

export type Settlement = {
  success: boolean;
  transaction: string | null;
  network: string | null;
  payer: string | null;
  raw: string;
};

/** Decode the PAYMENT-RESPONSE settlement header. Tolerates the legacy X-PAYMENT-RESPONSE name. */
export function readSettlement(headers: Headers): Settlement | null {
  const raw = headers.get("payment-response") ?? headers.get("x-payment-response");
  if (!raw) return null;
  try {
    const s = decodePaymentResponseHeader(raw);
    return {
      success: Boolean(s.success),
      transaction: typeof s.transaction === "string" && s.transaction.length > 0 ? s.transaction : null,
      network: typeof s.network === "string" ? s.network : null,
      payer: typeof s.payer === "string" ? s.payer : null,
      raw,
    };
  } catch {
    return { success: false, transaction: null, network: null, payer: null, raw };
  }
}
