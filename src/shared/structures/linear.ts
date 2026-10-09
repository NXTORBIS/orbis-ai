import {
  compareKeys,
  emptySnapshot,
  Recorder,
  refuse,
  type Cell,
  type Link,
  type Run,
  type Snapshot,
  type StructureError
} from './model.ts'

/**
 * The structures that are a line of things: stacks, queues, deques and linked lists.
 *
 * ## A stack and a linked list are different pictures of the same idea, and that is the lesson
 *
 * Pushing onto a stack costs one write. Adding to the front of a linked list costs one allocation and two pointer
 * changes. Adding to the *end* of a singly linked list costs a walk the whole way down — and the counts show that,
 * which is why both are here rather than one standing in for the other.
 *
 * ## The lists are really linked
 *
 * A linked list here is nodes with `next` fields, not an array drawn with arrows between the boxes. So removing from
 * the middle genuinely repoints one pointer and genuinely requires finding the node before it, and the step
 * transcript says so. An array pretending to be a list would get the complexity of every operation wrong.
 */

// ---------------------------------------------------------------- stacks and queues

/**
 * A stack, a queue or a deque.
 *
 * All three are one array plus a rule about which ends may be used, so they are one type. The rule is enforced in
 * the operations rather than by separate classes, because the whole difference between them *is* the rule.
 */
export interface Linear {
  kind: 'stack' | 'queue' | 'deque'
  items: readonly (number | string)[]
  /** What the structure may not hold more than. Null is unbounded. */
  capacity: number | null
}

export const newLinear = (kind: Linear['kind'], capacity: number | null = null): Linear =>
  Object.freeze({ kind, items: Object.freeze([]), capacity })

const LINEAR_WORDS: Readonly<Record<Linear['kind'], { top: string; add: string; take: string }>> = Object.freeze({
  stack: { top: 'top', add: 'push', take: 'pop' },
  queue: { top: 'front', add: 'enqueue', take: 'dequeue' },
  deque: { top: 'front', add: 'add', take: 'take' }
})

function linearPicture(structure: Linear, marks: Readonly<Record<number, Cell['mark']>> = {}): Snapshot {
  const words = LINEAR_WORDS[structure.kind]
  const cells: Cell[] = structure.items.map((value, at) => {
    const cell: Cell = { id: `i${at}`, value, at }
    const mark = marks[at]
    if (mark) (cell as { mark?: Cell['mark'] }).mark = mark
    // The end that matters is labelled, because "the top" is the whole point of a stack and an unlabelled row hides it.
    if (structure.kind === 'stack' && at === structure.items.length - 1) (cell as { note?: string }).note = 'top'
    if (structure.kind === 'queue' && at === 0) (cell as { note?: string }).note = 'front'
    if (structure.kind === 'queue' && at === structure.items.length - 1 && structure.items.length > 1) {
      ;(cell as { note?: string }).note = 'back'
    }
    if (structure.kind === 'deque' && structure.items.length > 0) {
      if (at === 0) (cell as { note?: string }).note = 'front'
      if (at === structure.items.length - 1 && structure.items.length > 1) (cell as { note?: string }).note = 'back'
    }
    return cell
  })
  const notes: string[] = [
    structure.items.length === 0
      ? 'Empty.'
      : `${structure.items.length} ${structure.items.length === 1 ? 'item' : 'items'}, ${words.top} is ${String(
          structure.kind === 'stack' ? structure.items[structure.items.length - 1] : structure.items[0]
        )}.`
  ]
  if (structure.capacity !== null) {
    notes.push(`Holds at most ${structure.capacity}. ${structure.capacity - structure.items.length} free.`)
  }
  return { layout: 'row', cells: Object.freeze(cells), links: Object.freeze([]), notes: Object.freeze(notes) }
}

