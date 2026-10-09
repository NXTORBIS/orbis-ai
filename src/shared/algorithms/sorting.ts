import { Recorder, fail, intFrom, randomFrom, type AlgorithmError, type Run } from './trace.ts'

/**
 * Sorting algorithms that record what they do.
 *
 * ## These are the real algorithms
 *
 * Not `[...input].sort()` with an animation bolted on. Each one is written out, does its own comparisons and its own
 * swaps, and reports them. That is what makes the comparison counts mean something: when the laboratory says
 * insertion sort made 2,145 comparisons on this input and merge sort made 544, those are two numbers that came out
 * of two different algorithms actually running.
 *
 * It also means the complexity curve is measured. `n log n` is not written anywhere in the code that counts.
 *
 * ## Every one stops when told to
 *
 * Every loop tests `rec.cut`. A sort of a hundred thousand elements reaches the step ceiling and reports that it was
 * cut off rather than filling memory — and the partial result is labelled partial.
 *
 * ## In place means in place
 *
 * The algorithms that are in place swap within one array and say so in their metadata; merge sort and counting sort
 * allocate and say so. A laboratory claiming insertion sort is not in place would be teaching something false.
 *
 * Pure. No clock, no `Math.random` — randomised pivots take a seed.
 */

const MOST = 20_000

/** The input checked before anything runs. A sort of a million elements is refused rather than attempted. */
function check(values: readonly number[]): AlgorithmError | null {
  if (!Array.isArray(values)) return fail('input', 'That is not a list of numbers.', 'Give numbers separated by commas.')
  if (values.length === 0) return null
  if (values.length > MOST) {
    return fail('too-big', `${values.length.toLocaleString('en-GB')} values is more than this laboratory sorts.`, `Use at most ${MOST.toLocaleString('en-GB')}.`)
  }
  for (const one of values) {
    if (typeof one !== 'number' || !Number.isFinite(one)) return fail('input', 'The list contains something that is not a finite number.', 'Give only numbers.')
  }
  return null
}

/** A swap, recorded. The one place an exchange happens, so the count can never drift from the array. */
function swap(rec: Recorder, values: number[], i: number, j: number): void {
  if (i === j) return
  rec.step('swap', `swap positions ${i} and ${j}`, [i, j], { values: [values[i], values[j]] })
  const held = values[i]
  values[i] = values[j]
  values[j] = held
}

/** A comparison, recorded. Returns whether a > b. */
function greater(rec: Recorder, a: number, b: number, at: readonly number[]): boolean {
  rec.step('compare', `is ${a} greater than ${b}?`, at, { values: [a, b] })
  return a > b
}

export interface SortResult {
  sorted: readonly number[]
  /** True when the output really is in order. Checked, not assumed — a sort with a bug should say so. */
  correct: boolean
}

const finished = (rec: Recorder, name: string, input: readonly number[], values: number[], seed: number | null = null): Run => {
  if (!rec.cut) rec.step('done', 'sorted', [], { values: [...values].slice(0, 32) })
  const correct = values.every((one, at) => at === 0 || values[at - 1] <= one)
  return rec.finish(name, { values: [...input] }, { sorted: [...values], correct } satisfies SortResult, seed)
}

// ---------------------------------------------------------------- the quadratic family

export function bubbleSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const n = values.length

  rec.where(1, { n })
  for (let pass = 0; pass < n - 1 && !rec.cut; pass += 1) {
    let swapped = false
    rec.where(2, { pass, swapped: false })
    rec.step('range', `pass ${pass + 1}: the last ${pass} are already in place`, [], {
      region: { from: 0, to: Math.max(0, n - 1 - pass), label: `pass ${pass + 1}` }
    })
    for (let at = 0; at < n - 1 - pass && !rec.cut; at += 1) {
      rec.where(4, { at })
      if (greater(rec, values[at], values[at + 1], [at, at + 1])) {
        rec.where(5)
        swap(rec, values, at, at + 1)
        swapped = true
        rec.where(6, { swapped: true })
      }
    }
    rec.where(7)
    if (n - 1 - pass >= 0) rec.step('settle', `position ${n - 1 - pass} now holds its final value`, [n - 1 - pass])
    // The early exit is what makes bubble sort O(n) on sorted input, and leaving it out would misreport the best case.
    rec.where(8)
    if (!swapped) {
      rec.where(9)
      rec.step('note', 'nothing moved in that pass, so the list is in order', [])
      for (let at = 0; at < n - 1 - pass; at += 1) rec.step('settle', `position ${at} is in place`, [at])
      break
    }
  }
  return finished(rec, 'bubble sort', input, values)
}

