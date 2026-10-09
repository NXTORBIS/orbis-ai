import { Recorder, fail, type AlgorithmError, type Run } from './trace.ts'

/**
 * The techniques that work on a plain array, and the three structures built from one.
 *
 * ## Why these belong beside the sorts
 *
 * Sorting is what an algorithm course opens with and almost none of what it is about. The real content is here: a
 * sliding window that turns an O(n·k) scan into one pass, two pointers that need the array sorted and say so, a
 * prefix sum that answers any range in one subtraction, and Boyer-Moore voting, which finds a majority in one pass
 * and *cannot* be believed without watching the counter.
 *
 * Each one records the window, the pointers or the running total at every step, so the thing that makes it clever
 * is the thing on screen rather than a sentence underneath.
 *
 * ## The structures record their shape, not just their contents
 *
 * A stack that printed its array would be an array. Every step here carries the structure as it stood — the stack's
 * depth, the queue's head and tail with the wrap, the list's links — because the shape is the lesson.
 *
 * Pure. No clock; the one randomised algorithm takes a seed and reports it.
 */

const MOST = 2_000

function check(values: readonly number[]): AlgorithmError | null {
  if (!Array.isArray(values)) return fail('input', 'That is not a list of numbers.', 'Give numbers separated by commas.')
  if (values.length === 0) return fail('empty', 'The list is empty.', 'Give at least one number.')
  if (values.length > MOST) return fail('too-big', `${values.length} values is more than this traces.`, `Use at most ${MOST}.`)
  for (const one of values) {
    if (typeof one !== 'number' || !Number.isFinite(one)) return fail('input', 'The list has something in it that is not a finite number.', 'Give only numbers.')
  }
  return null
}

// ---------------------------------------------------------------- arrays

/** Walk the array once, reading each value. The baseline every other technique is measured against. */
export function traversal(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  let total = 0
  rec.where(1, { n: values.length, total: 0 })
  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    total += values[at]
    rec.where(2, { at, value: values[at], total })
    rec.step('read', `A[${at}] is ${values[at]}; the running total is ${total}`, [at], { values: [values[at]] })
  }
  rec.where(3, { total })
  if (!rec.cut) rec.step('done', `every value read once, and they add to ${total}`, [])
  return rec.finish('array traversal', { values: [...values] }, { total, reads: values.length })
}

/** Swap from both ends towards the middle. Half as many swaps as moving everything, which the count shows. */
export function reversal(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const a = [...values]
  let left = 0
  let right = a.length - 1
  rec.where(1, { left, right })
  while (left < right && !rec.cut) {
    rec.where(2, { left, right })
    rec.step('compare', `swap the ends: A[${left}]=${a[left]} and A[${right}]=${a[right]}`, [left, right], { values: [a[left], a[right]] })
    ;[a[left], a[right]] = [a[right], a[left]]
    rec.step('swap', `A[${left}] and A[${right}] exchanged`, [left, right])
    left += 1
    right -= 1
    rec.where(3, { left, right })
  }
  if (!rec.cut) rec.step('done', `reversed in ${Math.floor(values.length / 2)} swaps, not ${values.length}`, [])
  return rec.finish('array reversal', { values: [...values] }, { reversed: a, swaps: Math.floor(values.length / 2) })
}

/**
 * Rotate left by k, by reversing three times.
 *
 * Reverse the whole thing, then reverse each part. It is the trick that does the job with no extra array at all,
 * and the three reversals on screen are the only way it stops looking like magic.
 */
export function rotation(values: readonly number[], by: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const a = [...values]
  const n = a.length
  const k = ((Math.trunc(by) % n) + n) % n

  const reverse = (from: number, to: number, why: string): void => {
    rec.step('range', why, [], { region: { from, to, label: why } })
    let left = from
    let right = to
    while (left < right && !rec.cut) {
      ;[a[left], a[right]] = [a[right], a[left]]
      rec.step('swap', `A[${left}] ↔ A[${right}]`, [left, right])
      left += 1
      right -= 1
    }
  }

  rec.where(1, { n, k })
  if (k === 0) {
    rec.step('note', `rotating by ${by} on ${n} values is no rotation at all`, [])
    return rec.finish('array rotation', { values: [...values], by }, { rotated: a, k })
  }
  rec.where(2, { k })
  reverse(0, k - 1, `reverse the first ${k}`)
  rec.where(3)
  reverse(k, n - 1, `reverse the remaining ${n - k}`)
  rec.where(4)
  reverse(0, n - 1, 'reverse the whole array')
  if (!rec.cut) rec.step('done', `rotated left by ${k} using three reversals and no second array`, [])
  return rec.finish('array rotation', { values: [...values], by }, { rotated: a, k })
}

