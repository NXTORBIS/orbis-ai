/**
 * Comic archive service. Comic archives (CBZ/CBR/CB7/CBT) are ZIP/RAR/7z/TAR
 * archives containing sequential images. This service lists the pages and
 * extracts individual pages for display.
 */
import fsp from 'node:fs/promises';
import { makeError } from '../../shared/errors';
import type { ComicManifest, ComicPage, ReadingPosition } from '../../shared/viewers';
import { listArchive, extractEntryToScratch, DEFAULT_LIMITS, type ArchiveLimits } from '../tools/archives';

/** Maximum comic archive size (2 GB). */
const MAX_COMIC_BYTES = 2 * 1024 * 1024 * 1024;

/** Image extensions that constitute comic pages. */
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'tiff', 'tif']);

/** Cache of opened comic manifests. */
const manifestCache = new Map<string, { manifest: ComicManifest; mtime: number }>();

/** Reading positions for comics. */
const positions = new Map<string, ReadingPosition>();

/** Natural sort for page ordering (handles "page001.jpg", "page002.jpg", etc.). */
function naturalSort(a: string, b: string): number {
  const re = /(\d+)/g;
  const aParts = a.split(re);
  const bParts = b.split(re);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const ap = aParts[i] ?? '';
    const bp = bParts[i] ?? '';
    // If both are numeric, compare as numbers
    if (/^\d+$/.test(ap) && /^\d+$/.test(bp)) {
      const diff = parseInt(ap, 10) - parseInt(bp, 10);
      if (diff !== 0) return diff;
    } else {
      const cmp = ap.localeCompare(bp);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

export async function openComic(archivePath: string, limits?: ArchiveLimits): Promise<ComicManifest> {
  const st = await fsp.stat(archivePath).catch(() => {
    throw makeError('not_found', 'comic.open', { target: archivePath });
  });
  if (st.size > MAX_COMIC_BYTES) {
    throw makeError('unsupported', 'comic.open', { message: 'This comic archive is too large (over 2 GB).' });
  }

  // Check cache
  const cached = manifestCache.get(archivePath);
  if (cached && cached.mtime === st.mtimeMs) {
    return cached.manifest;
  }

  const effectiveLimits = limits ?? DEFAULT_LIMITS;

  // List the archive contents
  const listing = await listArchive(archivePath, effectiveLimits);

  if (!listing.supported) {
    throw makeError('unsupported', 'comic.open', { message: 'This archive format is not supported for comic reading.' });
  }

  // Filter for image entries and sort naturally
  const imageEntries = listing.entries
    .filter((entry) => {
      if (entry.kind !== 'file') return false;
      const ext = extOf(entry.name);
      return IMAGE_EXTS.has(ext);
    })
    .filter((entry) => {
      // Skip images in __MACOSX or other metadata folders
      const lower = entry.name.toLowerCase();
      return !lower.startsWith('__macosx/') && !lower.startsWith('.') && !lower.includes('/.');
    })
    .sort((a, b) => naturalSort(a.name, b.name));

  if (imageEntries.length === 0) {
    throw makeError('unsupported', 'comic.open', { message: 'No image pages were found in this archive.' });
  }

  const pages: ComicPage[] = imageEntries.map((entry) => ({
    entry: entry.name,
    width: undefined,
    height: undefined,
  }));

  const manifest: ComicManifest = {
    format: listing.format,
    pages,
    pageCount: pages.length,
  };

  manifestCache.set(archivePath, { manifest, mtime: st.mtimeMs });

  return manifest;
}

export async function extractPage(archivePath: string, entry: string, limits?: ArchiveLimits): Promise<string> {
  const effectiveLimits = limits ?? DEFAULT_LIMITS;
  // Extract single entry to scratch, return the local file path
  const maxBytes = 100 * 1024 * 1024; // 100 MB per page
  try {
    const localPath = await extractEntryToScratch(archivePath, entry, maxBytes, effectiveLimits);
    return localPath;
  } catch (err) {
    throw makeError('io', 'comic.page', { message: `Failed to extract page: ${(err as Error).message}` });
  }
}

export function getPosition(filePath: string): ReadingPosition | null {
  return positions.get(filePath) ?? null;
}

export function savePosition(filePath: string, index: number): void {
  positions.set(filePath, { path: filePath, index, lastReadMs: Date.now() });
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}
