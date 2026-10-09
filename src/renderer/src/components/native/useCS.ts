import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerReply, WorkerRequest } from './cs.worker'

/**
 * Owning the computer-science worker, and dropping anything stale it sends back.
 *
 * The same generation guard every other worker in the platform uses, and it earns its place twice over here:
 * dragging a rotation slider sends a request a frame, and a subset construction on a bad machine can take long
 * enough that two answers are outstanding at once. Drawing whichever arrives last would show a shape at an angle
 * nobody is holding.
 *
 * The SQL laboratory is the exception that proves it: the worker keeps the database between messages, so its
 * answers are *not* interchangeable and arriving out of order would corrupt what is on screen.
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

export interface CS {
  compiler: Asked<Record<string, unknown>>
  automata: Asked<Record<string, unknown>>
  crypto: Asked<Record<string, unknown>>
  graphics: Asked<Record<string, unknown>>
  consensus: Asked<Record<string, unknown>>
  ask(request: Ask): void
  ready: boolean
}

export function useCS(): CS {
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const [ready, setReady] = useState(false)

  const [compiler, setCompiler] = useState<Asked<Record<string, unknown>>>(nothing)
  const [automata, setAutomata] = useState<Asked<Record<string, unknown>>>(nothing)
  const [crypto, setCrypto] = useState<Asked<Record<string, unknown>>>(nothing)
  const [graphics, setGraphics] = useState<Asked<Record<string, unknown>>>(nothing)
  const [consensus, setConsensus] = useState<Asked<Record<string, unknown>>>(nothing)

  const setters = useRef({ compiler: setCompiler, automata: setAutomata, crypto: setCrypto, graphics: setGraphics, consensus: setConsensus })

  useEffect(() => {
    const made = new Worker(new URL('./cs.worker.ts', import.meta.url), { type: 'module' })
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
        setter((held) => (held.busy ? { ...held, busy: false, broke: 'The computer-science engine could not be started.' } : held))
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

  return { compiler, automata, crypto, graphics, consensus, ask, ready }
}
