/**
 * Orbis Arena -> F1: where F1 data is fetched, cached and checked.
 *
 * No Electron in here (the adapter is ipc.ts), so the rules below are testable without a window or a network:
 *  - one request per address at a time (two views asking for the same thing share it);
 *  - an answer is reused while it is fresh, and a provider's pacing is respected between requests;
 *  - when a provider cannot be reached, the last good answer is returned and marked `stale`, never passed off as new;
 *  - a provider's "slow down" is honoured: nothing is sent to it until its Retry-After has passed.
 *
 * Providers (both need no key, which is a requirement of this feature):
 *  - Jolpica-F1, Ergast-compatible: calendar, results, standings.  https://api.jolpi.ca/ergast/f1/
 *  - OpenF1: sessions, drivers, laps and sector times.             https://api.openf1.org/v1/
 */
import { normalizeArchiveIndex, type ArchiveSession } from '../../shared/f1/archive.ts'
import { normalizeChampions, type ChampionRow } from '../../shared/f1/analysis.ts'
import {
  normalizeCircuitRecords,
  normalizeConstructorSeason,
  normalizeQualifyingSession,
  normalizeTeamRadio,
  pickForecast,
  type CircuitRecord,
  type ConstructorRound,
  type Forecast,
  type QualifyingSession,
  type RadioClip
} from '../../shared/f1/extras.ts'
import {
  type ChampionshipRow,
  type GapPoint,
  normalizeChampionship,
  normalizeIntervals,
  normalizeOvertakes,
  normalizePositions,
  normalizeRaceControl,
  normalizeSessionResult,
  normalizeStartingGrid,
  normalizeWeather
} from '../../shared/f1/race.ts'
import { normalizePitStops, normalizeStints } from '../../shared/f1/strategy.ts'
import { normalizeCareer, normalizeQualifying, normalizeSeasonRows, type CareerSeason, type QualifyingRow, type SeasonRow } from '../../shared/f1/season.ts'
import type { CarSample } from '../../shared/f1/telemetry.ts'
import { normalizeCarData, normalizeLocation, type LocationSample } from '../../shared/f1/telemetryData.ts'
import {
  normalizeConstructorStandings,
  normalizeDriverStandings,
  normalizeLaps,
  normalizeResults,
  normalizeSchedule,
  normalizeSessions,
  normalizeTimingDrivers
} from '../../shared/f1/normalize.ts'
import type {
  F1Answer,
  F1ConstructorStanding,
  F1DriverStanding,
  F1Failure,
  F1Freshness,
  F1Provider,
  F1Race,
  F1RaceResult,
  F1Session,
  F1SessionBundle,
  F1SessionTiming,
  F1Source,
  F1Standings
} from '../../shared/f1/types.ts'

export interface FetchResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponse>

export interface F1ServiceOptions {
  fetch: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const BASE: Record<F1Provider, string> = {
  jolpica: 'https://api.jolpi.ca/ergast/f1',
  openf1: 'https://api.openf1.org/v1',
  f1archive: 'https://livetiming.formula1.com/static',
  openmeteo: 'https://api.open-meteo.com/v1'
}
/** Minimum spacing between requests to one provider (their published limits are a few per second, tens per minute). */
const SPACING_MS: Record<F1Provider, number> = { jolpica: 300, openf1: 450, f1archive: 200, openmeteo: 400 }
const REQUEST_TIMEOUT_MS = 20_000

const MIN = 60_000
const HOUR = 60 * MIN

interface CacheEntry {
  body: unknown
  at: number
  url: string
}

export class F1Service {
  private readonly fetchFn: FetchLike
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private readonly lastSent: Record<F1Provider, number> = { jolpica: 0, openf1: 0, f1archive: 0, openmeteo: 0 }
  private readonly blockedUntil: Record<F1Provider, number> = { jolpica: 0, openf1: 0, f1archive: 0, openmeteo: 0 }
  /** A chain per provider, so spacing holds even when several requests are started together. */
  private readonly lane: Record<F1Provider, Promise<void>> = { jolpica: Promise.resolve(), openf1: Promise.resolve(), f1archive: Promise.resolve(), openmeteo: Promise.resolve() }
  private readonly stats: Record<F1Provider, { requests: number; failures: number; lastOkAt: number | null; lastError: string | null }> = {
    jolpica: { requests: 0, failures: 0, lastOkAt: null, lastError: null },
    openf1: { requests: 0, failures: 0, lastOkAt: null, lastError: null },
    f1archive: { requests: 0, failures: 0, lastOkAt: null, lastError: null },
    openmeteo: { requests: 0, failures: 0, lastOkAt: null, lastError: null }
  }

