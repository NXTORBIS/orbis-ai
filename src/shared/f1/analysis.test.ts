import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  pitStopsByTeam,
  slowStops,
  COVERAGE,
  compoundComparison,
  constructorContribution,
  constructorDuel,
  coverageFor,
  driverConsistency,
  driverForm,
  leadGaps,
  normalizeChampions,
  planSensitivity,
  positionProgression,
  projectStint,
  seasonPercentiles,
  titleCounts
} from './analysis.ts'
import type { SeasonRow } from './season.ts'

function row(over: Partial<SeasonRow> & { driverId: string; round: number }): SeasonRow {
  return {
    season: 2026,
    raceName: `GP ${over.round}`,
    sprint: false,
    driverCode: null,
    driverName: over.driverId.toUpperCase(),
    constructorId: 'a',
    constructorName: 'A',
    position: 1,
    positionText: '1',
    grid: 1,
    points: 25,
    status: 'Finished',
    laps: 50,
    fastestLapRank: null,
    classified: true,
    ...over
  }
}

test('form: the last races newest first, a retirement stays what it was', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((r) => row({ driverId: 'x', round: r, position: r === 4 ? null : r, positionText: r === 4 ? 'R' : String(r), classified: r !== 4 }))
  const f = driverForm(rows, 'x', 3)
  assert.deepEqual(f.map((e) => e.round), [6, 5, 4])
  assert.equal(f[2].positionText, 'R')
  assert.equal(f[2].classified, false)
})

test('consistency: classified only, pit-lane starts have no gain, too few finishes give no stdev', () => {
  const rows = [
    row({ driverId: 'x', round: 1, position: 3, grid: 5 }),
    row({ driverId: 'x', round: 2, position: 8, grid: 4 }),
    row({ driverId: 'x', round: 3, position: 2, grid: 0 }),
    row({ driverId: 'x', round: 4, position: null, classified: false, grid: 2 })
  ]
  const c = driverConsistency(rows, 'x')
  assert.equal(c.n, 3)
  assert.equal(c.best, 2)
  assert.equal(c.worst, 8)
  assert.equal(c.avgGain, (2 + -4) / 2)
  assert.equal(c.bestGain?.places, 2)
  assert.equal(c.worstLoss?.places, -4)
  assert.ok(c.stdev !== null)
  assert.equal(driverConsistency(rows.slice(0, 2), 'x').stdev, null)
  assert.equal(driverConsistency([], 'nobody').mean, null)
})

test('percentiles need five placed drivers and enough entries', () => {
  const rows: SeasonRow[] = []
  for (let d = 1; d <= 6; d++) for (let r = 1; r <= 4; r++) rows.push(row({ driverId: `d${d}`, round: r, position: d, positionText: String(d), points: 25 - d * 3, grid: d }))
  rows.push(row({ driverId: 'rookie', round: 1, position: 7, positionText: '7', points: 0, grid: 7 }))
  const p = seasonPercentiles(rows)
  const top = p.find((x) => x.driverId === 'd1')!
  const bottom = p.find((x) => x.driverId === 'd6')!
  assert.equal(top.finish, 100)
  assert.equal(bottom.finish, 0)
  assert.equal(p.find((x) => x.driverId === 'rookie')!.finish, null)
  assert.equal(seasonPercentiles(rows.filter((r) => r.driverId !== 'd5' && r.driverId !== 'd6' && r.driverId !== 'd4')).every((x) => x.finish === null), true)
})

test('constructor contribution and duel', () => {
  const rows = [
    row({ driverId: 'a1', round: 1, constructorId: 'a', position: 1, points: 25, grid: 1 }),
    row({ driverId: 'a2', round: 1, constructorId: 'a', position: 5, points: 10, grid: 4 }),
    row({ driverId: 'b1', round: 1, constructorId: 'b', position: 2, points: 18, grid: 2 }),
    row({ driverId: 'a1', round: 2, constructorId: 'a', position: 6, points: 8, grid: 3 }),
    row({ driverId: 'b1', round: 2, constructorId: 'b', position: 3, points: 15, grid: 5 }),
    row({ driverId: 'b2', round: 3, constructorId: 'b', position: null, classified: false, points: 0, grid: 6 }),
    row({ driverId: 'a1', round: 3, constructorId: 'a', position: null, classified: false, points: 0, grid: 7 })
  ]
  const c = constructorContribution(rows, 'a')
  assert.equal(c.total, 43)
  assert.equal(c.drivers[0].driverId, 'a1')
  assert.ok(Math.abs((c.drivers[0].share as number) - 33 / 43) < 1e-9)
  const d = constructorDuel(rows, 'a', 'b')
  assert.equal(d.rounds, 3)
  assert.equal(d.aAhead, 1)
  assert.equal(d.bAhead, 1)
  assert.equal(d.aPoints, 43)
  assert.equal(d.bPoints, 33)
  assert.equal(constructorContribution(rows, 'nobody').drivers.length, 0)
})

