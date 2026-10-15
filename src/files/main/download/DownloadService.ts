import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { ThrottleTransform } from './throttle';
import {
  type DownloadRecord,
  type DownloadState,
  type DownloadProgressEvent,
  type DownloadStateEvent,
  type DownloadSettings,
  type DownloadOptions,
  type ChecksumAlgorithm,
  TERMINAL_DOWNLOAD_STATES,
  MAX_RETRIES,
  PROGRESS_INTERVAL_MS,
  SPEED_WINDOW_MS,
  parseContentDisposition,
  filenameFromUrl,
} from '../../shared/downloads';
import type { AppDatabase } from '../store/Database';
import { detectFormat } from '../tools/archives';
import { fullExtract } from '../tools/archiveEdit';

interface ActiveDownload {
  record: DownloadRecord;
  /** Abort controller for the HTTP request. */
  ac: AbortController;
  /** The throttle transform (to change speed limit at runtime). */
  throttle: ThrottleTransform;
  /** Rolling speed samples: [timestampMs, bytesAtThatTime]. */
  speedSamples: Array<[number, number]>;
  /** Timer for progress events. */
  progressTimer: NodeJS.Timeout | null;
}

export interface DownloadServiceOptions {
  db: AppDatabase;
  defaultDir: string;
  onProgress: (event: DownloadProgressEvent) => void;
  onStateChange: (event: DownloadStateEvent) => void;
}

export class DownloadService extends EventEmitter {
  private readonly db: AppDatabase;
  private readonly active = new Map<string, ActiveDownload>();
  private settings: DownloadSettings;
  onProgress: (event: DownloadProgressEvent) => void;
  onStateChange: (event: DownloadStateEvent) => void;

  constructor(opts: DownloadServiceOptions) {
    super();
    this.db = opts.db;
    this.onProgress = opts.onProgress;
    this.onStateChange = opts.onStateChange;
    this.settings = {
      maxConcurrent: 3,
      defaultDir: opts.defaultDir,
      speedLimitKBs: 0,
      autoExtract: false,
    };
    // Load saved settings
    const saved = this.db.get<{ value: string }>("SELECT value FROM kv WHERE key = 'download_settings'");
    if (saved) {
      try {
        Object.assign(this.settings, JSON.parse(saved.value));
      } catch { /* use defaults */ }
    }
    // Recover downloads that were 'downloading' when the app closed.
    this.recoverInterrupted();
  }

  private recoverInterrupted(): void {
    const rows = this.db.all<{ id: string }>("SELECT id FROM download_queue WHERE state IN ('downloading', 'queued', 'verifying', 'extracting')");
    for (const row of rows) {
      this.db.run("UPDATE download_queue SET state = 'queued' WHERE id = ?", [row.id]);
    }
    // Attempt to start queued downloads.
    this.processQueue();
  }

  getSettings(): DownloadSettings {
    return { ...this.settings };
  }

