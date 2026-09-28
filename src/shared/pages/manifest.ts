/**
 * What a Page declares about itself.
 *
 * The manifest is the whole of what Orbis knows about a Page before any of it runs -- what it is called, what it does,
 * what it needs, which runtime it was written against, and what it wants permission for. Everything that decides whether
 * a Page may open, whether it may be indexed, and whether an update needs reviewing is read from here.
 *
 * Which makes it untrusted input. A manifest may have come from a template, from a generator, from a file somebody was
 * sent, or from a Page that was edited by hand. So it is validated rather than read: every field is checked, every length
 * is capped, every unknown value is refused, and a manifest that does not validate does not run. There is no path here
 * that repairs a manifest and continues, because a repaired manifest is one whose author did not write what runs.
 *
 * Two versions live in here and they are not the same number:
 *
 * ```
 * schemaVersion   the shape of this file
 * version         the Page's own version, which its author bumps
 * ```
 *
 * Confusing them means a Page can claim a manifest shape it was not written for.
 *
 * Pure. No network, no clock, no storage.
 */

import { checkDeclarations, capabilityById, type DeclarationProblem } from './capabilities.ts'
import {
  checkSlug,
  compareVersions,
  isPageId,
  MAX_SLUG_LENGTH,
  parseVersion,
  versionToText,
  type PageOwner,
  type PageVersion
} from './identity.ts'

/** The shape of the manifest file. Bumped when the structure changes, never when a Page changes. */
export const MANIFEST_SCHEMA_VERSION = 1

/**
 * The version of the Page runtime in this build of Orbis.
 *
 * A Page declares the oldest runtime it works against. This is the number that gets compared with it, and the comparison
 * is what stops a Page written for a future Orbis from half-running in this one.
 */
export const PAGE_RUNTIME_VERSION: PageVersion = Object.freeze({ major: 1, minor: 0, patch: 0 })

// ---------------------------------------------------------------- the shape

/**
 * What kind of thing a Page is.
 *
 * Deliberately an open string rather than a closed union. The list below is what Orbis suggests, not what it permits: a
 * future Page that is a kind nobody has thought of yet should not need a change here in order to exist.
 */
export type PageKind = string

export const SUGGESTED_KINDS: readonly PageKind[] = [
  'calculator',
  'solver',
  'converter',
  'laboratory',
  'simulator',
  'analyzer',
  'visualizer',
  'explorer',
  'editor',
  'builder',
  'generator',
  'planner',
  'reference',
  'lesson',
  'workspace',
  'utility'
]

/**
 * A category, written as a dotted path.
 *
 * `science.physics.mechanics`. Hierarchical without a fixed depth, so a subject that turns out to need four levels does
 * not require the registry to change.
 */
export type PageCategory = string

export interface PageSearchMetadata {
  /** A sentence describing what the Page is for, in the words somebody would search with. */
  summary: string
  keywords: string[]
  /** What somebody would be trying to do. Used to tell a tool-seeking search from an informational one. */
  intents: string[]
  /** Other names for the same thing. */
  aliases: string[]
}

export interface PageDependency {
  /** A shared engine, by id. */
  id: string
  /** The oldest version that will do. */
  atLeast: PageVersion
  /** Whether the Page still works without it. */
  optional: boolean
}

