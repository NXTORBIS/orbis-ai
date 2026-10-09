import {
  compareKeys,
  emptySnapshot,
  Recorder,
  type Cell,
  type Link,
  type Run,
  type Snapshot
} from './model.ts'

/**
 * The structures that branch: binary search trees, AVL trees, heaps and tries.
 *
 * ## The unbalanced tree is kept, on purpose
 *
 * A binary search tree given sorted keys becomes a linked list with extra steps, and every lookup then costs a walk
 * down the whole thing. That is the single most useful fact about binary search trees and the reason AVL trees exist,
 * so the plain tree is not quietly balanced here — it degenerates, the height is shown, and the laboratory says what
 * happened. Hiding it would make the balanced version look like a pointless complication.
 *
 * ## A heap is an array, and is drawn as both
 *
 * A binary heap has no pointers: a node's children are at `2i+1` and `2i+2`. So a heap here is one array, shown as a
 * row *and* as a tree, because the whole trick is that those are the same thing. Sifting up and down moves real array
 * entries and the counts are the real swap counts.
 *
 * ## Rotations are shown as rotations
 *
 * An AVL insert that triggers a rebalance records which rotation it did and which node was out of balance, with the
 * balance factors on the nodes. A rebalance that just appears as a different tree teaches nothing.
 */

// ---------------------------------------------------------------- binary trees

interface TreeNode {
  id: string
  key: number | string
  left: string | null
  right: string | null
  /** Kept on the node for AVL. A plain tree carries it too, so the two can be compared without special cases. */
  height: number
}

export interface BinaryTree {
  kind: 'binary-search-tree' | 'avl-tree'
  nodes: Readonly<Record<string, TreeNode>>
  root: string | null
  nextId: number
}

export const newTree = (kind: BinaryTree['kind']): BinaryTree =>
  Object.freeze({ kind, nodes: Object.freeze({}), root: null, nextId: 1 })

const heightOf = (nodes: Readonly<Record<string, TreeNode>>, id: string | null): number =>
  id === null ? 0 : nodes[id]?.height ?? 0

const balanceOf = (nodes: Readonly<Record<string, TreeNode>>, id: string | null): number =>
  id === null ? 0 : heightOf(nodes, nodes[id].left) - heightOf(nodes, nodes[id].right)

/** Recomputes one node's stored height from its children's. Called after any change beneath it. */
function refreshHeight(nodes: Record<string, TreeNode>, id: string): void {
  nodes[id] = {
    ...nodes[id],
    height: 1 + Math.max(heightOf(nodes, nodes[id].left), heightOf(nodes, nodes[id].right))
  }
}

/** Every node, in the order they would be drawn, with how deep each one sits. */
function layOutTree(tree: BinaryTree): { order: readonly string[]; depth: Readonly<Record<string, number>> } {
  const order: string[] = []
  const depth: Record<string, number> = {}
  const walk = (id: string | null, at: number): void => {
    if (id === null) return
    depth[id] = at
    // In-order, so the drawn left-to-right position matches the sorted order — which is what a search tree means.
    walk(tree.nodes[id].left, at + 1)
    order.push(id)
    walk(tree.nodes[id].right, at + 1)
  }
  walk(tree.root, 0)
  return { order, depth }
}

function treePicture(
  tree: BinaryTree,
  marks: Readonly<Record<string, Cell['mark']>> = {},
  extra: readonly string[] = []
): Snapshot {
  if (tree.root === null) return emptySnapshot('tree', ['Empty. There is no root yet.', ...extra])
  const { order, depth } = layOutTree(tree)
  const cells: Cell[] = order.map((id, at) => {
    const cell: Cell = { id, value: tree.nodes[id].key, at }
    const mark = marks[id]
    if (mark) (cell as { mark?: Cell['mark'] }).mark = mark
    if (tree.kind === 'avl-tree') {
      const balance = balanceOf(tree.nodes, id)
      // The balance factor is the whole mechanism of an AVL tree, so it is on the face of every node.
      ;(cell as { note?: string }).note = balance === 0 ? '0' : balance > 0 ? `+${balance}` : String(balance)
      if (Math.abs(balance) > 1 && !mark) (cell as { mark?: Cell['mark'] }).mark = 'unbalanced'
    }
    return cell
  })
  const links: Link[] = []
  for (const id of order) {
    const node = tree.nodes[id]
    if (node.left !== null) links.push({ from: id, to: node.left, role: 'left' })
    if (node.right !== null) links.push({ from: id, to: node.right, role: 'right' })
  }

  const height = heightOf(tree.nodes, tree.root)
  const count = order.length
  const best = count === 0 ? 0 : Math.floor(Math.log2(count)) + 1
  const notes: string[] = [`${count} ${count === 1 ? 'node' : 'nodes'}, height ${height}.`]
  if (count > 2) {
    if (height === best) notes.push(`That is as short as ${count} nodes can be.`)
    else if (height > 2 * best) {
      /*
       * The specific thing a learner needs told. A tree twice as tall as it needs to be is not a curiosity: every
       * lookup costs proportionally more, and saying so is the difference between a picture and a lesson.
       */
      notes.push(
        `A balanced tree of ${count} nodes would be ${best} tall. This one is ${height}, so a lookup can cost ${height} comparisons instead of ${best}.`
      )
    } else notes.push(`A balanced tree of ${count} nodes would be ${best} tall.`)
  }
  return {
    layout: 'tree',
    cells: Object.freeze(cells),
    links: Object.freeze(links),
    depth: Object.freeze(depth),
    notes: Object.freeze([...notes, ...extra])
  }
}

