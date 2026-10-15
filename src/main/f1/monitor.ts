import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { emptyPrefs, sanitizePrefs, type F1Prefs } from '../../shared/f1/extras.ts'
import type { F1Answer, F1Race, F1RaceResult } from '../../shared/f1/types.ts'

/** What a profile keeps for F1 (watchlist, alert switches), one small file per profile. No Electron: the path comes in. */
export class PrefsStore {
  private readonly pathFor: () => Promise<string>
  private chain: Promise<unknown> = Promise.resolve()

  constructor(pathFor: () => Promise<string>) {
    this.pathFor = pathFor
  }

  async read(): Promise<F1Prefs> {
    const path = await this.pathFor()
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyPrefs()
      throw e
    }
    try {
      return sanitizePrefs(JSON.parse(text.replace(/^﻿/, '')))
    } catch {
      // Kept aside, not overwritten with an empty list.
      await fs.rename(path, `${path}.unreadable-${Date.now()}`).catch(() => undefined)
      return emptyPrefs()
    }
  }

  update(fn: (p: F1Prefs) => F1Prefs): Promise<F1Prefs> {
    const run = this.chain.then(async () => {
      const clean = sanitizePrefs(fn(await this.read()))
      const path = await this.pathFor()
      await fs.mkdir(dirname(path), { recursive: true })
      await fs.writeFile(`${path}.tmp`, JSON.stringify(clean), { encoding: 'utf8', mode: 0o600 })
      await fs.rename(`${path}.tmp`, path)
      return clean
    })
    this.chain = run.catch(() => undefined)
    return run
  }
}

export interface F1MonitorDeps {
  service: {
    schedule(season: 'current'): Promise<F1Answer<F1Race[]>>
    results(season: 'current', round: 'last'): Promise<F1Answer<F1RaceResult | null>>
  }
  prefs(): Promise<F1Prefs>
  publish(e: { type: string; fields: Record<string, string> }): void
  now?: () => number
}

/**
 * Tells Orbis when an F1 session is about to start and when a race's result has been published. It asks the schedule
 * and the latest result about every few minutes (both are cached by the service, so this is cheap), says each thing
 * once, and says nothing about a result it merely found at startup.
 */
export class F1Monitor {
  private readonly said = new Set<string>()
  private seenResult: string | null | undefined
  private readonly d: F1MonitorDeps

  constructor(deps: F1MonitorDeps) {
    this.d = deps
  }

  async tick(): Promise<void> {
    const now = (this.d.now ?? Date.now)()
    const prefs = await this.d.prefs()
    if (prefs.alerts.sessions) {
      const cal = await this.d.service.schedule('current')
      if (cal.ok) {
        for (const race of cal.data) {
          const sessions = [...race.sessions, { name: 'Race', startsAt: race.startsAt }]
          for (const s of sessions) {
            const t = s.startsAt ? Date.parse(s.startsAt) : NaN
            // A date with no time cannot be reminded about; a session that is long over is not.
            if (Number.isNaN(t) || !s.startsAt || s.startsAt.length <= 10) continue
            if (now >= t - prefs.leadMinutes * 60_000 && now < t + 5 * 60_000) {
              const id = `${race.season}:${race.round}:${s.name}`
              if (!this.said.has(id)) {
                this.said.add(id)
                this.d.publish({ type: 'f1.session', fields: { id, race: race.name, session: s.name, minutes: String(Math.max(0, Math.round((t - now) / 60_000))), circuit: race.circuitName } })
              }
            }
          }
        }
      }
    }
    if (prefs.alerts.results) {
      const last = await this.d.service.results('current', 'last')
      if (last.ok && last.data) {
        const id = `${last.data.race.season}:${last.data.race.round}`
        if (this.seenResult === undefined) this.seenResult = id
        else if (this.seenResult !== id) {
          this.seenResult = id
          const rows = last.data.rows.filter((r) => r.position !== null).slice(0, 3)
          const top = rows.map((r) => `${r.position}. ${r.driver.name}`).join(', ')
          const watched = last.data.rows
            .filter((r) => r.driver.id && prefs.watchlist.includes(r.driver.id))
            .map((r) => `${r.driver.name} ${r.positionText}`)
            .join(', ')
          this.d.publish({ type: 'f1.results', fields: { id, race: last.data.race.name, summary: top + (watched ? ` · Watching: ${watched}` : '') } })
        }
      }
    }
  }
}
