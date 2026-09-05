import { describe, expect, it } from "vitest";
import { openDb, intentRequests } from "@zengawd/db";
import { TelegraphClient } from "./client";
import type { FetchLike } from "./payment";

const NODE = "https://node.test";

function catalogFetch(minerCounts: Record<string, number>, miners: unknown[] = []): FetchLike {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/engine/v1/intents")) {
      return json({ intents: Object.entries(minerCounts).map(([intent_id, miner_count]) => ({ intent_id, miner_count })) });
    }
    if (url.endsWith("/api/miners")) return json(miners);
    return new Response("not found", { status: 404 });
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function settlementHeader(tx: string): string {
  return Buffer.from(JSON.stringify({ success: true, transaction: tx, network: "eip155:84532", payer: "0xabc" })).toString("base64");
}

const okBody = {
  miner_id: "7302",
  miner_name: "chainwire-holder-count",
  intent: "TOKEN_HOLDER_COUNT",
  result: { holders: 3_000_000, confidence: 0.95 },
  cost_usd: 0.01,
  duration_ms: 400,
  timestamp: "2026-09-05T00:00:00Z",
  signal_hash: "0xsig",
};

const miners = [{ id: "7302", slug: "chainwire-holder-count", signal_mapping: { confidence_field: "confidence" } }];