/** One rotation. Returns the id that takes the rotated node's place. */
function rotate(
  nodes: Record<string, TreeNode>,
  id: string,
  direction: 'left' | 'right'
): string {
  if (direction === 'right') {
    const pivot = nodes[id].left as string
    nodes[id] = { ...nodes[id], left: nodes[pivot].right }
    nodes[pivot] = { ...nodes[pivot], right: id }
    refreshHeight(nodes, id)
    refreshHeight(nodes, pivot)
    return pivot
  }
  const pivot = nodes[id].right as string
  nodes[id] = { ...nodes[id], right: nodes[pivot].left }
  nodes[pivot] = { ...nodes[pivot], left: id }
  refreshHeight(nodes, id)
  refreshHeight(nodes, pivot)
  return pivot
}

/**
 * Puts a key in.
 *
 * Walks down comparing, which is the operation, then — for an AVL tree — walks back up refreshing heights and
 * rebalancing where a node has gone out of balance. The plain tree skips the second half entirely, which is exactly
 * the difference between them.
 */
export function insertIntoTree(
  tree: BinaryTree,
  key: number | string,
  quiet = false
): { structure: BinaryTree; run: Run; added: boolean } {
  const recorder = new Recorder(quiet)
  recorder.note('start', `Put ${String(key)} in.`, () => treePicture(tree))

  const nodes: Record<string, TreeNode> = { ...tree.nodes }
  const path: string[] = []
  const went: ('left' | 'right')[] = []

  let at = tree.root
  while (at !== null) {
    path.push(at)
    const here = nodes[at].key
    const side = compareKeys(key, here)
    const node = at
    if (side === 0) {
      recorder.compare(`${String(key)} is already here.`, () => treePicture(tree, { [node]: 'found' }))
      recorder.note('done', 'A search tree holds each key once, so nothing changed.', () => treePicture(tree, { [node]: 'found' }))
      return {
        structure: tree,
        added: false,
        run: recorder.finish(
          tree.kind,
          'insert',
          String(key),
          treePicture(tree, { [node]: 'found' }),
          `${String(key)} was already there.`,
          false
        )
      }
    }
    const going = side < 0 ? 'left' : 'right'
    recorder.compare(
      `${String(key)} is ${side < 0 ? 'less' : 'greater'} than ${String(here)}, so go ${going}.`,
      () => treePicture(tree, { [node]: 'looking' })
    )
    went.push(going)
    at = going === 'left' ? nodes[at].left : nodes[at].right
  }
  recorder.reached(path.length + 1)

  const id = `t${tree.nextId}`
  nodes[id] = { id, key, left: null, right: null, height: 1 }
  recorder.allocate()

  if (path.length === 0) {
    const made: BinaryTree = Object.freeze({ ...tree, nodes: Object.freeze(nodes), root: id, nextId: tree.nextId + 1 })
    recorder.write(`The tree was empty, so ${String(key)} is the root.`, () => treePicture(made, { [id]: 'added' }))
    return {
      structure: made,
      added: true,
      run: recorder.finish(tree.kind, 'insert', String(key), treePicture(made, { [id]: 'added' }), `${String(key)} is the root.`, true)
    }
  }

  const parent = path[path.length - 1]
  const side = went[went.length - 1]
  nodes[parent] = { ...nodes[parent], [side]: id } as TreeNode
  recorder.counts.links += 1

  let root = tree.root
  {
    const shown: BinaryTree = Object.freeze({ ...tree, nodes: Object.freeze({ ...nodes }), root, nextId: tree.nextId + 1 })
    recorder.write(`Hang ${String(key)} off ${String(nodes[parent].key)} on the ${side}.`, () =>
      treePicture(shown, { [id]: 'added' })
    )
  }

  // Back up the path. The plain tree only refreshes heights so its picture can report one; the AVL tree also rebalances.
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const node = path[i]
    refreshHeight(nodes, node)
    if (tree.kind !== 'avl-tree') continue

    const balance = balanceOf(nodes, node)
    if (Math.abs(balance) <= 1) continue

    const heavy = balance > 1 ? 'left' : 'right'
    const child = (heavy === 'left' ? nodes[node].left : nodes[node].right) as string
    const childBalance = balanceOf(nodes, child)
    /*
     * The four AVL cases. Which one applies is decided by the direction the imbalance leans and the direction its
     * heavy child leans — and naming it in the step is the only way the rotation stops looking arbitrary.
     */
    let says: string
    let replacement: string
    if (heavy === 'left' && childBalance >= 0) {
      says = `${String(nodes[node].key)} is left-heavy and so is its left child. One right rotation fixes it.`
      replacement = rotate(nodes, node, 'right')
    } else if (heavy === 'left') {
      says = `${String(nodes[node].key)} is left-heavy but its left child leans right. Rotate the child left, then this node right.`
      // The child's rotation gives back whatever took its place, and the node must be repointed at that before its own
      // rotation — otherwise the second rotation lifts a node that is no longer there.
      const newChild = rotate(nodes, child, 'left')
      nodes[node] = { ...nodes[node], left: newChild }
      replacement = rotate(nodes, node, 'right')
    } else if (childBalance <= 0) {
      says = `${String(nodes[node].key)} is right-heavy and so is its right child. One left rotation fixes it.`
      replacement = rotate(nodes, node, 'left')
    } else {
      says = `${String(nodes[node].key)} is right-heavy but its right child leans left. Rotate the child right, then this node left.`
      const newChild = rotate(nodes, child, 'right')
      nodes[node] = { ...nodes[node], right: newChild }
      replacement = rotate(nodes, node, 'left')
    }

    // Reattach where the rotated subtree hung.
    if (i === 0) root = replacement
    else {
      const above = path[i - 1]
      const which = went[i - 1]
      nodes[above] = { ...nodes[above], [which]: replacement } as TreeNode
      recorder.counts.links += 1
      refreshHeight(nodes, above)
    }
    const shown: BinaryTree = Object.freeze({
      ...tree,
      nodes: Object.freeze({ ...nodes }),
      root,
      nextId: tree.nextId + 1
    })
    recorder.rotate(says, () => treePicture(shown, { [replacement]: 'changed' }))
  }

  const made: BinaryTree = Object.freeze({ ...tree, nodes: Object.freeze(nodes), root, nextId: tree.nextId + 1 })
  const height = heightOf(nodes, root)
  return {
    structure: made,
    added: true,
    run: recorder.finish(
      tree.kind,
      'insert',
      String(key),
      treePicture(made, { [id]: 'added' }),
      recorder.counts.rotations > 0
        ? `${String(key)} is in. ${recorder.counts.rotations} ${recorder.counts.rotations === 1 ? 'rotation was' : 'rotations were'} needed to keep it balanced. Height ${height}.`
        : `${String(key)} is in, after ${recorder.counts.comparisons} ${recorder.counts.comparisons === 1 ? 'comparison' : 'comparisons'}. Height ${height}.`,
      true
    )
  }
}