  constructor(options: F1ServiceOptions) {
    this.fetchFn = options.fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  // ---- public ------------------------------------------------------------------------------------------------------------------

  schedule(season: number | 'current'): Promise<F1Answer<F1Race[]>> {
    const s = this.seasonPath(season)
    if (!s) return this.invalid('That season is not valid.')
    return this.get('jolpica', `${BASE.jolpica}/${s}.json?limit=100`, 6 * HOUR, normalizeSchedule, (d) => d.length > 0)
  }

  results(season: number | 'current', round: number | 'last'): Promise<F1Answer<F1RaceResult | null>> {
    const s = this.seasonPath(season)
    const r = this.roundPath(round)
    if (!s || !r) return this.invalid('That season or round is not valid.')
    // A race that is over does not change; "last" moves when a race finishes, so it is checked more often.
    const ttl = round === 'last' ? 10 * MIN : 12 * HOUR
    return this.get('jolpica', `${BASE.jolpica}/${s}/${r}/results.json?limit=100`, ttl, normalizeResults)
  }

  driverStandings(season: number | 'current', round?: number): Promise<F1Answer<F1Standings<F1DriverStanding> | null>> {
    const path = this.standingsPath(season, round, 'driverStandings')
    if (!path) return this.invalid('That season or round is not valid.')
    return this.get('jolpica', `${BASE.jolpica}/${path}?limit=100`, round === undefined ? 10 * MIN : 12 * HOUR, normalizeDriverStandings)
  }

  constructorStandings(season: number | 'current', round?: number): Promise<F1Answer<F1Standings<F1ConstructorStanding> | null>> {
    const path = this.standingsPath(season, round, 'constructorStandings')
    if (!path) return this.invalid('That season or round is not valid.')
    return this.get('jolpica', `${BASE.jolpica}/${path}?limit=100`, round === undefined ? 10 * MIN : 12 * HOUR, normalizeConstructorStandings)
  }

  sessions(year: number): Promise<F1Answer<F1Session[]>> {
    // OpenF1's free historical data begins with the 2023 season.
    if (!Number.isInteger(year) || year < 2023 || year > 2100) return this.invalid('Session data is available from 2023.')
    return this.get('openf1', `${BASE.openf1}/sessions?year=${year}`, 15 * MIN, normalizeSessions)
  }

  /** Drivers and every lap of one session. Two provider requests; the answer carries the older of the two retrievals. */
  async timing(sessionKey: number, sessionEndsAt: string | null): Promise<F1Answer<F1SessionTiming>> {
    if (!Number.isInteger(sessionKey) || sessionKey <= 0) return this.invalid('That session is not valid.')
    // A session that finished hours ago will not change; one in progress should be looked at again soon.
    const ended = sessionEndsAt ? Date.parse(sessionEndsAt) : NaN
    const settled = Number.isFinite(ended) && this.now() - ended > 3 * HOUR
    const ttl = settled ? 24 * HOUR : 20_000
    const [drivers, laps, sessions] = await Promise.all([
      this.get('openf1', `${BASE.openf1}/drivers?session_key=${sessionKey}`, settled ? 24 * HOUR : 10 * MIN, normalizeTimingDrivers),
      this.get('openf1', `${BASE.openf1}/laps?session_key=${sessionKey}`, ttl, normalizeLaps),
      this.get('openf1', `${BASE.openf1}/sessions?session_key=${sessionKey}`, 15 * MIN, normalizeSessions)
    ])
    if (!laps.ok) return laps
    if (!drivers.ok) return drivers
    if (!sessions.ok) return sessions
    const session = sessions.data[0]
    if (!session) return { ok: false, reason: 'bad-response', message: 'The provider does not know that session.' }
    const order: F1Freshness[] = ['fresh', 'cached', 'stale']
    const worst = [drivers, laps, sessions].map((a) => a.freshness).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0]
    return { ok: true, data: { session, drivers: drivers.data, laps: laps.data }, source: laps.source, freshness: worst }
  }

