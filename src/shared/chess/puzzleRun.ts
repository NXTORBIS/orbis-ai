import { legalMoves } from './rules.ts'
import { playablePosition, type Exercise } from './exercise.ts'
import { RATING_BANDS, dailyEligible, type Puzzle } from './puzzles.ts'

/**
 * A timed run of puzzles: three minutes, five minutes, or until the lives are gone (Sections 071, 073, 075, 076).
 *
 * This is the thing chess.com calls Puzzle Rush, and it is the most replayed screen on that site for a reason: the
 * puzzles get harder as you go, there are three lives, and there is either a clock or nothing but the lives. There
 * is no race against another person here -- that half of it is multiplayer and Orbis does not do multiplayer -- so
 * what is left is the solo run, which is the part worth having anyway.
 *
 * Pure: no timers, no storage, no DOM. `now` is an argument everywhere, the way `clock.ts` does it, and the run
 * holds the moment it started rather than a count of ticks. That is not tidiness. A window that stops being drawn
 * for four seconds -- a different screen in front, a laptop lid shut, a long garbage collection -- comes back and
 * asks `remainingMs(run, Date.now())`, which is right, where a counter decremented once a frame would be four
 * seconds out and would have let somebody finish a puzzle after the clock had gone.
 *
 * ## The climb is the honest part, and it is mostly a refusal
 *
 * "Puzzles get harder as you go" needs puzzles whose difficulty is known, and `puzzleRating.ts` is explicit about
 * what Orbis knows: a puzzle with no rating cannot move anybody's rating, and **no puzzle Orbis makes has a
 * rating at all**. Puzzles here come from a person's own saved games, and `puzzleGen.ts` deliberately does not
 * guess a number from the engine's evaluation. Nothing else in Orbis imports rated puzzles. So in a real profile
 * today the count of rated puzzles is zero.
 *
 * A run could serve those in a random order, call itself a rush, and nobody would notice. It does not. There are
 * three kinds of climb and the run says which one it got:
 *
 *   - `rated`   -- there are enough rated puzzles, spread over enough rating bands, to order a run by rating. Only
 *                  the rated ones are used, because ordering a mix of rated and unrated puzzles by rating is
 *                  ordering half a list.
 *   - `counted` -- there is no rating to order by, so the order comes from things counted off the board: how many
 *                  legal moves there are to look through, how many of them work, how long a forced mate runs, and
 *                  whether the move is a quiet one. The arithmetic is real and `COUNTED_WEIGHTS` is written down;
 *                  the boundaries between "harder" and "easier" are a convention Orbis chose, which is said on
 *                  screen rather than implied. It is **not** a rating and is never shown as one.
 *   - `none`    -- there are not enough puzzles for a run at all. No run starts.
 *
 * ## No repeats, and the run ends when the puzzles do
 *
 * The queue is as long as the pool and a puzzle appears once. A score made of puzzles you have just seen the
 * answer to is not a score, and with a pool the size of one person's own games repeats would start almost at once.
 * So a run that gets through everything ends with `ended: 'pool'` and the screen says you got to the end of what
 * you have, which is a different and better thing to be told than being handed the same mate again.
 */

// ---------------------------------------------------------------- the modes

export type RunModeId = 'three-minute' | 'five-minute' | 'survival'

export interface RunMode {
  id: RunModeId
  /** What the button says. */
  label: string
  /** What happens, in one sentence. */
  what: string
  /** The clock, in seconds. Null when there is no clock and only the lives. */
  seconds: number | null
  lives: number
}

/** The lives every mode gets. Three, which is what chess.com gives and what feels right. */
export const RUN_LIVES = 3

export const RUN_MODES: readonly RunMode[] = Object.freeze([
  Object.freeze({
    id: 'three-minute' as const,
    label: 'Three minutes',
    what: 'Three minutes on the clock and three lives. Whichever runs out first ends the run.',
    seconds: 180,
    lives: RUN_LIVES
  }),
  Object.freeze({
    id: 'five-minute' as const,
    label: 'Five minutes',
    what: 'Five minutes on the clock and three lives. More room to think, and further to climb.',
    seconds: 300,
    lives: RUN_LIVES
  }),
  Object.freeze({
    id: 'survival' as const,
    label: 'Survival',
    what: 'No clock. Three lives, and the run goes on until they are gone.',
    seconds: null,
    lives: RUN_LIVES
  })
])

