import { z } from 'zod';

/**
 * Remote locations (SFTP, WebDAV, FTP/FTPS): connection definitions, the remote
 * reference format used for remote items across the process boundary, and
 * path rules shared by the main process and the renderer.
 *
 * A remote item is addressed by a reference string
 * `orbis-remote://<connectionId><absolute POSIX path>`, e.g.
 * `orbis-remote://k3j9x0aa/home/me/report.pdf`. It is never a local path:
 * the main process only ever resolves it through the connection it names.
 */

export const REMOTE_SCHEME = 'orbis-remote://';
export type RemoteProtocol = 'sftp' | 'webdav' | 'ftp';
/** FTPS flavour: explicit (AUTH TLS on the normal port) or implicit (TLS from the first byte, usually port 990). */
export type FtpTlsMode = 'explicit' | 'implicit';
/** Encoding of file names and server messages on an FTP connection. */
export type FtpEncoding = 'utf8' | 'latin1';

export const CONNECTION_ID = /^[a-z0-9]{8,32}$/;
export const RemoteIdSchema = z.string().regex(CONNECTION_ID);

/** Longest remote path accepted (bytes are checked by the servers themselves). */
export const REMOTE_PATH_MAX = 4096;
/** Secrets are only ever held in memory or encrypted with the OS secure storage. */
export const REMOTE_SECRET_MAX = 4096;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return LOOPBACK.has(h) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** Host names and IP literals (no scheme, path, user info or spaces). IPv6 literals without brackets. */
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$|^\d{1,3}(?:\.\d{1,3}){3}$|^[0-9A-Fa-f:]+$/;

export const remoteSecret = z.string().min(1).max(REMOTE_SECRET_MAX).refine((s) => !s.includes('\0'), 'Secrets cannot contain a null character.');

/**
 * What the user enters for a connection. `password`/`passphrase` are write-only:
 * undefined keeps a stored secret, null removes it, a string replaces it.
 */
export const RemoteConnectionInputSchema = z
  .object({
    id: RemoteIdSchema.optional(),
    name: z.string().trim().min(1).max(80),
    protocol: z.enum(['sftp', 'webdav', 'ftp']),
    host: z.string().trim().min(1).max(253).refine((h) => HOST_RE.test(h), 'Enter a host name or IP address (without “sftp://”, a path or a user name).'),
    port: z.number().int().min(1).max(65535),
    username: z.string().min(1).max(256).refine((u) => !/[\0\r\n:]/.test(u), 'The user name cannot contain “:”, line breaks or null characters.'),
    /** 'anonymous' (FTP only): signs in as an anonymous user, no password. */
    auth: z.enum(['password', 'key', 'anonymous']),
    /** SFTP private key file (absolute local path), read when connecting. */
    keyPath: z.string().max(4096).optional(),
    /** WebDAV: HTTPS (true) or plain HTTP (false). FTP: FTPS (true) or plain FTP (false). Ignored for SFTP. */
    secure: z.boolean().default(true),
    /** WebDAV over plain HTTP, or plain FTP, to a host other than this computer (explicit opt-in). */
    allowUnencrypted: z.boolean().default(false),
    /** FTPS: explicit (AUTH TLS) or implicit TLS. Ignored otherwise. */
    ftpTls: z.enum(['explicit', 'implicit']).default('explicit'),
    /** FTP: encoding of file names ('utf8' asks the server for UTF-8; 'latin1' for older servers). */
    encoding: z.enum(['utf8', 'latin1']).default('utf8'),
    /** Folder opened first ('' = the server's default: the home folder for SFTP, "/" for WebDAV). */
    startPath: z.string().max(REMOTE_PATH_MAX).default(''),
    /** 'stored': the secret is kept encrypted with the OS secure storage; 'ask': asked for when connecting. */
    secretMode: z.enum(['stored', 'ask']),
    password: remoteSecret.nullable().optional(),
    passphrase: remoteSecret.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.auth === 'key' && v.protocol !== 'sftp') ctx.addIssue({ code: 'custom', path: ['auth'], message: 'Key authentication is available for SFTP only.' });
    if (v.auth === 'key' && (!v.keyPath || !v.keyPath.trim())) ctx.addIssue({ code: 'custom', path: ['keyPath'], message: 'Choose the private key file.' });
    if (v.auth === 'anonymous' && v.protocol !== 'ftp') ctx.addIssue({ code: 'custom', path: ['auth'], message: 'Anonymous sign-in is available for FTP only.' });
    if (v.protocol === 'webdav' && !v.secure && !isLoopbackHost(v.host) && !v.allowUnencrypted) {
      ctx.addIssue({ code: 'custom', path: ['allowUnencrypted'], message: 'Plain HTTP sends the password and files unencrypted. Use HTTPS, or confirm “Allow unencrypted connection”.' });
    }
    if (v.protocol === 'ftp' && !v.secure && !isLoopbackHost(v.host) && !v.allowUnencrypted) {
      ctx.addIssue({ code: 'custom', path: ['allowUnencrypted'], message: 'Plain FTP sends the password and files unencrypted. Use FTPS, or confirm “Allow unencrypted connection”.' });
    }
    if (v.startPath && !isCleanRemotePath(v.startPath)) ctx.addIssue({ code: 'custom', path: ['startPath'], message: 'The start folder must be an absolute path such as /home/me (no “..”).' });
  });
