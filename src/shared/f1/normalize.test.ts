import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  lapStats,
  normalizeConstructorStandings,
  normalizeDriverStandings,
  normalizeLaps,
  normalizeResults,
  normalizeSchedule,
  normalizeSessions,
  normalizeTimingDrivers,
  sessionBest,
  sessionBestSectors
} from './normalize.ts'
import { compareTimes, formatDelta, formatLapTime, parseLapTime } from './time.ts'

// Shapes copied from real responses of api.jolpi.ca and api.openf1.org. Values are test fixtures, not live data.
const SCHEDULE = {
  MRData: {
    RaceTable: {
      season: '2026',
      Races: [
        {
          season: '2026',
          round: '2',
          raceName: 'Second Grand Prix',
          Circuit: { circuitId: 'c2', circuitName: 'Second Circuit', Location: { locality: 'Town', country: 'Land' } },
          date: '2026-03-15',
          time: '07:00:00Z'
        },
        {
          season: '2026',
          round: '1',
          raceName: 'Australian Grand Prix',
          Circuit: { circuitId: 'albert_park', circuitName: 'Albert Park Grand Prix Circuit', Location: { locality: 'Melbourne', country: 'Australia' } },
          date: '2026-03-08',
          time: '04:00:00Z',
          FirstPractice: { date: '2026-03-06', time: '01:30:00Z' },
          Qualifying: { date: '2026-03-07', time: '05:00:00Z' }
        },
        { season: '2026', round: 'x' }
      ]
    }
  }
}

test('the calendar is ordered by round, keeps session times, and drops rows it cannot read', () => {
  const races = normalizeSchedule(SCHEDULE)
  assert.deepEqual(
    races.map((r) => r.round),
    [1, 2]
  )
  assert.equal(races[0].startsAt, '2026-03-08T04:00:00Z')
  assert.deepEqual(
    races[0].sessions.map((s) => s.name),
    ['Practice 1', 'Qualifying']
  )
  assert.equal(races[0].country, 'Australia')
})

test('a calendar entry with no time keeps its date and no invented time', () => {
  const r = normalizeSchedule({ MRData: { RaceTable: { Races: [{ season: '2026', round: '3', raceName: 'X', Circuit: { circuitId: 'c', circuitName: 'C' }, date: '2026-04-01' }] } } })
  assert.equal(r[0].startsAt, '2026-04-01')
})

