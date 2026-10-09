import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AVATARS, DEFAULT_AVATAR, avatarStyle } from '../../../shared/avatars'
import { useFocusTrap } from '../lib/useFocusTrap'
import { Gamepad2, Globe, Info, Lock, Mic, Palette, Search, Sparkles, User, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DefaultBrowserState, Settings, SettingsUpdate, Theme } from '../../../shared/types'
import { MODELS } from '../../../shared/models'
import ResearchSourceSettings from './ResearchSourceSettings'
import {
  cleanSectionId,
  findSections,
  SETTINGS_SECTIONS,
  type SettingsSectionId
} from '../../../shared/settingsSections'

const OfflineGamesSettings = lazy(() => import('./OfflineGamesSettings'))
const NotificationSettings = lazy(() => import('./NotificationSettings'))
const AmbientSettings = lazy(() => import('./AmbientSettings'))
// A megabyte of licence text: read only when someone asks to see it.
const NoticesPanel = lazy(() => import('./NoticesPanel'))
const UpdateSettings = lazy(() => import('./UpdateSettings'))
const SkillsSettings = lazy(() => import('./SkillsSettings'))
const MemorySettings = lazy(() => import('./MemorySettings'))
const ControlSwitches = lazy(() => import('./ControlSwitches'))
const MotionNote = lazy(() => import('./MotionNote'))
const VoiceSettings = lazy(() => import('./VoiceSettings'))
const AccountPasswordSettings = lazy(() => import('./AccountPasswordSettings'))
const TransferSettings = lazy(() => import('./TransferSettings'))
const ProfileLockSettings = lazy(() => import('./ProfileLockSettings'))
const TabLockSettings = lazy(() => import('./TabLockSettings'))
const MarketsSettings = lazy(() => import('./MarketsSettings'))
const RecallSettings = lazy(() => import('./RecallSettings'))
// Customize and Profiles were rows in the feature dropdown, which made how Orbis looks and who is using it into two
// screens you navigated to rather than two settings. They are settings, so they are in Settings.
const CustomizeView = lazy(() => import('./CustomizeView'))
const ProfilesView = lazy(() => import('./ProfilesView'))

interface Props {
  settings: Settings
  onUpdate(update: SettingsUpdate): Promise<Settings>
  onClose(): void
  /**
   * Which section to open at.
   *
   * The whole point of the restructure: the account chip opens Account, the lock button opens Security, and `Ctrl+,`
   * opens where it was left. Before this, all five ways in landed at the top of one scroll and you looked for what you
   * wanted from there.
   */
  section?: SettingsSectionId
}

const THEME_OPTIONS: [Theme, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark']
]

type ProfileKey = 'assistantName' | 'userName' | 'userTitle'

/** The registry names an icon; the window is what knows which drawing that is. */
const ICONS: Record<string, LucideIcon> = {
  user: User,
  lock: Lock,
  sparkles: Sparkles,
  globe: Globe,
  palette: Palette,
  mic: Mic,
  gamepad: Gamepad2,
  info: Info
}

