/**
 * Orbis Arena -> Football: where football data is fetched, cached and checked. No Electron in here, so every rule below
 * is testable without a window or a network:
 *  - one request per address at a time, and a provider's pacing is respected between requests;
 *  - an answer is reused while it is fresh; when a provider cannot be reached the last good answer comes back marked
 *    `stale`, never passed off as new;
 *  - a provider's "slow down" (429 / Retry-After) is honoured;
 *  - an answer with nothing usable in it is not cached.
 *
 * Providers (neither needs a key a person has to obtain):
 *  - OpenLigaDB, community-run and open: German football with goal lists.   https://api.openligadb.de
 *  - TheSportsDB, with its public test key: live status and minutes, fixtures and tables for many leagues.
 */
import { LEAGUES, currentSeason, leagueById, providerSeason } from '../../shared/football/leagues.ts'
import { acceptStatus } from '../../shared/football/logic.ts'
import {
  normalizeEventStats,
  normalizeLineup,
  normalizeSquad,
  normalizeTeam,
  normalizeTimeline,
  type FbMatchExtras,
  type FbTeamProfile
} from '../../shared/football/extras.ts'
import { normalizeOpenLigaMatches, normalizeOpenLigaTable, normalizeSportsDbMatches, normalizeSportsDbTable } from '../../shared/football/normalize.ts'
import type { FbAnswer, FbFailure, FbFreshness, FbLeague, FbMatch, FbProvider, FbSource, FbStandingRow } from '../../shared/football/types.ts'

export interface FetchResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponse>

export interface FootballServiceOptions {
  fetch: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const BASE: Record<FbProvider, string> = {
  openligadb: 'https://api.openligadb.de',
  thesportsdb: 'https://www.thesportsdb.com/api/v1/json/3'
}
const SPACING_MS: Record<FbProvider, number> = { openligadb: 250, thesportsdb: 600 }
const TIMEOUT_MS = 20_000
const MIN = 60_000
const HOUR = 60 * MIN

/** Matchdays kept for the "now" view: a short list of the leagues whose current round is cheap and goal-listed. */
const NOW_LEAGUES = ['openligadb:bl1', 'openligadb:bl2', 'openligadb:bl3', 'openligadb:dfb']

interface CacheEntry {
  body: unknown
  at: number
}

type Pace = { requests: number; failures: number; lastOkAt: number | null; lastError: string | null }

export class FootballService {
  private readonly fetchFn: FetchLike
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private readonly lastSent: Record<FbProvider, number> = { openligadb: 0, thesportsdb: 0 }
  private readonly blockedUntil: Record<FbProvider, number> = { openligadb: 0, thesportsdb: 0 }
  private readonly lane: Record<FbProvider, Promise<void>> = { openligadb: Promise.resolve(), thesportsdb: Promise.resolve() }
  private readonly stats: Record<FbProvider, Pace> = {
    openligadb: { requests: 0, failures: 0, lastOkAt: null, lastError: null },
    thesportsdb: { requests: 0, failures: 0, lastOkAt: null, lastError: null }
  }
  /** The newest accepted record of each match, so an old answer arriving late cannot move a match backwards. */
  private readonly held = new Map<string, FbMatch>()

