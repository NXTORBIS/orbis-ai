import crypto from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import { Client, utils as sshUtils, type ConnectConfig, type SFTPWrapper, type Stats } from 'ssh2';
import { normalizeRemotePath, remoteJoin, remoteNameProblem, type RemoteCertificateInfo } from '../../shared/remote';
import { CAUSE, networkError, remoteError, type RemoteEntry, type RemoteFs, type RemoteListing } from './types';
import { OrbisError } from '../../shared/errors';

export interface HostKeyInfo {
  host: string;
  port: number;
  algorithm: string;
  /** "SHA256:<base64 without padding>", as OpenSSH prints it; FTPS certificates: SHA-256 as "AB:CD:…". */
  fingerprint: string;
  /** FTPS: the certificate the server presented (subject, issuer, validity, why it is not trusted). */
  certificate?: RemoteCertificateInfo;
}

export type HostKeyDecision = 'accept' | 'unknown' | { changed: string };

export interface SftpOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: Buffer;
  passphrase?: string;
  readyTimeoutMs?: number;
  /** Decide about the server's host key (trust on first use, see RemoteService). */
  checkHostKey: (info: HostKeyInfo) => HostKeyDecision;
}

/** SHA-256 fingerprint of an SSH public key blob, and its algorithm name. */
export function hostKeyInfo(host: string, port: number, blob: Buffer): HostKeyInfo {
  const fingerprint = `SHA256:${crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
  let algorithm = 'unknown';
  if (blob.length >= 4) {
    const n = blob.readUInt32BE(0);
    if (n > 0 && n < 64 && blob.length >= 4 + n) algorithm = blob.subarray(4, 4 + n).toString('latin1');
  }
  return { host, port, algorithm, fingerprint };
}

/** Thrown when the host key is not (yet) trusted; carries what the server presented. */
export class HostKeyError extends OrbisError {
  constructor(readonly info: HostKeyInfo, readonly expected?: string) {
    super({
      category: 'permission_denied',
      operation: 'remote.connect',
      message: info.certificate
        ? expected
          ? `The TLS certificate of ${info.host}:${info.port} has CHANGED since you trusted it. This can mean someone is intercepting the connection, or the server got a new certificate. Orbis Files did not connect.`
          : `The TLS certificate of ${info.host}:${info.port} is not trusted by your system. Check its fingerprint to connect.`
        : expected
          ? `The host key of ${info.host}:${info.port} has CHANGED since you trusted it. This can mean someone is intercepting the connection, or the server was reinstalled. Orbis Files did not connect.`
          : `The host key of ${info.host}:${info.port} is not known yet. Confirm its fingerprint to connect.`,
      cause: expected ? CAUSE.hostKeyChanged : CAUSE.hostKeyUnknown,
      dataChanged: 'no',
      retryable: false,
    });
  }
}

/** Check a private key and its passphrase before connecting. */
export function checkPrivateKey(key: Buffer, passphrase?: string): 'ok' | 'needs-passphrase' | 'wrong-passphrase' | 'invalid' {
  const parsed = sshUtils.parseKey(key, passphrase);
  if (!(parsed instanceof Error)) return 'ok';
  const msg = parsed.message;
  if (/passphrase/i.test(msg) && /no passphrase|without passphrase|given/i.test(msg) && !passphrase) return 'needs-passphrase';
  if (/passphrase|decrypt|bad decrypt/i.test(msg)) return passphrase ? 'wrong-passphrase' : 'needs-passphrase';
  return 'invalid';
}

const S_IFMT = 0o170000;
function kindOfMode(mode: number): RemoteEntry['kind'] {
  const t = mode & S_IFMT;
  if (t === 0o040000) return 'directory';
  if (t === 0o100000) return 'file';
  if (t === 0o120000) return 'symlink';
  return 'other';
}

function sftpError(err: unknown, operation: string, target: string, where: string): OrbisError {
  if (err instanceof OrbisError) return err;
  const e = err as { code?: number | string; message?: string };
  switch (e?.code) {
    case 2: return remoteError('not_found', operation, 'The item does not exist on the server.', { cause: `SFTP ${e.code}: ${e.message ?? ''}`, target });
    case 3: return remoteError('permission_denied', operation, 'The server does not allow this here (permission denied).', { cause: `SFTP ${e.code}: ${e.message ?? ''}`, target });
    case 6: case 7: return remoteError('unavailable', operation, `The connection to ${where} was lost.`, { cause: `${CAUSE.connectionLost}: SFTP ${e.code}`, target, retryable: true });
    case 8: return remoteError('unsupported', operation, 'The server does not support this operation.', { cause: `SFTP ${e.code}: ${e.message ?? ''}`, target });
    case 4: case 5: return remoteError('io', operation, `The server reported a failure${e.message && e.message !== 'Failure' ? `: ${e.message}` : ''}.`, { cause: `SFTP ${e.code}: ${e.message ?? ''}`, target });
  }
  return networkError(err, operation, where);
}

/** Open an SSH connection and its SFTP channel. Rejects with honest errors (auth, host key, network). */
export function connectSftp(o: SftpOptions): Promise<SftpFs> {
  const where = `${o.host}:${o.port}`;
  return new Promise((resolve, reject) => {
    const client = new Client();
    let hostKeyProblem: HostKeyError | undefined;
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      client.end();
      if (hostKeyProblem) return reject(hostKeyProblem);
      const e = err as { level?: string; message?: string };
      if (e?.level === 'client-authentication') {
        return reject(remoteError('permission_denied', 'remote.connect', o.privateKey ? 'The server did not accept the key for this user name.' : 'The server did not accept the user name or password.', { cause: `${CAUSE.authFailed}: ${e.message ?? ''}` }));
      }
      if (e?.level === 'client-timeout') return reject(remoteError('unavailable', 'remote.connect', `${where} did not answer in time.`, { cause: `${CAUSE.timeout}: ${e.message ?? ''}`, retryable: true }));
      reject(networkError(err, 'remote.connect', where));
    };
    client.on('error', fail);
    client.on('close', () => fail(Object.assign(new Error('connection closed'), { code: 'ECONNRESET' })));
    client.on('ready', () => {
      // SFTP is request/response: without TCP_NODELAY every small request waits for a delayed ACK.
      client.setNoDelay(true);
      client.sftp((err, sftp) => {
        if (err) return fail(err);
        settled = true;
        resolve(new SftpFs(client, sftp, where));
      });
    });
    const cfg: ConnectConfig = {
      host: o.host,
      port: o.port,
      username: o.username,
      readyTimeout: o.readyTimeoutMs ?? 20_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 4,
      tryKeyboard: false,
      hostVerifier: (key: Buffer) => {
        const info = hostKeyInfo(o.host, o.port, key);
        const d = o.checkHostKey(info);
        if (d === 'accept') return true;
        hostKeyProblem = new HostKeyError(info, typeof d === 'object' ? d.changed : undefined);
        return false;
      },
    };
    if (o.privateKey) {
      cfg.privateKey = o.privateKey;
      if (o.passphrase) cfg.passphrase = o.passphrase;
    } else cfg.password = o.password;
    try {
      client.connect(cfg);
    } catch (err) {
      fail(err);
    }
  });
}

export class SftpFs implements RemoteFs {
  readonly protocol = 'sftp' as const;
  private open = true;
  private homeDir: string | undefined;

  constructor(private readonly client: Client, private readonly sftp: SFTPWrapper, private readonly where: string) {
    const down = () => {
      this.open = false;
    };
    client.on('close', down);
    client.on('end', down);
    client.on('error', down);
  }

  get alive(): boolean {
    return this.open;
  }

  close(): void {
    this.open = false;
    this.client.end();
  }

  private call<T>(operation: string, target: string, fn: (cb: (err: unknown, v?: T) => void) => void): Promise<T> {
    if (!this.open) return Promise.reject(remoteError('unavailable', operation, `The connection to ${this.where} was lost.`, { cause: CAUSE.connectionLost, target, retryable: true }));
    return new Promise((resolve, reject) => {
      try {
        fn((err, v) => (err ? reject(sftpError(err, operation, target, this.where)) : resolve(v as T)));
      } catch (err) {
        reject(sftpError(err, operation, target, this.where));
      }
    });
  }

  async home(): Promise<string> {
    if (this.homeDir) return this.homeDir;
    const p = await this.call<string>('remote.home', '.', (cb) => this.sftp.realpath('.', cb));
    let home = '/';
    try {
      home = normalizeRemotePath(p);
    } catch {
      /* a server reporting an odd home folder: use the root */
    }
    this.homeDir = home;
    return home;
  }

  private toEntry(p: string, name: string, attrs: Stats): RemoteEntry {
    return { name, path: p, kind: kindOfMode(attrs.mode), size: kindOfMode(attrs.mode) === 'file' ? attrs.size : undefined, modifiedMs: attrs.mtime ? attrs.mtime * 1000 : undefined, mode: attrs.mode };
  }

  async list(dir: string, signal?: AbortSignal): Promise<RemoteListing> {
    const d = normalizeRemotePath(dir);
    const list = await this.call<Array<{ filename: string; attrs: Stats }>>('remote.list', d, (cb) => this.sftp.readdir(d, cb as never));
    if (signal?.aborted) throw remoteError('cancelled', 'remote.list', 'Cancelled.');
    const entries: RemoteEntry[] = [];
    const refused: string[] = [];
    for (const it of list) {
      if (it.filename === '.' || it.filename === '..') continue;
      // A server can send any name: one that would leave this folder ("../x", "a/b") is refused.
      if (remoteNameProblem(it.filename)) {
        refused.push(it.filename.slice(0, 200));
        continue;
      }
      entries.push(this.toEntry(remoteJoin(d, it.filename), it.filename, it.attrs));
    }
    return { entries, refused };
  }

  async stat(p: string): Promise<RemoteEntry> {
    const target = normalizeRemotePath(p);
    const attrs = await this.call<Stats>('remote.stat', target, (cb) => this.sftp.lstat(target, cb));
    return this.toEntry(target, target === '/' ? '/' : target.slice(target.lastIndexOf('/') + 1), attrs);
  }

  /** Kind of what a link points to (undefined when it cannot be followed). */
  async linkTargetKind(p: string): Promise<RemoteEntry['kind'] | undefined> {
    try {
      const attrs = await this.call<Stats>('remote.stat', p, (cb) => this.sftp.stat(p, cb));
      return kindOfMode(attrs.mode);
    } catch {
      return undefined;
    }
  }

  async read(p: string, opts: { start?: number; end?: number; signal?: AbortSignal } = {}): Promise<Readable> {
    if (!this.open) throw remoteError('unavailable', 'remote.read', `The connection to ${this.where} was lost.`, { cause: CAUSE.connectionLost, target: p, retryable: true });
    // Open first so a missing file or a refused permission is reported before streaming starts.
    const handle = await this.call<Buffer>('remote.read', p, (cb) => this.sftp.open(p, 'r', cb));
    const stream = this.sftp.createReadStream(p, { handle, start: opts.start, end: opts.end, highWaterMark: 64 * 1024, autoClose: true } as never);
    stream.on('error', () => undefined);
    return stream;
  }

  async write(p: string, opts: { signal?: AbortSignal } = {}): Promise<{ stream: Writable; done: Promise<void> }> {
    // 'wx': exclusive create (SSH_FXF_EXCL) — never replaces an existing item.
    const handle = await this.call<Buffer>('remote.write', p, (cb) => this.sftp.open(p, 'wx', cb));
    const stream = this.sftp.createWriteStream(p, { handle, autoClose: true } as never);
    const done = new Promise<void>((resolve, reject) => {
      stream.on('close', () => resolve());
      stream.on('error', (err: unknown) => reject(sftpError(err, 'remote.write', p, this.where)));
    });
    // Settled by the caller after the data was piped; a failure while piping is reported there.
    done.catch(() => undefined);
    if (opts.signal) opts.signal.addEventListener('abort', () => (stream as Writable).destroy(remoteError('cancelled', 'remote.write', 'Cancelled.')), { once: true });
    return { stream, done };
  }

  async mkdir(p: string): Promise<void> {
    const exists = await this.stat(p).then(() => true, (err) => {
      if (err instanceof OrbisError && err.shape.category === 'not_found') return false;
      throw err;
    });
    if (exists) throw remoteError('already_exists', 'remote.mkdir', 'An item with this name already exists.', { target: p });
    await this.call('remote.mkdir', p, (cb) => this.sftp.mkdir(p, cb));
  }

  async rename(from: string, to: string, opts: { overwrite?: boolean } = {}): Promise<void> {
    if (opts.overwrite) {
      // posix-rename@openssh.com replaces atomically where the server offers it.
      const s = this.sftp as unknown as { _extensions?: Record<string, string>; ext_openssh_rename: (a: string, b: string, cb: (e?: unknown) => void) => void };
      if (s._extensions?.['posix-rename@openssh.com'] === '1') {
        await this.call('remote.rename', from, (cb) => s.ext_openssh_rename(from, to, cb));
        return;
      }
      // Fallback (no atomic replace on this server): remove the old file, then rename.
      const target = await this.stat(to).catch(() => undefined);
      if (target?.kind === 'file') await this.removeFile(to);
    } else {
      // Plain SFTP rename never replaces on OpenSSH, but other servers may: check first.
      const exists = await this.stat(to).then(() => true, () => false);
      if (exists) throw remoteError('already_exists', 'remote.rename', 'An item with this name already exists on the server.', { target: to });
    }
    await this.call('remote.rename', from, (cb) => this.sftp.rename(from, to, cb));
  }

  async removeFile(p: string): Promise<void> {
    await this.call('remote.delete', p, (cb) => this.sftp.unlink(p, cb));
  }

  async setModified(p: string, ms: number): Promise<void> {
    const t = Math.floor(ms / 1000);
    await this.call('remote.setModified', p, (cb) => this.sftp.utimes(p, t, t, cb));
  }

  async removeDir(p: string): Promise<void> {
    await this.call('remote.delete', p, (cb) => this.sftp.rmdir(p, cb));
  }
}