test('results keep the provider text for time and mark missing values as null', () => {
  const payload = {
    MRData: {
      RaceTable: {
        Races: [
          {
            season: '2026',
            round: '17',
            raceName: 'Singapore Grand Prix',
            Circuit: { circuitId: 'marina_bay', circuitName: 'Marina Bay Street Circuit' },
            date: '2026-10-11',
            time: '12:00:00Z',
            Results: [
              {
                position: '1',
                positionText: '1',
                points: '25',
                Driver: { driverId: 'max_verstappen', permanentNumber: '3', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                Constructor: { constructorId: 'red_bull', name: 'Red Bull' },
                grid: '1',
                laps: '62',
                status: 'Finished',
                Time: { millis: '6120785', time: '1:42:00.785' },
                FastestLap: { rank: '5', lap: '44', Time: { time: '1:36.201' } }
              },
              { position: '20', positionText: 'R', points: '0', Driver: { driverId: 'x', givenName: 'A', familyName: 'B' }, Constructor: { name: 'Y' }, status: 'Engine' }
            ]
          }
        ]
      }
    }
  }
  const r = normalizeResults(payload)
  assert.ok(r)
  assert.equal(r.rows[0].timeText, '1:42:00.785')
  assert.equal(r.rows[0].fastestLap?.timeText, '1:36.201')
  assert.equal(r.rows[1].timeText, null)
  assert.equal(r.rows[1].grid, null)
  assert.equal(r.rows[1].positionText, 'R')
  assert.equal(r.rows[1].fastestLap, null)
})

test('a round with no results yet is null rather than an empty table presented as a result', () => {
  assert.equal(normalizeResults({ MRData: { RaceTable: { Races: [] } } }), null)
  assert.equal(normalizeResults({}), null)
  assert.equal(normalizeResults(null), null)
})

test('standings read the round they stand after, and points are numbers', () => {
  const d = normalizeDriverStandings({
    MRData: {
      StandingsTable: {
        StandingsLists: [
          {
            season: '2026',
            round: '17',
            DriverStandings: [{ position: '1', positionText: '1', points: '340', wins: '8', Driver: { driverId: 'antonelli', givenName: 'Andrea Kimi', familyName: 'Antonelli' }, Constructors: [{ constructorId: 'mercedes', name: 'Mercedes' }] }]
          }
        ]
      }
    }
  })
  assert.equal(d?.round, 17)
  assert.equal(d?.rows[0].points, 340)
  assert.equal(d?.rows[0].constructors[0].name, 'Mercedes')
  const c = normalizeConstructorStandings({
    MRData: { StandingsTable: { StandingsLists: [{ season: '2026', round: '17', ConstructorStandings: [{ position: '1', points: '578', wins: '11', Constructor: { constructorId: 'mercedes', name: 'Mercedes' } }] }] } }
  })
  assert.equal(c?.rows[0].points, 578)
})

test('sessions are ordered by start time and need a key and both times', () => {
  const s = normalizeSessions([
    { session_key: 2, session_name: 'Race', date_start: '2026-10-11T12:00:00+00:00', date_end: '2026-10-11T14:00:00+00:00', circuit_short_name: 'Singapore', year: 2026 },
    { session_key: 1, session_name: 'Practice 1', date_start: '2026-10-09T09:30:00+00:00', date_end: '2026-10-09T10:30:00+00:00' },
    { session_key: 3, session_name: 'No end', date_start: '2026-10-10T09:30:00+00:00' }
  ])
  assert.deepEqual(
    s.map((x) => x.key),
    [1, 2]
  )
})

const LAPS = normalizeLaps([
  { driver_number: 1, lap_number: 1, lap_duration: null, duration_sector_1: 34.3, duration_sector_2: 42.7, duration_sector_3: 28.0, is_pit_out_lap: true },
  { driver_number: 1, lap_number: 2, lap_duration: 99.1, duration_sector_1: 29.5, duration_sector_2: 41.9, duration_sector_3: 27.7, is_pit_out_lap: false },
  { driver_number: 1, lap_number: 3, lap_duration: 98.4, duration_sector_1: 29.1, duration_sector_2: 41.3, duration_sector_3: 27.9, is_pit_out_lap: false },
  { driver_number: 4, lap_number: 2, lap_duration: 97.9, duration_sector_1: 29.0, duration_sector_2: 41.2, duration_sector_3: 27.7, is_pit_out_lap: false },
  { driver_number: 4, lap_number: 3, lap_duration: 0, is_pit_out_lap: false },
  { lap_number: 9 }
])

test('laps without a driver are dropped and a zero duration is not a lap time', () => {
  assert.equal(LAPS.length, 5)
  assert.equal(LAPS.find((l) => l.driverNumber === 4 && l.lap === 3)?.duration, null)
})

test('driver figures use eligible laps only: no out-lap, no missing time', () => {
  const s = lapStats(LAPS, 1)
  assert.equal(s.lapsRecorded, 3)
  assert.equal(s.lapsEligible, 2)
  assert.deepEqual(s.best, { lap: 3, duration: 98.4 })
  assert.equal(s.median, (99.1 + 98.4) / 2)
  assert.deepEqual(s.bestSectors, [29.1, 41.3, 27.7])
  const none = lapStats(LAPS, 99)
  assert.equal(none.best, null)
  assert.equal(none.median, null)
})

test('the session best and best sectors come from eligible laps across drivers', () => {
  assert.deepEqual(sessionBest(LAPS), { driverNumber: 4, lap: 2, duration: 97.9 })
  assert.deepEqual(sessionBestSectors(LAPS), [29.0, 41.2, 27.7])
})

test('timing drivers are keyed by number and ordered', () => {
  const d = normalizeTimingDrivers([
    { driver_number: 4, name_acronym: 'NOR', full_name: 'Lando NORRIS', team_name: 'McLaren', team_colour: 'F47600' },
    { driver_number: 1, name_acronym: 'VER', full_name: 'Max VERSTAPPEN' },
    { driver_number: 4, name_acronym: 'NOR', full_name: 'Lando NORRIS' }
  ])
  assert.deepEqual(
    d.map((x) => x.number),
    [1, 4]
  )
  assert.equal(d[1].colour, null)
})

test('lap times format, parse and compare without turning missing into zero', () => {
  assert.equal(formatLapTime(96.201), '1:36.201')
  assert.equal(formatLapTime(59.9), '59.900')
  assert.equal(formatLapTime(60), '1:00.000')
  assert.equal(formatLapTime(null), '–')
  assert.equal(parseLapTime('1:36.201'), 96.201)
  assert.equal(parseLapTime('1:42:00.785'), 6120.785)
  assert.equal(parseLapTime('abc'), null)
  assert.equal(parseLapTime(null), null)
  assert.equal(formatDelta(98.7, 98.4), '+0.300')
  assert.equal(formatDelta(98.1, 98.4), '-0.300')
  assert.equal(formatDelta(null, 98.4), '–')
  assert.deepEqual([97, null, 96].sort(compareTimes), [96, 97, null])
})