/** Looks for a key, down one path only — which is the point of a search tree. */
export function findInTree(tree: BinaryTree, key: number | string): Run {
  const recorder = new Recorder()
  recorder.note('start', `Look for ${String(key)}.`, () => treePicture(tree))
  const walked: string[] = []
  let at = tree.root
  let depth = 0
  while (at !== null) {
    depth += 1
    walked.push(at)
    const here = tree.nodes[at].key
    const side = compareKeys(key, here)
    const marks: Record<string, Cell['mark']> = {}
    for (const one of walked) marks[one] = 'path'
    marks[at] = side === 0 ? 'found' : 'looking'
    const shown = { ...marks }
    if (side === 0) {
      recorder.compare(`${String(here)} — that is it, ${depth} ${depth === 1 ? 'level' : 'levels'} down.`, () =>
        treePicture(tree, shown)
      )
      recorder.reached(depth)
      return recorder.finish(
        tree.kind,
        'find',
        String(key),
        treePicture(tree, shown),
        `Found after ${depth} ${depth === 1 ? 'comparison' : 'comparisons'}.`,
        false
      )
    }
    recorder.compare(`${String(key)} is ${side < 0 ? 'less' : 'greater'} than ${String(here)}, so go ${side < 0 ? 'left' : 'right'}.`, () =>
      treePicture(tree, shown)
    )
    at = side < 0 ? tree.nodes[at].left : tree.nodes[at].right
  }
  recorder.reached(depth)
  recorder.note('missing', 'There is nothing below here, so it is not in the tree.', () => treePicture(tree))
  return recorder.finish(
    tree.kind,
    'find',
    String(key),
    treePicture(tree),
    `Not there. It took ${depth} ${depth === 1 ? 'comparison' : 'comparisons'} to be sure.`,
    false
  )
}

