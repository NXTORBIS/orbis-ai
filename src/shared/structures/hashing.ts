import { compareKeys, Recorder, refuse, type Cell, type Run, type Snapshot, type StructureError } from './model.ts'

/**
 * The structures built on a hash: hash tables, and the union-find that behaves like one.
 *
 * ## The hash is a real hash, and the collisions are real collisions
 *
 * The bucket a key lands in comes from an actual hash function applied to the key — FNV-1a, which is short enough to
 * read and good enough that the distribution is not a lie. So two keys landing in the same bucket happens because
 * those keys genuinely hash the same way at that table size, not because a demonstration arranged it. Resizing the
 * table rehashes everything and the keys move to different buckets, which is the thing a learner needs to see.
 *
 * ## Both collision strategies, because they fail differently
 *
 * Chaining makes a bucket hold a list. Open addressing walks to the next free slot, which means a deletion cannot
 * simply blank a slot — doing so would cut the probe chain and hide every key after it. So this keeps tombstones, and
 * says what they are, because "why is my hash table slowing down after many deletions" is the lesson.
 */

/** FNV-1a, 32-bit. Chosen for being short enough to show and well-distributed enough not to mislead. */
export function hashOf(key: number | string): number {
  const text = String(key)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    // The FNV prime, multiplied in 16-bit halves so it stays exact in a double.
    hash = (hash * 0x01000193) >>> 0
  }
  return hash >>> 0
}

export type Collisions = 'chaining' | 'linear-probing'

interface Entry {
  key: number | string
  value: number | string | null
  /** An open-addressed slot that held a key which has since gone. Not empty, or the probe chain would break. */
  tombstone?: true
}

export interface HashTable {
  kind: 'hash-table'
  collisions: Collisions
  /** One array per bucket for chaining; one entry or null per slot for probing. */
  buckets: readonly (readonly Entry[])[]
  count: number
  /** When the table grows. Above this, lookups get slow enough to matter. */
  loadLimit: number
  resizes: number
}

export const newTable = (collisions: Collisions, size = 8, loadLimit = 0.75): HashTable =>
  Object.freeze({
    kind: 'hash-table',
    collisions,
    buckets: Object.freeze(Array.from({ length: size }, () => Object.freeze([] as Entry[]))),
    count: 0,
    loadLimit,
    resizes: 0
  })

const bucketFor = (key: number | string, size: number): number => hashOf(key) % size

function tablePicture(table: HashTable, marks: Readonly<Record<number, Cell['mark']>> = {}): Snapshot {
  const cells: Cell[] = []
  for (let i = 0; i < table.buckets.length; i += 1) {
    const bucket = table.buckets[i]
    const mark = marks[i]
    if (table.collisions === 'chaining') {
      const cell: Cell = {
        id: `b${i}`,
        value: bucket.length === 0 ? null : bucket.map((one) => String(one.key)).join(' → '),
        at: i,
        note: String(i)
      }
      if (mark) (cell as { mark?: Cell['mark'] }).mark = mark
      cells.push(cell)
    } else {
      const entry = bucket[0]
      const cell: Cell = {
        id: `b${i}`,
        value: entry === undefined ? null : entry.tombstone ? '×' : String(entry.key),
        at: i,
        note: String(i)
      }
      if (mark) (cell as { mark?: Cell['mark'] }).mark = mark
      else if (entry?.tombstone) (cell as { mark?: Cell['mark'] }).mark = 'removed'
      cells.push(cell)
    }
  }

  const used = table.buckets.filter((one) => one.length > 0 && !(one[0]?.tombstone && one.length === 1)).length
  const load = table.count / table.buckets.length
  const longest = Math.max(0, ...table.buckets.map((one) => one.filter((two) => !two.tombstone).length))
  const notes: string[] = [
    `${table.count} ${table.count === 1 ? 'key' : 'keys'} in ${table.buckets.length} buckets — ${(load * 100).toFixed(0)}% full.`
  ]
  if (table.collisions === 'chaining') {
    notes.push(
      longest <= 1
        ? 'No bucket holds more than one key, so every lookup is one step.'
        : `The longest chain holds ${longest} keys, so a lookup landing there costs ${longest} comparisons instead of one.`
    )
  } else {
    const tombstones = table.buckets.filter((one) => one[0]?.tombstone).length
    notes.push(
      `${used} ${used === 1 ? 'slot' : 'slots'} in use${tombstones > 0 ? `, and ${tombstones} ${tombstones === 1 ? 'tombstone' : 'tombstones'} from removed keys` : ''}.`
    )
    if (tombstones > 0) {
      notes.push(
        'A tombstone is a slot whose key was removed. It cannot be left empty, or the walk looking for a later key would stop here and miss it.'
      )
    }
  }
  if (table.resizes > 0) notes.push(`It has grown ${table.resizes} ${table.resizes === 1 ? 'time' : 'times'}, rehashing everything each time.`)
  return { layout: 'buckets', cells: Object.freeze(cells), links: Object.freeze([]), notes: Object.freeze(notes) }
}

