import { z } from 'zod';

/**
 * Bookmarks / favorites bar: pinned files and folders with drag-to-reorder.
 */

export interface Bookmark {
  id: string;
  path: string;
  label: string;
  kind: 'file' | 'directory';
  position: number;
  createdMs: number;
}

export const BookmarkCreateSchema = z.object({
  path: z.string().min(1).max(32767),
  label: z.string().min(1).max(256),
  kind: z.enum(['file', 'directory']),
});
export type BookmarkCreate = z.infer<typeof BookmarkCreateSchema>;
