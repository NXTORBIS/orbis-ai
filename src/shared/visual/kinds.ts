/**
 * What a selection turned out to be, and what Orbis can do about it.
 *
 * The categories are not decoration: each one changes which actions are offered and which laboratory, if any, the
 * selection can be handed to. They come from the model looking at the pixels -- never from the page's address, never
 * from a word in its title, and never from a guess made before anything was looked at. A category Orion did not
 * return is `unknown`, and `unknown` still gets every general action, because not knowing what a thing is has never
 * been a reason to refuse to explain it.
 *
 * The laboratory column is the part that makes this feature Orbis's rather than a lens: a graph becomes something you
 * can plot, a circuit something you can run. Each id here is a real Native App, and `visual.test.ts` checks every one
 * of them against the registry -- so a laboratory that is renamed breaks the build instead of becoming a dead button.
 */

export type VisualKind =
  | 'text'
  | 'document'
  | 'table'
  | 'maths'
  | 'graph'
  | 'chart'
  | 'diagram'
  | 'circuit'
  | 'chemistry'
  | 'code'
  | 'product'
  | 'object'
  | 'plant'
  | 'animal'
  | 'food'
  | 'vehicle'
  | 'person'
  | 'place'
  | 'map'
  | 'artwork'
  | 'photo'
  | 'ui'
  | 'unknown'

export interface KindFacts {
  readonly id: VisualKind
  /** What to call it on screen, in the result's category line. */
  readonly label: string
  /**
   * The laboratory this kind can be handed to, when Orion also returned something structured enough to hand over.
   * Null means there is nothing to open, which is most of them -- a photograph of a cat opens nothing.
   */
  readonly lab: string | null
  /** What the lab button says. Only read when `lab` is set. */
  readonly labSays: string
  /** Whether this kind is mostly words, which is what earns the reading and translating actions. */
  readonly wordy: boolean
}

export const VISUAL_KINDS: readonly KindFacts[] = Object.freeze([
  { id: 'text', label: 'Text', lab: null, labSays: '', wordy: true },
  { id: 'document', label: 'Document', lab: null, labSays: '', wordy: true },
  { id: 'table', label: 'Table', lab: 'data-explorer', labSays: 'Open the Data Explorer', wordy: true },
  { id: 'maths', label: 'Maths', lab: 'function-plotter', labSays: 'Open the Function Plotter', wordy: true },
  { id: 'graph', label: 'Graph', lab: 'function-plotter', labSays: 'Open the Function Plotter', wordy: false },
  { id: 'chart', label: 'Chart', lab: 'data-explorer', labSays: 'Open the Data Explorer', wordy: false },
  { id: 'diagram', label: 'Diagram', lab: 'flowchart', labSays: 'Open it as a flowchart', wordy: false },
  { id: 'circuit', label: 'Circuit', lab: 'circuit-lab', labSays: 'Open the Circuit Lab', wordy: false },
  { id: 'chemistry', label: 'Chemical structure', lab: 'molecule-lab', labSays: 'Open the Molecule Lab', wordy: false },
  { id: 'code', label: 'Code', lab: 'code-playground', labSays: 'Open in the Code Playground', wordy: true },
  { id: 'product', label: 'Product', lab: null, labSays: '', wordy: false },
  { id: 'object', label: 'Object', lab: null, labSays: '', wordy: false },
  { id: 'plant', label: 'Plant', lab: null, labSays: '', wordy: false },
  { id: 'animal', label: 'Animal', lab: null, labSays: '', wordy: false },
  { id: 'food', label: 'Food', lab: null, labSays: '', wordy: false },
  { id: 'vehicle', label: 'Vehicle', lab: null, labSays: '', wordy: false },
  { id: 'person', label: 'Person', lab: null, labSays: '', wordy: false },
  { id: 'place', label: 'Place', lab: null, labSays: '', wordy: false },
  { id: 'map', label: 'Map', lab: null, labSays: '', wordy: false },
  { id: 'artwork', label: 'Artwork', lab: null, labSays: '', wordy: false },
  { id: 'photo', label: 'Photograph', lab: null, labSays: '', wordy: false },
  { id: 'ui', label: 'Interface', lab: null, labSays: '', wordy: false },
  { id: 'unknown', label: 'Selection', lab: null, labSays: '', wordy: false }
])

const BY_ID = new Map(VISUAL_KINDS.map((one) => [one.id, one]))

/** The facts for a kind, or the ones for `unknown` when the name is not one Orbis has. */
export function kindFacts(id: string): KindFacts {
  return BY_ID.get(id as VisualKind) ?? BY_ID.get('unknown')!
}

/** Whether a string is a kind Orbis knows. Used to refuse a category a model invented. */
export function isKind(id: string): id is VisualKind {
  return BY_ID.has(id as VisualKind)
}

/** Every kind name, for the prompt -- so the list the model is given is the list the code accepts. */
export const KIND_NAMES: readonly string[] = Object.freeze(VISUAL_KINDS.map((one) => one.id))

/** Every laboratory any kind can open, for the test that checks they all exist. */
export const KIND_LABS: readonly string[] = Object.freeze([...new Set(VISUAL_KINDS.map((one) => one.lab).filter((one): one is string => one !== null))])
