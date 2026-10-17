import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { availabilityWords, backdropColours, dayWords, dominantColours, originWords, rgbText, sizeWords, sureWords, trackFacts } from './nowplaying.ts'
import type { OrbisTrack } from '../music.ts'

/** Four bytes a pixel, the way a canvas hands them over. */
const pixels = (list: readonly [number, number, number, number][]): number[] => list.flat()

const track = (over: Partial<OrbisTrack> = {}): OrbisTrack => ({
  id: 't1',
  title: 'A song',
  artist: 'Someone',
  album: 'A record',
  duration: 200,
  availability: 'local',
  provenance: 'user-file',
  confidence: 'confirmed',
  method: 'file-tags',
  addedAt: Date.parse('2024-03-02T10:00:00Z'),
  file: 'C:/x.mp3',
  ...over
})

describe('colours measured out of a cover', () => {
  it('finds the colour a picture is mostly made of', () => {
    const found = dominantColours(pixels([
      [200, 20, 20, 255],
      [201, 21, 21, 255],
      [203, 22, 20, 255],
      [10, 10, 10, 255]
    ]))
    assert.equal(found.length > 0, true)
    assert.equal(found[0]!.r > 150, true)
    assert.equal(found[0]!.g < 60, true)
    assert.equal(found[0]!.share > 0.5, true)
  })

  it('reports nothing for a picture that is entirely see-through, rather than a colour', () => {
    assert.deepEqual(dominantColours(pixels([[200, 20, 20, 0], [20, 200, 20, 10]])), [])
  })

  it('reports nothing for bytes that are not pixels at all', () => {
    assert.deepEqual(dominantColours([1, 2]), [])
    assert.deepEqual(dominantColours([]), [])
  })

  it('does not return one colour twice', () => {
    const found = dominantColours(pixels([
      [200, 20, 20, 255],
      [201, 21, 21, 255],
      [199, 19, 19, 255]
    ]), 3)
    assert.equal(found.length, 1)
  })

  it('returns two colours when a picture really has two', () => {
    const found = dominantColours(pixels([
      [220, 30, 30, 255],
      [220, 30, 30, 255],
      [30, 40, 220, 255],
      [30, 40, 220, 255]
    ]), 3)
    assert.equal(found.length, 2)
  })

  it('keeps a picture of one flat colour', () => {
    const found = dominantColours(pixels([[90, 90, 90, 255], [90, 90, 90, 255]]), 3)
    assert.equal(found.length, 1)
    assert.deepEqual([found[0]!.r, found[0]!.g, found[0]!.b], [90, 90, 90])
  })

  it('writes a colour as CSS, with and without a strength', () => {
    assert.equal(rgbText({ r: 1, g: 2, b: 3, share: 1 }), 'rgb(1 2 3)')
    assert.equal(rgbText({ r: 1, g: 2, b: 3, share: 1 }, 0.5), 'rgb(1 2 3 / 0.5)')
  })

  it('gives no gradient colours when the cover gave none, so the page falls back to the Orbis accent', () => {
    assert.equal(backdropColours([]), null)
  })

  it('uses the one colour twice when a cover only had one', () => {
    const stops = backdropColours([{ r: 10, g: 20, b: 30, share: 1 }])
    assert.equal(stops?.near, 'rgb(10 20 30 / 0.55)')
    assert.equal(stops?.far, 'rgb(10 20 30 / 0.22)')
  })
})

describe('dates a person reads', () => {
  const now = Date.parse('2024-05-10T12:00:00Z')

  it('says nothing for a moment that was never recorded', () => {
    assert.equal(dayWords(undefined, now), '')
    assert.equal(dayWords(0, now), '')
  })

  it('refuses a moment in the future rather than printing it', () => {
    assert.equal(dayWords(now + 10 * 86400000, now), '')
  })

  it('names today and yesterday', () => {
    assert.match(dayWords(Date.parse('2024-05-10T09:30:00Z'), now), /^Today, /)
    assert.match(dayWords(Date.parse('2024-05-09T09:30:00Z'), now), /^Yesterday, /)
  })

  it('gives a plain date for anything older', () => {
    const words = dayWords(Date.parse('2024-03-02T10:00:00Z'), now)
    assert.equal(words.includes('Today'), false)
    assert.equal(words.length > 0, true)
  })
})

describe('where a track came from', () => {
  it('names a file with tags', () => {
    assert.equal(originWords({ provenance: 'user-file', method: 'file-tags' }), 'A file you added, named from the file itself')
  })

  it('names a song noticed on a page, and where', () => {
    const words = originWords({ provenance: 'recognised', method: 'media-session', source: { provider: 'a web page', recognisedAt: 1 } })
    assert.equal(words, "Noticed while browsing, named from the web page's own player, on a web page")
  })

  it('says how sure Orbis is only when that is worth saying', () => {
    assert.equal(sureWords('confirmed'), '')
    assert.equal(sureWords('high'), '')
    assert.match(sureWords('low'), /not certain/)
  })
})

describe('what Orbis has of a track', () => {
  it('tells a file apart from a name with no audio', () => {
    assert.match(availabilityWords('local', true), /file on this computer/)
    assert.match(availabilityWords('local', false), /no file/)
    assert.match(availabilityWords('reference', false), /name only/)
    assert.match(availabilityWords('missing', false), /not where it was/)
    assert.match(availabilityWords('unsupported', false), /cannot play/)
  })

  it('leaves a file size out when none was recorded', () => {
    assert.equal(sizeWords(undefined), '')
    assert.equal(sizeWords(0), '')
    assert.equal(sizeWords(500), '500 bytes')
    assert.equal(sizeWords(1024 * 1024 * 5), '5.0 MB')
  })
})

describe('the facts list', () => {
  const now = Date.parse('2024-05-10T12:00:00Z')

  it('leaves out every line it has no value for', () => {
    const facts = trackFacts(track(), now, '3:20')
    const labels = facts.map((one) => one.label)
    assert.equal(labels.includes('Year'), false)
    assert.equal(labels.includes('Genre'), false)
    assert.equal(labels.includes('Played'), false)
    assert.equal(labels.includes('Last played'), false)
    assert.equal(labels.includes('File size'), false)
  })

  it('shows no length line when the length is not known', () => {
    assert.equal(trackFacts(track({ duration: 0 }), now, '—').some((one) => one.label === 'Length'), false)
  })

  it('never shows a play count of zero', () => {
    assert.equal(trackFacts(track({ playCount: 0 }), now, '3:20').some((one) => one.label === 'Played'), false)
    const once = trackFacts(track({ playCount: 1 }), now, '3:20').find((one) => one.label === 'Played')
    assert.equal(once?.value, 'Once, all the way through')
  })

  it('always says where it came from and what Orbis has', () => {
    const labels = trackFacts(track(), now, '3:20').map((one) => one.label)
    assert.equal(labels.includes('Where it came from'), true)
    assert.equal(labels.includes('What Orbis has'), true)
  })

  it('leaves the album artist out when it is the same as the artist', () => {
    const same = trackFacts(track({ albumArtist: 'Someone' }), now, '3:20')
    assert.equal(same.some((one) => one.label === 'Album artist'), false)
    const other = trackFacts(track({ albumArtist: 'Somebody else' }), now, '3:20')
    assert.equal(other.some((one) => one.label === 'Album artist'), true)
  })
})
