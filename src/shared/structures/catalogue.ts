import { isStructureError, readKeys, refuse, type Run, type Snapshot, type StructureError } from './model.ts'
import {
  addBack,
  addFront,
  addLinear,
  findInList,
  linearPicture,
  listPicture,
  newLinear,
  newList,
  peekLinear,
  removeFromList,
  reverseList,
  takeLinear,
  type Linear,
  type LinkedList
} from './linear.ts'
import {
  findInTree,
  heapPicture,
  heapify,
  insertIntoHeap,
  insertIntoTree,
  insertIntoTrie,
  newHeap,
  newTree,
  newTrie,
  removeFromTree,
  searchTrie,
  takeFromHeap,
  treePicture,
  triePicture,
  walkTree,
  type BinaryTree,
  type Heap,
  type Trie,
  type Walk
} from './trees.ts'
import {
  findGroup,
  findInTable,
  join,
  newTable,
  newUnionFind,
  putInTable,
  removeFromTable,
  spreadOf,
  tablePicture,
  unionPicture,
  type Collisions,
  type HashTable,
  type UnionFind
} from './hashing.ts'

/**
 * One door over every data structure.
 *
 * ## Why a single `apply`
 *
 * Twelve structures with four to six operations each is sixty-odd functions, and a laboratory that called them
 * directly would need to know which ones exist for which structure — so the knowledge would live in the renderer and
 * in Orion's instructions and in the worker, and the three would drift. Instead every structure reports which
 * operations it has, `apply` is the only way to run one, and an operation a structure does not have is refused with a
 * reason rather than silently doing nothing.
 *
 * This is the same shape as `algorithms/catalogue.ts`, deliberately, because the two laboratories are siblings.
 */

export type StructureId =
  | 'stack'
  | 'queue'
  | 'deque'
  | 'linked-list'
  | 'doubly-linked-list'
  | 'binary-search-tree'
  | 'avl-tree'
  | 'min-heap'
  | 'max-heap'
  | 'hash-table'
  | 'trie'
  | 'union-find'

export type Structure = Linear | LinkedList | BinaryTree | Heap | Trie | HashTable | UnionFind

export type OperationId =
  | 'add'
  | 'addFront'
  | 'addBack'
  | 'take'
  | 'takeFront'
  | 'takeBack'
  | 'peek'
  | 'find'
  | 'remove'
  | 'reverse'
  | 'walk'
  | 'build'
  | 'startsWith'
  | 'group'
  | 'join'

export interface Operation {
  id: OperationId
  name: string
  /** What it is for, said plainly. */
  about: string
  /** Whether it needs a value typed in. */
  needs: 'key' | 'keys' | 'two' | 'walk' | 'nothing'
  /** Its real cost, as computer science states it. The measured counts sit beside this in the laboratory. */
  costs: string
}

export interface Entry {
  id: StructureId
  name: string
  /** What it is, in one sentence somebody who has not met it would understand. */
  about: string
  /** What it is genuinely good at. */
  goodAt: readonly string[]
  /** What it is bad at. Present on every structure, because the trade-off *is* the subject. */
  badAt: readonly string[]
  operations: readonly Operation[]
  /** Stated costs, per operation name. */
  complexity: Readonly<Record<string, string>>
  /** The thing that goes wrong with it, which the laboratory can be made to show. */
  watchOutFor: string
}

const op = (id: OperationId, name: string, about: string, needs: Operation['needs'], costs: string): Operation => ({
  id,
  name,
  about,
  needs,
  costs
})

