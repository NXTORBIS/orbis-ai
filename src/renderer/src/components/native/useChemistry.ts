import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerReply, WorkerRequest } from './chemistry.worker'

/**
 * Owning the chemistry worker, and dropping anything stale it sends back.
 *
 * The same generation guard as every other worker in the native platform, and it earns its place here because a
 * titration is four hundred solved equilibria: somebody dragging the acid concentration will have several runs
 * outstanding, and drawing whichever happens to arrive last would show a curve belonging to a concentration that is
 * no longer on screen.
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

export interface Chemistry {
  table: Asked<Record<string, unknown>>
  element: Asked<Record<string, unknown>>
  calculator: Asked<Record<string, unknown>>
  reaction: Asked<Record<string, unknown>>
  electro: Asked<Record<string, unknown>>
  titration: Asked<Record<string, unknown>>
  organic: Asked<Record<string, unknown>>
  combine: Asked<Record<string, unknown>>
  molecular: Asked<Record<string, unknown>>
  ask(request: Ask): void
  ready: boolean
}

export function useChemistry(): Chemistry {
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const [ready, setReady] = useState(false)

  const [table, setTable] = useState<Asked<Record<string, unknown>>>(nothing)
  const [element, setElement] = useState<Asked<Record<string, unknown>>>(nothing)
  const [calculator, setCalculator] = useState<Asked<Record<string, unknown>>>(nothing)
  const [reaction, setReaction] = useState<Asked<Record<string, unknown>>>(nothing)
  const [electro, setElectro] = useState<Asked<Record<string, unknown>>>(nothing)
  const [titrationState, setTitration] = useState<Asked<Record<string, unknown>>>(nothing)
  const [organic, setOrganic] = useState<Asked<Record<string, unknown>>>(nothing)
  const [combineState, setCombine] = useState<Asked<Record<string, unknown>>>(nothing)
  const [molecular, setMolecular] = useState<Asked<Record<string, unknown>>>(nothing)

  const setters = useRef({
    table: setTable,
    element: setElement,
    calculator: setCalculator,
    reaction: setReaction,
    electro: setElectro,
    titration: setTitration,
    organic: setOrganic,
    combine: setCombine,
    molecular: setMolecular
  })

  useEffect(() => {
    const made = new Worker(new URL('./chemistry.worker.ts', import.meta.url), { type: 'module' })
    worker.current = made
    setReady(true)

    made.onmessage = (event: MessageEvent<WorkerReply>): void => {
      const reply = event.data
      if (!reply || reply.generation !== generation.current) return

      if (reply.kind === 'refused' || reply.kind === 'broke') {
        const refused = reply.kind === 'refused' ? { says: reply.says, fix: reply.fix } : null
        const broke = reply.kind === 'broke' ? reply.says : null
        // Only whatever was outstanding is told; the others keep what they correctly hold.
        for (const setter of Object.values(setters.current)) {
          setter((held) => (held.busy ? { ...held, busy: false, refused, broke } : held))
        }
        return
      }

      const setter = setters.current[reply.kind as keyof typeof setters.current]
      if (setter === undefined) return
      const { kind, generation: _ignored, ...rest } = reply as unknown as Record<string, unknown> & { kind: string; generation: number }
      setter({ value: rest, busy: false, refused: null, broke: null })
    }

    made.onerror = (): void => {
      for (const setter of Object.values(setters.current)) {
        setter((held) => (held.busy ? { ...held, busy: false, broke: 'The chemistry engine could not be started.' } : held))
      }
    }

    return () => {
      made.terminate()
      worker.current = null
    }
  }, [])

  const ask = useCallback((request: Ask): void => {
    const made = worker.current
    if (made === null) return
    generation.current += 1
    const setter = setters.current[request.kind as keyof typeof setters.current]
    setter?.((held) => ({ ...held, busy: true, refused: null, broke: null }))
    made.postMessage({ ...request, generation: generation.current })
  }, [])

  return { table, element, calculator, reaction, electro, titration: titrationState, organic, combine: combineState, molecular, ask, ready }
}
