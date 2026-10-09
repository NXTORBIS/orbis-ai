import { Recorder, fail, randomFrom, type AlgorithmError, type Run } from './trace.ts'
import { type SortResult } from './sorting.ts'

/**
 * The rest of the sorting family.
 *
 * ## Why a second file
 *
 * `sorting.ts` holds the eight every course teaches. These are the other seventeen — the shell-and-gap family, the
 * exchange oddities, the hybrids, and the two that exist to be laughed at. Together they are what a sorting
 * laboratory is for: not "here is quicksort" but "here are twenty-five ways to do the same thing, and here is what
 * each one actually costs on this input".
 *
 * ## The same rules as everything else here
 *
 * Each one is written out and does its own comparisons and its own swaps, recorded as they happen. Nothing calls
 * `Array.prototype.sort`. Every loop tests `rec.cut`, so a bogo sort of twelve elements stops at the ceiling and
 * says it was stopped rather than running until the window dies.
 *
 * ## The ones that are deliberately terrible
 *
 * Stooge sort and bogo sort are here because a complexity curve needs a top end to be legible. Bogo takes a seed,
 * so "it finished in 40,319 shuffles" is a fact somebody can reproduce rather than a story.
 *
 * Pure. No clock, no `Math.random` — the shuffles take a seed.
 */

const MOST = 20_000

function check(values: readonly number[]): AlgorithmError | null {
  if (!Array.isArray(values)) return fail('input', 'That is not a list of numbers.', 'Give numbers separated by commas.')
  if (values.length > MOST) {
    return fail('too-big', `${values.length.toLocaleString('en-GB')} values is more than this laboratory sorts.`, `Use at most ${MOST.toLocaleString('en-GB')}.`)
  }
  for (const one of values) {
    if (typeof one !== 'number' || !Number.isFinite(one)) return fail('input', 'The list contains something that is not a finite number.', 'Give only numbers.')
  }
  return null
}

const finished = (rec: Recorder, name: string, input: readonly number[], values: number[], seed: number | null = null): Run => {
  if (!rec.cut) rec.step('done', 'sorted', [], { values: [...values].slice(0, 32) })
  const correct = values.every((one, at) => at === 0 || values[at - 1] <= one)
  return rec.finish(name, { values: [...input] }, { sorted: [...values], correct } satisfies SortResult, seed)
}

function swap(rec: Recorder, values: number[], i: number, j: number, vars?: Record<string, number | string | boolean>): void {
  if (i === j) return
  rec.step('swap', `swap positions ${i} and ${j}`, [i, j], { values: [values[i], values[j]], ...(vars ? { vars } : {}) })
  const held = values[i]
  values[i] = values[j]
  values[j] = held
}

/** A comparison, recorded. Returns whether a > b. */
function greater(rec: Recorder, a: number, b: number, at: readonly number[], vars?: Record<string, number | string | boolean>): boolean {
  rec.step('compare', `is ${a} greater than ${b}?`, at, { values: [a, b], ...(vars ? { vars } : {}) })
  return a > b
}

// ---------------------------------------------------------------- the gap family

/**
 * Shell sort: insertion sort on elements a gap apart, with the gap shrinking to one.
 *
 * The gap sequence is Knuth's (1, 4, 13, 40, …), stated here rather than hidden, because the sequence *is* the
 * algorithm — a different one gives a different complexity and this laboratory would be lying if it did not say
 * which it used.
 */
export function shellSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const n = values.length

  let gap = 1
  while (gap < Math.floor(n / 3)) gap = gap * 3 + 1

  rec.where(1, { gap })
  while (gap >= 1 && !rec.cut) {
    rec.where(1, { gap })
    rec.step('range', `gap ${gap}: sort every ${gap}th element together`, [], {
      region: { from: 0, to: Math.max(0, n - 1), label: `gap ${gap}` },
      vars: { gap }
    })
    for (let at = gap; at < n && !rec.cut; at += 1) {
      const held = values[at]
      rec.where(2, { i: at })
      rec.step('read', `take ${held} out of position ${at}`, [at], { values: [held], vars: { gap, i: at, held } })
      let into = at
      rec.where(4, { j: into })
      while (into >= gap && !rec.cut) {
        rec.where(5, { j: into })
        if (!greater(rec, values[into - gap], held, [into - gap, at], { gap, i: at, j: into })) break
        rec.where(6)
        rec.step('write', `shift ${values[into - gap]} right by ${gap}`, [into], { values: [values[into - gap]] })
        values[into] = values[into - gap]
        into -= gap
        rec.where(7, { j: into })
      }
      rec.where(8)
      rec.step('write', `put ${held} into position ${into}`, [into], { values: [held], vars: { gap, i: at } })
      values[into] = held
    }
    gap = Math.floor(gap / 3)
  }
  for (let at = 0; at < n && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'shell sort', input, values)
}

