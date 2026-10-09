import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPABILITY_LABELS,
  CONNECTION_STATES,
  SOURCES,
  capabilitiesFrom,
  describeConnection,
  missing,
  newConnection,
  sourcesThatNeedNothing,
  stateFromStatus,
  usable
} from './connection.ts'

describe('music source connections', () => {
  it('only one state counts as connected', () => {
    const connected = Object.entries(CONNECTION_STATES).filter(([, one]) => one.connected).map(([id]) => id)
    assert.deepEqual(connected, ['connected'])
  })

  it('a service needing registration starts as not set up, not as broken', () => {
    const one = newConnection('spotify', false)
    assert.equal(one.state, 'not-set-up')
    assert.match(describeConnection(one, 0), /not set up/i)
  })

  it('once configured it is ready to connect, which is still not connected', () => {
    const one = newConnection('spotify', true)
    assert.equal(one.state, 'ready-to-connect')
    assert.equal(CONNECTION_STATES[one.state].connected, false)
    assert.equal(usable(one, 0).ok, false)
  })

  it('a source needing nothing is ready without any configuration', () => {
    for (const source of sourcesThatNeedNothing()) {
      assert.equal(newConnection(source.id, false).state, 'ready-to-connect', source.id)
    }
    assert.ok(sourcesThatNeedNothing().length >= 3)
  })

  it('a connection that has expired is not usable, whatever it was stored as', () => {
    const one = { ...newConnection('spotify', true), state: 'connected' as const, expiresAt: 1000, capabilities: capabilitiesFrom({ readPlaylistTracks: true }) }
    assert.equal(usable(one, 500).ok, true)
    assert.equal(usable(one, 2000).ok, false)
    assert.match(describeConnection(one, 2000), /again/i)
  })

  it('connected but not allowed to read tracks is not usable', () => {
    const one = { ...newConnection('spotify', true), state: 'connected' as const, capabilities: capabilitiesFrom({ listPlaylists: true }) }
    const out = usable(one, 0)
    assert.equal(out.ok, false)
    assert.match(out.why, /not allowed to read/i)
  })

  it('a connected card names the account when the service gave one', () => {
    const one = { ...newConnection('spotify', true), state: 'connected' as const, account: 'ksran' }
    assert.match(describeConnection(one, 0), /connected as ksran/i)
  })

  it('a problem is shown next to the state rather than swallowed', () => {
    const one = { ...newConnection('spotify', true), state: 'broken' as const, lastProblem: 'no answer in ten seconds' }
    assert.match(describeConnection(one, 0), /no answer in ten seconds/)
  })

  it('capabilities default to false and come only from real answers', () => {
    const none = capabilitiesFrom({})
    assert.equal(Object.values(none).some(Boolean), false)
    const some = capabilitiesFrom({ listPlaylists: true, isrc: true })
    assert.equal(some.listPlaylists, true)
    assert.equal(some.write, false)
  })

  it('what the account cannot do is listed for the screen', () => {
    const one = { ...newConnection('spotify', true), capabilities: capabilitiesFrom({ listPlaylists: true, readPlaylistTracks: true }) }
    const gone = missing(one).map((two) => two.key)
    assert.ok(gone.includes('likedSongs'))
    assert.ok(!gone.includes('listPlaylists'))
    // Never offers something the source itself cannot do at best.
    assert.ok(!gone.includes('write'))
  })

  it('statuses map to the state they actually mean', () => {
    assert.equal(stateFromStatus(401), 'expired')
    assert.equal(stateFromStatus(403), 'refused')
    assert.equal(stateFromStatus(503), 'broken')
    assert.equal(stateFromStatus(0), 'broken')
  })

  it('every source says what it needs, or needs nothing', () => {
    for (const source of SOURCES) {
      assert.ok(source.name.length > 1, source.id)
      assert.ok(source.offers.length > 0, source.id)
      if (source.kind === 'oauth') assert.ok(source.needs.length > 20, `${source.id} must say what it needs`)
      else assert.equal(source.needs, '', source.id)
    }
  })

  it('every capability has a plain label', () => {
    for (const [key, label] of Object.entries(CAPABILITY_LABELS)) assert.ok(label.length > 3, key)
  })
})
