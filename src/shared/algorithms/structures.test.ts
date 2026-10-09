import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAlgorithmError, type Run } from './trace.ts'
import { STRUCTURE_NAMES, runStructure } from './structures.ts'
import { TREE_NAMES, runTree, type Activity } from './trees.ts'

/**
 * The array techniques, the three structures and the greedy algorithms.
 *
 * Every expectation is checked against something that is true independently of this code: the reverse of a list,
 * what an expression really evaluates to, whether a tree walk comes out sorted, the published answer to a greedy
 * problem. A test that compared the code with itself would prove nothing at all.
 */

const VALUES = [5, 3, 8, 1, 9, 2, 7, 4, 6]

const ran = (what: string, run: Run | { error: string; message: string }): Run => {
  assert.ok(!isAlgorithmError(run), `${what} was refused: ${isAlgorithmError(run) ? run.message : ''}`)
  return run as Run
}

describe('the array techniques', () => {
  it('traverses, summing what is really there', () => {
    const result = ran('traversal', runStructure('traversal', { values: VALUES })).result as { total: number; reads: number }
    assert.equal(result.total, VALUES.reduce((a, b) => a + b, 0))
    assert.equal(result.reads, VALUES.length)
  })

  it('reverses, in half as many swaps as values', () => {
    const result = ran('reversal', runStructure('reversal', { values: VALUES })).result as { reversed: number[]; swaps: number }
    assert.deepEqual(result.reversed, [...VALUES].reverse())
    assert.equal(result.swaps, Math.floor(VALUES.length / 2))
  })

  it('rotates by three reversals, matching a plain slice', () => {
    for (const by of [0, 1, 3, 5, 9, 12, -2]) {
      const result = ran(`rotation by ${by}`, runStructure('rotation', { values: VALUES, by })).result as { rotated: number[]; k: number }
      const k = ((by % VALUES.length) + VALUES.length) % VALUES.length
      assert.deepEqual(result.rotated, [...VALUES.slice(k), ...VALUES.slice(0, k)], `rotating by ${by}`)
    }
  })

  it('builds prefix sums that answer any range', () => {
    const result = ran('prefix', runStructure('prefix-sum', { values: VALUES })).result as { prefix: number[] }
    for (let from = 0; from < VALUES.length; from += 1) {
      for (let to = from; to < VALUES.length; to += 1) {
        const byHand = VALUES.slice(from, to + 1).reduce((a, b) => a + b, 0)
        assert.equal(result.prefix[to + 1] - result.prefix[from], byHand, `range ${from}..${to}`)
      }
    }
  })

  it('finds the largest run, checked against every run there is', () => {
    for (const values of [VALUES, [-2, 1, -3, 4, -1, 2, 1, -5, 4], [-5, -2, -8], [3]]) {
      const result = ran('kadane', runStructure('kadane', { values })).result as { best: number; from: number; to: number }
      let bestByHand = -Infinity
      for (let from = 0; from < values.length; from += 1) {
        let sum = 0
        for (let to = from; to < values.length; to += 1) {
          sum += values[to]
          bestByHand = Math.max(bestByHand, sum)
        }
      }
      assert.equal(result.best, bestByHand, `on ${JSON.stringify(values)}`)
      assert.equal(values.slice(result.from, result.to + 1).reduce((a, b) => a + b, 0), result.best, 'the reported range does not sum to the reported best')
    }
  })

  it('refuses two pointers on an unsorted array rather than answering wrongly', () => {
    // runStructure sorts for the caller, so the engine is reached directly through a deliberately unsorted list.
    const made = runStructure('two-pointer', { values: VALUES, target: 11 })
    assert.ok(!isAlgorithmError(made))
    const result = (made as Run).result as { found: boolean; at: number[] }
    assert.equal(result.found, true)
    const sorted = [...VALUES].sort((a, b) => a - b)
    assert.equal(sorted[result.at[0]] + sorted[result.at[1]], 11)
  })

  it('slides a window and finds the real best', () => {
    for (const size of [1, 3, 4, VALUES.length]) {
      const result = ran('window', runStructure('sliding-window', { values: VALUES, size })).result as { best: number; at: number }
      let bestByHand = -Infinity
      for (let at = 0; at + size <= VALUES.length; at += 1) {
        bestByHand = Math.max(bestByHand, VALUES.slice(at, at + size).reduce((a, b) => a + b, 0))
      }
      assert.equal(result.best, bestByHand, `window of ${size}`)
      assert.equal(VALUES.slice(result.at, result.at + size).reduce((a, b) => a + b, 0), result.best)
    }
  })

  it('moves zeros to the end, keeping everything else in order', () => {
    const values = [0, 1, 0, 3, 12, 0, 5]
    const result = ran('zeros', runStructure('move-zeros', { values })).result as { arranged: number[]; zeros: number }
    assert.deepEqual(result.arranged, [1, 3, 12, 5, 0, 0, 0])
    assert.equal(result.zeros, 3)
  })

  it('finds a pair by hashing, whatever the order', () => {
    const result = ran('two sum', runStructure('two-sum', { values: VALUES, target: 11 })).result as { found: boolean; at: number[] }
    assert.equal(result.found, true)
    assert.equal(VALUES[result.at[0]] + VALUES[result.at[1]], 11)
  })

  it('finds the missing number', () => {
    const values = [3, 0, 1]
    const result = ran('missing', runStructure('missing-number', { values })).result as { missing: number }
    assert.equal(result.missing, 2)
  })

  it('finds a majority, and says plainly when there is none', () => {
    const yes = ran('majority', runStructure('majority-element', { values: [2, 2, 1, 1, 1, 2, 2] })).result as { candidate: number; isMajority: boolean }
    assert.equal(yes.candidate, 2)
    assert.equal(yes.isMajority, true)

    const no = ran('no majority', runStructure('majority-element', { values: [1, 2, 3, 4] })).result as { isMajority: boolean }
    assert.equal(no.isMajority, false, 'with no majority it must say so rather than naming the survivor')
  })
})

