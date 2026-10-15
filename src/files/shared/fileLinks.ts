import { z } from 'zod';

/**
 * File links (aliases): soft references that point to files or folders elsewhere.
 * Stored in the database, resolved on click, with broken-link detection.
 */

export const FileLinkSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(1024),
  targetPath: z.string().min(1).max(32767),
  parentPath: z.string().min(1).max(32767),
  createdMs: z.number(),
  updatedMs: z.number(),
});

export type FileLink = z.infer<typeof FileLinkSchema>;

export interface FileLinkResolved extends FileLink {
  exists: boolean;
  targetKind: 'file' | 'directory' | 'unknown';
  targetSize?: number;
  targetMtimeMs?: number;
}

export const CreateFileLinkSchema = z.object({
  name: z.string().min(1).max(1024),
  targetPath: z.string().min(1).max(32767),
  parentPath: z.string().min(1).max(32767),
});

export type CreateFileLinkInput = z.infer<typeof CreateFileLinkSchema>;
