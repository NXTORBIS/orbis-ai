/**
 * The register of Pages: what exists, where it lives, and how it is found.
 *
 * One registry for every Page, whatever domain it belongs to. A physics Page and a finance Page are the same kind of
 * object here, because the alternative -- a registry per subject -- means every question about Pages has to be asked in
 * several places and the answers eventually disagree.
 *
 * This is the authority on identity. A Page exists because it is registered; search, discovery and the browser all read
 * from here rather than keeping lists of their own. The search index in particular is *derived*: if it and the register
 * ever disagree, the register is right and the index is stale.
 *
 * ## Resolving an address is a security operation
 *
 * `resolve` is the function a URL from the address bar reaches. So it checks the profile before it answers: a Page that
 * belongs to another profile resolves as *not found*, with the same message as a Page that never existed. Saying "that
 * exists but is not yours" tells somebody what is in another profile, which is exactly what profile isolation is for.
 *
 * Pure, and immutable: every mutating function returns a new state rather than editing the one it was given. Persisting
 * it is the main process's job; `now` and the id generator are always passed in, so every test is deterministic.
 */

import {
  canonicalPageAddress,
  compareVersions,
  isAddressProblem,
  pageIdentity,
  parsePageAddress,
  uniqueSlug,
  versionToText,
  type PageAddress,
  type PageIdentity,
  type SlugAlias,
  type PageVersion
} from './identity.ts'
import { capabilityChanges, type PageTrust, type CapabilityChange } from './capabilities.ts'
import {
  compatibility,
  manifestErrors,
  readManifest,
  searchMetadataChanged,
  type Compatibility,
  type ManifestProblem,
  type PageManifest
} from './manifest.ts'

// ---------------------------------------------------------------- state

/**
 * Where a Page is in its life.
 *
 * `needs-review` is the important one: a Page that has been updated to ask for more than it did is not available and not
 * broken. It is waiting for somebody to look, and it says so rather than silently running with the old permissions or
 * silently acquiring the new ones.
 */
export type PageStatus = 'available' | 'archived' | 'needs-review' | 'incompatible' | 'blocked'

export interface RegisteredPage {
  manifest: PageManifest
  identity: PageIdentity
  status: PageStatus
  trust: PageTrust
  installedAt: number
  updatedAt: number
  /** Local, for ranking and for a recents list. Never sent anywhere. */
  lastOpenedAt: number | null
  openCount: number
  favourite: boolean
  /** Why it is not available, when it is not. */
  note: string
}

export interface PageRegistry {
  readonly pages: readonly RegisteredPage[]
  /** Addresses that used to point somewhere, so a rename does not break every link. */
  readonly aliases: readonly SlugAlias[]
}

export const emptyRegistry = (): PageRegistry => Object.freeze({ pages: [], aliases: [] })

const replacePages = (state: PageRegistry, pages: RegisteredPage[], aliases = state.aliases): PageRegistry =>
  Object.freeze({ pages: Object.freeze(pages), aliases: Object.freeze([...aliases]) })

export const pageById = (state: PageRegistry, pageId: string): RegisteredPage | null =>
  state.pages.find((one) => one.identity.pageId === pageId) ?? null

export const pageBySlug = (state: PageRegistry, slug: string): RegisteredPage | null =>
  state.pages.find((one) => one.identity.slug === slug) ?? null

// ---------------------------------------------------------------- who may see what

/**
 * Whether a Page is visible to a profile.
 *
 * A Page with no profile is one Orbis ships and everybody has. Anything else belongs to exactly one profile, and no other
 * profile may see that it exists.
 */
export const visibleTo = (page: RegisteredPage, profileId: string | null): boolean =>
  page.identity.profileId === null || page.identity.profileId === profileId

// ---------------------------------------------------------------- registering

export type RegisterError =
  | { error: 'invalid-manifest'; problems: ManifestProblem[]; message: string }
  | { error: 'id-taken'; message: string }
  | { error: 'slug-taken'; message: string; suggestion: string }

export interface RegisterOptions {
  trust: PageTrust
  profileId: string | null
  now: number
  /** Whether to take the next free address rather than refusing when the preferred one is taken. */
  renameOnCollision?: boolean
}

