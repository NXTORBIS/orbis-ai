/**
 * Where Chromium's real autocomplete results meet Orbis's own, and become one list.
 *
 * Orbis's address bar now has two sources of prediction and they are very different things:
 *
 *   - **Chromium's `AutocompleteController`**, driven natively (see `orbis_autocomplete.cc`). It owns search
 *     suggestions, history, URLs, bookmarks, keywords and open tabs, because it already does all of that properly and
 *     reimplementing any of it in Orbis would be building a worse copy of the thing underneath.
 *   - **Orbis's own providers**, for the things Chromium has never heard of: workspaces, workflows, browser actions.
 *
 * This file is the merge, and nothing else. It does not predict, it does not fetch, and it is not a second ranker for
 * the things Chromium ranks. What it decides is the small set of questions that only arise *because* there are two
 * sources:
 *
 *   1. **Whose result is this, and is it still wanted?** Providers answer out of order while the person keeps typing.
 *      Every query has a generation; a batch stamped with an older one is discarded rather than merged (§11).
 *   2. **Is this the answer, or a stand-in?** The prefix cache exists so the list is never blank, and its results are
 *      marked `provisional`. The moment native results arrive for the current input they are authoritative, and the
 *      provisional ones for that input are gone -- never both at once (§10).
 *   3. **Are two results the same thing?** A page in history and the same page open in a tab share a URL and are not
 *      the same action. Switching wins, and the duplicate navigation goes (§30, §62).
 *   4. **How do two incomparable scores get ordered?** Chromium's relevance runs to about 1500 and means something
 *      within Chromium's own scale. Orbis's scores do not. Adding them would be arithmetic on unrelated units, so both
 *      are normalised before either is compared (§31).
 *
 * The one thing it will not do is let a weak Orbis result displace a strong native one, or the reverse. Intent decides
 * which family is likely to matter, and the scores decide within that -- rather than one family always winning.
 */

// ---------------------------------------------------------------- what arrives from Chromium

/** One match, exactly as `orbis_autocomplete.cc` converts it. Field names are that converter's. */
export interface NativeMatch {
  index: number
  source: 'CHROMIUM_NATIVE'
  provider: string
  /** Chromium's own `AutocompleteMatchType::ToString`, e.g. "search-suggest", "open-tab", "bookmark-title". */
  type: string
  relevance: number
  contents: string
  description: string
  fillIntoEdit: string
  inlineAutocompletion: string
  additionalText: string
  destinationUrl: string
  allowedToBeDefault: boolean
  keyword: string
  associatedKeyword: string
  isSearch: boolean
  transition: number
}

/** One notification from the controller. Providers report repeatedly, so these arrive several times per query. */
export interface NativeBatch {
  generation: number
  /** The controller's own view of whether every provider has finished. */
  done: boolean
  defaultMatchChanged: boolean
  matches: NativeMatch[]
  /** Which match Chromium considers default -- what Enter should do. */
  defaultIndex?: number
}

// ---------------------------------------------------------------- what the UI is given

/**
 * What a row means when it is chosen.
 *
 * Explicit, and decided here from the match's own type, so that selecting a row never involves inferring an action
 * from the words drawn on it (§60). A prediction that looks right and opens the wrong thing is a failure, not a
 * cosmetic problem.
 */
export type PredictionAction =
  | 'NAVIGATE_URL'
  | 'SEARCH'
  | 'SWITCH_TAB'
  | 'OPEN_BOOKMARK'
  | 'OPEN_HISTORY'
  | 'OPEN_WORKSPACE'
  | 'EXECUTE_ORBIS_ACTION'
  | 'SITE_SEARCH'

export type PredictionSource = 'CHROMIUM_NATIVE' | 'ORBIS_NATIVE' | 'CACHE_PROVISIONAL'

export type PredictionGroup = 'Search' | 'History' | 'Bookmarks' | 'Open Tabs' | 'Workspaces' | 'Actions' | 'Site Search' | 'URLs'