export function runModeById(id: string): RunMode | null {
  return RUN_MODES.find((one) => one.id === id) ?? null
}

export const MODE_LABEL: Readonly<Record<RunModeId, string>> = Object.freeze({
  'three-minute': 'Three minutes',
  'five-minute': 'Five minutes',
  survival: 'Survival'
})

// ---------------------------------------------------------------- how hard a puzzle is, when nothing has rated it

/**
 * What the counted measure adds up, and what each part is worth.
 *
 * Every line is something counted from the position, which is what makes the arithmetic real. What is a
 * *convention* is the weights: that a move further into a forced mate is worth about twelve legal moves of
 * searching is Orbis's choice, not a measurement. It is data so a screen can show it and so a test can hold it.
 */
export const COUNTED_WEIGHTS = Object.freeze({
  /** One point for each legal move there is to look through. */
  perLegalMove: 1,
  /** Each move of a forced mate beyond the first, because every one of them has replies to answer. */
  perMoveBeyondTheFirst: 12,
  /** A move that gives no check and takes nothing is harder to see than one that does either. */
  quietMove: 10,
  /** Taken off for each working move beyond the first: more right answers is more chance of hitting one. */
  perExtraAnswer: 6
})

export interface Counted {
  puzzleId: string
  /** Legal moves in the position. Null when the position will not load, in which case nothing was counted. */
  legalMoves: number | null
  /** Moves recorded as working. */
  answers: number
  /** Moves of a forced mate, when that is the objective. Null otherwise. */
  mateIn: number | null
  /** True when every working first move gives no check and takes nothing. Null when it could not be told. */
  quiet: boolean | null
  /** The total. Higher is counted as harder. Not a rating and never shown as one. */
  weight: number
  facts: readonly string[]
}

/**
 * How much there is to look through in one puzzle, counted off the board.
 *
 * Deliberately the same facts `describeDifficulty` in `puzzleRating.ts` reports, because that function is already
 * the answer to "how hard is this one?" for a puzzle with no rating. This turns those facts into one number so a
 * list can be put in an order, and it says in `facts` what went into it.
 */
export function countedWeight(puzzle: Puzzle): Counted {
  const exercise: Exercise = puzzle.exercise
  const facts: string[] = []
  if (!playablePosition(exercise.startFen).ok) {
    return {
      puzzleId: puzzle.id,
      legalMoves: null,
      answers: 0,
      mateIn: null,
      quiet: null,
      weight: 0,
      facts: Object.freeze(['The position will not load, so nothing could be counted from it.'])
    }
  }
  const moves = legalMoves(exercise.startFen)
  const answers = exercise.solution.lines.length
  const mateIn = exercise.objective === 'mate-in-n' && exercise.movesToMate !== undefined ? exercise.movesToMate : null

  let weight = moves.length * COUNTED_WEIGHTS.perLegalMove
  facts.push(`${moves.length} legal ${moves.length === 1 ? 'move' : 'moves'} to look through.`)

  if (mateIn !== null && mateIn > 1) {
    weight += (mateIn - 1) * COUNTED_WEIGHTS.perMoveBeyondTheFirst
    facts.push(`A forced mate in ${mateIn}, so there are replies to answer along the way.`)
  }

  // Whether the move is a loud one. Worked out from the recorded answers against the real move list, so a line
  // that names a move the rules do not have simply does not count towards it.
  const first = exercise.solution.lines
    .map((line) => moves.find((one) => one.san === line.move || one.uci === line.move) ?? null)
    .filter((one): one is NonNullable<typeof one> => one !== null)
  const quiet = first.length === 0 ? null : first.every((one) => !one.check && !one.captured)
  if (quiet === true) {
    weight += COUNTED_WEIGHTS.quietMove
    facts.push(answers === 1 ? 'The move gives no check and takes nothing.' : 'None of the moves that work gives a check or takes anything.')
  }

  if (answers > 1) {
    weight -= (answers - 1) * COUNTED_WEIGHTS.perExtraAnswer
    facts.push(`${answers} different moves work, so there is more than one way to find it.`)
  } else if (answers === 1) {
    facts.push('One move works.')
  }

  return {
    puzzleId: puzzle.id,
    legalMoves: moves.length,
    answers,
    mateIn,
    quiet,
    weight: Math.max(0, Math.round(weight)),
    facts: Object.freeze(facts)
  }
}

