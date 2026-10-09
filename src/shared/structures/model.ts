/**
 * What a data structure looks like while it is being used.
 *
 * ## Why this is a separate file from the structures themselves
 *
 * A stack, a binary search tree and a hash table have nothing in common as code, and everything in common as
 * *pictures*: boxes in a row, circles joined by lines, or rows of buckets. One renderer can draw all of them if
 * every structure reports itself in the same shape, and that shape is `Snapshot`.
 *
 * This is the same bargain `algorithms/trace.ts` makes for algorithms, and it is made here for the same reason: the
 * interesting thing about a data structure is not its final state but the sequence it passed through, so an operation
 * records every step it takes and the picture after each one.
 *
 * ## The counts are measured, never stated
 *
 * `Counts` is incremented by the structures as they work. Nothing writes an expected figure into it. So when the
 * laboratory shows that inserting a thousand sorted keys into an unbalanced tree cost about half a million
 * comparisons, that is the number the tree actually did — which is the only version of that lesson worth showing.
 */

/** The kinds of picture a structure can be drawn as. */
export type Layout =
  /** Boxes left to right: a stack, a queue, an array-backed heap. */
  | 'row'
  /** Circles joined by arrows, positioned by the structure: a linked list. */
  | 'chain'
  /** A tree, laid out by depth and order. */
  | 'tree'
  /** Numbered buckets, each holding none or several entries: a hash table. */
  | 'buckets'

/** One box, bucket slot, or node, as drawn. */
export interface Cell {
  /** Stable across steps where the thing is the same thing, so a renderer can animate it. */
  id: string
  /** What is in it. Null is a genuinely empty slot, which for a hash table is different from a missing one. */
  value: number | string | null
  /** Where it sits. For `row` and `buckets` this is the index; for `tree` and `chain` it is drawing order. */
  at: number
  /** Why it is highlighted, if it is. */
  mark?: 'looking' | 'found' | 'changed' | 'added' | 'removed' | 'path' | 'unbalanced'
  /** A short label drawn with it: a bucket number, a balance factor, a priority. */
  note?: string
}

/** A line between two cells. */
export interface Link {
  from: string
  to: string
  /** `next`/`prev` for lists, `left`/`right` for trees, `child` for a trie. */
  role: 'next' | 'prev' | 'left' | 'right' | 'child' | 'parent'
  mark?: 'changed' | 'path' | 'broken'
}

/** The picture after a step. */
export interface Snapshot {
  layout: Layout
  cells: readonly Cell[]
  links: readonly Link[]
  /**
   * Rows, for a tree: how deep each cell sits. Absent for the other layouts.
   *
   * Given rather than derived because a renderer deriving depth from the links has to walk them, and the structure
   * already knows.
   */
  depth?: Readonly<Record<string, number>>
  /** What is true of the structure right now, in words: "3 of 8 buckets used", "height 4, balanced". */
  notes: readonly string[]
}

/** What an operation did at one moment. */
export interface Step {
  n: number
  /** Said the way somebody would say it: "8 is less than 12, so go left." */
  says: string
  kind: StepKind
  snapshot: Snapshot
}

export type StepKind =
  | 'start'
  | 'compare'
  | 'read'
  | 'write'
  | 'link'
  | 'rotate'
  | 'probe'
  | 'grow'
  | 'found'
  | 'missing'
  | 'done'
  | 'refused'

/**
 * What the operation cost.
 *
 * Every field is counted by the structures themselves. A structure that does not do a kind of work leaves its count
 * at zero rather than omitting it, so a comparison table has no holes in it.
 */
export interface Counts {
  /** Two keys held against each other. */
  comparisons: number
  /** A cell or field looked at. */
  reads: number
  /** A cell or field changed. */
  writes: number
  /** A pointer repointed. The honest cost of a linked structure. */
  links: number
  /** A tree rotation. Only a self-balancing tree ever does these. */
  rotations: number
  /** A bucket tried. For a hash table this is the number that matters, not the comparisons. */
  probes: number
  /** A new node or a resized array. */
  allocations: number
  /** The deepest the structure got during the operation. */
  deepest: number
}

const noCounts = (): Counts => ({
  comparisons: 0,
  reads: 0,
  writes: 0,
  links: 0,
  rotations: 0,
  probes: 0,
  allocations: 0,
  deepest: 0
})

/** The result of one operation. */
export interface Run {
  structure: string
  operation: string
  /** What was asked for, so a transcript reads sensibly without the caller keeping it. */
  argument: string
  steps: readonly Step[]
  counts: Counts
  /** The picture at the end. The same object as the last step's snapshot when there is one. */
  ending: Snapshot
  /** What the operation returned, in words: "7", "nothing — the stack was empty", "already there". */
  answer: string
  /** True when the operation changed the structure. A failed lookup does not. */
  changed: boolean
  /** Hit the step ceiling and stopped. The steps up to that point are real; there are simply more. */
  truncated: boolean
}

/**
 * The most steps one operation may record.
 *
 * An operation on a structure is small — tens of steps, not thousands — so this is far above anything legitimate and
 * exists only to stop a bug in a rebalance loop from exhausting memory. Bulk building uses `quietly` instead, which
 * records no steps at all.
 */
