/**
 * What an algorithm records while it runs.
 *
 * ## The trace is the algorithm's own account of itself
 *
 * An algorithm here does not return an answer and leave the visualiser to invent an animation. It runs, and as it
 * runs it records every comparison, every swap, every read, every recursive call, and the state of whatever it is
 * working on. The visualiser then *replays a recording*. That distinction is the whole difference between a
 * computational laboratory and a cartoon:
 *
 * ```
 *   a cartoon      :  animation invents plausible-looking steps
 *   a laboratory   :  the algorithm emits steps; the display shows them
 * ```
 *
 * It also means the step count, the comparison count and the complexity curve are *measured*, not asserted. If
 * quicksort on this input made 41 comparisons, 41 is what somebody sees, and nothing in the display could show a
 * different number.
 *
 * ## Bounded, because a trace of a million steps is a hang
 *
 * Every run carries a step ceiling. Reaching it stops the run and says so — `cut: true` — rather than filling memory
 * or freezing the window. An algorithm that was cut off is reported as cut off; its answer is not presented as
 * complete.
 *
 * ## Deterministic
 *
 * Nothing here reads a clock or `Math.random`. Randomised algorithms take a seeded generator, so a run is
 * reproducible from its seed and a comparison between two algorithms is a comparison and not a coincidence.
 *
 * Pure.
 */

// ---------------------------------------------------------------- what a step is

/**
 * The kinds of thing an algorithm does.
 *
 * Deliberately a closed set: the visualiser has to know how to draw each one, and a free-form string would mean a
 * step nothing can render. Adding a kind is a decision made here, together with how it looks.
 */
export type StepKind =
  /** Looked at a value without changing it. */
  | 'read'
  /** Compared two values. The thing complexity is counted in for a comparison sort. */
  | 'compare'
  /** Exchanged two positions. */
  | 'swap'
  /** Wrote a value into a position. */
  | 'write'
  /** Narrowed or moved a region of interest: a binary search's bounds, a partition's range. */
  | 'range'
  /** Marked something as settled — in its final place, visited, chosen. */
  | 'settle'
  /** Entered a recursive call or a new frame. */
  | 'call'
  /** Left one. */
  | 'return'
  /** Added to a queue, stack or heap. */
  | 'push'
  /** Took from one. */
  | 'pop'
  /** Visited a node or edge. */
  | 'visit'
  /** Updated a running value: a distance, a total, a best-so-far. */
  | 'update'
  /** Something the algorithm wants said at this point, in words. Never a substitute for the above. */
  | 'note'
  /** The answer. Always the last step of a run that finished. */
  | 'done'

export const STEP_KINDS: readonly StepKind[] = Object.freeze([
  'read',
  'compare',
  'swap',
  'write',
  'range',
  'settle',
  'call',
  'return',
  'push',
  'pop',
  'visit',
  'update',
  'note',
  'done'
])

/**
 * One thing that happened.
 *
 * `at` holds whichever positions, nodes or keys the step concerns — the visualiser highlights them and does not have
 * to work out which they were. `says` is one short sentence in plain words, which is what an educational overlay
 * shows and what Orion is given when somebody asks why a step happened.
 */
