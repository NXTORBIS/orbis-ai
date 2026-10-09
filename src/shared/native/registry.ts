import {
  readManifest,
  sizeAtMost,
  type AppDomain,
  type AppPermission,
  type DataKind,
  type ManifestProblem,
  type NativeAppManifest,
  type AppSize
} from './manifest.ts'

/**
 * The register of Native Apps: what exists, what each can do, and how one is found.
 *
 * **One registry, read by both doors.** Orion and Search Labs ask the same functions here. That is the single most
 * important property of this file: the alternative — a list for the composer and a list for the model — produces a
 * search result nothing can launch, or a model promising an app that is not there. Spec §114 states it directly, and
 * `discover` is the only ranking function in the codebase that either door uses.
 *
 * ## Capabilities are learned, not enumerated
 *
 * There is no list of valid capability ids here. Apps declare them and the index is built from what registered, so
 * Phase 2 adding `executeCode` and Phase 3 adding `simulateNBody` change no file in this directory. A capability with
 * no app providing it does not exist, and `providersOf` returning nothing is the honest answer that lets Orion fall
 * back to answering normally instead of pretending.
 *
 * ## Availability is separate from existence
 *
 * An app can be registered and not openable — a missing engine, a permission refused, a resource the machine has not
 * got. Those are different states and they get different answers, because "there is no circuit simulator" and "the
 * circuit simulator needs a GPU this machine has not got" send somebody to entirely different places. `launchable`
 * returns the reason; it never returns a bare false.
 *
 * Pure and immutable. Every mutating function returns a new registry. No clock — `now` is passed in where it matters.
 */

export interface RegistryError {
  error: 'invalid-manifest' | 'duplicate-id' | 'duplicate-surface' | 'not-found'
  message: string
  problems?: readonly ManifestProblem[]
}

export const isRegistryError = (value: unknown): value is RegistryError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: RegistryError['error'], message: string, problems?: readonly ManifestProblem[]): RegistryError => ({
  error,
  message,
  ...(problems ? { problems } : {})
})

// ---------------------------------------------------------------- what the runtime can offer

/**
 * What this machine and this build can actually provide.
 *
 * Supplied by the main process, never guessed in here. A pure module cannot know whether a GPU exists, and a pure
 * module that assumes one is how an app gets offered and then fails to open.
 */
export interface Readiness {
  /** Permissions the runtime can satisfy at all. A permission absent from this set makes an app unavailable. */
  available: readonly AppPermission[]
  /** Engine names the main process has. An app whose engine is missing cannot run. */
  engines: readonly string[]
  /** Capability ids the user has explicitly turned off, if any. */
  disabled?: readonly string[]
}

export const FULL_READINESS: Readiness = Object.freeze({
  available: Object.freeze([
    'compute',
    'worker',
    'file.read',
    'file.write',
    'clipboard.read',
    'clipboard.write',
    'browser.read'
  ]) as readonly AppPermission[],
  engines: Object.freeze([]) as readonly string[]
})

// ---------------------------------------------------------------- the registry

export interface RegisteredApp {
  manifest: NativeAppManifest
  /** When it was registered. Only used to break ties in discovery deterministically. */
  at: number
}

export interface Registry {
  readonly apps: Readonly<Record<string, RegisteredApp>>
  /** capability id → app ids, newest registration last. Derived; the apps map is the authority. */
  readonly byCapability: Readonly<Record<string, readonly string[]>>
}

export const EMPTY: Registry = Object.freeze({ apps: Object.freeze({}), byCapability: Object.freeze({}) })

/** Rebuilt from the apps map rather than patched, so the index can never drift from what is registered. */
function index(apps: Readonly<Record<string, RegisteredApp>>): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, string[]> = {}
  const ordered = Object.values(apps).sort((a, b) => a.at - b.at || a.manifest.id.localeCompare(b.manifest.id))
  for (const one of ordered) {
    for (const capability of one.manifest.capabilities) {
      const held = out[capability.id] ?? []
      held.push(one.manifest.id)
      out[capability.id] = held
    }
  }
  return Object.freeze(out)
}

/**
 * An app registered, or the reason it was not.
 *
 * Two surfaces pointing at the same component is refused as well as two apps sharing an id: a duplicate surface means
 * two entries in Search Labs that open the same thing, which looks like a bug to whoever finds it and is one.
 */
