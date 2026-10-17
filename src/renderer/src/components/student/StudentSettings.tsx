import { useEffect, useState } from 'react'
import { AlertTriangle, Download, ShieldCheck, Sparkles } from 'lucide-react'
import Orbi, { wearable } from './Orbi'
import { atmosphere } from './atmosphere'
import { STYLES as CHARACTER_STYLES, styleFor } from '../../../../shared/student/orbiCharacter'
import type { Call, Catalogue } from './useStudent'
import { useSurface } from '../../lib/surfaces'
import { studentSettingsSurface } from './studentSurfaces'
import type { ContentCategory, StudentSnapshot } from '../../../../shared/student/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * Student Settings.
 *
 * Grouped, so somebody looking for one thing is not reading a wall. Three of the groups exist because of promises
 * made elsewhere in the feature and have to be kept honest here:
 *
 *   - **Safety** says what the age protection is doing, in words, and lets it be made stricter or turned off. It
 *     never changes by itself.
 *   - **Privacy** lists what is stored, in plain language, and every category has a way to delete it. Nothing is
 *     sent anywhere, and that is stated rather than implied.
 *   - **Sound** keeps four volumes apart, because music, atmosphere, the interface and Orbi's voice are four
 *     different reasons to want quiet.
 */

/** Whole hours, written the way a clock is read rather than as a number between 0 and 23. */
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const clockHour = (hour: number): string =>
  hour === 0 ? 'midnight' : hour === 12 ? 'midday' : hour < 12 ? `${hour}am` : `${hour - 12}pm`

const SECTIONS = ['you', 'safety', 'focus', 'orbi', 'learning', 'sound', 'notifications', 'accessibility', 'privacy'] as const
type Section = (typeof SECTIONS)[number]

const TITLES: Record<Section, string> = {
  you: 'You',
  safety: 'Safety',
  focus: 'Focus',
  orbi: 'Orbi',
  learning: 'Learning',
  sound: 'Sound',
  notifications: 'Notifications',
  accessibility: 'Accessibility',
  privacy: 'Privacy and data'
}

const CATEGORIES: ContentCategory[] = ['social', 'entertainment', 'streaming', 'gaming', 'shopping', 'news', 'communication', 'unknown']