export const CATALOGUE: readonly Entry[] = Object.freeze([
  {
    id: 'stack',
    name: 'Stack',
    about: 'A pile. Things go on the top and come off the top, so the last thing in is the first thing out.',
    goodAt: ['Undo histories', 'Working backwards out of somewhere', 'Keeping track of what to come back to'],
    badAt: ['Getting at anything that is not on top', 'Fairness — the oldest item waits forever'],
    operations: Object.freeze([
      op('add', 'Push', 'Put something on the top.', 'key', 'O(1)'),
      op('take', 'Pop', 'Take the top one off.', 'nothing', 'O(1)'),
      op('peek', 'Peek', 'Look at the top without taking it.', 'nothing', 'O(1)')
    ]),
    complexity: Object.freeze({ Push: 'O(1)', Pop: 'O(1)', Peek: 'O(1)', Find: 'O(n)' }),
    watchOutFor: 'A stack never runs out of room on paper, but a real one does, and a recursion that never stops is how you find that out.'
  },
  {
    id: 'queue',
    name: 'Queue',
    about: 'A line. Things join the back and leave the front, so the first thing in is the first thing out.',
    goodAt: ['Anything that should be dealt with in order', 'Handing work to a worker', 'Walking a tree level by level'],
    badAt: ['Getting at the middle', 'Letting anything jump ahead'],
    operations: Object.freeze([
      op('add', 'Enqueue', 'Join the back of the line.', 'key', 'O(1)'),
      op('take', 'Dequeue', 'Take the one at the front.', 'nothing', 'O(1) amortised'),
      op('peek', 'Peek', 'Look at the front without taking it.', 'nothing', 'O(1)')
    ]),
    complexity: Object.freeze({ Enqueue: 'O(1)', Dequeue: 'O(1)', Peek: 'O(1)', Find: 'O(n)' }),
    watchOutFor:
      'Taking from the front of a plain array shifts everything along, which is O(n). A real queue keeps two indices, or uses a linked list, so this one counts the shifting honestly.'
  },
  {
    id: 'deque',
    name: 'Double-ended queue',
    about: 'A line that can be joined or left at either end.',
    goodAt: ['Sliding windows', 'Undo and redo together', 'Anything needing both ends'],
    badAt: ['The middle, same as the others'],
    operations: Object.freeze([
      op('addFront', 'Add at front', 'Put something at the front.', 'key', 'O(n) here'),
      op('addBack', 'Add at back', 'Put something at the back.', 'key', 'O(1)'),
      op('takeFront', 'Take from front', 'Take the front one.', 'nothing', 'O(n) here'),
      op('takeBack', 'Take from back', 'Take the back one.', 'nothing', 'O(1)'),
      op('peek', 'Peek', 'Look without taking.', 'nothing', 'O(1)')
    ]),
    complexity: Object.freeze({
      'Add at front': 'O(1) with a ring buffer, O(n) backed by a plain array',
      'Add at back': 'O(1)',
      'Take from front': 'O(1) with a ring buffer, O(n) backed by a plain array'
    }),
    watchOutFor:
      'This one is backed by a plain array, so working at the front shifts everything. A real deque uses a ring buffer and both ends cost the same. The counts here show the difference rather than hiding it.'
  },
  {
    id: 'linked-list',
    name: 'Linked list',
    about: 'A chain of boxes, each holding a value and the address of the next one. There is no index.',
    goodAt: ['Adding or removing at the front', 'Splicing something out when you already hold it', 'Growing without copying'],
    badAt: ['Reaching the tenth item — you have to walk', 'Anything needing to jump about', 'Memory, since every value costs a pointer too'],
    operations: Object.freeze([
      op('addFront', 'Add at front', 'Make a node and point it at the old head.', 'key', 'O(1)'),
      op('addBack', 'Add at end', 'Walk to the end, then point the last node at a new one.', 'key', 'O(n)'),
      op('find', 'Find', 'Walk from the head comparing.', 'key', 'O(n)'),
      op('remove', 'Remove', 'Find it, then point the node before it past it.', 'key', 'O(n)'),
      op('reverse', 'Reverse', 'Turn every pointer the other way.', 'nothing', 'O(n), no copying')
    ]),
    complexity: Object.freeze({
      'Add at front': 'O(1)',
      'Add at end': 'O(n)',
      Find: 'O(n)',
      Remove: 'O(n) to find, O(1) to unhook',
      Reverse: 'O(n)'
    }),
    watchOutFor:
      'The appeal is "inserting is cheap", but only once you are standing at the right place. Getting there is the expensive part, and the counts here separate the two.'
  },
  {
    id: 'doubly-linked-list',
    name: 'Doubly linked list',
    about: 'A chain where every box points both forward and back, and the end is remembered.',
    goodAt: ['Both ends cheaply', 'Walking either direction', 'Removing a node you are already holding'],
    badAt: ['Memory — two pointers per value', 'Still no indexing'],
    operations: Object.freeze([
      op('addFront', 'Add at front', 'One allocation, two pointers.', 'key', 'O(1)'),
      op('addBack', 'Add at end', 'The tail pointer goes straight there.', 'key', 'O(1)'),
      op('find', 'Find', 'Still a walk.', 'key', 'O(n)'),
      op('remove', 'Remove', 'Repoint both neighbours.', 'key', 'O(n) to find'),
      op('reverse', 'Reverse', 'Swap every pair of pointers.', 'nothing', 'O(n)')
    ]),
    complexity: Object.freeze({ 'Add at front': 'O(1)', 'Add at end': 'O(1)', Find: 'O(n)', Remove: 'O(1) once found' }),
    watchOutFor:
      'Twice the pointers for one cheap operation. Compare adding at the end here against the singly linked version — that gap is the whole reason this exists.'
  },
  {
    id: 'binary-search-tree',
    name: 'Binary search tree',
    about:
      'Every node holds a key, with smaller keys to its left and larger to its right, so looking something up means going down one path.',
    goodAt: ['Looking up, adding and removing, all in about the same time', 'Giving the keys back in order for free', 'Finding the next key up or down'],
    badAt: ['Keys arriving in order — then it is just a list', 'Guaranteeing anything, since nothing keeps it balanced'],
    operations: Object.freeze([
      op('build', 'Build from keys', 'Put several keys in, in the order given.', 'keys', 'O(n log n) if balanced, O(n²) if sorted'),
      op('add', 'Insert', 'Walk down comparing, then hang it off the bottom.', 'key', 'O(height)'),
      op('find', 'Find', 'Walk down comparing.', 'key', 'O(height)'),
      op('remove', 'Remove', 'Unhook it, or replace it with the next key up.', 'key', 'O(height)'),
      op('walk', 'Walk', 'Visit every node in an order.', 'walk', 'O(n)')
    ]),
    complexity: Object.freeze({
      Insert: 'O(log n) balanced, O(n) in the worst case',
      Find: 'O(log n) balanced, O(n) in the worst case',
      Remove: 'O(log n) balanced, O(n) in the worst case',
      Walk: 'O(n)'
    }),
    watchOutFor:
      'Build one from 1, 2, 3, 4, 5 and look at the height. Every node has only a right child, so it is a linked list and every lookup walks the whole thing. That is what AVL trees are for.'
  },
  {
    id: 'avl-tree',
    name: 'AVL tree',
    about:
      'A binary search tree that measures how lopsided each node is and rotates itself whenever one gets more than one level out of balance.',
    goodAt: ['Guaranteeing a short tree whatever order the keys arrive in', 'Everything a search tree is good at, reliably'],
    badAt: ['Insertion, slightly — the rebalancing is real work', 'Code complexity, considerably'],
    operations: Object.freeze([
      op('build', 'Build from keys', 'Put several keys in, rebalancing as it goes.', 'keys', 'O(n log n)'),
      op('add', 'Insert', 'Insert, then rotate back up the path where needed.', 'key', 'O(log n)'),
      op('find', 'Find', 'Same walk as a plain tree, but the tree is short.', 'key', 'O(log n)'),
      op('remove', 'Remove', 'Remove, then rebalance.', 'key', 'O(log n)'),
      op('walk', 'Walk', 'Visit every node in an order.', 'walk', 'O(n)')
    ]),
    complexity: Object.freeze({ Insert: 'O(log n) guaranteed', Find: 'O(log n) guaranteed', Remove: 'O(log n) guaranteed' }),
    watchOutFor:
      'Build this from 1, 2, 3, 4, 5 too. It rotates as it goes and stays short — which is the comparison worth making, and the rotation count is what it cost.'
  },
  {
    id: 'min-heap',
    name: 'Min-heap',
    about:
      'A tree kept in an array, where every node is smaller than its children — so the smallest thing is always at the front, but nothing else is sorted.',
    goodAt: ['Always knowing the smallest', 'Priority queues', 'Scheduling'],
    badAt: ['Looking up anything but the smallest', 'Giving things back in order without emptying it'],
    operations: Object.freeze([
      op('build', 'Build from keys', 'Heapify an array in place, from the middle backwards.', 'keys', 'O(n)'),
      op('add', 'Insert', 'Put it on the end and let it rise.', 'key', 'O(log n)'),
      op('take', 'Take smallest', 'Take the root, move the last item up, let it sink.', 'nothing', 'O(log n)'),
      op('peek', 'Peek', 'The root, without taking it.', 'nothing', 'O(1)')
    ]),
    complexity: Object.freeze({ Insert: 'O(log n)', 'Take smallest': 'O(log n)', Peek: 'O(1)', 'Build from keys': 'O(n)' }),
    watchOutFor:
      'Building in one go is O(n), but inserting the same keys one at a time is O(n log n). Try both and compare the comparison counts — the difference is real and surprising.'
  },
  {
    id: 'max-heap',
    name: 'Max-heap',
    about: 'The same thing the other way up: the largest is always at the front.',
    goodAt: ['Always knowing the largest', 'Heapsort', 'Keeping the top few of something'],
    badAt: ['Everything a min-heap is bad at'],
    operations: Object.freeze([
      op('build', 'Build from keys', 'Heapify in place.', 'keys', 'O(n)'),
      op('add', 'Insert', 'Put it on the end and let it rise.', 'key', 'O(log n)'),
      op('take', 'Take largest', 'Take the root and sink the replacement.', 'nothing', 'O(log n)'),
      op('peek', 'Peek', 'The root.', 'nothing', 'O(1)')
    ]),
    complexity: Object.freeze({ Insert: 'O(log n)', 'Take largest': 'O(log n)', Peek: 'O(1)' }),
    watchOutFor: 'Taking everything out of a max-heap one at a time gives them in order. That is heapsort, and it is why heaps and sorting are related.'
  },
  {
    id: 'hash-table',
    name: 'Hash table',
    about:
      'Keys are put through a hash that turns them into a bucket number, so looking one up means going straight to its bucket rather than searching.',
    goodAt: ['Looking up by key, in about one step', 'Counting things', 'Checking whether something has been seen'],
    badAt: ['Any order at all — the keys come out scattered', 'Finding a range', 'Its worst case, which is everything in one bucket'],
    operations: Object.freeze([
      op('build', 'Build from keys', 'Put several keys in.', 'keys', 'O(n) on average'),
      op('add', 'Put', 'Hash it, go to the bucket, store it.', 'key', 'O(1) on average'),
      op('find', 'Find', 'Hash it, look in that bucket only.', 'key', 'O(1) on average'),
      op('remove', 'Remove', 'Hash it, take it out of the bucket.', 'key', 'O(1) on average')
    ]),
    complexity: Object.freeze({
      Put: 'O(1) average, O(n) worst case',
      Find: 'O(1) average, O(n) worst case',
      Remove: 'O(1) average, O(n) worst case'
    }),
    watchOutFor:
      'The "O(1)" assumes the hash spreads the keys out. The spread panel shows whether it actually did. And with open addressing, removing leaves a tombstone, because blanking the slot would hide every key that had to step past it.'
  },
  {
    id: 'trie',
    name: 'Trie',
    about:
      'A tree of letters. Words sharing a beginning share the nodes for it, so the path down spells the word out.',
    goodAt: ['Finding every word starting with something', 'Autocomplete', 'Storing many words with shared beginnings cheaply'],
    badAt: ['Memory, when the words share nothing', 'Anything that is not text'],
    operations: Object.freeze([
      op('build', 'Build from words', 'Put several words in.', 'keys', 'O(total letters)'),
      op('add', 'Insert', 'Walk the letters, making nodes where none exist.', 'key', 'O(length)'),
      op('startsWith', 'Starts with', 'Walk to the prefix, then collect everything below.', 'key', 'O(length + matches)')
    ]),
    complexity: Object.freeze({
      Insert: 'O(length of the word)',
      'Starts with': 'O(length of the prefix), plus the matches',
      Find: 'O(length of the word)'
    }),
    watchOutFor:
      'The cost does not depend on how many words are stored — only on how long the one you are asking about is. Put in a thousand words and look one up: the step count barely moves.'
  },
  {
    id: 'union-find',
    name: 'Union-find',
    about:
      'Keeps track of which things are in the same group, by having each one point at another until a root is reached.',
    goodAt: ['Asking whether two things are connected', 'Building a minimum spanning tree', 'Working out connected groups as edges arrive'],
    badAt: ['Splitting a group up again — it cannot', 'Listing who is in a group without checking everybody'],
    operations: Object.freeze([
      op('build', 'Set up', 'Start with every thing in its own group.', 'keys', 'O(n)'),
      op('group', 'Which group', 'Walk up to the root, flattening the path.', 'key', 'almost O(1)'),
      op('join', 'Join', 'Find both roots and put the smaller tree under the bigger.', 'two', 'almost O(1)')
    ]),
    complexity: Object.freeze({
      'Which group': 'Effectively constant, with path flattening and joining by size',
      Join: 'Effectively constant'
    }),
    watchOutFor:
      'Switch path flattening off and join things in a chain. The trees grow tall and every lookup walks them. With it on, each lookup shortens what it walked, so the structure gets faster from being used.'
  }
])

