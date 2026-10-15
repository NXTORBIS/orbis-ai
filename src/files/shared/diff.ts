import { z } from 'zod';

/** Types shared between main and renderer for the enhanced diff/compare feature. */

export const DiffComputeSchema = z.object({
  pathA: z.string().min(1).max(32767),
  pathB: z.string().min(1).max(32767),
});

export interface DiffHunk {
  kind: 'same' | 'added' | 'removed';
  lines: string[];
}

export interface DiffStats {
  linesAdded: number;
  linesRemoved: number;
  linesChanged: number;
}

export interface TextDiffResult {
  type: 'text';
  hunks: DiffHunk[];
  stats: DiffStats;
  identical: boolean;
  leftHash: string;
  rightHash: string;
}

export interface ImageDiffResult {
  type: 'image';
  leftDims: { width: number; height: number } | null;
  rightDims: { width: number; height: number } | null;
  leftSize: number;
  rightSize: number;
  identical: boolean;
  leftHash: string;
  rightHash: string;
}

export interface BinaryDiffResult {
  type: 'binary';
  leftHex: string; // base64 of first 4KB
  rightHex: string; // base64 of first 4KB
  leftSize: number;
  rightSize: number;
  identical: boolean;
  leftHash: string;
  rightHash: string;
}

export type DiffResult = TextDiffResult | ImageDiffResult | BinaryDiffResult;
