import { getDb, intentRequests, newId, nowIso, type Db } from "@zengawd/db";
import { Catalog, normaliseConfidence, readPath } from "./catalog";
import { getConfig } from "./config";
import { createPaidFetch, readSettlement, type FetchLike, type Settlement } from "./payment";
import type { EngineAskResponse, IntentRequest, IntentResult } from "./types";

/** Maximum number of x402 settlement attempts per intent request (spec: cap retries at 2). */
export const MAX_PAYMENT_RETRIES = 2;

/**
 * Wall-clock budget for the x402 payment rail, on top of the caller's `deadlineMs`.
 *
 * Measured on the live testnet node (scripts/latency-probe.ts, n=9, 2026-09-05): the unpaid 402
 * challenge returns in ~1.5 s, then signing + facilitator verification + settlement on Base Sepolia
 * takes a further 11.3-12.0 s before the miner is even called. Miners themselves answer in
 * ~0.4-1.0 s (`duration_ms` in the response).
 *
 * `deadlineMs` is therefore enforced where it is meaningful - against the miner's own serve time -
 * while the transport timeout is `deadlineMs + this budget`, so a slow payment rail is never
 * misreported as an unresponsive miner. See DECISIONS.md 2.6.
 */
export const X402_SETTLEMENT_BUDGET_MS = 30_000;

export type TelegraphClientOptions = {
  nodeUrl?: string;
  /** Fetch used for paid calls. Defaults to an x402-wrapped global fetch. */
  paidFetch?: FetchLike;
  /** Fetch used for free discovery calls. */
  plainFetch?: FetchLike;
  db?: Db;
  sendRoutingHints?: boolean;
  /** Override the x402 settlement budget added to the transport timeout. Tests set this to 0. */
  settlementBudgetMs?: number;
};

export type RequestOptions = {
  /** Links the telemetry row to a verdict. */
  verdictId?: string;
};

type Recorded = {
  status: "ok" | "unavailable";
  minerId: string | null;
  minerName: string | null;
  returnedConfidence: number | null;
  costUsd: number | null;
  settlementTxHash: string | null;
  signalHash: string | null;
  responsePayload: unknown;
};

export class TelegraphClient {
  readonly nodeUrl: string;
  readonly catalog: Catalog;
  private readonly paidFetch: FetchLike;
  private readonly db: Promise<Db>;
  private readonly sendRoutingHints: boolean;
  private readonly settlementBudgetMs: number;

  constructor(opts: TelegraphClientOptions = {}) {
    const cfg = getConfig();
    this.nodeUrl = (opts.nodeUrl ?? cfg.nodeUrl).replace(/\/+$/, "");
    const plain = opts.plainFetch ?? fetch;
    this.paidFetch = opts.paidFetch ?? createPaidFetch(plain).paidFetch;
    this.catalog = new Catalog(this.nodeUrl, plain);
    this.db = opts.db ? Promise.resolve(opts.db) : getDb();
    this.sendRoutingHints = opts.sendRoutingHints ?? cfg.sendRoutingHints;
    this.settlementBudgetMs = opts.settlementBudgetMs ?? X402_SETTLEMENT_BUDGET_MS;
  }