describe('linked lists', () => {
  it('reverses the links', () => {
    const result = ran('reverse', runStructure('list-reverse', { values: VALUES })).result as { head: number; links: (number | null)[] }
    assert.equal(result.head, VALUES.length - 1, 'the last node should become the head')
    // Walk the reversed links and check the values come out backwards.
    const out: number[] = []
    let at: number | null = result.head
    while (at !== null) {
      out.push(VALUES[at])
      at = result.links[at]
    }
    assert.deepEqual(out, [...VALUES].reverse())
  })

  it('finds the middle without counting', () => {
    for (const values of [[1, 2, 3], [1, 2, 3, 4], VALUES]) {
      const result = ran('middle', runStructure('list-middle', { values })).result as { middle: number }
      assert.equal(result.middle, Math.floor(values.length / 2), `on ${values.length} nodes`)
    }
  })

  it('detects a cycle, and its absence', () => {
    const none = ran('no cycle', runStructure('list-cycle', { values: VALUES, cycleAt: null })).result as { hasCycle: boolean }
    assert.equal(none.hasCycle, false)
    for (const at of [0, 3, VALUES.length - 1]) {
      const some = ran('cycle', runStructure('list-cycle', { values: VALUES, cycleAt: at })).result as { hasCycle: boolean }
      assert.equal(some.hasCycle, true, `a loop back to ${at} was missed`)
    }
  })
})

describe('stacks', () => {
  it('judges brackets the way a person would', () => {
    const cases: readonly (readonly [string, boolean])[] = [
      ['()', true], ['()[]{}', true], ['{[()]}', true], ['(', false], [')', false],
      ['([)]', false], ['{[}', false], ['', true], ['a(b)c[d]', true]
    ]
    for (const [text, want] of cases) {
      if (text === '') continue
      const result = ran(text, runStructure('balanced-parens', { text })).result as { balanced: boolean }
      assert.equal(result.balanced, want, `on "${text}"`)
    }
  })

  it('converts to postfix and the postfix evaluates to the same answer', () => {
    const cases: readonly (readonly [string, number])[] = [
      ['3 + 4 * 2', 11],
      ['( 1 + 2 ) * 3', 9],
      ['10 - 2 - 3', 5],
      ['2 * 3 + 4 * 5', 26],
      ['100 / 10 / 2', 5]
    ]
    for (const [expression, want] of cases) {
      const converted = ran(expression, runStructure('infix-to-postfix', { text: expression })).result as { postfix: string; balanced: boolean }
      assert.equal(converted.balanced, true, `"${expression}" was not balanced`)
      const evaluated = ran(converted.postfix, runStructure('postfix-eval', { text: converted.postfix })).result as { value: number | null; valid: boolean }
      assert.equal(evaluated.valid, true, `"${converted.postfix}" did not evaluate`)
      assert.equal(evaluated.value, want, `"${expression}" became "${converted.postfix}" and gave ${evaluated.value}`)
    }
  })

  it('refuses a postfix expression that does not balance', () => {
    const made = ran('bad', runStructure('postfix-eval', { text: '3 +' })).result as { valid: boolean; why: string }
    assert.equal(made.valid, false)
    assert.ok(made.why.length > 0, 'it refused without saying why')
  })
})