/**
 * Comb sort: bubble sort with a shrinking gap.
 *
 * The shrink factor 1.3 is the one the original paper found; it is what turns bubble sort's O(n²) into something
 * close to O(n log n) in practice, by killing the small values stranded at the end that bubble sort moves one place
 * per pass.
 */
export function combSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const n = values.length

  let gap = n
  let swapped = true
  rec.where(1, { gap })
  while ((gap > 1 || swapped) && !rec.cut) {
    rec.where(2)
    gap = Math.max(1, Math.floor(gap / 1.3))
    swapped = false
    rec.where(3, { gap, swapped: false })
    rec.step('range', `gap ${gap}`, [], { region: { from: 0, to: Math.max(0, n - 1), label: `gap ${gap}` }, vars: { gap } })
    for (let at = 0; at + gap < n && !rec.cut; at += 1) {
      rec.where(5, { i: at })
      if (greater(rec, values[at], values[at + gap], [at, at + gap], { gap, i: at })) {
        rec.where(6)
        swap(rec, values, at, at + gap, { gap, i: at })
        swapped = true
        rec.where(6, { swapped: true })
      }
    }
  }
  for (let at = 0; at < n && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'comb sort', input, values)
}

// ---------------------------------------------------------------- the exchange oddities

/** Cocktail shaker sort: bubble sort that walks back as well as forwards. */
export function cocktailSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  let lo = 0
  let hi = values.length - 1
  let swapped = true

  rec.where(1, { lo, hi, going: 'forwards' })
  while (swapped && lo < hi && !rec.cut) {
    swapped = false
    rec.where(2, { lo, hi, going: 'forwards', swapped: false })
    rec.step('range', `forwards from ${lo} to ${hi}`, [], { region: { from: lo, to: hi, label: 'forwards' }, vars: { lo, hi } })
    for (let at = lo; at < hi && !rec.cut; at += 1) {
      rec.where(2, { i: at })
      if (greater(rec, values[at], values[at + 1], [at, at + 1], { lo, hi, i: at })) {
        swap(rec, values, at, at + 1)
        swapped = true
        rec.set({ swapped: true })
      }
    }
    rec.where(3)
    rec.step('settle', `position ${hi} now holds its final value`, [hi])
    hi -= 1
    rec.set({ hi })
    if (!swapped || lo >= hi) break

    swapped = false
    rec.where(4, { lo, hi, going: 'backwards', swapped: false })
    rec.step('range', `backwards from ${hi} to ${lo}`, [], { region: { from: lo, to: hi, label: 'backwards' }, vars: { lo, hi } })
    for (let at = hi; at > lo && !rec.cut; at -= 1) {
      rec.where(4, { i: at })
      if (greater(rec, values[at - 1], values[at], [at - 1, at], { lo, hi, i: at })) {
        swap(rec, values, at - 1, at)
        swapped = true
        rec.set({ swapped: true })
      }
    }
    rec.where(5)
    rec.step('settle', `position ${lo} now holds its final value`, [lo])
    lo += 1
    rec.set({ lo })
  }
  for (let at = 0; at < values.length && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'cocktail shaker sort', input, values)
}

/** Gnome sort: step forward when the pair is in order, step back and swap when it is not. */
export function gnomeSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  let at = 0

  rec.where(1, { i: at })
  while (at < values.length && !rec.cut) {
    rec.where(2, { i: at })
    if (at === 0) {
      rec.where(3)
      rec.step('note', 'at the start, so step forward', [0], { vars: { i: at } })
      at += 1
      rec.where(4, { i: at })
      continue
    }
    rec.where(3, { i: at })
    if (greater(rec, values[at - 1], values[at], [at - 1, at], { i: at })) {
      rec.where(6)
      swap(rec, values, at - 1, at, { i: at })
      at -= 1
      rec.where(7, { i: at })
    } else {
      at += 1
      rec.where(4, { i: at })
    }
  }
  for (let one = 0; one < values.length && !rec.cut; one += 1) rec.step('settle', `position ${one} is in place`, [one])
  return finished(rec, 'gnome sort', input, values)
}

