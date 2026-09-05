import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findRepoRoot, openDb, resolveDatabaseUrl } from "./index";

// Scripts read .env themselves; the library half of this package stays side-effect free.
const envPath = resolve(findRepoRoot(), ".env");
if (existsSync(envPath)) loadDotenv({ path: envPath, override: false });

/**
 * Deploy-time migration runner.
 *
 * Prefers DATABASE_MIGRATION_URL, falling back to DATABASE_URL. DDL and drizzle's advisory lock need a
 * session-mode connection, which Supabase's transaction pooler (port 6543) is not — so the app runs on
 * the pooler and migrations run on the direct (or session-pooler) string.
 */
const raw = process.env.DATABASE_MIGRATION_URL?.trim() || process.env.DATABASE_URL;
const url = resolveDatabaseUrl(raw);
const source = process.env.DATABASE_MIGRATION_URL?.trim() ? "DATABASE_MIGRATION_URL" : "DATABASE_URL";

if (url.includes(":6543") || url.includes("pgbouncer=true")) {
  console.warn(
    `warning: ${source} looks like a transaction pooler (port 6543). Migrations need session mode — ` +
      "use the direct connection (port 5432) or Supabase's session pooler if this fails.",
  );
}

await openDb(url, { migrate: true });
console.log(`migrations applied to ${url === ":memory:" ? "an ephemeral PGlite instance" : redact(url)} (from ${source})`);
process.exit(0);

function redact(u: string): string {
  return u.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
}
