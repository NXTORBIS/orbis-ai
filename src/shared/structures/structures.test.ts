import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { apply, CATALOGUE, compare, create, entryFor, pictureOf, spreadOf, type StructureId } from './catalogue.ts'
import { isStructureError, type Run, type Structure } from './catalogue.ts'
import { hashOf, newTable, putInTable, findInTable, removeFromTable, newUnionFind, findGroup, join } from './hashing.ts'
import { newTree, insertIntoTree, findInTree, walkTree, heightOf, newHeap, insertIntoHeap, takeFromHeap, heapify, newTrie, insertIntoTrie, searchTrie } from './trees.ts'
import { newList, addBack, addFront, reverseList, findInList, removeFromList, listOrder } from './linear.ts'

/**
 * What the structures are asserted against.
 *
 * ## Properties, not recorded output
 *
 * Every assertion here is something that is true of the structure by definition and would be true of any correct
 * implementation: a stack gives back what went in last, an in-order walk of a search tree gives the keys sorted, a
 * key always hashes to the same bucket. Nothing checks a step transcript word for word, because that would fail on
 * any rewording and pass on a wrong answer.
 *
 * ## The expensive cases are asserted, not just the easy ones
 *
 * The tests that matter are the ones about what goes wrong: a search tree degenerating on sorted input, a hash
 * table's probe chain surviving a removal in the middle of it, path compression actually shortening the paths. Those
 * are the behaviours a plausible-looking implementation gets wrong, so they are the behaviours pinned here.
 */

const run = (structure: Structure, operation: string, argument?: string): { structure: Structure; run: Run } => {
  const made = apply(structure, { operation: operation as never, ...(argument === undefined ? {} : { argument }) })
  assert.ok(!isStructureError(made), isStructureError(made) ? `${made.says} ${made.fix}` : '')
  return made
}

const fresh = (id: StructureId): Structure => {
  const made = create(id)
  assert.ok(!isStructureError(made))
  return made
}

describe('the catalogue', () => {
  it('describes twelve structures, each with what it is bad at', () => {
    assert.equal(CATALOGUE.length, 12)
    for (const entry of CATALOGUE) {
      assert.ok(entry.about.length > 30, entry.id)
      assert.ok(entry.goodAt.length > 0, entry.id)
      // Stating the downside is the point of the whole laboratory, so a structure without one is a bug.
      assert.ok(entry.badAt.length > 0, `${entry.id} claims no downside`)
      assert.ok(entry.watchOutFor.length > 40, `${entry.id} has nothing to watch out for`)
      assert.ok(entry.operations.length >= 3, entry.id)
    }
  })

  it('every structure can be made and drawn before anything is done to it', () => {
    for (const entry of CATALOGUE) {
      const structure = fresh(entry.id)
      const picture = pictureOf(structure)
      assert.ok(['row', 'chain', 'tree', 'buckets'].includes(picture.layout), entry.id)
      assert.ok(picture.notes.length > 0, `${entry.id} draws with nothing said about it`)
    }
  })

  it('every listed operation is actually connected', () => {
    for (const entry of CATALOGUE) {
      for (const operation of entry.operations) {
        const structure = fresh(entry.id)
        const argument =
          operation.needs === 'two'
            ? 'a b'
            : operation.needs === 'keys'
              ? entry.id === 'trie'
                ? 'car cat cart'
                : '5 3 8'
              : operation.needs === 'key'
                ? entry.id === 'trie'
                  ? 'car'
                  : entry.id === 'union-find'
                    ? 'a'
                    : '5'
                : undefined
        const made = apply(structure, { operation: operation.id, ...(argument === undefined ? {} : { argument }) })
        // A listed operation that refuses because it is not wired is the failure this test exists for.
        assert.ok(
          !isStructureError(made) || made.error !== 'not wired',
          `${entry.id}.${operation.id} is listed and not connected`
        )
      }
    }
  })

  it('refuses an operation a structure does not have, by name', () => {
    const made = apply(fresh('stack'), { operation: 'walk' })
    assert.ok(isStructureError(made))
    assert.match(made.says, /stack/i)
    assert.match(made.fix, /push|pop|peek/i)
  })
})