/** Odd-even (brick) sort: compare-and-swap every odd pair, then every even pair, until a pass changes nothing. */
export function oddEvenSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const n = values.length
  let sorted = false

  rec.where(1, { swapped: false })
  while (!sorted && !rec.cut) {
    sorted = true
    for (const phase of [1, 0]) {
      rec.where(phase === 1 ? 2 : 4, { phase: phase === 1 ? 'odd' : 'even' })
      rec.step('range', phase === 1 ? 'odd pairs' : 'even pairs', [], {
        region: { from: 0, to: Math.max(0, n - 1), label: phase === 1 ? 'odd' : 'even' },
        vars: { phase: phase === 1 ? 'odd' : 'even' }
      })
      for (let at = phase; at + 1 < n && !rec.cut; at += 2) {
        rec.where(phase === 1 ? 2 : 4, { i: at })
        if (greater(rec, values[at], values[at + 1], [at, at + 1], { i: at })) {
          rec.where(phase === 1 ? 3 : 5)
          swap(rec, values, at, at + 1)
          sorted = false
          rec.set({ swapped: true })
        }
      }
    }
  }
  for (let at = 0; at < n && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'odd-even sort', input, values)
}

/**
 * Cycle sort: the one that writes each element exactly once.
 *
 * It costs more comparisons than anything else here and fewer writes than anything else here, which is the whole
 * point of it — it is what you use when a write is expensive, like flash memory with a limited erase count. The
 * two counters in the statistics panel are what show that trade, so this algorithm is the one that proves the
 * panel is worth having.
 */
export function cycleSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const n = values.length

  rec.where(1, { start: 0 })
  for (let start = 0; start < n - 1 && !rec.cut; start += 1) {
    let held = values[start]
    rec.where(2, { start, held })
    rec.step('read', `start a cycle at position ${start} with ${held}`, [start], { values: [held], vars: { start, held } })
    let into = start
    rec.where(3, { into })
    for (let at = start + 1; at < n && !rec.cut; at += 1) {
      rec.step('compare', `is ${values[at]} less than ${held}?`, [at, start], { values: [values[at], held] })
      if (values[at] < held) into += 1
    }
    rec.where(4, { into })
    if (into === start) {
      rec.step('note', `${held} is already where it belongs`, [start])
      continue
    }
    rec.where(5)
    while (held === values[into] && !rec.cut) into += 1
    if (into !== start) {
      rec.where(6, { into })
      rec.step('write', `write ${held} into position ${into}`, [into], { values: [held], vars: { into } })
      const other = values[into]
      values[into] = held
      held = other
      rec.step('settle', `position ${into} is settled`, [into])
    }
    rec.where(7)
    while (into !== start && !rec.cut) {
      into = start
      rec.where(7, { into })
      for (let at = start + 1; at < n && !rec.cut; at += 1) {
        rec.step('compare', `is ${values[at]} less than ${held}?`, [at], { values: [values[at], held] })
        if (values[at] < held) into += 1
      }
      while (held === values[into] && !rec.cut) into += 1
      if (held !== values[into]) {
        rec.step('write', `write ${held} into position ${into}`, [into], { values: [held], vars: { into } })
        const other = values[into]
        values[into] = held
        held = other
      }
    }
  }
  for (let at = 0; at < n && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'cycle sort', input, values)
}

/** Pancake sort: the only move allowed is to flip a prefix, so the biggest is flipped to the top and then to the end. */
export function pancakeSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]

  const flip = (upTo: number): void => {
    rec.step('range', `flip the first ${upTo + 1}`, [], { region: { from: 0, to: upTo, label: 'flip' }, vars: { k: upTo + 1 } })
    rec.set({ k: upTo + 1 })
    let lo = 0
    let hi = upTo
    while (lo < hi && !rec.cut) {
      swap(rec, values, lo, hi)
      lo += 1
      hi -= 1
    }
  }

  rec.where(1, { size: values.length })
  for (let size = values.length; size > 1 && !rec.cut; size -= 1) {
    let biggest = 0
    rec.where(2, { size, biggest })
    for (let at = 1; at < size && !rec.cut; at += 1) {
      if (greater(rec, values[at], values[biggest], [at, biggest], { size, biggest })) biggest = at
    }
    rec.set({ biggest })
    if (biggest !== size - 1) {
      if (biggest !== 0) {
        rec.where(3)
        flip(biggest)
      }
      rec.where(4)
      flip(size - 1)
    }
    rec.where(5)
    rec.step('settle', `position ${size - 1} now holds its final value`, [size - 1])
  }
  for (let at = 0; at < values.length && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'pancake sort', input, values)
}

