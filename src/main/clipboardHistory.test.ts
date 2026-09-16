import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ClipItem } from '../shared/clipboardHistory.ts'
import { addClip, clipKind, DEFAULT_CLIPBOARD_SETTINGS, looksSecret, normalizeClip, normalizeClipboardSettings, pruneClips, searchClips, shouldCapture } from '../shared/clipboardHistory.ts'

const clip = (patch: Partial<ClipItem>): ClipItem => ({ id: 'c', kind: 'text', content: 'x', preview: 'x', pinned: false, copiedAt: 0, times: 1, bytes: 1, ...patch })

test('copied text is recognised as a link, colour, code or plain text', () => {
  assert.equal(clipKind('https://example.com/page?a=1'), 'link')
  assert.equal(clipKind('  #3fd8ff '), 'color')
  assert.equal(clipKind('rgba(10, 20, 30, 0.5)'), 'color')
  assert.equal(clipKind('const x = 1\nfunction go() {}'), 'code')
  assert.equal(clipKind('Just a sentence about https://example.com and more'), 'text')
})

test('passwords, card numbers, private keys and tokens are never kept', () => {
  assert.equal(looksSecret('Tr0ub4dor&3xyz'), true)
  assert.equal(looksSecret('4539 1488 0343 6467'), true, 'a card number that passes the Luhn check')
  assert.equal(looksSecret('4539 1488 0343 6468'), false, 'digits that fail the check are just digits')
  assert.equal(looksSecret('-----BEGIN RSA PRIVATE KEY-----\nabc'), true)
  assert.equal(looksSecret('ghp_abcdefghijklmnopqrstuvwxyz0123'), true)
  assert.equal(looksSecret('sk_live_abcdefghijklmnop'), true)
  assert.equal(looksSecret('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.dozjgNryP4J3jVmNHl0w5N'), true)
  assert.equal(looksSecret('Hello there, this is ordinary copied text.'), false)
  assert.equal(looksSecret('https://example.com/path?token=abc'), false, 'a plain link stays')
})

test('capture respects the settings: off, private tabs, blocked sites, secrets and size', () => {
  const s = { ...DEFAULT_CLIPBOARD_SETTINGS, blockedSites: ['bank.com'] }
  assert.equal(shouldCapture('hello', s).keep, true)
  assert.equal(shouldCapture('hello', { ...s, enabled: false }).keep, false)
  assert.equal(shouldCapture('hello', s, { private: true }).keep, false)
  assert.equal(shouldCapture('hello', s, { url: 'https://secure.bank.com/x' }).keep, false)
  assert.equal(shouldCapture('hello', s, { url: 'https://notbank.com/x' }).keep, true)
  assert.equal(shouldCapture('Tr0ub4dor&3xyz', s).keep, false)
  assert.equal(shouldCapture('Tr0ub4dor&3xyz', { ...s, skipSecrets: false }).keep, true)
  assert.equal(shouldCapture('x'.repeat(200_000), s).keep, false)
  assert.equal(shouldCapture('   ', s).keep, false)
})

test('copying the same thing again moves it up instead of duplicating, and pinned entries survive the limit', () => {
  const settings = { ...DEFAULT_CLIPBOARD_SETTINGS, limit: 2 }
  let history: ClipItem[] = []
  history = addClip(history, clip({ id: 'a', content: 'one', copiedAt: 1 }), settings)
  history = addClip(history, clip({ id: 'b', content: 'two', copiedAt: 2 }), settings)
  history = addClip(history, clip({ id: 'c', content: 'one', copiedAt: 3 }), settings)
  assert.equal(history.length, 2)
  assert.equal(history[0].id, 'a', 'the repeat kept the original entry')
  assert.equal(history[0].times, 2)

  history = addClip(history.map((c) => (c.id === 'a' ? { ...c, pinned: true } : c)), clip({ id: 'd', content: 'three', copiedAt: 4 }), settings)
  history = addClip(history, clip({ id: 'e', content: 'four', copiedAt: 5 }), settings)
  history = addClip(history, clip({ id: 'f', content: 'five', copiedAt: 6 }), settings)
  assert.ok(history.some((c) => c.id === 'a'), 'the pinned entry is still there')
  assert.equal(history.filter((c) => !c.pinned).length, 2)

  const old = [clip({ id: 'p', pinned: true, copiedAt: 0 }), clip({ id: 'q', copiedAt: 0 }), clip({ id: 'r', copiedAt: 100 * 86_400_000 })]
  assert.deepEqual(pruneClips(old, { ...settings, keepDays: 30 }, 100 * 86_400_000).map((c) => c.id), ['p', 'r'])
  assert.equal(pruneClips(old, { ...settings, keepDays: 0 }, Date.now()).length, 3)
})

test('search finds entries by text, site and kind, pinned first', () => {
  const history = [
    clip({ id: 'a', content: 'hello world', preview: 'hello world', copiedAt: 1 }),
    clip({ id: 'b', kind: 'link', content: 'https://docs.example.com/x', preview: 'https://docs.example.com/x', copiedAt: 2 }),
    clip({ id: 'c', content: 'pinned thing', preview: 'pinned thing', pinned: true, copiedAt: 0, source: { url: 'https://news.site/a' } })
  ]
  assert.deepEqual(searchClips(history, 'hello').map((c) => c.id), ['a'])
  assert.deepEqual(searchClips(history, '').map((c) => c.id), ['c', 'b', 'a'])
  assert.deepEqual(searchClips(history, '', 'link').map((c) => c.id), ['b'])
  assert.deepEqual(searchClips(history, '', 'pinned').map((c) => c.id), ['c'])
  assert.deepEqual(searchClips(history, 'news.site').map((c) => c.id), ['c'])
})

test('stored entries and settings are validated', () => {
  assert.equal(normalizeClip({ id: 'x', kind: 'image', content: 'not a data url' }), null)
  assert.equal(normalizeClip({ id: 'x', content: 'hi', kind: 'nonsense' })?.kind, 'text')
  assert.equal(normalizeClip({ content: 'no id' }), null)
  const settings = normalizeClipboardSettings({ limit: 99_999, keepDays: -5, blockedSites: ['A.com', 'a.com', ''], skipSecrets: false })
  assert.equal(settings.limit, 2000)
  assert.equal(settings.keepDays, 0)
  assert.deepEqual(settings.blockedSites, ['a.com'])
  assert.equal(settings.skipSecrets, false)
  assert.equal(settings.enabled, true)
})
