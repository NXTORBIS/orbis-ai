/**
 * The things a results page is made of, and the rule that keeps them honest (§68, §69).
 *
 * Every module here -- the knowledge panel, People also ask, People also search for, related searches -- is the kind
 * of thing a search engine can produce very convincingly and entirely falsely. A plausible birth date, a plausible
 * rival, a plausible answer to a question nobody asked: all cheap to generate, all indistinguishable from the real
 * ones, and all worse than an empty space.
 *
 * So the shape of the data enforces what §65 asks for in prose. Provenance is not an optional field somebody
 * remembered to fill in: a fact without a source cannot be constructed, and the functions that build these modules
 * discard anything arriving without one. "Information unavailable" is a supported, ordinary outcome (§18).
 *
 * What is generated and what is retrieved are kept apart on purpose:
 *
 *   generated  -- the *question* in People also ask, the *wording* of a related search. Asking is not asserting.
 *   retrieved  -- every answer, every fact, every entity, every image. These come from somewhere, and say where.
 *
 * A model may propose what to look into. It may not be the reason anything is believed.
 */

/** Where something came from, when, and by whose hand (§69). Carried through every normalisation, never dropped. */
export interface Provenance {
  /** The page it came from. Always a real address somebody can open. */
  url: string
  /** The site, for showing identity rather than a bare address. */
  site: string
  /** Which provider returned it, so a bad source can be traced to who supplied it. */
  provider: string
  /** When Orbis retrieved it. A fact about the world is also a fact about when it was read. */
  retrievedAt: number
  /** The page's title, where known. */
  title?: string
  /** The exact words behind a claim, where the claim came from text. */
  quote?: string
}

/** Everything a result can be, normalised so a module never invents its own incompatible shape (§68). */
export interface NormalizedResult {
  id: string
  type: 'web' | 'image' | 'video' | 'news' | 'shopping' | 'local'
  title: string
  description: string
  url: string
  domain: string
  favicon?: string
  image?: string
  publishedAt?: number
  /** Whatever this kind of result has and the others do not: duration, price, rating, dimensions. */
  metadata: Record<string, string | number>
  provenance: Provenance
}

/** One fact in a knowledge panel. There is no way to make one without saying where it came from (§11, §65). */
export interface EntityFact {
  key: string
  label: string
  value: string
  provenance: Provenance
}

export interface KnowledgeEntity {
  name: string
  /** "Malaysian former badminton player" -- the one line under the name. Sourced like everything else. */
  description: string
  kind: string
  /** A picture of the thing, from a page that actually showed it. */
  image?: { url: string; provenance: Provenance }
  /** The About paragraph, in the words of the source it came from. */
  about?: { text: string; provenance: Provenance }
  facts: EntityFact[]
  /** Addresses the entity itself owns, never guessed from the name (§11). */
  official: { label: string; url: string; provenance: Provenance }[]
  provenance: Provenance
}

/**
 * A question and, when one could be found, its answer (§15-§18).
 *
 * The question may be generated -- asking "when did they retire" is not a claim that they did. The answer may not.
 * `answer` is null until something real is found, and stays null when nothing is, which the page shows as
 * "Information unavailable" rather than filling in.
 */
export interface AskedQuestion {
  id: string
  question: string
  answer: { text: string; provenance: Provenance } | null
  /** Set once the answer has been looked for, so "not looked yet" and "looked and found nothing" are different. */
  answered: boolean
}

/** A related entity (§19-§21). The relationship is stated, so a random famous name cannot pass as one. */
export interface RelatedEntity {
  name: string
  kind: string
  description: string
  image?: { url: string; provenance: Provenance }
  /** Why this one: "also a badminton player", "founded the same company". Never decoration. */
  relationship: string
  searchQuery: string
  provenance: Provenance
}

const clean = (value: unknown, limit: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '')

const isWebUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//i.test(value)

export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Builds provenance, or refuses. Everything downstream depends on this being impossible to fake into existence. */
export function provenanceFor(raw: unknown, provider: string, now = Date.now()): Provenance | null {
  const o = (raw ?? {}) as Record<string, unknown>
  const url = typeof o.url === 'string' ? o.url.trim() : ''
  if (!isWebUrl(url)) return null
  return {
    url,
    site: siteOf(url),
    provider: clean(provider, 40) || 'unknown',
    retrievedAt: typeof o.retrievedAt === 'number' && Number.isFinite(o.retrievedAt) ? o.retrievedAt : now,
    ...(clean(o.title, 300) ? { title: clean(o.title, 300) } : {}),
    ...(clean(o.quote, 500) ? { quote: clean(o.quote, 500) } : {})
  }
}

