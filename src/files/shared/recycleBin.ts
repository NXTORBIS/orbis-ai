import { z } from 'zod';

/**
 * Advanced Recycle Bin: soft-delete with restore, permanent delete and auto-purge.
 */

export interface RecycleBinItem {
  id: string;
  originalPath: string;
  name: string;
  kind: 'file' | 'directory';
  size: number;
  deletedMs: number;
  storagePath: string;
}

export interface RecycleBinSettings {
  autoPurgeDays: number;
  maxSizeBytes: number;
}

export const RecycleBinSettingsSchema = z.object({
  autoPurgeDays: z.number().int().min(0).max(3650),
  maxSizeBytes: z.number().int().nonnegative(),
});
