import './files-host.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FILES_ASK_STATE_MESSAGE,
  FILES_CONTROL_MESSAGE,
  readFilesCommands,
  readFilesReply,
  readFilesState,
  type FilesCommand,
  type FilesControlName,
  type FilesViewState
} from '../../../../shared/filesControl'
import DeclareSurface from '../../components/DeclareSurface'
import { filesBrowserSurface } from '../../components/filesSurfaces'

interface Props {
  /** A Files tool to open once the frame is ready, e.g. 'universeExplorer'. */
  tool?: string
}

type Phase = { kind: 'waiting' } | { kind: 'loading' } | { kind: 'failed'; why: string }

/** How long the frame is given to answer before the window says it did not. */
const ANSWER_MS = 20_000

/**
 * The Files screen runs in its own frame (files.html). Its stylesheet restyles the whole document, so sharing a
 * page with the rest of Orbis made the Orbis window collapse; a frame keeps both exactly as they were.
 *
 * The frame is not made until the main process says Files' services are up. Opened straight after launch it used to
 * load first and ask for things that were not registered yet, and sat there. Now that wait is shown, and a failure is
 * said, with a way to try again.
 *
 * This is also where Files becomes something Orbis can work rather than only open. The frame is a separate program:
 * the window's register of controllable screens cannot see a screen inside it, and the one door between the
 * application and its window reaches this document and not a subframe. So the frame says what is on screen over the
 * same `postMessage` route it already uses to say it is ready, this holds the last thing it said, and
 * `files/browser` is declared from that. Nothing is assumed: before the frame has spoken, every reading on that
 * screen comes back as one that could not be taken.
 */
export default function FilesHost({ tool }: Props): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' })
  /** The last snapshot from the frame and when it arrived here. Null until it has said something. */
  const [said, setSaid] = useState<{ state: FilesViewState; at: number } | null>(null)
  const [commands, setCommands] = useState<readonly FilesCommand[]>([])
  /** Questions sent to the frame that have not been answered yet. */
  const asked = useRef(new Map<string, { resolve(value: unknown): void; reject(why: Error): void; timer: number }>())

  const check = useCallback(() => {
    setPhase({ kind: 'waiting' })
    window.api
      .filesHostReady()
      .then((answer) => setPhase(answer.ok ? { kind: 'loading' } : { kind: 'failed', why: answer.why || 'Files could not start.' }))
      .catch((e: unknown) => setPhase({ kind: 'failed', why: e instanceof Error ? e.message : 'Files could not start.' }))
  }, [])

  useEffect(() => check(), [check])

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      // Only this frame. Everything arriving is somebody else's text until it has been checked, and every reader
      // below checks the shape field by field rather than trusting the `type`.
      if (event.source !== frame.current?.contentWindow) return
      if ((event.data as { type?: string } | null)?.type === 'orbis-files-ready') {
        setReady(true)
        return
      }
      const state = readFilesState(event.data)
      if (state) {
        setSaid({ state, at: Date.now() })
        return
      }
      const list = readFilesCommands(event.data)
      if (list) {
        setCommands(list)
        return
      }
      const reply = readFilesReply(event.data)
      if (reply) {
        const waiting = asked.current.get(reply.id)
        if (!waiting) return
        asked.current.delete(reply.id)
        window.clearTimeout(waiting.timer)
        if (reply.ok) waiting.resolve(reply.data)
        else waiting.reject(new Error(reply.message ?? 'Files did not say what went wrong.'))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Nothing is left waiting for ever when this screen goes.
  useEffect(
    () => () => {
      for (const [, waiting] of asked.current) {
        window.clearTimeout(waiting.timer)
        waiting.reject(new Error('The Files screen was closed before it answered.'))
      }
      asked.current.clear()
    },
    []
  )

  useEffect(() => {
    if (!ready) return
    if (tool) frame.current?.contentWindow?.postMessage({ type: 'orbis-files-open', tool }, '*')
    // Asked for once it is ready, in case it had settled before this window started listening.
    frame.current?.contentWindow?.postMessage({ type: FILES_ASK_STATE_MESSAGE }, '*')
  }, [ready, tool])

  /** Asks the frame for something and resolves with its answer, or rejects with its own sentence. */
  const ask = useCallback((name: FilesControlName, params: Record<string, unknown> = {}): Promise<unknown> => {
    const target = frame.current?.contentWindow
    if (!target) return Promise.reject(new Error('The Files screen is not open.'))
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        asked.current.delete(id)
        // Said as what it is: nothing came back. Not "it failed", which would be a claim about what Files did.
        reject(new Error(`Files did not answer “${name}” within ${Math.round(ANSWER_MS / 1000)} seconds.`))
      }, ANSWER_MS)
      asked.current.set(id, { resolve, reject, timer })
      target.postMessage({ type: FILES_CONTROL_MESSAGE, id, name, params }, '*')
    })
  }, [])

  /*
   * The declaration, rebuilt whenever the frame says something new.
   *
   * It has to be rebuilt rather than captured: the allowed views, the sort keys and the list of commands all come
   * from what Files said, so a declaration held from before the first snapshot would offer a screen with no choices
   * on it.
   */
  const declaration = useMemo(() => filesBrowserSurface({ said: () => said, commands: () => commands, ask }), [said, commands, ask])

  if (phase.kind === 'waiting') {
    return <div className="files-frame files-wait" role="status">Starting Files…</div>
  }
  if (phase.kind === 'failed') {
    return (
      <div className="files-frame files-wait" role="alert">
        <p>{phase.why}</p>
        <button type="button" className="queue-btn" onClick={check}>Try again</button>
      </div>
    )
  }
  return (
    <>
      {/* Draws nothing. It declares the Files screen for as long as the frame is there to answer for it. */}
      {ready && <DeclareSurface declaration={declaration} />}
      <iframe ref={frame} className="files-frame" title="Orbis Files" src={new URL('./files.html', window.location.href).href} />
    </>
  )
}
