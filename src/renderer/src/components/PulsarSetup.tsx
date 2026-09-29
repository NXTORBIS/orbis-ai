import { useCallback, useEffect, useState } from 'react'
import { Check, Download, Mic, X } from 'lucide-react'

import { PULSAR_MODELS, PULSAR_MODEL_INFO, saidSize } from '../../../shared/pulsarModels'
import type { PulsarDownloadProgress, PulsarHardwareInfo, PulsarModelId } from '../../../shared/pulsarModels'
import type { NoticeKind } from '../lib/notices'

/**
 * Choosing a voice model, the first time somebody presses a microphone.
 *
 * Until now the first press produced an error telling you to go and find Settings. That is a dead end dressed as a
 * message: the person wanted to speak, and what they got was homework. This asks the question at the moment it
 * matters, with enough in front of them to answer it.
 *
 * ## Why it asks rather than deciding
 *
 * Orbis can tell which model this machine will run comfortably, and it says so. But the honest trade -- a fast model
 * that mishears names against a slow one that does not, paid for in gigabytes and in seconds per sentence -- is a
 * preference, not a fact about the hardware. Somebody dictating short commands and somebody dictating prose want
 * different answers on the same laptop.
 *
 * So the recommendation leads, and everything else is one click away rather than hidden.
 *
 * ## What it refuses to hide
 *
 * The download size, the memory each one needs, and whether this machine has that memory. A model that will not fit
 * is shown and marked, not silently dropped: "why can't I pick the accurate one" has an answer, and it is better read
 * than guessed at.
 */

export function PulsarSetup({
  onClose,
  onReady,
  onNotify
}: {
  onClose(): void
  /** The chosen model finished downloading and is ready to use. */
  onReady(id: PulsarModelId): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [hardware, setHardware] = useState<PulsarHardwareInfo | null>(null)
  const [chosen, setChosen] = useState<PulsarModelId | null>(null)
  const [downloading, setDownloading] = useState<PulsarModelId | null>(null)
  const [progress, setProgress] = useState<PulsarDownloadProgress | null>(null)

  useEffect(() => {
    void window.api.voiceHardware().then((info) => {
      if (info === null || 'error' in info) return
      setHardware(info)
      // The recommendation is the starting answer, so pressing the one obvious button is the right thing to do.
      setChosen((current) => current ?? info.recommended)
    })
  }, [])

  useEffect(() => window.api.onPulsarModelProgress((one) => setProgress(one)), [])

  // Escape closes, the way every other overlay in Orbis does -- but not mid-download, where it would leave a
  // half-written file and no way to see it finish.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && downloading === null) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, downloading])

  const fits = useCallback(
    (id: PulsarModelId): boolean => hardware === null || hardware.totalRamMb >= PULSAR_MODEL_INFO[id].ramMb * 2.2,
    [hardware]
  )

  const get = useCallback(async (): Promise<void> => {
    if (chosen === null) return
    setDownloading(chosen)
    setProgress(null)
    try {
      const result = await window.api.downloadPulsarModel(chosen)
      if ('error' in result || result.ok !== true) {
        onNotify(('message' in result && result.message) || 'The download did not finish.', 'error')
        return
      }
      onNotify(`${PULSAR_MODEL_INFO[chosen].label} is ready. Press the microphone again.`)
      onReady(chosen)
    } finally {
      setDownloading(null)
      setProgress(null)
    }
  }, [chosen, onNotify, onReady])

  const percent =
    progress && progress.totalBytes > 0 ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100)) : null

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal pulsar-setup" role="dialog" aria-modal="true" aria-labelledby="pulsar-setup-title">
        <header className="pulsar-setup-head">
          <div>
            <h2 id="pulsar-setup-title">
              <Mic size={16} aria-hidden="true" /> Set up Orbis Pulsar
            </h2>
            <p className="page-note">
              Speech to text runs on this computer, so it needs a model downloaded once. After that it works offline,
              with no limit, and nothing you say leaves the machine.
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={downloading !== null}>
            <X size={16} />
          </button>
        </header>

        {hardware && (
          <p className="page-note pulsar-setup-machine">
            This machine: {hardware.cpuThreads} cores, {Math.round(hardware.totalRamMb / 1000)} GB of memory
            {hardware.hasNvidiaGpu ? ', with a GPU' : ''}.
          </p>
        )}

        <ul className="pulsar-setup-list" role="radiogroup" aria-label="Which model to download">
          {PULSAR_MODELS.map((id) => {
            const model = PULSAR_MODEL_INFO[id]
            const roomy = fits(id)
            const suggested = hardware?.recommended === id
            return (
              <li key={id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen === id}
                  className={`pulsar-model${chosen === id ? ' on' : ''}${roomy ? '' : ' tight'}`}
                  onClick={() => setChosen(id)}
                  disabled={downloading !== null}
                >
                  <span className="pulsar-model-head">
                    <strong>{model.label}</strong>
                    {suggested && <span className="pulsar-tag">Recommended for this machine</span>}
                    {!roomy && <span className="pulsar-tag tight">Needs more memory than this machine has</span>}
                    {chosen === id && <Check size={14} aria-hidden="true" />}
                  </span>
                  <span className="page-note">{model.description}</span>
                  <span className="pulsar-model-facts">
                    {saidSize(model.sizeBytes)} to download · about {Math.round(model.ramMb / 100) / 10} GB of memory
                    while it runs
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {downloading !== null ? (
          <div className="pulsar-setup-progress">
            <p>
              Downloading {PULSAR_MODEL_INFO[downloading].label}
              {percent === null ? '…' : ` — ${percent}%`}
            </p>
            <progress value={percent ?? undefined} max={100} aria-label="Download progress" />
            <p className="page-note">You can keep working; this carries on in the background.</p>
          </div>
        ) : (
          <div className="pulsar-setup-actions">
            <button type="button" className="queue-btn" onClick={onClose}>
              Not now
            </button>
            <button type="button" className="queue-btn primary" disabled={chosen === null} onClick={() => void get()}>
              <Download size={14} /> Download {chosen ? PULSAR_MODEL_INFO[chosen].label : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default PulsarSetup
