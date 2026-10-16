import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { isZipError, readDirectory, readEntry, type ZipLimits } from '../../shared/portable/zip.ts'

/**
 * Getting a chess engine onto this machine, honestly.
 *
 * ## Why nothing is bundled
 *
 * Stockfish is the engine Chess World analyses with, and Stockfish is GPL-3.0. Orbis does not ship GPL code, so
 * nothing here is vendored, copied into the repository or packaged into the installer. The engine is fetched from
 * upstream's own release, on request, into the person's app-data folder -- the same shape as the image engine and
 * the music engines, which are installed rather than bundled for the same kind of reason.
 *
 * The licence text travels with the binary. Upstream's archive already contains it at `stockfish/Copying.txt`, so
 * the installed folder keeps that file beside the executable rather than a copy written from somewhere else, and the
 * install record names the archive it came from so the matching source is one address away.
 *
 * ## Why a download is verified before it is run
 *
 * An unverified binary that gets executed is the whole problem. GitHub's release API gives every asset a `digest`
 * field of the form `sha256:<hex>`; the download is hashed as it arrives and compared against it. A release that
 * carries no digest -- older Stockfish releases do not have one -- cannot be verified, and `install` refuses rather
 * than running it, unless the caller explicitly says to accept an unverified download. `verified: false` is then
 * recorded and stays visible in the engine's status, so "it works" never quietly means "we ran whatever arrived".
 *
 * ## What is known about upstream, rather than guessed
 *
 * Checked against the real releases on 2026-10-16:
 *
 *   - Windows assets are ZIP; every other platform's are tar, which this installer does not read.
 *   - The current scheme (sf_19 and the dev builds) publishes exactly two Windows assets, both `-universal`:
 *     `stockfish-windows-x86-64-universal.zip` and `stockfish-windows-arm64-universal.zip`. They pick the right code
 *     for the processor themselves.
 *   - Up to sf_18 the names were per-instruction-set instead (`-avx2`, `-bmi2`, `-sse41-popcnt`, `-avx512` and a bare
 *     `stockfish-windows-x86-64.zip`). Those are still real for those tags, which is why the choice below is a
 *     preference list over what a release actually offers rather than a filename built from a guess.
 *   - Nothing here chooses an instruction-set build on a hunch. Node cannot see whether this processor has AVX2, so
 *     the order is: the universal build, then the baseline build that runs anywhere. Never `-avx2` without evidence.
 *   - The archive holds a single top-level `stockfish/` folder with the executable, `Copying.txt`, the source tree
 *     and a copy of the wiki. Only the executable and the licence are extracted; the rest would be ~100 MB of files
 *     nothing reads.
 */

export const RELEASES_API = 'https://api.github.com/repos/official-stockfish/Stockfish/releases'
export const PROJECT_URL = 'https://github.com/official-stockfish/Stockfish'
/** The release this was written and tested against. `install` resolves the latest by default and falls back to this. */
export const KNOWN_TAG = 'sf_19'
export const LICENCE_ID = 'GPL-3.0-or-later'
const USER_AGENT = 'Orbis-Chess'

/** The licence file as upstream names it, at the root of the archive's single folder. */
export const LICENCE_NAME = 'Copying.txt'

/** Where an installed engine lives when the caller does not say. */
export function defaultHome(): string {
  const base = process.env.APPDATA ?? join(homedir(), '.config')
  return join(base, 'Orbis', 'chess', 'engine')
}

// ---------------------------------------------------------------- choosing an asset

export interface ReleaseAsset {
  name: string
  url: string
  /** Bytes, as the release says. Used to refuse a download that is not the file it claims to be. */
  size: number
  /** Lower-case hex, with the `sha256:` prefix stripped. Null when the release carries no digest for this asset. */
  sha256: string | null
}

export interface ReleaseInfo {
  tag: string
  prerelease: boolean
  assets: ReleaseAsset[]
}

/**
 * The asset names this installer will take, best first, for a platform and processor.
 *
 * Only Windows ZIPs: every other platform's asset is a tar, and reading tars is a second archive format for a
 * platform Orbis does not ship on. On those the engine is not installed automatically and the status says so --
 * a binary the person installed themselves can still be pointed at.
 */
export function assetPreference(platform: string, arch: string): string[] {
  if (platform !== 'win32') return []
  if (arch === 'arm64') return ['stockfish-windows-arm64-universal.zip', 'stockfish-windows-armv8.zip']
  if (arch === 'x64') return ['stockfish-windows-x86-64-universal.zip', 'stockfish-windows-x86-64.zip']
  return []
}

export interface AssetChoice {
  asset: ReleaseAsset | null
  /** Said plainly: which one, or why none of them. */
  reason: string
}

