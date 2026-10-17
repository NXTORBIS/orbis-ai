import { useCallback, useEffect, useId, useState } from 'react'
import type { OrbisNotification, NotificationCategory } from '../../../shared/notifications'
import type { NotificationsConfig } from '../../../shared/experience'
import { useSurface } from '../lib/surfaces'
import { notificationsSurface } from './settingsSurfaces'

/**
 * What Orbis interrupts you for, and what it has interrupted you for lately.
 *
 * Both on one screen on purpose. The switches above decide what reaches you; the list below is what actually did, so
 * somebody who thinks they are being told too much can see exactly what they were told and turn that one thing off
 * rather than switching everything off and hoping.
 *
 * Nothing here is drawn from anything but real state. The list is the real history, the count is the real count, and
 * what the computer can do is asked of the computer rather than assumed -- which is why the line at the bottom can
 * say that Windows will not draw the buttons, instead of showing buttons that would never appear.
 */

const CATEGORIES: readonly { id: NotificationCategory; label: string; what: string }[] = Object.freeze([
  { id: 'attention', label: 'Waiting for you', what: 'When Orbis cannot go on without you — a verification, a workflow that is stuck.' },
  { id: 'schedules', label: 'Scheduled jobs', what: 'When something you scheduled has run, or could not.' },
  { id: 'workflows', label: 'Workflows', what: 'When a workflow finishes or fails.' },
  { id: 'downloads', label: 'Downloads', what: 'When a download finishes or fails.' },
  { id: 'artifacts', label: 'Files Orbis makes', what: 'When a document, spreadsheet or report is ready.' },
  { id: 'research', label: 'Research', what: 'When research you asked for is finished.' },
  { id: 'pages', label: 'Pages', what: 'When a Page has been built.' },
  { id: 'orion', label: 'Orion', what: 'When a long answer is ready while you are elsewhere.' },
  { id: 'f1', label: 'F1', what: 'When a session is about to start and when a race result is published.' },
  { id: 'football', label: 'Football', what: 'Goals, kick-off, full-time and reminders for the teams and matches you follow.' },
  { id: 'updates', label: 'Updates', what: 'When an Orbis update is ready to install.' },
  { id: 'security', label: 'Security', what: 'When Orbis stops something. These get through quiet hours.' },
  { id: 'system', label: 'Everything else', what: 'Rules you set up, and problems Orbis hits in the background.' }
])

