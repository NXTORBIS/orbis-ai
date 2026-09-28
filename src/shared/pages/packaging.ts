/**
 * Packing a Page up, and taking one apart again.
 *
 * A package is how a Page travels: out of Orbis as a file somebody can keep or send, and back in from a file that could
 * have come from anywhere. Those two directions have almost nothing in common, and treating them symmetrically is the
 * mistake this file exists to avoid.
 *
 * ## Exporting: the danger is what goes in
 *
 * A Page's saved work is whatever the Page put there, and a Page that helpfully cached an API key has put an API key in
 * the thing about to be emailed to somebody. So `packForExport` scans what it is about to write and refuses anything
 * that looks like a credential, rather than trusting that no Page ever did that. It is a scan, it can be evaded, and
 * `PACKAGE_ASSUMPTIONS` says so -- but the failure it prevents is the common one: not somebody hiding a key, somebody
 * forgetting one is there.
 *
 * ## Importing: the danger is what comes out
 *
 * A package is untrusted code and untrusted data. Every rule here follows from that:
 *
 * - **A checksum detects corruption, not tampering.** There is no signature, so a modified package with a matching
 *   checksum is indistinguishable from an honest one. Saying "verified" about a checksum is the lie that makes people
 *   trust a file they should not, so nothing here says it.
 * - **Declared capabilities are requests.** An import never grants anything. The manifest saying it needs the camera is
 *   a sentence in a file, not a decision.
 * - **Paths inside a package are checked before anything is written.** An entry called `../../autostart/run.bat` is what
 *   a malicious archive looks like, and the check happens on the whole list before a single byte lands on disk.
 * - **Everything is bounded before it is read.** Entry count, each entry's size, the total unpacked size and the
 *   compression ratio, because a small file that unpacks to a hundred gigabytes is a real and old attack.
 *
 * Pure. No filesystem, no clock, no compression: bytes arrive already decoded, and the caller writes what comes back.
 */

import { MANIFEST_SCHEMA_VERSION, readManifest, type PageManifest } from './manifest.ts'
import { capabilityById, CAPABILITIES, type CapabilityDefinition } from './capabilities.ts'
import { versionToText, type PageVersion } from './identity.ts'

export const PACKAGE_FORMAT = 'orbis-page-package'
/** Bumped when the layout changes in a way an older Orbis could not read. */
export const PACKAGE_FORMAT_VERSION = 1

export const PACKAGE_LIMITS = Object.freeze({
  entries: 500,
  /** One file inside a package. */
  entryBytes: 8 * 1024 * 1024,
  /** Everything unpacked, together. */
  totalBytes: 32 * 1024 * 1024,
  /**
   * How much larger the unpacked contents may be than the package.
   *
   * A file that unpacks to a thousand times its own size is a decompression bomb, not a well-compressed Page. Two
   * hundred is generous for text and nowhere near the ratios an attack needs.
   */
  expansion: 200,
  pathLength: 255,
  depth: 12
})

export interface PackageError {
  error:
    | 'too-large'
    | 'too-many'
    | 'unsafe-path'
    | 'malformed'
    | 'wrong-format'
    | 'unsupported-version'
    | 'contains-secrets'
    | 'missing-entry'
    | 'checksum-mismatch'
  message: string
  /** Which entry was the problem, where one was. */
  entry?: string
}

export const isPackageError = (value: unknown): value is PackageError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

export interface PackageEntry {
  /** Relative, forward slashes, no leading slash. Checked before anything uses it. */
  path: string
  /** The file's contents. Text, because a Page is HTML, script, style and JSON. */
  content: string
}

export interface PackageManifestBlock {
  format: typeof PACKAGE_FORMAT
  formatVersion: number
  /** The Page's own manifest, exactly as it will be read back. */
  page: unknown
  /** When it was packed. Passed in, never read from a clock here. */
  packedAt: number
  /** The Orbis that packed it, for a compatibility message that names something real. */
  packedBy: string
  /** A checksum over the entries. Detects corruption. Not a signature, and never described as one. */
  checksum: string
  entries: { path: string; bytes: number }[]
}

export interface Package {
  manifest: PackageManifestBlock
  entries: readonly PackageEntry[]
}

// ---------------------------------------------------------------- paths inside a package

/**
 * Whether a path inside a package is safe to write.
 *
 * Checked structurally, segment by segment, rather than by searching the text for `..`. A text search misses a
 * percent-encoded climb, a backslash on Windows, and an absolute path that replaces the root instead of escaping it --
 * and each of those has been a real vulnerability in a real archive tool.
 */