/** Running totals, so any range sums in one subtraction afterwards. */
export function prefixSum(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const sums = new Array<number>(values.length + 1).fill(0)
  rec.where(1, { n: values.length })
  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    sums[at + 1] = sums[at] + values[at]
    rec.where(2, { at, running: sums[at + 1] })
    rec.step('write', `P[${at + 1}] = P[${at}] + A[${at}] = ${sums[at]} + ${values[at]} = ${sums[at + 1]}`, [at], { values: [sums[at + 1]] })
  }
  rec.where(3)
  if (!rec.cut) {
    const from = Math.floor(values.length / 4)
    const to = Math.floor((values.length * 3) / 4)
    rec.step('done', `built in one pass. Any range now costs one subtraction: A[${from}..${to}] = P[${to + 1}] − P[${from}] = ${sums[to + 1] - sums[from]}`, [])
  }
  return rec.finish('prefix sum', { values: [...values] }, { prefix: sums })
}

/** The largest sum of any run. One pass, and the only state is two numbers. */
export function kadane(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  let best = values[0]
  let here = values[0]
  let bestFrom = 0
  let bestTo = 0
  let from = 0
  rec.where(1, { best, here })
  rec.step('note', `start with A[0] = ${values[0]} as both the best run and the run ending here`, [0])

  for (let at = 1; at < values.length && !rec.cut; at += 1) {
    rec.where(2, { at, value: values[at] })
    // The whole algorithm: either extend the run, or start again here. Whichever is larger.
    if (here + values[at] < values[at]) {
      here = values[at]
      from = at
      rec.where(3, { here, from })
      rec.step('update', `${here - values[at]} + ${values[at]} is worse than starting again, so the run restarts at ${at}`, [at], { values: [here] })
    } else {
      here += values[at]
      rec.where(4, { here })
      rec.step('update', `extend the run: it now sums to ${here}`, [at], { values: [here], region: { from, to: at, label: 'run ending here' } })
    }
    if (here > best) {
      best = here
      bestFrom = from
      bestTo = at
      rec.where(5, { best })
      rec.step('visit', `that is the best run so far: A[${bestFrom}..${bestTo}] = ${best}`, [at], { region: { from: bestFrom, to: bestTo, label: 'best so far' } })
    }
  }
  rec.where(6, { best })
  if (!rec.cut) rec.step('done', `the largest run is A[${bestFrom}..${bestTo}], summing to ${best}`, [], { region: { from: bestFrom, to: bestTo, label: 'answer' } })
  return rec.finish("Kadane's algorithm", { values: [...values] }, { best, from: bestFrom, to: bestTo })
}

/** Two pointers closing in, for a pair that sums to the target. Needs the array sorted, and refuses otherwise. */
export function twoPointer(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  if (!values.every((one, at) => at === 0 || values[at - 1] <= one)) {
    return fail(
      'not-sorted',
      'Two pointers only work on a sorted array, and this one is not sorted.',
      'Sort it first — or use the hash method, which does not care about order.'
    )
  }
  const rec = new Recorder(ceiling)
  let left = 0
  let right = values.length - 1
  rec.where(1, { left, right, target })

  while (left < right && !rec.cut) {
    const sum = values[left] + values[right]
    rec.where(2, { left, right, sum })
    rec.step('compare', `A[${left}]=${values[left]} + A[${right}]=${values[right]} = ${sum}`, [left, right], {
      values: [values[left], values[right]],
      region: { from: left, to: right, label: 'still to search' }
    })
    if (sum === target) {
      rec.where(3)
      rec.step('visit', `${sum} is the target: positions ${left} and ${right}`, [left, right])
      return rec.finish('two pointers', { values: [...values], target }, { found: true, at: [left, right] })
    }
    if (sum < target) {
      left += 1
      rec.where(4, { left })
      rec.step('note', `${sum} is below ${target}, so the only way up is a larger left value`, [left])
    } else {
      right -= 1
      rec.where(5, { right })
      rec.step('note', `${sum} is above ${target}, so the only way down is a smaller right value`, [right])
    }
  }
  rec.where(6)
  if (!rec.cut) rec.step('done', `no pair sums to ${target}`, [])
  return rec.finish('two pointers', { values: [...values], target }, { found: false, at: [] })
}