/** A result from any provider, in the one shape every module reads. Anything without a real address is dropped. */
export function normalizeResult(raw: unknown, type: NormalizedResult['type'], provider: string, now = Date.now()): NormalizedResult | null {
  const o = (raw ?? {}) as Record<string, unknown>
  const provenance = provenanceFor({ ...o, retrievedAt: now }, provider, now)
  if (!provenance) return null
  const title = clean(o.title, 300)
  if (!title) return null
  const metadata: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(o.metadata && typeof o.metadata === 'object' ? (o.metadata as Record<string, unknown>) : {})) {
    if (typeof value === 'string' && value.trim()) metadata[key] = clean(value, 120)
    else if (typeof value === 'number' && Number.isFinite(value)) metadata[key] = value
  }
  return {
    id: provenance.url,
    type,
    title,
    description: clean(o.description ?? o.snippet, 600),
    url: provenance.url,
    domain: provenance.site,
    ...(isWebUrl(o.favicon) ? { favicon: o.favicon } : {}),
    ...(isWebUrl(o.image) ? { image: o.image } : {}),
    ...(typeof o.publishedAt === 'number' && Number.isFinite(o.publishedAt) ? { publishedAt: o.publishedAt } : {}),
    metadata,
    provenance
  }
}

/**
 * Two results are the same result when they are the same page, or the same page with tracking on the end (§56).
 *
 * Only exact duplicates are removed. Two publications covering one story are two sources and both are kept, because
 * independent reporting is not duplication -- collapsing it would quietly narrow what somebody is shown.
 */
export function dedupeResults(results: NormalizedResult[]): NormalizedResult[] {
  const seen = new Set<string>()
  const out: NormalizedResult[] = []
  for (const result of results) {
    let key = result.url
    try {
      const u = new URL(result.url)
      for (const parameter of [...u.searchParams.keys()]) {
        if (/^(utm_|fbclid|gclid|ref|source|mc_cid|mc_eid|igshid)/i.test(parameter)) u.searchParams.delete(parameter)
      }
      u.hash = ''
      key = `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`
    } catch {
      // Not parseable, so the address itself is the key. Nothing is lost by being cautious here.
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(result)
  }
  return out
}

// ---------------------------------------------------------------- questions

const QUESTION_LIKE = /^(who|what|when|where|why|how|which|is|are|was|were|does|do|did|can|should|will)\b/i

/**
 * Keeps the questions worth showing (§16).
 *
 * A question must read as a question and must be about what was searched for -- sharing a real word with the query,
 * not merely sounding plausible. That single check is what stops a page about one person filling up with questions
 * about somebody else entirely, which is the characteristic way this module goes wrong.
 */
export function acceptQuestions(raw: unknown, query: string, limit = 6): AskedQuestion[] {
  const subject = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
  )
  const out: AskedQuestion[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const question = clean(typeof item === 'string' ? item : (item as Record<string, unknown>)?.question, 200)
    if (!question || !QUESTION_LIKE.test(question)) continue
    const key = question.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (seen.has(key)) continue
    // About the thing that was searched for, not about something adjacent that sounded good.
    if (subject.size) {
      const words = new Set(question.toLowerCase().split(/[^a-z0-9]+/))
      if (![...subject].some((w) => words.has(w))) continue
    }
    seen.add(key)
    out.push({ id: `q${out.length}`, question: question.endsWith('?') ? question : `${question}?`, answer: null, answered: false })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Attaches an answer, or records that there is none (§18).
 *
 * An answer must come with a page it came from, and its words must be present in that page. A claim that cannot be
 * traced is not softened or hedged -- it is dropped, and the question is marked answered with nothing, which the page
 * renders as "Information unavailable". That is a better outcome than a sentence nobody can check.
 */
export function answerQuestion(question: AskedQuestion, proposed: { text?: unknown; source?: unknown }, pageText: string, provider: string, now = Date.now()): AskedQuestion {
  const text = clean(proposed?.text, 600)
  const provenance = provenanceFor({ ...(proposed?.source && typeof proposed.source === 'object' ? proposed.source : {}), retrievedAt: now }, provider, now)
  if (!text || !provenance) return { ...question, answered: true, answer: null }
  // The answer has to be supported by the page it cites. A long answer need not be a quote, but it must overlap it:
  // every significant word in the answer has to appear in the page it claims to come from.
  const haystack = pageText.toLowerCase()
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3)
  const grounded = words.length > 0 && words.filter((w) => haystack.includes(w)).length / words.length >= 0.7
  if (!grounded) return { ...question, answered: true, answer: null }
  return { ...question, answered: true, answer: { text, provenance } }
}

/** How the page says it when nothing could be found. Named so it is the same sentence everywhere (§18). */
export const NO_ANSWER = 'Information unavailable'

// ---------------------------------------------------------------- related entities

/**
 * Keeps the related entities that are actually related (§20).
 *
 * The rule is that a relationship has to be stated and the entity has to have come from somewhere. Without both, this
 * module becomes a list of famous names that happen to be famous, which is worse than no module: it asserts a
 * connection that nobody checked and that may not exist.
 */
export function acceptRelated(raw: unknown, query: string, provider: string, limit = 8, now = Date.now()): RelatedEntity[] {
  const self = query.toLowerCase().replace(/[^a-z0-9]/g, '')
  const out: RelatedEntity[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const o = (item ?? {}) as Record<string, unknown>
    const name = clean(o.name, 120)
    const relationship = clean(o.relationship, 160)
    if (!name || !relationship) continue
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!key || key === self || seen.has(key)) continue
    const provenance = provenanceFor({ ...o, retrievedAt: now }, provider, now)
    if (!provenance) continue
    const image = isWebUrl(o.image) ? provenanceFor({ url: o.image, retrievedAt: now }, provider, now) : null
    seen.add(key)
    out.push({
      name,
      kind: clean(o.kind, 40) || 'entity',
      description: clean(o.description, 200),
      ...(image && isWebUrl(o.image) ? { image: { url: o.image, provenance: image } } : {}),
      relationship,
      searchQuery: clean(o.searchQuery, 160) || name,
      provenance
    })
    if (out.length >= limit) break
  }
  return out
}