// ---------------------------------------------------------------- the divide family, continued

/**
 * Three-way quicksort (Dutch national flag partition).
 *
 * Splits into less / equal / greater rather than less / greater, so a list with many duplicates is sorted in one
 * pass over the equals instead of recursing into them. On a list of a thousand values drawn from ten, the
 * difference against ordinary quicksort is the whole lesson.
 */
export function threeWayQuickSort(input: readonly number[], seed = 1, ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const random = randomFrom(seed)

  const sort = (lo: number, hi: number): void => {
    rec.where(2, { lo, hi })
    if (lo >= hi || rec.cut) return
    const frame = rec.enter(`three-way sort ${lo}..${hi}`)
    const pivotAt = lo + Math.floor(random() * (hi - lo + 1))
    const pivot = values[pivotAt]
    rec.where(3, { pivot })
    rec.step('range', `pivot ${pivot} from position ${pivotAt}`, [pivotAt], {
      region: { from: lo, to: hi, label: 'partition' },
      values: [pivot],
      vars: { lo, hi, pivot }
    })

    let less = lo
    let at = lo
    let greaterThan = hi
    rec.where(4, { equal: greaterThan - less + 1 })
    while (at <= greaterThan && !rec.cut) {
      rec.where(4)
      rec.step('compare', `is ${values[at]} less than, equal to or greater than ${pivot}?`, [at], { values: [values[at], pivot], vars: { lt: less, i: at, gt: greaterThan } })
      if (values[at] < pivot) {
        swap(rec, values, less, at)
        less += 1
        at += 1
      } else if (values[at] > pivot) {
        swap(rec, values, at, greaterThan)
        greaterThan -= 1
      } else {
        at += 1
      }
    }
    for (let one = less; one <= greaterThan && !rec.cut; one += 1) {
      rec.step('settle', `position ${one} holds the pivot value and is settled`, [one])
    }
    rec.set({ equal: greaterThan - less + 1 })
    rec.leave(frame, `${lo}..${hi} partitioned`)
    rec.where(5)
    sort(lo, less - 1)
    sort(greaterThan + 1, hi)
  }

  sort(0, values.length - 1)
  for (let at = 0; at < values.length && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'three-way quicksort', input, values, seed)
}

/** Merge sort built from the bottom up: widths of 1, then 2, then 4, with no recursion at all. */
export function bottomUpMergeSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const n = values.length
  const spare = new Array<number>(n)

  rec.where(1, { width: 1 })
  for (let width = 1; width < n && !rec.cut; width *= 2) {
    rec.where(1, { width })
    rec.step('range', `merge runs of ${width}`, [], { region: { from: 0, to: Math.max(0, n - 1), label: `width ${width}` }, vars: { width } })
    for (let lo = 0; lo < n && !rec.cut; lo += width * 2) {
      const mid = Math.min(lo + width, n)
      const hi = Math.min(lo + width * 2, n)
      let a = lo
      let b = mid
      let into = lo
      rec.where(2, { lo, into })
      rec.where(3)
      while (a < mid && b < hi && !rec.cut) {
        rec.set({ into })
        rec.step('compare', `is ${values[a]} less than or equal to ${values[b]}?`, [a, b], { values: [values[a], values[b]], vars: { lo, mid, hi, a, b } })
        spare[into] = values[a] <= values[b] ? values[a++] : values[b++]
        rec.step('write', `take ${spare[into]} into the merged run`, [into], { values: [spare[into]] })
        into += 1
      }
      while (a < mid && !rec.cut) {
        spare[into] = values[a++]
        rec.step('write', `take the rest of the left run: ${spare[into]}`, [into], { values: [spare[into]] })
        into += 1
      }
      while (b < hi && !rec.cut) {
        spare[into] = values[b++]
        rec.step('write', `take the rest of the right run: ${spare[into]}`, [into], { values: [spare[into]] })
        into += 1
      }
      for (let one = lo; one < hi && !rec.cut; one += 1) values[one] = spare[one]
    }
  }
  for (let at = 0; at < n && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'bottom-up merge sort', input, values)
}

