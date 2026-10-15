import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  circuitRecord,
  emptyPrefs,
  estimateCorners,
  normalizeCircuitRecords,
  normalizeConstructorSeason,
  normalizeQualifyingSession,
  normalizeTeamRadio,
  parseLapText,
  pickForecast,
  reportHtml,
  sanitizePrefs
} from './extras.ts'

const lap = (season: string, round: string, time: string | null, name = 'Singapore Grand Prix') => ({
  season,
  round,
  raceName: name,
  Results: [{ Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' }, Constructor: { name: 'McLaren' }, FastestLap: time ? { lap: '52', Time: { time }, AverageSpeed: { speed: '190.1' } } : undefined }]
})
const wrap = (races: unknown[]) => ({ MRData: { RaceTable: { Races: races } } })

test('lap times parse; text that is not a lap time is null, not 0', () => {
  assert.equal(parseLapText('1:35.867'), 95.867)
  assert.equal(parseLapText('59.5'), 59.5)
  assert.equal(parseLapText('DNF'), null)
  assert.equal(parseLapText(null), null)
})

test('circuit records: newest first, the record is the quickest lap, a race with no lap time cannot be the record', () => {
  const rows = normalizeCircuitRecords(wrap([lap('2008', '15', '1:45.599'), lap('2023', '16', '1:35.867'), lap('2024', '17', null), lap('2019', '15', '1:41.905')]))
  assert.deepEqual(rows.map((r) => r.season), [2024, 2023, 2019, 2008])
  const rec = circuitRecord(rows)
  assert.equal(rec?.season, 2023)
  assert.equal(rows[0].seconds, null)
  assert.equal(circuitRecord([]), null)
})

test('qualifying keeps each driver, and says how deep they got', () => {
  const q = normalizeQualifyingSession(
    wrap([
      {
        season: '2026',
        round: '5',
        raceName: 'X Grand Prix',
        Circuit: { circuitName: 'Circuit' },
        QualifyingResults: [
          { position: '1', Driver: { driverId: 'a', givenName: 'A', familyName: 'One', code: 'ONE' }, Constructor: { name: 'T' }, Q1: '1:30.1', Q2: '1:29.5', Q3: '1:28.9' },
          { position: '15', Driver: { driverId: 'b', givenName: 'B', familyName: 'Two' }, Constructor: { name: 'T' }, Q1: '1:31.0' },
          { position: '20', Driver: { driverId: 'c', givenName: 'C', familyName: 'Three' }, Constructor: { name: 'T' } }
        ]
      }
    ])
  )
  assert.deepEqual(q?.lines.map((l) => l.reached), [3, 1, null])
  assert.equal(normalizeQualifyingSession(wrap([])), null)
})

test('constructor season: both cars, points per round', () => {
  const s = normalizeConstructorSeason(
    wrap([
      {
        round: '2',
        raceName: 'B',
        Results: [
          { position: '1', positionText: '1', grid: '1', points: '25', status: 'Finished', Driver: { driverId: 'a', givenName: 'A', familyName: 'One' } },
          { position: '5', positionText: '5', grid: '4', points: '10', status: 'Finished', Driver: { driverId: 'b', givenName: 'B', familyName: 'Two' } }
        ]
      },
      { round: '1', raceName: 'A', Results: [] }
    ])
  )
  assert.deepEqual(s.map((r) => r.round), [1, 2])
  assert.equal(s[1].points, 35)
})

test('team radio keeps only clips on F1’s own host, in time order', () => {
  const c = normalizeTeamRadio([
    { driver_number: 1, date: '2023-09-15T09:40:00.000000+00:00', recording_url: 'https://livetiming.formula1.com/static/a.mp3' },
    { driver_number: 4, date: '2023-09-15T09:39:00.000000+00:00', recording_url: 'https://livetiming.formula1.com/static/b.mp3' },
    { driver_number: 5, date: '2023-09-15T09:41:00.000000+00:00', recording_url: 'https://evil.example/c.mp3' },
    { driver_number: 6, date: 'soon', recording_url: 'https://livetiming.formula1.com/static/d.mp3' }
  ])
  assert.deepEqual(c.map((x) => x.driverNumber), [4, 1])
})

test('forecast: the nearest hour within ninety minutes, else nothing', () => {
  const payload = { hourly: { time: ['2026-10-18T12:00', '2026-10-18T13:00', '2026-10-18T14:00'], temperature_2m: [28, 30, 31], precipitation_probability: [10, 40, 60], wind_speed_10m: [8, 9, 10], cloud_cover: [20, 50, 80] } }
  const f = pickForecast(payload, '2026-10-18T13:10:00Z')
  assert.equal(f?.temperatureC, 30)
  assert.equal(f?.rainChancePct, 40)
  assert.equal(pickForecast(payload, '2026-10-20T13:00:00Z'), null)
  assert.equal(pickForecast({}, '2026-10-18T13:00:00Z'), null)
})

test('corners are found where the path turns, once each, and an oval has none', () => {
  // A rounded rectangle: four turns.
  const pts: { x: number; y: number }[] = []
  const side = (x0: number, y0: number, x1: number, y1: number, n: number) => {
    for (let i = 0; i < n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n })
  }
  side(0, 0, 100, 0, 60)
  side(100, 0, 100, 40, 40)
  side(100, 40, 0, 40, 60)
  side(0, 40, 0, 0, 40)
  const c = estimateCorners(pts)
  assert.ok(c.length >= 3 && c.length <= 6, `found ${c.length}`)
  assert.deepEqual(c.map((x) => x.number), c.map((_, i) => i + 1))
  assert.deepEqual(estimateCorners([{ x: 0, y: 0 }]), [])
  const line = Array.from({ length: 80 }, (_, i) => ({ x: i, y: 0 }))
  assert.equal(estimateCorners(line).length, 0)
})

test('prefs are cleaned: bad ids, duplicates and odd lead times are dropped', () => {
  const p = sanitizePrefs({ watchlist: ['max_verstappen', 'max_verstappen', '../x', 5], alerts: { sessions: false }, leadMinutes: 7 })
  assert.deepEqual(p.watchlist, ['max_verstappen'])
  assert.deepEqual(p.alerts, { sessions: false, results: true })
  assert.equal(p.leadMinutes, 15)
  assert.deepEqual(sanitizePrefs('x'), emptyPrefs())
})

test('a report is one escaped page with no script and no outside resource', () => {
  const html = reportHtml('Race <1>', [{ heading: 'Top "3"', header: ['Pos', 'Driver'], rows: [[1, 'A & B'], [2, null]] }], { source: 'Jolpica-F1', madeAt: '2026-10-15' })
  assert.ok(!/<script|http:\/\/|https:\/\/|src=/i.test(html))
  assert.ok(html.includes('Race &lt;1&gt;'))
  assert.ok(html.includes('A &amp; B'))
  assert.ok(html.includes('<td>—</td>'))
})
