import { z } from 'zod';

/**
 * File version history: shared types for the IPC boundary.
 */

export const FileVersionSchema = z.object({
  id: z.string().min(1).max(128),
  filePath: z.string().min(1).max(32767),
  versionNumber: z.number().int().positive(),
  sizeBytes: z.number().nonnegative(),
  hash: z.string().max(128),
  createdMs: z.number().int().nonnegative(),
  label: z.string().max(256).default(''),
});
export type FileVersion = z.infer<typeof FileVersionSchema>;

export const FileVersionCreateSchema = z.object({
  filePath: z.string().min(1).max(32767),
  label: z.string().max(256).optional(),
});
export type FileVersionCreate = z.infer<typeof FileVersionCreateSchema>;

export const FileVersionDiffSchema = z.object({
  versionA: z.string().min(1).max(128),
  versionB: z.string().min(1).max(128),
});
export type FileVersionDiff = z.infer<typeof FileVersionDiffSchema>;

export const FileVersionRestoreSchema = z.object({
  versionId: z.string().min(1).max(128),
});
export type FileVersionRestore = z.infer<typeof FileVersionRestoreSchema>;

export const MAX_VERSIONS_DEFAULT = 50;
