import { z } from 'zod';

/**
 * Virtual Workspaces / Spaces: named groups of folders from different locations.
 * Each space remembers its own tab layout, sort and view preferences.
 */

export const SpaceSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  folders: z.array(z.string().min(1).max(32767)).max(100),
  sortKey: z.string().max(32).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  viewMode: z.string().max(32).optional(),
  tabState: z.string().max(1_000_000).optional(),
  createdMs: z.number().int().nonnegative(),
  updatedMs: z.number().int().nonnegative(),
});
export type Space = z.infer<typeof SpaceSchema>;

export const SpaceCreateSchema = z.object({
  name: z.string().min(1).max(128),
  folders: z.array(z.string().min(1).max(32767)).min(1).max(100),
});
export type SpaceCreate = z.infer<typeof SpaceCreateSchema>;

export const SpaceUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128).optional(),
  folders: z.array(z.string().min(1).max(32767)).max(100).optional(),
  sortKey: z.string().max(32).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  viewMode: z.string().max(32).optional(),
  tabState: z.string().max(1_000_000).optional(),
});
export type SpaceUpdate = z.infer<typeof SpaceUpdateSchema>;