export interface PageManifest {
  schemaVersion: number
  pageId: string
  slug: string
  title: string
  /** One or two sentences. What the Page does, not how good it is. */
  description: string
  version: PageVersion
  kind: PageKind
  categories: PageCategory[]
  tags: string[]
  /** A short generic word for the Page's icon. Never a brand. */
  icon: string
  owner: PageOwner
  /** The oldest Page runtime this was written against. */
  runtimeAtLeast: PageVersion
  /** Capability ids the Page is asking for. A request, never a permission. */
  capabilities: string[]
  /** Why each capability that has to justify itself is needed, keyed by capability id. */
  capabilityReasons: Record<string, string>
  dependencies: PageDependency[]
  search: PageSearchMetadata
  /** Whether everything the Page does works with no network. */
  offline: boolean
  /** What the Page cannot do, in its own words. Shown rather than discovered. */
  limitations: string[]
  /**
   * The kinds of message this Page will accept from another Page.
   *
   * Empty for almost every Page, and that is the safe default: a Page that has not said it accepts something cannot
   * have it pushed at it. Declaring a kind here is one half of the permission to send -- the sender still needs
   * `page.send` scoped to this Page, and neither half is enough on its own.
   */
  accepts: PageAcceptance[]
  /** Language codes the Page has text for. */
  languages: string[]
}

/** One kind of message a Page will take, and what it does with it. */
export interface PageAcceptance {
  /** A dotted name, like `table.rows`. The same shape as an operation name. */
  kind: string
  /** What the Page does with it, shown in the prompt before anything is sent. */
  describe: string
  /** Whether the sender gets an answer back. */
  replies: boolean
}

// ---------------------------------------------------------------- limits

/** Caps, so a generated manifest cannot become a denial of service or a wall of text in a list. */
export const LIMITS = Object.freeze({
  title: 80,
  description: 400,
  summary: 300,
  icon: 40,
  kind: 40,
  category: 120,
  tag: 40,
  keyword: 60,
  intent: 40,
  alias: 80,
  limitation: 200,
  reason: 300,
  categories: 8,
  tags: 24,
  keywords: 32,
  intents: 12,
  aliases: 12,
  limitations: 12,
  /** Kinds of message one Page may accept. Small: a Page that takes twenty kinds is a Page nobody can reason about. */
  accepts: 8,
  dependencies: 24,
  capabilities: 32,
  languages: 16
})

// ---------------------------------------------------------------- validation

export type ProblemSeverity = 'error' | 'warning'

export interface ManifestProblem {
  /** Where in the manifest, as a dotted path, so a Page editor can point at the field. */
  path: string
  code: string
  severity: ProblemSeverity
  message: string
}

const error = (path: string, code: string, message: string): ManifestProblem => ({ path, code, severity: 'error', message })
const warning = (path: string, code: string, message: string): ManifestProblem => ({ path, code, severity: 'warning', message })

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null
  if (value.some((one) => typeof one !== 'string')) return null
  return value as string[]
}

/** A category path, checked. Lower-case dotted segments, so two spellings cannot become two categories. */
export function checkCategory(category: string): string | null {
  const text = String(category ?? '')
  if (text === '') return 'A category cannot be empty.'
  if (text.length > LIMITS.category) return `A category may be at most ${LIMITS.category} characters.`
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(text)) {
    return 'A category is lower-case words separated by dots, like science.physics.mechanics.'
  }
  return null
}

/**
 * A tag, checked.
 *
 * Case-insensitive, unlike a category. The difference is deliberate: a category is a controlled hierarchy that an author
 * looks up, so `Science` being refused points them at the real name -- while a tag is something somebody types, and
 * refusing `Kinematics` to insist on `kinematics` is a rule that exists only to be annoying. Reading a manifest
 * lower-cases tags, so the stored form is still canonical either way.
 */
export function checkTag(tag: string): string | null {
  const text = String(tag ?? '').trim()
  if (text === '') return 'A tag cannot be empty.'
  if (text.length > LIMITS.tag) return `A tag may be at most ${LIMITS.tag} characters.`
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(text)) return 'A tag is words joined by single dashes.'
  return null
}

/**
 * Whether a manifest is one Orbis will run.
 *
 * Returns every problem rather than the first, because a Page editor showing one error at a time makes fixing a manifest
 * a guessing game. Errors stop the Page; warnings are things that will make it work badly -- mostly discoverability --
 * and are worth saying without refusing.
 */
