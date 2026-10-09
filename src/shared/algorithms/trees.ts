import { Recorder, fail, type AlgorithmError, type Run } from './trace.ts'

/**
 * Binary search trees, the four traversals, and the two ways to build a hash table.
 *
 * ## Why the four traversals are one laboratory and not four
 *
 * In-order, pre-order and post-order differ by a single line's position, and that is almost impossible to believe
 * from a description. Here they are the same walk with the visit moved, and the orders they produce come out
 * different — in-order sorted, pre-order with the root first, post-order with it last. Seeing one function produce
 * three answers is the point.
 *
 * ## The tree records its shape
 *
 * Every step carries the links as they stand, so an unbalanced tree *looks* unbalanced. Insert 1 to 7 in order and
 * the tree becomes a list, and the depth climbing to 7 instead of 3 is the entire argument for balancing.
 *
 * ## Hashing shows the collisions
 *
 * Both tables report how many keys collided and the longest chain or probe run. A hash table is O(1) only while
 * that stays small, and the number falling apart as the table fills is the thing worth watching.
 *
 * Pure.
 */

const MOST = 500

export interface TreeNode {
  value: number
  left: number | null
  right: number | null
}

function check(values: readonly number[]): AlgorithmError | null {
  if (!Array.isArray(values)) return fail('input', 'That is not a list of numbers.', 'Give numbers separated by commas.')
  if (values.length === 0) return fail('empty', 'There is nothing to build a tree from.', 'Give at least one number.')
  if (values.length > MOST) return fail('too-big', `${values.length} values is more than this traces.`, `Use at most ${MOST}.`)
  for (const one of values) {
    if (typeof one !== 'number' || !Number.isFinite(one)) return fail('input', 'The list has something in it that is not a finite number.', 'Give only numbers.')
  }
  return null
}

/** Build a search tree by inserting in the order given. The order is what decides the shape. */
function build(values: readonly number[]): { nodes: TreeNode[]; root: number | null; depths: number[] } {
  const nodes: TreeNode[] = []
  const depths: number[] = []
  let root: number | null = null
  for (const value of values) {
    const made = nodes.length
    nodes.push({ value, left: null, right: null })
    if (root === null) {
      root = made
      depths.push(1)
      continue
    }
    let at: number = root
    let depth = 1
    for (;;) {
      depth += 1
      const here = nodes[at]
      if (value < here.value) {
        if (here.left === null) {
          here.left = made
          break
        }
        at = here.left
      } else {
        if (here.right === null) {
          here.right = made
          break
        }
        at = here.right
      }
    }
    depths.push(depth)
  }
  return { nodes, root, depths }
}

const links = (nodes: readonly TreeNode[]): readonly (readonly [number, number])[] =>
  nodes.flatMap((one, at) => [
    ...(one.left !== null ? ([[at, one.left]] as [number, number][]) : []),
    ...(one.right !== null ? ([[at, one.right]] as [number, number][]) : [])
  ])

