import http from 'node:http';
import https from 'node:https';
import { PassThrough, type Readable } from 'node:stream';
import { isLoopbackHost, normalizeRemotePath, remoteBase, remoteNameProblem, remoteParent } from '../../shared/remote';
import { CAUSE, networkError, remoteError, type RemoteEntry, type RemoteFs, type RemoteListing } from './types';
import { childrenNamed, firstChild, parseXml, textOf, XML_MAX_BYTES, XmlError, type XmlElement } from './xml';

export interface WebDavOptions {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  /** Plain HTTP to a host other than this computer (the user confirmed it). */
  allowUnencrypted?: boolean;
  /** Socket inactivity timeout (ms). */
  timeoutMs?: number;
  /** Extra TLS options (tests: a CA to trust). Certificates are always verified. */
  ca?: string | Buffer;
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>\n<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:getcontentlength/><D:getlastmodified/><D:getetag/></D:prop></D:propfind>';

/**
 * WebDAV client on Node's http/https (RFC 4918 subset): PROPFIND depth 0/1,
 * GET with Range, streaming PUT (never overwriting: If-None-Match: *),
 * MKCOL, MOVE and COPY (Overwrite: F unless replacing), DELETE.
 * Basic authentication is only ever sent over HTTPS, to this computer, or
 * when the user explicitly allowed an unencrypted connection. Redirects are
 * not followed (credentials never travel to another address).
 */
export class WebDavFs implements RemoteFs {
  readonly protocol = 'webdav' as const;
  private agent: http.Agent;
  private closed = false;
  private readonly auth: string;
  private readonly where: string;

  constructor(private readonly o: WebDavOptions) {
    if (!o.secure && !isLoopbackHost(o.host) && !o.allowUnencrypted) {
      throw remoteError('validation', 'remote.webdav', 'Plain HTTP to another computer needs “Allow unencrypted connection”.');
    }
    const AgentClass = o.secure ? https.Agent : http.Agent;
    this.agent = new AgentClass({ keepAlive: true, maxSockets: 6, ...(o.secure && o.ca ? { ca: o.ca } : {}) });
    this.auth = `Basic ${Buffer.from(`${o.username}:${o.password}`, 'utf8').toString('base64')}`;
    this.where = `${o.host}:${o.port}`;
  }

  get alive(): boolean {
    return !this.closed;
  }

  close(): void {
    this.closed = true;
    this.agent.destroy();
  }

  async home(): Promise<string> {
    return '/';
  }

  /** Check the address and credentials (PROPFIND depth 0 on a folder). */
  async check(p: string): Promise<RemoteEntry> {
    return this.stat(p);
  }

  private urlPath(p: string, collection = false): string {
    const enc = p === '/' ? '/' : p.split('/').map((s) => encodeURIComponent(s)).join('/');
    return collection && !enc.endsWith('/') ? `${enc}/` : enc;
  }

  private origin(): string {
    const host = this.o.host.includes(':') ? `[${this.o.host}]` : this.o.host;
    return `${this.o.secure ? 'https' : 'http'}://${host}:${this.o.port}`;
  }