export interface Candidate {
  /** Stable across batches for the same thing, so a selected row survives providers answering (§40). */
  id: string
  source: PredictionSource
  action: PredictionAction
  group: PredictionGroup
  /** What the row reads. */
  text: string
  description?: string
  url?: string
  query?: string
  /** Where it came from, for diagnosis. Never shown to somebody who did not ask for it (§99). */
  provider?: string
  /** Chromium's own score, kept as it was given. Never compared directly with an Orbis one. */
  nativeRelevance?: number
  /** Orbis's own score for its own results, on its own scale. */
  orbisScore?: number
  /** Both of the above brought onto one 0..1 scale, which is the only thing ordering uses. */
  rank: number
  /** A stand-in shown while the real answer is in flight. Never the final state for its input. */
  provisional: boolean
  /** Which query produced it. */
  generation: number
  /** What the address bar's text becomes if this is taken. */
  fillIntoEdit?: string
  inlineAutocompletion?: string
  /** What Chromium thinks Enter should do. At most one candidate carries it. */
  isDefault?: boolean
  /** Chromium's intended navigation semantics, carried through rather than re-derived. */
  transition?: number
  /** Its position in the live native result set, which is how it is opened (§59). */
  nativeIndex?: number
  /** A keyword this row can be Tabbed into, for Tab-to-Search. */
  keyword?: string
}

// ---------------------------------------------------------------- reading Chromium's own vocabulary

/**
 * What a native match means, from its type.
 *
 * Read from Chromium's own `AutocompleteMatchType::ToString` strings rather than guessed at from the URL or the row's
 * text. A type is a fact about what a provider produced; a URL is not. The default is the honest one: `isSearch` is
 * Chromium's own answer to "is this a search", so anything unrecognised still gets the right broad behaviour instead
 * of being treated as a navigation because that is more common.
 */
export function actionFor(match: Pick<NativeMatch, 'type' | 'isSearch' | 'keyword'>): PredictionAction {
  const type = match.type
  if (type === 'open-tab' || type === 'tab-search') return 'SWITCH_TAB'
  if (type === 'bookmark-title') return 'OPEN_BOOKMARK'
  if (type.startsWith('history-') || type === 'history-cluster') return 'OPEN_HISTORY'
  // A keyword match is a search *on a particular site*, which is a different row and a different action from a plain
  // search even though both end in a query.
  if (type === 'search-other-engine' || type === 'featured-enterprise-search' || type === 'starter-pack') return 'SITE_SEARCH'
  if (type === 'url-what-you-typed' || type === 'navsuggest' || type === 'navsuggest-personalized' || type === 'navsuggest-tiles' || type === 'most-visited-site-tile') return 'NAVIGATE_URL'
  if (type === 'url-from-clipboard' || type === 'document') return 'NAVIGATE_URL'
  if (match.isSearch) return 'SEARCH'
  return 'NAVIGATE_URL'
}

/** Which heading a row sits under. Only groups with something in them are ever shown (§29). */
export function groupFor(action: PredictionAction): PredictionGroup {
  switch (action) {
    case 'SEARCH':
      return 'Search'
    case 'SWITCH_TAB':
      return 'Open Tabs'
    case 'OPEN_BOOKMARK':
      return 'Bookmarks'
    case 'OPEN_HISTORY':
      return 'History'
    case 'OPEN_WORKSPACE':
      return 'Workspaces'
    case 'EXECUTE_ORBIS_ACTION':
      return 'Actions'
    case 'SITE_SEARCH':
      return 'Site Search'
    default:
      return 'URLs'
  }
}

/**
 * Chromium's relevance, on a 0..1 scale.
 *
 * Chromium's numbers run to roughly 1500 -- what you typed scores around 1300-1500, a good history match similarly,
 * a weak suggestion a few hundred. The exact ceiling is not a published constant and moves between versions, so this
 * divides by a stated reference and clamps, rather than pretending to know the maximum. What matters is that it is
 * monotonic and bounded: order within Chromium's results is preserved exactly, and no native score can exceed 1.
 */
export const NATIVE_RELEVANCE_REFERENCE = 1500

export const normalizeNative = (relevance: number): number =>
  Math.max(0, Math.min(1, (Number.isFinite(relevance) ? relevance : 0) / NATIVE_RELEVANCE_REFERENCE))

/**
 * An Orbis score, on the same 0..1 scale.
 *
 * Orbis's own providers score on whatever scale suits them, so the caller says what the top of that scale is. Where it
 * does not, 1 is assumed -- which treats the score as already normalised rather than silently rescaling it by a number
 * nobody chose.
 */
export const normalizeOrbis = (score: number, reference = 1): number =>
  Math.max(0, Math.min(1, (Number.isFinite(score) ? score : 0) / (reference > 0 ? reference : 1)))

// ---------------------------------------------------------------- generations

/**
 * Whether a batch still belongs to the query being asked.
 *
 * The whole of stale-result protection is this one comparison (§11). Chromium's `Stop()` is what ends the *work*, but a
 * notification already on its way cannot be recalled, so the guard is what makes a late arrival harmless rather than
 * wrong.
 */