  /** Everything OpenF1 records about one finished session besides laps. A part that fails is named, not hidden. */
  async sessionBundle(sessionKey: number, endsAt: string | null): Promise<F1Answer<F1SessionBundle>> {
    if (!Number.isInteger(sessionKey) || sessionKey <= 0) return this.invalid('That session is not valid.')
    const ended = endsAt ? Date.parse(endsAt) : NaN
    const settled = Number.isFinite(ended) && this.now() - ended > 3 * HOUR
    const ttl = settled ? 24 * HOUR : 30_000
    const q = (path: string): string => `${BASE.openf1}/${path}?session_key=${sessionKey}`
    const names = ['stints', 'pit stops', 'weather', 'race control', 'positions', 'overtakes', 'results', 'starting grid']
    const [stints, pit, weather, raceControl, positions, overtakes, result, grid] = await Promise.all([
      this.get('openf1', q('stints'), ttl, normalizeStints),
      this.get('openf1', q('pit'), ttl, normalizePitStops),
      this.get('openf1', q('weather'), ttl, normalizeWeather),
      this.get('openf1', q('race_control'), ttl, normalizeRaceControl),
      this.get('openf1', q('position'), ttl, normalizePositions),
      this.get('openf1', q('overtakes'), ttl, normalizeOvertakes),
      this.get('openf1', q('session_result'), ttl, normalizeSessionResult),
      this.get('openf1', q('starting_grid'), ttl, normalizeStartingGrid)
    ])
    const parts = [stints, pit, weather, raceControl, positions, overtakes, result, grid]
    const failed = parts.filter((p): p is F1Failure => !p.ok)
    // Nothing at all came back: that is a failure. Some parts came back: the others are named as missing.
    if (failed.length === parts.length) return failed[0]
    const good = parts.filter((p) => p.ok) as { ok: true; freshness: F1Freshness; source: F1Source }[]
    const order: F1Freshness[] = ['fresh', 'cached', 'stale']
    const worst = good.map((p) => p.freshness).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0]
    return {
      ok: true,
      freshness: worst,
      source: good[0].source,
      data: {
        stints: stints.ok ? stints.data : [],
        pit: pit.ok ? pit.data : [],
        weather: weather.ok ? weather.data : [],
        raceControl: raceControl.ok ? raceControl.data : [],
        positions: positions.ok ? positions.data : [],
        overtakes: overtakes.ok ? overtakes.data : [],
        result: result.ok ? result.data : [],
        grid: grid.ok ? grid.data : [],
        missing: names.filter((_, i) => !parts[i].ok)
      }
    }
  }

  /** Gap and interval readings through a session, thinned. A race is tens of thousands of rows, so it is asked for apart. */
  intervals(sessionKey: number, endsAt: string | null): Promise<F1Answer<GapPoint[]>> {
    if (!Number.isInteger(sessionKey) || sessionKey <= 0) return this.invalid('That session is not valid.')
    const ended = endsAt ? Date.parse(endsAt) : NaN
    const settled = Number.isFinite(ended) && this.now() - ended > 3 * HOUR
    return this.get('openf1', `${BASE.openf1}/intervals?session_key=${sessionKey}`, settled ? 24 * HOUR : 30_000, (p) => normalizeIntervals(p))
  }

