/** Trace the x402 exchange phase by phase against the live node (no DB writes). */
import { createPaidFetch } from "../src/payment";

const url = `${process.env.TELEGRAPH_NODE_URL ?? "https://devnode.telegraphprotocol.com"}/engine/v1/ask`;
const t0 = Date.now();
const log = (m: string) => console.log(`[+${Date.now() - t0}ms] ${m}`);

const traced: typeof fetch = async (input, init) => {
  const hasPay = Boolean((init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"] ?? new Headers(init?.headers).get("payment-signature"));
  log(`-> ${init?.method ?? "GET"} ${String(input)} payment=${hasPay}`);
  const res = await fetch(input, init);
  log(`<- ${res.status} settlement=${res.headers.get("payment-response") ? "yes" : "no"}`);
  return res;
};

const { paidFetch, payerAddress } = createPaidFetch(traced);
log(`payer=${payerAddress}`);
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 40_000);
try {
  const res = await paidFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "What is the current price of bitcoin in USD?" }),
    signal: ctrl.signal,
  });
  log(`final ${res.status}`);
  console.log((await res.text()).slice(0, 800));
} catch (e) {
  log(`error: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  clearTimeout(timer);
}
