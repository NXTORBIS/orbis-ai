import { kindFacts, type VisualKind } from './kinds.ts'

/**
 * What can be done with a selection once Orbis has looked at it.
 *
 * Two rules, and between them they are the whole of this file:
 *
 * **Nothing is offered that cannot run.** Every action names what it needs, and an action whose need Orbis has not
 * got is not drawn at all -- not drawn greyed out, not drawn with a tooltip. The Command Center in the browser panel
 * shipped eighteen rows that looked live and opened nothing, and the lesson from that is that a disabled-looking
 * button is still a promise. So the list is built from what the helper says is available, every time.
 *
 * **What is offered depends on what was found.** A photograph of a plant gets Identify and Search; a circuit gets the
 * Circuit Lab; a paragraph of Japanese gets Translate. Offering all of them always is how a compact bar becomes a
 * menu nobody reads, and the order below is a judgement about what somebody actually wanted when they selected that
 * kind of thing.
 */

/** What an action needs before it can be offered. */
export type VisualNeed =
  /** A model that can look at an image. Without it there is no Visual Search at all. */
  | 'eyes'
  /** The browser, for a tab or a search. */
  | 'browser'
  /** Real Notes to save into. */
  | 'notes'
  /** The Orbis window, for anything that continues in the conversation or opens a laboratory. */
  | 'window'
  /** Nothing: it happens in the page. */
  | 'page'

export interface VisualAction {
  readonly id: string
  readonly label: string
  /** What it does, for the title attribute and the screen reader. */
  readonly says: string
  readonly needs: VisualNeed
  /**
   * Whether running it sends the selection somewhere beyond this machine. Used for the one refusal that is not about
   * availability: a selection the person was warned about is not sent.
   */
  readonly sends: boolean
  /** An icon name from the browser panel's set, so Visual Search uses the icons Orbis already has. */
  readonly icon: string
}

export const VISUAL_ACTIONS: readonly VisualAction[] = Object.freeze([
  { id: 'identify', label: 'Identify', says: 'Say what this is', needs: 'eyes', sends: true, icon: 'spark' },
  { id: 'explain', label: 'Explain', says: 'Explain what this shows', needs: 'eyes', sends: true, icon: 'book' },
  { id: 'read', label: 'Read text', says: 'Read the words out of this', needs: 'eyes', sends: true, icon: 'lines' },
  { id: 'translate', label: 'Translate', says: 'Translate the words in this', needs: 'eyes', sends: true, icon: 'globe' },
  { id: 'summarise', label: 'Summarise', says: 'Summarise what this says', needs: 'eyes', sends: true, icon: 'lines' },
  { id: 'solve', label: 'Solve', says: 'Work through this problem', needs: 'eyes', sends: true, icon: 'calculator' },
  { id: 'extract', label: 'Extract', says: 'Pull the numbers out of this', needs: 'eyes', sends: true, icon: 'chart' },
  { id: 'search', label: 'Search', says: 'Search the web for what this is', needs: 'browser', sends: true, icon: 'search' },
  { id: 'similar', label: 'Find similar', says: 'Search for things like this', needs: 'browser', sends: true, icon: 'layers' },
  { id: 'lab', label: 'Open laboratory', says: 'Hand this to the laboratory for it', needs: 'window', sends: false, icon: 'orion' },
  { id: 'chat', label: 'Continue in chat', says: 'Carry this on in the conversation', needs: 'window', sends: false, icon: 'quote' },
  { id: 'note', label: 'Keep', says: 'Save this and the answer as a note', needs: 'notes', sends: false, icon: 'note' },
  { id: 'copy', label: 'Copy', says: 'Copy the answer', needs: 'page', sends: false, icon: 'copy' },
  { id: 'open', label: 'Open address', says: 'Open the address found in this', needs: 'browser', sends: false, icon: 'external' }
])

const BY_ID = new Map(VISUAL_ACTIONS.map((one) => [one.id, one]))

export function visualAction(id: string): VisualAction | null {
  return BY_ID.get(id) ?? null
}

/**
 * Which actions a kind earns, best first.
 *
 * Written out per kind rather than derived, because the ordering is the judgement and a rule general enough to
 * produce all of these would be a rule nobody could read. `identify` leads for anything that is a thing; `explain`
 * leads for anything that is a representation of a thing.
 */
