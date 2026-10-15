import { diffMatch } from '../../shared/football/logic.ts'
import type { FbFollows } from '../../shared/football/follows.ts'
import type { FbAnswer, FbMatch } from '../../shared/football/types.ts'

export interface MonitorDeps {
  service: { live(): Promise<FbAnswer<FbMatch[]>>; match(key: string): Promise<FbAnswer<FbMatch | null>> }
  follows(): Promise<FbFollows>
  /** Hands an event to Orbis's one notification place. Words are decided there, not here. */
  publish(e: { type: string; fields: Record<string, string> }): void
  /** A reminder has been said once (or can never be): it is removed so it cannot be said again after a restart. */
  reminderDone(key: string, minutes: number): Promise<void>
  now?: () => number
}

const title = (m: FbMatch): string => `${m.home.name} – ${m.away.name}`

/**
 * Watches what a person follows and tells Orbis when something *changed*, using the same change detection the screen
 * does. The first sight of a match says nothing (a match already at 2–1 is not a goal), and each event is said once.
 * It asks only when something is followed, pinned or reminded, and it never says a minute it was not given.
 */
export class FootballMonitor {
  private readonly prev = new Map<string, FbMatch>()
  private readonly said = new Set<string>()
  private readonly d: MonitorDeps

  constructor(deps: MonitorDeps) {
    this.d = deps
  }

  private once(id: string): boolean {
    if (this.said.has(id)) return false
    this.said.add(id)
    if (this.said.size > 2000) this.said.delete(this.said.values().next().value as string)
    return true
  }

  async tick(): Promise<void> {
    const now = (this.d.now ?? Date.now)()
    const f = await this.d.follows()
    if (f.teams.length + f.pins.length + f.reminders.length === 0) return
    const teams = new Set(f.teams.map((t) => t.id))
    const pins = new Set(f.pins.map((p) => p.key))
    const rows = new Map<string, FbMatch>()
    const live = await this.d.service.live()
    if (live.ok) for (const m of live.data) rows.set(m.key, m)
    // A pinned or reminded match that is not in the live list (not started, or finished) is looked up by itself.
    const wanted = new Set([...pins, ...f.reminders.map((r) => r.key)])
    for (const key of [...wanted].filter((k) => !rows.has(k)).slice(0, 8)) {
      const one = await this.d.service.match(key)
      if (one.ok && one.data) rows.set(key, one.data)
    }
    for (const m of rows.values()) {
      const watched = teams.has(m.home.id) || teams.has(m.away.id) || pins.has(m.key)
      const before = this.prev.get(m.key) ?? null
      this.prev.set(m.key, m)
      if (!watched) continue
      for (const c of diffMatch(before, m)) {
        if (c.kind === 'goal' && f.alerts.goals) {
          const id = c.event?.id ?? `${m.key}:${c.score.home}-${c.score.away}`
          if (this.once(`goal:${id}`)) this.d.publish({ type: 'football.goal', fields: { id, match: title(m), summary: `${m.home.name} ${c.score.home}–${c.score.away} ${m.away.name}${c.event?.player ? ` (${c.event.player})` : ''}` } })
        } else if (c.kind === 'kickoff' && f.alerts.kickoff) {
          if (this.once(`ko:${m.key}`)) this.d.publish({ type: 'football.kickoff', fields: { id: m.key, match: title(m) } })
        } else if (c.kind === 'full-time' && f.alerts.fulltime) {
          if (this.once(`ft:${m.key}`)) this.d.publish({ type: 'football.fulltime', fields: { id: m.key, match: title(m), summary: `${m.home.name} ${m.score.home}–${m.score.away} ${m.away.name}` } })
        }
      }
    }
    for (const r of f.reminders) {
      const m = rows.get(r.key)
      // A postponed or cancelled match gets no reminder; a moved kick-off is followed.
      if (m && (m.status === 'postponed' || m.status === 'cancelled' || m.status === 'abandoned')) {
        await this.d.reminderDone(r.key, r.minutes)
        continue
      }
      const kick = Date.parse(m?.kickoff ?? r.kickoff)
      if (Number.isNaN(kick)) continue
      if (now >= kick + 15 * 60_000) {
        await this.d.reminderDone(r.key, r.minutes)
        continue
      }
      if (now >= kick - r.minutes * 60_000 && this.once(`rem:${r.key}:${r.minutes}`)) {
        this.d.publish({ type: 'football.reminder', fields: { id: `${r.key}:${r.minutes}`, match: r.title, minutes: String(r.minutes) } })
        await this.d.reminderDone(r.key, r.minutes)
      }
    }
  }
}
