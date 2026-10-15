import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyScenario, contendersFrom, maxPerRound, possibility, rulesFor, type Contender } from './championship.ts'
import { safeFileName, toCsv } from './csv.ts'
import { driverSeasonStats, headToHead, normalizeCareer, normalizeQualifying, normalizeSeasonRows, pointsProgression } from './season.ts'

const race = (round: number, rows: object[]): object => ({ season: '2026', round: String(round), raceName: `GP ${round}`, Circuit: { circuitId: 'c', circuitName: 'C' }, Results: rows })
const res = (id: string, team: string, pos: number | null, pts: number, extra: object = {}): object => ({
  position: pos === null ? undefined : String(pos),
  positionText: pos === null ? 'R' : String(pos),
  points: String(pts),
  Driver: { driverId: id, code: id.slice(0, 3).toUpperCase(), givenName: id, familyName: 'X' },
  Constructor: { constructorId: team, name: team },
  grid: '1',
  status: pos === null ? 'Engine' : 'Finished',
  laps: '60',
  ...extra
})

const PAYLOAD = {
  MRData: {
    RaceTable: {
      Races: [
        race(1, [res('alpha', 'red', 1, 25), res('beta', 'red', 2, 18), res('gamma', 'blue', 3, 15)]),
        race(2, [res('beta', 'red', 1, 25), res('alpha', 'red', null, 0), res('gamma', 'blue', 2, 18)]),
        race(3, [res('alpha', 'red', 2, 18), res('beta', 'red', 3, 15), res('gamma', 'blue', 1, 25)])
      ]
    }
  }
}
const rows = normalizeSeasonRows(PAYLOAD, false)

test('rows carry the provider words and whether a driver was classified', () => {
  assert.equal(rows.length, 9)
  const dnf = rows.find((r) => r.driverId === 'alpha' && r.round === 2)
  assert.equal(dnf?.classified, false)
  assert.equal(dnf?.position, null)
  assert.equal(rows.find((r) => r.driverId === 'alpha' && r.round === 1)?.classified, true)
  assert.equal(normalizeSeasonRows({}, false).length, 0)
})

test('season statistics count wins, podiums, DNFs and average only classified finishes', () => {
  const s = driverSeasonStats(rows, 'alpha')
  assert.equal(s.entries, 3)
  assert.equal(s.wins, 1)
  assert.equal(s.podiums, 2)
  assert.equal(s.dnfs, 1)
  assert.equal(s.points, 43)
  assert.equal(s.avgFinish, 1.5)
  assert.equal(s.bestFinish, 1)
})

test('teammate comparison counts only shared rounds, and a retirement is not a comparable finish', () => {
  const qr = (id: string, pos: string): object => ({ position: pos, Driver: { driverId: id }, Constructor: { constructorId: 'red' } })
  const q = normalizeQualifying({
    MRData: {
      RaceTable: {
        Races: [
          { season: '2026', round: '1', QualifyingResults: [qr('alpha', '1'), qr('beta', '2')] },
          { season: '2026', round: '2', QualifyingResults: [qr('alpha', '3'), qr('beta', '1')] }
        ]
      }
    }
  })
  const h = headToHead(rows, q, 'alpha', 'beta')
  assert.equal(h.sharedRounds, 3)
  // Round 2: alpha retired, so the race comparison covers rounds 1 and 3 only.
  assert.deepEqual(h.race, { rounds: 2, a: 2, b: 0 })
  assert.deepEqual(h.qualifying, { rounds: 2, a: 1, b: 1 })
  // Different teams: nothing to compare.
  assert.equal(headToHead(rows, q, 'alpha', 'gamma').sharedRounds, 0)
})

test('cumulative points go up by what was scored each round and skip nothing', () => {
  const p = pointsProgression(rows, 'driver').get('alpha')
  assert.deepEqual(
    p?.points.map((x) => x.total),
    [25, 25, 43]
  )
  const t = pointsProgression(rows, 'constructor').get('red')
  assert.deepEqual(
    t?.points.map((x) => x.total),
    [43, 68, 101]
  )
})

test('a career is one line per season, in order', () => {
  const c = normalizeCareer({
    MRData: {
      StandingsTable: {
        StandingsLists: [
          { season: '2024', DriverStandings: [{ position: '1', points: '400', wins: '9', Constructors: [{ name: 'A' }] }] },
          { season: '2023', DriverStandings: [{ position: '3', points: '200', wins: '2', Constructors: [{ name: 'B' }] }] }
        ]
      }
    }
  })
  assert.deepEqual(
    c.map((x) => x.season),
    [2023, 2024]
  )
})