const BY_ID = new Map(CATALOGUE.map((one) => [one.id, one]))

export const entryFor = (id: string): Entry | null => BY_ID.get(id as StructureId) ?? null

/** A fresh structure of a kind, with any setting it needs. */
export function create(
  id: StructureId,
  options: { collisions?: Collisions; size?: number; capacity?: number | null; compress?: boolean } = {}
): Structure | StructureError {
  switch (id) {
    case 'stack':
    case 'queue':
    case 'deque':
      return newLinear(id, options.capacity ?? null)
    case 'linked-list':
    case 'doubly-linked-list':
      return newList(id)
    case 'binary-search-tree':
    case 'avl-tree':
      return newTree(id)
    case 'min-heap':
    case 'max-heap':
      return newHeap(id)
    case 'hash-table':
      return newTable(options.collisions ?? 'chaining', options.size ?? 8)
    case 'trie':
      return newTrie()
    case 'union-find':
      // Union-find needs its members up front — it cannot be grown — so it starts with a default set to work with.
      return newUnionFind(['a', 'b', 'c', 'd', 'e', 'f'], options.compress ?? true)
    default:
      return refuse('unknown', `There is no structure called "${String(id)}".`, 'Pick one from the list.')
  }
}

/** The picture of a structure as it stands, without doing anything to it. */
export function pictureOf(structure: Structure): Snapshot {
  switch (structure.kind) {
    case 'stack':
    case 'queue':
    case 'deque':
      return linearPicture(structure)
    case 'linked-list':
    case 'doubly-linked-list':
      return listPicture(structure)
    case 'binary-search-tree':
    case 'avl-tree':
      return treePicture(structure)
    case 'min-heap':
    case 'max-heap':
      return heapPicture(structure)
    case 'hash-table':
      return tablePicture(structure)
    case 'trie':
      return triePicture(structure)
    case 'union-find':
      return unionPicture(structure)
  }
}

