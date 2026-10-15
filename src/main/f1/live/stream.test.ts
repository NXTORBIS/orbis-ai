import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { test } from 'node:test'

import { StreamService, type StreamEvent } from './stream.ts'
import type { SocketLike } from './signalr.ts'

const RS = '\u001e'
const z = (o: unknown): string => deflateRawSync(Buffer.from(JSON.stringify(o))).toString('base64')

class Sock implements SocketLike {
  sent: string[] = []
  private h: Record<string, ((e: { data?: unknown }) => void)[]> = {}
  send(d: string): void {
    this.sent.push(d)
  }
  close(): void {}
  addEventListener(t: string, f: (e: { data?: unknown }) => void): void {
    ;(this.h[t] ??= []).push(f)
  }
  emit(t: string, e: { data?: unknown } = {}): void {
    for (const f of this.h[t] ?? []) f(e)
  }
}

function liveRig() {
  let clock = 1_000_000
  const events: StreamEvent[] = []
  const socks: Sock[] = []
  const svc = new StreamService({
    clientOptions: {
      negotiate: async () => ({ ok: true, status: 200, cookies: '', body: { connectionToken: 't' } }),
      socketUrl: (t) => `wss://x/${t}`,
      socket: () => {
        const s = new Sock()
        socks.push(s)
        return s
      }
    },
    fetchText: async () => {
      throw new Error('no archive in this test')
    },
    archiveBase: 'https://archive.test/static/',
    emit: (e) => events.push(e),
    now: () => clock,
    setInterval: () => 0,
    clearInterval: () => undefined
  })
  const connect = async (snapshot: Record<string, unknown>): Promise<Sock> => {
    svc.startLive()
    await new Promise((r) => setImmediate(r))
    const s = socks[socks.length - 1]
    s.emit('open')
    s.emit('message', { data: '{}' + RS })
    s.emit('message', { data: JSON.stringify({ type: 3, result: snapshot }) + RS })
    return s
  }
  return { svc, events, connect, advance: (ms: number) => (clock += ms), socks }
}

test('a connected feed whose session finished is "last-session", never "live"', async () => {
  const r = liveRig()
  await r.connect({ SessionStatus: { Status: 'Finalised' }, DriverList: { '1': { Tla: 'AAA' } } })
  const s = r.svc.status()
  assert.equal(s.phase, 'last-session')
  assert.match(s.message, /Not live/)
  assert.equal(r.svc.event().snapshot.drivers[0].code, 'AAA')
  r.svc.stopAll()
})

test('a started session with fresh records is live, and goes stale when records stop', async () => {
  const r = liveRig()
  await r.connect({ SessionStatus: { Status: 'Started' } })
  assert.equal(r.svc.status().phase, 'live')
  r.advance(30_000)
  assert.equal(r.svc.status().phase, 'stale')
  r.svc.stopAll()
})

test('changes after the snapshot are merged into the picture', async () => {
  const r = liveRig()
  const s = await r.connect({ SessionStatus: { Status: 'Started' }, TimingData: { Lines: { '1': { Position: '1', GapToLeader: '' } } } })
  s.emit('message', { data: JSON.stringify({ type: 1, target: 'feed', arguments: ['TimingData', { Lines: { '1': { Position: '2' } } }, 't'] }) + RS })
  assert.equal(r.svc.event().snapshot.drivers[0].position, 2)
  r.svc.stopAll()
})

test('live car positions are decoded and kept per car', async () => {
  const r = liveRig()
  const s = await r.connect({ SessionStatus: { Status: 'Started' } })
  const pos = z({ Position: [{ Timestamp: '2026-10-11T12:00:00Z', Entries: { '4': { Status: 'OnTrack', X: 100, Y: 200, Z: 5 } } }] })
  s.emit('message', { data: JSON.stringify({ type: 1, target: 'feed', arguments: ['Position.z', pos, 't'] }) + RS })
  const car = z({ Entries: [{ Utc: '2026-10-11T12:00:00Z', Cars: { '4': { Channels: { '2': 288, '3': 7, '4': 100, '5': 0, '0': 11800, '45': 12 } } } }] })
  s.emit('message', { data: JSON.stringify({ type: 1, target: 'feed', arguments: ['CarData.z', car, 't'] }) + RS })
  const c = r.svc.event().cars[0]
  assert.equal(c.number, '4')
  assert.equal(c.x, 100)
  assert.equal(c.speed, 288)
  assert.equal(c.drs, 12)
  r.svc.stopAll()
})

