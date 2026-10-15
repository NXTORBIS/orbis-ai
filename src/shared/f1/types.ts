/**
 * Orbis Arena -> F1: the models every F1 view shares.
 *
 * Two rules run through all of it. A value that a source did not supply is `null`, never 0 or an empty string made
 * up to fill the cell. And every record says which provider it came from, so a number on the screen can be traced.
 */

export type F1Provider = 'jolpica' | 'openf1' | 'f1archive' | 'openmeteo'

/** Where a value came from and how old it is. Attached to every answer the service gives. */
export interface F1Source {
  provider: F1Provider
  /** The address that was asked (never contains a secret: neither provider takes a key). */
  url: string
  /** When Orbis received the answer. */
  retrievedAt: string
}

export type F1Freshness =
  /** Just fetched from the provider. */
  | 'fresh'
  /** Answered from Orbis's cache, within its freshness window. */
  | 'cached'
  /** The provider could not be reached; this is the last good answer, older than its window. */
  | 'stale'

export interface F1Envelope<T> {
  data: T
  source: F1Source
  freshness: F1Freshness
}

export interface F1Failure {
  ok: false
  reason: 'offline' | 'rate-limited' | 'provider-error' | 'bad-response' | 'invalid-request'
  message: string
}

export type F1Answer<T> = ({ ok: true } & F1Envelope<T>) | F1Failure

export interface F1Driver {
  /** The provider's stable id (Jolpica: "max_verstappen"). OpenF1 drivers have only a number, so this is null there. */
  id: string | null
  code: string | null
  number: number | null
  name: string
  nationality: string | null
}

export interface F1Constructor {
  id: string | null
  name: string
  /** Team colour as 6 hex digits, without '#', when the provider supplies it. */
  colour: string | null
}

export interface F1Race {
  season: number
  round: number
  name: string
  circuitId: string
  circuitName: string
  locality: string | null
  country: string | null
  /** Where the circuit is, when the schedule says (Jolpica's circuit location). */
  lat?: number | null
  long?: number | null
  /** UTC instant of the race start, or null when the schedule has no time yet. */
  startsAt: string | null
  /** The other sessions of the weekend that the schedule lists, in time order. */
  sessions: { name: string; startsAt: string | null }[]
}

export interface F1ResultRow {
  position: number | null
  /** "R", "D", "W" and the like when the driver is not classified. */
  positionText: string
  driver: F1Driver
  constructor: F1Constructor
  grid: number | null
  laps: number | null
  status: string
  points: number
  /** Total race time in seconds for the winner, or the gap text for others, exactly as the provider gave it. */
  timeText: string | null
  fastestLap: { rank: number | null; lap: number | null; timeText: string | null } | null
}

export interface F1RaceResult {
  race: F1Race
  rows: F1ResultRow[]
}

export interface F1DriverStanding {
  position: number
  positionText: string
  points: number
  wins: number
  driver: F1Driver
  constructors: F1Constructor[]
}

export interface F1ConstructorStanding {
  position: number
  positionText: string
  points: number
  wins: number
  constructor: F1Constructor
}

export interface F1Standings<T> {
  season: number
  /** The round after which this table stands. */
  round: number
  rows: T[]
}

export interface F1Session {
  key: number
  meetingKey: number
  name: string
  type: string
  startsAt: string
  endsAt: string
  circuitName: string
  country: string | null
  year: number
}

export interface F1TimingDriver {
  number: number
  code: string
  name: string
  team: string | null
  colour: string | null
}

export interface F1Lap {
  driverNumber: number
  lap: number
  startedAt: string | null
  /** Seconds, or null when the lap has no recorded duration (an incomplete or deleted lap). */
  duration: number | null
  sectors: [number | null, number | null, number | null]
  /** Speed-trap readings in km/h, as the provider labels them. */
  speeds: { i1: number | null; i2: number | null; finishLine: number | null }
  isPitOut: boolean
}

export interface F1SessionTiming {
  session: F1Session
  drivers: F1TimingDriver[]
  laps: F1Lap[]
}

export interface F1LapStats {
  driverNumber: number
  lapsRecorded: number
  /** Laps counted in the figures below: they have a duration and are not out-laps. */
  lapsEligible: number
  best: { lap: number; duration: number } | null
  median: number | null
  average: number | null
  /** Best sector time of each sector across this driver's eligible laps. */
  bestSectors: [number | null, number | null, number | null]
}

import type { Overtake, PositionChange, RaceControlEntry, SessionResultRow, StartingGridRow, WeatherPoint } from './race.ts'
import type { PitStop, Stint } from './strategy.ts'

/** Everything recorded about one finished session besides its laps. `missing` names parts the provider could not supply. */
export interface F1SessionBundle {
  stints: Stint[]
  pit: PitStop[]
  weather: WeatherPoint[]
  raceControl: RaceControlEntry[]
  positions: PositionChange[]
  overtakes: Overtake[]
  result: SessionResultRow[]
  grid: StartingGridRow[]
  missing: string[]
}