export interface Request {
  operation: OperationId
  /** What was typed in, if the operation needs something. */
  argument?: string
  /** Which walk, for a tree. */
  walk?: Walk
}

export interface Outcome {
  structure: Structure
  run: Run
}

const kindOf = (structure: Structure): StructureId => structure.kind as StructureId

/**
 * Runs one operation.
 *
 * An operation the structure does not have is refused by name, because a laboratory that silently did nothing would
 * look broken and a laboratory that guessed a nearby operation would be worse.
 */
export function apply(structure: Structure, request: Request): Outcome | StructureError {
  const id = kindOf(structure)
  const entry = entryFor(id)
  if (entry === null) return refuse('unknown', 'That structure is not in the list.', 'Pick one from the list.')
  const operation = entry.operations.find((one) => one.id === request.operation)
  if (operation === undefined) {
    return refuse(
      'no such operation',
      `A ${entry.name.toLowerCase()} has no "${request.operation}".`,
      `It can do: ${entry.operations.map((one) => one.name.toLowerCase()).join(', ')}.`
    )
  }

  const typed = String(request.argument ?? '').trim()
  if ((operation.needs === 'key' || operation.needs === 'keys' || operation.needs === 'two') && typed.length === 0) {
    return refuse(
      'nothing given',
      `${operation.name} needs ${operation.needs === 'two' ? 'two things' : operation.needs === 'keys' ? 'some values' : 'a value'}.`,
      operation.needs === 'two' ? 'Type two names separated by a space.' : 'Type it in the box.'
    )
  }

  const keys = operation.needs === 'keys' || operation.needs === 'two' ? readKeys(typed) : null
  if (keys !== null && isStructureError(keys)) return keys
  const one = typed.length > 0 ? (Number.isFinite(Number(typed)) && typed !== '' ? Number(typed) : typed) : ''

  switch (structure.kind) {
    case 'stack':
    case 'queue':
    case 'deque': {
      if (request.operation === 'add') return wrap(addLinear(structure, one, structure.kind === 'stack' ? 'back' : 'back'))
      if (request.operation === 'addFront') return wrap(addLinear(structure, one, 'front'))
      if (request.operation === 'addBack') return wrap(addLinear(structure, one, 'back'))
      if (request.operation === 'take') return wrap(takeLinear(structure, structure.kind === 'stack' ? 'back' : 'front'))
      if (request.operation === 'takeFront') return wrap(takeLinear(structure, 'front'))
      if (request.operation === 'takeBack') return wrap(takeLinear(structure, 'back'))
      if (request.operation === 'peek') return { structure, run: peekLinear(structure) }
      break
    }
    case 'linked-list':
    case 'doubly-linked-list': {
      if (request.operation === 'addFront') return wrap(addFront(structure, one))
      if (request.operation === 'addBack') return wrap(addBack(structure, one))
      if (request.operation === 'find') return { structure, run: findInList(structure, one) }
      if (request.operation === 'remove') return wrap(removeFromList(structure, one))
      if (request.operation === 'reverse') return wrap(reverseList(structure))
      break
    }
    case 'binary-search-tree':
    case 'avl-tree': {
      if (request.operation === 'add') return wrap(insertIntoTree(structure, one))
      if (request.operation === 'find') return { structure, run: findInTree(structure, one) }
      if (request.operation === 'remove') return wrap(removeFromTree(structure, one))
      if (request.operation === 'walk') return { structure, run: walkTree(structure, request.walk ?? 'in-order') }
      if (request.operation === 'build') {
        /*
         * Building is quiet for all but the last key. A thousand keys would otherwise record a thousand transcripts,
         * and the counts — which are what the comparison is for — stay true either way.
         */
        let working: BinaryTree = newTree(structure.kind)
        let comparisons = 0
        let rotations = 0
        const list = keys as readonly (number | string)[]
        for (let i = 0; i < list.length; i += 1) {
          const made = insertIntoTree(working, list[i], i < list.length - 1)
          working = made.structure
          comparisons += made.run.counts.comparisons
          rotations += made.run.counts.rotations
        }
        const last = insertIntoTree(working, list[list.length - 1], true)
        const run = last.run
        return {
          structure: working,
          run: {
            ...run,
            operation: 'build',
            argument: `${list.length} keys`,
            counts: { ...run.counts, comparisons, rotations },
            ending: treePicture(working),
            steps: Object.freeze([]),
            changed: true,
            answer: `${list.length} keys put in, costing ${comparisons.toLocaleString()} comparisons${rotations > 0 ? ` and ${rotations} rotations` : ''}. The tree is ${pictureHeight(working)} tall.`
          }
        }
      }
      break
    }
    case 'min-heap':
    case 'max-heap': {
      if (request.operation === 'add') return wrap(insertIntoHeap(structure, one))
      if (request.operation === 'take') return wrap(takeFromHeap(structure))
      if (request.operation === 'peek') {
        const recorder = peekHeap(structure)
        return { structure, run: recorder }
      }
      if (request.operation === 'build') return wrap(heapify(structure.kind, keys as readonly (number | string)[]))
      break
    }
    case 'hash-table': {
      if (request.operation === 'add') return wrap(putInTable(structure, one))
      if (request.operation === 'find') return { structure, run: findInTable(structure, one) }
      if (request.operation === 'remove') return wrap(removeFromTable(structure, one))
      if (request.operation === 'build') {
        let working: HashTable = newTable(structure.collisions, structure.buckets.length)
        let probes = 0
        let comparisons = 0
        const list = keys as readonly (number | string)[]
        for (const key of list) {
          const made = putInTable(working, key, null, true)
          working = made.structure
          probes += made.run.counts.probes
          comparisons += made.run.counts.comparisons
        }
        const spread = spreadOf(working)
        return {
          structure: working,
          run: {
            structure: 'hash-table',
            operation: 'build',
            argument: `${list.length} keys`,
            steps: Object.freeze([]),
            counts: {
              comparisons,
              reads: 0,
              writes: list.length,
              links: 0,
              rotations: 0,
              probes,
              allocations: working.resizes,
              deepest: spread.longest
            },
            ending: tablePicture(working),
            answer: `${list.length} keys put in. ${spread.says}`,
            changed: true,
            truncated: false
          }
        }
      }
      break
    }
    case 'trie': {
      if (request.operation === 'add') return wrap(insertIntoTrie(structure, typed))
      if (request.operation === 'startsWith') return { structure, run: searchTrie(structure, typed) }
      if (request.operation === 'build') {
        let working: Trie = newTrie()
        const words = typed.split(/[\s,;]+/).filter((w) => w.length > 0)
        let allocations = 0
        for (const word of words) {
          const made = insertIntoTrie(working, word, true)
          working = made.structure
          allocations += made.run.counts.allocations
        }
        const letters = words.reduce((a, b) => a + b.length, 0)
        return {
          structure: working,
          run: {
            structure: 'trie',
            operation: 'build',
            argument: `${words.length} words`,
            steps: Object.freeze([]),
            counts: { comparisons: 0, reads: 0, writes: words.length, links: allocations, rotations: 0, probes: 0, allocations, deepest: 0 },
            ending: triePicture(working),
            answer: `${words.length} words stored in ${allocations} nodes, for ${letters} letters in total — the difference is the letters they share.`,
            changed: true,
            truncated: false
          }
        }
      }
      break
    }
    case 'union-find': {
      if (request.operation === 'build') {
        const names = typed.split(/[\s,;]+/).filter((w) => w.length > 0)
        const made = newUnionFind(names, structure.compress)
        if (isStructureError(made)) return made
        return {
          structure: made,
          run: {
            structure: 'union-find',
            operation: 'build',
            argument: `${names.length} things`,
            steps: Object.freeze([]),
            counts: { comparisons: 0, reads: 0, writes: names.length, links: 0, rotations: 0, probes: 0, allocations: names.length, deepest: 0 },
            ending: unionPicture(made),
            answer: `${names.length} things, each in its own group to begin with.`,
            changed: true,
            truncated: false
          }
        }
      }
      if (request.operation === 'group') {
        const at = structure.labels.indexOf(typed)
        if (at < 0) return refuse('not here', `There is nothing called "${typed}".`, `It holds: ${structure.labels.join(', ')}.`)
        return wrap(findGroup(structure, at))
      }
      if (request.operation === 'join') {
        const names = (keys as readonly (number | string)[]).map(String)
        if (names.length !== 2) return refuse('needs two', 'Joining takes exactly two things.', 'Type two names separated by a space.')
        const a = structure.labels.indexOf(names[0])
        const b = structure.labels.indexOf(names[1])
        if (a < 0 || b < 0) {
          return refuse(
            'not here',
            `There is nothing called "${a < 0 ? names[0] : names[1]}".`,
            `It holds: ${structure.labels.join(', ')}.`
          )
        }
        return wrap(join(structure, a, b))
      }
      break
    }
  }

  return refuse(
    'not wired',
    `${operation.name} is listed for a ${entry.name.toLowerCase()} but is not connected to anything.`,
    'This is a fault in Orbis, not in what you asked for.'
  )
}