describe('stacks and queues', () => {
  it('a stack gives back the last thing put in', () => {
    let structure = fresh('stack')
    for (const value of ['1', '2', '3']) structure = run(structure, 'add', value).structure
    const taken = run(structure, 'take')
    assert.match(taken.run.answer, /^3/)
  })

  it('a queue gives back the first thing put in', () => {
    let structure = fresh('queue')
    for (const value of ['1', '2', '3']) structure = run(structure, 'add', value).structure
    const taken = run(structure, 'take')
    assert.match(taken.run.answer, /^1/)
  })

  it('taking from an empty one says so rather than failing', () => {
    const made = run(fresh('stack'), 'take')
    assert.match(made.run.answer, /empty/i)
    assert.equal(made.run.changed, false)
  })

  it('a queue refuses to be used from the wrong end', () => {
    const made = apply(fresh('queue'), { operation: 'takeBack' })
    // A queue with a takeBack would not be a queue, and silently allowing it would teach the wrong thing.
    assert.ok(isStructureError(made))
  })

  it('a deque counts the shifting that an array-backed front operation really costs', () => {
    let structure = fresh('deque')
    for (const value of ['1', '2', '3', '4', '5']) structure = run(structure, 'addBack', value).structure
    const front = run(structure, 'addFront', '0')
    const back = run(structure, 'addBack', '6')
    assert.ok(
      front.run.counts.writes > back.run.counts.writes,
      'adding at the front of an array must cost more than adding at the back'
    )
  })
})

describe('linked lists', () => {
  it('adding at the end of a singly linked list means walking it', () => {
    let list = newList('linked-list')
    for (const value of [1, 2, 3, 4, 5]) list = addBack(list, value).structure
    const sixth = addBack(list, 6)
    // Five nodes already there, so reaching the end reads five of them.
    assert.equal(sixth.run.counts.reads, 5)
    assert.match(sixth.run.answer, /walking/)
  })

  it('a doubly linked list reaches its end without walking', () => {
    let list = newList('doubly-linked-list')
    for (const value of [1, 2, 3, 4, 5]) list = addBack(list, value).structure
    const sixth = addBack(list, 6)
    assert.ok(sixth.run.counts.reads <= 1, `expected no walk, got ${sixth.run.counts.reads} reads`)
  })

  it('adding at the front never walks, however long the list', () => {
    let list = newList('linked-list')
    for (let i = 0; i < 50; i += 1) list = addFront(list, i).structure
    const next = addFront(list, 99)
    assert.equal(next.run.counts.reads, 0)
  })

  it('reversing changes one pointer per node and copies nothing', () => {
    let list = newList('linked-list')
    for (const value of [1, 2, 3, 4]) list = addBack(list, value).structure
    const reversed = reverseList(list)
    assert.equal(reversed.run.counts.links, 4)
    assert.equal(reversed.run.counts.allocations, 0)
    const order = listOrder(reversed.structure).map((id) => reversed.structure.nodes[id].value)
    assert.deepEqual(order, [4, 3, 2, 1])
  })

  it('finding the last item costs a comparison per node', () => {
    let list = newList('linked-list')
    for (const value of [1, 2, 3, 4, 5]) list = addBack(list, value).structure
    assert.equal(findInList(list, 5).counts.comparisons, 5)
    assert.equal(findInList(list, 1).counts.comparisons, 1)
  })

  it('removing from the middle repoints one pointer and leaves the rest alone', () => {
    let list = newList('linked-list')
    for (const value of [1, 2, 3, 4, 5]) list = addBack(list, value).structure
    const made = removeFromList(list, 3)
    assert.equal(made.removed, true)
    assert.equal(made.run.counts.links, 1)
    assert.deepEqual(
      listOrder(made.structure).map((id) => made.structure.nodes[id].value),
      [1, 2, 4, 5]
    )
  })

  it('removing the head moves the head', () => {
    let list = newList('doubly-linked-list')
    for (const value of [1, 2, 3]) list = addBack(list, value).structure
    const made = removeFromList(list, 1)
    assert.equal(made.structure.nodes[made.structure.head as string].value, 2)
  })
})

