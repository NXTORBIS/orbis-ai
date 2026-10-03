import type { SelectionKind, SelectionReading } from './selectionText.ts'

/**
 * What Orbis can offer to do with something you have selected on a page.
 *
 * One list, read by both halves of Orbis: the browser draws the palette from it, and the helper decides what it is
 * willing to run from the same entries, so the two can never disagree about what an action is or what it is allowed
 * to touch. Adding a capability to Orbis means adding a row here; nothing in the drawing code knows any action by name.
 *
 * Three rules decide what appears when the orb is opened, and they are the whole design:
 *
 * **Nothing is offered that cannot run.** Every action names what it needs -- Orion, Search, Notes, the Whiteboard,
 * the browser itself -- and an action whose need is missing is not drawn greyed out, it is not drawn at all. A button
 * that fails when pressed is worse than one that was never there.
 *
 * **Nothing is offered that does not suit the text.** Translating a line of code, or defining a paragraph, is noise.
 * Each action says which kinds of selection it is for, and how much text it needs to mean anything.
 *
 * **Nothing that leaves the machine is offered for a selection that must not leave it.** Every action says plainly
 * whether it sends the text away. If the selection looks like a password, a key or a card number, every one of those
 * disappears and the local ones -- copy, open, search the page -- remain.
 */

/** Where an action's result belongs. Not every result wants the same surface. */
export type SelectionSurface =
  /** A small panel beside the selection: an answer to read. */
  | 'panel'
  /** The browser does something: a tab opens, a page is navigated to. */
  | 'browser'
  /** A line of confirmation and nothing more. */
  | 'toast'

/** What has to exist for an action to be worth offering. */
export type SelectionNeed = 'orion' | 'search' | 'notes' | 'whiteboard' | 'browser' | 'clipboard'

export interface SelectionAction {
  readonly id: string
  /** One or two words. The palette is not the place for a sentence. */
  readonly label: string
  /** A name from the shared icon set. */
  readonly icon: string
  /** What it does, for a tooltip and for a screen reader. */
  readonly hint: string
  /** Which kinds of selection it suits. `null` means any kind. */
  readonly kinds: readonly SelectionKind[] | null
  readonly needs: readonly SelectionNeed[]
  /**
   * Whether running this sends the selected text off this machine.
   *
   * The single most important field here. Everything that goes to a model is `true`, and everything `true` is hidden
   * the moment a selection looks sensitive.
   */
  readonly sends: boolean
  /** Fewest words for which this means anything. */
  readonly minWords: number
  /** Most words for which this still means anything, or null for no limit. */
  readonly maxWords: number | null
  readonly surface: SelectionSurface
  /** Higher sorts earlier, before the kind-specific nudges are applied. */
  readonly rank: number
  /** True when choosing it opens something to type in rather than running straight away. */
  readonly asks?: boolean
}

const action = (one: SelectionAction): SelectionAction => Object.freeze(one)

/**
 * The actions.
 *
 * Every one of these runs a real part of Orbis. If something is listed here it works; if a capability is not built,
 * it has no row, because a palette that offers what Orbis cannot do teaches people not to trust the palette.
 */