/**
 * Takes a key out.
 *
 * The three cases — no children, one child, two children — are the reason removal from a search tree is harder than
 * insertion, so each one is named in the step rather than folded together.
 */
export function removeFromTree(
  tree: BinaryTree,
  key: number | string
): { structure: BinaryTree; run: Run; removed: boolean } {
  const recorder = new Recorder()
  recorder.note('start', `Take ${String(key)} out.`, () => treePicture(tree))

  const nodes: Record<string, TreeNode> = { ...tree.nodes }
  const path: string[] = []
  const went: ('left' | 'right')[] = []
  let at = tree.root
  while (at !== null) {
    const side = compareKeys(key, nodes[at].key)
    if (side === 0) break
    path.push(at)
    const node = at
    recorder.compare(`${String(key)} is ${side < 0 ? 'less' : 'greater'} than ${String(nodes[node].key)}.`, () =>
      treePicture(tree, { [node]: 'looking' })
    )
    went.push(side < 0 ? 'left' : 'right')
    at = side < 0 ? nodes[at].left : nodes[at].right
  }
  if (at === null) {
    recorder.note('missing', 'It is not in the tree.', () => treePicture(tree))
    return {
      structure: tree,
      removed: false,
      run: recorder.finish(tree.kind, 'remove', String(key), treePicture(tree), 'Not there, so nothing changed.', false)
    }
  }

  const target = at
  recorder.compare(`Found ${String(key)}.`, () => treePicture(tree, { [target]: 'found' }))

  const attach = (replacement: string | null): string | null => {
    if (path.length === 0) return replacement
    const above = path[path.length - 1]
    nodes[above] = { ...nodes[above], [went[went.length - 1]]: replacement } as TreeNode
    recorder.counts.links += 1
    return tree.root
  }

  let root = tree.root
  const left = nodes[target].left
  const right = nodes[target].right

  if (left === null && right === null) {
    root = attach(null)
    delete nodes[target]
    recorder.write(`${String(key)} had no children, so it just goes.`, () =>
      treePicture(Object.freeze({ ...tree, nodes: Object.freeze({ ...nodes }), root }))
    )
  } else if (left === null || right === null) {
    const only = (left ?? right) as string
    root = attach(only)
    delete nodes[target]
    recorder.write(
      `${String(key)} had one child, so that child takes its place.`,
      () => treePicture(Object.freeze({ ...tree, nodes: Object.freeze({ ...nodes }), root }), { [only]: 'changed' })
    )
  } else {
    /*
     * Two children. The replacement must be the next key in order — the smallest in the right subtree — because any
     * other choice breaks the ordering the whole structure rests on.
     */
    let successorParent = target
    let successor = right
    const down: string[] = []
    while (nodes[successor].left !== null) {
      successorParent = successor
      down.push(successor)
      successor = nodes[successor].left as string
      const node = successor
      recorder.read(`Go left for the next key up: ${String(nodes[node].key)}.`, () =>
        treePicture(tree, { [target]: 'found', [node]: 'path' })
      )
    }
    recorder.read(`${String(nodes[successor].key)} is the next key after ${String(key)}, so it takes its place.`, () =>
      treePicture(tree, { [target]: 'found', [successor]: 'changed' })
    )
    // Lift the successor's key into the target rather than moving nodes, which keeps every other pointer valid.
    const successorRight = nodes[successor].right
    if (successorParent === target) nodes[target] = { ...nodes[target], right: successorRight }
    else nodes[successorParent] = { ...nodes[successorParent], left: successorRight }
    recorder.counts.links += 1
    nodes[target] = { ...nodes[target], key: nodes[successor].key }
    recorder.counts.writes += 1
    delete nodes[successor]
    for (const one of [...down, successorParent, target].reverse()) if (nodes[one]) refreshHeight(nodes, one)
    recorder.write('Its key is copied up, and the node it came from is unhooked.', () =>
      treePicture(Object.freeze({ ...tree, nodes: Object.freeze({ ...nodes }), root }), { [target]: 'changed' })
    )
  }

  for (let i = path.length - 1; i >= 0; i -= 1) if (nodes[path[i]]) refreshHeight(nodes, path[i])
  if (root !== null && nodes[root]) refreshHeight(nodes, root)

  const made: BinaryTree = Object.freeze({ ...tree, nodes: Object.freeze(nodes), root })
  return {
    structure: made,
    removed: true,
    run: recorder.finish(
      tree.kind,
      'remove',
      String(key),
      treePicture(made),
      `${String(key)} is out. Height is now ${heightOf(nodes, root)}.`,
      true
    )
  }
}

