/**
 * Several Pages behaving as one application: identity, routes, navigation, shared state and typed contracts.
 *
 * A Page is already a complete thing — it has a permanent id, an address, a version and an owner, all decided in
 * `identity.ts`. This module is what lets a set of them act together without any of them stopping being a Page.
 * That distinction is the whole design:
 *
 * ```
 * Page         an independently addressable surface, openable on its own
 * Application  a composition of Pages, with routes, navigation and shared state
 * ```
 *
 * A Page may belong to several applications and still be openable by itself. An application never owns the Pages it
 * lists; it *refers* to them by `pageId`, exactly as a workspace refers to notes. Removing a Page from an
 * application does not delete the Page, and deleting the application does not delete anything.
 *
 * ## Why references and not copies
 *
 * The alternative — an application holding its own copy of each Page's definition — is what makes two Pages with the
 * same name drift apart until nobody knows which is real. So an application entry carries a `pageId`, a route and
 * the configuration *that application* wants, and nothing else. The Page's own definition stays where it is.
 *
 * ## Why shared state has owners
 *
 * Any state two Pages both touch needs exactly one owner, or the result is the ambient-global problem: a value
 * changes, several Pages disagree about who changed it, and the bug is unreproducible. So every shared value names
 * the Page allowed to write it, and every Page that wants to write one must declare a binding. A Page cannot reach
 * into shared state it has not declared, and `checkApplication` reports it when one tries.
 *
 * ## Why contracts are versioned and adapters are explicit
 *
 * When one Page's output feeds another's input, the two have to agree on a shape. They will not agree forever:
 * somebody adds a field, changes a unit, renames a column. A silent reinterpretation there is the failure that
 * corrupts data without anything appearing to break, so a contract carries a version, a mismatch is refused, and
 * bridging two versions requires an adapter that says so.
 *
 * ## What this module refuses to do
 *
 * It is pure: no clock, no storage, no registry, no runtime. Resolving a `pageId` to a Page that exists belongs to
 * the registry, executing a route belongs to the runtime, and persisting an application belongs to the store.
 * Keeping them apart is what makes all four testable. Every function here either returns a value or returns an
 * error object — nothing throws.
 */

import {
  compareVersions,
  isPageId,
  parseVersion,
  slugify,
  versionToText,
  type PageId,
  type PageVersion
} from './identity.ts'
import { ORBIS_SCHEME } from '../orbisSearch.ts'

/** Where every application lives. `orbis://apps/<slug>`. Under the same scheme as Pages, not a second one. */
export const APPS_ROOT = `${ORBIS_SCHEME}//apps`

export interface ApplicationError {
  error:
    | 'invalid-argument'
    | 'not-found'
    | 'duplicate'
    | 'bad-route'
    | 'bad-contract'
    | 'not-permitted'
    | 'too-many'
    | 'cycle'
  message: string
}

export const isApplicationError = (value: unknown): value is ApplicationError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ApplicationError['error'], message: string): ApplicationError => ({ error, message })

/**
 * What an application may hold.
 *
 * These are not performance tuning. They are the point at which a structure has stopped being something a person
 * navigates and become something that needs a different tool, and saying so is more useful than letting it grow
 * until the navigation is unusable.
 */
export const APPLICATION_LIMITS = Object.freeze({
  pages: 200,
  groups: 40,
  depth: 3,
  sharedValues: 200,
  contracts: 200,
  bindings: 400,
  routeSegments: 4,
  routeLength: 120,
  titleLength: 120,
  descriptionLength: 600
})

// ---------------------------------------------------------------- identity

export type ApplicationId = string

const APPLICATION_ID_PATTERN = /^app_[0-9a-z]{12,40}$/

export const isApplicationId = (value: unknown): value is ApplicationId =>
  typeof value === 'string' && APPLICATION_ID_PATTERN.test(value)

/**
 * A new application id.
 *
 * The randomness is supplied rather than generated, for the same reason `makePageId` does it: this module is pure,
 * and a test that needs a repeatable id has to be able to supply one.
 */
export function makeApplicationId(random: string): ApplicationId {
  const cleaned = String(random ?? '').toLowerCase().replace(/[^0-9a-z]/g, '')
  if (cleaned.length < 12) throw new Error('An application id needs at least 12 usable characters of randomness.')
  return `app_${cleaned.slice(0, 32)}`
}

/** Addresses under `orbis://apps/` that are not applications, so one may never take the name. */
export const RESERVED_APPLICATION_SLUGS: readonly string[] = Object.freeze([
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
  'orbis',
  'apps',
  'pages'
])

// ---------------------------------------------------------------- routes

/**
 * Route segments that cannot be used, because the router needs them for itself or they are not a path.
 *
 * `.` and `..` are refused rather than resolved: a route is a name, not a filesystem walk, and letting `..` through
 * is how a deep link reaches a Page the person was never given.
 */
const BAD_SEGMENTS = new Set(['.', '..', '', 'new', 'edit'])

const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$|^:[a-z][a-zA-Z0-9]*$/

export interface RouteProblem {
  error: 'bad-route'
  message: string
}

/**
 * A route, checked segment by segment.
 *
 * Returns the normalised segments or says exactly what is wrong with them. A dynamic segment is written `:name` —
 * `/projects/:projectId` — and is a placeholder the router fills, not a literal.
 */
export function parseRoute(raw: string): string[] | RouteProblem {
  if (typeof raw !== 'string') return { error: 'bad-route', message: 'A route has to be text.' }
  const text = raw.trim()
  if (text.length > APPLICATION_LIMITS.routeLength) {
    return { error: 'bad-route', message: `A route may be at most ${APPLICATION_LIMITS.routeLength} characters.` }
  }
  if (text === '' || text === '/') return []
  const segments = text.replace(/^\/+|\/+$/g, '').split('/')
  if (segments.length > APPLICATION_LIMITS.routeSegments) {
    return {
      error: 'bad-route',
      message: `"${raw}" has ${segments.length} segments and at most ${APPLICATION_LIMITS.routeSegments} are allowed. A route deeper than that is usually a sign the application wants a group rather than a longer path.`
    }
  }
  for (const segment of segments) {
    if (BAD_SEGMENTS.has(segment)) {
      return {
        error: 'bad-route',
        message:
          segment === '..' || segment === '.'
            ? `"${segment}" is not a route segment. A route is a name, not a path walk — allowing ".." is how a deep link reaches a Page nobody was given.`
            : `"${segment}" cannot be a route segment; it is reserved or empty.`
      }
    }
    if (!SEGMENT_PATTERN.test(segment)) {
      return {
        error: 'bad-route',
        message: `"${segment}" is not a usable route segment. Use lowercase letters, digits and hyphens, or ":name" for a value the router fills in.`
      }
    }
  }
  return segments
}