/** Rebuilds the table at double the size, rehashing every key. */
function grown(table: HashTable): HashTable {
  const size = table.buckets.length * 2
  const buckets: Entry[][] = Array.from({ length: size }, () => [])
  for (const bucket of table.buckets) {
    for (const entry of bucket) {
      if (entry.tombstone) continue
      if (table.collisions === 'chaining') buckets[bucketFor(entry.key, size)].push({ ...entry })
      else {
        let at = bucketFor(entry.key, size)
        while (buckets[at].length > 0) at = (at + 1) % size
        buckets[at] = [{ ...entry }]
      }
    }
  }
  return Object.freeze({
    ...table,
    buckets: Object.freeze(buckets.map((one) => Object.freeze(one))),
    resizes: table.resizes + 1
  })
}

/** Puts a key in, or replaces its value if it is already there. */
export function putInTable(
  table: HashTable,
  key: number | string,
  value: number | string | null = null,
  quiet = false
): { structure: HashTable; run: Run; added: boolean } {
  const recorder = new Recorder(quiet)
  const hash = hashOf(key)
  let at = hash % table.buckets.length
  recorder.note(
    'start',
    `Hash "${String(key)}" — it comes out as ${hash}, and ${hash} out of ${table.buckets.length} leaves ${at}, so it belongs in bucket ${at}.`,
    () => tablePicture(table, { [at]: 'looking' })
  )

  const buckets = table.buckets.map((one) => [...one])

  if (table.collisions === 'chaining') {
    recorder.probe(`Look in bucket ${at}.`, () => tablePicture(table, { [at]: 'looking' }))
    const bucket = buckets[at]
    for (let i = 0; i < bucket.length; i += 1) {
      recorder.compare(`Bucket ${at} already holds ${String(bucket[i].key)}.`, () => tablePicture(table, { [at]: 'looking' }))
      if (compareKeys(bucket[i].key, key) === 0) {
        bucket[i] = { key, value }
        recorder.counts.writes += 1
        const made: HashTable = Object.freeze({ ...table, buckets: Object.freeze(buckets.map((one) => Object.freeze(one))) })
        recorder.write(`${String(key)} is already there, so its value is replaced.`, () => tablePicture(made, { [at]: 'changed' }))
        return {
          structure: made,
          added: false,
          run: recorder.finish('hash-table', 'put', String(key), tablePicture(made, { [at]: 'changed' }), `${String(key)} was already in bucket ${at}; its value changed.`, true)
        }
      }
    }
    bucket.push({ key, value })
    recorder.counts.writes += 1
    const collided = bucket.length > 1
    let made: HashTable = Object.freeze({
      ...table,
      buckets: Object.freeze(buckets.map((one) => Object.freeze(one))),
      count: table.count + 1
    })
    recorder.write(
      collided
        ? `Bucket ${at} was taken, so ${String(key)} joins the chain there. That is a collision — two different keys hashing to the same bucket.`
        : `Bucket ${at} was free, so ${String(key)} goes straight in.`,
      () => tablePicture(made, { [at]: 'added' })
    )
    if (made.count / made.buckets.length > made.loadLimit) {
      const before = made.buckets.length
      made = grown(made)
      recorder.grow(
        `It is more than ${(made.loadLimit * 100).toFixed(0)}% full, so the table doubles from ${before} to ${made.buckets.length} buckets and every key is hashed again. Keys land in different buckets now.`,
        () => tablePicture(made)
      )
    }
    return {
      structure: made,
      added: true,
      run: recorder.finish(
        'hash-table',
        'put',
        String(key),
        tablePicture(made),
        collided
          ? `${String(key)} is in bucket ${at}, sharing it with ${bucket.length - 1} other ${bucket.length === 2 ? 'key' : 'keys'}.`
          : `${String(key)} is in bucket ${at}, on its own.`,
        true
      )
    }
  }

  // Open addressing. Walk forward until a free slot, a tombstone that can be reused, or the key itself.
  const size = table.buckets.length
  let firstTombstone = -1
  for (let tried = 0; tried < size; tried += 1) {
    const here = at
    const entry = buckets[here][0]
    recorder.probe(
      entry === undefined
        ? `Slot ${here} is empty.`
        : entry.tombstone
          ? `Slot ${here} is a tombstone — something was removed from it.`
          : `Slot ${here} holds ${String(entry.key)}.`,
      () => tablePicture(table, { [here]: 'looking' })
    )
    if (entry === undefined) {
      const landing = firstTombstone >= 0 ? firstTombstone : here
      buckets[landing] = [{ key, value }]
      recorder.counts.writes += 1
      let made: HashTable = Object.freeze({
        ...table,
        buckets: Object.freeze(buckets.map((one) => Object.freeze(one))),
        count: table.count + 1
      })
      recorder.write(
        firstTombstone >= 0
          ? `Reuse the tombstone at slot ${landing} rather than the empty slot — it is earlier in the walk.`
          : `${String(key)} goes in slot ${landing}.`,
        () => tablePicture(made, { [landing]: 'added' })
      )
      if (made.count / made.buckets.length > made.loadLimit) {
        const before = made.buckets.length
        made = grown(made)
        recorder.grow(
          `Over ${(made.loadLimit * 100).toFixed(0)}% full, so the table doubles from ${before} to ${made.buckets.length} slots, every key is rehashed, and the tombstones are dropped.`,
          () => tablePicture(made)
        )
      }
      const walked = recorder.counts.probes
      return {
        structure: made,
        added: true,
        run: recorder.finish(
          'hash-table',
          'put',
          String(key),
          tablePicture(made),
          walked === 1
            ? `${String(key)} went straight into slot ${landing}.`
            : `${String(key)} is in slot ${landing}, after trying ${walked} slots — the ones before it were taken by keys that hashed nearby.`,
          true
        )
      }
    }
    if (entry.tombstone) {
      if (firstTombstone < 0) firstTombstone = here
    } else {
      recorder.counts.comparisons += 1
      if (compareKeys(entry.key, key) === 0) {
        buckets[here] = [{ key, value }]
        recorder.counts.writes += 1
        const made: HashTable = Object.freeze({ ...table, buckets: Object.freeze(buckets.map((one) => Object.freeze(one))) })
        recorder.write(`${String(key)} is already in slot ${here}, so its value is replaced.`, () => tablePicture(made, { [here]: 'changed' }))
        return {
          structure: made,
          added: false,
          run: recorder.finish('hash-table', 'put', String(key), tablePicture(made, { [here]: 'changed' }), `${String(key)} was already there.`, true)
        }
      }
    }
    at = (at + 1) % size
  }

  return refuseFull(table, key)
}

