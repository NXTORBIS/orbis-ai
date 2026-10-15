import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import yazl from 'yazl';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { EXPIRY_MS, type ShareActivity, type ShareInterfaces, type ShareSnapshot, type ShareStartRequest, type ShareUploadEvent } from '../../shared/share';
import type { OperationRecord } from '../../shared/operations';
import { TERMINAL_STATES } from '../../shared/operations';
import type { ExternalRunner, OperationManager } from '../ops/OperationManager';
import { isWithin, requireAbsolute, uniqueName, validateName } from '../fs/paths';
import { exists } from '../fs/FileSystemService';
import { listShareInterfaces, urlHost } from './interfaces';
import { boundaryOf, MultipartError, readMultipart, type FileSink } from './multipart';
import { listingHtml, messageHtml, STYLE_CSP_SOURCE, type ListedItem } from './page';

/**
 * "Share on local network": temporary HTTP servers in the main process.
 *
 * - Each share listens only on the addresses the user picked (0.0.0.0 only
 *   when "all interfaces" was chosen explicitly), on a random port.
 * - Every URL carries a 256-bit random token: /s/<token>/… . Anything else is
 *   404; tokens are compared in constant time; an address that sends too many
 *   wrong links is blocked for a while.
 * - Only the shared items are reachable: paths are built from validated
 *   segments under each item's real path, and the resolved path must be the
 *   same path (no symbolic link anywhere below the shared item).
 * - Read-only unless uploads into one folder were allowed. Uploads are
 *   streamed into a private staging folder inside the upload folder and then
 *   committed by a 'share-receive' operation (never overwriting: keep both).
 * - Shares stop when they expire, when the user stops them and when Orbis
 *   Files quits. Plain HTTP: the share panel says that transfers are not encrypted.
 */

const PART_PREFIX = '.orbis-part-';
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60_000;
const BLOCK_MS = 10 * 60_000;
const ACTIVITY_MAX = 200;
const LIST_MAX = 5000;
const ZIP_MAX_ENTRIES = 100_000;
const UPLOAD_MAX_FILES = 1000;

interface SharedItem {
  name: string;
  kind: 'file' | 'directory';
  /** Real (resolved) path at the time the share started. */
  real: string;
  size?: number;
}

interface ShareState {
  id: string;
  token: string;
  tokenDigest: Buffer;
  createdMs: number;
  expiresMs: number | null;
  state: 'running' | 'stopped';
  stoppedMs?: number;
  stopReason?: ShareSnapshot['stopReason'];
  port: number;
  allInterfaces: boolean;
  servers: http.Server[];
  urls: ShareSnapshot['urls'];
  items: SharedItem[];
  includeHidden: boolean;
  upload?: { folder: string; maxBytes: number };
  activity: ShareActivity[];
  stats: ShareSnapshot['stats'];
  failures: Map<string, { times: number[]; blockedUntil?: number; reported?: boolean }>;
  timer?: NodeJS.Timeout;
}

export interface ShareServiceDeps {
  ops: OperationManager;
  /** QR code for a URL, as an image data URL (SVG). */
  qr: (text: string) => Promise<string>;
  log?: { info(event: string, data?: Record<string, unknown>): void; warn(event: string, data?: Record<string, unknown>): void };
  now?: () => number;
  /** Interface list (tests can pass a fixed list). */
  interfaces?: () => ShareInterfaces;
}