// ---------------------------------------------------------------- the ladder

export type ClimbKind = 'rated' | 'counted' | 'none'

/** Rated puzzles needed before a run may be ordered by rating. */
export const RATED_FOR_A_CLIMB = 20

/** Rating bands those puzzles have to be spread over, so the "climb" is not twenty puzzles of the same difficulty. */
export const BANDS_FOR_A_CLIMB = 3

/** Below this there is no run. Three lives and two puzzles is not a run, it is a question. */
export const FEWEST_PUZZLES = 5

export interface Ladder {
  kind: ClimbKind
  /** The puzzles a run will serve, easiest first. Empty when `kind` is 'none'. */
  order: readonly string[]
  /** Usable puzzles in the collection: answered with moves, with a solution, and not rejected. */
  usable: number
  /** How many of those carry a rating. */
  rated: number
  /** How many rating bands those rated ones fall into. */
  bands: number
  /** Usable puzzles that have not been fully checked yet. Part of the run, and said rather than hidden. */
  unchecked: number
  /** One sentence for the screen: what the order is, and what it is not. */
  says: string
  /** Why it is that kind of climb. */
  why: string
  /** What is missing for a run ordered by rating. Empty when `kind` is 'rated'. */
  shortOf: readonly string[]
}

function bandsOf(rated: readonly Puzzle[]): number {
  const hit = new Set<string>()
  for (const one of rated) {
    if (one.rating === null) continue
    const band = RATING_BANDS.find((row) => one.rating !== null && one.rating >= row.from && one.rating <= row.to)
    hit.add(band ? band.label : 'outside every band')
  }
  return hit.size
}

/**
 * The order a run will climb, and which of the three kinds of climb it is.
 *
 * The one thing this must never do is hand back a list in no particular order and let the caller describe it as a
 * climb. `kind` is the answer to that, `says` is the sentence the screen shows, and `shortOf` is what would have to
 * be true for the rating order to be available.
 */
