import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolveSurface, SURFACES } from './surfaceCapabilities.ts'

const idOf = (name: string): string | null => {
  const found = resolveSurface(name)
  if (!found) return null
  return 'ambiguous' in found ? `ambiguous:${found.ambiguous.map((s) => s.id).join('|')}` : found.id
}

test('the plain words for the browser itself reach the right page', () => {
  const expected: [string, string][] = [
    ['settings', 'settings'],
    ['browser settings', 'settings'],
    ['preferences', 'settings'],
    ['browser preferences', 'settings'],
    ['the browser configuration', 'settings'],
    ['history', 'history'],
    ['browsing history', 'history'],
    ['downloads', 'downloads'],
    ['bookmarks', 'bookmarks'],
    ['favourites', 'bookmarks'],
    ['favorites', 'bookmarks'],
    ['extensions', 'extensions'],
    ['add ons', 'extensions'],
    ['saved passwords', 'passwords'],
    ['reading list', 'reading-list'],
    ['site permissions', 'site-permissions'],
    ['notifications', 'site-permissions'],
    ['default search', 'search-engines'],
    ['on startup', 'startup'],
    ['browser version', 'about']
  ]
  for (const [said, id] of expected) assert.equal(idOf(said), id, said)
})

test('a longer name wins over a shorter one it contains', () => {
  // Every one of these contains "settings". Reading them as the top of settings is the failure this ordering prevents.
  assert.equal(idOf('privacy settings'), 'privacy')
  assert.equal(idOf('clear browsing data'), 'clear-browsing-data')
  assert.equal(idOf('download settings'), 'downloads-settings')
  assert.equal(idOf('search engine settings'), 'search-engines')
  assert.equal(idOf('appearance settings'), 'appearance')
})

test('an id, an address and a spoken name all work', () => {
  assert.equal(idOf('site-permissions'), 'site-permissions')
  assert.equal(idOf('chrome://history/'), 'history')
  assert.equal(idOf('chrome://settings/privacy'), 'privacy')
})

test('a name for nothing is refused rather than guessed at', () => {
  for (const nonsense of ['', 'wikipedia', 'the thing', 'youtube']) assert.equal(idOf(nonsense), null, nonsense)
})

test('every surface is reachable by its own id and by each of its words', () => {
  for (const s of SURFACES) {
    assert.equal(idOf(s.id), s.id, `${s.id} by id`)
    for (const w of s.words) {
      const got = idOf(w)
      // A word may be ambiguous between surfaces, but it must never resolve to a surface that does not list it.
      if (got?.startsWith('ambiguous:')) assert.ok(got.includes(s.id), `${w} -> ${got} should include ${s.id}`)
      else assert.ok(got !== null, `${w} resolves to nothing`)
    }
  }
})

test('every address is one of the browser’s own', () => {
  for (const s of SURFACES) {
    assert.match(s.url, /^chrome:\/\//, s.id)
    // Nothing here may be a web address. A capability that opens http: is tabs.create, and that is a different thing.
    assert.ok(!/^chrome:\/\/(http|www)/.test(s.url), s.id)
  }
})

test('no two surfaces share an id or an address', () => {
  assert.equal(new Set(SURFACES.map((s) => s.id)).size, SURFACES.length)
  assert.equal(new Set(SURFACES.map((s) => s.url)).size, SURFACES.length)
})
