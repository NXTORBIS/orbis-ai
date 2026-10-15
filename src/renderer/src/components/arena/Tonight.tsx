import { Bell, BellRing } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FbAnswer, FbMatch } from '../../../../shared/football/types'
import type { F1Answer, F1Race } from '../../../../shared/f1/types'
import { tonightMatches, tonightSession, type TonightMatch } from '../../../../shared/arenaTonight'

const hhmm = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

interface Followed {
  reminders?: { key: string; title: string; kickoff: string; minutes: number }[]
}

/**
 * What is on in the next day, across Football and F1, with a reminder one press away. A reminder is the same one the
 * Football screen sets, so it fires through the same notification place; F1 session alerts are the F1 screen's switch.
 */
export default function Tonight(): React.JSX.Element | null {
  const [matches, setMatches] = useState<TonightMatch[]>([])
  const [session, setSession] = useState<{ name: string; race: string; at: number } | null>(null)
  const [reminded, setReminded] = useState<Set<string>>(new Set())
  const [f1Alerts, setF1Alerts] = useState<boolean | null>(null)
  const [said, setSaid] = useState('')

  useEffect(() => {
    let alive = true
    const now = Date.now()
    void window.api
      .footballLive()
      .then((raw) => {
        const a = raw as FbAnswer<FbMatch[]>
        if (alive && a.ok) setMatches(tonightMatches(a.data, now))
      })
      .catch(() => undefined)
    void window.api
      .footballFollows()
      .then((raw) => {
        const r = raw as { data?: Followed }
        if (alive && r.data?.reminders) setReminded(new Set(r.data.reminders.map((x) => x.key)))
      })
      .catch(() => undefined)
    void window.api
      .f1Schedule('current')
      .then((raw) => {
        const a = raw as F1Answer<F1Race[]>
        if (!alive || !a.ok) return
        const all = a.data.flatMap((race) =>
          [...race.sessions, { name: 'Race', startsAt: race.startsAt }].map((s) => ({ name: s.name, startsAt: s.startsAt ?? null, race: race.name }))
        )
        setSession(tonightSession(all, now))
      })
      .catch(() => undefined)
    void window.api
      .f1Prefs()
      .then((raw) => {
        const r = raw as { data?: { alerts?: { sessions?: boolean } } }
        if (alive && r.data?.alerts) setF1Alerts(r.data.alerts.sessions !== false)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const remind = useCallback(async (m: TonightMatch): Promise<void> => {
    try {
      const raw = (await window.api.footballFollows()) as { data?: Followed }
      const cur = raw.data ?? {}
      const list = (cur.reminders ?? []).filter((x) => x.key !== m.key)
      await window.api.footballFollowsSet({ ...cur, reminders: [...list, { key: m.key, title: m.title, kickoff: m.kickoff, minutes: 15 }] })
      setReminded((s) => new Set(s).add(m.key))
      setSaid(`You will be told 15 minutes before ${m.title}.`)
    } catch {
      setSaid('That reminder could not be saved.')
    }
  }, [])

  const toggleF1 = useCallback(async (): Promise<void> => {
    try {
      const raw = (await window.api.f1Prefs()) as { data?: { alerts?: { sessions?: boolean; results?: boolean } } }
      const cur = (raw.data ?? {}) as Record<string, unknown>
      const alerts = { ...(raw.data?.alerts ?? {}), sessions: !(f1Alerts ?? true) }
      await window.api.f1PrefsSet({ ...cur, alerts })
      setF1Alerts(alerts.sessions)
      setSaid(alerts.sessions ? 'F1 session alerts are on.' : 'F1 session alerts are off.')
    } catch {
      setSaid('That could not be changed.')
    }
  }, [f1Alerts])

  if (matches.length === 0 && !session) return null
  return (
    <div className="arena-tonight" aria-label="On in the next 24 hours">
      <h2>Tonight</h2>
      <ul>
        {session && (
          <li>
            <span className="arena-tonight-time">{hhmm(session.at)}</span>
            <span className="arena-tonight-what">
              <b>F1 · {session.name}</b>
              <small>{session.race}</small>
            </span>
            <button
              type="button"
              className="arena-tonight-btn"
              aria-pressed={f1Alerts === true}
              onClick={() => void toggleF1()}
              title={f1Alerts ? 'Session alerts are on: press to turn off' : 'Turn on session alerts'}
            >
              {f1Alerts ? <BellRing size={14} /> : <Bell size={14} />}
              {f1Alerts ? 'Alerts on' : 'Alert me'}
            </button>
          </li>
        )}
        {matches.map((m) => (
          <li key={m.key}>
            <span className="arena-tonight-time">{hhmm(m.at)}</span>
            <span className="arena-tonight-what">
              <b>{m.title}</b>
              <small>{m.competition}</small>
            </span>
            <button type="button" className="arena-tonight-btn" aria-pressed={reminded.has(m.key)} disabled={reminded.has(m.key)} onClick={() => void remind(m)}>
              {reminded.has(m.key) ? <BellRing size={14} /> : <Bell size={14} />}
              {reminded.has(m.key) ? 'Reminder set' : 'Remind me'}
            </button>
          </li>
        ))}
      </ul>
      {said && (
        <p className="arena-tonight-said" role="status">
          {said}
        </p>
      )}
    </div>
  )
}
