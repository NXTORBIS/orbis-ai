import { z } from 'zod';

/**
 * Snippet library: shared types for the IPC boundary.
 */

export const SnippetSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  content: z.string().min(1).max(1_000_000),
  language: z.string().max(64).default(''),
  tags: z.array(z.string().min(1).max(64)).max(20).default([]),
  createdMs: z.number().int().nonnegative(),
  updatedMs: z.number().int().nonnegative(),
});
export type Snippet = z.infer<typeof SnippetSchema>;

export const SnippetCreateSchema = z.object({
  title: z.string().min(1).max(256),
  content: z.string().min(1).max(1_000_000),
  language: z.string().max(64).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
});
export type SnippetCreate = z.infer<typeof SnippetCreateSchema>;

export const SnippetUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(256).optional(),
  content: z.string().min(1).max(1_000_000).optional(),
  language: z.string().max(64).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
});
export type SnippetUpdate = z.infer<typeof SnippetUpdateSchema>;

export interface SnippetExport {
  version: 1;
  exportedMs: number;
  snippets: Snippet[];
}