export function insertionSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]

  rec.where(1, { n: values.length })
  if (values.length > 0) rec.step('settle', 'the first value is a sorted list of one', [0])
  for (let at = 1; at < values.length && !rec.cut; at += 1) {
    const held = values[at]
    rec.where(3, { at, held })
    rec.step('read', `take ${held} out of position ${at}`, [at], { values: [held], region: { from: 0, to: at, label: 'sorted so far' } })
    let into = at - 1
    rec.where(4, { into })
    while (into >= 0 && !rec.cut) {
      rec.where(5, { into })
      rec.step('compare', `is ${values[into]} greater than ${held}?`, [into, at], { values: [values[into], held] })
      if (values[into] <= held) break
      rec.where(6)
      rec.step('write', `shift ${values[into]} right into ${into + 1}`, [into + 1], { values: [values[into]] })
      values[into + 1] = values[into]
      into -= 1
      rec.where(7, { into })
    }
    rec.where(8)
    rec.step('write', `put ${held} into position ${into + 1}`, [into + 1], { values: [held] })
    values[into + 1] = held
    rec.step('settle', `positions 0 to ${at} are now in order`, Array.from({ length: at + 1 }, (_, one) => one))
  }
  return finished(rec, 'insertion sort', input, values)
}

export function selectionSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]

  rec.where(1, { n: values.length })
  for (let at = 0; at < values.length - 1 && !rec.cut; at += 1) {
    let smallest = at
    rec.where(2, { at, least: smallest })
    rec.step('range', `find the smallest from position ${at} onwards`, [at], {
      region: { from: at, to: values.length - 1, label: 'still to sort' }
    })
    for (let look = at + 1; look < values.length && !rec.cut; look += 1) {
      rec.where(4, { look })
      rec.step('compare', `is ${values[look]} smaller than ${values[smallest]}?`, [look, smallest], { values: [values[look], values[smallest]] })
      if (values[look] < values[smallest]) {
        smallest = look
        rec.where(5, { least: smallest })
        rec.step('update', `${values[look]} is the smallest so far`, [look], { values: [values[look]] })
      }
    }
    rec.where(smallest === at ? 6 : 7)
    swap(rec, values, at, smallest)
    rec.where(8)
    rec.step('settle', `position ${at} now holds its final value`, [at])
  }
  if (values.length > 0) rec.step('settle', `position ${values.length - 1} holds the last value`, [values.length - 1])
  // Selection sort always makes exactly n(n-1)/2 comparisons, which is why its best and worst cases are the same.
  rec.count('comparisonsAreFixed', 1)
  return finished(rec, 'selection sort', input, values)
}

// ---------------------------------------------------------------- the divide-and-conquer family

export function mergeSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  // Allocated once rather than per merge: merge sort is O(n) extra space, not O(n log n).
  const scratch = new Array<number>(values.length)

  const merge = (from: number, middle: number, to: number): void => {
    for (let at = from; at <= to; at += 1) scratch[at] = values[at]
    let left = from
    let right = middle + 1
    let into = from
    rec.where(9, { lo: from, mid: middle, hi: to, into })
    rec.step('range', `merge [${from}..${middle}] with [${middle + 1}..${to}]`, [], { region: { from, to, label: 'merging' } })

    while (left <= middle && right <= to && !rec.cut) {
      rec.where(10, { into })
      rec.step('compare', `is ${scratch[left]} at or below ${scratch[right]}?`, [left, right], { values: [scratch[left], scratch[right]] })
      rec.where(11)
      if (scratch[left] <= scratch[right]) {
        rec.step('write', `take ${scratch[left]} from the left into ${into}`, [into], { values: [scratch[left]] })
        values[into++] = scratch[left++]
      } else {
        rec.step('write', `take ${scratch[right]} from the right into ${into}`, [into], { values: [scratch[right]] })
        values[into++] = scratch[right++]
      }
    }
    rec.where(12)
    while (left <= middle && !rec.cut) {
      rec.where(12, { into })
      rec.step('write', `the left half still has ${scratch[left]}`, [into], { values: [scratch[left]] })
      values[into++] = scratch[left++]
    }
    while (right <= to && !rec.cut) {
      rec.where(12, { into })
      rec.step('write', `the right half still has ${scratch[right]}`, [into], { values: [scratch[right]] })
      values[into++] = scratch[right++]
    }
    rec.count('merges')
  }

  const sort = (from: number, to: number): void => {
    rec.where(2, { lo: from, hi: to })
    if (from >= to || rec.cut) return
    const frame = rec.enter(`merge sort [${from}..${to}]`)
    const middle = from + Math.floor((to - from) / 2)
    rec.where(3, { mid: middle })
    rec.where(4)
    sort(from, middle)
    rec.where(5)
    sort(middle + 1, to)
    rec.where(6)
    merge(from, middle, to)
    rec.leave(frame, `[${from}..${to}] in order`)
  }

  sort(0, values.length - 1)
  for (let at = 0; at < values.length && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'merge sort', input, values)
}