  updateSettings(update: Partial<DownloadSettings>): DownloadSettings {
    Object.assign(this.settings, update);
    this.db.run("INSERT INTO kv(key, value) VALUES('download_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(this.settings)]);
    // Apply speed limit changes to active downloads.
    if (update.speedLimitKBs !== undefined) {
      for (const ad of this.active.values()) {
        if (ad.record.speedLimitKBs === 0) {
          ad.throttle.setLimit(this.settings.speedLimitKBs * 1024);
        }
      }
    }
    // Concurrency change may start more downloads.
    this.processQueue();
    return this.getSettings();
  }

  async start(url: string, destination: string, options?: DownloadOptions): Promise<DownloadRecord> {
    const id = crypto.randomUUID();
    const now = Date.now();

    // Determine filename: user override > later detection from headers
    const filename = options?.filename ?? filenameFromUrl(url) ?? `download-${id.slice(0, 8)}`;
    const filePath = path.join(destination, filename);

    const record: DownloadRecord = {
      id,
      url,
      filePath,
      destination,
      filename,
      state: 'queued',
      mimeType: null,
      totalBytes: null,
      bytesDownloaded: 0,
      resumable: false,
      retries: 0,
      error: null,
      priority: options?.priority ?? 100,
      checksumAlgorithm: options?.checksum?.algorithm ?? null,
      checksumExpected: options?.checksum?.expected ?? null,
      checksumResult: null,
      checksumActual: null,
      autoExtract: options?.autoExtract ?? this.settings.autoExtract,
      extractedTo: null,
      speedLimitKBs: options?.speedLimitKBs ?? 0,
      createdMs: now,
      startedMs: null,
      finishedMs: null,
    };

    this.saveRecord(record);
    this.processQueue();
    return record;
  }

  pause(id: string): DownloadRecord | null {
    const ad = this.active.get(id);
    if (!ad) {
      // May be queued
      const rec = this.loadRecord(id);
      if (rec && rec.state === 'queued') {
        rec.state = 'paused';
        this.saveRecord(rec);
        this.emitState(rec);
        return rec;
      }
      return null;
    }
    ad.ac.abort();
    ad.record.state = 'paused';
    this.saveRecord(ad.record);
    this.cleanupActive(id);
    this.emitState(ad.record);
    this.processQueue();
    return ad.record;
  }

  resume(id: string): DownloadRecord | null {
    const rec = this.loadRecord(id);
    if (!rec || (rec.state !== 'paused' && rec.state !== 'failed')) return null;
    rec.state = 'queued';
    rec.error = null;
    this.saveRecord(rec);
    this.emitState(rec);
    this.processQueue();
    return rec;
  }

  cancel(id: string): DownloadRecord | null {
    const ad = this.active.get(id);
    if (ad) {
      ad.ac.abort();
      ad.record.state = 'cancelled';
      ad.record.finishedMs = Date.now();
      this.saveRecord(ad.record);
      this.cleanupActive(id);
      this.emitState(ad.record);
      this.processQueue();
      return ad.record;
    }
    const rec = this.loadRecord(id);
    if (!rec || TERMINAL_DOWNLOAD_STATES.has(rec.state)) return null;
    rec.state = 'cancelled';
    rec.finishedMs = Date.now();
    this.saveRecord(rec);
    this.emitState(rec);
    return rec;
  }

  retry(id: string): DownloadRecord | null {
    const rec = this.loadRecord(id);
    if (!rec || (rec.state !== 'failed' && rec.state !== 'cancelled')) return null;
    rec.state = 'queued';
    rec.error = null;
    rec.retries = 0;
    rec.checksumResult = null;
    rec.checksumActual = null;
    // If the file exists partially and is resumable, keep bytesDownloaded.
    if (!rec.resumable) rec.bytesDownloaded = 0;
    this.saveRecord(rec);
    this.emitState(rec);
    this.processQueue();
    return rec;
  }

  remove(id: string): boolean {
    const ad = this.active.get(id);
    if (ad) {
      ad.ac.abort();
      this.cleanupActive(id);
    }
    this.db.run('DELETE FROM download_queue WHERE id = ?', [id]);
    return this.db.changes() > 0;
  }

  list(filter?: 'all' | 'active' | 'completed' | 'failed'): DownloadRecord[] {
    let sql = 'SELECT * FROM download_queue';
    const params: string[] = [];
    switch (filter) {
      case 'active':
        sql += " WHERE state IN ('queued', 'downloading', 'paused', 'verifying', 'extracting')";
        break;
      case 'completed':
        sql += " WHERE state = 'completed'";
        break;
      case 'failed':
        sql += " WHERE state = 'failed'";
        break;
    }
    sql += ' ORDER BY created_ms DESC';
    return this.db.all<Record<string, unknown>>(sql, params).map(rowToRecord);
  }

  clearHistory(): number {
    this.db.run("DELETE FROM download_queue WHERE state IN ('completed', 'failed', 'cancelled')");
    return this.db.changes();
  }

  /** Shut down: cancel active downloads gracefully. */
  shutdown(): void {
    for (const [id, ad] of this.active) {
      ad.ac.abort();
      ad.record.state = 'queued'; // Will be resumed on next start.
      this.saveRecord(ad.record);
      this.cleanupActive(id);
    }
  }

  // ─── internal ──────────────────────────────────────────────────

  private processQueue(): void {
    if (this.active.size >= this.settings.maxConcurrent) return;
    const queued = this.db.all<Record<string, unknown>>(
      "SELECT * FROM download_queue WHERE state = 'queued' ORDER BY priority ASC, created_ms ASC LIMIT ?",
      [this.settings.maxConcurrent - this.active.size],
    ).map(rowToRecord);
    for (const rec of queued) {
      if (this.active.size >= this.settings.maxConcurrent) break;
      void this.runDownload(rec);
    }
  }

  private async runDownload(record: DownloadRecord): Promise<void> {
    const ac = new AbortController();
    const speedLimit = record.speedLimitKBs > 0 ? record.speedLimitKBs * 1024 : this.settings.speedLimitKBs * 1024;
    const throttle = new ThrottleTransform(speedLimit);
    const ad: ActiveDownload = {
      record,
      ac,
      throttle,
      speedSamples: [[Date.now(), record.bytesDownloaded]],
      progressTimer: null,
    };
    this.active.set(record.id, ad);

    record.state = 'downloading';
    record.startedMs = record.startedMs ?? Date.now();
    this.saveRecord(record);
    this.emitState(record);

    // Start progress timer.
    ad.progressTimer = setInterval(() => this.emitProgress(ad), PROGRESS_INTERVAL_MS);

    try {
      await this.doHttpDownload(ad);
      if (ad.record.state !== 'downloading') return; // cancelled/paused

      ad.record.state = 'completed';
      ad.record.finishedMs = Date.now();

      // Checksum verification
      if (ad.record.checksumExpected && ad.record.checksumAlgorithm) {
        ad.record.state = 'verifying';
        this.saveRecord(ad.record);
        this.emitState(ad.record);
        await this.verifyChecksum(ad.record);
      }

      // Auto-extract
      if (ad.record.autoExtract && ad.record.checksumResult !== 'mismatch') {
        ad.record.state = 'extracting';
        this.saveRecord(ad.record);
        this.emitState(ad.record);
        try {
          const format = await detectFormat(ad.record.filePath);
          if (format !== 'unknown') {
            const baseName = path.basename(ad.record.filePath).replace(/\.[^.]+$/, '');
            const extractDir = path.join(ad.record.destination, baseName);
            await fsp.mkdir(extractDir, { recursive: true });
            await fullExtract(ad.record.filePath, extractDir, format);
            ad.record.extractedTo = extractDir;
          }
        } catch (extractErr) {
          // Extraction is best-effort; not all files are archives.
          // On failure, revert to completed state and report the error.
          ad.record.extractedTo = null;
          ad.record.state = 'completed';
          ad.record.error = `Extraction failed: ${(extractErr as Error).message}`;
          this.saveRecord(ad.record);
          this.emitState(ad.record);
        }
      }

      if (ad.record.state === 'verifying' || ad.record.state === 'extracting') {
        ad.record.state = ad.record.checksumResult === 'mismatch' ? 'failed' : 'completed';
      }
      ad.record.finishedMs = Date.now();
      this.saveRecord(ad.record);
      this.emitState(ad.record);
    } catch (err) {
      if (ac.signal.aborted) return; // Intentional abort (pause/cancel).
      ad.record.error = (err as Error).message ?? String(err);
      if (ad.record.retries < MAX_RETRIES) {
        ad.record.retries++;
        ad.record.state = 'queued';
        ad.record.error = `Retry ${ad.record.retries}/${MAX_RETRIES}: ${ad.record.error}`;
        this.saveRecord(ad.record);
        this.emitState(ad.record);
      } else {
        ad.record.state = 'failed';
        ad.record.finishedMs = Date.now();
        this.saveRecord(ad.record);
        this.emitState(ad.record);
      }
    } finally {
      this.cleanupActive(record.id);
      this.processQueue();
    }
  }

  private doHttpDownload(ad: ActiveDownload, maxRedirects = 20): Promise<void> {
    return new Promise((resolve, reject) => {
      const rec = ad.record;
      const urlObj = new URL(rec.url);
      const mod = urlObj.protocol === 'https:' ? https : http;

      const headers: Record<string, string> = {
        'User-Agent': 'OrbisFiles/1.0',
      };

      // Resume support: send Range header if we have partial data.
      if (rec.bytesDownloaded > 0 && rec.resumable) {
        headers['Range'] = `bytes=${rec.bytesDownloaded}-`;
      }

      const req = mod.request(urlObj, { method: 'GET', headers, signal: ad.ac.signal }, (res) => {
        const status = res.statusCode ?? 0;

        // Handle redirects.
        if (status >= 300 && status < 400 && res.headers.location) {
          req.destroy();
          if (maxRedirects <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          rec.url = new URL(res.headers.location, rec.url).toString();
          this.saveRecord(rec);
          resolve(this.doHttpDownload(ad, maxRedirects - 1));
          return;
        }

        if (status !== 200 && status !== 206) {
          req.destroy();
          reject(new Error(`HTTP ${status} ${res.statusMessage ?? ''}`));
          return;
        }

        // Parse response headers.
        const contentLength = res.headers['content-length'];
        const acceptRanges = res.headers['accept-ranges'];
        const contentDisp = res.headers['content-disposition'];
        const contentType = res.headers['content-type'];

        rec.mimeType = contentType?.split(';')[0]?.trim() ?? null;
        rec.resumable = acceptRanges === 'bytes' || status === 206;

        if (status === 200) {
          // Full response: reset downloaded bytes.
          rec.bytesDownloaded = 0;
          if (contentLength) rec.totalBytes = parseInt(contentLength, 10) || null;
        } else if (status === 206) {
          // Partial content.
          const cr = res.headers['content-range'];
          if (cr) {
            const m = cr.match(/bytes \d+-\d+\/(\d+|\*)/);
            if (m && m[1] !== '*') rec.totalBytes = parseInt(m[1]!, 10);
          }
        }

        // Detect filename from Content-Disposition if user did not override.
        const headerName = parseContentDisposition(contentDisp);
        if (headerName && !rec.filename.startsWith('download-')) {
          // User provided a name, keep it.
        } else if (headerName) {
          rec.filename = headerName;
          rec.filePath = path.join(rec.destination, rec.filename);
        }

        this.saveRecord(rec);

        // Ensure destination directory exists.
        void fsp.mkdir(rec.destination, { recursive: true }).then(() => {
          const flags = status === 206 ? 'a' : 'w';
          const fileStream = fs.createWriteStream(rec.filePath, { flags });

          // Track bytes through a writable counter.
          const counter = new Writable({
            write: (chunk: Buffer, _enc, cb) => {
              rec.bytesDownloaded += chunk.length;
              ad.speedSamples.push([Date.now(), rec.bytesDownloaded]);
              // Keep only samples within the window.
              const cutoff = Date.now() - SPEED_WINDOW_MS;
              while (ad.speedSamples.length > 2 && ad.speedSamples[0]![0] < cutoff) {
                ad.speedSamples.shift();
              }
              fileStream.write(chunk, cb);
            },
            final: (cb) => {
              fileStream.end(cb);
            },
          });

          counter.on('error', (err) => {
            req.destroy();
            reject(err);
          });
          fileStream.on('error', (err) => {
            req.destroy();
            reject(err);
          });
          void pipeline(res, ad.throttle, counter).then(() => resolve(), (err) => {
            if (!ad.ac.signal.aborted) reject(err);
          });
        }, reject);
      });

      req.on('error', (err) => {
        if (!ad.ac.signal.aborted) reject(err);
      });

      req.end();
    });
  }

  private async verifyChecksum(record: DownloadRecord): Promise<void> {
    if (!record.checksumAlgorithm || !record.checksumExpected) return;
    const algo = record.checksumAlgorithm as ChecksumAlgorithm;
    const hash = crypto.createHash(algo);
    const stream = fs.createReadStream(record.filePath);
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    const actual = hash.digest('hex');
    record.checksumActual = actual;
    record.checksumResult = actual.toLowerCase() === record.checksumExpected.toLowerCase() ? 'match' : 'mismatch';
    if (record.checksumResult === 'mismatch') {
      record.error = `Checksum mismatch: expected ${record.checksumExpected}, got ${actual}`;
    }
  }

  private emitProgress(ad: ActiveDownload): void {
    const rec = ad.record;
    if (rec.state !== 'downloading') return;

    const samples = ad.speedSamples;
    let speed = 0;
    if (samples.length >= 2) {
      const first = samples[0]!;
      const last = samples[samples.length - 1]!;
      const dt = (last[0] - first[0]) / 1000;
      if (dt > 0) speed = (last[1] - first[1]) / dt;
    }

    let etaSec: number | null = null;
    if (rec.totalBytes && speed > 0) {
      etaSec = Math.round((rec.totalBytes - rec.bytesDownloaded) / speed);
    }

    const fraction = rec.totalBytes ? rec.bytesDownloaded / rec.totalBytes : null;

    this.onProgress({
      id: rec.id,
      bytesDownloaded: rec.bytesDownloaded,
      totalBytes: rec.totalBytes,
      speed,
      etaSec,
      fraction,
    });
  }

  private emitState(record: DownloadRecord): void {
    this.onStateChange({ id: record.id, state: record.state, record: { ...record } });
  }

  private cleanupActive(id: string): void {
    const ad = this.active.get(id);
    if (!ad) return;
    if (ad.progressTimer) clearInterval(ad.progressTimer);
    ad.throttle.destroy();
    this.active.delete(id);
  }

  private saveRecord(record: DownloadRecord): void {
    this.db.run(
      `INSERT INTO download_queue(
        id, url, file_path, destination, filename, state, mime_type, total_bytes,
        bytes_downloaded, resumable, retries, error, priority,
        checksum_algorithm, checksum_expected, checksum_result, checksum_actual,
        auto_extract, extracted_to, speed_limit_kbs, created_ms, started_ms, finished_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        url=excluded.url, file_path=excluded.file_path, destination=excluded.destination,
        filename=excluded.filename, state=excluded.state, mime_type=excluded.mime_type,
        total_bytes=excluded.total_bytes, bytes_downloaded=excluded.bytes_downloaded,
        resumable=excluded.resumable, retries=excluded.retries, error=excluded.error,
        priority=excluded.priority, checksum_algorithm=excluded.checksum_algorithm,
        checksum_expected=excluded.checksum_expected, checksum_result=excluded.checksum_result,
        checksum_actual=excluded.checksum_actual, auto_extract=excluded.auto_extract,
        extracted_to=excluded.extracted_to, speed_limit_kbs=excluded.speed_limit_kbs,
        started_ms=excluded.started_ms, finished_ms=excluded.finished_ms`,
      [
        record.id, record.url, record.filePath, record.destination, record.filename,
        record.state, record.mimeType, record.totalBytes,
        record.bytesDownloaded, record.resumable ? 1 : 0, record.retries, record.error,
        record.priority, record.checksumAlgorithm, record.checksumExpected,
        record.checksumResult, record.checksumActual,
        record.autoExtract ? 1 : 0, record.extractedTo, record.speedLimitKBs,
        record.createdMs, record.startedMs, record.finishedMs,
      ],
    );
  }

  private loadRecord(id: string): DownloadRecord | null {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM download_queue WHERE id = ?', [id]);
    return row ? rowToRecord(row) : null;
  }
}

function rowToRecord(row: Record<string, unknown>): DownloadRecord {
  return {
    id: String(row.id),
    url: String(row.url),
    filePath: String(row.file_path),
    destination: String(row.destination),
    filename: String(row.filename),
    state: String(row.state) as DownloadState,
    mimeType: row.mime_type != null ? String(row.mime_type) : null,
    totalBytes: row.total_bytes != null ? Number(row.total_bytes) : null,
    bytesDownloaded: Number(row.bytes_downloaded) || 0,
    resumable: row.resumable === 1,
    retries: Number(row.retries) || 0,
    error: row.error != null ? String(row.error) : null,
    priority: Number(row.priority) || 100,
    checksumAlgorithm: row.checksum_algorithm != null ? String(row.checksum_algorithm) as ChecksumAlgorithm : null,
    checksumExpected: row.checksum_expected != null ? String(row.checksum_expected) : null,
    checksumResult: row.checksum_result != null ? String(row.checksum_result) as 'match' | 'mismatch' : null,
    checksumActual: row.checksum_actual != null ? String(row.checksum_actual) : null,
    autoExtract: row.auto_extract === 1,
    extractedTo: row.extracted_to != null ? String(row.extracted_to) : null,
    speedLimitKBs: Number(row.speed_limit_kbs) || 0,
    createdMs: Number(row.created_ms),
    startedMs: row.started_ms != null ? Number(row.started_ms) : null,
    finishedMs: row.finished_ms != null ? Number(row.finished_ms) : null,
  };
}