export interface Registered {
  state: PageRegistry
  page: RegisteredPage
  warnings: ManifestProblem[]
}

/**
 * A Page added to the register.
 *
 * Validates before it stores. A manifest that does not validate is refused outright rather than stored in a broken state,
 * because a broken registry entry is worse than a missing Page: the Page appears in lists, gets indexed, and fails when
 * somebody opens it.
 *
 * A taken address is refused by default rather than silently renamed. Silently renaming means the Page's author wrote one
 * address and got another, and found out when a link did not work. `renameOnCollision` exists for the importer, where
 * refusing would mean the import fails entirely.
 */
export function registerPage(state: PageRegistry, raw: unknown, options: RegisterOptions): Registered | RegisterError {
  const read = readManifest(raw)
  if ('problems' in read) {
    return {
      error: 'invalid-manifest',
      problems: read.problems,
      message: `That Page cannot be registered: ${manifestErrors(read.problems)[0]?.message ?? 'its manifest is not valid.'}`
    }
  }
  let { manifest } = read

  if (pageById(state, manifest.pageId)) {
    return { error: 'id-taken', message: 'A Page with that id is already registered.' }
  }

  if (pageBySlug(state, manifest.slug)) {
    const suggestion = uniqueSlug(
      manifest.slug,
      state.pages.map((one) => one.identity.slug)
    )
    if (options.renameOnCollision !== true) {
      return {
        error: 'slug-taken',
        message: `The address "${manifest.slug}" is already in use.`,
        suggestion
      }
    }
    manifest = { ...manifest, slug: suggestion }
  }

  const page: RegisteredPage = {
    manifest,
    identity: pageIdentity({
      pageId: manifest.pageId,
      slug: manifest.slug,
      version: manifest.version,
      owner: manifest.owner,
      // A Page Orbis ships belongs to no profile; anything else belongs to exactly one.
      profileId: manifest.owner === 'system' ? null : options.profileId
    }),
    status: 'available',
    trust: options.trust,
    installedAt: options.now,
    updatedAt: options.now,
    lastOpenedAt: null,
    openCount: 0,
    favourite: false,
    note: ''
  }

  return { state: replacePages(state, [...state.pages, page]), page, warnings: read.warnings }
}

// ---------------------------------------------------------------- updating

export type UpdateError =
  | { error: 'not-found'; message: string }
  | { error: 'invalid-manifest'; problems: ManifestProblem[]; message: string }
  | { error: 'different-page'; message: string }
  | { error: 'not-newer'; message: string }
  | { error: 'slug-taken'; message: string; suggestion: string }

export interface Updated {
  state: PageRegistry
  page: RegisteredPage
  /** What changed in what the Page asks for. Drives whether a person has to look. */
  changes: CapabilityChange
  /** Whether the Page needs re-indexing, so the caller does not have to work it out. */
  reindex: boolean
  warnings: ManifestProblem[]
}

/**
 * A Page replaced by a newer version of itself.
 *
 * Three refusals worth naming:
 *
 * - A manifest with a different `pageId` is a different Page, not an update. Accepting it would let an update replace one
 *   Page with another while keeping its permissions and its address.
 * - A version that is not newer is refused, because "update" with no version change is how two different pieces of code
 *   come to share a version number -- and a grant is tied to a version.
 * - An update that asks for more goes to `needs-review` rather than becoming available. This is the single most likely
 *   route to acquiring permissions quietly, so it is the one closed hardest.
 */