export function validateManifest(raw: unknown): ManifestProblem[] {
  const problems: ManifestProblem[] = []
  if (!isPlainObject(raw)) {
    return [error('', 'not-an-object', 'A manifest has to be an object.')]
  }

  // ---- schema version. Checked first: everything below assumes this shape.
  if (raw.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion)) {
      problems.push(error('schemaVersion', 'bad-schema-version', 'A manifest has to say which schema version it is.'))
    } else if (raw.schemaVersion > MANIFEST_SCHEMA_VERSION) {
      problems.push(
        error(
          'schemaVersion',
          'schema-too-new',
          `This Page was written for a newer Orbis (manifest version ${raw.schemaVersion}; this one reads ${MANIFEST_SCHEMA_VERSION}).`
        )
      )
    } else {
      // An older schema is a migration, and migrating is not validating. Named as such so the caller routes it correctly.
      problems.push(
        error('schemaVersion', 'schema-needs-migration', `This manifest is version ${raw.schemaVersion} and needs migrating to ${MANIFEST_SCHEMA_VERSION}.`)
      )
    }
  }

  // ---- identity
  if (!isPageId(raw.pageId)) {
    problems.push(error('pageId', 'bad-page-id', 'A manifest needs a Page id Orbis generated.'))
  }
  const slugProblem = typeof raw.slug === 'string' ? checkSlug(raw.slug) : { message: 'A manifest needs an address.' }
  if (slugProblem) problems.push(error('slug', 'bad-slug', slugProblem.message))

  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    problems.push(error('title', 'no-title', 'A Page needs a name.'))
  } else if (raw.title.length > LIMITS.title) {
    problems.push(error('title', 'title-too-long', `A name may be at most ${LIMITS.title} characters.`))
  }

  if (typeof raw.description !== 'string' || raw.description.trim().length < 10) {
    // Not a warning: a Page with no description cannot be found, and cannot be told apart from another in a list.
    problems.push(error('description', 'no-description', 'A Page needs a description of what it does.'))
  } else if (raw.description.length > LIMITS.description) {
    problems.push(error('description', 'description-too-long', `A description may be at most ${LIMITS.description} characters.`))
  }

  // ---- versions
  const version = typeof raw.version === 'string' ? parseVersion(raw.version) : null
  if (!version) problems.push(error('version', 'bad-version', 'A Page version is written as major.minor.patch.'))

  const runtime = typeof raw.runtimeAtLeast === 'string' ? parseVersion(raw.runtimeAtLeast) : null
  if (!runtime) {
    problems.push(error('runtimeAtLeast', 'bad-runtime-version', 'A Page has to say which Page runtime it needs.'))
  } else if (compareVersions(runtime, PAGE_RUNTIME_VERSION) > 0) {
    problems.push(
      error(
        'runtimeAtLeast',
        'runtime-too-old',
        `This Page needs Page runtime ${versionToText(runtime)}; this Orbis has ${versionToText(PAGE_RUNTIME_VERSION)}.`
      )
    )
  }

  // ---- kind
  if (typeof raw.kind !== 'string' || raw.kind === '') {
    problems.push(error('kind', 'no-kind', 'A Page has to say what kind of thing it is.'))
  } else if (raw.kind.length > LIMITS.kind || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.kind)) {
    problems.push(error('kind', 'bad-kind', 'A kind is lower-case words joined by single dashes.'))
  }

  if (typeof raw.owner !== 'string' || !['system', 'user', 'orion', 'imported'].includes(raw.owner)) {
    problems.push(error('owner', 'bad-owner', 'A Page has to say where it came from.'))
  }

  if (typeof raw.icon !== 'string' || raw.icon === '' || raw.icon.length > LIMITS.icon) {
    problems.push(error('icon', 'bad-icon', 'A Page needs a short generic word for its icon.'))
  }

  // ---- categories and tags
  const categories = asStringArray(raw.categories)
  if (!categories) {
    problems.push(error('categories', 'bad-categories', 'Categories have to be a list of text.'))
  } else {
    if (categories.length === 0) {
      problems.push(warning('categories', 'no-categories', 'A Page with no category is hard to come across.'))
    }
    if (categories.length > LIMITS.categories) {
      problems.push(error('categories', 'too-many-categories', `At most ${LIMITS.categories} categories.`))
    }
    categories.forEach((one, i) => {
      const complaint = checkCategory(one)
      if (complaint) problems.push(error(`categories[${i}]`, 'bad-category', complaint))
    })
    if (new Set(categories).size !== categories.length) {
      problems.push(error('categories', 'duplicate-category', 'A category is listed more than once.'))
    }
  }

  const tags = asStringArray(raw.tags)
  if (!tags) {
    problems.push(error('tags', 'bad-tags', 'Tags have to be a list of text.'))
  } else {
    if (tags.length > LIMITS.tags) problems.push(error('tags', 'too-many-tags', `At most ${LIMITS.tags} tags.`))
    tags.forEach((one, i) => {
      const complaint = checkTag(one)
      if (complaint) problems.push(error(`tags[${i}]`, 'bad-tag', complaint))
    })
    // Compared case-insensitively, because reading the manifest lower-cases them -- so `Physics` and `physics` would
    // otherwise pass validation and then silently collapse into one, losing a tag nobody was told about.
    const flattened = tags.map((one) => one.trim().toLowerCase())
    if (new Set(flattened).size !== flattened.length) {
      problems.push(error('tags', 'duplicate-tag', 'A tag is listed more than once.'))
    }
  }

  // ---- capabilities. The request, checked against the registry rather than taken at face value.
  const capabilities = asStringArray(raw.capabilities)
  const reasons = isPlainObject(raw.capabilityReasons) ? raw.capabilityReasons : {}
  if (!capabilities) {
    problems.push(error('capabilities', 'bad-capabilities', 'Capabilities have to be a list of text.'))
  } else {
    if (capabilities.length > LIMITS.capabilities) {
      problems.push(error('capabilities', 'too-many-capabilities', `At most ${LIMITS.capabilities} capabilities.`))
    }
    const reasonText: Record<string, string> = {}
    for (const [key, value] of Object.entries(reasons)) {
      if (typeof value !== 'string') {
        problems.push(error(`capabilityReasons.${key}`, 'bad-reason', 'A reason has to be text.'))
        continue
      }
      if (value.length > LIMITS.reason) {
        problems.push(error(`capabilityReasons.${key}`, 'reason-too-long', `A reason may be at most ${LIMITS.reason} characters.`))
        continue
      }
      reasonText[key] = value
    }
    for (const problem of checkDeclarations(capabilities, reasonText)) {
      problems.push(fromDeclarationProblem(problem, capabilities))
    }
    // A reason for something the Page did not declare is a sign the two lists have drifted apart.
    for (const key of Object.keys(reasonText)) {
      if (!capabilities.includes(key)) {
        problems.push(warning(`capabilityReasons.${key}`, 'orphan-reason', `"${key}" has a reason but is not declared.`))
      }
    }
  }

  // ---- dependencies
  if (!Array.isArray(raw.dependencies)) {
    problems.push(error('dependencies', 'bad-dependencies', 'Dependencies have to be a list.'))
  } else {
    if (raw.dependencies.length > LIMITS.dependencies) {
      problems.push(error('dependencies', 'too-many-dependencies', `At most ${LIMITS.dependencies} dependencies.`))
    }
    raw.dependencies.forEach((one, i) => {
      if (!isPlainObject(one)) {
        problems.push(error(`dependencies[${i}]`, 'bad-dependency', 'A dependency has to be an object.'))
        return
      }
      if (typeof one.id !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(one.id)) {
        problems.push(error(`dependencies[${i}].id`, 'bad-dependency-id', 'A dependency needs an id.'))
      }
      if (typeof one.atLeast !== 'string' || !parseVersion(one.atLeast)) {
        problems.push(error(`dependencies[${i}].atLeast`, 'bad-dependency-version', 'A dependency needs a version, as major.minor.patch.'))
      }
      if (one.optional !== undefined && typeof one.optional !== 'boolean') {
        problems.push(error(`dependencies[${i}].optional`, 'bad-dependency-optional', 'A dependency is optional or it is not.'))
      }
    })
  }

  // ---- search metadata
  if (!isPlainObject(raw.search)) {
    problems.push(error('search', 'bad-search', 'A Page needs search information, even if it is brief.'))
  } else {
    const search = raw.search
    if (typeof search.summary !== 'string' || search.summary.trim().length < 10) {
      problems.push(warning('search.summary', 'no-summary', 'Without a summary this Page will be hard to find.'))
    } else if (search.summary.length > LIMITS.summary) {
      problems.push(error('search.summary', 'summary-too-long', `A summary may be at most ${LIMITS.summary} characters.`))
    }
    for (const [field, limit, itemLimit] of [
      ['keywords', LIMITS.keywords, LIMITS.keyword],
      ['intents', LIMITS.intents, LIMITS.intent],
      ['aliases', LIMITS.aliases, LIMITS.alias]
    ] as const) {
      const list = asStringArray(search[field])
      if (!list) {
        problems.push(error(`search.${field}`, `bad-${field}`, `${field} have to be a list of text.`))
        continue
      }
      if (list.length > limit) problems.push(error(`search.${field}`, `too-many-${field}`, `At most ${limit} ${field}.`))
      list.forEach((one, i) => {
        if (one.trim() === '') problems.push(error(`search.${field}[${i}]`, 'empty-entry', 'An empty entry says nothing.'))
        else if (one.length > itemLimit) {
          problems.push(error(`search.${field}[${i}]`, 'entry-too-long', `At most ${itemLimit} characters.`))
        }
      })
      // The same word twenty times does not make a Page more relevant, and pretending it does is what keyword stuffing
      // is. Refused rather than ranked down, because ranking down is invisible to whoever wrote it.
      const lowered = list.map((one) => one.trim().toLowerCase())
      if (new Set(lowered).size !== lowered.length) {
        problems.push(error(`search.${field}`, `duplicate-${field}`, `An entry in ${field} is repeated.`))
      }
    }
  }

  // ---- the rest
  if (typeof raw.offline !== 'boolean') {
    problems.push(error('offline', 'bad-offline', 'A Page has to say whether it works without a network.'))
  } else if (raw.offline === true && capabilities?.some((id) => id.startsWith('network.'))) {
    // Two statements that cannot both be true, and the combination is the one that misleads people on a train.
    problems.push(error('offline', 'offline-contradiction', 'A Page that asks for network access does not work offline.'))
  }

  const limitations = asStringArray(raw.limitations)
  if (!limitations) {
    problems.push(error('limitations', 'bad-limitations', 'Limitations have to be a list of text.'))
  } else if (limitations.length > LIMITS.limitations) {
    problems.push(error('limitations', 'too-many-limitations', `At most ${LIMITS.limitations} limitations.`))
  } else {
    limitations.forEach((one, i) => {
      if (one.length > LIMITS.limitation) {
        problems.push(error(`limitations[${i}]`, 'limitation-too-long', `At most ${LIMITS.limitation} characters.`))
      }
    })
  }

  // Accepted message kinds. Absent is fine and means the Page talks to nobody, which is what almost every Page wants.
  if (raw.accepts !== undefined) {
    if (!Array.isArray(raw.accepts)) {
      problems.push(error('accepts', 'bad-accepts', 'What a Page accepts has to be a list.'))
    } else if (raw.accepts.length > LIMITS.accepts) {
      problems.push(error('accepts', 'too-many-accepts', `A Page may accept at most ${LIMITS.accepts} kinds of message.`))
    } else {
      raw.accepts.forEach((one, i) => {
        const entry = one as Record<string, unknown>
        if (!entry || typeof entry !== 'object') {
          problems.push(error(`accepts[${i}]`, 'bad-acceptance', 'Each accepted kind is an object.'))
          return
        }
        // The same pattern an operation name has to match, and for the same reason: a pattern says "is this a name at
        // all", which is safe against a name nobody thought of.
        if (typeof entry.kind !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(entry.kind)) {
          problems.push(error(`accepts[${i}].kind`, 'bad-acceptance-kind', 'An accepted kind is a dotted name like "table.rows".'))
        }
        if (typeof entry.describe !== 'string' || entry.describe.trim() === '') {
          // Required, because it is what somebody reads before allowing one Page to push data into another.
          problems.push(
            error(`accepts[${i}].describe`, 'bad-acceptance-describe', 'Say what this Page does with that kind of message.')
          )
        }
      })
    }
  }

  const languages = asStringArray(raw.languages)
  if (!languages) {
    problems.push(error('languages', 'bad-languages', 'Languages have to be a list of codes.'))
  } else {
    if (languages.length === 0) problems.push(error('languages', 'no-languages', 'A Page has to say which language its text is in.'))
    if (languages.length > LIMITS.languages) problems.push(error('languages', 'too-many-languages', `At most ${LIMITS.languages} languages.`))
    languages.forEach((one, i) => {
      if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(one)) {
        problems.push(error(`languages[${i}]`, 'bad-language', `"${one}" is not a language code.`))
      }
    })
  }

  return problems
}

