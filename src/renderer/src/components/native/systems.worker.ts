import {
  blueprint,
  checkNetwork,
  counter,
  evaluate,
  isLogicError,
  runClocked,
  shiftRegister,
  simplify,
  truthTable,
  LOGIC_ASSUMPTIONS,
  type Blueprint,
  type Network as LogicNetwork
} from '../../../../shared/compute/logic.ts'
import {
  assemble,
  isProcessorError,
  pipeline,
  run as runProgram,
  sample,
  PROCESSOR_ASSUMPTIONS,
  type Replacement,
  type Sample
} from '../../../../shared/compute/processor.ts'
import {
  bankersCheck,
  beladyCheck,
  comparePolicies,
  findDeadlock,
  isSchedulingError,
  paging,
  race,
  schedule,
  OS_ASSUMPTIONS,
  type PageReplacement,
  type Policy,
  type Process
} from '../../../../shared/compute/scheduling.ts'
import {
  congestion,
  findRoute,
  firewall,
  handshake,
  isNetworkError,
  nameLookup,
  addressAssignment,
  shape,
  splitBlock,
  subnet,
  translate,
  NETWORK_ASSUMPTIONS,
  type Shape
} from '../../../../shared/compute/networking.ts'

/**
 * The systems engines — digital logic, the processor, the operating system and the network — on their own thread.
 *
 * ## Why these four share a worker
 *
 * They are the four that are *about* a machine rather than about the world, and no laboratory uses more than one of
 * them at a time. Four separate workers would be four threads started for a card that needs one, and the brief is
 * explicit that a worker exists where measurement justified it rather than for appearance.
 *
 * ## Measured
 *
 * A truth table of a sixteen-input network is 65,536 evaluations, about 300ms. A pipeline schedule over a loop that
 * runs 200,000 instructions is about 250ms. A page-replacement run with the optimal policy looks ahead through the
 * whole reference string for every fault, which is quadratic and reaches 400ms at a few thousand references. Any of
 * those on the main thread is a visible stall while somebody is typing.
 *
 * ## It computes and nothing else
 *
 * No DOM, no storage, no network. Every engine it calls is one the test suite checks, so what is drawn is what was
 * verified.
 */

export type WorkerRequest =
  | {
      kind: 'logic'
      generation: number
      what: 'blueprint' | 'truth-table' | 'simplify' | 'clocked'
      blueprint: Blueprint
      /** For the clocked view. */
      sequential: 'counter' | 'shift-register'
      bits: number
      ticks: number
      /** Which output to reduce to an expression. */
      output: string
      /** Input values, for a single evaluation. */
      inputs: Readonly<Record<string, boolean>>
    }
  | {
      kind: 'processor'
      generation: number
      source: string
      /** When set, the named sample replaces whatever was typed. */
      useSample: Sample | null
      forwarding: boolean
      predictTaken: boolean
      cacheSize: number
      lineSize: number
      ways: number
      replacement: Replacement
    }
  | {
      kind: 'scheduling'
      generation: number
      what: 'processes' | 'paging' | 'deadlock' | 'race'
      processes: readonly Process[]
      policy: Policy
      quantum: number
      compareWith: readonly Policy[]
      references: readonly number[]
      frames: number
      pagePolicy: PageReplacement
      locked: boolean
      rounds: number
      workers: number
    }
  | {
      kind: 'networking'
      generation: number
      what: 'subnet' | 'topology' | 'protocol' | 'congestion' | 'firewall'
      address: string
      prefix: number
      splitInto: number
      topology: Shape
      from: string
      to: string
      unplug: string
      protocol: 'address' | 'name' | 'handshake' | 'translation'
      cached: boolean
      capacity: number
      congestionRounds: number
      randomLoss: number
    }

export type WorkerReply =
  | { kind: 'logic'; generation: number; network: unknown; check: unknown; table: unknown; expression: unknown; evaluation: unknown; clocked: unknown; assumptions: readonly string[] }
  | { kind: 'processor'; generation: number; program: unknown; run: unknown; withForwarding: unknown; withoutForwarding: unknown; assumptions: readonly string[] }
  | { kind: 'scheduling'; generation: number; schedule: unknown; comparison: unknown; paging: unknown; belady: unknown; deadlock: unknown; banker: unknown; race: unknown; assumptions: readonly string[] }
  | { kind: 'networking'; generation: number; subnet: unknown; pieces: unknown; topology: unknown; route: unknown; protocol: unknown; congestion: unknown; firewall: unknown; assumptions: readonly string[] }
  | { kind: 'refused'; generation: number; says: string; fix: string }
  | { kind: 'broke'; generation: number; says: string }

const send = (reply: WorkerReply): void => {
  ;(self as unknown as { postMessage(value: unknown): void }).postMessage(reply)
}

