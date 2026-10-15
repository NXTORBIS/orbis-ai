import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Structured, privacy-conscious local logging.
 * - JSON lines in <userData>/logs, rotated daily, retained 14 days.
 * - The home directory is replaced with "~"; file contents, prompts and
 *   credentials are never passed to the logger by callers.
 * - `error()` returns an errorId that is written into the record, so a
 *   user-facing error can be matched to its diagnostic entry.
 */

export type Level = 'debug' | 'info' | 'warn' | 'error';
export interface LogRecord { ts: string; level: Level; event: string; errorId?: string; [k: string]: unknown }

const HOME = os.homedir();
const RING_MAX = 2000;
const SENSITIVE_KEYS = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|content|prompt|data/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') return value.split(HOME).join('~').slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

export class Logger {
  private ring: LogRecord[] = [];
  private stream: fs.WriteStream | undefined;
  private day = '';
  verbose = false;

  constructor(readonly dir: string) {}

  private file(): fs.WriteStream | undefined {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.day || !this.stream) {
      this.stream?.end();
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this.stream = fs.createWriteStream(path.join(this.dir, `orbis-files-${day}.log`), { flags: 'a' });
        this.stream.on('error', () => {
          this.stream = undefined;
        });
        this.day = day;
      } catch {
        this.stream = undefined;
      }
    }
    return this.stream;
  }

  write(level: Level, event: string, fields: Record<string, unknown> = {}): LogRecord {
    if (level === 'debug' && !this.verbose) return { ts: new Date().toISOString(), level, event };
    const rec: LogRecord = { ts: new Date().toISOString(), level, event, ...(redact(fields) as Record<string, unknown>) };
    this.ring.push(rec);
    if (this.ring.length > RING_MAX) this.ring.splice(0, this.ring.length - RING_MAX);
    this.file()?.write(JSON.stringify(rec) + '\n');
    if (process.env.ORBIS_LOG_STDOUT) console.log(JSON.stringify(rec));
    return rec;
  }

  debug(event: string, f?: Record<string, unknown>) { this.write('debug', event, f); }
  info(event: string, f?: Record<string, unknown>) { this.write('info', event, f); }
  warn(event: string, f?: Record<string, unknown>) { this.write('warn', event, f); }

  /** Log an error and return its id for display alongside the user-facing message. */
  error(event: string, f: Record<string, unknown> = {}): string {
    const errorId = `E-${crypto.randomBytes(4).toString('hex')}`;
    this.write('error', event, { ...f, errorId });
    return errorId;
  }

  recent(limit = 200): LogRecord[] {
    return this.ring.slice(-limit);
  }

  async exportTo(dest: string): Promise<void> {
    const lines = this.ring.map((r) => JSON.stringify(r)).join('\n');
    await fsp.writeFile(dest, lines + '\n', { flag: 'wx' });
  }

  async prune(maxAgeDays = 14): Promise<void> {
    try {
      const cutoff = Date.now() - maxAgeDays * 86400000;
      for (const f of await fsp.readdir(this.dir)) {
        const p = path.join(this.dir, f);
        const st = await fsp.stat(p);
        if (st.mtimeMs < cutoff && f.endsWith('.log')) await fsp.unlink(p);
      }
    } catch {
      /* log dir may not exist yet */
    }
  }

  close(): void {
    this.stream?.end();
  }
}