export interface Step {
  /** Its position in the run, from 0. */
  n: number
  kind: StepKind
  /** Positions in an array, or node ids in a graph. Empty for a step about nothing in particular. */
  at: readonly (number | string)[]
  /** What it did, in words. Never invented later: the algorithm wrote it as it ran. */
  says: string
  /**
   * The values involved, when the step is about values.
   *
   * For a compare: the two values. For a write: the value written. Kept so the display need not re-read the array
   * and risk showing a value from a later moment.
   */
  values?: readonly (number | string)[]
  /** How deep in recursion this step is, for drawing a recursion tree. */
  depth?: number
  /** Which frame it belongs to, so a recursion tree can attach it. */
  frame?: number
  /** A named region, for things like a partition's bounds or a search's window. */
  region?: { from: number; to: number; label: string }
  /**
   * The algorithm's own variables at this moment, for the panel that shows them.
   *
   * Named as the algorithm names them -- `i`, `j`, `pivot`, `lo`, `hi`, `gap` -- because somebody following a
   * trace is following the code, and a variable renamed on the way to the screen is a variable they cannot find.
   * Only what changed or matters at this step; the display carries the last value forward.
   */
  vars?: Readonly<Record<string, number | string | boolean>>
  /**
   * Which line of the algorithm's pseudocode this step is at, 1-based.
   *
   * The pseudocode lives in the catalogue, beside the algorithm's name, and the panel highlights this line. It is
   * absent for an algorithm that has not been instrumented, and the panel then says there is no code to follow
   * rather than highlighting line 1 and being wrong on every step.
   */
  line?: number
  /** Extra structured detail the specific algorithm wants to carry. Opaque to everything generic. */
  extra?: Readonly<Record<string, number | string | boolean | readonly (number | string)[]>>
}

// ---------------------------------------------------------------- what is counted

/**
 * The operations a run performed.
 *
 * Measured by the recorder as the steps arrive, so a count can never disagree with the trace. `comparisons` and
 * `swaps` are what a sorting complexity claim is checked against; `reads` and `writes` are what a memory-traffic
 * claim is checked against.
 */
export interface Counts {
  steps: number
  comparisons: number
  swaps: number
  reads: number
  writes: number
  calls: number
  /** The deepest recursion reached. For an iterative algorithm this is 0. */
  depth: number
  /** Extra counters an algorithm defines for itself, e.g. a heap's sift distance. */
  own: Readonly<Record<string, number>>
}

const EMPTY_COUNTS: Counts = Object.freeze({
  steps: 0,
  comparisons: 0,
  swaps: 0,
  reads: 0,
  writes: 0,
  calls: 0,
  depth: 0,
  own: Object.freeze({})
})

// ---------------------------------------------------------------- a whole run

export interface Frame {
  id: number
  /** The frame that called this one. Null for the first. */
  parent: number | null
  depth: number
  /** What this call was given, in words: "merge sort [5,1,4]" or "fib(6)". */
  label: string
  /** The step at which it was entered, and the step at which it returned. */
  from: number
  to: number | null
  /** What it handed back, when it handed something back. */
  result?: string
}

export interface Run {
  algorithm: string
  /** What it was given, kept so a run can be repeated exactly. */
  input: Readonly<Record<string, unknown>>
  /** Every step, in order. */
  steps: readonly Step[]
  counts: Counts
  /** The recursion structure, when the algorithm recursed. Empty otherwise. */
  frames: readonly Frame[]
  /** The answer. Shape depends on the algorithm. */
  result: unknown
  /** True when the step ceiling stopped it. Its result is then incomplete and must be shown as such. */
  cut: boolean
  /** Why it was cut, or why it failed. Null when it finished. */
  stopped: string | null
  /** The seed, when the algorithm used randomness. Null when it is deterministic. */
  seed: number | null
}

export const STEP_CEILING = 200_000

/**
 * A run that could not happen, with a reason somebody can act on.
 *
 * An algorithm given a graph with no such start node, or a negative-weight cycle it cannot handle, returns one of
 * these rather than a run with a wrong answer in it.
 */
export interface AlgorithmError {
  error: string
  message: string
  /** What to do about it. Never "try again". */
  fix: string
}

export const isAlgorithmError = (value: unknown): value is AlgorithmError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value && 'fix' in value

export const fail = (error: string, message: string, fix: string): AlgorithmError => ({ error, message, fix })

// ---------------------------------------------------------------- the recorder

