import { useEffect, useState } from 'react'
import { CircleAlert, Download, RefreshCw, RotateCcw } from 'lucide-react'
import type { UpdateStatus } from '../../../shared/updates'
import { CHANNELS, describeUpdate } from '../../../shared/updates'
import type { UpdateHistoryView, UpdateSettingsView } from '../../../shared/types'

/**
 * About Orbis: which version this is, whether there is a newer one, and what Orbis should do about it.
 *
 * Everything here asks the update manager rather than keeping any account of its own, so what is shown is what is
 * actually happening. Nothing on this screen can make an update skip a check — it can only ask for what the manager
 * already allows.
 */

const when = (at: number): string =>
  at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : ''

export default function UpdateSettings(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [settings, setSettings] = useState<UpdateSettingsView | null>(null)
  const [history, setHistory] = useState<UpdateHistoryView[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.updateStatus().then((all) => {
      if (!alive || !all) return
      setStatus(all.status)
      setSettings(all.settings)
      setHistory(all.history)
    })
    const off = window.api.onUpdateChanged((next) => setStatus(next))
    return () => {
      alive = false
      off()
    }
  }, [])

  const change = async (patch: Partial<UpdateSettingsView>): Promise<void> => {
    const next = await window.api.setUpdateSettings(patch)
    if (next) setSettings(next)
  }

  const run = async (what: () => Promise<UpdateStatus | null>): Promise<void> => {
    setBusy(true)
    try {
      const next = await what()
      if (next) setStatus(next)
    } finally {
      setBusy(false)
    }
  }

  if (!status || !settings) {
    return (
      <section className="setting">
        <div className="setting-label">
          <h3>About Orbis</h3>
          <p className="view-muted">Reading…</p>
        </div>
      </section>
    )
  }

  const ready = status.state === 'ready-to-install'
  const downloading = status.state === 'downloading'

  return (
    <>
      <section className="setting">
        <div className="setting-label">
          <h3>About Orbis</h3>
          <p>
            Version {status.currentVersion}
            {status.lastCheckedAt ? ` · last checked ${when(status.lastCheckedAt)}` : ''}
          </p>
        </div>

        <div className="up-state">
          <p className={`up-line${status.state === 'failed' ? ' problem' : ''}`}>
            {status.state === 'failed' && <CircleAlert size={14} aria-hidden="true" />}
            {describeUpdate(status)}
          </p>

          {downloading && (
            <div className="up-progress" role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
            </div>
          )}

          {status.mandatory && status.availableVersion && (
            <p className="up-required">This update is required: the version you have is no longer supported.</p>
          )}

          {status.releaseNotes && (status.state === 'update-available' || ready) && (
            <div className="up-notes">
              <b>What’s new in {status.availableVersion}</b>
              <pre>{status.releaseNotes}</pre>
            </div>
          )}

          <div className="up-actions">
            {ready ? (
              <button type="button" className="queue-btn primary" disabled={busy} onClick={() => void run(() => window.api.restartAndUpdate())}>
                <RotateCcw size={13} /> Restart &amp; Update
              </button>
            ) : status.state === 'update-available' ? (
              <button type="button" className="queue-btn primary" disabled={busy} onClick={() => void run(() => window.api.downloadUpdate())}>
                <Download size={13} /> Download
              </button>
            ) : (
              <button type="button" className="queue-btn" disabled={busy || status.state === 'checking'} onClick={() => void run(() => window.api.checkForUpdates())}>
                <RefreshCw size={13} /> Check for updates
              </button>
            )}
            {downloading && (
              <button type="button" className="queue-btn" onClick={() => void run(() => window.api.cancelUpdateDownload())}>
                Stop
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="setting row">
        <div className="setting-label">
          <h3>Update channel</h3>
          <p>Stable is the one to be on unless you are helping test Orbis. Changing it leaves your profiles alone.</p>
        </div>
        <select value={settings.channel} aria-label="Update channel" onChange={(e) => void change({ channel: e.target.value as UpdateSettingsView['channel'] })}>
          {CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {channel[0].toUpperCase() + channel.slice(1)}
            </option>
          ))}
        </select>
      </section>

      <section className="setting row">
        <div className="setting-label">
          <h3>Check for updates automatically</h3>
        </div>
        <label className="switch">
          <input type="checkbox" checked={settings.checkAutomatically} onChange={(e) => void change({ checkAutomatically: e.target.checked })} />
          <span />
        </label>
      </section>

      <section className="setting row">
        <div className="setting-label">
          <h3>Download updates automatically</h3>
          <p>Downloaded in the background. Nothing is installed until you say so.</p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={settings.downloadAutomatically} onChange={(e) => void change({ downloadAutomatically: e.target.checked })} />
          <span />
        </label>
      </section>

      <section className="setting row">
        <div className="setting-label">
          <h3>Install and restart automatically</h3>
          <p>Off by default: Orbis will not close itself while you are using it.</p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={settings.installAutomatically} onChange={(e) => void change({ installAutomatically: e.target.checked })} />
          <span />
        </label>
      </section>

      {history.length > 0 && (
        <section className="setting">
          <div className="setting-label">
            <h3>Update history</h3>
          </div>
          <ul className="up-history">
            {[...history].reverse().map((entry, i) => (
              <li key={`${entry.version}-${entry.at}-${i}`}>
                <b>{entry.version}</b>
                <small className="view-muted">
                  {entry.outcome === 'installed' ? 'Installed' : entry.outcome === 'rolled-back' ? 'Put back' : 'Failed'} · {when(entry.at)}
                </small>
                {entry.note && <small className="view-muted">{entry.note}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
