import { useCallback, useEffect, useRef, useState } from 'react'
import { acceptUpdate, noWatch, readUpdate, watchFor, type EngineWatch } from '../../../../../shared/chess/analysis'

/**
 * The window's side of the chess engine.
 *
 * Asking is an invoke; the answers come back as a stream of events, because a search produces dozens of updates
 * before it settles. So this needs two things: a way to ask, and a way to listen. The listening follows the pattern
 * every other screen in the window uses -- a named listener on `window.api` that hands back its own unsubscribe,
 * which is `onChessAnalysis` here, with `onChessAnalysisFailed` for a search that could not be finished.
 *
 * Two rules do the real work:
 *
 *   - **Every answer is matched before it is used.** `acceptUpdate` checks the request id and the position, and
 *     counts what it drops. An answer that arrives after the board has moved on is never shown against the new
 *     position, which is the one way a perfectly correct engine still manages to lie (Sections 048, 327).
 *
 *   - **A failure is an answer too.** Without the failed channel a search that died leaves the screen waiting on a
 *     number that is never coming, which looks exactly like a slow engine. The failure arrives, is matched to the
 *     request, and is said.
 *
 * `bridged` exists for the case where the bridge is not there at all. It should be true in this build; if a preload
 * without those listeners is ever loaded, the panel says so in those words rather than offering a search that
 * could produce nothing.
 */

export interface EngineStatus {
  state: string
  detail: string
  name?: string
  version?: string
}

export interface Ask {
  fen: string
  multipv: number
  /** Milliseconds to think for. One of these two is set, never neither. */
  movetime?: number
  depth?: number
}

export interface EngineAnalysis {
  status: EngineStatus | null
  /** True when the engine is installed and ready to be asked. */
  ready: boolean
  /** True when this window can receive the engine's answers at all. */
  bridged: boolean
  watch: EngineWatch
  running: boolean
  /** Said plainly when something went wrong, for the panel to show. */
  problem: string | null
  start: (ask: Ask) => void
  stop: () => void
  /** One search, resolving with everything the engine said about it. This is what a whole-game sweep runs on. */
  runOne: (ask: Ask) => Promise<EngineWatch>
  clearProblem: () => void
  reload: () => void
}

/** What the failed channel carries. Checked rather than trusted: it crossed a process boundary. */
function readFailure(raw: unknown): { id: string; message: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : ''
  const message = typeof r.message === 'string' && r.message.trim() ? r.message : 'That search could not be finished.'
  return { id, message }
}

const plainly = (err: unknown): string =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : 'The engine could not be asked.'

export function useEngineAnalysis(): EngineAnalysis {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [watch, setWatch] = useState<EngineWatch>(noWatch)
  const [running, setRunning] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [bridged, setBridged] = useState(false)
  // The listener runs outside React's render, and a whole-game sweep reads the answer straight after its await, so
  // the live watch is kept in a ref as well as in state. The ref is the truth; the state is what gets drawn.
  const live = useRef<EngineWatch>(noWatch())
  const counter = useRef(0)
  const current = useRef<string | null>(null)
  const failed = useRef<{ id: string; message: string } | null>(null)

  const reload = useCallback(() => {
    void window.api.chessEngineStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (typeof window.api.onChessAnalysis !== 'function') {
      setBridged(false)
      return
    }
    setBridged(true)
    const offUpdates = window.api.onChessAnalysis((raw) => {
      const update = readUpdate(raw)
      if (!update) return
      live.current = acceptUpdate(live.current, update)
      setWatch(live.current)
    })
    const offFailures = typeof window.api.onChessAnalysisFailed === 'function'
      ? window.api.onChessAnalysisFailed((raw) => {
          const failure = readFailure(raw)
          // A failure for a request we are not waiting on belongs to somewhere else on the screen.
          if (!failure || (failure.id && failure.id !== current.current)) return
          failed.current = { id: failure.id || (current.current ?? ''), message: failure.message }
          setProblem(failure.message)
          setRunning(false)
        })
      : null
    return () => {
      offUpdates()
      offFailures?.()
    }
  }, [])

  const runOne = useCallback(async (ask: Ask): Promise<EngineWatch> => {
    const id = `studio-${Date.now().toString(36)}-${(counter.current += 1)}`
    current.current = id
    failed.current = null
    live.current = watchFor(id, ask.fen)
    setWatch(live.current)
    setRunning(true)
    setProblem(null)
    // Read through a typed local: without it the compiler still believes the ref holds the null just assigned, and
    // the check below becomes a comparison against a type with nothing in it.
    const gaveUp = (): boolean => {
      const seen: { id: string; message: string } | null = failed.current
      return seen !== null && seen.id === id
    }
    try {
      await window.api.chessAnalyse({
        id,
        fen: ask.fen,
        multipv: ask.multipv,
        ...(ask.movetime !== undefined ? { movetime: ask.movetime } : {}),
        ...(ask.depth !== undefined ? { depth: ask.depth } : {})
      })
      // The invoke resolves when the search has finished, but the last few updates travel on another channel and can
      // still be in flight. A short wait for the settled one is the difference between recording the final
      // evaluation and recording the one from a moment earlier. A failure ends the wait at once.
      for (let waited = 0; waited < 750 && !live.current.complete && !gaveUp(); waited += 25) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      return live.current
    } catch (err) {
      setProblem(plainly(err))
      return live.current
    } finally {
      if (current.current === id) setRunning(false)
    }
  }, [])

  const start = useCallback((ask: Ask) => { void runOne(ask) }, [runOne])

  const stop = useCallback(() => {
    const id = current.current
    void window.api.chessStopAnalysis(id ?? undefined).catch(() => undefined)
    setRunning(false)
  }, [])

  const clearProblem = useCallback(() => setProblem(null), [])

  return {
    status,
    ready: status?.state === 'ready',
    bridged,
    watch,
    running,
    problem,
    start,
    stop,
    runOne,
    clearProblem,
    reload
  }
}
