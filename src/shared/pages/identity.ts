/**
 * What an Orbis Page *is*, as an identity and an address.
 *
 * A Page is not a tab in a panel. It is a thing with a permanent identifier, a readable address, a version, and an owner,
 * and every one of those has to be decided before anything is built on top -- because the moment a Page is bookmarked, put
 * in a workflow, or referred to from a note, its identity has to stop moving.
 *
 * So there are two identifiers and they do different jobs:
 *
 * ```
 * pageId   permanent, opaque, never reused, never derived from the title
 * slug     readable, in the address, may change -- with the old one still resolving
 * ```
 *
 * Getting this the other way round is the mistake that cannot be undone later: if the address *is* the identity, renaming
 * a Page breaks every reference to it, and the only fix is to never rename anything.
 *
 * Orbis already has an internal address scheme -- `orbis://search`, `orbis://galaxy` -- and Pages join it rather than
 * inventing a second one. See `shared/orbisSearch.ts` for the scheme itself.
 *
 * Pure. No network, no clock, no storage, no registry: resolving an address to a Page that exists is the registry's job,
 * and keeping the two apart is what makes both testable.
 */

import { ORBIS_SCHEME } from '../orbisSearch.ts'

/** Where every Page lives. `orbis://pages/<slug>`. */
export const PAGES_ROOT = `${ORBIS_SCHEME}//pages`

/** The library itself -- the page that lists Pages. Not a Page; a destination like `orbis://search`. */
export const PAGES_LIBRARY = PAGES_ROOT

/**
 * A Page's permanent identifier.
 *
 * Opaque on purpose. Nothing may be inferred from it, because anything inferrable becomes something that has to stay
 * true. It is not the slug, not the title, not a path, and not a number that says when the Page was made.
 */
export type PageId = string

/** The shape of an id, checked wherever one arrives from outside. */
const ID_PATTERN = /^page_[0-9a-z]{12,40}$/

export const isPageId = (value: unknown): value is PageId => typeof value === 'string' && ID_PATTERN.test(value)

/**
 * A new Page id.
 *
 * The random part is supplied rather than generated here, because this module is pure and because the caller already has
 * the right generator -- `crypto.randomUUID` in the main process, and a seeded one in a test that needs to be repeatable.
 */
export function makePageId(random: string): PageId {
  const cleaned = random.toLowerCase().replace(/[^0-9a-z]/g, '')
  if (cleaned.length < 12) throw new Error('A Page id needs at least 12 usable characters of randomness.')
  return `page_${cleaned.slice(0, 32)}`
}

// ---------------------------------------------------------------- slugs

/** The longest a slug may be. Long enough to be descriptive, short enough to read in an address bar. */
export const MAX_SLUG_LENGTH = 64

/** Addresses under `orbis://pages/` that are not Pages, so a Page may never take one. */
export const RESERVED_SLUGS: readonly string[] = [
  'new',
  'create',
  'edit',
  'library',
  'all',
  'search',
  'settings',
  'index',
  'about',
  'help',
  'internal',
  'system',
  'orbis'
]

/**
 * A title turned into a slug.
 *
 * Deterministic: the same title always gives the same slug, so two people naming a Page the same thing get the same
 * address and the collision is visible rather than random. Uniqueness is the registry's job -- this only says what the
 * preferred slug would be.
 */
export function slugify(title: string): string {
  const slug = String(title ?? '')
    .normalize('NFKD')
    // Strip the marks left behind by decomposition, so "Pöttinger" becomes "pottinger" rather than "po-ttinger".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
  return slug
}

export interface SlugProblem {
  error: 'empty' | 'reserved' | 'too-long' | 'shape'
  message: string
}

/**
 * Whether a slug may be used, and why not when it may not.
 *
 * Deliberately strict. A slug is part of an address and part of a filesystem path in some storage backends, so anything
 * that could be read two ways -- a dot, a slash, an encoded character, a leading dash -- is refused rather than escaped.
 */