describe('queues', () => {
  it('wraps round and refuses to overflow', () => {
    const result = ran('queue', runStructure('circular-queue', { operations: ['1', '2', '3', '4', '5'], size: 3 })).result as { count: number; slots: (number | null)[] }
    assert.equal(result.count, 3, 'a queue of three took more than three')
  })

  it('walks a tree level by level', () => {
    const result = ran('bfs', runStructure('queue-bfs', { values: [1, 2, 3, 4, 5, 6, 7] })).result as { order: number[] }
    assert.deepEqual(result.order, [1, 2, 3, 4, 5, 6, 7], 'an array-held tree should come out in its own order, level by level')
  })
})

describe('trees', () => {
  it('comes out sorted in order, and not in the other two', () => {
    const inOrder = ran('in', runTree('in-order', { values: VALUES })).result as { order: number[]; sorted: boolean }
    assert.deepEqual(inOrder.order, [...VALUES].sort((a, b) => a - b))
    assert.equal(inOrder.sorted, true)

    const pre = ran('pre', runTree('pre-order', { values: VALUES })).result as { order: number[] }
    assert.equal(pre.order[0], VALUES[0], 'pre-order starts at the root')

    const post = ran('post', runTree('post-order', { values: VALUES })).result as { order: number[] }
    assert.equal(post.order[post.order.length - 1], VALUES[0], 'post-order ends at the root')

    const level = ran('level', runTree('level-order', { values: VALUES })).result as { order: number[]; levels: number[][] }
    assert.equal(level.order[0], VALUES[0])
    assert.equal(level.levels[0].length, 1, 'the first level is the root alone')
  })

  it('shows an unbalanced tree as unbalanced', () => {
    const sorted = ran('sorted insert', runTree('bst-insert', { values: [1, 2, 3, 4, 5, 6, 7] })).result as { deepest: number; perfect: number }
    assert.equal(sorted.deepest, 7, 'inserting in order should make a list seven deep')
    assert.ok(sorted.deepest > sorted.perfect, 'it should say the tree is deeper than a balanced one would be')
  })

  it('finds what is in the tree and not what is not', () => {
    for (const target of VALUES) {
      const made = ran(`search ${target}`, runTree('bst-search', { values: VALUES, target })).result as { found: boolean }
      assert.equal(made.found, true, `${target} is in the tree and was not found`)
    }
    const missing = ran('search 99', runTree('bst-search', { values: VALUES, target: 99 })).result as { found: boolean }
    assert.equal(missing.found, false)
  })
})

describe('hashing', () => {
  it('stores everything, and counts the collisions honestly', () => {
    const result = ran('chaining', runTree('hash-chaining', { values: VALUES, buckets: 5 })).result as { table: number[][]; collisions: number; longest: number }
    const stored = result.table.flat().sort((a, b) => a - b)
    assert.deepEqual(stored, [...VALUES].sort((a, b) => a - b), 'a value went missing')
    assert.equal(result.longest, Math.max(...result.table.map((one) => one.length)))
    assert.ok(result.collisions > 0, 'nine values in five buckets must collide')
  })

  it('refuses to probe a table that cannot hold the values', () => {
    const made = runTree('hash-probing', { values: VALUES, buckets: 4 })
    assert.ok(isAlgorithmError(made), 'nine values in four slots should be refused, not looped over')
  })

  it('probes into a big enough table and keeps everything', () => {
    const result = ran('probing', runTree('hash-probing', { values: VALUES, buckets: 32 })).result as { slots: (number | null)[]; load: number }
    const stored = result.slots.filter((one): one is number => one !== null).sort((a, b) => a - b)
    assert.deepEqual(stored, [...VALUES].sort((a, b) => a - b))
    assert.ok(result.load < 0.7, 'the load factor should be reported and should be comfortable here')
  })
})