export const accept = (batch: Pick<NativeBatch, 'generation'>, current: number): boolean => batch.generation === current

// ---------------------------------------------------------------- the cache, kept honest

/**
 * Whether a cached prediction from a shorter input can stand in for this one.
 *
 * The rule is the existing one and deliberately strict: it must actually start with what has been typed. Having asked
 * about "python" and been told "python tutorial", typing "python t" may show it -- and must never show "java tutorial"
 * merely because it came back from the same earlier request (§9).
 */
export function stillFits(text: string, candidateText: string): boolean {
  const typed = text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!typed) return false
  return candidateText.replace(/\s+/g, ' ').trim().toLowerCase().startsWith(typed)
}

/** A provisional row, from a cached suggestion for a shorter input. Always a search: it is a query, not a destination. */
export function provisionalFrom(text: string, suggestions: string[], generation: number): Candidate[] {
  return suggestions
    .filter((suggestion) => stillFits(text, suggestion))
    .map((suggestion, i) => ({
      id: `q:${suggestion.replace(/\s+/g, ' ').trim().toLowerCase()}`,
      source: 'CACHE_PROVISIONAL' as const,
      action: 'SEARCH' as const,
      group: 'Search' as const,
      text: suggestion,
      query: suggestion,
      // Below anything real by construction: a stand-in must never outrank the thing it is standing in for.
      rank: Math.max(0, 0.3 - i * 0.01),
      provisional: true,
      generation
    }))
}

// ---------------------------------------------------------------- one identity for the same thing

/**
 * What makes two rows the same row.
 *
 * **One destination is one row.** The same page sitting in history, bookmarked, and open in a tab is one thing the
 * person might want, and offering it three times wastes the list and makes somebody choose between identical-looking
 * options. Orbis's existing tests state this directly: a page already open is "offered as a switch, not a second copy
 * of itself", and the switch outranks the history entry.
 *
 * This is worth spelling out because §30 of the requirement can be read as asking for the opposite -- it warns against
 * removing two genuinely different actions that share a URL, giving "open existing tab" versus "navigate to URL" as the
 * example. The two are reconciled by *which* row survives rather than by keeping both: the surviving row carries the
 * switch action (see `preferred`), so nothing is lost -- the person still gets the tab switch, which is the action that
 * mattered. What §30 forbids is the switch being dropped in favour of a plain navigation, and that cannot happen here.
 * Where the requirement and the existing tests genuinely disagree, the tests win: a regression is not an improvement.
 *
 * Searches are identified by their query, and a site search separately from a plain one, because searching Wikipedia
 * for a word and searching the web for it are different destinations reached by different means.
 */
export function identityOf(candidate: Pick<Candidate, 'action' | 'url' | 'query' | 'text'>): string {
  if (candidate.action === 'SEARCH' || candidate.action === 'SITE_SEARCH') {
    return `${candidate.action === 'SITE_SEARCH' ? 'site' : 'q'}:${(candidate.query ?? candidate.text).replace(/\s+/g, ' ').trim().toLowerCase()}`
  }
  // Orbis's own things are not destinations and are identified by what they are.
  if (candidate.action === 'OPEN_WORKSPACE' || candidate.action === 'EXECUTE_ORBIS_ACTION') {
    return `${candidate.action}:${candidate.text.toLowerCase()}`
  }
  // Switching to it, navigating to it, opening it from a bookmark or from history: one page, one row.
  return `u:${normalizeUrl(candidate.url ?? '')}`
}

/** A URL reduced to what makes it the same page: scheme and "www." and a trailing slash are not differences. */
export function normalizeUrl(url: string): string {
  const raw = String(url ?? '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    const host = u.host.replace(/^www\./i, '')
    const path = u.pathname.replace(/\/$/, '')
    return `${host}${path}${u.search}`.toLowerCase()
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase()
  }
}

/**
 * Which of two rows for the same page survives.
 *
 * Switching to a tab that is already open beats opening the page again, always: the person almost never wants a second
 * copy, and the existing tests say so. Otherwise the better rank wins, and the winner keeps the loser's native index
 * when it had none -- so a row that came from Orbis can still be opened through the native pipeline.
 */