test('lead gaps and position progression follow the totals', () => {
  const p = new Map([
    ['a', { name: 'A', points: [{ round: 1, total: 25 }, { round: 2, total: 40 }] }],
    ['b', { name: 'B', points: [{ round: 1, total: 18 }, { round: 2, total: 43 }] }]
  ])
  assert.deepEqual(leadGaps(p, ['a']).get('a'), [{ round: 1, gap: 0 }, { round: 2, gap: 3 }])
  assert.deepEqual(positionProgression(p, ['a']).get('a'), [{ round: 1, position: 1 }, { round: 2, position: 2 }])
})

test('champions: one row per season, newest first, names and team; titles counted', () => {
  const payload = {
    MRData: {
      StandingsTable: {
        StandingsLists: [
          { season: '2019', round: '21', DriverStandings: [{ points: '413', wins: '11', Driver: { givenName: 'Lewis', familyName: 'Hamilton' }, Constructors: [{ name: 'Mercedes' }] }] },
          { season: '2020', round: '17', DriverStandings: [{ points: '347', wins: '11', Driver: { givenName: 'Lewis', familyName: 'Hamilton' }, Constructors: [{ name: 'Mercedes' }] }] },
          { season: '2021', round: '22', DriverStandings: [] }
        ]
      }
    }
  }
  const c = normalizeChampions(payload, 'driver')
  assert.deepEqual(c.map((x) => x.season), [2020, 2019])
  assert.equal(c[0].team, 'Mercedes')
  assert.equal(titleCounts(c)[0].titles, 2)
})

test('coverage: what exists in a season depends on the season', () => {
  assert.ok(COVERAGE.length >= 8)
  assert.equal(coverageFor(1985).length, 2)
  assert.ok(coverageFor(2024).length > coverageFor(2005).length)
})

test('projection: needs eight laps and a real trend; the band carries the spread', () => {
  const ages = Array.from({ length: 12 }, (_, i) => i + 1)
  const times = ages.map((a) => 90 + 0.05 * a + (a % 2 ? 0.1 : -0.1))
  const p = projectStint(ages, times, 5)
  assert.ok(p)
  assert.equal(p.points.length, 5)
  assert.ok(Math.abs(p.perLap - 0.05) < 0.02)
  assert.ok(p.points[0].low < p.points[0].seconds && p.points[0].seconds < p.points[0].high)
  assert.equal(projectStint(ages.slice(0, 6), times.slice(0, 6)), null)
  assert.equal(projectStint(ages, ages.map((_, i) => 90 + (i % 2 ? 0.3 : -0.3))), null)
})

test('sensitivity: a slower pit stop costs time, a missing assumption gives nothing', () => {
  const plan = [{ compound: 'MEDIUM', laps: 25 }, { compound: 'HARD', laps: 30 }]
  const a = { basePace: { MEDIUM: 90, HARD: 90.5 }, wear: { MEDIUM: 0.05, HARD: 0.03 }, pitLoss: 22 }
  const s = planSensitivity(plan, a)
  assert.ok(s)
  assert.ok(Math.abs(s.rows[0].delta - 2) < 1e-9)
  assert.ok(Math.abs(s.rows[1].delta + 2) < 1e-9)
  assert.ok(s.rows[2].delta > 0)
  assert.equal(planSensitivity([{ compound: 'SOFT', laps: 10 }], a), null)
})

test('compounds: nulls stay null, not zero', () => {
  const c = compoundComparison([
    { compound: 'SOFT', median: 90, laps: 10, trend: 0.08 },
    { compound: 'SOFT', median: 91, laps: 12, trend: null },
    { compound: 'HARD', median: null, laps: 5, trend: null }
  ])
  const soft = c.find((x) => x.compound === 'SOFT')!
  assert.equal(soft.pace, 90.5)
  assert.equal(soft.wear, 0.08)
  assert.equal(soft.laps, 22)
  assert.equal(c.find((x) => x.compound === 'HARD')!.pace, null)
})

test('pit stops by team: median of measured stops only; slow stops need enough stops and sit past the fence', () => {
  const stops = [
    { driverNumber: 1, lap: 10, laneDuration: 22 },
    { driverNumber: 2, lap: 11, laneDuration: 23 },
    { driverNumber: 3, lap: 12, laneDuration: 21.5 },
    { driverNumber: 4, lap: 13, laneDuration: 22.5 },
    { driverNumber: 5, lap: 14, laneDuration: 22.2 },
    { driverNumber: 6, lap: 15, laneDuration: 22.8 },
    { driverNumber: 7, lap: 16, laneDuration: 21.9 },
    { driverNumber: 8, lap: 17, laneDuration: 45 },
    { driverNumber: 1, lap: 40, laneDuration: null }
  ]
  const team = (n: number): string => (n <= 2 || n === 8 ? 'A' : 'B')
  const t = pitStopsByTeam(stops, team)
  const a = t.find((x) => x.team === 'A')!
  assert.equal(a.stops, 4)
  assert.equal(a.best, 22)
  assert.equal(slowStops(stops).length, 1)
  assert.equal(slowStops(stops)[0].driverNumber, 8)
  assert.deepEqual(slowStops(stops.slice(0, 5)), [])
})
