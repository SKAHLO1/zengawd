import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

export * from "./schema";
export { schema };

/**
 * Query operators are re-exported so that @zengawd/db is the only package depending on drizzle-orm.
 * When several packages depend on it directly, pnpm resolves a separate instance per peer set and the
 * two copies' types stop being assignable to each other.
 */
export { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

/**
 * Both drivers speak the same Postgres dialect and expose the same query builder, so call sites are
 * driver-agnostic: postgres.js against a real server, PGlite (in-process Postgres) for tests.
 * Typed as the postgres.js flavour because the shared `PgDatabase` supertype erases select() result
 * types; the PGlite handle is structurally identical for everything used here.
 */
export type Db = PostgresJsDatabase<typeof schema>;

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

/**
 * Resolve DATABASE_URL to a Postgres connection string, or ":memory:" for an in-process PGlite instance.
 * A `file:` URL is rejected outright: the SQLite build is gone (see DECISIONS.md 3).
 */
export function resolveDatabaseUrl(url: string | undefined = process.env.DATABASE_URL): string {
  const raw = url?.trim() || "";
  if (!raw || raw === ":memory:") return ":memory:";
  if (raw.startsWith("file:") || raw.endsWith(".sqlite")) {
    throw new Error(
      `DATABASE_URL "${raw}" points at a SQLite file, but this build ships the Postgres Drizzle driver only. ` +
        "Use a postgres:// connection string (see DECISIONS.md 3).",
    );
  }
  if (!raw.startsWith("postgres://") && !raw.startsWith("postgresql://")) {
    throw new Error(`DATABASE_URL "${raw}" is not a postgres:// connection string.`);
  }
  return raw;
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

let singleton: Promise<Db> | undefined;

/**
 * Open (or reuse) the process-wide database handle.
 *
 * Against a real Postgres, migrations are NOT applied here: on serverless the migrations folder is not
 * traced into the function bundle, and concurrent cold starts would race. Run `pnpm db:migrate` as a
 * deploy step instead. An in-process PGlite database is created empty every time, so it migrates itself.
 */
export function getDb(): Promise<Db> {
  if (!singleton) singleton = openDb(resolveDatabaseUrl());
  return singleton;
}

/**
 * Open a fresh handle. `":memory:"` gives an in-process PGlite database (tests); anything else is
 * treated as a Postgres connection string.
 *
 * Pooled connection strings (Supabase's port 6543, pgbouncer in transaction mode) cannot hold prepared
 * statements, so prepared statements are disabled whenever the URL looks pooled.
 */
export async function openDb(url: string, opts: { migrate?: boolean } = {}): Promise<Db> {
  const runMigrations = opts.migrate ?? url === ":memory:";

  if (url === ":memory:") {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    if (runMigrations) await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
    return db as unknown as Db;
  }

  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !isPooledUrl(url),
  });
  const db = drizzlePg(client, { schema });
  if (runMigrations) await migratePg(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}

/** Supabase's transaction-mode pooler listens on 6543 and cannot hold prepared statements. */
export function isPooledUrl(url: string): boolean {
  return url.includes(":6543") || url.includes("pgbouncer=true") || url.includes("pooler.supabase.com");
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
