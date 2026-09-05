import { type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
export * from "./schema";
export { schema };
export type Db = BetterSQLite3Database<typeof schema>;
/**
 * Resolve DATABASE_URL to a SQLite file path.
 * Accepts "file:./relative.sqlite", "file:/abs/path.sqlite", a bare path, or ":memory:".
 * Relative paths resolve against the repository root (the directory containing pnpm-workspace.yaml).
 */
export declare function resolveDatabasePath(url?: string | undefined): string;
export declare function findRepoRoot(): string;
/** Open (or reuse) the process-wide database handle. Pending migrations are applied on first open. */
export declare function getDb(): Db;
/** Open a fresh handle at an explicit path (tests use ":memory:"). Migrations are applied. */
export declare function openDb(path: string): Db;
export declare function newId(): string;
export declare function nowIso(): string;
//# sourceMappingURL=index.d.ts.map