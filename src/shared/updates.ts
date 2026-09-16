/**
 * What Orbis knows about updating itself: versions, channels, what a release manifest must look like to be believed,
 * and the states an update moves through.
 *
 * Nothing here downloads, installs or touches a disk. It is the part that decides, so that the deciding can be held to
 * account on its own: which version is newer, whether a release is meant for this computer, whether a manifest is
 * trustworthy enough to act on, and what may follow what.
 *
 * The one rule underneath all of it: this is about the application. A user's profiles, settings and everything else
 * they have made live somewhere else entirely, and nothing in an update reaches them.
 *
 * Pure — no browser, no storage, no network.
 */

// ---------------------------------------------------------------- versions

export interface Version {
  major: number
  minor: number
  patch: number
  /** 'beta.2' in 1.2.0-beta.2; empty for an ordinary release. */
  prerelease: string
}

const VERSION_PATTERN = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,64}))?$/

export function parseVersion(text: string): Version | null {
  const match = VERSION_PATTERN.exec(String(text ?? '').trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? '' }
}

export const formatVersion = (v: Version): string => `${v.major}.${v.minor}.${v.patch}${v.prerelease ? `-${v.prerelease}` : ''}`

/** Compares two prerelease tags the way semantic versioning says: numbers count as numbers, and more parts win ties. */
function comparePrerelease(a: string, b: string): number {
  // A release is always newer than a prerelease of the same numbers: 1.2.0 beats 1.2.0-beta.
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  const left = a.split('.')
  const right = b.split('.')
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i]
    const y = right[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    if (xNum && yNum) {
      const diff = Number(x) - Number(y)
      if (diff) return diff < 0 ? -1 : 1
    } else if (xNum !== yNum) {
      // Numbers rank below words.
      return xNum ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** -1 when a is older, 0 when they are the same release, 1 when a is newer. */
export function compareVersions(a: Version, b: Version): number {
  for (const part of ['major', 'minor', 'patch'] as const) {
    const diff = a[part] - b[part]
    if (diff) return diff < 0 ? -1 : 1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

/** Compares version strings, treating anything unreadable as older than everything. */
export function compareVersionStrings(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1
  return compareVersions(left, right)
}

export const isNewer = (candidate: string, current: string): boolean => compareVersionStrings(candidate, current) > 0

// ---------------------------------------------------------------- channels and platforms

export const CHANNELS = ['stable', 'beta', 'dev', 'canary'] as const
export type Channel = (typeof CHANNELS)[number]
export const DEFAULT_CHANNEL: Channel = 'stable'
export const isChannel = (value: unknown): value is Channel => typeof value === 'string' && (CHANNELS as readonly string[]).includes(value)

/** The platforms Orbis can be built for, named as Node names them. Kept here so shared code needs no Node types. */
export type OrbisPlatform = 'win32' | 'darwin' | 'linux'

/** How a platform and processor are named in a manifest, e.g. 'windows-x64'. */
export function platformKey(platform: OrbisPlatform, arch: string): string {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform === 'linux' ? 'linux' : platform
  return `${os}-${arch}`
}

// ---------------------------------------------------------------- what a release says about itself

export interface ReleasePackage {
  url: string
  sha256: string
  size: number
}

export interface ReleaseManifest {
  channel: Channel
  latestVersion: string
  /** Below this, Orbis is no longer supported and the user is told so. */
  minimumSupportedVersion: string
  mandatory: boolean
  releaseDate: string
  releaseNotes: string
  /** What is expected to be installed, so the updater knows what it is putting in place. */
  components: Record<string, string>
  platforms: Record<string, ReleasePackage>
}

/**
 * Where a package may be fetched from. https anywhere, and plain http only from this computer: a loopback address has
 * no network in the middle to be interfered with, and is how a development build is tested against a local server.
 */
export function isSafePackageUrl(url: string): boolean {
  if (/^https:\/\/[^\s]+$/i.test(url)) return true
  const loopback = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d{1,5})?(\/[^\s]*)?$/i
  return loopback.test(url)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Reads a manifest, and refuses anything it cannot fully believe. A manifest arrives from a server, so it is treated
 * as a claim rather than as fact: every field is checked, downloads must be https, and anything unexpected is a reason
 * to stop rather than to guess.
 */
export function readManifest(raw: unknown): { ok: true; manifest: ReleaseManifest } | { ok: false; problem: string } {
  if (!isPlainObject(raw)) return { ok: false, problem: 'the manifest is not an object' }
  if (!isChannel(raw.channel)) return { ok: false, problem: 'the manifest does not say which channel it is for' }
  if (!parseVersion(String(raw.latestVersion))) return { ok: false, problem: 'the manifest has no readable version' }
  if (!parseVersion(String(raw.minimumSupportedVersion))) return { ok: false, problem: 'the manifest has no readable minimum supported version' }
  if (!isPlainObject(raw.platforms) || Object.keys(raw.platforms).length === 0) return { ok: false, problem: 'the manifest lists no packages' }

  const platforms: Record<string, ReleasePackage> = {}
  for (const [key, value] of Object.entries(raw.platforms)) {
    if (!/^[a-z0-9-]{1,40}$/.test(key) || !isPlainObject(value)) return { ok: false, problem: `the entry for ${key} does not make sense` }
    const url = String(value.url ?? '')
    // Only https, so a package cannot be tampered with in transit. The single exception is a server on this same
    // computer, which nothing can sit in the middle of — that is what development builds talk to.
    if (!isSafePackageUrl(url)) return { ok: false, problem: `the package for ${key} is not an https address` }
    const sha256 = String(value.sha256 ?? '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, problem: `the package for ${key} has no usable checksum` }
    const size = Number(value.size)
    if (!Number.isFinite(size) || size <= 0 || size > 8_000_000_000) return { ok: false, problem: `the package for ${key} has an impossible size` }
    platforms[key] = { url, sha256, size }
  }

  const components: Record<string, string> = {}
  if (raw.components !== undefined) {
    if (!isPlainObject(raw.components)) return { ok: false, problem: 'the component list does not make sense' }
    for (const [name, version] of Object.entries(raw.components)) {
      if (!/^[a-z0-9-]{1,40}$/.test(name) || typeof version !== 'string' || !parseVersion(version)) {
        return { ok: false, problem: `the version given for ${name} does not make sense` }
      }
      components[name] = version
    }
  }

  return {
    ok: true,
    manifest: {
      channel: raw.channel,
      latestVersion: String(raw.latestVersion),
      minimumSupportedVersion: String(raw.minimumSupportedVersion),
      mandatory: raw.mandatory === true,
      releaseDate: typeof raw.releaseDate === 'string' ? raw.releaseDate.slice(0, 40) : '',
      releaseNotes: typeof raw.releaseNotes === 'string' ? raw.releaseNotes.slice(0, 20_000) : '',
      components,
      platforms
    }
  }
}

// ---------------------------------------------------------------- what to do about it

export type UpdateDecision =
  | { action: 'none'; reason: string }
  | { action: 'update'; version: string; package: ReleasePackage; mandatory: boolean }
  /** This Orbis is older than the release the server still supports. */
  | { action: 'unsupported'; version: string; package: ReleasePackage }
  | { action: 'refuse'; reason: string }

export interface DecideOptions {
  currentVersion: string
  manifest: ReleaseManifest
  channel: Channel
  platform: OrbisPlatform
  arch: string
}

/**
 * Whether to update, and why not when not. A manifest for another channel, a package for another kind of computer, or
 * a version older than the one already installed are all refused: an update only ever goes forwards, and only ever
 * with a package meant for this machine.
 */
export function decideUpdate(o: DecideOptions): UpdateDecision {
  if (o.manifest.channel !== o.channel) return { action: 'refuse', reason: `this manifest is for the ${o.manifest.channel} channel, not ${o.channel}` }

  const key = platformKey(o.platform, o.arch)
  const pkg = o.manifest.platforms[key]
  if (!pkg) return { action: 'none', reason: `there is no ${key} package in this release` }

  const current = parseVersion(o.currentVersion)
  if (!current) return { action: 'refuse', reason: 'the installed version cannot be read' }

  const comparison = compareVersionStrings(o.manifest.latestVersion, o.currentVersion)
  if (comparison === 0) return { action: 'none', reason: 'Orbis is up to date' }
  // Going backwards is how an attacker reintroduces a fixed problem, so it is never done on the server's say-so.
  if (comparison < 0) return { action: 'refuse', reason: 'the release offered is older than the version installed' }

  // Below the minimum the release still supports, this Orbis has to move on rather than being merely invited to.
  if (compareVersionStrings(o.currentVersion, o.manifest.minimumSupportedVersion) < 0) {
    return { action: 'unsupported', version: o.manifest.latestVersion, package: pkg }
  }
  return { action: 'update', version: o.manifest.latestVersion, package: pkg, mandatory: o.manifest.mandatory }
}

// ---------------------------------------------------------------- the states an update moves through

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'no-update'
  | 'update-available'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'ready-to-install'
  | 'preparing'
  | 'installing'
  | 'validating'
  | 'restarting'
  | 'completed'
  | 'rolling-back'
  | 'failed'
  | 'cancelled'

/**
 * What may follow what. Everything about an update is one of these, rather than a handful of separate flags that can
 * disagree with each other: an update cannot be downloading and idle at once, and cannot be installed without having
 * been verified first.
 */
const ALLOWED: Record<UpdateState, readonly UpdateState[]> = {
  idle: ['checking'],
  checking: ['no-update', 'update-available', 'failed', 'cancelled'],
  'no-update': ['checking'],
  'update-available': ['downloading', 'cancelled', 'checking'],
  downloading: ['verifying', 'paused', 'failed', 'cancelled'],
  paused: ['downloading', 'cancelled', 'failed'],
  // Verifying can send it back to downloading: a package that fails its checks is thrown away and fetched again.
  verifying: ['ready-to-install', 'downloading', 'failed', 'cancelled'],
  'ready-to-install': ['preparing', 'cancelled', 'checking'],
  preparing: ['installing', 'failed', 'cancelled'],
  installing: ['validating', 'rolling-back', 'failed'],
  validating: ['restarting', 'rolling-back', 'failed'],
  restarting: ['completed', 'rolling-back', 'failed'],
  completed: ['idle', 'checking'],
  'rolling-back': ['idle', 'failed'],
  failed: ['idle', 'checking'],
  cancelled: ['idle', 'checking']
}

export const canMoveTo = (from: UpdateState, to: UpdateState): boolean => ALLOWED[from].includes(to)

/** Once past this point an update is being put in place, and stopping means rolling back rather than cancelling. */
export const isInstalling = (state: UpdateState): boolean => state === 'preparing' || state === 'installing' || state === 'validating' || state === 'restarting'

/** Whether there is a package on disk worth keeping between runs of Orbis. */
export const holdsPackage = (state: UpdateState): boolean => state === 'ready-to-install' || state === 'verifying' || state === 'paused'

// ---------------------------------------------------------------- what the user is told

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  availableVersion: string | null
  mandatory: boolean
  /** 0 to 1 while downloading. */
  progress: number
  releaseNotes: string
  /** Why it stopped, in plain words, when it did. */
  problem: string | null
  lastCheckedAt: number
}

export const idleStatus = (currentVersion: string): UpdateStatus => ({
  state: 'idle',
  currentVersion,
  availableVersion: null,
  mandatory: false,
  progress: 0,
  releaseNotes: '',
  problem: null,
  lastCheckedAt: 0
})

/** How an update is described in the interface, in words rather than in states. */
export function describeUpdate(status: UpdateStatus): string {
  switch (status.state) {
    case 'checking':
      return 'Looking for updates…'
    case 'no-update':
      return `Orbis ${status.currentVersion} is up to date`
    case 'update-available':
      return `Orbis ${status.availableVersion} is available`
    case 'downloading':
      return `Downloading Orbis ${status.availableVersion}… ${Math.round(status.progress * 100)}%`
    case 'paused':
      return `Download paused at ${Math.round(status.progress * 100)}%`
    case 'verifying':
      return 'Checking the download…'
    case 'ready-to-install':
      return `Orbis ${status.availableVersion} is ready`
    case 'preparing':
    case 'installing':
      return `Installing Orbis ${status.availableVersion}…`
    case 'validating':
      return 'Making sure it works…'
    case 'restarting':
      return 'Restarting…'
    case 'completed':
      return `Orbis was updated to ${status.currentVersion}`
    case 'rolling-back':
      return 'Putting the previous version back…'
    case 'failed':
      return status.problem ?? 'The update could not be completed'
    case 'cancelled':
      return 'The update was stopped'
    default:
      return `Orbis ${status.currentVersion}`
  }
}
