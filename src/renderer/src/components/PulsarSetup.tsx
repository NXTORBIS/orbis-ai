import { useCallback, useEffect, useState } from 'react'
import { Check, Download, Mic, X } from 'lucide-react'

import { PULSAR_MODELS, PULSAR_MODEL_INFO, saidSize } from '../../../shared/pulsarModels'
import type { PulsarDownloadProgress, PulsarHardwareInfo, PulsarModelId } from '../../../shared/pulsarModels'
import type { NoticeKind } from '../lib/notices'
import { Button, Modal } from '../ui'

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
    <Modal
      label="Set up Orbis Pulsar"
      onClose={onClose}
      /*
       * This one answer used to be given three separate times, and that is all `canClose` is replacing.
       *
       * There was a hand-written Escape listener on the window -- `if (event.key === 'Escape' && downloading ===
       * null) onClose()`, commented "Escape closes, the way every other overlay in Orbis does -- but not
       * mid-download, where it would leave a half-written file and no way to see it finish". It is deleted: Modal
       * takes Escape itself, and takes it capturing, so the screen behind this one no longer sees the key either.
       * There was a backdrop with no handler at all, which is the second way of saying not now. And there is the
       * close button in the header below, which disables itself while a download runs.
       *
       * One condition, said once.
       */
      canClose={downloading === null}
      /*
       * The backdrop here has never closed this dialog: it carried no click handler at all, not even before a
       * download started. Leaving the shared default on would have been a behaviour change smuggled in beside a
       * construction change, which is the one thing this pass must not do.
       */
      outsideCloses={false}
      /*
       * `modal pulsar-setup`, exactly the two classes it has always written, rather than the usual `modal glass`
       * plus a `className`.
       *
       * Worth saying plainly rather than quietly correcting: neither of those classes paints anything. `.modal` is
       * a width, a flex column and a corner radius; `.pulsar-setup` is a width, a flex column and a gap. The
       * background, border, shadow and blur all live in `.glass`, which this dialog has never had -- so its
       * heading, its list of models and its buttons sit directly on the dimmed window with no panel behind them.
       * That is how it shipped. Adding `glass` here would fix it and change how the dialog looks in the same
       * commit, which is the one thing this pass must not do. Written down, not fixed.
       *
       * `panel` also keeps `.modal` on the element, which is the only hook the Corners setting has.
       */
      panel="modal pulsar-setup"
    >
      {/* Titles itself in its body, so no `title` prop: that would swap this header for `modal-header` and drop the
          paragraph under the heading. Modal names the dialog with `label` instead of the old
          `aria-labelledby="pulsar-setup-title"`; same words either way. */}
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
        {/* Icon only, so it stays as it is -- that is IconButton's job, not this pass's. Its `disabled` is the same
            condition `canClose` carries, because without a `title` prop Modal draws no close button of its own. */}
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
              {/* Not a Button: `pulsar-model` is its own card and belongs to neither shared family, and this is a
                  radio rather than a button that does something. */}
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
          <Button onClick={onClose}>Not now</Button>
          <Button kind="primary" icon={<Download size={14} />} disabled={chosen === null} onClick={() => void get()}>
            {/* The space the old markup had between the icon and the word, kept literally so nothing can shift. */}
            {' '}
            Download {chosen ? PULSAR_MODEL_INFO[chosen].label : ''}
          </Button>
        </div>
      )}
    </Modal>
  )
}

export default PulsarSetup
