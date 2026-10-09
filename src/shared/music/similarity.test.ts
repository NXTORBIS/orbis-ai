import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { difference, duplicatePlaylists, similarity, suggestDestination } from './similarity.ts'

const t = (title: string, artist = 'A'): { title: string; artist: string } => ({ title, artist })

describe('playlist similarity', () => {
  it('the same tracks in the same order', () => {
    const out = similarity([t('One'), t('Two')], [t('One'), t('Two')])
    assert.equal(out.overlap, 1)
    assert.equal(out.reordered, false)
    assert.match(out.says, /same order/i)
  })

  it('the same tracks in a different order is its own answer', () => {
    const out = similarity([t('One'), t('Two')], [t('Two'), t('One')])
    assert.equal(out.overlap, 1)
    assert.equal(out.reordered, true)
    assert.match(out.says, /different order/i)
  })

  it('a small playlist inside a big one is fully contained but barely overlapping', () => {
    const big = Array.from({ length: 50 }, (_, i) => t(`Track ${i}`))
    const small = [t('Track 0'), t('Track 1')]
    const out = similarity(small, big)
    assert.equal(out.containment, 1)
    assert.ok(out.overlap < 0.1)
    assert.match(out.says, /entirely inside/i)
  })

  it('nothing in common is said plainly', () => {
    const out = similarity([t('One')], [t('Two')])
    assert.equal(out.shared, 0)
    assert.match(out.says, /nothing in common/i)
  })

  it('an empty side is not reported as a match', () => {
    const out = similarity([], [t('One')])
    assert.equal(out.overlap, 0)
    assert.match(out.says, /empty/i)
  })

  it('both empty is honest rather than an error', () => {
    assert.match(similarity([], []).says, /both are empty/i)
  })

  it('the difference lists all three sides', () => {
    const out = difference([t('One'), t('Two')], [t('Two'), t('Three')])
    assert.deepEqual(out.shared.map((one) => one.title), ['Two'])
    assert.deepEqual(out.onlyLeft.map((one) => one.title), ['One'])
    assert.deepEqual(out.onlyRight.map((one) => one.title), ['Three'])
  })

  it('finds playlists across sources that are the same playlist', () => {
    const pairs = duplicatePlaylists([
      { id: 'a', name: 'Gym', tracks: [t('One'), t('Two'), t('Three')] },
      { id: 'b', name: 'Gym 2024', tracks: [t('One'), t('Two'), t('Three')] },
      { id: 'c', name: 'Quiet', tracks: [t('Nine')] }
    ])
    assert.equal(pairs.length, 1)
    assert.equal(pairs[0].looksLike, 'the same playlist')
  })

  it('a coincidental single shared track is not offered as a duplicate', () => {
    const pairs = duplicatePlaylists([
      { id: 'a', name: 'A', tracks: [t('One'), t('Two'), t('Three'), t('Four')] },
      { id: 'b', name: 'B', tracks: [t('One'), t('Nine'), t('Ten'), t('Eleven')] }
    ])
    assert.equal(pairs.length, 0)
  })

  it('suggests the destination with the same name', () => {
    const out = suggestDestination('Gym (imported)', [{ id: 'd', name: 'Gym' }])
    assert.equal(out?.id, 'd')
    assert.match(out?.why ?? '', /same name/i)
  })

  it('does not suggest a destination that merely shares a word', () => {
    /* "Gym" against "Gym Shoes Shopping" is one word in three, and a wrong pre-filled row gets confirmed by habit. */
    assert.equal(suggestDestination('Gym', [{ id: 'd', name: 'Gym Shoes Shopping List' }]), null)
  })

  it('suggests nothing rather than guessing from an empty name', () => {
    assert.equal(suggestDestination('   ', [{ id: 'd', name: 'Gym' }]), null)
  })
})
