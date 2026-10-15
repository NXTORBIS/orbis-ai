import { z } from 'zod';

/**
 * Git status integration: schemas and types for extended git operations
 * (stage, unstage, commit) beyond the read-only status already in shared/git.ts.
 */

export const GitStageSchema = z.object({
  repoRoot: z.string().min(1).max(32767),
  paths: z.array(z.string().min(1).max(32767)).min(1).max(10000),
});

export const GitUnstageSchema = z.object({
  repoRoot: z.string().min(1).max(32767),
  paths: z.array(z.string().min(1).max(32767)).min(1).max(10000),
});

export const GitCommitSchema = z.object({
  repoRoot: z.string().min(1).max(32767),
  message: z.string().min(1).max(100000),
});

export const GitDiffSummarySchema = z.object({
  repoRoot: z.string().min(1).max(32767),
});

export interface GitDiffSummary {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export interface GitCommitResult {
  ok: boolean;
  message?: string;
  hash?: string;
  error?: string;
}