describe("TelegraphClient.requestIntent", () => {
  it("returns ok, extracts miner, confidence and settlement tx, and records one row", async () => {
    const db = openDb(":memory:");
    const paidFetch: FetchLike = async () => json(okBody, 200, { "payment-response": settlementHeader("0xtx1") });
    const client = new TelegraphClient({ nodeUrl: NODE, db, paidFetch, plainFetch: catalogFetch({ TOKEN_HOLDER_COUNT: 5 }, miners) });
    const r = await client.requestIntent({ intent: "TOKEN_HOLDER_COUNT", payload: { query: "q" }, minConfidence: 0.6, deadlineMs: 4000 });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error();
    expect(r.minerId).toBe("7302");
    expect(r.confidence).toBe(0.95);
    expect(r.txHash).toBe("0xtx1");
    expect(r.costUsd).toBe(0.01);
    const rows = db.select().from(intentRequests).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("ok");
    expect(rows[0]?.minerId).toBe("7302");
    expect(rows[0]?.settlementTxHash).toBe("0xtx1");
    expect(JSON.parse(rows[0]?.responsePayload ?? "")).toMatchObject({ body: okBody });
  });

  it("resolves to unavailable on deadline and still records a row", async () => {
    const db = openDb(":memory:");
    const paidFetch: FetchLike = (_i, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const client = new TelegraphClient({ nodeUrl: NODE, db, paidFetch, plainFetch: catalogFetch({ TOKEN_HOLDER_COUNT: 5 }), settlementBudgetMs: 0 });
    const r = await client.requestIntent({ intent: "TOKEN_HOLDER_COUNT", payload: { query: "q" }, minConfidence: 0.6, deadlineMs: 50 });
    expect(r.status).toBe("unavailable");
    if (r.status !== "unavailable") throw new Error();
    expect(r.reason).toMatch(/deadline of 50ms/);
    expect(db.select().from(intentRequests).all()).toHaveLength(1);
  });

  it("caps payment retries at 2 and reports unavailable on persistent 402", async () => {
    const db = openDb(":memory:");
    let calls = 0;
    const paidFetch: FetchLike = async () => {
      calls++;
      return json({ error: "payment required" }, 402);
    };
    const client = new TelegraphClient({ nodeUrl: NODE, db, paidFetch, plainFetch: catalogFetch({ TOKEN_HOLDER_COUNT: 5 }) });
    const r = await client.requestIntent({ intent: "TOKEN_HOLDER_COUNT", payload: { query: "q" }, minConfidence: 0.6, deadlineMs: 4000 });
    expect(r.status).toBe("unavailable");
    expect(calls).toBe(2);
    expect(db.select().from(intentRequests).all()[0]?.status).toBe("unavailable");
  });

  it("rejects a response the router classified into a different intent", async () => {
    const db = openDb(":memory:");
    const paidFetch: FetchLike = async () => json({ ...okBody, intent: "CRYPTO_PRICE" });
    const client = new TelegraphClient({ nodeUrl: NODE, db, paidFetch, plainFetch: catalogFetch({ TOKEN_HOLDER_COUNT: 5 }, miners) });
    const r = await client.requestIntent({ intent: "TOKEN_HOLDER_COUNT", payload: { query: "q" }, minConfidence: 0.6, deadlineMs: 4000 });
    expect(r.status).toBe("unavailable");
    if (r.status !== "unavailable") throw new Error();
    expect(r.reason).toMatch(/classified/);
    expect(db.select().from(intentRequests).all()[0]?.minerId).toBe("7302");
  });

  it("rejects a response whose miner-reported confidence is below the threshold", async () => {
    const db = openDb(":memory:");
    const paidFetch: FetchLike = async () => json({ ...okBody, result: { holders: 1, confidence: 0.3 } });
    const client = new TelegraphClient({ nodeUrl: NODE, db, paidFetch, plainFetch: catalogFetch({ TOKEN_HOLDER_COUNT: 5 }, miners) });
    const r = await client.requestIntent({ intent: "TOKEN_HOLDER_COUNT", payload: { query: "q" }, minConfidence: 0.6, deadlineMs: 4000 });
    expect(r.status).toBe("unavailable");
    expect(db.select().from(intentRequests).all()[0]?.returnedConfidence).toBe(0.3);
  });

  it("marks a miner unavailable when its own serve time exceeds the declared deadline", async () => {
    const db = openDb(":memory:");
    const paidFetch: FetchLike = async () => json({ ...okBody, duration_ms: 9000 });
    const client = new TelegraphClient({ nodeUrl: NODE, db, paidFetch, plainFetch: catalogFetch({ TOKEN_HOLDER_COUNT: 5 }, miners) });
    const r = await client.requestIntent({ intent: "TOKEN_HOLDER_COUNT", payload: { query: "q" }, minConfidence: 0.6, deadlineMs: 4000 });
    expect(r.status).toBe("unavailable");
    if (r.status !== "unavailable") throw new Error();
    expect(r.reason).toMatch(/9000ms to serve, beyond the declared 4000ms/);
    expect(db.select().from(intentRequests).all()[0]?.minerId).toBe("7302");
  });

  it("accepts a miner that serves within the declared deadline even though settlement took longer", async () => {
    const db = openDb(":memory:");
    // total wall clock is dominated by the payment rail; the miner itself answered in 700ms
    const paidFetch: FetchLike = async () => json({ ...okBody, duration_ms: 700 });
    const client = new TelegraphClient({ nodeUrl: NODE, db, paidFetch, plainFetch: catalogFetch({ TOKEN_HOLDER_COUNT: 5 }, miners) });
    const r = await client.requestIntent({ intent: "TOKEN_HOLDER_COUNT", payload: { query: "q" }, minConfidence: 0.6, deadlineMs: 4000 });
    expect(r.status).toBe("ok");
  });

  it("refuses an intent with no live miners without spending", async () => {
    const db = openDb(":memory:");
    let calls = 0;
    const paidFetch: FetchLike = async () => {
      calls++;
      return json(okBody);
    };
    const client = new TelegraphClient({ nodeUrl: NODE, db, paidFetch, plainFetch: catalogFetch({ TWITTER_SEARCH: 0 }) });
    const r = await client.requestIntent({ intent: "TWITTER_SEARCH", payload: { query: "q" }, minConfidence: 0.8, deadlineMs: 4000 });
    expect(r.status).toBe("unavailable");
    if (r.status !== "unavailable") throw new Error();
    expect(r.reason).toMatch(/no live miners/);
    expect(calls).toBe(0);
    expect(db.select().from(intentRequests).all()).toHaveLength(1);
  });
});