export function updatePage(state: PageRegistry, pageId: string, raw: unknown, now: number): Updated | UpdateError {
  const existing = pageById(state, pageId)
  if (!existing) return { error: 'not-found', message: 'There is no Page with that id.' }

  const read = readManifest(raw)
  if ('problems' in read) {
    return {
      error: 'invalid-manifest',
      problems: read.problems,
      message: `That update cannot be applied: ${manifestErrors(read.problems)[0]?.message ?? 'its manifest is not valid.'}`
    }
  }
  const manifest = read.manifest

  if (manifest.pageId !== pageId) {
    return { error: 'different-page', message: 'That manifest is for a different Page, so it is not an update.' }
  }
  if (compareVersions(manifest.version, existing.manifest.version) <= 0) {
    return {
      error: 'not-newer',
      message: `An update has to have a newer version than ${versionToText(existing.manifest.version)}.`
    }
  }

  const aliases = [...state.aliases]
  if (manifest.slug !== existing.identity.slug) {
    const clash = state.pages.find((one) => one.identity.slug === manifest.slug && one.identity.pageId !== pageId)
    if (clash) {
      return {
        error: 'slug-taken',
        message: `The address "${manifest.slug}" is already in use.`,
        suggestion: uniqueSlug(manifest.slug, state.pages.map((one) => one.identity.slug))
      }
    }
    // The old address keeps working. This is the difference between renaming a Page and breaking every link to it.
    aliases.push({ from: existing.identity.slug, pageId, changedAt: now })
  }

  const changes = capabilityChanges(existing.manifest.capabilities, manifest.capabilities)

  const page: RegisteredPage = {
    ...existing,
    manifest,
    identity: pageIdentity({
      pageId,
      slug: manifest.slug,
      version: manifest.version,
      owner: manifest.owner,
      profileId: existing.identity.profileId
    }),
    // Not available until somebody has looked at what it now wants.
    status: changes.needsReview ? 'needs-review' : existing.status === 'needs-review' ? 'available' : existing.status,
    note: changes.needsReview ? changes.describe : '',
    updatedAt: now
  }

  return {
    state: replacePages(
      state,
      state.pages.map((one) => (one.identity.pageId === pageId ? page : one)),
      aliases
    ),
    page,
    changes,
    reindex: searchMetadataChanged(existing.manifest, manifest),
    warnings: read.warnings
  }
}

/** A Page whose new permissions have been accepted, made available again. */
export function approveUpdate(state: PageRegistry, pageId: string): PageRegistry {
  return replacePages(
    state,
    state.pages.map((one) =>
      one.identity.pageId === pageId && one.status === 'needs-review' ? { ...one, status: 'available', note: '' } : one
    )
  )
}

// ---------------------------------------------------------------- lifecycle

/** A Page put away. It keeps its identity, its address and its saved work, and stops appearing in ordinary lists. */
export function archivePage(state: PageRegistry, pageId: string, why = ''): PageRegistry {
  return replacePages(
    state,
    state.pages.map((one) => (one.identity.pageId === pageId ? { ...one, status: 'archived', note: why } : one))
  )
}

export function restorePage(state: PageRegistry, pageId: string): PageRegistry {
  return replacePages(
    state,
    state.pages.map((one) => (one.identity.pageId === pageId && one.status === 'archived' ? { ...one, status: 'available', note: '' } : one))
  )
}

/**
 * A Page removed from the register.
 *
 * Removes the entry and the aliases that pointed at it. The Page's saved work is a separate thing in a separate store,
 * and deleting it is a separate decision -- so this never touches it, and the caller has to ask for that explicitly.
 *
 * A Page Orbis ships cannot be deleted this way; it is part of the build, and removing the entry would only make it come
 * back at the next start looking like a new Page.
 */
export function deletePage(state: PageRegistry, pageId: string): { state: PageRegistry; deleted: boolean; message: string } {
  const existing = pageById(state, pageId)
  if (!existing) return { state, deleted: false, message: 'There is no Page with that id.' }
  if (existing.manifest.owner === 'system') {
    return { state, deleted: false, message: 'That Page is part of Orbis and cannot be removed.' }
  }
  return {
    state: replacePages(
      state,
      state.pages.filter((one) => one.identity.pageId !== pageId),
      state.aliases.filter((one) => one.pageId !== pageId)
    ),
    deleted: true,
    message: `"${existing.manifest.title}" was removed. Anything you saved in it is still there.`
  }
}

/** A Page marked as unopenable in this build, with the reason from the compatibility check. */
export function markCompatibility(state: PageRegistry, pageId: string, result: Compatibility): PageRegistry {
  return replacePages(
    state,
    state.pages.map((one) => {
      if (one.identity.pageId !== pageId) return one
      if (result.canOpen) return one.status === 'incompatible' ? { ...one, status: 'available', note: '' } : one
      return { ...one, status: 'incompatible', note: result.message }
    })
  )
}