/**
 * Timsort, simplified: find the runs that are already in order, extend short ones with insertion sort, merge them.
 *
 * The real one has galloping mode, a minimum run length computed from n, and a merge-balance invariant. This has
 * the first idea only — that real data arrives partly sorted and an algorithm that notices beats one that does not.
 * Called simplified on screen for that reason.
 */
export function timSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const n = values.length
  const MIN_RUN = 16

  const insertion = (lo: number, hi: number): void => {
    for (let at = lo + 1; at <= hi && !rec.cut; at += 1) {
      const held = values[at]
      let into = at - 1
      while (into >= lo && !rec.cut) {
        if (!greater(rec, values[into], held, [into, at], { lo, hi, i: at })) break
        rec.step('write', `shift ${values[into]} right`, [into + 1], { values: [values[into]] })
        values[into + 1] = values[into]
        into -= 1
      }
      rec.step('write', `put ${held} into position ${into + 1}`, [into + 1], { values: [held] })
      values[into + 1] = held
    }
  }

  const runs: { from: number; to: number }[] = []
  let at = 0
  rec.where(1, { minrun: MIN_RUN, runs: 0 })
  while (at < n && !rec.cut) {
    let end = at + 1
    rec.where(2, { lo: at })
    while (end < n && !rec.cut) {
      rec.step('compare', `is ${values[end]} at least ${values[end - 1]}? (still a run?)`, [end - 1, end], { values: [values[end - 1], values[end]], vars: { runFrom: at, i: end } })
      if (values[end] < values[end - 1]) break
      end += 1
    }
    let to = end - 1
    if (to - at + 1 < MIN_RUN) {
      to = Math.min(n - 1, at + MIN_RUN - 1)
      rec.where(3, { lo: at, hi: to })
      rec.step('note', `run too short \u2014 extend to ${to} with insertion sort`, [], { vars: { runFrom: at, runTo: to } })
      insertion(at, to)
    } else {
      rec.where(2, { lo: at, hi: to })
      rec.step('note', `found a natural run from ${at} to ${to}`, [], { region: { from: at, to, label: 'run' }, vars: { runFrom: at, runTo: to } })
    }
    runs.push({ from: at, to })
    rec.where(4, { runs: runs.length })
    at = to + 1
  }

  const spare = new Array<number>(n)
  while (runs.length > 1 && !rec.cut) {
    const left = runs.shift() as { from: number; to: number }
    const right = runs.shift() as { from: number; to: number }
    let a = left.from
    let b = right.from
    let into = left.from
    rec.step('range', `merge ${left.from}..${left.to} with ${right.from}..${right.to}`, [], {
      region: { from: left.from, to: right.to, label: 'merge' },
      vars: { leftFrom: left.from, rightTo: right.to }
    })
    while (a <= left.to && b <= right.to && !rec.cut) {
      rec.step('compare', `is ${values[a]} less than or equal to ${values[b]}?`, [a, b], { values: [values[a], values[b]] })
      spare[into++] = values[a] <= values[b] ? values[a++] : values[b++]
    }
    while (a <= left.to && !rec.cut) spare[into++] = values[a++]
    while (b <= right.to && !rec.cut) spare[into++] = values[b++]
    for (let one = left.from; one <= right.to && !rec.cut; one += 1) {
      values[one] = spare[one]
      rec.step('write', `merged value ${values[one]} into position ${one}`, [one], { values: [values[one]] })
    }
    runs.unshift({ from: left.from, to: right.to })
  }
  for (let one = 0; one < n && !rec.cut; one += 1) rec.step('settle', `position ${one} is in place`, [one])
  return finished(rec, 'tim sort (simplified)', input, values)
}

/**
 * Introsort: quicksort until it goes too deep, then heapsort for that part, and insertion sort for small pieces.
 *
 * This is what a standard library actually ships. The depth limit is 2·log₂(n), and when it fires the trace says so
 * — which is the only way somebody watching learns that the guarantee comes from the switch and not from quicksort.
 */