/** The largest sum of any k in a row, by sliding rather than re-adding. */
export function slidingWindow(values: readonly number[], size: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const k = Math.trunc(size)
  if (!(k >= 1 && k <= values.length)) {
    return fail('input', `A window of ${size} does not fit in ${values.length} values.`, `Use a size between 1 and ${values.length}.`)
  }
  const rec = new Recorder(ceiling)
  let sum = 0
  rec.where(1, { k })
  for (let at = 0; at < k && !rec.cut; at += 1) {
    sum += values[at]
    rec.step('read', `A[${at}] = ${values[at]} joins the first window; it sums to ${sum}`, [at], { values: [values[at]] })
  }
  let best = sum
  let bestAt = 0
  rec.where(2, { sum, best })
  rec.step('range', `the first window sums to ${sum}`, [], { region: { from: 0, to: k - 1, label: 'window' } })

  for (let at = k; at < values.length && !rec.cut; at += 1) {
    // The whole point: one addition and one subtraction, however large the window is.
    sum += values[at] - values[at - k]
    rec.where(3, { at, sum })
    rec.step('update', `slide: add A[${at}]=${values[at]}, drop A[${at - k}]=${values[at - k]} → ${sum}`, [at, at - k], {
      values: [values[at], values[at - k]],
      region: { from: at - k + 1, to: at, label: 'window' }
    })
    if (sum > best) {
      best = sum
      bestAt = at - k + 1
      rec.where(4, { best })
      rec.step('visit', `the best window so far starts at ${bestAt} and sums to ${best}`, [], { region: { from: bestAt, to: at, label: 'best' } })
    }
  }
  rec.where(5, { best })
  if (!rec.cut) {
    rec.step('done', `best is ${best}, at position ${bestAt}. It took ${values.length} additions, not ${(values.length - k + 1) * k}`, [], {
      region: { from: bestAt, to: bestAt + k - 1, label: 'answer' }
    })
  }
  return rec.finish('sliding window', { values: [...values], size: k }, { best, at: bestAt })
}

/** Sort three kinds in one pass with three pointers. The partition at the heart of three-way quicksort. */
export function dutchFlag(values: readonly number[], middle: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const a = [...values]
  let low = 0
  let at = 0
  let high = a.length - 1
  rec.where(1, { low, at, high, pivot: middle })

  while (at <= high && !rec.cut) {
    rec.where(2, { at, low, high })
    rec.step('compare', `A[${at}]=${a[at]} against ${middle}`, [at], { values: [a[at], middle] })
    if (a[at] < middle) {
      ;[a[low], a[at]] = [a[at], a[low]]
      rec.where(3, { low: low + 1, at: at + 1 })
      rec.step('swap', `below — send it to the front`, [low, at])
      low += 1
      at += 1
    } else if (a[at] > middle) {
      ;[a[at], a[high]] = [a[high], a[at]]
      rec.where(4, { high: high - 1 })
      // `at` does not move: what came back from the far end has not been looked at yet.
      rec.step('swap', `above — send it to the back. The pointer stays, because what arrived is unseen`, [at, high])
      high -= 1
    } else {
      rec.where(5, { at: at + 1 })
      rec.step('note', `equal — leave it and move on`, [at])
      at += 1
    }
  }
  rec.where(6)
  if (!rec.cut) rec.step('done', `three groups in one pass: below, equal, above`, [])
  return rec.finish('Dutch national flag', { values: [...values], middle }, { arranged: a, low, high })
}

/** Move every zero to the end, keeping the rest in order. One write per non-zero. */
export function moveZeros(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const a = [...values]
  let into = 0
  rec.where(1, { into })
  for (let at = 0; at < a.length && !rec.cut; at += 1) {
    rec.where(2, { at, value: a[at] })
    rec.step('compare', `A[${at}] = ${a[at]}`, [at], { values: [a[at]] })
    if (a[at] !== 0) {
      if (into !== at) {
        ;[a[into], a[at]] = [a[at], a[into]]
        rec.step('swap', `not zero — move it to position ${into}`, [into, at])
      }
      into += 1
      rec.where(3, { into })
    }
  }
  rec.where(4)
  if (!rec.cut) rec.step('done', `${a.length - into} zero${a.length - into === 1 ? '' : 's'} at the end, the rest in their original order`, [])
  return rec.finish('move zeros', { values: [...values] }, { arranged: a, zeros: a.length - into })
}

/** Remove repeats from a sorted array in place. Needs it sorted and says so. */
export function removeDuplicates(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  if (!values.every((one, at) => at === 0 || values[at - 1] <= one)) {
    return fail('not-sorted', 'This only works on a sorted array, where repeats are next to each other.', 'Sort it first.')
  }
  const rec = new Recorder(ceiling)
  const a = [...values]
  let into = 1
  rec.where(1, { into })
  for (let at = 1; at < a.length && !rec.cut; at += 1) {
    rec.where(2, { at })
    rec.step('compare', `A[${at}]=${a[at]} against the last kept, A[${into - 1}]=${a[into - 1]}`, [at, into - 1], { values: [a[at], a[into - 1]] })
    if (a[at] !== a[into - 1]) {
      a[into] = a[at]
      rec.where(3, { into: into + 1 })
      rec.step('write', `new value — keep it at ${into}`, [into], { values: [a[at]] })
      into += 1
    } else {
      rec.step('note', `the same as the last kept, so skip it`, [at])
    }
  }
  rec.where(4, { kept: into })
  if (!rec.cut) rec.step('done', `${into} different value${into === 1 ? '' : 's'} of ${a.length}`, [], { region: { from: 0, to: into - 1, label: 'kept' } })
  return rec.finish('remove duplicates', { values: [...values] }, { kept: a.slice(0, into), count: into })
}

