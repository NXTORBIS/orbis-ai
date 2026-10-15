import { useState } from 'react'
import { CircleAlert, CircleCheck, TriangleAlert, Stethoscope } from 'lucide-react'
import './orbisDoctor.css'

type Result = Awaited<ReturnType<typeof window.api.runDoctor>>

/**
 * Orbis looking at itself. One press runs a handful of read-only checks (can it save, are its files readable, is there
 * space, does it have model access, is the browser there) and says what it found in plain sentences. It changes nothing.
 */
export default function OrbisDoctor(): React.JSX.Element {
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      setResult(await window.api.runDoctor())
    } catch {
      setFailed(true)
    }
    setBusy(false)
  }

  return (
    <section className="setting doctor">
      <div className="setting-label">
        <h3>Check Orbis</h3>
        <p>Looks at saving, your data files, disk space, model access and the browser, and tells you what it finds. It changes nothing.</p>
      </div>
      <div className="doctor-body">
        <button type="button" className="doctor-run" onClick={() => void run()} disabled={busy}>
          <Stethoscope size={14} />
          {busy ? 'Checking…' : result ? 'Check again' : 'Run the check'}
        </button>
        {failed && <p className="doctor-line is-bad">The check itself could not run.</p>}
        {result && (
          <>
            <p className="doctor-head" role="status">
              {result.headline}
            </p>
            <ul className="doctor-list">
              {result.checks.map((c) => (
                <li key={c.id} className={`doctor-line is-${c.state}`}>
                  {c.state === 'ok' ? <CircleCheck size={15} /> : c.state === 'warn' ? <TriangleAlert size={15} /> : <CircleAlert size={15} />}
                  <span>
                    <b>{c.name}</b>
                    <small>{c.detail}</small>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
