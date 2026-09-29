import { CATEGORIES, categoryById, type PortabilityClass } from './registry.ts'

/**
 * What a `.orbis` package says about itself, and how much of that Orbis is willing to believe.
 *
 * A manifest is the first thing read and the last thing to be trusted. Everything in it was written by whoever made
 * the file, which on an import is not necessarily the person doing the importing. So the manifest's job is to let Orbis
 * decide *whether to proceed* -- is this even an Orbis package, was it made by a version whose data this one
 * understands, does it claim more content than will be extracted -- and its counts and hashes are then checked against
 * the archive rather than reported as facts.
 *
 * ## The signature is not security
 *
 * `ORBIS_PROFILE_PACKAGE` exists so that a ZIP file renamed to `.orbis` is refused with a sentence rather than
 * half-imported. Anyone can write those bytes. It prevents an accident, not an attack; the integrity hashes and the
 * encryption do the second job.
 *
 * ## What is not in it
 *
 * Nothing private, and nothing about the machine. A manifest is read before any password is asked for, so anything in
 * it is readable by anyone holding the file. That rules out conversation text, note titles, secret names, the computer's
 * name, the operating-system user, hardware identifiers and the export password -- and it is why the counts are counts
 * rather than lists.
 */

/** The package format's own version. Bumped when the layout changes in a way an older reader cannot follow. */
export const FORMAT_VERSION = 1

/** The oldest format this build can read. */
export const MINIMUM_READABLE_FORMAT = 1

/** In the archive at a fixed path, so a reader finds it without scanning. */
export const MANIFEST_PATH = 'manifest.json'

/** The marker that tells an Orbis package from a renamed ZIP. Not a security measure. */
export const PACKAGE_SIGNATURE = 'ORBIS_PROFILE_PACKAGE'

export type PackagePurpose = 'transfer' | 'backup' | 'snapshot'

export interface CategoryRecord {
  id: string
  /** What happened to this category when the package was made. */
  disposition: 'included' | 'transformed' | 'excluded' | 'failed'
  /** How many objects. Counted from what was actually written, never estimated. */
  count: number
  /** Bytes of content, uncompressed. */
  bytes: number
  /** The portable schema version this category was written at. */
  schemaVersion: number
  /** Why, for anything not simply included. */
  note: string
  /** The archive paths this category's data is at. */
  paths: string[]
}

export interface AssetRecord {
  /** Content-addressed: the same bytes appear once however many things reference them. */
  hash: string
  path: string
  bytes: number
  mediaType: string
  /** How many objects point at it. */
  references: number
}

export interface IntegrityRecord {
  /** The hash algorithm. Named so a future package can use a different one without ambiguity. */
  algorithm: 'sha-256'
  /** One entry per archive path, so a single changed file is found rather than only a changed package. */
  entries: { path: string; bytes: number; hash: string }[]
  /** A hash over the entry list itself, so entries cannot be removed from it unnoticed. */
  digest: string
}

export interface EncryptionRecord {
  /** False for a package with nothing sensitive in it, or one the user chose not to protect. */
  encrypted: boolean
  /** Named rather than implied, so a future package can change either without guessing. */
  cipher: 'aes-256-gcm' | null
  kdf: 'scrypt' | null
  /** The scrypt cost, so the destination derives the same key. */
  kdfParams: { N: number; r: number; p: number } | null
  /** Which archive paths are sealed. Everything else is readable without the password. */
  sealed: string[]
}

export interface Manifest {
  signature: typeof PACKAGE_SIGNATURE
  formatVersion: number
  /** The lowest format version that can read this package. */
  minimumReadableBy: number

  /** Distinguishes two packages with the same filename. Random per export. */
  packageId: string
  purpose: PackagePurpose

  /** The Orbis that wrote it, for the compatibility check and for diagnostics. */
  createdByVersion: string
  createdAt: number