/** A pair summing to the target, using a map. One pass, and order does not matter. */
export function twoSum(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const seen = new Map<number, number>()
  rec.where(1, { target, stored: 0 })
  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    const wanted = target - values[at]
    rec.where(2, { at, value: values[at], wanted })
    rec.step('compare', `A[${at}]=${values[at]}, so look for ${wanted}`, [at], { values: [values[at], wanted] })
    if (seen.has(wanted)) {
      const other = seen.get(wanted) as number
      rec.where(3)
      rec.step('visit', `${wanted} was already seen at position ${other}`, [other, at])
      return rec.finish('two sum', { values: [...values], target }, { found: true, at: [other, at] })
    }
    seen.set(values[at], at)
    rec.where(4, { stored: seen.size })
    rec.step('write', `remember ${values[at]} at position ${at}`, [at], { values: [values[at]] })
  }
  rec.where(5)
  if (!rec.cut) rec.step('done', `nothing sums to ${target}. One pass, and the order never mattered`, [])
  return rec.finish('two sum', { values: [...values], target }, { found: false, at: [] })
}

/** The one number missing from 0..n, by arithmetic rather than by searching. */
export function missingNumber(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const n = values.length
  const should = (n * (n + 1)) / 2
  rec.where(1, { n, should })
  rec.step('note', `0 to ${n} adds to ${should}. Whatever the array adds to, the difference is the missing one`, [])
  let total = 0
  for (let at = 0; at < n && !rec.cut; at += 1) {
    total += values[at]
    rec.where(2, { at, total })
    rec.step('read', `+ ${values[at]} → ${total}`, [at], { values: [values[at]] })
  }
  rec.where(3, { missing: should - total })
  if (!rec.cut) rec.step('done', `${should} − ${total} = ${should - total}`, [])
  return rec.finish('missing number', { values: [...values] }, { missing: should - total })
}

/**
 * Boyer-Moore voting: find a value that occurs more than half the time, with one counter.
 *
 * It looks wrong, which is why it is worth watching: the candidate changes to whatever is in front of it whenever
 * the count hits zero, and it still comes out right — because a true majority cannot be cancelled out.
 */
export function majorityElement(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  let candidate = values[0]
  let count = 0
  rec.where(1, { candidate, count })

  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    rec.where(2, { at, value: values[at] })
    if (count === 0) {
      candidate = values[at]
      count = 1
      rec.where(3, { candidate, count })
      rec.step('update', `the count is zero, so ${values[at]} becomes the candidate`, [at], { values: [values[at]] })
    } else if (values[at] === candidate) {
      count += 1
      rec.where(4, { count })
      rec.step('compare', `${values[at]} agrees — the count is ${count}`, [at], { values: [values[at]] })
    } else {
      count -= 1
      rec.where(5, { count })
      rec.step('compare', `${values[at]} disagrees — the count falls to ${count}`, [at], { values: [values[at]] })
    }
  }

  // The vote finds a candidate; only a second pass proves it. Skipping this check is the usual mistake.
  let actual = 0
  rec.where(6, { candidate })
  for (let at = 0; at < values.length && !rec.cut; at += 1) if (values[at] === candidate) actual += 1
  const isMajority = actual > values.length / 2
  rec.where(7, { seen: actual })
  if (!rec.cut) {
    rec.step(
      'done',
      isMajority
        ? `${candidate} appears ${actual} times out of ${values.length}, which is a majority`
        : `${candidate} survived the vote but appears only ${actual} times of ${values.length}, so there is no majority at all`,
      []
    )
  }
  return rec.finish('majority element', { values: [...values] }, { candidate, count: actual, isMajority })
}

// ---------------------------------------------------------------- linked lists

/** A node of the list, as a position in an array of links. Drawn as links, never as an array. */
export interface ListNode {
  value: number
  next: number | null
}

const asList = (values: readonly number[], cycleAt: number | null = null): ListNode[] =>
  values.map((value, at) => ({ value, next: at === values.length - 1 ? cycleAt : at + 1 }))

/** Reverse the links. Three pointers, and the order they move in is the whole difficulty. */
export function listReverse(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const nodes = asList(values)
  let previous: number | null = null
  let current: number | null = 0

  rec.where(1, { previous: 'null', current: 0 })
  rec.step('note', `${values.length} nodes, each pointing at the next`, [0], { extra: { links: nodes.map((one) => one.next ?? -1) } })

  while (current !== null && !rec.cut) {
    const after: number | null = nodes[current].next
    rec.where(2, { current, after: after ?? 'null' })
    rec.step('read', `remember what comes after node ${current} (${nodes[current].value}) before the link is broken`, [current], { values: [nodes[current].value] })
    nodes[current].next = previous
    rec.where(3)
    rec.step('write', `point node ${current} backwards${previous === null ? ' at nothing — it is the new end' : ` at node ${previous}`}`, [current], {
      extra: { links: nodes.map((one) => one.next ?? -1) }
    })
    previous = current
    current = after
    rec.where(4, { previous, current: current ?? 'null' })
  }
  rec.where(5)
  if (!rec.cut) rec.step('done', `the head is now node ${previous}, holding ${nodes[previous as number].value}`, [previous as number])
  return rec.finish('reverse a linked list', { values: [...values] }, { head: previous, links: nodes.map((one) => one.next) })
}

