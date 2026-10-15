import { z } from 'zod';

/**
 * Macro recorder: shared types for the IPC boundary.
 */

export const MacroStepSchema = z.object({
  type: z.enum(['copy', 'move', 'rename', 'create']),
  /** Relative path pattern or name; resolved against the target at playback time. */
  sourceName: z.string().min(1).max(1024),
  /** Destination name or pattern (for rename/create). */
  destName: z.string().max(1024).optional(),
  /** Template for create operations. */
  template: z.enum(['empty', 'text', 'markdown', 'json']).optional(),
});
export type MacroStep = z.infer<typeof MacroStepSchema>;

export const MacroSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  description: z.string().max(2000).default(''),
  steps: z.array(MacroStepSchema).min(1).max(1000),
  createdMs: z.number().int().nonnegative(),
  updatedMs: z.number().int().nonnegative(),
});
export type Macro = z.infer<typeof MacroSchema>;

export const MacroCreateSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  steps: z.array(MacroStepSchema).min(1).max(1000),
});
export type MacroCreate = z.infer<typeof MacroCreateSchema>;

export const MacroUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(2000).optional(),
  steps: z.array(MacroStepSchema).min(1).max(1000).optional(),
});
export type MacroUpdate = z.infer<typeof MacroUpdateSchema>;

export const MacroPlaybackSchema = z.object({
  id: z.string().min(1).max(128),
  targetDir: z.string().min(1).max(32767),
});
export type MacroPlayback = z.infer<typeof MacroPlaybackSchema>;
