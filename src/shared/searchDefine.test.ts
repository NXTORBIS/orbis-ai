import test from 'node:test'
import assert from 'node:assert/strict'
import { WIKTIONARY_LICENCE, readDefinition, wiktionaryUrl, wordToDefine } from './searchDefine.ts'

// The shape Wiktionary really returns, markup and all (checked against the live API).
const REAL = {
  en: [
    {
      partOfSpeech: 'Adjective',
      language: 'English',
      definitions: [
        { definition: 'Lasting for a <a rel="mw:WikiLink" href="/wiki/short" title="short">short</a> period of <a href="/wiki/time">time</a>.' },
        { definition: '<span class="usage-label-sense"></span> Existing for only <a href="/wiki/one">one</a> <a href="/wiki/day">day</a>.' }
      ]
    }
  ]
}

test('the word is found in the ways people ask', () => {
  assert.equal(wordToDefine('define ephemeral'), 'ephemeral')
  assert.equal(wordToDefine('definition of ephemeral'), 'ephemeral')
  assert.equal(wordToDefine('meaning of ephemeral'), 'ephemeral')
  assert.equal(wordToDefine('what does ephemeral mean'), 'ephemeral')
  assert.equal(wordToDefine('ephemeral definition'), 'ephemeral')
})

test('a bare word is a search, not a dictionary lookup', () => {
  assert.equal(wordToDefine('ephemeral'), null)
  assert.equal(wordToDefine('python'), null)
})

test('a phrase is not a dictionary lookup either', () => {
  assert.equal(wordToDefine('define the theory of relativity'), null)
  assert.equal(wordToDefine('what does machine learning mean'), null)
})

test('the markup comes out and the words stay', () => {
  const entry = readDefinition(REAL, 'ephemeral')!
  assert.equal(entry.parts[0].label, 'Adjective')
  assert.equal(entry.parts[0].senses[0].text, 'Lasting for a short period of time.')
  assert.equal(entry.parts[0].senses[1].text, 'Existing for only one day.')
})

test('the entry carries its source and its licence, because Wiktionary requires both', () => {
  const entry = readDefinition(REAL, 'ephemeral')!
  assert.equal(entry.source.site, 'en.wiktionary.org')
  assert.equal(entry.source.licence, WIKTIONARY_LICENCE)
  assert.equal(entry.source.url, wiktionaryUrl('ephemeral'))
})

test('an answer that is not an entry becomes no definition rather than a guess', () => {
  assert.equal(readDefinition(null, 'x'), null)
  assert.equal(readDefinition({}, 'x'), null)
  assert.equal(readDefinition({ en: [] }, 'x'), null)
  assert.equal(readDefinition({ en: [{ partOfSpeech: 'Noun', definitions: [] }] }, 'x'), null)
})

test('a definition that is empty once the markup is gone is not kept', () => {
  const hollow = { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: '<span class="x"></span>' }] }] }
  assert.equal(readDefinition(hollow, 'x'), null)
})

test('an example is kept when the entry gives one, and absent when it does not', () => {
  const withExample = {
    en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'A thing.', examples: ['He held the thing.'] }] }]
  }
  assert.equal(readDefinition(withExample, 'thing')!.parts[0].senses[0].example, 'He held the thing.')
  assert.equal(readDefinition(REAL, 'ephemeral')!.parts[0].senses[0].example, undefined)
})
