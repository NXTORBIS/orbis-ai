import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Segmented } from '../ui'
import type { ImageGenStatus, Settings, SettingsUpdate } from '../../../shared/types'

/**
 * The local image engine, in Settings.
 *
 * Everything shown is read from the engine: its state, the last time a picture took, the version it is pinned to and the
 * lines it printed while installing. The size and steps are real inputs to the next picture. There is no sample value.
 */

const SIZES = ['512', '640', '768', '1024'] as const
const STEPS = ['1', '2', '3', '4'] as const

const STATE_WORDS: Record<ImageGenStatus['state'], string> = {
  'not-installed': 'Not installed',
  installing: 'Installing',
  stopped: 'Installed, not running (starts with the next picture)',
  starting: 'Starting',
  ready: 'Ready',
  generating: 'Drawing a picture',
  failed: 'Failed'
}

interface Props {
  settings: Settings
  onUpdate(update: SettingsUpdate): Promise<Settings>
}

export default function ImageGenSettings({ settings, onUpdate }: Props): React.JSX.Element {
  const [status, setStatus] = useState<ImageGenStatus | null>(null)
  const [problem, setProblem] = useState('')
  const [starting, setStarting] = useState(false)
  const alive = useRef(true)

  const read = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.getImageGenStatus()
      if (alive.current) setStatus(next)
    } catch (err) {
      if (alive.current) setProblem(err instanceof Error ? err.message : 'The image engine could not be read.')
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void read()
    return () => {
      alive.current = false
    }
  }, [read])

  // Quick while something is happening, slow otherwise.
  const busy = status?.state === 'installing' || status?.state === 'starting' || status?.state === 'generating'
  useEffect(() => {
    const timer = setInterval(() => void read(), busy ? 1000 : 6000)
    return () => clearInterval(timer)
  }, [read, busy])

  const install = async (): Promise<void> => {
    setProblem('')
    setStarting(true)
    try {
      const answer = await window.api.installImageEngine()
      if (!answer.started) setProblem(answer.message)
      await read()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The install could not be started.')
    } finally {
      setStarting(false)
    }
  }

  const installed = status !== null && status.state !== 'not-installed'
  const last = status?.lastGeneration ?? null

  return (
    <>
      <section className="setting">
        <div className="setting-label">
          <h3>Image engine</h3>
          <p>Pictures are drawn on this computer by FastSDCPU. Nothing is sent to an online image service.</p>
        </div>
        <p aria-live="polite">
          <strong>{status ? STATE_WORDS[status.state] : 'Checking…'}</strong>
          {status?.detail && status.state !== 'ready' ? ` — ${status.detail}` : ''}
        </p>
        {status?.backend && <p style={{ color: 'var(--faint)' }}>{status.backend.openvino ? 'OpenVINO' : 'PyTorch'} · {status.backend.model}</p>}
        <p style={{ color: 'var(--faint)' }}>
          {last
            ? `Last picture: ${last.seconds.toFixed(1)} s at ${last.width}×${last.height}, ${last.steps} step${last.steps === 1 ? '' : 's'}${last.imageToImage ? ', edited from a picture' : ''}.`
            : 'No picture has been made on this computer yet, so there is no time to show.'}
        </p>
        {status && (
          <p style={{ color: 'var(--faint)' }}>
            Pinned version {status.pinnedCommit.slice(0, 8)}
            {status.installedCommit ? (status.installedCommit === status.pinnedCommit ? ' · installed' : ` · installed ${status.installedCommit.slice(0, 8)}`) : ''}
          </p>
        )}
        <div className="field-grid">
          <Button kind="primary" busy={starting || status?.state === 'installing'} busyLabel="Installing…" disabled={status?.state === 'generating'} onClick={() => void install()}>
            {installed ? 'Repair' : 'Install'}
          </Button>
        </div>
        {problem && <p role="alert">{problem}</p>}
        {status && status.log.length > 0 && (status.state === 'installing' || status.state === 'failed' || status.state === 'starting') && (
          <ul aria-label="Engine progress" style={{ color: 'var(--faint)', fontSize: 12, listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {status.log.map((line, i) => (
              <li key={`${i}-${line}`} style={{ overflowWrap: 'anywhere' }}>
                {line}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="setting row">
        <div className="setting-label">
          <h3>Picture size</h3>
          <p>Width and height in pixels. Larger pictures take noticeably longer on a CPU.</p>
        </div>
        <Segmented
          label="Picture size"
          className="segmented"
          value={String(settings.imageSize)}
          options={SIZES.map((v) => ({ value: v, label: v }))}
          onChange={(v) => void onUpdate({ imageSize: Number(v) })}
        />
      </section>

      <section className="setting row">
        <div className="setting-label">
          <h3>Steps</h3>
          <p>One step is the fastest. More steps refine the picture and take about as many times longer.</p>
        </div>
        <Segmented
          label="Steps"
          className="segmented"
          value={String(settings.imageSteps)}
          options={STEPS.map((v) => ({ value: v, label: v }))}
          onChange={(v) => void onUpdate({ imageSteps: Number(v) })}
        />
      </section>
    </>
  )
}
