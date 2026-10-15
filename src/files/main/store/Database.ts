import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import initSqlJs, { type Database as SqlDb, type SqlJsStatic, type SqlValue } from 'sql.js';
import type { StartupNotice } from '../../shared/model';
import { MIGRATIONS } from './migrations';

/**
 * Local application database (SQLite compiled to WASM via sql.js).
 *
 * Durability model:
 *  - The DB lives in memory and is written to disk with write-tmp → fsync → rename,
 *    so an interrupted write never leaves a half-written database.
 *  - The previous good file is kept as `<db>.bak` and used if the main file is unreadable.
 *  - An unreadable file is quarantined (renamed, never deleted) and reported at startup.
 *  - Before migrating, the current file is copied to `<db>.pre-v<N>.bak`; a failed
 *    migration rolls back and the on-disk file is left untouched.
 */

let sqlPromise: Promise<SqlJsStatic> | undefined;

export function loadSqlJs(wasmDir: string): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: (f: string) => path.join(wasmDir, f) });
  return sqlPromise;
}

export type Row = Record<string, SqlValue>;

export class AppDatabase {
  private db: SqlDb;
  private dirty = false;
  private saveTimer: NodeJS.Timeout | undefined;
  private saving: Promise<void> | undefined;
  readonly notices: StartupNotice[] = [];
  /** When true, writes are kept in memory only (used after an unrecoverable migration failure). */
  readonly ephemeral: boolean;

  private constructor(private readonly SQL: SqlJsStatic, db: SqlDb, readonly filePath: string, ephemeral: boolean) {
    this.db = db;
    this.ephemeral = ephemeral;
  }

  static async open(filePath: string, wasmDir: string): Promise<AppDatabase> {
    const SQL = await loadSqlJs(wasmDir);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const notices: StartupNotice[] = [];
    let db: SqlDb | undefined;
    let loadedFrom: string | undefined;

    for (const candidate of [filePath, `${filePath}.bak`]) {
      let bytes: Buffer;
      try {
        bytes = await fsp.readFile(candidate);
      } catch {
        continue;
      }
      try {
        const d = new SQL.Database(bytes);
        d.exec('PRAGMA integrity_check'); // throws on a malformed image
        const check = d.exec('PRAGMA quick_check')[0]?.values[0]?.[0];
        if (check !== 'ok') throw new Error(`quick_check: ${String(check)}`);
        db = d;
        loadedFrom = candidate;
        break;
      } catch (err) {
        const quarantine = `${candidate}.corrupt-${Date.now()}`;
        await fsp.rename(candidate, quarantine).catch(() => undefined);
        notices.push({
          level: 'warning',
          message: candidate === filePath ? 'The Orbis Files database could not be read and was set aside.' : 'The database backup could not be read and was set aside.',
          detail: `Moved to ${quarantine}. Reason: ${(err as Error).message}`,
        });
      }
    }
    if (loadedFrom && loadedFrom !== filePath) {
      notices.push({ level: 'warning', message: 'Restored application data from the last good backup.', detail: loadedFrom });
    }
    const isNew = !db;
    db ??= new SQL.Database();
    db.exec('PRAGMA foreign_keys = ON');

    const instance = new AppDatabase(SQL, db, filePath, false);
    instance.notices.push(...notices);
    try {
      await instance.migrate(isNew);
    } catch (err) {
      instance.notices.push({
        level: 'error',
        message: 'Application data could not be upgraded. Your existing data was not changed; this session runs without saving preferences.',
        detail: (err as Error).message,
      });
      const temp = new AppDatabase(SQL, new SQL.Database(), filePath, true);
      temp.notices.push(...instance.notices);
      await temp.migrate(true);
      return temp;
    }
    if (isNew || instance.dirty) await instance.flush();
    return instance;
  }

  get schemaVersion(): number {
    const v = this.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
    return v ? Number(v.value) : 0;
  }

  private async migrate(isNew: boolean): Promise<void> {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const current = this.schemaVersion;
    const latest = MIGRATIONS[MIGRATIONS.length - 1]!.version;
    if (current > latest) {
      throw new Error(`Database schema v${current} is newer than this version of Orbis Files supports (v${latest}).`);
    }
    const pending = MIGRATIONS.filter((m) => m.version > current);
    if (!pending.length) return;
    if (!isNew && fs.existsSync(this.filePath)) {
      await fsp.copyFile(this.filePath, `${this.filePath}.pre-v${pending[pending.length - 1]!.version}.bak`);
    }
    for (const m of pending) {
      this.db.exec('BEGIN');
      try {
        m.up(this.db);
        this.db.run("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(m.version)]);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw new Error(`Migration to v${m.version} failed: ${(err as Error).message}`);
      }
    }
    this.dirty = true;
  }

  run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params);
    this.markDirty();
  }

  all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get<T = Row>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  /** Run fn inside a transaction; rolls back on throw. */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      this.markDirty();
      return r;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  changes(): number {
    return this.db.getRowsModified();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.ephemeral) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 400);
  }

  /** Persist to disk atomically. Concurrent calls are serialised. */
  async flush(): Promise<void> {
    if (this.ephemeral) return;
    clearTimeout(this.saveTimer);
    if (this.saving) await this.saving;
    if (!this.dirty) return;
    this.dirty = false;
    const data = this.db.export();
    // export() resets PRAGMAs on the connection in sql.js; restore them.
    this.db.exec('PRAGMA foreign_keys = ON');
    this.saving = writeAtomic(this.filePath, data).finally(() => {
      this.saving = undefined;
    });
    try {
      await this.saving;
    } catch (err) {
      this.dirty = true;
      throw err;
    }
  }

  /** Synchronous flush for process shutdown paths. */
  flushSync(): void {
    if (this.ephemeral || !this.dirty) return;
    clearTimeout(this.saveTimer);
    const data = this.db.export();
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, `${this.filePath}.bak`);
    fs.renameSync(tmp, this.filePath);
    this.dirty = false;
  }

  /** Export a consistent copy of the database to a file (for backups). */
  async exportTo(dest: string): Promise<void> {
    await writeAtomic(dest, this.db.export(), false);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  close(): void {
    clearTimeout(this.saveTimer);
    this.db.close();
  }

  /** Validate that bytes are a readable Orbis Files database (used by restore). */
  validateImage(bytes: Uint8Array): { ok: boolean; version?: number; reason?: string } {
    try {
      const d = new this.SQL.Database(bytes);
      const v = d.exec("SELECT value FROM meta WHERE key='schema_version'")[0]?.values[0]?.[0];
      d.close();
      if (v === undefined) return { ok: false, reason: 'Not an Orbis Files database (no schema version).' };
      return { ok: true, version: Number(v) };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}

async function writeAtomic(target: string, data: Uint8Array, keepBackup = true): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.write(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  if (keepBackup) {
    try {
      await fsp.copyFile(target, `${target}.bak`);
    } catch {
      /* first save: no previous file */
    }
  }
  await fsp.rename(tmp, target);
}
