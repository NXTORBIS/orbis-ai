import './files-host.css'
import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  /** A Files tool to open once the frame is ready, e.g. 'universeExplorer'. */
  tool?: string
}

type Phase = { kind: 'waiting' } | { kind: 'loading' } | { kind: 'failed'; why: string }

/**
 * The Files screen runs in its own frame (files.html). Its stylesheet restyles the whole document, so sharing a
 * page with the rest of Orbis made the Orbis window collapse; a frame keeps both exactly as they were.
 *
 * The frame is not made until the main process says Files' services are up. Opened straight after launch it used to
 * load first and ask for things that were not registered yet, and sat there. Now that wait is shown, and a failure is
 * said, with a way to try again.
 */
export default function FilesHost({ tool }: Props): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' })

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
      if (event.source !== frame.current?.contentWindow) return
      if ((event.data as { type?: string } | null)?.type === 'orbis-files-ready') setReady(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (ready && tool) frame.current?.contentWindow?.postMessage({ type: 'orbis-files-open', tool }, '*')
  }, [ready, tool])

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
  return <iframe ref={frame} className="files-frame" title="Orbis Files" src={new URL('./files.html', window.location.href).href} />
}
