import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isHostPattern, matchesAny, matchesPattern } from './matchPattern.ts'

test('<all_urls> matches web, websocket, ftp, data and file URLs, not extension pages', () => {
  for (const url of ['https://a.example/x', 'http://b.example/', 'wss://c.example/s', 'file:///C:/x.txt', 'data:text/plain,hi']) assert.ok(matchesPattern('<all_urls>', url), url)
  assert.equal(matchesPattern('<all_urls>', 'chrome-extension://abc/popup.html'), false)
})

test('scheme, host and path parts follow Chrome rules', () => {
  assert.ok(matchesPattern('*://*/*', 'https://news.example.com/a?b=1'))
  assert.equal(matchesPattern('*://*/*', 'file:///C:/x'), false, '* scheme means http(s) and ws(s) only')
  assert.ok(matchesPattern('https://*.example.com/*', 'https://example.com/'))
  assert.ok(matchesPattern('https://*.example.com/*', 'https://deep.sub.example.com/page'))
  assert.equal(matchesPattern('https://*.example.com/*', 'https://notexample.com/'), false)
  assert.equal(matchesPattern('https://*.example.com/*', 'http://example.com/'), false)
  assert.ok(matchesPattern('https://site.org/docs/*', 'https://site.org/docs/guide?x=1'))
  assert.equal(matchesPattern('https://site.org/docs/*', 'https://site.org/blog/'), false)
  assert.ok(matchesPattern('http://localhost:3000/*', 'http://localhost:3000/app'))
  assert.equal(matchesPattern('not a pattern', 'https://a.example/'), false)
  assert.ok(matchesAny(['https://a.example/*', 'https://b.example/*'], 'https://b.example/x'))
})

test('host patterns are told apart from API permissions', () => {
  assert.ok(isHostPattern('<all_urls>'))
  assert.ok(isHostPattern('*://*/*'))
  assert.equal(isHostPattern('tabs'), false)
  assert.equal(isHostPattern('storage'), false)
})