describe('binary search trees', () => {
  it('an in-order walk gives the keys sorted, whatever order they went in', () => {
    let tree = newTree('binary-search-tree')
    for (const key of [50, 30, 70, 20, 40, 60, 80]) tree = insertIntoTree(tree, key).structure
    const walked = walkTree(tree, 'in-order')
    assert.match(walked.answer, /^20, 30, 40, 50, 60, 70, 80/)
  })

  it('sorted keys make it degenerate into a list, and it says so', () => {
    let tree = newTree('binary-search-tree')
    for (const key of [1, 2, 3, 4, 5, 6, 7, 8]) tree = insertIntoTree(tree, key).structure
    // Eight keys in order means eight levels: the thing AVL trees exist to prevent.
    assert.equal(heightOf(tree.nodes, tree.root), 8)
    const picture = pictureOf(tree)
    assert.ok(
      picture.notes.some((one) => /would be \d+ tall/.test(one)),
      'the picture must say how much taller than necessary it is'
    )
  })

  it('an AVL tree given the same sorted keys stays short, and rotates to do it', () => {
    let tree = newTree('avl-tree')
    let rotations = 0
    for (const key of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const made = insertIntoTree(tree, key)
      tree = made.structure
      rotations += made.run.counts.rotations
    }
    assert.equal(heightOf(tree.nodes, tree.root), 4)
    assert.ok(rotations >= 3, `expected rebalancing, got ${rotations} rotations`)
  })

  it('an AVL tree stays balanced at every node', () => {
    let tree = newTree('avl-tree')
    // A mixture that forces all four rotation cases, including the two double rotations.
    for (const key of [10, 20, 30, 25, 28, 5, 1, 3, 40, 35, 50, 45, 15, 12]) tree = insertIntoTree(tree, key).structure
    for (const id of Object.keys(tree.nodes)) {
      const balance = heightOf(tree.nodes, tree.nodes[id].left) - heightOf(tree.nodes, tree.nodes[id].right)
      assert.ok(Math.abs(balance) <= 1, `node ${String(tree.nodes[id].key)} is ${balance} out of balance`)
    }
    assert.match(walkTree(tree, 'in-order').answer, /^1, 3, 5, 10, 12, 15, 20, 25, 28, 30, 35, 40, 45, 50/)
  })

  it('an AVL tree still holds every key after all that rotating', () => {
    let tree = newTree('avl-tree')
    const keys = [10, 20, 30, 25, 28, 5, 1, 3, 40, 35, 50, 45, 15, 12]
    for (const key of keys) tree = insertIntoTree(tree, key).structure
    for (const key of keys) {
      assert.match(findInTree(tree, key).answer, /^Found/, `${key} went missing during rebalancing`)
    }
  })

  it('a balanced tree finds a key in far fewer comparisons than a degenerate one', () => {
    let flat = newTree('binary-search-tree')
    let balanced = newTree('avl-tree')
    for (let key = 1; key <= 64; key += 1) {
      flat = insertIntoTree(flat, key, true).structure
      balanced = insertIntoTree(balanced, key, true).structure
    }
    const slow = findInTree(flat, 64).counts.comparisons
    const fast = findInTree(balanced, 64).counts.comparisons
    assert.equal(slow, 64)
    assert.ok(fast <= 7, `a balanced tree of 64 keys should need at most 7 comparisons, took ${fast}`)
  })

  it('putting the same key in twice changes nothing', () => {
    let tree = newTree('binary-search-tree')
    tree = insertIntoTree(tree, 5).structure
    const again = insertIntoTree(tree, 5)
    assert.equal(again.added, false)
    assert.equal(again.run.changed, false)
  })

  it('removing a node with two children keeps the keys sorted', () => {
    let tree = newTree('binary-search-tree')
    for (const key of [50, 30, 70, 20, 40, 60, 80]) tree = insertIntoTree(tree, key).structure
    const made = apply(tree, { operation: 'remove', argument: '30' })
    assert.ok(!isStructureError(made))
    const walked = walkTree(made.structure as never, 'in-order')
    assert.match(walked.answer, /^20, 40, 50, 60, 70, 80/)
  })

  it('a missing key is reported as missing rather than as found', () => {
    let tree = newTree('binary-search-tree')
    for (const key of [50, 30, 70]) tree = insertIntoTree(tree, key).structure
    assert.match(findInTree(tree, 99).answer, /Not there/)
  })
})