/** Puts a value in. For a deque, `end` says which end; a stack and a queue each have only one place it may go. */
export function addLinear(
  structure: Linear,
  value: number | string,
  end: 'front' | 'back' = 'back'
): { structure: Linear; run: Run } | StructureError {
  const words = LINEAR_WORDS[structure.kind]
  if (structure.capacity !== null && structure.items.length >= structure.capacity) {
    const recorder = new Recorder()
    recorder.note('refused', `It is full — ${structure.capacity} is the most it holds.`, () => linearPicture(structure))
    return {
      structure,
      run: recorder.finish(
        structure.kind,
        words.add,
        String(value),
        linearPicture(structure),
        `It is full, so ${String(value)} was not added.`,
        false
      )
    }
  }
  if (structure.kind !== 'deque' && end === 'front') {
    return refuse(
      'wrong end',
      `A ${structure.kind} does not take things at the front.`,
      structure.kind === 'stack'
        ? 'A stack only pushes onto the top. Use a deque if you need both ends.'
        : 'A queue only joins at the back. Use a deque if you need both ends.'
    )
  }

  const recorder = new Recorder()
  recorder.note('start', `${words.add} ${String(value)}.`, () => linearPicture(structure))
  const items = end === 'front' ? [value, ...structure.items] : [...structure.items, value]
  const made: Linear = Object.freeze({ ...structure, items: Object.freeze(items) })
  const at = end === 'front' ? 0 : items.length - 1
  recorder.write(
    end === 'front'
      ? `${String(value)} goes at the front. Everything else shifts along.`
      : `${String(value)} goes in at position ${at}.`,
    () => linearPicture(made, { [at]: 'added' })
  )
  /*
   * Adding at the front of an array-backed deque moves every other item. That is a real cost and it is counted, so
   * the table does not make a deque look like a linked list.
   */
  if (end === 'front') for (let i = 1; i < items.length; i += 1) recorder.counts.writes += 1

  return {
    structure: made,
    run: recorder.finish(
      structure.kind,
      words.add,
      String(value),
      linearPicture(made, { [at]: 'added' }),
      `${String(value)} is in. ${items.length} ${items.length === 1 ? 'item' : 'items'} now.`,
      true
    )
  }
}

/** Takes a value out. A stack takes from the top, a queue from the front, a deque from whichever end is asked. */
export function takeLinear(
  structure: Linear,
  end: 'front' | 'back' = 'front'
): { structure: Linear; run: Run; value: number | string | null } | StructureError {
  const words = LINEAR_WORDS[structure.kind]
  const recorder = new Recorder()
  if (structure.items.length === 0) {
    recorder.note('missing', 'There is nothing in it.', () => linearPicture(structure))
    return {
      structure,
      value: null,
      run: recorder.finish(
        structure.kind,
        words.take,
        '',
        linearPicture(structure),
        'Nothing came out — it was empty.',
        false
      )
    }
  }
  if (structure.kind === 'stack' && end !== 'back') {
    // A pop is the back of the array, which is the top of the stack. Asking for the front is asking for a queue.
    return takeLinear(structure, 'back')
  }
  if (structure.kind === 'queue' && end !== 'front') {
    return refuse('wrong end', 'A queue does not take from the back.', 'Use a deque if you need both ends.')
  }

  const at = end === 'front' ? 0 : structure.items.length - 1
  const value = structure.items[at]
  recorder.read(`Look at the ${structure.kind === 'stack' ? 'top' : end}: ${String(value)}.`, () =>
    linearPicture(structure, { [at]: 'looking' })
  )
  const items = end === 'front' ? structure.items.slice(1) : structure.items.slice(0, -1)
  const made: Linear = Object.freeze({ ...structure, items: Object.freeze(items) })
  recorder.write(`Take ${String(value)} out.`, () => linearPicture(made))
  if (end === 'front') for (let i = 0; i < items.length; i += 1) recorder.counts.writes += 1

  return {
    structure: made,
    value,
    run: recorder.finish(
      structure.kind,
      words.take,
      '',
      linearPicture(made),
      `${String(value)} came out. ${items.length} ${items.length === 1 ? 'item' : 'items'} left.`,
      true
    )
  }
}

