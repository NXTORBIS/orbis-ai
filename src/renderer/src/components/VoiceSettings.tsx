import { useCallback, useEffect, useState } from 'react'
import { Check, Download, Mic, Trash2, X } from 'lucide-react'
import type { ExperienceConfig } from '../../../shared/experience'
import { WHISPER_MODELS, PULSAR_MODEL_INFO } from '../../../shared/pulsarModels'
import type { PulsarDownloadProgress, PulsarHardwareInfo, PulsarModelId } from '../../../shared/pulsarModels'

const LANGUAGES: [string, string][] = [
  ['', 'Auto-detect'],
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['kn', 'Kannada'],
  ['ml', 'Malayalam'],
  ['bn', 'Bengali'],
  ['mr', 'Marathi'],
  ['gu', 'Gujarati'],
  ['pa', 'Punjabi'],
  ['ur', 'Urdu'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ar', 'Arabic'],
  ['ru', 'Russian'],
  ['pt', 'Portuguese']
]

const said = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.')

function sizeOf(bytes: number): string {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`
}

/**
 * Settings → Voice input.
 *
 * Every microphone in Orbis reads its model, language and device from here — one setting for the chat composer, the
 * address bar, Orbis Search and Browser Orion alike. There is no cloud option to fall back to: the model that runs
 * is whichever one is installed on this machine, and nothing else. This is the way to see which that is, choose a
 * different one, and manage what is actually on disk.
 */
export default function VoiceSettings(): React.JSX.Element {
  const [experience, setExperience] = useState<ExperienceConfig | null>(null)
  const [hardware, setHardware] = useState<PulsarHardwareInfo | null>(null)
  const [status, setStatus] = useState<{ installed: PulsarModelId[]; downloading: PulsarModelId[] }>({ installed: [], downloading: [] })
  const [progress, setProgress] = useState<Record<string, PulsarDownloadProgress>>({})
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([])
  const [busy, setBusy] = useState<PulsarModelId | null>(null)
  const [message, setMessage] = useState('')

  const refresh = useCallback(() => {
    void window.api.pulsarModelsStatus().then(setStatus)
  }, [])

  useEffect(() => {
    void window.api.getExperience().then(setExperience)
    refresh()
    void window.api.voiceHardware().then(setHardware)
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => setDevices(list.filter((d) => d.kind === 'audioinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))))
      .catch(() => undefined)
    const offExperience = window.api.onExperienceChanged(setExperience)
    const offProgress = window.api.onPulsarModelProgress((p) => setProgress((prev) => ({ ...prev, [p.id]: p })))
    return () => {
      offExperience()
      offProgress()
    }
  }, [refresh])

  const save = async (next: ExperienceConfig, reason?: string): Promise<void> => {
    setExperience(next)
    const { config } = await window.api.saveExperience(next, reason)
    setExperience(config)
  }

  const setModel = async (model: PulsarModelId): Promise<void> => {
    if (!experience) return
    await save({ ...experience, voice: { ...experience.voice, model } }, `Voice model set to ${PULSAR_MODEL_INFO[model].label}`)
  }

  const download = async (id: PulsarModelId): Promise<void> => {
    setBusy(id)
    setMessage('')
    try {
      const result = await window.api.downloadPulsarModel(id)
      setMessage(result.ok ? `${PULSAR_MODEL_INFO[id].label} is ready.` : result.message ?? 'The download failed.')
    } catch (err) {
      setMessage(said(err))
    } finally {
      setBusy(null)
      setProgress((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      refresh()
    }
  }

  const cancelDownload = async (id: PulsarModelId): Promise<void> => {
    await window.api.cancelPulsarModelDownload(id)
  }

  const remove = async (id: PulsarModelId): Promise<void> => {
    await window.api.deletePulsarModel(id)
    if (experience?.voice.model === id) await setModel(hardware?.recommended ?? 'base')
    refresh()
  }

  if (!experience) return <></>

  return (
    <div className="voice-settings">
      {hardware && (
        <p className="skill-meta">
          {hardware.cpuModel} · {hardware.cpuThreads} threads · {(hardware.totalRamMb / 1000).toFixed(1)} GB RAM
          {hardware.hasNvidiaGpu ? ' · GPU acceleration available' : ''} — recommended: {PULSAR_MODEL_INFO[hardware.recommended].label}
        </p>
      )}

      <ul className="voice-model-list">
        {WHISPER_MODELS.map((id) => {
          const info = PULSAR_MODEL_INFO[id]
          const installed = status.installed.includes(id)
          const downloading = status.downloading.includes(id) || busy === id
          const p = progress[id]
          const active = experience.voice.model === id
          return (
            <li key={id} className={`voice-model-row${active ? ' active' : ''}`}>
              <div className="voice-model-info">
                <b>
                  {info.label}
                  {id === hardware?.recommended && <span className="voice-model-tag">Recommended</span>}
                  {active && <span className="voice-model-tag on">In use</span>}
                </b>
                <small>
                  {sizeOf(info.sizeBytes)} · {info.description}
                </small>
                {downloading && p && (
                  <div className="voice-progress">
                    <div className="voice-progress-bar" style={{ width: `${Math.min(100, (p.receivedBytes / p.totalBytes) * 100)}%` }} />
                  </div>
                )}
              </div>
              <div className="voice-model-actions">
                {downloading ? (
                  <button type="button" className="galaxy-btn" onClick={() => void cancelDownload(id)}>
                    <X size={12} /> Cancel
                  </button>
                ) : installed ? (
                  <>
                    {!active && (
                      <button type="button" className="galaxy-btn" onClick={() => void setModel(id)}>
                        <Check size={12} /> Use this
                      </button>
                    )}
                    <button type="button" className="galaxy-btn" onClick={() => void remove(id)} aria-label={`Remove ${info.label}`}>
                      <Trash2 size={12} />
                    </button>
                  </>
                ) : (
                  <button type="button" className="galaxy-btn" onClick={() => void download(id)}>
                    <Download size={12} /> Download
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {message && <p className="skill-meta">{message}</p>}
      {!status.installed.length && !status.downloading.length && !message && (
        <p className="skill-meta">Pulsar needs one model downloaded once — after that it works completely offline, with no limit and nothing sent anywhere.</p>
      )}

      <div className="voice-settings-row">
        <label htmlFor="voice-language">Language</label>
        <select id="voice-language" value={experience.voice.language ?? ''} onChange={(e) => void save({ ...experience, voice: { ...experience.voice, language: e.target.value || null } })}>
          {LANGUAGES.map(([code, label]) => (
            <option key={code || 'auto'} value={code}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {devices.length > 0 && (
        <div className="voice-settings-row">
          <label htmlFor="voice-device">
            <Mic size={13} /> Microphone
          </label>
          <select id="voice-device" value={experience.voice.deviceId ?? ''} onChange={(e) => void save({ ...experience, voice: { ...experience.voice, deviceId: e.target.value || null } })}>
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
