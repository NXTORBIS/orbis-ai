import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import type { OrbisTrack } from '../music.ts'
import { albumKey, albumsOf, factsOf, faceOf, genresOf, isAlbum, isArtist, mostPlayed, readAlbumKey, yearsText } from './record.ts'

const track = (one: Partial<OrbisTrack> & { id: string }): OrbisTrack => ({
  title: one.id,
  artist: '',
  album: '',
  duration: 100,
  availability: 'local',
  provenance: 'user-file',
  confidence: 'confirmed',
  method: 'file-tags',
  addedAt: 0,
  file: 'C:/music/a.mp3',
  ...one
})

test('an album address survives being read back', () => {
  const key = albumKey('Rock & Roll / Part 2', 'The Band|Two')
  assert.deepEqual(readAlbumKey(key), { name: 'Rock & Roll / Part 2', by: 'The Band|Two' })
})

test('an address with no artist in it matches on the album name alone', () => {
  assert.equal(isAlbum({ name: 'Home', by: 'One Band' }, 'home'), true)
  assert.equal(isAlbum({ name: 'Home', by: 'One Band' }, albumKey('Home', 'Other Band')), false)
  assert.equal(isAlbum({ name: 'Home', by: 'One Band' }, albumKey('HOME', 'one band')), true)
})

test('an artist address is matched the forgiving way', () => {
  assert.equal(isArtist('Sigur Rós', ' sigur ros '), true)
  assert.equal(isArtist('Sigur Rós', 'Mogwai'), false)
})

test('a total length is only stated when every track has one', () => {
  assert.equal(factsOf([track({ id: 'a', duration: 60 }), track({ id: 'b', duration: 90 })]).seconds, 150)
  assert.equal(factsOf([track({ id: 'a', duration: 60 }), track({ id: 'b', duration: 0 })]).seconds, null)
  assert.equal(factsOf([]).seconds, null)
})

test('a year is only stated when the files agree on one', () => {
  assert.equal(factsOf([track({ id: 'a', year: 1999 }), track({ id: 'b', year: 1999 })]).year, 1999)
  assert.equal(factsOf([track({ id: 'a', year: 1999 }), track({ id: 'b', year: 2001 })]).year, null)
  assert.equal(factsOf([track({ id: 'a' })]).year, null)
})

test('only tracks with a file are counted as playable', () => {
  const facts = factsOf([track({ id: 'a' }), track({ id: 'b', availability: 'reference', file: undefined }), track({ id: 'c', file: undefined })])
  assert.equal(facts.playable, 1)
  assert.deepEqual(facts.playableIds, ['a'])
  assert.equal(facts.tracks, 3)
})

test('most played leaves out everything that has never been played', () => {
  const list = mostPlayed([track({ id: 'a', playCount: 2 }), track({ id: 'b' }), track({ id: 'c', playCount: 9 })])
  assert.deepEqual(
    list.map((one) => one.id),
    ['c', 'a']
  )
})

test('a tie in play counts is settled by what was played last', () => {
  const list = mostPlayed([track({ id: 'a', playCount: 3, lastPlayedAt: 10 }), track({ id: 'b', playCount: 3, lastPlayedAt: 99 })])
  assert.deepEqual(
    list.map((one) => one.id),
    ['b', 'a']
  )
})

test('most played can be asked for nothing', () => {
  assert.equal(mostPlayed([track({ id: 'a', playCount: 1 })], 0).length, 0)
})

test("an artist's albums are grouped on the album name and come newest first", () => {
  const groups = albumsOf([
    track({ id: 'a', album: 'Later', year: 2010 }),
    track({ id: 'b', album: 'Earlier', year: 1990 }),
    track({ id: 'c', album: 'Later', year: 2010, artist: 'Guest', albumArtist: 'Them' }),
    track({ id: 'd' })
  ])
  assert.deepEqual(
    groups.map((one) => one.name),
    ['Later', 'Earlier', 'Unknown album']
  )
  assert.equal(groups[0].tracks.length, 2)
})

test('an album orders its tracks by disc then track number', () => {
  const groups = albumsOf([
    track({ id: 'a', album: 'One', discNumber: 2, trackNumber: 1 }),
    track({ id: 'b', album: 'One', discNumber: 1, trackNumber: 5 }),
    track({ id: 'c', album: 'One', discNumber: 1, trackNumber: 2 })
  ])
  assert.deepEqual(
    groups[0].tracks.map((one) => one.id),
    ['c', 'b', 'a']
  )
})

test('genres are only the ones the files name', () => {
  assert.deepEqual(genresOf([track({ id: 'a', genre: 'Jazz' }), track({ id: 'b' }), track({ id: 'c', genre: 'jazz' }), track({ id: 'd', genre: 'Folk' })]), [
    'Jazz',
    'Folk'
  ])
  assert.deepEqual(genresOf([track({ id: 'a' })]), [])
})

test('years span is empty when no file says', () => {
  assert.equal(yearsText([track({ id: 'a' })]), '')
  assert.equal(yearsText([track({ id: 'a', year: 2004 })]), '2004')
  assert.equal(yearsText([track({ id: 'a', year: 2004 }), track({ id: 'b', year: 1998 })]), '1998–2004')
})

test('the face of a record is the first track that has a cover', () => {
  assert.equal(faceOf([track({ id: 'a' }), track({ id: 'b', artwork: 'cover.png' })])?.id, 'b')
  assert.equal(faceOf([track({ id: 'a' })])?.id, 'a')
  assert.equal(faceOf([]), null)
})