/** The canonical text of a route: leading slash, no trailing one, and `/` for the root. */
export const routeToText = (segments: readonly string[]): string =>
  segments.length === 0 ? '/' : `/${segments.join('/')}`

/** Whether a segment is a placeholder the router fills rather than a literal. */
export const isDynamicSegment = (segment: string): boolean => segment.startsWith(':')

export interface ApplicationAddress {
  slug: string
  route: string[]
  /** A pinned version, when the address names one. */
  version: PageVersion | null
  params: Record<string, string>
}

export interface AddressProblem {
  error: 'bad-address'
  message: string
}

export const isAddressProblem = (
  value: ApplicationAddress | AddressProblem
): value is AddressProblem => 'error' in value

/** Whether a URL is under `orbis://apps/` at all. Cheap, for a router deciding where to send something. */
export function isApplicationAddress(url: string): boolean {
  if (typeof url !== 'string') return false
  const lower = url.trim().toLowerCase()
  return (
    lower === APPS_ROOT ||
    lower.startsWith(`${APPS_ROOT}/`) ||
    lower.startsWith(`${APPS_ROOT}?`) ||
    lower.startsWith(`${APPS_ROOT}#`)
  )
}

/**
 * Read an application address.
 *
 * `orbis://apps/<slug>` opens the application at its default route. `orbis://apps/<slug>/<route>` opens that route.
 * A deep link is checked here for shape only — whether the application exists, whether the route resolves, and
 * whether this profile may open it are three separate questions, answered by the registry, `resolveRoute` and the
 * permission layer respectively. Answering them here would make this module need all three.
 */
export function parseApplicationAddress(url: string): ApplicationAddress | AddressProblem {
  if (typeof url !== 'string') return { error: 'bad-address', message: 'An address has to be text.' }
  const text = url.trim()
  if (!isApplicationAddress(text)) {
    return { error: 'bad-address', message: `"${url}" is not an address under ${APPS_ROOT}/.` }
  }
  const withoutRoot = text.slice(APPS_ROOT.length).replace(/^\/+/, '')
  const [beforeFragment] = withoutRoot.split('#')
  const [pathPart, queryPart = ''] = beforeFragment.split('?')
  const segments = pathPart === '' ? [] : pathPart.split('/').map((one) => decodeURIComponent(one))
  if (segments.length === 0) {
    return { error: 'bad-address', message: `${APPS_ROOT} is the application library, not an application.` }
  }

  // A version may be pinned on the slug as "slug@1.2.3".
  const [rawSlug, pinned] = segments[0].split('@')
  const slug = slugify(rawSlug)
  if (slug === '') {
    return { error: 'bad-address', message: `"${segments[0]}" is not a usable application name.` }
  }
  let version: PageVersion | null = null
  if (pinned !== undefined) {
    version = parseVersion(pinned)
    if (version === null) {
      return { error: 'bad-address', message: `"${pinned}" is not a version. A pinned version looks like "1.2.3".` }
    }
  }

  const route = parseRoute(segments.slice(1).join('/'))
  if (!Array.isArray(route)) return { error: 'bad-address', message: route.message }

  const params: Record<string, string> = Object.create(null)
  if (queryPart !== '') {
    for (const pair of queryPart.split('&')) {
      if (pair === '') continue
      const index = pair.indexOf('=')
      const key = decodeURIComponent(index === -1 ? pair : pair.slice(0, index))
      const value = index === -1 ? '' : decodeURIComponent(pair.slice(index + 1))
      if (key !== '') params[key] = value
    }
  }

  return { slug, route, version, params }
}