export function register(registry: Registry, raw: unknown, now: number): Registry | RegistryError {
  const read = readManifest(raw)
  if (!read.ok) {
    const first = read.problems[0]
    return fail('invalid-manifest', `That app cannot be registered: ${first.field ? `${first.field} — ` : ''}${first.says}`, read.problems)
  }
  const manifest = read.manifest

  if (registry.apps[manifest.id]) return fail('duplicate-id', `An app called "${manifest.id}" is already registered.`)

  const wanted = `${manifest.surface.kind}:${manifest.surface.ref}`
  for (const held of Object.values(registry.apps)) {
    if (`${held.manifest.surface.kind}:${held.manifest.surface.ref}` === wanted) {
      return fail('duplicate-surface', `"${held.manifest.id}" already mounts ${wanted}. Two entries that open the same thing is a bug, not a feature.`)
    }
  }

  const apps = Object.freeze({ ...registry.apps, [manifest.id]: { manifest, at: now } })
  return Object.freeze({ apps, byCapability: index(apps) })
}

/** Several at once. Stops at the first failure and says which, because a half-registered catalogue is worse. */
export function registerAll(registry: Registry, list: readonly unknown[], now: number): Registry | RegistryError {
  let next = registry
  for (const raw of list) {
    const made = register(next, raw, now)
    if (isRegistryError(made)) return made
    next = made
  }
  return next
}

export function unregister(registry: Registry, id: string): Registry | RegistryError {
  if (!registry.apps[id]) return fail('not-found', `There is no app called "${id}".`)
  const apps: Record<string, RegisteredApp> = { ...registry.apps }
  delete apps[id]
  return Object.freeze({ apps: Object.freeze(apps), byCapability: index(apps) })
}

export const appById = (registry: Registry, id: string): NativeAppManifest | null => registry.apps[id]?.manifest ?? null

/**
 * Every app worth offering.
 *
 * A superseded app is left out: something better now does its job, and listing both would make the catalogue
 * claim two tools for one task. It is still in `registry.apps`, so `appById` finds it and an instance already
 * open keeps working -- see `supersededBy` on the manifest.
 */
export const allApps = (registry: Registry): readonly NativeAppManifest[] =>
  Object.values(registry.apps)
    .map((one) => one.manifest)
    .filter((one) => one.supersededBy === undefined)
    .sort((a, b) => a.name.localeCompare(b.name))

/** Including the retired ones. For anything that has to account for every app rather than offer them. */
export const everyApp = (registry: Registry): readonly NativeAppManifest[] =>
  Object.values(registry.apps)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
    .map((one) => one.manifest)

/** What superseded this app, following a chain if one app was retired twice. Null when it is current. */
export function supersederOf(registry: Registry, id: string): NativeAppManifest | null {
  const seen = new Set<string>([id])
  let at = registry.apps[id]?.manifest ?? null
  while (at?.supersededBy !== undefined) {
    if (seen.has(at.supersededBy)) return null
    seen.add(at.supersededBy)
    const next = registry.apps[at.supersededBy]?.manifest ?? null
    if (!next) return null
    at = next
  }
  return at && at.id !== id ? at : null
}

export const inDomain = (registry: Registry, domain: AppDomain): readonly NativeAppManifest[] =>
  allApps(registry).filter((one) => one.domain === domain)