export const SELECTION_ACTIONS: readonly SelectionAction[] = Object.freeze([
  action({
    id: 'ask',
    label: 'Ask',
    icon: 'spark',
    hint: 'Ask Orion anything about the selected text',
    kinds: null,
    needs: ['orion'],
    sends: true,
    minWords: 1,
    maxWords: null,
    surface: 'panel',
    rank: 100,
    asks: true
  }),
  action({
    id: 'explain',
    label: 'Explain',
    icon: 'book',
    hint: 'Explain what the selected text means',
    kinds: null,
    needs: ['orion'],
    sends: true,
    minWords: 1,
    maxWords: null,
    surface: 'panel',
    rank: 90
  }),
  action({
    id: 'define',
    label: 'Define',
    icon: 'globe',
    hint: 'What this word means, and how it is used',
    kinds: ['word', 'quote'],
    needs: ['orion'],
    sends: true,
    minWords: 1,
    maxWords: 4,
    surface: 'panel',
    rank: 95
  }),
  action({
    id: 'summarise',
    label: 'Summarise',
    icon: 'lines',
    hint: 'The short version of the selected text',
    kinds: ['prose', 'quote', 'data'],
    needs: ['orion'],
    sends: true,
    minWords: 25,
    maxWords: null,
    surface: 'panel',
    rank: 88
  }),
  action({
    id: 'check',
    label: 'Fact check',
    icon: 'check',
    hint: 'Look this up and say what the sources actually support',
    kinds: ['prose', 'quote'],
    needs: ['orion', 'search'],
    sends: true,
    minWords: 4,
    maxWords: null,
    surface: 'panel',
    rank: 70
  }),
  action({
    id: 'simplify',
    label: 'Simplify',
    icon: 'layers',
    hint: 'Say the same thing in plainer words',
    kinds: ['prose', 'quote'],
    needs: ['orion'],
    sends: true,
    minWords: 8,
    maxWords: null,
    surface: 'panel',
    rank: 60
  }),
  action({
    id: 'rewrite',
    label: 'Rewrite',
    icon: 'note',
    hint: 'Write this again in a different tone',
    kinds: ['prose', 'quote'],
    needs: ['orion'],
    sends: true,
    minWords: 4,
    maxWords: null,
    surface: 'panel',
    rank: 58
  }),
  action({
    id: 'translate',
    label: 'Translate',
    icon: 'globe',
    hint: 'Put this into another language',
    kinds: ['prose', 'word', 'quote'],
    needs: ['orion'],
    sends: true,
    minWords: 1,
    maxWords: null,
    surface: 'panel',
    rank: 56
  }),

  // ---------------------------------------------------------------- code
  action({
    id: 'explain-code',
    label: 'Explain code',
    icon: 'code',
    hint: 'What this code does, line by line where it matters',
    kinds: ['code'],
    needs: ['orion'],
    sends: true,
    minWords: 1,
    maxWords: null,
    surface: 'panel',
    rank: 96
  }),
  action({
    id: 'find-bug',
    label: 'Find the bug',
    icon: 'bug',
    hint: 'Look for what is wrong with this code',
    kinds: ['code'],
    needs: ['orion'],
    sends: true,
    minWords: 2,
    maxWords: null,
    surface: 'panel',
    rank: 72
  }),

  // ---------------------------------------------------------------- numbers
  action({
    id: 'solve',
    label: 'Solve',
    icon: 'calculator',
    hint: 'Work this out, with the steps',
    kinds: ['math'],
    needs: ['orion'],
    sends: true,
    minWords: 1,
    maxWords: null,
    surface: 'panel',
    rank: 97
  }),
  action({
    id: 'analyse',
    label: 'Analyse',
    icon: 'chart',
    hint: 'What this data says',
    kinds: ['data'],
    needs: ['orion'],
    sends: true,
    minWords: 3,
    maxWords: null,
    surface: 'panel',
    rank: 94
  }),

  // ---------------------------------------------------------------- the browser's own
  action({
    id: 'open',
    label: 'Open',
    icon: 'globe',
    hint: 'Open this address in a new tab',
    kinds: ['url'],
    needs: ['browser'],
    sends: false,
    minWords: 1,
    maxWords: null,
    surface: 'browser',
    rank: 99
  }),
  action({
    id: 'search',
    label: 'Search',
    icon: 'search',
    hint: 'Search for the selected text',
    kinds: null,
    needs: ['search', 'browser'],
    sends: false,
    minWords: 1,
    maxWords: 60,
    surface: 'browser',
    rank: 80
  }),
  action({
    id: 'copy',
    label: 'Copy',
    icon: 'copy',
    hint: 'Copy the selected text',
    kinds: null,
    needs: ['clipboard'],
    sends: false,
    minWords: 1,
    maxWords: null,
    surface: 'toast',
    rank: 50
  }),
  action({
    id: 'note',
    label: 'Save to Notes',
    icon: 'sticky',
    hint: 'Keep this, with the page it came from',
    kinds: null,
    needs: ['notes'],
    sends: false,
    minWords: 1,
    maxWords: null,
    surface: 'toast',
    rank: 48
  }),
  action({
    id: 'whiteboard',
    label: 'Send to Whiteboard',
    icon: 'board',
    hint: 'Put this on a board, with the page it came from',
    kinds: null,
    needs: ['whiteboard'],
    sends: false,
    minWords: 1,
    maxWords: null,
    surface: 'toast',
    rank: 44
  })
])

