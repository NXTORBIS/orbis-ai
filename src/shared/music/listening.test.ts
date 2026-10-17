import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { OrbisTrack } from '../music.ts'
import {
  DISCOVERY_LEVELS,
  FORGET_SCOPES,
  byDay,
  dateWords,
  dayWords,
  howSure,
  isDiscoveryLevel,
  listeningSummary,
  measuringWords,
  noticedOffer,
  tasteBars,
  topAlbums,
  topArtists,
  topGenres,
  topSongs,
  whenWords
} from './listening.ts'

/** A library row with only the fields these figures read, so a test says what it is about. */
function track(one: Partial<OrbisTrack> & { id: string }): OrbisTrack {
  return {
    title: one.title ?? one.id,
    artist: one.artist ?? '',
    album: one.album ?? '',
    duration: one.duration ?? 0,
    availability: one.availability ?? 'local',
    provenance: one.provenance ?? 'user-file',
    confidence: one.confidence ?? 'high',
    method: one.method ?? 'file-tags',
    addedAt: one.addedAt ?? 0,
    ...one
  } as OrbisTrack
}

describe('what has actually been played', () => {
  it('counts only plays Orbis really recorded', () => {
    const summary = listeningSummary([
      track({ id: 'a', playCount: 3, lastPlayedAt: 500 }),
      track({ id: 'b', playCount: 0 }),
      track({ id: 'c' }),
      track({ id: 'd', playCount: 2, lastPlayedAt: 900 })
    ])
    assert.deepEqual(summary, { songsPlayed: 2, totalPlays: 5, neverPlayed: 2, lastAt: 900 })
  })

  it('says nothing has been played rather than guessing a time', () => {
    assert.equal(listeningSummary([track({ id: 'a' })]).lastAt, null)
    assert.deepEqual(listeningSummary([]), { songsPlayed: 0, totalPlays: 0, neverPlayed: 0, lastAt: null })
  })

  it('leaves unplayed songs out of the most-played list', () => {
    const songs = topSongs([track({ id: 'a', playCount: 1 }), track({ id: 'b' }), track({ id: 'c', playCount: 9 })])
    assert.deepEqual(
      songs.map((one) => one.id),
      ['c', 'a']
    )
  })

  it('breaks a tie the same way every time', () => {
    const songs = topSongs([
      track({ id: 'a', title: 'Beta', playCount: 2, lastPlayedAt: 10 }),
      track({ id: 'b', title: 'Alpha', playCount: 2, lastPlayedAt: 10 }),
      track({ id: 'c', title: 'Gamma', playCount: 2, lastPlayedAt: 99 })
    ])
    assert.deepEqual(
      songs.map((one) => one.title),
      ['Gamma', 'Alpha', 'Beta']
    )
  })
})

describe('adding plays up by name', () => {
  const library = [
    track({ id: 'a', artist: 'One', album: 'First', genre: 'Rock', playCount: 4 }),
    track({ id: 'b', artist: 'One', album: 'First', genre: 'Rock', playCount: 1 }),
    track({ id: 'c', artist: 'Two', album: 'Second', genre: '', playCount: 6 }),
    track({ id: 'd', artist: '', album: '', playCount: 50 })
  ]

  it('counts plays and the songs they were spread over', () => {
    assert.deepEqual(topArtists(library), [
      { name: 'Two', plays: 6, songs: 1 },
      { name: 'One', plays: 5, songs: 2 }
    ])
  })

  it('leaves a nameless artist, album or genre out rather than inventing a heading', () => {
    assert.ok(topArtists(library).every((one) => one.name !== ''))
    assert.deepEqual(
      topAlbums(library).map((one) => one.name),
      ['Second', 'First']
    )
    assert.deepEqual(topGenres(library), [{ name: 'Rock', plays: 5, songs: 2 }])
  })

  it('holds to the limit asked for', () => {
    assert.equal(topArtists(library, 1).length, 1)
    assert.equal(topArtists(library, 0).length, 0)
  })
})