/** Local usage, for ranking and a recents list. */
export function recordOpen(state: PageRegistry, pageId: string, now: number): PageRegistry {
  return replacePages(
    state,
    state.pages.map((one) =>
      one.identity.pageId === pageId ? { ...one, lastOpenedAt: now, openCount: Math.min(1e9, one.openCount + 1) } : one
    )
  )
}

export function setFavourite(state: PageRegistry, pageId: string, favourite: boolean): PageRegistry {
  return replacePages(
    state,
    state.pages.map((one) => (one.identity.pageId === pageId ? { ...one, favourite } : one))
  )
}

// ---------------------------------------------------------------- resolving an address

export type ResolveFailure =
  | { found: false; reason: 'bad-address'; message: string }
  | { found: false; reason: 'not-found'; message: string }
  | { found: false; reason: 'unavailable'; message: string; page: RegisteredPage }

export interface Resolved {
  found: true
  page: RegisteredPage
  address: PageAddress
  /** The address that was asked for, when it was an old one that redirected here. */
  redirectedFrom: string | null
  /** Where the browser should actually be, which is the canonical address plus whatever the Page needs. */
  canonicalUrl: string
}

export type Resolution = Resolved | ResolveFailure

/**
 * An address turned into a Page.
 *
 * The order matters and is deliberate:
 *
 * 1. Read the address. A malformed one never reaches the register at all.
 * 2. Find the Page -- by current address, then by an old one.
 * 3. Check the profile. A Page belonging to another profile is *not found*, with the same words as one that never
 *    existed, because a different message would say what is in another profile.
 * 4. Only then, report a Page that exists and is not currently openable.
 */
export function resolve(state: PageRegistry, url: string, profileId: string | null): Resolution {
  const address = parsePageAddress(url)
  if (isAddressProblem(address)) {
    return { found: false, reason: 'bad-address', message: address.message }
  }

  const notFound: ResolveFailure = {
    found: false,
    reason: 'not-found',
    message: `There is no Orbis Page at "${address.slug}".`
  }

  let page = pageBySlug(state, address.slug)
  let redirectedFrom: string | null = null
  if (!page) {
    // An address that used to be a Page's. The most recent rename wins, so a slug reused twice lands on the latest.
    const alias = [...state.aliases].filter((one) => one.from === address.slug).sort((a, b) => b.changedAt - a.changedAt)[0]
    if (alias) {
      const target = pageById(state, alias.pageId)
      if (target) {
        page = target
        redirectedFrom = canonicalPageAddress(address.slug)
      }
    }
  }
  if (!page) return notFound

  // Deliberately the same answer as never having existed.
  if (!visibleTo(page, profileId)) return notFound

  if (page.status !== 'available') {
    return {
      found: false,
      reason: 'unavailable',
      message:
        page.note ||
        (page.status === 'archived'
          ? `"${page.manifest.title}" has been archived.`
          : page.status === 'needs-review'
            ? `"${page.manifest.title}" has been updated and is waiting to be checked.`
            : page.status === 'blocked'
              ? `"${page.manifest.title}" has been blocked.`
              : `"${page.manifest.title}" cannot open in this version of Orbis.`),
      page
    }
  }

  return {
    found: true,
    page,
    address: { ...address, slug: page.identity.slug },
    redirectedFrom,
    canonicalUrl: page.identity.canonicalUrl
  }
}

/** Whether a Page can be opened right now, with everything checked in one call. */
export function canOpen(
  state: PageRegistry,
  url: string,
  profileId: string | null,
  engines: Readonly<Record<string, PageVersion>> = {}
): Resolution {
  const resolved = resolve(state, url, profileId)
  if (!resolved.found) return resolved
  const fit = compatibility(resolved.page.manifest, engines)
  if (!fit.canOpen) {
    return { found: false, reason: 'unavailable', message: fit.message, page: resolved.page }
  }
  return resolved
}

// ---------------------------------------------------------------- listing

export interface ListFilter {
  profileId: string | null
  status?: PageStatus | 'any'
  /** A category prefix. `science` matches `science.physics.mechanics`. */
  category?: string
  tag?: string
  kind?: string
  favourite?: boolean
  offline?: boolean
  owner?: PageManifest['owner']
}

