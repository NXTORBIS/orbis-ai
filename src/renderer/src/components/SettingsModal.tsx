import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Settings, SettingsUpdate, Theme } from '../../../shared/types'
import { MODELS } from '../../../shared/models'
import AccountSection from './AccountSection'

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
          <AccountSection />

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
              <h3>Theme</h3>
            </div>
            <Segmented value={settings.theme} options={THEME_OPTIONS} onChange={(v) => void onUpdate({ theme: v })} />
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
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(value: T): void }): React.JSX.Element {
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

function Toggle({ checked, onChange }: { checked: boolean; onChange(value: boolean): void }): React.JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}