const WHEN = (at: number): string => {
  const ago = Date.now() - at
  if (ago < 60_000) return 'just now'
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)} min ago`
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)} hr ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function NotificationSettings(): React.JSX.Element | null {
  const [items, setItems] = useState<OrbisNotification[]>([])
  const [can, setCan] = useState<{ native: boolean; buttons: boolean; quiet: boolean } | null>(null)
  const [said, setSaid] = useState('')
  /** The whole personalisation, because saving one part of it means saving the whole and this is where it lives. */
  const [experience, setExperience] = useState<{ notifications: NotificationsConfig } | null>(null)
  /** One stem for the switch names and the sentences under them, so two of these screens cannot share an id. */
  const stem = useId()

  useEffect(() => {
    void window.api.getExperience().then((got) => setExperience(got as { notifications: NotificationsConfig }))
  }, [])

  const onUpdate = useCallback(
    async (next: NotificationsConfig): Promise<void> => {
      if (!experience) return
      const whole = { ...experience, notifications: next }
      setExperience(whole)
      await window.api.saveExperience(whole as never, 'Notifications')
    },
    [experience]
  )

  const load = useCallback(async () => {
    const got = await window.api.notifications()
    if (got.ok) {
      setItems(got.items ?? [])
      setCan(got.can ?? null)
    }
  }, [])

  useEffect(() => {
    void load()
    // Redrawn when something happens rather than on a timer: a list that polls is a list that is wrong between polls.
    return window.api.onNotificationsChanged(() => void load())
  }, [load])

  /*
   * What this page lets Orbis read and set.
   *
   * Above the early return below, because a hook has to be called every time this draws -- and that matters here
   * rather than being a formality: until the personalisation has arrived there is nothing to read, and `settings`
   * below throws instead of answering. A control whose getter throws is reported as "could not be read", which is the
   * truth; one that hands back its default would report a switch as off because a file was slow.
   *
   * What it offers is in `settingsSurfaces.ts`, as a function of these same handlers.
   */
  useSurface(
    notificationsSurface({
      settings: () => {
        if (!experience) throw new Error('This page has not finished loading.')
        return experience.notifications
      },
      save: (next) => void onUpdate(next),
      categories: CATEGORIES,
      told: () => ({ total: items.length, unread: items.filter((one) => !one.read).length }),
      shows: () => can?.native ?? null,
      test: () => window.api.notificationTest(),
      markAllRead: () => window.api.notificationRead(null).then(load),
      clearAll: () => window.api.notificationClear(null).then(load),
      // Asked of the application again rather than read off this screen, so that marking or clearing is checked
      // against what is really kept and not against a list this screen may not have redrawn yet.
      check: async () => {
        const got = await window.api.notifications()
        const all = got.items ?? []
        return { total: all.length, unread: all.filter((one) => !one.read).length }
      }
    })
  )

  if (!experience) return null
  const notifications = experience.notifications
  const quiet = notifications.quietHours
  const setCategory = (id: string, on: boolean): void => {
    void onUpdate({ ...notifications, categories: { ...notifications.categories, [id]: on } })
  }

  return (
    <>
      <section className="setting">
        <div className="setting-label">
          <h3>What Orbis tells you about</h3>
          <p>Turning one off stops the notification. It never stops the thing itself — a download you are not told about still finishes.</p>
        </div>
        <div className="notify-cats">
          {CATEGORIES.map((category) => {
            // Never decided about means on: Orbis does not go silent about something new because nobody chose yet.
            const on = notifications.categories[category.id] !== false
            const named = `${stem}-${category.id}-name`
            const described = `${stem}-${category.id}-what`
            return (
              <label className="notify-cat" key={category.id}>
                {/* The sentence is inside this label, so it was part of what the switch is called: read aloud, every
                    one of these was "Waiting for you When Orbis cannot go on without you — a verification, a workflow
                    that is stuck.". Pointing the box at the title names it and at the sentence describes it, so the
                    sentence is read after the name, once. The label still wraps both, so pressing anywhere on the
                    card still works -- which is why this is not the shared Field: Field puts the name before the
                    control, and here the box comes first. */}
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setCategory(category.id, e.target.checked)}
                  aria-labelledby={named}
                  aria-describedby={described}
                />
                <span>
                  <b id={named}>{category.label}</b>
                  <small id={described}>{category.what}</small>
                </span>
              </label>
            )
          })}
        </div>
      </section>

      <section className="setting row">
        <div className="setting-label">
          <h3>Quiet hours</h3>
          <p>Nothing is lost: what arrives during these hours is held, and said in one line afterwards. Security warnings still get through.</p>
        </div>
        <div className="notify-quiet">
          <input type="checkbox" checked={quiet.enabled} onChange={(e) => void onUpdate({ ...notifications, quietHours: { ...quiet, enabled: e.target.checked } })} aria-label="Quiet hours" />
          <input type="time" value={quiet.from} disabled={!quiet.enabled} aria-label="Quiet from" onChange={(e) => void onUpdate({ ...notifications, quietHours: { ...quiet, from: e.target.value } })} />
          <span>to</span>
          <input type="time" value={quiet.to} disabled={!quiet.enabled} aria-label="Quiet until" onChange={(e) => void onUpdate({ ...notifications, quietHours: { ...quiet, to: e.target.value } })} />
        </div>
      </section>

      <section className="setting row">
        <div className="setting-label">
          <h3>Does it work?</h3>
          {/* Asked of the computer, not assumed. Where Windows will not draw a notification's buttons, it says so
              rather than showing buttons that would never appear. */}
          <p>
            {can === null
              ? 'Checking…'
              : !can.native
                ? 'This computer is not showing notifications for Orbis. Check notifications for Orbis in Windows settings.'
                : can.buttons
                  ? 'Notifications are working, and their buttons appear on them.'
                  : 'Notifications are working. Windows does not draw their buttons, so a notification does one thing when pressed and the rest of its buttons are in the list below.'}
          </p>
          {said ? <p className="notify-said">{said}</p> : null}
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => void window.api.notificationTest().then((r) => setSaid(r.message))}
        >
          Send a test
        </button>
      </section>

      <section className="setting">
        <div className="setting-label">
          <h3>What you have been told</h3>
          <p>Only what really happened. Forgetting one here forgets the note, never the download, the file or the workflow it was about.</p>
        </div>
        {items.length === 0 ? (
          <p className="notify-none">Nothing yet.</p>
        ) : (
          <>
            <div className="notify-tools">
              <button type="button" className="btn small" onClick={() => void window.api.notificationRead(null).then(load)}>
                Mark all read
              </button>
              <button type="button" className="btn small" onClick={() => void window.api.notificationClear(null).then(load)}>
                Clear
              </button>
            </div>
            <ul className="notify-list">
              {items.map((one) => (
                <li className={`notify-item${one.read ? '' : ' unread'}`} key={one.id}>
                  <div className="notify-text">
                    <b>{one.title}</b>
                    <span>{one.body}</span>
                    <small>
                      {WHEN(one.at)}
                      {one.status === 'suppressed' ? ' · not shown, that kind is off' : ''}
                      {one.status === 'held' ? ' · held until quiet hours end' : ''}
                      {one.status === 'failed' ? ' · could not be shown' : ''}
                    </small>
                  </div>
                  <div className="notify-acts">
                    {one.actions.map((action) => (
                      <button
                        type="button"
                        className="btn small"
                        key={action.id}
                        onClick={() => void window.api.notificationAct(one.id, action.id).then((r) => (r.ok ? load() : setSaid(r.message ?? 'That did not work.')))}
                      >
                        {action.label}
                      </button>
                    ))}
                    <button type="button" className="btn small quiet" onClick={() => void window.api.notificationClear(one.id).then(load)} aria-label={`Forget: ${one.title}`}>
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  )
}
