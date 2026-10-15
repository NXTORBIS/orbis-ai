import fsp from 'node:fs/promises';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { requireAbsolute } from '../fs/paths';
import { loadSqlJs } from '../store/Database';
import type { SqliteTable, SqliteQueryResult, SqliteSchemaResult, SqliteColumn } from '../../shared/sqlite';
import type { Database as SqlDb, SqlJsStatic } from 'sql.js';

/**
 * SQLite database viewer: opens user .db / .sqlite / .sqlite3 files read-only
 * using the same sql.js WASM the app already loads for its own catalogue.
 *
 * Databases are cached in memory for 60 seconds so successive queries on the
 * same file do not re-read it from disk. The cache holds at most 4 databases.
 */

const MAX_FILE_BYTES = 512 * 1024 * 1024; // 512 MB
const CACHE_TTL_MS = 60_000;
const MAX_CACHED = 4;

interface CachedDb {
  db: SqlDb;
  path: string;
  timer: NodeJS.Timeout;
}

const cache = new Map<string, CachedDb>();

function evict(key: string): void {
  const entry = cache.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    entry.db.close();
    cache.delete(key);
  }
}

async function openDb(filePath: string, wasmDir: string): Promise<SqlDb> {
  const abs = requireAbsolute(filePath, 'sqlite:open');

  // Return cached if available, refreshing TTL.
  const cached = cache.get(abs);
  if (cached) {
    clearTimeout(cached.timer);
    cached.timer = setTimeout(() => evict(abs), CACHE_TTL_MS);
    return cached.db;
  }

  const stat = await fsp.stat(abs).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'sqlite:open', abs, 'no'));
  });
  if (!stat.isFile()) throw makeError('validation', 'sqlite:open', { target: abs, message: 'Not a file.' });
  if (stat.size > MAX_FILE_BYTES) throw makeError('validation', 'sqlite:open', { target: abs, message: `The file is too large (${Math.round(stat.size / 1024 / 1024)} MB). The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.` });

  const buf = await fsp.readFile(abs);
  // Validate SQLite header magic.
  if (buf.length < 16 || buf.subarray(0, 6).toString('ascii') !== 'SQLite') {
    throw makeError('validation', 'sqlite:open', { target: abs, message: 'This file does not appear to be a valid SQLite database.' });
  }

  const SQL: SqlJsStatic = await loadSqlJs(wasmDir);
  const db = new SQL.Database(buf);

  // Evict oldest if cache is full.
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) evict(oldest);
  }

  const timer = setTimeout(() => evict(abs), CACHE_TTL_MS);
  cache.set(abs, { db, path: abs, timer });
  return db;
}

type Channels = 'sqlite:open' | 'sqlite:tables' | 'sqlite:query' | 'sqlite:schema';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export function sqliteHandlers(): Handlers {
  // sql.js is already initialised by the app DB (Database.ts); loadSqlJs('')
  // returns the cached promise regardless of the wasmDir argument.
  const wasmDir = '';
  return {
    'sqlite:open': async (p) => {
      const db = await openDb(p.path, wasmDir);
      return listTables(db);
    },

    'sqlite:tables': async (p) => {
      const db = await openDb(p.path, wasmDir);
      return listTables(db);
    },

    'sqlite:query': async (p) => {
      const db = await openDb(p.path, wasmDir);
      const params = (p.params ?? []) as (string | number | null | Uint8Array)[];
      const t0 = performance.now();
      try {
        const stmt = db.prepare(p.sql);
        if (params.length) stmt.bind(params);
        const columns: SqliteColumn[] = [];
        const colNames = stmt.getColumnNames();
        for (const cn of colNames) columns.push({ name: cn, type: '' });
        const rows: unknown[][] = [];
        while (stmt.step()) {
          rows.push(stmt.get());
        }
        stmt.free();
        const elapsed = performance.now() - t0;
        const result: SqliteQueryResult = { columns, rows, rowCount: rows.length, totalRows: -1, elapsedMs: Math.round(elapsed * 100) / 100 };
        return result;
      } catch (err: unknown) {
        throw makeError('validation', 'sqlite:query', { message: err instanceof Error ? err.message : String(err) });
      }
    },

    'sqlite:schema': async (p) => {
      const db = await openDb(p.path, wasmDir);
      const abs = requireAbsolute(p.path, 'sqlite:schema');
      try {
        // Get CREATE TABLE DDL
        const ddlStmt = db.prepare("SELECT sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')");
        ddlStmt.bind([p.table]);
        let ddl = '';
        if (ddlStmt.step()) {
          const row = ddlStmt.get();
          ddl = String(row[0] ?? '');
        }
        ddlStmt.free();

        // Get column info
        const infoStmt = db.prepare(`PRAGMA table_info("${p.table.replace(/"/g, '""')}")`);
        const columns: SqliteSchemaResult['columns'] = [];
        while (infoStmt.step()) {
          const row = infoStmt.get();
          columns.push({
            cid: Number(row[0]),
            name: String(row[1]),
            type: String(row[2]),
            notnull: row[3] === 1,
            dfltValue: row[4],
            pk: row[5] === 1,
          });
        }
        infoStmt.free();

        const result: SqliteSchemaResult = { ddl: ddl || `-- No DDL found for ${p.table}`, columns };
        void abs; // used for requireAbsolute side effect
        return result;
      } catch (err: unknown) {
        throw makeError('validation', 'sqlite:schema', { message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

function listTables(db: SqlDb): SqliteTable[] {
  const tables: SqliteTable[] = [];
  const stmt = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name");
  while (stmt.step()) {
    const row = stmt.get();
    const name = String(row[0]);
    const type = String(row[1]) as 'table' | 'view';
    let rowCount = 0;
    try {
      const countStmt = db.prepare(`SELECT COUNT(*) FROM "${name.replace(/"/g, '""')}"`);
      if (countStmt.step()) rowCount = Number(countStmt.get()[0]);
      countStmt.free();
    } catch { /* views or virtual tables may fail */ }
    tables.push({ name, rowCount, type });
  }
  stmt.free();
  return tables;
}
