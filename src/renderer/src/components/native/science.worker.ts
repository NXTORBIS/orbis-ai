import { describeMolecule, knownMolecule, isMoleculeError, layOut, type Molecule } from '../../../../shared/compute/molecules.ts'
import { fieldAt, isElectrostaticsError, type PointCharge } from '../../../../shared/compute/electrostatics.ts'
import { fieldGrid } from '../../../../shared/compute/gravitation.ts'
import { integrate, type State } from '../../../../shared/compute/simulation.ts'
import { readSequence, translate } from '../../../../shared/compute/genetics.ts'

/**
 * The scientific engines, on their own thread.
 *
 * ## Why a worker, measured rather than assumed
 *
 * A 60-unit predator-prey run at a timestep of 0.01 is 6,000 RK4 steps, each evaluating the model four times; a
 * 41×41 field grid is 1,681 points each summing over every source. Both are tens to hundreds of milliseconds, and
 * the brief forbids a heavy simulation freezing the chat (§91, §284). Molecular work is cheaper but shares the
 * thread for free.
 *
 * ## It calls the engines that already exist
 *
 * `integrate` from `simulation.ts`, `fieldAt` from `electrostatics.ts`, `fieldGrid` from `gravitation.ts`,
 * `readSequence` and `translate` from `genetics.ts`, and the new `molecules.ts`. Nothing here reimplements science:
 * every one of those is already covered by its own tests, so what is drawn is what was verified.
 *
 * ## Divergence is reported, never smoothed
 *
 * `integrate` returns a status — `diverged`, `too-stiff`, `step-limit` — and this passes it straight through. A
 * solver that failed must say so rather than handing back a curve that looks fine.
 */

export type ScienceRequest =
  | { kind: 'molecule'; generation: number; id: string }
  | { kind: 'population'; generation: number; model: string; values: Readonly<Record<string, number>>; method: string }
  | { kind: 'field'; generation: number; of: 'electric' | 'gravitational'; sources: readonly { strength: number; x: number; y: number }[]; extent: number; resolution: number }
  | { kind: 'dna'; generation: number; sequence: string; frame: number }

export type ScienceReply =
  | { kind: 'molecule'; generation: number; molecule: Molecule; report: unknown; placement: string }
  | { kind: 'population'; generation: number; result: unknown }
  | { kind: 'field'; generation: number; result: unknown }
  | { kind: 'dna'; generation: number; result: unknown }
  | { kind: 'refused'; generation: number; says: string; fix: string }
  | { kind: 'broke'; generation: number; says: string }

const send = (reply: ScienceReply): void => {
  ;(self as unknown as { postMessage(value: unknown): void }).postMessage(reply)
}

/** A number out of a record, with a fallback. The request crosses a thread boundary, so nothing is trusted. */
const num = (values: Readonly<Record<string, number>>, key: string, fallback: number): number => {
  const held = values[key]
  return typeof held === 'number' && Number.isFinite(held) ? held : fallback
}

