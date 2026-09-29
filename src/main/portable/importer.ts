/**
 * Reading a `.orbis` package back into a profile.
 *
 * The harder half. An export that fails wastes time; an import that fails halfway can leave a profile that is
 * neither the old one nor the new one, which is the state nothing recovers from. So the whole of this is built
 * around one rule: **nothing reaches the profile until everything is ready to.**
 *
 * ## The order, and why it is that order
 *
 * 1. **Read the manifest.** Before a password, before anything is unpacked. A package from a newer Orbis, or with a
 *    category at a newer schema, is refused by looking at it.
 * 2. **Verify every hash.** Against the archive, not against the manifest's own claims about itself.
 * 3. **Unlock.** One password attempt against the protection record; a wrong one stops here having written nothing.
 * 4. **Stage.** Every file is opened, transformed by its provider and held, with the existing profile read for the
 *    merge decisions. Still nothing written.
 * 5. **Snapshot.** The existing bytes of every path about to change are kept, so the profile can be put back.
 * 6. **Commit.** The staged files are written. A failure here rolls back from the snapshot.
 * 7. **Journal.** A record on disk from before the first write until after the last, so a crash in the middle is
 *    recoverable on the next start rather than being a profile nobody can explain.
 *
 * ## What this refuses to do
 *
 * It never executes anything out of a package. A workflow, a Page or an extension arriving in an import is **data**
 * that has been written to disk, and nothing runs it because it arrived. A package is a file somebody else made.
 *
 * It never half-applies a category. A category whose files cannot all be staged is skipped whole, with the reason,
 * rather than leaving half its objects in place.
 *
 * It never guesses at a schema it does not know. A category written by a newer Orbis is refused for that category
 * alone — losing one feature's data is bad, and losing the profile because one feature moved on is worse.
 */

import {
  checkCompatibility,
  checkManifest,
  MANIFEST_PATH,
  readManifest,
  summarise,
  type Manifest,
  type Summary
} from '../../shared/portable/manifest.ts'
import { CATEGORIES, restoreOrder, type PortableCategory } from '../../shared/portable/registry.ts'
import { readDirectory, readEntry, type ZipError, type ZipListing } from '../../shared/portable/zip.ts'
import { forgetKey, isProtection, openEntry, unlockPackage, type PackageProtection } from './encryption.ts'
import { PROTECTION_PATH } from './exporter.ts'
import { builtInProviders, isProviderError, type ImportMode, type PortableProviderRegistry } from './providers.ts'

export interface ImportError {
  error:
    | 'not-a-package'
    | 'unreadable'
    | 'incompatible'
    | 'integrity'
    | 'password'
    | 'nothing-to-do'
    | 'cancelled'
    | 'staging'
    | 'commit'
  message: string
  /** For a rolled-back commit: whether the profile was put back. */
  rolledBack?: boolean
}

export const isImportError = (value: unknown): value is ImportError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ImportError['error'], message: string, rolledBack?: boolean): ImportError => ({ error, message, rolledBack })

/** Where the journal lives, relative to the profile's data directory. */
export const JOURNAL_PATH = 'import-journal.json'

export interface ImportDeps {
  read(scope: 'profile' | 'app', path: string): Promise<Buffer | null>
  write(scope: 'profile' | 'app', path: string, bytes: Buffer): Promise<void>
  remove(scope: 'profile' | 'app', path: string): Promise<void>
  exists(scope: 'profile' | 'app', path: string): Promise<boolean>
  inflateRawSync(data: Uint8Array): Uint8Array
  sha256(data: Uint8Array): string
  now(): number
  appVersion: string
}

export interface InspectResult {
  manifest: Manifest
  summary: Summary
  compatibility: ReturnType<typeof checkCompatibility>
  /** True when a password will be needed to go further. */
  encrypted: boolean
  protection: PackageProtection | null
  /** Problems that stop the import, and notes that do not. */
  blocking: string[]
  notes: string[]
}