/**
 * What an algorithm writes its steps into.
 *
 * Every algorithm in this directory takes one of these and nothing else. That is what makes them all traceable in
 * the same way, and what lets one of them be swapped for another in a comparison without the comparison knowing
 * anything about either.
 *
 * The recorder counts as it goes and enforces the ceiling. An algorithm does not have to check whether it has run
 * too long: `cut` tells it, and every loop in here tests it.
 */
export class Recorder {
  private readonly out: Step[] = []
  private readonly framesOut: Frame[] = []
  private readonly ceiling: number
  private readonly counters: Record<string, number> = {}

  private comparisons = 0
  private swaps = 0
  private reads = 0
  private writes = 0
  private callCount = 0
  private deepest = 0

  private currentDepth = 0
  private currentFrame: number | null = null
  private nextFrame = 0

  /*
   * Where the algorithm is, and what its variables hold.
   *
   * Set by `where()` at each place in the code and inherited by every step recorded until the next call. This is
   * what lets the shared comparison and swap helpers stay untouched: they record steps without knowing anything
   * about lines, and the step still comes out carrying the line the caller was on. Threading a line parameter
   * through those helpers instead would mean every algorithm passing it twice and the two copies disagreeing.
   */
  private currentLine: number | null = null
  private currentVars: Record<string, number | string | boolean> = {}

  /** Set once the ceiling is reached. Every loop in every algorithm checks it. */
  private stoppedAt: string | null = null

  constructor(ceiling = STEP_CEILING) {
    this.ceiling = Math.max(1, Math.min(STEP_CEILING, Math.floor(ceiling)))
  }

  /** True when the run has been cut short and should stop. */
  get cut(): boolean {
    return this.stoppedAt !== null
  }

  get stopped(): string | null {
    return this.stoppedAt
  }

  get length(): number {
    return this.out.length
  }

  /**
   * One step recorded.
   *
   * Returns false once the ceiling is reached, so a loop can be written as `while (!rec.cut)` or can test the return
   * value — either way an algorithm cannot run away.
   */
  step(kind: StepKind, says: string, at: readonly (number | string)[] = [], more: Partial<Step> = {}): boolean {
    if (this.stoppedAt !== null) return false
    if (this.out.length >= this.ceiling) {
      this.stoppedAt = `It was stopped after ${this.ceiling.toLocaleString('en-GB')} steps. The answer below is incomplete.`
      return false
    }

    switch (kind) {
      case 'compare':
        this.comparisons += 1
        break
      case 'swap':
        this.swaps += 1
        // A swap is two reads and two writes, and saying so keeps the memory-traffic count honest.
        this.reads += 2
        this.writes += 2
        break
      case 'read':
        this.reads += 1
        break
      case 'write':
        this.writes += 1
        break
      case 'call':
        this.callCount += 1
        break
      default:
        break
    }

    this.out.push({
      n: this.out.length,
      kind,
      at,
      says,
      depth: this.currentDepth,
      ...(this.currentFrame !== null ? { frame: this.currentFrame } : {}),
      ...(this.currentLine !== null ? { line: this.currentLine } : {}),
      ...(Object.keys(this.currentVars).length > 0 ? { vars: { ...this.currentVars } } : {}),
      ...more
    })
    return true
  }

  /**
   * Where in the pseudocode the algorithm is now, and what its variables hold.
   *
   * Every step recorded after this carries both, until the next call. `vars` is merged rather than replaced, so a
   * loop can say `rec.where(4, { at })` without restating the variables that have not changed — and a variable
   * that genuinely goes out of scope is cleared by passing `undefined` for it.
   */
  where(line: number | null, vars: Readonly<Record<string, number | string | boolean | undefined>> = {}): void {
    this.currentLine = line === null ? null : Math.max(1, Math.floor(line))
    for (const [name, value] of Object.entries(vars)) {
      if (value === undefined) delete this.currentVars[name]
      else this.currentVars[name] = value
    }
  }

  /** Just the variables, leaving the line where it is. */
  set(vars: Readonly<Record<string, number | string | boolean | undefined>>): void {
    this.where(this.currentLine, vars)
  }

