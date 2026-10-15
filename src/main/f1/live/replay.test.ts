import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { test } from 'node:test'

import { carPointsFrom, carTelemetryFrom, decodeCompressed, lastAtOrBefore, parseJsonStream, parseOffset } from './archive.ts'
import { ReplayEngine, type ReplayData } from './replay.ts'
import { FeedClient, type FeedConnectionState, type SocketLike } from './signalr.ts'

const z = (obj: unknown): string => deflateRawSync(Buffer.from(JSON.stringify(obj))).toString('base64')

test('stream offsets parse and the byte-order mark and damaged lines are tolerated', () => {
  assert.equal(parseOffset('01:09:00.051'), 4140051)
  assert.equal(parseOffset('nope'), null)
  const parsed = parseJsonStream('﻿00:00:01.000{"a":1}\n00:00:02.500{broken\n00:00:03.000{"b":2}\n')
  assert.deepEqual(
    parsed.map((p) => p.t),
    [1000, 3000]
  )
})

test('compressed feed values decode, and garbage decodes to null', () => {
  assert.deepEqual(decodeCompressed(z({ hello: 'world' })), { hello: 'world' })
  assert.equal(decodeCompressed('!!!not base64 deflate'), null)
  assert.equal(decodeCompressed(42), null)
})

test('car positions and telemetry keep the real spacing inside a batch', () => {
  const pos = carPointsFrom([
    {
      t: 10_000,
      data: z({
        Position: [
          { Timestamp: '2026-10-11T12:00:00.000Z', Entries: { '1': { Status: 'OnTrack', X: 10, Y: 20, Z: 1 } } },
          { Timestamp: '2026-10-11T12:00:00.500Z', Entries: { '1': { Status: 'OffTrack', X: 11, Y: 21, Z: 1 } } }
        ]
      })
    }
  ])
  assert.deepEqual(
    pos.get('1')?.map((p) => [p.t, p.onTrack]),
    [
      [10_000, true],
      [10_500, false]
    ]
  )
  const tel = carTelemetryFrom([{ t: 5000, data: z({ Entries: [{ Utc: '2026-10-11T12:00:00.000Z', Cars: { '4': { Channels: { '0': 11000, '2': 301, '3': 7, '4': 100, '5': 0, '45': 12 } } } }] }) }])
  assert.deepEqual(tel.get('4')?.[0], { t: 5000, rpm: 11000, speed: 301, gear: 7, throttle: 100, brake: 0, drs: 12 })
})

test('binary search finds the last point at or before a time', () => {
  const pts = [{ t: 0 }, { t: 10 }, { t: 20 }]
  assert.equal(lastAtOrBefore(pts, -1), -1)
  assert.equal(lastAtOrBefore(pts, 10), 1)
  assert.equal(lastAtOrBefore(pts, 99), 2)
})

function replayData(): ReplayData {
  return {
    sessionInfo: { Name: 'Race', Meeting: { Name: 'Test GP' } },
    feeds: {
      SessionStatus: [
        { t: 0, data: { Status: 'Inactive' } },
        { t: 5000, data: { Status: 'Started' } },
        { t: 200_000, data: { Status: 'Finished' } }
      ],
      DriverList: [{ t: 0, data: { '1': { Tla: 'AAA', FullName: 'Alex Alpha' } } }],
      TimingData: [
        { t: 6000, data: { Lines: { '1': { Position: '1', NumberOfLaps: 1 } } } },
        { t: 70_000, data: { Lines: { '1': { NumberOfLaps: 2, GapToLeader: '' } } } },
        { t: 130_000, data: { Lines: { '1': { NumberOfLaps: 3 } } } }
      ]
    },
    positions: new Map([['1', [{ t: 6000, x: 1, y: 2, z: 0, onTrack: true }]]]),
    telemetry: new Map([['1', [{ t: 6000, speed: 250, rpm: 10000, gear: 6, throttle: 90, brake: 0, drs: 0 }]]])
  }
}

test('replay answers "what did the feeds say at t", forward and backward', () => {
  const r = new ReplayEngine(replayData())
  assert.equal(r.snapshotAt(1000).sessionStatus, 'Inactive')
  assert.equal(r.snapshotAt(10_000).sessionStatus, 'Started')
  assert.equal(r.snapshotAt(10_000).drivers[0].code, 'AAA')
  assert.equal(r.snapshotAt(250_000).sessionStatus, 'Finished')
  // Back in time: the earlier state, not a mixture.
  assert.equal(r.snapshotAt(1000).sessionStatus, 'Inactive')
  assert.equal(r.snapshotAt(1000).drivers[0].position, null)
  assert.equal(r.durationMs, 200_000)
})

test('cars appear only while their last reading is recent', () => {
  const r = new ReplayEngine(replayData())
  assert.equal(r.carsAt(3000).length, 0)
  const at = r.carsAt(7000)
  assert.equal(at.length, 1)
  assert.equal(at[0].speed, 250)
  assert.equal(r.carsAt(60_000).length, 0)
})

test('with too few laps there is no outline, rather than a made-up one', () => {
  assert.equal(new ReplayEngine(replayData()).outline(), null)
})

// ---- the connection --------------------------------------------------------------------------------------------------------------