/** Looks without taking. */
export function peekLinear(structure: Linear, end: 'front' | 'back' = 'front'): Run {
  const recorder = new Recorder()
  if (structure.items.length === 0) {
    recorder.note('missing', 'There is nothing to look at.', () => linearPicture(structure))
    return recorder.finish(structure.kind, 'peek', '', linearPicture(structure), 'It is empty.', false)
  }
  const at = structure.kind === 'stack' ? structure.items.length - 1 : end === 'front' ? 0 : structure.items.length - 1
  const value = structure.items[at]
  recorder.read(`The ${structure.kind === 'stack' ? 'top' : end} is ${String(value)}.`, () =>
    linearPicture(structure, { [at]: 'found' })
  )
  return recorder.finish(
    structure.kind,
    'peek',
    '',
    linearPicture(structure, { [at]: 'found' }),
    `${String(value)}. Nothing was taken out.`,
    false
  )
}

// ---------------------------------------------------------------- linked lists

interface ListNode {
  id: string
  value: number | string
  next: string | null
  previous: string | null
}

/**
 * A singly or doubly linked list, stored as nodes in a map.
 *
 * Kept as a map of id to node rather than as objects pointing at each other so a snapshot can be taken without
 * walking anything, and so the whole structure can be frozen. The pointers are still pointers: `next` holds an id,
 * and following it is a read.
 */
export interface LinkedList {
  kind: 'linked-list' | 'doubly-linked-list'
  nodes: Readonly<Record<string, ListNode>>
  head: string | null
  tail: string | null
  /** Rises forever, so a removed node's id is never handed to a new node and a renderer never confuses the two. */
  nextId: number
}

export const newList = (kind: LinkedList['kind']): LinkedList =>
  Object.freeze({ kind, nodes: Object.freeze({}), head: null, tail: null, nextId: 1 })

/** Walks the list once, giving the node ids in order. Stops if the list is circular, which is a bug, not an input. */
function order(list: LinkedList): readonly string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let at = list.head
  while (at !== null) {
    if (seen.has(at)) break
    seen.add(at)
    out.push(at)
    at = list.nodes[at]?.next ?? null
  }
  return out
}

function listPicture(list: LinkedList, marks: Readonly<Record<string, Cell['mark']>> = {}): Snapshot {
  const ids = order(list)
  if (ids.length === 0) return emptySnapshot('chain', ['Empty. The head points at nothing.'])
  const cells: Cell[] = ids.map((id, at) => {
    const cell: Cell = { id, value: list.nodes[id].value, at }
    const mark = marks[id]
    if (mark) (cell as { mark?: Cell['mark'] }).mark = mark
    if (id === list.head) (cell as { note?: string }).note = ids.length === 1 ? 'head, tail' : 'head'
    else if (id === list.tail) (cell as { note?: string }).note = 'tail'
    return cell
  })
  const links: Link[] = []
  for (let i = 0; i < ids.length - 1; i += 1) {
    links.push({ from: ids[i], to: ids[i + 1], role: 'next' })
    if (list.kind === 'doubly-linked-list') links.push({ from: ids[i + 1], to: ids[i], role: 'prev' })
  }
  const notes = [
    `${ids.length} ${ids.length === 1 ? 'node' : 'nodes'}.`,
    list.kind === 'doubly-linked-list'
      ? 'Each node points both ways, so it can be walked from either end.'
      : 'Each node points only forward, so reaching the end means walking the whole way.'
  ]
  return { layout: 'chain', cells: Object.freeze(cells), links: Object.freeze(links), notes: Object.freeze(notes) }
}

/** Adds to the front. One allocation, one or two pointer changes, no walk — which is a list's one real advantage. */
export function addFront(list: LinkedList, value: number | string): { structure: LinkedList; run: Run } {
  const recorder = new Recorder()
  recorder.note('start', `Add ${String(value)} at the front.`, () => listPicture(list))

  const id = `n${list.nextId}`
  const node: ListNode = { id, value, next: list.head, previous: null }
  const nodes: Record<string, ListNode> = { ...list.nodes, [id]: node }
  recorder.grow(`Make a node holding ${String(value)}.`, () => listPicture(list))

  if (list.head !== null) {
    nodes[list.head] = { ...nodes[list.head], previous: list.kind === 'doubly-linked-list' ? id : null }
    if (list.kind === 'doubly-linked-list') recorder.counts.links += 1
  }
  const made: LinkedList = Object.freeze({
    ...list,
    nodes: Object.freeze(nodes),
    head: id,
    tail: list.tail ?? id,
    nextId: list.nextId + 1
  })
  recorder.link(
    list.head === null
      ? 'The list was empty, so this node is both the head and the tail.'
      : `Point the new node at the old head, and make it the head.`,
    () => listPicture(made, { [id]: 'added' })
  )

  return {
    structure: made,
    run: recorder.finish(
      list.kind,
      'add at front',
      String(value),
      listPicture(made, { [id]: 'added' }),
      `${String(value)} is at the front. No walking was needed.`,
      true
    )
  }
}

