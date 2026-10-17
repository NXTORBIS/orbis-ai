import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addressParts } from './omnibox.ts'

/**
 * What the address bar shows when nobody is typing in it.
 *
 * The rule being checked is that the site is told apart from everything around it, so the bar can draw the site
 * brightly and the rest dim -- which is the whole point of the resting state. The refusals matter as much: a
 * search, a half-typed word or an address Orbis cannot take apart is shown exactly as the person left it, never
 * rearranged into something that looks like a site.
 */

test('the site is separated from the path, and https is dropped', () => {
  assert.deepEqual(addressParts('https://www.youtube.com/?themeRefresh=1'), {
    before: '', site: 'www.youtube.com', after: '/?themeRefresh=1'
  })
  assert.deepEqual(addressParts('https://www.google.com/search?q=hello'), {
    before: '', site: 'www.google.com', after: '/search?q=hello'
  })
})

test('a bare site has nothing after it, so nothing dim is drawn', () => {
  assert.deepEqual(addressParts('https://youtube.com'), { before: '', site: 'youtube.com', after: '' })
  assert.deepEqual(addressParts('https://youtube.com/'), { before: '', site: 'youtube.com', after: '' }, 'a lone slash is not a path worth showing')
})

test('http is kept, because there the scheme is the warning', () => {
  assert.deepEqual(addressParts('http://example.com/x'), { before: 'http://', site: 'example.com', after: '/x' })
})

test('a port and a fragment belong to the parts they are part of', () => {
  assert.deepEqual(addressParts('https://localhost:5173/app#top'), {
    before: '', site: 'localhost:5173', after: '/app#top'
  })
})

test('anything that is not a web address is refused, and shown as it was typed', () => {
  for (const notOne of ['', '   ', 'hello world', 'youtube', 'file:///C:/x', 'chrome://orbis', 'about:blank']) {
    assert.equal(addressParts(notOne), null, `${JSON.stringify(notOne)} is not a web address`)
  }
})