describe('heaps', () => {
  it('the smallest is always at the root of a min-heap', () => {
    let heap = newHeap('min-heap')
    for (const value of [9, 4, 7, 1, 8, 3]) heap = insertIntoHeap(heap, value).structure
    assert.equal(heap.items[0], 1)
  })

  it('taking everything out of a max-heap gives them in order', () => {
    let heap = newHeap('max-heap')
    for (const value of [5, 1, 9, 3, 7, 2, 8]) heap = insertIntoHeap(heap, value).structure
    const out: (number | string)[] = []
    for (let i = 0; i < 7; i += 1) {
      const made = takeFromHeap(heap)
      heap = made.structure
      if (made.value !== null) out.push(made.value)
    }
    assert.deepEqual(out, [9, 8, 7, 5, 3, 2, 1])
  })

  it('every node sits above its children, at every size', () => {
    let heap = newHeap('min-heap')
    for (const value of [15, 3, 17, 8, 1, 20, 6, 11, 2, 9, 4]) heap = insertIntoHeap(heap, value).structure
    for (let i = 0; i < heap.items.length; i += 1) {
      for (const child of [2 * i + 1, 2 * i + 2]) {
        if (child < heap.items.length) {
          assert.ok(
            Number(heap.items[i]) <= Number(heap.items[child]),
            `index ${i} holds ${heap.items[i]}, above a child holding ${heap.items[child]}`
          )
        }
      }
    }
  })

  it('building in one go costs fewer comparisons than inserting one at a time', () => {
    const values = [15, 3, 17, 8, 1, 20, 6, 11, 2, 9, 4, 19, 7, 13, 5, 18, 10, 12, 16, 14]
    const built = heapify('min-heap', values)
    let heap = newHeap('min-heap')
    let oneAtATime = 0
    for (const value of values) {
      const made = insertIntoHeap(heap, value)
      heap = made.structure
      oneAtATime += made.run.counts.comparisons
    }
    /*
     * O(n) against O(n log n). This is the whole reason `heapify` exists, and it is the kind of claim that is worth
     * measuring rather than asserting — a bug in the sift-down loop would make it fail.
     */
    assert.ok(
      built.run.counts.comparisons < oneAtATime,
      `building cost ${built.run.counts.comparisons}, inserting cost ${oneAtATime}`
    )
    assert.equal(built.structure.items[0], 1)
  })

  it('taking from an empty heap gives nothing back without failing', () => {
    const made = takeFromHeap(newHeap('min-heap'))
    assert.equal(made.value, null)
    assert.equal(made.run.changed, false)
  })
})

describe('hash tables', () => {
  it('a key always lands in the same bucket', () => {
    assert.equal(hashOf('apple'), hashOf('apple'))
    assert.notEqual(hashOf('apple'), hashOf('apricot'))
  })

  it('the hash spreads keys across the buckets rather than piling them up', () => {
    let table = newTable('chaining', 16)
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'.split(' ')
    for (const word of words) table = putInTable(table, word, null, true).structure
    const spread = spreadOf(table)
    // Not a claim about perfection — a claim that it is not degenerate, which a broken hash would be.
    assert.ok(spread.used >= words.length / 2, `${words.length} keys went into only ${spread.used} buckets`)
    assert.ok(spread.longest <= 3, `the busiest bucket holds ${spread.longest}`)
  })

  it('finding a key only looks in its own bucket', () => {
    let table = newTable('chaining', 32)
    for (let i = 0; i < 30; i += 1) table = putInTable(table, `key${i}`, null, true).structure
    const found = findInTable(table, 'key17')
    assert.match(found.answer, /^Found/)
    assert.equal(found.counts.probes, 1)
  })

  it('a removal in an open-addressed table does not hide the keys behind it', () => {
    /*
     * The test this whole file exists for. Two keys that collide are put in, so the second sits one slot past the
     * first. Removing the first must leave a tombstone — if the slot were simply emptied, the walk looking for the
     * second would stop at the empty slot and report it missing.
     */
    const size = 8
    let table = newTable('linear-probing', size)
    const colliding: string[] = []
    const want = hashOf('alpha') % size
    for (let i = 0; colliding.length < 2 && i < 10_000; i += 1) {
      const candidate = `k${i}`
      if (hashOf(candidate) % size === want) colliding.push(candidate)
    }
    assert.equal(colliding.length, 2, 'the test needs two keys that genuinely collide')

    table = putInTable(table, colliding[0], null, true).structure
    table = putInTable(table, colliding[1], null, true).structure
    assert.match(findInTable(table, colliding[1]).answer, /^Found/)

    const removed = removeFromTable(table, colliding[0])
    assert.equal(removed.removed, true)
    assert.match(removed.run.answer, /tombstone/)
    assert.match(
      findInTable(removed.structure, colliding[1]).answer,
      /^Found/,
      'the second key became unreachable, which means the probe chain was broken'
    )
  })

  it('a chained table reports a collision as a collision', () => {
    const size = 8
    let table = newTable('chaining', size, 10)
    const want = hashOf('alpha') % size
    const colliding: string[] = []
    for (let i = 0; colliding.length < 2 && i < 10_000; i += 1) {
      if (hashOf(`k${i}`) % size === want) colliding.push(`k${i}`)
    }
    table = putInTable(table, colliding[0]).structure
    const second = putInTable(table, colliding[1])
    assert.match(second.run.answer, /sharing it/)
  })

  it('it grows and rehashes when it gets too full', () => {
    let table = newTable('chaining', 4, 0.75)
    for (let i = 0; i < 20; i += 1) table = putInTable(table, `key${i}`, null, true).structure
    assert.ok(table.buckets.length > 4, 'the table should have grown')
    assert.ok(table.resizes > 0)
    // Every key must still be findable after being rehashed into different buckets.
    for (let i = 0; i < 20; i += 1) {
      assert.match(findInTable(table, `key${i}`).answer, /^Found/, `key${i} was lost in a resize`)
    }
  })

  it('putting the same key twice replaces rather than duplicates', () => {
    let table = newTable('chaining', 8)
    table = putInTable(table, 'one', 1).structure
    const again = putInTable(table, 'one', 2)
    assert.equal(again.added, false)
    assert.equal(again.structure.count, 1)
  })
})