export default function SettingsModal({ settings, onUpdate, onClose, section }: Props): React.JSX.Element {
  // The keyboard stays in the dialog while it is open, and goes back where it was afterwards.
  const settingsRef = useRef<HTMLDivElement>(null)
  useFocusTrap(settingsRef, true)
  const [instructions, setInstructions] = useState(settings.systemPrompt)
  const [noticesOpen, setNoticesOpen] = useState(false)
  const [active, setActive] = useState<SettingsSectionId>(() => cleanSectionId(section))
  const [query, setQuery] = useState('')
  const [profile, setProfile] = useState<Record<ProfileKey, string>>({
    assistantName: settings.assistantName,
    userName: settings.userName,
    userTitle: settings.userTitle
  })
  const body = useRef<HTMLDivElement | null>(null)
  const search = useRef<HTMLInputElement | null>(null)

  const saveText = useCallback((): void => {
    const update: SettingsUpdate = {}
    if (instructions !== settings.systemPrompt) update.systemPrompt = instructions
    for (const key of Object.keys(profile) as ProfileKey[]) {
      if (profile[key] !== settings[key]) update[key] = profile[key]
    }
    if (Object.keys(update).length) void onUpdate(update)
  }, [instructions, profile, settings, onUpdate])

  const close = useCallback((): void => {
    saveText()
    onClose()
  }, [saveText, onClose])

  /** Opening a section starts it at the top, rather than wherever the previous one had been scrolled to. */
  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [active])

  /** Asked to open somewhere specific after it is already open — the lock button while Settings is showing. */
  useEffect(() => {
    if (section) setActive(cleanSectionId(section))
  }, [section])

  const shown = useMemo(() => findSections(query), [query])

  /**
   * A search narrows the list, and moves to the best match.
   *
   * Without this, typing "password" would leave Security highlighted in the list and Account still on screen, which
   * makes the search look broken. It only moves while there is something to move to, so backspacing to nothing leaves
   * you where you are rather than throwing you back to the first section.
   */
  useEffect(() => {
    if (query.trim() && shown.length > 0 && !shown.some((one) => one.id === active)) setActive(shown[0].id)
  }, [query, shown, active])

  /**
   * Getting around without the mouse.
   *
   * Escape closes, or clears the search first when there is one, because that is far more often what was meant. Up
   * and down move through the list of sections. The slash key jumps to the search box, so finding a setting by name
   * never needs the mouse either.
   *
   * The check on what is being typed into is the whole difficulty here. Settings is full of boxes — names, custom
   * instructions, every password panel — and the instructions box is several lines tall. Inside one of those, up and
   * down have to move the cursor and a slash has to type a slash; a shortcut that steals either would make the boxes
   * unusable. So the arrows are read everywhere except a box that holds text, with the search box itself the
   * deliberate exception, because moving through the results while still typing is the point of it. The slash is
   * read only when nothing at all is being typed into.
   *
   * The search box is not given the cursor when Settings opens, for the same reason: if it had the cursor, slash
   * would simply type a slash and the shortcut would never work.
   *
   * And once somebody has tabbed into the section on the right, the arrows go back to being the arrows: they scroll
   * what is in front of them. Changing the section out from under somebody who is working inside it would be the
   * shortcut taking something away rather than adding something.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const inSearch = target === search.current
      const tag = target?.tagName
      const typing = !inSearch && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true)
      const inSection = target !== null && body.current !== null && body.current.contains(target)

      if (e.key === 'Escape') {
        // Innermost thing first. The licences open on top of Settings, so Escape should put them away and leave
        // Settings where it was, rather than closing both and losing the section somebody was reading.
        if (noticesOpen) setNoticesOpen(false)
        else if (query) setQuery('')
        else close()
        return
      }

      // Nothing else reaches past the licences: moving the section behind them would be a change nobody could see.
      if (noticesOpen) return

      if (e.key === '/' && !typing && !inSearch && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        search.current?.focus()
        search.current?.select()
        return
      }

      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing && !inSection && shown.length > 0) {
        e.preventDefault()
        const at = shown.findIndex((one) => one.id === active)
        const step = e.key === 'ArrowDown' ? 1 : -1
        // Stops at either end rather than wrapping round. Eight sections that loop are eight you can lose your
        // place in: pressing down twice too often puts you back at the top with no sign that anything happened.
        const next = Math.min(shown.length - 1, Math.max(0, (at < 0 ? 0 : at) + step))
        setActive(shown[next].id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [query, close, shown, active, noticesOpen])

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

  const current = SETTINGS_SECTIONS.find((one) => one.id === active) ?? SETTINGS_SECTIONS[0]

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal glass set-modal" ref={settingsRef} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-header">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div className="set-split">
          {/* Where everything is. Eight names instead of thirty-one blocks in one scroll. */}
          <nav className="set-nav" aria-label="Settings sections">
            <div className="set-search">
              <Search size={13} />
              <input
                ref={search}
                type="search"
                value={query}
                placeholder="Search settings"
                aria-label="Search settings"
                // Said rather than left to be discovered. The arrows and the slash key work whether anybody reads
                // this or not, but a shortcut nobody knows about is a shortcut nobody has.
                title="Press / to search, up and down to move between sections"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {shown.length === 0 ? (
              <p className="set-none">Nothing matches “{query.trim()}”.</p>
            ) : (
              <ul>
                {shown.map((one) => {
                  const Icon = ICONS[one.icon] ?? Info
                  return (
                    <li key={one.id}>
                      <button
                        type="button"
                        className={one.id === active ? 'is-on' : undefined}
                        aria-current={one.id === active ? 'page' : undefined}
                        onClick={() => setActive(one.id)}
                      >
                        <Icon size={15} />
                        <span>{one.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </nav>

          <div className="modal-body set-body" ref={body}>
            <header className="set-head">
              <h3>{current.label}</h3>
              <p>{current.blurb}</p>
            </header>

            {/* ---------------------------------------------------------------- Account */}
            {active === 'account' && (
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

                {/*
                  The same twelve as the setup screen, for everybody who is already set up.
                  Without this the picture could only ever be chosen once, on a screen that an existing account
                  never sees again -- which would make the whole thing invisible to every person already using
                  Orbis. Saved the moment one is pressed: there is nothing to confirm about a picture.
                */}
                <div className="setting-label" style={{ marginTop: 18 }}>
                  <h3>Your picture</h3>
                  <p>Shown beside your name, and on your messages.</p>
                </div>
                <div className="setting-faces" role="radiogroup" aria-label="Your picture">
                  {AVATARS.map((one) => {
                    const chosen = one.id === (settings.userAvatar || DEFAULT_AVATAR)
                    return (
                      <button
                        key={one.id}
                        type="button"
                        role="radio"
                        aria-checked={chosen}
                        aria-label={one.name}
                        title={one.name}
                        className={`setting-face${chosen ? ' is-chosen' : ''}`}
                        style={avatarStyle(one.id)}
                        onClick={() => void onUpdate({ userAvatar: one.id })}
                      />
                    )
                  })}
                </div>
              </section>
            )}

            {active === 'account' && (
              <Suspense fallback={null}>
                <ProfilesView embedded />
              </Suspense>
            )}

            {/* ---------------------------------------------------------------- Security
                The four layers together, in the order they nest: the account password opens the profile, Profile Lock
                puts the whole profile away, Tab Lock protects single tabs with their own separate passwords, and the
                transfer package is a fourth password for a profile that has left this computer. They were scattered
                through the old scroll with unrelated settings between them, which made layers look unrelated. */}
            {active === 'security' && (
              <Suspense fallback={null}>
                <AccountPasswordSettings userName={settings.userName} />
                <ProfileLockSettings />
                <TabLockSettings userName={settings.userName} />
                <TransferSettings userName={settings.userName} />
              </Suspense>
            )}

            {/* ---------------------------------------------------------------- Orion */}
            {active === 'orion' && (
              <>
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
                    <h3>What you are working on</h3>
                    <p>
                      Orbis can notice what you open and work out the subject, so Orion already knows what "this"
                      means and search knows what matters. It all stays on this computer.
                    </p>
                  </div>
                  <Suspense fallback={null}>
                    <AmbientSettings />
                  </Suspense>
                </section>

                <section className="setting">
                  <div className="setting-label">
                    <h3>Custom instructions</h3>
                    <p>What should the assistant know about you, or how should it respond?</p>
                  </div>
                  <textarea
                    className="hud-input"
                    aria-label="What Orion should know about you"
                    rows={5}
                    maxLength={8000}
                    value={instructions}
                    placeholder="e.g. I'm a Python developer. Keep answers concise."
                    onChange={(e) => setInstructions(e.target.value)}
                    onBlur={saveText}
                  />
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
              </>
            )}

            {/* ---------------------------------------------------------------- Browsing */}
            {active === 'browsing' && (
              <>
                <DefaultBrowserSetting />

                <section className="setting row">
                  <div className="setting-label">
                    <h3>Show the research plan first</h3>
                    <p>Research says what it is about to search for and waits, so you can change it. Off, it starts straight away.</p>
                  </div>
                  <Toggle checked={settings.showResearchPlan} onChange={(v) => void onUpdate({ showResearchPlan: v })} />
                </section>

                {/* Which sources research uses. A preference orders what was found; blocking is the only absolute. */}
                <section className="setting">
                  <div className="setting-label">
                    <h3>Sources research uses</h3>
                  </div>
                  <ResearchSourceSettings settings={settings} onChange={(update) => void onUpdate(update)} />
                </section>

                <section className="setting row">
                  <div className="setting-label">
                    <h3>Open browser on launch</h3>
                    <p>Start Orbis in its browser, at your browser size, instead of the chat. Use Chat to go back to your conversations.</p>
                  </div>
                  <Toggle checked={settings.openBrowserOnLaunch} onChange={(v) => void onUpdate({ openBrowserOnLaunch: v })} />
                </section>

                {/*
                  The two settings that decide whether a schedule actually happens.

                  Both are off to begin with, and both say what they do not do. Orbis has no server, so a schedule
                  needs this computer: these narrow that as far as a program on your own machine can, and no further.
                */}
                <section className="setting row">
                  <div className="setting-label">
                    <h3>Keep schedules running when you close Orbis</h3>
                    <p>
                      Orbis stays running with no window while something is scheduled, so closing the window stops the
                      window rather than the clock. There is a tray icon with a way to quit, and Orbis quits by itself
                      once nothing is scheduled.
                    </p>
                  </div>
                  <Toggle checked={settings.keepSchedulesRunning} onChange={(v) => void onUpdate({ keepSchedulesRunning: v })} />
                </section>

                <section className="setting row">
                  <div className="setting-label">
                    <h3>Wake this computer for a schedule</h3>
                    <p>
                      Windows wakes a sleeping computer for the next thing due, then lets it sleep again. It cannot
                      wake a computer that is fully switched off, and wake timers are often off while a laptop is on
                      battery — in either case Orbis does it the next time you open it, and says how late it was.
                    </p>
                  </div>
                  <Toggle checked={settings.wakeForSchedules} onChange={(v) => void onUpdate({ wakeForSchedules: v })} />
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
                    <h3>Visual Search</h3>
                    <p>
                      Hold Ctrl and drag over anything on a page to ask Orion about what you selected. The part you select is sent to the service that can
                      look at an image; nothing is sent until you ask.
                    </p>
                  </div>
                  <Toggle checked={settings.visualSearch !== false} onChange={(v) => void onUpdate({ visualSearch: v })} />
                </section>

                <section className="setting row">
                  <div className="setting-label">
                    <h3>Personalized suggestions</h3>
                    <p>Suggest from your browsing history, recent searches, bookmarks and Orion research, and learn which suggestions you pick. Stays on this device.</p>
                  </div>
                  <Toggle checked={settings.personalizedSuggestions} onChange={(v) => void onUpdate({ personalizedSuggestions: v })} />
                </section>

                {/* Everything in the reading index came from browsing, so the switch for it belongs beside the rest
                    of the browsing settings. Searching it is the browser panel's job. */}
                <Suspense fallback={null}>
                  <RecallSettings />
                </Suspense>

                <Suspense fallback={null}>
                  <MarketsSettings />
                </Suspense>
              </>
            )}

            {/* ---------------------------------------------------------------- Notifications
                What Orbis interrupts you for, when it stays quiet, whether it works, and what it has told you. */}
            {active === 'notifications' && (
              <Suspense fallback={null}>
                <NotificationSettings />
              </Suspense>
            )}

            {/* ---------------------------------------------------------------- Appearance
                Theme and Visual effects, together. They were nine items apart in the old scroll. */}
            {active === 'appearance' && (
              <>
                <section className="setting row">
                  <div className="setting-label">
                    <h3>Theme</h3>
                  </div>
                  <Segmented value={settings.theme} options={THEME_OPTIONS} onChange={(v) => void onUpdate({ theme: v })} />
                </section>

                <Suspense fallback={null}>
                  <CustomizeView embedded />
                </Suspense>

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
              </>
            )}

            {/* ---------------------------------------------------------------- Voice */}
            {active === 'voice' && (
              <section className="setting">
                <div className="setting-label">
                  <h3>Orbis Pulsar</h3>
                  <p>Speech to text, behind every microphone in Orbis — the chat composer, the address bar, Orbis Search and Browser Orion alike. Runs entirely on this device once downloaded, with no limit and nothing sent anywhere.</p>
                </div>
                <Suspense fallback={null}>
                  <VoiceSettings />
                </Suspense>
              </section>
            )}

            {/* ---------------------------------------------------------------- Games */}
            {active === 'games' && (
              <section className="setting">
                <div className="setting-label">
                  <h3>Offline games</h3>
                  <p>What the browser shows when a page can&apos;t load because of the network, and how the games play. Scores and saved games stay on this device.</p>
                </div>
                <Suspense fallback={null}>
                  <OfflineGamesSettings />
                </Suspense>
              </section>
            )}

            {/* ---------------------------------------------------------------- About */}
            {active === 'about' && (
              <>
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
              </>
            )}
          </div>
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
