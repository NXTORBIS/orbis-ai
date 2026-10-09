import { Recorder, fail, type AlgorithmError, type Run } from './trace.ts'

/**
 * Searching algorithms that record what they do.
 *
 * ## Binary search is the brief's own example, so it has to be exactly right
 *
 * "Why did it take three comparisons?" is answered by the trace, not by a model's guess: the three comparisons are
 * three recorded steps with the bounds at each one. Getting the bounds wrong by one would make every explanation
 * wrong, so the window is recorded at every step and `midpoint` is written the overflow-safe way.
 *
 * ## A search on unsorted input is refused, not quietly wrong
 *
 * Binary search assumes order. Given unsorted input it does not fail — it returns *not found* for a value that is
 * there, which is the worst possible outcome because it looks like an answer. So it is checked first and refused
 * with the reason.
 *
 * Pure.
 */

const MOST = 1_000_000

function check(values: readonly number[], target: number): AlgorithmError | null {
  if (!Array.isArray(values)) return fail('input', 'That is not a list of numbers.', 'Give numbers separated by commas.')
  if (values.length > MOST) return fail('too-big', 'That list is too long to search here.', `Use at most ${MOST.toLocaleString('en-GB')} values.`)
  for (const one of values) {
    if (typeof one !== 'number' || !Number.isFinite(one)) return fail('input', 'The list contains something that is not a finite number.', 'Give only numbers.')
  }
  if (typeof target !== 'number' || !Number.isFinite(target)) return fail('target', 'The value to look for is not a number.', 'Give a number to search for.')
  return null
}

export interface SearchResult {
  /** Where it was found, or -1. */
  at: number
  found: boolean
  comparisons: number
}

const finish = (rec: Recorder, name: string, values: readonly number[], target: number, at: number): Run => {
  if (!rec.cut) {
    rec.step('done', at >= 0 ? `found ${target} at position ${at}` : `${target} is not in the list`, at >= 0 ? [at] : [])
  }
  const run = rec.finish(name, { values: [...values], target }, { at, found: at >= 0, comparisons: 0 } satisfies SearchResult)
  // The comparison count comes from the recorder, so the result cannot claim a different number from the trace.
  return { ...run, result: { at, found: at >= 0, comparisons: run.counts.comparisons } satisfies SearchResult }
}

// ---------------------------------------------------------------- linear

export function linearSearch(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values, target)
  if (bad) return bad
  const rec = new Recorder(ceiling)

  rec.where(1, { target })
  rec.step('note', `look at every value in turn until ${target} turns up`, [])
  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    rec.where(2, { at })
    rec.step('compare', `is ${values[at]} equal to ${target}?`, [at], {
      values: [values[at], target],
      region: { from: at, to: values.length - 1, label: 'still to look at' }
    })
    if (values[at] === target) {
      rec.where(3)
      return finish(rec, 'linear search', values, target, at)
    }
  }
  rec.where(4)
  return finish(rec, 'linear search', values, target, -1)
}

// ---------------------------------------------------------------- binary

const sorted = (values: readonly number[]): boolean => values.every((one, at) => at === 0 || values[at - 1] <= one)

export function binarySearch(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values, target)
  if (bad) return bad
  if (!sorted(values)) {
    return fail(
      'not-sorted',
      'Binary search only works on a list that is already in order, and this one is not.',
      'Sort the list first, or use linear search, which does not care about order.'
    )
  }

  const rec = new Recorder(ceiling)
  let low = 0
  let high = values.length - 1

  rec.where(1, { lo: low, hi: high, target })
  rec.step('note', `halve the search window until ${target} is found or the window is empty`, [], {
    region: { from: 0, to: Math.max(0, values.length - 1), label: 'search window' }
  })

  while (low <= high && !rec.cut) {
    rec.where(2, { lo: low, hi: high })
    // Written this way rather than (low + high) / 2 because that overflows for large indices in languages with
    // fixed-width integers, and this is the version people should see.
    const middle = low + Math.floor((high - low) / 2)
    rec.where(3, { mid: middle })
    rec.step('read', `the middle of [${low}..${high}] is position ${middle}, holding ${values[middle]}`, [middle], {
      values: [values[middle]],
      region: { from: low, to: high, label: `window [${low}..${high}]` }
    })
    rec.where(4)
    rec.step('compare', `is ${values[middle]} equal to ${target}?`, [middle], { values: [values[middle], target] })

    if (values[middle] === target) {
      rec.where(5)
      return finish(rec, 'binary search', values, target, middle)
    }

    rec.where(6)
    if (values[middle] < target) {
      low = middle + 1
      rec.where(7, { lo: low })
      rec.step('range', `${values[middle]} is below ${target}, so look in the upper half`, [], {
        region: { from: low, to: high, label: `window [${low}..${high}]` }
      })
    } else {
      high = middle - 1
      rec.where(9, { hi: high })
      rec.step('range', `${values[middle]} is above ${target}, so look in the lower half`, [], {
        region: { from: low, to: Math.max(low, high), label: `window [${low}..${Math.max(low, high)}]` }
      })
    }
  }
  rec.where(10)
  if (!rec.cut) rec.step('note', 'the window is empty, so the value is not there', [])
  return finish(rec, 'binary search', values, target, -1)
}

