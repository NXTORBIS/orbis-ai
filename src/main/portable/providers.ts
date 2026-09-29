/**
 * What each category of a profile knows about becoming a package, and becoming a profile again.
 *
 * One provider per category in `registry.ts`. The registry says what exists and where it lives; a provider says how
 * to read it out and put it back, which is a different question and the one with the awkward cases in it.
 *
 * ## Three awkward cases, and how they are handled
 *
 * **A file that serves several categories.** `knowledge/knowledge.db` holds Orion's memory, the Galaxy graph and the
 * search sessions — three categories, one file. Canonical package paths are therefore derived from the *storage*
 * path rather than from the category, so the file is carried once however many of those three were selected, and the
 * manifest records which categories asked for it. Copying it three times would triple the size of the package and
 * then restore the same bytes three times over the same place.
 *
 * **A file that is partly excluded.** `settings.json` holds Orion's settings, which travel, and the model provider
 * key, which is sealed by this machine's key store and is meaningless anywhere else. The file cannot be copied
 * verbatim without carrying a key-shaped value that will never work. So settings has a provider that reads the JSON
 * and removes that field by name, and the person is told to enter the key again.
 *
 * **Merging into a profile that already has things.** A category marked mergeable in the registry can be joined
 * object by object. The shape of each store is not assumed: the provider looks at what it parsed, merges by `id`
 * when it is a list of identified objects and by key when it is a map, and when it is neither it says so and falls
 * back to replacing rather than guessing at how two of them combine.
 *
 * Nothing here decides *whether* something is carried. That is the registry's table and the person's selection; a
 * provider is only asked about categories that were chosen.
 */

import { CATEGORIES, EXCLUDED, type PortableCategory } from '../../shared/portable/registry.ts'

export type ImportMode = 'replace' | 'merge'

export interface ProviderError {
  error: 'unreadable' | 'unmergeable' | 'invalid' | 'unknown-category'
  message: string
}

export const isProviderError = (value: unknown): value is ProviderError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ProviderError['error'], message: string): ProviderError => ({ error, message })

/** The outcome of restoring one file. */
export interface Restored {
  /** What to write. Null means write nothing and leave whatever is there. */
  bytes: Buffer | null
  /** How many objects came across. Null where the provider cannot count them. */
  added: number | null
  /** How many were already there and were left alone. */
  kept: number
  notes: string[]
}

/**
 * How one category becomes package bytes and becomes a profile again.
 *
 * Deliberately file-shaped rather than object-shaped, because the data on disk is files and a provider that parsed
 * every store into objects would need to know the shape of thirty of them to put a single byte back.
 */
export interface PortableProvider {
  categoryId: string
  /** Must equal the category's `schemaVersion` in the registry; a test checks that it does. */
  schemaVersion: number
  /**
   * Turns a source file into what goes in the package.
   *
   * Returning null omits the file, which is how a partly excluded store leaves its excluded part behind.
   */
  toPackage(relativePath: string, bytes: Buffer): Buffer | ProviderError | null
  /** Turns package bytes back into what belongs on disk, given whatever is there now. */
  fromPackage(relativePath: string, bytes: Buffer, mode: ImportMode, existing: Buffer | null): Restored | ProviderError
  /**
   * Brings a payload forward from an older schema version, one version at a time.
   *
   * Absent when the category has only ever had one version. A category at a version this provider does not know is
   * refused by the importer rather than read anyway.
   */
  migrate?(from: number, relativePath: string, bytes: Buffer): Buffer | ProviderError
}

// ---------------------------------------------------------------- the plain case

/**
 * Carries a file exactly as it is.
 *
 * The right provider for anything whose bytes mean the same on the other machine: a JSON store with no device-bound
 * field in it, a directory of assets, a database that is not keyed to this install. On a merge it leaves an existing
 * file alone rather than overwriting it, because "merge" for an opaque file has no other honest meaning.
 */
export function fileProvider(category: PortableCategory): PortableProvider {
  return {
    categoryId: category.id,
    schemaVersion: category.schemaVersion,
    toPackage: (_path, bytes) => bytes,
    fromPackage: (relativePath, bytes, mode, existing) => {
      if (mode === 'merge' && existing !== null) {
        return {
          bytes: null,
          added: null,
          kept: 1,
          notes: [
            `"${relativePath}" is already here and was left as it is. ${category.label} is carried as a whole file, so merging it object by object is not something this can do — replace the profile, or move this one thing across by hand.`
          ]
        }
      }
      return { bytes, added: null, kept: 0, notes: [] }
    }
  }
}

// ---------------------------------------------------------------- the partly excluded case

/**
 * Carries a JSON file with named fields removed.
 *
 * For a store that holds both portable data and something sealed by this machine's key store. The removed field is
 * named in the notes rather than dropped quietly: a setting that silently does not arrive is worse than one the
 * person was told to enter again.
 */
