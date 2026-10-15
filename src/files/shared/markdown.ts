import { z } from 'zod';

/** Types shared between main and renderer for the markdown live preview feature. */

export const MarkdownRenderSchema = z.object({
  content: z.string().max(10_000_000),
  /** Base directory for resolving relative image paths. */
  basePath: z.string().max(32767).optional(),
});

export interface MarkdownRenderResult {
  html: string;
}