  /** One driver's car readings and positions between two instants (one lap, normally). */
  async telemetry(sessionKey: number, driverNumber: number, fromIso: string, toIso: string): Promise<F1Answer<{ car: CarSample[]; location: LocationSample[] }>> {
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
    const okIds = Number.isInteger(sessionKey) && sessionKey > 0 && Number.isInteger(driverNumber) && driverNumber > 0 && driverNumber < 100
    if (!okIds) return this.invalid('That request is not valid.')
    if (typeof fromIso !== 'string' || typeof toIso !== 'string' || !iso.test(fromIso) || !iso.test(toIso)) return this.invalid('That time is not valid.')
    const a = Date.parse(fromIso)
    const b = Date.parse(toIso)
    if (!(b > a) || b - a > 15 * MIN) return this.invalid('Telemetry is fetched one lap at a time.')
    const win = `session_key=${sessionKey}&driver_number=${driverNumber}&date%3E=${encodeURIComponent(fromIso)}&date%3C=${encodeURIComponent(toIso)}`
    // A finished lap's readings never change.
    const [car, location] = await Promise.all([
      this.get('openf1', `${BASE.openf1}/car_data?${win}`, 24 * HOUR, normalizeCarData),
      this.get('openf1', `${BASE.openf1}/location?${win}`, 24 * HOUR, normalizeLocation)
    ])
    if (!car.ok) return car
    return { ok: true, data: { car: car.data, location: location.ok ? location.data : [] }, freshness: car.freshness, source: car.source }
  }

  championship(sessionKey: number): Promise<F1Answer<ChampionshipRow[]>> {
    if (!Number.isInteger(sessionKey) || sessionKey <= 0) return this.invalid('That session is not valid.')
    return this.get('openf1', `${BASE.openf1}/championship_drivers?session_key=${sessionKey}`, 6 * HOUR, normalizeChampionship)
  }

  /** The recorded sessions of a season that can be replayed. */
  archive(year: number): Promise<F1Answer<ArchiveSession[]>> {
    if (!Number.isInteger(year) || year < 2018 || year > 2100) return this.invalid('The archive begins in 2018.')
    return this.get('f1archive', `${BASE.f1archive}/${year}/Index.json`, 30 * MIN, normalizeArchiveIndex, (d) => d.length > 0)
  }

  /**
   * Every race, sprint and qualifying result of a season, in pages of a hundred. A page that fails fails the whole
   * answer: half a season would give wrong totals without looking wrong.
   */
  async seasonData(season: number): Promise<F1Answer<{ results: SeasonRow[]; sprints: SeasonRow[]; qualifying: QualifyingRow[] }>> {
    if (!Number.isInteger(season) || season < 1950 || season > 2100) return this.invalid('That season is not valid.')
    const current = season >= new Date(this.now()).getUTCFullYear()
    const ttl = current ? 10 * MIN : 24 * HOUR
    const pages = async <T>(kind: string, normalize: (payload: unknown) => T[]): Promise<F1Answer<T[]>> => {
      const all: T[] = []
      let source: F1Source | null = null
      let freshness: F1Freshness = 'fresh'
      const order: F1Freshness[] = ['fresh', 'cached', 'stale']
      for (let page = 0, offset = 0; page < 12; page++, offset += 100) {
        let total = 0
        const a = await this.get(
          'jolpica',
          `${BASE.jolpica}/${season}/${kind}.json?limit=100&offset=${offset}`,
          ttl,
          (payload) => {
            const t = Number(((payload as { MRData?: { total?: string } })?.MRData ?? {}).total)
            total = Number.isFinite(t) ? t : 0
            return normalize(payload)
          }
        )
        if (!a.ok) return a
        if (order.indexOf(a.freshness) > order.indexOf(freshness)) freshness = a.freshness
        source = source ?? a.source
        all.push(...a.data)
        // The provider counts rows of the table (races), not result lines, so continue until a page comes back short.
        if (a.data.length === 0 || total === 0 || offset + 100 >= total) break
      }
      return { ok: true, data: all, source: source as F1Source, freshness }
    }
    const [results, sprints, qualifying] = await Promise.all([
      pages('results', (p) => normalizeSeasonRows(p, false)),
      pages('sprint', (p) => normalizeSeasonRows(p, true)),
      pages('qualifying', normalizeQualifying)
    ])
    if (!results.ok) return results
    return {
      ok: true,
      data: { results: results.data, sprints: sprints.ok ? sprints.data : [], qualifying: qualifying.ok ? qualifying.data : [] },
      source: results.source,
      freshness: results.freshness
    }
  }