export function chooseAsset(
  release: ReleaseInfo,
  o: { platform?: string; arch?: string; prefer?: string } = {}
): AssetChoice {
  const platform = o.platform ?? process.platform
  const arch = o.arch ?? process.arch
  const byName = new Map(release.assets.map((a) => [a.name, a]))
  // A name the caller asked for by hand, honoured only if the release really has it.
  if (o.prefer) {
    const wanted = byName.get(o.prefer)
    if (wanted) return { asset: wanted, reason: `${wanted.name}, which you asked for.` }
    return { asset: null, reason: `Release ${release.tag} has no asset called "${o.prefer}".` }
  }
  const order = assetPreference(platform, arch)
  if (!order.length) {
    return {
      asset: null,
      reason: `Orbis can only install the engine from a Windows archive, and this is ${platform}/${arch}. Point Orbis at an engine you installed yourself instead.`
    }
  }
  for (const name of order) {
    const found = byName.get(name)
    if (found) return { asset: found, reason: `${found.name} from release ${release.tag}.` }
  }
  return {
    asset: null,
    reason: `Release ${release.tag} offers none of the builds Orbis knows how to install (${order.join(', ')}); it has ${release.assets.map((a) => a.name).join(', ') || 'no assets at all'}.`
  }
}

// ---------------------------------------------------------------- reading the release

const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** A release as the API gives it, read defensively: a field that is not there is not invented. */
export function readRelease(raw: unknown): ReleaseInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const tag = asString(r.tag_name)
  if (!tag) return null
  const assets: ReleaseAsset[] = []
  for (const entry of Array.isArray(r.assets) ? r.assets : []) {
    if (!entry || typeof entry !== 'object') continue
    const a = entry as Record<string, unknown>
    const name = asString(a.name)
    const url = asString(a.browser_download_url)
    if (!name || !url) continue
    // Only an https address from the project's own host is followed. A release body is editable text; the download
    // address is not taken on trust because it arrived in JSON.
    if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com)\//.test(url)) continue
    const digest = asString(a.digest)
    const sha = digest && /^sha256:[0-9a-f]{64}$/i.test(digest) ? digest.slice(7).toLowerCase() : null
    assets.push({ name, url, size: typeof a.size === 'number' && a.size > 0 ? a.size : 0, sha256: sha })
  }
  return { tag, prerelease: r.prerelease === true, assets }
}

export class InstallError extends Error {
  readonly code:
    | 'offline'
    | 'no-release'
    | 'no-asset'
    | 'unverified'
    | 'download-failed'
    | 'archive-failed'
    | 'cancelled'
    | 'disk'
  constructor(code: InstallError['code'], message: string) {
    super(message)
    this.name = 'InstallError'
    this.code = code
  }
}

/**
 * The release to install from: the newest stable one, or a tag the caller named.
 *
 * Pre-releases are skipped. Upstream publishes a development build most days, and a daily engine is not what an
 * analysis board wants under it.
 */
