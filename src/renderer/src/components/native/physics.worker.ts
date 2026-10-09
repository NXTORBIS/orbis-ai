import { SECTIONS, SIMULATIONS, mustFind, sections, search } from '../../../../shared/physics/catalogue.ts'
import { isSimulationError, readValues, run, startingValues } from '../../../../shared/physics/simulation.ts'

/**
 * The physics simulations, on their own thread.
 *
 * ## Why this one needs a worker more than most
 *
 * A double pendulum at a two-millisecond step is five hundred steps a second of simulated time, and the whole
 * point of it is to run for long enough that the two copies separate. Tracing sixteen field lines is nine hundred
 * field evaluations each, every time a charge moves. Doing either on the thread that draws would make dragging a
 * slider feel broken.
 *
 * ## Nothing here computes
 *
 * Every number comes from the simulation engines. This routes a request to one, runs it, and posts back what came
 * out — including the refusals, which carry their own words about what to do instead.
 */

export type WorkerRequest =
  | { kind: 'list'; generation: number }
  | {
      kind: 'run'
      generation: number
      simulation: string
      values: Readonly<Record<string, number>>
      seconds: number
      dt: number
      every: number
    }
  | { kind: 'find'; generation: number; query: string }

export type WorkerReply =
  | { kind: 'refused'; generation: number; says: string; fix: string }
  | { kind: 'broke'; generation: number; says: string }
  | {
      kind: 'list'
      generation: number
      sections: readonly unknown[]
      all: readonly unknown[]
      counts: { simulations: number; sections: number }
    }
  | {
      kind: 'run'
      generation: number
      simulation: string
      name: string
      about: string
      controls: readonly unknown[]
      readouts: readonly unknown[]
      report: unknown
      limits: readonly string[]
    }
  | { kind: 'find'; generation: number; found: readonly unknown[] }

const send = (reply: WorkerReply): void => {
  ;(self as unknown as { postMessage(value: unknown): void }).postMessage(reply)
}

/** A simulation as the screen needs it: everything but the functions, which cannot cross a thread boundary. */
const describe = (one: (typeof SIMULATIONS)[number]) => ({
  id: one.id,
  name: one.name,
  section: one.section,
  about: one.about,
  controls: one.controls,
  readouts: one.readouts,
  limits: one.limits,
  conserves: one.conserves ?? null,
  suggestedStep: one.suggestedStep ?? null
})

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  const generation = typeof message.generation === 'number' ? message.generation : 0

  try {
    switch (message.kind) {
      case 'list': {
        send({
          kind: 'list',
          generation,
          sections: sections().map((one) => ({ ...one.section, simulations: one.simulations.map(describe) })),
          all: SIMULATIONS.map(describe),
          counts: { simulations: SIMULATIONS.length, sections: sections().length }
        })
        return
      }

      case 'find': {
        send({ kind: 'find', generation, found: search(message.query).map(describe) })
        return
      }

      case 'run': {
        const found = mustFind(message.simulation)
        if (isSimulationError(found)) {
          send({ kind: 'refused', generation, says: found.message, fix: found.fix })
          return
        }
        // Every value is put inside what its control allows, so a typed number cannot break a simulation.
        const values = readValues(found, { ...startingValues(found), ...message.values })
        const report = run(found, values, {
          seconds: message.seconds,
          dt: message.dt,
          every: message.every
        })
        if (isSimulationError(report)) {
          send({ kind: 'refused', generation, says: report.message, fix: report.fix })
          return
        }
        send({
          kind: 'run',
          generation,
          simulation: found.id,
          name: found.name,
          about: found.about,
          controls: found.controls,
          readouts: found.readouts,
          report,
          limits: found.limits
        })
        return
      }

      default:
        return
    }
  } catch (error) {
    send({ kind: 'broke', generation, says: `The physics engine stopped: ${error instanceof Error ? error.message : String(error)}` })
  }
}

void SECTIONS
