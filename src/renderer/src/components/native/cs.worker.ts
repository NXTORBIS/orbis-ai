import { compile, EXAMPLE, isCompilerError } from '../../../../shared/cs/compiler.ts'
import { PRESETS, deterministic, isAutomatonError, presetFor, runMachine, testMany, toDeterministic, allStrings, type Machine } from '../../../../shared/cs/automata.ts'
import { breakCaesar, caesar, differingBits, isCryptoError, rot13, sha256, toBase64, fromBase64, toHex, xorCipher, xorFromHex, CRYPTO_NOTES } from '../../../../shared/cs/crypto.ts'
import { SHAPES, isGraphicsError, render } from '../../../../shared/cs/graphics3d.ts'
import {
  crash,
  describe as describeCluster,
  heal,
  isConsensusError,
  makeCluster,
  partition,
  propose,
  recover,
  settle,
  step,
  type Cluster,
  type ConsensusError
} from '../../../../shared/cs/consensus.ts'

/**
 * The computer-science engines, on their own thread.
 *
 * ## Why a worker
 *
 * A subset construction can double its states with every one it starts with, a SQL join compares every pair, and a
 * 3D shape is a few thousand points through four matrices on every frame of a drag. None of that is slow once;
 * all of it is slow while somebody holds a slider down.
 *
 * ## The database is the one thing that is kept
 *
 * Every other engine here is a pure function of its request. The SQL laboratory is not: a CREATE TABLE has to still
 * be there when the next SELECT arrives. So the worker holds the database between messages, and a reset is an
 * explicit request rather than something that happens by accident when a component re-renders.
 *
 * Nothing here computes. Every number comes from the engines; this file routes a request to one and posts back what
 * it returned, refusals included.
 */

export type WorkerRequest =
  | { kind: 'compiler'; generation: number; source: string }
  | {
      kind: 'automata'
      generation: number
      what: 'run' | 'convert' | 'explore'
      preset: string
      machine: Machine | null
      input: string
      upTo: number
    }
  | {
      kind: 'crypto'
      generation: number
      what: 'hash' | 'encode' | 'caesar' | 'xor' | 'break'
      text: string
      key: string
      shift: number
      compareWith: string
    }
  | {
      kind: 'graphics'
      generation: number
      shape: string
      rotateX: number
      rotateY: number
      rotateZ: number
      distance: number
      fieldOfView: number
      projection: 'perspective' | 'orthographic'
      detail: number
      backFaceCulling: boolean
      width: number
      height: number
    }
  | {
      kind: 'consensus'
      generation: number
      what: 'make' | 'step' | 'settle' | 'crash' | 'recover' | 'partition' | 'heal' | 'propose'
      nodes: number
      seed: number
      node: string
      sideB: readonly string[]
      value: string
    }

export type WorkerReply =
  | { kind: 'refused'; generation: number; says: string; fix: string }
  | { kind: 'broke'; generation: number; says: string }
  | { kind: 'compiler'; generation: number; report: unknown; example: string }
  | { kind: 'automata'; generation: number; what: string; report: unknown; machine: unknown; presets: readonly unknown[]; deterministic: unknown }
  | { kind: 'crypto'; generation: number; what: string; report: unknown; notes: readonly string[] }
  | { kind: 'graphics'; generation: number; report: unknown; shapes: readonly { id: string; name: string }[] }
  | { kind: 'consensus'; generation: number; cluster: unknown; report: unknown }

const send = (reply: WorkerReply): void => {
  ;(self as unknown as { postMessage(value: unknown): void }).postMessage(reply)
}

/*
 * The cluster lives between messages, because it is a thing that is *built up*: crashing a node and then stepping
 * only means something if the crash is still true. Everything else here is a pure function of its request.
 */
