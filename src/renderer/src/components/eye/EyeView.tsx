import { ArrowLeft, Globe2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import './eye.css'

interface Props {
  onClose(): void
}

type Phase = { kind: 'starting' } | { kind: 'ready'; url: string } | { kind: 'failed'; why: string }

/**
 * OrbisEye, full screen: the live globe with aircraft, ships, satellites, earthquakes and cameras, and voice control.
 *
 * It is a program of its own with a small local server behind it, so it is shown in a frame. Orbis starts that
 * server the first time this screen opens and keeps it for the rest of the session.
 */
export default function EyeView({ onClose }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })

  const start = useCallback(() => {
    setPhase({ kind: 'starting' })
    window.api
      .eyeStart()
      .then((answer) => {
        const a = answer as { ok: boolean; url?: string; why?: string }
        setPhase(a.ok && a.url ? { kind: 'ready', url: a.url } : { kind: 'failed', why: a.why || 'OrbisEye could not start.' })
      })
      .catch((e: unknown) => setPhase({ kind: 'failed', why: e instanceof Error ? e.message : String(e) }))
  }, [])

  useEffect(() => start(), [start])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section className="eye-full" aria-label="OrbisEye">
      <button type="button" className="eye-back" onClick={onClose} title="Back to chat (Esc)" aria-label="Back to chat">
        <ArrowLeft size={16} />
      </button>
      {phase.kind === 'ready' && (
        <iframe className="eye-frame" title="OrbisEye" src={phase.url} allow="microphone; fullscreen; geolocation; autoplay; clipboard-write" />
      )}
      {phase.kind === 'starting' && (
        <div className="eye-wait" role="status">
          <div className="eye-orbit" aria-hidden="true" />
          <p>
            <Globe2 size={16} /> Starting OrbisEye…
          </p>
          <small>The first start takes a few seconds while the map engine loads.</small>
        </div>
      )}
      {phase.kind === 'failed' && (
        <div className="eye-wait" role="alert">
          <p>OrbisEye could not start.</p>
          <small>{phase.why}</small>
          <button type="button" className="files-back" onClick={start}>
            Try again
          </button>
        </div>
      )}
    </section>
  )
}