class FakeSocket implements SocketLike {
  sent: string[] = []
  closed = false
  private handlers: Record<string, ((ev: { data?: unknown }) => void)[]> = {}
  send(d: string): void {
    this.sent.push(d)
  }
  close(): void {
    this.closed = true
  }
  addEventListener(type: string, fn: (ev: { data?: unknown }) => void): void {
    ;(this.handlers[type] ??= []).push(fn)
  }
  emit(type: string, ev: { data?: unknown } = {}): void {
    for (const f of this.handlers[type] ?? []) f(ev)
  }
}

function rig(options: { negotiateOk?: boolean } = {}) {
  let clock = 0
  const timers: { at: number; fn: () => void; id: number; dead?: boolean }[] = []
  let seq = 0
  const sockets: FakeSocket[] = []
  const states: string[] = []
  const changes: [string, unknown][] = []
  let snapshot: Record<string, unknown> | null = null
  const client = new FeedClient({
    feeds: ['TimingData'],
    negotiate: async () => ({ ok: options.negotiateOk ?? true, status: options.negotiateOk === false ? 503 : 200, cookies: '', body: { connectionToken: 'tok' } }),
    socketUrl: (t) => `wss://example.test/?id=${t}`,
    socket: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    onSnapshot: (s) => (snapshot = s),
    onChange: (f, c) => changes.push([f, c]),
    onState: (s: FeedConnectionState) => states.push(s),
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { at: clock + ms, fn, id: ++seq }
      timers.push(t)
      return t
    },
    clearTimer: (h) => {
      ;(h as { dead?: boolean }).dead = true
    },
    silenceMs: 45_000,
    pingEveryMs: 15_000
  })
  const advance = (ms: number): void => {
    const end = clock + ms
    for (;;) {
      const due = timers.filter((t) => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      due.dead = true
      clock = due.at
      due.fn()
    }
    clock = end
  }
  const flush = (): Promise<void> => new Promise((r) => setImmediate(r))
  return { client, sockets, states, changes, advance, flush, snapshot: () => snapshot, setClock: (n: number) => (clock = n) }
}

const RS = '\u001e'

test('handshake, then a subscription, then the snapshot and then changes', async () => {
  const t = rig()
  t.client.start()
  await t.flush()
  const s = t.sockets[0]
  s.emit('open')
  assert.equal(s.sent[0], JSON.stringify({ protocol: 'json', version: 1 }) + RS)
  s.emit('message', { data: '{}' + RS })
  assert.equal(JSON.parse(s.sent[1].replace(RS, '')).target, 'Subscribe')
  s.emit('message', { data: JSON.stringify({ type: 3, invocationId: '1', result: { TimingData: { Lines: {} } } }) + RS })
  assert.deepEqual(t.snapshot(), { TimingData: { Lines: {} } })
  assert.ok(t.states.includes('connected'))
  s.emit('message', { data: JSON.stringify({ type: 1, target: 'feed', arguments: ['TimingData', { Lines: { '1': {} } }, 'ts'] }) + RS })
  assert.equal(t.changes[0][0], 'TimingData')
  t.client.stop()
  assert.equal(s.closed, true)
})

test('two records in one frame are both read', async () => {
  const t = rig()
  t.client.start()
  await t.flush()
  const s = t.sockets[0]
  s.emit('open')
  s.emit('message', { data: '{}' + RS })
  const a = JSON.stringify({ type: 1, target: 'feed', arguments: ['A', { v: 1 }] })
  const b = JSON.stringify({ type: 1, target: 'feed', arguments: ['B', { v: 2 }] })
  s.emit('message', { data: a + RS + b + RS })
  assert.deepEqual(
    t.changes.map((c) => c[0]),
    ['A', 'B']
  )
})

test('a connection that goes silent is dropped and re-established with a growing wait', async () => {
  const t = rig()
  t.client.start()
  await t.flush()
  t.sockets[0].emit('open')
  t.sockets[0].emit('message', { data: '{}' + RS })
  t.advance(50_000)
  assert.equal(t.sockets[0].closed, true)
  assert.ok(t.states.includes('reconnecting'))
  t.advance(1500)
  await t.flush()
  assert.equal(t.sockets.length, 2)
  assert.equal(t.client.stats.reconnects, 1)
  assert.equal(FeedClient.backoff(1), 1000)
  assert.equal(FeedClient.backoff(3), 4000)
  assert.equal(FeedClient.backoff(20), 30_000)
})

test('a refused negotiation retries instead of crashing', async () => {
  const t = rig({ negotiateOk: false })
  t.client.start()
  await t.flush()
  assert.equal(t.sockets.length, 0)
  assert.ok(t.states.includes('reconnecting'))
  assert.match(t.client.stats.lastError ?? '', /refused/)
  t.client.stop()
})

test('pings are sent while connected', async () => {
  const t = rig()
  t.client.start()
  await t.flush()
  t.sockets[0].emit('open')
  t.sockets[0].emit('message', { data: '{}' + RS })
  t.sockets[0].emit('message', { data: JSON.stringify({ type: 3, result: {} }) + RS })
  t.advance(16_000)
  assert.ok(t.sockets[0].sent.some((m) => m === JSON.stringify({ type: 6 }) + RS))
})