/**
 * Turns what an operation returned into an outcome, passing a refusal straight through.
 *
 * The linear operations can refuse — a queue has no back to take from — so this has to carry a refusal rather than
 * assume success. Without it, asking a queue for its back end would have been a type error here and a crash there.
 */
const wrap = (made: { structure: Structure; run: Run } | StructureError): Outcome | StructureError =>
  isStructureError(made) ? made : { structure: made.structure, run: made.run }

const pictureHeight = (tree: BinaryTree): number => {
  const note = treePicture(tree).notes[0] ?? ''
  const found = /height (\d+)/.exec(note)
  return found ? Number(found[1]) : 0
}

function peekHeap(heap: Heap): Run {
  const top = heap.items[0]
  return {
    structure: heap.kind,
    operation: 'peek',
    argument: '',
    steps: Object.freeze([]),
    counts: { comparisons: 0, reads: heap.items.length === 0 ? 0 : 1, writes: 0, links: 0, rotations: 0, probes: 0, allocations: 0, deepest: 0 },
    ending: heapPicture(heap, heap.items.length > 0 ? { 0: 'found' } : {}),
    answer:
      heap.items.length === 0
        ? 'It is empty.'
        : `${String(top)} — the ${heap.kind === 'min-heap' ? 'smallest' : 'largest'}, and reading it costs nothing because it is always at index 0.`,
    changed: false,
    truncated: false
  }
}