export type Walk = 'in-order' | 'pre-order' | 'post-order' | 'level-order'

/** Walks the whole tree. In-order gives the keys sorted, which is worth seeing rather than being told. */
export function walkTree(tree: BinaryTree, how: Walk): Run {
  const recorder = new Recorder()
  recorder.note('start', `Walk it ${how.replace('-', ' ')}.`, () => treePicture(tree))
  const visited: string[] = []
  const keys: (number | string)[] = []

  const visit = (id: string): void => {
    visited.push(id)
    keys.push(tree.nodes[id].key)
    const marks: Record<string, Cell['mark']> = {}
    for (const one of visited) marks[one] = 'path'
    marks[id] = 'found'
    recorder.read(`${String(tree.nodes[id].key)} — number ${keys.length}.`, () => treePicture(tree, marks))
  }

  if (how === 'level-order') {
    const queue: string[] = tree.root === null ? [] : [tree.root]
    while (queue.length > 0) {
      const id = queue.shift() as string
      visit(id)
      if (tree.nodes[id].left !== null) queue.push(tree.nodes[id].left as string)
      if (tree.nodes[id].right !== null) queue.push(tree.nodes[id].right as string)
    }
  } else {
    const walk = (id: string | null): void => {
      if (id === null) return
      if (how === 'pre-order') visit(id)
      walk(tree.nodes[id].left)
      if (how === 'in-order') visit(id)
      walk(tree.nodes[id].right)
      if (how === 'post-order') visit(id)
    }
    walk(tree.root)
  }

  const sorted = how === 'in-order' && keys.length > 1
  return recorder.finish(
    tree.kind,
    `walk ${how}`,
    '',
    treePicture(tree),
    keys.length === 0
      ? 'The tree is empty.'
      : `${keys.map(String).join(', ')}.${sorted ? ' Walking a search tree in order always gives the keys sorted — that is what makes it a search tree.' : ''}`,
    false
  )
}

// ---------------------------------------------------------------- heaps

export interface Heap {
  kind: 'min-heap' | 'max-heap'
  items: readonly (number | string)[]
}

export const newHeap = (kind: Heap['kind']): Heap => Object.freeze({ kind, items: Object.freeze([]) })

/** True when `a` should sit above `b` in this heap. */
const sitsAbove = (heap: Heap, a: number | string, b: number | string): boolean =>
  heap.kind === 'min-heap' ? compareKeys(a, b) < 0 : compareKeys(a, b) > 0

function heapPicture(heap: Heap, marks: Readonly<Record<number, Cell['mark']>> = {}): Snapshot {
  if (heap.items.length === 0) return emptySnapshot('tree', ['Empty.'])
  const cells: Cell[] = []
  const depth: Record<string, number> = {}
  const links: Link[] = []
  for (let i = 0; i < heap.items.length; i += 1) {
    const id = `h${i}`
    const cell: Cell = { id, value: heap.items[i], at: i }
    const mark = marks[i]
    if (mark) (cell as { mark?: Cell['mark'] }).mark = mark
    // The array index is on the node, because the whole idea is that the tree and the array are one thing.
    ;(cell as { note?: string }).note = String(i)
    cells.push(cell)
    depth[id] = Math.floor(Math.log2(i + 1))
    const left = 2 * i + 1
    const right = 2 * i + 2
    if (left < heap.items.length) links.push({ from: id, to: `h${left}`, role: 'left' })
    if (right < heap.items.length) links.push({ from: id, to: `h${right}`, role: 'right' })
  }
  const top = heap.kind === 'min-heap' ? 'smallest' : 'largest'
  return {
    layout: 'tree',
    cells: Object.freeze(cells),
    links: Object.freeze(links),
    depth: Object.freeze(depth),
    notes: Object.freeze([
      `${heap.items.length} ${heap.items.length === 1 ? 'item' : 'items'}, height ${Math.floor(Math.log2(heap.items.length)) + 1}.`,
      `The ${top} is always at the root, which is index 0. A child of index i sits at 2i+1 and 2i+2, so no pointers are stored at all.`
    ])
  }
}