const BY_KIND: Readonly<Record<VisualKind, readonly string[]>> = Object.freeze({
  text: ['read', 'translate', 'summarise', 'explain'],
  document: ['summarise', 'read', 'explain', 'translate'],
  table: ['extract', 'explain', 'summarise', 'lab'],
  maths: ['solve', 'explain', 'lab', 'read'],
  graph: ['explain', 'extract', 'lab', 'identify'],
  chart: ['explain', 'extract', 'lab', 'summarise'],
  diagram: ['explain', 'identify', 'lab', 'summarise'],
  circuit: ['identify', 'explain', 'lab', 'extract'],
  chemistry: ['identify', 'explain', 'lab'],
  code: ['explain', 'read', 'lab', 'summarise'],
  product: ['identify', 'search', 'similar', 'explain'],
  object: ['identify', 'explain', 'search'],
  plant: ['identify', 'explain', 'search'],
  animal: ['identify', 'explain', 'search'],
  food: ['identify', 'explain', 'search'],
  vehicle: ['identify', 'search', 'explain'],
  person: ['explain', 'search'],
  place: ['identify', 'explain', 'search'],
  map: ['explain', 'identify'],
  artwork: ['identify', 'explain', 'search'],
  photo: ['explain', 'identify', 'search'],
  ui: ['explain', 'read', 'identify'],
  unknown: ['identify', 'explain', 'read', 'search']
})

export interface ActionsInput {
  /** What Orion said the selection is. `unknown` before anything has been looked at. */
  readonly kind: VisualKind
  /** What Orbis can actually do, from the helper rather than from hope. */
  readonly can: readonly VisualNeed[]
  /** Whether the answer carried something structured enough to hand to a laboratory. */
  readonly structured: boolean
  /** Whether the answer found a web address worth offering to open. */
  readonly address: boolean
  /** Whether there is an answer yet. Before there is, `copy`, `note` and `chat` have nothing to work on. */
  readonly answered: boolean
  /** A selection that looked sensitive: everything that sends is dropped, and the bar says why. */
  readonly risky: boolean
  /** How many to return. The bar is small on purpose. */
  readonly most?: number
}

export interface ActionList {
  readonly actions: readonly VisualAction[]
  /** Why something is missing, when it is worth saying. Empty when nothing was held back. */
  readonly says: string
}

/**
 * The actions to draw, in order.
 *
 * The suggestions come first (what this kind of thing earns), then the ones that apply to any answer, and the whole
 * list is filtered by what is available. `most` trims it, and trimming happens last so that an unavailable action
 * does not eat one of the four slots.
 */
export function visualActions(input: ActionsInput): ActionList {
  const can = new Set<VisualNeed>([...input.can, 'page'])
  const facts = kindFacts(input.kind)
  const wanted: string[] = [...(BY_KIND[input.kind] ?? BY_KIND.unknown)]

  // Anything that works on an answer rather than on the selection.
  if (input.answered) {
    for (const id of ['copy', 'chat', 'note']) if (!wanted.includes(id)) wanted.push(id)
  }
  if (input.address) wanted.unshift('open')

  const held: string[] = []
  const out: VisualAction[] = []
  for (const id of wanted) {
    const action = visualAction(id)
    if (!action) continue
    if (out.some((one) => one.id === id)) continue
    // A laboratory button needs three separate things to be true, and all three are checked: a laboratory for this
    // kind, something structured to give it, and a window to open it in.
    if (id === 'lab' && (!facts.lab || !input.structured)) continue
    if (!can.has(action.needs)) {
      held.push(action.label)
      continue
    }
    if (action.sends && input.risky) {
      held.push(action.label)
      continue
    }
    out.push(action)
  }

  const most = input.most ?? 4
  const trimmed = out.slice(0, most)
  let says = ''
  if (input.risky) says = 'This selection looks like it holds something private, so nothing here will send it anywhere.'
  else if (!can.has('eyes')) says = 'Orbis has no key for the service that can look at an image, so there is nothing to ask.'
  else if (held.length && !can.has('window')) says = 'Open the Orbis window to carry this on in a conversation or a laboratory.'
  return { actions: trimmed, says }
}

/** The label a laboratory button carries for a kind. Empty when that kind opens nothing. */
export function labSays(kind: VisualKind): string {
  return kindFacts(kind).labSays
}

/** The laboratory a kind opens, or null. */
export function labFor(kind: VisualKind): string | null {
  return kindFacts(kind).lab
}
