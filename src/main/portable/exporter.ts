/**
 * Writing a profile out as a `.orbis` package.
 *
 * Takes what the registry says exists, what the providers say about carrying it, the ZIP writer and the manifest, and
 * produces one file. The whole of the interesting behaviour is in what it refuses to claim.
 *
 * ## Four things this will not do
 *
 * **It will not say a package is complete when it is not.** A category that failed to read is recorded as failed,
 * and `completeness` refuses to let the result call itself an export of everything. A transfer that quietly leaves
 * the workflows behind and reports success is worse than one that fails, because the person deletes the original.
 *
 * **It will not count what it did not write.** Every number in the manifest comes from bytes that went into the
 * archive. The estimate exists separately and is called an estimate, because the preview is the first thing somebody
 * compares the result against.
 *
 * **It will not trust its own output.** After writing, it reads the package back through the same reader an import
 * would use, checks every hash, and — when the package is encrypted — opens an entry with the key it just used. A
 * package that cannot be read is a failure discovered here, not on the other machine after the original is gone.
 *
 * **It will not write a partial file where a whole one is expected.** The archive is assembled and verified before
 * anything reaches the destination path.
 *
 * ## Everything is injected
 *
 * Reading files, writing files, compressing, hashing and the clock all arrive as parameters. Not for purity: it is
 * what lets the whole of this be tested against a profile made of a Map, including the failure paths that are
 * awkward to arrange on a real disk — a file that disappears mid-export, a disk with no room, a cancelled run.
 */

import {
  buildManifest,
  completeness,
  excludedRecord,
  MANIFEST_PATH,
  type CategoryRecord,
  type EncryptionRecord,
  type IntegrityRecord,
  type Manifest,
  type PackagePurpose
} from '../../shared/portable/manifest.ts'
import {
  CATEGORIES,
  EXCLUDED,
  withDependencies,
  type PortableCategory
} from '../../shared/portable/registry.ts'
import { DEFAULT_LIMITS, shouldCompress, ZipWriter, type ZipError } from '../../shared/portable/zip.ts'
import { forgetKey, protectPackage, sealEntry, type PackageProtection } from './encryption.ts'
import {
  builtInProviders,
  isProviderError,
  packagePathFor,
  sourcesFor,
  type PortableProviderRegistry
} from './providers.ts'

/** Where the protection record lives. Readable without a password, like the manifest, and holding neither. */
export const PROTECTION_PATH = 'protection.json'

export interface ExportError {
  error: 'no-categories' | 'no-space' | 'cancelled' | 'archive' | 'verification' | 'password' | 'write'
  message: string
}

export const isExportError = (value: unknown): value is ExportError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ExportError['error'], message: string): ExportError => ({ error, message })

/** One file found under a storage path. */
export interface SourceFile {
  /** Relative to the scope root, using forward slashes. */
  path: string
  bytes: number
  modified: number
}

export interface ExportDeps {
  /** Every file under a storage path, or just the one when it is a file. Empty when it does not exist. */
  list(scope: 'profile' | 'app', storagePath: string): Promise<SourceFile[]>
  read(scope: 'profile' | 'app', path: string): Promise<Buffer | null>
  write(destination: string, bytes: Uint8Array): Promise<void>
  /** Bytes free where the package is going, or null when it cannot be worked out. */
  freeSpace(destination: string): Promise<number | null>
  deflateRawSync(data: Uint8Array): Uint8Array
  inflateRawSync(data: Uint8Array): Uint8Array
  sha256(data: Uint8Array): string
  now(): number
  appVersion: string
  platform: Manifest['platform']
}

export interface ExportRequest {
  profileId: string
  profileName: string
  /** Category ids. Dependencies are pulled in, and the additions are reported. */
  categoryIds: readonly string[]
  purpose: PackagePurpose
  /** Null writes an unencrypted package, which is refused when anything sensitive was chosen. */
  password: string | null
  destination: string
}

export type ExportStage = 'planning' | 'reading' | 'writing' | 'verifying' | 'done'

export interface ExportProgress {
  stage: ExportStage
  /** The category being worked on, when one is. */
  category: string | null
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  message: string
}

export interface ExportOutcome {
  destination: string
  /** The size of the file written. */
  bytes: number
  manifest: Manifest
  /** Whether every chosen category actually made it, and what to say if not. */
  complete: ReturnType<typeof completeness>
  /** Categories pulled in because something chosen depends on them. */
  addedDependencies: readonly string[]
  /** Categories that could not be carried at all, with the reason. */
  failures: readonly { categoryId: string; message: string }[]
  notes: readonly string[]
}