/** Puts a value in and sifts it up until its parent belongs above it. */
export function insertIntoHeap(heap: Heap, value: number | string, quiet = false): { structure: Heap; run: Run } {
  const recorder = new Recorder(quiet)
  recorder.note('start', `Put ${String(value)} in.`, () => heapPicture(heap))

  const items = [...heap.items, value]
  let at = items.length - 1
  recorder.write(`${String(value)} goes on the end, at index ${at}.`, () =>
    heapPicture(Object.freeze({ ...heap, items: Object.freeze([...items]) }), { [at]: 'added' })
  )

  while (at > 0) {
    const parent = Math.floor((at - 1) / 2)
    const here = at
    recorder.compare(
      `Compare ${String(items[here])} with its parent ${String(items[parent])}.`,
      () => heapPicture(Object.freeze({ ...heap, items: Object.freeze([...items]) }), { [here]: 'looking', [parent]: 'looking' })
    )
    if (!sitsAbove(heap, items[at], items[parent])) {
      recorder.note('done', `Its parent belongs above it, so ${String(value)} stays put.`, () =>
        heapPicture(Object.freeze({ ...heap, items: Object.freeze([...items]) }), { [here]: 'found' })
      )
      break
    }
    const temporary = items[at]
    items[at] = items[parent]
    items[parent] = temporary
    recorder.counts.writes += 2
    recorder.counts.reads += 2
    const moved = parent
    recorder.write(`Swap them — ${String(value)} belongs higher.`, () =>
      heapPicture(Object.freeze({ ...heap, items: Object.freeze([...items]) }), { [moved]: 'changed', [here]: 'changed' })
    )
    at = parent
  }
  recorder.reached(Math.floor(Math.log2(items.length)) + 1)

  const made: Heap = Object.freeze({ ...heap, items: Object.freeze(items) })
  return {
    structure: made,
    run: recorder.finish(
      heap.kind,
      'insert',
      String(value),
      heapPicture(made, { [at]: 'added' }),
      at === 0
        ? `${String(value)} rose all the way to the root, so it is the ${heap.kind === 'min-heap' ? 'smallest' : 'largest'} so far.`
        : `${String(value)} settled at index ${at}, after ${recorder.counts.comparisons} ${recorder.counts.comparisons === 1 ? 'comparison' : 'comparisons'}.`,
      true
    )
  }
}

/** Takes the root out and sifts the last item down into place. */
export function takeFromHeap(heap: Heap): { structure: Heap; run: Run; value: number | string | null } {
  const recorder = new Recorder()
  if (heap.items.length === 0) {
    recorder.note('missing', 'There is nothing in it.', () => heapPicture(heap))
    return { structure: heap, value: null, run: recorder.finish(heap.kind, 'take', '', heapPicture(heap), 'It was empty.', false) }
  }

  const value = heap.items[0]
  recorder.read(`The root is ${String(value)} — the ${heap.kind === 'min-heap' ? 'smallest' : 'largest'}.`, () =>
    heapPicture(heap, { 0: 'found' })
  )
  const items = [...heap.items]
  const last = items.pop() as number | string
  if (items.length > 0) {
    items[0] = last
    recorder.write(`Move the last item, ${String(last)}, up to the root, then sift it down.`, () =>
      heapPicture(Object.freeze({ ...heap, items: Object.freeze([...items]) }), { 0: 'changed' })
    )
  }

  let at = 0
  while (true) {
    const left = 2 * at + 1
    const right = 2 * at + 2
    let best = at
    if (left < items.length) {
      recorder.counts.comparisons += 1
      if (sitsAbove(heap, items[left], items[best])) best = left
    }
    if (right < items.length) {
      recorder.counts.comparisons += 1
      if (sitsAbove(heap, items[right], items[best])) best = right
    }
    if (best === at) {
      if (items.length > 1) {
        const here = at
        recorder.note('done', `Both children belong below ${String(items[here])}, so it stays at index ${here}.`, () =>
          heapPicture(Object.freeze({ ...heap, items: Object.freeze([...items]) }), { [here]: 'found' })
        )
      }
      break
    }
    const temporary = items[at]
    items[at] = items[best]
    items[best] = temporary
    recorder.counts.writes += 2
    const from = at
    const to = best
    recorder.write(`${String(items[from])} belongs above, so swap down to index ${to}.`, () =>
      heapPicture(Object.freeze({ ...heap, items: Object.freeze([...items]) }), { [from]: 'changed', [to]: 'changed' })
    )
    at = best
  }
  recorder.reached(items.length === 0 ? 0 : Math.floor(Math.log2(items.length)) + 1)

  const made: Heap = Object.freeze({ ...heap, items: Object.freeze(items) })
  return {
    structure: made,
    value,
    run: recorder.finish(
      heap.kind,
      'take',
      '',
      heapPicture(made),
      `${String(value)} came out. Sifting the replacement down cost ${recorder.counts.comparisons} ${recorder.counts.comparisons === 1 ? 'comparison' : 'comparisons'}.`,
      true
    )
  }
}