/**
 * Quicksort, with a choice of pivot.
 *
 * The pivot choice is a parameter because it is the whole lesson: last-element on sorted input is the O(n²) case, and
 * a random pivot is what makes that case unlikely. Both are real and the comparison counts show the difference.
 */
export type Pivot = 'last' | 'first' | 'middle' | 'random' | 'median-of-three'

export function quickSort(input: readonly number[], pivot: Pivot = 'last', seed = 1, ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const random = randomFrom(seed)

  const choose = (from: number, to: number): number => {
    switch (pivot) {
      case 'first':
        return from
      case 'middle':
        return from + Math.floor((to - from) / 2)
      case 'random':
        return intFrom(random, from, to)
      case 'median-of-three': {
        const middle = from + Math.floor((to - from) / 2)
        const three: [number, number][] = [
          [values[from], from],
          [values[middle], middle],
          [values[to], to]
        ]
        three.sort((a, b) => a[0] - b[0])
        rec.step('read', `median of ${values[from]}, ${values[middle]}, ${values[to]} is ${three[1][0]}`, [from, middle, to])
        return three[1][1]
      }
      default:
        return to
    }
  }

  const partition = (from: number, to: number): number => {
    rec.where(3, { lo: from, hi: to })
    const chosen = choose(from, to)
    if (chosen !== to) swap(rec, values, chosen, to)
    const value = values[to]
    rec.where(8, { pivot: value })
    rec.step('range', `partition [${from}..${to}] around the pivot ${value}`, [to], {
      values: [value],
      region: { from, to, label: `pivot ${value}` }
    })

    let boundary = from
    rec.where(9, { smaller: boundary })
    for (let at = from; at < to && !rec.cut; at += 1) {
      rec.where(11, { at })
      rec.step('compare', `is ${values[at]} below the pivot ${value}?`, [at, to], { values: [values[at], value] })
      if (values[at] < value) {
        rec.where(12)
        swap(rec, values, at, boundary)
        boundary += 1
        rec.where(13, { smaller: boundary })
      }
    }
    rec.where(14)
    swap(rec, values, boundary, to)
    rec.step('settle', `the pivot ${value} is now in its final place at ${boundary}`, [boundary], { values: [value] })
    rec.count('partitions')
    return boundary
  }

  const sort = (from: number, to: number): void => {
    rec.where(2, { lo: from, hi: to })
    if (from >= to || rec.cut) return
    const frame = rec.enter(`quicksort [${from}..${to}]`)
    const at = partition(from, to)
    sort(from, at - 1)
    sort(at + 1, to)
    rec.leave(frame, `[${from}..${to}] in order`)
  }

  sort(0, values.length - 1)
  return finished(rec, `quicksort (${pivot} pivot)`, input, values, pivot === 'random' ? seed : null)
}