export async function resolveRelease(
  o: { fetchFn?: typeof fetch; tag?: string; signal?: AbortSignal } = {}
): Promise<ReleaseInfo> {
  const fetchFn = o.fetchFn ?? fetch
  const url = o.tag ? `${RELEASES_API}/tags/${encodeURIComponent(o.tag)}` : `${RELEASES_API}?per_page=10`
  let body: unknown
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' },
      signal: o.signal
    })
    if (!res.ok) throw new InstallError('no-release', `The engine's release list answered with status ${res.status}.`)
    body = await res.json()
  } catch (e) {
    if (e instanceof InstallError) throw e
    if (o.signal?.aborted) throw new InstallError('cancelled', 'Cancelled.')
    throw new InstallError('offline', `Could not reach the engine's releases: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (Array.isArray(body)) {
    for (const entry of body) {
      const release = readRelease(entry)
      if (release && !release.prerelease && release.assets.length) return release
    }
    throw new InstallError('no-release', 'The engine publishes no finished release that Orbis can read.')
  }
  const one = readRelease(body)
  if (!one) throw new InstallError('no-release', 'The engine release could not be read.')
  return one
}

// ---------------------------------------------------------------- downloading

export interface DownloadProgress {
  received: number
  /** Null while the server has not said how big the file is. */
  total: number | null
}

/**
 * An asset, onto disk, hashed as it arrives.
 *
 * The hash is computed over the bytes that really arrive rather than read back afterwards, and the file is only moved
 * into place once both the hash and the length are what the release said. A failed download leaves nothing behind
 * that could be mistaken for a finished one.
 */
export async function downloadAsset(
  asset: ReleaseAsset,
  dest: string,
  o: { fetchFn?: typeof fetch; signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void; allowUnverified?: boolean } = {}
): Promise<{ path: string; bytes: number; sha256: string; verified: boolean }> {
  if (!asset.sha256 && o.allowUnverified !== true) {
    throw new InstallError(
      'unverified',
      `Release asset "${asset.name}" publishes no checksum, so Orbis cannot tell whether the download is the file upstream built. It was not run.`
    )
  }
  const fetchFn = o.fetchFn ?? fetch
  await mkdir(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  await rm(part, { force: true })

  let res: Response
  try {
    res = await fetchFn(asset.url, { headers: { 'user-agent': USER_AGENT, accept: 'application/octet-stream' }, redirect: 'follow', signal: o.signal })
  } catch (e) {
    if (o.signal?.aborted) throw new InstallError('cancelled', 'Cancelled.')
    throw new InstallError('download-failed', `The engine download could not start: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) throw new InstallError('download-failed', `The engine download answered with status ${res.status}.`)
  const type = String(res.headers.get('content-type') ?? '').toLowerCase()
  if (type.startsWith('text/html')) {
    throw new InstallError('download-failed', 'The download address returned a web page instead of the engine archive.')
  }
  const declared = Number(res.headers.get('content-length'))
  const total = Number.isFinite(declared) && declared > 0 ? declared : asset.size > 0 ? asset.size : null
  if (asset.size > 0 && Number.isFinite(declared) && declared > 0 && declared !== asset.size) {
    throw new InstallError('download-failed', `The server offers ${declared} bytes where the release says ${asset.size}.`)
  }

  const hash = createHash('sha256')
  let received = 0
  const handle = await open(part, 'w')
  try {
    const body = res.body as unknown as AsyncIterable<Uint8Array> | null
    if (!body) throw new InstallError('download-failed', 'The engine download arrived with no content.')
    for await (const chunk of body) {
      if (o.signal?.aborted) throw new InstallError('cancelled', 'Cancelled.')
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike)
      hash.update(bytes)
      received += bytes.length
      await handle.write(bytes)
      o.onProgress?.({ received, total })
    }
  } catch (e) {
    await handle.close()
    await rm(part, { force: true })
    if (e instanceof InstallError) throw e
    if (o.signal?.aborted) throw new InstallError('cancelled', 'Cancelled.')
    throw new InstallError('download-failed', `The engine download stopped: ${e instanceof Error ? e.message : String(e)}`)
  }
  await handle.close()

  const digest = hash.digest('hex')
  if (asset.size > 0 && received !== asset.size) {
    await rm(part, { force: true })
    throw new InstallError('download-failed', `The download is ${received} bytes where the release says ${asset.size}; it was discarded.`)
  }
  if (asset.sha256 && digest !== asset.sha256) {
    await rm(part, { force: true })
    throw new InstallError('unverified', 'The downloaded engine does not match the checksum upstream published, so it was discarded and never run.')
  }
  await rename(part, dest)
  return { path: dest, bytes: received, sha256: digest, verified: asset.sha256 !== null }
}

// ---------------------------------------------------------------- unpacking

/** Raised from the default so the ~100 MB executable fits; still a limit, not an absence of one. */
export const ARCHIVE_LIMITS: Readonly<ZipLimits> = Object.freeze({
  entryBytes: 512 * 1024 * 1024,
  totalBytes: 2 * 1024 * 1024 * 1024,
  entries: 50_000,
  ratio: 2000,
  ratioFloor: 4096,
  pathLength: 512
})

export interface Unpacked {
  binary: string
  licence: string | null
}

/**
 * Takes the executable and the licence out of the archive, and nothing else.
 *
 * The archive is read through `shared/portable/zip.ts`, which checks every path while it reads the table of contents
 * and verifies each entry's checksum after inflating it, so a hostile entry is refused before any bytes are written.
 * Two entries are wanted out of about a hundred; the source tree and the wiki copy are left in the archive.
 */
