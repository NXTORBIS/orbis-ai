import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerReply, WorkerRequest } from './structures.worker'

/**
 * Owning the structures worker, and dropping anything stale it sends back.
 *
 * The same generation guard as the algorithm and science workers, for the same reason — but with one difference that
 * matters: this worker is *stateful*. Making a new structure throws the old one away, so a reply from before that
 * point does not merely describe something out of date, it describes a structure that no longer exists. Drawing it
 * would show a tree the user has already replaced, with counts belonging to neither. So the guard here is not a
 * nicety.
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

/** What a reply carries about the structure as it stands. */
export interface StructureState {
  structure: string
  run: unknown
  picture: unknown
  spread: unknown
  entry: unknown
}

export interface Structures {
  state: Asked<StructureState>
  comparison: Asked<unknown>
  ask(request: Ask): void
  ready: boolean
}

export function useStructures(): Structures {
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<Asked<StructureState>>(nothing)
  const [comparison, setComparison] = useState<Asked<unknown>>(nothing)

  useEffect(() => {
    const made = new Worker(new URL('./structures.worker.ts', import.meta.url), { type: 'module' })
    worker.current = made
    setReady(true)

    made.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data
      if (!reply || reply.generation !== generation.current) return
      switch (reply.kind) {
        case 'state':
          setState({
            value: {
              structure: reply.structure,
              run: reply.run,
              picture: reply.picture,
              spread: reply.spread,
              entry: reply.entry
            },
            busy: false,
            refused: null,
            broke: null
          })
          break
        case 'comparison':
          setComparison({ value: reply.comparison, busy: false, refused: null, broke: null })
          break
        case 'entry':
          // A description on its own does not replace the structure, so only the entry is updated.
          setState((held) => (held.value === null ? held : { ...held, value: { ...held.value, entry: reply.entry } }))
          break
        case 'refused': {
          const refused = { says: reply.says, fix: reply.fix }
          setState((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setComparison((held) => (held.busy ? { ...held, busy: false, refused } : held))
          break
        }
        case 'broke': {
          setState((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setComparison((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          break
        }
        default:
          break
      }
    }

    made.onerror = () => {
      setState((held) => ({ ...held, busy: false, broke: 'The structure engine could not be started.' }))
    }

    return () => {
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
    if (request.kind === 'compare') setComparison((held) => ({ ...held, busy: true, refused: null, broke: null }))
    else setState((held) => ({ ...held, busy: true, refused: null, broke: null }))
    made.postMessage({ ...request, generation: next } as WorkerRequest)
  }, [])

  return { state, comparison, ask, ready }
}