test('a lost connection says so and keeps the last data marked as possibly old', async () => {
  const r = liveRig()
  await r.connect({ SessionStatus: { Status: 'Started' }, DriverList: { '1': { Tla: 'AAA' } } })
  // The service closes the connection.
  const s = r.socks[0]
  s.emit('message', { data: JSON.stringify({ type: 7 }) + RS })
  const st = r.svc.status()
  assert.equal(st.phase, 'disconnected')
  assert.match(st.message, /may be old/)
  assert.equal(r.svc.event().snapshot.drivers.length, 1)
  r.svc.stopAll()
})

// ---- replay --------------------------------------------------------------------------------------------------------------------

function replayRig(files: Record<string, string>) {
  const events: StreamEvent[] = []
  const svc = new StreamService({
    clientOptions: { negotiate: async () => ({ ok: false, status: 0, cookies: '', body: null }), socketUrl: () => '', socket: () => new Sock() },
    fetchText: async (url) => {
      const key = url.replace('https://archive.test/static/2026/m/s/', '')
      if (key in files) return files[key]
      throw new Error('404')
    },
    archiveBase: 'https://archive.test/static/',
    emit: (e) => events.push(e),
    setInterval: () => 0,
    clearInterval: () => undefined
  })
  return { svc, events }
}

const FILES = {
  'SessionInfo.json': '﻿{"Name":"Race","Meeting":{"Name":"Test GP"}}',
  'SessionStatus.jsonStream': '﻿00:00:00.000{"Status":"Inactive"}\n00:00:05.000{"Status":"Started"}\n00:10:00.000{"Status":"Finished"}\n',
  'DriverList.jsonStream': '﻿00:00:00.000{"1":{"Tla":"AAA","FullName":"Alex Alpha"}}\n',
  'TimingData.jsonStream': '﻿00:00:06.000{"Lines":{"1":{"Position":"1","NumberOfLaps":1}}}\n'
}

test('a recorded session loads, is always labelled replay, and obeys seek, play and speed', async () => {
  const r = replayRig(FILES)
  const loaded = await r.svc.loadReplay('2026/m/s/')
  assert.deepEqual(loaded.ok && loaded.durationMs, 600_000)
  assert.equal(r.svc.status().phase, 'replay')
  assert.match(r.svc.status().message, /REPLAY/)
  r.svc.replayControl('seek', 10_000)
  assert.equal(r.svc.event().snapshot.sessionStatus, 'Started')
  assert.equal(r.svc.event().snapshot.drivers[0].code, 'AAA')
  r.svc.replayControl('seek', 599_000)
  r.svc.replayControl('seek', 700_000)
  assert.equal(r.svc.status().replay?.t, 600_000)
  assert.equal(r.svc.event().snapshot.sessionStatus, 'Finished')
  r.svc.replayControl('speed', 7)
  assert.equal(r.svc.status().replay?.speed, 1)
  r.svc.replayControl('speed', 8)
  assert.equal(r.svc.status().replay?.speed, 8)
  r.svc.replayControl('play')
  assert.equal(r.svc.status().replay?.t, 0)
  assert.equal(r.svc.status().replay?.playing, true)
})

test('a path that is not an archive session path is refused before anything is fetched', async () => {
  const r = replayRig(FILES)
  const bad = await r.svc.loadReplay('../../etc/passwd')
  assert.equal(bad.ok, false)
})

test('a session with no timing at all is reported, not shown as an empty replay', async () => {
  const r = replayRig({ 'SessionInfo.json': '{}' })
  const loaded = await r.svc.loadReplay('2026/m/s/')
  assert.equal(loaded.ok, false)
  assert.equal(r.svc.status().source, 'none')
})