function refuseFull(table: HashTable, key: number | string): { structure: HashTable; run: Run; added: boolean } {
  const recorder = new Recorder()
  recorder.note('refused', 'Every slot is taken, so there is nowhere for it to go.', () => tablePicture(table))
  return {
    structure: table,
    added: false,
    run: recorder.finish('hash-table', 'put', String(key), tablePicture(table), 'The table is completely full.', false)
  }
}

/** Looks a key up. */
export function findInTable(table: HashTable, key: number | string): Run {
  const recorder = new Recorder()
  const hash = hashOf(key)
  let at = hash % table.buckets.length
  recorder.note('start', `"${String(key)}" hashes to bucket ${at}.`, () => tablePicture(table, { [at]: 'looking' }))

  if (table.collisions === 'chaining') {
    const bucket = table.buckets[at]
    recorder.probe(`Look in bucket ${at} — it holds ${bucket.length} ${bucket.length === 1 ? 'key' : 'keys'}.`, () =>
      tablePicture(table, { [at]: 'looking' })
    )
    for (const entry of bucket) {
      recorder.compare(`Is it ${String(entry.key)}?`, () => tablePicture(table, { [at]: 'looking' }))
      if (compareKeys(entry.key, key) === 0) {
        recorder.note('found', `Yes.`, () => tablePicture(table, { [at]: 'found' }))
        return recorder.finish(
          'hash-table',
          'find',
          String(key),
          tablePicture(table, { [at]: 'found' }),
          `Found in bucket ${at} after ${recorder.counts.comparisons} ${recorder.counts.comparisons === 1 ? 'comparison' : 'comparisons'}. One bucket was looked in, whatever the table's size.`,
          false
        )
      }
    }
    recorder.note('missing', `Bucket ${at} does not hold it, so nothing does.`, () => tablePicture(table, { [at]: 'looking' }))
    return recorder.finish(
      'hash-table',
      'find',
      String(key),
      tablePicture(table),
      `Not there. Only bucket ${at} had to be looked in — a hash table does not search the others.`,
      false
    )
  }

  const size = table.buckets.length
  for (let tried = 0; tried < size; tried += 1) {
    const here = at
    const entry = table.buckets[here][0]
    if (entry === undefined) {
      recorder.probe(`Slot ${here} is empty, so the walk stops.`, () => tablePicture(table, { [here]: 'looking' }))
      recorder.note('missing', 'An empty slot means it was never put in.', () => tablePicture(table))
      return recorder.finish(
        'hash-table',
        'find',
        String(key),
        tablePicture(table),
        `Not there, after trying ${recorder.counts.probes} ${recorder.counts.probes === 1 ? 'slot' : 'slots'}.`,
        false
      )
    }
    if (entry.tombstone) {
      recorder.probe(`Slot ${here} is a tombstone — keep walking, because the key may be past it.`, () =>
        tablePicture(table, { [here]: 'looking' })
      )
    } else {
      recorder.probe(`Slot ${here} holds ${String(entry.key)}.`, () => tablePicture(table, { [here]: 'looking' }))
      recorder.counts.comparisons += 1
      if (compareKeys(entry.key, key) === 0) {
        recorder.note('found', 'That is it.', () => tablePicture(table, { [here]: 'found' }))
        return recorder.finish(
          'hash-table',
          'find',
          String(key),
          tablePicture(table, { [here]: 'found' }),
          `Found in slot ${here}, after trying ${recorder.counts.probes} ${recorder.counts.probes === 1 ? 'slot' : 'slots'}.`,
          false
        )
      }
    }
    at = (at + 1) % size
  }
  recorder.note('missing', 'Walked the whole table.', () => tablePicture(table))
  return recorder.finish('hash-table', 'find', String(key), tablePicture(table), 'Not there, and the whole table had to be walked because it is full.', false)
}