export interface ExportOptions {
  /** Checked between files. Returning true stops the export before anything is written. */
  shouldCancel?(): boolean
  onProgress?(progress: ExportProgress): void
}

/** An estimate of the space an export needs, made before doing any of the work. */
export interface Estimate {
  /** The content, uncompressed. */
  contentBytes: number
  files: number
  /** What the package is likely to take on disk, after compression and sealing. */
  packageBytes: number
  /** Free space where it is going, when that could be found out. */
  freeBytes: number | null
  enoughRoom: boolean | null
  why: string
}

/**
 * How much room an export will need.
 *
 * Compression is guessed at, not measured — measuring means doing the export. The guess is deliberately pessimistic
 * (a third off, where JSON usually gives far more) because the failure this exists to prevent is running out of room
 * halfway through, and an estimate that is too small causes exactly that.
 */
export async function estimate(request: ExportRequest, deps: ExportDeps): Promise<Estimate | ExportError> {
  const plan = planCategories(request.categoryIds)
  if (isExportError(plan)) return plan

  let contentBytes = 0
  let files = 0
  for (const source of sourcesFor(plan.categoryIds)) {
    for (const file of await deps.list(source.scope, source.storage)) {
      contentBytes += file.bytes
      files += 1
    }
  }
  // A third off for compression, plus the per-entry sealing and header cost.
  const packageBytes = Math.ceil(contentBytes * 0.67) + files * 128
  const freeBytes = await deps.freeSpace(request.destination)
  // Room for the package and for the copy the verification reads back.
  const needed = packageBytes * 2
  const enoughRoom = freeBytes === null ? null : freeBytes > needed
  return {
    contentBytes,
    files,
    packageBytes,
    freeBytes,
    enoughRoom,
    why:
      freeBytes === null
        ? `About ${format(packageBytes)} from ${files} files. How much room is free where this is going could not be worked out, so nothing was checked against it.`
        : enoughRoom === true
          ? `About ${format(packageBytes)} from ${files} files, with ${format(freeBytes)} free. The check allows for twice the package, because it is read back to be verified before you are told it worked.`
          : `About ${format(packageBytes)} from ${files} files, and only ${format(freeBytes)} is free. Writing it and reading it back to verify needs roughly ${format(needed)}.`
  }
}

const format = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface Plan {
  categoryIds: string[]
  added: string[]
  order: string[]
}

function planCategories(asked: readonly string[]): Plan | ExportError {
  const wanted = [...new Set(asked)]
  if (wanted.length === 0) {
    return fail('no-categories', 'Nothing was chosen to export. An empty package is not a backup of anything.')
  }
  const known = new Set(CATEGORIES.map((one) => one.id))
  const unknown = wanted.filter((one) => !known.has(one))
  if (unknown.length > 0) {
    return fail('no-categories', `There is nothing called ${unknown.map((one) => `"${one}"`).join(', ')} to export.`)
  }
  const excluded = new Set(EXCLUDED.map((one) => one.id))
  const carriable = wanted.filter((one) => !excluded.has(one))
  if (carriable.length === 0) {
    return fail(
      'no-categories',
      'Everything chosen is tied to this machine and cannot be carried. A package of nothing but exclusions would be an empty file with a reassuring name.'
    )
  }
  const withDeps = withDependencies(carriable)
  return { categoryIds: withDeps.categories, added: withDeps.added, order: withDeps.categories }
}

const categoryById = (id: string): PortableCategory | undefined => CATEGORIES.find((one) => one.id === id)

/** Whether anything chosen is sensitive enough that going without a password would be a mistake. */
export function needsPassword(categoryIds: readonly string[]): { required: boolean; because: string[] } {
  const because: string[] = []
  for (const id of categoryIds) {
    const one = categoryById(id)
    if (one === undefined) continue
    // 'sealed' data is already encrypted by something the user knows, so it does not need the package password to be
    // safe. 'personal' is the user's own content in the clear, which is exactly what a password is for.
    if (one.sensitivity === 'personal') because.push(one.label)
  }
  return { required: because.length > 0, because }
}