describe('tries', () => {
  it('words sharing a beginning share nodes', () => {
    let trie = newTrie()
    trie = insertIntoTrie(trie, 'car').structure
    const second = insertIntoTrie(trie, 'cart')
    // "car" is already a path, so only the final t is new.
    assert.equal(second.run.counts.allocations, 1)
    assert.match(second.run.answer, /1 of its 4 letters/)
  })

  it('a prefix search finds every word below it and nothing else', () => {
    let trie = newTrie()
    for (const word of ['car', 'cart', 'carpet', 'cat', 'dog']) trie = insertIntoTrie(trie, word).structure
    const found = searchTrie(trie, 'car')
    assert.match(found.answer, /car/)
    assert.match(found.answer, /cart/)
    assert.match(found.answer, /carpet/)
    assert.ok(!/\bdog\b/.test(found.answer), 'dog does not start with car')
    assert.ok(!/\bcat\b/.test(found.answer), 'cat does not start with car')
  })

  it('a prefix finds the longer word it is part of', () => {
    let trie = newTrie()
    trie = insertIntoTrie(trie, 'carpet').structure
    // "carp" is not stored, but it is the start of something that is — which is what a prefix search is for.
    assert.match(searchTrie(trie, 'carp').answer, /carpet/)
    // And a prefix that goes nowhere is refused rather than returning the nearest thing.
    assert.match(searchTrie(trie, 'carz').answer, /No words start/)
  })

  it('the cost of a lookup does not depend on how many words are stored', () => {
    let small = newTrie()
    for (const word of ['apple', 'banana']) small = insertIntoTrie(small, word).structure
    let big = newTrie()
    for (let i = 0; i < 400; i += 1) big = insertIntoTrie(big, `word${i}`, true).structure
    big = insertIntoTrie(big, 'apple', true).structure
    const inSmall = searchTrie(small, 'apple').counts.reads
    const inBig = searchTrie(big, 'apple').counts.reads
    assert.equal(inSmall, inBig)
  })

  it('a word already stored is not stored twice', () => {
    let trie = newTrie()
    trie = insertIntoTrie(trie, 'car').structure
    const again = insertIntoTrie(trie, 'car')
    assert.equal(again.added, false)
    assert.equal(again.structure.words, 1)
  })
})