export function ladderFor(puzzles: readonly Puzzle[]): Ladder {
  const pools = dailyEligible(puzzles)
  const usable = [...pools.verified, ...pools.checkedOnly]
  const rated = usable.filter((one) => one.rating !== null)
  const bands = bandsOf(rated)
  const unchecked = pools.checkedOnly.length

  const shortOf: string[] = []
  if (rated.length < RATED_FOR_A_CLIMB) {
    shortOf.push(`A run ordered by rating needs ${RATED_FOR_A_CLIMB} rated puzzles, and ${rated.length === 0 ? 'none of yours has a rating' : `${rated.length} of yours ${rated.length === 1 ? 'has' : 'have'} one`}.`)
  } else if (bands < BANDS_FOR_A_CLIMB) {
    shortOf.push(`Your ${rated.length} rated puzzles fall into ${bands} rating ${bands === 1 ? 'band' : 'bands'}, and a climb needs ${BANDS_FOR_A_CLIMB}. Twenty puzzles all of the same difficulty is a list, not a climb.`)
  }
  if (rated.length === 0) {
    shortOf.push('Nothing in Orbis gives a puzzle a rating. Puzzles made from your own games arrive with none on purpose, because guessing one from the engine’s evaluation would be inventing a number.')
  }

  if (usable.length < FEWEST_PUZZLES) {
    return {
      kind: 'none',
      order: Object.freeze([]),
      usable: usable.length,
      rated: rated.length,
      bands,
      unchecked,
      says: usable.length === 0
        ? 'There are no puzzles to run through yet.'
        : `${usable.length} ${usable.length === 1 ? 'puzzle' : 'puzzles'} is not enough for a run.`,
      why: `A run needs at least ${FEWEST_PUZZLES} puzzles, because a puzzle is never served twice in one run and three lives would be gone before you had started.`,
      shortOf: Object.freeze(shortOf)
    }
  }

  if (rated.length >= RATED_FOR_A_CLIMB && bands >= BANDS_FOR_A_CLIMB) {
    const order = [...rated]
      .sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0) || a.id.localeCompare(b.id))
      .map((one) => one.id)
    return {
      kind: 'rated',
      order: Object.freeze(order),
      usable: usable.length,
      rated: rated.length,
      bands,
      unchecked,
      says: `${order.length} rated puzzles, easiest first, so each one is harder than the last.`,
      why: `Only the rated ones are in this run. Ordering a mix of rated and unrated puzzles by rating would be ordering half a list, so the ${usable.length - rated.length} without a rating are left out.`,
      shortOf: Object.freeze([])
    }
  }

  const counted = new Map(usable.map((one) => [one.id, countedWeight(one)]))
  const order = [...usable]
    .sort((a, b) => (counted.get(a.id)?.weight ?? 0) - (counted.get(b.id)?.weight ?? 0) || a.id.localeCompare(b.id))
    .map((one) => one.id)
  return {
    kind: 'counted',
    order: Object.freeze(order),
    usable: usable.length,
    rated: rated.length,
    bands,
    unchecked,
    says: `${order.length} ${order.length === 1 ? 'puzzle' : 'puzzles'}, in order of how much there is to look through — counted off the board, not rated.`,
    why: 'The order comes from the number of legal moves, how many of them work, how long a forced mate runs, and whether the move is a quiet one. Those are all counted from the position. Where the line between harder and easier falls is Orbis’s own convention, and this is not a rating.',
    shortOf: Object.freeze(shortOf)
  }
}

// ---------------------------------------------------------------- the queue

/**
 * A small, repeatable random number generator.
 *
 * Mulberry32. It is here so a run's order can have some variety from one go to the next and still be exactly
 * reproducible in a test from its seed. It is not for anything that needs to be unguessable.
 */