function fromDeclarationProblem(problem: DeclarationProblem, capabilities: string[]): ManifestProblem {
  const at = capabilities.indexOf(problem.capabilityId)
  const path = problem.error === 'missing-reason' ? `capabilityReasons.${problem.capabilityId}` : `capabilities[${at < 0 ? 0 : at}]`
  return error(path, `capability-${problem.error}`, problem.message)
}

export const manifestErrors = (problems: ManifestProblem[]): ManifestProblem[] => problems.filter((one) => one.severity === 'error')

export const manifestIsValid = (raw: unknown): boolean => manifestErrors(validateManifest(raw)).length === 0

// ---------------------------------------------------------------- reading one in

/**
 * A validated manifest turned into the object the rest of Orbis uses.
 *
 * Returns null when it does not validate, rather than a partially-filled object -- because a half-read manifest is the
 * thing most likely to be used by accident. Validation and construction are one step for exactly that reason.
 *
 * Normalising happens here and nowhere else: text is trimmed, tags are sorted and lower-cased, optional fields are
 * filled. None of it changes meaning; all of it means two manifests describing the same Page compare equal.
 */
export function readManifest(raw: unknown): { manifest: PageManifest; warnings: ManifestProblem[] } | { problems: ManifestProblem[] } {
  const problems = validateManifest(raw)
  const fatal = manifestErrors(problems)
  if (fatal.length > 0) return { problems }

  const o = raw as Record<string, unknown>
  const search = o.search as Record<string, unknown>
  const tidyList = (value: unknown, cap: number): string[] =>
    [...new Set((asStringArray(value) ?? []).map((one) => one.trim()).filter((one) => one !== ''))].slice(0, cap)

  const manifest: PageManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: o.pageId as string,
    slug: o.slug as string,
    title: (o.title as string).trim(),
    description: (o.description as string).trim(),
    version: parseVersion(o.version as string)!,
    kind: o.kind as string,
    // Sorted, so the same categories in a different order are the same manifest.
    categories: tidyList(o.categories, LIMITS.categories).sort(),
    tags: tidyList(o.tags, LIMITS.tags).map((one) => one.toLowerCase()).sort(),
    icon: (o.icon as string).trim(),
    owner: o.owner as PageOwner,
    runtimeAtLeast: parseVersion(o.runtimeAtLeast as string)!,
    capabilities: [...new Set(asStringArray(o.capabilities) ?? [])].sort(),
    capabilityReasons: Object.fromEntries(
      Object.entries(isPlainObject(o.capabilityReasons) ? o.capabilityReasons : {})
        .filter(([key, value]) => typeof value === 'string' && (asStringArray(o.capabilities) ?? []).includes(key))
        .map(([key, value]) => [key, (value as string).trim()])
    ),
    dependencies: (Array.isArray(o.dependencies) ? o.dependencies : []).map((one) => {
      const dependency = one as Record<string, unknown>
      return {
        id: dependency.id as string,
        atLeast: parseVersion(dependency.atLeast as string)!,
        optional: dependency.optional === true
      }
    }),
    search: {
      summary: typeof search.summary === 'string' ? search.summary.trim() : '',
      keywords: tidyList(search.keywords, LIMITS.keywords).map((one) => one.toLowerCase()),
      intents: tidyList(search.intents, LIMITS.intents).map((one) => one.toLowerCase()),
      aliases: tidyList(search.aliases, LIMITS.aliases)
    },
    offline: o.offline === true,
    limitations: tidyList(o.limitations, LIMITS.limitations),
    accepts: Array.isArray(o.accepts)
      ? (o.accepts as Record<string, unknown>[]).slice(0, LIMITS.accepts).map((one) => ({
          kind: String(one.kind ?? '').slice(0, 64),
          describe: String(one.describe ?? '').slice(0, 200),
          replies: one.replies === true
        }))
      : [],
    languages: tidyList(o.languages, LIMITS.languages)
  }

  return { manifest, warnings: problems.filter((one) => one.severity === 'warning') }
}