/** The middle, by one pointer moving twice as fast as the other. One pass, no counting. */
export function listMiddle(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const nodes = asList(values)
  let slow = 0
  let fast: number | null = 0
  rec.where(1, { slow, fast })

  while (fast !== null && nodes[fast].next !== null && !rec.cut) {
    slow = nodes[slow].next as number
    fast = nodes[nodes[fast].next as number].next
    rec.where(2, { slow, fast: fast ?? 'past the end' })
    rec.step('visit', `slow is at node ${slow} (${nodes[slow].value}); fast is ${fast === null ? 'past the end' : `at node ${fast} (${nodes[fast].value})`}`, [slow, ...(fast === null ? [] : [fast])])
  }
  rec.where(3, { middle: slow })
  if (!rec.cut) rec.step('done', `when fast reaches the end, slow is exactly half way: node ${slow}, holding ${nodes[slow].value}`, [slow])
  return rec.finish('find the middle', { values: [...values] }, { middle: slow, value: nodes[slow].value })
}

/**
 * Floyd's cycle detection: two pointers at different speeds must meet inside a loop.
 *
 * `cycleAt` makes the last node point back at that position. With no cycle, fast simply runs off the end — and
 * that difference is the entire test.
 */
export function listCycle(values: readonly number[], cycleAt: number | null, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  if (cycleAt !== null && (cycleAt < 0 || cycleAt >= values.length)) {
    return fail('input', `There is no node ${cycleAt} to loop back to.`, `Use a position from 0 to ${values.length - 1}, or none for no cycle.`)
  }
  const rec = new Recorder(ceiling)
  const nodes = asList(values, cycleAt)
  let slow: number | null = 0
  let fast: number | null = 0
  rec.where(1, { slow, fast })
  rec.step('note', cycleAt === null ? 'the list ends' : `the last node points back at node ${cycleAt}`, [], { extra: { links: nodes.map((one) => one.next ?? -1) } })

  let steps = 0
  while (fast !== null && nodes[fast].next !== null && !rec.cut) {
    slow = nodes[slow as number].next
    fast = nodes[nodes[fast].next as number].next
    steps += 1
    rec.where(2, { slow: slow ?? 'null', fast: fast ?? 'null', steps })
    rec.step('visit', `slow at ${slow}, fast at ${fast === null ? 'the end' : fast}`, [...(slow === null ? [] : [slow]), ...(fast === null ? [] : [fast])])
    if (slow !== null && slow === fast) {
      rec.where(3)
      rec.step('done', `they met at node ${slow} after ${steps} steps, so there is a loop. Two pointers at different speeds can only meet inside one`, [slow])
      return rec.finish('detect a cycle', { values: [...values], cycleAt }, { hasCycle: true, metAt: slow, steps })
    }
  }
  rec.where(4)
  if (!rec.cut) rec.step('done', 'fast ran off the end, so there is no loop', [])
  return rec.finish('detect a cycle', { values: [...values], cycleAt }, { hasCycle: false, metAt: null, steps })
}

/** Walk the links looking for a value. There is no shortcut: a list cannot be binary searched. */
export function listSearch(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const nodes = asList(values)
  let at: number | null = 0
  rec.where(1, { target })
  while (at !== null && !rec.cut) {
    rec.where(2, { at, value: nodes[at].value })
    rec.step('compare', `node ${at} holds ${nodes[at].value}`, [at], { values: [nodes[at].value, target] })
    if (nodes[at].value === target) {
      rec.where(3)
      rec.step('visit', `found at node ${at}`, [at])
      return rec.finish('search a linked list', { values: [...values], target }, { found: true, at })
    }
    at = nodes[at].next
    rec.where(4, { at: at ?? 'the end' })
  }
  rec.where(5)
  if (!rec.cut) rec.step('done', `${target} is not in the list. Every node had to be looked at, because a list cannot be halved`, [])
  return rec.finish('search a linked list', { values: [...values], target }, { found: false, at: -1 })
}

// ---------------------------------------------------------------- stacks