export function checkSlug(slug: string): SlugProblem | null {
  const text = String(slug ?? '')
  if (text === '') return { error: 'empty', message: 'A Page needs an address.' }
  if (text.length > MAX_SLUG_LENGTH) {
    return { error: 'too-long', message: `An address may be at most ${MAX_SLUG_LENGTH} characters.` }
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) {
    return {
      error: 'shape',
      message: 'An address may contain lower-case letters, digits and single dashes between them, and nothing else.'
    }
  }
  if (RESERVED_SLUGS.includes(text)) {
    return { error: 'reserved', message: `"${text}" is part of Orbis's own addresses, so a Page cannot use it.` }
  }
  return null
}

export const isUsableSlug = (slug: string): boolean => checkSlug(slug) === null

/**
 * A slug that does not collide with the ones already taken.
 *
 * Appends a number rather than random characters, so the second Page called "Projectile Motion" gets
 * `projectile-motion-2` -- guessable, stable, and obviously the second one.
 */
export function uniqueSlug(preferred: string, taken: Iterable<string>, limit = 999): string {
  const used = new Set(taken)
  const base = slugify(preferred) || 'page'
  const seed = isUsableSlug(base) ? base : `page-${base}`.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
  if (!used.has(seed) && isUsableSlug(seed)) return seed
  for (let n = 2; n <= limit; n++) {
    const suffix = `-${n}`
    const candidate = `${seed.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!used.has(candidate) && isUsableSlug(candidate)) return candidate
  }
  throw new Error(`Could not find an unused address near "${seed}".`)
}

// ---------------------------------------------------------------- versions

/** A Page version, as major.minor.patch. */
export interface PageVersion {
  major: number
  minor: number
  patch: number
}

export const versionToText = (v: PageVersion): string => `${v.major}.${v.minor}.${v.patch}`

const VERSION_PATTERN = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/

export function parseVersion(text: string): PageVersion | null {
  const match = VERSION_PATTERN.exec(String(text ?? '').trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** Negative when `a` is older, zero when they are the same, positive when `a` is newer. */
export function compareVersions(a: PageVersion, b: PageVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

export const sameVersion = (a: PageVersion, b: PageVersion): boolean => compareVersions(a, b) === 0

// ---------------------------------------------------------------- addresses

/**
 * What an Orbis Page address says.
 *
 * The slug identifies the Page; everything after it belongs to the Page. A route is the Page's own internal navigation --
 * `orbis://pages/physics-lab/experiment` is one Page, not two -- and a version pin asks for a specific published version
 * rather than whatever is current.
 */
export interface PageAddress {
  slug: string
  /** The Page's own path, split and already decoded. Empty for the Page's front door. */
  route: string[]
  /** A pinned version, when the address asked for one. Null means "whatever is current and compatible". */
  version: PageVersion | null
  /** Query parameters, which are navigation state and never identity. */
  params: Record<string, string>
  /** The fragment, which belongs entirely to the Page. */
  fragment: string
}

export interface AddressProblem {
  error: 'not-a-page-address' | 'no-slug' | 'bad-slug' | 'traversal' | 'bad-version' | 'too-long'
  message: string
}

export const isAddressProblem = (value: PageAddress | AddressProblem): value is AddressProblem => 'error' in value

/** The longest address Orbis will look at, so a generated one cannot become a denial of service. */
export const MAX_ADDRESS_LENGTH = 2048

/** Whether a URL is under `orbis://pages/` at all. Cheap, for a router deciding where to send something. */
export function isPageAddress(url: string): boolean {
  const text = String(url ?? '').trim()
  const lower = text.toLowerCase()
  return lower === PAGES_ROOT || lower.startsWith(`${PAGES_ROOT}/`) || lower.startsWith(`${PAGES_ROOT}?`) || lower.startsWith(`${PAGES_ROOT}#`)
}

/**
 * A Page address, read.
 *
 * Every rejection here is a security decision as much as a parsing one:
 *
 * - `..` and `.` in the path are refused outright rather than resolved, because a path that has been normalised is a path
 *   whose authorisation check was performed against a different string than the one used to fetch. That is the shape of
 *   every traversal bug ever written, so the segments never get to move.
 * - An encoded separator -- `%2e%2e`, `%2f` -- is refused for the same reason. Decoding after the check is what makes
 *   checking pointless.
 * - A host is refused. `orbis://evil.example/pages/x` is not a Page address, and matching on "contains orbis://pages"
 *   would let a website claim to be one.
 */
export function parsePageAddress(url: string): PageAddress | AddressProblem {
  const text = String(url ?? '').trim()
  if (text.length > MAX_ADDRESS_LENGTH) {
    return { error: 'too-long', message: 'That address is too long to be a Page address.' }
  }
  if (!isPageAddress(text)) {
    return { error: 'not-a-page-address', message: 'That is not an Orbis Page address.' }
  }

  // Split by hand rather than with `new URL`. `orbis://pages/a/b` has "pages" as its host under the URL rules, and the
  // parser lower-cases and percent-decodes hosts -- neither of which should happen to something being authorised.
  const afterScheme = text.slice(`${ORBIS_SCHEME}//`.length)
  const firstSlash = afterScheme.indexOf('/')
  const firstQuestion = afterScheme.indexOf('?')
  const firstHash = afterScheme.indexOf('#')
  const stops = [firstSlash, firstQuestion, firstHash].filter((at) => at >= 0)
  const hostEnd = stops.length > 0 ? Math.min(...stops) : afterScheme.length
  const host = afterScheme.slice(0, hostEnd)
  if (host.toLowerCase() !== 'pages') {
    return { error: 'not-a-page-address', message: 'That is not an Orbis Page address.' }
  }

  let rest = afterScheme.slice(hostEnd)

  let fragment = ''
  const hashAt = rest.indexOf('#')
  if (hashAt >= 0) {
    fragment = rest.slice(hashAt + 1)
    rest = rest.slice(0, hashAt)
  }

  let query = ''
  const questionAt = rest.indexOf('?')
  if (questionAt >= 0) {
    query = rest.slice(questionAt + 1)
    rest = rest.slice(0, questionAt)
  }

  const path = rest.replace(/^\/+/, '').replace(/\/+$/, '')
  if (path === '') return { error: 'no-slug', message: 'That address names no Page.' }

  const rawSegments = path.split('/').filter((segment) => segment !== '')

  for (const segment of rawSegments) {
    // Checked before decoding, so an encoded separator cannot become one afterwards.
    if (segment === '.' || segment === '..') {
      return { error: 'traversal', message: 'A Page address cannot contain a relative path.' }
    }
    if (/%2e/i.test(segment) || /%2f/i.test(segment) || /%5c/i.test(segment) || segment.includes('\\')) {
      return { error: 'traversal', message: 'A Page address cannot contain an encoded path separator.' }
    }
    if (segment.includes('\0')) {
      return { error: 'traversal', message: 'A Page address cannot contain a null character.' }
    }
  }

  const [slugPart, ...routeParts] = rawSegments

  // A pinned version, written after an `@`.
  let slug = slugPart
  let version: PageVersion | null = null
  const atSign = slugPart.lastIndexOf('@')
  if (atSign > 0) {
    slug = slugPart.slice(0, atSign)
    const asked = parseVersion(slugPart.slice(atSign + 1))
    if (!asked) return { error: 'bad-version', message: 'A pinned version must be written as major.minor.patch.' }
    version = asked
  }

  const slugProblem = checkSlug(slug)
  if (slugProblem) return { error: 'bad-slug', message: slugProblem.message }

  const route: string[] = []
  for (const segment of routeParts) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return { error: 'traversal', message: 'A Page address contains an escape Orbis cannot read.' }
    }
    // And again after decoding, because that is the string the Page will act on.
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
      return { error: 'traversal', message: 'A Page address cannot contain a relative path.' }
    }
    route.push(decoded)
  }

  const params: Record<string, string> = {}
  if (query !== '') {
    for (const pair of query.split('&')) {
      if (pair === '') continue
      const equals = pair.indexOf('=')
      const rawKey = equals >= 0 ? pair.slice(0, equals) : pair
      const rawValue = equals >= 0 ? pair.slice(equals + 1) : ''
      try {
        const key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
        if (key === '') continue
        // First wins, so a repeated parameter cannot be used to smuggle a second value past a check on the first.
        if (!Object.prototype.hasOwnProperty.call(params, key)) {
          params[key] = decodeURIComponent(rawValue.replace(/\+/g, ' '))
        }
      } catch {
        return { error: 'traversal', message: 'A Page address contains an escape Orbis cannot read.' }
      }
    }
  }

  let readableFragment = ''
  try {
    readableFragment = fragment === '' ? '' : decodeURIComponent(fragment)
  } catch {
    readableFragment = fragment
  }

  return { slug, route, version, params, fragment: readableFragment }
}