/** Insert each value, recording the path down. The path length is the cost, and it depends on the order. */
export function bstInsert(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const nodes: TreeNode[] = []
  let root: number | null = null
  let deepest = 0

  rec.where(1, { nodes: 0 })
  for (let one = 0; one < values.length && !rec.cut; one += 1) {
    const value = values[one]
    const made = nodes.length
    nodes.push({ value, left: null, right: null })
    rec.where(2, { value, nodes: nodes.length })
    rec.step('read', `insert ${value}`, [made], { values: [value] })

    if (root === null) {
      root = made
      deepest = Math.max(deepest, 1)
      rec.where(3, { depth: 1 })
      rec.step('write', `${value} is the first value, so it is the root`, [made], { extra: { links: links(nodes).flat() } })
      continue
    }

    let at: number = root
    let depth = 1
    while (!rec.cut) {
      depth += 1
      rec.where(4, { depth, at: nodes[at].value })
      rec.step('compare', `is ${value} less than ${nodes[at].value}?`, [at, made], { values: [value, nodes[at].value] })
      const here = nodes[at]
      if (value < here.value) {
        if (here.left === null) {
          here.left = made
          rec.where(5, { depth })
          rec.step('write', `smaller — ${value} goes to the left of ${here.value}, at depth ${depth}`, [made], { extra: { links: links(nodes).flat() } })
          break
        }
        at = here.left
      } else {
        if (here.right === null) {
          here.right = made
          rec.where(6, { depth })
          rec.step('write', `not smaller — ${value} goes to the right of ${here.value}, at depth ${depth}`, [made], { extra: { links: links(nodes).flat() } })
          break
        }
        at = here.right
      }
    }
    deepest = Math.max(deepest, depth)
  }

  rec.where(7, { depth: deepest })
  const perfect = Math.ceil(Math.log2(values.length + 1))
  if (!rec.cut) {
    rec.step(
      'done',
      deepest > perfect * 1.6
        ? `${values.length} values, and the tree is ${deepest} deep where a balanced one would be ${perfect}. Inserting in order makes a list, and that is why balanced trees exist`
        : `${values.length} values, ${deepest} deep — close to the ${perfect} a perfectly balanced tree would be`,
      []
    )
  }
  return rec.finish('insert into a search tree', { values: [...values] }, { nodes, root, deepest, perfect })
}

/** Search the tree. Halves at every step — but only if the tree is balanced, which the step count shows. */
export function bstSearch(values: readonly number[], target: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const { nodes, root } = build(values)
  rec.where(1, { target })
  rec.step('note', `${values.length} values in the tree; look for ${target}`, [], { extra: { links: links(nodes).flat() } })

  let at = root
  let steps = 0
  while (at !== null && !rec.cut) {
    steps += 1
    rec.where(2, { at: nodes[at].value, steps })
    rec.step('compare', `is ${target} equal to ${nodes[at].value}?`, [at], { values: [target, nodes[at].value] })
    if (nodes[at].value === target) {
      rec.where(3)
      rec.step('visit', `found after ${steps} comparison${steps === 1 ? '' : 's'}`, [at])
      return rec.finish('search a tree', { values: [...values], target }, { found: true, steps, at })
    }
    if (target < nodes[at].value) {
      rec.where(4)
      rec.step('note', `smaller, so everything to the right can be ignored`, [at])
      at = nodes[at].left
    } else {
      rec.where(5)
      rec.step('note', `larger, so everything to the left can be ignored`, [at])
      at = nodes[at].right
    }
  }
  rec.where(6)
  if (!rec.cut) rec.step('done', `${target} is not in the tree; ${steps} comparisons were needed to be sure`, [])
  return rec.finish('search a tree', { values: [...values], target }, { found: false, steps, at: -1 })
}

type Order = 'in' | 'pre' | 'post'

/**
 * The three depth-first walks, which differ only in where the visit happens.
 *
 * Pre-order visits before recursing, in-order between the two, post-order after both. One function, one line moved,
 * three different answers — and the in-order one comes out sorted, which is the property the whole structure exists
 * for.
 */