self.onmessage = (event: MessageEvent<ScienceRequest>): void => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  const generation = typeof message.generation === 'number' ? message.generation : 0

  try {
    switch (message.kind) {
      // ------------------------------------------------ chemistry
      case 'molecule': {
        const molecule = knownMolecule(message.id)
        if (isMoleculeError(molecule)) return send({ kind: 'refused', generation, says: molecule.message, fix: molecule.fix })
        const report = describeMolecule(molecule)
        if (isMoleculeError(report)) return send({ kind: 'refused', generation, says: report.message, fix: report.fix })
        /*
         * The laid-out copy, which is what makes it drawable.
         *
         * The comment here always said that and the code always sent the molecule straight from the catalogue --
         * where no atom has a position, because `layOut` is what assigns them. The viewer draws only atoms that have
         * one, so it drew nothing, every time, for every molecule, and said "Nothing to show yet" underneath.
         */
        const placed = layOut(molecule)
        if (isMoleculeError(placed)) return send({ kind: 'refused', generation, says: placed.message, fix: placed.fix })
        return send({ kind: 'molecule', generation, molecule: placed.molecule, report, placement: placed.note })
      }

      // ------------------------------------------------ biology: populations
      case 'population': {
        const values = message.values
        const until = num(values, 'until', 60)
        const step = num(values, 'step', 0.01)
        const method = message.method === 'euler' || message.method === 'adaptive' ? message.method : 'rk4'

        /*
         * The models, written out rather than selected from a generic one.
         *
         * Lotka-Volterra, logistic and exponential are three different sets of equations and three different
         * lessons; a single "population model" with the terms switched off would teach that they are one thing.
         */
        let derivative: (time: number, state: readonly number[]) => number[]
        let start: State

        if (message.model === 'logistic') {
          const rate = num(values, 'preyGrowth', 0.6)
          const capacity = num(values, 'capacity', 500)
          derivative = (_time, state) => [rate * state[0] * (1 - state[0] / capacity)]
          start = { time: 0, values: [num(values, 'prey', 40)] }
        } else if (message.model === 'exponential') {
          const rate = num(values, 'preyGrowth', 0.6)
          derivative = (_time, state) => [rate * state[0]]
          start = { time: 0, values: [num(values, 'prey', 40)] }
        } else {
          const birth = num(values, 'preyGrowth', 0.6)
          const predation = num(values, 'predation', 0.03)
          const death = num(values, 'predatorDeath', 0.4)
          const conversion = num(values, 'conversion', 0.02)
          // dx/dt = ax − bxy ; dy/dt = cxy − dy
          derivative = (_time, state) => [
            birth * state[0] - predation * state[0] * state[1],
            conversion * state[0] * state[1] - death * state[1]
          ]
          start = { time: 0, values: [num(values, 'prey', 40), num(values, 'predators', 9)] }
        }

        const result = integrate(derivative, start, until, { method, step })
        if ('error' in result) return send({ kind: 'refused', generation, says: result.message, fix: 'Try a smaller timestep, or a shorter run.' })
        return send({ kind: 'population', generation, result })
      }

      // ------------------------------------------------ physics: fields
      case 'field': {
        const extent = Math.abs(message.extent) || 5
        const resolution = Math.max(3, Math.min(81, Math.round(message.resolution)))

        if (message.of === 'gravitational') {
          // Masses are positive by definition, so a negative strength is refused rather than silently flipped.
          const bad = message.sources.find((one) => one.strength <= 0)
          if (bad) {
            return send({
              kind: 'refused',
              generation,
              says: `A mass of ${bad.strength} is not possible — mass is always positive.`,
              fix: 'Use a positive value, or switch to the electric field, where a negative charge is real.'
            })
          }
          const made = fieldGrid(
            message.sources.map((one) => ({ mass: one.strength, position: { x: one.x, y: one.y } })),
            { xFrom: -extent, xTo: extent, yFrom: -extent, yTo: extent, columns: resolution, rows: resolution }
          )
          if ('error' in made) return send({ kind: 'refused', generation, says: made.message, fix: 'Change the sources or the grid and try again.' })
          return send({ kind: 'field', generation, result: made })
        }

        const charges: PointCharge[] = message.sources.map((one, at) => ({ charge: one.strength, x: one.x, y: one.y, label: `q${at + 1}` }))
        const samples: { x: number; y: number; fx: number; fy: number; magnitude: number; potential: number }[] = []
        let strongest = 0
        let skipped = 0

        for (let row = 0; row < resolution; row += 1) {
          for (let column = 0; column < resolution; column += 1) {
            const x = -extent + (2 * extent * column) / (resolution - 1)
            const y = -extent + (2 * extent * row) / (resolution - 1)
            const report = fieldAt(charges, { x, y })
            if (isElectrostaticsError(report)) {
              // A point sitting on a charge has an infinite field. Left out rather than given a made-up value.
              skipped += 1
              continue
            }
            const magnitude = Math.hypot(report.field.x, report.field.y)
            if (!Number.isFinite(magnitude) || !Number.isFinite(report.potential)) {
              skipped += 1
              continue
            }
            if (magnitude > strongest) strongest = magnitude
            samples.push({ x, y, fx: report.field.x, fy: report.field.y, magnitude, potential: report.potential })
          }
        }

        return send({
          kind: 'field',
          generation,
          result: {
            samples,
            strongest,
            skipped,
            note:
              skipped > 0
                ? `${skipped} grid point${skipped === 1 ? '' : 's'} sat on a source, where the field is infinite, and ${skipped === 1 ? 'was' : 'were'} left out.`
                : ''
          }
        })
      }

      // ------------------------------------------------ biology: sequences
      case 'dna': {
        const read = readSequence({ sequence: message.sequence, kind: 'dna' })
        if ('error' in read) {
          return send({
            kind: 'refused',
            generation,
            says: read.message,
            fix: 'DNA is written with A, T, G and C only. Remove anything else.'
          })
        }
        const protein = translate({ sequence: message.sequence, frame: message.frame })
        return send({
          kind: 'dna',
          generation,
          result: { read, protein: 'error' in protein ? null : protein, proteinProblem: 'error' in protein ? protein.message : null }
        })
      }

      default:
        send({ kind: 'broke', generation, says: 'The science worker was asked for something it does not know how to do.' })
    }
  } catch (error) {
    // Reported rather than swallowed: silence would leave the laboratory waiting for an answer that never comes.
    send({ kind: 'broke', generation, says: error instanceof Error ? error.message : 'Something went wrong working that out.' })
  }
}