export function checkEntryPath(path: string): PackageError | null {
  if (typeof path !== 'string' || path === '') {
    return { error: 'unsafe-path', message: 'A package entry needs a path.' }
  }
  if (path.length > PACKAGE_LIMITS.pathLength) {
    return { error: 'unsafe-path', message: `"${path.slice(0, 60)}..." is longer than a path may be.`, entry: path }
  }
  if (path.includes('\0')) {
    return { error: 'unsafe-path', message: 'A path cannot contain a null byte.', entry: path }
  }
  // Decoded first: `%2e%2e%2f` is `../` to anything that decodes before using it.
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return { error: 'unsafe-path', message: `"${path}" is not a path that can be read.`, entry: path }
  }
  if (decoded !== path && /(^|[/\\])\.\.([/\\]|$)/.test(decoded)) {
    return { error: 'unsafe-path', message: `"${path}" hides a climb out of the Page's folder once decoded.`, entry: path }
  }
  if (decoded.includes('\\')) {
    return { error: 'unsafe-path', message: `"${path}" uses a backslash. Paths inside a package use forward slashes.`, entry: path }
  }
  if (decoded.startsWith('/')) {
    return { error: 'unsafe-path', message: `"${path}" is an absolute path, which would write outside the Page's folder.`, entry: path }
  }
  if (/^[A-Za-z]:/.test(decoded)) {
    return { error: 'unsafe-path', message: `"${path}" names a drive, which would write outside the Page's folder.`, entry: path }
  }

  const segments = decoded.split('/')
  if (segments.length > PACKAGE_LIMITS.depth) {
    return { error: 'unsafe-path', message: `"${path}" is nested deeper than ${PACKAGE_LIMITS.depth} folders.`, entry: path }
  }
  for (const segment of segments) {
    if (segment === '' ) {
      return { error: 'unsafe-path', message: `"${path}" has an empty folder name in it.`, entry: path }
    }
    if (segment === '.' || segment === '..') {
      return { error: 'unsafe-path', message: `"${path}" climbs out of the Page's folder.`, entry: path }
    }
    // A trailing dot or space is stripped by Windows, so `evil.exe.` and `evil.exe ` become `evil.exe` after the check.
    if (/[. ]$/.test(segment)) {
      return { error: 'unsafe-path', message: `"${path}" ends a name with a dot or a space, which some systems quietly remove.`, entry: path }
    }
    if (/[<>:"|?*\u0000-\u001f]/.test(segment)) {
      return { error: 'unsafe-path', message: `"${path}" contains a character that is not allowed in a file name.`, entry: path }
    }
    // Reserved device names on Windows, which are not files and behave very strangely when written to.
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(segment)) {
      return { error: 'unsafe-path', message: `"${path}" uses a name reserved by the operating system.`, entry: path }
    }
  }
  return null
}

// ---------------------------------------------------------------- secrets

export interface SecretFinding {
  entry: string
  /** What it looked like. Never the value itself: putting a suspected key in a message copies it somewhere new. */
  looksLike: string
  line: number
}

/**
 * Patterns that look like a credential.
 *
 * Deliberately broad, and deliberately not clever. This catches the case that actually happens -- somebody's Page saved
 * a key into its own state and nobody noticed -- and it will not catch a key somebody set out to hide. That limit is
 * stated in the result rather than left for the reader to assume otherwise.
 */
