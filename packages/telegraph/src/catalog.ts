import type { IntentCatalogEntry, MinerCatalogEntry } from "./types";
import type { FetchLike } from "./payment";

const CATALOG_TTL_MS = 5 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 10_000;

type Cached<T> = { at: number; value: T };

/**
 * Read-only discovery endpoints (no payment): GET /engine/v1/intents and GET /api/miners.
 * Cached for 5 minutes. Miner records are used only to (a) know whether an intent has live
 * miners and (b) read the serving miner's declared confidence field after a response.
 */
export class Catalog {
  private intents: Cached<IntentCatalogEntry[]> | null = null;
  private miners: Cached<MinerCatalogEntry[]> | null = null;

  constructor(
    private readonly nodeUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async listIntents(force = false): Promise<IntentCatalogEntry[]> {
    if (!force && this.intents && Date.now() - this.intents.at < CATALOG_TTL_MS) return this.intents.value;
    const body = await this.getJson<{ intents?: IntentCatalogEntry[] } | IntentCatalogEntry[]>("/engine/v1/intents");
    const list = Array.isArray(body) ? body : (body.intents ?? []);
    this.intents = { at: Date.now(), value: list };
    return list;
  }

  async listMiners(force = false): Promise<MinerCatalogEntry[]> {
    if (!force && this.miners && Date.now() - this.miners.at < CATALOG_TTL_MS) return this.miners.value;
    const body = await this.getJson<MinerCatalogEntry[] | { miners?: MinerCatalogEntry[] }>("/api/miners");
    const list = Array.isArray(body) ? body : (body.miners ?? []);
    this.miners = { at: Date.now(), value: list };
    return list;
  }

  /** Miner count for an intent; `null` when the intent is not canonical. */
  async minerCount(intent: string): Promise<number | null> {
    const list = await this.listIntents();
    const hit = list.find((i) => i.intent_id === intent || i.intent_name === intent);
    return hit ? hit.miner_count : null;
  }

  async findMiner(minerId: string): Promise<MinerCatalogEntry | null> {
    const list = await this.listMiners();
    return list.find((m) => String(m.id) === String(minerId)) ?? null;
  }

  private async getJson<T>(path: string): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CATALOG_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.nodeUrl}${path}`, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }
}

/** Read a dotted path ("a.b.c") out of an unknown JSON value. */
export function readPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Normalise a miner-reported confidence: only finite numbers in 0..1 count. */
export function normaliseConfidence(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return null;
}