/** Whether a category path is inside another, compared segment by segment so `science` never matches `sciencefiction`. */
export function categoryContains(parent: string, child: string): boolean {
  if (parent === child) return true
  return child.startsWith(`${parent}.`)
}

export function listPages(state: PageRegistry, filter: ListFilter): RegisteredPage[] {
  const wanted = filter.status ?? 'available'
  return state.pages.filter((page) => {
    if (!visibleTo(page, filter.profileId)) return false
    if (wanted !== 'any' && page.status !== wanted) return false
    if (filter.category && !page.manifest.categories.some((one) => categoryContains(filter.category!, one))) return false
    if (filter.tag && !page.manifest.tags.includes(filter.tag)) return false
    if (filter.kind && page.manifest.kind !== filter.kind) return false
    if (filter.favourite !== undefined && page.favourite !== filter.favourite) return false
    if (filter.offline !== undefined && page.manifest.offline !== filter.offline) return false
    if (filter.owner && page.manifest.owner !== filter.owner) return false
    return true
  })
}

/** Pages most recently opened, newest first. Never includes one that has not been opened. */
export function recentPages(state: PageRegistry, profileId: string | null, limit = 10): RegisteredPage[] {
  return listPages(state, { profileId })
    .filter((page) => page.lastOpenedAt !== null)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, Math.max(0, limit))
}

export interface CategoryNode {
  path: string
  name: string
  /** Pages filed directly at this path. */
  count: number
  /** Pages at this path or anywhere below it. */
  total: number
  children: CategoryNode[]
}

/**
 * The categories that actually have Pages in them, as a tree.
 *
 * Built from what is registered rather than from a fixed taxonomy, so an empty category never appears. A category browser
 * showing empty shelves is a category browser that looks broken.
 */
export function categoryTree(state: PageRegistry, profileId: string | null): CategoryNode[] {
  const pages = listPages(state, { profileId })
  const direct = new Map<string, number>()
  for (const page of pages) {
    for (const category of page.manifest.categories) direct.set(category, (direct.get(category) ?? 0) + 1)
  }

  // Every ancestor of every used category, so `science.physics.mechanics` creates `science` and `science.physics` too.
  const paths = new Set<string>()
  for (const path of direct.keys()) {
    const parts = path.split('.')
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('.'))
  }

  const nodeFor = (path: string): CategoryNode => {
    const parts = path.split('.')
    const children = [...paths]
      .filter((other) => other.startsWith(`${path}.`) && other.split('.').length === parts.length + 1)
      .sort()
      .map(nodeFor)
    const count = direct.get(path) ?? 0
    const total = pages.filter((page) => page.manifest.categories.some((one) => categoryContains(path, one))).length
    return { path, name: parts[parts.length - 1].replace(/-/g, ' '), count, total, children }
  }

  return [...paths]
    .filter((path) => !path.includes('.'))
    .sort()
    .map(nodeFor)
}

/** Every tag in use, with how many Pages have it, commonest first. */
export function tagCounts(state: PageRegistry, profileId: string | null): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const page of listPages(state, { profileId })) {
    for (const tag of page.manifest.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
}

// ---------------------------------------------------------------- search

export interface PageSearchResult {
  page: RegisteredPage
  /** Higher is more relevant. Comparable within one search and meaningless between two. */
  score: number
  /** Which signals fired, so a ranking can be explained rather than trusted. */
  matched: string[]
}

export interface SearchOptions {
  profileId: string | null
  limit?: number
  /** Only Pages that work with no network. */
  offlineOnly?: boolean
  category?: string
}

/** Words from a query, lower-cased, with the very short ones kept because `pi` and `x` are real searches. */
const words = (text: string): string[] =>
  String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((word) => word !== '')

/**
 * How far apart two short words are, capped.
 *
 * Only used for typo tolerance on a whole word, and only when the word is long enough that a single edit is more likely a
 * typo than a different word. `cat` and `car` are not the same search.
 */
function editDistance(a: string, b: string, cap = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = current
    if (Math.min(...current) > cap) return cap + 1
  }
  return previous[b.length]
}

