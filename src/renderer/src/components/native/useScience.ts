import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScienceReply, ScienceRequest } from './science.worker'

/**
 * Owning the science worker, and dropping anything stale.
 *
 * The same generation guard as the algorithm worker, and for the same reason: a field grid or a population run takes
 * long enough that somebody can change two parameters while it is in flight, and without the check the first answer
 * arrives last and the laboratory draws a result for inputs that are no longer on screen.
 *
 * Started on first use and terminated on unmount, so a conversation with no laboratory in it starts no thread and a
 * closed card leaves none running.
 */

type Without<T, K extends string> = T extends unknown ? Omit<T, K> : never
export type AskScience = Without<ScienceRequest, 'generation'>

export interface Answer<T> {
  value: T | null
  busy: boolean
  /** The engine declined, with a reason and what to do. Not an error. */
  refused: { says: string; fix: string } | null
  /** The worker itself broke. Different from a refusal, and said differently. */
  broke: string | null
}

const nothing = <T,>(): Answer<T> => ({ value: null, busy: false, refused: null, broke: null })

export interface Science {
  molecule: Answer<{ molecule: unknown; report: unknown }>
  population: Answer<unknown>
  field: Answer<unknown>
  dna: Answer<unknown>
  ask(request: AskScience): void
  ready: boolean
}

export function useScience(): Science {
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const [ready, setReady] = useState(false)

  const [molecule, setMolecule] = useState<Answer<{ molecule: unknown; report: unknown }>>(nothing)
  const [population, setPopulation] = useState<Answer<unknown>>(nothing)
  const [field, setField] = useState<Answer<unknown>>(nothing)
  const [dna, setDna] = useState<Answer<unknown>>(nothing)

  useEffect(() => {
    const made = new Worker(new URL('./science.worker.ts', import.meta.url), { type: 'module' })
    worker.current = made
    setReady(true)

    made.onmessage = (event: MessageEvent<ScienceReply>) => {
      const reply = event.data
      if (!reply || reply.generation !== generation.current) return

      switch (reply.kind) {
        case 'molecule':
          setMolecule({ value: { molecule: reply.molecule, report: reply.report }, busy: false, refused: null, broke: null })
          break
        case 'population':
          setPopulation({ value: reply.result, busy: false, refused: null, broke: null })
          break
        case 'field':
          setField({ value: reply.result, busy: false, refused: null, broke: null })
          break
        case 'dna':
          setDna({ value: reply.result, busy: false, refused: null, broke: null })
          break
        case 'refused': {
          const refused = { says: reply.says, fix: reply.fix }
          // Only whichever was waiting is told, so a refusal does not appear against an unrelated panel.
          setMolecule((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setPopulation((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setField((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setDna((held) => (held.busy ? { ...held, busy: false, refused } : held))
          break
        }
        case 'broke': {
          setMolecule((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setPopulation((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setField((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setDna((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          break
        }
        default:
          break
      }
    }

    made.onerror = () => {
      setMolecule((held) => ({ ...held, busy: false, broke: 'The science engine could not be started.' }))
    }

    return () => {
      made.terminate()
      worker.current = null
      setReady(false)
    }
  }, [])

  const ask = useCallback((request: AskScience) => {
    const made = worker.current
    if (!made) return
    generation.current += 1
    const next = generation.current

    if (request.kind === 'molecule') setMolecule((held) => ({ ...held, busy: true, refused: null, broke: null }))
    if (request.kind === 'population') setPopulation((held) => ({ ...held, busy: true, refused: null, broke: null }))
    if (request.kind === 'field') setField((held) => ({ ...held, busy: true, refused: null, broke: null }))
    if (request.kind === 'dna') setDna((held) => ({ ...held, busy: true, refused: null, broke: null }))

    made.postMessage({ ...request, generation: next } as ScienceRequest)
  }, [])

  return { molecule, population, field, dna, ask, ready }
}