/** Takes a key out. Open addressing leaves a tombstone, which is the thing worth seeing. */
export function removeFromTable(
  table: HashTable,
  key: number | string
): { structure: HashTable; run: Run; removed: boolean } {
  const recorder = new Recorder()
  const size = table.buckets.length
  let at = hashOf(key) % size
  recorder.note('start', `Remove "${String(key)}" — it belongs in bucket ${at}.`, () => tablePicture(table, { [at]: 'looking' }))
  const buckets = table.buckets.map((one) => [...one])

  if (table.collisions === 'chaining') {
    const bucket = buckets[at]
    for (let i = 0; i < bucket.length; i += 1) {
      recorder.compare(`Is it ${String(bucket[i].key)}?`, () => tablePicture(table, { [at]: 'looking' }))
      if (compareKeys(bucket[i].key, key) === 0) {
        bucket.splice(i, 1)
        recorder.counts.writes += 1
        const made: HashTable = Object.freeze({
          ...table,
          buckets: Object.freeze(buckets.map((one) => Object.freeze(one))),
          count: table.count - 1
        })
        recorder.write('Take it out of the chain. Nothing else in the bucket is affected.', () => tablePicture(made, { [at]: 'changed' }))
        return {
          structure: made,
          removed: true,
          run: recorder.finish('hash-table', 'remove', String(key), tablePicture(made), `${String(key)} is out of bucket ${at}.`, true)
        }
      }
    }
    recorder.note('missing', 'It is not in that bucket, so it is not in the table.', () => tablePicture(table))
    return {
      structure: table,
      removed: false,
      run: recorder.finish('hash-table', 'remove', String(key), tablePicture(table), 'Not there, so nothing changed.', false)
    }
  }

  for (let tried = 0; tried < size; tried += 1) {
    const here = at
    const entry = buckets[here][0]
    if (entry === undefined) {
      recorder.probe(`Slot ${here} is empty, so it was never there.`, () => tablePicture(table, { [here]: 'looking' }))
      return {
        structure: table,
        removed: false,
        run: recorder.finish('hash-table', 'remove', String(key), tablePicture(table), 'Not there, so nothing changed.', false)
      }
    }
    recorder.probe(entry.tombstone ? `Slot ${here} is a tombstone.` : `Slot ${here} holds ${String(entry.key)}.`, () =>
      tablePicture(table, { [here]: 'looking' })
    )
    if (!entry.tombstone && compareKeys(entry.key, key) === 0) {
      buckets[here] = [{ key: entry.key, value: null, tombstone: true }]
      recorder.counts.writes += 1
      const made: HashTable = Object.freeze({
        ...table,
        buckets: Object.freeze(buckets.map((one) => Object.freeze(one))),
        count: table.count - 1
      })
      recorder.write(
        'Mark the slot as a tombstone rather than emptying it. Emptying it would stop the walk here and hide any key that had to step past this slot when it was put in.',
        () => tablePicture(made, { [here]: 'removed' })
      )
      return {
        structure: made,
        removed: true,
        run: recorder.finish(
          'hash-table',
          'remove',
          String(key),
          tablePicture(made),
          `${String(key)} is gone from slot ${here}, which is now a tombstone. Enough of those and lookups slow down, which is why open addressing needs rebuilding occasionally.`,
          true
        )
      }
    }
    at = (at + 1) % size
  }
  return {
    structure: table,
    removed: false,
    run: recorder.finish('hash-table', 'remove', String(key), tablePicture(table), 'Not there.', false)
  }
}