  /**
   * One season's champion driver, runner-up and champion constructor: three small requests (the provider answers only
   * per season). The current, unfinished season gives the standings as they stand.
   */
  async seasonChampions(season: number): Promise<F1Answer<{ champion: ChampionRow | null; runnerUp: ChampionRow | null; constructor: ChampionRow | null }>> {
    if (!Number.isInteger(season) || season < 1950 || season > 2100) return this.invalid('That season is not valid.')
    const ttl = season >= new Date(this.now()).getUTCFullYear() ? 10 * MIN : 7 * 24 * HOUR
    const one = (path: string, kind: 'driver' | 'constructor'): Promise<F1Answer<ChampionRow[]>> => this.get('jolpica', `${BASE.jolpica}/${season}/${path}.json`, ttl, (b) => normalizeChampions(b, kind))
    const [d, r, c] = await Promise.all([one('driverStandings/1', 'driver'), one('driverStandings/2', 'driver'), season >= 1958 ? one('constructorStandings/1', 'constructor') : Promise.resolve(null)])
    if (!d.ok) return d
    return {
      ok: true,
      data: { champion: d.data[0] ?? null, runnerUp: r.ok ? (r.data[0] ?? null) : null, constructor: c && c.ok ? (c.data[0] ?? null) : null },
      source: d.source,
      freshness: d.freshness
    }
  }

  /**
   * The champion driver of every season from 1950 (one small request each, paced, then cached for a week). A season
   * that failed is listed as missing rather than leaving a quiet gap.
   */
  async championsAll(): Promise<F1Answer<{ drivers: ChampionRow[]; missing: number[] }>> {
    const last = new Date(this.now()).getUTCFullYear()
    const seasons = Array.from({ length: last - 1949 }, (_, i) => 1950 + i)
    // One at a time. When the provider says "slow down", wait out what it asked (up to ninety seconds) and go on,
    // rather than failing every season that is left; a season that still fails is listed as missing.
    const results: F1Answer<ChampionRow[]>[] = []
    for (const y of seasons) {
      const url = `${BASE.jolpica}/${y}/driverStandings/1.json`
      const ttl = y >= last ? 10 * MIN : 7 * 24 * HOUR
      let r = await this.get('jolpica', url, ttl, (b) => normalizeChampions(b, 'driver'))
      if (!r.ok && r.reason === 'rate-limited') {
        const wait = Math.min(90_000, Math.max(1000, this.blockedUntil.jolpica - this.now()))
        await this.sleep(wait)
        r = await this.get('jolpica', url, ttl, (b) => normalizeChampions(b, 'driver'))
      }
      results.push(r)
    }
    const drivers: ChampionRow[] = []
    const missing: number[] = []
    results.forEach((r, i) => {
      if (r.ok && r.data[0]) drivers.push(r.data[0])
      else missing.push(seasons[i])
    })
    if (drivers.length === 0) return results.find((r) => !r.ok) ?? { ok: false, reason: 'bad-response', message: 'No champions were returned.' }
    const first = results.find((r) => r.ok)
    return {
      ok: true,
      data: { drivers: drivers.sort((x, y) => y.season - x.season), missing },
      source: (first as Extract<F1Answer<unknown>, { ok: true }>).source,
      freshness: results.some((r) => r.ok && r.freshness === 'stale') ? 'stale' : 'fresh'
    }
  }

  /** The fastest lap of every race run at a circuit (2004 on), newest first: Jolpica holds fastest laps from that year. */
  circuitRecords(circuitId: string): Promise<F1Answer<CircuitRecord[]>> {
    if (typeof circuitId !== 'string' || !/^[a-z0-9_]{2,40}$/.test(circuitId)) return this.invalid('That circuit is not valid.')
    return this.get('jolpica', `${BASE.jolpica}/circuits/${circuitId}/fastest/1/results.json?limit=100`, 12 * HOUR, normalizeCircuitRecords, (d) => d.length > 0)
  }