export function heapSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]

  const siftDown = (at: number, limit: number): void => {
    let root = at
    rec.where(9, { root })
    while (!rec.cut) {
      const left = 2 * root + 1
      if (left >= limit) break
      let largest = left
      const right = left + 1
      rec.where(10, { root, biggest: largest })
      if (right < limit && greater(rec, values[right], values[left], [right, left])) largest = right
      rec.where(11, { biggest: largest })
      if (!greater(rec, values[largest], values[root], [largest, root])) break
      rec.where(12)
      swap(rec, values, root, largest)
      rec.count('siftSteps')
      root = largest
      rec.where(13, { root })
    }
  }

  rec.where(1, { n: values.length })
  rec.step('note', 'first build a heap: every parent at least as large as its children', [])
  for (let at = Math.floor(values.length / 2) - 1; at >= 0 && !rec.cut; at -= 1) {
    rec.where(1, { root: at })
    rec.step('range', `sift down from ${at}`, [at], { region: { from: 0, to: values.length - 1, label: 'heap' } })
    rec.where(2)
    siftDown(at, values.length)
  }

  rec.where(3)
  rec.step('note', 'now repeatedly take the largest off the top', [])
  for (let end = values.length - 1; end > 0 && !rec.cut; end -= 1) {
    rec.where(4, { end })
    swap(rec, values, 0, end)
    rec.where(5)
    rec.step('settle', `the largest remaining value is now at ${end}`, [end])
    rec.where(6)
    siftDown(0, end)
  }
  if (values.length > 0) rec.step('settle', 'position 0 holds the smallest', [0])
  return finished(rec, 'heap sort', input, values)
}

// ---------------------------------------------------------------- the non-comparison family

/**
 * Counting sort.
 *
 * Only works on whole numbers in a bounded range, and refuses otherwise rather than producing nonsense. The range
 * limit is the real constraint of the algorithm, not an arbitrary one: counting sort allocates a bucket per distinct
 * value, so a range of a billion is a billion buckets.
 */
export function countingSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  if (input.some((one) => !Number.isInteger(one))) {
    return fail('not-integers', 'Counting sort only works on whole numbers.', 'Use whole numbers, or choose a comparison sort.')
  }
  if (input.length === 0) return finished(new Recorder(ceiling), 'counting sort', input, [])

  const least = Math.min(...input)
  const most = Math.max(...input)
  const span = most - least + 1
  if (span > 1_000_000) {
    return fail(
      'range-too-wide',
      `Counting sort needs one bucket per value, and these span ${span.toLocaleString('en-GB')}.`,
      'Use a comparison sort for values spread this far apart.'
    )
  }

  const rec = new Recorder(ceiling)
  const values = [...input]
  const tally = new Array<number>(span).fill(0)

  rec.where(1, { least, most })
  rec.step('note', `count how many of each value there are, from ${least} to ${most}`, [])
  rec.where(2)
  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    rec.where(2, { value: values[at] })
    rec.step('read', `${values[at]} goes in bucket ${values[at] - least}`, [at], { values: [values[at]] })
    tally[values[at] - least] += 1
    rec.count('tallies')
  }

  rec.where(3)
  rec.step('note', 'then write the values back out, smallest bucket first', [])
  let into = 0
  for (let bucket = 0; bucket < span && !rec.cut; bucket += 1) {
    for (let again = 0; again < tally[bucket] && !rec.cut; again += 1) {
      const value = bucket + least
      rec.where(4, { value, into })
      rec.step('write', `write ${value} into position ${into}`, [into], { values: [value] })
      values[into] = value
      rec.step('settle', `position ${into} is in place`, [into])
      into += 1
    }
  }
  // No comparisons at all: this is the point of a non-comparison sort, and the count shows it.
  rec.count('comparisonFree', 1)
  return finished(rec, 'counting sort', input, values)
}

/** Radix sort, least-significant digit first, over non-negative whole numbers. */
export function radixSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  if (input.some((one) => !Number.isInteger(one) || one < 0)) {
    return fail('not-whole-positive', 'This radix sort works on whole numbers of zero or more.', 'Use non-negative whole numbers, or choose a comparison sort.')
  }
  if (input.length === 0) return finished(new Recorder(ceiling), 'radix sort', input, [])

  const rec = new Recorder(ceiling)
  let values = [...input]
  const most = Math.max(...values)

  rec.where(1, { place: 1 })
  for (let place = 1; Math.floor(most / place) > 0 && !rec.cut; place *= 10) {
    rec.where(1, { place })
    rec.step('note', `sort by the ${place === 1 ? 'ones' : place === 10 ? 'tens' : `${place}s`} digit`, [], {
      region: { from: 0, to: values.length - 1, label: `digit ${place}` }
    })
    const buckets: number[][] = Array.from({ length: 10 }, () => [])
    for (let at = 0; at < values.length && !rec.cut; at += 1) {
      const digit = Math.floor(values[at] / place) % 10
      rec.where(2, { digit })
      rec.step('read', `${values[at]} has digit ${digit} here`, [at], { values: [values[at]], extra: { digit } })
      buckets[digit].push(values[at])
    }
    const next: number[] = []
    rec.where(3)
    for (let digit = 0; digit < 10 && !rec.cut; digit += 1) {
      for (const value of buckets[digit]) {
        rec.where(3, { digit })
        rec.step('write', `write ${value} back into position ${next.length}`, [next.length], { values: [value] })
        next.push(value)
      }
    }
    values = next.length === values.length ? next : values
    rec.count('passes')
  }
  for (let at = 0; at < values.length && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'radix sort', input, values)
}