/**
 * Looks at a package without opening it.
 *
 * Everything here is read from the unencrypted manifest, which is why the manifest carries nothing private. A
 * person gets to see what a package holds, and Orbis gets to refuse an incompatible one, before a password is typed
 * and before a single byte is decrypted.
 */
export function inspect(archive: Uint8Array, deps: ImportDeps): InspectResult | ImportError {
  const listing = readDirectory(archive)
  if (!Array.isArray(listing)) {
    return fail('unreadable', `This file cannot be read as a package: ${(listing as ZipError).message}`)
  }
  const byPath = new Map(listing.map((one) => [one.path, one]))
  const manifestEntry = byPath.get(MANIFEST_PATH)
  if (manifestEntry === undefined) {
    return fail(
      'not-a-package',
      'This is a ZIP file with no Orbis manifest in it. A renamed archive is not a profile package, and half-importing one would scatter somebody else’s files through your profile.'
    )
  }
  const manifestBytes = readEntry(archive, manifestEntry, deps.inflateRawSync)
  if (!(manifestBytes instanceof Uint8Array)) {
    return fail('unreadable', `The manifest could not be read: ${(manifestBytes as ZipError).message}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as unknown
  } catch {
    return fail('not-a-package', 'The manifest is not readable as JSON, so this is not a package Orbis wrote.')
  }

  const problems = checkManifest(raw)
  const blocking = problems.filter((one) => one.blocking).map((one) => `${one.field}: ${one.describe}`)
  if (blocking.length > 0) {
    return fail('not-a-package', `This package's manifest does not hold together: ${blocking.join(' ')}`)
  }
  const manifest = readManifest(raw)
  if (manifest === null) {
    return fail('not-a-package', 'The manifest passed its checks and still could not be read, which means the two disagree. The package is not opened.')
  }

  let protection: PackageProtection | null = null
  if (manifest.encryption.encrypted) {
    const record = byPath.get(PROTECTION_PATH)
    if (record === undefined) {
      return fail('not-a-package', 'The manifest says this package is encrypted and there is no protection record in it, so there is nothing to unlock it with.')
    }
    const bytes = readEntry(archive, record, deps.inflateRawSync)
    if (!(bytes instanceof Uint8Array)) return fail('unreadable', 'The protection record could not be read.')
    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
      if (!isProtection(parsed)) return fail('not-a-package', 'The protection record is not the shape Orbis writes.')
      protection = parsed
    } catch {
      return fail('not-a-package', 'The protection record is not readable as JSON.')
    }
  }

  const compatibility = checkCompatibility(manifest)
  return {
    manifest,
    summary: summarise(manifest),
    compatibility,
    encrypted: manifest.encryption.encrypted,
    protection,
    blocking: compatibility.importable ? [] : compatibility.problems.filter((one) => one.blocking).map((one) => `${one.field}: ${one.describe}`),
    notes: problems.filter((one) => !one.blocking).map((one) => `${one.field}: ${one.describe}`)
  }
}

/** Checks every entry against the hash the manifest recorded for it. */
export function verify(archive: Uint8Array, manifest: Manifest, deps: ImportDeps): { ok: true } | ImportError {
  const listing = readDirectory(archive)
  if (!Array.isArray(listing)) return fail('unreadable', (listing as ZipError).message)
  const byPath = new Map(listing.map((one) => [one.path, one]))

  // The entry list is hashed too, so entries cannot be taken out of it without the digest changing.
  const digest = deps.sha256(Buffer.from(JSON.stringify(manifest.integrity.entries), 'utf8'))
  if (digest !== manifest.integrity.digest) {
    return fail('integrity', 'The list of files in the manifest has been changed since the package was made. Nothing in it is trusted.')
  }

  for (const entry of manifest.integrity.entries) {
    const found = byPath.get(entry.path)
    if (found === undefined) {
      return fail('integrity', `The manifest lists "${entry.path}" and the package does not contain it. A package missing a file it claims to have is not imported.`)
    }
    const data = readEntry(archive, found, deps.inflateRawSync)
    if (!(data instanceof Uint8Array)) {
      return fail('integrity', `"${entry.path}" could not be read: ${(data as ZipError).message}`)
    }
    if (deps.sha256(data) !== entry.hash) {
      return fail('integrity', `"${entry.path}" is not the file the manifest describes. The package was damaged or altered after it was made.`)
    }
  }
  return { ok: true }
}

