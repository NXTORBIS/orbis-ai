import { z } from 'zod';

/**
 * Archive Manager: shared types for the IPC boundary.
 * Browse archives without extracting, extract individual files, and create
 * archives with compression options.
 */

export const ArchiveFormatSchema = z.enum(['zip', '7z', 'tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst']);
export type ArchiveFormat = z.infer<typeof ArchiveFormatSchema>;

export const CompressionLevelSchema = z.enum(['store', 'fastest', 'fast', 'normal', 'maximum', 'ultra']);
export type CompressionLevel = z.infer<typeof CompressionLevelSchema>;

export interface ArchiveManagerEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  compressedSize?: number;
  modifiedMs?: number;
  encrypted?: boolean;
}

export interface ArchiveCreateOptions {
  format: ArchiveFormat;
  compressionLevel: CompressionLevel;
  password?: string;
  splitSizeBytes?: number;
}

export interface ArchiveInfo {
  path: string;
  format: string;
  totalFiles: number;
  totalSize: number;
  compressedSize: number;
  encrypted: boolean;
  comment?: string;
}

export const ArchiveCreateSchema = z.object({
  sources: z.array(z.string().min(1).max(32767)).min(1).max(100_000),
  destination: z.string().min(1).max(32767),
  format: ArchiveFormatSchema,
  compressionLevel: CompressionLevelSchema.default('normal'),
  password: z.string().max(1024).optional(),
  splitSizeBytes: z.number().int().positive().optional(),
});
export type ArchiveCreateInput = z.infer<typeof ArchiveCreateSchema>;

export const ArchiveExtractFileSchema = z.object({
  archivePath: z.string().min(1).max(32767),
  entries: z.array(z.string().min(1).max(32767)).min(1).max(100_000),
  destination: z.string().min(1).max(32767),
  password: z.string().max(1024).optional(),
});
export type ArchiveExtractFileInput = z.infer<typeof ArchiveExtractFileSchema>;

export const ArchiveBrowseSchema = z.object({
  archivePath: z.string().min(1).max(32767),
  innerPath: z.string().max(32767).default(''),
  password: z.string().max(1024).optional(),
});
export type ArchiveBrowseInput = z.infer<typeof ArchiveBrowseSchema>;

/** Format labels for UI display. */
export const FORMAT_LABELS: Record<ArchiveFormat, string> = {
  'zip': 'ZIP',
  '7z': '7-Zip',
  'tar.gz': 'TAR.GZ (gzip)',
  'tar.bz2': 'TAR.BZ2 (bzip2)',
  'tar.xz': 'TAR.XZ (xz)',
  'tar.zst': 'TAR.ZST (Zstandard)',
};

export const LEVEL_LABELS: Record<CompressionLevel, string> = {
  store: 'Store (no compression)',
  fastest: 'Fastest',
  fast: 'Fast',
  normal: 'Normal',
  maximum: 'Maximum',
  ultra: 'Ultra',
};