export function introSort(input: readonly number[], seed = 1, ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const n = values.length
  const limit = n > 1 ? 2 * Math.floor(Math.log2(n)) : 0
  const random = randomFrom(seed)

  const heapify = (lo: number, hi: number): void => {
    const size = hi - lo + 1
    const sift = (root: number): void => {
      while (!rec.cut) {
        let biggest = root
        const left = 2 * (root - lo) + 1 + lo
        const right = left + 1
        if (left <= hi && greater(rec, values[left], values[biggest], [left, biggest])) biggest = left
        if (right <= hi && greater(rec, values[right], values[biggest], [right, biggest])) biggest = right
        if (biggest === root) return
        swap(rec, values, root, biggest)
        root = biggest
      }
    }
    for (let one = lo + Math.floor(size / 2) - 1; one >= lo && !rec.cut; one -= 1) sift(one)
    for (let end = hi; end > lo && !rec.cut; end -= 1) {
      swap(rec, values, lo, end)
      const saved = hi
      hi = end - 1
      sift(lo)
      hi = saved
    }
  }

  const sort = (lo: number, hi: number, depth: number): void => {
    rec.where(1, { lo, hi, depth })
    if (lo >= hi || rec.cut) return
    if (hi - lo + 1 <= 16) {
      rec.where(2)
      rec.step('note', `only ${hi - lo + 1} left \u2014 insertion sort is faster here`, [], { region: { from: lo, to: hi, label: 'insertion' }, vars: { lo, hi } })
      for (let at = lo + 1; at <= hi && !rec.cut; at += 1) {
        const held = values[at]
        let into = at - 1
        while (into >= lo && !rec.cut) {
          if (!greater(rec, values[into], held, [into, at])) break
          values[into + 1] = values[into]
          rec.step('write', `shift ${values[into]} right`, [into + 1], { values: [values[into]] })
          into -= 1
        }
        values[into + 1] = held
        rec.step('write', `put ${held} into position ${into + 1}`, [into + 1], { values: [held] })
      }
      return
    }
    if (depth <= 0) {
      rec.where(3)
      rec.step('note', `recursion depth limit reached \u2014 switch to heapsort for ${lo}..${hi}`, [], {
        region: { from: lo, to: hi, label: 'heapsort' },
        vars: { lo, hi, depth }
      })
      heapify(lo, hi)
      return
    }
    const frame = rec.enter(`quicksort ${lo}..${hi} (depth left ${depth})`)
    const pivotAt = lo + Math.floor(random() * (hi - lo + 1))
    swap(rec, values, pivotAt, hi)
    const pivot = values[hi]
    rec.where(4, { pivot })
    rec.step('range', `pivot ${pivot}`, [hi], { region: { from: lo, to: hi, label: 'partition' }, values: [pivot], vars: { lo, hi, pivot, depth } })
    let wall = lo
    for (let at = lo; at < hi && !rec.cut; at += 1) {
      if (!greater(rec, values[at], pivot, [at, hi])) {
        swap(rec, values, wall, at)
        wall += 1
      }
    }
    swap(rec, values, wall, hi)
    rec.step('settle', `the pivot is in its final place at ${wall}`, [wall])
    rec.leave(frame, `${lo}..${hi} partitioned at ${wall}`)
    rec.where(5)
    sort(lo, wall - 1, depth - 1)
    rec.where(6)
    sort(wall + 1, hi, depth - 1)
  }

  sort(0, n - 1, limit)
  for (let at = 0; at < n && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'introsort', input, values, seed)
}

/** Tree sort: build a binary search tree, then read it back in order. */
export function treeSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]

  interface Node {
    value: number
    left: Node | null
    right: Node | null
  }
  let root: Node | null = null

  rec.where(1, { nodes: 0 })
  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    const value = values[at]
    rec.where(2, { value, nodes: at })
    rec.step('read', `insert ${value}`, [at], { values: [value], vars: { i: at, value } })
    if (root === null) {
      root = { value, left: null, right: null }
      rec.step('write', `${value} becomes the root`, [at], { values: [value] })
      continue
    }
    let node = root
    let depth = 0
    while (!rec.cut) {
      depth += 1
      rec.where(3, { depth })
      rec.step('compare', `is ${value} less than ${node.value}?`, [at], { values: [value, node.value], vars: { depth, at: node.value } })
      if (value < node.value) {
        if (node.left === null) {
          node.left = { value, left: null, right: null }
          rec.step('write', `${value} goes to the left of ${node.value}`, [at], { values: [value] })
          break
        }
        node = node.left
      } else {
        if (node.right === null) {
          node.right = { value, left: null, right: null }
          rec.step('write', `${value} goes to the right of ${node.value}`, [at], { values: [value] })
          break
        }
        node = node.right
      }
    }
  }

  const out: number[] = []
  const walk = (node: Node | null): void => {
    if (node === null || rec.cut) return
    rec.where(4)
    walk(node.left)
    out.push(node.value)
    rec.where(5, { read: out.length })
    rec.step('visit', `read ${node.value} out of the tree`, [out.length - 1], { values: [node.value], vars: { read: out.length } })
    walk(node.right)
  }
  walk(root)
  for (let at = 0; at < out.length && !rec.cut; at += 1) {
    values[at] = out[at]
    rec.step('write', `position ${at} takes ${out[at]}`, [at], { values: [out[at]] })
  }
  for (let at = 0; at < values.length && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'tree sort', input, values)
}

