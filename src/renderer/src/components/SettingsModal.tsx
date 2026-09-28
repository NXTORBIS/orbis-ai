import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { DefaultBrowserState, Settings, SettingsUpdate, Theme } from '../../../shared/types'
import { MODELS } from '../../../shared/models'

const OfflineGamesSettings = lazy(() => import('./OfflineGamesSettings'))
// A megabyte of licence text: read only when someone asks to see it.
const NoticesPanel = lazy(() => import('./NoticesPanel'))
const UpdateSettings = lazy(() => import('./UpdateSettings'))
const SkillsSettings = lazy(() => import('./SkillsSettings'))
const MemorySettings = lazy(() => import('./MemorySettings'))
const ControlSwitches = lazy(() => import('./ControlSwitches'))
const MotionNote = lazy(() => import('./MotionNote'))
const VoiceSettings = lazy(() => import('./VoiceSettings'))
const AccountPasswordSettings = lazy(() => import('./AccountPasswordSettings'))
const ProfileLockSettings = lazy(() => import('./ProfileLockSettings'))
const TabLockSettings = lazy(() => import('./TabLockSettings'))
const MarketsSettings = lazy(() => import('./MarketsSettings'))

interface Props {
  settings: Settings
  onUpdate(update: SettingsUpdate): Promise<Settings>
  onClose(): void
}

const THEME_OPTIONS: [Theme, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark']
]

type ProfileKey = 'assistantName' | 'userName' | 'userTitle'

