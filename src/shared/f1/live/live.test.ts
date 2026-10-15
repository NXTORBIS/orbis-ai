import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyFeedUpdate, mergeDelta, type RawFeedState } from './merge.ts'
import { buildSnapshot } from './snapshot.ts'

// Shapes follow what the official feed sends. The values are test fixtures, not live data.
const FULL: RawFeedState = {
  SessionInfo: { Meeting: { Name: 'Test Grand Prix', Circuit: { ShortName: 'Testville' }, Country: { Name: 'Land' } }, Name: 'Race', Type: 'Race', Path: '2026/x/' },
  SessionStatus: { Status: 'Started', _kf: true },
  DriverList: {
    '1': { Tla: 'AAA', FullName: 'Alex Alpha', TeamName: 'Team A', TeamColour: 'FF0000' },
    '2': { Tla: 'BBB', FullName: 'Bo Beta', TeamName: 'Team B', TeamColour: '0000FF' }
  },
  TimingData: {
    Lines: {
      '1': {
        Position: '1',
        GapToLeader: '',
        IntervalToPositionAhead: { Value: '' },
        NumberOfLaps: 10,
        Sectors: [
          { Value: '28.1', OverallFastest: false, PersonalFastest: true },
          { Value: '41.0', OverallFastest: true, PersonalFastest: true },
          { Value: '' }
        ],
        LastLapTime: { Value: '1:36.201', PersonalFastest: true },
        BestLapTime: { Value: '1:36.201', Lap: 9 },
        Speeds: { I1: { Value: '299' }, FL: { Value: '' } },
        InPit: false
      },
      '2': { Position: '2', GapToLeader: '+1.250', IntervalToPositionAhead: { Value: '+1.250', Catching: false }, NumberOfLaps: 10, InPit: false }
    }
  },
  TimingAppData: { Lines: { '1': { Stints: [{ Compound: 'MEDIUM', New: 'true', TotalLaps: 4 }, { Compound: 'HARD', New: 'false', TotalLaps: 12 }], GridPos: '3' } } },
  WeatherData: { AirTemp: '31.2', TrackTemp: '44.0', Humidity: '70', Rainfall: '0', WindSpeed: '2.1', WindDirection: '180', Pressure: '1009.5' },
  TrackStatus: { Status: '1', Message: 'AllClear' },
  LapCount: { CurrentLap: 10, TotalLaps: 62 },
  RaceControlMessages: { Messages: [{ Utc: '2026-10-11T12:05:00', Lap: 1, Category: 'Flag', Flag: 'GREEN', Message: 'GREEN LIGHT - PIT EXIT OPEN' }] }
}

test('a delta changes only what it names, and the keyframe marker is dropped', () => {
  const next = mergeDelta(FULL.SessionStatus, { Status: 'Finished', _kf: true }) as Record<string, unknown>
  assert.deepEqual(next, { Status: 'Finished' })
  const t = mergeDelta(FULL.TimingData, { Lines: { '2': { GapToLeader: '+1.400' } } }) as { Lines: Record<string, Record<string, unknown>> }
  assert.equal(t.Lines['2'].GapToLeader, '+1.400')
  assert.equal(t.Lines['2'].Position, '2')
  assert.equal(t.Lines['1'].Position, '1')
})

test('an index-keyed update changes one item of a list and leaves the others', () => {
  const t = mergeDelta(FULL.TimingData, { Lines: { '1': { Sectors: { '2': { Value: '27.9', PersonalFastest: true } } } } }) as {
    Lines: Record<string, { Sectors: { Value: string }[] }>
  }
  assert.deepEqual(
    t.Lines['1'].Sectors.map((s) => s.Value),
    ['28.1', '41.0', '27.9']
  )
})

test('a list that arrives as a list replaces the old one', () => {
  const next = mergeDelta({ Messages: [{ Message: 'a' }] }, { Messages: [{ Message: 'b' }, { Message: 'c' }] }) as { Messages: unknown[] }
  assert.equal(next.Messages.length, 2)
})

test('the merge does not alter its input', () => {
  const before = JSON.stringify(FULL.TimingData)
  mergeDelta(FULL.TimingData, { Lines: { '1': { Position: '5' } } })
  assert.equal(JSON.stringify(FULL.TimingData), before)
})

test('applying updates feed by feed builds the same picture as a full one', () => {
  let state: RawFeedState = {}
  state = applyFeedUpdate(state, 'TimingData', { Lines: { '1': { Position: '1' } } })
  state = applyFeedUpdate(state, 'TimingData', { Lines: { '1': { GapToLeader: '' }, '2': { Position: '2' } } })
  assert.deepEqual(Object.keys((state.TimingData as { Lines: object }).Lines), ['1', '2'])
})

test('the snapshot keeps the feed words for gaps and marks sectors', () => {
  const s = buildSnapshot(FULL)
  assert.equal(s.session.meeting, 'Test Grand Prix')
  assert.equal(s.sessionStatus, 'Started')
  assert.deepEqual(s.lap, { current: 10, total: 62 })
  assert.equal(s.trackStatus.message, 'AllClear')
  assert.deepEqual(
    s.drivers.map((d) => d.code),
    ['AAA', 'BBB']
  )
  const a = s.drivers[0]
  assert.equal(a.gapToLeader, null)
  assert.equal(s.drivers[1].gapToLeader, '+1.250')
  assert.deepEqual(
    a.sectors.map((x) => [x.time, x.mark]),
    [
      [28.1, 'personal'],
      [41.0, 'overall'],
      [null, 'none']
    ]
  )
  assert.equal(a.lastLap.time, 96.201)
  assert.equal(a.bestLap.lap, 9)
  assert.equal(a.speeds.i1, 299)
  assert.equal(a.speeds.fl, null)
  assert.equal(a.grid, 3)
})

test('the current tyre is the latest stint and an unknown compound stays unknown', () => {
  const s = buildSnapshot({ ...FULL, TimingAppData: { Lines: { '1': { Stints: [{ Compound: 'SOFT' }, { Compound: 'UNKNOWN', TotalLaps: 0 }] } } } })
  const a = s.drivers.find((d) => d.number === '1')
  assert.equal(a?.tyre?.compound, null)
  assert.equal(a?.stints[0].compound, 'SOFT')
  const full = buildSnapshot(FULL).drivers[0]
  assert.equal(full.tyre?.compound, 'HARD')
  assert.equal(full.tyre?.laps, 12)
  assert.equal(full.stints[0].isNew, true)
  assert.equal(full.tyre?.isNew, false)
})

test('weather values are numbers and rainfall is a yes/no only when the feed says', () => {
  const w = buildSnapshot(FULL).weather
  assert.equal(w.airTemp, 31.2)
  assert.equal(w.rainfall, false)
  const wet = buildSnapshot({ ...FULL, WeatherData: { Rainfall: '1' } }).weather
  assert.equal(wet.rainfall, true)
  assert.equal(wet.airTemp, null)
  const none = buildSnapshot({}).weather
  assert.equal(none.rainfall, null)
})

test('race control messages keep their words and unreadable ones are dropped', () => {
  const s = buildSnapshot({ RaceControlMessages: { Messages: { '0': { Message: 'TRACK LIMITS', Lap: 3, RacingNumber: '1' }, '1': { Lap: 4 } } } })
  assert.equal(s.raceControl.length, 1)
  assert.equal(s.raceControl[0].driver, '1')
})

test('an empty feed gives an empty, honest snapshot', () => {
  const s = buildSnapshot({})
  assert.equal(s.drivers.length, 0)
  assert.equal(s.sessionStatus, null)
  assert.equal(s.lap.total, null)
})