/** How evenly the keys landed. The measurement that says whether the hash is doing its job. */
export interface Spread {
  buckets: number
  keys: number
  used: number
  emptiest: number
  longest: number
  /** What the longest chain would be if the keys were spread perfectly. */
  ideal: number
  /** Mean comparisons for a successful lookup, worked out from the actual chain lengths. */
  averageLookup: number
  says: string
}

export function spreadOf(table: HashTable): Spread {
  const lengths = table.buckets.map((one) => one.filter((two) => !two.tombstone).length)
  const keys = lengths.reduce((a, b) => a + b, 0)
  const used = lengths.filter((one) => one > 0).length
  const longest = Math.max(0, ...lengths)
  const ideal = table.buckets.length === 0 ? 0 : Math.ceil(keys / table.buckets.length)
  /*
   * The mean position a found key sits at within its own bucket. Worked out from the real lengths rather than from
   * the load factor, because the load factor assumes a spread the hash may not have achieved.
   */
  let total = 0
  for (const length of lengths) for (let i = 1; i <= length; i += 1) total += i
  const averageLookup = keys === 0 ? 0 : total / keys
  return {
    buckets: table.buckets.length,
    keys,
    used,
    emptiest: table.buckets.length - used,
    longest,
    ideal,
    averageLookup,
    says:
      keys === 0
        ? 'Nothing in it yet.'
        : longest <= ideal
          ? `The keys are spread as evenly as they can be: the busiest bucket holds ${longest}, and a successful lookup costs ${averageLookup.toFixed(2)} comparisons on average.`
          : `The busiest bucket holds ${longest} where an even spread would hold ${ideal}. A successful lookup costs ${averageLookup.toFixed(2)} comparisons on average, against ${(ideal / 2 + 0.5).toFixed(2)} if they were spread evenly.`
  }
}