export function redactingJsonProvider(category: PortableCategory, remove: readonly string[]): PortableProvider {
  return {
    categoryId: category.id,
    schemaVersion: category.schemaVersion,
    toPackage: (relativePath, bytes) => {
      const parsed = parseJson(bytes)
      if (isProviderError(parsed)) return parsed
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return fail('invalid', `"${relativePath}" is not a JSON object, so the fields that must not travel cannot be found in it. Nothing is carried rather than carrying it whole.`)
      }
      const copy: Record<string, unknown> = {}
      for (const key of Object.keys(parsed as Record<string, unknown>)) {
        if (remove.includes(key)) continue
        Object.defineProperty(copy, key, {
          value: (parsed as Record<string, unknown>)[key],
          enumerable: true,
          writable: true,
          configurable: true
        })
      }
      return Buffer.from(JSON.stringify(copy, null, 2), 'utf8')
    },
    fromPackage: (relativePath, bytes, mode, existing) => {
      const incoming = parseJson(bytes)
      if (isProviderError(incoming)) return incoming
      if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
        return fail('invalid', `"${relativePath}" in the package is not a JSON object.`)
      }
      const base = existing === null ? {} : parseJson(existing)
      if (isProviderError(base)) return base
      const current = typeof base === 'object' && base !== null && !Array.isArray(base) ? (base as Record<string, unknown>) : {}
      const merged: Record<string, unknown> = {}
      // Whatever is here already goes down first, so the fields that were removed on the way out keep the values
      // this machine has for them rather than being cleared by their absence from the package.
      for (const key of Object.keys(current)) {
        Object.defineProperty(merged, key, { value: current[key], enumerable: true, writable: true, configurable: true })
      }
      for (const key of Object.keys(incoming as Record<string, unknown>)) {
        if (mode === 'merge' && Object.prototype.hasOwnProperty.call(current, key)) continue
        Object.defineProperty(merged, key, {
          value: (incoming as Record<string, unknown>)[key],
          enumerable: true,
          writable: true,
          configurable: true
        })
      }
      const kept = remove.filter((one) => Object.prototype.hasOwnProperty.call(current, one))
      return {
        bytes: Buffer.from(JSON.stringify(merged, null, 2), 'utf8'),
        added: Object.keys(incoming as Record<string, unknown>).length,
        kept: kept.length,
        notes:
          kept.length === 0
            ? [`${remove.join(', ')} ${remove.length === 1 ? 'was' : 'were'} not in the package and ${remove.length === 1 ? 'is' : 'are'} not set here either. You will be asked for ${remove.length === 1 ? 'it' : 'them'}.`]
            : [`${kept.join(', ')} already set on this machine and left alone — the package never carried ${kept.length === 1 ? 'it' : 'them'}.`]
      }
    }
  }
}

// ---------------------------------------------------------------- the mergeable case

/**
 * Carries a JSON store that can be joined object by object.
 *
 * The shape is examined rather than assumed. A list of objects each with an `id` merges by that id; an object whose
 * values are objects merges by key; anything else is reported as unmergeable and replaced instead, because two lists
 * of unidentified things have no defensible way to combine and picking one would silently lose entries.
 *
 * On a collision the existing object wins and the incoming one is counted as skipped. That direction is the one that
 * cannot lose anything the person already has on this machine.
 */
export function mergeableJsonProvider(category: PortableCategory): PortableProvider {
  return {
    categoryId: category.id,
    schemaVersion: category.schemaVersion,
    toPackage: (_path, bytes) => bytes,
    fromPackage: (relativePath, bytes, mode, existing) => {
      if (mode === 'replace' || existing === null) return { bytes, added: null, kept: 0, notes: [] }

      const incoming = parseJson(bytes)
      if (isProviderError(incoming)) return incoming
      const current = parseJson(existing)
      if (isProviderError(current)) {
        return {
          bytes,
          added: null,
          kept: 0,
          notes: [`What is here in "${relativePath}" could not be read as JSON, so there was nothing to merge into and the package's copy was used.`]
        }
      }

      const joined = join(incoming, current)
      if (isProviderError(joined)) {
        return {
          bytes,
          added: null,
          kept: 0,
          notes: [`${joined.message} "${relativePath}" was replaced rather than merged.`]
        }
      }
      return {
        bytes: Buffer.from(JSON.stringify(joined.value, null, 2), 'utf8'),
        added: joined.added,
        kept: joined.kept,
        notes:
          joined.kept === 0
            ? []
            : [`${joined.kept} ${joined.kept === 1 ? 'entry' : 'entries'} in "${relativePath}" were already here and were kept as they are; the package's versions of those were not used.`]
      }
    }
  }
}

function parseJson(bytes: Buffer): unknown | ProviderError {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch (err) {
    return fail('unreadable', err instanceof Error ? `That is not valid JSON: ${err.message}` : 'That is not valid JSON.')
  }
}

const identityOf = (one: unknown): string | null => {
  if (typeof one !== 'object' || one === null || Array.isArray(one)) return null
  const record = one as Record<string, unknown>
  for (const field of ['id', 'uuid', 'key', 'slug']) {
    const value = record[field]
    if (typeof value === 'string' && value !== '') return `${field}:${value}`
    if (typeof value === 'number' && Number.isFinite(value)) return `${field}:${value}`
  }
  return null
}