/**
 * Interpolation search.
 *
 * Guesses where the value should be from how far along the range it falls, rather than always taking the middle. On
 * evenly spread data it beats binary search; on clustered data it is worse. Both are visible in the step counts,
 * which is the reason it is here.
 */
export function interpolationSearch(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values, target)
  if (bad) return bad
  if (!sorted(values)) {
    return fail('not-sorted', 'Interpolation search needs a list in order, and this one is not.', 'Sort it first, or use linear search.')
  }

  const rec = new Recorder(ceiling)
  let low = 0
  let high = values.length - 1

  rec.where(1, { lo: low, hi: high })
  rec.step('note', 'guess where the value should be from how far along the range it falls', [])
  while (low <= high && target >= values[low] && target <= values[high] && !rec.cut) {
    let guess: number
    if (values[high] === values[low]) {
      // Every value in the window is the same, so the formula would divide by zero. The honest guess is the edge.
      guess = low
      rec.step('note', `every value from ${low} to ${high} is ${values[low]}, so there is nothing to interpolate`, [low, high])
    } else {
      const share = (target - values[low]) / (values[high] - values[low])
      guess = low + Math.floor(share * (high - low))
      rec.where(3, { lo: low, hi: high, guess })
      rec.step('read', `${target} is ${(share * 100).toFixed(1)}% of the way through [${values[low]}..${values[high]}], so try ${guess}`, [guess], {
        values: [values[guess]],
        region: { from: low, to: high, label: `window [${low}..${high}]` }
      })
    }

    rec.where(4)
    rec.step('compare', `is ${values[guess]} equal to ${target}?`, [guess], { values: [values[guess], target] })
    if (values[guess] === target) return finish(rec, 'interpolation search', values, target, guess)
    if (values[guess] < target) {
      low = guess + 1
      rec.where(5, { lo: low })
      rec.step('range', `too low, so look above ${guess}`, [], { region: { from: low, to: high, label: `window [${low}..${high}]` } })
    } else {
      high = guess - 1
      rec.where(6, { hi: high })
      rec.step('range', `too high, so look below ${guess}`, [], { region: { from: low, to: Math.max(low, high), label: `window` } })
    }
  }
  if (!rec.cut) rec.step('note', `${target} is outside the range of the remaining window`, [])
  return finish(rec, 'interpolation search', values, target, -1)
}

/**
 * Jump search.
 *
 * Steps forward in blocks of about √n, then walks back through the last block. Included because it is the clearest
 * demonstration that there is a middle ground between looking at everything and halving.
 */
