import { buildSuggestions, type OmniSources, type SuggestionKind } from './omnibox.ts'

/**
 * What Orbis adds to the browser's own address bar.
 *
 * The browser already has an address bar, and a good one: Chromium's omnibox finds history, bookmarks, pages that are
 * already open, site search by keyword and the search engine's suggestions, ranks them against each other and draws
 * them. None of that is repeated here. Repeating it would mean two engines disagreeing about the same row, and a
 * person watching a bookmark appear twice with different wording.
 *
 * What Chromium cannot do is know about Orbis. It has never heard of a workspace, of a question Orion researched, of
 * Orion's own predictions, or of the Images/Videos/News views of an Orbis search. Those four kinds are the whole of
 * what this contributes, and they are produced by the same `buildSuggestions` the Orbis window's address bar uses --
 * so the two bars agree, because they are one engine asked two different questions.
 */
export const ORBIS_ONLY_KINDS = ['workspace', 'research', 'vertical', 'orion'] as const

export type OrbisOnlyKind = (typeof ORBIS_ONLY_KINDS)[number]

const isOrbisOnly = (kind: SuggestionKind): kind is OrbisOnlyKind =>
  (ORBIS_ONLY_KINDS as readonly string[]).includes(kind)

/** One row for the browser's omnibox. */
export interface OrbisOmniboxRow {
  kind: OrbisOnlyKind
  /** The main line. */
  text: string
  /** The second line, saying where the row came from. Never empty: a row that cannot explain itself is not shown. */
  detail: string
  /** Opens this address. Exactly one of `url`, `query` and `workspaceId` is set. */
  url?: string
  /** Searches for this instead. */
  query?: string
  /**
   * Opens this workspace, which is not a navigation: a workspace is a set of pages, and opening it is something Orbis
   * does rather than somewhere the browser goes. The omnibox carries it as an action on the match.
   */
  workspaceId?: string
  /**
   * Where the row sits on Chromium's relevance scale, which the omnibox ranks everything by.
   *
   * The band is deliberately below what the omnibox gives a typed address or a page the person visits constantly, and
   * around what it gives an ordinary search suggestion. Orbis has things to offer here; it does not have the right to
   * push aside the address someone is halfway through typing.
   */
  relevance: number
}

/**
 * The top of each kind's band.
 *
 * A workspace sits highest because naming one is unambiguous -- nothing else is called that -- and lowest is Orion's
 * prediction, which is a guess at what the person might mean.
 */
const BAND: Record<OrbisOnlyKind, number> = {
  workspace: 940,
  research: 880,
  vertical: 830,
  orion: 780
}

/** How far a row may fall inside its own band, so a kind can never reach into the one below it. */
const STEP = 15

/** At most this many of any one kind, so a person with forty workspaces still sees the rest. */
const PER_KIND = 2

/** Everything Orbis knows that Chromium does not. */
export interface OrbisOmniboxSources {
  /** Questions Orion researched, and when. */
  research: { question: string; at: number }[]
  /** Saved sets of tabs. */
  workspaces: { id: string; name: string; tabCount?: number }[]
  /** Orion's predictions for the text so far. */
  orion: string[]
  now: number
  /**
   * Whether the person's own history may be used. Off, the rows drawn from what they have done -- research above all
   * -- are not offered at all, exactly as in the Orbis window.
   */
  personalized: boolean
}

/**
 * The Orbis rows for what is being typed, best first.
 *
 * `limit` is a ceiling, not a target: on most inputs there is nothing to say, and saying nothing is the right answer.
 */
export function orbisOnlySuggestions(input: string, sources: OrbisOmniboxSources, limit = 6): OrbisOmniboxRow[] {
  const text = input.replace(/\s+/g, ' ').trim()
  if (!text) return []

  // The one engine, asked with everything Chromium covers left empty. `inline` is off because an inline completion
  // belongs to whichever address bar has the caret, and this one does not have it.
  const full: OmniSources = {
    history: [],
    bookmarks: [],
    searches: [],
    picks: {},
    research: sources.research,
    tabs: [],
    workspaces: sources.workspaces,
    web: [],
    orion: sources.orion,
    now: sources.now,
    personalized: sources.personalized
  }

  const { items } = buildSuggestions(text, full, Math.max(limit * 4, 24), false)

  const seenPerKind = new Map<OrbisOnlyKind, number>()
  const rows: OrbisOmniboxRow[] = []
  for (const item of items) {
    if (rows.length >= limit) break
    if (!isOrbisOnly(item.kind)) continue
    // A row that cannot be acted on has nowhere to go when it is chosen.
    if (!item.url && !item.query && !item.workspaceId) continue
    const taken = seenPerKind.get(item.kind) ?? 0
    if (taken >= PER_KIND) continue
    seenPerKind.set(item.kind, taken + 1)
    rows.push({
      kind: item.kind,
      text: item.text,
      detail: item.detail ?? DEFAULT_DETAIL[item.kind],
      ...(item.workspaceId ? { workspaceId: item.workspaceId } : item.url ? { url: item.url } : { query: item.query }),
      relevance: BAND[item.kind] - taken * STEP
    })
  }
  // Best first, and stable between two rows of equal standing so the list does not reshuffle under the cursor.
  return rows.sort((a, b) => (b.relevance !== a.relevance ? b.relevance - a.relevance : a.text.localeCompare(b.text)))
}

/** What a row says about itself when the engine had nothing more specific to add. */
const DEFAULT_DETAIL: Record<OrbisOnlyKind, string> = {
  workspace: 'Workspace',
  research: 'Researched with Orion',
  vertical: 'Orbis Search',
  orion: 'Orion suggests'
}