  /** A counter of the algorithm's own, e.g. `heapify` distance or `partitions`. */
  count(name: string, by = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + by
  }

  /**
   * Entering a call. Returns its frame id, which `leave` takes back.
   *
   * Recorded even when the ceiling has been reached, so a recursion tree is not left with an unmatched frame.
   */
  enter(label: string): number {
    const id = this.nextFrame++
    this.framesOut.push({ id, parent: this.currentFrame, depth: this.currentDepth, label, from: this.out.length, to: null })
    this.currentFrame = id
    this.currentDepth += 1
    if (this.currentDepth > this.deepest) this.deepest = this.currentDepth
    this.step('call', label, [])
    return id
  }

  leave(id: number, result?: string): void {
    const frame = this.framesOut.find((one) => one.id === id)
    this.step('return', result === undefined ? `done: ${frame?.label ?? ''}`.trim() : `${frame?.label ?? ''} → ${result}`, [])
    if (frame) {
      frame.to = this.out.length
      if (result !== undefined) frame.result = result
      this.currentFrame = frame.parent
    }
    this.currentDepth = Math.max(0, this.currentDepth - 1)
  }

  /** The run, assembled. Called once, by whatever ran the algorithm. */
  finish(algorithm: string, input: Readonly<Record<string, unknown>>, result: unknown, seed: number | null = null): Run {
    return {
      algorithm,
      input,
      steps: this.out,
      counts: {
        steps: this.out.length,
        comparisons: this.comparisons,
        swaps: this.swaps,
        reads: this.reads,
        writes: this.writes,
        calls: this.callCount,
        depth: this.deepest,
        own: Object.freeze({ ...this.counters })
      },
      frames: this.framesOut,
      result,
      cut: this.stoppedAt !== null,
      stopped: this.stoppedAt,
      seed
    }
  }
}

export const emptyRun = (algorithm: string): Run => ({
  algorithm,
  input: {},
  steps: [],
  counts: EMPTY_COUNTS,
  frames: [],
  result: null,
  cut: false,
  stopped: null,
  seed: null
})

// ---------------------------------------------------------------- replaying

/**
 * The array as it stood at a given step.
 *
 * Worked out by replaying the swaps and writes from the start rather than by storing a copy per step: a thousand
 * steps over a thousand elements is a million numbers kept for nothing. Replaying is fast and cannot drift, because
 * the only source is the trace itself.
 */
export function arrayAt(initial: readonly number[], steps: readonly Step[], upTo: number): number[] {
  const out = [...initial]
  const last = Math.min(upTo, steps.length - 1)
  for (let at = 0; at <= last; at += 1) {
    const step = steps[at]
    if (step.kind === 'swap' && step.at.length === 2) {
      const [i, j] = step.at as [number, number]
      if (Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0 && i < out.length && j < out.length) {
        const held = out[i]
        out[i] = out[j]
        out[j] = held
      }
    } else if (step.kind === 'write' && step.at.length === 1 && step.values && step.values.length > 0) {
      const i = step.at[0]
      const value = step.values[0]
      if (typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < out.length && typeof value === 'number') out[i] = value
    }
  }
  return out
}

/** Which positions are settled — in their final place — by a given step. */
export function settledAt(steps: readonly Step[], upTo: number): ReadonlySet<number> {
  const out = new Set<number>()
  const last = Math.min(upTo, steps.length - 1)
  for (let at = 0; at <= last; at += 1) {
    if (steps[at].kind !== 'settle') continue
    for (const one of steps[at].at) if (typeof one === 'number') out.add(one)
  }
  return out
}

