import { Recorder, fail, type AlgorithmError, type Run } from './trace.ts'

/**
 * Dynamic programming, with the table filled in step by step.
 *
 * ## The table is the lesson
 *
 * Dynamic programming is hard to learn because the answer appears in one corner of a grid and nothing explains how
 * it got there. So every algorithm here records each cell as it is written, which cells it was worked out from, and
 * then walks the table backwards to recover the actual choice — the items taken, the subsequence, the parenthesis
 * placement. A knapsack that returns only `maximum: 220` has taught nothing.
 *
 * ## Naive recursion is included on purpose
 *
 * `fibonacci` runs both the exponential recursion and the linear table, because the comparison is the only way the
 * cost of recomputation becomes real: fib(25) naively is 242,785 calls and 25 steps with a table. Both numbers are
 * measured.
 *
 * Pure.
 */

const MOST_CELLS = 250_000

export interface Cell {
  row: number
  column: number
  value: number
  /** The cells this one was worked out from. What makes the dependency visible. */
  from: readonly { row: number; column: number }[]
}

// ---------------------------------------------------------------- knapsack

export interface Item {
  name: string
  weight: number
  value: number
}

export interface KnapsackResult {
  best: number
  taken: readonly Item[]
  weightUsed: number
  /** The whole table, for the grid view. */
  table: readonly (readonly number[])[]
}

/**
 * The 0/1 knapsack: each item is taken once or not at all.
 *
 * Whole weights only, and it says why rather than silently rounding: the table has one column per unit of capacity,
 * so a fractional weight has no column to live in. Rounding would change the problem being solved.
 */
export function knapsack(items: readonly Item[], capacity: number, ceiling?: number): Run | AlgorithmError {
  if (items.length === 0) return fail('no-items', 'There are no items to choose from.', 'Add an item.')
  if (!Number.isInteger(capacity) || capacity < 0) return fail('capacity', 'The capacity has to be a whole number of zero or more.', 'Give a whole number.')
  for (const one of items) {
    if (!Number.isInteger(one.weight) || one.weight < 0) {
      return fail(
        'weights',
        `"${one.name}" weighs ${one.weight}, and this table needs whole weights — it has one column per unit of capacity.`,
        'Use whole weights, or scale them all up until they are whole.'
      )
    }
    if (typeof one.value !== 'number' || !Number.isFinite(one.value)) return fail('values', `"${one.name}" has no usable value.`, 'Give each item a number.')
  }
  if ((items.length + 1) * (capacity + 1) > MOST_CELLS) {
    return fail('too-big', `That table would have ${((items.length + 1) * (capacity + 1)).toLocaleString('en-GB')} cells.`, `Keep it under ${MOST_CELLS.toLocaleString('en-GB')}.`)
  }

  const rec = new Recorder(ceiling)
  const rows = items.length + 1
  const columns = capacity + 1
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(0))

  rec.where(1, { item: 0, capacity })
  rec.step('note', `a table of ${rows} rows and ${columns} columns: row i, column w is the best value using the first i items within weight w`, [])

  rec.where(1, { item: 0 })
  for (let i = 1; i < rows && !rec.cut; i += 1) {
    const item = items[i - 1]
    rec.where(1, { item: i })
    rec.step('range', `row ${i}: now ${item.name} may be used (weight ${item.weight}, value ${item.value})`, [], {
      region: { from: 0, to: columns - 1, label: `row ${i}: ${item.name}` }
    })
    for (let w = 0; w < columns && !rec.cut; w += 1) {
      const without = table[i - 1][w]
      rec.where(3, { capacity: w, without })
      if (item.weight > w) {
        table[i][w] = without
        rec.step('write', `${item.name} weighs more than ${w}, so the best is still ${without}`, [i, w], {
          values: [without],
          extra: { row: i, column: w, from: 'above' }
        })
        continue
      }
      const withIt = table[i - 1][w - item.weight] + item.value
      rec.where(4, { with: withIt })
      rec.step('compare', `leave ${item.name}: ${without}. Take it: ${table[i - 1][w - item.weight]} + ${item.value} = ${withIt}`, [i, w], {
        values: [without, withIt],
        extra: { row: i, column: w }
      })
      table[i][w] = Math.max(without, withIt)
      rec.where(5)
      rec.step('write', `cell (${i}, ${w}) is ${table[i][w]}`, [i, w], {
        values: [table[i][w]],
        extra: { row: i, column: w, chose: withIt > without ? 'take' : 'leave' }
      })
      rec.count('cells')
    }
  }

  // The table gives the number; walking it back gives the actual choice, which is the part people want.
  const taken: Item[] = []
  let weightUsed = 0
  if (!rec.cut) {
    rec.step('note', 'now walk back up the table to find out which items were actually taken', [])
    let w = capacity
    for (let i = items.length; i > 0 && !rec.cut; i -= 1) {
      if (table[i][w] !== table[i - 1][w]) {
        const item = items[i - 1]
        taken.unshift(item)
        weightUsed += item.weight
        rec.step('visit', `cell (${i}, ${w}) differs from the row above, so ${item.name} was taken`, [i, w], { extra: { item: item.name } })
        w -= item.weight
      } else {
        rec.step('read', `cell (${i}, ${w}) matches the row above, so ${items[i - 1].name} was left out`, [i, w])
      }
    }
    rec.step('done', `best value ${table[items.length][capacity]} using ${taken.map((one) => one.name).join(', ') || 'nothing'}`, [])
  }

  return rec.finish('0/1 knapsack', { items: items.length, capacity }, {
    best: table[items.length][capacity],
    taken,
    weightUsed,
    table
  } satisfies KnapsackResult)
}

