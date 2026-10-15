import type { AppDatabase } from '../store/Database';
import { randomUUID } from 'crypto';
import { opendir, stat } from 'fs/promises';
import path from 'path';
import type { BrowserWindow } from 'electron';

export interface ScanOptions {
  root: string;
  maxDepth: number;
  maxEntries: number;
  includeHidden: boolean;
}

export interface ScanProgress {
  scanId: string;
  scanned: number;
  totalBytes: number;
  currentPath: string;
  state: 'running' | 'complete' | 'cancelled' | 'error';
}

const CATEGORY_MAP: Record<string, string> = {
  // Documents
  pdf: 'document', doc: 'document', docx: 'document', txt: 'document', rtf: 'document',
  odt: 'document', xls: 'document', xlsx: 'document', ppt: 'document', pptx: 'document',
  csv: 'document', md: 'document', pages: 'document', numbers: 'document', key: 'document',
  // Images
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image', svg: 'image',
  webp: 'image', tiff: 'image', ico: 'image', raw: 'image', cr2: 'image', nef: 'image',
  psd: 'image', ai: 'image', heic: 'image', heif: 'image', avif: 'image',
  // Video
  mp4: 'video', avi: 'video', mkv: 'video', mov: 'video', wmv: 'video', flv: 'video',
  webm: 'video', m4v: 'video', mpg: 'video', mpeg: 'video', '3gp': 'video',
  // Audio
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', wma: 'audio',
  m4a: 'audio', opus: 'audio', aiff: 'audio', alac: 'audio', mid: 'audio', midi: 'audio',
  // Code
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', py: 'code', java: 'code',
  c: 'code', cpp: 'code', h: 'code', hpp: 'code', cs: 'code', go: 'code',
  rs: 'code', rb: 'code', php: 'code', swift: 'code', kt: 'code', scala: 'code',
  html: 'code', css: 'code', scss: 'code', less: 'code', vue: 'code', svelte: 'code',
  sh: 'code', bash: 'code', zsh: 'code', fish: 'code', ps1: 'code', bat: 'code',
  sql: 'code', json: 'code', xml: 'code', yaml: 'code', yml: 'code', toml: 'code',
  ini: 'code', cfg: 'code', conf: 'code', env: 'code', makefile: 'code',
  // Archives
  zip: 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive',
  '7z': 'archive', rar: 'archive', dmg: 'archive', iso: 'archive', pkg: 'archive',
  deb: 'archive', rpm: 'archive',
  // Data
  db: 'data', sqlite: 'data', mdb: 'data', accdb: 'data', bak: 'data',
  log: 'data', dat: 'data', bin: 'data',
};

function categorize(ext: string): string {
  return CATEGORY_MAP[ext.toLowerCase()] || 'other';
}

export class UniverseScanner {
  private abortControllers = new Map<string, AbortController>();

  constructor(private db: AppDatabase, private win: BrowserWindow | null) {}

  async scan(opts: ScanOptions): Promise<string> {
    const scanId = randomUUID();
    const ac = new AbortController();
    this.abortControllers.set(scanId, ac);

    this.db.run(
      'INSERT INTO universe_scans (id, root, started_ms, state, options) VALUES (?, ?, ?, ?, ?)',
      [scanId, opts.root, Date.now(), 'running', JSON.stringify(opts)]
    );

    let scanned = 0;
    let totalBytes = 0;
    let lastEmit = 0;

    const INSERT_SQL = 'INSERT OR IGNORE INTO universe_entries (path, scan_id, parent, name, kind, size, depth, mtime_ms, ctime_ms, ext, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

    const walk = async (dir: string, depth: number) => {
      if (ac.signal.aborted || scanned >= opts.maxEntries) return;
      if (depth > opts.maxDepth) return;

      let entries;
      try {
        entries = await opendir(dir);
      } catch { return; }

      for await (const entry of entries) {
        if (ac.signal.aborted || scanned >= opts.maxEntries) break;
        const name = entry.name;
        if (!opts.includeHidden && name.startsWith('.')) continue;

        const fullPath = path.join(dir, name);
        let st;
        try {
          st = await stat(fullPath);
        } catch { continue; }

        const kind = st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other';
        const ext = kind === 'file' ? path.extname(name).slice(1).toLowerCase() : '';
        const size = st.size;
        const cat = kind === 'directory' ? 'directory' : categorize(ext);

        this.db.run(INSERT_SQL, [fullPath, scanId, dir, name, kind, size, depth, st.mtimeMs, st.ctimeMs, ext, cat]);
        scanned++;
        totalBytes += size;

        const now = Date.now();
        if (now - lastEmit > 200) {
          lastEmit = now;
          this.emitProgress({ scanId, scanned, totalBytes, currentPath: dir, state: 'running' });
        }

        if (kind === 'directory') {
          await walk(fullPath, depth + 1);
        }
      }
    };

    try {
      await walk(opts.root, 0);
      const state = ac.signal.aborted ? 'cancelled' : 'complete';
      this.db.run(
        'UPDATE universe_scans SET finished_ms = ?, total_entries = ?, total_bytes = ?, state = ? WHERE id = ?',
        [Date.now(), scanned, totalBytes, state, scanId]
      );
      this.emitProgress({ scanId, scanned, totalBytes, currentPath: opts.root, state });
    } catch (err: any) {
      this.db.run(
        'UPDATE universe_scans SET finished_ms = ?, total_entries = ?, total_bytes = ?, state = ? WHERE id = ?',
        [Date.now(), scanned, totalBytes, 'error', scanId]
      );
      this.emitProgress({ scanId, scanned, totalBytes, currentPath: opts.root, state: 'error' });
    }

    this.abortControllers.delete(scanId);
    return scanId;
  }

