import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import { makeError, OrbisError } from '../../shared/errors';
import type { FileEntry } from '../../shared/model';
import {
  CONNECTION_ID, defaultPort, isCleanRemotePath, normalizeRemotePath, parseRemoteRef, remoteBase, remoteRef, RemoteConnectionInputSchema,
  type RemoteConnectionInfo, type RemoteConnectionInput, type RemoteConnectResult, type RemoteOpenedCopy, type SecureStorageState,
} from '../../shared/remote';
import { extOf } from '../fs/FileSystemService';
import { validateName } from '../fs/paths';
import type { Logger } from '../log';
import { checkPrivateKey, connectSftp, HostKeyError, type HostKeyInfo } from './sftp';
import { WebDavFs } from './webdav';
import { FtpFs } from './ftp';
import { CAUSE, isConnectionLost, remoteError, type RemoteEntry, type RemoteFs } from './types';
import { NO_SECRET_STORAGE, type SecretBox } from './secrets';

/** Key-value storage of the profile (Catalog in the app). */
export interface KvStore {
  getKv<T>(key: string, fallback: T): T;
  setKv(key: string, value: unknown): void;
}

const StoredSchema = z.object({
  id: z.string().regex(CONNECTION_ID),
  name: z.string().min(1).max(80),
  protocol: z.enum(['sftp', 'webdav', 'ftp']),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(256),
  auth: z.enum(['password', 'key', 'anonymous']),
  ftpTls: z.enum(['explicit', 'implicit']).optional(),
  encoding: z.enum(['utf8', 'latin1']).optional(),
  keyPath: z.string().max(4096).optional(),
  secure: z.boolean(),
  allowUnencrypted: z.boolean(),
  startPath: z.string().max(4096),
  secretMode: z.enum(['stored', 'ask']),
  createdMs: z.number(),
});
type Stored = z.infer<typeof StoredSchema>;

const KEY_CONNECTIONS = 'remote.connections.v1';
const KEY_HOSTS = 'remote.knownHosts.v1';
const secretKey = (id: string) => `remote.secret.${id}`;
/** Where a trusted SSH host key (host:port) or a pinned FTPS certificate (ftps:host:port) is kept. */
const hostKeyId = (host: string, port: number, protocol: Stored['protocol'] = 'sftp') => `${protocol === 'ftp' ? 'ftps:' : ''}${host.toLowerCase()}:${port}`;

/** Largest private key file read (OpenSSH keys are a few KB). */
const KEY_FILE_MAX = 64 * 1024;
/** Previews download at most this much. */
export const REMOTE_PREVIEW_MAX = 20 * 1024 * 1024;
/** Connections unused for this long are closed. */
const IDLE_MS = 10 * 60 * 1000;
const PART = '.orbis-part-';

export interface RemoteServiceOptions {
  kv: KvStore;
  secrets?: SecretBox;
  log?: Logger;
  /** Where opened copies of remote files are kept (inside the profile). */
  copiesDir: string;
  /** Where preview copies go (private scratch space, removed at quit). */
  scratchDir: string;
  /** Tests: shorter timeouts, a CA for HTTPS test servers. */
  connectTimeoutMs?: number;
  webdavCa?: string | Buffer;
  /** Tests: an extra certificate authority FTPS servers may be verified against. */
  ftpsCa?: string | Buffer;
}

interface Pooled { fs: RemoteFs; lastUsed: number; home: string }
interface OpenedCopy { localPath: string; ref: string; remote: { size?: number; modifiedMs?: number; etag?: string }; local: { size: number; mtimeMs: number }; openedMs: number; changed: boolean; uploadedMs?: number }

/**
 * Remote connections: definitions (no secrets in them), secrets encrypted with
 * the OS secure storage (or asked for and kept in memory for the session),
 * SFTP host keys trusted on first use, a pool of open connections (reused,
 * reconnected on loss, closed when idle) and the local copies of opened files.
 *
 * Secrets never leave the main process: `list()` reports only whether one is stored.
 */