  /**
   * The profile this belongs to, logically.
   *
   * The logical identity travels so that importing onto a new machine continues the same profile rather than starting a
   * stranger. Nothing about the device does: no machine name, no operating-system user, no hardware identifier.
   */
  profileId: string
  profileName: string

  categories: CategoryRecord[]
  assets: { count: number; bytes: number; deduplicated: number }
  integrity: IntegrityRecord
  encryption: EncryptionRecord

  /** The platform family, for migrating settings that differ between them. Not the machine. */
  platform: 'win32' | 'darwin' | 'linux' | 'unknown'
}

// ---------------------------------------------------------------- validation

export interface ManifestProblem {
  field: string
  describe: string
  /** A blocking problem stops the import. A note is reported and does not. */
  blocking: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Whether a manifest can be acted on.
 *
 * Every field is checked rather than trusted, including the ones that look harmless: a count is used to size a progress
 * bar and a negative one is a division by something unexpected; a path list decides what gets extracted. The result
 * separates what stops the import from what is merely worth saying, because refusing a package over a cosmetic field
 * loses the user their data for no reason.
 */
export function checkManifest(raw: unknown, options: { formatVersion?: number } = {}): ManifestProblem[] {
  const problems: ManifestProblem[] = []
  const blocking = (field: string, describe: string): void => {
    problems.push({ field, describe, blocking: true })
  }
  const note = (field: string, describe: string): void => {
    problems.push({ field, describe, blocking: false })
  }

  if (!isRecord(raw)) {
    return [{ field: 'manifest', describe: 'The package has no readable manifest, so there is nothing to say what it contains.', blocking: true }]
  }

  if (raw.signature !== PACKAGE_SIGNATURE) {
    blocking(
      'signature',
      'This file does not carry the Orbis package marker. A ZIP file renamed to .orbis is not an Orbis profile, and importing one would mean guessing at what the contents mean.'
    )
  }

  const format = raw.formatVersion
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) blocking('formatVersion', 'The package does not say which format it uses.')
  else {
    const here = options.formatVersion ?? FORMAT_VERSION
    const minimum = typeof raw.minimumReadableBy === 'number' ? raw.minimumReadableBy : format
    if (minimum > here) {
      blocking(
        'formatVersion',
        `This package was made by a newer Orbis: it needs format ${minimum} and this one reads up to ${here}. Importing it would mean silently dropping whatever the newer version added, so it is refused.`
      )
    } else if (format < MINIMUM_READABLE_FORMAT) {
      blocking('formatVersion', `This package uses format ${format}, which this Orbis no longer reads.`)
    } else if (format < here) {
      note('formatVersion', `This package uses format ${format} and will be migrated to ${here} on import.`)
    }
  }