/** The inverse of `parseApplicationAddress`, checked against it by a round-trip test rather than assumed. */
export function applicationAddress(
  slug: string,
  options: { route?: readonly string[]; version?: PageVersion | null; params?: Record<string, string> } = {}
): string {
  const pinned = options.version === undefined || options.version === null ? '' : `@${versionToText(options.version)}`
  const route = (options.route ?? []).map((one) => encodeURIComponent(one)).join('/')
  const entries = Object.entries(options.params ?? {})
  const query =
    entries.length === 0
      ? ''
      : `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
  return `${APPS_ROOT}/${slug}${pinned}${route === '' ? '' : `/${route}`}${query}`
}

/** No route, no parameters, no version: what a bookmark stores and what a search result points at. */
export const canonicalApplicationAddress = (slug: string): string => `${APPS_ROOT}/${slug}`

// ---------------------------------------------------------------- the model

export type PageVisibility = 'visible' | 'hidden'

/**
 * One Page inside one application.
 *
 * `pageId` is a reference. The Page's title, capabilities and version live with the Page; what is here is what
 * *this* application decided about it: where it sits, what it is called in the navigation, and any configuration
 * this application wants applied. That separation is what lets the same Page appear in two applications configured
 * differently without either configuration leaking into the other.
 */
export interface ApplicationPage {
  pageId: PageId
  /** The route this Page answers, as normalised segments. Empty is the application root. */
  route: string[]
  /** What the navigation calls it here, which need not be the Page's own title. */
  label: string
  /** The navigation group it belongs to, or null for the top level. */
  group: string | null
  order: number
  visibility: PageVisibility
  /** Configuration this application applies to the Page. Plain data only. */
  configuration: Readonly<Record<string, unknown>>
}

export interface NavigationGroup {
  id: string
  label: string
  /** A parent group, for one level of nesting. */
  parent: string | null
  order: number
  collapsed: boolean
}

/**
 * A value two or more Pages share.
 *
 * `owner` is the only Page permitted to write it. Everything else reads. A shared value with no owner is what
 * ambient global state looks like, and the reason this is a required field rather than an optional one is that the
 * bug it prevents — several Pages writing one value, none of them knowing about the others — is close to
 * impossible to reproduce once it exists.
 */
export interface SharedValue {
  name: string
  /** The contract that describes the value's shape, by id. */
  contract: string
  owner: PageId
  /** Whether Pages other than the owner may read it. */
  readableByAll: boolean
  description: string
}

export type BindingDirection = 'reads' | 'writes'

/** A Page declaring that it touches a shared value. Nothing may read or write one without this. */
export interface StateBinding {
  pageId: PageId
  value: string
  direction: BindingDirection
}

/**
 * The agreed shape of data moving between Pages.
 *
 * Versioned, because it will change. A consumer expecting version 2 handed version 1 is refused rather than
 * reinterpreted — `checkContractFlow` reports it — and bridging the two takes an adapter that names both versions.
 */
export interface DataContract {
  id: string
  version: number
  /** Field name to a type name. Types are names here; validating a value against one is the runtime's job. */
  fields: Readonly<Record<string, string>>
  /** Fields a consumer may do without. */
  optional: readonly string[]
  description: string
}

/** A declared conversion from one version of a contract to another. */
export interface ContractAdapter {
  contract: string
  fromVersion: number
  toVersion: number
  /** What the conversion does, for a person reading the graph. */
  description: string
  /** Fields the conversion cannot supply, which is what makes an adapter honest rather than a rename. */
  loses: readonly string[]
}

/** One Page's output feeding another's input. */
export interface DataFlow {
  from: PageId
  to: PageId
  contract: string
  /** The version the producer emits. */
  producesVersion: number
  /** The version the consumer expects. */
  expectsVersion: number
}

export interface PageApplication {
  applicationId: ApplicationId
  slug: string
  title: string
  description: string
  version: PageVersion
  ownerProfile: string
  pages: readonly ApplicationPage[]
  groups: readonly NavigationGroup[]
  /** The route opened when the application is opened without one. */
  defaultRoute: string[]
  sharedValues: readonly SharedValue[]
  bindings: readonly StateBinding[]
  contracts: readonly DataContract[]
  adapters: readonly ContractAdapter[]
  flows: readonly DataFlow[]
}

/** An empty application. Everything else is added through the functions below, which validate as they go. */
export function emptyApplication(parts: {
  applicationId: ApplicationId
  slug: string
  title: string
  ownerProfile: string
  description?: string
  version?: PageVersion
}): PageApplication | ApplicationError {
  if (!isApplicationId(parts.applicationId)) {
    return fail('invalid-argument', `"${String(parts.applicationId)}" is not an application id.`)
  }
  const slug = slugify(parts.slug)
  if (slug === '') return fail('invalid-argument', 'An application needs a usable name.')
  if (RESERVED_APPLICATION_SLUGS.includes(slug)) {
    return fail('invalid-argument', `"${slug}" is reserved for Orbis itself and cannot name an application.`)
  }
  if (typeof parts.title !== 'string' || parts.title.trim() === '') {
    return fail('invalid-argument', 'An application needs a title.')
  }
  if (parts.title.length > APPLICATION_LIMITS.titleLength) {
    return fail('invalid-argument', `A title may be at most ${APPLICATION_LIMITS.titleLength} characters.`)
  }
  if (typeof parts.ownerProfile !== 'string' || parts.ownerProfile === '') {
    return fail('invalid-argument', 'An application belongs to a profile, and the profile has to be named.')
  }
  const description = parts.description ?? ''
  if (description.length > APPLICATION_LIMITS.descriptionLength) {
    return fail('invalid-argument', `A description may be at most ${APPLICATION_LIMITS.descriptionLength} characters.`)
  }
  return {
    applicationId: parts.applicationId,
    slug,
    title: parts.title.trim(),
    description,
    version: parts.version ?? { major: 1, minor: 0, patch: 0 },
    ownerProfile: parts.ownerProfile,
    pages: Object.freeze([]),
    groups: Object.freeze([]),
    defaultRoute: [],
    sharedValues: Object.freeze([]),
    bindings: Object.freeze([]),
    contracts: Object.freeze([]),
    adapters: Object.freeze([]),
    flows: Object.freeze([])
  }
}

// ---------------------------------------------------------------- building

/** Whether a value is plain data: no functions, no class instances, nothing that could carry behaviour. */
function isPlainData(value: unknown, depth = 0): boolean {
  if (depth > 6) return false
  if (value === null) return true
  const kind = typeof value
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return Number.isFinite(value as number) || kind !== 'number'
  if (Array.isArray(value)) return value.every((one) => isPlainData(one, depth + 1))
  if (kind === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Object.values(value as Record<string, unknown>).every((one) => isPlainData(one, depth + 1))
  }
  return false
}

/**
 * Add a Page to an application at a route.
 *
 * Refuses a duplicate route, because two Pages answering one address is not a layout question — the router has to
 * pick one and whichever it picks is arbitrary. Refuses a Page already in the application, because a Page appearing
 * twice under different routes makes "the dataset Page" ambiguous in every later instruction.
 */
export function addPage(
  application: PageApplication,
  entry: {
    pageId: PageId
    route: string
    label: string
    group?: string | null
    order?: number
    visibility?: PageVisibility
    configuration?: Record<string, unknown>
  }
): PageApplication | ApplicationError {
  if (!isPageId(entry.pageId)) return fail('invalid-argument', `"${String(entry.pageId)}" is not a Page id.`)
  if (application.pages.length >= APPLICATION_LIMITS.pages) {
    return fail('too-many', `An application may hold ${APPLICATION_LIMITS.pages} Pages.`)
  }
  if (application.pages.some((one) => one.pageId === entry.pageId)) {
    return fail(
      'duplicate',
      `That Page is already in this application. A Page appearing twice under two routes makes every later instruction about it ambiguous — to show it in two places, give it one route and link to that.`
    )
  }
  if (typeof entry.label !== 'string' || entry.label.trim() === '') {
    return fail('invalid-argument', 'A Page needs a label for the navigation.')
  }
  if (entry.label.length > APPLICATION_LIMITS.titleLength) {
    return fail('invalid-argument', `A label may be at most ${APPLICATION_LIMITS.titleLength} characters.`)
  }
  const route = parseRoute(entry.route)
  if (!Array.isArray(route)) return fail('bad-route', route.message)
  const clash = application.pages.find((one) => routeToText(one.route) === routeToText(route))
  if (clash !== undefined) {
    return fail(
      'duplicate',
      `The route ${routeToText(route)} is already answered by another Page in this application. Two Pages on one address means the router picks one arbitrarily.`
    )
  }
  if (entry.group !== undefined && entry.group !== null && !application.groups.some((one) => one.id === entry.group)) {
    return fail('not-found', `There is no navigation group "${entry.group}".`)
  }
  const configuration = entry.configuration ?? {}
  if (!isPlainData(configuration)) {
    return fail(
      'invalid-argument',
      'A Page configuration has to be plain data. Anything that can carry behaviour across that boundary is a way for one Page to run code inside another.'
    )
  }

  const page: ApplicationPage = {
    pageId: entry.pageId,
    route,
    label: entry.label.trim(),
    group: entry.group ?? null,
    order: entry.order ?? application.pages.length,
    visibility: entry.visibility ?? 'visible',
    configuration: Object.freeze({ ...configuration })
  }
  const pages = Object.freeze([...application.pages, page])
  // The first Page added becomes the default route, since an application with no default cannot be opened.
  const defaultRoute = application.pages.length === 0 ? route : application.defaultRoute
  return { ...application, pages, defaultRoute }
}

/**
 * Take a Page out of an application.
 *
 * The Page itself is untouched — this is a reference, and removing a reference is not a deletion. What does have to
 * be cleaned up is everything that pointed at it: its bindings, the shared values it owned, and the flows it was
 * part of. Leaving those behind is how an application ends up with a data-flow graph naming a Page that is not
 * there, which `checkApplication` would then report for ever.
 */
export function removePage(
  application: PageApplication,
  pageId: PageId
): { application: PageApplication; alsoRemoved: string[] } | ApplicationError {
  if (!application.pages.some((one) => one.pageId === pageId)) {
    return fail('not-found', 'That Page is not in this application.')
  }
  const alsoRemoved: string[] = []
  const orphanedValues = application.sharedValues.filter((one) => one.owner === pageId)
  for (const value of orphanedValues) {
    alsoRemoved.push(`the shared value "${value.name}", which it owned`)
  }
  const goneNames = new Set(orphanedValues.map((one) => one.name))
  const bindings = application.bindings.filter((one) => one.pageId !== pageId && !goneNames.has(one.value))
  if (bindings.length !== application.bindings.length) {
    alsoRemoved.push(`${application.bindings.length - bindings.length} state binding(s)`)
  }
  const flows = application.flows.filter((one) => one.from !== pageId && one.to !== pageId)
  if (flows.length !== application.flows.length) {
    alsoRemoved.push(`${application.flows.length - flows.length} data flow(s)`)
  }

  const pages = application.pages.filter((one) => one.pageId !== pageId)
  const removedRoute = application.pages.find((one) => one.pageId === pageId)?.route ?? []
  const defaultRoute =
    routeToText(application.defaultRoute) === routeToText(removedRoute) && pages.length > 0
      ? pages[0].route
      : pages.length === 0
        ? []
        : application.defaultRoute
  if (routeToText(defaultRoute) !== routeToText(application.defaultRoute)) {
    alsoRemoved.push('the default route, which moved to the first remaining Page')
  }

  return {
    application: {
      ...application,
      pages: Object.freeze(pages),
      sharedValues: Object.freeze(application.sharedValues.filter((one) => one.owner !== pageId)),
      bindings: Object.freeze(bindings),
      flows: Object.freeze(flows),
      defaultRoute
    },
    alsoRemoved
  }
}

/** Add a navigation group. Groups are navigation only; they hold no Pages and own no state. */
export function addGroup(
  application: PageApplication,
  group: { id: string; label: string; parent?: string | null; order?: number; collapsed?: boolean }
): PageApplication | ApplicationError {
  const id = slugify(group.id)
  if (id === '') return fail('invalid-argument', 'A group needs a usable id.')
  if (application.groups.some((one) => one.id === id)) return fail('duplicate', `There is already a group "${id}".`)
  if (application.groups.length >= APPLICATION_LIMITS.groups) {
    return fail('too-many', `An application may hold ${APPLICATION_LIMITS.groups} navigation groups.`)
  }
  if (typeof group.label !== 'string' || group.label.trim() === '') {
    return fail('invalid-argument', 'A group needs a label.')
  }
  const parent = group.parent ?? null
  if (parent !== null) {
    const found = application.groups.find((one) => one.id === parent)
    if (found === undefined) return fail('not-found', `There is no group "${parent}" to nest this under.`)
    if (found.parent !== null) {
      return fail(
        'invalid-argument',
        `"${parent}" is already nested, and navigation is limited to ${APPLICATION_LIMITS.depth} levels. Deeper than that stops being something a person can hold in mind.`
      )
    }
  }
  return {
    ...application,
    groups: Object.freeze([
      ...application.groups,
      {
        id,
        label: group.label.trim(),
        parent,
        order: group.order ?? application.groups.length,
        collapsed: group.collapsed ?? false
      }
    ])
  }
}

/** Set the route the application opens at. Must be a route a Page answers. */
export function setDefaultRoute(application: PageApplication, route: string): PageApplication | ApplicationError {
  const parsed = parseRoute(route)
  if (!Array.isArray(parsed)) return fail('bad-route', parsed.message)
  if (!application.pages.some((one) => routeToText(one.route) === routeToText(parsed))) {
    return fail('not-found', `No Page in this application answers ${routeToText(parsed)}.`)
  }
  return { ...application, defaultRoute: parsed }
}

/** Move a Page to a different route, which is how navigation is reordered without touching the Page. */
export function movePage(application: PageApplication, pageId: PageId, route: string): PageApplication | ApplicationError {
  const existing = application.pages.find((one) => one.pageId === pageId)
  if (existing === undefined) return fail('not-found', 'That Page is not in this application.')
  const parsed = parseRoute(route)
  if (!Array.isArray(parsed)) return fail('bad-route', parsed.message)
  const clash = application.pages.find(
    (one) => one.pageId !== pageId && routeToText(one.route) === routeToText(parsed)
  )
  if (clash !== undefined) {
    return fail('duplicate', `The route ${routeToText(parsed)} is already answered by another Page.`)
  }
  const wasDefault = routeToText(application.defaultRoute) === routeToText(existing.route)
  return {
    ...application,
    pages: Object.freeze(
      application.pages.map((one) => (one.pageId === pageId ? { ...one, route: parsed } : one))
    ),
    defaultRoute: wasDefault ? parsed : application.defaultRoute
  }
}

/** Reorder the navigation. Order is presentation; it never changes what a route resolves to. */
export function reorderPages(application: PageApplication, order: readonly PageId[]): PageApplication | ApplicationError {
  const known = new Set(application.pages.map((one) => one.pageId))
  for (const pageId of order) {
    if (!known.has(pageId)) return fail('not-found', `"${pageId}" is not in this application.`)
  }
  const position = new Map(order.map((pageId, index) => [pageId, index]))
  return {
    ...application,
    pages: Object.freeze(
      application.pages.map((one) => ({ ...one, order: position.get(one.pageId) ?? one.order }))
    )
  }
}

// ---------------------------------------------------------------- contracts and state

export function addContract(application: PageApplication, contract: DataContract): PageApplication | ApplicationError {
  const id = String(contract.id ?? '').trim()
  if (id === '') return fail('invalid-argument', 'A contract needs an id.')
  if (!Number.isInteger(contract.version) || contract.version < 1) {
    return fail('invalid-argument', 'A contract version is a whole number of at least 1.')
  }
  if (application.contracts.some((one) => one.id === id && one.version === contract.version)) {
    return fail('duplicate', `Contract "${id}" version ${contract.version} is already declared.`)
  }
  if (application.contracts.length >= APPLICATION_LIMITS.contracts) {
    return fail('too-many', `An application may declare ${APPLICATION_LIMITS.contracts} contracts.`)
  }
  const fields = contract.fields ?? {}
  if (Object.keys(fields).length === 0) {
    return fail(
      'bad-contract',
      `Contract "${id}" declares no fields. A contract with no fields accepts anything, which is the same as having no contract while looking like it has one.`
    )
  }
  for (const optional of contract.optional ?? []) {
    if (!Object.prototype.hasOwnProperty.call(fields, optional)) {
      return fail('bad-contract', `Contract "${id}" marks "${optional}" optional but does not declare it.`)
    }
  }
  return {
    ...application,
    contracts: Object.freeze([
      ...application.contracts,
      {
        id,
        version: contract.version,
        fields: Object.freeze({ ...fields }),
        optional: Object.freeze([...(contract.optional ?? [])]),
        description: contract.description ?? ''
      }
    ])
  }
}

export function addAdapter(application: PageApplication, adapter: ContractAdapter): PageApplication | ApplicationError {
  if (!application.contracts.some((one) => one.id === adapter.contract && one.version === adapter.fromVersion)) {
    return fail('not-found', `Contract "${adapter.contract}" version ${adapter.fromVersion} is not declared.`)
  }
  if (!application.contracts.some((one) => one.id === adapter.contract && one.version === adapter.toVersion)) {
    return fail('not-found', `Contract "${adapter.contract}" version ${adapter.toVersion} is not declared.`)
  }
  if (adapter.fromVersion === adapter.toVersion) {
    return fail('invalid-argument', 'An adapter converts between two different versions.')
  }
  if (
    application.adapters.some(
      (one) =>
        one.contract === adapter.contract &&
        one.fromVersion === adapter.fromVersion &&
        one.toVersion === adapter.toVersion
    )
  ) {
    return fail('duplicate', 'That adapter is already declared.')
  }
  return {
    ...application,
    adapters: Object.freeze([
      ...application.adapters,
      {
        contract: adapter.contract,
        fromVersion: adapter.fromVersion,
        toVersion: adapter.toVersion,
        description: adapter.description ?? '',
        loses: Object.freeze([...(adapter.loses ?? [])])
      }
    ])
  }
}

/** Declare a value several Pages share, with the one Page allowed to write it. */
export function addSharedValue(application: PageApplication, value: SharedValue): PageApplication | ApplicationError {
  const name = String(value.name ?? '').trim()
  if (name === '') return fail('invalid-argument', 'A shared value needs a name.')
  if (application.sharedValues.some((one) => one.name === name)) {
    return fail('duplicate', `There is already a shared value called "${name}".`)
  }
  if (application.sharedValues.length >= APPLICATION_LIMITS.sharedValues) {
    return fail('too-many', `An application may hold ${APPLICATION_LIMITS.sharedValues} shared values.`)
  }
  if (!application.pages.some((one) => one.pageId === value.owner)) {
    return fail(
      'not-found',
      `"${String(value.owner)}" is not a Page in this application, so it cannot own "${name}". Every shared value needs an owner: a value several Pages write is the ambient-global bug, and it is close to impossible to reproduce once it exists.`
    )
  }
  if (!application.contracts.some((one) => one.id === value.contract)) {
    return fail('not-found', `Contract "${String(value.contract)}" is not declared, so "${name}" has no shape.`)
  }
  return {
    ...application,
    sharedValues: Object.freeze([
      ...application.sharedValues,
      {
        name,
        contract: value.contract,
        owner: value.owner,
        readableByAll: value.readableByAll ?? true,
        description: value.description ?? ''
      }
    ]),
    // The owner writes it by definition, so the binding that says so is added rather than left to be remembered.
    bindings: Object.freeze([
      ...application.bindings,
      { pageId: value.owner, value: name, direction: 'writes' as const }
    ])
  }
}

/**
 * Declare that a Page reads or writes a shared value.
 *
 * A write by anything other than the owner is refused here rather than reported later, because by the time two
 * Pages are both writing one value the damage is already in the stored state.
 */
export function bindState(application: PageApplication, binding: StateBinding): PageApplication | ApplicationError {
  const value = application.sharedValues.find((one) => one.name === binding.value)
  if (value === undefined) return fail('not-found', `There is no shared value called "${String(binding.value)}".`)
  if (!application.pages.some((one) => one.pageId === binding.pageId)) {
    return fail('not-found', `"${String(binding.pageId)}" is not a Page in this application.`)
  }
  if (binding.direction !== 'reads' && binding.direction !== 'writes') {
    return fail('invalid-argument', 'A binding either reads or writes.')
  }
  if (binding.direction === 'writes' && value.owner !== binding.pageId) {
    return fail(
      'not-permitted',
      `"${binding.value}" is owned by ${value.owner}, so only that Page may write it. Two Pages writing one value is the bug this ownership exists to prevent — to have this Page change it, send the owner a request instead.`
    )
  }
  if (binding.direction === 'reads' && !value.readableByAll && value.owner !== binding.pageId) {
    return fail('not-permitted', `"${binding.value}" is private to ${value.owner}.`)
  }
  if (
    application.bindings.some(
      (one) => one.pageId === binding.pageId && one.value === binding.value && one.direction === binding.direction
    )
  ) {
    return application
  }
  if (application.bindings.length >= APPLICATION_LIMITS.bindings) {
    return fail('too-many', `An application may hold ${APPLICATION_LIMITS.bindings} state bindings.`)
  }
  return { ...application, bindings: Object.freeze([...application.bindings, { ...binding }]) }
}

/** Declare that one Page's output feeds another's input. */
export function addFlow(application: PageApplication, flow: DataFlow): PageApplication | ApplicationError {
  for (const [role, pageId] of [['from', flow.from], ['to', flow.to]] as const) {
    if (!application.pages.some((one) => one.pageId === pageId)) {
      return fail('not-found', `The ${role} Page "${String(pageId)}" is not in this application.`)
    }
  }
  if (flow.from === flow.to) {
    return fail('invalid-argument', 'A Page feeding itself is not a flow between Pages.')
  }
  if (!application.contracts.some((one) => one.id === flow.contract && one.version === flow.producesVersion)) {
    return fail('not-found', `Contract "${flow.contract}" version ${flow.producesVersion} is not declared.`)
  }
  if (!application.contracts.some((one) => one.id === flow.contract && one.version === flow.expectsVersion)) {
    return fail('not-found', `Contract "${flow.contract}" version ${flow.expectsVersion} is not declared.`)
  }
  if (
    application.flows.some(
      (one) => one.from === flow.from && one.to === flow.to && one.contract === flow.contract
    )
  ) {
    return fail('duplicate', 'That flow is already declared.')
  }
  return { ...application, flows: Object.freeze([...application.flows, { ...flow }]) }
}

// ---------------------------------------------------------------- resolving

export interface ResolvedRoute {
  pageId: PageId
  /** The Page entry, so a caller does not have to look it up again. */
  page: ApplicationPage
  /** Values filled into the dynamic segments, if the route had any. */
  params: Readonly<Record<string, string>>
  /** Whether the route matched exactly or through a dynamic segment. */
  exact: boolean
}

/**
 * Find the Page that answers a route.
 *
 * An exact match always wins over a dynamic one, so `/projects/new` reaches a Page declared at `/projects/new` even
 * when `/projects/:projectId` also exists. Without that rule the more general route swallows the specific one and
 * which it is depends on insertion order, which is the kind of bug that appears only after somebody adds a Page.
 */
export function resolveRoute(application: PageApplication, route: string): ResolvedRoute | ApplicationError {
  const parsed = parseRoute(route)
  if (!Array.isArray(parsed)) return fail('bad-route', parsed.message)
  const wanted = parsed.length === 0 ? application.defaultRoute : parsed

  const exact = application.pages.find((one) => routeToText(one.route) === routeToText(wanted))
  if (exact !== undefined) {
    return { pageId: exact.pageId, page: exact, params: Object.freeze({}), exact: true }
  }

  // Dynamic matches, most literal segments first so the most specific pattern wins.
  const candidates = application.pages
    .filter((one) => one.route.length === wanted.length && one.route.some((segment) => isDynamicSegment(segment)))
    .map((one) => ({ page: one, literals: one.route.filter((segment) => !isDynamicSegment(segment)).length }))
    .sort((a, b) => b.literals - a.literals)

  for (const { page } of candidates) {
    const params: Record<string, string> = Object.create(null)
    let matches = true
    for (const [i, segment] of page.route.entries()) {
      if (isDynamicSegment(segment)) {
        const value = wanted[i]
        if (value === undefined || value === '') {
          matches = false
          break
        }
        params[segment.slice(1)] = value
      } else if (segment !== wanted[i]) {
        matches = false
        break
      }
    }
    if (matches) return { pageId: page.pageId, page, params: Object.freeze(params), exact: false }
  }

  return fail(
    'not-found',
    `Nothing in "${application.title}" answers ${routeToText(wanted)}. It has ${routeToText(application.defaultRoute)}${application.pages.length > 1 ? ` and ${application.pages.length - 1} other route(s)` : ''}.`
  )
}

export interface NavigationNode {
  kind: 'page' | 'group'
  id: string
  label: string
  route: string | null
  children: NavigationNode[]
}

/**
 * The navigation as a tree, ordered, with hidden Pages left out.
 *
 * Hidden means not shown, never not present: a hidden Page keeps its route and still resolves, because hiding
 * something from a menu and taking away its address are different decisions and conflating them breaks every link
 * anybody saved.
 */
export function navigationTree(application: PageApplication): NavigationNode[] {
  const visible = application.pages.filter((one) => one.visibility === 'visible')
  const pageNode = (page: ApplicationPage): NavigationNode => ({
    kind: 'page',
    id: page.pageId,
    label: page.label,
    route: routeToText(page.route),
    children: []
  })
  const byOrder = (a: { order: number }, b: { order: number }): number => a.order - b.order

  const groupNode = (group: NavigationGroup): NavigationNode => ({
    kind: 'group',
    id: group.id,
    label: group.label,
    route: null,
    children: [
      ...application.groups
        .filter((one) => one.parent === group.id)
        .sort(byOrder)
        .map(groupNode),
      ...visible
        .filter((one) => one.group === group.id)
        .sort(byOrder)
        .map(pageNode)
    ]
  })

  return [
    ...application.groups
      .filter((one) => one.parent === null)
      .sort(byOrder)
      .map(groupNode),
    ...visible
      .filter((one) => one.group === null)
      .sort(byOrder)
      .map(pageNode)
  ]
}

/** Every route in the application, for a test that walks all of them and for a sitemap. */
export const allRoutes = (application: PageApplication): string[] =>
  application.pages.map((one) => routeToText(one.route)).sort()

// ---------------------------------------------------------------- validation

export type ProblemSeverity = 'error' | 'warning'

export interface ApplicationProblem {
  severity: ProblemSeverity
  /** What kind of thing is wrong, for grouping rather than for display. */
  kind:
    | 'no-pages'
    | 'default-route-missing'
    | 'duplicate-route'
    | 'route-shadowed'
    | 'unreachable-page'
    | 'group-empty'
    | 'undeclared-binding'
    | 'unowned-value'
    | 'unread-value'
    | 'contract-version-gap'
    | 'contract-unused'
    | 'flow-cycle'
    | 'lossy-adapter'
  message: string
  /** What it is about, so a fix can point at it. */
  subject: string
}

const findCycle = (nodes: readonly string[], edges: readonly { from: string; to: string }[]): string[] | null => {
  const next = new Map<string, string[]>()
  for (const node of nodes) next.set(node, [])
  for (const edge of edges) next.get(edge.from)?.push(edge.to)
  const state = new Map<string, 'open' | 'done'>()
  const stack: string[] = []

  const walk = (node: string): string[] | null => {
    const seen = state.get(node)
    if (seen === 'done') return null
    if (seen === 'open') return [...stack.slice(stack.indexOf(node)), node]
    state.set(node, 'open')
    stack.push(node)
    for (const child of next.get(node) ?? []) {
      const found = walk(child)
      if (found !== null) return found
    }
    stack.pop()
    state.set(node, 'done')
    return null
  }

  for (const node of nodes) {
    const found = walk(node)
    if (found !== null) return found
  }
  return null
}

/**
 * Everything wrong with an application, as errors and warnings.
 *
 * An error means the application will not work: a route nobody answers, a Page nothing can reach, a data flow that
 * loops. A warning means it will work and something is probably not as intended: an empty group, a contract
 * nothing uses, a shared value nobody reads.
 *
 * The split matters because a quality gate that treats both the same either blocks on a tidiness note or ships with
 * a broken route, and both of those are worse than knowing which is which.
 */
export function checkApplication(application: PageApplication): ApplicationProblem[] {
  const problems: ApplicationProblem[] = []
  const add = (severity: ProblemSeverity, kind: ApplicationProblem['kind'], subject: string, message: string): void => {
    problems.push({ severity, kind, subject, message })
  }

  if (application.pages.length === 0) {
    add('error', 'no-pages', application.applicationId, 'This application contains no Pages, so there is nothing to open.')
    return problems
  }

  // ---- routes
  const routeCounts = new Map<string, number>()
  for (const page of application.pages) {
    const text = routeToText(page.route)
    routeCounts.set(text, (routeCounts.get(text) ?? 0) + 1)
  }
  for (const [route, count] of routeCounts) {
    if (count > 1) {
      add('error', 'duplicate-route', route, `${count} Pages answer ${route}. The router has to pick one and whichever it picks is arbitrary.`)
    }
  }

  const defaultText = routeToText(application.defaultRoute)
  if (!routeCounts.has(defaultText)) {
    add(
      'error',
      'default-route-missing',
      defaultText,
      `The application opens at ${defaultText} and no Page answers it, so opening the application shows nothing.`
    )
  }

  // A dynamic route that comes before an exact one at the same depth would swallow it, except that `resolveRoute`
  // prefers the exact match. This reports the shadowing anyway, because relying on that preference silently is how
  // it gets broken by a refactor.
  for (const page of application.pages) {
    if (!page.route.some(isDynamicSegment)) continue
    for (const other of application.pages) {
      if (other.pageId === page.pageId) continue
      if (other.route.length !== page.route.length) continue
      if (other.route.some(isDynamicSegment)) continue
      const covered = page.route.every((segment, i) => isDynamicSegment(segment) || segment === other.route[i])
      if (covered) {
        add(
          'warning',
          'route-shadowed',
          routeToText(other.route),
          `${routeToText(page.route)} also matches ${routeToText(other.route)}. The exact route wins, so this works — but the two overlap, and an exact route that is later removed changes what the other one does.`
        )
      }
    }
  }

  // ---- reachability. A Page with no navigation entry and no incoming flow can only be reached by typing its
  // address, which for most applications means it was forgotten rather than deliberately hidden.
  const tree = navigationTree(application)
  const inNavigation = new Set<string>()
  const walkTree = (nodes: readonly NavigationNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'page') inNavigation.add(node.id)
      walkTree(node.children)
    }
  }
  walkTree(tree)
  const flowTargets = new Set(application.flows.map((one) => one.to))
  for (const page of application.pages) {
    if (inNavigation.has(page.pageId)) continue
    if (flowTargets.has(page.pageId)) continue
    if (routeToText(page.route) === defaultText) continue
    add(
      'warning',
      'unreachable-page',
      page.pageId,
      `"${page.label}" is hidden from the navigation, is not the default route, and nothing feeds it. It can only be reached by typing ${routeToText(page.route)}.`
    )
  }

  for (const group of application.groups) {
    const hasPages = application.pages.some((one) => one.group === group.id)
    const hasGroups = application.groups.some((one) => one.parent === group.id)
    if (!hasPages && !hasGroups) {
      add('warning', 'group-empty', group.id, `The navigation group "${group.label}" holds nothing.`)
    }
  }

  // ---- shared state
  const pageIds = new Set(application.pages.map((one) => one.pageId))
  for (const value of application.sharedValues) {
    if (!pageIds.has(value.owner)) {
      add(
        'error',
        'unowned-value',
        value.name,
        `"${value.name}" is owned by ${value.owner}, which is not a Page in this application, so nothing can write it.`
      )
    }
    const readers = application.bindings.filter((one) => one.value === value.name && one.direction === 'reads')
    if (readers.length === 0) {
      add(
        'warning',
        'unread-value',
        value.name,
        `Nothing reads "${value.name}". A shared value with one writer and no readers is Page-local state that has been put somewhere more public than it needs to be.`
      )
    }
  }
  for (const binding of application.bindings) {
    if (!pageIds.has(binding.pageId)) {
      add('error', 'undeclared-binding', binding.value, `A binding names ${binding.pageId}, which is not a Page in this application.`)
      continue
    }
    if (!application.sharedValues.some((one) => one.name === binding.value)) {
      add('error', 'undeclared-binding', binding.value, `A binding names the shared value "${binding.value}", which is not declared.`)
    }
  }

  // ---- contracts and flows
  const usedContracts = new Set<string>([
    ...application.flows.map((one) => one.contract),
    ...application.sharedValues.map((one) => one.contract)
  ])
  for (const contract of application.contracts) {
    if (!usedContracts.has(contract.id)) {
      add(
        'warning',
        'contract-unused',
        `${contract.id}@${contract.version}`,
        `Contract "${contract.id}" has no producer and no consumer. A contract nothing uses is a shape somebody agreed on and then did not connect.`
      )
    }
  }

  for (const flow of application.flows) {
    if (flow.producesVersion === flow.expectsVersion) continue
    const direct = application.adapters.some(
      (one) =>
        one.contract === flow.contract &&
        one.fromVersion === flow.producesVersion &&
        one.toVersion === flow.expectsVersion
    )
    if (!direct) {
      add(
        'error',
        'contract-version-gap',
        `${flow.contract}: ${flow.from} -> ${flow.to}`,
        `${flow.from} produces "${flow.contract}" version ${flow.producesVersion} and ${flow.to} expects version ${flow.expectsVersion}, with no adapter between them. Passing it anyway would reinterpret the data rather than convert it, which is the failure that corrupts without anything appearing to break.`
      )
      continue
    }
    const adapter = application.adapters.find(
      (one) =>
        one.contract === flow.contract &&
        one.fromVersion === flow.producesVersion &&
        one.toVersion === flow.expectsVersion
    )
    if (adapter !== undefined && adapter.loses.length > 0) {
      add(
        'warning',
        'lossy-adapter',
        `${flow.contract} ${flow.producesVersion}->${flow.expectsVersion}`,
        `The adapter for this flow cannot supply ${adapter.loses.join(', ')}. ${flow.to} will not see those fields.`
      )
    }
  }

  const cycle = findCycle(
    [...pageIds],
    application.flows.map((one) => ({ from: one.from, to: one.to }))
  )
  if (cycle !== null) {
    add(
      'error',
      'flow-cycle',
      cycle.join(' -> '),
      `The data flows form a loop: ${cycle.join(' -> ')}. Each Page in it waits on the one before, so nothing ever settles.`
    )
  }

  return problems
}

export const applicationErrors = (problems: readonly ApplicationProblem[]): ApplicationProblem[] =>
  problems.filter((one) => one.severity === 'error')

/**
 * Whether an application is fit to publish.
 *
 * Errors block; warnings do not. A gate that blocked on warnings would stop somebody publishing because a
 * navigation group is empty, and a gate that ignored errors would publish a route that resolves to nothing.
 */
export const applicationIsPublishable = (application: PageApplication): boolean =>
  applicationErrors(checkApplication(application)).length === 0

// ---------------------------------------------------------------- flow order and staleness

/**
 * The order in which Pages have to run, from the data flows.
 *
 * Kahn's algorithm. A cycle is returned as an error rather than a partial order, because a partial order that
 * quietly omits the looping Pages is worse than no answer: everything appears to run and the omitted Pages never
 * update.
 */
export function flowOrder(application: PageApplication): PageId[] | ApplicationError {
  const incoming = new Map<PageId, number>()
  const next = new Map<PageId, PageId[]>()
  for (const page of application.pages) {
    incoming.set(page.pageId, 0)
    next.set(page.pageId, [])
  }
  for (const flow of application.flows) {
    next.get(flow.from)?.push(flow.to)
    incoming.set(flow.to, (incoming.get(flow.to) ?? 0) + 1)
  }
  // Ready Pages come out in a stable order, so the same application always gives the same plan.
  const ready = application.pages
    .filter((one) => (incoming.get(one.pageId) ?? 0) === 0)
    .map((one) => one.pageId)
    .sort()
  const order: PageId[] = []
  while (ready.length > 0) {
    const pageId = ready.shift() as PageId
    order.push(pageId)
    for (const child of next.get(pageId) ?? []) {
      const left = (incoming.get(child) ?? 0) - 1
      incoming.set(child, left)
      if (left === 0) {
        ready.push(child)
        ready.sort()
      }
    }
  }
  if (order.length !== application.pages.length) {
    const stuck = application.pages.filter((one) => !order.includes(one.pageId)).map((one) => one.pageId)
    return fail(
      'cycle',
      `The data flows loop, so no run order exists. The Pages caught in it are ${stuck.join(', ')}.`
    )
  }
  return order
}

/**
 * Which Pages are out of date once one of them changes.
 *
 * Everything downstream of the change, and nothing else. This is what makes a report say "based on an outdated
 * dataset" rather than presenting old numbers as current, and it is why the flows are declared: without them there
 * is no way to know what a change affects, so the only safe options are recomputing everything or showing stale
 * results, and both are wrong.
 */
export function staleAfter(application: PageApplication, changed: PageId): PageId[] | ApplicationError {
  if (!application.pages.some((one) => one.pageId === changed)) {
    return fail('not-found', `"${String(changed)}" is not a Page in this application.`)
  }
  const next = new Map<PageId, PageId[]>()
  for (const page of application.pages) next.set(page.pageId, [])
  for (const flow of application.flows) next.get(flow.from)?.push(flow.to)

  const stale = new Set<PageId>()
  const queue = [changed]
  while (queue.length > 0) {
    const pageId = queue.shift() as PageId
    for (const child of next.get(pageId) ?? []) {
      if (stale.has(child)) continue
      stale.add(child)
      queue.push(child)
    }
  }
  return [...stale].sort()
}

// ---------------------------------------------------------------- describing

/**
 * What an application does, from what it actually contains.
 *
 * Derived rather than written, so it cannot claim a capability the application does not have. A description
 * somebody typed goes stale the first time a Page is added; this one cannot.
 */
export function describeApplication(application: PageApplication): string[] {
  const lines: string[] = []
  const visible = application.pages.filter((one) => one.visibility === 'visible').length
  lines.push(
    `"${application.title}" is ${application.pages.length} Page${application.pages.length === 1 ? '' : 's'}${
      visible === application.pages.length ? '' : `, ${visible} of them in the navigation`
    }, opening at ${routeToText(application.defaultRoute)}.`
  )
  if (application.groups.length > 0) {
    lines.push(`The navigation is grouped into ${application.groups.map((one) => one.label).join(', ')}.`)
  }
  if (application.sharedValues.length > 0) {
    lines.push(
      `${application.sharedValues.length} value${application.sharedValues.length === 1 ? ' is' : 's are'} shared between Pages: ${application.sharedValues
        .map((one) => `${one.name} (written by ${one.owner})`)
        .join(', ')}.`
    )
  }
  if (application.flows.length > 0) {
    const order = flowOrder(application)
    lines.push(
      isApplicationError(order)
        ? `Data flows between ${application.flows.length} pair(s) of Pages, and they currently loop.`
        : `Data flows through ${application.flows.length} connection(s); the Pages run in the order ${order.join(', ')}.`
    )
  } else {
    lines.push('No data flows between the Pages, so each one stands alone inside the application.')
  }
  const problems = checkApplication(application)
  const errors = applicationErrors(problems)
  lines.push(
    errors.length === 0
      ? `Nothing is blocking it${problems.length > 0 ? `, with ${problems.length} thing(s) worth a look` : ''}.`
      : `${errors.length} thing(s) would stop it working: ${errors.map((one) => one.kind).join(', ')}.`
  )
  return lines
}

/** Whether a version is old enough that a stored application needs migrating before it is opened. */
export const needsMigration = (stored: PageVersion, current: PageVersion): boolean =>
  compareVersions(stored, current) < 0

export const APPLICATION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'An application refers to Pages by id and never copies them, so a Page stays openable on its own and may belong to several applications.',
  'Removing a Page from an application is not a deletion, and everything that pointed at it — bindings, owned values, flows — is cleaned up in the same step.',
  'Every shared value names exactly one Page allowed to write it. A write by anything else is refused rather than reported later.',
  'A Page cannot touch shared state it has not declared a binding for.',
  'Data contracts carry versions, and a producer and consumer on different versions is refused unless an adapter declares the conversion.',
  'An adapter states what it cannot supply, so a lossy conversion is visible rather than a silent rename.',
  'An exact route always beats a dynamic one, so adding a general route cannot swallow a specific one.',
  'Hidden means hidden from the navigation, never without an address: a hidden Page still resolves, because taking away the address would break every saved link.',
  'Route segments are names, not path walks. ".." is refused rather than resolved.',
  'Validation separates errors that stop the application working from warnings that mean something is probably unintended.',
  'A data-flow loop is reported as an error with the Pages in it, rather than returning a run order that quietly omits them.',
  'Staleness is computed from the declared flows, which is what lets a result say it is based on outdated input instead of presenting old numbers as current.',
  'The description is derived from what the application contains, so it cannot claim a capability that is not there.'
])
