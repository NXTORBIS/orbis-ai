import test from 'node:test'
import assert from 'node:assert/strict'
import { detectIntents, guessEntity, imageRelevance, moduleOrder, parseQuery, planModules, understand } from './searchIntent.ts'
import { correctQuery, correctionLines, editDistance, isTransposition, letterDistance, mustNotCorrect } from './searchCorrection.ts'

const intentOf = (query: string): string => understand(query).intent
const modules = (query: string): string[] => moduleOrder(understand(query))
const has = (query: string, module: string): boolean => modules(query).includes(module)

// ---------------------------------------------------------------- reading the query

test('a sum is arithmetic, not a search', () => {
  assert.equal(intentOf('25 × 48'), 'calculation')
  assert.equal(intentOf('2^10'), 'calculation')
  assert.equal(intentOf('15% of 850'), 'calculation')
})

test('a sum is answered exactly, and does not drag a page of modules behind it', () => {
  const page = modules('25 × 48')
  assert.ok(page.includes('calculator'))
  assert.ok(!page.includes('images'), 'no image strip for arithmetic')
  assert.ok(!page.includes('knowledge'))
  assert.ok(!page.includes('peopleAlsoAsk'), 'nobody has follow-up questions about a multiplication')
})

test('the other askings are told apart', () => {
  assert.equal(intentOf('define ephemeral'), 'definition')
  assert.equal(intentOf('weather in chennai'), 'weather')
  assert.equal(intentOf('cafes near me'), 'local')
  assert.equal(intentOf('how to install python'), 'howto')
  assert.equal(intentOf('python vs java'), 'comparison')
  assert.equal(intentOf('100 km to miles'), 'conversion')
  assert.equal(intentOf('https://example.com'), 'navigational')
})

test('an ambiguous query keeps both readings rather than picking one and hiding the other', () => {
  const both = detectIntents(parseQuery('best laptop under 1000 reviews')).map((i) => i.intent)
  assert.ok(both.includes('shopping'))
  assert.ok(both.includes('informational'))
})

test('a shopping query reads as one, but draws no module, because there is no source of prices', () => {
  // The reading is real and worth keeping; what is missing is a product catalogue. Rather than show an empty
  // Shopping section, or one filled with invented prices, the page simply has no such section.
  assert.ok(detectIntents(parseQuery('buy iphone 15 cheapest price')).some((i) => i.intent === 'shopping'))
  assert.ok(!modules('buy iphone 15 cheapest price').includes('shopping'))
})

test('a sports query asks for coverage, which Orbis can really get', () => {
  const page = modules('premier league standings')
  assert.ok(page.includes('sports'))
  assert.ok(page.includes('web'))
})

test('a query that is not about sport gets no sports section', () => {
  assert.ok(!modules('Albert Einstein biography').includes('sports'))
  assert.ok(!modules('define ephemeral').includes('sports'))
})

// ---------------------------------------------------------------- what is being named

test('a name with a word saying what kind of name it is, is the strong case', () => {
  const strong = guessEntity(parseQuery('Albert Einstein biography'))
  assert.equal(strong?.kind, 'person')
  assert.ok(strong!.confidence >= 0.7)
})

test('a bare capitalised name is a guess, not enough for a knowledge panel', () => {
  const weak = guessEntity(parseQuery('Lee Chong Wei'))
  assert.equal(weak?.kind, 'person')
  assert.ok(weak!.confidence < 0.55, 'a bare name alone must not draw a panel')
  assert.ok(!has('Lee Chong Wei', 'knowledge'))
})

test('an identifier is not a person however it is capitalised', () => {
  assert.equal(guessEntity(parseQuery('TypeError: undefined is not a function')), null)
  assert.equal(guessEntity(parseQuery('react-router-dom v6')), null)
  assert.equal(guessEntity(parseQuery('site:docs.python.org asyncio')), null)
})

test('organisations, places and products are told apart from people', () => {
  assert.equal(guessEntity(parseQuery('NASA headquarters founded'))?.kind, 'organization')
  assert.equal(guessEntity(parseQuery('Chennai population'))?.kind, 'place')
  assert.equal(guessEntity(parseQuery('iPhone 15 specifications'))?.kind, 'product')
})

// ---------------------------------------------------------------- whether pictures help

test('pictures help for things you look at, and not for things you read', () => {
  assert.ok(imageRelevance(parseQuery('golden retriever photos'), null) > 0.8)
  assert.ok(imageRelevance(parseQuery('python typeerror undefined'), null) < 0.2)
  assert.ok(imageRelevance(parseQuery('meaning of ephemeral'), null) < 0.2)
})

