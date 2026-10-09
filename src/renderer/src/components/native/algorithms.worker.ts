import { run as runAlgorithm, compare as compareAlgorithms, growth as measureGrowth, type RunRequest } from '../../../../shared/algorithms/catalogue.ts'
import { makeGraph, makeNumbers, makeItems, type GraphShape, type Shape } from '../../../../shared/algorithms/inputs.ts'
import { isAlgorithmError } from '../../../../shared/algorithms/trace.ts'

/**
 * The algorithm engines, on their own thread.
 *
 * ## Measured, not assumed
 *
 * This worker exists because the cost was measured rather than guessed: a bubble sort that reaches the step ceiling
 * takes about 200ms, a merge sort of 5,000 values about 280ms, and a seven-point growth curve about 245ms. Any of
 * those on the main thread is a visible stall in the chat while somebody is typing — which §284 of the brief
 * forbids and anybody would notice. Below that threshold a worker would be complexity for appearance, which the same
 * brief warns against; above it, it is the only correct answer.
 *
 * ## Every reply carries the generation it was asked under
 *
 * The Phase 1 runtime rejects a result from before a reset by comparing generations. The same rule applies here, and
 * it is the worker's job to hand the number back untouched — so a trace from the configuration somebody has already
 * changed can be dropped rather than drawn.
 *
 * ## It computes and nothing else
 *
 * No DOM, no storage, no network. It receives a request, runs a pure engine, and posts the result. The engines it
 * calls are the same ones the test suite checks, so what is drawn is what was verified.
 */

export type WorkerRequest =
  | { kind: 'run'; generation: number; algorithm: string; request: RunRequest }
  | {
      kind: 'generate'
      generation: number
      what: 'numbers' | 'graph' | 'items'
      shape?: Shape
      graphShape?: GraphShape
      size: number
      seed: number
    }
  | { kind: 'compare'; generation: number; ids: readonly string[]; request: RunRequest }
  | { kind: 'growth'; generation: number; ids: readonly string[]; shape: Shape; seed: number }

export type WorkerReply =
  | { kind: 'run'; generation: number; run: unknown }
  | { kind: 'generate'; generation: number; what: string; made: unknown }
  | { kind: 'compare'; generation: number; comparison: unknown }
  | { kind: 'growth'; generation: number; curves: readonly unknown[] }
  | { kind: 'refused'; generation: number; says: string; fix: string }
  | { kind: 'broke'; generation: number; says: string }

const send = (reply: WorkerReply): void => {
  ;(self as unknown as { postMessage(value: unknown): void }).postMessage(reply)
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  const generation = typeof message.generation === 'number' ? message.generation : 0

  try {
    switch (message.kind) {
      case 'run': {
        const made = runAlgorithm(message.algorithm, message.request)
        if (isAlgorithmError(made)) {
          send({ kind: 'refused', generation, says: made.message, fix: made.fix })
          return
        }
        send({ kind: 'run', generation, run: made })
        return
      }
      case 'generate': {
        if (message.what === 'numbers') {
          const made = makeNumbers(message.shape ?? 'random', message.size, message.seed)
          if (isAlgorithmError(made)) return send({ kind: 'refused', generation, says: made.message, fix: made.fix })
          return send({ kind: 'generate', generation, what: 'numbers', made })
        }
        if (message.what === 'graph') {
          const made = makeGraph(message.graphShape ?? 'random', message.size, message.seed)
          if (isAlgorithmError(made)) return send({ kind: 'refused', generation, says: made.message, fix: made.fix })
          return send({ kind: 'generate', generation, what: 'graph', made })
        }
        const made = makeItems(message.size, message.seed)
        if (isAlgorithmError(made)) return send({ kind: 'refused', generation, says: made.message, fix: made.fix })
        return send({ kind: 'generate', generation, what: 'items', made })
      }
      case 'compare': {
        const made = compareAlgorithms(message.ids, message.request)
        if (isAlgorithmError(made)) {
          send({ kind: 'refused', generation, says: made.message, fix: made.fix })
          return
        }
        send({ kind: 'compare', generation, comparison: made })
        return
      }
      case 'growth': {
        const curves: unknown[] = []
        for (const id of message.ids) {
          const made = measureGrowth(id, message.shape, message.seed)
          // One algorithm refusing a growth curve must not lose the others, so it is skipped rather than fatal.
          if (!isAlgorithmError(made)) curves.push(made)
        }
        send({ kind: 'growth', generation, curves })
        return
      }
      default:
        send({ kind: 'broke', generation, says: 'The worker was asked for something it does not know how to do.' })
    }
  } catch (error) {
    /*
     * A throw here is a programming error, and it is reported rather than swallowed.
     *
     * Swallowing it would leave the laboratory waiting for a result that is never coming, which looks to somebody
     * exactly like a hang.
     */
    send({ kind: 'broke', generation, says: error instanceof Error ? error.message : 'Something went wrong working that out.' })
  }
}