  constructor(options: FootballServiceOptions) {
    this.fetchFn = options.fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  leagues(): readonly FbLeague[] {
    return LEAGUES
  }

  /**
   * What is happening now: matches the provider *reports* as live (TheSportsDB), plus the current rounds of the German
   * leagues, where "live" can only be inferred and is labelled so.
   */
  async live(): Promise<FbAnswer<FbMatch[]>> {
    const notes: string[] = []
    const jobs = await Promise.all([
      this.get('thesportsdb', `${BASE.thesportsdb}/livescore.php?s=Soccer`, 30_000, (b) => normalizeSportsDbMatches(b, 'livescore')),
      ...NOW_LEAGUES.map((id) => {
        const l = leagueById(id) as FbLeague
        return this.get('openligadb', `${BASE.openligadb}/getmatchdata/${l.providerId}`, MIN, (b) => normalizeOpenLigaMatches(b, this.now()))
      })
    ])
    const ok = jobs.filter((j): j is Extract<FbAnswer<FbMatch[]>, { ok: true }> => j.ok)
    if (ok.length === 0) return jobs.find((j) => !j.ok) as FbFailure
    if (!jobs[0].ok) notes.push('Live scores for non-German leagues could not be loaded just now.')
    const all = ok.flatMap((a) => a.data)
    return {
      ok: true,
      data: this.settle(this.dedupe(all)),
      sources: ok.flatMap((a) => a.sources),
      freshness: ok.some((a) => a.freshness === 'stale') ? 'stale' : ok.every((a) => a.freshness === 'cached') ? 'cached' : 'fresh',
      notes
    }
  }

  /** Every match of one competition's season (one request), with the goal lists where the provider has them. */
  season(leagueId: string, season: string): Promise<FbAnswer<FbMatch[]>> {
    const l = leagueById(leagueId)
    if (!l) return this.invalid('That competition is not one Orbis has data for.')
    if (!/^\d{4}$/.test(season) || Number(season) < l.firstSeason || Number(season) > new Date(this.now()).getUTCFullYear() + 1) return this.invalid('That season is not one this competition has data for.')
    const isNow = season === currentSeason(l, new Date(this.now()))
    const ttl = isNow ? 5 * MIN : 12 * HOUR
    const ps = providerSeason(l, season)
    if (l.provider === 'openligadb') return this.get('openligadb', `${BASE.openligadb}/getmatchdata/${l.providerId}/${ps}`, ttl, (b) => normalizeOpenLigaMatches(b, this.now()), (d) => d.length > 0)
    return this.get('thesportsdb', `${BASE.thesportsdb}/eventsseason.php?id=${l.providerId}&s=${ps}`, ttl, (b) => normalizeSportsDbMatches(b, 'events'), (d) => d.length > 0).then((a) => {
      if (a.ok) a.notes.push(`Only the fixtures this provider returns are shown (${a.data.length}). A full season can be larger.`)
      return a
    })
  }

  table(leagueId: string, season: string): Promise<FbAnswer<FbStandingRow[]>> {
    const l = leagueById(leagueId)
    if (!l) return this.invalid('That competition is not one Orbis has data for.')
    if (!l.capabilities.table) return Promise.resolve({ ok: false, reason: 'unsupported', message: `${l.name} is a knockout competition: it has no league table.` })
    if (!/^\d{4}$/.test(season) || Number(season) < l.firstSeason) return this.invalid('That season is not one this competition has data for.')
    const ttl = season === currentSeason(l, new Date(this.now())) ? 5 * MIN : 12 * HOUR
    const ps = providerSeason(l, season)
    if (l.provider === 'openligadb') return this.get('openligadb', `${BASE.openligadb}/getbltable/${l.providerId}/${ps}`, ttl, normalizeOpenLigaTable, (d) => d.length > 0)
    return this.get('thesportsdb', `${BASE.thesportsdb}/lookuptable.php?l=${l.providerId}&s=${ps}`, ttl, normalizeSportsDbTable, (d) => d.length > 0)
  }

  /** One match by its namespaced key, from its own provider. */
  async match(key: string): Promise<FbAnswer<FbMatch | null>> {
    const m = /^(openligadb|thesportsdb):(\d{1,12})$/.exec(key)
    if (!m) return this.invalid('That match is not one Orbis can look up.')
    const provider = m[1] as FbProvider
    if (provider === 'openligadb') {
      const a = await this.get('openligadb', `${BASE.openligadb}/getmatchdata/${m[2]}`, 30_000, (b) => normalizeOpenLigaMatches([b], this.now())[0] ?? null, (d) => d !== null)
      return a.ok && a.data ? { ...a, data: this.settle([a.data])[0] } : a
    }
    const a = await this.get('thesportsdb', `${BASE.thesportsdb}/lookupevent.php?id=${m[2]}`, 30_000, (b) => normalizeSportsDbMatches(b, 'events')[0] ?? null, (d) => d !== null)
    return a.ok && a.data ? { ...a, data: this.settle([a.data])[0] } : a
  }

  /**
   * Lineup, timeline and statistics for a TheSportsDB match. The public key returns only the first few of each, so the
   * answer is marked partial. OpenLigaDB has none of these, and that is said rather than answered with empty lists.
   */
  async extras(key: string): Promise<FbAnswer<FbMatchExtras>> {
    const m = /^(openligadb|thesportsdb):(\d{1,12})$/.exec(key)
    if (!m) return this.invalid('That match is not one Orbis can look up.')
    if (m[1] !== 'thesportsdb') return { ok: false, reason: 'unsupported', message: 'OpenLigaDB supplies the score and the goals only: no lineup, timeline or statistics.' }
    const id = m[2]
    const [lineup, timeline, stats] = await Promise.all([
      this.get('thesportsdb', `${BASE.thesportsdb}/lookuplineup.php?id=${id}`, 10 * MIN, normalizeLineup),
      this.get('thesportsdb', `${BASE.thesportsdb}/lookuptimeline.php?id=${id}`, MIN, normalizeTimeline),
      this.get('thesportsdb', `${BASE.thesportsdb}/lookupeventstats.php?id=${id}`, MIN, normalizeEventStats)
    ])
    const parts = [lineup, timeline, stats]
    const good = parts.filter((p): p is Extract<typeof p, { ok: true }> => p.ok)
    if (good.length === 0) return parts.find((p) => !p.ok) as FbFailure
    const data: FbMatchExtras = {
      lineup: lineup.ok ? lineup.data : [],
      timeline: timeline.ok ? timeline.data : [],
      stats: stats.ok ? stats.data : [],
      partial: [lineup, timeline, stats].some((p) => p.ok && p.data.length >= 5)
    }
    return {
      ok: true,
      data,
      sources: good.flatMap((g) => g.sources),
      freshness: good.some((g) => g.freshness === 'stale') ? 'stale' : good.every((g) => g.freshness === 'cached') ? 'cached' : 'fresh',
      notes: data.partial ? ['The provider’s public key returns only the first few entries of each list, so these are not complete.'] : []
    }
  }

  /** A team's profile and the first of its squad, from TheSportsDB. */
  async team(teamKey: string): Promise<FbAnswer<FbTeamProfile>> {
    const m = /^thesportsdb:(\d{1,12})$/.exec(teamKey)
    if (!m) return { ok: false, reason: 'unsupported', message: 'Team pages come from TheSportsDB; this team is from another provider.' }
    const [info, squad] = await Promise.all([
      this.get('thesportsdb', `${BASE.thesportsdb}/lookupteam.php?id=${m[1]}`, 24 * HOUR, normalizeTeam, (d) => d !== null),
      this.get('thesportsdb', `${BASE.thesportsdb}/lookup_all_players.php?id=${m[1]}`, 24 * HOUR, normalizeSquad)
    ])
    if (!info.ok || !info.data) return info.ok ? { ok: false, reason: 'bad-response', message: 'No team was returned.' } : info
    const players = squad.ok ? squad.data : []
    return {
      ok: true,
      data: { ...info.data, squad: players, squadPartial: players.length >= 10 },
      sources: [...info.sources, ...(squad.ok ? squad.sources : [])],
      freshness: info.freshness,
      notes: players.length >= 10 ? ['The public key returns only the first ten people of a squad.'] : []
    }
  }

  /** What the Sources screen shows: honest counts, no guessed uptime. */
  status(): { provider: FbProvider; base: string; requests: number; failures: number; lastOkAt: string | null; lastError: string | null; rateLimitedUntil: string | null; cached: number }[] {
    return (['openligadb', 'thesportsdb'] as const).map((provider) => {
      const s = this.stats[provider]
      const blocked = this.blockedUntil[provider]
      return {
        provider,
        base: BASE[provider],
        requests: s.requests,
        failures: s.failures,
        lastOkAt: s.lastOkAt === null ? null : new Date(s.lastOkAt).toISOString(),
        lastError: s.lastError,
        rateLimitedUntil: blocked > this.now() ? new Date(blocked).toISOString() : null,
        cached: [...this.cache.keys()].filter((u) => u.startsWith(BASE[provider])).length
      }
    })
  }

  // ---- internals ---------------------------------------------------------------------------------------------------------

  /** Keeps the held record when a late answer would move a match backwards; otherwise holds the new one. */
  private settle(list: FbMatch[]): FbMatch[] {
    return list.map((m) => {
      const prev = this.held.get(m.key) ?? null
      if (acceptStatus(prev, m).accept) {
        this.held.set(m.key, m)
        return m
      }
      return prev as FbMatch
    })
  }

  /**
   * The same fixture from two providers is one row only when both teams' names are the same after normalising. Where
   * the names differ the two stay as two rows, each saying its own source: guessing identity would merge clubs.
   */
  private dedupe(list: FbMatch[]): FbMatch[] {
    const norm = (s: string): string =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '')
    const byKey = new Map<string, FbMatch>()
    for (const m of list) {
      const day = m.kickoff ? m.kickoff.slice(0, 10) : '?'
      const k = `${norm(m.home.name)}|${norm(m.away.name)}|${day}`
      const have = byKey.get(k)
      // A provider that *reports* live outranks one that is merely inferred to be.
      if (!have || (m.liveBasis === 'reported' && have.liveBasis !== 'reported')) byKey.set(k, m)
    }
    return [...byKey.values()]
  }