export function jumpSearch(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values, target)
  if (bad) return bad
  if (!sorted(values)) return fail('not-sorted', 'Jump search needs a list in order.', 'Sort it first, or use linear search.')
  if (values.length === 0) return finish(new Recorder(ceiling), 'jump search', values, target, -1)

  const rec = new Recorder(ceiling)
  const stride = Math.max(1, Math.floor(Math.sqrt(values.length)))
  rec.where(1, { step: stride })
  rec.step('note', `jump forward ${stride} at a time \u2014 about the square root of ${values.length}`, [])

  let at = 0
  let previous = 0
  rec.where(2, { at })
  while (at < values.length && !rec.cut) {
    rec.where(2, { at })
    rec.step('compare', `is ${values[Math.min(at, values.length - 1)]} below ${target}?`, [Math.min(at, values.length - 1)], {
      values: [values[Math.min(at, values.length - 1)], target],
      region: { from: previous, to: Math.min(at, values.length - 1), label: 'current block' }
    })
    if (values[Math.min(at, values.length - 1)] >= target) break
    previous = at
    at += stride
    rec.count('jumps')
  }

  rec.where(3, { at: previous })
  rec.step('range', `walk back through the block from ${previous}`, [], {
    region: { from: previous, to: Math.min(at, values.length - 1), label: 'block to walk' }
  })
  for (let look = previous; look <= Math.min(at, values.length - 1) && !rec.cut; look += 1) {
    rec.where(3, { at: look })
    rec.step('compare', `is ${values[look]} equal to ${target}?`, [look], { values: [values[look], target] })
    if (values[look] === target) {
      rec.where(4)
      return finish(rec, 'jump search', values, target, look)
    }
  }
  rec.where(5)
  return finish(rec, 'jump search', values, target, -1)
}


/**
 * Exponential search.
 *
 * Double a bound until it passes the target, then binary search the block that was just passed. Its point is the
 * unbounded case: it finds the range in log(position) comparisons without ever being told how long the list is,
 * which is why it is the right search over a stream or a very large index.
 */
export function exponentialSearch(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values, target)
  if (bad) return bad
  if (!sorted(values)) return fail('not-sorted', 'Exponential search needs a list in order.', 'Sort it first, or use linear search.')
  if (values.length === 0) return finish(new Recorder(ceiling), 'exponential search', values, target, -1)

  const rec = new Recorder(ceiling)
  rec.where(1, { bound: 1, target })
  rec.step('compare', `is the first value ${values[0]} the one?`, [0], { values: [values[0], target] })
  if (values[0] === target) return finish(rec, 'exponential search', values, target, 0)

  let bound = 1
  rec.where(2)
  while (bound < values.length && values[bound] < target && !rec.cut) {
    rec.where(3, { bound })
    rec.step('compare', `is ${values[bound]} at position ${bound} still below ${target}?`, [bound], {
      values: [values[bound], target],
      region: { from: 0, to: bound, label: `bound ${bound}` }
    })
    bound *= 2
    rec.count('doublings')
  }

  const low = Math.floor(bound / 2)
  const high = Math.min(bound, values.length - 1)
  rec.where(4, { lo: low, hi: high })
  rec.step('range', `${target} is somewhere in [${low}..${high}] \u2014 now binary search that`, [], {
    region: { from: low, to: high, label: `block [${low}..${high}]` }
  })

  let lo = low
  let hi = high
  while (lo <= hi && !rec.cut) {
    const middle = lo + Math.floor((hi - lo) / 2)
    rec.where(5, { lo, hi, mid: middle })
    rec.step('compare', `is ${values[middle]} equal to ${target}?`, [middle], { values: [values[middle], target] })
    if (values[middle] === target) return finish(rec, 'exponential search', values, target, middle)
    if (values[middle] < target) {
      lo = middle + 1
      rec.where(6, { lo })
    } else {
      hi = middle - 1
      rec.where(6, { hi })
    }
  }
  if (!rec.cut) rec.step('note', `${target} is not in the block the doubling found, so it is not in the list`, [])
  return finish(rec, 'exponential search', values, target, -1)
}

/**
 * Fibonacci search.
 *
 * Divides the list by Fibonacci numbers rather than in half. The division is done with addition and subtraction
 * alone \u2014 no division, no midpoint \u2014 which is why it was used on machines where dividing was expensive, and why
 * it touches memory in a friendlier pattern than binary search on very large arrays.
 */