const BY_ID: ReadonlyMap<string, SelectionAction> = new Map(SELECTION_ACTIONS.map((one) => [one.id, one]))

export function selectionAction(id: string): SelectionAction | null {
  return BY_ID.get(id) ?? null
}

/**
 * Which kinds get a nudge up the list.
 *
 * Separate from `rank` so that an action can be generally minor and locally essential: translating is well down the
 * list on an English page and the first thing wanted on a page that is not in your language.
 */
const PREFERRED: Readonly<Record<SelectionKind, readonly string[]>> = Object.freeze({
  prose: ['explain', 'summarise', 'ask'],
  word: ['define', 'explain', 'search'],
  code: ['explain-code', 'find-bug', 'ask'],
  math: ['solve', 'explain', 'ask'],
  url: ['open', 'copy', 'search'],
  email: ['copy', 'search', 'ask'],
  address: ['search', 'copy', 'ask'],
  date: ['explain', 'search', 'copy'],
  data: ['analyse', 'summarise', 'ask'],
  quote: ['explain', 'check', 'summarise']
})

export interface PaletteInput {
  readonly reading: SelectionReading
  /** What this Orbis can actually do, right now. Absent means absent: never assumed. */
  readonly available: readonly SelectionNeed[]
  /** The language the person reads, as a two-letter code, for deciding whether translating is worth offering. */
  readonly ownLanguage?: string | null
  /** Actions the person has hidden, by id. */
  readonly hidden?: readonly string[]
  /** Actions the person has pinned, by id, in the order they want them. */
  readonly pinned?: readonly string[]
  /** How many to show before the rest go behind "More". */
  readonly top?: number
}

export interface Palette {
  /** Shown straight away. */
  readonly top: readonly SelectionAction[]
  /** Behind "More". */
  readonly more: readonly SelectionAction[]
  /** Why everything that sends text away is missing, or null when nothing was held back. */
  readonly withheld: string | null
}

/**
 * Which actions to show for this selection, in order.
 *
 * Runs in the page, on every opening of the orb, with no network and no model -- see the note at the top of
 * selectionText.ts about why. A richer ordering learnt from what somebody actually uses belongs in the personalisation
 * engine and arrives here as `pinned` and `hidden`; it is not invented here.
 */
export function buildPalette(input: PaletteInput): Palette {
  const { reading } = input
  const available = new Set(input.available)
  const hidden = new Set(input.hidden ?? [])
  const pinned = input.pinned ?? []
  const risky = reading.risk !== 'none'

  const fits = (one: SelectionAction): boolean => {
    if (hidden.has(one.id)) return false
    if (!one.needs.every((need) => available.has(need))) return false
    if (risky && one.sends) return false
    if (one.kinds !== null && !one.kinds.includes(reading.kind)) return false
    if (reading.words < one.minWords) return false
    if (one.maxWords !== null && reading.words > one.maxWords) return false
    // Translating what is already in your own language is an answer nobody asked for.
    if (one.id === 'translate' && input.ownLanguage && reading.language === input.ownLanguage) return false
    return true
  }

  const preferred = PREFERRED[reading.kind] ?? []
  const scored = SELECTION_ACTIONS.filter(fits).map((one) => {
    const pin = pinned.indexOf(one.id)
    const prefer = preferred.indexOf(one.id)
    return {
      one,
      /*
       * Pinned first, in the order they were pinned; then the ones this kind of text wants; then by rank.
       *
       * The three steps are far apart on purpose. Close together, a pinned action could still be pushed down the list
       * by an unpinned one with a high rank, which makes pinning look broken. Each step has to beat everything below
       * it outright, including the gap between the first pinned action and the second.
       */
      score: (pin >= 0 ? 1_000_000 - pin * 10_000 : 0) + (prefer >= 0 ? 10_000 - prefer * 100 : 0) + one.rank
    }
  })
  scored.sort((a, b) => b.score - a.score || a.one.id.localeCompare(b.one.id))

  const ordered = scored.map((s) => s.one)
  const cut = Math.max(1, input.top ?? 4)
  return {
    top: Object.freeze(ordered.slice(0, cut)),
    more: Object.freeze(ordered.slice(cut)),
    withheld: risky && SELECTION_ACTIONS.some((one) => one.sends && !hidden.has(one.id)) ? reading.risk : null
  }
}
