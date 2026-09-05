import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

/**
 * Resolve DATABASE_URL to a SQLite file path.
 * Accepts "file:./relative.sqlite", "file:/abs/path.sqlite", a bare path, or ":memory:".
 * Relative paths resolve against the repository root (the directory containing pnpm-workspace.yaml).
 */
export function resolveDatabasePath(url: string | undefined = process.env.DATABASE_URL): string {
  const raw = (url && url.trim()) || "file:./data/zengawd.sqlite";
  if (raw.startsWith("postgres")) {
    throw new Error(
      "DATABASE_URL points at Postgres, but this build ships the SQLite Drizzle driver only (see DECISIONS.md).",
    );
  }
  const path = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  if (path === ":memory:") return path;
  return resolve(findRepoRoot(), path);
}

export function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

let singleton: Db | undefined;

/** Open (or reuse) the process-wide database handle. Pending migrations are applied on first open. */
export function getDb(): Db {
  if (singleton) return singleton;
  singleton = openDb(resolveDatabasePath());
  return singleton;
}

/** Open a fresh handle at an explicit path (tests use ":memory:"). Migrations are applied. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  if (path !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