// ---------------------------------------------------------------- union-find

/**
 * Disjoint sets.
 *
 * Here with the hash structures because it is the other structure whose cost is about *finding*, and because the two
 * optimisations — pointing at the root as you go, and joining the smaller tree under the bigger — are the clearest
 * example anywhere of a structure that gets faster by rewriting itself while being read.
 */
export interface UnionFind {
  kind: 'union-find'
  parent: readonly number[]
  size: readonly number[]
  labels: readonly string[]
  groups: number
  /** Off, to show what happens without it. */
  compress: boolean
}

export function newUnionFind(labels: readonly string[], compress = true): UnionFind | StructureError {
  if (labels.length < 2) return refuse('too few', 'There must be at least two things to join.', 'Give two or more names.')
  if (labels.length > 500) return refuse('too many', `${labels.length} is more than this can draw.`, 'Use 500 or fewer.')
  return Object.freeze({
    kind: 'union-find',
    parent: Object.freeze(labels.map((_, i) => i)),
    size: Object.freeze(labels.map(() => 1)),
    labels: Object.freeze(labels.slice()),
    groups: labels.length,
    compress
  })
}

function unionPicture(sets: UnionFind, marks: Readonly<Record<number, Cell['mark']>> = {}): Snapshot {
  const cells: Cell[] = []
  const depth: Record<string, number> = {}
  const links: { from: string; to: string; role: 'parent' }[] = []
  const depthOf = (at: number): number => {
    let n = 0
    let here = at
    while (sets.parent[here] !== here && n < sets.parent.length) {
      here = sets.parent[here]
      n += 1
    }
    return n
  }
  for (let i = 0; i < sets.labels.length; i += 1) {
    const cell: Cell = { id: `u${i}`, value: sets.labels[i], at: i }
    const mark = marks[i]
    if (mark) (cell as { mark?: Cell['mark'] }).mark = mark
    if (sets.parent[i] === i) (cell as { note?: string }).note = `root of ${sets.size[i]}`
    cells.push(cell)
    depth[`u${i}`] = depthOf(i)
    if (sets.parent[i] !== i) links.push({ from: `u${i}`, to: `u${sets.parent[i]}`, role: 'parent' })
  }
  const deepest = Math.max(0, ...Object.values(depth))
  return {
    layout: 'tree',
    cells: Object.freeze(cells),
    links: Object.freeze(links),
    depth: Object.freeze(depth),
    notes: Object.freeze([
      `${sets.groups} ${sets.groups === 1 ? 'group' : 'groups'} across ${sets.labels.length} things.`,
      sets.compress
        ? `Deepest chain: ${deepest}. Every lookup flattens the path it walked, so the trees stay shallow.`
        : `Deepest chain: ${deepest}. Paths are not flattened, so chains keep growing and lookups keep getting slower.`
    ])
  }
}

