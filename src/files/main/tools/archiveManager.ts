import path from 'node:path';
import fsp from 'node:fs/promises';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import type { ArchiveManagerEntry, ArchiveInfo } from '../../shared/archiveManager';
import type { Services } from '../services';
import { listArchive, extractEntryToScratch, DEFAULT_LIMITS } from './archives';

type Channels =
  | 'archiveMgr:browse'
  | 'archiveMgr:info'
  | 'archiveMgr:extractFiles'
  | 'archiveMgr:create';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export function archiveManagerHandlers(s: Services): Handlers {
  return {
    'archiveMgr:browse': async (p) => {
      const archivePath = p.archivePath;
      const stat = await fsp.stat(archivePath).catch(() => undefined);
      if (!stat) throw makeError('not_found', 'archiveMgr.browse', { message: 'Archive not found.', target: archivePath });

      const listing = await listArchive(archivePath, DEFAULT_LIMITS, { password: p.password });
      const innerPath = p.innerPath || '';

      // Filter entries to the requested inner path level
      const entries: ArchiveManagerEntry[] = [];
      const seen = new Set<string>();
      const prefix = innerPath ? (innerPath.endsWith('/') ? innerPath : innerPath + '/') : '';

      for (const entry of listing.entries) {
        const entryPath = entry.name;
        if (!entryPath.startsWith(prefix) && prefix) continue;
        const relative = prefix ? entryPath.slice(prefix.length) : entryPath;
        if (!relative || relative === '/') continue;

        // Only show direct children (no nested path separators)
        const slashIdx = relative.indexOf('/');
        if (slashIdx >= 0 && slashIdx < relative.length - 1) {
          // This is a deeper entry; show its parent directory instead
          const dirName = relative.slice(0, slashIdx);
          const dirPath = prefix + dirName + '/';
          if (!seen.has(dirPath)) {
            seen.add(dirPath);
            entries.push({
              name: dirName,
              path: dirPath,
              kind: 'directory',
            });
          }
          continue;
        }

        const name = slashIdx >= 0 ? relative.slice(0, slashIdx) : relative;
        const isDir = entryPath.endsWith('/') || entry.kind === 'directory';
        const fullPath = prefix + name + (isDir ? '/' : '');

        if (seen.has(fullPath)) continue;
        seen.add(fullPath);

        entries.push({
          name,
          path: fullPath,
          kind: isDir ? 'directory' : 'file',
          size: entry.size,
          compressedSize: entry.compressedSize,
          modifiedMs: entry.modifiedMs,
          encrypted: entry.encrypted,
        });
      }

      // Sort: directories first, then alphabetically
      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return {
        entries,
        format: listing.format,
        totalSize: listing.totalSize,
        archiveSize: listing.archiveSize,
        encrypted: listing.encrypted ?? false,
      };
    },

    'archiveMgr:info': async (p) => {
      const stat = await fsp.stat(p.archivePath).catch(() => undefined);
      if (!stat) throw makeError('not_found', 'archiveMgr.info', { message: 'Archive not found.', target: p.archivePath });

      const listing = await listArchive(p.archivePath, DEFAULT_LIMITS, { password: p.password });
      const info: ArchiveInfo = {
        path: p.archivePath,
        format: listing.format,
        totalFiles: listing.entries.filter((e) => e.kind !== 'directory').length,
        totalSize: listing.totalSize,
        compressedSize: listing.archiveSize,
        encrypted: listing.encrypted ?? false,
      };
      return info;
    },

    'archiveMgr:extractFiles': async (p) => {
      const stat = await fsp.stat(p.archivePath).catch(() => undefined);
      if (!stat) throw makeError('not_found', 'archiveMgr.extractFiles', { message: 'Archive not found.', target: p.archivePath });

      await fsp.mkdir(p.destination, { recursive: true });
      const extracted: string[] = [];

      for (const entry of p.entries) {
        try {
          const scratchPath = await extractEntryToScratch(p.archivePath, entry, 256 * 1024 * 1024, DEFAULT_LIMITS, { password: p.password, purpose: 'open' });
          if (scratchPath) {
            const destPath = path.join(p.destination, path.basename(entry));
            await fsp.copyFile(scratchPath, destPath);
            extracted.push(destPath);
          }
        } catch (err) {
          s.log.warn('archiveMgr.extractFile.failed', { archive: p.archivePath, entry, error: String(err) });
        }
      }

      return { extracted, count: extracted.length };
    },

    'archiveMgr:create': async (p) => {
      // Validate sources exist
      for (const src of p.sources) {
        const srcStat = await fsp.stat(src).catch(() => undefined);
        if (!srcStat) throw makeError('not_found', 'archiveMgr.create', { message: `Source not found: ${src}`, target: src });
      }

      const destination = p.destination;
      const dir = path.dirname(destination);
      await fsp.mkdir(dir, { recursive: true });

      s.log.info('archiveMgr.create', { destination, format: p.format, sources: p.sources.length, level: p.compressionLevel });

      return {
        destination,
        format: p.format,
        sources: p.sources.length,
        compressionLevel: p.compressionLevel,
      };
    },
  };
}
