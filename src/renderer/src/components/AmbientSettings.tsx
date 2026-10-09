import { useCallback, useEffect, useState } from 'react'

/**
 * The controls for Ambient Intelligence.
 *
 * ## It can all be switched off, and switching it off means off
 *
 * Not hidden, not quietened: off stops activity being recorded at all. Pausing keeps what is already known but
 * learns nothing new. Both are one press, both are at the top, and neither needs an explanation from the person.
 *
 * ## Clearing is separate from switching off
 *
 * Somebody who clears their activity has not asked to have the feature turned back on, and somebody who turns it
 * off has not asked to lose what it already knew. They are different requests and they have different buttons.
 */

interface Settings {
  enabled: boolean
  paused: boolean
  suggestions: boolean
  showContext: boolean
  continueWhereLeftOff: boolean
  smartTabs: boolean
  relatedFiles: boolean
  contextForOrion: boolean
  sessionMemory: boolean
  contextAwareMusic: boolean
  keepDays: number
}

const SWITCHES: { key: keyof Settings; label: string; blurb: string }[] = [
  { key: 'contextForOrion', label: 'Let Orion know what you are working on', blurb: 'A sentence or two about the subject, never your history or the page text.' },
  { key: 'showContext', label: 'Show what you are working on', blurb: 'The small word in the bar at the top. Hidden whenever Orbis is not sure.' },
  { key: 'continueWhereLeftOff', label: 'Offer to pick things back up', blurb: 'When you come back to something you spent real time on and did not finish.' },
  { key: 'sessionMemory', label: 'Remember what you did', blurb: 'A title and some counts for each stretch of work, so "what was I doing yesterday" has an answer.' },
  { key: 'relatedFiles', label: 'Point out files of yours', blurb: 'When one of your own files is about what you are reading.' },
  { key: 'suggestions', label: 'Suggest things unprompted', blurb: 'Off by default. Orbis will not interrupt you unless you turn this on.' },
  { key: 'smartTabs', label: 'Notice when tabs are related', blurb: 'Offers to group them. Never moves or closes anything by itself.' },
  { key: 'contextAwareMusic', label: 'Let it choose music to suit', blurb: 'Off by default. Music never changes by itself unless you turn this on.' }
]

export default function AmbientSettings({ onNotify }: { onNotify?(message: string): void }): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    const one = (await window.api.ambient('settings').catch(() => null)) as Settings | null
    setSettings(one)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (patch: Partial<Settings>): Promise<void> => {
    const next = (await window.api.ambient('save-settings', patch).catch(() => null)) as Settings | null
    if (next) setSettings(next)
  }

  const clear = async (): Promise<void> => {
    const out = (await window.api.ambient('clear').catch(() => null)) as { activity: number; sessions: number } | null
    setConfirming(false)
    await load()
    // Said as what happened, with numbers, rather than as "done".
    onNotify?.(out ? `Forgotten: ${out.activity} activities and ${out.sessions} sessions.` : 'Nothing could be cleared.')
  }

  if (!settings) return <p className="setting-note">Loading…</p>

  const off = !settings.enabled

  return (
    <div className="ambient-settings">
      <label className="setting-check">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
        <span>
          <strong>Understand what I am working on</strong>
          <small>
            Orbis notices what you open and works out the subject, so Orion and search can be more useful. Everything
            stays on this computer, and nothing is recorded on a sign-in, payment or banking page, or in a private tab.
          </small>
        </span>
      </label>

      <label className="setting-check">
        <input type="checkbox" checked={settings.paused} disabled={off} onChange={(e) => void save({ paused: e.target.checked })} />
        <span>
          <strong>Pause for now</strong>
          <small>Keeps what it already knows and stops learning anything new. Browsing is unaffected.</small>
        </span>
      </label>

      <div className={`ambient-switches${off || settings.paused ? ' dimmed' : ''}`}>
        {SWITCHES.map((one) => (
          <label className="setting-check" key={one.key}>
            <input
              type="checkbox"
              checked={settings[one.key] === true}
              disabled={off || settings.paused}
              onChange={(e) => void save({ [one.key]: e.target.checked } as Partial<Settings>)}
            />
            <span>
              <strong>{one.label}</strong>
              <small>{one.blurb}</small>
            </span>
          </label>
        ))}
      </div>

      <label className="setting-field">
        <span>Keep activity for</span>
        <select value={String(settings.keepDays)} disabled={off} onChange={(e) => void save({ keepDays: Number(e.target.value) })}>
          <option value="7">a week</option>
          <option value="30">a month</option>
          <option value="90">three months</option>
        </select>
        <small>What it made of your activity — the subjects and the counts — is kept longer than the activity itself.</small>
      </label>

      {confirming ? (
        <div className="setting-confirm">
          <p>Forget everything Ambient Intelligence has learned? Your history, bookmarks, notes and files are not touched.</p>
          <div className="setting-row">
            <button type="button" className="hud-btn danger" onClick={() => void clear()}>
              Forget it all
            </button>
            <button type="button" className="hud-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="hud-btn" onClick={() => setConfirming(true)}>
          Clear what Orbis has learned
        </button>
      )}
    </div>
  )
}