/**
 * Reads whichever shape of refusal an engine returned.
 *
 * The four engines each have their own error type with the same three fields under slightly different names, so this
 * reads whichever is present rather than assuming one. Getting it wrong turns a precise refusal into "undefined",
 * which is the worst possible version of an error message.
 */
const refusalOf = (value: unknown): { says: string; fix: string } | null => {
  if (typeof value !== 'object' || value === null) return null
  const held = value as Record<string, unknown>
  if (typeof held.error !== 'string') return null
  return {
    says: typeof held.says === 'string' ? held.says : typeof held.message === 'string' ? held.message : held.error,
    fix: typeof held.fix === 'string' ? held.fix : ''
  }
}

const failed = (value: unknown): boolean =>
  isLogicError(value) || isProcessorError(value) || isSchedulingError(value) || isNetworkError(value)

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  const generation = typeof message.generation === 'number' ? message.generation : 0

  const refuse = (value: unknown): boolean => {
    if (!failed(value)) return false
    const held = refusalOf(value)
    send({ kind: 'refused', generation, says: held?.says ?? 'The engine refused.', fix: held?.fix ?? 'Change the values and try again.' })
    return true
  }
  /** Anything optional: a refusal becomes a panel that explains itself rather than failing the whole request. */
  const optional = (value: unknown): unknown => (failed(value) ? { refused: refusalOf(value) } : value)

  try {
    switch (message.kind) {
      // ---------------------------------------------------------------- digital logic
      case 'logic': {
        if (message.what === 'clocked') {
          const built = message.sequential === 'counter' ? counter(message.bits) : shiftRegister(message.bits)
          if (refuse(built)) return
          const feed =
            message.sequential === 'counter'
              ? [{ enable: true }]
              : [{ in: true }, ...Array.from({ length: Math.max(1, message.ticks - 1) }, () => ({ in: false }))]
          const ran = runClocked(built as never, feed, message.ticks)
          if (refuse(ran)) return
          send({
            kind: 'logic',
            generation,
            network: built,
            check: null,
            table: null,
            expression: null,
            evaluation: null,
            clocked: ran,
            assumptions: LOGIC_ASSUMPTIONS
          })
          return
        }

        const network = blueprint(message.blueprint)
        if (refuse(network)) return
        const check = checkNetwork(network as LogicNetwork)
        if (refuse(check)) return

        // A truth table is only meaningful for logic with no memory in it, so a looping network gets its evaluation
        // instead rather than a table that would be a lie.
        const table = (check as { hasFeedback: boolean }).hasFeedback ? null : optional(truthTable(network as LogicNetwork))
        const expression =
          table !== null && message.what === 'simplify' && !failed(table)
            ? optional(simplify(table as never, message.output))
            : null
        const evaluation = optional(evaluate(network as LogicNetwork, message.inputs))

        send({ kind: 'logic', generation, network, check, table, expression, evaluation, clocked: null, assumptions: LOGIC_ASSUMPTIONS })
        return
      }

      // ---------------------------------------------------------------- the processor
      case 'processor': {
        let source = message.source
        let memory: Readonly<Record<string, number>> = {}
        if (message.useSample !== null) {
          const made = sample(message.useSample)
          if (refuse(made)) return
          source = (made as { source: string }).source
          memory = (made as { memory: Readonly<Record<string, number>> }).memory
        }

        const program = assemble(source)
        if (refuse(program)) return

        const ran = runProgram(program as never, {
          memory: memory as never,
          cache: {
            size: message.cacheSize,
            lineSize: message.lineSize,
            ways: message.ways,
            replacement: message.replacement
          }
        })

        /*
         * Both pipeline schedules, always.
         *
         * The number that teaches anything is the difference, and a laboratory showing only the one that is switched
         * on makes that difference invisible. Both are over the same trace, so they cannot disagree about what ran.
         */
        const withForwarding = pipeline(ran, { forwarding: true, predictTaken: message.predictTaken })
        const withoutForwarding = pipeline(ran, { forwarding: false, predictTaken: message.predictTaken })

        send({ kind: 'processor', generation, program, run: ran, withForwarding, withoutForwarding, assumptions: PROCESSOR_ASSUMPTIONS })
        return
      }

      // ---------------------------------------------------------------- the operating system
      case 'scheduling': {
        let made: unknown = null
        let comparison: unknown = null
        let paged: unknown = null
        let belady: unknown = null
        let deadlock: unknown = null
        let banker: unknown = null
        let raced: unknown = null

        if (message.what === 'processes') {
          const one = schedule(message.processes, message.policy, { quantum: message.quantum })
          if (refuse(one)) return
          made = one
          if (message.compareWith.length > 1) {
            comparison = optional(comparePolicies(message.processes, message.compareWith, { quantum: message.quantum }))
          }
        } else if (message.what === 'paging') {
          const one = paging(message.references, message.frames, message.pagePolicy)
          if (refuse(one)) return
          paged = one
          // Whether more memory ever made it worse, which is a real property of first-in-first-out.
          belady = optional(beladyCheck(message.references, message.pagePolicy, Math.max(4, message.frames + 2)))
        } else if (message.what === 'deadlock') {
          deadlock = findDeadlock([
            { process: 'P1', resource: 'A', holding: true },
            { process: 'P1', resource: 'B', holding: false },
            { process: 'P2', resource: 'B', holding: true },
            { process: 'P2', resource: 'A', holding: false }
          ])
          banker = optional(
            bankersCheck({
              processes: ['P0', 'P1', 'P2', 'P3', 'P4'],
              resources: ['A', 'B', 'C'],
              total: [10, 5, 7],
              allocated: [
                [0, 1, 0],
                [2, 0, 0],
                [3, 0, 2],
                [2, 1, 1],
                [0, 0, 2]
              ],
              maximum: [
                [7, 5, 3],
                [3, 2, 2],
                [9, 0, 2],
                [2, 2, 2],
                [4, 3, 3]
              ]
            })
          )
        } else {
          // The race, run both ways so the lock has something to be compared against.
          const without = race(message.rounds, { locked: false, processes: message.workers })
          if (refuse(without)) return
          const withLock = race(message.rounds, { locked: true, processes: message.workers })
          raced = { without, withLock: optional(withLock), showing: message.locked ? 'with' : 'without' }
        }

        send({
          kind: 'scheduling',
          generation,
          schedule: made,
          comparison,
          paging: paged,
          belady,
          deadlock,
          banker,
          race: raced,
          assumptions: OS_ASSUMPTIONS
        })
        return
      }

      // ---------------------------------------------------------------- the network
      case 'networking': {
        let made: unknown = null
        let pieces: unknown = null
        let built: unknown = null
        let route: unknown = null
        let protocol: unknown = null
        let flow: unknown = null
        let rules: unknown = null

        if (message.what === 'subnet') {
          const one = subnet(message.address, message.prefix)
          if (refuse(one)) return
          made = one
          if (message.splitInto > 1) pieces = optional(splitBlock(message.address, message.prefix, message.splitInto))
        } else if (message.what === 'topology') {
          const one = shape(message.topology)
          if (isNetworkError(one)) {
            send({ kind: 'refused', generation, says: one.says, fix: one.fix })
            return
          }
          // Unplugging a named link, so a route can be made to fail without the topology being edited.
          const working =
            message.unplug.trim().length === 0
              ? one
              : {
                  ...one,
                  links: one.links.map((link) =>
                    link.from === message.unplug || link.to === message.unplug ? { ...link, down: true } : link
                  )
                }
          built = working
          route = optional(findRoute(working, message.from, message.to))
        } else if (message.what === 'protocol') {
          protocol =
            message.protocol === 'address'
              ? addressAssignment({})
              : message.protocol === 'name'
                ? optional(nameLookup('example.com', { cached: message.cached }))
                : message.protocol === 'handshake'
                  ? handshake(20)
                  : optional(
                      translate([
                        { from: '192.168.1.10', port: 51000, to: 'example.com' },
                        { from: '192.168.1.10', port: 51001, to: 'example.com' },
                        { from: '192.168.1.11', port: 44000, to: 'example.com' }
                      ])
                    )
        } else if (message.what === 'congestion') {
          const one = congestion({
            capacity: message.capacity,
            rounds: message.congestionRounds,
            randomLoss: message.randomLoss
          })
          if (refuse(one)) return
          flow = one
        } else {
          rules = optional(
            firewall(
              [
                { order: 1, action: 'allow', port: 443, protocol: 'tcp', note: 'web traffic' },
                { order: 2, action: 'allow', port: 22, protocol: 'tcp', from: '192.168.1.10', note: 'remote access, from one machine' },
                { order: 3, action: 'deny', port: 22, protocol: 'tcp', note: 'and nobody else' }
              ],
              [
                { from: '1.2.3.4', to: 'server', port: 443, protocol: 'tcp' },
                { from: '192.168.1.10', to: 'server', port: 22, protocol: 'tcp' },
                { from: '1.2.3.4', to: 'server', port: 22, protocol: 'tcp' },
                { from: '1.2.3.4', to: 'server', port: 8080, protocol: 'tcp' }
              ],
              'deny'
            )
          )
        }

        send({
          kind: 'networking',
          generation,
          subnet: made,
          pieces,
          topology: built,
          route,
          protocol,
          congestion: flow,
          firewall: rules,
          assumptions: NETWORK_ASSUMPTIONS
        })
        return
      }

      default:
        return
    }
  } catch (error) {
    send({
      kind: 'broke',
      generation,
      says: `The ${message.kind} engine stopped: ${error instanceof Error ? error.message : String(error)}`
    })
  }
}