/** Brackets matched with a stack. The depth at each step is the picture. */
export function balancedParentheses(text: string, ceiling?: number): Run | AlgorithmError {
  if (typeof text !== 'string' || text.length === 0) return fail('input', 'There is nothing to check.', 'Type something with brackets in it.')
  if (text.length > MOST) return fail('too-big', `${text.length} characters is more than this traces.`, `Use at most ${MOST}.`)
  const rec = new Recorder(ceiling)
  const PAIRS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' }
  const stack: string[] = []
  rec.where(1, { depth: 0 })

  for (let at = 0; at < text.length && !rec.cut; at += 1) {
    const here = text[at]
    if ('([{'.includes(here)) {
      stack.push(here)
      rec.where(2, { at, depth: stack.length })
      rec.step('push', `"${here}" opens — push it, depth is now ${stack.length}`, [at], { extra: { stack: [...stack] } })
      continue
    }
    if (here in PAIRS) {
      rec.where(3, { at, depth: stack.length })
      if (stack.length === 0) {
        rec.step('note', `"${here}" closes nothing — there is no opening bracket left`, [at])
        return rec.finish('balanced brackets', { text }, { balanced: false, failedAt: at, why: 'a closing bracket with nothing open' })
      }
      const top = stack.pop() as string
      rec.where(4, { depth: stack.length })
      if (top !== PAIRS[here]) {
        rec.step('pop', `"${here}" does not close "${top}"`, [at], { extra: { stack: [...stack] } })
        return rec.finish('balanced brackets', { text }, { balanced: false, failedAt: at, why: `"${here}" does not match "${top}"` })
      }
      rec.step('pop', `"${here}" closes "${top}" — depth is now ${stack.length}`, [at], { extra: { stack: [...stack] } })
    }
  }
  rec.where(5, { depth: stack.length })
  const balanced = stack.length === 0
  if (!rec.cut) {
    rec.step('done', balanced ? 'every bracket was closed, in the right order' : `${stack.length} bracket${stack.length === 1 ? '' : 's'} left open`, [])
  }
  return rec.finish('balanced brackets', { text }, { balanced, failedAt: balanced ? -1 : text.length, why: balanced ? '' : 'brackets left open' })
}

/** Infix to postfix, by the shunting-yard rule. The stack is where precedence is decided. */
export function infixToPostfix(expression: string, ceiling?: number): Run | AlgorithmError {
  if (typeof expression !== 'string' || expression.trim() === '') return fail('input', 'There is nothing to convert.', 'Type something like 3 + 4 * 2.')
  const rec = new Recorder(ceiling)
  const PRECEDENCE: Readonly<Record<string, number>> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }
  const out: string[] = []
  const stack: string[] = []
  const tokens = expression.replace(/\s+/g, '').split(/([+\-*/^()])/).filter(Boolean)
  rec.where(1, { tokens: tokens.length })

  for (let at = 0; at < tokens.length && !rec.cut; at += 1) {
    const token = tokens[at]
    if (/^[0-9a-zA-Z.]+$/.test(token)) {
      out.push(token)
      rec.where(2, { at })
      rec.step('write', `"${token}" is a value — straight to the output`, [at], { extra: { output: [...out], stack: [...stack] } })
      continue
    }
    if (token === '(') {
      stack.push(token)
      rec.where(3)
      rec.step('push', `"(" goes on the stack and waits for its partner`, [at], { extra: { output: [...out], stack: [...stack] } })
      continue
    }
    if (token === ')') {
      rec.where(4)
      while (stack.length > 0 && stack[stack.length - 1] !== '(' && !rec.cut) {
        const popped = stack.pop() as string
        out.push(popped)
        rec.step('pop', `")" — empty the stack down to the "(": "${popped}" goes out`, [at], { extra: { output: [...out], stack: [...stack] } })
      }
      if (stack.length === 0) {
        return rec.finish('infix to postfix', { expression }, { postfix: out.join(' '), balanced: false, why: 'a closing bracket with no opening one' })
      }
      stack.pop()
      continue
    }
    if (token in PRECEDENCE) {
      rec.where(5, { operator: token, precedence: PRECEDENCE[token] })
      // Anything already on the stack that binds at least as tightly comes off first. That is precedence.
      while (
        stack.length > 0 &&
        stack[stack.length - 1] !== '(' &&
        PRECEDENCE[stack[stack.length - 1]] >= PRECEDENCE[token] &&
        !rec.cut
      ) {
        const popped = stack.pop() as string
        out.push(popped)
        rec.step('pop', `"${popped}" binds at least as tightly as "${token}", so it goes out first`, [at], { extra: { output: [...out], stack: [...stack] } })
      }
      stack.push(token)
      rec.step('push', `"${token}" waits on the stack`, [at], { extra: { output: [...out], stack: [...stack] } })
    }
  }
  rec.where(6)
  while (stack.length > 0 && !rec.cut) {
    const popped = stack.pop() as string
    if (popped === '(') return rec.finish('infix to postfix', { expression }, { postfix: out.join(' '), balanced: false, why: 'an opening bracket was never closed' })
    out.push(popped)
    rec.step('pop', `the end — "${popped}" comes off`, [], { extra: { output: [...out], stack: [...stack] } })
  }
  if (!rec.cut) rec.step('done', `${expression.replace(/\s+/g, '')} becomes ${out.join(' ')} — no brackets needed, because the order is now the order`, [])
  return rec.finish('infix to postfix', { expression }, { postfix: out.join(' '), balanced: true, why: '' })
}