function walk(order: Order, values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const { nodes, root } = build(values)
  const out: number[] = []
  const names: Record<Order, string> = { in: 'in-order', pre: 'pre-order', post: 'post-order' }

  rec.where(1, { visited: 0 })
  rec.step('note', `${names[order]}: visit ${order === 'pre' ? 'before' : order === 'in' ? 'between' : 'after'} the recursive calls`, [], {
    extra: { links: links(nodes).flat() }
  })

  /*
   * Which line each part is on, per order.
   *
   * One function serves all three walks and each has its own listing, so the visit is on a different line in each
   * — which is the very thing the three listings exist to show.
   */
  const LINES: Record<Order, { enter: number; visit: number; left: number; right: number; end: number }> = {
    in: { enter: 1, visit: 3, left: 2, right: 4, end: 5 },
    pre: { enter: 1, visit: 2, left: 3, right: 4, end: 5 },
    post: { enter: 1, visit: 4, left: 2, right: 3, end: 5 }
  }
  const line = LINES[order]

  const go = (at: number | null, depth: number): void => {
    if (at === null || rec.cut) return
    rec.where(line.enter, { at: nodes[at].value, depth })
    const frame = rec.enter(`${names[order]} at ${nodes[at].value}`)

    if (order === 'pre') {
      out.push(nodes[at].value)
      rec.where(line.visit, { visited: out.length })
      rec.step('visit', `visit ${nodes[at].value} before going down`, [at], { values: [nodes[at].value] })
    }
    rec.where(line.left)
    go(nodes[at].left, depth + 1)
    if (order === 'in') {
      out.push(nodes[at].value)
      rec.where(line.visit, { visited: out.length })
      rec.step('visit', `the left is done, so visit ${nodes[at].value} now`, [at], { values: [nodes[at].value] })
    }
    rec.where(line.right)
    go(nodes[at].right, depth + 1)
    if (order === 'post') {
      out.push(nodes[at].value)
      rec.where(line.visit, { visited: out.length })
      rec.step('visit', `both sides are done, so visit ${nodes[at].value} last`, [at], { values: [nodes[at].value] })
    }
    rec.leave(frame, String(nodes[at].value))
  }
  go(root, 1)

  rec.where(line.end)
  const sorted = out.every((one, at) => at === 0 || out[at - 1] <= one)
  if (!rec.cut) {
    rec.step(
      'done',
      order === 'in'
        ? `${out.join(', ')} — ${sorted ? 'sorted, which is what in-order on a search tree always gives' : 'not sorted, which means the tree is not a search tree'}`
        : `${out.join(', ')}`,
      []
    )
  }
  return rec.finish(`${names[order]} traversal`, { values: [...values] }, { order: out, sorted })
}

export const inOrder = (values: readonly number[], ceiling?: number): Run | AlgorithmError => walk('in', values, ceiling)
export const preOrder = (values: readonly number[], ceiling?: number): Run | AlgorithmError => walk('pre', values, ceiling)
export const postOrder = (values: readonly number[], ceiling?: number): Run | AlgorithmError => walk('post', values, ceiling)

/** Level by level, with a queue. The only traversal that is not recursive, and the only one that needs one. */
export function levelOrder(values: readonly number[], ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const { nodes, root } = build(values)
  const out: number[] = []
  const levels: number[][] = []
  if (root === null) return rec.finish('level-order traversal', { values: [...values] }, { order: [], levels: [] })

  const queue: { at: number; depth: number }[] = [{ at: root, depth: 1 }]
  rec.where(1, { queued: 1 })
  rec.step('note', 'level-order needs a queue, not recursion — a stack would go deep instead of wide', [root], { extra: { links: links(nodes).flat() } })

  while (queue.length > 0 && !rec.cut) {
    const { at, depth } = queue.shift() as { at: number; depth: number }
    out.push(nodes[at].value)
    ;(levels[depth - 1] ??= []).push(nodes[at].value)
    rec.where(2, { at: nodes[at].value, depth, queued: queue.length })
    rec.step('pop', `visit ${nodes[at].value}, at depth ${depth}`, [at], { values: [nodes[at].value] })

    for (const child of [nodes[at].left, nodes[at].right]) {
      if (child === null) continue
      queue.push({ at: child, depth: depth + 1 })
      rec.where(3, { queued: queue.length })
      rec.step('push', `${nodes[child].value} joins the back of the queue`, [child], { values: [nodes[child].value] })
    }
  }
  rec.where(4)
  if (!rec.cut) rec.step('done', `${levels.length} level${levels.length === 1 ? '' : 's'}: ${levels.map((one) => one.join(' ')).join(' | ')}`, [])
  return rec.finish('level-order traversal', { values: [...values] }, { order: out, levels })
}

// ---------------------------------------------------------------- hashing

const hashOf = (value: number, buckets: number): number => {
  // Multiply and take the remainder. Simple on purpose: the collisions are the lesson, not the hash.
  const made = Math.abs(Math.imul(value, 2654435761))
  return made % buckets
}