// ---------------------------------------------------------------- comparing

export interface Side {
  id: StructureId
  name: string
  counts: Run['counts']
  answer: string
  stated: string
}

export interface Comparison {
  operation: string
  argument: string
  sides: readonly Side[]
  says: string
}

/**
 * Runs the same work on several structures and reports what each actually cost.
 *
 * The point is the lesson that cannot be delivered any other way: a binary search tree and an AVL tree given sorted
 * keys do identical work until the rebalancing starts, and then one of them keeps paying for the rest of its life.
 */
export function compare(
  ids: readonly StructureId[],
  keys: readonly (number | string)[],
  lookFor: number | string | null
): Comparison | StructureError {
  if (ids.length < 2) return refuse('too few', 'Comparing needs at least two structures.', 'Pick two or more.')
  if (ids.length > 4) return refuse('too many', 'Four is the most that fits side by side.', 'Pick four or fewer.')
  if (keys.length === 0) return refuse('no keys', 'There is nothing to put in.', 'Give some values.')

  const sides: Side[] = []
  for (const id of ids) {
    const entry = entryFor(id)
    if (entry === null) return refuse('unknown', `There is no structure called "${id}".`, 'Pick one from the list.')
    const has = (one: OperationId): boolean => entry.operations.some((two) => two.id === one)

    let structure = create(id)
    if (isStructureError(structure)) return structure

    const total: Run['counts'] = { comparisons: 0, reads: 0, writes: 0, links: 0, rotations: 0, probes: 0, allocations: 0, deepest: 0 }
    const addEach = (counts: Run['counts']): void => {
      total.comparisons += counts.comparisons
      total.reads += counts.reads
      total.writes += counts.writes
      total.links += counts.links
      total.rotations += counts.rotations
      total.probes += counts.probes
      total.allocations += counts.allocations
      total.deepest = Math.max(total.deepest, counts.deepest)
    }

    // Fill it, using whichever adding operation the structure actually has.
    const adder: OperationId = has('add') ? 'add' : has('addBack') ? 'addBack' : has('addFront') ? 'addFront' : 'build'
    if (adder === 'build') {
      const made = apply(structure, { operation: 'build', argument: keys.map(String).join(' ') })
      if (isStructureError(made)) return made
      structure = made.structure
      addEach(made.run.counts)
    } else {
      for (const key of keys) {
        const made = apply(structure, { operation: adder, argument: String(key) })
        if (isStructureError(made)) return made
        structure = made.structure
        addEach(made.run.counts)
      }
    }

    let answer = `${keys.length} keys in.`
    if (lookFor !== null && has('find')) {
      const found = apply(structure, { operation: 'find', argument: String(lookFor) })
      if (isStructureError(found)) return found
      addEach(found.run.counts)
      answer = found.run.answer
    } else if (lookFor !== null) {
      // Honest rather than approximate: a stack has no find, and pretending otherwise would make the table a lie.
      answer = `A ${entry.name.toLowerCase()} has no way to look a key up, so there is nothing to time.`
    }

    sides.push({ id, name: entry.name, counts: total, answer, stated: entry.complexity.Find ?? entry.complexity.Put ?? '—' })
  }

  const byComparisons = [...sides].sort((a, b) => a.counts.comparisons + a.counts.probes - (b.counts.comparisons + b.counts.probes))
  const cheapest = byComparisons[0]
  const dearest = byComparisons[byComparisons.length - 1]
  const low = cheapest.counts.comparisons + cheapest.counts.probes
  const high = dearest.counts.comparisons + dearest.counts.probes

  return {
    operation: 'fill, then find',
    argument: `${keys.length} keys${lookFor === null ? '' : `, looking for ${String(lookFor)}`}`,
    sides: Object.freeze(sides),
    says:
      low === high
        ? 'Every structure cost the same here. Try sorted keys, or more of them.'
        : `${cheapest.name} did the least work — ${low.toLocaleString()} comparisons against ${dearest.name}'s ${high.toLocaleString()}, which is ${(high / Math.max(1, low)).toFixed(1)} times as many.`
  }
}

export { spreadOf, isStructureError, readKeys }
export type { Run, Snapshot, StructureError, Collisions, Walk }