/**
 * Pages matching a query, ranked.
 *
 * The weights are chosen so that what a Page *is* outranks what it merely mentions: an exact title beats a keyword, and a
 * keyword beats a word buried in a description. That ordering is the whole of why a keyword list has a length cap -- a
 * Page cannot climb by listing more, only by being the thing that was asked for.
 *
 * Every result carries the signals that fired. A ranking nobody can explain is a ranking nobody can fix.
 */
export function searchPages(state: PageRegistry, query: string, options: SearchOptions): PageSearchResult[] {
  const text = String(query ?? '').trim().toLowerCase()
  if (text === '') return []
  const terms = words(text)
  if (terms.length === 0) return []

  const candidates = listPages(state, { profileId: options.profileId, category: options.category }).filter((page) =>
    options.offlineOnly === true ? page.manifest.offline : true
  )

  const results: PageSearchResult[] = []
  for (const page of candidates) {
    const manifest = page.manifest
    const title = manifest.title.toLowerCase()
    const titleWords = words(title)
    const matched: string[] = []
    let score = 0

    if (title === text) {
      score += 1000
      matched.push('exact title')
    } else if (title.startsWith(text)) {
      score += 500
      matched.push('title starts with')
    } else if (title.includes(text)) {
      score += 300
      matched.push('title contains')
    }

    const aliasHit = manifest.search.aliases.find((one) => one.toLowerCase() === text)
    if (aliasHit) {
      score += 400
      matched.push('another name for it')
    }

    // Whole-word hits in the title, which is the strongest per-word signal.
    const titleWordHits = terms.filter((term) => titleWords.includes(term)).length
    if (titleWordHits > 0) {
      score += 120 * titleWordHits
      matched.push(`${titleWordHits} word${titleWordHits === 1 ? '' : 's'} in the name`)
    }

    const keywordHits = terms.filter((term) => manifest.search.keywords.includes(term)).length
    if (keywordHits > 0) {
      score += 80 * keywordHits
      matched.push('keyword')
    }

    const tagHits = terms.filter((term) => manifest.tags.includes(term)).length
    if (tagHits > 0) {
      score += 60 * tagHits
      matched.push('tag')
    }

    // What somebody is trying to do -- `simulate`, `convert` -- which is how a tool-seeking search finds a tool.
    const intentHits = terms.filter((term) => manifest.search.intents.includes(term)).length
    if (intentHits > 0) {
      score += 70 * intentHits
      matched.push('what you want to do')
    }

    const categoryHits = terms.filter((term) =>
      manifest.categories.some((category) => category.split('.').includes(term))
    ).length
    if (categoryHits > 0) {
      score += 40 * categoryHits
      matched.push('subject')
    }

    if (manifest.kind === text || terms.includes(manifest.kind)) {
      score += 50
      matched.push('kind of Page')
    }

    const haystack = `${manifest.description} ${manifest.search.summary}`.toLowerCase()
    const proseHits = terms.filter((term) => new RegExp(`\\b${term.replace(/[+]/g, '\\+')}`).test(haystack)).length
    if (proseHits > 0) {
      score += 15 * proseHits
      matched.push('description')
    }

    // Typo tolerance, last and cheapest, and only for words long enough that one edit is more likely a slip than a
    // different word.
    if (score === 0) {
      const near = terms.filter(
        (term) => term.length >= 5 && [...titleWords, ...manifest.search.keywords, ...manifest.tags].some((other) => editDistance(term, other) <= 1)
      ).length
      if (near > 0) {
        score += 25 * near
        matched.push('close spelling')
      }
    }

    if (score === 0) continue

    // Context, which nudges rather than decides. A favourite is a real signal; an open count is not popularity and is
    // never presented as one.
    if (page.favourite) {
      score += 30
      matched.push('a favourite')
    }
    if (page.openCount > 0) score += Math.min(20, Math.log2(1 + page.openCount) * 6)

    results.push({ page, score, matched })
  }

  return results
    .sort((a, b) => b.score - a.score || (a.page.manifest.title < b.page.manifest.title ? -1 : 1))
    .slice(0, Math.max(1, options.limit ?? 20))
}

/**
 * Pages related to a given one.
 *
 * From shared categories and tags -- so the relationship is a real one that can be pointed at, rather than a slot in a
 * layout that had to be filled. A Page with nothing in common with anything returns nothing.
 */