function shuffler(seed: number): () => number {
  let state = (Math.trunc(seed) || 1) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** How many difficulty tiers a run's order is cut into before it is shuffled inside each one. */
export const RUN_TIERS = 6

/**
 * The order a run really serves: the ladder, cut into tiers, shuffled inside each tier.
 *
 * Straight up the ladder would mean the same puzzles in the same order every time, which for a pool the size of one
 * person's own games would be the same run over and over. Shuffling the whole thing would throw the climb away.
 * Tiers keep the climb -- every puzzle in tier two is harder than every puzzle in tier one -- and give the order
 * inside a tier something to vary.
 */
export function queueFor(ladder: Ladder, seed: number, tiers = RUN_TIERS): readonly string[] {
  if (ladder.order.length === 0) return Object.freeze([])
  const random = shuffler(seed)
  const count = Math.max(1, Math.min(tiers, ladder.order.length))
  const size = Math.ceil(ladder.order.length / count)
  const out: string[] = []
  for (let from = 0; from < ladder.order.length; from += size) {
    const slice = [...ladder.order.slice(from, from + size)]
    // Fisher-Yates, inside this tier only.
    for (let i = slice.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const held = slice[i]
      slice[i] = slice[j]
      slice[j] = held
    }
    out.push(...slice)
  }
  return Object.freeze(out)
}

// ---------------------------------------------------------------- a run

export type RunEnd =
  /** The clock ran out. */
  | 'time'
  /** The lives were gone. */
  | 'lives'
  /** Every puzzle in the collection had been served. */
  | 'pool'
  /** Stopped on purpose. */
  | 'stopped'

export const END_WORDS: Readonly<Record<RunEnd, string>> = Object.freeze({
  time: 'The clock ran out.',
  lives: 'All three lives were gone.',
  pool: 'You got to the end of every puzzle you have.',
  stopped: 'You stopped it.'
})

export type ResultWhy =
  /** Solved, with no hint and no wrong move -- which is the only kind of solve a run counts. */
  | 'solved'
  /** A move that was not the idea. */
  | 'wrong'
  /** The answer was asked for. */
  | 'shown'

export interface RunResult {
  puzzleId: string
  solved: boolean
  why: ResultWhy
  /** When it was recorded. */
  at: number
  /** How long this one took, in seconds, from when it went on screen. */
  seconds: number
}

export interface Run {
  id: string
  mode: RunModeId
  climb: ClimbKind
  startedAt: number
  /** The puzzles to serve, in the order they will be served. A puzzle appears once. */
  order: readonly string[]
  /** Which of `order` is on screen. Equal to `order.length` when they have all been served. */
  at: number
  /** When the one on screen went up, so its own time can be recorded. */
  shownAt: number
  solved: number
  missed: number
  livesLeft: number
  streak: number
  bestStreak: number
  results: readonly RunResult[]
  /** Null while it is running. */
  ended: RunEnd | null
  endedAt: number | null
}

export function isRunning(run: Run): boolean {
  return run.ended === null
}

/** The clock for a mode, in milliseconds. Null for survival, which has none. */
export function limitMs(mode: RunModeId): number | null {
  const found = runModeById(mode)
  return found && found.seconds !== null ? found.seconds * 1000 : null
}

/** The moment the clock would run out. Null for survival and for a run that has already ended. */
export function timeUpAt(run: Run): number | null {
  const limit = limitMs(run.mode)
  return limit === null ? null : run.startedAt + limit
}

/**
 * Milliseconds left, never below zero. Null for survival, where the answer is not a number of milliseconds.
 *
 * Worked out from the moment the run started, so four seconds in which nothing was drawn costs four seconds and
 * not nothing. For a finished run the answer is what was left when it finished, which is what a result screen
 * wants to show.
 */
export function remainingMs(run: Run, now: number): number | null {
  const up = timeUpAt(run)
  if (up === null) return null
  const at = run.endedAt ?? now
  return Math.max(0, up - at)
}

export interface RunStarted {
  /** Null when no run could be started. */
  run: Run | null
  ladder: Ladder
  ok: boolean
  says: string
}

/**
 * A run, if there is one to be had.
 *
 * `seed` is an argument so a test gets the same order twice. A screen passes the moment it started, which is as
 * good a seed as any and means two runs a second apart are not the same run.
 */
export function startRun(o: {
  mode: RunModeId
  puzzles: readonly Puzzle[]
  now: number
  seed?: number
  id?: string
}): RunStarted {
  const mode = runModeById(o.mode)
  if (!mode) {
    const ladder = ladderFor([])
    return { run: null, ladder, ok: false, says: `There is no run called "${o.mode}".` }
  }
  const ladder = ladderFor(o.puzzles)
  if (ladder.kind === 'none') {
    return { run: null, ladder, ok: false, says: `${ladder.says} ${ladder.why}` }
  }
  const order = queueFor(ladder, o.seed ?? o.now)
  return {
    run: {
      id: o.id ?? `run-${o.now}`,
      mode: mode.id,
      climb: ladder.kind,
      startedAt: o.now,
      order,
      at: 0,
      shownAt: o.now,
      solved: 0,
      missed: 0,
      livesLeft: mode.lives,
      streak: 0,
      bestStreak: 0,
      results: Object.freeze([]),
      ended: null,
      endedAt: null
    },
    ladder,
    ok: true,
    says: `${mode.label}. ${ladder.says}`
  }
}

/** The puzzle on screen, or null when there is none -- which is every run that has ended or run out of puzzles. */
export function currentPuzzleId(run: Run): string | null {
  if (!isRunning(run)) return null
  return run.at < run.order.length ? run.order[run.at] : null
}

/**
 * The run brought up to date with the clock, and ended if the clock has gone.
 *
 * Idempotent, and safe to call on every draw. It is the one thing that must be called before anything is credited:
 * a solve that arrives after the clock ran out did not happen inside the run, and the run ends at the moment the
 * clock ran out rather than at the moment somebody got round to telling it.
 */
export function settleRun(run: Run, now: number): Run {
  if (!isRunning(run)) return run
  const up = timeUpAt(run)
  if (up !== null && now >= up) return { ...run, ended: 'time', endedAt: up }
  return run
}

export interface RunStep {
  run: Run
  /** False when nothing was credited, with `says` giving the reason. */
  counted: boolean
  says: string
}

/** The run after a puzzle has been served, with the two ways a run can finish by itself applied. */
function afterResult(run: Run, result: RunResult, now: number): Run {
  const livesLeft = result.solved ? run.livesLeft : Math.max(0, run.livesLeft - 1)
  const streak = result.solved ? run.streak + 1 : 0
  const next: Run = {
    ...run,
    at: run.at + 1,
    shownAt: now,
    solved: run.solved + (result.solved ? 1 : 0),
    missed: run.missed + (result.solved ? 0 : 1),
    livesLeft,
    streak,
    bestStreak: Math.max(run.bestStreak, streak),
    results: Object.freeze([...run.results, result])
  }
  if (livesLeft === 0) return { ...next, ended: 'lives', endedAt: now }
  if (next.at >= next.order.length) return { ...next, ended: 'pool', endedAt: now }
  return next
}

/**
 * The puzzle on screen was solved.
 *
 * Only a clean solve should reach here. A run offers no hints and a wrong move ends the puzzle, so there is no
 * ladder of partial credit to apply -- which is also why a run's score is a count of puzzles and not a total of
 * worths. The caller decides what counts as solved from `attempt.ts`; this records it.
 */
export function recordSolved(run: Run, now: number): RunStep {
  const settled = settleRun(run, now)
  if (!isRunning(settled)) {
    return {
      run: settled,
      counted: false,
      says: settled.ended === 'time'
        ? 'The clock had already run out when that came in, so it has not been counted.'
        : `The run was already over (${END_WORDS[settled.ended as RunEnd].toLowerCase()}), so that has not been counted.`
    }
  }
  const puzzleId = currentPuzzleId(settled)
  if (puzzleId === null) {
    return { run: settled, counted: false, says: 'There is no puzzle on screen, so there was nothing to count.' }
  }
  const result: RunResult = {
    puzzleId,
    solved: true,
    why: 'solved',
    at: now,
    seconds: Math.max(0, Math.round((now - settled.shownAt) / 1000))
  }
  const next = afterResult(settled, result, now)
  return {
    run: next,
    counted: true,
    says: next.ended === null
      ? `Solved. ${next.solved} so far${next.streak > 1 ? `, ${next.streak} in a row` : ''}.`
      : `Solved. ${END_WORDS[next.ended]} ${next.solved} ${next.solved === 1 ? 'puzzle' : 'puzzles'} in all.`
  }
}

/** The puzzle on screen went wrong, or the answer was asked for. A life goes either way. */
export function recordMissed(run: Run, why: Exclude<ResultWhy, 'solved'>, now: number): RunStep {
  const settled = settleRun(run, now)
  if (!isRunning(settled)) {
    return {
      run: settled,
      counted: false,
      says: settled.ended === 'time'
        ? 'The clock had already run out when that came in, so it has not been counted against you.'
        : `The run was already over (${END_WORDS[settled.ended as RunEnd].toLowerCase()}), so that has not been counted against you.`
    }
  }
  const puzzleId = currentPuzzleId(settled)
  if (puzzleId === null) {
    return { run: settled, counted: false, says: 'There is no puzzle on screen, so there was nothing to count.' }
  }
  const result: RunResult = {
    puzzleId,
    solved: false,
    why,
    at: now,
    seconds: Math.max(0, Math.round((now - settled.shownAt) / 1000))
  }
  const next = afterResult(settled, result, now)
  const lost = why === 'shown' ? 'You asked to see it.' : 'Not the idea.'
  return {
    run: next,
    counted: true,
    says: next.ended === null
      ? `${lost} ${next.livesLeft} ${next.livesLeft === 1 ? 'life' : 'lives'} left.`
      : `${lost} ${END_WORDS[next.ended]} ${next.solved} ${next.solved === 1 ? 'puzzle' : 'puzzles'} in all.`
  }
}

/**
 * The puzzle on screen passed over, with nothing counted either way.
 *
 * For one case and no other: a puzzle that cannot be finished. A puzzle with no reply recorded for the opponent
 * leaves the solver waiting for a move that does not exist, which is a gap in the puzzle and not a mistake by the
 * person solving it, so it costs no life and goes in no result. It still uses up its place in the queue, because
 * serving it again would just stop again in the same position.
 *
 * There is deliberately no skip button anywhere near this. A run you can skip through is not a run.
 */
export function skipPuzzle(run: Run, now: number): RunStep {
  const settled = settleRun(run, now)
  if (!isRunning(settled)) return { run: settled, counted: false, says: 'The run was already over.' }
  if (currentPuzzleId(settled) === null) {
    return { run: settled, counted: false, says: 'There is no puzzle on screen to pass over.' }
  }
  const next: Run = { ...settled, at: settled.at + 1, shownAt: now }
  if (next.at >= next.order.length) {
    return { run: { ...next, ended: 'pool', endedAt: now }, counted: false, says: `${END_WORDS.pool} ${next.solved} ${next.solved === 1 ? 'puzzle' : 'puzzles'} in all.` }
  }
  return { run: next, counted: false, says: 'That one has been passed over, and it has not cost you a life.' }
}

/** Stopped on purpose. The run keeps what was scored up to here; it is a real run and is recorded as one. */
export function stopRun(run: Run, now: number): Run {
  const settled = settleRun(run, now)
  if (!isRunning(settled)) return settled
  return { ...settled, ended: 'stopped', endedAt: now }
}

/** What a run looks like while it is going, for the strip above the board. */
export function runWords(run: Run, now: number): string {
  if (!isRunning(run)) {
    return `${END_WORDS[run.ended as RunEnd]} ${run.solved} ${run.solved === 1 ? 'puzzle' : 'puzzles'}${run.bestStreak > 1 ? `, best run of ${run.bestStreak} in a row` : ''}.`
  }
  const left = remainingMs(run, now)
  const clock = left === null ? 'No clock' : `${Math.ceil(left / 1000)}s left`
  const puzzlesLeft = run.order.length - run.at
  return `${clock}. ${run.solved} solved, ${run.livesLeft} ${run.livesLeft === 1 ? 'life' : 'lives'} left, ${puzzlesLeft} ${puzzlesLeft === 1 ? 'puzzle' : 'puzzles'} still to come.`
}

// ---------------------------------------------------------------- what a run leaves behind

export interface RunRecord {
  id: string
  mode: RunModeId
  climb: ClimbKind
  startedAt: number
  endedAt: number
  /** How long it really lasted, in seconds. */
  seconds: number
  /** The score: puzzles solved. One point each, which is the only count that means anything here. */
  score: number
  missed: number
  bestStreak: number
  /** How many puzzles the run had to serve altogether. A score equal to this one is "all of them". */
  served: number
  ended: RunEnd
}

/** The record of a finished run, or null while it is still going. */
export function runRecordOf(run: Run): RunRecord | null {
  if (run.ended === null || run.endedAt === null) return null
  return {
    id: run.id,
    mode: run.mode,
    climb: run.climb,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    seconds: Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000)),
    score: run.solved,
    missed: run.missed,
    bestStreak: run.bestStreak,
    served: run.order.length,
    ended: run.ended
  }
}

