import http from 'node:http'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import { dirname, join, basename } from 'node:path'

export type DownloadCode =
  | 'BAD_PROTOCOL' | 'TOO_MANY_REDIRECTS' | 'HTTP_ERROR' | 'DISK_FULL' | 'HASH_MISMATCH' | 'SIZE_MISMATCH'
  | 'HTML_RESPONSE' | 'CANCELLED' | 'NETWORK' | 'BAD_URL'

export class DownloadError extends Error {
  code: DownloadCode
  constructor(code: DownloadCode, message: string) { super(message); this.code = code; this.name = 'DownloadError' }
}

export interface DownloadOptions {
  sha256?: string
  size?: number
  /** Content-type prefixes accepted, e.g. ['audio/', 'application/octet-stream']. Unset: only text/html is refused. */
  expectContentType?: string[]
  signal?: AbortSignal
  onProgress?: (p: { received: number; total: number | null }) => void
  maxRedirects?: number
  /** Extra bytes required free beyond the file itself. */
  diskMargin?: number
}

export interface DownloadResult { path: string; bytes: number; sha256: string; resumed: boolean }

interface Opened { res: http.IncomingMessage; req: http.ClientRequest }

function open(url: string, headers: Record<string, string>, signal: AbortSignal | undefined, redirects: number): Promise<Opened> {
  return new Promise((resolve, reject) => {
    let u: URL
    try { u = new URL(url) } catch { return reject(new DownloadError('BAD_URL', 'That is not a valid address.')) }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new DownloadError('BAD_PROTOCOL', 'Only http and https downloads are allowed.'))
    if (signal?.aborted) return reject(new DownloadError('CANCELLED', 'Download cancelled.'))
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.get(u, { headers }, (res) => {
      const st = res.statusCode ?? 0
      if (st >= 300 && st < 400 && res.headers.location) {
        res.resume()
        if (redirects <= 0) return reject(new DownloadError('TOO_MANY_REDIRECTS', 'The server redirected too many times.'))
        const to = new URL(res.headers.location, u).toString()
        open(to, headers, signal, redirects - 1).then(resolve, reject)
        return
      }
      resolve({ res, req })
    })
    req.on('error', (e) => reject(signal?.aborted ? new DownloadError('CANCELLED', 'Download cancelled.') : new DownloadError('NETWORK', 'Network error: ' + e.message)))
    signal?.addEventListener('abort', () => req.destroy(), { once: true })
  })
}

async function statSize(p: string): Promise<number> {
  try { return (await fs.stat(p)).size } catch { return 0 }
}

export async function hashFile(p: string): Promise<string> {
  const h = createHash('sha256')
  const fh = await fs.open(p, 'r')
  try {
    for await (const chunk of fh.createReadStream()) h.update(chunk as Buffer)
  } finally { await fh.close() }
  return h.digest('hex')
}

async function checkDisk(dir: string, needed: number): Promise<void> {
  try {
    const s = await fs.statfs(dir)
    const free = Number(s.bavail) * Number(s.bsize)
    if (free < needed) throw new DownloadError('DISK_FULL', 'Not enough free disk space: need ' + needed + ' bytes, have ' + free + '.')
  } catch (e) {
    if (e instanceof DownloadError) throw e
    // statfs unsupported: do not invent a number.
  }
}