/**
 * Bitonic sort: a sorting network, so the comparisons are fixed before any value is looked at.
 *
 * Which is the point of it — the same sequence of compare-and-swap runs whatever the data, so it can be laid out in
 * hardware or run in parallel. It needs a power-of-two length, and rather than refuse, it pads with a value above
 * the maximum and drops the padding afterwards, saying so.
 */
export function bitonicSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const n = input.length
  let size = 1
  while (size < n) size *= 2
  const padding = size - n
  const biggest = n === 0 ? 0 : Math.max(...input)
  const values = [...input, ...Array.from({ length: padding }, () => biggest + 1)]
  rec.where(1, { size, padding })
  rec.where(1, { size, padding })
  if (padding > 0) {
    rec.step('note', `a sorting network needs a power of two, so ${padding} placeholder${padding === 1 ? '' : 's'} were added and will be dropped`, [], { vars: { size, padding } })
  }

  const compareAndSwap = (i: number, j: number, up: boolean): void => {
    rec.where(5, { i, partner: j })
    rec.step('compare', `network: is ${values[i]} ${up ? 'greater' : 'less'} than ${values[j]}?`, [i, j], { values: [values[i], values[j]], vars: { i, j, direction: up ? 'up' : 'down' } })
    if (up === values[i] > values[j]) swap(rec, values, i, j)
  }

  const merge = (lo: number, length: number, up: boolean): void => {
    if (length <= 1 || rec.cut) return
    const half = length / 2
    rec.where(2, { stride: half })
    for (let at = lo; at < lo + half && !rec.cut; at += 1) compareAndSwap(at, at + half, up)
    rec.where(3)
    merge(lo, half, up)
    merge(lo + half, half, up)
  }
  const sort = (lo: number, length: number, up: boolean): void => {
    if (length <= 1 || rec.cut) return
    const half = length / 2
    rec.where(1, { size: length })
    sort(lo, half, true)
    sort(lo + half, half, false)
    merge(lo, length, up)
  }
  sort(0, size, true)

  const out = values.slice(0, n)
  for (let at = 0; at < out.length && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'bitonic sort', input, out)
}

/** Bucket sort: scatter into buckets by value, sort each small bucket, concatenate. */
export function bucketSort(input: readonly number[], buckets = 10, ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const values = [...input]
  const n = values.length
  if (n === 0) return finished(rec, 'bucket sort', input, values)

  const low = Math.min(...values)
  const high = Math.max(...values)
  const count = Math.max(1, Math.min(64, Math.floor(buckets)))
  const span = (high - low) / count || 1
  rec.where(1, { filled: 0 })
  rec.step('note', `${count} buckets across ${low} to ${high}`, [], { vars: { buckets: count, low, high } })

  const pails: number[][] = Array.from({ length: count }, () => [])
  rec.where(2)
  for (let at = 0; at < n && !rec.cut; at += 1) {
    const which = Math.min(count - 1, Math.floor((values[at] - low) / span))
    rec.where(3, { value: values[at], bucket: which })
    rec.step('read', `${values[at]} goes into bucket ${which}`, [at], { values: [values[at]], vars: { i: at, bucket: which } })
    pails[which].push(values[at])
  }
  rec.set({ filled: pails.filter((one) => one.length > 0).length })

  let into = 0
  for (let which = 0; which < count && !rec.cut; which += 1) {
    const pail = pails[which]
    rec.where(4, { bucket: which })
    rec.step('range', `sort bucket ${which} (${pail.length} value${pail.length === 1 ? '' : 's'})`, [], { vars: { bucket: which, size: pail.length } })
    for (let at = 1; at < pail.length && !rec.cut; at += 1) {
      const held = pail[at]
      let one = at - 1
      while (one >= 0 && !rec.cut) {
        rec.step('compare', `is ${pail[one]} greater than ${held}?`, [], { values: [pail[one], held] })
        if (pail[one] <= held) break
        pail[one + 1] = pail[one]
        one -= 1
      }
      pail[one + 1] = held
    }
    rec.where(5)
    for (const one of pail) {
      if (rec.cut) break
      values[into] = one
      rec.step('write', `position ${into} takes ${one} from bucket ${which}`, [into], { values: [one] })
      into += 1
    }
  }
  for (let at = 0; at < n && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'bucket sort', input, values)
}