describe('when something happened', () => {
  const now = new Date(2026, 2, 12, 15, 0, 0).getTime()

  it('writes a date the same way whatever the machine is set to', () => {
    assert.equal(dateWords(new Date(2026, 2, 12).getTime()), '12 Mar 2026')
    assert.equal(dateWords(0), '')
  })

  it('rounds to the unit a person can picture', () => {
    assert.equal(whenWords(now - 10_000, now), 'Just now')
    assert.equal(whenWords(now - 60_000, now), 'A minute ago')
    assert.equal(whenWords(now - 600_000, now), '10 minutes ago')
    assert.equal(whenWords(now - 3_600_000, now), 'An hour ago')
    assert.equal(whenWords(now - 4 * 3_600_000, now), '4 hours ago')
    assert.equal(whenWords(now - 30 * 86_400_000, now), dateWords(now - 30 * 86_400_000))
  })

  it('never reads as the future when a clock is a little behind', () => {
    assert.equal(whenWords(now + 5_000, now), 'Just now')
  })

  it('says nothing at all for a time it was not given', () => {
    assert.equal(whenWords(0, now), '')
  })

  it('names a day by the calendar, not by how many hours ago it was', () => {
    assert.equal(dayWords(new Date(2026, 2, 12, 1, 0, 0).getTime(), now), 'Today')
    assert.equal(dayWords(new Date(2026, 2, 11, 23, 0, 0).getTime(), now), 'Yesterday')
    assert.equal(dayWords(new Date(2026, 2, 1).getTime(), now), '1 Mar 2026')
  })

  it('gathers things under one heading per day, newest first', () => {
    const groups = byDay(
      [
        { at: new Date(2026, 2, 11, 9).getTime(), id: 'old' },
        { at: new Date(2026, 2, 12, 9).getTime(), id: 'new' },
        { at: new Date(2026, 2, 12, 14).getTime(), id: 'newer' }
      ],
      now
    )
    assert.deepEqual(
      groups.map((one) => [one.day, one.things.map((thing) => thing.id)]),
      [
        ['Today', ['newer', 'new']],
        ['Yesterday', ['old']]
      ]
    )
  })
})

describe('what a noticed song may offer', () => {
  it('offers to play only a song there is really a copy of', () => {
    assert.equal(noticedOffer({ trackId: 'abc' }), 'play')
    assert.equal(noticedOffer({}), 'keep')
    assert.equal(noticedOffer({ trackId: '' }), 'keep')
  })
})

describe('the dials on the choosing', () => {
  it('offers only the five levels the engine accepts', () => {
    assert.equal(DISCOVERY_LEVELS.length, 5)
    assert.ok(isDiscoveryLevel('balanced'))
    assert.ok(!isDiscoveryLevel('adventurous!'))
    assert.ok(!isDiscoveryLevel(undefined))
  })

  it('says what each kind of forgetting throws away', () => {
    assert.equal(FORGET_SCOPES.length, 4)
    assert.ok(FORGET_SCOPES.every((one) => one.blurb.length > 10))
  })
})

describe('what Orbis has worked out about somebody', () => {
  it('drops a reading with no evidence behind it', () => {
    const bars = tasteBars([
      { name: 'energy', value: 70, confidence: 0.8, evidence: 20 },
      { name: 'tempo', value: 50, confidence: 0.9, evidence: 0 }
    ])
    assert.deepEqual(
      bars.map((one) => one.name),
      ['energy']
    )
  })

  it('puts the surest first and marks which are firm', () => {
    const bars = tasteBars([
      { name: 'a', value: 10, confidence: 0.2, evidence: 5 },
      { name: 'b', value: 120, confidence: 0.7, evidence: 5 }
    ])
    assert.deepEqual(bars, [
      { name: 'b', value: 100, confidence: 0.7, firm: true },
      { name: 'a', value: 10, confidence: 0.2, firm: false }
    ])
  })

  it('says plainly when there is nothing to show', () => {
    assert.match(howSure(null), /not counted any listening/)
    assert.match(howSure({ events: 0, ready: false }), /not counted any listening/)
    assert.match(howSure({ events: 1, ready: false }), /From 1 play\./)
    assert.match(howSure({ events: 40, ready: false }), /treat these loosely/)
    assert.equal(howSure({ events: 400, ready: true }), 'From 400 plays.')
  })

  it('says nothing about measuring once there is nothing left to measure', () => {
    assert.equal(measuringWords({ measured: 10, total: 12, unmeasurable: 2, working: false }), null)
    assert.equal(measuringWords(null), null)
    assert.match(measuringWords({ measured: 2, total: 12, unmeasurable: 0, working: true }) ?? '', /Listening to 10 more songs/)
    assert.match(measuringWords({ measured: 11, total: 12, unmeasurable: 0, working: false }) ?? '', /1 song has not been listened to/)
  })
})