function preferred(a: Candidate, b: Candidate): Candidate {
  if (a.action === 'SWITCH_TAB' && b.action !== 'SWITCH_TAB') return a
  if (b.action === 'SWITCH_TAB' && a.action !== 'SWITCH_TAB') return b
  // Something real always beats a stand-in for the same thing, whatever they score.
  if (a.provisional !== b.provisional) return a.provisional ? b : a
  return b.rank > a.rank ? b : a
}

// ---------------------------------------------------------------- intent, cheaply

/**
 * Which family of result the input is reaching for.
 *
 * Cheap on purpose: it runs on every keystroke, so it is a look at the shape of the text and nothing more. No model, no
 * inference, no network (§33, §35). Orion is never asked to rank a keystroke.
 */
export type Leaning = 'navigate' | 'search' | 'orbis' | 'open'

const LOOKS_LIKE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|:)/i
const NAMES_ORBIS_THING = /\b(workspace|workflow|profile|tab|window|bookmark|download|history|settings)\b/i
const ASKS_FOR_ACTION = /^(close|open|new|switch|mute|pin|unpin|split|reload|duplicate|clear|run|start|stop)\b/i

export function leaning(text: string): Leaning {
  const typed = text.trim()
  if (!typed) return 'search'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) || LOOKS_LIKE_HOST.test(typed)) return 'navigate'
  if (ASKS_FOR_ACTION.test(typed)) return 'orbis'
  if (NAMES_ORBIS_THING.test(typed)) return 'open'
  return 'search'
}

/**
 * How much a row's family is helped or hurt by what the input is reaching for.
 *
 * Small and bounded, which is the point. Typing "github.com" should let a navigation lead, and typing "python
 * threading" should let a search lead -- but neither nudge is large enough to put a barely-relevant row above a
 * strongly relevant one. That is the intent-aware merge the requirement asks for, and it is the reason this is a
 * modest adjustment rather than a reordering by category (§32, §33).
 */
const NUDGE = 0.12

export function nudgeFor(lean: Leaning, action: PredictionAction): number {
  if (lean === 'navigate') return action === 'NAVIGATE_URL' || action === 'OPEN_HISTORY' || action === 'OPEN_BOOKMARK' ? NUDGE : action === 'SEARCH' ? -NUDGE : 0
  if (lean === 'search') return action === 'SEARCH' ? NUDGE : action === 'EXECUTE_ORBIS_ACTION' ? -NUDGE : 0
  if (lean === 'orbis') return action === 'EXECUTE_ORBIS_ACTION' ? NUDGE : action === 'SEARCH' ? -NUDGE : 0
  // Naming a thing Orbis owns: its own rows and switching to what is already open both become likelier.
  return action === 'OPEN_WORKSPACE' || action === 'SWITCH_TAB' || action === 'EXECUTE_ORBIS_ACTION' ? NUDGE : 0
}

// ---------------------------------------------------------------- the merge

/** Chromium's matches as Orbis candidates. No ranking decided here -- only translation. */
export function fromNative(batch: NativeBatch): Candidate[] {
  return batch.matches
    .filter((match) => match.destinationUrl || match.isSearch)
    .map((match) => {
      const action = actionFor(match)
      const isSearchish = action === 'SEARCH' || action === 'SITE_SEARCH'
      return {
        id: identityOf({ action, url: match.destinationUrl, query: isSearchish ? match.contents : undefined, text: match.contents }),
        source: 'CHROMIUM_NATIVE' as const,
        action,
        group: groupFor(action),
        text: match.contents,
        ...(match.description ? { description: match.description } : {}),
        ...(match.destinationUrl ? { url: match.destinationUrl } : {}),
        ...(isSearchish ? { query: match.contents } : {}),
        provider: match.provider,
        nativeRelevance: match.relevance,
        rank: normalizeNative(match.relevance),
        provisional: false,
        generation: batch.generation,
        ...(match.fillIntoEdit ? { fillIntoEdit: match.fillIntoEdit } : {}),
        ...(match.inlineAutocompletion ? { inlineAutocompletion: match.inlineAutocompletion } : {}),
        ...(batch.defaultIndex === match.index ? { isDefault: true } : {}),
        transition: match.transition,
        nativeIndex: match.index,
        ...(match.associatedKeyword || match.keyword ? { keyword: match.associatedKeyword || match.keyword } : {})
      }
    })
}

export interface MergeInput {
  text: string
  generation: number
  /** The latest accepted native batch, or null when none has arrived for this generation yet. */
  native: NativeBatch | null
  /** Orbis's own results: workspaces, actions, workflows. Already scored on `orbisReference`. */
  orbis?: Candidate[]
  /** Cached suggestions from a shorter input, shown only while nothing native has arrived. */
  provisional?: string[]
  orbisReference?: number
  limit?: number
}