// ---- championship ----------------------------------------------------------------------------------------------------------------

test('rules are chosen by season and a season without rules is refused', () => {
  assert.equal(rulesFor(2020)?.fastestLapPoint, true)
  assert.equal(rulesFor(2025)?.fastestLapPoint, false)
  assert.equal(rulesFor(2022)?.sprint[0], 8)
  assert.equal(rulesFor(2021)?.sprint[0], 3)
  assert.equal(rulesFor(1985), null)
  assert.equal(maxPerRound(rulesFor(2024)!, true), 25 + 8 + 1)
  assert.equal(maxPerRound(rulesFor(2025)!, false), 25)
})

const C = (id: string, points: number, wins = 0, finishes: number[] = []): Contender => ({ id, name: id, points, wins, finishes })

test('mathematical possibility follows the points left, and levels are called tie-break only', () => {
  const rules = rulesFor(2026)!
  const left = [
    { round: 20, name: 'A', hasSprint: false },
    { round: 21, name: 'B', hasSprint: false }
  ]
  const all = [C('lead', 300), C('chase', 260), C('level', 250), C('far', 249)]
  assert.equal(possibility(all[1], all, left, rules), 'possible')
  assert.equal(possibility(all[2], all, left, rules), 'only-on-tiebreak')
  assert.equal(possibility(all[3], all, left, rules), 'out')
  const late = [{ round: 21, name: 'B', hasSprint: false }]
  assert.equal(possibility(C('level', 275), [C('lead', 300), C('level', 275)], late, rules), 'only-on-tiebreak')
  assert.equal(possibility(C('far', 270), [C('lead', 300), C('far', 270)], late, rules), 'out')
  assert.equal(possibility(C('lead', 400), [C('lead', 400), C('x', 300)], late, rules), 'champion')
})

test('a scenario adds the rules points and gives the fastest-lap point only inside the top ten and in an era that has it', () => {
  const base = [C('a', 100, 3, [3]), C('b', 100, 2, [2, 1])]
  const r2024 = applyScenario(base, [{ round: 1, hasSprint: false, race: { a: 1, b: 11 }, sprint: {}, fastestLap: 'b' }], rulesFor(2024)!)
  assert.equal(r2024.rows.find((r) => r.id === 'b')?.points, 100)
  assert.equal(r2024.rows[0].id, 'a')
  assert.equal(r2024.rows[0].points, 125)
  const withFl = applyScenario(base, [{ round: 1, hasSprint: false, race: { a: 2, b: 1 }, sprint: {}, fastestLap: 'a' }], rulesFor(2024)!)
  assert.equal(withFl.rows.find((r) => r.id === 'a')?.points, 100 + 18 + 1)
  const noFl = applyScenario(base, [{ round: 1, hasSprint: false, race: { a: 2, b: 1 }, sprint: {}, fastestLap: 'a' }], rulesFor(2026)!)
  assert.equal(noFl.rows.find((r) => r.id === 'a')?.points, 100 + 18)
})

test('sprints score only on sprint weekends, and ties fall to wins then second places', () => {
  const base = [C('a', 100, 1, [1]), C('b', 100, 0, [0, 2])]
  const s = applyScenario(base, [{ round: 1, hasSprint: false, race: {}, sprint: { a: 1 } }], rulesFor(2026)!)
  assert.equal(s.rows.find((r) => r.id === 'a')?.points, 100)
  const tied = applyScenario(base, [], rulesFor(2026)!)
  assert.equal(tied.rows[0].id, 'a')
  assert.deepEqual(tied.unresolvedTies, [])
  const exact = applyScenario([C('x', 50, 1, [1]), C('y', 50, 1, [1])], [], rulesFor(2026)!)
  assert.deepEqual(exact.unresolvedTies, [['x', 'y']])
})

test('standings can be rebuilt from result rows', () => {
  const c = contendersFrom(rows, 'driver')
  assert.equal(c[0].id, 'beta')
  assert.equal(c.find((x) => x.id === 'alpha')?.wins, 1)
  assert.equal(contendersFrom(rows, 'constructor')[0].id, 'red')
})

test('csv quotes what needs quoting and leaves missing values empty', () => {
  const csv = toCsv(['Driver', 'Time'], [['Smith, J', 96.2], ['O"Neil', null]])
  assert.equal(csv, '﻿Driver,Time\r\n"Smith, J",96.2\r\n"O""Neil",\r\n')
  assert.equal(safeFileName('Singapore GP / Race: laps.csv'), 'Singapore_GP_Race_laps.csv')
  assert.equal(safeFileName('///'), 'export')
})