/** A hash table where each bucket holds a list. Collisions make a chain, and the longest chain is the cost. */
export function hashChaining(values: readonly number[], buckets: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const count = Math.max(1, Math.min(64, Math.trunc(buckets)))
  const rec = new Recorder(ceiling)
  const table: number[][] = Array.from({ length: count }, () => [])
  let collisions = 0

  rec.where(1, { buckets: count, stored: 0 })
  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    const value = values[at]
    const bucket = hashOf(value, count)
    rec.where(2, { value, bucket })
    rec.step('read', `${value} hashes to bucket ${bucket}`, [at], { values: [value] })
    if (table[bucket].length > 0) {
      collisions += 1
      rec.where(3, { collisions, chain: table[bucket].length + 1 })
      rec.step('note', `bucket ${bucket} already holds ${table[bucket].join(', ')} — a collision, so ${value} joins the chain`, [at])
    }
    table[bucket].push(value)
    rec.where(4, { stored: at + 1 })
    rec.step('write', `bucket ${bucket} is now [${table[bucket].join(', ')}]`, [at], { extra: { table: table.map((one) => one.length) } })
  }

  const longest = Math.max(0, ...table.map((one) => one.length))
  const used = table.filter((one) => one.length > 0).length
  rec.where(5, { collisions, longest })
  if (!rec.cut) {
    rec.step(
      'done',
      `${values.length} values in ${count} buckets: ${collisions} collision${collisions === 1 ? '' : 's'}, longest chain ${longest}. A lookup costs one hash plus up to ${longest} comparisons, so "O(1)" only holds while that stays small`,
      []
    )
  }
  return rec.finish('hash table with chaining', { values: [...values], buckets: count }, { table, collisions, longest, used, load: values.length / count })
}

/** A hash table with no chains: on a collision, try the next slot. Fast until it fills, then suddenly not. */
export function hashProbing(values: readonly number[], buckets: number, ceiling?: number): Run | AlgorithmError {
  const bad = check(values)
  if (bad) return bad
  const count = Math.max(1, Math.min(64, Math.trunc(buckets)))
  if (values.length > count) {
    return fail('too-big', `${values.length} values cannot fit in ${count} slots without chaining.`, `Use more buckets than values — a table above about 70% full probes badly.`)
  }
  const rec = new Recorder(ceiling)
  const slots = new Array<number | null>(count).fill(null)
  let probes = 0
  let longest = 0

  rec.where(1, { buckets: count, stored: 0 })
  for (let at = 0; at < values.length && !rec.cut; at += 1) {
    const value = values[at]
    let bucket = hashOf(value, count)
    rec.where(2, { value, bucket })
    rec.step('read', `${value} hashes to slot ${bucket}`, [at], { values: [value] })

    let tried = 0
    while (slots[bucket] !== null && !rec.cut) {
      tried += 1
      probes += 1
      const next = (bucket + 1) % count
      rec.where(3, { probing: next, tried })
      rec.step('compare', `slot ${bucket} holds ${slots[bucket]} — try ${next}`, [at])
      bucket = next
      if (tried > count) break
    }
    longest = Math.max(longest, tried)
    slots[bucket] = value
    rec.where(4, { stored: at + 1 })
    rec.step('write', `${value} goes in slot ${bucket}${tried > 0 ? ` after ${tried} probe${tried === 1 ? '' : 's'}` : ''}`, [at], {
      extra: { slots: slots.map((one) => (one === null ? -1 : one)) }
    })
  }

  const load = values.length / count
  rec.where(5, { probes, longest })
  if (!rec.cut) {
    rec.step(
      'done',
      `${values.length} values in ${count} slots — ${Math.round(load * 100)}% full, ${probes} probe${probes === 1 ? '' : 's'}, longest run ${longest}. Probing stays fast to about 70% and falls apart above it, which chaining does not`,
      []
    )
  }
  return rec.finish('hash table with probing', { values: [...values], buckets: count }, { slots, probes, longest, load })
}