// ---------------------------------------------------------------- the registry

import {
  bitonicSort,
  bogoSort,
  bottomUpMergeSort,
  bucketSort,
  cocktailSort,
  combSort,
  cycleSort,
  gnomeSort,
  introSort,
  oddEvenSort,
  pancakeSort,
  shellSort,
  stoogeSort,
  threeWayQuickSort,
  timSort,
  treeSort
} from './sorting.more.ts'

export type SortName =
  | 'bubble'
  | 'insertion'
  | 'selection'
  | 'merge'
  | 'quick'
  | 'heap'
  | 'counting'
  | 'radix'
  | 'shell'
  | 'comb'
  | 'cocktail'
  | 'gnome'
  | 'odd-even'
  | 'cycle'
  | 'pancake'
  | 'three-way-quick'
  | 'bottom-up-merge'
  | 'tim'
  | 'intro'
  | 'tree'
  | 'bitonic'
  | 'bucket'
  | 'stooge'
  | 'bogo'

export const SORT_NAMES: readonly SortName[] = Object.freeze([
  'bubble',
  'insertion',
  'selection',
  'merge',
  'quick',
  'heap',
  'counting',
  'radix',
  'shell',
  'comb',
  'cocktail',
  'gnome',
  'odd-even',
  'cycle',
  'pancake',
  'three-way-quick',
  'bottom-up-merge',
  'tim',
  'intro',
  'tree',
  'bitonic',
  'bucket',
  'stooge',
  'bogo'
])

/**
 * One sort by name.
 *
 * Here so a comparison can run several algorithms over the same input without knowing anything about any of them,
 * and so the catalogue has a single place to look an algorithm up.
 */
export function runSort(
  name: SortName,
  values: readonly number[],
  options: { pivot?: Pivot; seed?: number; ceiling?: number } = {}
): Run | AlgorithmError {
  switch (name) {
    case 'bubble':
      return bubbleSort(values, options.ceiling)
    case 'insertion':
      return insertionSort(values, options.ceiling)
    case 'selection':
      return selectionSort(values, options.ceiling)
    case 'merge':
      return mergeSort(values, options.ceiling)
    case 'quick':
      return quickSort(values, options.pivot ?? 'median-of-three', options.seed ?? 1, options.ceiling)
    case 'heap':
      return heapSort(values, options.ceiling)
    case 'counting':
      return countingSort(values, options.ceiling)
    case 'radix':
      return radixSort(values, options.ceiling)
    case 'shell':
      return shellSort(values, options.ceiling)
    case 'comb':
      return combSort(values, options.ceiling)
    case 'cocktail':
      return cocktailSort(values, options.ceiling)
    case 'gnome':
      return gnomeSort(values, options.ceiling)
    case 'odd-even':
      return oddEvenSort(values, options.ceiling)
    case 'cycle':
      return cycleSort(values, options.ceiling)
    case 'pancake':
      return pancakeSort(values, options.ceiling)
    case 'three-way-quick':
      return threeWayQuickSort(values, options.seed ?? 1, options.ceiling)
    case 'bottom-up-merge':
      return bottomUpMergeSort(values, options.ceiling)
    case 'tim':
      return timSort(values, options.ceiling)
    case 'intro':
      return introSort(values, options.seed ?? 1, options.ceiling)
    case 'tree':
      return treeSort(values, options.ceiling)
    case 'bitonic':
      return bitonicSort(values, options.ceiling)
    case 'bucket':
      return bucketSort(values, options.ceiling)
    case 'stooge':
      return stoogeSort(values, options.ceiling)
    case 'bogo':
      return bogoSort(values, options.seed ?? 1, options.ceiling)
    default:
      return fail('unknown', `There is no sort called "${String(name)}".`, `Choose one of: ${SORT_NAMES.join(', ')}.`)
  }
}