export class RemoteService extends EventEmitter {
  private pool = new Map<string, Pooled>();
  private connecting = new Map<string, Promise<RemoteConnectResult>>();
  /** "Ask every time" secrets (and secrets typed when none was stored), for this session only. */
  private session = new Map<string, string>();
  /** Host keys a server presented that the user has not decided about yet (host:port → info). */
  private offered = new Map<string, HostKeyInfo & { ms: number }>();
  private opened = new Map<string, OpenedCopy>();
  private idleTimer: NodeJS.Timeout;
  private readonly box: SecretBox;

  constructor(private readonly o: RemoteServiceOptions) {
    super();
    this.box = o.secrets ?? NO_SECRET_STORAGE;
    this.idleTimer = setInterval(() => this.closeIdle(), 60_000);
    this.idleTimer.unref();
  }

  // ------------------------------------------------------------------ definitions

  private stored(): Stored[] {
    const raw = this.o.kv.getKv<unknown[]>(KEY_CONNECTIONS, []);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((r) => {
      const p = StoredSchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
  }

  private conn(id: string): Stored {
    const c = this.stored().find((x) => x.id === id);
    if (!c) throw makeError('not_found', 'remote.connection', { message: 'This remote connection no longer exists.' });
    return c;
  }

  private knownHosts(): Record<string, { fingerprint: string; algorithm: string; addedMs: number }> {
    const v = this.o.kv.getKv<Record<string, { fingerprint: string; algorithm: string; addedMs: number }>>(KEY_HOSTS, {});
    return v && typeof v === 'object' ? v : {};
  }

  storage(): SecureStorageState {
    return this.box.state();
  }

  private storedSecret(id: string): string | undefined {
    const enc = this.o.kv.getKv<string | null>(secretKey(id), null);
    if (!enc || !this.box.state().available) return undefined;
    try {
      return this.box.decrypt(enc);
    } catch {
      return undefined;
    }
  }

  private info(c: Stored): RemoteConnectionInfo {
    const hk = c.protocol === 'sftp' || (c.protocol === 'ftp' && c.secure) ? this.knownHosts()[hostKeyId(c.host, c.port, c.protocol)] : undefined;
    return {
      id: c.id, name: c.name, protocol: c.protocol, host: c.host, port: c.port, username: c.username, auth: c.auth, keyPath: c.keyPath,
      secure: c.secure, allowUnencrypted: c.allowUnencrypted, startPath: c.startPath, secretMode: c.secretMode,
      ...(c.protocol === 'ftp' ? { ftpTls: c.ftpTls ?? 'explicit', encoding: c.encoding ?? 'utf8' } : {}),
      hasSecret: !!this.o.kv.getKv<string | null>(secretKey(c.id), null),
      hostKey: hk ? { fingerprint: hk.fingerprint, algorithm: hk.algorithm, addedMs: hk.addedMs } : undefined,
      connected: !!this.pool.get(c.id)?.fs.alive,
    };
  }

  list(): RemoteConnectionInfo[] {
    return this.stored().map((c) => this.info(c));
  }

  get(id: string): RemoteConnectionInfo {
    return this.info(this.conn(id));
  }

  /**
   * Create or change a connection. The secret is write-only. A stored secret
   * belongs to the server it was entered for: changing the protocol, host,
   * port or user name removes it unless a new one is given.
   */
  save(input: RemoteConnectionInput): RemoteConnectionInfo {
    const v = RemoteConnectionInputSchema.parse(input);
    if (v.auth === 'key' && v.keyPath && !path.isAbsolute(v.keyPath)) throw makeError('validation', 'remote.save', { message: 'The key file must be an absolute path.' });
    const all = this.stored();
    const prev = v.id ? all.find((c) => c.id === v.id) : undefined;
    if (v.id && !prev) throw makeError('not_found', 'remote.save', { message: 'This remote connection no longer exists.' });
    // Anonymous FTP has no secret: anything stored before is removed.
    const secret = v.auth === 'anonymous' ? null : v.auth === 'key' ? v.passphrase : v.password;
    const wantsStore = v.secretMode === 'stored';
    if (wantsStore && typeof secret === 'string' && !this.box.state().available) {
      throw makeError('unavailable', 'remote.save', { message: `${this.box.state().reason ?? 'Secure credential storage is not available.'} Choose “Ask every time”.` });
    }
    const id = prev?.id ?? crypto.randomBytes(8).toString('hex');
    const canBePlain = v.protocol === 'webdav' || v.protocol === 'ftp';
    const next: Stored = {
      id, name: v.name.trim(), protocol: v.protocol, host: v.host.trim(), port: v.port, username: v.auth === 'anonymous' ? 'anonymous' : v.username, auth: v.auth,
      keyPath: v.auth === 'key' ? v.keyPath : undefined, secure: canBePlain ? v.secure : true,
      allowUnencrypted: canBePlain && !v.secure ? v.allowUnencrypted : false,
      ...(v.protocol === 'ftp' ? { ftpTls: v.ftpTls, encoding: v.encoding } : {}),
      startPath: v.startPath ? normalizeRemotePath(v.startPath) : '', secretMode: v.secretMode, createdMs: prev?.createdMs ?? Date.now(),
    };
    const serverChanged = !!prev && (prev.protocol !== next.protocol || prev.host.toLowerCase() !== next.host.toLowerCase() || prev.port !== next.port || prev.username !== next.username || prev.auth !== next.auth || prev.keyPath !== next.keyPath);
    this.o.kv.setKv(KEY_CONNECTIONS, prev ? all.map((c) => (c.id === id ? next : c)) : [...all, next]);
    // Secrets: a new one replaces; null, "ask every time" or a changed server removes the stored one.
    if (!wantsStore || secret === null || (serverChanged && secret === undefined)) this.o.kv.setKv(secretKey(id), null);
    if (wantsStore && typeof secret === 'string') this.o.kv.setKv(secretKey(id), this.box.encrypt(secret));
    if (serverChanged || secret !== undefined) this.session.delete(id);
    if (typeof secret === 'string' && !wantsStore) this.session.set(id, secret);
    if (prev) this.disconnect(id);
    this.o.log?.info('remote.saved', { id, protocol: next.protocol, secretMode: next.secretMode, edited: !!prev });
    this.emit('changed');
    return this.info(next);
  }

  remove(id: string): void {
    this.conn(id);
    this.disconnect(id);
    this.session.delete(id);
    this.o.kv.setKv(secretKey(id), null);
    this.o.kv.setKv(KEY_CONNECTIONS, this.stored().filter((c) => c.id !== id));
    this.o.log?.info('remote.removed', { id });
    this.emit('changed');
  }

  /** Forget the trusted host key of a connection's server (the next connection asks again). */
  forgetHostKey(id: string): void {
    const c = this.conn(id);
    const hosts = { ...this.knownHosts() };
    delete hosts[hostKeyId(c.host, c.port, c.protocol)];
    this.o.kv.setKv(KEY_HOSTS, hosts);
    this.disconnect(id);
    this.o.log?.info('remote.host_key_forgotten', { id });
    this.emit('changed');
  }

  /** Trust the host key the server presented in the last connection attempt (must be the same fingerprint). */
  trustHostKey(id: string, fingerprint: string): RemoteConnectionInfo {
    const c = this.conn(id);
    const key = hostKeyId(c.host, c.port, c.protocol);
    const offer = this.offered.get(key);
    if (!offer || offer.fingerprint !== fingerprint || Date.now() - offer.ms > 15 * 60_000) {
      throw makeError('validation', 'remote.trustHostKey', { message: 'This fingerprint was not the one the server presented. Connect again to see it.' });
    }
    if (this.knownHosts()[key]) {
      throw makeError('validation', 'remote.trustHostKey', { message: c.protocol === 'ftp' ? 'A different certificate is already trusted for this server. Forget it first (Edit connection → Forget certificate) if you are sure the server changed.' : 'A different host key is already trusted for this server. Forget it first (Edit connection → Forget host key) if you are sure the server changed.' });
    }
    this.o.kv.setKv(KEY_HOSTS, { ...this.knownHosts(), [key]: { fingerprint: offer.fingerprint, algorithm: offer.algorithm, addedMs: Date.now() } });
    this.offered.delete(key);
    this.o.log?.info('remote.host_key_trusted', { id, algorithm: offer.algorithm });
    this.emit('changed');
    return this.info(c);
  }

  // ------------------------------------------------------------------ connections

  /**
   * Connect (or confirm an open connection). Interaction the user must give
   * (a password, a host key decision) is returned as a status, not thrown.
   */
  connect(id: string, secret?: string): Promise<RemoteConnectResult> {
    const pooled = this.pool.get(id);
    if (pooled?.fs.alive && secret === undefined) {
      pooled.lastUsed = Date.now();
      return Promise.resolve({ status: 'connected', home: pooled.home });
    }
    const running = this.connecting.get(id);
    if (running && secret === undefined) return running;
    const p = this.doConnect(id, secret).finally(() => {
      if (this.connecting.get(id) === p) this.connecting.delete(id);
    });
    this.connecting.set(id, p);
    return p;
  }

  private async doConnect(id: string, typed?: string): Promise<RemoteConnectResult> {
    const c = this.conn(id);
    this.pool.get(id)?.fs.close();
    this.pool.delete(id);
    const fromUser = typed !== undefined;
    const secret = typed ?? this.session.get(id) ?? (c.secretMode === 'stored' ? this.storedSecret(id) : undefined);
    let fs: RemoteFs;
    try {
      if (c.protocol === 'sftp') {
        let privateKey: Buffer | undefined;
        if (c.auth === 'key') {
          privateKey = await readKeyFile(c.keyPath ?? '');
          const k = checkPrivateKey(privateKey, secret);
          if (k === 'needs-passphrase') return secret ? { status: 'needsSecret', kind: 'passphrase', wrong: true } : { status: 'needsSecret', kind: 'passphrase' };
          if (k === 'wrong-passphrase') {
            this.session.delete(id);
            return { status: 'needsSecret', kind: 'passphrase', wrong: true };
          }
          if (k === 'invalid') throw makeError('validation', 'remote.connect', { message: 'The key file is not a private key Orbis Files can use (OpenSSH, PEM RSA/ECDSA/Ed25519).' });
        } else if (!secret) return { status: 'needsSecret', kind: 'password' };
        fs = await connectSftp({
          host: c.host, port: c.port, username: c.username,
          password: c.auth === 'password' ? secret : undefined,
          privateKey, passphrase: c.auth === 'key' ? secret : undefined,
          readyTimeoutMs: this.o.connectTimeoutMs,
          checkHostKey: (info) => {
            const known = this.knownHosts()[hostKeyId(info.host, info.port, 'sftp')];
            if (known && known.fingerprint === info.fingerprint) return 'accept';
            this.offered.set(hostKeyId(info.host, info.port, 'sftp'), { ...info, ms: Date.now() });
            return known ? { changed: known.fingerprint } : 'unknown';
          },
        });
      } else if (c.protocol === 'ftp') {
        const anonymous = c.auth === 'anonymous';
        if (!anonymous && !secret) return { status: 'needsSecret', kind: 'password' };
        const ftp = await FtpFs.connect({
          host: c.host, port: c.port, username: c.username, password: anonymous ? undefined : secret, anonymous,
          tls: c.secure ? (c.ftpTls ?? 'explicit') : 'none', encoding: c.encoding ?? 'utf8', allowUnencrypted: c.allowUnencrypted,
          timeoutMs: this.o.connectTimeoutMs, ca: this.o.ftpsCa,
          // Certificates the system trusts are accepted; others only when pinned (trust on first use). A pin always wins.
          checkCert: (info, systemTrusted) => {
            const key = hostKeyId(info.host, info.port, 'ftp');
            const known = this.knownHosts()[key];
            if (known && known.fingerprint === info.fingerprint) return 'accept';
            if (!known && systemTrusted) return 'accept';
            this.offered.set(key, { ...info, ms: Date.now() });
            return known ? { changed: known.fingerprint } : 'unknown';
          },
        });
        if (c.startPath) {
          try {
            const st = await ftp.stat(c.startPath);
            if (st.kind !== 'directory') throw makeError('not_a_directory', 'remote.connect', { message: 'The start folder is not a folder on the server.' });
          } catch (err) {
            ftp.close();
            throw err;
          }
        }
        fs = ftp;
      } else {
        if (!secret) return { status: 'needsSecret', kind: 'password' };
        const dav = new WebDavFs({ host: c.host, port: c.port, secure: c.secure, username: c.username, password: secret, allowUnencrypted: c.allowUnencrypted, timeoutMs: this.o.connectTimeoutMs, ca: this.o.webdavCa });
        try {
          const st = await dav.check(c.startPath || '/');
          if (st.kind !== 'directory') throw makeError('not_a_directory', 'remote.connect', { message: 'The start folder is not a folder on the server.' });
        } catch (err) {
          dav.close();
          throw err;
        }
        fs = dav;
      }
    } catch (err) {
      if (err instanceof HostKeyError) {
        this.o.log?.warn(err.expected ? 'remote.host_key_changed' : 'remote.host_key_unknown', { id, algorithm: err.info.algorithm });
        const base = { host: err.info.host, port: err.info.port, algorithm: err.info.algorithm, fingerprint: err.info.fingerprint, ...(err.info.certificate ? { certificate: err.info.certificate } : {}) };
        return err.expected ? { status: 'hostKeyChanged', ...base, expected: err.expected } : { status: 'hostKeyUnknown', ...base };
      }
      if (err instanceof OrbisError && err.shape.cause?.startsWith(CAUSE.authFailed) && c.auth === 'password') {
        this.session.delete(id);
        this.o.log?.info('remote.auth_failed', { id, protocol: c.protocol });
        return { status: 'needsSecret', kind: 'password', wrong: true };
      }
      this.o.log?.info('remote.connect_failed', { id, protocol: c.protocol, category: err instanceof OrbisError ? err.shape.category : 'internal', cause: err instanceof OrbisError ? err.shape.cause?.slice(0, 120) : undefined });
      throw err;
    }
    // Keep a secret typed now for this session (or store it, when the user chose to and it is possible).
    if (fromUser && typed) {
      if (c.secretMode === 'stored' && this.box.state().available) this.o.kv.setKv(secretKey(id), this.box.encrypt(typed));
      else this.session.set(id, typed);
    }
    let home = '/';
    try {
      home = c.startPath ? normalizeRemotePath(c.startPath) : await fs.home();
    } catch {
      home = '/';
    }
    this.pool.set(id, { fs, lastUsed: Date.now(), home });
    this.o.log?.info('remote.connected', { id, protocol: c.protocol });
    this.emit('changed');
    return { status: 'connected', home };
  }

  disconnect(id: string): void {
    const p = this.pool.get(id);
    this.pool.delete(id);
    if (p) {
      p.fs.close();
      this.o.log?.info('remote.disconnected', { id });
      this.emit('changed');
    }
  }

  /** Disconnect and forget "ask every time" secrets. */
  forgetSession(id: string): void {
    this.session.delete(id);
    this.disconnect(id);
  }

  private closeIdle(): void {
    const now = Date.now();
    for (const [id, p] of this.pool) if (now - p.lastUsed > IDLE_MS || !p.fs.alive) this.disconnect(id);
  }

  /**
   * An open connection for operations and listings: reused, or opened again
   * without asking anything (a stored or session secret, a trusted host key).
   * When the user would have to answer something, this throws instead.
   */
  async fs(id: string): Promise<RemoteFs> {
    const p = this.pool.get(id);
    if (p?.fs.alive) {
      p.lastUsed = Date.now();
      return p.fs;
    }
    const name = this.conn(id).name;
    const r = await this.connect(id);
    if (r.status === 'connected') return this.pool.get(id)!.fs;
    if (r.status === 'needsSecret') throw remoteError('permission_denied', 'remote.connect', `Connect to “${name}” first: it needs your ${r.kind === 'passphrase' ? 'key passphrase' : 'password'}.`, { cause: CAUSE.needsSecret });
    const what = r.certificate ? 'certificate' : 'host key';
    if (r.status === 'hostKeyChanged') throw remoteError('permission_denied', 'remote.connect', `The ${what} of “${name}” has changed. Orbis Files did not connect.`, { cause: CAUSE.hostKeyChanged });
    throw remoteError('permission_denied', 'remote.connect', `Connect to “${name}” first to confirm its ${what}.`, { cause: CAUSE.hostKeyUnknown });
  }

  /** Run a read-only call, reconnecting once if the connection was lost. */
  async withFs<T>(id: string, fn: (fs: RemoteFs) => Promise<T>): Promise<T> {
    const first = await this.fs(id);
    try {
      return await fn(first);
    } catch (err) {
      if (!isConnectionLost(err)) throw err;
      this.disconnect(id);
      return fn(await this.fs(id));
    }
  }

  home(id: string): string | undefined {
    return this.pool.get(id)?.home;
  }

  /** A transfer is using the connection (keeps long transfers from being closed as idle). */
  touch(id: string): void {
    const p = this.pool.get(id);
    if (p) p.lastUsed = Date.now();
  }

  closeAll(): void {
    for (const id of [...this.pool.keys()]) this.disconnect(id);
    clearInterval(this.idleTimer);
    for (const c of this.opened.values()) fs.unwatchFile(c.localPath);
  }

  // ------------------------------------------------------------------ browsing

  toFileEntry(id: string, e: RemoteEntry, linkTargetKind?: RemoteEntry['kind']): FileEntry {
    return {
      path: remoteRef(id, e.path), name: e.name, kind: e.kind, size: e.size, modifiedMs: e.modifiedMs, ext: e.kind === 'directory' ? '' : extOf(e.name),
      hidden: e.name.startsWith('.'), mode: e.mode, ...(e.kind === 'symlink' ? { linkTargetKind: linkTargetKind ?? 'broken' } : {}),
    };
  }

  async listDir(id: string, dir: string, showHidden: boolean): Promise<{ entries: FileEntry[]; refused: string[] }> {
    const d = normalizeRemotePath(dir);
    const r = await this.withFs(id, (f) => f.list(d));
    // Temporary files of transfers in progress are never shown; hidden items only when asked.
    const shown = r.entries.filter((e) => !e.name.startsWith(PART) && (showHidden || !e.name.startsWith('.')));
    // Links (SFTP, FTP): find what they point to (bounded), so folders behind links can be opened.
    const f = await this.fs(id);
    const links = shown.filter((e) => e.kind === 'symlink').slice(0, 200);
    const targets = new Map<string, RemoteEntry['kind'] | undefined>();
    if (f.linkTargetKind) for (const l of links) targets.set(l.path, await f.linkTargetKind(l.path));
    if (r.refused.length) this.o.log?.warn('remote.list_refused', { id, count: r.refused.length });
    return { entries: shown.map((e) => this.toFileEntry(id, e, targets.get(e.path))), refused: r.refused };
  }

  async stat(ref: string): Promise<FileEntry> {
    const r = this.parse(ref, 'remote.stat');
    const e = await this.withFs(r.connectionId, (f) => f.stat(r.path));
    return this.toFileEntry(r.connectionId, e);
  }

  parse(ref: string, operation: string): { connectionId: string; path: string } {
    const r = parseRemoteRef(ref);
    if (!r) throw makeError('invalid_path', operation, { message: 'This is not a valid remote location.' });
    this.conn(r.connectionId);
    return r;
  }

  async mkdir(id: string, parent: string, name: string): Promise<FileEntry> {
    const v = validateRemoteName(name, 'remote.mkdir');
    const p = joinChecked(normalizeRemotePath(parent), v);
    const f = await this.fs(id);
    await f.mkdir(p);
    this.o.log?.info('remote.mkdir', { id });
    return this.toFileEntry(id, await f.stat(p));
  }

  async rename(ref: string, newName: string): Promise<FileEntry> {
    const r = this.parse(ref, 'remote.rename');
    if (r.path === '/') throw makeError('invalid_path', 'remote.rename', { message: 'The top folder of a server cannot be renamed.' });
    const name = validateRemoteName(newName, 'remote.rename');
    const parent = r.path.slice(0, r.path.lastIndexOf('/')) || '/';
    const to = joinChecked(parent, name);
    const f = await this.fs(r.connectionId);
    if (to !== r.path) {
      // A case-only change is a rename of the same item, not a clash.
      const existing = await f.stat(to).catch(() => undefined);
      if (existing && to.toLowerCase() !== r.path.toLowerCase()) throw makeError('already_exists', 'remote.rename', { message: `“${name}” already exists in this folder on the server.` });
      await f.rename(r.path, to, { overwrite: false });
    }
    this.o.log?.info('remote.rename', { id: r.connectionId });
    return this.toFileEntry(r.connectionId, await f.stat(to));
  }

  // ------------------------------------------------------------------ local copies

  /** Download a file into a new private folder (0700, file 0600). Never touches an existing local file. */
  private async download(ref: string, intoDir: string, opts: { maxBytes?: number; signal?: AbortSignal; progress?: (done: number, total?: number) => void }): Promise<{ localPath: string; remote: RemoteEntry }> {
    const r = this.parse(ref, 'remote.download');
    const f = await this.fs(r.connectionId);
    const st = await f.stat(r.path);
    if (st.kind !== 'file') throw makeError('is_a_directory', 'remote.download', { message: st.kind === 'directory' ? 'Folders cannot be opened as files.' : 'Only regular files can be opened.' });
    if (opts.maxBytes !== undefined && (st.size ?? 0) > opts.maxBytes) {
      throw makeError('unsupported', 'remote.preview', { message: `The file is larger than ${Math.round(opts.maxBytes / 1024 / 1024)} MB, too large to preview. Open it or copy it to this computer instead.` });
    }
    await fsp.mkdir(intoDir, { recursive: true, mode: 0o700 });
    const dir = await fsp.mkdtemp(path.join(intoDir, 'c-'));
    await fsp.chmod(dir, 0o700).catch(() => undefined);
    const name = safeLocalName(remoteBase(r.path));
    const tmp = path.join(dir, `${PART}${crypto.randomUUID()}`);
    const target = path.join(dir, name);
    let done = 0;
    const touch = () => this.touch(r.connectionId);
    try {
      const src = await f.read(r.path, { signal: opts.signal });
      const counter = new Transform({
        transform(chunk: Buffer, _e, cb) {
          done += chunk.length;
          touch();
          if (opts.maxBytes !== undefined && done > opts.maxBytes) return cb(makeError('unsupported', 'remote.preview', { message: 'The file grew beyond the preview limit while it was read.' }));
          opts.progress?.(done, st.size);
          cb(null, chunk);
        },
      });
      await pipeline(src, counter, fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 }), opts.signal ? { signal: opts.signal } : {});
      if (st.size !== undefined && done !== st.size) throw makeError('io', 'remote.download', { message: 'The downloaded size does not match the size on the server (the file may have changed while it was read).', retryable: true });
      if (st.modifiedMs) await fsp.utimes(tmp, new Date(), new Date(st.modifiedMs)).catch(() => undefined);
      await fsp.rename(tmp, target);
    } catch (err) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if (opts.signal?.aborted) throw makeError('cancelled', 'remote.download');
      throw err;
    }
    return { localPath: target, remote: st };
  }

  /** A size-limited private copy for the preview (removed at quit with the scratch folder). */
  async previewCopy(ref: string, signal?: AbortSignal): Promise<string> {
    const { localPath } = await this.download(ref, path.join(this.o.scratchDir, 'remote-preview'), { maxBytes: REMOTE_PREVIEW_MAX, signal });
    return localPath;
  }

  /** Download a file to open it with its default app; the copy is watched for changes ("Upload changes"). */
  async openCopy(ref: string, signal?: AbortSignal, progress?: (done: number, total?: number) => void): Promise<string> {
    const { localPath, remote } = await this.download(ref, this.o.copiesDir, { signal, progress });
    const st = await fsp.stat(localPath);
    const rec: OpenedCopy = { localPath, ref, remote: { size: remote.size, modifiedMs: remote.modifiedMs, etag: remote.etag }, local: { size: st.size, mtimeMs: st.mtimeMs }, openedMs: Date.now(), changed: false };
    this.opened.set(localPath, rec);
    fs.watchFile(localPath, { interval: 1500, persistent: false }, (cur) => {
      const changed = cur.size !== rec.local.size || cur.mtimeMs !== rec.local.mtimeMs;
      if (changed !== rec.changed) {
        rec.changed = changed;
        this.emit('opened', this.openedCopies());
      }
    });
    this.o.log?.info('remote.opened_copy', { id: parseRemoteRef(ref)?.connectionId });
    this.emit('opened', this.openedCopies());
    return localPath;
  }

  openedCopies(): RemoteOpenedCopy[] {
    return [...this.opened.values()].map((c) => {
      const r = parseRemoteRef(c.ref);
      const name = r ? (this.stored().find((x) => x.id === r.connectionId)?.name ?? 'Removed connection') : '';
      return { localPath: c.localPath, ref: c.ref, name: path.basename(c.localPath), connectionName: name, openedMs: c.openedMs, changed: c.changed, uploadedMs: c.uploadedMs };
    }).sort((a, b) => b.openedMs - a.openedMs);
  }

  openedCopy(localPath: string): OpenedCopy | undefined {
    return this.opened.get(localPath);
  }

  /** After "Upload changes": the copy and the server now agree. */
  markUploaded(localPath: string, remote: RemoteEntry, local: { size: number; mtimeMs: number }): void {
    const c = this.opened.get(localPath);
    if (!c) return;
    c.remote = { size: remote.size, modifiedMs: remote.modifiedMs, etag: remote.etag };
    c.local = local;
    c.changed = false;
    c.uploadedMs = Date.now();
    this.emit('opened', this.openedCopies());
  }

  /** Stop tracking an opened copy and delete it. */
  async discardCopy(localPath: string): Promise<void> {
    const c = this.opened.get(localPath);
    if (!c) throw makeError('not_found', 'remote.discardCopy', { message: 'This copy is no longer tracked.' });
    fs.unwatchFile(localPath);
    this.opened.delete(localPath);
    await fsp.rm(path.dirname(localPath), { recursive: true, force: true }).catch(() => undefined);
    this.emit('opened', this.openedCopies());
  }

  /** At quit: copies without unsaved edits are deleted; edited ones are kept (and reported at the next start). */
  cleanupCopiesSync(): void {
    for (const c of this.opened.values()) {
      fs.unwatchFile(c.localPath);
      let changed = c.changed;
      try {
        const st = fs.statSync(c.localPath);
        changed = st.size !== c.local.size || st.mtimeMs !== c.local.mtimeMs;
      } catch {
        changed = false;
      }
      if (!changed) fs.rmSync(path.dirname(c.localPath), { recursive: true, force: true });
    }
    this.opened.clear();
  }

  /** At start: copies kept from earlier sessions (older than 14 days are removed). */
  async leftoverCopies(): Promise<{ kept: number; removed: number; dir: string }> {
    let kept = 0;
    let removed = 0;
    const names = await fsp.readdir(this.o.copiesDir).catch(() => [] as string[]);
    for (const n of names) {
      const p = path.join(this.o.copiesDir, n);
      const st = await fsp.stat(p).catch(() => undefined);
      if (!st) continue;
      if (Date.now() - st.mtimeMs > 14 * 86400_000) {
        await fsp.rm(p, { recursive: true, force: true }).catch(() => undefined);
        removed++;
      } else kept++;
    }
    return { kept, removed, dir: this.o.copiesDir };
  }
}

