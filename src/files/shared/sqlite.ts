import { z } from 'zod';

/**
 * SQLite database viewer: shared types and schemas for the IPC boundary.
 * Databases are opened read-only via sql.js (the same WASM the app uses
 * internally). The file is read into memory; changes from user queries
 * stay in memory and are never written back.
 */

export const SqliteTableSchema = z.object({
  name: z.string(),
  rowCount: z.number().int().nonnegative(),
  type: z.enum(['table', 'view']),
});
export type SqliteTable = z.infer<typeof SqliteTableSchema>;

export interface SqliteColumn {
  name: string;
  type: string;
}

export interface SqliteQueryResult {
  columns: SqliteColumn[];
  rows: unknown[][];
  rowCount: number;
  /** Total rows matched (before LIMIT) if known; -1 if unknown. */
  totalRows: number;
  elapsedMs: number;
}

export interface SqliteSchemaResult {
  ddl: string;
  columns: Array<{ cid: number; name: string; type: string; notnull: boolean; dfltValue: unknown; pk: boolean }>;
}

/** File extensions treated as SQLite databases. */
export const SQLITE_EXTS = new Set(['db', 'sqlite', 'sqlite3']);