/** A manifest back to the plain object that gets written to a file. The inverse of `readManifest`. */
export function manifestToJson(manifest: PageManifest): Record<string, unknown> {
  return {
    schemaVersion: manifest.schemaVersion,
    pageId: manifest.pageId,
    slug: manifest.slug,
    title: manifest.title,
    description: manifest.description,
    version: versionToText(manifest.version),
    kind: manifest.kind,
    categories: manifest.categories,
    tags: manifest.tags,
    icon: manifest.icon,
    owner: manifest.owner,
    runtimeAtLeast: versionToText(manifest.runtimeAtLeast),
    capabilities: manifest.capabilities,
    capabilityReasons: manifest.capabilityReasons,
    dependencies: manifest.dependencies.map((one) => ({ id: one.id, atLeast: versionToText(one.atLeast), optional: one.optional })),
    search: manifest.search,
    offline: manifest.offline,
    limitations: manifest.limitations,
    accepts: manifest.accepts,
    languages: manifest.languages
  }
}

// ---------------------------------------------------------------- compatibility

export type CompatibilityState = 'compatible' | 'runtime-too-old' | 'schema-too-new' | 'needs-migration' | 'dependency-missing'

export interface Compatibility {
  state: CompatibilityState
  /** Whether the Page may run as it is. */
  canOpen: boolean
  /** Required dependencies the environment does not have. */
  missing: string[]
  /** Optional dependencies that are absent, which degrade the Page rather than stopping it. */
  degraded: string[]
  message: string
}