/** What a finished run is worth saying, with "all of them" kept apart from a score that had room to grow. */
export function recordWordsFor(record: RunRecord): string {
  const all = record.score > 0 && record.score === record.served
  return `${record.score} ${record.score === 1 ? 'puzzle' : 'puzzles'} in ${record.seconds}s${all ? ', which was every puzzle you had' : ''}.`
    + `${record.bestStreak > 1 ? ` Best run of ${record.bestStreak} in a row.` : ''}`
    + ` ${END_WORDS[record.ended]}`
}

/**
 * How many runs are kept, oldest dropped first.
 *
 * It is a cap on a log, not on a best score: `bestRun` reads what is kept, so a high score that falls off the end
 * stops being the best one. Fifty runs is months of them, and the alternative -- keeping a separate "best ever"
 * number beside the log -- is a second answer to a question the log already answers, which is how a best score
 * ends up disagreeing with the runs behind it.
 */
export const RUNS_KEPT = 50

/** Runs kept oldest first, the way every other list of attempts in Chess World is kept. */
export function addRunRecord(runs: readonly RunRecord[], record: RunRecord): readonly RunRecord[] {
  return Object.freeze([...runs, record].slice(-RUNS_KEPT))
}

export function runsFor(runs: readonly RunRecord[], mode: RunModeId): RunRecord[] {
  return runs.filter((one) => one.mode === mode)
}

