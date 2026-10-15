import type { Readable, Writable } from 'node:stream';
import { makeError, OrbisError, type ErrorCategory } from '../../shared/errors';

/** One item on a remote server, as listed. Names are validated before they get here. */
export interface RemoteEntry {
  name: string;
  /** Absolute POSIX path on the server. */
  path: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  modifiedMs?: number;
  /** WebDAV entity tag (used to detect changes on the server). */
  etag?: string;
  mode?: number;
}

export interface RemoteListing {
  entries: RemoteEntry[];
  /** Items the server reported that were refused (unsafe names, entries outside the folder). */
  refused: string[];
}

/**
 * The file-system operations Orbis Files needs from a remote server. SFTP,
 * WebDAV and FTP/FTPS implement it; operations and listings only use this interface.
 * Every method rejects with an OrbisError carrying an honest category.
 */
export interface RemoteFs {
  readonly protocol: 'sftp' | 'webdav' | 'ftp';
  /** The folder the session starts in (the server's home folder for SFTP, "/" for WebDAV). */
  home(): Promise<string>;
  list(dir: string, signal?: AbortSignal): Promise<RemoteListing>;
  /** Throws `not_found` when nothing is at the path. */
  stat(p: string): Promise<RemoteEntry>;
  /** Read a file; `start`/`end` (inclusive) read a byte range. */
  read(p: string, opts?: { start?: number; end?: number; signal?: AbortSignal }): Promise<Readable>;
  /**
   * Write a NEW file at `p` (callers use a temporary name and rename it into place).
   * Resolves with a writable stream; `done` settles once the server has the data.
   */
  write(p: string, opts?: { signal?: AbortSignal; size?: number }): Promise<{ stream: Writable; done: Promise<void> }>;
  /** Create a folder; fails with `already_exists` when something is there. */
  mkdir(p: string): Promise<void>;
  /** Rename/move on the server. Without `overwrite` it never replaces an existing item. */
  rename(from: string, to: string, opts?: { overwrite?: boolean }): Promise<void>;
  /** Server-side copy where the protocol has one (WebDAV COPY); never overwrites. */
  copy?(from: string, to: string): Promise<void>;
  removeFile(p: string): Promise<void>;
  /** Set the modification time where the protocol allows it (SFTP). */
  setModified?(p: string, ms: number): Promise<void>;
  /** Remove an EMPTY folder (recursion is done by the caller, item by item). */
  removeDir(p: string): Promise<void>;
  /** What a symbolic link points to (undefined when it cannot be followed). */
  linkTargetKind?(p: string): Promise<RemoteEntry['kind'] | undefined>;
  /** The connection still works (cheap check). */
  readonly alive: boolean;
  close(): void;
}

/** Error causes the renderer and the connection pool look at. */
export const CAUSE = {
  authFailed: 'auth_failed',
  hostKeyUnknown: 'host_key_unknown',
  hostKeyChanged: 'host_key_changed',
  unreachable: 'host_unreachable',
  timeout: 'timeout',
  connectionLost: 'connection_lost',
  tls: 'tls',
  needsSecret: 'needs_secret',
} as const;

export function remoteError(category: ErrorCategory, operation: string, message: string, opts: { cause?: string; target?: string; retryable?: boolean; dataChanged?: 'no' | 'yes' | 'partial' | 'unknown' } = {}): OrbisError {
  return makeError(category, operation, { message, cause: opts.cause, target: opts.target, retryable: opts.retryable ?? false, dataChanged: opts.dataChanged ?? 'no' });
}

/** Network-level failures (before or while talking to the server) in plain words. */
export function networkError(err: unknown, operation: string, where: string): OrbisError {
  if (err instanceof OrbisError) return err;
  const e = err as { code?: string; message?: string; level?: string };
  const code = e?.code ?? '';
  if (code === 'ECONNREFUSED') return remoteError('unavailable', operation, `${where} refused the connection. Check the host name and port, and that the server is running.`, { cause: `${CAUSE.unreachable}: ECONNREFUSED`, retryable: true });
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return remoteError('unavailable', operation, `The host name of ${where} could not be found. Check it and your network connection.`, { cause: `${CAUSE.unreachable}: ${code}`, retryable: true });
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EHOSTDOWN') return remoteError('unavailable', operation, `${where} cannot be reached from this network.`, { cause: `${CAUSE.unreachable}: ${code}`, retryable: true });
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timed out/i.test(e?.message ?? '')) return remoteError('unavailable', operation, `${where} did not answer in time.`, { cause: `${CAUSE.timeout}: ${code || 'timeout'}`, retryable: true });
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNABORTED' || /not connected|no response|connection (lost|closed)/i.test(e?.message ?? '')) return remoteError('unavailable', operation, `The connection to ${where} was lost.`, { cause: `${CAUSE.connectionLost}: ${code || e?.message}`, retryable: true });
  if (/certificate|self[- ]signed|TLS|SSL/i.test(code) || /certificate|self[- ]signed/i.test(e?.message ?? '')) return remoteError('permission_denied', operation, `The HTTPS certificate of ${where} was not accepted (${e?.message ?? code}). Orbis Files only connects to servers with a certificate your system trusts.`, { cause: `${CAUSE.tls}: ${code}` });
  return remoteError('io', operation, `A network error occurred with ${where}.`, { cause: code || e?.message, retryable: true });
}

export function isConnectionLost(err: unknown): boolean {
  return err instanceof OrbisError && !!err.shape.cause && (err.shape.cause.startsWith(CAUSE.connectionLost) || err.shape.cause.startsWith(CAUSE.timeout));
}