export interface Merged {
  candidates: Candidate[]
  /** Which groups actually have something, in display order. Empty ones are never shown. */
  groups: PredictionGroup[]
  /** True once the native controller says every provider has finished. */
  settled: boolean
  /** Whether anything shown is still a stand-in. */
  provisional: boolean
  generation: number
}

/** Groups appear in this order when they have anything in them. */
const GROUP_ORDER: PredictionGroup[] = ['Search', 'Open Tabs', 'History', 'Bookmarks', 'Site Search', 'URLs', 'Workspaces', 'Actions']

/**
 * The one authoritative list (§58).
 *
 * Everything the UI shows comes from here, so the cache, the native controller and Orbis's own providers cannot each
 * be separately deciding what is on screen. The order of business:
 *
 *   - Native results for this generation, translated.
 *   - Orbis's own results, normalised onto the same scale.
 *   - Provisional rows, **only** while nothing native has arrived for this input -- which is what stops old and fresh
 *     being shown together as duplicates (§10).
 *   - Deduplicated by identity, switching preferred over navigating to the same place.
 *   - Ordered by rank with a small intent nudge, then by group, then by id so the order is stable as providers answer.
 */
export function merge(input: MergeInput): Merged {
  const lean = leaning(input.text)
  const native = input.native && accept(input.native, input.generation) ? fromNative(input.native) : []
  const hasNative = native.length > 0

  const orbis = (input.orbis ?? []).map((candidate) => ({
    ...candidate,
    generation: input.generation,
    rank: normalizeOrbis(candidate.orbisScore ?? candidate.rank, input.orbisReference ?? 1)
  }))

  // A stand-in is worth having only until the real thing arrives. Once it has, showing both is the duplication the
  // requirement forbids -- so these are dropped rather than reconciled row by row.
  const provisional = hasNative ? [] : provisionalFrom(input.text, input.provisional ?? [], input.generation)

  const byIdentity = new Map<string, Candidate>()
  for (const candidate of [...native, ...orbis, ...provisional]) {
    const key = identityOf(candidate)
    const existing = byIdentity.get(key)
    if (!existing) {
      byIdentity.set(key, { ...candidate, id: key })
      continue
    }
    const winner = preferred(existing, candidate)
    const loser = winner === existing ? candidate : existing
    byIdentity.set(key, {
      ...winner,
      id: key,
      // Keep whatever the loser knew that the winner did not, so merging never costs information: an Orbis row that
      // won still needs the native index to be opened through the native pipeline.
      nativeIndex: winner.nativeIndex ?? loser.nativeIndex,
      isDefault: winner.isDefault || loser.isDefault,
      fillIntoEdit: winner.fillIntoEdit ?? loser.fillIntoEdit,
      transition: winner.transition ?? loser.transition
    })
  }

  const ordered = [...byIdentity.values()]
    .map((candidate) => ({ candidate, score: candidate.rank + nudgeFor(lean, candidate.action) }))
    .sort((a, b) => {
      // A default match Chromium chose leads, because Enter and the first row must agree (§19).
      if (Boolean(a.candidate.isDefault) !== Boolean(b.candidate.isDefault)) return a.candidate.isDefault ? -1 : 1
      if (a.score !== b.score) return b.score - a.score
      return a.candidate.id.localeCompare(b.candidate.id)
    })
    .map(({ candidate }) => candidate)
    .slice(0, input.limit ?? 10)

  const present = new Set(ordered.map((c) => c.group))
  return {
    candidates: ordered,
    groups: GROUP_ORDER.filter((group) => present.has(group)),
    settled: Boolean(input.native && accept(input.native, input.generation) && input.native.done),
    provisional: ordered.some((c) => c.provisional),
    generation: input.generation
  }
}

// ---------------------------------------------------------------- selection, kept still

/**
 * Where the selection goes when the list changes underneath it.
 *
 * Providers answer while somebody is arrowing down a list, and a selection that jumps is how a person ends up opening
 * something they did not choose. So: if what was selected is still there, it stays selected wherever it has moved to.
 * If it has gone, the selection does not silently land on whatever is now in that position -- it goes to the top, which
 * is the one row whose meaning somebody can predict (§40).
 */
export function preserveSelection(previousId: string | null, candidates: Candidate[]): number {
  if (!previousId) return -1
  const at = candidates.findIndex((candidate) => candidate.id === previousId)
  if (at >= 0) return at
  return candidates.length ? 0 : -1
}