export default function StudentSettings({
  snapshot,
  catalogue,
  call,
  onNotify,
  onTour
}: {
  snapshot: StudentSnapshot
  catalogue: Catalogue | null
  call: Call
  onNotify(message: string, kind?: NoticeKind): void
  /** Starts Orbi's tour again. Given by the view, because only the view can navigate the real screens. */
  onTour?(fromStart?: boolean): void
}): React.JSX.Element {
  const prefs = snapshot.preferences
  const [section, setSection] = useState<Section>('you')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const save = async (patch: Record<string, unknown>): Promise<void> => {
    await call('save-settings', patch)
  }

  useEffect(() => {
    // Previewing a sound stops when the page is left, so nothing is left playing.
    return () => atmosphere().stopAll()
  }, [])

  const tryOut = (id: string): void => {
    const engine = atmosphere()
    if (preview === id) {
      engine.stopAll()
      setPreview(null)
      return
    }
    engine.setVolume(prefs.volumes.atmosphere)
    engine.stopAll()
    if (engine.play(id, 1)) setPreview(id)
    else onNotify(catalogue?.sounds.find((one) => one.id === id)?.unavailable ?? 'That one needs a recording Orbis does not have.', 'warn')
  }

  const reset = async (scope: string): Promise<void> => {
    await call('reset', scope)
    setConfirming(null)
    onNotify('Done.')
  }

  /*
   * What this page lets Orbis read and set.
   *
   * Every setter is the same `save-settings` the fields on screen call, so a value Orbis writes goes through the same
   * reading rules -- and a bad one is pulled back into range in exactly one place. What it offers is in
   * `studentSurfaces.ts`, where each control's type and range is read from `patchPreferences` rather than written out
   * a second time.
   */
  useSurface(
    studentSettingsSurface({
      snapshot: () => snapshot,
      save,
      section: () => section,
      openSection: (id) => setSection(id as Section),
      sections: SECTIONS,
      atmospheres: catalogue?.atmospheres.map((one) => ({ id: one.id, label: one.label })) ?? [],
      reset,
      check: () => call<StudentSnapshot | null>('snapshot')
    })
  )

  const exportAll = async (): Promise<void> => {
    const data = await call<unknown>('export')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `orbis-student-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    onNotify('Saved to your downloads.')
  }

  return (
    <div className="st-settings">
      <header className="st-section-head">
        <div>
          <h2>Student Settings</h2>
          <p className="st-faint">Everything here is for this profile only.</p>
        </div>
      </header>

      <div className="st-split">
        <nav className="st-settings-nav" aria-label="Settings sections">
          {SECTIONS.map((one) => (
            <button
              key={one}
              type="button"
              className={`st-nav-row${section === one ? ' on' : ''}`}
              aria-current={section === one}
              /*
               * The tour points at these rather than at the headings inside each section.
               *
               * A heading only exists while its section is open, so a tour step aiming at one would be skipped on
               * every profile that had not already opened it -- which is every profile the tour runs on. The nav
               * is always here, and "this is where you turn me down" is the thing worth showing anyway.
               */
              data-tour={one === 'notifications' ? 'settings-notices' : one === 'orbi' ? 'settings-orbi' : one === 'sound' ? 'settings-sound' : undefined}
              onClick={() => setSection(one)}
            >
              {TITLES[one]}
            </button>
          ))}
        </nav>

        <div className="st-settings-body">
          {section === 'you' ? (
            <>
              <h3>You</h3>
              <label className="st-field">
                <span>Name</span>
                <input defaultValue={prefs.name} onBlur={(e) => void save({ name: e.target.value })} placeholder="Your name" />
              </label>
              <label className="st-field">
                <span>Why you are doing this</span>
                <input defaultValue={prefs.why} onBlur={(e) => void save({ why: e.target.value })} placeholder="I want to actually understand physics" />
                <small>Shown rarely, and only when it might help.</small>
              </label>
              <label className="st-field">
                <span>How motivation should sound</span>
                <select value={prefs.motivationStyle} onChange={(e) => void save({ motivationStyle: e.target.value })}>
                  <option value="calm">Calm</option>
                  <option value="goal">Goal-driven</option>
                  <option value="energetic">Energetic</option>
                  <option value="academic">Academic</option>
                  <option value="self-competition">Beat my own records</option>
                  <option value="minimal">As little as possible</option>
                </select>
              </label>
            </>
          ) : null}

          {section === 'safety' ? (
            <>
              <h3>Safety</h3>
              <p className="st-note">
                <ShieldCheck size={15} aria-hidden />
                <span>
                  Browsing protection is worked out from the date of birth on this profile, on this computer. The date is never sent anywhere and is not used for anything else.
                </span>
              </p>
              <label className="st-field">
                <span>Date of birth</span>
                <input type="date" defaultValue={prefs.dob ?? ''} max={new Date().toISOString().slice(0, 10)} onBlur={(e) => void save({ dob: e.target.value || null })} />
                <small>
                  {prefs.dob ? `Currently set for: ${catalogue?.bands[snapshot.band] ?? snapshot.band}` : 'Not set. Orbis holds back the things that have an age on them by law and allows the rest.'}
                </small>
              </label>
              <label className="st-field">
                <span>How strict</span>
                <select value={prefs.safetyOverride} onChange={(e) => void save({ safetyOverride: e.target.value })}>
                  <option value="age">Follow the age on this profile</option>
                  <option value="strict">Stricter than the age</option>
                  <option value="off">Off — the browser decides</option>
                </select>
              </label>
              <label className="st-field">
                <span>Always allowed</span>
                <textarea
                  defaultValue={prefs.approvedSites.join('\n')}
                  rows={4}
                  onBlur={(e) => void save({ approvedSites: e.target.value.split('\n').map((one) => one.trim()).filter(Boolean) })}
                  placeholder={'ncert.nic.in\nclassroom.google.com'}
                />
                <small>One per line. These open whatever else is held back.</small>
              </label>
              <label className="st-field">
                <span>Never allowed</span>
                <textarea
                  defaultValue={prefs.blockedSites.join('\n')}
                  rows={3}
                  onBlur={(e) => void save({ blockedSites: e.target.value.split('\n').map((one) => one.trim()).filter(Boolean) })}
                />
              </label>
            </>
          ) : null}

          {section === 'focus' ? (
            <>
              <h3>Focus</h3>
              <div className="st-row">
                <label className="st-field">
                  <span>Default length</span>
                  <input type="number" min={5} max={300} step={5} defaultValue={prefs.defaultMinutes} onBlur={(e) => void save({ defaultMinutes: Number(e.target.value) })} />
                </label>
                <label className="st-field">
                  <span>Default strictness</span>
                  <select value={prefs.defaultLevel} onChange={(e) => void save({ defaultLevel: e.target.value })}>
                    <option value="light">Light</option>
                    <option value="focus">Focus</option>
                    <option value="deep">Deep Focus</option>
                  </select>
                </label>
              </div>
              <fieldset className="st-field">
                <legend>Held back during a session, by default</legend>
                <div className="st-pills">
                  {CATEGORIES.map((one) => {
                    const on = prefs.blockedCategories.includes(one)
                    return (
                      <button
                        key={one}
                        type="button"
                        className={`st-pill${on ? ' on' : ''}`}
                        aria-pressed={on}
                        onClick={() => void save({ blockedCategories: on ? prefs.blockedCategories.filter((x) => x !== one) : [...prefs.blockedCategories, one] })}
                      >
                        {catalogue?.categories[one] ?? one}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <label className="st-field">
                <span>Video during a session</span>
                <select value={prefs.youtube} onChange={(e) => void save({ youtube: e.target.value })}>
                  <option value="open">Open as usual</option>
                  <option value="educational">Feeds held back, a video you go to directly opens</option>
                  <option value="approved-only">Only videos you approved</option>
                  <option value="blocked">Held back entirely</option>
                </select>
              </label>
              <label className="st-check">
                <input type="checkbox" checked={prefs.exitConfirmation} onChange={(e) => void save({ exitConfirmation: e.target.checked })} />
                <span>
                  <strong>Ask before ending a session early</strong>
                  <small>A locked session always asks, whatever this says. You can always close Orbis.</small>
                </span>
              </label>
              <label className="st-field">
                <span>Default atmosphere</span>
                <select value={prefs.defaultAtmosphere ?? ''} onChange={(e) => void save({ defaultAtmosphere: e.target.value || null })}>
                  <option value="">None</option>
                  {(catalogue?.atmospheres ?? []).map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="st-field">
                <span>Music when a session starts</span>
                <select value={prefs.musicOnFocus} onChange={(e) => void save({ musicOnFocus: e.target.value })}>
                  <option value="off">Don&apos;t involve music</option>
                  <option value="suggest">Suggest a playlist</option>
                  <option value="auto">Start my study playlist</option>
                </select>
              </label>
            </>
          ) : null}

          {section === 'orbi' ? (
            <>
              <h3>Orbi</h3>
              {/* Shown round again, from the beginning, on the real screens. */}
              {onTour ? (
                <div className="st-row-actions">
                  <button type="button" className="st-btn" onClick={() => void save({ tourAt: null, tourDone: false }).then(() => onTour(true))}>
                    <Sparkles size={15} aria-hidden /> Meet Orbi again
                  </button>
                  {prefs.tourAt ? (
                    <button type="button" className="st-btn quiet" onClick={() => onTour()}>
                      Carry on from where you stopped
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="st-orbi-preview">
                <Orbi state="ready" behaviour={prefs.orbi} reducedMotion={prefs.reducedMotion} worn={snapshot.orbi.worn} size={110} />
                <div>
                  <strong>
                    {snapshot.orbi.name} · level {snapshot.orbi.level}
                  </strong>
                  <p className="st-faint">{snapshot.orbi.unlocked.length} things unlocked</p>
                </div>
              </div>
              <label className="st-check">
                <input type="checkbox" checked={prefs.orbi.enabled} onChange={(e) => void save({ orbi: { ...prefs.orbi, enabled: e.target.checked } })} />
                <span>
                  <strong>Show Orbi</strong>
                  <small>Everything else about Student works exactly the same without it.</small>
                </span>
              </label>
              <div className="st-row">
                <label className="st-field">
                  <span>How much it says</span>
                  <select value={prefs.orbi.messages} onChange={(e) => void save({ orbi: { ...prefs.orbi, messages: e.target.value } })}>
                    <option value="normal">Normally</option>
                    <option value="rare">Rarely</option>
                    <option value="off">Nothing at all</option>
                  </select>
                </label>
                <label className="st-field">
                  <span>Personality</span>
                  <select value={prefs.orbi.personality} onChange={(e) => void save({ orbi: { ...prefs.orbi, personality: e.target.value } })}>
                    {Object.values(CHARACTER_STYLES).map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.name}
                      </option>
                    ))}
                    {/*
                      * The older names, kept selectable so a profile that has one does not show an empty box.
                      * Each maps to one of the six above, so choosing it changes nothing surprising.
                      */}
                    {['calm', 'energetic', 'playful'].includes(prefs.orbi.personality) ? (
                      <option value={prefs.orbi.personality}>{prefs.orbi.personality}</option>
                    ) : null}
                  </select>
                  <small>{styleFor(prefs.orbi.personality).blurb}</small>
                </label>
              </div>
              <div className="st-row">
                <label className="st-field">
                  <span>Size</span>
                  <select value={prefs.orbi.size} onChange={(e) => void save({ orbi: { ...prefs.orbi, size: e.target.value } })}>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </label>
                <label className="st-field">
                  <span>Movement</span>
                  <select value={prefs.orbi.animation} onChange={(e) => void save({ orbi: { ...prefs.orbi, animation: e.target.value } })}>
                    <option value="full">Full</option>
                    <option value="reduced">Less</option>
                    <option value="off">Still</option>
                  </select>
                </label>
              </div>
              <label className="st-field">
                <span>Celebrations</span>
                <select value={prefs.orbi.celebration} onChange={(e) => void save({ orbi: { ...prefs.orbi, celebration: e.target.value } })}>
                  <option value="full">Full</option>
                  <option value="subtle">Subtle</option>
                  <option value="off">None</option>
                </select>
              </label>
              {wearable(snapshot.orbi.unlocked).length > 0 ? (
                <fieldset className="st-field">
                  <legend>What Orbi is wearing</legend>
                  <div className="st-pills">
                    {wearable(snapshot.orbi.unlocked).map((id) => {
                      const on = snapshot.orbi.worn.includes(id)
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`st-pill${on ? ' on' : ''}`}
                          aria-pressed={on}
                          onClick={() => void call('save-orbi', { worn: on ? snapshot.orbi.worn.filter((x) => x !== id) : [...snapshot.orbi.worn, id] })}
                        >
                          {catalogue?.cosmetics.find((one) => one.id === id)?.label ?? id}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              ) : (
                <p className="st-faint">Things to wear and put in Orbi&apos;s room unlock as you study. Nothing important is ever behind one.</p>
              )}
            </>
          ) : null}

          {section === 'learning' ? (
            <>
              <h3>Learning</h3>
              <label className="st-field">
                <span>How hard</span>
                <select value={prefs.difficulty} onChange={(e) => void save({ difficulty: e.target.value })}>
                  <option value="beginner">Easier</option>
                  <option value="intermediate">Middling</option>
                  <option value="advanced">Harder</option>
                </select>
                <small>Quizzes follow how you are actually doing, within one step of this.</small>
              </label>
              <label className="st-check">
                <input type="checkbox" checked={prefs.learningReminders} onChange={(e) => void save({ learningReminders: e.target.checked })} />
                <span>
                  <strong>Tell me when something is due for review</strong>
                </span>
              </label>
            </>
          ) : null}

          {section === 'sound' ? (
            <>
              <h3>Sound</h3>
              {(['music', 'atmosphere', 'ui', 'orbi'] as const).map((which) => (
                <label key={which} className="st-field">
                  <span>{which === 'ui' ? 'Interface sounds' : which === 'orbi' ? "Orbi's voice" : which[0].toUpperCase() + which.slice(1)}</span>
                  <div className="st-minutes">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      defaultValue={prefs.volumes[which]}
                      onChange={(e) => {
                        if (which === 'atmosphere') atmosphere().setVolume(Number(e.target.value))
                      }}
                      onBlur={(e) => void save({ volumes: { ...prefs.volumes, [which]: Number(e.target.value) } })}
                      aria-label={`${which} volume`}
                    />
                    <strong>{Math.round(prefs.volumes[which] * 100)}%</strong>
                  </div>
                </label>
              ))}
              <h4>Atmosphere</h4>
              <ul className="st-sounds">
                {(catalogue?.sounds ?? []).map((one) => (
                  <li key={one.id} className={one.needsFile ? 'off' : ''}>
                    <div>
                      <strong>{one.label}</strong>
                      <span className="st-faint small">{one.needsFile ? one.unavailable : one.blurb}</span>
                    </div>
                    <button type="button" className="st-btn" disabled={one.needsFile} aria-pressed={preview === one.id} onClick={() => tryOut(one.id)}>
                      {preview === one.id ? 'Stop' : 'Try it'}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="st-faint small">
                {/* Said rather than hidden: these are generated, which is why they work with no network and why the rest are not here. */}
                These are generated by Orbis as they play, so they work offline and never loop. The ones marked above need a recording, which Orbis does not ship.
              </p>
            </>
          ) : null}

          {section === 'notifications' ? (
            <>
              <h3>Notifications</h3>
              <label className="st-field">
                <span>What reaches you</span>
                <select value={prefs.notifications} onChange={(e) => void save({ notifications: e.target.value })}>
                  <option value="all">Everything</option>
                  <option value="important">Only what needs a decision</option>
                  <option value="focus">Only about sessions</option>
                  <option value="off">Nothing</option>
                </select>
                <small>Nothing interrupts you while you are typing, mid-quiz, or waiting on Orion.</small>
              </label>
              <label className="st-check">
                <input type="checkbox" checked={prefs.briefingMorning} onChange={(e) => void save({ briefingMorning: e.target.checked })} />
                <span>
                  <strong>A short briefing in the morning</strong>
                </span>
              </label>
              <label className="st-check">
                <input type="checkbox" checked={prefs.briefingEvening} onChange={(e) => void save({ briefingEvening: e.target.checked })} />
                <span>
                  <strong>A summary in the evening</strong>
                </span>
              </label>

              <label className="st-field">
                <span>Let Orbi drift with the weather (optional)</span>
                <input
                  value={prefs.weatherCity ?? ''}
                  onChange={(e) => void save({ weatherCity: e.target.value.trim() || null })}
                  placeholder="The town you are in"
                  aria-label="A town, for the weather"
                />
                <small>
                  Typed in by you and used for nothing else. Orbis never looks up where you are, and with this empty
                  the weather plays no part in how Orbi moves.
                </small>
              </label>

              <h3>Quiet hours</h3>
              <p className="st-faint small">
                Orbis says nothing at all during these hours. Something about a session you are actually in still
                reaches you — a timer finishing is the thing you asked for, not an interruption.
              </p>
              <label className="st-check">
                <input
                  type="checkbox"
                  checked={prefs.quietHours !== null}
                  onChange={(e) => void save({ quietHours: e.target.checked ? { from: 22, to: 7 } : null })}
                />
                <span>
                  <strong>Keep some hours quiet</strong>
                </span>
              </label>
              {prefs.quietHours ? (
                <div className="st-row-actions">
                  <label className="st-field inline">
                    <span>From</span>
                    <select
                      value={prefs.quietHours.from}
                      onChange={(e) => void save({ quietHours: { from: Number(e.target.value), to: prefs.quietHours?.to ?? 7 } })}
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {clockHour(hour)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="st-field inline">
                    <span>Until</span>
                    <select
                      value={prefs.quietHours.to}
                      onChange={(e) => void save({ quietHours: { from: prefs.quietHours?.from ?? 22, to: Number(e.target.value) } })}
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {clockHour(hour)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              {/* One tap, and it wears off by itself. Nothing here can mute Orbis for ever by accident. */}
              <h3>Quiet now</h3>
              {prefs.quietUntil !== null && prefs.quietUntil > Date.now() ? (
                <div className="st-row-actions">
                  <p className="st-faint">
                    Quiet until{' '}
                    {new Date(prefs.quietUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.
                  </p>
                  <button type="button" className="st-btn" onClick={() => void call('end-quiet').then(() => onNotify('Orbis will speak up again.'))}>
                    Speak up again
                  </button>
                </div>
              ) : (
                <div className="st-row-actions">
                  {[30, 60, 120].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      className="st-btn"
                      onClick={() =>
                        void call<{ until: number }>('quiet-for', minutes).then((out) =>
                          onNotify(
                            out
                              ? `Quiet until ${new Date(out.until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
                              : 'Quiet for a while.'
                          )
                        )
                      }
                    >
                      {minutes < 60 ? `${minutes} minutes` : `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {section === 'accessibility' ? (
            <>
              <h3>Accessibility</h3>
              {(
                [
                  ['reducedMotion', 'Less movement', 'Orbi goes still, and panels appear without sliding.'],
                  ['reducedTransparency', 'Less transparency', 'Solid panels instead of glass.'],
                  ['highContrast', 'Higher contrast', 'Stronger borders and text.'],
                  ['largerText', 'Larger text', 'Everything in Student a step bigger.']
                ] as const
              ).map(([key, label, blurb]) => (
                <label key={key} className="st-check">
                  <input type="checkbox" checked={prefs[key]} onChange={(e) => void save({ [key]: e.target.checked })} />
                  <span>
                    <strong>{label}</strong>
                    <small>{blurb}</small>
                  </span>
                </label>
              ))}
              <label className="st-field">
                <span>How much fits on screen</span>
                <select value={prefs.density} onChange={(e) => void save({ density: e.target.value })}>
                  <option value="calm">Calm — more space</option>
                  <option value="standard">Standard</option>
                  <option value="dense">Dense — more at once</option>
                </select>
              </label>
            </>
          ) : null}

          {section === 'privacy' ? (
            <>
              <h3>Privacy and data</h3>
              <p className="st-note">
                <ShieldCheck size={15} aria-hidden />
                <span>
                  Everything Orbis Student keeps is on this computer, in this profile&apos;s folder. None of it is uploaded, and no other profile can see it.
                </span>
              </p>
              <h4>What is stored</h4>
              <ul className="st-stored">
                <li>Your name, date of birth and settings</li>
                <li>Focus sessions: when, how long, what for, and whether they finished</li>
                <li>Goals, milestones and tasks</li>
                <li>Capsules, spaces and your study library</li>
                <li>XP, achievements, streaks and records</li>
                <li>Learning history: what you have seen and answered</li>
                <li>Pages you saved for later, and thoughts you wrote down</li>
                <li>Orbi&apos;s level and what it is wearing</li>
              </ul>
              <div className="st-row-actions">
                <button type="button" className="st-btn" onClick={() => void exportAll()}>
                  <Download size={15} aria-hidden /> Export everything
                </button>
              </div>

              <h4>Start part of it over</h4>
              <ul className="st-resets">
                {(catalogue?.resetScopes ?? []).map((one) => (
                  <li key={one.id}>
                    <div>
                      <strong>{one.label}</strong>
                      <span className="st-faint small">{one.blurb}</span>
                    </div>
                    {confirming === one.id ? (
                      <div className="st-row-right">
                        <button type="button" className="st-btn quiet" onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                        <button type="button" className="st-btn danger" onClick={() => void reset(one.id)}>
                          Yes, clear it
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="st-btn" onClick={() => setConfirming(one.id)}>
                        Clear
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="st-faint small">
                <AlertTriangle size={12} aria-hidden /> None of these touch your browser profile, your browsing history, your bookmarks or any Orbis setting outside Student.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