/**
 * A Page address, written.
 *
 * The inverse of `parsePageAddress` for every address the parser accepts, which is checked by a test rather than assumed.
 */
export function pageAddress(
  slug: string,
  options: { route?: string[]; version?: PageVersion | null; params?: Record<string, string>; fragment?: string } = {}
): string {
  const pinned = options.version ? `@${versionToText(options.version)}` : ''
  const route = (options.route ?? [])
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const entries = Object.entries(options.params ?? {}).filter(([key]) => key !== '')
  const query = entries.length === 0 ? '' : `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
  const fragment = options.fragment ? `#${encodeURIComponent(options.fragment)}` : ''
  return `${PAGES_ROOT}/${slug}${pinned}${route === '' ? '' : `/${route}`}${query}${fragment}`
}

/**
 * The one address that identifies a Page.
 *
 * No route, no parameters, no fragment, no version. What a bookmark should store and what search results should point at,
 * so the same Page is never indexed twice under two spellings.
 */
export const canonicalPageAddress = (slug: string): string => `${PAGES_ROOT}/${slug}`

/**
 * An address reduced to its canonical form.
 *
 * Trailing slashes, a repeated parameter, an upper-case scheme and an empty fragment all describe the same Page, and a
 * comparison between two spellings of one address must not depend on which was typed.
 */
