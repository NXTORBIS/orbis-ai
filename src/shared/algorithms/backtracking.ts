import { Recorder, fail, type AlgorithmError, type Run } from './trace.ts'

/**
 * Recursion and backtracking, recorded.
 *
 * ## Why these four
 *
 * Towers of Hanoi is recursion with no choice in it — every move is forced, and the whole algorithm is three lines.
 * Permutations and subsets are recursion where the choice is "take it or not", and the recursion tree is the answer.
 * N-Queens is the first one that has to *undo*: it places a queen, finds the position impossible, and takes it back.
 * Watching a placement recorded and then a removal recorded is what backtracking is, and nothing explains it as well
 * as seeing it happen.
 *
 * ## The undo is a recorded step, not a gap in the trace
 *
 * A trace that only records placements would show a board filling up and silently resetting. Every removal is its
 * own step with its own words, which is why the step counts for N-Queens are so much larger than the number of
 * queens placed — and that gap is the cost of backtracking, measured.
 *
 * Pure. No clock, no randomness.
 */

const MOST_QUEENS = 10
const MOST_DISCS = 12
const MOST_ITEMS = 9

export interface HanoiResult {
  moves: readonly { disc: number; from: string; to: string }[]
  /** 2^n - 1, and the trace is checked against it. */
  fewest: number
}

/**
 * Towers of Hanoi.
 *
 * The fewest possible moves is 2^n − 1, and the result says so beside the number actually made — because a learner's
 * first question is whether the recursion is wasteful, and the answer is that it is exactly optimal.
 */
export function hanoi(discs: number, ceiling?: number): Run | AlgorithmError {
  if (!Number.isInteger(discs) || discs < 1) return fail('input', 'The number of discs has to be a whole number of one or more.', 'Try 3.')
  if (discs > MOST_DISCS) {
    return fail(
      'too-big',
      `${discs} discs takes ${(2 ** discs - 1).toLocaleString('en-GB')} moves.`,
      `Use ${MOST_DISCS} or fewer — the number of moves doubles with every disc.`
    )
  }

  const rec = new Recorder(ceiling)
  const moves: { disc: number; from: string; to: string }[] = []
  const pegs: Record<string, number[]> = { A: Array.from({ length: discs }, (_, one) => discs - one), B: [], C: [] }

  rec.where(1, { n: discs, moves: 0 })
  rec.step('note', `move ${discs} disc${discs === 1 ? '' : 's'} from A to C, using B, never putting a larger disc on a smaller one`, [])

  const move = (count: number, from: string, to: string, spare: string): void => {
    if (count === 0 || rec.cut) return
    const frame = rec.enter(`move ${count} from ${from} to ${to}`)
    rec.where(2, { n: count, from, to })
    move(count - 1, from, spare, to)

    const disc = pegs[from].pop()
    if (disc !== undefined) {
      pegs[to].push(disc)
      moves.push({ disc, from, to })
      rec.where(3, { disc, moves: moves.length })
      rec.step('visit', `move disc ${disc} from ${from} to ${to}`, [from, to], {
        values: [disc],
        extra: { A: [...pegs.A], B: [...pegs.B], C: [...pegs.C] }
      })
      rec.count('moves')
    }

    rec.where(4, { n: count - 1, from: spare, to })
    move(count - 1, spare, to, from)
    rec.leave(frame, `${count} discs are on ${to}`)
  }

  move(discs, 'A', 'C', 'B')
  const fewest = 2 ** discs - 1
  if (!rec.cut) {
    rec.where(5, { moves: moves.length })
    rec.step('done', `${moves.length} moves, which is 2^${discs} − 1 and cannot be bettered`, [])
  }
  return rec.finish('Towers of Hanoi', { discs }, { moves, fewest } satisfies HanoiResult)
}

export interface ChoiceResult {
  /** Each complete answer found. */
  found: readonly (readonly (number | string)[])[]
  /** How many were expected: n! for permutations, 2^n for subsets. */
  expected: number
}

