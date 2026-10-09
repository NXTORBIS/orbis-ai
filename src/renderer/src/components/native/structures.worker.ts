import {
  apply,
  compare,
  create,
  entryFor,
  isStructureError,
  pictureOf,
  readKeys,
  spreadOf,
  type OperationId,
  type Structure,
  type StructureId
} from '../../../../shared/structures/catalogue.ts'
import type { Walk } from '../../../../shared/structures/catalogue.ts'

/**
 * The data structures, on their own thread, holding the live structure between operations.
 *
 * ## Why a worker
 *
 * Most operations on a data structure are trivially cheap — a lookup in a tree is a handful of comparisons. Two are
 * not. Building a binary search tree from four thousand sorted keys is about eight million comparisons, which is
 * roughly 400ms, and comparing four structures over the same keys multiplies that. Either on the main thread is a
 * visible stall in the chat, so the measurement decides it, the same way it decided for the algorithm worker.
 *
 * ## The structure lives here, not in React state
 *
 * A data structure is the one thing in this platform that is genuinely stateful: inserting into a tree only means
 * something relative to what was already in it. Keeping it in the worker means an operation is a message rather than
 * a round trip of the whole structure, and — more usefully — means the *structure* is the thing that persists while
 * the snapshots that get drawn are disposable copies of it.
 *
 * One worker per card, so one structure per card, and closing the card terminates the worker and takes it with it.
 */

export type WorkerRequest =
  | {
      kind: 'make'
      generation: number
      structure: StructureId
      /** Settings only some structures use; the rest ignore them.  */
      collisions?: 'chaining' | 'linear-probing'
      buckets?: number
      compress?: boolean
      /** Keys to fill it with straight away, if any. */
      keys?: string
    }
  | { kind: 'do'; generation: number; operation: OperationId; argument?: string; walk?: Walk }
  | { kind: 'compare'; generation: number; ids: readonly string[]; keys: string; lookFor?: string }
  | { kind: 'describe'; generation: number; structure: StructureId }

export type WorkerReply =
  | {
      kind: 'state'
      generation: number
      structure: StructureId
      /** The last operation's full record, or null when the structure was merely made. */
      run: unknown
      /** The picture as it stands now. */
      picture: unknown
      /** How evenly a hash table's keys landed. Null for every other structure. */
      spread: unknown
      /** What the structure is and what it is bad at, so the panel never has to hold a second copy of that. */
      entry: unknown
    }
  | { kind: 'comparison'; generation: number; comparison: unknown }
  | { kind: 'entry'; generation: number; entry: unknown }
  | { kind: 'refused'; generation: number; says: string; fix: string }
  | { kind: 'broke'; generation: number; says: string }

const send = (reply: WorkerReply): void => {
  ;(self as unknown as { postMessage(value: unknown): void }).postMessage(reply)
}

/** The one structure this worker is holding. */
let held: Structure | null = null

const stateReply = (generation: number, run: unknown): WorkerReply => {
  if (held === null) {
    return { kind: 'broke', generation, says: 'There is no structure to show.' }
  }
  const id = held.kind as StructureId
  return {
    kind: 'state',
    generation,
    structure: id,
    run,
    picture: pictureOf(held),
    // Only a hash table has a spread, and sending null for the others is what stops the panel guessing.
    spread: held.kind === 'hash-table' ? spreadOf(held) : null,
    entry: entryFor(id)
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  const generation = typeof message.generation === 'number' ? message.generation : 0

  try {
    switch (message.kind) {
      case 'describe': {
        send({ kind: 'entry', generation, entry: entryFor(message.structure) })
        return
      }

      case 'make': {
        const made = create(message.structure, {
          ...(message.collisions === undefined ? {} : { collisions: message.collisions }),
          ...(message.buckets === undefined ? {} : { size: message.buckets }),
          ...(message.compress === undefined ? {} : { compress: message.compress })
        })
        if (isStructureError(made)) {
          send({ kind: 'refused', generation, says: made.says, fix: made.fix })
          return
        }
        held = made

        const typed = String(message.keys ?? '').trim()
        if (typed.length === 0) {
          send(stateReply(generation, null))
          return
        }

        /*
         * Filling it. A structure with a `build` uses it, because building in one go is a different and cheaper
         * operation than inserting one at a time — a heap most of all — and using the wrong one would make the cost
         * shown wrong. Everything else is filled with whichever add it has.
         */
        const entry = entryFor(message.structure)
        const has = (one: OperationId): boolean => entry?.operations.some((two) => two.id === one) ?? false

        if (has('build')) {
          const built = apply(held, { operation: 'build', argument: typed })
          if (isStructureError(built)) {
            send({ kind: 'refused', generation, says: built.says, fix: built.fix })
            return
          }
          held = built.structure
          send(stateReply(generation, built.run))
          return
        }

        const keys = readKeys(typed)
        if (isStructureError(keys)) {
          send({ kind: 'refused', generation, says: keys.says, fix: keys.fix })
          return
        }
        const adder: OperationId = has('add') ? 'add' : has('addBack') ? 'addBack' : 'addFront'
        let last: unknown = null
        for (const key of keys) {
          const done = apply(held, { operation: adder, argument: String(key) })
          if (isStructureError(done)) {
            send({ kind: 'refused', generation, says: done.says, fix: done.fix })
            return
          }
          held = done.structure
          last = done.run
        }
        send(stateReply(generation, last))
        return
      }

      case 'do': {
        if (held === null) {
          send({
            kind: 'refused',
            generation,
            says: 'There is no structure yet.',
            fix: 'Pick a structure and some keys first.'
          })
          return
        }
        const done = apply(held, {
          operation: message.operation,
          ...(message.argument === undefined ? {} : { argument: message.argument }),
          ...(message.walk === undefined ? {} : { walk: message.walk })
        })
        if (isStructureError(done)) {
          send({ kind: 'refused', generation, says: done.says, fix: done.fix })
          return
        }
        held = done.structure
        send(stateReply(generation, done.run))
        return
      }

      case 'compare': {
        const keys = readKeys(message.keys)
        if (isStructureError(keys)) {
          send({ kind: 'refused', generation, says: keys.says, fix: keys.fix })
          return
        }
        const typed = String(message.lookFor ?? '').trim()
        const lookFor =
          typed.length === 0 ? null : Number.isFinite(Number(typed)) ? Number(typed) : typed
        const made = compare(message.ids as readonly StructureId[], keys, lookFor)
        if (isStructureError(made)) {
          send({ kind: 'refused', generation, says: made.says, fix: made.fix })
          return
        }
        send({ kind: 'comparison', generation, comparison: made })
        return
      }

      default:
        return
    }
  } catch (error) {
    // A throw here is a fault in Orbis, and saying which stage it happened in is what makes it findable.
    send({
      kind: 'broke',
      generation,
      says: `The structure engine stopped while ${message.kind === 'compare' ? 'comparing' : 'working'}: ${
        error instanceof Error ? error.message : String(error)
      }`
    })
  }
}