export function normalisePageAddress(url: string): string | AddressProblem {
  const parsed = parsePageAddress(url)
  if (isAddressProblem(parsed)) return parsed
  return pageAddress(parsed.slug, {
    route: parsed.route,
    version: parsed.version,
    // Sorted, so two addresses with the same parameters in a different order normalise to one string.
    params: Object.fromEntries(Object.entries(parsed.params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    fragment: parsed.fragment
  })
}

/** Whether two addresses name the same Page, ignoring route, parameters, fragment and version. */
export function samePage(a: string, b: string): boolean {
  const left = parsePageAddress(a)
  const right = parsePageAddress(b)
  if (isAddressProblem(left) || isAddressProblem(right)) return false
  return left.slug === right.slug
}

// ---------------------------------------------------------------- identity as an object

/** Who a Page belongs to. Provenance, never permission -- see `capabilities.ts` for what a Page may actually do. */
export type PageOwner = 'system' | 'user' | 'orion' | 'imported'

/**
 * Everything needed to refer to a Page, without the Page itself.
 *
 * What other subsystems store. A workflow, a note, a bookmark or a whiteboard card keeps this rather than a title, so a
 * renamed Page stays findable and a deleted one fails loudly instead of resolving to something else.
 */
export interface PageIdentity {
  readonly pageId: PageId
  readonly slug: string
  readonly version: PageVersion
  readonly owner: PageOwner
  /** The profile the Page belongs to, or null for one shipped with Orbis. */
  readonly profileId: string | null
  readonly canonicalUrl: string
}

export function pageIdentity(parts: {
  pageId: PageId
  slug: string
  version: PageVersion
  owner: PageOwner
  profileId?: string | null
}): PageIdentity {
  return Object.freeze({
    pageId: parts.pageId,
    slug: parts.slug,
    version: parts.version,
    owner: parts.owner,
    profileId: parts.profileId ?? null,
    canonicalUrl: canonicalPageAddress(parts.slug)
  })
}

/**
 * An address that used to point somewhere.
 *
 * A slug may change, and every reference written down before it changed still has the old one. Keeping the alias is the
 * difference between renaming a Page and breaking every link to it.
 */
export interface SlugAlias {
  from: string
  pageId: PageId
  /** When the slug moved, so an alias can eventually be retired knowingly rather than forgotten. */
  changedAt: number
}

/** Whether two identities are the same Page, which is a question about the id and nothing else. */
export const sameIdentity = (a: PageIdentity, b: PageIdentity): boolean => a.pageId === b.pageId