/** Every permutation, by choosing one unused item at a time and putting it back afterwards. */
export function permutations(items: readonly (number | string)[], ceiling?: number): Run | AlgorithmError {
  if (!Array.isArray(items) || items.length === 0) return fail('input', 'There is nothing to arrange.', 'Give some items.')
  if (items.length > MOST_ITEMS) {
    return fail('too-big', `${items.length} items have ${factorial(items.length).toLocaleString('en-GB')} arrangements.`, `Use ${MOST_ITEMS} or fewer.`)
  }

  const rec = new Recorder(ceiling)
  const found: (number | string)[][] = []
  const used = new Array<boolean>(items.length).fill(false)
  const building: (number | string)[] = []

  rec.where(1, { n: items.length, found: 0 })
  rec.step('note', `arrange ${items.length} items: ${items.join(', ')}`, [])

  const go = (): void => {
    if (rec.cut) return
    rec.where(2, { depth: building.length })
    if (building.length === items.length) {
      found.push([...building])
      rec.where(3, { found: found.length })
      rec.step('visit', `a complete arrangement: ${building.join(', ')}`, [], { extra: { arrangement: [...building] } })
      return
    }
    for (let at = 0; at < items.length && !rec.cut; at += 1) {
      if (used[at]) continue
      used[at] = true
      building.push(items[at])
      rec.where(4, { taking: String(items[at]), depth: building.length })
      rec.step('push', `take ${items[at]}`, [at], { values: [items[at]] })
      go()
      // The undo is a step of its own. Without it the trace would show the arrangement changing with no cause.
      used[at] = false
      building.pop()
      rec.where(6, { depth: building.length })
      rec.step('pop', `put ${items[at]} back and try something else`, [at], { values: [items[at]] })
    }
  }
  go()

  const expected = factorial(items.length)
  if (!rec.cut) rec.step('done', `${found.length} arrangements, which is ${items.length}! = ${expected}`, [])
  return rec.finish('permutations', { items: [...items] }, { found, expected } satisfies ChoiceResult)
}

/** Every subset, by taking or leaving each item in turn. */
export function subsets(items: readonly (number | string)[], ceiling?: number): Run | AlgorithmError {
  if (!Array.isArray(items) || items.length === 0) return fail('input', 'There is nothing to choose from.', 'Give some items.')
  if (items.length > 14) return fail('too-big', `${items.length} items have ${2 ** items.length} subsets.`, 'Use 14 or fewer.')

  const rec = new Recorder(ceiling)
  const found: (number | string)[][] = []
  const building: (number | string)[] = []

  rec.where(1, { n: items.length, found: 0 })
  rec.step('note', `each of the ${items.length} items is either in or out, so there are 2^${items.length} = ${2 ** items.length} subsets`, [])

  const go = (at: number): void => {
    if (rec.cut) return
    rec.where(2, { at, depth: building.length })
    if (at === items.length) {
      found.push([...building])
      rec.where(3, { found: found.length })
      rec.step('visit', building.length === 0 ? 'the empty subset' : `a subset: ${building.join(', ')}`, [], {
        extra: { subset: [...building] }
      })
      return
    }
    // Leave it.
    rec.where(4, { taking: 'no' })
    rec.step('note', `leave ${items[at]} out`, [at], { values: [items[at]] })
    go(at + 1)
    // Take it.
    building.push(items[at])
    rec.where(5, { taking: 'yes', depth: building.length })
    rec.step('push', `put ${items[at]} in`, [at], { values: [items[at]] })
    go(at + 1)
    building.pop()
    rec.where(5, { depth: building.length })
    rec.step('pop', `take ${items[at]} back out`, [at], { values: [items[at]] })
  }
  go(0)

  const expected = 2 ** items.length
  if (!rec.cut) rec.step('done', `${found.length} subsets, which is 2^${items.length} = ${expected}`, [])
  return rec.finish('subsets', { items: [...items] }, { found, expected } satisfies ChoiceResult)
}

export interface QueensResult {
  /** One queen's column per row, for each solution. */
  solutions: readonly (readonly number[])[]
  /** How many placements were tried and taken back. The cost of backtracking, counted. */
  removals: number
}