export async function download(url: string, dest: string, opts: DownloadOptions = {}): Promise<DownloadResult> {
  await fs.mkdir(dirname(dest), { recursive: true })
  const part = dest + '.part'
  let have = await statSize(part)
  if (opts.size !== undefined && have > opts.size) { await fs.rm(part, { force: true }); have = 0 }

  const headers: Record<string, string> = { 'User-Agent': 'Orbis-NEUROVA' }
  if (have > 0) headers.Range = 'bytes=' + have + '-'
  const { res, req } = await open(url, headers, opts.signal, opts.maxRedirects ?? 5)
  const st = res.statusCode ?? 0
  if (st !== 200 && st !== 206) { res.resume(); throw new DownloadError('HTTP_ERROR', 'The server answered ' + st + '.') }

  const ctype = String(res.headers['content-type'] ?? '').toLowerCase()
  if (opts.expectContentType) {
    if (!opts.expectContentType.some((t) => ctype.startsWith(t.toLowerCase()))) {
      res.resume()
      throw new DownloadError('HTML_RESPONSE', 'The server sent "' + (ctype || 'unknown') + '" instead of the expected file.')
    }
  } else if (ctype.startsWith('text/html')) {
    res.resume()
    throw new DownloadError('HTML_RESPONSE', 'The server sent a web page instead of the file.')
  }

  const resumed = st === 206 && have > 0
  if (!resumed) have = 0
  const remaining = Number(res.headers['content-length'])
  const bodyLen = Number.isFinite(remaining) ? remaining : null
  const total = bodyLen !== null ? bodyLen + have : (opts.size ?? null)
  if (opts.size !== undefined && total !== null && total !== opts.size) {
    res.resume()
    throw new DownloadError('SIZE_MISMATCH', 'The server reports ' + total + ' bytes but ' + opts.size + ' were expected.')
  }
  await checkDisk(dirname(dest), (bodyLen ?? 0) + (opts.diskMargin ?? 0))

  const hash = createHash('sha256')
  if (resumed) {
    const fh = await fs.open(part, 'r')
    try { for await (const c of fh.createReadStream()) hash.update(c as Buffer) } finally { await fh.close() }
  }
  const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
  let received = have
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (e: Error) => reject(opts.signal?.aborted ? new DownloadError('CANCELLED', 'Download cancelled.') : e instanceof DownloadError ? e : new DownloadError('NETWORK', 'Network error: ' + e.message))
      res.on('data', (c: Buffer) => {
        hash.update(c)
        received += c.length
        const ok = out.write(c)
        if (!ok) { res.pause(); out.once('drain', () => res.resume()) }
        opts.onProgress?.({ received, total })
      })
      res.on('error', fail)
      res.on('aborted', () => fail(new Error('connection closed early')))
      req.on('error', fail)
      out.on('error', (e) => reject(new DownloadError('DISK_FULL', 'Could not write the file: ' + e.message)))
      res.on('end', () => out.end(() => resolve()))
      opts.signal?.addEventListener('abort', () => { res.destroy(); out.end(() => fail(new Error('aborted'))) }, { once: true })
    })
  } catch (e) {
    // Let what was received reach the disk so the .part can resume.
    await new Promise<void>((r) => { if (out.closed) r(); else { out.once('close', () => r()); out.end() } })
    throw e // a partial .part is kept so it can be resumed
  }
  if (bodyLen !== null && received - have < bodyLen) {
    throw new DownloadError('NETWORK', 'The connection ended after ' + received + ' bytes.')
  }

  const digest = hash.digest('hex')
  if (opts.size !== undefined && received !== opts.size) {
    await fs.rm(part, { force: true })
    throw new DownloadError('SIZE_MISMATCH', 'Received ' + received + ' bytes, expected ' + opts.size + '.')
  }
  if (opts.sha256 && digest !== opts.sha256.toLowerCase()) {
    await fs.rm(part, { force: true })
    throw new DownloadError('HASH_MISMATCH', 'The downloaded file does not match its checksum; it was discarded.')
  }
  await fs.rename(part, dest)
  return { path: dest, bytes: received, sha256: digest, resumed }
}

export interface StageFile { url: string; sha256?: string; size?: number; dest: string }

/**
 * Downloads every file into a staging folder next to finalDir, then moves the folder into place. An existing
 * finalDir is untouched until everything is verified; it is then set aside and removed only after the swap works.
 */
export async function stageInstall(files: StageFile[], finalDir: string, opts: { signal?: AbortSignal; onProgress?: (p: { file: number; of: number; received: number; total: number | null }) => void } = {}): Promise<{ dir: string; files: DownloadResult[] }> {
  const parent = dirname(finalDir)
  await fs.mkdir(parent, { recursive: true })
  const staging = join(parent, '.' + basename(finalDir) + '.staging')
  await fs.mkdir(staging, { recursive: true }) // kept between attempts so verified files and .part resume
  const results: DownloadResult[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const target = join(staging, f.dest)
    if (!target.startsWith(staging)) throw new DownloadError('BAD_URL', 'Unsafe destination: ' + f.dest)
    results.push(await download(f.url, target, {
      sha256: f.sha256, size: f.size, signal: opts.signal,
      onProgress: (p) => opts.onProgress?.({ file: i, of: files.length, ...p })
    }))
  }
  let aside: string | null = null
  try { await fs.stat(finalDir); aside = finalDir + '.old-' + Date.now() } catch { /* none yet */ }
  if (aside) await fs.rename(finalDir, aside)
  try {
    await fs.rename(staging, finalDir)
  } catch (e) {
    if (aside) await fs.rename(aside, finalDir).catch(() => undefined)
    throw e
  }
  if (aside) await fs.rm(aside, { recursive: true, force: true })
  return { dir: finalDir, files: results.map((r) => ({ ...r, path: join(finalDir, relative(staging, r.path)) })) }
}

function relative(from: string, to: string): string {
  return to.slice(from.length + 1)
}