  if (typeof raw.packageId !== 'string' || raw.packageId.length < 8) blocking('packageId', 'The package has no identifier, so two packages could not be told apart.')
  if (typeof raw.profileId !== 'string' || raw.profileId.length === 0) blocking('profileId', 'The package does not say which profile it belongs to.')
  if (typeof raw.profileName !== 'string') note('profileName', 'The package does not name its profile.')
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt) || raw.createdAt <= 0) note('createdAt', 'The package does not say when it was made.')
  if (raw.purpose !== 'transfer' && raw.purpose !== 'backup' && raw.purpose !== 'snapshot') note('purpose', 'The package does not say whether it is a transfer, a backup or a snapshot.')

  // Categories.
  if (!Array.isArray(raw.categories)) blocking('categories', 'The package does not list what it contains.')
  else {
    if (raw.categories.length === 0) blocking('categories', 'The package lists no data at all, so there is nothing to import.')
    if (raw.categories.length > 500) blocking('categories', 'The package lists more categories than Orbis has, which means its manifest does not describe Orbis data.')
    const seen = new Set<string>()
    for (const [i, one] of raw.categories.entries()) {
      if (!isRecord(one) || typeof one.id !== 'string') {
        blocking(`categories[${i}]`, 'One of the listed categories is not readable.')
        continue
      }
      if (seen.has(one.id)) blocking(`categories[${i}]`, `The package lists "${one.id}" twice.`)
      seen.add(one.id)
      if (categoryById(one.id) === undefined) {
        // Not blocking. A newer Orbis may have exported something this one has never heard of, and refusing the whole
        // package over it would lose everything else. It is skipped and reported.
        note(`categories[${i}]`, `This package contains "${one.id}", which this Orbis does not know. It will be left alone rather than guessed at.`)
      }
      if (typeof one.count !== 'number' || one.count < 0 || !Number.isFinite(one.count)) blocking(`categories[${i}].count`, `"${one.id}" does not say how many objects it holds.`)
      if (typeof one.bytes !== 'number' || one.bytes < 0 || !Number.isFinite(one.bytes)) blocking(`categories[${i}].bytes`, `"${one.id}" does not say how large it is.`)
      if (!Array.isArray(one.paths)) blocking(`categories[${i}].paths`, `"${one.id}" does not say where its data is in the package.`)
    }
  }

  // Integrity.
  if (!isRecord(raw.integrity)) blocking('integrity', 'The package carries no integrity information, so corruption could not be detected.')
  else {
    if (raw.integrity.algorithm !== 'sha-256') blocking('integrity.algorithm', 'The package uses an integrity algorithm this Orbis does not know.')
    if (!Array.isArray(raw.integrity.entries) || raw.integrity.entries.length === 0) blocking('integrity.entries', 'The package lists no file hashes, so a changed file could not be found.')
    if (typeof raw.integrity.digest !== 'string' || raw.integrity.digest.length < 32) {
      blocking('integrity.digest', 'The package’s hash list is not itself hashed, so entries could have been removed from it unnoticed.')
    }
  }

  // Encryption.
  if (!isRecord(raw.encryption)) blocking('encryption', 'The package does not say whether it is protected.')
  else {
    const e = raw.encryption
    if (typeof e.encrypted !== 'boolean') blocking('encryption.encrypted', 'The package does not say whether it is protected.')
    else if (e.encrypted) {
      if (e.cipher !== 'aes-256-gcm') blocking('encryption.cipher', 'The package is protected with a cipher this Orbis does not use.')
      if (e.kdf !== 'scrypt') blocking('encryption.kdf', 'The package derives its key in a way this Orbis does not use.')
      if (!isRecord(e.kdfParams) || typeof e.kdfParams.N !== 'number') blocking('encryption.kdfParams', 'The package does not say how to derive its key, so the password could not be used.')
      if (!Array.isArray(e.sealed) || e.sealed.length === 0) blocking('encryption.sealed', 'The package says it is protected and names nothing as protected.')
    }
  }

  return problems
}

/** Whether the package can be imported at all. */
export const canImport = (problems: readonly ManifestProblem[]): boolean => !problems.some((one) => one.blocking)

// ---------------------------------------------------------------- reading a checked manifest

/**
 * A manifest as a usable object, once it has been checked.
 *
 * Defaults are applied only to the fields whose absence is a note rather than a refusal, so a package missing its
 * creation time is importable and a package missing its integrity list is not.
 */