/** Every capability any app provides, with how many provide it. The vocabulary, as it actually stands. */
export function capabilities(registry: Registry): readonly { id: string; summary: string; apps: number }[] {
  const out = new Map<string, { id: string; summary: string; apps: number }>()
  for (const one of Object.values(registry.apps)) {
    for (const capability of one.manifest.capabilities) {
      const held = out.get(capability.id)
      // The first app to declare it owns the wording, so the summary does not change with registration order.
      if (held) held.apps += 1
      else out.set(capability.id, { id: capability.id, summary: capability.summary, apps: 1 })
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * The apps that provide a capability.
 *
 * A superseded app does not provide anything any more -- whatever it declared goes to the app that replaced it,
 * so a request for `periodicTable` opens the studio rather than the retired laboratory. The replacement is
 * included even if it never declared the capability itself, because that is what taking over the job means.
 */
export const providersOf = (registry: Registry, capability: string): readonly NativeAppManifest[] => {
  const out: NativeAppManifest[] = []
  const already = new Set<string>()
  for (const id of registry.byCapability[capability] ?? []) {
    const manifest = registry.apps[id]?.manifest
    if (!manifest) continue
    const current = manifest.supersededBy === undefined ? manifest : supersederOf(registry, id)
    if (!current || already.has(current.id)) continue
    already.add(current.id)
    out.push(current)
  }
  return out
}

// ---------------------------------------------------------------- can it open

export type Unavailable =
  | { why: 'engine'; says: string; needs: string }
  | { why: 'permission'; says: string; needs: AppPermission }
  | { why: 'disabled'; says: string }

export interface Launchable {
  ok: boolean
  /** Present when ok is false. Says what is missing, so nothing has to guess. */
  blocked?: Unavailable
}

/**
 * Whether an app can actually be opened right now.
 *
 * Checked before an app appears as openable anywhere — which is what stops the eighteen-dead-rows failure the browser
 * panel had, where a row rendered as live because nothing ever asked whether its destination existed.
 */
export function launchable(manifest: NativeAppManifest, readiness: Readiness): Launchable {
  if (manifest.engine !== null && !readiness.engines.includes(manifest.engine)) {
    return {
      ok: false,
      blocked: {
        why: 'engine',
        says: `${manifest.name} computes through the ${manifest.engine} engine, which is not available in this build.`,
        needs: manifest.engine
      }
    }
  }

  const can = new Set(readiness.available)
  for (const permission of manifest.permissions) {
    if (!can.has(permission)) {
      return {
        ok: false,
        blocked: {
          why: 'permission',
          says: `${manifest.name} needs ${readPermission(permission)}, which is not available here.`,
          needs: permission
        }
      }
    }
  }

  const off = new Set(readiness.disabled ?? [])
  if (manifest.capabilities.every((one) => off.has(one.id)) && manifest.capabilities.length > 0) {
    return { ok: false, blocked: { why: 'disabled', says: `${manifest.name} has been turned off in settings.` } }
  }

  return { ok: true }
}

const PERMISSION_WORDS: Readonly<Record<AppPermission, string>> = Object.freeze({
  compute: 'the computation engines',
  worker: 'a background thread',
  gpu: 'graphics acceleration',
  'file.read': 'reading files',
  'file.write': 'writing files',
  'clipboard.read': 'reading the clipboard',
  'clipboard.write': 'writing to the clipboard',
  network: 'the network',
  process: 'running a separate program',
  'browser.read': 'reading the current page',
  camera: 'the camera',
  microphone: 'the microphone'
})

export const readPermission = (permission: AppPermission): string => PERMISSION_WORDS[permission] ?? permission

/** The size an app may actually open at, which is never larger than it said it supports. */
export const sizeFor = (manifest: NativeAppManifest, wanted?: AppSize): AppSize =>
  sizeAtMost(wanted ?? manifest.opensAt, manifest.largest)

// ---------------------------------------------------------------- discovery

export interface DiscoveryContext {
  /** Apps used before, most recent first. Profile-local; never a cloud list. */
  recent?: readonly string[]
  /** Capability ids the conversation has already been about: a weak nudge, not a filter. */
  about?: readonly string[]
  /** Domains the conversation has been about. */
  domains?: readonly AppDomain[]
}

export interface Hit {
  manifest: NativeAppManifest
  score: number
  /** Why it matched, in words. Shown in Search Labs so a surprising result explains itself. */
  because: string
  /** Set when it matched but cannot open. The row says so rather than pretending. */
  blocked?: Unavailable
}

const WEIGHT = Object.freeze({
  capabilityExact: 60,
  nameExact: 50,
  namePrefix: 34,
  nameWord: 26,
  aliasExact: 50,
  aliasWord: 18,
  tag: 16,
  /**
   * Per word of a multi-word tag found in the query as a phrase.
   *
   * "confusion matrix" found the Matrix Laboratory, because one incidental word of the name outweighed a tag that
   * matched the whole question. A phrase of several words is much rarer than one word, so it counts for each word
   * in it -- which is what makes the app that covers the subject win over one that merely shares a word.
   */
  tagPhrase: 30,
  /**
   * A tag that is the whole question.
   *
   * "quicksort" is the CS Studio's tag exactly, and also one word of the Algorithm Comparison's alias
   * "quicksort vs merge sort" -- which scored higher, so typing one algorithm's name opened the tool for
   * comparing several. A tag is a deliberate statement that the app covers a subject; when it answers the
   * entire question, an incidental word elsewhere should not beat it.
   */
  tagIsTheQuestion: 44,
  capabilityWord: 14,
  summaryWord: 7,
  domainWord: 6,
  contextCapability: 10,
  contextDomain: 5,
  recentMost: 9
})

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((one) => one.length > 1)

/**
 * Apps for a query, ranked.
 *
 * Capability match first, then name, then alias, then tag, then description — because somebody typing "gravity" wants
 * the thing that simulates gravity, not the thing whose summary happens to contain the word. Alphabetical ordering, or
 * registration order, would make the list look arbitrary to the one person it matters to.
 *
 * An empty query is not an error: it returns recent apps and then a context-ranked list, which is what Search Labs
 * shows before anything is typed.
 */
export function discover(registry: Registry, query: string, readiness: Readiness, context: DiscoveryContext = {}): readonly Hit[] {
  const asked = query.trim().toLowerCase()
  const terms = words(asked)
  const recent = context.recent ?? []
  const aboutCapabilities = new Set(context.about ?? [])
  const aboutDomains = new Set(context.domains ?? [])

  const hits: Hit[] = []

  for (const held of Object.values(registry.apps)) {
    const manifest = held.manifest
    /*
     * A retired app is not a result.
     *
     * Something better now does its job, so offering it in search would hand somebody the worse of two tools for
     * the same task -- and it is not in the catalogue either, so a row that opened it would come from nowhere.
     */
    if (manifest.supersededBy !== undefined) continue
    let score = 0
    const reasons: string[] = []

    if (terms.length > 0) {
      const name = manifest.name.toLowerCase()
      if (name === asked) {
        score += WEIGHT.nameExact
        reasons.push('name')
      } else if (name.startsWith(asked)) {
        score += WEIGHT.namePrefix
        reasons.push('name')
      } else {
        const nameWords = new Set(words(manifest.name))
        const matched = terms.filter((one) => nameWords.has(one)).length
        if (matched > 0) {
          score += WEIGHT.nameWord * matched
          reasons.push('name')
        }
      }

      for (const alias of manifest.aliases) {
        const lower = alias.toLowerCase()
        if (lower === asked) {
          score += WEIGHT.aliasExact
          reasons.push(`also called "${alias}"`)
          break
        }
        const aliasWords = new Set(words(alias))
        if (terms.some((one) => aliasWords.has(one))) {
          score += WEIGHT.aliasWord
          reasons.push(`also called "${alias}"`)
          break
        }
      }

      /*
       * A capability id, asked for in words.
       *
       * The filler words come out before comparing, because "visualize an algorithm" and "visualizeAlgorithm"
       * are the same request and the "an" was enough to miss it entirely -- which sent the question to a
       * different laboratory with no sign that anything had gone wrong.
       */
      const askedAsId = asked
        // Word boundaries matter: without them this strips the "a" out of the middle of "algorithm".
        .replace(/\b(?:a|an|the|some|my|this|that)\b/g, ' ')
        .replace(/\s+/g, '')
      for (const capability of manifest.capabilities) {
        const lower = capability.id.toLowerCase()
        if (lower === asked.replace(/\s+/g, '') || lower === askedAsId) {
          score += WEIGHT.capabilityExact
          reasons.push(capability.summary)
          break
        }
        const capWords = new Set([...words(capability.id.replace(/([A-Z])/g, ' $1')), ...words(capability.summary)])
        if (terms.some((one) => capWords.has(one))) {
          score += WEIGHT.capabilityWord
          reasons.push(capability.summary)
          break
        }
      }

      /*
       * A tag of several words could never match anything.
       *
       * Terms are single words, so `terms.includes('hash table')` was always false — and every multi-word tag in the
       * catalogue, of which there are many, was dead weight that looked like coverage. A tag of one word still
       * matches a term; a tag of several now matches when the query contains it as a phrase.
       */
      let tagged = 0
      let phrased = 0
      let answered = 0
      for (const one of manifest.tags) {
        const lower = one.toLowerCase()
        /*
         * The tag answers the whole question, which is a much stronger signal than matching part of it.
         *
         * Compared with the spaces taken out, because people write both: "quicksort" and "quick sort" are the
         * same request, and the catalogue happens to spell it one way. Without this, typing the compound form
         * matched nothing and a search for one algorithm opened the tool for comparing several.
         */
        if (lower === asked || lower.replace(/\s+/g, '') === asked.replace(/\s+/g, '')) {
          answered += 1
          continue
        }
        if (lower.includes(' ')) {
          if (asked.includes(lower)) phrased += lower.split(' ').filter(Boolean).length
        } else if (terms.includes(lower)) tagged += 1
      }
      if (tagged > 0 || phrased > 0 || answered > 0) {
        score += WEIGHT.tag * tagged + WEIGHT.tagPhrase * phrased + WEIGHT.tagIsTheQuestion * answered
        reasons.push(answered > 0 ? 'exactly what it covers' : 'what it covers')
      }

      const summaryWords = new Set(words(manifest.summary))
      const inSummary = terms.filter((one) => summaryWords.has(one)).length
      if (inSummary > 0) {
        score += WEIGHT.summaryWord * inSummary
        reasons.push('its description')
      }

      if (terms.includes(manifest.domain)) {
        score += WEIGHT.domainWord
        reasons.push(manifest.domain)
      }

      if (score === 0) continue
    }

    // Context is a nudge and never a filter: an app that matched the query stays, ranked a little differently.
    if (manifest.capabilities.some((one) => aboutCapabilities.has(one.id))) score += WEIGHT.contextCapability
    if (aboutDomains.has(manifest.domain)) score += WEIGHT.contextDomain

    const at = recent.indexOf(manifest.id)
    if (at >= 0) {
      score += Math.max(1, WEIGHT.recentMost - at)
      if (terms.length === 0) reasons.push('used recently')
    }

    if (terms.length === 0 && score === 0) score = 1

    const can = launchable(manifest, readiness)
    hits.push({
      manifest,
      score,
      because: reasons.length > 0 ? reasons.slice(0, 2).join(' · ') : manifest.summary,
      ...(can.ok ? {} : { blocked: can.blocked })
    })
  }

  return hits.sort(
    (a, b) =>
      // An app that can open outranks one that cannot at the same score: offering the broken one first is a dead end.
      b.score - a.score ||
      Number(Boolean(a.blocked)) - Number(Boolean(b.blocked)) ||
      a.manifest.name.localeCompare(b.manifest.name)
  )
}

/**
 * The best app for a capability, or nothing.
 *
 * This is the function Orion resolves an intent through. It returns null rather than a guess, and null means Orion
 * answers normally — which is the correct outcome far more often than opening something approximately right.
 */
export function resolve(registry: Registry, capability: string, readiness: Readiness, context: DiscoveryContext = {}): NativeAppManifest | null {
  const providers = providersOf(registry, capability)
  if (providers.length === 0) return null

  const scored = providers.map((manifest) => {
    let score = 0
    if ((context.recent ?? []).includes(manifest.id)) score += 10 - (context.recent ?? []).indexOf(manifest.id)
    if ((context.domains ?? []).includes(manifest.domain)) score += 5
    // An app that declares fewer capabilities is the more specific tool for this one.
    score += Math.max(0, 12 - manifest.capabilities.length)
    const can = launchable(manifest, readiness)
    return { manifest, score, ok: can.ok }
  })

  const open = scored.filter((one) => one.ok)
  const pool = open.length > 0 ? open : scored
  pool.sort((a, b) => b.score - a.score || a.manifest.name.localeCompare(b.manifest.name))
  return pool[0]?.manifest ?? null
}

// ---------------------------------------------------------------- composition

export interface Flow {
  from: string
  to: string
  /** The data kinds they have in common. Never empty — a flow with nothing in common is not returned. */
  kinds: readonly DataKind[]
}

/**
 * Which apps could be fed by which, worked out from declared data kinds.
 *
 * The foundation for "export this and analyse it" without a hardcoded pair list. Coarse on purpose: it answers
 * *could*, and the apps themselves decide whether a particular payload makes sense. A precise guess would be wrong
 * more often than a coarse fact.
 */
export function dataFlows(registry: Registry): readonly Flow[] {
  const out: Flow[] = []
  const apps = allApps(registry)
  for (const from of apps) {
    if (from.produces.length === 0) continue
    for (const to of apps) {
      if (to.id === from.id || to.accepts.length === 0) continue
      const shared = from.produces.filter((one) => to.accepts.includes(one))
      if (shared.length > 0) out.push({ from: from.id, to: to.id, kinds: shared })
    }
  }
  return out
}

/** Apps that could take what this one produces. */
export const consumersOf = (registry: Registry, id: string): readonly NativeAppManifest[] => {
  const from = appById(registry, id)
  if (!from) return []
  return allApps(registry).filter((to) => to.id !== id && from.produces.some((kind) => to.accepts.includes(kind)))
}