  qualifying(season: number, round: number): Promise<F1Answer<QualifyingSession | null>> {
    if (!Number.isInteger(season) || season < 1994 || season > 2100 || !Number.isInteger(round) || round < 1 || round > 40) return this.invalid('That race is not valid.')
    return this.get('jolpica', `${BASE.jolpica}/${season}/${round}/qualifying.json?limit=100`, 12 * HOUR, normalizeQualifyingSession)
  }

  constructorSeason(season: number, constructorId: string): Promise<F1Answer<ConstructorRound[]>> {
    if (!Number.isInteger(season) || season < 1950 || season > 2100 || typeof constructorId !== 'string' || !/^[a-z0-9_]{2,40}$/.test(constructorId)) return this.invalid('That team or season is not valid.')
    return this.get('jolpica', `${BASE.jolpica}/${season}/constructors/${constructorId}/results.json?limit=100`, season >= new Date(this.now()).getUTCFullYear() ? 10 * MIN : 24 * HOUR, normalizeConstructorSeason)
  }

  /** The team-radio recordings OpenF1 lists for a session (2023 on). The clips themselves stay on F1's own host. */
  teamRadio(sessionKey: number): Promise<F1Answer<RadioClip[]>> {
    if (!Number.isInteger(sessionKey) || sessionKey < 1) return this.invalid('That session is not valid.')
    return this.get('openf1', `${BASE.openf1}/team_radio?session_key=${sessionKey}`, 10 * MIN, normalizeTeamRadio)
  }

  /** The weather forecast for a circuit at a session's start. Open-Meteo reaches about two weeks ahead, and no further is claimed. */
  forecast(lat: number, long: number, startsAt: string): Promise<F1Answer<Forecast | null>> {
    const t = Date.parse(startsAt)
    if (!Number.isFinite(lat) || !Number.isFinite(long) || Math.abs(lat) > 90 || Math.abs(long) > 180 || Number.isNaN(t)) return this.invalid('That place or time is not valid.')
    const ahead = t - this.now()
    if (ahead < -3 * HOUR) return this.invalid('That session has already happened.')
    if (ahead > 15 * 24 * HOUR) return this.invalid('A forecast only reaches about two weeks ahead.')
    const url = `${BASE.openmeteo}/forecast?latitude=${lat.toFixed(3)}&longitude=${long.toFixed(3)}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,cloud_cover&timezone=UTC&forecast_days=16`
    return this.get('openmeteo', url, 30 * MIN, (b) => pickForecast(b, startsAt), (d) => d !== null)
  }

  /** One driver's finishing position, points and wins in every season they raced. */
  career(driverId: string): Promise<F1Answer<CareerSeason[]>> {
    if (typeof driverId !== 'string' || !/^[a-z0-9_]{2,40}$/.test(driverId)) return this.invalid('That driver is not valid.')
    return this.get('jolpica', `${BASE.jolpica}/drivers/${driverId}/driverStandings.json?limit=100`, 6 * HOUR, normalizeCareer)
  }