  private invalid<T>(message: string): Promise<FbAnswer<T>> {
    return Promise.resolve({ ok: false, reason: 'invalid-request', message } satisfies FbFailure)
  }

  private async get<T>(provider: FbProvider, url: string, ttlMs: number, normalize: (payload: unknown) => T, acceptable: (d: T) => boolean = () => true): Promise<FbAnswer<T>> {
    const cached = this.cache.get(url)
    const age = cached ? this.now() - cached.at : Infinity
    if (cached && age < ttlMs) return this.answer(provider, url, normalize(cached.body), 'cached', cached.at)
    const pending = this.inFlight.get(url)
    let outcome: { body: unknown } | FbFailure
    if (pending) outcome = (await pending) as { body: unknown } | FbFailure
    else {
      const run = this.fetchOnce(provider, url)
      this.inFlight.set(url, run)
      try {
        outcome = await run
      } finally {
        this.inFlight.delete(url)
      }
    }
    if ('ok' in outcome) {
      if (cached) return this.answer(provider, url, normalize(cached.body), 'stale', cached.at)
      return outcome
    }
    const data = normalize(outcome.body)
    if (!acceptable(data)) return { ok: false, reason: 'bad-response', message: 'The provider answered, but there was nothing usable in the answer.' }
    this.cache.set(url, { body: outcome.body, at: this.now() })
    return this.answer(provider, url, data, 'fresh', this.now())
  }