const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = Object.freeze([
  // The `["']?` before the separator is what lets these see JSON. Without it `"api_key": "..."` does not match, because
  // the key's own closing quote sits between the name and the colon -- and JSON is the form a Page's saved state is
  // almost always in, so a scanner that cannot read it would have caught nothing that matters.
  { name: 'an API key', pattern: /\b(?:api[_-]?key|apikey|api[_-]?secret|access[_-]?token|secret[_-]?key)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/i },
  { name: 'a bearer token', pattern: /\bbearer\s+[A-Za-z0-9_\-.]{20,}/i },
  { name: 'an authorization header', pattern: /\bauthorization\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-. ]{20,}/i },
  { name: 'a password', pattern: /\b(?:password|passwd|pwd)\b["']?\s*[:=]\s*["'][^"']{6,}["']/i },
  { name: 'a private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'a JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'an AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'a Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'a seed phrase', pattern: /\b(?:mnemonic|seed[_ -]?phrase|recovery[_ -]?phrase)\b["']?\s*[:=]\s*["'][a-z ]{20,}["']/i },
  { name: 'a connection string with a password', pattern: /\b[a-z+]{2,12}:\/\/[^\s:@/]+:[^\s@/]{4,}@/i }
])

/**
 * Anything in these entries that looks like a credential.
 *
 * Returns findings rather than a boolean, and never includes the matched text. A message saying "line 40 of state.json
 * looks like an API key" tells somebody everything they need; one quoting the key has copied it into a log.
 */
export function findSecrets(entries: readonly PackageEntry[]): SecretFinding[] {
  const findings: SecretFinding[] = []
  for (const entry of entries) {
    const lines = entry.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // Long lines are truncated for the scan: a minified bundle can be megabytes on one line, and a regex over that is
      // slow enough to matter. A credential sitting past 20,000 characters of one line is not the case this catches.
      const line = lines[i].slice(0, 20_000)
      for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({ entry: entry.path, looksLike: name, line: i + 1 })
          break
        }
      }
    }
  }
  return findings
}

// ---------------------------------------------------------------- checksum

/**
 * A checksum over a package's entries.
 *
 * FNV-1a, 64 bits, over the paths and contents in sorted order. It detects a truncated download, a corrupted file, and
 * an entry that went missing. It detects **nothing** about who made the package or whether it was changed on purpose --
 * anybody editing a package can recompute this, and it takes no key to do it.
 *
 * It is not a cryptographic hash and is not used as one. Orbis does not sign packages, so there is no key to check a
 * signature against, and computing a SHA here would only make the same non-guarantee look stronger than it is.
 */