export function readManifest(raw: unknown): Manifest | null {
  if (!isRecord(raw)) return null
  if (!canImport(checkManifest(raw))) return null
  const e = raw.encryption as Record<string, unknown>

  return {
    signature: PACKAGE_SIGNATURE,
    formatVersion: raw.formatVersion as number,
    minimumReadableBy: typeof raw.minimumReadableBy === 'number' ? raw.minimumReadableBy : (raw.formatVersion as number),
    packageId: raw.packageId as string,
    purpose: raw.purpose === 'backup' || raw.purpose === 'snapshot' ? raw.purpose : 'transfer',
    createdByVersion: typeof raw.createdByVersion === 'string' ? raw.createdByVersion : 'unknown',
    createdAt: typeof raw.createdAt === 'number' && raw.createdAt > 0 ? raw.createdAt : 0,
    profileId: raw.profileId as string,
    profileName: typeof raw.profileName === 'string' ? raw.profileName : '',
    categories: (raw.categories as Record<string, unknown>[]).map((one) => ({
      id: one.id as string,
      disposition:
        one.disposition === 'transformed' || one.disposition === 'excluded' || one.disposition === 'failed' ? one.disposition : 'included',
      count: one.count as number,
      bytes: one.bytes as number,
      schemaVersion: typeof one.schemaVersion === 'number' ? one.schemaVersion : 1,
      note: typeof one.note === 'string' ? one.note : '',
      paths: (one.paths as unknown[]).filter((p): p is string => typeof p === 'string')
    })),
    assets: isRecord(raw.assets)
      ? {
          count: typeof raw.assets.count === 'number' ? raw.assets.count : 0,
          bytes: typeof raw.assets.bytes === 'number' ? raw.assets.bytes : 0,
          deduplicated: typeof raw.assets.deduplicated === 'number' ? raw.assets.deduplicated : 0
        }
      : { count: 0, bytes: 0, deduplicated: 0 },
    integrity: {
      algorithm: 'sha-256',
      entries: ((raw.integrity as Record<string, unknown>).entries as Record<string, unknown>[])
        .filter((one) => isRecord(one) && typeof one.path === 'string' && typeof one.hash === 'string')
        .map((one) => ({ path: one.path as string, bytes: typeof one.bytes === 'number' ? one.bytes : 0, hash: one.hash as string })),
      digest: (raw.integrity as Record<string, unknown>).digest as string
    },
    encryption: {
      encrypted: e.encrypted === true,
      cipher: e.encrypted === true ? 'aes-256-gcm' : null,
      kdf: e.encrypted === true ? 'scrypt' : null,
      kdfParams:
        e.encrypted === true && isRecord(e.kdfParams)
          ? { N: e.kdfParams.N as number, r: (e.kdfParams.r as number) ?? 8, p: (e.kdfParams.p as number) ?? 1 }
          : null,
      sealed: Array.isArray(e.sealed) ? e.sealed.filter((one): one is string => typeof one === 'string') : []
    },
    platform: raw.platform === 'win32' || raw.platform === 'darwin' || raw.platform === 'linux' ? raw.platform : 'unknown'
  }
}

// ---------------------------------------------------------------- what it contains, for a person

export interface Summary {
  profileName: string
  createdAt: number
  createdByVersion: string
  purpose: PackagePurpose
  encrypted: boolean
  /** One line per category with something in it, largest first. */
  contents: { id: string; label: string; count: number; bytes: number }[]
  /** Categories this Orbis does not recognise, named rather than hidden. */
  unknown: string[]
  /** Categories the package says it could not write. */
  failed: { id: string; label: string; note: string }[]
  totalBytes: number
  assets: { count: number; bytes: number }
  describe: string
}

/**
 * What to show before importing.
 *
 * Every number comes from the manifest, which was written by counting what went in rather than by estimating. A preview
 * that guessed would be the first thing a user compared against the result, and the first place they would lose trust.
 */
export function summarise(manifest: Manifest): Summary {
  const contents: Summary['contents'] = []
  const unknown: string[] = []
  const failed: Summary['failed'] = []

  for (const one of manifest.categories) {
    const known = categoryById(one.id)
    if (known === undefined) {
      unknown.push(one.id)
      continue
    }
    if (one.disposition === 'failed') {
      failed.push({ id: one.id, label: known.label, note: one.note })
      continue
    }
    if (one.disposition === 'excluded') continue
    if (one.count === 0 && one.bytes === 0) continue
    contents.push({ id: one.id, label: known.label, count: one.count, bytes: one.bytes })
  }

  contents.sort((a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label))
  const totalBytes = manifest.categories.reduce((running, one) => running + one.bytes, 0)

  const parts: string[] = [`${contents.length} kind${contents.length === 1 ? '' : 's'} of data`]
  if (manifest.assets.count > 0) parts.push(`${manifest.assets.count.toLocaleString('en')} files`)
  if (unknown.length > 0) parts.push(`${unknown.length} this Orbis does not recognise`)
  if (failed.length > 0) parts.push(`${failed.length} the export could not write`)

  return {
    profileName: manifest.profileName,
    createdAt: manifest.createdAt,
    createdByVersion: manifest.createdByVersion,
    purpose: manifest.purpose,
    encrypted: manifest.encryption.encrypted,
    contents,
    unknown,
    failed,
    totalBytes,
    assets: { count: manifest.assets.count, bytes: manifest.assets.bytes },
    describe: `${parts.join(', ')}.${failed.length > 0 ? ' The export recorded a failure, so this package is not complete.' : ''}`
  }
}

