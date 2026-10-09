import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerReply, WorkerRequest } from './engineering.worker'

/**
 * Owning the engineering worker, and dropping anything stale it sends back.
 *
 * The same generation guard as the algorithm, science and structures workers. It matters here as much as anywhere:
 * a control-loop simulation and a Bode sweep take long enough together that somebody dragging a gain slider will
 * have several outstanding, and drawing the one that happens to arrive last would show a response curve belonging to
 * gains that are no longer set — which is the one thing a control laboratory must never do.
 */

type Without<T, K extends string> = T extends unknown ? Omit<T, K> : never
export type Ask = Without<WorkerRequest, 'generation'>

export interface Asked<T> {
  value: T | null
  busy: boolean
  refused: { says: string; fix: string } | null
  broke: string | null
}

const nothing = <T,>(): Asked<T> => ({ value: null, busy: false, refused: null, broke: null })

export interface Engineering {
  circuit: Asked<{ report: unknown; what: string; assumptions: readonly string[] }>
  control: Asked<{
    closed: unknown
    step: unknown
    bodePlot: unknown
    poles: unknown
    routh: unknown
    pid: unknown
    tuned: unknown
    assumptions: readonly string[]
  }>
  robot: Asked<{
    forward: unknown
    inverse: unknown
    jacobianReport: unknown
    planned: unknown
    torques: unknown
    assumptions: readonly string[]
  }>
  beam: Asked<{ analysis: unknown; section: unknown; buckling: unknown; material: unknown; assumptions: readonly string[] }>
  truss: Asked<{ report: unknown; assumptions: readonly string[] }>
  ask(request: Ask): void
  ready: boolean
}

export function useEngineering(): Engineering {
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const [ready, setReady] = useState(false)

  const [circuit, setCircuit] = useState<Engineering['circuit']>(nothing)
  const [control, setControl] = useState<Engineering['control']>(nothing)
  const [robot, setRobot] = useState<Engineering['robot']>(nothing)
  const [beam, setBeam] = useState<Engineering['beam']>(nothing)
  const [truss, setTruss] = useState<Engineering['truss']>(nothing)

  useEffect(() => {
    const made = new Worker(new URL('./engineering.worker.ts', import.meta.url), { type: 'module' })
    worker.current = made
    setReady(true)

    made.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data
      if (!reply || reply.generation !== generation.current) return
      switch (reply.kind) {
        case 'circuit':
          setCircuit({
            value: { report: reply.report, what: reply.what, assumptions: reply.assumptions },
            busy: false,
            refused: null,
            broke: null
          })
          break
        case 'control':
          setControl({
            value: {
              closed: reply.closed,
              step: reply.step,
              bodePlot: reply.bodePlot,
              poles: reply.poles,
              routh: reply.routh,
              pid: reply.pid,
              tuned: reply.tuned,
              assumptions: reply.assumptions
            },
            busy: false,
            refused: null,
            broke: null
          })
          break
        case 'robot':
          setRobot({
            value: {
              forward: reply.forward,
              inverse: reply.inverse,
              jacobianReport: reply.jacobianReport,
              planned: reply.planned,
              torques: reply.torques,
              assumptions: reply.assumptions
            },
            busy: false,
            refused: null,
            broke: null
          })
          break
        case 'beam':
          setBeam({
            value: {
              analysis: reply.analysis,
              section: reply.section,
              buckling: reply.buckling,
              material: reply.material,
              assumptions: reply.assumptions
            },
            busy: false,
            refused: null,
            broke: null
          })
          break
        case 'truss':
          setTruss({ value: { report: reply.report, assumptions: reply.assumptions }, busy: false, refused: null, broke: null })
          break
        case 'refused': {
          const refused = { says: reply.says, fix: reply.fix }
          // Only whichever request was outstanding is told; the others keep whatever they correctly hold.
          setCircuit((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setControl((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setRobot((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setBeam((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setTruss((held) => (held.busy ? { ...held, busy: false, refused } : held))
          break
        }
        case 'broke': {
          setCircuit((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setControl((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setRobot((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setBeam((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setTruss((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          break
        }
        default:
          break
      }
    }

    made.onerror = () => {
      setCircuit((held) => ({ ...held, busy: false, broke: 'The engineering engine could not be started.' }))
      setControl((held) => ({ ...held, busy: false, broke: 'The engineering engine could not be started.' }))
      setRobot((held) => ({ ...held, busy: false, broke: 'The engineering engine could not be started.' }))
      setBeam((held) => ({ ...held, busy: false, broke: 'The engineering engine could not be started.' }))
      setTruss((held) => ({ ...held, busy: false, broke: 'The engineering engine could not be started.' }))
    }

    return () => {
      // Without this, closing the card leaves a thread running for the rest of the session.
      made.terminate()
      worker.current = null
      setReady(false)
    }
  }, [])

  const ask = useCallback((request: Ask) => {
    const made = worker.current
    if (!made) return
    generation.current += 1
    const next = generation.current
    const busy = { busy: true, refused: null, broke: null }
    if (request.kind === 'circuit') setCircuit((held) => ({ ...held, ...busy }))
    if (request.kind === 'control') setControl((held) => ({ ...held, ...busy }))
    if (request.kind === 'robot') setRobot((held) => ({ ...held, ...busy }))
    if (request.kind === 'beam') setBeam((held) => ({ ...held, ...busy }))
    if (request.kind === 'truss') setTruss((held) => ({ ...held, ...busy }))
    made.postMessage({ ...request, generation: next } as WorkerRequest)
  }, [])

  return { circuit, control, robot, beam, truss, ask, ready }
}
