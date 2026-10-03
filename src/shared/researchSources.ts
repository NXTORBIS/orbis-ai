/**
 * Which sources you want research to use, and which you do not.
 *
 * Research ranked pages on how well they matched and how recent they were, and that was the whole of it. There was no
 * way to say "prefer official documentation", "stay off social media", or "never use this site" -- so somebody who
 * knew exactly where the good answer lived had no way to say so, and somebody who knew a site was rubbish had to
 * watch it come back every time.
 *
 * Two rules, and the second is what keeps this from quietly lying:
 *
 * **A preference moves a source up the list; it does not invent one.** Preferring academic sources cannot produce an
 * academic source for a question that has none. What it does is decide the order among the pages that were really
 * found, which is the only honest thing a preference can do.
 *
 * **Blocking is absolute and is said.** A blocked site is not read at all, not even to rank it, and the count of what
 * was left out travels with the research so the answer can say "two results were left out because you blocked those
 * sites" rather than silently returning less.
 */

/** The kinds of source somebody can lean research towards. Coarse on purpose: a longer list would be guessing. */
export type SourceKind = 'official' | 'academic' | 'news' | 'reference' | 'forum'

export const SOURCE_KINDS: readonly SourceKind[] = Object.freeze(['official', 'academic', 'news', 'reference', 'forum'])

export const SOURCE_KIND_LABELS: Readonly<Record<SourceKind, { label: string; blurb: string }>> = Object.freeze({
  official: { label: 'Official and documentation', blurb: "A product's own site, developer docs, standards bodies" },
  academic: { label: 'Academic and government', blurb: 'Universities, research, government sites' },
  news: { label: 'News', blurb: 'Newspapers, magazines, broadcasters' },
  reference: { label: 'Reference', blurb: 'Encyclopedias and dictionaries' },
  forum: { label: 'Forums and discussion', blurb: 'Q&A sites, discussion boards, social media' }
})

export interface SourcePreferences {
  /** Kinds to put first. Empty means no opinion, which is the default. */
  readonly prefer: readonly SourceKind[]
  /** Kinds to put last. A kind here is still used when nothing else answers; it is not a block. */
  readonly avoid: readonly SourceKind[]
  /** Sites never to read. A host, or "*.example.com". Absolute. */
  readonly blocked: readonly string[]
}

export const DEFAULT_SOURCE_PREFERENCES: SourcePreferences = Object.freeze({ prefer: [], avoid: [], blocked: [] })

const ACADEMIC = /\.(gov|edu|int|mil)$|\.gov\.|\.ac\.|\.edu\.|(^|\.)(arxiv|jstor|pubmed|ncbi\.nlm\.nih|nature|sciencedirect|springer|ieee|acm)\.(org|com|gov)$/
const OFFICIAL = /^(docs|developer|developers|learn|support|help|spec|specs|api)\./
const STANDARDS = /(^|\.)(w3|ietf|whatwg|iso|unicode|ecma-international)\.org$/
const REFERENCE = /(^|\.)(wikipedia|wiktionary|britannica|merriam-webster)\.org$|(^|\.)(dictionary|encyclopedia)\./
const FORUM = /(^|\.)(reddit|stackoverflow|stackexchange|quora|x|twitter|facebook|instagram|tiktok|threads|mastodon|discord|medium|substack)\.(com|org|net|social)$/
const NEWS = /(^|\.)(bbc|cnn|nytimes|theguardian|reuters|apnews|ft|wsj|bloomberg|aljazeera|ndtv|thehindu|indiatimes|hindustantimes)\.(com|co\.uk|in|org)$|(^|\.)news\./

/**
 * What kind of source a page is, from its address and nothing else.
 *
 * Deliberately shallow. Reading the page to decide would mean fetching a page in order to decide whether to fetch it,
 * and a page that calls itself a journal is not one. An address Orbis cannot place is placed nowhere, which means no
 * preference moves it either way -- it is ranked on how well it answers, as everything was before.
 */
export function kindOf(url: string): SourceKind | null {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    // Documentation lives at a path as often as at a host.
    if (OFFICIAL.test(host) || /\/(docs|documentation|reference|api|spec)(\/|$)/i.test(parsed.pathname)) return 'official'
  } catch {
    return null
  }
  if (STANDARDS.test(host)) return 'official'
  if (ACADEMIC.test(host)) return 'academic'
  if (REFERENCE.test(host)) return 'reference'
  if (FORUM.test(host)) return 'forum'
  if (NEWS.test(host)) return 'news'
  return null
}

/** Whether a blocking pattern covers a host. "example.com" covers its subdomains; "*.example.com" covers only those. */
export function blocks(pattern: string, host: string): boolean {
  const want = pattern.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const have = host.toLowerCase().replace(/^www\./, '')
  if (!want) return false
  if (want.startsWith('*.')) {
    const bare = want.slice(2)
    return have.endsWith(`.${bare}`)
  }
  return have === want || have.endsWith(`.${want}`)
}

/** Whether research may read this address at all. */
export function allowed(url: string, prefs: SourcePreferences): boolean {
  if (!prefs.blocked.length) return true
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return !prefs.blocked.some((one) => blocks(one, host))
  } catch {
    return true
  }
}

/**
 * How much a preference moves a source, as a number to sort by. Lower comes first.
 *
 * Deliberately small compared with whether a page could be read at all: a preferred page that could not be read is
 * still worse than an ordinary page that could, because an unread page says nothing whatever its address is.
 */
export function preferenceRank(url: string, prefs: SourcePreferences): number {
  const kind = kindOf(url)
  if (!kind) return 0
  if (prefs.prefer.includes(kind)) return -1
  if (prefs.avoid.includes(kind)) return 1
  return 0
}

/** Reads preferences back from settings, dropping anything that is not one rather than repairing it into something odd. */
export function readSourcePreferences(raw: unknown): SourcePreferences {
  const given = (raw ?? {}) as Partial<Record<keyof SourcePreferences, unknown>>
  const kinds = (value: unknown): SourceKind[] =>
    Array.isArray(value) ? [...new Set(value.filter((one): one is SourceKind => typeof one === 'string' && SOURCE_KINDS.includes(one as SourceKind)))] : []
  const blocked = Array.isArray(given.blocked)
    ? [...new Set(given.blocked.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map((one) => one.trim().toLowerCase().slice(0, 120)))].slice(0, 200)
    : []
  const prefer = kinds(given.prefer)
  // A kind cannot be both preferred and avoided; preferring is what somebody chose more recently in the UI, and
  // keeping both would make the sort depend on which check ran first.
  const avoid = kinds(given.avoid).filter((one) => !prefer.includes(one))
  return Object.freeze({ prefer, avoid, blocked })
}

/** What to say when sources were left out. Null when nothing was, which is the usual answer. */
export function leftOutNote(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? 'One result was left out because you have blocked that site.' : `${count} results were left out because you have blocked those sites.`
}