/**
 * N-Queens: place one queen per row so that none attacks another.
 *
 * Each placement and each removal is a recorded step, so the board on screen is exactly the board the algorithm
 * held — and the removals, which are most of the steps, are what backtracking actually costs.
 */
export function queens(n: number, ceiling?: number): Run | AlgorithmError {
  if (!Number.isInteger(n) || n < 1) return fail('input', 'The board has to be at least one square.', 'Try 8.')
  if (n > MOST_QUEENS) return fail('too-big', `A ${n}×${n} board is more than this traces step by step.`, `Use ${MOST_QUEENS} or fewer.`)

  const rec = new Recorder(ceiling)
  const column = new Array<number>(n).fill(-1)
  const solutions: number[][] = []
  let removals = 0

  rec.where(1, { n, solutions: 0 })
  rec.step('note', `place one queen in each of the ${n} rows so that no two share a column or a diagonal`, [])

  /** Whether a queen at (row, col) is attacked by any already placed. Each check is recorded. */
  const safe = (row: number, col: number): boolean => {
    for (let other = 0; other < row && !rec.cut; other += 1) {
      rec.where(4, { row, col, against: other })
      rec.step('compare', `does the queen in row ${other}, column ${column[other]} attack row ${row}, column ${col}?`, [other, row], {
        values: [column[other], col]
      })
      if (column[other] === col) {
        rec.step('note', `yes — same column`, [other, row])
        return false
      }
      if (Math.abs(column[other] - col) === row - other) {
        rec.step('note', `yes — same diagonal`, [other, row])
        return false
      }
    }
    return true
  }

  const place = (row: number): void => {
    if (rec.cut) return
    rec.where(2, { row })
    if (row === n) {
      solutions.push([...column])
      rec.where(3, { solutions: solutions.length })
      rec.step('visit', `all ${n} queens placed: columns ${column.join(', ')}`, [], { extra: { board: [...column] } })
      return
    }
    for (let col = 0; col < n && !rec.cut; col += 1) {
      if (!safe(row, col)) continue
      column[row] = col
      rec.where(5, { row, col })
      rec.step('push', `place a queen at row ${row}, column ${col}`, [row, col], { extra: { board: [...column] } })
      place(row + 1)
      column[row] = -1
      removals += 1
      rec.where(6, { removals })
      rec.step('pop', `take the queen out of row ${row}, column ${col} and try the next column`, [row, col], {
        extra: { board: [...column] }
      })
      rec.count('backtracks')
    }
  }
  place(0)

  if (!rec.cut) {
    rec.step(
      'done',
      solutions.length === 0
        ? `there is no way to place ${n} queens on a ${n}×${n} board`
        : `${solutions.length} solution${solutions.length === 1 ? '' : 's'}, after taking a queen back ${removals} times`,
      []
    )
  }
  return rec.finish('N-Queens', { n }, { solutions, removals } satisfies QueensResult)
}

function factorial(n: number): number {
  let out = 1
  for (let one = 2; one <= n; one += 1) out *= one
  return out
}

// ---------------------------------------------------------------- the registry

export type BacktrackName = 'hanoi' | 'permutations' | 'subsets' | 'n-queens'

export const BACKTRACK_NAMES: readonly BacktrackName[] = Object.freeze(['hanoi', 'permutations', 'subsets', 'n-queens'])

export function runBacktrack(
  name: BacktrackName,
  options: { n?: number; items?: readonly (number | string)[]; ceiling?: number } = {}
): Run | AlgorithmError {
  switch (name) {
    case 'hanoi':
      return hanoi(options.n ?? 3, options.ceiling)
    case 'permutations':
      return permutations(options.items ?? [1, 2, 3], options.ceiling)
    case 'subsets':
      return subsets(options.items ?? [1, 2, 3], options.ceiling)
    case 'n-queens':
      return queens(options.n ?? 6, options.ceiling)
    default:
      return fail('unknown', `There is no algorithm called "${String(name)}".`, `Choose one of: ${BACKTRACK_NAMES.join(', ')}.`)
  }
}