/** The best run in a mode, by score, and the earliest one when two scores are equal. */
export function bestRun(runs: readonly RunRecord[], mode: RunModeId): RunRecord | null {
  let best: RunRecord | null = null
  for (const one of runsFor(runs, mode)) {
    if (!best || one.score > best.score || (one.score === best.score && one.startedAt < best.startedAt)) best = one
  }
  return best
}

export interface ModeStanding {
  mode: RunModeId
  label: string
  best: RunRecord | null
  runs: number
  /** What to show under the mode's button. */
  says: string
}

/**
 * What to say about a mode: the best score, or that there is no best score yet.
 *
 * One run is a run and not a measurement, and that is said rather than left for somebody to assume. The best score
 * is a real high score -- the best of what really happened -- and is not dressed up as a level.
 */
export function modeStanding(runs: readonly RunRecord[], mode: RunModeId): ModeStanding {
  const mine = runsFor(runs, mode)
  const best = bestRun(runs, mode)
  return {
    mode,
    label: MODE_LABEL[mode],
    best,
    runs: mine.length,
    says: best === null
      ? 'No runs yet.'
      : mine.length === 1
        ? `${best.score} ${best.score === 1 ? 'puzzle' : 'puzzles'}, from one run. One run is one run; it is not a measure of you.`
        : `Best ${best.score} ${best.score === 1 ? 'puzzle' : 'puzzles'}, from ${mine.length} runs.`
  }
}