// ---------------------------------------------------------------- greedy

export interface Activity {
  name: string
  start: number
  finish: number
}

/**
 * Activity selection: take whatever finishes soonest, every time.
 *
 * It is the clearest greedy proof there is. Taking the shortest, or the one that starts first, both give the wrong
 * answer on inputs this laboratory can show — and "finishes soonest" is right because it leaves the most room for
 * everything after it.
 */
export function activitySelection(activities: readonly Activity[], ceiling?: number): Run | AlgorithmError {
  if (!Array.isArray(activities) || activities.length === 0) return fail('empty', 'There is nothing to choose between.', 'Add some activities.')
  if (activities.length > 200) return fail('too-big', `${activities.length} activities is more than this traces.`, 'Use at most 200.')
  for (const one of activities) {
    if (!(Number.isFinite(one.start) && Number.isFinite(one.finish))) return fail('input', `"${one.name}" has no start or finish time.`, 'Give both as numbers.')
    if (one.finish < one.start) return fail('input', `"${one.name}" finishes before it starts.`, 'Check the times.')
  }

  const rec = new Recorder(ceiling)
  const sorted = [...activities].sort((a, b) => a.finish - b.finish || a.start - b.start)
  rec.where(1, { n: sorted.length })
  rec.step('note', `sort by finishing time: ${sorted.map((one) => one.name).join(', ')}`, [])

  const taken: Activity[] = []
  let lastFinish = -Infinity
  for (let at = 0; at < sorted.length && !rec.cut; at += 1) {
    const one = sorted[at]
    rec.where(2, { at, considering: one.name, lastFinish: lastFinish === -Infinity ? 'none' : lastFinish })
    rec.step('compare', `"${one.name}" runs ${one.start}–${one.finish}; the last one taken finished at ${lastFinish === -Infinity ? 'nothing yet' : lastFinish}`, [at])
    if (one.start >= lastFinish) {
      taken.push(one)
      lastFinish = one.finish
      rec.where(3, { taken: taken.length, lastFinish })
      rec.step('visit', `it does not overlap, so take it. ${taken.length} taken so far`, [at])
    } else {
      rec.where(4)
      rec.step('note', `it overlaps, so skip it`, [at])
    }
  }

  rec.where(5, { taken: taken.length })
  if (!rec.cut) {
    rec.step(
      'done',
      `${taken.length} of ${sorted.length}: ${taken.map((one) => one.name).join(', ')}. Choosing what finishes soonest is right because it leaves the most time for everything after it`,
      []
    )
  }
  return rec.finish('activity selection', { activities: [...activities] }, { taken, count: taken.length })
}

export interface Item {
  name: string
  weight: number
  value: number
}

/**
 * Fractional knapsack: take the best value per unit of weight, and cut the last one to fit.
 *
 * Greedy is right here and wrong for the 0/1 version, and that pair is the single best illustration of when greedy
 * works. The report says so, with the ratios that decided it.
 */