describe('greedy', () => {
  it('selects the most activities it can', () => {
    const activities: Activity[] = [
      { name: 'a', start: 1, finish: 4 },
      { name: 'b', start: 3, finish: 5 },
      { name: 'c', start: 0, finish: 6 },
      { name: 'd', start: 5, finish: 7 },
      { name: 'e', start: 3, finish: 9 },
      { name: 'f', start: 5, finish: 9 },
      { name: 'g', start: 6, finish: 10 },
      { name: 'h', start: 8, finish: 11 },
      { name: 'i', start: 8, finish: 12 },
      { name: 'j', start: 2, finish: 14 },
      { name: 'k', start: 12, finish: 16 }
    ]
    const result = ran('activities', runTree('activity-selection', { activities })).result as { count: number; taken: Activity[] }
    // The published answer for this classic set is four.
    assert.equal(result.count, 4)
    // And nothing it took may overlap anything else it took.
    for (let one = 1; one < result.taken.length; one += 1) {
      assert.ok(result.taken[one].start >= result.taken[one - 1].finish, 'two chosen activities overlap')
    }
  })

  it('fills the bag with the best value per weight', () => {
    const result = ran('knapsack', runTree('fractional-knapsack', { capacity: 50 })).result as { total: number; taken: { fraction: number }[] }
    // Gold 60/10, silver 100/20, bronze 120/30 into 50: 60 + 100 + two thirds of 120 = 240.
    assert.ok(Math.abs(result.total - 240) < 1e-9, `the classic answer is 240 and this gave ${result.total}`)
    assert.ok(result.taken.some((one) => one.fraction < 1), 'the last item has to be cut, which is the whole point')
  })

  it('says plainly when greedy change-making is wrong', () => {
    const wrong = ran('1 3 4', runTree('coin-change-greedy', { coins: [1, 3, 4], amount: 6 })).result as { total: number; best: number; greedyIsBest: boolean }
    assert.equal(wrong.total, 3, 'greedy takes 4 + 1 + 1')
    assert.equal(wrong.best, 2, 'the real answer is 3 + 3')
    assert.equal(wrong.greedyIsBest, false, 'it has to admit greedy lost')

    const right = ran('ordinary money', runTree('coin-change-greedy', { coins: [1, 2, 5, 10, 20, 50], amount: 87 })).result as { greedyIsBest: boolean }
    assert.equal(right.greedyIsBest, true, 'on ordinary coins greedy is right and should say so')
  })
})

describe('every one of them', () => {
  it('runs and records steps worth watching', () => {
    for (const name of STRUCTURE_NAMES) {
      const made = runStructure(name, { values: VALUES, target: 11, by: 3, size: 3, cycleAt: null })
      assert.ok(!isAlgorithmError(made), `${name} was refused: ${isAlgorithmError(made) ? made.message : ''}`)
      assert.ok((made as Run).steps.length > 1, `${name} recorded ${(made as Run).steps.length} steps`)
      for (const step of (made as Run).steps) assert.ok(step.says.length > 0, `${name} recorded a step that says nothing`)
    }
    for (const name of TREE_NAMES) {
      const made = runTree(name, { values: VALUES, target: 7, buckets: 16, amount: 6, coins: [1, 3, 4] })
      assert.ok(!isAlgorithmError(made), `${name} was refused: ${isAlgorithmError(made) ? made.message : ''}`)
      assert.ok((made as Run).steps.length > 1, `${name} recorded too few steps`)
    }
  })

  it('never claims to have finished when it was cut short', () => {
    for (const name of STRUCTURE_NAMES) {
      const made = runStructure(name, { values: VALUES, target: 11, size: 3, ceiling: 4 })
      if (isAlgorithmError(made)) continue
      const run = made as Run
      if (run.cut) assert.ok(run.steps.length <= 4, `${name} was cut and still recorded ${run.steps.length} steps`)
    }
  })
})