  /** What the Sources panel shows: honest counts, no addresses with secrets (there are none) and no guessed uptime. */
  status(): { provider: F1Provider; base: string; requests: number; failures: number; lastOkAt: string | null; lastError: string | null; rateLimitedUntil: string | null; cached: number }[] {
    return (['jolpica', 'openf1', 'f1archive', 'openmeteo'] as const).map((provider) => {
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
        cached: [...this.cache.values()].filter((e) => e.url.startsWith(BASE[provider])).length
      }
    })
  }

  // ---- internals ---------------------------------------------------------------------------------------------------------------

  private invalid<T>(message: string): Promise<F1Answer<T>> {
    return Promise.resolve({ ok: false, reason: 'invalid-request', message } satisfies F1Failure)
  }

  private seasonPath(season: number | 'current'): string | null {
    if (season === 'current') return 'current'
    return Number.isInteger(season) && season >= 1950 && season <= 2100 ? String(season) : null
  }

  private roundPath(round: number | 'last'): string | null {
    if (round === 'last') return 'last'
    return Number.isInteger(round) && round >= 1 && round <= 40 ? String(round) : null
  }

  private standingsPath(season: number | 'current', round: number | undefined, kind: string): string | null {
    const s = this.seasonPath(season)
    if (!s) return null
    if (round === undefined) return `${s}/${kind}.json`
    return Number.isInteger(round) && round >= 1 && round <= 40 ? `${s}/${round}/${kind}.json` : null
  }

  private async get<T>(
    provider: F1Provider,
    url: string,
    ttlMs: number,
    normalize: (payload: unknown) => T,
    acceptable: (data: T) => boolean = () => true
  ): Promise<F1Answer<T>> {
    const cached = this.cache.get(url)
    const age = cached ? this.now() - cached.at : Infinity
    if (cached && age < ttlMs) {
      return this.answer(provider, url, normalize(cached.body), 'cached', cached.at)
    }
    const pending = this.inFlight.get(url)
    let outcome: { body: unknown } | F1Failure
    if (pending) {
      outcome = (await pending) as { body: unknown } | F1Failure
    } else {
      const run = this.fetchOnce(provider, url)
      this.inFlight.set(url, run)
      try {
        outcome = await run
      } finally {
        this.inFlight.delete(url)
      }
    }
    if ('ok' in outcome) {
      // Failed. The last good answer is better than nothing, but it is said to be old.
      if (cached) return this.answer(provider, url, normalize(cached.body), 'stale', cached.at)
      return outcome
    }
    const data = normalize(outcome.body)
    if (!acceptable(data)) {
      return { ok: false, reason: 'bad-response', message: 'The provider answered, but the answer had nothing usable in it.' }
    }
    this.cache.set(url, { body: outcome.body, at: this.now(), url })
    return this.answer(provider, url, data, 'fresh', this.now())
  }

  private answer<T>(provider: F1Provider, url: string, data: T, freshness: F1Freshness, at: number): F1Answer<T> {
    return { ok: true, data, freshness, source: { provider, url, retrievedAt: new Date(at).toISOString() } }
  }

  private fetchOnce(provider: F1Provider, url: string): Promise<{ body: unknown } | F1Failure> {
    // Queue behind earlier requests to this provider so the spacing holds under concurrency.
    const turn = this.lane[provider].then(async () => {
      const wait = this.lastSent[provider] + SPACING_MS[provider] - this.now()
      if (wait > 0) await this.sleep(wait)
      this.lastSent[provider] = this.now()
    })
    this.lane[provider] = turn.catch(() => undefined)
    return turn.then(() => this.send(provider, url))
  }

  private async send(provider: F1Provider, url: string): Promise<{ body: unknown } | F1Failure> {
    const stats = this.stats[provider]
    if (this.blockedUntil[provider] > this.now()) {
      return { ok: false, reason: 'rate-limited', message: 'The data provider asked Orbis to slow down; it will be asked again shortly.' }
    }
    stats.requests += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await this.fetchFn(url, { signal: controller.signal })
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after'))
        this.blockedUntil[provider] = this.now() + (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 300) * 1000 : 30_000)
        return this.fail(provider, 'rate-limited', 'The data provider asked Orbis to slow down.')
      }
      // OpenF1 answers 404 with a plain message when a query matches nothing: that is "nothing", not "broken".
      if (res.status === 404 && provider === 'openf1') {
        stats.lastOkAt = this.now()
        return { body: [] }
      }
      // Formula 1 closed its recording archive behind a sign-in during 2026: every address under
      // livetiming.formula1.com/static now answers 401 whatever is sent, while live timing itself is still open. That
      // is not a fault anybody can retry out of, so it is said as a plain sentence instead of as a status code.
      if ((res.status === 401 || res.status === 403) && provider === 'f1archive') {
        return this.fail(provider, 'provider-error', 'Formula 1 no longer lets anything read its recorded-session archive without a sign-in, so finished sessions cannot be replayed. Live timing is unaffected.')
      }
      if (!res.ok) return this.fail(provider, 'provider-error', `The data provider answered with an error (${res.status}).`)
      // Bodies may begin with a byte-order mark, which JSON.parse refuses.
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

  private fail(provider: F1Provider, reason: F1Failure['reason'], message: string): F1Failure {
    const stats = this.stats[provider]
    stats.failures += 1
    stats.lastError = message
    return { ok: false, reason, message }
  }
}