export function fractionalKnapsack(items: readonly Item[], capacity: number, ceiling?: number): Run | AlgorithmError {
  if (!Array.isArray(items) || items.length === 0) return fail('empty', 'There is nothing to pack.', 'Add some items.')
  if (!(capacity > 0)) return fail('input', 'The bag holds nothing.', 'Give a capacity above zero.')
  for (const one of items) {
    if (!(one.weight > 0)) return fail('input', `"${one.name}" weighs nothing.`, 'Every item needs a weight above zero.')
    if (!Number.isFinite(one.value)) return fail('input', `"${one.name}" has no value.`, 'Give a number.')
  }

  const rec = new Recorder(ceiling)
  const ranked = [...items]
    .map((one) => ({ ...one, ratio: one.value / one.weight }))
    .sort((a, b) => b.ratio - a.ratio)

  rec.where(1, { capacity })
  rec.step('note', `sort by value per unit of weight: ${ranked.map((one) => `${one.name} ${one.ratio.toFixed(2)}`).join(', ')}`, [])

  let left = capacity
  let total = 0
  const taken: { name: string; fraction: number; value: number }[] = []

  for (let at = 0; at < ranked.length && !rec.cut; at += 1) {
    const one = ranked[at]
    rec.where(2, { at, item: one.name, left: Number(left.toFixed(4)) })
    if (left <= 0) {
      rec.step('note', `the bag is full, so "${one.name}" is left behind`, [at])
      continue
    }
    if (one.weight <= left) {
      left -= one.weight
      total += one.value
      taken.push({ name: one.name, fraction: 1, value: one.value })
      rec.where(3, { left: Number(left.toFixed(4)), total: Number(total.toFixed(4)) })
      rec.step('visit', `"${one.name}" fits whole: +${one.value}, ${left} left`, [at], { values: [one.value] })
    } else {
      // The cut is why greedy works here and not for 0/1 — a part of an item is allowed.
      const fraction = left / one.weight
      const value = one.value * fraction
      total += value
      taken.push({ name: one.name, fraction, value })
      rec.where(4, { fraction: Number(fraction.toFixed(4)), total: Number(total.toFixed(4)) })
      rec.step('visit', `only ${(fraction * 100).toFixed(1)}% of "${one.name}" fits: +${value.toFixed(2)}`, [at], { values: [value] })
      left = 0
    }
  }

  rec.where(5, { total: Number(total.toFixed(4)) })
  if (!rec.cut) {
    rec.step(
      'done',
      `${total.toFixed(2)} in a bag of ${capacity}. Greedy is provably right here only because an item can be cut — for 0/1 it is wrong, and that needs the dynamic programming version`,
      []
    )
  }
  return rec.finish('fractional knapsack', { items: [...items], capacity }, { taken, total, ratios: ranked.map((one) => ({ name: one.name, ratio: one.ratio })) })
}

/** Fewest coins for an amount, taking the largest first — which is wrong for some coin sets, and says so. */
export function coinChangeGreedy(coins: readonly number[], amount: number, ceiling?: number): Run | AlgorithmError {
  if (!Array.isArray(coins) || coins.length === 0) return fail('empty', 'There are no coins.', 'Give some coin values.')
  if (!(amount >= 0)) return fail('input', 'The amount has to be zero or more.', 'Give a positive amount.')
  if (coins.some((one) => !(one > 0) || !Number.isFinite(one))) return fail('input', 'Every coin has to be worth more than nothing.', 'Give positive numbers.')

  const rec = new Recorder(ceiling)
  const sorted = [...new Set(coins)].sort((a, b) => b - a)
  rec.where(1, { amount, coins: sorted.length })
  rec.step('note', `coins: ${sorted.join(', ')}. Take the largest that fits, every time`, [])

  let left = amount
  const used: { coin: number; count: number }[] = []
  for (let at = 0; at < sorted.length && !rec.cut; at += 1) {
    const coin = sorted[at]
    rec.where(2, { coin, left })
    if (coin > left) {
      rec.step('note', `${coin} is more than the ${left} left`, [at])
      continue
    }
    const count = Math.floor(left / coin)
    left -= count * coin
    used.push({ coin, count })
    rec.where(3, { left, taken: count })
    rec.step('visit', `take ${count} × ${coin}, leaving ${left}`, [at], { values: [coin] })
  }

  const total = used.reduce((out, one) => out + one.count, 0)
  // The best answer, by dynamic programming, so the greedy one can be checked rather than trusted.
  const best = bestCoinCount(sorted, amount)
  rec.where(4, { coins: total, left })
  if (!rec.cut) {
    rec.step(
      'done',
      left > 0
        ? `${left} could not be made at all from these coins`
        : best !== null && total > best
          ? `${total} coins — but ${best} is possible. Greedy is wrong for this coin set, which is exactly why change-making is a dynamic programming problem`
          : `${total} coins, which is the fewest possible for this set`,
      []
    )
  }
  return rec.finish('coin change, greedily', { coins: [...coins], amount }, { used, total, left, best, greedyIsBest: best !== null && total === best })
}

