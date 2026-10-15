import path from 'node:path';
import type { AppDatabase } from '../store/Database';

/**
 * Recognized text of images for content search ("Make text in images searchable").
 * One row per image, keyed by path and valid only while the file still has the
 * recorded size and modification time; a changed file is recognized again.
 * Lives in the profile database next to the search index (`index_entries.content`
 * holds text files' contents; this table holds images' recognized text).
 *
 * The table is created here with IF NOT EXISTS rather than by a numbered migration,
 * so it does not move the schema version; turning the setting off empties it.
 */

/** Recognized text kept per image (characters); longer text is cut. */
export const OCR_TEXT_MAX = 64 * 1024;
/** Rows kept at most (oldest recognitions removed first). */
export const OCR_ROWS_MAX = 100_000;

export interface OcrTextRow {
  path: string;
  size: number;
  mtime_ms: number;
  /** 'ok' (text, possibly empty), 'skipped' (over the limits; reason in error), 'failed'. */
  status: 'ok' | 'skipped' | 'failed';
  text: string | null;
  confidence: number | null;
  langs: string;
  done_ms: number;
  error: string | null;
}

export class OcrTextStore {
  constructor(private readonly db: AppDatabase) {
    db.run(`CREATE TABLE IF NOT EXISTS ocr_text (
      path TEXT PRIMARY KEY, size REAL NOT NULL, mtime_ms REAL NOT NULL, status TEXT NOT NULL,
      text TEXT, confidence REAL, langs TEXT NOT NULL, done_ms INTEGER NOT NULL, error TEXT)`);
  }

  /** The stored row when it still describes the file (same size, same modification time, same languages). */
  fresh(p: string, size: number, mtimeMs: number, langs?: string): OcrTextRow | undefined {
    const r = this.db.get<OcrTextRow>('SELECT * FROM ocr_text WHERE path = ?', [p]);
    if (!r || r.size !== size || r.mtime_ms !== mtimeMs) return undefined;
    if (langs !== undefined && r.langs !== langs) return undefined;
    return r;
  }

  /** Recognized text for content search, only while it still describes the file. */
  textFor(p: string, size: number | undefined, mtimeMs: number | undefined): string | undefined {
    if (size === undefined || mtimeMs === undefined) return undefined;
    const r = this.db.get<{ text: string | null; size: number; mtime_ms: number; status: string }>("SELECT text, size, mtime_ms, status FROM ocr_text WHERE path = ? AND status = 'ok'", [p]);
    return r && r.size === size && r.mtime_ms === mtimeMs && r.text ? r.text : undefined;
  }

  put(rows: Array<Omit<OcrTextRow, 'done_ms'> & { done_ms?: number }>): void {
    if (!rows.length) return;
    this.db.tx(() => {
      for (const r of rows) {
        this.db.run(
          `INSERT INTO ocr_text(path, size, mtime_ms, status, text, confidence, langs, done_ms, error) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime_ms=excluded.mtime_ms, status=excluded.status, text=excluded.text,
             confidence=excluded.confidence, langs=excluded.langs, done_ms=excluded.done_ms, error=excluded.error`,
          [r.path, r.size, r.mtime_ms, r.status, r.text === null ? null : r.text.slice(0, OCR_TEXT_MAX), r.confidence, r.langs, r.done_ms ?? Date.now(), r.error],
        );
      }
    });
    const n = this.count('all');
    if (n > OCR_ROWS_MAX) this.db.run('DELETE FROM ocr_text WHERE path IN (SELECT path FROM ocr_text ORDER BY done_ms ASC LIMIT ?)', [n - OCR_ROWS_MAX]);
  }

  /** Paths stored below `folder` (to find files that were deleted). */
  pathsUnder(folder: string): string[] {
    const prefix = folder.endsWith(path.sep) ? folder : folder + path.sep;
    return this.db.all<{ path: string }>('SELECT path FROM ocr_text WHERE substr(path, 1, ?) = ?', [prefix.length, prefix]).map((r) => r.path);
  }

  remove(paths: string[]): void {
    if (!paths.length) return;
    this.db.tx(() => paths.forEach((p) => this.db.run('DELETE FROM ocr_text WHERE path = ?', [p])));
  }

  removeUnder(folder: string): void {
    const prefix = folder.endsWith(path.sep) ? folder : folder + path.sep;
    this.db.run('DELETE FROM ocr_text WHERE path = ? OR substr(path, 1, ?) = ?', [folder, prefix.length, prefix]);
  }

  clear(): void {
    this.db.run('DELETE FROM ocr_text');
  }

  /** Rows with text ('text'), or every row ('all'). */
  count(what: 'text' | 'all' = 'text'): number {
    return this.db.get<{ n: number }>(what === 'all' ? 'SELECT COUNT(*) AS n FROM ocr_text' : "SELECT COUNT(*) AS n FROM ocr_text WHERE status = 'ok' AND text IS NOT NULL AND text != ''")?.n ?? 0;
  }
}