/**
 * Adds to the end.
 *
 * A singly linked list has no pointer back, so this walks from the head — and every node it passes is a counted read.
 * That is why `tail` exists on the doubly linked version and why the counts differ so sharply between the two.
 */
export function addBack(list: LinkedList, value: number | string): { structure: LinkedList; run: Run } {
  const recorder = new Recorder()
  recorder.note('start', `Add ${String(value)} at the end.`, () => listPicture(list))

  const id = `n${list.nextId}`
  const nodes: Record<string, ListNode> = { ...list.nodes }

  let last: string | null = null
  if (list.kind === 'doubly-linked-list') {
    last = list.tail
    if (last !== null) recorder.read('The tail pointer goes straight there — no walking.', () => listPicture(list, { [last as string]: 'looking' }))
  } else {
    // The walk. Counted read by read, because this is the cost the picture is meant to make obvious.
    let at = list.head
    let steps = 0
    while (at !== null) {
      steps += 1
      const here = at
      recorder.read(`Walk: node ${steps} holds ${String(nodes[here].value)}.`, () => listPicture(list, { [here]: 'path' }))
      if (nodes[at].next === null) break
      at = nodes[at].next
    }
    last = at
    recorder.reached(steps)
  }

  nodes[id] = { id, value, next: null, previous: list.kind === 'doubly-linked-list' ? last : null }
  recorder.grow(`Make a node holding ${String(value)}.`, () => listPicture(list))

  if (last !== null) {
    nodes[last] = { ...nodes[last], next: id }
    recorder.counts.links += 1
    if (list.kind === 'doubly-linked-list') recorder.counts.links += 1
  }

  const made: LinkedList = Object.freeze({
    ...list,
    nodes: Object.freeze(nodes),
    head: list.head ?? id,
    tail: id,
    nextId: list.nextId + 1
  })
  recorder.link(last === null ? 'The list was empty, so this is the head too.' : 'Point the last node at the new one.', () =>
    listPicture(made, { [id]: 'added' })
  )

  const walked = list.kind === 'linked-list' ? recorder.counts.reads : 0
  return {
    structure: made,
    run: recorder.finish(
      list.kind,
      'add at end',
      String(value),
      listPicture(made, { [id]: 'added' }),
      walked > 0
        ? `${String(value)} is at the end. It took walking past ${walked} ${walked === 1 ? 'node' : 'nodes'} to find it.`
        : `${String(value)} is at the end. The tail pointer meant no walking.`,
      true
    )
  }
}

/** Finds a value, reporting how far in it was. */
export function findInList(list: LinkedList, value: number | string): Run {
  const recorder = new Recorder()
  recorder.note('start', `Look for ${String(value)}.`, () => listPicture(list))
  const ids = order(list)
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]
    const here = list.nodes[id].value
    recorder.compare(`Node ${i + 1} holds ${String(here)}.`, () => listPicture(list, { [id]: 'looking' }))
    if (compareKeys(here, value) === 0) {
      recorder.note('found', `That is it — position ${i + 1}.`, () => listPicture(list, { [id]: 'found' }))
      return recorder.finish(
        list.kind,
        'find',
        String(value),
        listPicture(list, { [id]: 'found' }),
        `Found at position ${i + 1} of ${ids.length}, after ${i + 1} ${i === 0 ? 'comparison' : 'comparisons'}.`,
        false
      )
    }
  }
  recorder.note('missing', 'Reached the end without finding it.', () => listPicture(list))
  return recorder.finish(
    list.kind,
    'find',
    String(value),
    listPicture(list),
    `Not there. Finding that out meant looking at all ${ids.length} ${ids.length === 1 ? 'node' : 'nodes'}.`,
    false
  )
}