async function readKeyFile(p: string): Promise<Buffer> {
  if (!p || !path.isAbsolute(p)) throw makeError('validation', 'remote.connect', { message: 'Choose the private key file in the connection settings.' });
  const st = await fsp.stat(p).catch(() => undefined);
  if (!st?.isFile()) throw makeError('not_found', 'remote.connect', { message: 'The private key file could not be found.', target: p });
  if (st.size > KEY_FILE_MAX) throw makeError('validation', 'remote.connect', { message: 'The chosen file is too large to be a private key.' });
  return fsp.readFile(p);
}

export function validateRemoteName(name: string, operation: string): string {
  const v = validateName(name, 'linux');
  if (!v.valid) throw makeError('invalid_name', operation, { message: v.reason });
  if (name.includes('\\') || /[\r\n]/.test(name)) throw makeError('invalid_name', operation, { message: 'The name cannot contain “\\” or line breaks.' });
  if (name.startsWith(PART)) throw makeError('invalid_name', operation, { message: 'This name is reserved for temporary files.' });
  return name;
}

function joinChecked(parent: string, name: string): string {
  const p = parent === '/' ? `/${name}` : `${parent}/${name}`;
  if (!isCleanRemotePath(p)) throw makeError('invalid_name', 'remote.path', { message: 'The name is not valid.' });
  return p;
}

/** A local file name for a remote name (characters this platform cannot use are replaced). */
export function safeLocalName(name: string): string {
  if (validateName(name).valid) return name;
  const cleaned = name.replace(/[<>:"\\|?*\x00-\x1f/]/g, '_').replace(/[ .]+$/, '') || 'file';
  return validateName(cleaned).valid ? cleaned : `file${path.extname(cleaned)}`;
}

export { defaultPort };