  /**
   * Declare an intent and let Telegraph route it. Never selects a miner.
   * Every call, success or failure, writes exactly one `intent_requests` row before returning.
   */
  async requestIntent<T = unknown>(req: IntentRequest, opts: RequestOptions = {}): Promise<IntentResult<T>> {
    const started = Date.now();
    const id = newId();
    const query = typeof req.payload.query === "string" ? req.payload.query.trim() : "";
    // `context` is forwarded verbatim to the miner, whose schema may be closed; off by default.
    const body: Record<string, unknown> = { query };
    if (this.sendRoutingHints) {
      const extraContext = isRecord(req.payload.context) ? req.payload.context : {};
      body.context = { ...extraContext, min_confidence: req.minConfidence, deadline_ms: req.deadlineMs };
    }
    const requestPayload = { url: `${this.nodeUrl}/engine/v1/ask`, method: "POST", body, intent: req.intent };

    // The row is written before the result is returned (see the method contract above), so both
    // helpers are async and every `return finish(...)` / `return unavailable(...)` resolves through them.
    const finish = async (result: IntentResult<T>, rec: Recorded): Promise<IntentResult<T>> => {
      await this.record(id, req, opts, rec, Date.now() - started, requestPayload);
      return result;
    };
    const unavailable = (reason: string, extra: Partial<Recorded> = {}, extraResult: Partial<IntentResult<T>> = {}): Promise<IntentResult<T>> =>
      finish(
        { status: "unavailable", reason, latencyMs: Date.now() - started, ...extraResult } as IntentResult<T>,
        {
          status: "unavailable",
          minerId: null,
          minerName: null,
          returnedConfidence: null,
          costUsd: null,
          settlementTxHash: null,
          signalHash: null,
          responsePayload: { error: reason },
          ...extra,
        },
      );

    if (!query) return unavailable("payload.query (string) is required");
    if (!(req.minConfidence >= 0 && req.minConfidence <= 1)) return unavailable("minConfidence must be within 0..1");
    if (!(req.deadlineMs > 0)) return unavailable("deadlineMs must be positive");

    // Coverage gate: never depend on an intent with no live miners.
    let minerCount: number | null;
    try {
      minerCount = await this.catalog.minerCount(req.intent);
    } catch (e) {
      return unavailable(`intent catalog unreachable: ${errMsg(e)}`);
    }
    if (minerCount === null) return unavailable(`intent ${req.intent} is not in the canonical catalog`);
    if (minerCount === 0) return unavailable(`no live miners for intent ${req.intent}`);

    const ctrl = new AbortController();
    const transportTimeoutMs = req.deadlineMs + this.settlementBudgetMs;
    const timer = setTimeout(() => ctrl.abort(), transportTimeoutMs);
    let res: Response | null = null;
    let lastError: string | null = null;
    try {
      for (let attempt = 0; attempt < MAX_PAYMENT_RETRIES; attempt++) {
        try {
          res = await this.paidFetch(requestPayload.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          if (res.status !== 402) break;
          lastError = `HTTP 402 after payment attempt ${attempt + 1}: ${await safeText(res)}`;
          res = null;
        } catch (e) {
          if (ctrl.signal.aborted) return unavailable(`deadline of ${req.deadlineMs}ms (+${this.settlementBudgetMs}ms settlement budget) exceeded`);
          lastError = errMsg(e);
          // Only payment-related failures are worth a second settlement attempt.
          if (!/402|payment/i.test(lastError)) break;
        }
      }
    } finally {
      clearTimeout(timer);
    }
    if (!res) return unavailable(lastError ?? "no response");

    const settlement: Settlement | null = readSettlement(res.headers);
    const txHash = settlement?.transaction ?? null;
    const text = await safeText(res);
    let json: EngineAskResponse | null = null;
    try {
      json = JSON.parse(text) as EngineAskResponse;
    } catch {
      json = null;
    }
    const responsePayload = {
      status: res.status,
      headers: pickHeaders(res.headers),
      settlement,
      body: json ?? text,
    };

    if (!res.ok) {
      const detail = json?.error ?? text.slice(0, 500);
      return unavailable(`HTTP ${res.status}: ${detail}`, { responsePayload, settlementTxHash: txHash });
    }
    if (!json || typeof json !== "object") {
      return unavailable("engine returned a non-JSON body", { responsePayload, settlementTxHash: txHash });
    }
    if (json.error) {
      return unavailable(`engine error: ${json.error}`, { responsePayload, settlementTxHash: txHash });
    }

    const minerId = json.miner_id !== undefined && json.miner_id !== null ? String(json.miner_id) : null;
    const minerName = typeof json.miner_name === "string" ? json.miner_name : null;
    const costUsd = typeof json.cost_usd === "number" ? json.cost_usd : null;
    const signalHash = typeof json.signal_hash === "string" ? json.signal_hash : null;
    const served: Partial<Recorded> = { minerId, minerName, costUsd, settlementTxHash: txHash, signalHash, responsePayload };

    if (!minerId) return unavailable("engine response carries no miner_id", served);

    // Intent verification: the router must have classified the query into the declared intent.
    if (typeof json.intent === "string" && json.intent !== req.intent) {
      return unavailable(`router classified query as ${json.intent}, not ${req.intent}`, served, { minerId, txHash });
    }

    // Declared-deadline enforcement, against the miner's own serve time (see X402_SETTLEMENT_BUDGET_MS).
    if (typeof json.duration_ms === "number" && json.duration_ms > req.deadlineMs) {
      return unavailable(
        `miner ${minerId} took ${json.duration_ms}ms to serve, beyond the declared ${req.deadlineMs}ms deadline`,
        served,
        { minerId, txHash },
      );
    }

    // Confidence: read through the serving miner's declared signal_mapping.
    let confidence: number | null = null;
    try {
      const miner = await this.catalog.findMiner(minerId);
      const field = miner?.signal_mapping?.confidence_field;
      if (field) confidence = normaliseConfidence(readPath(json.result, field));
    } catch {
      confidence = null;
    }
    if (confidence !== null && confidence < req.minConfidence) {
      return unavailable(
        `miner ${minerId} reported confidence ${confidence.toFixed(3)} below requested ${req.minConfidence}`,
        { ...served, returnedConfidence: confidence },
        { minerId, txHash },
      );
    }

    const latencyMs = Date.now() - started;
    return finish(
      {
        status: "ok",
        data: json.result as T,
        confidence,
        minerId,
        minerName,
        latencyMs,
        costUsd,
        txHash,
        signalHash,
        routedAt: typeof json.timestamp === "string" ? json.timestamp : nowIso(),
        reasoning: typeof json.reasoning === "string" ? json.reasoning : null,
        warnings: Array.isArray(json.warnings) ? json.warnings.map(String) : [],
      },
      { status: "ok", ...served, minerId, minerName, returnedConfidence: confidence } as Recorded,
    );
  }

  /** Free: look a paid call up by its signal hash (GET /engine/v1/signal/{hash}). */
  async getSignal(signalHash: string): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${this.nodeUrl}/engine/v1/signal/${encodeURIComponent(signalHash)}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  private async record(
    id: string,
    req: IntentRequest,
    opts: RequestOptions,
    rec: Recorded,
    latencyMs: number,
    requestPayload: unknown,
  ): Promise<void> {
    const db = await this.db;
    await db
      .insert(intentRequests)
      .values({
        id,
        verdictId: opts.verdictId ?? null,
        intent: req.intent,
        requestedConfidence: req.minConfidence,
        deadlineMs: req.deadlineMs,
        status: rec.status,
        minerId: rec.minerId,
        minerName: rec.minerName,
        returnedConfidence: rec.returnedConfidence,
        latencyMs,
        costUsd: rec.costUsd,
        settlementTxHash: rec.settlementTxHash,
        signalHash: rec.signalHash,
        requestPayload: JSON.stringify(requestPayload),
        responsePayload: JSON.stringify(rec.responsePayload ?? null),
        createdAt: nowIso(),
      });
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

const KEPT_HEADERS = ["payment-response", "x-payment-response", "content-type", "date", "cf-ray"];
function pickHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEPT_HEADERS) {
    const v = h.get(k);
    if (v) out[k] = v;
  }
  return out;
}

let defaultClient: TelegraphClient | undefined;
export function getTelegraphClient(): TelegraphClient {
  if (!defaultClient) defaultClient = new TelegraphClient();
  return defaultClient;
}

/** The single primary function of this package (spec section 4). */
export async function requestIntent<T = unknown>(req: IntentRequest, opts: RequestOptions = {}): Promise<IntentResult<T>> {
  return getTelegraphClient().requestIntent<T>(req, opts);
}