export function fibonacciSearch(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values, target)
  if (bad) return bad
  if (!sorted(values)) return fail('not-sorted', 'Fibonacci search needs a list in order.', 'Sort it first, or use linear search.')
  if (values.length === 0) return finish(new Recorder(ceiling), 'fibonacci search', values, target, -1)

  const rec = new Recorder(ceiling)
  // The smallest Fibonacci number at or above the length. Built by addition, which is the whole point.
  let back2 = 0
  let back1 = 1
  let fib = back2 + back1
  rec.where(1, { fib, target })
  while (fib < values.length && !rec.cut) {
    back2 = back1
    back1 = fib
    fib = back2 + back1
    rec.count('fibonacciSteps')
  }
  rec.step('note', `the first Fibonacci number at or above ${values.length} is ${fib}`, [])

  let offset = -1
  rec.where(2, { offset })
  while (fib > 1 && !rec.cut) {
    const at = Math.min(offset + back2, values.length - 1)
    rec.where(3, { at, fib })
    rec.step('compare', `is ${values[at]} equal to ${target}?`, [at], {
      values: [values[at], target],
      region: { from: Math.max(0, offset + 1), to: values.length - 1, label: 'still to search' }
    })
    if (values[at] === target) return finish(rec, 'fibonacci search', values, target, at)
    if (values[at] < target) {
      // Cut the front off: move the window forward and step the Fibonacci numbers down by one.
      fib = back1
      back1 = back2
      back2 = fib - back1
      offset = at
      rec.where(4, { offset, fib })
    } else {
      // Cut the back off: step down by two.
      fib = back2
      back1 = back1 - back2
      back2 = fib - back1
      rec.where(5, { fib })
    }
  }
  rec.where(6)
  if (back1 === 1 && offset + 1 < values.length && !rec.cut) {
    rec.step('compare', `one value is left: is ${values[offset + 1]} equal to ${target}?`, [offset + 1], {
      values: [values[offset + 1], target]
    })
    if (values[offset + 1] === target) return finish(rec, 'fibonacci search', values, target, offset + 1)
  }
  return finish(rec, 'fibonacci search', values, target, -1)
}

/**
 * Ternary search.
 *
 * Cuts the window into three rather than two. It is the clearest demonstration that cutting into more pieces is not
 * automatically better: it makes about 1.26 times as many comparisons as binary search on the same list, because
 * each round costs two comparisons to remove only two thirds.
 */
export function ternarySearch(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values, target)
  if (bad) return bad
  if (!sorted(values)) return fail('not-sorted', 'Ternary search needs a list in order.', 'Sort it first, or use linear search.')

  const rec = new Recorder(ceiling)
  let low = 0
  let high = values.length - 1
  rec.where(1, { lo: low, hi: high, target })

  while (low <= high && !rec.cut) {
    const third = Math.floor((high - low) / 3)
    const first = low + third
    const second = high - third
    rec.where(2, { lo: low, hi: high, first, second })
    rec.step('range', `cut [${low}..${high}] at ${first} and ${second}`, [first, second], {
      region: { from: low, to: high, label: `window [${low}..${high}]` }
    })

    rec.where(3)
    rec.step('compare', `is ${values[first]} equal to ${target}?`, [first], { values: [values[first], target] })
    if (values[first] === target) return finish(rec, 'ternary search', values, target, first)

    rec.where(4)
    rec.step('compare', `is ${values[second]} equal to ${target}?`, [second], { values: [values[second], target] })
    if (values[second] === target) return finish(rec, 'ternary search', values, target, second)

    if (target < values[first]) {
      high = first - 1
      rec.where(5, { hi: high })
    } else if (target > values[second]) {
      low = second + 1
      rec.where(6, { lo: low })
    } else {
      low = first + 1
      high = second - 1
      rec.where(7, { lo: low, hi: high })
    }
  }
  rec.where(8)
  if (!rec.cut) rec.step('note', 'the window is empty, so the value is not there', [])
  return finish(rec, 'ternary search', values, target, -1)
}

// ---------------------------------------------------------------- the registry

export type SearchName = 'linear' | 'binary' | 'interpolation' | 'jump' | 'exponential' | 'fibonacci-search' | 'ternary'

export const SEARCH_NAMES: readonly SearchName[] = Object.freeze([
  'linear',
  'binary',
  'interpolation',
  'jump',
  'exponential',
  'fibonacci-search',
  'ternary'
])

export function runSearch(name: SearchName, values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  switch (name) {
    case 'linear':
      return linearSearch(values, target, ceiling)
    case 'binary':
      return binarySearch(values, target, ceiling)
    case 'interpolation':
      return interpolationSearch(values, target, ceiling)
    case 'jump':
      return jumpSearch(values, target, ceiling)
    case 'exponential':
      return exponentialSearch(values, target, ceiling)
    case 'fibonacci-search':
      return fibonacciSearch(values, target, ceiling)
    case 'ternary':
      return ternarySearch(values, target, ceiling)
    default:
      return fail('unknown', `There is no search called "${String(name)}".`, `Choose one of: ${SEARCH_NAMES.join(', ')}.`)
  }
}