export default function SettingsModal({ settings, onUpdate, onClose }: Props): React.JSX.Element {
  const [instructions, setInstructions] = useState(settings.systemPrompt)
  const [noticesOpen, setNoticesOpen] = useState(false)
  const [profile, setProfile] = useState<Record<ProfileKey, string>>({
    assistantName: settings.assistantName,
    userName: settings.userName,
    userTitle: settings.userTitle
  })

  const saveText = (): void => {
    const update: SettingsUpdate = {}
    if (instructions !== settings.systemPrompt) update.systemPrompt = instructions
    for (const key of Object.keys(profile) as ProfileKey[]) {
      if (profile[key] !== settings[key]) update[key] = profile[key]
    }
    if (Object.keys(update).length) void onUpdate(update)
  }

  const close = (): void => {
    saveText()
    onClose()
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })


  const profileField = (key: ProfileKey, label: string, placeholder: string): React.JSX.Element => (
    <label className="field">
      <span>{label}</span>
      <input
        className="hud-input"
        value={profile[key]}
        maxLength={40}
        placeholder={placeholder}
        onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
        onBlur={saveText}
      />
    </label>
  )

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal glass" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-header">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <DefaultBrowserSetting />

          <section className="setting">
            <div className="setting-label">
              <h3>Profile</h3>
              <p>How the assistant is named and how it addresses you.</p>
            </div>
            <div className="field-grid">
              {profileField('assistantName', 'Assistant name', 'Orbis')}
              {profileField('userName', 'Your name', 'NxtOrbis')}
              {profileField('userTitle', 'Address me as', 'Commander')}
            </div>
          </section>

          <Suspense fallback={null}>
            <AccountPasswordSettings userName={settings.userName} />
          </Suspense>

          {/* The three layers in the order they nest: the account password opens the profile, Profile Lock puts the whole
              profile away, and Tab Lock protects single tabs with their own separate passwords. */}
          <Suspense fallback={null}>
            <ProfileLockSettings />
          </Suspense>

          <Suspense fallback={null}>
            <TabLockSettings userName={settings.userName} />
          </Suspense>

          <Suspense fallback={null}>
            <MarketsSettings />
          </Suspense>

          <section className="setting row">
            <div className="setting-label">
              <h3>Default model</h3>
              <p>Used for new chats.</p>
            </div>
            <select className="hud-input" value={settings.defaultModel} onChange={(e) => void onUpdate({ defaultModel: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </section>

          <section className="setting row">
            <div className="setting-label">
              <h3>Visual effects</h3>
              <p>Particles and the animated message box outline, orb, and greeting. Turn off for less motion.</p>
              <Suspense fallback={null}>
                <MotionNote />
              </Suspense>
            </div>
            <Toggle checked={settings.effects} onChange={(v) => void onUpdate({ effects: v })} />
          </section>

          <section className="setting row">
            <div className="setting-label">
              <h3>Web search suggestions</h3>
              <p>As you type in the address bar, ask the search engine and Orion for likely searches. Sends what you type.</p>
            </div>
            <Toggle checked={settings.searchSuggestions} onChange={(v) => void onUpdate({ searchSuggestions: v })} />
          </section>

          <section className="setting row">
            <div className="setting-label">
              <h3>Personalized suggestions</h3>
              <p>Suggest from your browsing history, recent searches, bookmarks and Orion research, and learn which suggestions you pick. Stays on this device.</p>
            </div>
            <Toggle checked={settings.personalizedSuggestions} onChange={(v) => void onUpdate({ personalizedSuggestions: v })} />
          </section>

          <section className="setting row">
            <div className="setting-label">
              <h3>Open browser on launch</h3>
              <p>Start Orbis in its browser, at your browser size, instead of the chat. Use Chat to go back to your conversations.</p>
            </div>
            <Toggle checked={settings.openBrowserOnLaunch} onChange={(v) => void onUpdate({ openBrowserOnLaunch: v })} />
          </section>

          <section className="setting">
            <div className="setting-label">
              <h3>What Orion may do</h3>
              <p>The kinds of thing Orbis may do for you, through Orion, skills, workflows and step-by-step runs. Switching one off hides it from them completely.</p>
            </div>
            <Suspense fallback={null}>
              <ControlSwitches />
            </Suspense>
          </section>

          <section className="setting">
            <div className="setting-label">
              <h3>Voice input</h3>
              <p>The model every microphone in Orbis uses — the chat composer, the address bar, Orbis Search and Browser Orion alike. Runs entirely on this device once downloaded, with no limit and nothing sent anywhere.</p>
            </div>
            <Suspense fallback={null}>
              <VoiceSettings />
            </Suspense>
          </section>

          <section className="setting">
            <div className="setting-label">
              <h3>Memory</h3>
              <p>What you have asked Orbis to remember, for this profile only, kept on this device. Orion is given only the few memories that matter for each message.</p>
            </div>
            <Suspense fallback={null}>
              <MemorySettings />
            </Suspense>
          </section>

          <section className="setting">
            <div className="setting-label">
              <h3>Learned skills</h3>
              <p>Successful step-by-step runs you chose to keep, so Orion can do them again faster. Kept on this device, for this profile only, with no passwords in them.</p>
            </div>
            <Suspense fallback={null}>
              <SkillsSettings />
            </Suspense>
          </section>

          <section className="setting">
            <div className="setting-label">
              <h3>Offline games</h3>
              <p>What the browser shows when a page can't load because of the network, and how the games play. Scores and saved games stay on this device.</p>
            </div>
            <Suspense fallback={null}>
              <OfflineGamesSettings />
            </Suspense>
          </section>

          <section className="setting row">
            <div className="setting-label">
              <h3>Theme</h3>
            </div>
            <Segmented value={settings.theme} options={THEME_OPTIONS} onChange={(v) => void onUpdate({ theme: v })} />
          </section>

          <Suspense fallback={null}>
            <UpdateSettings />
          </Suspense>

          <section className="setting row">
            <div className="setting-label">
              <h3>Licences</h3>
              <p>The licences of everything Orbis is built from.</p>
            </div>
            <button type="button" className="queue-btn" onClick={() => setNoticesOpen(true)}>
              Third-party notices
            </button>
          </section>

          <section className="setting">
            <div className="setting-label">
              <h3>Custom instructions</h3>
              <p>What should the assistant know about you, or how should it respond?</p>
            </div>
            <textarea
              className="hud-input"
              rows={5}
              maxLength={8000}
              value={instructions}
              placeholder="e.g. I'm a Python developer. Keep answers concise."
              onChange={(e) => setInstructions(e.target.value)}
              onBlur={saveText}
            />
          </section>
        </div>
      </div>
      {noticesOpen && (
        <Suspense fallback={null}>
          <NoticesPanel onClose={() => setNoticesOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(value: T): void }): React.JSX.Element {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([option, label]) => (
        <button key={option} role="radio" aria-checked={option === value} className={option === value ? 'selected' : undefined} onClick={() => onChange(option)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange(value: boolean): void }): React.JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

/**
 * Whether Orbis is the browser this computer opens links with.
 *
 * Windows decides this, not Orbis: since Windows 10 an application can register itself as able to open links and can
 * open the page where the choice is made, but it cannot make the choice. So this says what the system says, opens the
 * chooser, and asks the system again afterwards — it never reports a change it has not been told about.
 */
function DefaultBrowserSetting(): React.JSX.Element | null {
  const [state, setState] = useState<DefaultBrowserState | null>(null)
  const [asking, setAsking] = useState(false)

  const look = useCallback(() => void window.api.defaultBrowserState().then(setState), [])

  useEffect(() => {
    look()
    // Coming back to Orbis is when the answer is most likely to have changed.
    const onFocus = (): void => look()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [look])

  if (!state) return null

  const ask = async (): Promise<void> => {
    setAsking(true)
    try {
      setState(await window.api.requestDefaultBrowser())
    } finally {
      setAsking(false)
    }
  }

  return (
    <section className="setting row">
      <div className="setting-label">
        <h3>Default browser</h3>
        <p>{state.isDefault ? 'Links from other apps open in Orbis.' : (state.why ?? 'Links from other apps open somewhere else.')}</p>
      </div>
      <div className="setting-action">
        <span className={`default-browser-state${state.isDefault ? ' on' : ''}`}>{state.isDefault ? 'Orbis is your default browser' : 'Not default browser'}</span>
        {!state.isDefault && state.canAsk && (
          <button type="button" className="queue-btn primary" disabled={asking} onClick={() => void ask()}>
            {asking ? 'Waiting for Windows…' : 'Set Orbis as default'}
          </button>
        )}
      </div>
    </section>
  )
}
