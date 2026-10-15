import crypto from 'node:crypto';
import fs from 'node:fs';
import tls, { type ConnectionOptions, type PeerCertificate, type TLSSocket } from 'node:tls';
import { PassThrough, Writable, type Readable } from 'node:stream';
import { Client, FTPError, type FTPContext } from 'basic-ftp';
import { isLoopbackHost, normalizeRemotePath, remoteBase, remoteJoin, remoteNameProblem, remoteParent, type RemoteCertificateInfo } from '../../shared/remote';
import { OrbisError } from '../../shared/errors';
import { CAUSE, networkError, remoteError, type RemoteEntry, type RemoteFs, type RemoteListing } from './types';
import { HostKeyError, type HostKeyDecision, type HostKeyInfo } from './sftp';
import { parseFtpListing, parseMlsdLine, parseMlsxTime, type ParsedFtpEntry } from './ftpList';

/**
 * FTP and FTPS (explicit AUTH TLS, implicit TLS) on `basic-ftp`.
 *
 * basic-ftp runs one command at a time per connection, so this keeps a small
 * pool of control connections: every call leases one (a listing never waits
 * for a running transfer: it gets another connection), idle ones are kept
 * alive with NOOP and closed after a while, and a dropped connection is
 * replaced transparently. Passive mode only (EPSV, then PASV; the data
 * connection must go to the control connection's host). With TLS, every data
 * connection is TLS too (PROT P is required, and the TLS session of the
 * control connection is resumed), and its certificate must be the one the
 * control connection presented.
 */

export interface FtpOptions {
  host: string;
  port: number;
  username: string;
  /** Not used with anonymous sign-in. */
  password?: string;
  anonymous?: boolean;
  tls: 'none' | 'explicit' | 'implicit';
  encoding?: 'utf8' | 'latin1';
  /** Plain FTP to a host other than this computer (the user confirmed it). */
  allowUnencrypted?: boolean;
  timeoutMs?: number;
  /** Extra certificate authorities to trust (tests). */
  ca?: string | Buffer;
  /** Most simultaneous connections to the server (default 4). */
  maxConnections?: number;
  /** Decide about the server certificate (see RemoteService: trusted by the system, or pinned on first use). */
  checkCert: (info: HostKeyInfo, systemTrusted: boolean) => HostKeyDecision;
}

/** Things the server supports (from FEAT). */
interface Features { mlst: boolean; mdtm: boolean; mfmt: boolean; restStream: boolean; size: boolean }

interface Conn {
  client: Client;
  busy: boolean;
  lastUsed: number;
}

const KEEPALIVE_MS = 30_000;
const IDLE_CLOSE_MS = 90_000;
const KEEP_IDLE = 2;
const LEASE_WAIT_MS = 60_000;
const LISTING_MAX = 16 * 1024 * 1024;

// ---------------------------------------------------------------------------------------- certificates

let caCache: string[] | undefined;
/**
 * Node's bundled root certificates plus the system's CA bundle where one is at a well-known
 * place (Linux distributions, macOS's /etc/ssl/cert.pem), so a private CA installed system-wide
 * is trusted too.
 */
function trustedRoots(extra?: string | Buffer): string[] {
  if (!caCache) {
    caCache = [...tls.rootCertificates];
    for (const f of ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/ca-bundle.pem', '/etc/ssl/cert.pem']) {
      try {
        const st = fs.statSync(f);
        if (st.isFile() && st.size < 4 * 1024 * 1024) {
          caCache.push(fs.readFileSync(f, 'utf8'));
          break;
        }
      } catch {
        /* not there */
      }
    }
  }
  return extra ? [...caCache, extra.toString()] : caCache;
}

function dn(o: unknown): string {
  if (!o || typeof o !== 'object') return '';
  const order = ['CN', 'O', 'OU', 'L', 'ST', 'C'];
  const rec = o as Record<string, string | string[]>;
  const keys = [...order.filter((k) => k in rec), ...Object.keys(rec).filter((k) => !order.includes(k))];
  return keys.map((k) => `${k}=${Array.isArray(rec[k]) ? (rec[k] as string[]).join('+') : rec[k]}`).join(', ').slice(0, 500);
}