/**
 * Whether this Orbis can open this Page.
 *
 * A Page written for a newer runtime is refused rather than attempted, because a Page that half-runs has already written
 * to its own storage by the time the missing piece is discovered.
 */
export function compatibility(
  manifest: PageManifest,
  available: Readonly<Record<string, PageVersion>>,
  runtime: PageVersion = PAGE_RUNTIME_VERSION
): Compatibility {
  if (manifest.schemaVersion > MANIFEST_SCHEMA_VERSION) {
    return {
      state: 'schema-too-new',
      canOpen: false,
      missing: [],
      degraded: [],
      message: 'This Page was written for a newer version of Orbis.'
    }
  }
  if (manifest.schemaVersion < MANIFEST_SCHEMA_VERSION) {
    return {
      state: 'needs-migration',
      canOpen: false,
      missing: [],
      degraded: [],
      message: 'This Page needs updating before it can open.'
    }
  }
  if (compareVersions(manifest.runtimeAtLeast, runtime) > 0) {
    return {
      state: 'runtime-too-old',
      canOpen: false,
      missing: [],
      degraded: [],
      message: `This Page needs Page runtime ${versionToText(manifest.runtimeAtLeast)}; this Orbis has ${versionToText(runtime)}.`
    }
  }

  const missing: string[] = []
  const degraded: string[] = []
  for (const dependency of manifest.dependencies) {
    // Read with `hasOwnProperty`: a dependency called `constructor` matches the id pattern, and plain indexing would
    // find `Object.prototype.constructor` and then compare a function against a version.
    const have = Object.prototype.hasOwnProperty.call(available, dependency.id) ? available[dependency.id] : undefined
    const satisfied = have !== undefined && compareVersions(have, dependency.atLeast) >= 0
    if (satisfied) continue
    if (dependency.optional) degraded.push(dependency.id)
    else missing.push(dependency.id)
  }

  if (missing.length > 0) {
    return {
      state: 'dependency-missing',
      canOpen: false,
      missing,
      degraded,
      message: `This Page needs ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not available.`
    }
  }

  return {
    state: 'compatible',
    canOpen: true,
    missing: [],
    degraded,
    message:
      degraded.length === 0
        ? 'This Page can open.'
        : `This Page can open, without ${degraded.join(', ')}.`
  }
}