/** Which nodes have been visited by a given step. Graph algorithms. */
export function visitedAt(steps: readonly Step[], upTo: number): readonly string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const last = Math.min(upTo, steps.length - 1)
  for (let at = 0; at <= last; at += 1) {
    if (steps[at].kind !== 'visit') continue
    for (const one of steps[at].at) {
      const id = String(one)
      if (!seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  return out
}

/** The region of interest at a given step, when the algorithm declared one. */
export function regionAt(steps: readonly Step[], upTo: number): Step['region'] | null {
  for (let at = Math.min(upTo, steps.length - 1); at >= 0; at -= 1) {
    if (steps[at].region) return steps[at].region
  }
  return null
}

/** The frames open at a given step, outermost first — the call stack as it then stood. */
/**
 * The variables as they stood at a given step.
 *
 * Carried forward: a step records only what it set, so reading one step's `vars` alone would show a panel that
 * empties and refills as the algorithm moves. This walks from the start and keeps the last value of each name,
 * which is what somebody following the code expects a variable panel to do.
 */
export function varsAt(steps: readonly Step[], at: number): Readonly<Record<string, number | string | boolean>> {
  const out: Record<string, number | string | boolean> = {}
  for (let one = 0; one <= Math.min(at, steps.length - 1); one += 1) {
    const held = steps[one].vars
    if (held === undefined) continue
    for (const [name, value] of Object.entries(held)) out[name] = value
  }
  return out
}

/** The line the run is on at a given step, or null when the algorithm carries no line numbers. */
export function lineAt(steps: readonly Step[], at: number): number | null {
  for (let one = Math.min(at, steps.length - 1); one >= 0; one -= 1) {
    const held = steps[one].line
    if (typeof held === 'number') return held
  }
  return null
}

export function stackAt(run: Run, upTo: number): readonly Frame[] {
  const open = run.frames.filter((one) => one.from <= upTo && (one.to === null || one.to > upTo))
  return [...open].sort((a, b) => a.depth - b.depth)
}

/**
 * A short summary of a run, for Orion and for a result card.
 *
 * Compact on purpose: handing a model forty thousand steps spends its attention on the trace instead of on the
 * question. `describeStep` is what answers "why did this step happen", one step at a time.
 */
export function summarise(run: Run): string {
  const parts = [`${run.algorithm}`, `${run.counts.steps.toLocaleString('en-GB')} steps`]
  if (run.counts.comparisons > 0) parts.push(`${run.counts.comparisons.toLocaleString('en-GB')} comparisons`)
  if (run.counts.swaps > 0) parts.push(`${run.counts.swaps.toLocaleString('en-GB')} swaps`)
  if (run.counts.depth > 0) parts.push(`depth ${run.counts.depth}`)
  if (run.cut) parts.push('stopped early — the answer is incomplete')
  return parts.join(' · ')
}

/** One step, in words, with what was around it. What Orion is given for "explain this step". */
export function describeStep(run: Run, n: number): string | null {
  const step = run.steps[n]
  if (!step) return null
  const where = step.at.length > 0 ? ` at ${step.at.join(', ')}` : ''
  const values = step.values && step.values.length > 0 ? ` (${step.values.join(' and ')})` : ''
  const depth = step.depth && step.depth > 0 ? ` [depth ${step.depth}]` : ''
  return `Step ${n} of ${run.steps.length - 1}: ${step.kind}${where}${values}${depth} — ${step.says}`
}

/** Every step of one kind, for "show me only the comparisons". */
export const stepsOfKind = (run: Run, kind: StepKind): readonly Step[] => run.steps.filter((one) => one.kind === kind)

// ---------------------------------------------------------------- seeded randomness

/**
 * A small, fast, seeded generator (mulberry32).
 *
 * Deliberately not `Math.random`: a randomised quicksort has to be reproducible from its seed, or a comparison
 * between two runs is measuring luck. The algorithm is well known and short enough to read, which matters more here
 * than statistical perfection — nothing in this directory is cryptography.
 */
export function randomFrom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** An integer in [from, to], from a seeded generator. */
export const intFrom = (random: () => number, from: number, to: number): number => from + Math.floor(random() * (to - from + 1))