// ---------------------------------------------------------------- reading a stored run back

/**
 * One stored run, or null when it cannot be read.
 *
 * Written to be handed to the `records` reader in `src/main/chess/shapes.ts`, which is what decides how many are
 * kept and what to say about the ones that were left out. The judgement about what a *run* may be belongs here,
 * beside the type, the way `readStore` and `readStudy` keep theirs.
 *
 * A row missing when it happened or what it scored is left out rather than repaired: a run that scored nothing and
 * a run whose score could not be read are different things, and a best score built out of the second would be a lie
 * about somebody's own record. The stored row is spread first and only the fields this file depends on are put
 * back, so a shape that grows later costs nothing.
 */
export function readRunRow(row: Record<string, unknown>): RunRecord | null {
  const mode = typeof row.mode === 'string' ? runModeById(row.mode) : null
  if (!mode) return null
  const whole = (one: unknown): number | null => (typeof one === 'number' && Number.isFinite(one) ? Math.trunc(one) : null)
  const startedAt = whole(row.startedAt)
  const endedAt = whole(row.endedAt)
  const score = whole(row.score)
  if (startedAt === null || endedAt === null || score === null) return null
  const ended: RunEnd = row.ended === 'time' || row.ended === 'lives' || row.ended === 'pool' || row.ended === 'stopped' ? row.ended : 'stopped'
  const climb: ClimbKind = row.climb === 'rated' || row.climb === 'counted' ? row.climb : 'none'
  const fixed: RunRecord = {
    id: typeof row.id === 'string' && row.id ? row.id.slice(0, 160) : `run-${startedAt}`,
    mode: mode.id,
    climb,
    startedAt,
    endedAt,
    seconds: Math.max(0, whole(row.seconds) ?? Math.round((endedAt - startedAt) / 1000)),
    score: Math.max(0, score),
    missed: Math.max(0, whole(row.missed) ?? 0),
    bestStreak: Math.max(0, whole(row.bestStreak) ?? 0),
    served: Math.max(0, whole(row.served) ?? 0),
    ended
  }
  return { ...row, ...fixed } as RunRecord
}