// ---------------------------------------------------------------- subsequences

export interface SubsequenceResult {
  length: number
  /** The actual subsequence, recovered from the table. */
  sequence: string
  table: readonly (readonly number[])[]
}

/** The longest common subsequence of two strings, with the table and the recovered sequence. */
export function longestCommonSubsequence(a: string, b: string, ceiling?: number): Run | AlgorithmError {
  if (typeof a !== 'string' || typeof b !== 'string') return fail('input', 'Both inputs have to be text.', 'Give two strings.')
  if ((a.length + 1) * (b.length + 1) > MOST_CELLS) {
    return fail('too-big', 'Those strings are too long for the table.', `Keep the product of their lengths under ${MOST_CELLS.toLocaleString('en-GB')}.`)
  }

  const rec = new Recorder(ceiling)
  const rows = a.length + 1
  const columns = b.length + 1
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(0))

  rec.where(1, { i: 0, j: 0 })
  rec.step('note', `row i, column j is the longest common subsequence of the first i of "${a}" and the first j of "${b}"`, [])

  rec.where(1, { i: 0, j: 0 })
  for (let i = 1; i < rows && !rec.cut; i += 1) {
    rec.where(1, { i })
    for (let j = 1; j < columns && !rec.cut; j += 1) {
      rec.where(3, { j, match: a[i - 1] === b[j - 1] })
      rec.step('compare', `is "${a[i - 1]}" the same as "${b[j - 1]}"?`, [i, j], { values: [a[i - 1], b[j - 1]] })
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1
        rec.where(4)
        rec.step('write', `they match, so one longer than the diagonal: ${table[i][j]}`, [i, j], {
          values: [table[i][j]],
          extra: { row: i, column: j, from: 'diagonal' }
        })
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1])
        rec.where(6)
        rec.step('write', `no match, so the better of above (${table[i - 1][j]}) and left (${table[i][j - 1]}): ${table[i][j]}`, [i, j], {
          values: [table[i][j]],
          extra: { row: i, column: j, from: table[i - 1][j] >= table[i][j - 1] ? 'above' : 'left' }
        })
      }
      rec.count('cells')
    }
  }

  let sequence = ''
  if (!rec.cut) {
    rec.step('note', 'walk back from the bottom-right corner to read the subsequence off', [])
    let i = a.length
    let j = b.length
    while (i > 0 && j > 0 && !rec.cut) {
      if (a[i - 1] === b[j - 1]) {
        sequence = a[i - 1] + sequence
        rec.step('visit', `"${a[i - 1]}" is part of it`, [i, j], { values: [a[i - 1]] })
        i -= 1
        j -= 1
      } else if (table[i - 1][j] >= table[i][j - 1]) {
        rec.step('read', 'step up', [i, j])
        i -= 1
      } else {
        rec.step('read', 'step left', [i, j])
        j -= 1
      }
    }
    rec.step('done', `longest common subsequence: "${sequence}" (${table[a.length][b.length]} long)`, [])
  }

  return rec.finish('longest common subsequence', { a, b }, {
    length: table[a.length][b.length],
    sequence,
    table
  } satisfies SubsequenceResult)
}

/** The longest increasing subsequence, by the O(n²) table — chosen because the table is what can be shown. */
export function longestIncreasingSubsequence(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  if (!Array.isArray(values) || values.some((one) => typeof one !== 'number' || !Number.isFinite(one))) {
    return fail('input', 'That is not a list of numbers.', 'Give numbers separated by commas.')
  }
  if (values.length > 2_000) return fail('too-big', 'That list is too long for this table.', 'Use at most 2,000 values.')

  const rec = new Recorder(ceiling)
  const best = new Array<number>(values.length).fill(1)
  const previous = new Array<number>(values.length).fill(-1)

  rec.where(1, { at: 0, best: 1 })
  rec.step('note', 'for each position, find the longest increasing run that ends there', [])
  rec.where(1, { at: 0 })
  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    rec.where(2, { at, best: 1 })
    rec.step('range', `position ${at} holds ${values[at]}`, [at], { values: [values[at]] })
    for (let before = 0; before < at && !rec.cut; before += 1) {
      rec.where(3, { before })
      rec.step('compare', `is ${values[before]} below ${values[at]}, and would it make a longer run?`, [before, at], { values: [values[before], values[at]] })
      if (values[before] < values[at] && best[before] + 1 > best[at]) {
        best[at] = best[before] + 1
        previous[at] = before
        rec.where(5, { best: best[at] })
        rec.step('update', `yes — the run ending at ${at} is now ${best[at]} long, following position ${before}`, [at, before], { extra: { length: best[at] } })
      }
    }
    rec.where(6, { best: best[at] })
    rec.step('write', `the longest run ending at ${at} is ${best[at]}`, [at], { values: [best[at]] })
  }

  let sequence: number[] = []
  if (!rec.cut) {
    let end = 0
    for (let at = 1; at < best.length; at += 1) if (best[at] > best[end]) end = at
    rec.step('note', `the longest run ends at position ${end}; follow the trail back`, [end])
    let at: number = end
    while (at !== -1 && !rec.cut) {
      sequence.unshift(values[at])
      rec.step('visit', `${values[at]} is part of it`, [at], { values: [values[at]] })
      at = previous[at]
    }
    rec.step('done', `longest increasing subsequence: ${sequence.join(', ')} (${sequence.length} long)`, [])
  }

  return rec.finish('longest increasing subsequence', { values: [...values] }, {
    length: sequence.length,
    sequence: sequence.join(', '),
    table: [best]
  } satisfies SubsequenceResult)
}