/**
 * Builds a heap from an array in place.
 *
 * Sifting down from the middle backwards is O(n), not O(n log n) — which is surprising enough that the measured
 * comparison count is worth showing against inserting the same values one at a time.
 */
export function heapify(kind: Heap['kind'], values: readonly (number | string)[]): { structure: Heap; run: Run } {
  const heap = newHeap(kind)
  const recorder = new Recorder()
  const items = [...values]
  recorder.note('start', `Build a ${kind.replace('-', ' ')} from ${items.length} values, in place.`, () =>
    heapPicture(Object.freeze({ ...heap, items: Object.freeze([...items]) }))
  )

  const siftDown = (from: number): void => {
    let at = from
    while (true) {
      const left = 2 * at + 1
      const right = 2 * at + 2
      let best = at
      if (left < items.length) {
        recorder.counts.comparisons += 1
        if (sitsAbove({ kind, items: [] }, items[left], items[best])) best = left
      }
      if (right < items.length) {
        recorder.counts.comparisons += 1
        if (sitsAbove({ kind, items: [] }, items[right], items[best])) best = right
      }
      if (best === at) break
      const temporary = items[at]
      items[at] = items[best]
      items[best] = temporary
      recorder.counts.writes += 2
      at = best
    }
  }

  for (let i = Math.floor(items.length / 2) - 1; i >= 0; i -= 1) {
    const from = i
    siftDown(i)
    recorder.write(`Sift index ${from} down. Everything below it is already a heap.`, () =>
      heapPicture(Object.freeze({ ...heap, items: Object.freeze([...items]) }), { [from]: 'changed' })
    )
  }

  const made: Heap = Object.freeze({ kind, items: Object.freeze(items) })
  return {
    structure: made,
    run: recorder.finish(
      kind,
      'build',
      `${items.length} values`,
      heapPicture(made),
      `Built from ${items.length} values with ${recorder.counts.comparisons} comparisons. Putting them in one at a time costs more, because this starts from the bottom where most of the nodes are and they have the least distance to fall.`,
      true
    )
  }
}

// ---------------------------------------------------------------- tries

interface TrieNode {
  id: string
  letter: string
  children: Readonly<Record<string, string>>
  ends: boolean
}

export interface Trie {
  kind: 'trie'
  nodes: Readonly<Record<string, TrieNode>>
  root: string
  nextId: number
  words: number
}

export const newTrie = (): Trie =>
  Object.freeze({
    kind: 'trie',
    nodes: Object.freeze({ r: { id: 'r', letter: '', children: Object.freeze({}), ends: false } }),
    root: 'r',
    nextId: 1,
    words: 0
  })

function triePicture(trie: Trie, marks: Readonly<Record<string, Cell['mark']>> = {}): Snapshot {
  const cells: Cell[] = []
  const links: Link[] = []
  const depth: Record<string, number> = {}
  let at = 0
  const walk = (id: string, level: number): void => {
    depth[id] = level
    const node = trie.nodes[id]
    const cell: Cell = { id, value: id === trie.root ? '·' : node.letter, at: at++ }
    const mark = marks[id]
    if (mark) (cell as { mark?: Cell['mark'] }).mark = mark
    // A node that ends a word is the only thing distinguishing "car" stored from "car" merely passed through.
    if (node.ends) (cell as { note?: string }).note = 'word'
    cells.push(cell)
    for (const child of Object.values(node.children)) {
      links.push({ from: id, to: child, role: 'child' })
      walk(child, level + 1)
    }
  }
  walk(trie.root, 0)
  return {
    layout: 'tree',
    cells: Object.freeze(cells),
    links: Object.freeze(links),
    depth: Object.freeze(depth),
    notes: Object.freeze([
      `${trie.words} ${trie.words === 1 ? 'word' : 'words'} in ${cells.length - 1} ${cells.length === 2 ? 'node' : 'nodes'}.`,
      'Words sharing a beginning share nodes, so storing many similar words costs little more than storing one.'
    ])
  }
}

