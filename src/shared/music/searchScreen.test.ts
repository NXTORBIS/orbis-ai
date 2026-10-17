import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  MAX_RECENT_SEARCHES,
  biggestGroups,
  describedWords,
  forgetSearch,
  matchesName,
  matchingGroups,
  movePick,
  nothingFoundWords,
  notUnderstoodWords,
  placesWords,
  readRecentSearches,
  rememberSearch,
  searchable,
  versionWords,
  worthRemembering
} from './searchScreen.ts'

test('searchable tidies the words and caps the length', () => {
  assert.equal(searchable('  the   weeknd  '), 'the weeknd')
  assert.equal(searchable('a\n\tb'), 'a b')
  assert.equal(searchable(42), '')
  assert.equal(searchable(undefined), '')
  assert.equal(searchable('x'.repeat(500)).length, 300)
})

test('one letter is not worth remembering', () => {
  assert.equal(worthRemembering('a'), false)
  assert.equal(worthRemembering('  a  '), false)
  assert.equal(worthRemembering('ab'), true)
})

test('the recent list is read back safely', () => {
  assert.deepEqual(readRecentSearches(null), [])
  assert.deepEqual(readRecentSearches('nope'), [])
  assert.deepEqual(readRecentSearches(['one', 2, '', 'ONE', 'two']), ['one', 'two'])
  assert.equal(readRecentSearches(Array.from({ length: 40 }, (_, i) => `n${i}`)).length, MAX_RECENT_SEARCHES)
})

test('remembering moves an entry rather than repeating it', () => {
  assert.deepEqual(rememberSearch(['bb', 'aa'], 'aa'), ['aa', 'bb'])
  assert.deepEqual(rememberSearch(['bb', 'aa'], 'AA'), ['AA', 'bb'])
  assert.deepEqual(rememberSearch(['bb'], 'x'), ['bb'], 'one letter changes nothing')
  assert.equal(rememberSearch(Array.from({ length: 8 }, (_, i) => `n${i}`), 'new').length, MAX_RECENT_SEARCHES)
})

test('forgetting takes one entry out, whatever its case', () => {
  assert.deepEqual(forgetSearch(['Abba', 'b'], 'abba'), ['b'])
  assert.deepEqual(forgetSearch(['aa'], 'z'), ['aa'])
})

test('a name matches when every word is somewhere in it, in any order', () => {
  assert.equal(matchesName('The Dark Side of the Moon', 'dark side'), true)
  assert.equal(matchesName('The Dark Side of the Moon', 'moon dark'), true)
  assert.equal(matchesName('The Dark Side of the Moon', 'dark sun'), false)
  assert.equal(matchesName("Don't Stop Me Now", 'dont stop'), true, 'punctuation does not block a match')
  assert.equal(matchesName('anything', ''), false, 'an empty search matches nothing rather than everything')
})

test('the keyboard wraps at both ends and says when there is nowhere to go', () => {
  assert.equal(movePick(-1, 0, 1), -1)
  assert.equal(movePick(-1, 3, 1), 0)
  assert.equal(movePick(-1, 3, -1), 2)
  assert.equal(movePick(2, 3, 1), 0)
  assert.equal(movePick(0, 3, -1), 2)
})

test('a description is only called out when it mostly was one', () => {
  assert.equal(describedWords(0.2), null)
  assert.equal(describedWords(0.5), null)
  assert.equal(describedWords('lots'), null)
  assert.match(describedWords(0.8) ?? '', /description/)
})

test('words Orbis could not read are named', () => {
  assert.equal(notUnderstoodWords([]), null)
  assert.equal(notUnderstoodWords(['', '  ']), null)
  assert.equal(notUnderstoodWords(null), null)
  assert.equal(notUnderstoodWords(['glorp', ' zib ']), 'Orbis could not read: glorp, zib')
})

test('a source that was never set up and one that failed get different sentences', () => {
  const said = placesWords([
    { id: 'local', name: 'Music on this computer', ok: true, ready: true },
    { id: 'catalogue', name: 'Music catalogue', ok: false, ready: false, reason: 'Orbis has no catalogue set up.' },
    { id: 'other', name: 'Somewhere else', ok: false, ready: true }
  ])
  assert.deepEqual(said, ['Music catalogue: Orbis has no catalogue set up.', 'Somewhere else could not be asked this time.'])
  assert.deepEqual(placesWords('nope'), [])
})

test('nothing found says what was looked for', () => {
  assert.match(nothingFoundWords('abba').title, /"abba"/)
  assert.equal(nothingFoundWords('').title, 'Nothing matches')
})

test('a version reads as words, and an ordinary recording has none', () => {
  assert.equal(versionWords({ kind: 'live', said: 'Live', by: null }), 'Live')
  assert.equal(versionWords({ kind: 'remix', said: 'Remix', by: 'Kygo' }), 'Kygo remix')
  assert.equal(versionWords({ kind: 'original', said: '', by: null }), '')
  assert.equal(versionWords(null), '')
  assert.equal(versionWords({ nope: 1 }), '')
})

test('matching groups come back biggest first', () => {
  const groups = [
    { name: 'Blue', tracks: [{ id: '1' }] },
    { name: 'Blue Lines', tracks: [{ id: '2' }, { id: '3' }, { id: '4' }] },
    { name: 'Red', tracks: [{ id: '5' }] }
  ]
  assert.deepEqual(
    matchingGroups(groups, 'blue').map((one) => one.name),
    ['Blue Lines', 'Blue']
  )
  assert.deepEqual(matchingGroups(groups, 'green'), [])
  assert.equal(matchingGroups(groups, 'blue', 1).length, 1)
})

test('a group also matches on who it is by', () => {
  const groups = [{ name: 'Nevermind', by: 'Nirvana', tracks: [{ id: '1' }] }]
  assert.equal(matchingGroups(groups, 'nirvana').length, 1)
})

test('browse-all is biggest first and capped', () => {
  const groups = [
    { name: 'A', tracks: [{ id: '1' }] },
    { name: 'B', tracks: [{ id: '2' }, { id: '3' }] }
  ]
  assert.deepEqual(
    biggestGroups(groups).map((one) => one.name),
    ['B', 'A']
  )
  assert.equal(biggestGroups(groups, 1).length, 1)
})