/** Removes the first node holding a value. */
export function removeFromList(
  list: LinkedList,
  value: number | string
): { structure: LinkedList; run: Run; removed: boolean } {
  const recorder = new Recorder()
  recorder.note('start', `Remove ${String(value)}.`, () => listPicture(list))
  const ids = order(list)

  let found = -1
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]
    recorder.compare(`Node ${i + 1} holds ${String(list.nodes[id].value)}.`, () => listPicture(list, { [id]: 'looking' }))
    if (compareKeys(list.nodes[id].value, value) === 0) {
      found = i
      break
    }
  }
  if (found < 0) {
    recorder.note('missing', 'It is not in the list.', () => listPicture(list))
    return {
      structure: list,
      removed: false,
      run: recorder.finish(list.kind, 'remove', String(value), listPicture(list), 'Not there, so nothing changed.', false)
    }
  }

  const id = ids[found]
  const before = found > 0 ? ids[found - 1] : null
  const after = list.nodes[id].next
  const nodes: Record<string, ListNode> = { ...list.nodes }
  delete nodes[id]

  if (before !== null) {
    nodes[before] = { ...nodes[before], next: after }
    recorder.counts.links += 1
  }
  if (after !== null && list.kind === 'doubly-linked-list') {
    nodes[after] = { ...nodes[after], previous: before }
    recorder.counts.links += 1
  }

  const made: LinkedList = Object.freeze({
    ...list,
    nodes: Object.freeze(nodes),
    head: list.head === id ? after : list.head,
    tail: list.tail === id ? before : list.tail
  })
  recorder.note(
    'link',
    before === null
      ? 'It was the head, so the head now points at the next node.'
      : `Point node ${found} past it, straight at ${after === null ? 'nothing' : String(list.nodes[after].value)}.`,
    () => listPicture(made)
  )

  return {
    structure: made,
    removed: true,
    run: recorder.finish(
      list.kind,
      'remove',
      String(value),
      listPicture(made),
      `${String(value)} is out. Finding it took ${found + 1} ${found === 0 ? 'comparison' : 'comparisons'}; taking it out took ${recorder.counts.links} pointer ${recorder.counts.links === 1 ? 'change' : 'changes'}.`,
      true
    )
  }
}

/**
 * Reverses the list in place.
 *
 * Here because it is the operation that makes the difference between the two kinds of list obvious: a singly linked
 * list must repoint every `next` as it walks, and the step transcript shows each one.
 */
export function reverseList(list: LinkedList): { structure: LinkedList; run: Run } {
  const recorder = new Recorder()
  recorder.note('start', 'Reverse it.', () => listPicture(list))
  const ids = order(list)
  if (ids.length < 2) {
    recorder.note('done', 'Fewer than two nodes — there is nothing to reverse.', () => listPicture(list))
    return { structure: list, run: recorder.finish(list.kind, 'reverse', '', listPicture(list), 'Nothing to do.', false) }
  }

  const nodes: Record<string, ListNode> = { ...list.nodes }
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]
    const previous = i > 0 ? ids[i - 1] : null
    nodes[id] = {
      ...nodes[id],
      next: previous,
      previous: list.kind === 'doubly-linked-list' ? (i < ids.length - 1 ? ids[i + 1] : null) : null
    }
    recorder.counts.links += 1
  }
  const made: LinkedList = Object.freeze({
    ...list,
    nodes: Object.freeze(nodes),
    head: ids[ids.length - 1],
    tail: ids[0]
  })
  // `note`, not `link`: the loop above already counted one pointer change per node, and counting the summary step
  // again would overstate the cost by one.
  recorder.note('link', 'Every next pointer now points the other way.', () => listPicture(made))

  return {
    structure: made,
    run: recorder.finish(
      list.kind,
      'reverse',
      '',
      listPicture(made),
      `Reversed, by changing ${ids.length} pointers. Nothing was copied and no new node was made.`,
      true
    )
  }
}

export { listPicture, linearPicture, order as listOrder }
