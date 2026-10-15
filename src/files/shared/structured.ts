import { z } from 'zod';

/** Types shared between main and renderer for the structured data tree viewer. */

export const StructuredParseSchema = z.object({
  path: z.string().min(1).max(32767),
});

export type NodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface TreeNode {
  key: string;
  path: string;
  type: NodeType;
  value?: string | number | boolean | null;
  children?: TreeNode[];
  /** Number of descendants (for large objects, helps decide whether to auto-expand). */
  childCount?: number;
}

export interface StructuredParseResult {
  format: 'json' | 'yaml' | 'xml' | 'toml';
  root: TreeNode;
  truncated: boolean;
  /** Total bytes read. */
  bytesRead: number;
  /** Parsing error, if any (partial results may still be returned). */
  error?: string;
}