export type RemoteConnectionInput = z.input<typeof RemoteConnectionInputSchema>;

/** A connection as the renderer sees it: never any secret, only whether one is stored. */
export interface RemoteConnectionInfo {
  id: string;
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  auth: 'password' | 'key' | 'anonymous';
  keyPath?: string;
  secure: boolean;
  allowUnencrypted: boolean;
  /** FTP connections only. */
  ftpTls?: FtpTlsMode;
  encoding?: FtpEncoding;
  startPath: string;
  secretMode: 'stored' | 'ask';
  /** A password (or key passphrase) is stored encrypted for this connection. */
  hasSecret: boolean;
  /** SFTP: the trusted host key of host:port; FTPS: the pinned certificate (trust on first use). */
  hostKey?: { fingerprint: string; algorithm: string; addedMs: number };
  connected: boolean;
}

export interface SecureStorageState {
  available: boolean;
  /** Why secrets cannot be saved (shown in the connection dialog). */
  reason?: string;
}

/**
 * An FTPS server certificate that the system does not trust (self-signed, expired, wrong name…),
 * shown so the user can check it before pinning it (trust on first use).
 */
export interface RemoteCertificateInfo {
  subject: string;
  issuer: string;
  /** ISO dates. */
  validFrom: string;
  validTo: string;
  /** Why the system does not trust it, in plain words (undefined when it does). */
  problem?: string;
}

export type RemoteConnectResult =
  | { status: 'connected'; home: string }
  /** The server needs the password (or the key's passphrase); `wrong` when the last one was refused. */
  | { status: 'needsSecret'; kind: 'password' | 'passphrase'; wrong?: boolean }
  /** First connection to this host: show the fingerprint (and for FTPS the certificate) and let the user decide. */
  | { status: 'hostKeyUnknown'; host: string; port: number; algorithm: string; fingerprint: string; certificate?: RemoteCertificateInfo }
  /** The stored host key (FTPS: pinned certificate) differs: refused. */
  | { status: 'hostKeyChanged'; host: string; port: number; algorithm: string; fingerprint: string; expected: string; certificate?: RemoteCertificateInfo };

/** SSH host key fingerprints (OpenSSH "SHA256:<base64>") or TLS certificate SHA-256 fingerprints ("AB:CD:…", 32 bytes). */
export const FINGERPRINT_RE = /^(SHA256:[A-Za-z0-9+/]{43}|[0-9A-F]{2}(:[0-9A-F]{2}){31})$/;

/** A local copy of a remote file opened with the default app. */
export interface RemoteOpenedCopy {
  localPath: string;
  ref: string;
  name: string;
  connectionName: string;
  openedMs: number;
  /** The local copy changed since it was downloaded (size or modification time). */
  changed: boolean;
  uploadedMs?: number;
}

// ------------------------------------------------------------------ paths

