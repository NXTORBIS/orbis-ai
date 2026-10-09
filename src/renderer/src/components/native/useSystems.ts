import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerReply as SystemsReply, WorkerRequest as SystemsRequest } from './systems.worker'
import type { WorkerReply as IntelligenceReply, WorkerRequest as IntelligenceRequest } from './intelligence.worker'

/**
 * Owning the two Phase 5 workers, and dropping anything stale either sends back.
 *
 * The same generation guard as every other worker here, and it earns its place twice over in these: training a
 * network takes seconds, so somebody adjusting a learning rate will have several runs outstanding, and drawing the
 * one that happens to arrive last would show a decision boundary belonging to settings that are no longer on screen.
 *
 * ## Why one hook for two workers
 *
 * They are never both busy for the same card — a laboratory is either a systems one or an intelligence one — and a
 * single generation counter across both is what makes that guarantee hold. Two hooks with two counters could each
 * believe its own answer was current.
 */

type Without<T, K extends string> = T extends unknown ? Omit<T, K> : never
export type Ask = Without<SystemsRequest, 'generation'> | Without<IntelligenceRequest, 'generation'>

export interface Asked<T> {
  value: T | null
  busy: boolean
  refused: { says: string; fix: string } | null
  broke: string | null
}

const nothing = <T,>(): Asked<T> => ({ value: null, busy: false, refused: null, broke: null })

export interface Systems {
  logic: Asked<Record<string, unknown>>
  processor: Asked<Record<string, unknown>>
  scheduling: Asked<Record<string, unknown>>
  networking: Asked<Record<string, unknown>>
  image: Asked<Record<string, unknown>>
  learning: Asked<Record<string, unknown>>
  neural: Asked<Record<string, unknown>>
  ask(request: Ask): void
  ready: boolean
}

/** Which worker a request belongs to, so only the one that is needed is ever started. */
const SYSTEMS_KINDS = new Set(['logic', 'processor', 'scheduling', 'networking'])

export function useSystems(): Systems {
  const systems = useRef<Worker | null>(null)
  const intelligence = useRef<Worker | null>(null)
  const generation = useRef(0)
  const [ready, setReady] = useState(false)

  const [logic, setLogic] = useState<Asked<Record<string, unknown>>>(nothing)
  const [processor, setProcessor] = useState<Asked<Record<string, unknown>>>(nothing)
  const [scheduling, setScheduling] = useState<Asked<Record<string, unknown>>>(nothing)
  const [networking, setNetworking] = useState<Asked<Record<string, unknown>>>(nothing)
  const [image, setImage] = useState<Asked<Record<string, unknown>>>(nothing)
  const [learning, setLearning] = useState<Asked<Record<string, unknown>>>(nothing)
  const [neural, setNeural] = useState<Asked<Record<string, unknown>>>(nothing)

  const setters = useRef({
    logic: setLogic,
    processor: setProcessor,
    scheduling: setScheduling,
    networking: setNetworking,
    image: setImage,
    learning: setLearning,
    neural: setNeural
  })

  useEffect(() => {
    const onMessage = (event: MessageEvent<SystemsReply | IntelligenceReply>): void => {
      const reply = event.data
      if (!reply || reply.generation !== generation.current) return

      if (reply.kind === 'refused' || reply.kind === 'broke') {
        const refused = reply.kind === 'refused' ? { says: reply.says, fix: reply.fix } : null
        const broke = reply.kind === 'broke' ? reply.says : null
        // Only whichever request was outstanding is told; the others keep what they correctly hold.
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

    const onError = (which: string) => (): void => {
      for (const setter of Object.values(setters.current)) {
        setter((held) => (held.busy ? { ...held, busy: false, broke: `The ${which} engine could not be started.` } : held))
      }
    }

    /*
     * Both workers are started when the hook mounts rather than on first use.
     *
     * The alternative — starting one lazily — means the first request after opening a card waits for a module to be
     * fetched and a thread to start, which on a cold cache is long enough to feel like the app ignored the click.
     * Two idle threads cost nothing until something is posted to them, and both are terminated on unmount.
     */
    const madeSystems = new Worker(new URL('./systems.worker.ts', import.meta.url), { type: 'module' })
    const madeIntelligence = new Worker(new URL('./intelligence.worker.ts', import.meta.url), { type: 'module' })
    madeSystems.onmessage = onMessage
    madeIntelligence.onmessage = onMessage
    madeSystems.onerror = onError('systems')
    madeIntelligence.onerror = onError('intelligence')
    systems.current = madeSystems
    intelligence.current = madeIntelligence
    setReady(true)

    return () => {
      // Without this, closing the card leaves two threads running for the rest of the session.
      madeSystems.terminate()
      madeIntelligence.terminate()
      systems.current = null
      intelligence.current = null
      setReady(false)
    }
  }, [])

  const ask = useCallback((request: Ask) => {
    const which = SYSTEMS_KINDS.has(request.kind) ? systems.current : intelligence.current
    if (!which) return
    generation.current += 1
    const next = generation.current

    const setter = setters.current[request.kind as keyof typeof setters.current]
    if (setter !== undefined) setter((held) => ({ ...held, busy: true, refused: null, broke: null }))

    which.postMessage({ ...request, generation: next })
  }, [])

  return { logic, processor, scheduling, networking, image, learning, neural, ask, ready }
}