function isoDate(s: string | undefined): string {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/** Why the system does not trust a certificate, in plain words. */
export function certProblem(code: string | Error | null | undefined, cert: PeerCertificate, host: string): string | undefined {
  if (!code) return undefined;
  const c = typeof code === 'string' ? code : ((code as { code?: string }).code ?? code.message);
  switch (c) {
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'The certificate is self-signed: no certificate authority your system trusts vouches for it.';
    case 'CERT_HAS_EXPIRED':
      return `The certificate expired on ${isoDate(cert.valid_to).slice(0, 10) || 'an earlier date'}.`;
    case 'CERT_NOT_YET_VALID':
      return `The certificate is not valid before ${isoDate(cert.valid_from).slice(0, 10) || 'a later date'}.`;
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return `The certificate was issued for another name (${String(cert.subjectaltname ?? dn(cert.subject)).slice(0, 160)}), not for ${host}.`;
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'UNABLE_TO_GET_ISSUER_CERT':
      return 'The certificate is signed by an authority your system does not trust (or the server does not send its full certificate chain).';
    default:
      return `Your system does not trust this certificate (${String(c).slice(0, 80)}).`;
  }
}

/** What the server presented, for the trust decision and the dialog. */
export function certificateInfo(host: string, port: number, cert: PeerCertificate, authorizationError?: string | Error | null): HostKeyInfo & { certificate: RemoteCertificateInfo } {
  const fingerprint = cert.fingerprint256 || crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase().replace(/(..)(?!$)/g, '$1:');
  const c = cert as PeerCertificate & { asn1Curve?: string; bits?: number };
  const algorithm = c.asn1Curve ? `TLS certificate (EC ${c.asn1Curve})` : c.bits ? `TLS certificate (RSA ${c.bits}-bit)` : 'TLS certificate';
  return {
    host, port, algorithm, fingerprint,
    certificate: { subject: dn(cert.subject), issuer: dn(cert.issuer), validFrom: isoDate(cert.valid_from), validTo: isoDate(cert.valid_to), problem: certProblem(authorizationError, cert, host) },
  };
}

// ---------------------------------------------------------------------------------------- errors

function ftpError(err: unknown, operation: string, target: string, where: string): OrbisError {
  if (err instanceof OrbisError) return err;
  if (err instanceof FTPError) {
    const msg = String(err.message ?? '').replace(/^\d{3}[- ]?/, '').trim().slice(0, 200);
    const cause = `FTP ${err.code}: ${msg}`;
    switch (err.code) {
      case 530:
        if (/TLS|SSL|encrypt|secure/i.test(msg)) return remoteError('permission_denied', operation, 'The server requires an encrypted connection. Choose FTPS in the connection settings.', { cause, target });
        return remoteError('permission_denied', operation, 'The server did not accept the user name or password.', { cause: `${CAUSE.authFailed}: ${cause}`, target });
      case 534: case 522: case 533:
        return remoteError('permission_denied', operation, 'The server’s encryption policy does not allow this connection (it may require or refuse TLS for this user).', { cause, target });
      case 550:
        if (/permission|denied|access|not allowed|forbidden/i.test(msg)) return remoteError('permission_denied', operation, 'The server does not allow this here (permission denied).', { cause, target });
        if (/exist/i.test(msg) && !/not exist|no such|doesn.?t exist|does not exist/i.test(msg)) return remoteError('already_exists', operation, 'An item with this name already exists on the server.', { cause, target });
        if (/not empty/i.test(msg)) return remoteError('directory_not_empty', operation, 'The folder is not empty.', { cause, target });
        return remoteError('not_found', operation, 'The item does not exist on the server (or cannot be used).', { cause, target });
      case 553:
        return remoteError('invalid_name', operation, 'The server does not allow this file name.', { cause, target });
      case 552: case 452:
        return remoteError('no_space', operation, 'The server has no space left for this (or a quota was reached).', { cause, target });
      case 450:
        return remoteError('busy', operation, 'The file is busy or not available on the server right now.', { cause, target, retryable: true });
      case 421:
        return remoteError('unavailable', operation, `${where} closed the connection (${msg || 'service not available'}).`, { cause: `${CAUSE.connectionLost}: ${cause}`, target, retryable: true });
      case 425: case 426:
        return remoteError('unavailable', operation, `The data connection to ${where} failed or was closed.`, { cause: `${CAUSE.connectionLost}: ${cause}`, target, retryable: true });
      case 500: case 501: case 502: case 504:
        return remoteError('unsupported', operation, `The server does not support this command (${msg || err.code}).`, { cause, target });
      default:
        return remoteError('io', operation, `The server reported an error: ${msg || err.code}.`, { cause, target, retryable: err.code < 500 });
    }
  }
  const e = err as { code?: string; message?: string };
  const m = e?.message ?? '';
  if (/Timeout/i.test(m)) return remoteError('unavailable', operation, `${where} did not answer in time.`, { cause: `${CAUSE.timeout}: ${m.slice(0, 120)}`, target, retryable: true });
  if (/closed|FIN packet|transmission error|User closed client|Client is closed|ECONNRESET|socket hang up/i.test(m) && !e?.code) {
    return remoteError('unavailable', operation, `The connection to ${where} was lost.`, { cause: `${CAUSE.connectionLost}: ${m.slice(0, 120)}`, target, retryable: true });
  }
  if (/PASV returned another host/i.test(m)) return remoteError('permission_denied', operation, `${where} asked to send data to another address; Orbis Files refuses that (it protects against FTP bounce attacks).`, { cause: m.slice(0, 160), target });
  if (/data connection/i.test(m)) return remoteError('unavailable', operation, `The data connection to ${where} could not be opened (passive mode). A firewall may block it.`, { cause: `${CAUSE.connectionLost}: ${m.slice(0, 160)}`, target, retryable: true });
  if (/wrong version number|packet length too long|unknown protocol|handshake|alert|EPROTO/i.test(m) || e?.code === 'EPROTO' || e?.code === 'ERR_SSL_WRONG_VERSION_NUMBER') {
    return remoteError('unavailable', operation, `The TLS handshake with ${where} failed. Check the port and the connection type (explicit FTPS usually uses port 21, implicit FTPS port 990).`, { cause: `${CAUSE.tls}: ${e?.code ?? m.slice(0, 120)}`, target });
  }
  return networkError(err, operation, where);
}

/** A path for an FTP command: absolute, clean, without line breaks (they would split the command). */
function cmdPath(p: string, operation: string): string {
  if (/[\r\n\0]/.test(p)) throw remoteError('invalid_name', operation, 'The name contains a line break or a null character.', { target: p.slice(0, 200) });
  return normalizeRemotePath(p);
}

function mfmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function isIp(h: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');
}

// ---------------------------------------------------------------------------------------- the file system

export class FtpFs implements RemoteFs {
  readonly protocol = 'ftp' as const;
  private conns: Conn[] = [];
  private opening = 0;
  private waiters: Array<{ resolve: (c: Conn) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }> = [];
  private closed = false;
  private homeDir = '/';
  private features: Features = { mlst: false, mdtm: false, mfmt: false, restStream: false, size: false };
  private max: number;
  private timer: NodeJS.Timeout;
  /** The certificate fingerprint accepted for this session (every connection must present it). */
  private acceptedCert?: string;
  readonly where: string;

  private constructor(private readonly o: FtpOptions) {
    if (o.tls === 'none' && !isLoopbackHost(o.host) && !o.allowUnencrypted) {
      throw remoteError('validation', 'remote.ftp', 'Plain FTP to another computer needs “Allow unencrypted connection”.');
    }
    this.where = `${o.host}:${o.port}`;
    this.max = Math.max(1, o.maxConnections ?? 4);
    this.timer = setInterval(() => void this.housekeeping(), 10_000);
    this.timer.unref();
  }

  /** Connect and sign in (one connection; more are opened when needed). Rejects with honest errors. */
  static async connect(o: FtpOptions): Promise<FtpFs> {
    const f = new FtpFs(o);
    try {
      const c = await f.openConn();
      try {
        const pwd = await c.client.pwd();
        f.homeDir = normalizeRemotePath(pwd.startsWith('/') ? pwd : '/');
      } catch {
        f.homeDir = '/';
      }
      f.release(c, false);
      return f;
    } catch (err) {
      f.close();
      throw err;
    }
  }

  get alive(): boolean {
    return !this.closed;
  }

  /** How many control connections are open (tests, diagnostics). */
  get connectionCount(): number {
    return this.conns.length;
  }

  get supportsMlsd(): boolean {
    return this.features.mlst;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    for (const c of this.conns) c.client.close();
    this.conns = [];
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(this.lost('remote.ftp'));
    }
  }

  private lost(operation: string, target?: string): OrbisError {
    return remoteError('unavailable', operation, `The connection to ${this.where} was closed.`, { cause: CAUSE.connectionLost, target, retryable: true });
  }

  // ------------------------------------------------------------------ connections

  private tlsOptions(): ConnectionOptions {
    return {
      host: this.o.host,
      servername: isIp(this.o.host) ? undefined : this.o.host,
      minVersion: 'TLSv1.2',
      ca: trustedRoots(this.o.ca),
      // Verified below, before anything is sent: trusted by the system or pinned by the user.
      rejectUnauthorized: false,
    };
  }

  /** Check the certificate of a fresh TLS control connection (throws HostKeyError when not trusted). */
  private verifyControlCert(sock: TLSSocket): string {
    const cert = sock.getPeerCertificate();
    if (!cert || !cert.raw) throw remoteError('permission_denied', 'remote.connect', `${this.where} presented no TLS certificate.`, { cause: CAUSE.tls });
    const info = certificateInfo(this.o.host, this.o.port, cert, sock.authorized ? undefined : sock.authorizationError);
    if (this.acceptedCert && info.fingerprint === this.acceptedCert) return info.fingerprint;
    const d = this.o.checkCert(info, sock.authorized);
    if (d !== 'accept') throw new HostKeyError(info, typeof d === 'object' ? d.changed : undefined);
    return info.fingerprint;
  }

  /** Every TLS data connection must present the control connection's certificate. */
  private guardDataSockets(ftp: FTPContext, fingerprint: string): void {
    const proto = Object.getPrototypeOf(ftp) as object;
    const desc = Object.getOwnPropertyDescriptor(proto, 'dataSocket');
    if (!desc?.get || !desc.set) throw remoteError('internal', 'remote.connect', 'The FTP library changed in an unexpected way.');
    const where = this.where;
    Object.defineProperty(ftp, 'dataSocket', {
      configurable: true,
      get() {
        return desc.get!.call(this);
      },
      set(socket: unknown) {
        const s = socket as TLSSocket | undefined;
        if (s && typeof s.getPeerCertificate === 'function') {
          const check = () => {
            // A resumed session proves the peer holds the verified control connection's session secret;
            // a full handshake must present the same certificate.
            if (s.isSessionReused()) return;
            const fp = s.getPeerCertificate()?.fingerprint256;
            if (fp !== fingerprint) s.destroy(Object.assign(new Error(`The data connection to ${where} presented another certificate`), { code: 'ERR_CERT_MISMATCH' }));
          };
          if (s.encrypted && (s as unknown as { _secureEstablished?: boolean })._secureEstablished) check();
          else s.prependOnceListener('secureConnect', check);
        }
        desc.set!.call(this, socket);
      },
    });
  }

  /** Open, secure and sign in one control connection. */
  private async openConn(): Promise<Conn> {
    const client = new Client(this.o.timeoutMs ?? 30_000, { allowSeparateTransferHost: false, maxListingBytes: LISTING_MAX });
    client.ftp.encoding = this.o.encoding === 'latin1' ? 'latin1' : 'utf8';
    const op = 'remote.connect';
    try {
      const tlsOpts = this.tlsOptions();
      if (this.o.tls === 'implicit') await client.connectImplicitTLS(this.o.host, this.o.port, tlsOpts);
      else await client.connect(this.o.host, this.o.port);
      if (this.o.tls === 'explicit') {
        try {
          await client.useTLS(tlsOpts);
        } catch (err) {
          if (err instanceof FTPError) throw remoteError('unsupported', op, `${this.where} does not offer FTPS (it refused AUTH TLS). Orbis Files does not fall back to an unencrypted connection.`, { cause: `${CAUSE.tls}: FTP ${err.code}` });
          throw err;
        }
      }
      if (this.o.tls !== 'none') {
        const fp = this.verifyControlCert(client.ftp.socket as TLSSocket);
        this.acceptedCert = fp;
        this.guardDataSockets(client.ftp, fp);
      }
      if (this.o.encoding !== 'latin1') await client.sendIgnoringError('OPTS UTF8 ON');
      try {
        if (this.o.anonymous) await client.login('anonymous', 'anonymous@');
        else await client.login(this.o.username, this.o.password ?? '');
      } catch (err) {
        if (err instanceof FTPError && err.code === 530 && this.o.anonymous) throw remoteError('permission_denied', op, 'The server does not allow anonymous sign-in.', { cause: `FTP 530: ${err.message.slice(0, 120)}` });
        throw err;
      }
      const feat = await client.features();
      this.features = { mlst: feat.has('MLST'), mdtm: feat.has('MDTM'), mfmt: feat.has('MFMT'), restStream: feat.has('REST'), size: feat.has('SIZE') };
      await client.send('TYPE I');
      await client.sendIgnoringError('STRU F');
      if (this.o.encoding !== 'latin1') await client.sendIgnoringError('OPTS UTF8 ON');
      if (this.o.tls !== 'none') {
        // Data connections must be encrypted too: refuse a server that will not protect them.
        try {
          await client.send('PBSZ 0');
          await client.send('PROT P');
        } catch (err) {
          if (err instanceof FTPError) throw remoteError('unsupported', op, `${this.where} refused to encrypt file transfers (PROT P). Orbis Files does not transfer files unencrypted over FTPS.`, { cause: `${CAUSE.tls}: FTP ${err.code}` });
          throw err;
        }
      }
      if (this.features.mlst) await client.sendIgnoringError('OPTS MLST type;size;modify;unix.mode;');
      client.availableListCommands = this.features.mlst ? ['MLSD', 'LIST -a', 'LIST'] : ['LIST -a', 'LIST'];
    } catch (err) {
      client.close();
      throw ftpError(err, op, '', this.where);
    }
    const c: Conn = { client, busy: true, lastUsed: Date.now() };
    if (this.closed) {
      client.close();
      throw this.lost(op);
    }
    this.conns.push(c);
    return c;
  }

  /** A connection for one call: an idle one, a new one (up to the limit), or the next one released. */
  private async acquire(operation: string): Promise<Conn> {
    if (this.closed) throw this.lost(operation);
    this.conns = this.conns.filter((c) => c.busy || !c.client.closed);
    const idle = this.conns.find((c) => !c.busy);
    if (idle) {
      idle.busy = true;
      return idle;
    }
    if (this.conns.length + this.opening < this.max) {
      this.opening++;
      try {
        return await this.openConn();
      } catch (err) {
        // A server that limits connections per user (421 / "too many"): use the ones there are.
        const limited = err instanceof OrbisError && /^connection_lost: FTP 421|too many/i.test(err.shape.cause ?? '');
        if (!limited || !this.conns.length) {
          if (err instanceof HostKeyError) this.close();
          throw err;
        }
        this.max = Math.max(1, this.conns.length);
      } finally {
        this.opening--;
      }
    }
    return new Promise<Conn>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(remoteError('busy', operation, `All ${this.conns.length} connection(s) to ${this.where} are busy (the server may allow only a few at a time). Try again when the running transfers finish.`, { retryable: true }));
      }, LEASE_WAIT_MS);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  private release(c: Conn, broken: boolean): void {
    c.lastUsed = Date.now();
    if (broken || c.client.closed || this.closed) {
      c.client.close();
      this.conns = this.conns.filter((x) => x !== c);
      const w = this.waiters.shift();
      if (w && !this.closed) {
        clearTimeout(w.timer);
        // Open a replacement for the one waiting.
        this.acquire('remote.ftp').then(w.resolve, w.reject);
      }
      return;
    }
    const w = this.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      w.resolve(c);
      return;
    }
    c.busy = false;
  }

  /** NOOP on idle connections (servers and routers drop silent ones); close idle extras. */
  private async housekeeping(): Promise<void> {
    if (this.closed) return;
    const now = Date.now();
    let idleKept = 0;
    for (const c of [...this.conns]) {
      if (c.busy) continue;
      if (c.client.closed) {
        this.conns = this.conns.filter((x) => x !== c);
        continue;
      }
      if (idleKept >= KEEP_IDLE && now - c.lastUsed > IDLE_CLOSE_MS) {
        c.client.close();
        this.conns = this.conns.filter((x) => x !== c);
        continue;
      }
      idleKept++;
      if (now - c.lastUsed < KEEPALIVE_MS) continue;
      c.busy = true;
      let broken = false;
      try {
        await c.client.send('NOOP');
      } catch {
        broken = true;
      }
      this.release(c, broken);
    }
  }

  /**
   * Run one exchange on a leased connection. A connection that turns out to be dead
   * (the server dropped it while idle) is replaced and the call retried once when `retry`.
   */
  private async run<T>(operation: string, target: string, fn: (c: Client) => Promise<T>, retry = true): Promise<T> {
    const c = await this.acquire(operation);
    const reused = Date.now() - c.lastUsed > 1000;
    try {
      const v = await fn(c.client);
      this.release(c, false);
      return v;
    } catch (err) {
      const e = ftpError(err, operation, target, this.where);
      const broken = c.client.closed || /^(connection_lost|timeout)/.test(e.shape.cause ?? '');
      this.release(c, broken);
      if (broken && retry && reused && !this.closed) return this.run(operation, target, fn, false);
      throw e;
    }
  }

  // ------------------------------------------------------------------ RemoteFs

  async home(): Promise<string> {
    return this.homeDir;
  }

  private toEntry(dir: string, e: ParsedFtpEntry): RemoteEntry {
    return { name: e.name, path: remoteJoin(dir, e.name), kind: e.kind, size: e.kind === 'file' ? e.size : undefined, modifiedMs: e.modifiedMs, mode: e.mode };
  }

  /** CWD into the folder, then MLSD (or LIST): paths with spaces or leading dashes are never parsed as options. */
  private async rawList(c: Client, d: string): Promise<ReturnType<typeof parseFtpListing>> {
    await c.cd(d);
    let parsed: ReturnType<typeof parseFtpListing> = { entries: [], unparsed: [] };
    c.parseList = (text: string) => {
      parsed = parseFtpListing(text);
      return [];
    };
    try {
      await c.list();
    } catch (err) {
      // Some servers (IIS, older wu-ftpd) answer a listing of an empty folder with 450/550 "No files found".
      if (err instanceof FTPError && (err.code === 450 || err.code === 550) && /no (such )?files?|empty|not found/i.test(err.message)) return { entries: [], unparsed: [] };
      throw err;
    }
    return parsed;
  }

  async list(dir: string, signal?: AbortSignal): Promise<RemoteListing> {
    const d = cmdPath(dir, 'remote.list');
    const parsed = await this.run('remote.list', d, (c) => this.rawList(c, d));
    if (signal?.aborted) throw remoteError('cancelled', 'remote.list', 'Cancelled.');
    const entries: RemoteEntry[] = [];
    const refused: string[] = [...parsed.unparsed];
    const seen = new Set<string>();
    for (const e of parsed.entries) {
      // A server can send any name: one that would leave this folder ("../x", "a/b") is refused.
      if (remoteNameProblem(e.name) || seen.has(e.name)) {
        if (!seen.has(e.name)) refused.push(e.name.slice(0, 200));
        continue;
      }
      seen.add(e.name);
      entries.push(this.toEntry(d, e));
    }
    return { entries, refused };
  }

  async stat(p: string): Promise<RemoteEntry> {
    const target = cmdPath(p, 'remote.stat');
    if (target === '/') return { name: '/', path: '/', kind: 'directory' };
    const name = remoteBase(target);
    if (this.features.mlst) {
      const res = await this.run('remote.stat', target, (c) => c.send(`MLST ${target}`)).catch((err) => {
        if (err instanceof OrbisError && err.shape.category === 'unsupported') return undefined;
        throw err;
      });
      if (res) {
        for (const line of res.message.split(/\r?\n/)) {
          if (!line.startsWith(' ')) continue;
          const e = parseMlsdLine(line.slice(1));
          if (e) return { name, path: target, kind: e.kind, size: e.kind === 'file' ? e.size : undefined, modifiedMs: e.modifiedMs, mode: e.mode };
        }
      }
    }
    // No MLST: find the item in its folder's listing (MDTM gives the exact time of a file where offered).
    const parent = remoteParent(target) ?? '/';
    const parsed = await this.run('remote.stat', target, (c) => this.rawList(c, parent)).catch((err) => {
      if (err instanceof OrbisError && (err.shape.category === 'not_found' || err.shape.category === 'permission_denied')) {
        throw remoteError('not_found', 'remote.stat', 'The item does not exist on the server.', { target, cause: err.shape.cause });
      }
      throw err;
    });
    const found = parsed.entries.find((e) => e.name === name);
    if (!found) throw remoteError('not_found', 'remote.stat', 'The item does not exist on the server.', { target });
    const entry: RemoteEntry = { name, path: target, kind: found.kind, size: found.kind === 'file' ? found.size : undefined, modifiedMs: found.modifiedMs, mode: found.mode };
    if (found.kind === 'file' && this.features.mdtm) {
      const t = await this.run('remote.stat', target, (c) => c.send(`MDTM ${target}`)).then((r) => parseMlsxTime(r.message.slice(4)), () => undefined);
      if (t !== undefined) entry.modifiedMs = t;
    }
    return entry;
  }

  /** What a link points to: a folder when the server lets us enter it, a file when it reports a size. */
  async linkTargetKind(p: string): Promise<RemoteEntry['kind'] | undefined> {
    const target = cmdPath(p, 'remote.stat');
    try {
      return await this.run('remote.stat', target, async (c) => {
        try {
          await c.cd(target);
          return 'directory' as const;
        } catch (err) {
          if (!(err instanceof FTPError)) throw err;
        }
        try {
          await c.size(target);
          return 'file' as const;
        } catch (err) {
          if (!(err instanceof FTPError)) throw err;
          return undefined;
        }
      });
    } catch {
      return undefined;
    }
  }

  async read(p: string, opts: { start?: number; end?: number; signal?: AbortSignal } = {}): Promise<Readable> {
    const target = cmdPath(p, 'remote.read');
    const start = opts.start ?? 0;
    if (start > 0 && !this.features.restStream) throw remoteError('unsupported', 'remote.read', 'The server does not support reading part of a file (REST STREAM).', { target });
    // Report a missing file or a folder before streaming starts.
    const st = await this.stat(target);
    if (st.kind !== 'file' && st.kind !== 'symlink') throw remoteError('is_a_directory', 'remote.read', 'Only files can be read.', { target });
    const c = await this.acquire('remote.read');
    const out = new PassThrough({ highWaterMark: 256 * 1024 });
    const limit = opts.end !== undefined ? opts.end - start + 1 : undefined;
    let got = 0;
    let finished = false;
    // basic-ftp ends its destination even when the transfer fails, so the caller's stream is
    // only ended here, after the server confirmed the transfer (a failure is never a short file).
    const sink = new Writable({
      highWaterMark: 256 * 1024,
      write(chunk: Buffer, _e, cb) {
        if (out.destroyed) return cb(new Error('Reader closed'));
        let piece = chunk;
        if (limit !== undefined && got + piece.length >= limit) {
          piece = piece.subarray(0, limit - got);
          got += piece.length;
          out.end(piece);
          finished = true;
          // The rest of the file is not needed: stop the transfer (this connection is closed).
          return cb(new Error('Range complete'));
        }
        got += piece.length;
        if (out.write(piece)) cb();
        else {
          const onDrain = () => {
            out.off('close', onClose);
            cb();
          };
          const onClose = () => {
            out.off('drain', onDrain);
            cb(new Error('Reader closed'));
          };
          out.once('drain', onDrain);
          out.once('close', onClose);
        }
      },
      final(cb) {
        cb();
      },
    });
    out.on('close', () => {
      if (!finished && !sink.destroyed) sink.destroy(new Error('Reader closed'));
    });
    const abort = () => out.destroy(remoteError('cancelled', 'remote.read', 'Cancelled.'));
    opts.signal?.addEventListener('abort', abort, { once: true });
    c.client.downloadTo(sink, target, start).then(
      () => {
        opts.signal?.removeEventListener('abort', abort);
        this.release(c, false);
        finished = true;
        if (!out.writableEnded) out.end();
      },
      (err) => {
        opts.signal?.removeEventListener('abort', abort);
        // A transfer stopped early leaves the control connection in an unknown state: close it.
        this.release(c, true);
        if (finished) return;
        if (!out.destroyed) out.destroy(ftpError(err, 'remote.read', target, this.where));
      },
    );
    out.on('error', () => undefined);
    return out;
  }

  async write(p: string, opts: { signal?: AbortSignal; size?: number } = {}): Promise<{ stream: PassThrough; done: Promise<void> }> {
    const target = cmdPath(p, 'remote.write');
    // STOR replaces silently: callers write to fresh temporary names, and this refuses an existing one.
    const exists = await this.stat(target).then(() => true, (err) => {
      if (err instanceof OrbisError && err.shape.category === 'not_found') return false;
      throw err;
    });
    if (exists) throw remoteError('already_exists', 'remote.write', 'An item with this name already exists on the server.', { target });
    const c = await this.acquire('remote.write');
    const body = new PassThrough({ highWaterMark: 256 * 1024 });
    let settled = false;
    // Cancel stops the upload even when all data is already buffered: the connection is closed,
    // so the server sees a broken transfer (the caller removes the temporary file).
    const abort = () => {
      if (settled) return;
      body.destroy(remoteError('cancelled', 'remote.write', 'Cancelled.'));
      c.client.close();
    };
    const done = c.client.uploadFrom(body, target).then(
      () => {
        settled = true;
        opts.signal?.removeEventListener('abort', abort);
        this.release(c, false);
      },
      (err) => {
        settled = true;
        opts.signal?.removeEventListener('abort', abort);
        this.release(c, true);
        const e = opts.signal?.aborted ? remoteError('cancelled', 'remote.write', 'Cancelled.', { target }) : ftpError(err, 'remote.write', target, this.where);
        // A refused upload must not leave the caller writing into a stream nobody reads.
        if (!body.destroyed) body.destroy(e);
        throw e;
      },
    );
    done.catch(() => undefined);
    if (opts.signal?.aborted) abort();
    else opts.signal?.addEventListener('abort', abort, { once: true });
    return { stream: body, done };
  }

  async mkdir(p: string): Promise<void> {
    const target = cmdPath(p, 'remote.mkdir');
    const exists = await this.stat(target).then(() => true, (err) => {
      if (err instanceof OrbisError && err.shape.category === 'not_found') return false;
      throw err;
    });
    if (exists) throw remoteError('already_exists', 'remote.mkdir', 'An item with this name already exists.', { target });
    await this.run('remote.mkdir', target, (c) => c.send(`MKD ${target}`), false);
  }

  async rename(from: string, to: string, opts: { overwrite?: boolean } = {}): Promise<void> {
    const a = cmdPath(from, 'remote.rename');
    const b = cmdPath(to, 'remote.rename');
    const existing = await this.stat(b).catch((err) => {
      if (err instanceof OrbisError && err.shape.category === 'not_found') return undefined;
      throw err;
    });
    // RNTO replaces an existing file on most servers: never let it happen unasked.
    if (existing && !opts.overwrite && a.toLowerCase() !== b.toLowerCase()) throw remoteError('already_exists', 'remote.rename', 'An item with this name already exists on the server.', { target: b });
    if (existing && opts.overwrite && existing.kind !== 'file') throw remoteError('already_exists', 'remote.rename', 'Only files can be replaced.', { target: b });
    try {
      await this.run('remote.rename', a, async (c) => {
        await c.send(`RNFR ${a}`);
        await c.send(`RNTO ${b}`);
      }, false);
    } catch (err) {
      // Servers that refuse to replace (IIS): remove the old file, then rename.
      if (!(existing && opts.overwrite)) throw err;
      await this.removeFile(b);
      await this.run('remote.rename', a, async (c) => {
        await c.send(`RNFR ${a}`);
        await c.send(`RNTO ${b}`);
      }, false);
    }
  }

  async removeFile(p: string): Promise<void> {
    const target = cmdPath(p, 'remote.delete');
    await this.run('remote.delete', target, (c) => c.send(`DELE ${target}`), false);
  }

  async removeDir(p: string): Promise<void> {
    const target = cmdPath(p, 'remote.delete');
    await this.run('remote.delete', target, (c) => c.send(`RMD ${target}`), false);
  }

  async setModified(p: string, ms: number): Promise<void> {
    if (!this.features.mfmt) return;
    const target = cmdPath(p, 'remote.setModified');
    await this.run('remote.setModified', target, (c) => c.send(`MFMT ${mfmtTime(ms)} ${target}`), false);
  }
}

