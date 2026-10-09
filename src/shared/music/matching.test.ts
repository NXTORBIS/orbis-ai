import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BANDS, bandFor, describeMatch, matchAll, matchTrack, wordOverlap, type Held } from './matching.ts'

const held = (id: string, title: string, artist: string, extra: Partial<Held<string>> = {}): Held<string> => ({
  track: id,
  title,
  artist,
  ...extra
})

describe('music matching', () => {
  it('takes a provider id as the answer', () => {
    const out = matchTrack(
      { title: 'Something Else', artist: 'Nobody', providerId: 'abc', provider: 'spotify' },
      [held('one', 'Different Name', 'Someone', { providerIds: { spotify: 'abc' } })]
    )
    assert.equal(out.match, 'one')
    assert.equal(out.stage, 'provider-id')
    assert.equal(out.band, 'certain')
  })

  it('takes a matching recording code', () => {
    const out = matchTrack({ title: 'Blue', artist: 'A', isrc: 'GBAYE0000123' }, [held('one', 'Blue', 'A', { isrc: 'GB-AYE-00-00123' })])
    assert.equal(out.match, 'one')
    assert.equal(out.stage, 'isrc')
  })

  it('refuses a match when both sides name different recordings', () => {
    /* The whole point: identical metadata must not override two different ISRCs. */
    const out = matchTrack({ title: 'Blue', artist: 'A', isrc: 'GBAYE0000123' }, [held('one', 'Blue', 'A', { isrc: 'USAYE0000999' })])
    assert.equal(out.match, null)
    assert.equal(out.candidates.length, 0)
  })

  it('matches on title, artist, album and length agreeing', () => {
    const out = matchTrack({ title: 'Blue', artist: 'A', album: 'Sky', duration: 200 }, [
      held('one', 'Blue', 'A', { album: 'Sky', duration: 201 })
    ])
    assert.equal(out.match, 'one')
    assert.ok(out.score >= BANDS.strong.from)
  })

  it('will not take a different artist with the same title', () => {
    const out = matchTrack({ title: 'Hello', artist: 'Adele' }, [held('one', 'Hello', 'Lionel Richie')])
    assert.equal(out.match, null)
    assert.ok(out.candidates[0].why.some((one) => /different artist/i.test(one)))
  })

  it('asks rather than picking between versions that score the same', () => {
    const out = matchTrack({ title: 'Blue', artist: 'A' }, [held('one', 'Blue (2019 Remaster)', 'A'), held('two', 'Blue (Live)', 'A')])
    assert.equal(out.match, null)
    assert.equal(out.band, 'ambiguous')
    assert.ok(out.candidates.length >= 2)
    assert.match(out.reason ?? '', /more than one version/i)
  })

  it('says so honestly when the library is empty', () => {
    const out = matchTrack({ title: 'Blue' }, [])
    assert.equal(out.match, null)
    assert.match(out.reason ?? '', /library/i)
  })

  it('refuses a row with no title', () => {
    const out = matchTrack({ title: '  ' }, [held('one', 'Blue', 'A')])
    assert.equal(out.match, null)
    assert.match(out.reason ?? '', /no title/i)
  })

  it('a big length difference pushes it below taking', () => {
    const out = matchTrack({ title: 'Blue', artist: 'A', duration: 200 }, [held('one', 'Blue', 'A', { duration: 600 })])
    assert.equal(out.match, null)
    assert.ok(out.candidates[0].why.some((one) => /differ by/i.test(one)))
  })

  it('counts a whole list without losing any row', () => {
    const library = [held('one', 'Blue', 'A'), held('two', 'Green', 'B')]
    const { summary } = matchAll(
      [
        { title: 'Blue', artist: 'A' },
        { title: 'Hello', artist: 'Nobody At All' },
        { title: 'Green', artist: 'B' }
      ],
      library
    )
    assert.equal(summary.total, 3)
    assert.equal(summary.matched + summary.ambiguous + summary.unmatched, 3)
  })

  it('bands run in order', () => {
    assert.equal(bandFor(1), 'certain')
    assert.equal(bandFor(0.9), 'strong')
    assert.equal(bandFor(0.75), 'ambiguous')
    assert.equal(bandFor(0.2), 'manual')
    assert.equal(BANDS.ambiguous.take, false)
    assert.equal(BANDS.manual.take, false)
  })

  it('word overlap is symmetric and bounded', () => {
    assert.equal(wordOverlap('a b c', 'a b c'), 1)
    assert.equal(wordOverlap('', 'a'), 0)
    assert.equal(wordOverlap('a b', 'b a'), 1)
  })

  it('describes a match in words rather than a number', () => {
    const out = matchTrack({ title: 'Blue', artist: 'A', isrc: 'GBAYE0000123' }, [held('one', 'Blue', 'A', { isrc: 'GBAYE0000123' })])
    const said = describeMatch(out)
    assert.match(said, /certain/i)
    assert.doesNotMatch(said, /0\.9/)
  })
})