/** Puts a word in, making only the nodes that do not exist yet. */
export function insertIntoTrie(trie: Trie, word: string, quiet = false): { structure: Trie; run: Run; added: boolean } {
  const recorder = new Recorder(quiet)
  const clean = String(word).trim().toLowerCase()
  if (clean.length === 0) {
    recorder.note('refused', 'An empty word cannot go in.', () => triePicture(trie))
    return { structure: trie, added: false, run: recorder.finish('trie', 'insert', '', triePicture(trie), 'Nothing to put in.', false) }
  }
  recorder.note('start', `Put "${clean}" in.`, () => triePicture(trie))

  const nodes: Record<string, TrieNode> = { ...trie.nodes }
  let nextId = trie.nextId
  let at = trie.root
  let made = 0

  for (const letter of clean) {
    const existing = nodes[at].children[letter]
    if (existing !== undefined) {
      const node = existing
      recorder.read(`"${letter}" is already on this path, so follow it.`, () => triePicture(trie, { [node]: 'path' }))
      at = existing
      continue
    }
    const id = `p${nextId++}`
    nodes[id] = { id, letter, children: Object.freeze({}), ends: false }
    nodes[at] = { ...nodes[at], children: Object.freeze({ ...nodes[at].children, [letter]: id }) }
    // `grow` below counts the allocation. Counting it here as well is what made a shared prefix look twice as dear.
    recorder.counts.links += 1
    made += 1
    const shown: Trie = Object.freeze({ ...trie, nodes: Object.freeze({ ...nodes }), nextId })
    recorder.grow(`"${letter}" is new, so make a node for it.`, () => triePicture(shown, { [id]: 'added' }))
    at = id
  }

  if (nodes[at].ends) {
    recorder.note('done', `"${clean}" was already in.`, () => triePicture(trie, { [at]: 'found' }))
    return {
      structure: trie,
      added: false,
      run: recorder.finish('trie', 'insert', clean, triePicture(trie, { [at]: 'found' }), `"${clean}" was already there.`, false)
    }
  }
  nodes[at] = { ...nodes[at], ends: true }
  recorder.counts.writes += 1

  const result: Trie = Object.freeze({ ...trie, nodes: Object.freeze(nodes), nextId, words: trie.words + 1 })
  recorder.write(`Mark this node as the end of a word.`, () => triePicture(result, { [at]: 'added' }))
  return {
    structure: result,
    added: true,
    run: recorder.finish(
      'trie',
      'insert',
      clean,
      triePicture(result, { [at]: 'added' }),
      made === 0
        ? `"${clean}" needed no new nodes at all — every letter was already there as part of another word.`
        : `"${clean}" is in. ${made} of its ${clean.length} letters needed a new node; the rest were shared.`,
      true
    )
  }
}

/** Finds every word starting with a prefix. The operation a trie exists for. */
export function searchTrie(trie: Trie, prefix: string): Run {
  const recorder = new Recorder()
  const clean = String(prefix).trim().toLowerCase()
  recorder.note('start', clean.length === 0 ? 'List every word.' : `Find words starting "${clean}".`, () => triePicture(trie))

  let at: string | null = trie.root
  const walked: string[] = [trie.root]
  for (const letter of clean) {
    const next: string | undefined = trie.nodes[at as string].children[letter]
    if (next === undefined) {
      recorder.note('missing', `Nothing goes on from "${letter}", so no word starts that way.`, () =>
        triePicture(trie, Object.fromEntries(walked.map((one) => [one, 'path' as const])))
      )
      return recorder.finish('trie', 'starts with', clean, triePicture(trie), `No words start with "${clean}".`, false)
    }
    walked.push(next)
    recorder.read(`"${letter}" — keep going.`, () =>
      triePicture(trie, Object.fromEntries(walked.map((one) => [one, 'path' as const])))
    )
    at = next
  }

  const found: string[] = []
  const collect = (id: string, built: string): void => {
    if (trie.nodes[id].ends) found.push(built)
    for (const [letter, child] of Object.entries(trie.nodes[id].children)) collect(child, built + letter)
  }
  collect(at as string, clean)

  const marks: Record<string, Cell['mark']> = Object.fromEntries(walked.map((one) => [one, 'path' as const]))
  marks[at as string] = 'found'
  recorder.note('found', `Everything below here starts with "${clean}": ${found.join(', ')}.`, () =>
    triePicture(trie, marks)
  )
  return recorder.finish(
    'trie',
    'starts with',
    clean,
    triePicture(trie, marks),
    `${found.length} ${found.length === 1 ? 'word' : 'words'}: ${found.join(', ')}. Only ${clean.length} ${clean.length === 1 ? 'letter was' : 'letters were'} looked at to get here, however many words are stored.`,
    false
  )
}

export { treePicture, heapPicture, triePicture, heightOf, balanceOf, layOutTree }
