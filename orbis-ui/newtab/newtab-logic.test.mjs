import test from 'node:test'
import assert from 'node:assert/strict'
import * as L from './newtab-logic.js'

test('siteUrl', () => {
  assert.equal(L.siteUrl('example.com'), 'https://example.com/')
  assert.equal(L.siteUrl('javascript:alert(1)'), null)
  assert.equal(L.siteUrl('nodots'), null)
  assert.equal(L.siteUrl(''), null)
  assert.equal(L.siteUrl('http://localhost:3000'), 'http://localhost:3000/')
})
test('shortcuts add/edit/remove/limits', () => {
  let r = L.saveShortcut([], { name: 'Ex', url: 'example.com' }, () => 'a')
  assert.deepEqual(r.shortcuts, [{ id: 'a', url: 'https://example.com/', name: 'Ex' }])
  assert.equal(L.saveShortcut(r.shortcuts, { url: 'example.com' }).ok, false)
  r = L.saveShortcut(r.shortcuts, { id: 'a', name: 'X', url: 'b.org' })
  assert.equal(r.shortcuts[0].url, 'https://b.org/')
  assert.equal(L.saveShortcut(r.shortcuts, { id: 'zz', url: 'b.org' }).ok, false)
  assert.equal(L.saveShortcut(r.shortcuts, { url: 'bad' }).ok, false)
  assert.deepEqual(L.removeShortcut(r.shortcuts, 'a'), [])
  const full = Array.from({ length: 24 }, (_, i) => ({ id: `i${i}`, url: `https://s${i}.com/`, name: '' }))
  assert.equal(L.saveShortcut(full, { url: 'new.com' }).ok, false)
})
test('normalizeShortcuts drops junk and dupes', () => {
  const out = L.normalizeShortcuts([null, { id: 'a', url: 'a.com' }, { id: 'a', url: 'b.com' }, { id: 'c', url: 'file:///x' }, 5])
  assert.equal(out.length, 1)
  assert.deepEqual(L.normalizeShortcuts('x'), [])
})
test('normalizeSettings', () => {
  assert.deepEqual(L.normalizeSettings(undefined), L.DEFAULT_SETTINGS)
  const s = L.normalizeSettings({ wallpaper: 'bogus', hour12: true, countdown: { date: '2030-01-05', label: 'Trip' } })
  assert.equal(s.wallpaper, 'orbis'); assert.equal(s.hour12, true); assert.equal(s.countdown.label, 'Trip')
  // The greeting is gone from the page, and its name with it: a setting nothing reads is a setting that misleads.
  assert.equal('name' in s, false); assert.equal('greeting' in s, false)
  assert.equal(L.normalizeSettings({ countdown: { date: 'nope' } }).countdown, null)
})
test('the clock', () => {
  assert.equal(L.greetingText, undefined, 'the greeting was removed from the page, so nothing should still make one')
  const d = new Date(2026, 0, 1, 15, 4, 5)
  assert.match(L.clockText(d, { hour12: false }, 'en-US'), /15:04$/)
  assert.match(L.clockText(d, { hour12: true, seconds: true }, 'en-US'), /03:04:05\sPM$/)
})
test('countdown', () => {
  const now = new Date(2026, 0, 1, 23, 0)
  assert.equal(L.daysUntil('2026-01-04', now), 3)
  assert.equal(L.countdownText({ label: 'Trip', date: '2026-01-02' }, now), '1 day until Trip')
  assert.equal(L.countdownText({ label: '', date: '2026-01-01' }, now), 'the date: today')
  assert.equal(L.countdownText({ label: 'X', date: '2025-12-30' }, now), 'X: 2 days ago')
  assert.equal(L.countdownText(null), '')
})