/** The true fewest, by dynamic programming. Used to check the greedy answer rather than to replace it. */
function bestCoinCount(coins: readonly number[], amount: number): number | null {
  if (!Number.isInteger(amount) || amount > 20_000 || coins.some((one) => !Number.isInteger(one))) return null
  const best = new Array<number>(amount + 1).fill(Infinity)
  best[0] = 0
  for (let one = 1; one <= amount; one += 1) {
    for (const coin of coins) {
      if (coin <= one && best[one - coin] + 1 < best[one]) best[one] = best[one - coin] + 1
    }
  }
  return Number.isFinite(best[amount]) ? best[amount] : null
}

// ---------------------------------------------------------------- the registry

export type TreeName =
  | 'bst-insert' | 'bst-search' | 'in-order' | 'pre-order' | 'post-order' | 'level-order'
  | 'hash-chaining' | 'hash-probing'
  | 'activity-selection' | 'fractional-knapsack' | 'coin-change-greedy'

export const TREE_NAMES: readonly TreeName[] = Object.freeze([
  'bst-insert', 'bst-search', 'in-order', 'pre-order', 'post-order', 'level-order',
  'hash-chaining', 'hash-probing',
  'activity-selection', 'fractional-knapsack', 'coin-change-greedy'
])

/** The activities the laboratory starts with, chosen so that taking the shortest first gives the wrong answer. */
export const ACTIVITIES: readonly Activity[] = Object.freeze([
  { name: 'Lecture', start: 1, finish: 4 },
  { name: 'Lab', start: 3, finish: 5 },
  { name: 'Seminar', start: 0, finish: 6 },
  { name: 'Tutorial', start: 5, finish: 7 },
  { name: 'Workshop', start: 3, finish: 9 },
  { name: 'Reading', start: 5, finish: 9 },
  { name: 'Revision', start: 6, finish: 10 },
  { name: 'Practical', start: 8, finish: 11 },
  { name: 'Club', start: 8, finish: 12 },
  { name: 'Study', start: 2, finish: 14 },
  { name: 'Match', start: 12, finish: 16 }
])

export const ITEMS: readonly Item[] = Object.freeze([
  { name: 'Gold', weight: 10, value: 60 },
  { name: 'Silver', weight: 20, value: 100 },
  { name: 'Bronze', weight: 30, value: 120 }
])

export function runTree(
  name: TreeName,
  options: { values?: readonly number[]; target?: number; buckets?: number; activities?: readonly Activity[]; items?: readonly Item[]; capacity?: number; coins?: readonly number[]; amount?: number; ceiling?: number } = {}
): Run | AlgorithmError {
  const values = options.values ?? []
  const ceiling = options.ceiling
  switch (name) {
    case 'bst-insert':
      return bstInsert(values, ceiling)
    case 'bst-search':
      return bstSearch(values, options.target ?? 0, ceiling)
    case 'in-order':
      return inOrder(values, ceiling)
    case 'pre-order':
      return preOrder(values, ceiling)
    case 'post-order':
      return postOrder(values, ceiling)
    case 'level-order':
      return levelOrder(values, ceiling)
    case 'hash-chaining':
      return hashChaining(values, options.buckets ?? 7, ceiling)
    case 'hash-probing':
      return hashProbing(values, options.buckets ?? Math.max(8, values.length * 2), ceiling)
    case 'activity-selection':
      return activitySelection(options.activities ?? ACTIVITIES, ceiling)
    case 'fractional-knapsack':
      return fractionalKnapsack(options.items ?? ITEMS, options.capacity ?? 50, ceiling)
    case 'coin-change-greedy':
      return coinChangeGreedy(options.coins ?? [1, 3, 4], options.amount ?? 6, ceiling)
    default:
      return fail('unknown', `There is no algorithm called "${String(name)}".`, `Choose one of: ${TREE_NAMES.slice(0, 6).join(', ')}.`)
  }
}