// ---------------------------------------------------------------- the two that are jokes, kept honest

/**
 * Stooge sort: sorts the first two thirds, then the last two thirds, then the first two thirds again.
 *
 * O(n^2.71). It is here because a complexity chart needs something above quadratic to have a top, and because the
 * recursion tree is a genuinely surprising shape.
 */
export function stoogeSort(input: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  if (input.length > 60) {
    return fail('too-big', `Stooge sort on ${input.length} values would take more steps than this laboratory will run.`, 'Try 60 values or fewer — its cost is about n^2.71.')
  }
  const rec = new Recorder(ceiling)
  const values = [...input]

  let deepest = 0
  const sort = (lo: number, hi: number, depth = 0): void => {
    if (rec.cut) return
    deepest = Math.max(deepest, depth)
    rec.where(1, { lo, hi, depth })
    rec.where(2)
    if (greater(rec, values[lo], values[hi], [lo, hi], { lo, hi })) swap(rec, values, lo, hi)
    rec.where(3)
    if (hi - lo + 1 > 2) {
      const third = Math.floor((hi - lo + 1) / 3)
      rec.where(4, { third })
      const frame = rec.enter(`stooge ${lo}..${hi}`)
      rec.where(5)
      sort(lo, hi - third, depth + 1)
      rec.where(6)
      sort(lo + third, hi, depth + 1)
      rec.where(7)
      sort(lo, hi - third, depth + 1)
      rec.leave(frame, `${lo}..${hi} done`)
    }
  }
  if (values.length > 1) sort(0, values.length - 1)
  for (let at = 0; at < values.length && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'stooge sort', input, values)
}

/**
 * Bogo sort: shuffle, check, repeat.
 *
 * Seeded, so "it took 40,319 shuffles" is reproducible. Refused above eight elements, because the expected number
 * of shuffles is n! and nine is already 362,880 — the ceiling would always win and the run would always be a cut
 * one, which teaches nothing.
 */
export function bogoSort(input: readonly number[], seed = 1, ceiling?: number): Run | AlgorithmError {
  const bad = check(input)
  if (bad) return bad
  if (input.length > 8) {
    return fail(
      'too-big',
      `Bogo sort on ${input.length} values would take about ${input.length}! shuffles.`,
      'Try eight values or fewer. Its expected cost is n factorial, which is the entire point of it.'
    )
  }
  const rec = new Recorder(ceiling)
  const values = [...input]
  const random = randomFrom(seed)
  let shuffles = 0

  const inOrder = (): boolean => {
    rec.where(2, { tries: shuffles })
    for (let at = 1; at < values.length; at += 1) {
      rec.where(2, { at })
      rec.step('compare', `is ${values[at - 1]} at most ${values[at]}?`, [at - 1, at], { values: [values[at - 1], values[at]], vars: { shuffles } })
      if (values[at - 1] > values[at]) return false
    }
    rec.where(4)
    return true
  }

  while (!inOrder() && !rec.cut) {
    shuffles += 1
    rec.step('note', `not in order — shuffle number ${shuffles}`, [], { vars: { shuffles } })
    for (let at = values.length - 1; at > 0 && !rec.cut; at -= 1) {
      const other = Math.floor(random() * (at + 1))
      swap(rec, values, at, other, { shuffles })
    }
  }
  if (!rec.cut) rec.step('note', `in order after ${shuffles} shuffle${shuffles === 1 ? '' : 's'}`, [], { vars: { shuffles } })
  for (let at = 0; at < values.length && !rec.cut; at += 1) rec.step('settle', `position ${at} is in place`, [at])
  return finished(rec, 'bogo sort', input, values, seed)
}