/** QR codes rendered locally with the `qrcode` package (no network). */
export async function qrDataUrl(text: string): Promise<string> {
  const QR = await import('qrcode');
  const svg = await QR.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** A name for an uploaded file that is safe to create in the upload folder (no paths, no hidden or reserved names). */
export function safeUploadName(raw: string): string {
  let name = raw.replace(/\\/g, '/');
  name = name.slice(name.lastIndexOf('/') + 1).normalize('NFC');
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[<>:"|?*]/g, '_');
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  // Keep the name within 200 bytes, preserving a short extension.
  if (Buffer.byteLength(name, 'utf8') > 200) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    let stem = ext ? name.slice(0, dot) : name;
    while (Buffer.byteLength(stem + ext, 'utf8') > 200) stem = [...stem].slice(0, -1).join('');
    name = (stem + ext).replace(/[.\s]+$/, '');
  }
  if (!name || !validateName(name).valid) name = 'upload';
  return name;
}

/** Constant-time comparison of a presented token with the share's token (digests, so lengths never leak). */
export function tokenMatches(presented: string, digest: Buffer): boolean {
  const d = crypto.createHash('sha256').update(presented, 'utf8').digest();
  return crypto.timingSafeEqual(d, digest);
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

const BASE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
};
const PAGE_CSP = `default-src 'none'; style-src ${STYLE_CSP_SOURCE}; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
const DOWNLOAD_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const encodeSeg = (s: string) => encodeURIComponent(s);

export class ShareService extends EventEmitter {
  private shares = new Map<string, ShareState>();
  private changeTimer: NodeJS.Timeout | undefined;
  private readonly now: () => number;

  constructor(private readonly deps: ShareServiceDeps) {
    super();
    this.now = deps.now ?? Date.now;
  }

  interfaces(): ShareInterfaces {
    return (this.deps.interfaces ?? listShareInterfaces)();
  }

  list(): ShareSnapshot[] {
    return [...this.shares.values()].sort((a, b) => b.createdMs - a.createdMs).map((s) => this.snapshot(s));
  }

  get(id: string): ShareSnapshot | undefined {
    const s = this.shares.get(id);
    return s && this.snapshot(s);
  }

  /** Running shares (for the quit check and the status bar). */
  runningCount(): number {
    return [...this.shares.values()].filter((s) => s.state === 'running').length;
  }

  async start(req: ShareStartRequest): Promise<ShareSnapshot> {
    const op = 'share.start';
    // Items: existing files and folders, never links or a whole drive.
    const items: SharedItem[] = [];
    const used = new Set<string>();
    for (const p of req.paths) {
      const abs = requireAbsolute(p, op);
      if (path.parse(abs).root === abs) throw makeError('permission_denied', op, { message: 'Orbis Files will not share a whole drive. Choose folders or files inside it.' });
      const st = await fsp.lstat(abs).catch((err) => {
        throw new OrbisError(toOrbisError(err, op, abs, 'no'));
      });
      if (st.isSymbolicLink()) throw makeError('unsupported', op, { target: abs, message: `“${path.basename(abs)}” is a link. Share the item it points to instead.` });
      if (!st.isFile() && !st.isDirectory()) throw makeError('unsupported', op, { target: abs, message: 'Only files and folders can be shared.' });
      const real = await fsp.realpath(abs);
      let name = path.basename(abs);
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${path.basename(abs)} (${n})`;
      used.add(name.toLowerCase());
      items.push({ name, kind: st.isDirectory() ? 'directory' : 'file', real, size: st.isFile() ? st.size : undefined });
    }
    let upload: ShareState['upload'];
    if (req.upload) {
      const folder = requireAbsolute(req.upload.folder, op);
      const st = await fsp.stat(folder).catch((err) => {
        throw new OrbisError(toOrbisError(err, op, folder, 'no'));
      });
      if (!st.isDirectory()) throw makeError('not_a_directory', op, { target: folder, message: 'Uploads need a folder to save into.' });
      upload = { folder: await fsp.realpath(folder), maxBytes: req.upload.maxMB * 1024 * 1024 };
    }
    // Addresses: each must belong to an interface of this computer right now.
    const known = this.interfaces().interfaces;
    let bind: Array<{ address: string; interfaceName: string }>;
    if (req.allInterfaces) bind = [{ address: '0.0.0.0', interfaceName: 'all' }];
    else {
      if (!req.addresses.length) throw makeError('validation', op, { message: 'Choose at least one network to share on.' });
      bind = [];
      for (const a of new Set(req.addresses)) {
        const iface = known.find((i) => i.address === a);
        if (!iface) throw makeError('unavailable', op, { message: `${a} is not an address of this computer (any more). Choose a network again.` });
        bind.push({ address: a, interfaceName: iface.name });
      }
    }

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    const share: ShareState = {
      id,
      token,
      tokenDigest: crypto.createHash('sha256').update(token, 'utf8').digest(),
      createdMs: this.now(),
      expiresMs: EXPIRY_MS[req.expiry] === null ? null : this.now() + EXPIRY_MS[req.expiry]!,
      state: 'running',
      port: 0,
      allInterfaces: req.allInterfaces,
      servers: [],
      urls: [],
      items,
      includeHidden: req.includeHidden,
      upload,
      activity: [],
      stats: { requests: 0, downloads: 0, bytesSent: 0, uploads: 0, bytesReceived: 0, denied: 0 },
      failures: new Map(),
    };
    await this.listen(share, bind.map((b) => b.address));
    // The links to give out: one per address (for "all interfaces", every non-loopback IPv4 address).
    const shown = req.allInterfaces ? known.filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ address: i.address, interfaceName: i.name })) : bind;
    try {
      for (const b of shown) {
        const url = `http://${urlHost(b.address, share.port)}/s/${token}/`;
        share.urls.push({ address: b.address, interfaceName: b.interfaceName, url, qr: await this.deps.qr(url) });
      }
    } catch (err) {
      // Never leave a port open for a share the user cannot see.
      for (const srv of share.servers) {
        srv.close();
        srv.closeAllConnections();
      }
      throw new OrbisError(toOrbisError(err, 'share.start', undefined, 'no'));
    }
    if (share.expiresMs !== null) share.timer = setTimeout(() => void this.stop(id, 'expired').catch(() => undefined), share.expiresMs - this.now());
    share.timer?.unref?.();
    this.shares.set(id, share);
    this.deps.log?.info('share.started', { id, port: share.port, addresses: bind.length, allInterfaces: req.allInterfaces, items: items.length, uploads: !!upload, expiry: req.expiry });
    this.changed();
    return this.snapshot(share);
  }

  private async listen(share: ShareState, addresses: string[]): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const servers: http.Server[] = [];
      try {
        let port = 0;
        for (const address of addresses) {
          const server = http.createServer((req, res) => void this.handle(share, req, res));
          server.headersTimeout = 20_000;
          server.requestTimeout = 0; // large uploads and downloads may take long; headers must arrive quickly
          server.keepAliveTimeout = 5_000;
          server.maxConnections = 64;
          servers.push(server);
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen({ host: address, port, exclusive: true }, () => {
              server.off('error', reject);
              resolve();
            });
          });
          port = (server.address() as net.AddressInfo).port;
        }
        share.servers = servers;
        share.port = port;
        for (const s of servers) s.on('error', (err) => this.deps.log?.warn('share.server_error', { id: share.id, code: (err as NodeJS.ErrnoException).code }));
        return;
      } catch (err) {
        for (const s of servers) s.close();
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE' && addresses.length > 1) continue; // the random port was taken on another address: try another
        if (code === 'EADDRNOTAVAIL') throw makeError('unavailable', 'share.start', { message: 'That network address is not available any more. Choose a network again.' });
        throw new OrbisError(toOrbisError(err, 'share.start', undefined, 'no'));
      }
    }
    throw makeError('busy', 'share.start', { message: 'No free port was found on all chosen networks. Try again or choose one network.' });
  }

  /** Stop a share: its port is closed and open connections are ended. */
  async stop(id: string, reason: ShareSnapshot['stopReason'] = 'stopped'): Promise<void> {
    const s = this.shares.get(id);
    if (!s) throw makeError('not_found', 'share.stop', { message: 'This share no longer exists.' });
    if (s.state !== 'running') return;
    s.state = 'stopped';
    s.stoppedMs = this.now();
    s.stopReason = reason;
    clearTimeout(s.timer);
    await Promise.all(s.servers.map((srv) => new Promise<void>((resolve) => {
      srv.close(() => resolve());
      srv.closeAllConnections();
    })));
    this.deps.log?.info('share.stopped', { id, reason });
    this.changed();
  }

  /** Remove a stopped share from the list. */
  dismiss(id: string): void {
    const s = this.shares.get(id);
    if (!s) return;
    if (s.state === 'running') throw makeError('validation', 'share.dismiss', { message: 'Stop the share first.' });
    this.shares.delete(id);
    this.changed();
  }

  /** Stop every share at once (quit). Closes the ports synchronously. */
  stopAll(reason: ShareSnapshot['stopReason'] = 'quit'): void {
    for (const s of this.shares.values()) {
      if (s.state !== 'running') continue;
      s.state = 'stopped';
      s.stoppedMs = this.now();
      s.stopReason = reason;
      clearTimeout(s.timer);
      for (const srv of s.servers) {
        srv.close();
        srv.closeAllConnections();
      }
    }
    this.changed();
  }

  private snapshot(s: ShareState): ShareSnapshot {
    return {
      id: s.id,
      createdMs: s.createdMs,
      expiresMs: s.expiresMs,
      state: s.state,
      stoppedMs: s.stoppedMs,
      stopReason: s.stopReason,
      port: s.port,
      allInterfaces: s.allInterfaces,
      urls: s.urls.map((u) => ({ ...u })),
      items: s.items.map((i) => ({ name: i.name, kind: i.kind, size: i.size })),
      includeHidden: s.includeHidden,
      upload: s.upload && { ...s.upload },
      activity: s.activity.slice(),
      stats: { ...s.stats },
    };
  }

  private changed(): void {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      this.emit('changed', this.list());
    }, 150);
    this.changeTimer.unref?.();
  }

  private record(s: ShareState, a: Omit<ShareActivity, 'ms'>): void {
    s.activity.unshift({ ...a, ms: this.now() });
    if (s.activity.length > ACTIVITY_MAX) s.activity.length = ACTIVITY_MAX;
    this.changed();
  }

  // ------------------------------------------------------------------ requests

  private async handle(s: ShareState, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const from = (req.socket.remoteAddress ?? '?').replace(/^::ffff:/, '');
    try {
      if (s.state !== 'running') throw new HttpError(410, 'This share has stopped.');
      if (s.expiresMs !== null && this.now() >= s.expiresMs) {
        // Answer first, then close the port (stopping ends open connections, this one included).
        res.once('close', () => void this.stop(s.id, 'expired').catch(() => undefined));
        throw new HttpError(410, 'This share has expired.');
      }
      s.stats.requests++;
      // Requests must name this computer by IP address (refuses DNS-rebinding style host names).
      const host = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
      if (!net.isIP(host)) throw new HttpError(421, 'Use the address shown in Orbis Files.');
      const f = s.failures.get(from);
      if (f?.blockedUntil && f.blockedUntil > this.now()) {
        if (!f.reported) {
          f.reported = true;
          this.record(s, { from, kind: 'blocked', name: 'Too many wrong links', status: 'refused' });
        }
        res.setHeader('retry-after', String(Math.ceil((f.blockedUntil - this.now()) / 1000)));
        throw new HttpError(429, 'Too many wrong links from this device. Try again later.');
      }
      const raw = (req.url ?? '/').split('?')[0]!;
      if (!raw.startsWith('/')) throw new HttpError(400, 'Bad request.');
      const segments = raw.split('/').slice(1);
      // Requests browsers make on their own are not counted as wrong links.
      if (raw === '/' || raw === '/favicon.ico' || raw === '/robots.txt' || /^\/apple-touch-icon[\w-]*\.png$/.test(raw)) {
        if (raw === '/robots.txt') return this.send(res, 200, 'text/plain; charset=utf-8', 'User-agent: *\nDisallow: /\n', req.method === 'HEAD');
        throw new HttpError(404, 'Not found.');
      }
      if (segments[0] !== 's' || segments.length < 2 || !tokenMatches(segments[1] ?? '', s.tokenDigest)) {
        this.fail(s, from);
        throw new HttpError(404, 'Not found.');
      }
      const rest = segments.slice(2);
      if (rest.length === 0) return this.redirect(res, `/s/${s.token}/`);
      const segs = rest.map((x) => {
        let d: string;
        try {
          d = decodeURIComponent(x);
        } catch {
          throw new HttpError(400, 'Bad request.');
        }
        return d;
      });
      const method = req.method ?? 'GET';
      const [head, ...tail] = segs;
      if (head === 'upload' && tail.length === 0) {
        if (method !== 'POST') throw new HttpError(405, 'Use the form on the share page to send files.');
        return await this.receiveUpload(s, req, res, from);
      }
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'This share is read-only.');
      const headOnly = method === 'HEAD';
      if (head === '' && tail.length === 0) return this.indexPage(s, res, from, headOnly);
      if (head === 'f' || head === 'zip') {
        const n = Number(tail[0]);
        const item = Number.isInteger(n) && /^\d+$/.test(tail[0] ?? '') ? s.items[n] : undefined;
        if (!item) throw new HttpError(404, 'Not found.');
        const inner = tail.slice(1);
        const trailingSlash = inner.length > 0 && inner[inner.length - 1] === '';
        if (trailingSlash) inner.pop();
        const target = await this.resolve(s, item, inner);
        if (head === 'zip') {
          if (!target.st.isDirectory()) throw new HttpError(404, 'Not found.');
          return await this.sendZip(s, res, from, target.real, inner.length ? inner[inner.length - 1]! : item.name, headOnly);
        }
        if (target.st.isDirectory()) {
          if (!trailingSlash && item.kind === 'directory') return this.redirect(res, `/s/${s.token}/f/${n}/${inner.map(encodeSeg).join('/')}${inner.length ? '/' : ''}`);
          return await this.folderPage(s, res, n, item, inner, target.real, headOnly);
        }
        return await this.sendFile(s, req, res, from, target.real, target.st, inner.length ? inner[inner.length - 1]! : item.name, headOnly);
      }
      throw new HttpError(404, 'Not found.');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : 'Something went wrong while answering this request.';
      if (!(err instanceof HttpError)) this.deps.log?.warn('share.request_failed', { id: s.id, message: (err as Error)?.message });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const titles: Record<number, string> = { 400: 'Bad request', 403: 'Not allowed', 404: 'Not found', 405: 'Not allowed', 410: 'Share ended', 413: 'Too large', 416: 'Range not available', 421: 'Wrong address', 429: 'Too many attempts', 500: 'Error' };
      this.send(res, status, 'text/html; charset=utf-8', messageHtml(titles[status] ?? 'Error', message), req.method === 'HEAD');
    }
  }

  private fail(s: ShareState, from: string): void {
    s.stats.denied++;
    const now = this.now();
    const f = s.failures.get(from) ?? { times: [] };
    f.times = f.times.filter((t) => now - t < FAILURE_WINDOW_MS);
    f.times.push(now);
    if (f.times.length === 1) this.record(s, { from, kind: 'denied', name: 'Wrong link', status: 'refused' });
    if (f.times.length >= MAX_FAILURES) {
      f.blockedUntil = now + BLOCK_MS;
      f.reported = false;
      f.times = [];
    }
    s.failures.set(from, f);
    // Keep the table small.
    if (s.failures.size > 1000) for (const [k, v] of s.failures) if (!v.blockedUntil || v.blockedUntil < now) s.failures.delete(k);
  }

  private send(res: http.ServerResponse, status: number, type: string, body: string, headOnly: boolean, extra: Record<string, string> = {}): void {
    const buf = Buffer.from(body, 'utf8');
    res.writeHead(status, { ...BASE_HEADERS, 'content-security-policy': PAGE_CSP, 'content-type': type, 'content-length': String(buf.length), ...extra });
    res.end(headOnly ? undefined : buf);
  }

  private redirect(res: http.ServerResponse, to: string): void {
    res.writeHead(303, { ...BASE_HEADERS, 'content-security-policy': PAGE_CSP, location: to, 'content-length': '0' });
    res.end();
  }

  /**
   * Resolve a path inside a shared item from decoded URL segments. Refused:
   * empty, ".", ".." or separator-containing segments, hidden names (unless
   * allowed), Orbis temporary files, and any path whose real location differs
   * from its plain location (a link anywhere below the shared item).
   */
  private async resolve(s: ShareState, item: SharedItem, segs: string[]): Promise<{ real: string; st: fs.Stats }> {
    if (item.kind === 'file' && segs.length) throw new HttpError(404, 'Not found.');
    for (const seg of segs) {
      if (!seg || seg === '.' || seg === '..' || /[/\\\0]/.test(seg) || seg.startsWith(PART_PREFIX)) throw new HttpError(404, 'Not found.');
      if (!s.includeHidden && seg.startsWith('.')) throw new HttpError(404, 'Not found.');
    }
    const plain = path.join(item.real, ...segs);
    if (!isWithin(item.real, plain)) throw new HttpError(404, 'Not found.');
    let real: string;
    try {
      real = await fsp.realpath(plain);
    } catch {
      throw new HttpError(404, 'Not found.');
    }
    if (real !== plain || !isWithin(item.real, real)) throw new HttpError(404, 'Not found.');
    const st = await fsp.stat(real).catch(() => undefined);
    if (!st || (!st.isFile() && !st.isDirectory())) throw new HttpError(404, 'Not found.');
    return { real, st };
  }

  private uploadInfo(s: ShareState): string | undefined {
    if (!s.upload) return undefined;
    const mb = s.upload.maxBytes / 1024 / 1024;
    return `Up to ${mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${Math.round(mb)} MB`} per sending. Files are saved with their names; nothing on this computer is replaced (a number is added if the name exists).`;
  }

  private indexPage(s: ShareState, res: http.ServerResponse, from: string, headOnly: boolean): void {
    const items: ListedItem[] = s.items.map((it, i) => ({
      name: it.name,
      kind: it.kind,
      size: it.size,
      href: it.kind === 'directory' ? `f/${i}/` : `f/${i}`,
      zipHref: it.kind === 'directory' ? `zip/${i}` : undefined,
    }));
    if (!headOnly) this.record(s, { from, kind: 'page', name: 'Opened the share page', status: 'ok' });
    this.send(res, 200, 'text/html; charset=utf-8', listingHtml({ title: s.items.length === 1 ? s.items[0]!.name : `${s.items.length} shared items`, items, uploadAction: s.upload ? 'upload' : undefined, uploadInfo: this.uploadInfo(s) }), headOnly);
  }

  private async folderPage(s: ShareState, res: http.ServerResponse, n: number, item: SharedItem, inner: string[], real: string, headOnly: boolean): Promise<void> {
    const base = `/s/${s.token}`;
    const entries: ListedItem[] = [];
    let skipped = 0;
    const dirents = await fsp.readdir(real, { withFileTypes: true }).catch(() => {
      throw new HttpError(404, 'Not found.');
    });
    const rel = inner.map(encodeSeg).join('/');
    const prefix = `${base}/f/${n}/${rel ? `${rel}/` : ''}`;
    const zipPrefix = `${base}/zip/${n}/${rel ? `${rel}/` : ''}`;
    for (const d of dirents) {
      if (d.name.startsWith(PART_PREFIX) || (!s.includeHidden && d.name.startsWith('.'))) continue;
      if (!d.isFile() && !d.isDirectory()) continue; // links, devices, sockets are not shared
      if (entries.length >= LIST_MAX) {
        skipped++;
        continue;
      }
      const size = d.isFile() ? (await fsp.lstat(path.join(real, d.name)).catch(() => undefined))?.size : undefined;
      entries.push({ name: d.name, kind: d.isDirectory() ? 'directory' : 'file', size, href: `${prefix}${encodeSeg(d.name)}${d.isDirectory() ? '/' : ''}`, zipHref: d.isDirectory() ? `${zipPrefix}${encodeSeg(d.name)}` : undefined });
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    entries.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'directory' ? -1 : 1));
    const crumbs: Array<{ name: string; href?: string }> = [{ name: 'Shared items', href: `${base}/` }];
    const parts = [item.name, ...inner];
    parts.forEach((p, i) => crumbs.push({ name: p, href: i === parts.length - 1 ? undefined : `${base}/f/${n}/${inner.slice(0, i).map(encodeSeg).join('/')}${i ? '/' : ''}` }));
    const title = parts[parts.length - 1]!;
    const page = listingHtml({ title, crumbs, items: entries, truncated: skipped });
    // A download of the whole folder.
    const withZip = page.replace('<ul>', `<p><a class="btn" href="${zipPrefix.replace(/\/$/, '')}">Download this folder as ZIP</a></p><ul>`);
    this.send(res, 200, 'text/html; charset=utf-8', withZip, headOnly);
  }

  private async sendFile(s: ShareState, req: http.IncomingMessage, res: http.ServerResponse, from: string, real: string, st: fs.Stats, name: string, headOnly: boolean): Promise<void> {
    // Open without following a link swapped in at the last moment, and check it is the file that was resolved.
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const fh = await fsp.open(real, flags).catch(() => {
      throw new HttpError(404, 'Not found.');
    });
    let handedOver = false;
    try {
      const fst = await fh.stat();
      if (!fst.isFile() || fst.ino !== st.ino || fst.dev !== st.dev) throw new HttpError(404, 'Not found.');
      const size = fst.size;
      const lastModified = fst.mtime.toUTCString();
      let start = 0;
      let end = size - 1;
      let partial = false;
      const range = req.headers.range;
      const ifRange = req.headers['if-range'];
      if (range && (!ifRange || ifRange === lastModified)) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (m && (m[1] || m[2])) {
          if (m[1]) {
            start = Number(m[1]);
            end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
          } else {
            const suffix = Number(m[2]);
            start = Math.max(0, size - suffix);
            end = size - 1;
          }
          if (!Number.isSafeInteger(start) || start >= size || start > end || (m[1] && m[2] && Number(m[2]) < start)) {
            res.writeHead(416, { ...BASE_HEADERS, 'content-security-policy': DOWNLOAD_CSP, 'content-range': `bytes */${size}`, 'content-length': '0' });
            res.end();
            return;
          }
          partial = true;
        }
        // Several ranges or an unreadable header: the whole file is sent (allowed by HTTP).
      }
      const length = size === 0 ? 0 : end - start + 1;
      const headers: Record<string, string> = {
        ...BASE_HEADERS,
        'content-security-policy': DOWNLOAD_CSP,
        'content-type': 'application/octet-stream',
        'content-disposition': contentDisposition(name),
        'accept-ranges': 'bytes',
        'last-modified': lastModified,
        'content-length': String(length),
      };
      if (partial) headers['content-range'] = `bytes ${start}-${end}/${size}`;
      res.writeHead(partial ? 206 : 200, headers);
      if (headOnly || length === 0) {
        res.end();
        if (!headOnly) this.recordDownload(s, from, name, 0, partial, true);
        return;
      }
      const stream = fh.createReadStream({ start, end, autoClose: true });
      handedOver = true;
      let sent = 0;
      stream.on('data', (c: Buffer | string) => (sent += c.length));
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        res.on('close', done);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      });
      stream.destroy();
      s.stats.bytesSent += sent;
      this.recordDownload(s, from, name, sent, partial, sent === length && res.writableFinished);
    } finally {
      if (!handedOver) await fh.close().catch(() => undefined);
    }
  }

  private recordDownload(s: ShareState, from: string, name: string, bytes: number, range: boolean, complete: boolean): void {
    if (complete) s.stats.downloads++;
    this.record(s, { from, kind: 'download', name, bytes, range: range || undefined, status: complete ? 'ok' : 'incomplete' });
  }

  /** Stream a folder as a ZIP (links, special files, Orbis temporary files and — unless allowed — hidden items are left out). */
  private async sendZip(s: ShareState, res: http.ServerResponse, from: string, root: string, name: string, headOnly: boolean): Promise<void> {
    const files: Array<{ abs: string; rel: string; dir: boolean; mtime: Date }> = [];
    const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '' }];
    while (stack.length) {
      const { abs, rel } = stack.pop()!;
      const dirents = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
      let added = 0;
      for (const d of dirents) {
        if (d.name.startsWith(PART_PREFIX) || (!s.includeHidden && d.name.startsWith('.'))) continue;
        const childAbs = path.join(abs, d.name);
        const childRel = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) {
          stack.push({ abs: childAbs, rel: childRel });
          added++;
        } else if (d.isFile()) {
          const st = await fsp.lstat(childAbs).catch(() => undefined);
          if (!st?.isFile()) continue;
          files.push({ abs: childAbs, rel: childRel, dir: false, mtime: st.mtime });
          added++;
        }
        if (files.length > ZIP_MAX_ENTRIES) throw new HttpError(413, `This folder has more than ${ZIP_MAX_ENTRIES.toLocaleString('en')} files, which is too many for one ZIP. Open it and download smaller folders.`);
      }
      if (!added && rel) files.push({ abs, rel, dir: true, mtime: new Date() });
    }
    const zipName = `${name || 'folder'}.zip`;
    res.writeHead(200, { ...BASE_HEADERS, 'content-security-policy': DOWNLOAD_CSP, 'content-type': 'application/zip', 'content-disposition': contentDisposition(zipName) });
    if (headOnly) {
      res.end();
      return;
    }
    const zip = new yazl.ZipFile();
    let sent = 0;
    let failed = false;
    (zip as unknown as NodeJS.EventEmitter).on('error', () => {
      failed = true;
      res.destroy();
    });
    zip.outputStream.on('data', (c: Buffer) => (sent += c.length));
    for (const f of files) {
      if (f.dir) zip.addEmptyDirectory(f.rel, { mtime: f.mtime });
      else zip.addFile(f.abs, f.rel, { mtime: f.mtime });
    }
    zip.end();
    await new Promise<void>((resolve) => {
      res.on('close', () => resolve());
      zip.outputStream.pipe(res);
    });
    s.stats.bytesSent += sent;
    const complete = !failed && res.writableFinished;
    if (complete) s.stats.downloads++;
    this.record(s, { from, kind: 'zip', name: zipName, bytes: sent, status: complete ? 'ok' : 'incomplete', detail: `${files.filter((f) => !f.dir).length} files` });
  }

  // ------------------------------------------------------------------ uploads

  private async receiveUpload(s: ShareState, req: http.IncomingMessage, res: http.ServerResponse, from: string): Promise<void> {
    const back = `/s/${s.token}/`;
    const refuse = (status: number, message: string) => {
      req.resume();
      res.setHeader('connection', 'close');
      this.record(s, { from, kind: 'upload', name: 'Upload', status: 'refused', detail: message });
      this.send(res, status, 'text/html; charset=utf-8', messageHtml(status === 413 ? 'Too large' : 'Not sent', message, back), false);
    };
    if (!s.upload) return refuse(403, 'This share does not accept uploads.');
    const boundary = boundaryOf(req.headers['content-type']);
    if (!boundary) return refuse(400, 'Send files with the form on the share page.');
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > s.upload.maxBytes + 64 * 1024) return refuse(413, `This share accepts at most ${Math.round(s.upload.maxBytes / 1024 / 1024)} MB at a time.`);
    const folder = s.upload.folder;
    const stage = path.join(folder, `${PART_PREFIX}${crypto.randomUUID()}`);
    await fsp.mkdir(stage, { mode: 0o700 });
    const staged: Array<{ path: string; original: string; bytes: number }> = [];
    const open: Array<fsp.FileHandle> = [];
    try {
      await readMultipart(req, boundary, {
        maxBytes: s.upload.maxBytes + 64 * 1024, // the form's own framing is not counted against the limit
        maxFiles: UPLOAD_MAX_FILES,
        onFile: async ({ filename }): Promise<FileSink> => {
          let name = safeUploadName(filename);
          if (staged.some((x) => path.basename(x.path).toLowerCase() === name.toLowerCase())) name = await uniqueName(stage, name, exists);
          const p = path.join(stage, name);
          const fh = await fsp.open(p, 'wx', 0o644);
          open.push(fh);
          const entry = { path: p, original: filename, bytes: 0 };
          staged.push(entry);
          return {
            write: async (chunk) => {
              entry.bytes += chunk.length;
              if (staged.reduce((a, x) => a + x.bytes, 0) > s.upload!.maxBytes) throw new MultipartError(413, `This share accepts at most ${Math.round(s.upload!.maxBytes / 1024 / 1024)} MB at a time.`);
              await fh.write(chunk);
            },
            end: async () => {
              await fh.sync();
              await fh.close();
              open.splice(open.indexOf(fh), 1);
            },
          };
        },
      });
    } catch (err) {
      for (const fh of open) await fh.close().catch(() => undefined);
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
      const status = err instanceof MultipartError ? err.status : 500;
      const message = err instanceof MultipartError ? err.message : 'The files could not be saved on this computer.';
      if (!(err instanceof MultipartError)) this.deps.log?.warn('share.upload_failed', { id: s.id, message: (err as Error)?.message });
      if (!res.headersSent) {
        res.setHeader('connection', 'close');
        this.record(s, { from, kind: 'upload', name: staged.map((x) => safeUploadName(x.original)).join(', ') || 'Upload', status: 'failed', detail: message });
        this.send(res, status, 'text/html; charset=utf-8', messageHtml('Not sent', `${message} Nothing was saved.`, back), false);
      }
      req.resume();
      return;
    }
    if (!staged.length) {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
      return this.send(res, 400, 'text/html; charset=utf-8', messageHtml('Nothing sent', 'Choose one or more files first.', back), false);
    }
    // Commit through the operation engine: never overwrites (keep both), shown in Operations.
    let rec: OperationRecord;
    try {
      rec = await this.commitUpload(s, staged.map((x) => x.path), folder);
    } finally {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
    }
    const lines: string[] = [];
    let saved = 0;
    for (const x of staged) {
      const r = rec.results.find((y) => y.source === x.path);
      const savedAs = r?.status === 'done' && r.destination ? path.basename(r.destination) : undefined;
      if (savedAs) {
        saved++;
        s.stats.uploads++;
        s.stats.bytesReceived += x.bytes;
        lines.push(savedAs === path.basename(x.path) ? savedAs : `${path.basename(x.path)} → saved as ${savedAs}`);
        this.record(s, { from, kind: 'upload', name: savedAs, bytes: x.bytes, status: 'ok' });
        const ev: ShareUploadEvent = { shareId: s.id, from, name: path.basename(x.path), savedAs: r!.destination!, bytes: x.bytes };
        this.emit('upload', ev);
      } else {
        lines.push(`${path.basename(x.path)} — not saved${r?.error ? `: ${r.error.message}` : ''}`);
        this.record(s, { from, kind: 'upload', name: path.basename(x.path), bytes: x.bytes, status: 'failed', detail: r?.error?.message ?? rec.error?.message });
      }
    }
    const ok = saved === staged.length;
    this.send(res, ok ? 200 : 500, 'text/html; charset=utf-8', messageHtml(ok ? 'Sent' : 'Not everything was saved', ok ? `${saved} file${saved === 1 ? '' : 's'} saved on the other computer.` : `${saved} of ${staged.length} files were saved.`, back, lines), false);
  }

  private commitUpload(s: ShareState, sources: string[], folder: string): Promise<OperationRecord> {
    const rec = this.deps.ops.start({ type: 'share-receive', sources, destination: folder, conflictPolicy: 'keep-both', origin: `share:${s.id}` });
    return new Promise((resolve) => {
      const check = (r: OperationRecord) => {
        if (r.id !== rec.id || !TERMINAL_STATES.has(r.state)) return;
        this.deps.ops.off('update', check);
        resolve(r);
      };
      this.deps.ops.on('update', check);
      const cur = this.deps.ops.get(rec.id);
      if (cur && TERMINAL_STATES.has(cur.state)) check(structuredClone(cur));
    });
  }
}

/**
 * The 'share-receive' operation: moves files that a share received (staged in
 * a private ".orbis-part-*" folder inside the upload folder) into that folder.
 * Never replaces anything: a taken name gets a number ("photo (2).jpg"). Each
 * file is committed with link() (fails instead of overwriting) and only then
 * removed from staging.
 */
export function makeShareReceiveRunner(markRunning: (rec: OperationRecord) => void): { run: ExternalRunner; validate: (req: { sources: string[]; destination?: string }) => void } {
  const validate = (req: { sources: string[]; destination?: string }) => {
    if (!req.destination) throw makeError('validation', 'ops.share-receive', { message: 'A destination is required.' });
    for (const src of req.sources) {
      const stage = path.dirname(src);
      if (path.dirname(stage) !== path.resolve(req.destination) || !path.basename(stage).startsWith(PART_PREFIX)) {
        throw makeError('validation', 'ops.share-receive', { message: 'Only files received by a share can be committed this way.', target: src });
      }
    }
  };
  const run: ExternalRunner = async (rec, _req, ctx, helpers) => {
    const dest = rec.destination!;
    let totalBytes = 0;
    for (const src of rec.sources) totalBytes += (await fsp.lstat(src).catch(() => undefined))?.size ?? 0;
    rec.progress = { totalItems: rec.sources.length, totalBytes, completedItems: 0, completedBytes: 0 };
    markRunning(rec);
    for (const src of rec.sources) {
      await ctx.gate();
      try {
        const st = await fsp.lstat(src);
        if (!st.isFile()) throw makeError('unsupported', 'ops.share-receive', { target: src, message: 'Only regular files are received.' });
        const name = path.basename(src);
        let target = path.join(dest, name);
        for (let attempt = 0; ; attempt++) {
          try {
            await fsp.link(src, target);
            break;
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EEXIST' && attempt < 50) {
              target = path.join(dest, await uniqueName(dest, name, exists));
              continue;
            }
            if (code === 'EEXIST') throw err;
            // No hard links on this file system (FAT, some network shares): a checked rename instead.
            if (await exists(target)) target = path.join(dest, await uniqueName(dest, name, exists));
            await fsp.rename(src, target);
            break;
          }
        }
        await fsp.unlink(src).catch(() => undefined);
        rec.results.push({ source: src, destination: target, status: 'done' });
        helpers.tick(st.size, 1, path.basename(target));
      } catch (err) {
        const shape = toOrbisError(err, 'ops.share-receive', src, 'no');
        if (shape.category === 'cancelled') throw err;
        rec.results.push({ source: src, status: 'failed', error: shape });
      }
    }
    rec.undo = { kind: 'none', reason: 'Received files stay where they were saved. Move them to the Trash if you do not want them.' };
  };
  return { run, validate };
}