  cancel(scanId: string) {
    this.abortControllers.get(scanId)?.abort();
  }

  getStatus(scanId: string) {
    return this.db.get<any>('SELECT * FROM universe_scans WHERE id = ?', [scanId]) ?? null;
  }

  query(opts: {
    scanId: string; parent?: string; category?: string;
    minSize?: number; maxSize?: number; ext?: string;
    limit: number; offset: number; sortBy: string; sortDir: string;
  }) {
    let sql = 'SELECT * FROM universe_entries WHERE scan_id = ?';
    const params: any[] = [opts.scanId];
    if (opts.parent !== undefined) { sql += ' AND parent = ?'; params.push(opts.parent); }
    if (opts.category) { sql += ' AND category = ?'; params.push(opts.category); }
    if (opts.minSize !== undefined) { sql += ' AND size >= ?'; params.push(opts.minSize); }
    if (opts.maxSize !== undefined) { sql += ' AND size <= ?'; params.push(opts.maxSize); }
    if (opts.ext) { sql += ' AND ext = ?'; params.push(opts.ext); }
    sql += ` ORDER BY ${opts.sortBy === 'name' ? 'name' : opts.sortBy} ${opts.sortDir === 'asc' ? 'ASC' : 'DESC'}`;
    sql += ' LIMIT ? OFFSET ?';
    params.push(opts.limit, opts.offset);

    return this.db.all<any>(sql, params);
  }

  getStats(scanId: string) {
    const scan = this.getStatus(scanId);
    if (!scan) return null;

    const categories = this.db.all<any>(
      'SELECT category, COUNT(*) as count, SUM(size) as totalSize FROM universe_entries WHERE scan_id = ? GROUP BY category ORDER BY totalSize DESC',
      [scanId]
    );

    const extensions = this.db.all<any>(
      "SELECT ext, COUNT(*) as count, SUM(size) as totalSize FROM universe_entries WHERE scan_id = ? AND ext != '' GROUP BY ext ORDER BY totalSize DESC LIMIT 50",
      [scanId]
    );

    const depthDistribution = this.db.all<any>(
      'SELECT depth, COUNT(*) as count FROM universe_entries WHERE scan_id = ? GROUP BY depth ORDER BY depth',
      [scanId]
    );

    const largest = this.db.all<any>(
      "SELECT path, size, category, ext FROM universe_entries WHERE scan_id = ? AND kind = 'file' ORDER BY size DESC LIMIT 20",
      [scanId]
    );

    return { scan, categories, extensions, depthDistribution, largest };
  }

  getRelations(scanId: string, forPath?: string) {
    let sql = 'SELECT * FROM universe_relations WHERE scan_id = ?';
    const params: any[] = [scanId];
    if (forPath) {
      sql += ' AND (source_path = ? OR target_path = ?)';
      params.push(forPath, forPath);
    }
    return this.db.all<any>(sql, params);
  }

  private emitProgress(p: ScanProgress) {
    try {
      for (const f of this.win?.webContents.mainFrame.framesInSubtree ?? []) f.send('files:universe:scan:progress', p);
    } catch {}
  }
}