test('an image strip is not forced onto a query pictures would not serve', () => {
  assert.ok(!has('npm install fails with EACCES', 'images'))
  assert.ok(!has('define ephemeral', 'images'))
})

// ---------------------------------------------------------------- composing the page

test('the page is not the same page every time', () => {
  const sum = modules('25 × 48').join(',')
  const person = modules('Albert Einstein biography').join(',')
  const howto = modules('how to install python').join(',')
  assert.notEqual(sum, person)
  assert.notEqual(person, howto)
})

test('a person leads with who they are, then the pages about them', () => {
  const page = modules('Albert Einstein biography')
  assert.ok(page.indexOf('knowledge') < page.indexOf('web'), 'who before what was written')
  assert.ok(page.includes('images'))
  assert.ok(page.includes('peopleAlsoSearchFor'))
})

test('a correction always sits above whatever the page turned out to be', () => {
  assert.equal(modules('Albert Einstein biography')[0], 'correction')
  assert.equal(modules('25 × 48')[0], 'correction')
})

test('web results are on every page, because somebody searched for something', () => {
  for (const query of ['25 × 48', 'Albert Einstein', 'how to install python', 'cafes near me', 'define ephemeral']) {
    assert.ok(has(query, 'web'), `web results missing for ${query}`)
  }
})

test('a module is dropped rather than shown for the sake of existing', () => {
  const page = modules('https://example.com/docs')
  assert.ok(!page.includes('relatedSearches'))
  assert.ok(!page.includes('images'))
  assert.ok(!page.includes('peopleAlsoAsk'))
})

test('every chosen module can say why it is there', () => {
  for (const plan of planModules(understand('Albert Einstein biography'))) {
    assert.ok(plan.because.length > 0, `${plan.module} has no reason`)
    assert.ok(plan.confidence >= 0.3)
  }
})

test('something current asks for news without being told the word', () => {
  assert.ok(understand('iphone 17 launch today').needsFresh)
  assert.ok(has('iphone 17 launch today', 'news'))
  assert.ok(!understand('pythagorean theorem').needsFresh)
})

// ---------------------------------------------------------------- correcting, and mostly not

test('a model name is not a misspelling of an ordinary word', () => {
  assert.equal(correctQuery('Qwen', ['Queen', 'Quen']), null)
})

test('what must never be touched, is not', () => {
  for (const query of ['https://example.com', 'example.com/path', 'react-router-dom', 'v6.2.1', 'npm install', 'site:python.org asyncio', '"exact phrase"', 'getElementById', 'user_name']) {
    assert.equal(mustNotCorrect(query), true, `${query} should be left alone`)
    assert.equal(correctQuery(query, ['something else entirely']), null)
  }
})

test('a missing space in a name is caught, because the letters are what matter', () => {
  const fix = correctQuery('leec hong wei', ['Lee Chong Wei', 'Badminton', 'Lin Dan'])
  assert.equal(fix?.corrected, 'Lee Chong Wei')
  assert.ok(fix!.confidence >= 0.6)
})

test('a correction needs evidence: with nothing returned from the web, a name is left alone', () => {
  assert.equal(correctQuery('leec hong wei', []), null)
})

test('what was typed is never corrected to something it already matches', () => {
  assert.equal(correctQuery('Lee Chong Wei', ['Lee Chong Wei', 'Lin Dan']), null)
})

test('a short word is not rewritten on the strength of one letter', () => {
  assert.equal(correctQuery('cat', ['car']), null)
  assert.equal(correctQuery('go', [' go']), null)
})

test('a plain misspelling is fixed without needing the web to vouch for it', () => {
  const fix = correctQuery('teh enviroment', [])
  assert.equal(fix?.corrected, 'the environment')
})

test('the page offers both readings, and says which it ran', () => {
  const fix = correctQuery('leec hong wei', ['Lee Chong Wei'])!
  const lines = correctionLines(fix)
  assert.equal(lines.showing, 'These are results for Lee Chong Wei')
  assert.equal(lines.instead, 'Search instead for leec hong wei')
})

test('the distance measures behave', () => {
  assert.equal(editDistance('kitten', 'sitting', 5), 3)
  assert.equal(editDistance('same', 'same'), 0)
  assert.ok(editDistance('short', 'a completely different string', 3) > 3, 'gives up rather than computing forever')
  assert.equal(isTransposition('recieve', 'receive'), true)
  assert.equal(isTransposition('abc', 'acb'), true)
  assert.equal(isTransposition('abc', 'xyz'), false)
  // Zero, not one: once the spaces come out these are the same letters, which is how a missing space is seen at all.
  assert.equal(letterDistance('leec hong wei', 'Lee Chong Wei'), 0)
})
