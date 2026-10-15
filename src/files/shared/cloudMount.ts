import { z } from 'zod';

/**
 * Cloud Storage Mount (FTP/SFTP/WebDAV): shared types for the IPC boundary.
 * Connection profiles are stored in the database; credentials are held only in
 * memory (and optionally in the OS keychain through safeStorage).
 */

export type CloudProtocol = 'ftp' | 'sftp' | 'webdav';

export const CloudProtocolSchema = z.enum(['ftp', 'sftp', 'webdav']);

export const CloudProfileSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  protocol: CloudProtocolSchema,
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(256).default(''),
  /** Base path on the server to mount as root. */
  basePath: z.string().max(4096).default('/'),
  createdMs: z.number().int().nonnegative(),
  updatedMs: z.number().int().nonnegative(),
});
export type CloudProfile = z.infer<typeof CloudProfileSchema>;

export const CloudProfileInputSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  name: z.string().min(1).max(256),
  protocol: CloudProtocolSchema,
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(256).default(''),
  password: z.string().max(4096).optional(),
  basePath: z.string().max(4096).default('/'),
});
export type CloudProfileInput = z.infer<typeof CloudProfileInputSchema>;

export interface CloudEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  modifiedMs?: number;
}

export interface CloudTransferProgress {
  profileId: string;
  fileName: string;
  direction: 'upload' | 'download';
  bytesTransferred: number;
  totalBytes: number;
  /** 0..1 */
  progress: number;
}

export const CLOUD_DEFAULT_PORTS: Record<string, number> = {
  ftp: 21,
  sftp: 22,
  webdav: 443,
};
