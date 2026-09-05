/**
 * Helpers for reading miner responses whose exact shape varies per miner.
 * Every adapter stores the raw response verbatim as evidence; these helpers only
 * locate the fields an adapter interprets. When nothing can be located, the adapter
 * reports the signal as unavailable rather than inventing a value.
 */

export type Json = unknown;

const MAX_DEPTH = 6;

/** Depth-first walk over object keys; `visit` returns true to stop. */
export function walk(value: Json, visit: (key: string, v: Json, path: string) => boolean | void, path = "", depth = 0): boolean {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 50); i++) {
      if (walk(value[i], visit, `${path}[${i}]`, depth + 1)) return true;
    }
    return false;
  }
  for (const [k, v] of Object.entries(value as Record<string, Json>)) {
    const p = path ? `${path}.${k}` : k;
    if (visit(k, v, p) === true) return true;
    if (walk(v, visit, p, depth + 1)) return true;
  }
  return false;
}

/** First numeric value (number or numeric string) whose key matches any pattern. */
export function findNumber(value: Json, patterns: RegExp[]): { value: number; path: string } | null {
  let found: { value: number; path: string } | null = null;
  walk(value, (k, v, p) => {
    if (!patterns.some((re) => re.test(k))) return;
    const n = toNumber(v);
    if (n !== null) {
      found = { value: n, path: p };
      return true;
    }
  });
  return found;
}

/** First string value whose key matches any pattern. */
export function findString(value: Json, patterns: RegExp[]): { value: string; path: string } | null {
  let found: { value: string; path: string } | null = null;
  walk(value, (k, v, p) => {
    if (typeof v === "string" && v.trim() && patterns.some((re) => re.test(k))) {
      found = { value: v, path: p };
      return true;
    }
  });
  return found;
}

/** First boolean (or "true"/"false" string) whose key matches any pattern. */
export function findBoolean(value: Json, patterns: RegExp[]): { value: boolean; path: string } | null {
  let found: { value: boolean; path: string } | null = null;
  walk(value, (k, v, p) => {
    if (!patterns.some((re) => re.test(k))) return;
    if (typeof v === "boolean") {
      found = { value: v, path: p };
      return true;
    }
    if (typeof v === "string" && /^(true|false)$/i.test(v.trim())) {
      found = { value: v.trim().toLowerCase() === "true", path: p };
      return true;
    }
  });
  return found;
}

/** All string leaves concatenated (capped), for keyword scans of free-text answers. */
export function collectText(value: Json, cap = 20_000): string {
  const parts: string[] = [];
  let total = 0;
  walk(value, (_k, v) => {
    if (typeof v === "string" && v.trim()) {
      parts.push(v);
      total += v.length;
      if (total > cap) return true;
    }
  });
  if (typeof value === "string") parts.push(value);
  return parts.join("\n").slice(0, cap);
}

export function toNumber(v: Json): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[,$_\s]/g, "");
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(cleaned)) return Number(cleaned);
  }
  return null;
}

/** Parse the first number that follows (or precedes) a keyword in free text, e.g. "3,412 holders". */
export function numberNearKeyword(text: string, keyword: RegExp): number | null {
  const num = "(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*([kKmMbB](?:illion|n)?)?";
  const after = new RegExp(`${keyword.source}[^\\d\\-]{0,40}${num}`, "i").exec(text);
  const before = new RegExp(`${num}\\s*[^\\d]{0,20}${keyword.source}`, "i").exec(text);
  const m = after ?? before;
  if (!m) return null;
  const rawIdx = after ? 1 : 1;
  const raw = m[rawIdx] ?? "";
  const unit = (m[rawIdx + 1] ?? "").toLowerCase();
  let n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (unit.startsWith("k")) n *= 1e3;
  else if (unit.startsWith("m")) n *= 1e6;
  else if (unit.startsWith("b")) n *= 1e9;
  return n;
}

/** Count keyword hits in text (case-insensitive), used for news/social flagging. */
export function keywordHits(text: string, keywords: string[]): { hits: number; matched: string[] } {
  const matched: string[] = [];
  const lower = text.toLowerCase();
  for (const k of keywords) {
    if (lower.includes(k.toLowerCase())) matched.push(k);
  }
  return { hits: matched.length, matched };
}

/** Clamp to 0..1. */
export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Map a 0..1-ish value that may be expressed as 0..100 or 0..10 into 0..1. */
export function normaliseRatio(n: number): number {
  if (n > 1 && n <= 100) return n / 100;
  if (n > 100) return 1;
  return clamp01(n);
}