/**
 * Writes the package.
 *
 * The order of events matters and is worth stating: everything is read and sealed in memory, the archive is
 * assembled, the archive is verified by reading it back, and only then is it written to the destination. A failure
 * at any point before that last step leaves the destination untouched.
 */
export async function exportProfile(
  request: ExportRequest,
  deps: ExportDeps,
  options: ExportOptions = {},
  providers: PortableProviderRegistry = builtInProviders()
): Promise<ExportOutcome | ExportError> {
  const plan = planCategories(request.categoryIds)
  if (isExportError(plan)) return plan

  const sensitive = needsPassword(plan.categoryIds)
  if (sensitive.required && (request.password === null || request.password === '')) {
    return fail(
      'password',
      `${sensitive.because.join(', ')} ${sensitive.because.length === 1 ? 'is' : 'are'} private, and an unprotected package is a plain file anyone who picks up the drive can read. Give a password, or leave ${sensitive.because.length === 1 ? 'that' : 'those'} out.`
    )
  }

  let protection: PackageProtection | null = null
  let key: Buffer | null = null
  if (request.password !== null && request.password !== '') {
    const made = await protectPackage(request.password)
    if ('error' in made) return fail('password', made.message)
    protection = made.protection
    key = made.key
  }

  try {
    return await write(request, deps, options, providers, plan, protection, key)
  } finally {
    forgetKey(key)
  }
}

