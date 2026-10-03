import { useCallback, useEffect, useState } from 'react'
import type { OrbisNotification, NotificationCategory } from '../../../shared/notifications'
import type { NotificationsConfig } from '../../../shared/experience'

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
            return (
              <label className="notify-cat" key={category.id}>
                <input type="checkbox" checked={on} onChange={(e) => setCategory(category.id, e.target.checked)} />
                <span>
                  <b>{category.label}</b>
                  <small>{category.what}</small>
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