/** Absolute POSIX path without NUL, backslash-free segments of "." or "..", or empty segments in the middle. */
export function isCleanRemotePath(p: string): boolean {
  if (!p.startsWith('/') || p.includes('\0') || p.length > REMOTE_PATH_MAX) return false;
  const segs = p.split('/').slice(1);
  if (segs.length && segs[segs.length - 1] === '') segs.pop();
  return segs.every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Normalise a clean remote path: no trailing slash except the root. Throws on anything else. */
export function normalizeRemotePath(p: string): string {
  if (!isCleanRemotePath(p)) throw new Error('Invalid remote path.');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** Why a name from a server or the user cannot be used, or undefined when it can. */
export function remoteNameProblem(name: string): string | undefined {
  if (!name) return 'The name is empty.';
  if (name === '.' || name === '..') return 'This name is reserved.';
  if (name.includes('/')) return 'The name contains “/”.';
  if (name.includes('\0')) return 'The name contains a null character.';
  if (name.includes('\\')) return 'The name contains “\\”.';
  if (/[\r\n]/.test(name)) return 'The name contains a line break.';
  if (new TextEncoder().encode(name).length > 255) return 'The name is longer than 255 bytes.';
  return undefined;
}

export function remoteJoin(dir: string, name: string): string {
  const problem = remoteNameProblem(name);
  if (problem) throw new Error(problem);
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

export function remoteParent(p: string): string | undefined {
  if (p === '/') return undefined;
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function remoteBase(p: string): string {
  return p === '/' ? '/' : p.slice(p.lastIndexOf('/') + 1);
}

export function isWithinRemote(parent: string, child: string): boolean {
  if (parent === child) return true;
  return child.startsWith(parent === '/' ? '/' : `${parent}/`);
}

// ------------------------------------------------------------------ references

export function remoteRef(connectionId: string, p: string): string {
  return `${REMOTE_SCHEME}${connectionId}${p}`;
}

export function isRemoteRef(s: string): boolean {
  return typeof s === 'string' && s.startsWith(REMOTE_SCHEME);
}

/** Parse and validate a reference; returns null for anything malformed (including "..", NUL, relative paths). */
export function parseRemoteRef(s: string): { connectionId: string; path: string } | null {
  if (!isRemoteRef(s)) return null;
  const rest = s.slice(REMOTE_SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const connectionId = rest.slice(0, slash);
  const p = rest.slice(slash);
  if (!CONNECTION_ID.test(connectionId) || !isCleanRemotePath(p)) return null;
  return { connectionId, path: normalizeRemotePath(p) };
}

export function remoteRefParent(ref: string): string | undefined {
  const r = parseRemoteRef(ref);
  if (!r) return undefined;
  const parent = remoteParent(r.path);
  return parent === undefined ? undefined : remoteRef(r.connectionId, parent);
}

/** Short protocol name for the connection strip and the sidebar. */
export function remoteProtocolLabel(c: Pick<RemoteConnectionInfo, 'protocol' | 'secure'>): string {
  if (c.protocol === 'sftp') return 'SFTP';
  if (c.protocol === 'ftp') return c.secure ? 'FTPS' : 'FTP';
  return 'WebDAV';
}

/** URL scheme of a connection: sftp, davs/dav, ftp, ftpes (explicit FTPS) or ftps (implicit FTPS). */
export function remoteScheme(c: Pick<RemoteConnectionInfo, 'protocol' | 'secure' | 'ftpTls'>): string {
  if (c.protocol === 'sftp') return 'sftp';
  if (c.protocol === 'ftp') return !c.secure ? 'ftp' : c.ftpTls === 'implicit' ? 'ftps' : 'ftpes';
  return c.secure ? 'davs' : 'dav';
}

/** "sftp://me@example.org:2222/home/me" — for display and "Copy remote address" (never with a password). */
export function remoteDisplayUrl(c: Pick<RemoteConnectionInfo, 'protocol' | 'host' | 'port' | 'username' | 'secure' | 'ftpTls'>, p: string): string {
  const scheme = remoteScheme(c);
  const host = c.host.includes(':') ? `[${c.host}]` : c.host;
  const encoded = p.split('/').map((s) => encodeURIComponent(s)).join('/');
  return `${scheme}://${encodeURIComponent(c.username)}@${host}${c.port === defaultPort(c.protocol, c.secure, c.ftpTls) ? '' : `:${c.port}`}${encoded}`;
}

export function defaultPort(protocol: RemoteProtocol, secure: boolean, ftpTls?: FtpTlsMode): number {
  if (protocol === 'ftp') return secure && ftpTls === 'implicit' ? 990 : 21;
  return protocol === 'sftp' ? 22 : secure ? 443 : 80;
}

/** Remote operations: what a 'remote-transfer' request carries in params. */
export const RemoteTransferParamsSchema = z.object({ mode: z.enum(['copy', 'move']) }).strict();
