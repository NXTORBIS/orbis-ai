import { z } from 'zod';

/**
 * Download manager types and schemas shared between the main process and the renderer.
 */

export type DownloadState = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'verifying' | 'extracting';

export const TERMINAL_DOWNLOAD_STATES: ReadonlySet<DownloadState> = new Set(['completed', 'failed', 'cancelled']);

export type ChecksumAlgorithm = 'sha256' | 'sha1' | 'md5';

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number | null;
  /** Bytes per second (rolling average over last 3 seconds). */
  speed: number;
  /** Estimated seconds remaining (null when unknown). */
  etaSec: number | null;
  /** Completion fraction 0–1 (null when total size is unknown). */
  fraction: number | null;
}

export interface DownloadSettings {
  /** Maximum number of concurrent downloads (1–8). */
  maxConcurrent: number;
  /** Default download directory. */
  defaultDir: string;
  /** Bandwidth limit in KB/s (0 = unlimited). */
  speedLimitKBs: number;
  /** Auto-extract archives after download. */
  autoExtract: boolean;
}

export const DownloadSettingsSchema = z.object({
  maxConcurrent: z.number().int().min(1).max(8).optional(),
  defaultDir: z.string().min(1).max(32767).optional(),
  speedLimitKBs: z.number().int().min(0).max(1_000_000).optional(),
  autoExtract: z.boolean().optional(),
});

export interface DownloadOptions {
  /** Override the detected filename. */
  filename?: string;
  /** Expected checksum for verification after download. */
  checksum?: { algorithm: ChecksumAlgorithm; expected: string };
  /** Speed limit in KB/s for this download only (0 = use global setting). */
  speedLimitKBs?: number;
  /** Auto-extract this archive after download. */
  autoExtract?: boolean;
  /** Priority: lower numbers run first (default 100). */
  priority?: number;
}

export const DownloadOptionsSchema = z.object({
  filename: z.string().min(1).max(1024).optional(),
  checksum: z.object({
    algorithm: z.enum(['sha256', 'sha1', 'md5']),
    expected: z.string().min(1).max(256),
  }).optional(),
  speedLimitKBs: z.number().int().min(0).max(1_000_000).optional(),
  autoExtract: z.boolean().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
});

export interface DownloadRecord {
  id: string;
  url: string;
  /** Absolute destination path (includes filename). */
  filePath: string;
  /** The directory the file is saved in. */
  destination: string;
  /** Filename as saved. */
  filename: string;
  state: DownloadState;
  /** MIME type from Content-Type header. */
  mimeType: string | null;
  /** Total bytes from Content-Length (null when chunked or unknown). */
  totalBytes: number | null;
  /** Bytes downloaded so far. */
  bytesDownloaded: number;
  /** Whether the server supports Range requests. */
  resumable: boolean;
  /** Number of retry attempts so far. */
  retries: number;
  /** Last error message if state is 'failed'. */
  error: string | null;
  /** Priority: lower numbers run first. */
  priority: number;

  // Checksum verification
  checksumAlgorithm: ChecksumAlgorithm | null;
  checksumExpected: string | null;
  checksumResult: 'match' | 'mismatch' | null;
  checksumActual: string | null;

  // Auto-extract
  autoExtract: boolean;
  extractedTo: string | null;

  // Speed limiting
  speedLimitKBs: number;

  // Timestamps
  createdMs: number;
  startedMs: number | null;
  finishedMs: number | null;
}

/** The subset sent over IPC for a progress event. */
export interface DownloadProgressEvent {
  id: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  speed: number;
  etaSec: number | null;
  fraction: number | null;
}

/** The subset sent when a download's state changes. */
export interface DownloadStateEvent {
  id: string;
  state: DownloadState;
  record: DownloadRecord;
}

/** Parse a Content-Disposition header for a filename. */
export function parseContentDisposition(header: string | undefined): string | null {
  if (!header) return null;
  // RFC 6266: filename*=UTF-8''encoded  or  filename="quoted"  or  filename=bare
  const utf8Match = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)'[^']*'(.+?)(?:;|$)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]!.trim());
    } catch { /* fall through */ }
  }
  const quotedMatch = header.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch) return quotedMatch[1]!.trim();
  const bareMatch = header.match(/filename\s*=\s*([^\s;]+)/i);
  if (bareMatch) return bareMatch[1]!.trim();
  return null;
}

/** Extract a likely filename from a URL path. */
export function filenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) return null;
    const decoded = decodeURIComponent(last);
    // Must look like a filename (has an extension)
    if (/\.\w{1,10}$/.test(decoded)) return decoded;
    return null;
  } catch {
    return null;
  }
}

/** Maximum number of retries for a failed download. */
export const MAX_RETRIES = 3;

/** Interval between IPC progress events (ms). Aim for ~4/second. */
export const PROGRESS_INTERVAL_MS = 250;

/** Rolling window for speed calculation (ms). */
export const SPEED_WINDOW_MS = 3000;