interface Joined {
  value: unknown
  added: number
  kept: number
}

/** Joins what the package holds into what is here, keeping what is here where the two collide. */
function join(incoming: unknown, current: unknown): Joined | ProviderError {
  if (Array.isArray(incoming) && Array.isArray(current)) {
    const seen = new Set<string>()
    let unidentified = 0
    for (const one of current) {
      const id = identityOf(one)
      if (id === null) unidentified += 1
      else seen.add(id)
    }
    if (unidentified > 0 && seen.size === 0) {
      return fail(
        'unmergeable',
        `These are lists of things with no id on them, so there is no way to tell an entry that is in both from two entries that merely look alike.`
      )
    }
    const out = [...current]
    let added = 0
    let kept = 0
    for (const one of incoming) {
      const id = identityOf(one)
      if (id === null) {
        // An entry with no id cannot be matched, so carrying it would either duplicate or drop it.
        kept += 1
        continue
      }
      if (seen.has(id)) {
        kept += 1
        continue
      }
      seen.add(id)
      out.push(one)
      added += 1
    }
    return { value: out, added, kept }
  }

  const bothMaps =
    typeof incoming === 'object' && incoming !== null && !Array.isArray(incoming) &&
    typeof current === 'object' && current !== null && !Array.isArray(current)

  if (bothMaps) {
    const from = incoming as Record<string, unknown>
    const here = current as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(here)) {
      Object.defineProperty(out, key, { value: here[key], enumerable: true, writable: true, configurable: true })
    }
    let added = 0
    let kept = 0
    for (const key of Object.keys(from)) {
      if (Object.prototype.hasOwnProperty.call(here, key)) {
        kept += 1
        continue
      }
      Object.defineProperty(out, key, { value: from[key], enumerable: true, writable: true, configurable: true })
      added += 1
    }
    return { value: out, added, kept }
  }

  return fail(
    'unmergeable',
    `One of these is a list and the other is not, so they are not two versions of the same store.`
  )
}

// ---------------------------------------------------------------- the registry of providers

export class PortableProviderRegistry {
  private readonly byCategory = new Map<string, PortableProvider>()

  register(provider: PortableProvider): void {
    this.byCategory.set(provider.categoryId, provider)
  }

  /** The provider for a category, or an error naming the category that has none. */
  for(categoryId: string): PortableProvider | ProviderError {
    const found = this.byCategory.get(categoryId)
    if (found === undefined) {
      return fail(
        'unknown-category',
        `Nothing knows how to carry "${categoryId}". A category in the registry with no provider is a feature that would be quietly left out of every transfer, so it is refused rather than skipped.`
      )
    }
    return found
  }

  has(categoryId: string): boolean {
    return this.byCategory.has(categoryId)
  }

  all(): readonly PortableProvider[] {
    return [...this.byCategory.values()]
  }
}

const EXCLUDED_IDS = new Set(EXCLUDED.map((one) => one.id))

/** The fields in `settings.json` that this machine's key store sealed, and that mean nothing anywhere else. */
export const REDACTED_SETTINGS_FIELDS: readonly string[] = Object.freeze(['apiKey'])

/**
 * A provider for every category that can travel.
 *
 * Chosen from the registry rather than listed here, so a category added to the registry appears in this function's
 * output and fails the guard test until somebody decides how it travels. The alternative — a hand-written list —
 * fails silently by leaving the new category out, which is the exact failure the registry exists to prevent.
 */
export function builtInProviders(): PortableProviderRegistry {
  const registry = new PortableProviderRegistry()
  for (const category of CATEGORIES) {
    if (EXCLUDED_IDS.has(category.id)) continue
    if (category.id === 'orion.settings') {
      registry.register(redactingJsonProvider(category, REDACTED_SETTINGS_FIELDS))
      continue
    }
    registry.register(category.mergeable ? mergeableJsonProvider(category) : fileProvider(category))
  }
  return registry
}

/**
 * The canonical package path for a storage path.
 *
 * Derived from the storage path, not from the category, which is what lets one file serve several categories without
 * being carried once per category. `knowledge/knowledge.db` is three categories and one file, and a package that held
 * it three times would be three times the size and would restore the same bytes over the same place three times.
 */
export const packagePathFor = (scope: 'profile' | 'app', storagePath: string): string =>
  `data/${scope}/${storagePath.replaceAll('\\', '/')}`

/** Every distinct storage path the chosen categories need, with the categories that asked for each. */
export function sourcesFor(categoryIds: readonly string[]): { scope: 'profile' | 'app'; storage: string; wantedBy: string[] }[] {
  const byPath = new Map<string, { scope: 'profile' | 'app'; storage: string; wantedBy: string[] }>()
  for (const id of categoryIds) {
    const category = CATEGORIES.find((one) => one.id === id)
    if (category === undefined) continue
    for (const storage of category.storage) {
      const key = `${category.scope}:${storage}`
      const existing = byPath.get(key)
      if (existing === undefined) byPath.set(key, { scope: category.scope, storage, wantedBy: [id] })
      else existing.wantedBy.push(id)
    }
  }
  return [...byPath.values()]
}