  private request(method: string, p: string, opts: { headers?: Record<string, string>; body?: string; collection?: boolean; signal?: AbortSignal; stream?: boolean } = {}): Promise<http.IncomingMessage> {
    if (this.closed) return Promise.reject(remoteError('unavailable', `remote.${method.toLowerCase()}`, `The connection to ${this.where} was closed.`, { cause: CAUSE.connectionLost, retryable: true }));
    const mod = this.o.secure ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request({
        host: this.o.host,
        port: this.o.port,
        method,
        path: this.urlPath(p, opts.collection),
        agent: this.agent,
        headers: { Authorization: this.auth, 'User-Agent': 'OrbisFiles', ...(opts.body ? { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': String(Buffer.byteLength(opts.body)) } : {}), ...opts.headers },
        signal: opts.signal,
        ...(this.o.secure ? { servername: isIp(this.o.host) ? undefined : this.o.host } : {}),
      });
      req.setTimeout(this.o.timeoutMs ?? 30_000, () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
      req.on('response', resolve);
      req.on('error', (err) => reject(networkError(err, `remote.${method.toLowerCase()}`, this.where)));
      req.end(opts.body);
    });
  }

  /** Map an HTTP status to an honest error (the body is drained, never echoed: it may contain anything). */
  private statusError(res: http.IncomingMessage, operation: string, target: string, ctx: 'mkcol' | 'move' | 'put' | 'other' = 'other') {
    res.resume();
    const s = res.statusCode ?? 0;
    const what = `${s} ${res.statusMessage ?? ''}`.trim();
    if (s === 401) return remoteError('permission_denied', operation, 'The server did not accept the user name or password.', { cause: `${CAUSE.authFailed}: ${what}`, target });
    if (s === 403) return remoteError('permission_denied', operation, 'The server does not allow this here (403 Forbidden).', { cause: what, target });
    if (s === 404 || s === 410) return remoteError('not_found', operation, 'The item no longer exists on the server.', { cause: what, target });
    if (s === 405 && ctx === 'mkcol') return remoteError('already_exists', operation, 'An item with this name already exists.', { cause: what, target });
    if (s === 409) return remoteError('not_found', operation, 'The folder it should go into does not exist on the server.', { cause: what, target });
    if (s === 412) return remoteError('already_exists', operation, 'An item with this name already exists on the server.', { cause: what, target });
    if (s === 423) return remoteError('busy', operation, 'The item is locked on the server.', { cause: what, target, retryable: true });
    if (s === 507) return remoteError('no_space', operation, 'The server has no space left for this.', { cause: what, target });
    if (s === 413) return remoteError('no_space', operation, 'The server refused the file because it is too large.', { cause: what, target });
    if (s >= 300 && s < 400) return remoteError('unsupported', operation, 'The server answered with a redirect; Orbis Files does not follow redirects for WebDAV (check the address and HTTPS setting).', { cause: what, target });
    if (s >= 500) return remoteError('unavailable', operation, `The server reported an error (${what}).`, { cause: what, target, retryable: true });
    return remoteError('io', operation, `The server refused the request (${what}).`, { cause: what, target });
  }

  private async readBody(res: http.IncomingMessage, limit = XML_MAX_BYTES): Promise<string> {
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const c of res) {
      n += (c as Buffer).length;
      if (n > limit) {
        res.destroy();
        throw remoteError('io', 'remote.list', 'The server’s answer is too large.');
      }
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private async propfind(p: string, depth: 0 | 1, collection: boolean, signal?: AbortSignal): Promise<XmlElement> {
    let res = await this.request('PROPFIND', p, { headers: { Depth: String(depth) }, body: PROPFIND_BODY, collection, signal });
    // A folder addressed without its trailing slash: retry once with it (never follow other redirects).
    if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && !collection) {
      const loc = res.headers.location ?? '';
      res.resume();
      let target = '';
      try {
        target = new URL(loc, this.origin()).pathname;
      } catch {
        /* not a URL */
      }
      if (target === this.urlPath(p, true)) res = await this.request('PROPFIND', p, { headers: { Depth: String(depth) }, body: PROPFIND_BODY, collection: true, signal });
      else throw this.statusError(res, 'remote.list', p);
    }
    if (res.statusCode !== 207) throw this.statusError(res, depth ? 'remote.list' : 'remote.stat', p);
    const text = await this.readBody(res);
    try {
      const root = parseXml(text);
      if (root.name !== 'multistatus' || root.ns !== 'DAV:') throw new XmlError('Not a WebDAV multistatus response.');
      return root;
    } catch (err) {
      if (err instanceof XmlError) throw remoteError('io', 'remote.list', `The server’s answer could not be read safely: ${err.message}`, { target: p });
      throw err;
    }
  }

  /** Decode a response href into an absolute server path, or null when it is not on this server or malformed. */
  private hrefPath(href: string): string | null {
    const raw = href.trim();
    try {
      const u = new URL(raw, this.origin());
      if (u.origin !== new URL(this.origin()).origin) return null;
    } catch {
      return null;
    }
    // Segments are taken from the href as sent (the URL parser would silently resolve "../"),
    // so a dot segment, plain or percent-encoded, is refused rather than normalised away.
    const pathname = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/, '').replace(/[?#].*$/, '');
    if (!pathname.startsWith('/')) return null;
    const segs = pathname.split('/').filter((s, i, a) => !(s === '' && (i === 0 || i === a.length - 1)));
    const decoded: string[] = [];
    for (const s of segs) {
      let d: string;
      try {
        d = decodeURIComponent(s);
      } catch {
        return null;
      }
      if (remoteNameProblem(d)) return null;
      decoded.push(d);
    }
    return decoded.length ? `/${decoded.join('/')}` : '/';
  }

  private entryFrom(resp: XmlElement): { path: string | null; rawHref: string; entry?: Omit<RemoteEntry, 'name' | 'path'> } {
    const rawHref = textOf(firstChild(resp, 'href'));
    const p = this.hrefPath(rawHref);
    let prop: XmlElement | undefined;
    for (const ps of childrenNamed(resp, 'propstat')) {
      const status = textOf(firstChild(ps, 'status'));
      if (/\s200\s/.test(` ${status} `) || / 200 /.test(status)) {
        prop = firstChild(ps, 'prop');
        break;
      }
    }
    if (!prop) return { path: p, rawHref };
    const isDir = !!firstChild(firstChild(prop, 'resourcetype'), 'collection');
    const len = textOf(firstChild(prop, 'getcontentlength')).trim();
    const mod = textOf(firstChild(prop, 'getlastmodified')).trim();
    const etag = textOf(firstChild(prop, 'getetag')).trim();
    const size = /^\d{1,16}$/.test(len) ? Number(len) : undefined;
    const ms = mod ? Date.parse(mod) : NaN;
    return { path: p, rawHref, entry: { kind: isDir ? 'directory' : 'file', size: isDir ? undefined : size, modifiedMs: Number.isFinite(ms) ? ms : undefined, etag: etag || undefined } };
  }

  async list(dir: string, signal?: AbortSignal): Promise<RemoteListing> {
    const d = normalizeRemotePath(dir);
    const root = await this.propfind(d, 1, true, signal);
    const entries: RemoteEntry[] = [];
    const refused: string[] = [];
    const seen = new Set<string>();
    for (const resp of childrenNamed(root, 'response')) {
      const r = this.entryFrom(resp);
      if (r.path === d) continue; // the folder itself
      // Only direct children of the folder asked for, with safe names; anything else is refused.
      if (!r.path || remoteParent(r.path) !== d) {
        refused.push(r.rawHref.slice(0, 200));
        continue;
      }
      if (!r.entry || seen.has(r.path)) continue;
      seen.add(r.path);
      entries.push({ name: remoteBase(r.path), path: r.path, ...r.entry });
    }
    return { entries, refused };
  }

  async stat(p: string): Promise<RemoteEntry> {
    const target = normalizeRemotePath(p);
    const root = await this.propfind(target, 0, target === '/');
    for (const resp of childrenNamed(root, 'response')) {
      const r = this.entryFrom(resp);
      if (r.path === target && r.entry) return { name: remoteBase(target), path: target, ...r.entry };
    }
    throw remoteError('io', 'remote.stat', 'The server did not describe the item.', { target });
  }

  async read(p: string, opts: { start?: number; end?: number; signal?: AbortSignal } = {}): Promise<Readable> {
    const ranged = opts.start !== undefined || opts.end !== undefined;
    const headers: Record<string, string> = { 'Accept-Encoding': 'identity' };
    if (ranged) headers.Range = `bytes=${opts.start ?? 0}-${opts.end ?? ''}`;
    const res = await this.request('GET', p, { headers, signal: opts.signal });
    if (res.statusCode === 206) {
      const cr = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(String(res.headers['content-range'] ?? ''));
      if (!cr || Number(cr[1]) !== (opts.start ?? 0)) {
        res.resume();
        throw remoteError('io', 'remote.read', 'The server returned a different part of the file than asked for.', { target: p });
      }
      return res;
    }
    if (res.statusCode === 200) {
      if (ranged && (opts.start ?? 0) > 0) {
        res.resume();
        throw remoteError('unsupported', 'remote.read', 'The server does not support reading part of a file.', { target: p });
      }
      return res;
    }
    throw this.statusError(res, 'remote.read', p);
  }

  async write(p: string, opts: { signal?: AbortSignal; size?: number } = {}) {
    if (this.closed) throw remoteError('unavailable', 'remote.write', `The connection to ${this.where} was closed.`, { cause: CAUSE.connectionLost });
    const mod = this.o.secure ? https : http;
    const body = new PassThrough();
    const done = new Promise<void>((resolve, reject) => {
      const req = mod.request({
        host: this.o.host,
        port: this.o.port,
        method: 'PUT',
        path: this.urlPath(p),
        agent: this.agent,
        signal: opts.signal,
        headers: {
          Authorization: this.auth,
          'User-Agent': 'OrbisFiles',
          'Content-Type': 'application/octet-stream',
          // Never replace an item that exists (callers write to a fresh temporary name).
          'If-None-Match': '*',
          ...(opts.size !== undefined ? { 'Content-Length': String(opts.size) } : {}),
        },
        ...(this.o.secure ? { servername: isIp(this.o.host) ? undefined : this.o.host } : {}),
      });
      req.setTimeout(this.o.timeoutMs ?? 30_000, () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
      req.on('error', (err) => reject(networkError(err, 'remote.write', this.where)));
      req.on('response', (res) => {
        if (res.statusCode === 201 || res.statusCode === 204 || res.statusCode === 200) {
          res.resume();
          resolve();
        } else reject(this.statusError(res, 'remote.write', p, 'put'));
      });
      body.on('error', (err) => req.destroy(err));
      body.pipe(req);
    });
    done.catch(() => body.destroy());
    return { stream: body, done };
  }

  async mkdir(p: string): Promise<void> {
    const res = await this.request('MKCOL', p, { collection: true });
    if (res.statusCode === 201) {
      res.resume();
      return;
    }
    throw this.statusError(res, 'remote.mkdir', p, 'mkcol');
  }

  private async moveOrCopy(method: 'MOVE' | 'COPY', from: string, to: string, overwrite: boolean): Promise<void> {
    const st = await this.stat(from);
    const isDir = st.kind === 'directory';
    const res = await this.request(method, from, {
      collection: isDir,
      headers: { Destination: `${this.origin()}${this.urlPath(to, isDir)}`, Overwrite: overwrite ? 'T' : 'F', ...(method === 'COPY' ? { Depth: 'infinity' } : {}) },
    });
    if (res.statusCode === 201 || res.statusCode === 204) {
      res.resume();
      return;
    }
    throw this.statusError(res, `remote.${method.toLowerCase()}`, from, 'move');
  }

  rename(from: string, to: string, opts: { overwrite?: boolean } = {}): Promise<void> {
    return this.moveOrCopy('MOVE', from, to, !!opts.overwrite);
  }

  copy(from: string, to: string): Promise<void> {
    return this.moveOrCopy('COPY', from, to, false);
  }

  async removeFile(p: string): Promise<void> {
    const res = await this.request('DELETE', p);
    if (res.statusCode === 204 || res.statusCode === 200) {
      res.resume();
      return;
    }
    throw this.statusError(res, 'remote.delete', p);
  }

  async removeDir(p: string): Promise<void> {
    // Callers empty the folder item by item first; a DELETE of a folder that still has
    // content would remove it all at once, so refuse that here.
    const l = await this.list(p);
    if (l.entries.length || l.refused.length) throw remoteError('directory_not_empty', 'remote.delete', l.refused.length ? 'The folder contains items with names Orbis Files does not accept, so it was not deleted.' : 'The folder is not empty.', { target: p });
    const res = await this.request('DELETE', p, { collection: true });
    if (res.statusCode === 204 || res.statusCode === 200) {
      res.resume();
      return;
    }
    throw this.statusError(res, 'remote.delete', p);
  }
}

function isIp(h: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');
}