export const STEP_CEILING = 20_000

export interface StructureError {
  error: string
  says: string
  fix: string
}

export const isStructureError = (value: unknown): value is StructureError =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value && 'fix' in value

export const refuse = (error: string, says: string, fix: string): StructureError => ({ error, says, fix })

/**
 * Collects the steps and the counts while a structure works.
 *
 * ## It can be told to stay quiet
 *
 * Building a structure from a thousand keys to *then* show one lookup should not record a thousand insertions. So a
 * recorder in quiet mode counts everything and records nothing, and the counts stay true — which is what makes
 * "inserting these thousand keys cost this many comparisons" a measurement rather than an estimate.
 */
export class Recorder {
  private readonly steps: Step[] = []
  readonly counts: Counts = noCounts()
  private hitCeiling = false
  // Written out rather than declared as a constructor parameter, because the test runner strips types without
  // compiling and a parameter property is syntax it cannot strip.
  private readonly quiet: boolean

  constructor(quiet = false) {
    this.quiet = quiet
  }

  compare(says: string, picture: () => Snapshot): void {
    this.counts.comparisons += 1
    this.add('compare', says, picture)
  }

  read(says: string, picture: () => Snapshot): void {
    this.counts.reads += 1
    this.add('read', says, picture)
  }

  write(says: string, picture: () => Snapshot): void {
    this.counts.writes += 1
    this.add('write', says, picture)
  }

  link(says: string, picture: () => Snapshot): void {
    this.counts.links += 1
    this.add('link', says, picture)
  }

  rotate(says: string, picture: () => Snapshot): void {
    this.counts.rotations += 1
    this.add('rotate', says, picture)
  }

  probe(says: string, picture: () => Snapshot): void {
    this.counts.probes += 1
    this.add('probe', says, picture)
  }

  grow(says: string, picture: () => Snapshot): void {
    this.counts.allocations += 1
    this.add('grow', says, picture)
  }

  allocate(): void {
    this.counts.allocations += 1
  }

  /** A step that costs nothing — a start, an answer, a refusal. */
  note(kind: StepKind, says: string, picture: () => Snapshot): void {
    this.add(kind, says, picture)
  }

  /** The deepest point reached, reported by the structure because only it knows. */
  reached(depth: number): void {
    if (depth > this.counts.deepest) this.counts.deepest = depth
  }

  private add(kind: StepKind, says: string, picture: () => Snapshot): void {
    if (this.quiet) return
    if (this.steps.length >= STEP_CEILING) {
      this.hitCeiling = true
      return
    }
    this.steps.push({ n: this.steps.length, says, kind, snapshot: picture() })
  }

  finish(
    structure: string,
    operation: string,
    argument: string,
    ending: Snapshot,
    answer: string,
    changed: boolean
  ): Run {
    return {
      structure,
      operation,
      argument,
      steps: Object.freeze(this.steps.slice()),
      counts: { ...this.counts },
      ending,
      answer,
      changed,
      truncated: this.hitCeiling
    }
  }
}

/** The counts, said in a sentence, leaving out whatever was zero. */
export function describeCounts(counts: Counts): string {
  const parts: string[] = []
  const add = (n: number, one: string, many: string): void => {
    if (n > 0) parts.push(`${n.toLocaleString()} ${n === 1 ? one : many}`)
  }
  add(counts.comparisons, 'comparison', 'comparisons')
  add(counts.probes, 'bucket tried', 'buckets tried')
  add(counts.reads, 'read', 'reads')
  add(counts.writes, 'write', 'writes')
  add(counts.links, 'pointer changed', 'pointers changed')
  add(counts.rotations, 'rotation', 'rotations')
  add(counts.allocations, 'allocation', 'allocations')
  if (parts.length === 0) return 'It cost nothing measurable.'
  return `${parts.join(', ')}.`
}

/** A snapshot with nothing in it, for an empty structure. */
export const emptySnapshot = (layout: Layout, notes: readonly string[]): Snapshot =>
  Object.freeze({ layout, cells: Object.freeze([]), links: Object.freeze([]), notes: Object.freeze(notes.slice()) })

/** Keys, read from what somebody typed. Numbers stay numbers so comparisons are numeric where they can be. */
export function readKeys(text: string): readonly (number | string)[] | StructureError {
  const pieces = String(text)
    .split(/[\s,;]+/)
    .map((one) => one.trim())
    .filter((one) => one.length > 0)
  if (pieces.length === 0) {
    return refuse('no keys', 'Nothing was given to put in.', 'Type some values separated by spaces or commas.')
  }
  if (pieces.length > 4_000) {
    return refuse(
      'too many',
      `${pieces.length.toLocaleString()} values is more than this can draw.`,
      'Use 4,000 or fewer, or build it in stages.'
    )
  }
  return Object.freeze(
    pieces.map((one) => {
      const n = Number(one)
      return Number.isFinite(n) && one !== '' ? n : one
    })
  )
}

/** Compares two keys the way the structures do: numerically when both are numbers, otherwise as text. */
export function compareKeys(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  const left = String(a)
  const right = String(b)
  return left < right ? -1 : left > right ? 1 : 0
}