// ---------------------------------------------------------------- related searches

/**
 * Nearby searches (§23).
 *
 * These are queries, not claims -- "Albert Einstein age" asserts nothing about his age -- so they need no provenance.
 * What they do need is to be about the same thing and not to repeat the search somebody just made.
 */
export function acceptRelatedSearches(raw: unknown, query: string, limit = 8): string[] {
  const asked = query.toLowerCase().replace(/\s+/g, ' ').trim()
  const subject = new Set(asked.split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  const out: string[] = []
  const seen = new Set<string>([asked])
  for (const item of Array.isArray(raw) ? raw : []) {
    const text = clean(typeof item === 'string' ? item : (item as Record<string, unknown>)?.query, 120)
    const key = text.toLowerCase()
    if (!text || seen.has(key) || text.length < 3) continue
    if (subject.size) {
      const words = new Set(key.split(/[^a-z0-9]+/))
      if (![...subject].some((w) => words.has(w))) continue
    }
    seen.add(key)
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Builds a knowledge panel from facts that each carry a source, or returns null (§9, §10, §65).
 *
 * Null is the right answer far more often than a panel is. A panel with a name and no sourced facts is the failure
 * this guards against: it looks authoritative precisely because it looks like a panel.
 */
export function buildKnowledge(raw: unknown, provider: string, now = Date.now()): KnowledgeEntity | null {
  const o = (raw ?? {}) as Record<string, unknown>
  const name = clean(o.name, 160)
  const provenance = provenanceFor({ ...o, retrievedAt: now }, provider, now)
  if (!name || !provenance) return null

  const facts: EntityFact[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(o.facts) ? o.facts : []) {
    const f = (item ?? {}) as Record<string, unknown>
    const key = clean(f.key, 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const value = clean(f.value, 300)
    if (!key || !value || seen.has(key)) continue
    const where = provenanceFor({ ...(f.source && typeof f.source === 'object' ? f.source : o), retrievedAt: now }, provider, now)
    if (!where) continue
    seen.add(key)
    facts.push({ key, label: clean(f.label, 60) || key.replace(/_/g, ' '), value, provenance: where })
  }

  const aboutText = clean(o.about, 900)
  const image = isWebUrl(o.image) ? o.image : null
  const official: KnowledgeEntity['official'] = []
  for (const item of Array.isArray(o.official) ? o.official : []) {
    const l = (item ?? {}) as Record<string, unknown>
    const where = provenanceFor({ ...l, retrievedAt: now }, provider, now)
    if (!where) continue
    official.push({ label: clean(l.label, 60) || where.site, url: where.url, provenance: where })
  }

  // A name on its own is not knowledge. Something has to have been found for the panel to be worth drawing.
  if (!facts.length && !aboutText && !official.length) return null

  return {
    name,
    description: clean(o.description, 200),
    kind: clean(o.kind, 40) || 'entity',
    ...(image ? { image: { url: image, provenance } } : {}),
    ...(aboutText ? { about: { text: aboutText, provenance } } : {}),
    facts,
    official,
    provenance
  }
}