async function write(
  request: ExportRequest,
  deps: ExportDeps,
  options: ExportOptions,
  providers: PortableProviderRegistry,
  plan: Plan,
  protection: PackageProtection | null,
  key: Buffer | null
): Promise<ExportOutcome | ExportError> {
  const report = (progress: ExportProgress): void => options.onProgress?.(progress)
  const cancelled = (): boolean => options.shouldCancel?.() === true

  report({ stage: 'planning', category: null, filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0, message: 'Working out what to carry.' })

  const sources = sourcesFor(plan.categoryIds)
  // Keyed by the file, not by the storage path it was found under. One storage path can contain another --
  // `workflows` is a directory and `workflows/runs.json` is a file inside it, belonging to a different category --
  // so the same file is reached twice and every category that reached it is recorded against the one copy.
  const byFile = new Map<string, { scope: 'profile' | 'app'; storage: string; file: SourceFile; wantedBy: string[] }>()
  for (const source of sources) {
    for (const file of await deps.list(source.scope, source.storage)) {
      const key = `${source.scope}:${file.path}`
      const existing = byFile.get(key)
      if (existing === undefined) {
        byFile.set(key, { scope: source.scope, storage: source.storage, file, wantedBy: [...source.wantedBy] })
        continue
      }
      for (const id of source.wantedBy) if (!existing.wantedBy.includes(id)) existing.wantedBy.push(id)
    }
  }
  const work = [...byFile.values()]
  const bytesTotal = work.reduce((total, one) => total + one.file.bytes, 0)

  const archive = new ZipWriter(deps.deflateRawSync)
  // `add` returns the bytes for that entry and `finish` returns the table of contents; the caller concatenates them.
  // It is a streaming interface, so nothing is held twice -- and dropping what `add` returns leaves an archive whose
  // table of contents points at data that was never written.
  const chunks: Uint8Array[] = []
  const integrity: IntegrityRecord['entries'] = []
  const sealed: string[] = []
  const perCategory = new Map<string, { count: number; bytes: number; paths: string[]; notes: string[] }>()
  const failures: { categoryId: string; message: string }[] = []
  const notes: string[] = []
  let filesDone = 0
  let bytesDone = 0

  const note = (categoryIds: readonly string[], text: string): void => {
    for (const id of categoryIds) {
      const entry = perCategory.get(id) ?? { count: 0, bytes: 0, paths: [], notes: [] }
      if (!entry.notes.includes(text)) entry.notes.push(text)
      perCategory.set(id, entry)
    }
  }

  for (const item of work) {
    if (cancelled()) return fail('cancelled', 'The export was stopped. Nothing was written.')
    report({
      stage: 'reading',
      category: item.wantedBy[0] ?? null,
      filesDone,
      filesTotal: work.length,
      bytesDone,
      bytesTotal,
      message: `Reading ${item.file.path}`
    })

    const raw = await deps.read(item.scope, item.file.path)
    if (raw === null) {
      // A file listed a moment ago and unreadable now. Recorded against every category that wanted it, rather than
      // dropped -- this is exactly the gap that makes a package quietly incomplete.
      const message = `"${item.file.path}" could not be read. It may have been changed or removed while the export was running.`
      for (const id of item.wantedBy) failures.push({ categoryId: id, message })
      note(item.wantedBy, message)
      continue
    }

    // Every category that wants this file has to agree it can be carried. In practice only one transforms it.
    let payload: Buffer = raw
    let refused = false
    for (const id of item.wantedBy) {
      const provider = providers.for(id)
      if (isProviderError(provider)) {
        failures.push({ categoryId: id, message: provider.message })
        refused = true
        continue
      }
      const produced = provider.toPackage(item.file.path, payload)
      if (produced === null) {
        note([id], `"${item.file.path}" was left out of the package deliberately.`)
        refused = true
        break
      }
      if (isProviderError(produced)) {
        failures.push({ categoryId: id, message: produced.message })
        note([id], produced.message)
        refused = true
        break
      }
      payload = produced
    }
    if (refused) continue

    const path = packagePathFor(item.scope, item.file.path)
    const content = payload
    const stored = key === null || protection === null ? content : sealEntry(key, protection.packageId, path, content)
    if (!Buffer.isBuffer(stored)) {
      return fail('archive', `"${path}" could not be sealed: ${stored.message}`)
    }
    if (key !== null) sealed.push(path)

    const added = archive.add(
      {
        path,
        data: stored,
        // A sealed entry is indistinguishable from random bytes, so compressing it wastes time for nothing.
        compress: key === null && shouldCompress(item.file.path, content.length),
        modified: item.file.modified
      },
      DEFAULT_LIMITS
    )
    if (!(added instanceof Uint8Array)) {
      return fail('archive', `"${path}" could not go into the package: ${(added as ZipError).message}`)
    }
    chunks.push(added)

    integrity.push({ path, bytes: stored.length, hash: deps.sha256(stored) })
    for (const id of item.wantedBy) {
      const entry = perCategory.get(id) ?? { count: 0, bytes: 0, paths: [], notes: [] }
      entry.count += 1
      entry.bytes += content.length
      entry.paths.push(path)
      perCategory.set(id, entry)
    }
    filesDone += 1
    bytesDone += item.file.bytes
  }

  if (cancelled()) return fail('cancelled', 'The export was stopped. Nothing was written.')

  // The records, built from what actually went in.
  const records: CategoryRecord[] = []
  for (const id of plan.categoryIds) {
    const one = categoryById(id)
    if (one === undefined) continue
    const gathered = perCategory.get(id)
    const failed = failures.some((entry) => entry.categoryId === id)
    const disposition: CategoryRecord['disposition'] =
      failed && (gathered?.count ?? 0) === 0 ? 'failed' : one.portability === 'transformed' ? 'transformed' : 'included'
    records.push({
      id,
      disposition,
      count: gathered?.count ?? 0,
      bytes: gathered?.bytes ?? 0,
      schemaVersion: one.schemaVersion,
      note: (gathered?.notes ?? []).join(' ') || (one.why ?? 'Included.'),
      paths: gathered?.paths ?? []
    })
  }
  for (const one of EXCLUDED) {
    const record = excludedRecord(one.id)
    if (record !== null) records.push(record)
  }

  const encryption: EncryptionRecord =
    protection === null
      ? { encrypted: false, cipher: null, kdf: null, kdfParams: null, sealed: [] }
      : {
          encrypted: true,
          cipher: 'aes-256-gcm',
          kdf: 'scrypt',
          kdfParams: { N: protection.wrapped.n, r: protection.wrapped.r, p: protection.wrapped.p },
          sealed
        }

  const manifest = buildManifest({
    packageId: protection?.packageId ?? deps.sha256(Buffer.from(`${request.profileId}:${deps.now()}`, 'utf8')).slice(0, 32),
    purpose: request.purpose,
    createdByVersion: deps.appVersion,
    createdAt: deps.now(),
    profileId: request.profileId,
    profileName: request.profileName,
    categories: records,
    assets: { count: 0, bytes: 0, deduplicated: 0 },
    integrity: { algorithm: 'sha-256', entries: integrity, digest: deps.sha256(Buffer.from(JSON.stringify(integrity), 'utf8')) },
    encryption,
    platform: deps.platform
  })

  report({ stage: 'writing', category: null, filesDone, filesTotal: work.length, bytesDone, bytesTotal, message: 'Assembling the package.' })

  // The manifest and the protection record go in unsealed, because both are read before a password is asked for.
  const manifestEntry = archive.add({ path: MANIFEST_PATH, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), compress: true, modified: deps.now() })
  if (!(manifestEntry instanceof Uint8Array)) return fail('archive', `The manifest could not go into the package: ${(manifestEntry as ZipError).message}`)
  chunks.push(manifestEntry)
  if (protection !== null) {
    const record = archive.add({ path: PROTECTION_PATH, data: Buffer.from(JSON.stringify(protection, null, 2), 'utf8'), compress: true, modified: deps.now() })
    if (!(record instanceof Uint8Array)) return fail('archive', `The protection record could not go into the package: ${(record as ZipError).message}`)
    chunks.push(record)
  }

  chunks.push(archive.finish())
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const bytes = new Uint8Array(total)
  {
    let at = 0
    for (const chunk of chunks) {
      bytes.set(chunk, at)
      at += chunk.length
    }
  }

  report({ stage: 'verifying', category: null, filesDone, filesTotal: work.length, bytesDone, bytesTotal, message: 'Reading the package back.' })
  const verified = await verifyArchive(bytes, manifest, deps, key, protection)
  if (isExportError(verified)) return verified

  try {
    await deps.write(request.destination, bytes)
  } catch (err) {
    return fail('write', `The package was made and verified but could not be written to ${request.destination}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const complete = completeness(manifest, plan.categoryIds)
  if (plan.added.length > 0) {
    notes.push(`${plan.added.join(', ')} ${plan.added.length === 1 ? 'was' : 'were'} added because something you chose depends on ${plan.added.length === 1 ? 'it' : 'them'}.`)
  }
  if (protection === null) {
    notes.push('This package is not encrypted. Anyone who can open the file can read everything in it.')
  }

  report({ stage: 'done', category: null, filesDone, filesTotal: work.length, bytesDone, bytesTotal, message: 'Done.' })

  return {
    destination: request.destination,
    bytes: bytes.length,
    manifest,
    complete,
    addedDependencies: plan.added,
    failures,
    notes
  }
}

/**
 * Reads the finished package back and checks it.
 *
 * Through the same reader an import uses, on purpose: a verification that used a different path would prove the
 * bytes are self-consistent and not that anything can open them. When the package is encrypted, one entry is
 * actually decrypted, because a sealed entry whose key does not work is a package that is readable and useless.
 */
async function verifyArchive(
  bytes: Uint8Array,
  manifest: Manifest,
  deps: ExportDeps,
  key: Buffer | null,
  protection: PackageProtection | null
): Promise<true | ExportError> {
  const { readDirectory, readEntry } = await import('../../shared/portable/zip.ts')
  const listing = readDirectory(bytes)
  if (!Array.isArray(listing)) {
    return fail('verification', `The package was written but cannot be read back: ${(listing as ZipError).message}`)
  }
  const byPath = new Map(listing.map((one) => [one.path, one]))

  if (!byPath.has(MANIFEST_PATH)) return fail('verification', 'The package has no manifest in it.')

  for (const entry of manifest.integrity.entries) {
    const found = byPath.get(entry.path)
    if (found === undefined) {
      return fail('verification', `The manifest lists "${entry.path}" and the package does not contain it.`)
    }
    const data = readEntry(bytes, found, deps.inflateRawSync)
    if (!(data instanceof Uint8Array)) {
      return fail('verification', `"${entry.path}" could not be read back: ${(data as ZipError).message}`)
    }
    if (deps.sha256(data) !== entry.hash) {
      return fail('verification', `"${entry.path}" reads back differently from what was written. The package is not trustworthy and has not been saved.`)
    }
  }

  if (key !== null && protection !== null) {
    const first = manifest.encryption.sealed[0]
    if (first !== undefined) {
      const found = byPath.get(first)
      if (found === undefined) return fail('verification', `"${first}" is listed as sealed and is not in the package.`)
      const data = readEntry(bytes, found, deps.inflateRawSync)
      if (!(data instanceof Uint8Array)) return fail('verification', `"${first}" could not be read back.`)
      const { openEntry } = await import('./encryption.ts')
      const opened = openEntry(key, protection.packageId, first, Buffer.from(data))
      if (!Buffer.isBuffer(opened)) {
        return fail('verification', `The package is encrypted but "${first}" does not open with the key it was sealed with: ${opened.message}`)
      }
    }
  }

  return true
}