let cluster: Cluster | null = null

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  const generation = typeof message.generation === 'number' ? message.generation : 0

  /** A refusal from any engine, passed on in its own words. */
  const refuse = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false
    const held = value as { error?: unknown; message?: unknown; fix?: unknown }
    if (held.error === undefined) return false
    send({ kind: 'refused', generation, says: String(held.message ?? 'That could not be done.'), fix: String(held.fix ?? '') })
    return true
  }

  try {
    switch (message.kind) {
      case 'compiler': {
        const report = compile(message.source)
        if (isCompilerError(report)) {
          send({ kind: 'refused', generation, says: report.message, fix: report.fix })
          return
        }
        send({ kind: 'compiler', generation, report, example: EXAMPLE })
        return
      }

      case 'automata': {
        const machine = message.machine ?? presetFor(message.preset)?.machine ?? PRESETS[0].machine
        const presets = PRESETS.map((one) => ({ id: one.id, name: one.name, accepts: one.accepts, deterministic: deterministic(one.machine).yes }))
        const kind = deterministic(machine)

        if (message.what === 'convert') {
          const report = toDeterministic(machine)
          if (refuse(report)) return
          send({ kind: 'automata', generation, what: 'convert', report, machine, presets, deterministic: kind })
          return
        }
        if (message.what === 'explore') {
          const strings = allStrings(machine.alphabet, Math.max(1, Math.min(5, message.upTo)))
          const report = testMany(machine, strings)
          if (refuse(report)) return
          send({ kind: 'automata', generation, what: 'explore', report, machine, presets, deterministic: kind })
          return
        }
        const report = runMachine(machine, message.input)
        if (isAutomatonError(report)) {
          send({ kind: 'refused', generation, says: report.message, fix: report.fix })
          return
        }
        send({ kind: 'automata', generation, what: 'run', report, machine, presets, deterministic: kind })
        return
      }

      case 'crypto': {
        if (message.what === 'hash') {
          const report = sha256(message.text)
          if (isCryptoError(report)) {
            send({ kind: 'refused', generation, says: report.message, fix: report.fix })
            return
          }
          // The avalanche, measured rather than asserted: one changed character against the original.
          const other = message.compareWith.trim() === '' ? null : sha256(message.compareWith)
          const differing = other !== null && !isCryptoError(other) ? differingBits(report.hex, other.hex) : null
          send({
            kind: 'crypto',
            generation,
            what: 'hash',
            report: { ...report, compared: other !== null && !isCryptoError(other) ? other.hex : null, differingBits: differing },
            notes: CRYPTO_NOTES
          })
          return
        }
        if (message.what === 'encode') {
          const base64 = toBase64(message.text)
          if (isCryptoError(base64)) {
            send({ kind: 'refused', generation, says: base64.message, fix: base64.fix })
            return
          }
          const back = fromBase64(base64)
          send({
            kind: 'crypto',
            generation,
            what: 'encode',
            report: {
              base64,
              hex: toHex(message.text),
              roundTrip: isCryptoError(back) ? null : back,
              bytes: new TextEncoder().encode(message.text).length,
              characters: [...message.text].length
            },
            notes: CRYPTO_NOTES
          })
          return
        }
        if (message.what === 'caesar') {
          send({
            kind: 'crypto',
            generation,
            what: 'caesar',
            report: {
              shifted: caesar(message.text, message.shift),
              rot13: rot13(message.text),
              back: caesar(caesar(message.text, message.shift), -message.shift),
              shift: ((Math.trunc(message.shift) % 26) + 26) % 26
            },
            notes: CRYPTO_NOTES
          })
          return
        }
        if (message.what === 'break') {
          const report = breakCaesar(message.text)
          if (isCryptoError(report)) {
            send({ kind: 'refused', generation, says: report.message, fix: report.fix })
            return
          }
          send({ kind: 'crypto', generation, what: 'break', report, notes: CRYPTO_NOTES })
          return
        }
        const report = xorCipher(message.text, message.key)
        if (isCryptoError(report)) {
          send({ kind: 'refused', generation, says: report.message, fix: report.fix })
          return
        }
        const back = xorFromHex(report.hex, message.key)
        send({
          kind: 'crypto',
          generation,
          what: 'xor',
          report: { ...report, roundTrip: isCryptoError(back) ? null : back },
          notes: CRYPTO_NOTES
        })
        return
      }

      case 'graphics': {
        const found = SHAPES.find((one) => one.id === message.shape) ?? SHAPES[0]
        const report = render({
          shape: found.make(1, Math.max(3, Math.min(32, Math.floor(message.detail)))),
          rotateX: message.rotateX,
          rotateY: message.rotateY,
          rotateZ: message.rotateZ,
          distance: message.distance,
          fieldOfView: message.fieldOfView,
          projection: message.projection,
          width: message.width,
          height: message.height,
          backFaceCulling: message.backFaceCulling
        })
        if (isGraphicsError(report)) {
          send({ kind: 'refused', generation, says: report.message, fix: report.fix })
          return
        }
        send({ kind: 'graphics', generation, report, shapes: SHAPES.map((one) => ({ id: one.id, name: one.name })) })
        return
      }

      case 'consensus': {
        if (message.what === 'make' || cluster === null) {
          const made = makeCluster(Math.max(1, Math.min(9, Math.floor(message.nodes))), message.seed)
          if (isConsensusError(made)) {
            send({ kind: 'refused', generation, says: made.message, fix: made.fix })
            return
          }
          cluster = made
          if (message.what === 'make') {
            send({ kind: 'consensus', generation, cluster, report: describeCluster(cluster) })
            return
          }
        }

        let next: Cluster | ConsensusError = cluster
        switch (message.what) {
          case 'step':
            next = step(cluster)
            break
          case 'settle':
            next = settle(cluster)
            break
          case 'crash':
            next = crash(cluster, message.node)
            break
          case 'recover':
            next = recover(cluster, message.node)
            break
          case 'partition':
            next = partition(cluster, message.sideB)
            break
          case 'heal':
            next = heal(cluster)
            break
          case 'propose':
            next = propose(cluster, message.value)
            break
          default:
            break
        }
        if (isConsensusError(next)) {
          send({ kind: 'refused', generation, says: next.message, fix: next.fix })
          return
        }
        // Narrowed into its own name, because `cluster` is nullable and the refusal above only rules out the error.
        const settled: Cluster = next
        cluster = settled
        send({ kind: 'consensus', generation, cluster: settled, report: describeCluster(settled) })
        return
      }

      default:
        return
    }
  } catch (error) {
    send({ kind: 'broke', generation, says: `The engine stopped: ${error instanceof Error ? error.message : String(error)}` })
  }
}
