import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeAnswer, countBullets, countWords, hasNumericAnswer, leadsWithAnswer } from './answerMetrics.ts'

test('words are counted without markdown marks', () => {
  assert.equal(countWords('- one two\n- **three**  four ---'), 4)
  assert.equal(countWords(''), 0)
})

test('filler openers are caught, direct answers are not', () => {
  for (const t of ['Great question! The answer is 4.', 'Certainly, here you go.', 'Sure! Here it is.', 'As an AI, I cannot.', "I'd be happy to help with that."]) {
    assert.equal(leadsWithAnswer(t), false, t)
  }
  for (const t of ['Canberra.', '**Canberra** is the capital.', 'Sure enough, it rose.', '## Answer\n288 km.']) assert.equal(leadsWithAnswer(t), true, t)
})

test('closers and openers are counted as filler', () => {
  const m = analyzeAnswer('Great question! It is 4. I hope this helps. Let me know if you need more.')
  assert.equal(m.fillerPhrases, 3)
  assert.equal(analyzeAnswer('It is 4.').fillerPhrases, 0)
})

test('numeric answers compare as numbers', () => {
  assert.ok(hasNumericAnswer('It takes $1,989.0 total', 1989))
  assert.ok(hasNumericAnswer('about 30 dollars', '30'))
  assert.ok(!hasNumericAnswer('about 300 dollars', '30'))
  assert.ok(!hasNumericAnswer('twelve', '12'))
  assert.equal(analyzeAnswer('x', {}).numericAnswerPresent, null)
})

test('word limits and bullet counts are exact checks, null when unset', () => {
  const three = '- a b\n- c\n* d'
  assert.equal(countBullets(three), 3)
  assert.equal(analyzeAnswer(three, { bullets: 3 }).bulletsOk, true)
  assert.equal(analyzeAnswer(three, { bullets: 4 }).bulletsOk, false)
  assert.equal(analyzeAnswer(three).bulletsOk, null)
  assert.equal(analyzeAnswer('one two three', { maxWords: 3 }).withinMaxWords, true)
  assert.equal(analyzeAnswer('one two three four', { maxWords: 3 }).withinMaxWords, false)
  assert.equal(countBullets('```\n- not a bullet\n```\n1. real'), 1)
})

test('mustContain reports what is missing', () => {
  const m = analyzeAnswer('def fizzbuzz(n): pass', { mustContain: ['def fizzbuzz', 'range'] })
  assert.equal(m.mustContainOk, false)
  assert.deepEqual(m.mustContainMissing, ['range'])
  assert.equal(analyzeAnswer('FIZZBUZZ', { mustContain: ['fizzbuzz'] }).mustContainOk, true)
})

test('an unclosed code fence is flagged', () => {
  assert.equal(analyzeAnswer('```js\nlet a = 1').unbalancedCodeFence, true)
  assert.equal(analyzeAnswer('```js\nlet a = 1\n```').unbalancedCodeFence, false)
})

test('repetition is measured on sentences and word windows', () => {
  const s = 'The cat sat on the mat today. The cat sat on the mat today. Something else entirely happened here.'
  const m = analyzeAnswer(s)
  assert.equal(m.repeatedSentences, 1)
  assert.ok(m.repeatedWindowShare > 0)
  const clean = analyzeAnswer('One two three four five. Six seven eight nine ten.')
  assert.equal(clean.repeatedSentences, 0)
  assert.equal(clean.repeatedWindowShare, 0)
})

test('hedging is only judged when the question expects uncertainty', () => {
  assert.equal(analyzeAnswer('It will be 4.').hedged, null)
  assert.equal(analyzeAnswer('It will be 4.', { uncertain: true }).hedged, false)
  assert.equal(analyzeAnswer("I can't predict that; it depends on markets.", { uncertain: true }).hedged, true)
})
