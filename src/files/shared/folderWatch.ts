import { z } from 'zod';

/**
 * Folder watcher: shared types for the IPC boundary.
 */

export const WatchRuleSchema = z.object({
  /** Glob patterns to include (empty = all). */
  include: z.array(z.string().max(512)).max(50).default([]),
  /** Glob patterns to ignore. */
  ignore: z.array(z.string().max(512)).max(50).default([]),
  /** Auto-action when a matching change is detected. */
  autoAction: z.enum(['none', 'notify', 'copy', 'move']).default('none'),
  /** Destination directory for copy/move auto-actions. */
  actionDest: z.string().max(32767).optional(),
});
export type WatchRule = z.infer<typeof WatchRuleSchema>;

export const FolderWatchSchema = z.object({
  id: z.string().min(1).max(128),
  path: z.string().min(1).max(32767),
  label: z.string().max(256).default(''),
  rule: WatchRuleSchema,
  enabled: z.boolean().default(true),
  createdMs: z.number().int().nonnegative(),
  updatedMs: z.number().int().nonnegative(),
});
export type FolderWatch = z.infer<typeof FolderWatchSchema>;

export const FolderWatchCreateSchema = z.object({
  path: z.string().min(1).max(32767),
  label: z.string().max(256).optional(),
  rule: WatchRuleSchema.optional(),
});
export type FolderWatchCreate = z.infer<typeof FolderWatchCreateSchema>;

export const FolderWatchUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().max(256).optional(),
  rule: WatchRuleSchema.optional(),
  enabled: z.boolean().optional(),
});
export type FolderWatchUpdate = z.infer<typeof FolderWatchUpdateSchema>;

export interface WatchEvent {
  watchId: string;
  path: string;
  eventType: 'add' | 'change' | 'remove';
  timestampMs: number;
}