/** Evaluate postfix. Two off, one on, every time — which is why no brackets are needed. */
export function postfixEvaluate(expression: string, ceiling?: number): Run | AlgorithmError {
  if (typeof expression !== 'string' || expression.trim() === '') return fail('input', 'There is nothing to evaluate.', 'Try 3 4 2 * +.')
  const rec = new Recorder(ceiling)
  const stack: number[] = []
  const tokens = expression.trim().split(/\s+/)
  rec.where(1, { tokens: tokens.length })

  for (let at = 0; at < tokens.length && !rec.cut; at += 1) {
    const token = tokens[at]
    const asNumber = Number(token)
    if (Number.isFinite(asNumber) && token !== '') {
      stack.push(asNumber)
      rec.where(2, { at, depth: stack.length })
      rec.step('push', `${token} goes on the stack`, [at], { values: [asNumber], extra: { stack: [...stack] } })
      continue
    }
    rec.where(3, { operator: token })
    if (stack.length < 2) {
      return rec.finish('evaluate postfix', { expression }, { value: null, valid: false, why: `"${token}" needs two values and the stack has ${stack.length}` })
    }
    const right = stack.pop() as number
    const left = stack.pop() as number
    let made: number
    switch (token) {
      case '+':
        made = left + right
        break
      case '-':
        made = left - right
        break
      case '*':
        made = left * right
        break
      case '/':
        if (right === 0) return rec.finish('evaluate postfix', { expression }, { value: null, valid: false, why: 'division by zero' })
        made = left / right
        break
      case '^':
        made = left ** right
        break
      default:
        return rec.finish('evaluate postfix', { expression }, { value: null, valid: false, why: `"${token}" is not a value or an operator` })
    }
    stack.push(made)
    rec.where(4, { depth: stack.length, result: made })
    rec.step('pop', `${left} ${token} ${right} = ${made} — two off, one on`, [at], { values: [made], extra: { stack: [...stack] } })
  }
  rec.where(5)
  const valid = stack.length === 1
  if (!rec.cut) rec.step('done', valid ? `the answer is ${stack[0]}` : `${stack.length} values left on the stack, so the expression is incomplete`, [])
  return rec.finish('evaluate postfix', { expression }, { value: valid ? stack[0] : null, valid, why: valid ? '' : 'values left over' })
}

// ---------------------------------------------------------------- queues

/** A queue of a fixed size, wrapping round. The wrap is why it is worth having. */
export function circularQueue(operations: readonly string[], size: number, ceiling?: number): Run | AlgorithmError {
  const capacity = Math.trunc(size)
  if (!(capacity >= 1 && capacity <= 64)) return fail('input', `A queue of ${size} is not a size this shows.`, 'Use between 1 and 64.')
  if (!Array.isArray(operations) || operations.length === 0) return fail('empty', 'There is nothing to do.', 'Add some values to put in, and the word "take" to take one out.')

  const rec = new Recorder(ceiling)
  const slots = new Array<number | null>(capacity).fill(null)
  let head = 0
  let tail = 0
  let count = 0
  rec.where(1, { capacity, head, tail, count })

  for (let at = 0; at < operations.length && !rec.cut; at += 1) {
    const one = operations[at].trim()
    if (one.toLowerCase() === 'take' || one === '-') {
      rec.where(2, { head, count })
      if (count === 0) {
        rec.step('note', 'nothing to take — the queue is empty', [])
        continue
      }
      const value = slots[head]
      slots[head] = null
      head = (head + 1) % capacity
      count -= 1
      rec.where(3, { head, count })
      rec.step('pop', `took ${value}. The head moves to ${head}${head === 0 ? ', wrapping round to the start' : ''}`, [], { extra: { slots: slots.map((one) => one ?? -1), head, tail } })
      continue
    }
    const value = Number(one)
    if (!Number.isFinite(value)) {
      return fail('input', `"${one}" is neither a number nor "take".`, 'Give numbers to put in, and "take" to take one out.')
    }
    rec.where(4, { tail, count })
    if (count === capacity) {
      rec.step('note', `the queue is full at ${capacity}, so ${value} cannot go in. The head and tail meeting is what "full" means`, [])
      continue
    }
    slots[tail] = value
    tail = (tail + 1) % capacity
    count += 1
    rec.where(5, { tail, count })
    rec.step('push', `put ${value} in. The tail moves to ${tail}${tail === 0 ? ', wrapping round to the start' : ''}`, [], { values: [value], extra: { slots: slots.map((one) => one ?? -1), head, tail } })
  }
  rec.where(6, { count })
  if (!rec.cut) rec.step('done', `${count} of ${capacity} slots in use, head at ${head}, tail at ${tail}`, [])
  return rec.finish('circular queue', { operations: [...operations], size: capacity }, { slots, head, tail, count })
}

