import { z } from 'zod';

/**
 * Shared types for the Batch Rename tool view. The rename engine itself lives
 * in shared/rename.ts; this file adds the IPC-specific request/response shapes.
 */

export const RenamePatternSchema = z.object({
  /** A template string using tokens: {n}, {n:3}, {date}, {mtime}, {parent}, etc. */
  template: z.string().max(1024).default('{name}'),
  /** Plain-text or regex find/replace applied before the template. */
  find: z.string().max(1024).default(''),
  replace: z.string().max(1024).default(''),
  useRegex: z.boolean().default(false),
  caseSensitive: z.boolean().default(false),
  /** Case conversion: none, upper, lower, title. */
  caseMode: z.enum(['none', 'upper', 'lower', 'title']).default('none'),
  /** Start number for {n} token. */
  startNumber: z.number().int().min(0).max(1_000_000_000).default(1),
  /** Zero-pad width for {n} (0 = no padding). */
  padWidth: z.number().int().min(0).max(10).default(0),
  /** Whether to include the extension in text transformations. */
  includeExtension: z.boolean().default(false),
});

export type RenamePattern = z.infer<typeof RenamePatternSchema>;

export interface RenamePreviewResult {
  items: RenamePreviewItem[];
  error?: string;
  conflicts: number;
  unchanged: number;
  renamed: number;
}

export interface RenamePreviewItem {
  path: string;
  oldName: string;
  newName: string;
  status: 'renamed' | 'unchanged' | 'conflict' | 'invalid';
  reason?: string;
}