// ---------------------------------------------------------------- compatibility

export interface Compatibility {
  importable: boolean
  /** Categories in the package that will be restored. */
  willRestore: string[]
  /** Categories that need migrating from an older schema, with the versions involved. */
  willMigrate: { id: string; from: number; to: number }[]
  /** Categories this Orbis cannot use, with why. */
  cannotUse: { id: string; why: string }[]
  /** What the user will have to do afterwards. */
  userActions: { id: string; label: string; action: string }[]
  problems: ManifestProblem[]
  describe: string
}

/**
 * Whether this Orbis can use this package, worked out before anything is written.
 *
 * A category written at a newer schema than this build understands is refused *for that category* rather than for the
 * package: losing one feature's data is bad, and losing the whole profile because one feature moved on is worse.
 */
export function checkCompatibility(manifest: Manifest, options: { formatVersion?: number } = {}): Compatibility {
  const problems = checkManifest(manifest as unknown, options)
  const willRestore: string[] = []
  const willMigrate: Compatibility['willMigrate'] = []
  const cannotUse: Compatibility['cannotUse'] = []

  for (const one of manifest.categories) {
    if (one.disposition === 'excluded' || one.disposition === 'failed') continue
    const known = categoryById(one.id)
    if (known === undefined) {
      cannotUse.push({ id: one.id, why: 'This Orbis has no such data. It is left in the package rather than guessed at.' })
      continue
    }
    if (one.schemaVersion > known.schemaVersion) {
      cannotUse.push({
        id: one.id,
        why: `The package holds this at version ${one.schemaVersion} and this Orbis understands version ${known.schemaVersion}. Reading it would mean dropping whatever the newer version added.`
      })
      continue
    }
    if (one.schemaVersion < known.schemaVersion) willMigrate.push({ id: one.id, from: one.schemaVersion, to: known.schemaVersion })
    willRestore.push(one.id)
  }

  const userActions = CATEGORIES.filter((one) => one.requiresReauthentication && one.userAction !== null)
    .filter((one) => willRestore.includes(one.id) || one.portability === 'device-bound')
    .map((one) => ({ id: one.id, label: one.label, action: one.userAction as string }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const importable = canImport(problems) && willRestore.length > 0

  return {
    importable,
    willRestore: willRestore.sort(),
    willMigrate: willMigrate.sort((a, b) => a.id.localeCompare(b.id)),
    cannotUse: cannotUse.sort((a, b) => a.id.localeCompare(b.id)),
    userActions,
    problems,
    describe: !canImport(problems)
      ? `This package cannot be imported: ${problems.filter((one) => one.blocking).map((one) => one.describe).join(' ')}`
      : willRestore.length === 0
        ? 'Nothing in this package can be restored by this version of Orbis.'
        : `${willRestore.length} kind${willRestore.length === 1 ? '' : 's'} of data can be restored${willMigrate.length > 0 ? `, ${willMigrate.length} after migrating` : ''}${cannotUse.length > 0 ? `; ${cannotUse.length} cannot be used by this version` : ''}.`
  }
}

// ---------------------------------------------------------------- building one

export interface BuildManifestInput {
  packageId: string
  purpose: PackagePurpose
  createdByVersion: string
  createdAt: number
  profileId: string
  profileName: string
  categories: CategoryRecord[]
  assets: Manifest['assets']
  integrity: IntegrityRecord
  encryption: EncryptionRecord
  platform: Manifest['platform']
}

/**
 * The manifest for a package being written.
 *
 * Deliberately takes every number rather than working any out: the counts have to come from what was actually written,
 * and a function that could compute them here would be computing them from a different source than the archive.
 */
export function buildManifest(input: BuildManifestInput): Manifest {
  return {
    signature: PACKAGE_SIGNATURE,
    formatVersion: FORMAT_VERSION,
    minimumReadableBy: MINIMUM_READABLE_FORMAT,
    packageId: input.packageId,
    purpose: input.purpose,
    createdByVersion: input.createdByVersion,
    createdAt: input.createdAt,
    profileId: input.profileId,
    profileName: input.profileName,
    categories: [...input.categories].sort((a, b) => a.id.localeCompare(b.id)),
    assets: input.assets,
    integrity: input.integrity,
    encryption: input.encryption,
    platform: input.platform
  }
}

/**
 * Whether a manifest is honest about being complete.
 *
 * A package that failed to write a category is not an export of everything, and the export result must not say it was.
 * This is the check that stops "Everything exported" appearing over a package missing the workflows.
 */
export function completeness(manifest: Manifest, asked: readonly string[]): {
  complete: boolean
  missing: string[]
  failed: string[]
  describe: string
} {
  const written = new Set(manifest.categories.filter((one) => one.disposition === 'included' || one.disposition === 'transformed').map((one) => one.id))
  const failed = manifest.categories.filter((one) => one.disposition === 'failed').map((one) => one.id)
  const missing = asked.filter((one) => !written.has(one) && !failed.includes(one))

  const complete = missing.length === 0 && failed.length === 0
  return {
    complete,
    missing,
    failed,
    describe: complete
      ? 'Everything that was asked for is in the package.'
      : `${failed.length > 0 ? `${failed.length} could not be written (${failed.map((one) => categoryById(one)?.label ?? one).join(', ')}). ` : ''}${missing.length > 0 ? `${missing.length} was asked for and is not in the package (${missing.map((one) => categoryById(one)?.label ?? one).join(', ')}). ` : ''}This package is not complete, and must not be described as one.`
  }
}

/** A category record for something deliberately left out, so the manifest accounts for it. */
export function excludedRecord(id: string): CategoryRecord | null {
  const one = categoryById(id)
  if (one === undefined) return null
  const disposition: CategoryRecord['disposition'] = 'excluded'
  return {
    id,
    disposition,
    count: 0,
    bytes: 0,
    schemaVersion: one.schemaVersion,
    note: one.why ?? describeClass(one.portability),
    paths: []
  }
}

const describeClass = (one: PortabilityClass): string =>
  one === 'rebuilt'
    ? 'Rebuilt on the destination from data that is in the package.'
    : one === 'device-bound'
      ? 'Belongs to the machine it was made on and cannot be carried.'
      : 'Included.'

/** The assumptions the manifest rests on, shown rather than implied. */
export const MANIFEST_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A manifest is read before anything is trusted. Its counts and hashes are checked against the archive rather than reported as facts.',
  'The package marker stops a renamed ZIP being half-imported. Anyone can write those bytes, so it prevents an accident and not an attack.',
  'The manifest is readable without a password, so nothing private goes in it: no content, no titles, no secret names, no device identifiers and never the export password.',
  'Counts come from what was actually written, never from an estimate, because the preview is the first thing a user compares against the result.',
  'A package made by a newer Orbis is refused rather than opened and quietly stripped of what the newer version added.',
  'A single category written at a newer schema is refused for that category alone. Losing one feature’s data is bad; losing the profile because one feature moved on is worse.',
  'A category this Orbis has never heard of is reported and left alone rather than guessed at.',
  'A package that failed to write a category is not complete, and no result over it may say everything was exported.',
  'The logical profile identity travels so an import continues the same profile. Nothing about the device does.'
])