/** Finds which group a thing is in, flattening the path on the way back if that is switched on. */
export function findGroup(sets: UnionFind, at: number): { structure: UnionFind; run: Run; root: number } {
  const recorder = new Recorder()
  recorder.note('start', `Which group is ${sets.labels[at]} in?`, () => unionPicture(sets, { [at]: 'looking' }))
  const parent = [...sets.parent]
  const walked: number[] = []
  let here = at
  while (parent[here] !== here) {
    walked.push(here)
    const node = here
    recorder.read(`${sets.labels[node]} points at ${sets.labels[parent[node]]}.`, () =>
      unionPicture(sets, Object.fromEntries(walked.map((one) => [one, 'path' as const])))
    )
    here = parent[here]
  }
  recorder.reached(walked.length)
  const root = here
  recorder.note('found', `${sets.labels[root]} points at itself, so it is the root — that is the group.`, () =>
    unionPicture(sets, { ...Object.fromEntries(walked.map((one) => [one, 'path' as const])), [root]: 'found' })
  )

  let made = sets
  if (sets.compress && walked.length > 1) {
    for (const one of walked) parent[one] = root
    recorder.counts.links += walked.length
    made = Object.freeze({ ...sets, parent: Object.freeze(parent) })
    recorder.link(
      `Point every node walked past straight at ${sets.labels[root]}. The next lookup from any of them is one step.`,
      () => unionPicture(made, { [root]: 'found' })
    )
  }

  return {
    structure: made,
    root,
    run: recorder.finish(
      'union-find',
      'find',
      sets.labels[at],
      unionPicture(made, { [root]: 'found' }),
      walked.length === 0
        ? `${sets.labels[at]} is its own root.`
        : `${sets.labels[at]} is in ${sets.labels[root]}'s group, ${walked.length} ${walked.length === 1 ? 'step' : 'steps'} up.${sets.compress && walked.length > 1 ? ' The path was flattened on the way back.' : ''}`,
      made !== sets
    )
  }
}

/** Joins two groups, putting the smaller under the larger. */
export function join(sets: UnionFind, a: number, b: number): { structure: UnionFind; run: Run; joined: boolean } {
  const recorder = new Recorder()
  recorder.note('start', `Join ${sets.labels[a]} and ${sets.labels[b]}.`, () => unionPicture(sets, { [a]: 'looking', [b]: 'looking' }))

  const first = findGroup(sets, a)
  const second = findGroup(first.structure, b)
  recorder.counts.reads += first.run.counts.reads + second.run.counts.reads
  recorder.counts.links += first.run.counts.links + second.run.counts.links
  let working = second.structure

  if (first.root === second.root) {
    recorder.note('done', `They are already in the same group, under ${sets.labels[first.root]}.`, () =>
      unionPicture(working, { [first.root]: 'found' })
    )
    return {
      structure: working,
      joined: false,
      run: recorder.finish('union-find', 'join', `${sets.labels[a]} and ${sets.labels[b]}`, unionPicture(working), 'Already joined, so nothing changed.', working !== sets)
    }
  }

  // The smaller tree goes under the bigger one. The other way round makes the tree taller for no reason.
  const [big, small] = working.size[first.root] >= working.size[second.root] ? [first.root, second.root] : [second.root, first.root]
  const parent = [...working.parent]
  const size = [...working.size]
  parent[small] = big
  size[big] += size[small]
  recorder.counts.links += 1
  working = Object.freeze({
    ...working,
    parent: Object.freeze(parent),
    size: Object.freeze(size),
    groups: working.groups - 1
  })
  recorder.link(
    `${sets.labels[small]}'s group is the smaller, so it goes under ${sets.labels[big]}'s. Joining them the other way round would make the tree taller for nothing.`,
    () => unionPicture(working, { [big]: 'changed' })
  )

  return {
    structure: working,
    joined: true,
    run: recorder.finish(
      'union-find',
      'join',
      `${sets.labels[a]} and ${sets.labels[b]}`,
      unionPicture(working, { [big]: 'changed' }),
      `Joined under ${sets.labels[big]}. ${working.groups} ${working.groups === 1 ? 'group' : 'groups'} left.`,
      true
    )
  }
}

export { tablePicture, unionPicture }
