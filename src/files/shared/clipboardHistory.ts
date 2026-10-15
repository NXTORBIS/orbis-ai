import { z } from 'zod';

/**
 * Clipboard History: shared types for the IPC boundary.
 * Tracks text, images and file-path copies beyond what the existing clip:*
 * channels keep (those handle file copy/cut for operations; this tracks
 * everything the user copies for quick re-use).
 */

export type ClipItemKind = 'text' | 'image' | 'files';

export const ClipItemKindSchema = z.enum(['text', 'image', 'files']);

export const ClipHistoryItemSchema = z.object({
  id: z.string().min(1).max(128),
  kind: ClipItemKindSchema,
  /** Short preview text (first line, truncated). */
  preview: z.string().max(2000),
  /** Full text content (only for 'text' items). */
  content: z.string().max(10_000_000).optional(),
  /** File paths (only for 'files' items). */
  paths: z.array(z.string()).max(100_000).optional(),
  /** Base64 thumbnail (only for 'image' items, small JPEG). */
  thumbnail: z.string().max(500_000).optional(),
  /** Whether this item is pinned (survives clear). */
  pinned: z.boolean().default(false),
  copiedMs: z.number().int().nonnegative(),
});
export type ClipHistoryItem = z.infer<typeof ClipHistoryItemSchema>;

/** Maximum items kept in history (excluding pinned). */
export const CLIP_HISTORY_MAX = 100;