  private answer<T>(provider: FbProvider, url: string, data: T, freshness: FbFreshness, at: number): FbAnswer<T> {
    const source: FbSource = { provider, url, retrievedAt: new Date(at).toISOString() }
    return { ok: true, data, sources: [source], freshness, notes: [] }
  }

  private fetchOnce(provider: FbProvider, url: string): Promise<{ body: unknown } | FbFailure> {
    const turn = this.lane[provider].then(async () => {
      const wait = this.lastSent[provider] + SPACING_MS[provider] - this.now()
      if (wait > 0) await this.sleep(wait)
      this.lastSent[provider] = this.now()
    })
    this.lane[provider] = turn.catch(() => undefined)
    return turn.then(() => this.send(provider, url))
  }

  private async send(provider: FbProvider, url: string): Promise<{ body: unknown } | FbFailure> {
    const stats = this.stats[provider]
    if (this.blockedUntil[provider] > this.now()) return { ok: false, reason: 'rate-limited', message: 'The data provider asked Orbis to slow down; it will be asked again shortly.' }
    stats.requests += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await this.fetchFn(url, { signal: controller.signal })
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after'))
        this.blockedUntil[provider] = this.now() + (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 300) * 1000 : 60_000)
        return this.fail(provider, 'rate-limited', 'The data provider asked Orbis to slow down.')
      }
      if (!res.ok) return this.fail(provider, 'provider-error', `The data provider answered with an error (${res.status}).`)
      let body: unknown
      try {
        body = JSON.parse((await res.text()).replace(/^﻿/, ''))
      } catch {
        return this.fail(provider, 'bad-response', 'The data provider sent something that was not readable.')
      }
      stats.lastOkAt = this.now()
      stats.lastError = null
      return { body }
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError'
      return this.fail(provider, 'offline', aborted ? 'The data provider took too long to answer.' : 'The data provider could not be reached. Check the connection.')
    } finally {
      clearTimeout(timer)
    }
  }

  private fail(provider: FbProvider, reason: FbFailure['reason'], message: string): FbFailure {
    const s = this.stats[provider]
    s.failures += 1
    s.lastError = message
    return { ok: false, reason, message }
  }
}
