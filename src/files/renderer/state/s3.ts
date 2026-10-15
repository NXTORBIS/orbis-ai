import { createStore } from './store';
import { call, on } from '../api';
import { openDialog } from './app';
import type { S3ConnectionInfo, S3Bucket, S3ListResult, S3PresignedUrl } from '../../shared/s3';
import type { SecureStorageState } from '../../shared/remote';

/**
 * S3 connections as the window sees them (never with secrets) and
 * the interactive connect flow: secret prompts are answered here.
 */

export interface S3State {
  loaded: boolean;
  connections: S3ConnectionInfo[];
  storage: SecureStorageState;
}

export const s3Store = createStore<S3State>({ loaded: false, connections: [], storage: { available: false } });

let started = false;
export function startS3(): void {
  if (started) return;
  started = true;
  void call<{ connections: S3ConnectionInfo[]; storage: SecureStorageState }>('s3:list').then(
    (r) => s3Store.set({ loaded: true, connections: r.connections, storage: r.storage }),
    () => s3Store.set({ loaded: true }),
  );
  on<{ connections: S3ConnectionInfo[]; storage: SecureStorageState }>('s3:changed', (r) => s3Store.set({ connections: r.connections, storage: r.storage }));
}

export function s3ConnectionOf(id: string): S3ConnectionInfo | undefined {
  return s3Store.get().connections.find((c) => c.id === id);
}

/**
 * Connect, asking for the secret if needed. Resolves true once connected.
 */
export async function ensureS3Connected(id: string): Promise<boolean> {
  const conn = s3ConnectionOf(id);
  if (!conn) return false;
  if (conn.connected) return true;

  let secret: string | undefined;
  // If we need a secret and none is stored, ask
  if (conn.secretMode === 'ask' || !conn.hasSecret) {
    const input: string | null = await new Promise((resolve) =>
      openDialog('s3Secret', { connectionName: conn.name, resolve: resolve as unknown }),
    );
    if (!input) return false;
    secret = input;
  }

  const result = await call<S3ConnectionInfo>('s3:connect', { id, secret });
  return result.connected;
}

export async function listBuckets(id: string): Promise<S3Bucket[]> {
  const res = await call<{ buckets: S3Bucket[] }>('s3:listBuckets', { id });
  return res.buckets;
}

export async function listObjects(id: string, bucket: string, prefix = '', continuationToken?: string): Promise<S3ListResult> {
  return call<S3ListResult>('s3:listObjects', { id, bucket, prefix, continuationToken });
}

export async function createS3Folder(id: string, bucket: string, prefix: string): Promise<void> {
  await call('s3:mkdir', { id, bucket, prefix });
}

export async function deleteS3Object(id: string, bucket: string, key: string): Promise<void> {
  await call('s3:delete', { id, bucket, key });
}

export async function renameS3Object(id: string, bucket: string, oldKey: string, newKey: string): Promise<void> {
  await call('s3:rename', { id, bucket, oldKey, newKey });
}

export async function presignS3Url(id: string, bucket: string, key: string, expiresIn = 3600): Promise<S3PresignedUrl> {
  return call<S3PresignedUrl>('s3:presign', { id, bucket, key, expiresIn });
}
