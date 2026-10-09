import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerReply, WorkerRequest } from './algorithms.worker'

/**
 * `Omit` over a union collapses it to the fields the members share, which here is almost nothing.
 *
 * Distributing it keeps each member of the request union intact minus its generation, so a caller can still pass a
 * `run` or a `generate` and have its own fields checked.
 */
type Without<T, K extends string> = T extends unknown ? Omit<T, K> : never
export type Ask = Without<WorkerRequest, 'generation'>

/**
 * Owning the algorithm worker, and dropping anything stale it sends back.
 *
 * ## The generation guard, again
 *
 * The Phase 1 runtime rejects a result from before a reset by comparing generations, and the same rule has to apply
 * between this hook and its worker. A trace takes a couple of hundred milliseconds, and somebody can change the
 * input twice in that time: without the check, the first trace arrives last and the laboratory draws a run of an
 * input that is no longer on screen. That is the single worst thing a computational laboratory can do, so it is
 * guarded in both places rather than trusted once.
 *
 * ## The worker is started on first use and stopped on unmount
 *
 * Not at import: a conversation with no algorithm laboratory in it should start no thread. And `terminate` on unmount
 * is what stops a closed card leaving a worker running — the resource-cleanup failure the brief asks to be tested
 * for, caused here if this hook forgot one line.
 */

export interface Asked<T> {
  /** What came back, or null before anything has. */
  value: T | null
  /** True while a request is outstanding. */
  busy: boolean
  /** Set when the engine refused: a reason and what to do, both in plain words. */
  refused: { says: string; fix: string } | null
  /** Set when the worker itself broke. Different from a refusal, and said differently. */
  broke: string | null
}

const nothing = <T,>(): Asked<T> => ({ value: null, busy: false, refused: null, broke: null })

export interface Algorithms {
  run: Asked<unknown>
  generated: Asked<unknown>
  comparison: Asked<unknown>
  curves: Asked<readonly unknown[]>
  /** Asks for something. Each call takes the next generation, so earlier replies are dropped. */
  ask(request: Ask): void
  /** True once the worker has been started. */
  ready: boolean
}

export function useAlgorithms(): Algorithms {
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const [ready, setReady] = useState(false)

  const [run, setRun] = useState<Asked<unknown>>(nothing)
  const [generated, setGenerated] = useState<Asked<unknown>>(nothing)
  const [comparison, setComparison] = useState<Asked<unknown>>(nothing)
  const [curves, setCurves] = useState<Asked<readonly unknown[]>>(nothing)

  useEffect(() => {
    /*
     * `new URL(..., import.meta.url)` is the form the bundler understands, so the worker becomes its own chunk and
     * is fetched only when a laboratory is actually opened.
     */
    const made = new Worker(new URL('./algorithms.worker.ts', import.meta.url), { type: 'module' })
    worker.current = made
    setReady(true)

    made.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data
      // Anything from a generation that has been superseded is dropped, and deliberately without a trace on screen:
      // somebody who changed the input does not need telling that the previous answer was discarded.
      if (!reply || reply.generation !== generation.current) return

      switch (reply.kind) {
        case 'run':
          setRun({ value: reply.run, busy: false, refused: null, broke: null })
          break
        case 'generate':
          setGenerated({ value: reply.made, busy: false, refused: null, broke: null })
          break
        case 'compare':
          setComparison({ value: reply.comparison, busy: false, refused: null, broke: null })
          break
        case 'growth':
          setCurves({ value: reply.curves, busy: false, refused: null, broke: null })
          break
        case 'refused': {
          const refused = { says: reply.says, fix: reply.fix }
          setRun((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setGenerated((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setComparison((held) => (held.busy ? { ...held, busy: false, refused } : held))
          setCurves((held) => (held.busy ? { ...held, busy: false, refused } : held))
          break
        }
        case 'broke': {
          setRun((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setGenerated((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setComparison((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          setCurves((held) => (held.busy ? { ...held, busy: false, broke: reply.says } : held))
          break
        }
        default:
          break
      }
    }

    made.onerror = () => {
      setRun((held) => ({ ...held, busy: false, broke: 'The algorithm engine could not be started.' }))
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

    // Marked busy before posting, so the one that is waiting is the one that shows a loading state.
    if (request.kind === 'run') setRun((held) => ({ ...held, busy: true, refused: null, broke: null }))
    if (request.kind === 'generate') setGenerated((held) => ({ ...held, busy: true, refused: null, broke: null }))
    if (request.kind === 'compare') setComparison((held) => ({ ...held, busy: true, refused: null, broke: null }))
    if (request.kind === 'growth') setCurves((held) => ({ ...held, busy: true, refused: null, broke: null }))

    made.postMessage({ ...request, generation: next } as WorkerRequest)
  }, [])

  return { run, generated, comparison, curves, ask, ready }
}