export interface ImportRequest {
  /** Which categories to bring in. Ones not in the package are reported, not assumed. */
  categoryIds: readonly string[]
  mode: ImportMode
  password: string | null
}

export interface CategoryOutcome {
  categoryId: string
  status: 'applied' | 'skipped' | 'failed' | 'not-in-package'
  filesWritten: number
  added: number | null
  kept: number
  notes: string[]
}

export interface ImportOutcome {
  categories: CategoryOutcome[]
  /** What the person has to do now, because some of it could not travel. */
  actions: { id: string; label: string; action: string }[]
  filesWritten: number
  notes: string[]
}

export interface ImportOptions {
  shouldCancel?(): boolean
  onProgress?(progress: { stage: 'reading' | 'staging' | 'committing' | 'done'; category: string | null; message: string }): void
}

interface Staged {
  scope: 'profile' | 'app'
  path: string
  bytes: Buffer
  categoryId: string
}

/**
 * Brings a package into the profile.
 *
 * Everything is staged before anything is written, and the bytes being replaced are kept so a failure part-way
 * through can put the profile back. The journal on disk covers the case a rollback cannot: the process dying between
 * two writes.
 */
export async function importPackage(
  archive: Uint8Array,
  request: ImportRequest,
  deps: ImportDeps,
  options: ImportOptions = {},
  providers: PortableProviderRegistry = builtInProviders()
): Promise<ImportOutcome | ImportError> {
  const report = options.onProgress ?? ((): void => undefined)
  const cancelled = (): boolean => options.shouldCancel?.() === true

  report({ stage: 'reading', category: null, message: 'Reading the package.' })
  const looked = inspect(archive, deps)
  if (isImportError(looked)) return looked
  if (!looked.compatibility.importable) {
    return fail('incompatible', looked.blocking.join(' '))
  }

  const checked = verify(archive, looked.manifest, deps)
  if (isImportError(checked)) return checked

  let key: Buffer | null = null
  if (looked.encrypted) {
    if (looked.protection === null) return fail('password', 'This package is encrypted and carries no protection record.')
    if (request.password === null || request.password === '') {
      return fail('password', 'This package is encrypted. It needs the password it was made with; Orbis has no copy of it.')
    }
    const unlocked = await unlockPackage(request.password, looked.protection)
    if (!Buffer.isBuffer(unlocked)) return fail('password', unlocked.message)
    key = unlocked
  }

  try {
    return await apply(archive, request, deps, options, providers, looked, key, report, cancelled)
  } finally {
    forgetKey(key)
  }
}

