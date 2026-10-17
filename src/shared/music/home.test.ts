import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Grouped, OrbisTrack } from '../music.ts'
import {
  albumCards,
  artistCards,
  coverWants,
  greetingFor,
  haveWords,
  homeShelves,
  libraryIsEmpty,
  newestIn,
  noticedCards,
  playableIn,
  stationCards,
  trackCard,
  trackCards
} from './home.ts'

/** A track with real audio on this computer. Everything a card decision turns on is set explicitly. */
const file = (one: Partial<OrbisTrack> & { id: string }): OrbisTrack => ({
  title: 'A song',
  artist: 'Somebody',
  album: 'A record',
  duration: 200,
  availability: 'local',
  provenance: 'user-file',
  confidence: 'confirmed',
  method: 'file-tags',
  addedAt: 1000,
  file: 'C:/music/one.mp3',
  ...one
})

/** A song Orbis has by name and no audio for, which is the state a card must never dress up as a file. */
const byName = (one: Partial<OrbisTrack> & { id: string }): OrbisTrack => ({
  ...file(one),
  availability: 'reference',
  file: undefined,
  ...one
})

const group = (name: string, tracks: readonly OrbisTrack[], by?: string, year?: number): Grouped => ({ name, by, tracks: [...tracks], year })

describe('the greeting', () => {
  it('says something different at each part of the day', () => {
    assert.equal(greetingFor(7), 'Good morning')
    assert.equal(greetingFor(13), 'Good afternoon')
    assert.equal(greetingFor(20), 'Good evening')
    assert.equal(greetingFor(2), 'Still up')
    assert.equal(greetingFor(23), 'Still up')
  })

  it('does not guess at an hour it was not given', () => {
    assert.equal(greetingFor(Number.NaN), 'Your music')
  })
})

describe('a track as a card', () => {
  it('can be played when there is a file for it', () => {
    const card = trackCard(file({ id: 'one', title: 'Lift', artist: 'Tern' }))
    assert.deepEqual(card.trackIds, ['one'])
    assert.equal(card.why, undefined)
    assert.equal(card.name, 'Lift')
    assert.equal(card.under, 'Tern')
    assert.equal(card.coverTrackId, 'one')
  })

  it('carries the reason instead, and nothing to play, when there is no audio', () => {
    const card = trackCard(byName({ id: 'two' }))
    assert.deepEqual(card.trackIds, [])
    assert.match(card.why ?? '', /no audio/i)
  })

  it('never shows an empty name or an empty second line', () => {
    const card = trackCard(file({ id: 'three', title: '', artist: '' }))
    assert.equal(card.name, 'No title')
    assert.equal(card.under, 'No artist named')
  })

  it('caps a row rather than drawing a whole library sideways', () => {
    const many = Array.from({ length: 40 }, (_, at) => file({ id: `t${at}` }))
    assert.equal(trackCards(many, 12).length, 12)
    assert.equal(trackCards(many, 0).length, 0)
  })
})

describe('albums and artists', () => {
  it('plays only the tracks that have audio', () => {
    const mixed = group('Record', [file({ id: 'a' }), byName({ id: 'b' }), file({ id: 'c' })])
    assert.deepEqual(playableIn(mixed), ['a', 'c'])
  })

  it('says so when an album is nothing but names', () => {
    const cards = albumCards([group('Record', [byName({ id: 'b' })], 'Tern')])
    assert.deepEqual(cards[0].trackIds, [])
    assert.match(cards[0].why ?? '', /no audio/i)
  })

  it('puts the most recently added album first', () => {
    const older = group('Older', [file({ id: 'a', addedAt: 10 })], 'One')
    const newer = group('Newer', [file({ id: 'b', addedAt: 99 })], 'Two')
    assert.equal(newestIn(newer), 99)
    assert.deepEqual(
      albumCards([older, newer]).map((one) => one.name),
      ['Newer', 'Older']
    )
  })

  it('names the artist and the year under an album, and never a blank line', () => {
    const [withYear] = albumCards([group('Record', [file({ id: 'a' })], 'Tern', 2019)])
    assert.equal(withYear.under, 'Tern · 2019')
    const [without] = albumCards([group('Record', [file({ id: 'a' })])])
    assert.equal(without.under, 'Unknown artist')
  })

  it('puts the artist with most in the library first, and draws them round', () => {
    const few = group('Few', [file({ id: 'a' })])
    const lots = group('Lots', [file({ id: 'b' }), file({ id: 'c' })])
    const cards = artistCards([few, lots])
    assert.deepEqual(
      cards.map((one) => one.name),
      ['Lots', 'Few']
    )
    assert.equal(cards[0].round, true)
    assert.equal(cards[0].under, '2 songs')
    assert.equal(cards[1].under, '1 song')
  })
})

