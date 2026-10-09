import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { kindOf, readCsv, readJson, readM3u, readPlaylistFile, readText, splitCsvLine } from './importing.ts'

const gap = String.fromCharCode(10)
const lines = (...rows: string[]): string => rows.join(gap)

describe('reading playlist files', () => {
  it('knows each shape from the content, not just the name', () => {
    assert.equal(kindOf('x.txt', '#EXTM3U'), 'm3u')
    assert.equal(kindOf('x.txt', '{"tracks":[]}'), 'json')
    assert.equal(kindOf('x.txt', 'Track Name,Artist Name,Album' + gap + 'a,b,c'), 'csv')
    assert.equal(kindOf('x.txt', 'Adele - Hello'), 'text')
  })

  it('reads an M3U with lengths and artist-title labels', () => {
    const out = readM3u(lines('#EXTM3U', '#PLAYLIST:Gym', '#EXTINF:201,Adele - Hello', 'C:\\Music\\hello.mp3'))
    assert.equal(out.name, 'Gym')
    assert.equal(out.tracks.length, 1)
    assert.equal(out.tracks[0].title, 'Hello')
    assert.equal(out.tracks[0].artist, 'Adele')
    assert.equal(out.tracks[0].duration, 201)
  })

  it('falls back to the filename when there is no label', () => {
    const out = readM3u(lines('#EXTM3U', '/home/me/music/Some Song.flac'))
    assert.equal(out.tracks[0].title, 'Some Song')
    assert.equal(out.tracks[0].artist, null)
  })

  it('does not split a title that merely contains a dash', () => {
    const out = readM3u(lines('#EXTINF:100,A - B - C', 'x.mp3'))
    assert.equal(out.tracks[0].title, 'A - B - C')
    assert.equal(out.tracks[0].artist, null)
  })

  it('splits CSV cells through quotes and doubled quotes', () => {
    assert.deepEqual(splitCsvLine('a,"b,c",d', ','), ['a', 'b,c', 'd'])
    assert.deepEqual(splitCsvLine('a,"say ""hi""",b', ','), ['a', 'say "hi"', 'b'])
  })

  it('reads a Spotify-shaped CSV and says which columns it used', () => {
    const out = readCsv(
      lines('Track Name,Artist Name(s),Album Name,Duration (ms),ISRC', '"Hello","Adele","25","295502","GBBKS1500214"')
    )
    assert.equal(out.tracks.length, 1)
    assert.equal(out.tracks[0].title, 'Hello')
    assert.equal(out.tracks[0].artist, 'Adele')
    assert.equal(out.tracks[0].duration, 296)
    assert.equal(out.tracks[0].isrc, 'GBBKS1500214')
    assert.equal(out.columns?.artist, 'Artist Name(s)')
  })

  it('refuses a table with no track-name column instead of guessing one', () => {
    const out = readCsv(lines('email,signed up', 'a@b.c,yesterday'))
    assert.equal(out.tracks.length, 0)
    assert.match(out.says, /no column/i)
  })

  it('reports a row with no track name rather than dropping it silently', () => {
    const out = readCsv(lines('Title,Artist', 'Hello,Adele', ',Nobody'))
    assert.equal(out.tracks.length, 1)
    assert.equal(out.skipped.length, 1)
    assert.equal(out.skipped[0].line, 3)
    assert.match(out.says, /could not be read/i)
  })

  it('reads a tab-separated table', () => {
    const tab = String.fromCharCode(9)
    const out = readCsv(lines(['Title', 'Artist', 'Album'].join(tab), ['Hello', 'Adele', '25'].join(tab)))
    assert.equal(out.tracks[0].artist, 'Adele')
  })

  it('reads a nested Spotify-shaped JSON export', () => {
    const out = readJson(
      JSON.stringify({
        name: 'Gym',
        tracks: {
          items: [{ track: { name: 'Hello', artists: [{ name: 'Adele' }], album: { name: '25' }, duration_ms: 295502, external_ids: { isrc: 'GBBKS1500214' }, uri: 'spotify:track:1' } }]
        }
      })
    )
    assert.equal(out.name, 'Gym')
    assert.equal(out.tracks[0].title, 'Hello')
    assert.equal(out.tracks[0].artist, 'Adele')
    assert.equal(out.tracks[0].album, '25')
    assert.equal(out.tracks[0].duration, 296)
    assert.equal(out.tracks[0].isrc, 'GBBKS1500214')
  })

  it('reads a plain array of simple objects', () => {
    const out = readJson(JSON.stringify([{ title: 'Blue', artist: 'A', length: '3:20' }]))
    assert.equal(out.tracks[0].title, 'Blue')
    assert.equal(out.tracks[0].duration, 200)
  })

  it('says so when the JSON is not readable', () => {
    const out = readJson('{not json')
    assert.equal(out.tracks.length, 0)
    assert.match(out.says, /not readable/i)
  })

  it('says so when the JSON holds no tracks', () => {
    const out = readJson(JSON.stringify({ hello: 'world' }))
    assert.match(out.says, /nothing in that file/i)
  })

  it('reports a JSON entry with no name', () => {
    const out = readJson(JSON.stringify([{ artist: 'A' }]))
    assert.equal(out.tracks.length, 0)
    assert.equal(out.skipped.length, 1)
  })

  it('reads a pasted list, numbered or not', () => {
    const out = readText(lines('1. Adele - Hello', 'Blue', '# a comment'))
    assert.equal(out.tracks.length, 2)
    assert.equal(out.tracks[0].artist, 'Adele')
    assert.equal(out.tracks[1].title, 'Blue')
  })

  it('the one door picks the right reader', () => {
    assert.equal(readPlaylistFile('gym.m3u8', lines('#EXTINF:1,A - B', 'x.mp3')).kind, 'm3u')
    assert.equal(readPlaylistFile('gym.csv', lines('Title', 'Hello')).kind, 'csv')
    assert.equal(readPlaylistFile('gym.json', '[]').kind, 'json')
  })

  it('an empty file is said plainly rather than counted as zero tracks imported', () => {
    assert.match(readCsv('').says, /empty/i)
  })
})
