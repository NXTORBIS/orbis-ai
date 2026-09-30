import assert from 'node:assert/strict'
import test from 'node:test'
import { DWELL_MS, FrontTabWatch, REREAD_AFTER_MS, shouldReadNow, type CaptureTab } from './recallCapture.ts'
import { DEFAULT_RECALL_SETTINGS, type RecallSettings } from '../../shared/recall.ts'

/**
 * When a page counts as read.
 *
 * The browser reports its tabs on every change, which is far more often than somebody reads anything. These are the
 * rules that separate the two, and most of them are about *not* indexing.
 */

const on = (over: Partial<RecallSettings> = {}): RecallSettings => ({
  ...DEFAULT_RECALL_SETTINGS,
  enabled: true,
  ...over
})

const tab = (over: Partial<CaptureTab> = {}): CaptureTab => ({
  id: '1',
  active: true,
  url: 'https://example.com/article',
  title: 'An article',
  loading: false,
  private: false,
  ...over
})

const NOW = 1_700_000_000_000
const settled = { now: NOW, inFrontSince: NOW - DWELL_MS, lastIndexedAt: null }

test('a page in front, settled and unread, is read', () => {
  assert.deepEqual(shouldReadNow(tab(), on(), settled), { read: true })
})

test('nothing is read while the feature is off', () => {
  assert.equal(shouldReadNow(tab(), DEFAULT_RECALL_SETTINGS, settled).read, false)
})

test('a background tab is not read, because nobody has looked at it', () => {
  assert.equal(shouldReadNow(tab({ active: false }), on(), settled).read, false)
  assert.equal(shouldReadNow(undefined, on(), settled).read, false)
})

test('a tab still loading is not read', () => {
  // Half a page indexed under the whole page's name is worse than nothing.
  const answer = shouldReadNow(tab({ loading: true }), on(), settled)
  assert.equal(answer.read, false)
  assert.match(String(answer.reason), /loading/i)
})

test('a private tab is not read at all', () => {
  const answer = shouldReadNow(tab({ private: true }), on(), settled)
  assert.equal(answer.read, false)
  assert.match(String(answer.reason), /private/i)
})

test('flicking past a tab does not index it', () => {
  /**
   * The rule that stops "what I read" becoming "every address that passed through the window". Looking for one tab
   * among six is six switches and no reading.
   */
  assert.equal(shouldReadNow(tab(), on(), { ...settled, inFrontSince: NOW - 500 }).read, false)
  assert.equal(shouldReadNow(tab(), on(), { ...settled, inFrontSince: NOW - (DWELL_MS - 1) }).read, false)
  assert.equal(shouldReadNow(tab(), on(), { ...settled, inFrontSince: NOW - DWELL_MS }).read, true)
})

test('a tab that has only just appeared has no clock yet', () => {
  assert.equal(shouldReadNow(tab(), on(), { ...settled, inFrontSince: null }).read, false)
})

test('sitting on one article all afternoon is one read, not hundreds', () => {
  const justRead = { ...settled, lastIndexedAt: NOW - 60_000 }
  assert.equal(shouldReadNow(tab(), on(), justRead).read, false)
  // Long enough later it is worth reading again, because the page may have changed.
  assert.equal(shouldReadNow(tab(), on(), { ...settled, lastIndexedAt: NOW - REREAD_AFTER_MS }).read, true)
})

test('a page the store would refuse is never even read from the browser', () => {
  /**
   * Reading a page costs a round trip and up to a hundred thousand characters back, so asking a sign-in page for its
   * text and then throwing the answer away would be the expensive way to decline.
   */
  for (const url of ['https://bank.example/login', 'http://localhost:3000/', 'orbis://settings', 'file:///c:/x.pdf']) {
    assert.equal(shouldReadNow(tab({ url }), on(), settled).read, false, url)
  }
  assert.equal(shouldReadNow(tab({ url: 'https://news.example.com/a' }), on({ blockedSites: ['news.example.com'] }), settled).read, false)
})

test('every refusal says why, because a recording feature that silently does nothing is what people distrust', () => {
  const cases: CaptureTab[] = [tab({ active: false }), tab({ loading: true }), tab({ private: true }), tab({ url: 'orbis://x' })]
  for (const one of cases) {
    const answer = shouldReadNow(one, on(), settled)
    assert.equal(answer.read, false)
    assert.ok(answer.reason && answer.reason.length > 0, JSON.stringify(one))
  }
})

// ---------------------------------------------------------------- the clock

test('the clock starts when a page arrives in front and runs while it stays', () => {
  const watch = new FrontTabWatch()
  assert.equal(watch.saw(tab(), NOW), NOW)
  assert.equal(watch.saw(tab(), NOW + 1000), NOW, 'still the same page, so still the same clock')
  assert.equal(watch.saw(tab(), NOW + 9000), NOW)
})

test('navigating the same tab elsewhere starts the clock again', () => {
  // The new page has not been read for four seconds just because the tab has been open for four seconds.
  const watch = new FrontTabWatch()
  watch.saw(tab({ url: 'https://example.com/one' }), NOW)
  assert.equal(watch.saw(tab({ url: 'https://example.com/two' }), NOW + 5000), NOW + 5000)
})

test('a jump within one page is the same page', () => {
  const watch = new FrontTabWatch()
  watch.saw(tab({ url: 'https://example.com/a' }), NOW)
  assert.equal(watch.saw(tab({ url: 'https://example.com/a#section' }), NOW + 3000), NOW, 'the clock keeps running')
})

test('switching to another tab gives that tab its own clock', () => {
  const watch = new FrontTabWatch()
  watch.saw(tab({ id: '1' }), NOW)
  assert.equal(watch.saw(tab({ id: '2', url: 'https://other.example.com/' }), NOW + 2000), NOW + 2000)
})

test('with nothing in front there is no clock at all', () => {
  const watch = new FrontTabWatch()
  watch.saw(tab(), NOW)
  assert.equal(watch.saw(undefined, NOW + 1000), null)
  assert.equal(watch.saw(tab({ active: false }), NOW + 2000), null)
  assert.equal(watch.saw(tab({ url: '' }), NOW + 3000), null)
  assert.equal(watch.current, null)
})

test('the watch can be reset when the browser closes', () => {
  const watch = new FrontTabWatch()
  watch.saw(tab(), NOW)
  assert.ok(watch.current)
  watch.reset()
  assert.equal(watch.current, null)
  assert.equal(watch.saw(tab(), NOW + 1000), NOW + 1000, 'the next page starts its own clock')
})