export function checksumOf(entries: readonly PackageEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  // 64-bit FNV-1a as two 32-bit halves, because JavaScript numbers cannot hold a 64-bit integer exactly.
  let high = 0xcbf2_9ce4
  let low = 0x8422_2325
  const mix = (code: number): void => {
    low ^= code & 0xffff_ffff
    // Multiply by the FNV prime, 0x100000001b3, split across the halves.
    const lowLow = (low & 0xffff) * 0x1b3
    const lowHigh = (low >>> 16) * 0x1b3
    const carry = (lowLow >>> 16) + (lowHigh & 0xffff)
    const newLow = ((carry & 0xffff) << 16) | (lowLow & 0xffff)
    const newHigh = ((high * 0x1b3) + (lowHigh >>> 16) + (carry >>> 16) + low) >>> 0
    low = newLow >>> 0
    high = newHigh >>> 0
  }
  for (const entry of sorted) {
    for (let i = 0; i < entry.path.length; i++) mix(entry.path.charCodeAt(i))
    mix(0)
    for (let i = 0; i < entry.content.length; i++) mix(entry.content.charCodeAt(i))
    mix(0)
  }
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`
}

// ---------------------------------------------------------------- exporting

/**
 * A validated manifest written back out the way a manifest is written.
 *
 * `readManifest` normalises as it validates: a version arrives as `"1.0.0"` and comes back as `{major, minor, patch}`.
 * Writing the normalised form into a package produces a file that the same validator then refuses -- an export nothing
 * could import. So the round trip is closed here, explicitly, rather than assumed.
 */
export function manifestToRaw(manifest: PageManifest): Record<string, unknown> {
  // Idempotent: a version that is already text stays as it is. Running `versionToText` on a string would produce
  // "undefined.undefined.undefined", which is a package nothing can read and which nothing would have flagged.
  const asText = (version: unknown): string =>
    typeof version === 'string' ? version : versionToText(version as PageVersion)

  const raw = { ...(manifest as unknown as Record<string, unknown>) }
  // Every field the validator normalises has to be written back, not just the obvious one. There are three, and
  // missing any of them produces a package that exports cleanly and cannot be opened.
  raw.version = asText(manifest.version)
  raw.runtimeAtLeast = asText(manifest.runtimeAtLeast)
  raw.dependencies = manifest.dependencies.map((one) => ({ ...one, atLeast: asText(one.atLeast) }))
  return raw
}

export interface ExportInput {
  manifest: PageManifest
  entries: readonly PackageEntry[]
  packedAt: number
  packedBy: string
  /**
   * Export anyway, having been shown what was found.
   *
   * Only ever set from a person's answer to a prompt that named each finding. Never a default, and never something a
   * Page can set for itself.
   */
  acceptSecrets?: boolean
}

export interface ExportResult {
  package: Package
  /** What the scan found. Present even on a successful export, so a Page can show what was accepted. */
  secrets: readonly SecretFinding[]
  notes: readonly string[]
}

/**
 * A Page packed up for export.
 *
 * Refused outright when the scan finds something that looks like a credential, unless the caller passes
 * `acceptSecrets` -- which only ever comes from a person who was shown the findings. An export is a file that leaves
 * this machine, and the default for "this might contain your API key" has to be "no".
 */
export function packForExport(input: ExportInput): ExportResult | PackageError {
  if (input.entries.length > PACKAGE_LIMITS.entries) {
    return { error: 'too-many', message: `A package holds at most ${PACKAGE_LIMITS.entries} files.` }
  }

  let total = 0
  for (const entry of input.entries) {
    const problem = checkEntryPath(entry.path)
    if (problem) return problem
    if (typeof entry.content !== 'string') {
      return { error: 'malformed', message: `"${entry.path}" does not hold text.`, entry: entry.path }
    }
    const bytes = entry.content.length
    if (bytes > PACKAGE_LIMITS.entryBytes) {
      return { error: 'too-large', message: `"${entry.path}" is larger than one file in a package may be.`, entry: entry.path }
    }
    total += bytes
  }
  if (total > PACKAGE_LIMITS.totalBytes) {
    return { error: 'too-large', message: `That comes to ${Math.round(total / 1024 / 1024)} MB, and a package may be at most ${PACKAGE_LIMITS.totalBytes / 1024 / 1024} MB.` }
  }

  const paths = new Set<string>()
  for (const entry of input.entries) {
    // Case-insensitively, because two entries differing only in case overwrite each other on Windows and macOS.
    const key = entry.path.toLowerCase()
    if (paths.has(key)) {
      return { error: 'malformed', message: `"${entry.path}" appears twice, and on most computers the second would silently replace the first.`, entry: entry.path }
    }
    paths.add(key)
  }

  const secrets = findSecrets(input.entries)
  if (secrets.length > 0 && input.acceptSecrets !== true) {
    const where = secrets.slice(0, 5).map((one) => `${one.entry} line ${one.line} (${one.looksLike})`).join(', ')
    return {
      error: 'contains-secrets',
      message: `This looks like it contains ${secrets.length === 1 ? 'a credential' : 'credentials'}: ${where}${secrets.length > 5 ? `, and ${secrets.length - 5} more` : ''}. Nothing was exported. Remove them, or export again having chosen to include them.`
    }
  }

  const notes: string[] = [
    'A package carries the Page and whatever it had saved. It does not carry any permission: whoever opens it decides what it may do.'
  ]
  if (secrets.length > 0) {
    notes.push(`You chose to export despite ${secrets.length} ${secrets.length === 1 ? 'finding' : 'findings'} that looked like credentials. Anybody you send this to can read them.`)
  }
  notes.push('The checksum detects a damaged file. It is not a signature and cannot show who made this or whether it was changed.')

  return {
    package: {
      manifest: {
        format: PACKAGE_FORMAT,
        formatVersion: PACKAGE_FORMAT_VERSION,
        // Written back out as a manifest is written, so the package this produces is one that can be read back.
        page: manifestToRaw(input.manifest),
        packedAt: input.packedAt,
        packedBy: input.packedBy,
        checksum: checksumOf(input.entries),
        entries: input.entries.map((one) => ({ path: one.path, bytes: one.content.length }))
      },
      entries: Object.freeze([...input.entries])
    },
    secrets: Object.freeze(secrets),
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- importing

export interface ImportResult {
  manifest: PageManifest
  entries: readonly PackageEntry[]
  /** Exactly what the Page's manifest asks for. Requests, not grants, and the wording says so. */
  requested: readonly CapabilityDefinition[]
  /** Capability ids in the manifest that this Orbis has never heard of. */
  unknownCapabilities: readonly string[]
  /** True when the checksum matched. Means "not corrupted", never "not tampered with". */
  intact: boolean
  version: PageVersion
  warnings: readonly string[]
  /** Sentences to show before the person decides. Written to be read, not to be skipped. */
  beforeYouDecide: readonly string[]
}

/**
 * A package taken apart, checked, and described.
 *
 * Nothing is installed and nothing is granted. What comes back is a description for somebody to look at and a decision
 * for them to make, which is the only honest shape for "here is some code from a file".
 *
 * The checks run in this order on purpose: shape, then size, then paths, then the manifest. Each one is cheaper than
 * the next and each one refuses input the next would otherwise have to handle.
 */
export function readPackage(raw: unknown, packedBytes?: number): ImportResult | PackageError {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'malformed', message: 'That file is not an Orbis Page package.' }
  }
  const record = raw as Record<string, unknown>
  const block = record.manifest
  if (typeof block !== 'object' || block === null) {
    return { error: 'malformed', message: 'That package has no manifest block, so there is nothing to read it by.' }
  }
  const head = block as Record<string, unknown>

  if (head.format !== PACKAGE_FORMAT) {
    return { error: 'wrong-format', message: 'That file is not an Orbis Page package.' }
  }
  const formatVersion = head.formatVersion
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) {
    return { error: 'malformed', message: 'That package does not say which format version it is.' }
  }
  if (formatVersion > PACKAGE_FORMAT_VERSION) {
    return {
      error: 'unsupported-version',
      message: `That package was made by a newer Orbis (package format ${formatVersion}; this one reads up to ${PACKAGE_FORMAT_VERSION}). Update Orbis and try again.`
    }
  }

  const rawEntries = record.entries
  if (!Array.isArray(rawEntries)) {
    return { error: 'malformed', message: 'That package has no files in it.' }
  }
  if (rawEntries.length > PACKAGE_LIMITS.entries) {
    return { error: 'too-many', message: `That package holds ${rawEntries.length} files, and at most ${PACKAGE_LIMITS.entries} are allowed.` }
  }

  const entries: PackageEntry[] = []
  let total = 0
  const seen = new Set<string>()
  for (const one of rawEntries) {
    if (typeof one !== 'object' || one === null) {
      return { error: 'malformed', message: 'That package has an entry that is not a file.' }
    }
    const candidate = one as Record<string, unknown>
    const path = candidate.path
    const content = candidate.content
    if (typeof path !== 'string' || typeof content !== 'string') {
      return { error: 'malformed', message: 'That package has an entry without a path or without contents.' }
    }
    // Every path is checked before a single byte is written anywhere, which is the point of doing it here.
    const problem = checkEntryPath(path)
    if (problem) return problem
    const key = path.toLowerCase()
    if (seen.has(key)) {
      return { error: 'malformed', message: `"${path}" appears twice in that package.`, entry: path }
    }
    seen.add(key)

    if (content.length > PACKAGE_LIMITS.entryBytes) {
      return { error: 'too-large', message: `"${path}" is larger than one file in a package may be.`, entry: path }
    }
    total += content.length
    if (total > PACKAGE_LIMITS.totalBytes) {
      return { error: 'too-large', message: `That package unpacks to more than the ${PACKAGE_LIMITS.totalBytes / 1024 / 1024} MB allowed.` }
    }
    entries.push({ path, content })
  }

  // A small file that unpacks enormously is a decompression bomb, and the ratio is the only thing that shows it.
  if (packedBytes !== undefined && packedBytes > 0 && total / packedBytes > PACKAGE_LIMITS.expansion) {
    return {
      error: 'too-large',
      message: `That package is ${Math.round(packedBytes / 1024)} KB but unpacks to ${Math.round(total / 1024)} KB, which is ${Math.round(total / packedBytes)} times larger. Nothing legitimate compresses that well, so it was not opened.`
    }
  }

  // Unknown capabilities are separated out *before* the manifest is validated, and only here.
  //
  // Everywhere else in Orbis a capability that is not in the registry is a fatal error, and rightly so: a built-in Page
  // asking for one has a typo, and shipping it would be a bug. But a package is the one thing that can legitimately
  // have been written for a *newer* Orbis, and refusing the whole import over one capability this version has not heard
  // of would make every Page unopenable the moment it used anything new. So they are stripped, the reduced manifest is
  // validated strictly, and every one that was removed is named in the warnings. Stripping is safe precisely because a
  // declaration was never a grant: removing one takes nothing away that the Page had.
  const declaredRaw = typeof head.page === 'object' && head.page !== null
    ? (head.page as Record<string, unknown>).capabilities
    : undefined
  const declared = Array.isArray(declaredRaw) ? declaredRaw.filter((one): one is string => typeof one === 'string') : []
  const requested: CapabilityDefinition[] = []
  const unknown: string[] = []
  const knownIds: string[] = []
  for (const id of declared) {
    const definition = capabilityById(id)
    // `hasOwnProperty` as well, so a declared id of `constructor` cannot resolve to something off the prototype.
    if (definition && Object.prototype.hasOwnProperty.call(CAPABILITIES, id)) {
      requested.push(definition)
      knownIds.push(id)
    } else {
      unknown.push(id)
    }
  }

  const page = typeof head.page === 'object' && head.page !== null
    ? { ...(head.page as Record<string, unknown>), capabilities: knownIds }
    : head.page

  const manifest = readManifest(page)
  if ('problems' in manifest) {
    const first = manifest.problems[0]
    return {
      error: 'malformed',
      message: `That package's Page cannot be read: ${first ? first.message : 'its manifest is not valid.'}`
    }
  }

  const expected = typeof head.checksum === 'string' ? head.checksum : ''
  const intact = expected !== '' && expected === checksumOf(entries)

  // The manifest's own warnings are structured problems; flattened to their messages, because everything a person is
  // shown here is a sentence they read rather than a record they inspect.
  const warnings: string[] = manifest.warnings.map((one) => one.message)
  if (!intact) {
    warnings.push('The checksum does not match the files in this package, which means it is damaged or was changed after it was made.')
  }
  if (unknown.length > 0) {
    warnings.push(
      `This Page asks for ${unknown.length} ${unknown.length === 1 ? 'thing' : 'things'} this version of Orbis does not have: ${unknown.join(', ')}. ${unknown.length === 1 ? 'It was' : 'They were'} left out, so ${unknown.length === 1 ? 'it' : 'they'} cannot be granted and the Page may not work fully. It may have been written for a newer Orbis.`
    )
  }
  if (manifest.manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    warnings.push(`This Page was written for manifest version ${manifest.manifest.schemaVersion}; this Orbis uses ${MANIFEST_SCHEMA_VERSION}.`)
  }

  const highRisk = requested.filter((one) => one.risk === 'high' || one.risk === 'critical')
  const beforeYouDecide: string[] = [
    'This Page came from a file. Nobody at Orbis has looked at it, and it can do whatever its code says.'
  ]
  if (requested.length === 0) {
    beforeYouDecide.push('It is not asking for anything beyond working on its own. That is the safest kind of Page there is.')
  } else {
    beforeYouDecide.push(
      `It asks for: ${requested.map((one) => one.name.toLowerCase()).join(', ')}. Asking is not being given it -- you decide each one, and you can change your mind later.`
    )
  }
  if (highRisk.length > 0) {
    beforeYouDecide.push(
      `${highRisk.map((one) => one.name).join(' and ')} ${highRisk.length === 1 ? 'is' : 'are'} the kind of thing worth being sure about before saying yes.`
    )
  }
  beforeYouDecide.push(
    intact
      ? 'The checksum matches, so the file is not damaged. That says nothing about who made it: anybody editing a package can recompute the checksum, and Orbis does not sign packages.'
      : 'The checksum does not match. Either the file is damaged or it was changed since it was made, and there is no way to tell which.'
  )

  return {
    manifest: manifest.manifest,
    entries: Object.freeze(entries),
    requested: Object.freeze(requested),
    unknownCapabilities: Object.freeze(unknown),
    intact,
    version: manifest.manifest.version,
    warnings: Object.freeze(warnings),
    beforeYouDecide: Object.freeze(beforeYouDecide)
  }
}

/** A one-line description of a package, for a list. */
export const describePackage = (result: ImportResult): string =>
  `${result.manifest.title} ${versionToText(result.version)} — ${result.entries.length} file${result.entries.length === 1 ? '' : 's'}, ${result.requested.length === 0 ? 'asks for nothing' : `asks for ${result.requested.length}`}`

/** What a package is and is not, for the import screen. */
export const PACKAGE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A package is code nobody at Orbis has read. Opening one is running somebody else’s program.',
  'The checksum detects a damaged file. It is not a signature: anybody who edits a package can recompute it, so it cannot show who made a package or whether it was changed on purpose.',
  'Capabilities in a package are requests. Importing grants nothing, and every one is still yours to decide.',
  'Every path inside a package is checked before anything is written, so an entry cannot write outside the Page’s own folder.',
  'Packages are bounded in file count, file size, total size and how much they expand, because a small file that unpacks enormously is an old and real attack.',
  'Exports are scanned for anything that looks like a credential and refused if one is found. The scan catches the common case -- a key nobody noticed was saved -- and would not catch one somebody set out to hide.'
])
