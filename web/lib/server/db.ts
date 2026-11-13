// SQLite access for the live pipeline. Server-only (node:sqlite).
// Analysis reads go through a read-only connection; the per-URL result cache
// (store_runs) is the only thing written, through its own connection.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = path.join(process.cwd(), "..", "data", "pets.db");

let ro: DatabaseSync | null = null;
let rw: DatabaseSync | null = null;

/** Read-only connection for all analysis queries. */
export function db(): DatabaseSync {
  return (ro ??= new DatabaseSync(DB_PATH, { readOnly: true, timeout: 5000 }));
}

/** Writable connection, used only for the store_runs cache. */
function cacheDb(): DatabaseSync {
  if (!rw) {
    rw = new DatabaseSync(DB_PATH, { timeout: 5000 });
    rw.exec(`CREATE TABLE IF NOT EXISTS store_runs (
      url TEXT PRIMARY KEY, result_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  }
  return rw;
}

export function readCachedRun(url: string): string | null {
  const row = cacheDb().prepare("SELECT result_json FROM store_runs WHERE url = ?").get(url) as
    | { result_json: string }
    | undefined;
  return row?.result_json ?? null;
}

export function writeCachedRun(url: string, json: string): void {
  cacheDb()
    .prepare("INSERT OR REPLACE INTO store_runs (url, result_json, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
    .run(url, json);
}