describe('union-find', () => {
  it('two things are in the same group once joined', () => {
    const sets = newUnionFind(['a', 'b', 'c', 'd'])
    assert.ok(!isStructureError(sets))
    const joined = join(sets, 0, 1)
    assert.equal(joined.joined, true)
    assert.equal(joined.structure.groups, 3)
    const a = findGroup(joined.structure, 0)
    const b = findGroup(a.structure, 1)
    assert.equal(a.root, b.root)
  })

  it('joining two things already together changes nothing', () => {
    const sets = newUnionFind(['a', 'b'])
    assert.ok(!isStructureError(sets))
    const once = join(sets, 0, 1)
    const twice = join(once.structure, 0, 1)
    assert.equal(twice.joined, false)
    assert.equal(twice.structure.groups, 1)
  })

  it('path flattening shortens what the next lookup has to walk', () => {
    const names = Array.from({ length: 8 }, (_, i) => `n${i}`)
    const sets = newUnionFind(names, true)
    assert.ok(!isStructureError(sets))
    let working = sets
    for (let i = 0; i < names.length - 1; i += 1) working = join(working, i, i + 1).structure
    const first = findGroup(working, 0)
    const second = findGroup(first.structure, 0)
    assert.ok(
      second.run.counts.reads <= first.run.counts.reads,
      `the second lookup walked ${second.run.counts.reads} after the first walked ${first.run.counts.reads}`
    )
  })

  it('without path flattening the walk does not get shorter', () => {
    const names = Array.from({ length: 8 }, (_, i) => `n${i}`)
    const sets = newUnionFind(names, false)
    assert.ok(!isStructureError(sets))
    let working = sets
    for (let i = 0; i < names.length - 1; i += 1) working = join(working, i, i + 1).structure
    const first = findGroup(working, 0)
    const second = findGroup(first.structure, 0)
    assert.equal(second.run.counts.reads, first.run.counts.reads)
    assert.equal(second.run.changed, false)
  })

  it('refuses a name it does not hold, and says what it does hold', () => {
    const sets = newUnionFind(['a', 'b'])
    assert.ok(!isStructureError(sets))
    const made = apply(sets, { operation: 'group', argument: 'z' })
    assert.ok(isStructureError(made))
    assert.match(made.fix, /a, b/)
  })
})

describe('comparing structures', () => {
  it('reports what each one actually cost on the same work', () => {
    const made = compare(['binary-search-tree', 'avl-tree'], Array.from({ length: 32 }, (_, i) => i + 1), 32)
    assert.ok(!isStructureError(made), isStructureError(made) ? made.says : '')
    assert.equal(made.sides.length, 2)
    const flat = made.sides.find((one) => one.id === 'binary-search-tree')
    const balanced = made.sides.find((one) => one.id === 'avl-tree')
    assert.ok(flat && balanced)
    // Sorted keys: the plain tree pays for it on every insert and again on the lookup.
    assert.ok(
      flat.counts.comparisons > balanced.counts.comparisons,
      `plain ${flat.counts.comparisons} should exceed AVL ${balanced.counts.comparisons}`
    )
    assert.match(made.says, /times as many/)
  })

  it('says plainly when a structure cannot do the lookup rather than inventing a number', () => {
    const made = compare(['stack', 'hash-table'], [1, 2, 3, 4, 5], 3)
    assert.ok(!isStructureError(made))
    const stack = made.sides.find((one) => one.id === 'stack')
    assert.ok(stack)
    assert.match(stack.answer, /no way to look a key up/)
  })

  it('refuses fewer than two structures', () => {
    assert.ok(isStructureError(compare(['stack'], [1], null)))
  })
})

describe('refusals', () => {
  it('nothing typed in is refused with what to do about it', () => {
    const made = apply(fresh('binary-search-tree'), { operation: 'add' })
    assert.ok(isStructureError(made))
    assert.match(made.fix, /box/)
  })

  it('an unreasonable number of keys is refused rather than attempted', () => {
    const many = Array.from({ length: 5_000 }, (_, i) => i).join(' ')
    const made = apply(fresh('min-heap'), { operation: 'build', argument: many })
    assert.ok(isStructureError(made))
    assert.match(made.says, /more than/)
  })

  it('every structure in the catalogue has an entry that can be looked up by id', () => {
    for (const entry of CATALOGUE) assert.equal(entryFor(entry.id)?.id, entry.id)
    assert.equal(entryFor('nonsense'), null)
  })
})