export function relatedPages(state: PageRegistry, pageId: string, profileId: string | null, limit = 6): PageSearchResult[] {
  const page = pageById(state, pageId)
  if (!page) return []
  const results: PageSearchResult[] = []
  for (const other of listPages(state, { profileId })) {
    if (other.identity.pageId === pageId) continue
    const sharedCategories = other.manifest.categories.filter((category) =>
      page.manifest.categories.some((mine) => categoryContains(mine, category) || categoryContains(category, mine))
    )
    const sharedTags = other.manifest.tags.filter((tag) => page.manifest.tags.includes(tag))
    const sameKind = other.manifest.kind === page.manifest.kind
    const score = sharedCategories.length * 50 + sharedTags.length * 20 + (sameKind ? 10 : 0)
    if (score === 0) continue
    const matched: string[] = []
    if (sharedCategories.length > 0) matched.push('same subject')
    if (sharedTags.length > 0) matched.push('shared tags')
    if (sameKind) matched.push('same kind')
    results.push({ page: other, score, matched })
  }
  return results.sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit))
}

/**
 * Address-bar suggestions for a partly-typed query.
 *
 * Deliberately narrower than search: only a Page whose name or another name for it actually begins with what has been
 * typed. A suggestion list that guesses is a suggestion list that gets in the way of typing something else.
 */
export function suggestPages(state: PageRegistry, prefix: string, profileId: string | null, limit = 5): RegisteredPage[] {
  const text = String(prefix ?? '').trim().toLowerCase()
  if (text.length < 2) return []
  return listPages(state, { profileId })
    .filter((page) => {
      const names = [page.manifest.title, ...page.manifest.search.aliases, page.identity.slug].map((one) => one.toLowerCase())
      return names.some((name) => name.startsWith(text) || name.split(/[\s-]+/).some((word) => word.startsWith(text)))
    })
    .sort((a, b) => {
      const aStarts = a.manifest.title.toLowerCase().startsWith(text) ? 0 : 1
      const bStarts = b.manifest.title.toLowerCase().startsWith(text) ? 0 : 1
      return aStarts - bStarts || b.openCount - a.openCount || (a.manifest.title < b.manifest.title ? -1 : 1)
    })
    .slice(0, Math.max(0, limit))
}

// ---------------------------------------------------------------- health

export interface RegistryHealth {
  pages: number
  available: number
  archived: number
  needsReview: number
  incompatible: number
  /** Aliases pointing at a Page that is no longer registered. Harmless, but worth clearing. */
  danglingAliases: string[]
  /** Two Pages claiming one address, which should be impossible and is worth knowing about if it happens. */
  duplicateSlugs: string[]
  duplicateIds: string[]
  healthy: boolean
}

/**
 * What the register looks like, checked against itself.
 *
 * The duplicate checks should never fire. They exist because "should never happen" is how a registry ends up with two
 * Pages at one address and no way to tell which one an old bookmark meant.
 */
export function registryHealth(state: PageRegistry): RegistryHealth {
  const slugs = new Map<string, number>()
  const ids = new Map<string, number>()
  for (const page of state.pages) {
    slugs.set(page.identity.slug, (slugs.get(page.identity.slug) ?? 0) + 1)
    ids.set(page.identity.pageId, (ids.get(page.identity.pageId) ?? 0) + 1)
  }
  const duplicateSlugs = [...slugs.entries()].filter(([, n]) => n > 1).map(([slug]) => slug)
  const duplicateIds = [...ids.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  const danglingAliases = state.aliases.filter((one) => !pageById(state, one.pageId)).map((one) => one.from)
  const count = (status: PageStatus): number => state.pages.filter((one) => one.status === status).length

  return {
    pages: state.pages.length,
    available: count('available'),
    archived: count('archived'),
    needsReview: count('needs-review'),
    incompatible: count('incompatible'),
    danglingAliases,
    duplicateSlugs,
    duplicateIds,
    healthy: duplicateSlugs.length === 0 && duplicateIds.length === 0
  }
}

/** Aliases whose Page is gone, removed. Never touches a Page. */
export function pruneAliases(state: PageRegistry): PageRegistry {
  return replacePages(
    state,
    [...state.pages],
    state.aliases.filter((one) => pageById(state, one.pageId) !== null)
  )
}