describe('songs noticed while browsing', () => {
  it('plays only when Orbis found the person their own copy', () => {
    const [mine] = noticedCards([{ id: 'n1', title: 'Lift', artist: 'Tern', provider: 'a web page', trackId: 'own' }])
    assert.deepEqual(mine.trackIds, ['own'])
    assert.equal(mine.why, undefined)
  })

  it('keeps a name with no audio as a name, and says what to do about it', () => {
    const [onlyName] = noticedCards([{ id: 'n2', title: 'Lift', artist: 'Tern', provider: 'a web page' }])
    assert.deepEqual(onlyName.trackIds, [])
    assert.match(onlyName.why ?? '', /own copy/i)
    assert.equal(onlyName.coverTrackId, undefined)
  })
})

describe('the ways of exploring', () => {
  it('draws whatever the engine answered, and nothing of its own', () => {
    const cards = stationCards([{ id: 'surprise', label: 'Surprise me', blurb: 'Things you have not heard.' }])
    assert.equal(cards.length, 1)
    assert.equal(cards[0].stationId, 'surprise')
    assert.deepEqual(cards[0].trackIds, [])
    assert.equal(cards[0].under, 'Things you have not heard.')
  })

  it('is empty when the engine gave nothing', () => {
    assert.equal(stationCards([]).length, 0)
  })
})

describe('the whole screen', () => {
  const nothing = { played: [], stations: [], favourites: [], noticed: [], albums: [], artists: [] }

  it('draws no row at all when there is nothing to put in one', () => {
    assert.deepEqual(homeShelves(nothing), [])
  })

  it('leaves out only the rows that are empty', () => {
    const shelves = homeShelves({ ...nothing, played: [file({ id: 'a' })], favourites: [file({ id: 'b' })] })
    assert.deepEqual(
      shelves.map((one) => one.kind),
      ['recent', 'favourites']
    )
  })

  it('keeps the rows in the order a person uses them', () => {
    const shelves = homeShelves({
      played: [file({ id: 'a' })],
      stations: [{ id: 's', label: 'Surprise me', blurb: 'More.' }],
      favourites: [file({ id: 'b' })],
      noticed: [{ id: 'n', title: 'Lift', artist: 'Tern', provider: 'page' }],
      albums: [group('One', [file({ id: 'c' })], 'A'), group('Two', [file({ id: 'd' })], 'B')],
      artists: [group('A', [file({ id: 'c' })]), group('B', [file({ id: 'd' })])]
    })
    assert.deepEqual(
      shelves.map((one) => one.kind),
      ['recent', 'stations', 'favourites', 'noticed', 'albums', 'artists']
    )
  })

  it('does not give a heading to a single album or artist', () => {
    const shelves = homeShelves({ ...nothing, albums: [group('One', [file({ id: 'c' })], 'A')], artists: [group('A', [file({ id: 'c' })])] })
    assert.deepEqual(shelves, [])
  })

  it('asks for the covers at the top of the screen first, each one once', () => {
    const shelves = homeShelves({ ...nothing, played: [file({ id: 'a' }), file({ id: 'b' })], favourites: [file({ id: 'a' })] })
    assert.deepEqual(coverWants(shelves), ['a', 'b'])
    assert.deepEqual(coverWants(shelves, 1), ['a'])
  })
})

describe('telling an empty library from one it could not read', () => {
  it('only says empty when the summary itself says nothing is there', () => {
    assert.equal(libraryIsEmpty({ tracks: 0 }), true)
    assert.equal(libraryIsEmpty({ tracks: 5 }), false)
    assert.equal(libraryIsEmpty(null), false)
    assert.equal(libraryIsEmpty(undefined), false)
  })

  it('counts what is there, and keeps the songs saved by name visible', () => {
    assert.equal(haveWords({ tracks: 1, offline: 1, reference: 0 }), '1 song · 1 playable here')
    assert.equal(haveWords({ tracks: 9, offline: 7, reference: 2 }), '9 songs · 7 playable here · 2 saved by name')
    assert.equal(haveWords(null), null)
  })
})