// ---------------------------------------------------------------- recursion versus a table

export interface FibonacciResult {
  value: number
  /** Calls the naive recursion made. Measured, which is the point. */
  naiveCalls: number
  /** Steps the table took. */
  tableSteps: number
}

/**
 * Fibonacci, both ways, so the cost of recomputation is a measured number.
 *
 * Capped at 30 for the naive side because fib(40) is 331 million calls — the point is made long before that, and
 * attempting it would be a hang rather than a lesson.
 */
export function fibonacci(n: number, ceiling?: number): Run | AlgorithmError {
  if (!Number.isInteger(n) || n < 0) return fail('input', 'Fibonacci needs a whole number of zero or more.', 'Give a whole number.')
  if (n > 30) {
    return fail(
      'too-big',
      `The naive recursion for fib(${n}) would make tens of millions of calls, which is a hang rather than a demonstration.`,
      'Use 30 or less to see the comparison, or ask for the table on its own.'
    )
  }

  const rec = new Recorder(ceiling)
  let naiveCalls = 0

  rec.where(2, { n, hits: 0 })
  rec.step('note', `first the naive recursion: fib(n) = fib(n-1) + fib(n-2), recomputing everything`, [])
  const naive = (k: number): number => {
    naiveCalls += 1
    if (rec.cut) return 0
    const frame = rec.enter(`fib(${k})`)
    rec.where(2, { n: k, hits: naiveCalls })
    if (k <= 1) {
      rec.where(3)
      rec.step('read', `fib(${k}) is ${k} with no further work`, [k], { values: [k] })
      rec.leave(frame, String(k))
      return k
    }
    rec.where(4, { n: k })
    const value = naive(k - 1) + naive(k - 2)
    rec.where(5)
    rec.leave(frame, String(value))
    return value
  }
  const naiveValue = naive(n)

  const tableFrom = rec.length
  rec.step('note', 'now the table: each value worked out once, in order', [])
  const table = new Array<number>(Math.max(2, n + 1)).fill(0)
  table[1] = 1
  rec.where(1)
  for (let k = 2; k <= n && !rec.cut; k += 1) {
    table[k] = table[k - 1] + table[k - 2]
    rec.where(5, { n: k })
    rec.step('write', `fib(${k}) = ${table[k - 1]} + ${table[k - 2]} = ${table[k]}`, [k], { values: [table[k]] })
    rec.count('tableCells')
  }
  const tableSteps = rec.length - tableFrom

  if (!rec.cut) {
    rec.step(
      'done',
      `fib(${n}) is ${naiveValue}. The recursion made ${naiveCalls.toLocaleString('en-GB')} calls; the table took ${tableSteps} steps.`,
      []
    )
  }

  return rec.finish('Fibonacci: recursion against a table', { n }, {
    value: n <= 1 ? n : table[n],
    naiveCalls,
    tableSteps
  } satisfies FibonacciResult)
}

// ---------------------------------------------------------------- the registry

export type DynamicName = 'knapsack' | 'lcs' | 'lis' | 'fibonacci'

export const DYNAMIC_NAMES: readonly DynamicName[] = Object.freeze(['knapsack', 'lcs', 'lis', 'fibonacci'])

export function runDynamic(
  name: DynamicName,
  options: { items?: readonly Item[]; capacity?: number; a?: string; b?: string; values?: readonly number[]; n?: number; ceiling?: number }
): Run | AlgorithmError {
  switch (name) {
    case 'knapsack':
      return knapsack(options.items ?? [], options.capacity ?? 0, options.ceiling)
    case 'lcs':
      return longestCommonSubsequence(options.a ?? '', options.b ?? '', options.ceiling)
    case 'lis':
      return longestIncreasingSubsequence(options.values ?? [], options.ceiling)
    case 'fibonacci':
      return fibonacci(options.n ?? 10, options.ceiling)
    default:
      return fail('unknown', `There is no algorithm called "${String(name)}".`, `Choose one of: ${DYNAMIC_NAMES.join(', ')}.`)
  }
}