// ---------------------------------------------------------------- describing one

/**
 * What a Page asks for, in a sentence, ordered by how much it matters.
 *
 * For the review shown before a Page is installed or updated. Built from the capability registry rather than from the
 * Page's own words, so a Page cannot make something sound smaller than it is.
 */
export function describeRequests(manifest: PageManifest): { name: string; risk: string; reason: string }[] {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  return manifest.capabilities
    .map((id) => {
      const definition = capabilityById(id)
      return {
        name: definition?.name ?? id,
        risk: definition?.risk ?? 'critical',
        reason: manifest.capabilityReasons[id] ?? definition?.description ?? ''
      }
    })
    .sort((a, b) => (order[a.risk] ?? 0) - (order[b.risk] ?? 0))
}

/** A skeleton manifest, for a Page being created. Valid as it stands, so a new Page runs before it does anything. */
export function blankManifest(parts: { pageId: string; slug: string; title: string; owner?: PageOwner }): PageManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: parts.pageId,
    slug: parts.slug,
    title: parts.title,
    description: `${parts.title}, a Page in Orbis.`,
    version: { major: 0, minor: 1, patch: 0 },
    kind: 'utility',
    categories: [],
    tags: [],
    icon: 'page',
    owner: parts.owner ?? 'user',
    runtimeAtLeast: { major: 1, minor: 0, patch: 0 },
    // The two a Page cannot work without, and nothing else: whatever else it needs, somebody adds deliberately.
    capabilities: ['computation.arithmetic', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: { summary: '', keywords: [], intents: [], aliases: [] },
    offline: true,
    limitations: [],
    // Nothing, which is the safe default: a new Page cannot have data pushed at it until it says it takes some.
    accepts: [],
    languages: ['en']
  }
}

/** The manifest fields that, when they change, mean the Page has to be re-indexed. */
export const SEARCHABLE_FIELDS: readonly (keyof PageManifest)[] = ['title', 'description', 'categories', 'tags', 'search', 'kind']

/** Whether two manifests differ in anything search cares about. */
export function searchMetadataChanged(before: PageManifest, after: PageManifest): boolean {
  return SEARCHABLE_FIELDS.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
}

export { MAX_SLUG_LENGTH }
