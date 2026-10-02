import test from 'node:test'
import assert from 'node:assert/strict'
import { movedOn } from './feedCapabilities.ts'

/**
 * Whether the feed moved on, judged the way the Shorts run proved it has to be.
 *
 * The first attempt judged by the address, and YouTube Shorts leaves the URL on the Short you arrived at -- so a test
 * reported "0 advances" while the player had moved to a video of a different length. The address is the one thing that
 * does not change.
 */

const showing = (over: Partial<{ source: string; duration: number; text: string; scroll: number }> = {}) => ({
  source: '',
  duration: 0,
  text: '',
  scroll: 0,
  ...over
})

test('a different media source means a different item', () => {
  const out = movedOn(showing({ source: 'blob:a', duration: 24 }), showing({ source: 'blob:b', duration: 24 }))
  assert.equal(out.moved, true)
  assert.match(out.how, /different video/)
})

test('a different duration means a different item, because one video cannot change its length', () => {
  // The evidence that showed the Shorts run had actually advanced while the URL said otherwise.
  const out = movedOn(showing({ source: 'blob:a', duration: 24.42 }), showing({ source: 'blob:a', duration: 34.94 }))
  assert.equal(out.moved, true)
  assert.match(out.how, /different length/)
})

test('the same video playing on is not moving on', () => {
  assert.equal(movedOn(showing({ source: 'blob:a', duration: 24 }), showing({ source: 'blob:a', duration: 24 })).moved, false)
})

test('a feed with no media is judged by its text', () => {
  assert.equal(movedOn(showing({ text: 'first post' }), showing({ text: 'second post' })).moved, true)
  assert.equal(movedOn(showing({ text: 'first post' }), showing({ text: 'first post' })).moved, false)
})

test('text changing under a video does not count, because a page updates its own text', () => {
  // A Short's view count ticks up while it plays. Judging on that would call every second an advance.
  const out = movedOn(showing({ source: 'blob:a', duration: 24, text: '1,000 views' }), showing({ source: 'blob:a', duration: 24, text: '1,001 views' }))
  assert.equal(out.moved, false)
})

test('scrolling counts only where there is no media to judge by', () => {
  assert.equal(movedOn(showing({ scroll: 0, text: 'a' }), showing({ scroll: 900, text: 'a' })).moved, true)
  // With a video on screen, a scroll that left the same video playing has not advanced the feed.
  assert.equal(movedOn(showing({ source: 'blob:a', duration: 20, scroll: 0 }), showing({ source: 'blob:a', duration: 20, scroll: 900 })).moved, false)
})

test('an unreadable before or after does not invent a change', () => {
  assert.equal(movedOn(showing(), showing()).moved, false)
})