export async function unpackEngine(archive: string, dir: string, o: { platform?: string } = {}): Promise<Unpacked> {
  const platform = o.platform ?? process.platform
  const suffix = platform === 'win32' ? '.exe' : ''
  const file = await readFile(archive)
  const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength)
  const listing = readDirectory(bytes, ARCHIVE_LIMITS)
  if (isZipError(listing)) throw new InstallError('archive-failed', `The engine archive could not be read: ${listing.message}`)

  const executables = listing.filter((e) => {
    const name = basename(e.path)
    return suffix ? name.toLowerCase().endsWith(suffix) : /^stockfish[^./]*$/i.test(name) && e.size > 1024 * 1024
  })
  if (!executables.length) throw new InstallError('archive-failed', 'The engine archive contains no program to run.')
  // Upstream ships exactly one; if that ever changes, the largest is the engine and the rest are tools.
  const chosen = executables.sort((a, b) => b.size - a.size)[0]
  const licenceEntry = listing.find((e) => basename(e.path).toLowerCase() === LICENCE_NAME.toLowerCase()) ?? null

  await mkdir(dir, { recursive: true })
  const write = async (entry: (typeof listing)[number], to: string): Promise<void> => {
    const data = readEntry(bytes, entry, (d) => new Uint8Array(inflateRawSync(d)), ARCHIVE_LIMITS)
    if (isZipError(data)) throw new InstallError('archive-failed', `The engine archive could not be unpacked: ${data.message}`)
    await writeFile(to, data)
  }
  const binary = join(dir, basename(chosen.path))
  await write(chosen, binary)
  if (platform !== 'win32') await chmod(binary, 0o755).catch(() => undefined)
  let licence: string | null = null
  if (licenceEntry) {
    licence = join(dir, LICENCE_NAME)
    await write(licenceEntry, licence)
  }
  return { binary, licence }
}

// ---------------------------------------------------------------- the record on disk

export const MARKER = 'installed.json'

export interface InstallRecord {
  /** The release tag, which is the only place upstream puts a version. Not the engine's own claim about itself. */
  version: string
  asset: string
  archiveUrl: string
  sha256: string
  /** False only when the caller chose to accept a release that publishes no checksum. */
  verified: boolean
  bytes: number
  /** File name, not a path: the folder moves with the profile. */
  binary: string
  licence: string | null
  licenceId: string
  sourceUrl: string
  installedAt: number
}

const isRecord = (v: unknown): v is InstallRecord => {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r.version === 'string' && typeof r.binary === 'string' && r.binary.length > 0
}

export interface Installed {
  record: InstallRecord | null
  /**
   * Set when something is there and cannot be used, or is there and cannot be read.
   *
   * An unreadable marker is not an absent one: reporting "not installed" over a file that failed to parse would send
   * the person to download 80 MB again when the real problem is a half-written file.
   */
  problem: string | null
}

export async function readInstalled(dir: string): Promise<Installed> {
  const marker = join(dir, MARKER)
  if (!existsSync(marker)) return { record: null, problem: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(marker, 'utf8'))
  } catch (e) {
    return { record: null, problem: `The engine's install record could not be read (${e instanceof Error ? e.message : 'unknown reason'}). Installing again will replace it.` }
  }
  if (!isRecord(parsed)) return { record: null, problem: 'The engine’s install record is not in a shape Orbis understands. Installing again will replace it.' }
  const binary = join(dir, parsed.binary)
  if (!existsSync(binary)) {
    return { record: null, problem: `The engine's install record names "${parsed.binary}", which is not in ${dir} any more.` }
  }
  return { record: parsed, problem: null }
}

export async function writeInstalled(dir: string, record: InstallRecord): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, MARKER), `${JSON.stringify(record, null, 2)}\n`)
}

// ---------------------------------------------------------------- a path somebody chose

export interface PathCheckResult {
  ok: boolean
  path: string
  why: string
}

/**
 * Whether a binary path may be used.
 *
 * This only ever runs over a path from the options object or the environment -- something the person set. A path is
 * never taken from a PGN file, a broadcast provider or anything else that arrived as data: those are strings somebody
 * else wrote, and the thing at the end of this path gets executed.
 *
 * A carriage return or newline is refused outright. Not because of the filesystem, but because the engine is driven
 * by a line protocol and a path that can carry a newline is a path that can carry a second command.
 */
export function checkBinaryPath(raw: unknown, o: { platform?: string } = {}): PathCheckResult {
  const platform = o.platform ?? process.platform
  const no = (why: string): PathCheckResult => ({ ok: false, path: '', why })
  if (typeof raw !== 'string' || raw.trim() === '') return no('no engine path was given')
  const path = raw.trim()
  if (path.length > 4096) return no('the engine path is longer than a path can be')
  if (/[\u0000\r\n]/.test(path)) return no('the engine path contains a line break or a null byte')
  if (!isAbsolute(path)) return no(`"${path}" is not a full path, and Orbis will not search for an engine by name`)
  if (platform === 'win32' && !path.toLowerCase().endsWith('.exe')) return no(`"${basename(path)}" is not a program Windows can run`)
  let file
  try {
    file = statSync(path)
  } catch {
    return no(`there is no file at "${path}"`)
  }
  if (!file.isFile()) return no(`"${path}" is not a file`)
  return { ok: true, path, why: '' }
}
