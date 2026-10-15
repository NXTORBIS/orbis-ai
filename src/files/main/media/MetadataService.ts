import fsp from 'node:fs/promises';
import path from 'node:path';
import { mapLimit } from '../fs/FileSystemService';
import { META_EXTS, summarize, type MediaMeta, type MediaSummary } from '../../shared/media';
import { readMetadata } from './metadata';

/**
 * Caches embedded-metadata reads by path + size + modification time, so list
 * columns can ask repeatedly without re-reading files. A changed file gets a
 * new key, so stale values are never returned.
 */
export class MetadataService {
  private cache = new Map<string, MediaMeta>();
  constructor(private readonly max = 8000) {}

  private async key(p: string): Promise<string | undefined> {
    const st = await fsp.stat(p).catch(() => undefined);
    if (!st || !st.isFile()) return undefined;
    return `${p}|${st.size}|${st.mtimeMs}`;
  }

  async read(p: string, includeLocation = false): Promise<MediaMeta> {
    if (includeLocation) return readMetadata(p, { includeLocation: true });
    const key = await this.key(p);
    if (!key) return { kind: 'none', warnings: ['Not a readable file.'] };
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const meta = await readMetadata(p);
    this.cache.set(key, meta);
    if (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!);
    return meta;
  }

  /** Summaries for list columns; files without readable metadata are omitted. */
  async summaries(paths: string[], signal?: AbortSignal): Promise<Record<string, MediaSummary>> {
    const out: Record<string, MediaSummary> = {};
    const wanted = paths.filter((p) => META_EXTS.has(path.extname(p).slice(1).toLowerCase()));
    await mapLimit(wanted, 4, async (p) => {
      if (signal?.aborted) return;
      try {
        const m = await this.read(p);
        if (m.kind !== 'none') out[p] = summarize(m);
      } catch {
        /* unreadable files simply have no summary */
      }
    });
    return out;
  }

  invalidate(p: string): void {
    for (const k of this.cache.keys()) if (k.startsWith(`${p}|`)) this.cache.delete(k);
  }
}
