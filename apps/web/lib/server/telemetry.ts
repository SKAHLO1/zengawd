import { desc, sql } from "drizzle-orm";
import { calibrationRuns, getDb, intentRequests } from "@zengawd/db";

export type IntentStats = {
  intent: string;
  total: number;
  ok: number;
  availability: number;
  p50: number | null;
  p95: number | null;
  miners: { minerId: string; minerName: string | null; count: number; p50: number | null; avgCostUsd: number | null }[];
};

export type CalibrationPoint = {
  intent: string;
  confidence: number;
  runs: number;
  ok: number;
  availability: number;
  miners: string[];
  avgLatencyMs: number | null;
  avgCostUsd: number | null;
};

export type TailRow = {
  id: string;
  createdAt: string;
  intent: string;
  requestedConfidence: number;
  status: string;
  minerId: string | null;
  minerName: string | null;
  latencyMs: number;
  costUsd: number | null;
  settlementTxHash: string | null;
  verdictId: string | null;
};

export type TelemetrySnapshot = {
  generatedAt: string;
  totals: { requests: number; ok: number; distinctMiners: number; totalCostUsd: number; settled: number };
  intents: IntentStats[];
  calibration: CalibrationPoint[];
  tail: TailRow[];
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export function readTail(limit = 100): TailRow[] {
  const db = getDb();
  return db
    .select({
      id: intentRequests.id,
      createdAt: intentRequests.createdAt,
      intent: intentRequests.intent,
      requestedConfidence: intentRequests.requestedConfidence,
      status: intentRequests.status,
      minerId: intentRequests.minerId,
      minerName: intentRequests.minerName,
      latencyMs: intentRequests.latencyMs,
      costUsd: intentRequests.costUsd,
      settlementTxHash: intentRequests.settlementTxHash,
      verdictId: intentRequests.verdictId,
    })
    .from(intentRequests)
    .orderBy(desc(intentRequests.createdAt))
    .limit(limit)
    .all();
}

export function readTelemetry(): TelemetrySnapshot {
  const db = getDb();
  const rows = db
    .select({
      intent: intentRequests.intent,
      status: intentRequests.status,
      minerId: intentRequests.minerId,
      minerName: intentRequests.minerName,
      latencyMs: intentRequests.latencyMs,
      costUsd: intentRequests.costUsd,
      tx: intentRequests.settlementTxHash,
    })
    .from(intentRequests)
    .all();

  const byIntent = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byIntent.get(r.intent) ?? [];
    list.push(r);
    byIntent.set(r.intent, list);
  }

  const intents: IntentStats[] = [...byIntent.entries()]
    .map(([intent, list]) => {
      const ok = list.filter((r) => r.status === "ok");
      const lat = list.map((r) => r.latencyMs).sort((a, b) => a - b);
      const minerMap = new Map<string, { minerName: string | null; lat: number[]; cost: number[] }>();
      for (const r of list) {
        if (!r.minerId) continue;
        const m = minerMap.get(r.minerId) ?? { minerName: r.minerName, lat: [], cost: [] };
        m.lat.push(r.latencyMs);
        if (typeof r.costUsd === "number") m.cost.push(r.costUsd);
        minerMap.set(r.minerId, m);
      }
      const miners = [...minerMap.entries()]
        .map(([minerId, m]) => ({
          minerId,
          minerName: m.minerName,
          count: m.lat.length,
          p50: percentile([...m.lat].sort((a, b) => a - b), 50),
          avgCostUsd: m.cost.length ? round4(m.cost.reduce((a, b) => a + b, 0) / m.cost.length) : null,
        }))
        .sort((a, b) => b.count - a.count);
      return {
        intent,
        total: list.length,
        ok: ok.length,
        availability: list.length ? round4(ok.length / list.length) : 0,
        p50: percentile(lat, 50),
        p95: percentile(lat, 95),
        miners,
      };
    })
    .sort((a, b) => b.total - a.total);

  const cal = db
    .select({
      intent: calibrationRuns.intent,
      confidence: calibrationRuns.confidence,
      minerId: calibrationRuns.minerId,
      status: calibrationRuns.status,
      latencyMs: calibrationRuns.latencyMs,
      costUsd: calibrationRuns.costUsd,
    })
    .from(calibrationRuns)
    .all();
  const calMap = new Map<string, CalibrationPoint & { lat: number[]; cost: number[]; minerSet: Set<string> }>();
  for (const r of cal) {
    const key = `${r.intent}|${r.confidence}`;
    const p = calMap.get(key) ?? { intent: r.intent, confidence: r.confidence, runs: 0, ok: 0, availability: 0, miners: [], avgLatencyMs: null, avgCostUsd: null, lat: [], cost: [], minerSet: new Set<string>() };
    p.runs++;
    if (r.status === "ok") p.ok++;
    if (r.minerId) p.minerSet.add(r.minerId);
    p.lat.push(r.latencyMs);
    if (typeof r.costUsd === "number") p.cost.push(r.costUsd);
    calMap.set(key, p);
  }
  const calibration: CalibrationPoint[] = [...calMap.values()]
    .map((p) => ({
      intent: p.intent,
      confidence: p.confidence,
      runs: p.runs,
      ok: p.ok,
      availability: p.runs ? round4(p.ok / p.runs) : 0,
      miners: [...p.minerSet].sort(),
      avgLatencyMs: p.lat.length ? Math.round(p.lat.reduce((a, b) => a + b, 0) / p.lat.length) : null,
      avgCostUsd: p.cost.length ? round4(p.cost.reduce((a, b) => a + b, 0) / p.cost.length) : null,
    }))
    .sort((a, b) => a.intent.localeCompare(b.intent) || a.confidence - b.confidence);

  const distinct = new Set(rows.filter((r) => r.minerId).map((r) => r.minerId as string));
  const totalCost = rows.reduce((a, r) => a + (typeof r.costUsd === "number" ? r.costUsd : 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      requests: rows.length,
      ok: rows.filter((r) => r.status === "ok").length,
      distinctMiners: distinct.size,
      totalCostUsd: round4(totalCost),
      settled: rows.filter((r) => r.tx).length,
    },
    intents,
    calibration,
    tail: readTail(100),
  };
}

export function countRows(): number {
  const db = getDb();
  const r = db.select({ c: sql<number>`count(*)` }).from(intentRequests).get();
  return r?.c ?? 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
