import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildShare, mailtoFor, MAX_SHARE_TEXT, sharableUrl, shareSaid, shareSubject, shareText, siteOf } from './selectionShare.ts'

/**
 * Handing on something you highlighted. Orbis has no account anywhere, so the thing it must never do is say "Shared!"
 * and mean nothing -- which is the easiest button in the world to build and the reason nobody trusts one.
 */

test('a quote carries where it came from', () => {
  const { payload } = buildShare({ text: 'Quantum entanglement is a physical phenomenon.', title: 'Entanglement', url: 'https://example.org/a/b' })
  const said = shareText(payload)
  assert.ok(said.startsWith('Quantum entanglement is a physical phenomenon.'))
  assert.ok(said.includes('Entanglement'))
  assert.ok(said.includes('https://example.org/a/b'))
})

test('a page with no title and no address hands on just the words', () => {
  const { payload } = buildShare({ text: 'Just these words.' })
  assert.equal(shareText(payload), 'Just these words.')
  assert.equal(payload.title, null)
  assert.equal(payload.url, null)
})

test('a session token in the address is taken out, and the rest of the address is left alone', () => {
  const url = sharableUrl('https://example.org/doc?id=42&access_token=abc123&page=2')!
  assert.ok(url.includes('id=42'))
  assert.ok(url.includes('page=2'))
  assert.ok(!url.includes('access_token'), url)
  assert.ok(!url.includes('abc123'), url)
})

test('a user and password in the address is a credential, and none of it is handed on', () => {
  const url = sharableUrl('https://alice:hunter2@example.org/private')!
  assert.ok(!url.includes('alice'), url)
  assert.ok(!url.includes('hunter2'), url)
  assert.ok(url.includes('example.org/private'))
})

test('a token hidden in the fragment goes too', () => {
  assert.ok(!sharableUrl('https://example.org/#access_token=abc123')!.includes('abc123'))
})

test('an ordinary parameter is never removed, because a rewritten link may not go where it went', () => {
  const url = sharableUrl('https://shop.example/item?code2=x&keyword=lamp&q=blue')!
  assert.ok(url.includes('keyword=lamp'))
  assert.ok(url.includes('q=blue'))
})

test('something that is not an ordinary web page is not handed on at all', () => {
  assert.equal(sharableUrl('file:///C:/secret.txt'), null)
  assert.equal(sharableUrl('chrome://settings'), null)
  assert.equal(sharableUrl('data:text/html,<h1>hi</h1>'), null)
  assert.equal(sharableUrl('not a url'), null)
})

test('the site is named for an attribution line, and nothing is invented when there is no address', () => {
  assert.equal(siteOf('https://www.example.org/x'), 'example.org')
  assert.equal(siteOf(null), null)
})

test('text too long to carry is cut, and the cut is said rather than done quietly', () => {
  const { payload, shortened } = buildShare({ text: 'x'.repeat(MAX_SHARE_TEXT + 500) })
  assert.equal(shortened, true)
  assert.ok(payload.text.length <= MAX_SHARE_TEXT + 1)
  assert.ok(shareSaid('copied', true).includes('the end is not in it'))
})

test('copied never says shared, because nothing left this computer', () => {
  const said = shareSaid('copied')
  assert.ok(said.toLowerCase().includes('copied'), said)
  assert.ok(!/\bshared\b/i.test(said), said)
})

test('changing your mind is not a failure', () => {
  assert.equal(shareSaid('cancelled'), 'Nothing was shared.')
  assert.ok(shareSaid('failed').includes('could not'))
  assert.notEqual(shareSaid('cancelled'), shareSaid('failed'))
})

test('a draft says the sending is still yours to do', () => {
  assert.ok(shareSaid('drafted').includes('yours to do'))
})

test('every outcome has its own sentence, so none can be mistaken for another', () => {
  const all = (['copied', 'drafted', 'cancelled', 'failed', 'unavailable'] as const).map((one) => shareSaid(one))
  assert.equal(new Set(all).size, all.length)
})

test('a mail draft carries the quote and names nobody, because who it goes to is the person\u2019s choice', () => {
  const { payload } = buildShare({ text: 'A sentence worth sending.', title: 'A page', url: 'https://example.org/' })
  const link = mailtoFor(payload)!
  assert.ok(link.startsWith('mailto:?'), link.slice(0, 40))
  assert.ok(link.includes(encodeURIComponent('A sentence worth sending.')))
  assert.ok(!/mailto:[^?]/.test(link), 'no recipient is filled in')
})

test('a subject is the page title, or the first few words when there was none', () => {
  assert.equal(shareSubject({ text: 'x', title: 'The page', url: null, site: null }), 'The page')
  assert.equal(shareSubject({ text: 'one two three four five six seven eight nine ten', title: null, url: null, site: null }), 'one two three four five six seven eight nine')
})

test('nothing to send opens no draft', () => {
  assert.equal(mailtoFor({ text: '   ', title: null, url: null, site: null }), null)
})
