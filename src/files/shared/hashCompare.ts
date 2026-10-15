import { z } from 'zod';

/**
 * File hash comparator: compare two files by computing their hashes with a
 * chosen algorithm. Shared types and schemas used by both the main process
 * and the renderer.
 */

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

export const HASH_ALGORITHMS: { id: HashAlgorithm; label: string; bits: number }[] = [
  { id: 'md5', label: 'MD5', bits: 128 },
  { id: 'sha1', label: 'SHA-1', bits: 160 },
  { id: 'sha256', label: 'SHA-256', bits: 256 },
  { id: 'sha512', label: 'SHA-512', bits: 512 },
];

export const HashCompareRequestSchema = z.object({
  pathA: z.string().min(1).max(32767),
  pathB: z.string().min(1).max(32767),
  algorithm: z.enum(['md5', 'sha1', 'sha256', 'sha512']),
  jobId: z.string().min(1).max(128),
});

export interface HashCompareResult {
  pathA: string;
  pathB: string;
  algorithm: HashAlgorithm;
  hashA: string;
  hashB: string;
  sizeA: number;
  sizeB: number;
  match: boolean;
}