/** Breadth-first over a tree given as an array, to show what the queue is actually for. */
export function queueBreadthFirst(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const queue: number[] = [0]
  const order: number[] = []
  rec.where(1, { queued: 1 })
  rec.step('note', `the tree is held as an array: the children of ${0} are at 1 and 2, and of n at 2n+1 and 2n+2`, [0])

  while (queue.length > 0 && !rec.cut) {
    const at = queue.shift() as number
    order.push(at)
    rec.where(2, { at, queued: queue.length })
    rec.step('pop', `take ${values[at]} off the front — level by level, because a queue keeps the order they arrived`, [at], {
      values: [values[at]],
      extra: { queue: [...queue] }
    })
    for (const child of [2 * at + 1, 2 * at + 2]) {
      if (child >= values.length) continue
      queue.push(child)
      rec.where(3, { queued: queue.length })
      rec.step('push', `${values[child]} joins the back of the queue`, [child], { values: [values[child]], extra: { queue: [...queue] } })
    }
  }
  rec.where(4)
  if (!rec.cut) rec.step('done', `visited in level order: ${order.map((one) => values[one]).join(', ')}`, order)
  return rec.finish('breadth-first with a queue', { values: [...values] }, { order: order.map((one) => values[one]) })
}

// ---------------------------------------------------------------- the registry

export type StructureName =
  | 'traversal' | 'reversal' | 'rotation' | 'prefix-sum' | 'kadane' | 'two-pointer' | 'sliding-window'
  | 'dutch-flag' | 'move-zeros' | 'remove-duplicates' | 'two-sum' | 'missing-number' | 'majority-element'
  | 'list-reverse' | 'list-middle' | 'list-cycle' | 'list-search'
  | 'balanced-parens' | 'infix-to-postfix' | 'postfix-eval'
  | 'circular-queue' | 'queue-bfs'

export const STRUCTURE_NAMES: readonly StructureName[] = Object.freeze([
  'traversal', 'reversal', 'rotation', 'prefix-sum', 'kadane', 'two-pointer', 'sliding-window',
  'dutch-flag', 'move-zeros', 'remove-duplicates', 'two-sum', 'missing-number', 'majority-element',
  'list-reverse', 'list-middle', 'list-cycle', 'list-search',
  'balanced-parens', 'infix-to-postfix', 'postfix-eval',
  'circular-queue', 'queue-bfs'
])

export function runStructure(
  name: StructureName,
  options: { values?: readonly number[]; target?: number; by?: number; size?: number; text?: string; cycleAt?: number | null; operations?: readonly string[]; ceiling?: number } = {}
): Run | AlgorithmError {
  const values = options.values ?? []
  const ceiling = options.ceiling
  switch (name) {
    case 'traversal':
      return traversal(values, ceiling)
    case 'reversal':
      return reversal(values, ceiling)
    case 'rotation':
      return rotation(values, options.by ?? 3, ceiling)
    case 'prefix-sum':
      return prefixSum(values, ceiling)
    case 'kadane':
      return kadane(values, ceiling)
    case 'two-pointer':
      return twoPointer([...values].sort((a, b) => a - b), options.target ?? 0, ceiling)
    case 'sliding-window':
      return slidingWindow(values, options.size ?? 3, ceiling)
    case 'dutch-flag':
      return dutchFlag(values, options.target ?? 1, ceiling)
    case 'move-zeros':
      return moveZeros(values, ceiling)
    case 'remove-duplicates':
      return removeDuplicates([...values].sort((a, b) => a - b), ceiling)
    case 'two-sum':
      return twoSum(values, options.target ?? 0, ceiling)
    case 'missing-number':
      return missingNumber(values, ceiling)
    case 'majority-element':
      return majorityElement(values, ceiling)
    case 'list-reverse':
      return listReverse(values, ceiling)
    case 'list-middle':
      return listMiddle(values, ceiling)
    case 'list-cycle':
      return listCycle(values, options.cycleAt ?? null, ceiling)
    case 'list-search':
      return listSearch(values, options.target ?? 0, ceiling)
    case 'balanced-parens':
      return balancedParentheses(options.text ?? '{ [ ( ) ] }', ceiling)
    case 'infix-to-postfix':
      return infixToPostfix(options.text ?? '3 + 4 * 2 / ( 1 - 5 )', ceiling)
    case 'postfix-eval':
      return postfixEvaluate(options.text ?? '3 4 2 * +', ceiling)
    case 'circular-queue':
      return circularQueue(options.operations ?? ['1', '2', '3', 'take', '4', '5', 'take', '6'], options.size ?? 4, ceiling)
    case 'queue-bfs':
      return queueBreadthFirst(values, ceiling)
    default:
      return fail('unknown', `There is no algorithm called "${String(name)}".`, `Choose one of: ${STRUCTURE_NAMES.slice(0, 6).join(', ')}.`)
  }
}