async function apply(
  archive: Uint8Array,
  request: ImportRequest,
  deps: ImportDeps,
  _options: ImportOptions,
  providers: PortableProviderRegistry,
  looked: InspectResult,
  key: Buffer | null,
  report: NonNullable<ImportOptions['onProgress']>,
  cancelled: () => boolean
): Promise<ImportOutcome | ImportError> {
  const listing = readDirectory(archive)
  if (!Array.isArray(listing)) return fail('unreadable', (listing as ZipError).message)
  const byPath = new Map<string, ZipListing>(listing.map((one) => [one.path, one]))

  const inPackage = new Set(looked.manifest.categories.filter((one) => one.disposition !== 'excluded').map((one) => one.id))
  const wanted = [...new Set(request.categoryIds)]
  const outcomes = new Map<string, CategoryOutcome>()
  const outcomeFor = (id: string): CategoryOutcome => {
    const existing = outcomes.get(id)
    if (existing !== undefined) return existing
    const made: CategoryOutcome = { categoryId: id, status: 'applied', filesWritten: 0, added: null, kept: 0, notes: [] }
    outcomes.set(id, made)
    return made
  }

  for (const id of wanted) {
    if (!inPackage.has(id)) {
      const record = looked.manifest.categories.find((one) => one.id === id)
      const one = outcomeFor(id)
      one.status = 'not-in-package'
      one.notes.push(
        record === undefined
          ? 'This package does not contain that at all.'
          : `The package records this as ${record.disposition}: ${record.note}`
      )
    }
  }

  // Restore in dependency order, so a category that needs another is written after it.
  const carriable = wanted.filter((one) => inPackage.has(one))
  if (carriable.length === 0) {
    return fail('nothing-to-do', 'Nothing chosen is in this package, so there is nothing to bring in.')
  }
  const ordered = restoreOrder(carriable)
  if ('error' in ordered) {
    return fail('staging', `These categories depend on each other in a loop and cannot be ordered: ${ordered.cycle.join(' → ')}.`)
  }

  // ---- stage
  report({ stage: 'staging', category: null, message: 'Preparing everything before anything is written.' })
  const staged: Staged[] = []

  for (const id of ordered.order) {
    if (cancelled()) return fail('cancelled', 'The import was stopped before anything was written.')
    const category = CATEGORIES.find((one) => one.id === id)
    if (category === undefined) continue
    const record = looked.manifest.categories.find((one) => one.id === id)
    if (record === undefined) continue

    const outcome = outcomeFor(id)
    const provider = providers.for(id)
    if (isProviderError(provider)) {
      outcome.status = 'failed'
      outcome.notes.push(provider.message)
      continue
    }
    if (record.schemaVersion > provider.schemaVersion) {
      outcome.status = 'failed'
      outcome.notes.push(
        `This package holds ${category.label} at version ${record.schemaVersion} and this Orbis reads up to ${provider.schemaVersion}. It is left out rather than read as if it were the older shape — the rest of the import is unaffected.`
      )
      continue
    }

    const forThis: Staged[] = []
    let refused = false
    for (const path of record.paths) {
      const entry = byPath.get(path)
      if (entry === undefined) {
        outcome.status = 'failed'
        outcome.notes.push(`"${path}" is listed for this and is not in the package.`)
        refused = true
        break
      }
      const rawBytes = readEntry(archive, entry, deps.inflateRawSync)
      if (!(rawBytes instanceof Uint8Array)) {
        outcome.status = 'failed'
        outcome.notes.push(`"${path}" could not be read: ${(rawBytes as ZipError).message}`)
        refused = true
        break
      }
      let content: Buffer = Buffer.from(rawBytes)
      if (looked.manifest.encryption.sealed.includes(path)) {
        if (key === null || looked.protection === null) {
          outcome.status = 'failed'
          outcome.notes.push(`"${path}" is sealed and there is no key for it.`)
          refused = true
          break
        }
        const opened = openEntry(key, looked.protection.packageId, path, content)
        if (!Buffer.isBuffer(opened)) {
          outcome.status = 'failed'
          outcome.notes.push(opened.message)
          refused = true
          break
        }
        content = opened
      }

      const storagePath = storagePathOf(path, category.scope)
      if (storagePath === null) {
        outcome.status = 'failed'
        outcome.notes.push(`"${path}" is not where this package says its data lives, so it is not written anywhere.`)
        refused = true
        break
      }
      const existing = await deps.read(category.scope, storagePath)
      const restored = provider.fromPackage(storagePath, content, request.mode, existing)
      if (isProviderError(restored)) {
        outcome.status = 'failed'
        outcome.notes.push(restored.message)
        refused = true
        break
      }
      for (const note of restored.notes) if (!outcome.notes.includes(note)) outcome.notes.push(note)
      if (restored.added !== null) outcome.added = (outcome.added ?? 0) + restored.added
      outcome.kept += restored.kept
      if (restored.bytes === null) continue
      forThis.push({ scope: category.scope, path: storagePath, bytes: restored.bytes, categoryId: id })
    }

    if (refused) {
      // A category is applied whole or not at all. Half of one is a state nothing can explain afterwards.
      outcome.notes.push('Nothing from this was written: a category is brought in whole or left alone.')
      continue
    }
    if (forThis.length === 0 && outcome.status === 'applied') {
      outcome.status = 'skipped'
      if (outcome.notes.length === 0) outcome.notes.push('Everything in this was already here.')
    }
    staged.push(...forThis)
  }

  if (cancelled()) return fail('cancelled', 'The import was stopped before anything was written.')
  if (staged.length === 0) {
    return {
      categories: [...outcomes.values()],
      actions: actionsFor([...outcomes.values()]),
      filesWritten: 0,
      notes: ['Nothing was written. Everything chosen was either already here, not in the package, or could not be brought in.']
    }
  }

  // ---- snapshot
  const snapshot: { scope: 'profile' | 'app'; path: string; before: Buffer | null }[] = []
  for (const one of staged) {
    snapshot.push({ scope: one.scope, path: one.path, before: await deps.read(one.scope, one.path) })
  }

  // ---- journal, then commit
  const journal = {
    startedAt: deps.now(),
    appVersion: deps.appVersion,
    packageId: looked.manifest.packageId,
    mode: request.mode,
    paths: staged.map((one) => ({ scope: one.scope, path: one.path })),
    finished: false
  }
  await deps.write('profile', JOURNAL_PATH, Buffer.from(JSON.stringify(journal, null, 2), 'utf8'))

  report({ stage: 'committing', category: null, message: `Writing ${staged.length} file${staged.length === 1 ? '' : 's'}.` })
  let written = 0
  try {
    for (const one of staged) {
      await deps.write(one.scope, one.path, one.bytes)
      written += 1
      outcomeFor(one.categoryId).filesWritten += 1
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    const rolledBack = await rollback(snapshot.slice(0, written), deps)
    await deps.write('profile', JOURNAL_PATH, Buffer.from(JSON.stringify({ ...journal, finished: true, rolledBack }, null, 2), 'utf8'))
    return fail(
      'commit',
      rolledBack
        ? `Writing stopped at file ${written + 1} of ${staged.length} (${why}), and the profile has been put back as it was.`
        : `Writing stopped at file ${written + 1} of ${staged.length} (${why}), and putting the profile back also failed. The journal at ${JOURNAL_PATH} lists what was being changed.`,
      rolledBack
    )
  }

  await deps.write('profile', JOURNAL_PATH, Buffer.from(JSON.stringify({ ...journal, finished: true, rolledBack: false }, null, 2), 'utf8'))
  report({ stage: 'done', category: null, message: 'Done.' })

  const results = [...outcomes.values()]
  return {
    categories: results,
    actions: actionsFor(results),
    filesWritten: written,
    notes: notesFor(results, request.mode)
  }
}

/** Puts back what was there. Returns false when any of it could not be restored. */
async function rollback(
  snapshot: readonly { scope: 'profile' | 'app'; path: string; before: Buffer | null }[],
  deps: ImportDeps
): Promise<boolean> {
  let allBack = true
  for (const one of snapshot) {
    try {
      if (one.before === null) await deps.remove(one.scope, one.path)
      else await deps.write(one.scope, one.path, one.before)
    } catch {
      allBack = false
    }
  }
  return allBack
}

/** The storage path a package path refers to, or null when it is not under this scope's data at all. */
export function storagePathOf(packagePath: string, scope: 'profile' | 'app'): string | null {
  const prefix = `data/${scope}/`
  if (!packagePath.startsWith(prefix)) return null
  const rest = packagePath.slice(prefix.length)
  if (rest === '' || rest.includes('..') || rest.startsWith('/')) return null
  return rest
}

function actionsFor(outcomes: readonly CategoryOutcome[]): { id: string; label: string; action: string }[] {
  const applied = outcomes.filter((one) => one.status === 'applied').map((one) => one.categoryId)
  const out: { id: string; label: string; action: string }[] = []
  for (const category of CATEGORIES) {
    if (!category.requiresReauthentication) continue
    if (!applied.includes(category.id) && !dependsOnApplied(category, applied)) continue
    out.push({ id: category.id, label: category.label, action: category.userAction ?? 'Sign in again.' })
  }
  return out
}

const dependsOnApplied = (category: PortableCategory, applied: readonly string[]): boolean =>
  category.dependsOn.some((one) => applied.includes(one))

function notesFor(outcomes: readonly CategoryOutcome[], mode: ImportMode): string[] {
  const notes: string[] = []
  const failed = outcomes.filter((one) => one.status === 'failed')
  const absent = outcomes.filter((one) => one.status === 'not-in-package')
  if (failed.length > 0) {
    notes.push(`${failed.length} ${failed.length === 1 ? 'category' : 'categories'} could not be brought in and ${failed.length === 1 ? 'was' : 'were'} left alone entirely: ${failed.map((one) => one.categoryId).join(', ')}.`)
  }
  if (absent.length > 0) {
    notes.push(`${absent.map((one) => one.categoryId).join(', ')} ${absent.length === 1 ? 'was' : 'were'} asked for and ${absent.length === 1 ? 'is' : 'are'} not in this package.`)
  }
  if (mode === 'merge') {
    const kept = outcomes.reduce((total, one) => total + one.kept, 0)
    if (kept > 0) {
      notes.push(`${kept} ${kept === 1 ? 'thing' : 'things'} were already here and were kept as they are. Merging never overwrites what this profile already had.`)
    }
  }
  notes.push('Nothing from this package has been run. Workflows, Pages and extensions that arrived are data on disk until you open them.')
  return notes
}

// ---------------------------------------------------------------- crash recovery

export interface Recovery {
  /** True when an import was under way and never finished. */
  interrupted: boolean
  startedAt: number | null
  packageId: string | null
  /** The paths that were being changed, so the person can be told which parts of the profile to check. */
  paths: { scope: string; path: string }[]
  why: string
}

/**
 * Whether the last import finished.
 *
 * Read on start. A journal that exists and is not marked finished means the process died between two writes, which
 * no in-memory rollback could have covered. There is nothing to undo automatically at that point — the safe copy
 * was in memory and is gone — so this reports what was in flight rather than guessing at repairs.
 */
export async function checkRecovery(deps: ImportDeps): Promise<Recovery> {
  const bytes = await deps.read('profile', JOURNAL_PATH)
  if (bytes === null) {
    return { interrupted: false, startedAt: null, packageId: null, paths: [], why: 'No import was under way.' }
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
  } catch {
    return {
      interrupted: true,
      startedAt: null,
      packageId: null,
      paths: [],
      why: 'There is an import journal and it cannot be read, which means an import was interrupted. Which files it had reached is not recoverable from it.'
    }
  }
  if (parsed.finished === true) {
    return { interrupted: false, startedAt: null, packageId: null, paths: [], why: 'The last import finished.' }
  }
  const paths = Array.isArray(parsed.paths) ? (parsed.paths as { scope: string; path: string }[]) : []
  return {
    interrupted: true,
    startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : null,
    packageId: typeof parsed.packageId === 'string' ? parsed.packageId : null,
    paths,
    why: `An import began and never finished. It was part-way through writing ${paths.length} file${paths.length === 1 ? '' : 's'}, so some of those hold the package's version and some hold what was here before. Import the package again to finish it, or check the listed files.`
  }
}

/** Clears the journal once the person has been told. */
export async function clearRecovery(deps: ImportDeps): Promise<void> {
  if (await deps.exists('profile', JOURNAL_PATH)) await deps.remove('profile', JOURNAL_PATH)
}