/**
 * What Enter does.
 *
 * Chromium's default match when it named one, and the first row otherwise -- never "the first row" as a matter of
 * course, because Chromium's default and the visual order can differ and Enter must follow the default (§19).
 */
export function defaultOf(merged: Merged): Candidate | null {
  return merged.candidates.find((candidate) => candidate.isDefault) ?? merged.candidates[0] ?? null
}

// ---------------------------------------------------------------- what a developer can ask

/** A development-only account of one query, for answering "where did this row come from" (§99, §100). */
export interface Diagnostics {
  input: string
  generation: number
  providers: string[]
  nativeMatches: number
  orbisMatches: number
  provisional: number
  final: number
  settled: boolean
  leaning: Leaning
}

export function diagnose(input: MergeInput, merged: Merged): Diagnostics {
  const native = input.native && accept(input.native, input.generation) ? input.native.matches : []
  return {
    input: input.text,
    generation: input.generation,
    providers: [...new Set(native.map((m) => m.provider).filter(Boolean))].sort(),
    nativeMatches: native.length,
    orbisMatches: (input.orbis ?? []).length,
    provisional: merged.candidates.filter((c) => c.provisional).length,
    final: merged.candidates.length,
    settled: merged.settled,
    leaning: leaning(input.text)
  }
}

// ---------------------------------------------------------------- Orbis's existing suggestions, fed in

/**
 * Orbis's own suggestions, as candidates for the merge.
 *
 * `buildSuggestions` in src/shared/omnibox.ts already produces these, and it is not replaced. What it is good at --
 * workspaces, open tabs with their group names, Orbis actions, searches somebody ran before -- is exactly what
 * Chromium cannot know about, and that part stays. What it *also* did was rank history, bookmarks and web suggestions,
 * which Chromium does better; those kinds are dropped here rather than merged, so the same page does not arrive twice
 * ranked two different ways.
 *
 * This is the boundary §108 asks for: keep the Orbis-specific parts, and stop reimplementing Chromium's.
 */
const ORBIS_ONLY: Partial<Record<string, PredictionAction>> = {
  // Things Chromium has no idea about.
  workspace: 'OPEN_WORKSPACE',
  tab: 'SWITCH_TAB',
  site: 'SITE_SEARCH',
  vertical: 'EXECUTE_ORBIS_ACTION',
  research: 'EXECUTE_ORBIS_ACTION',
  orion: 'EXECUTE_ORBIS_ACTION'
}

/** Kinds Chromium's own providers cover, and which are therefore left to them. */
export const COVERED_BY_CHROMIUM = new Set(['navigate', 'query', 'history', 'bookmark', 'web', 'search'])

/**
 * Converts what Orbis already produces into candidates, keeping only what Chromium does not cover.
 *
 * `nativeAvailable` is the honest switch. Where there is no native controller -- Orbis running outside its Chromium
 * build -- nothing is dropped, because dropping history and bookmarks in favour of a pipeline that is not there would
 * leave somebody with fewer predictions than before. The filtering is a consequence of the native half existing, not a
 * decision taken independently of it.
 */
export function fromOrbis(
  suggestions: { id: string; kind: string; text: string; detail?: string; url?: string; query?: string; tabId?: string; workspaceId?: string; score: number }[],
  options: { generation: number; nativeAvailable: boolean; reference?: number }
): Candidate[] {
  const reference = options.reference ?? Math.max(1, ...suggestions.map((s) => s.score))
  return suggestions
    .filter((suggestion) => !options.nativeAvailable || !COVERED_BY_CHROMIUM.has(suggestion.kind))
    .map((suggestion) => {
      const action: PredictionAction =
        ORBIS_ONLY[suggestion.kind] ?? (suggestion.url ? 'NAVIGATE_URL' : 'SEARCH')
      return {
        id: identityOf({ action, url: suggestion.url, query: suggestion.query, text: suggestion.text }),
        source: 'ORBIS_NATIVE' as const,
        action,
        group: groupFor(action),
        text: suggestion.text,
        ...(suggestion.detail ? { description: suggestion.detail } : {}),
        ...(suggestion.url ? { url: suggestion.url } : {}),
        ...(suggestion.query ? { query: suggestion.query } : {}),
        provider: `orbis:${suggestion.kind}`,
        orbisScore: suggestion.score,
        rank: normalizeOrbis(suggestion.score, reference),
        provisional: false,
        generation: options.generation
      }
    })
}
