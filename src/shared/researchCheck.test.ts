import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { disagreementNote, disagreements, dropRepeats, fingerprint, overlap, statedNumbers } from './researchCheck.ts'

/**
 * The two things research was leaving to a model: spotting that two sources are one page, and spotting that they
 * disagree. Both are now worked out from the text, so both are tested without a model or a network.
 */

const ARTICLE =
  'The committee published its findings on Tuesday after a review lasting eleven months. Inspectors visited twelve sites across the region and interviewed more than two hundred staff. The report recommends replacing the ageing ventilation equipment before the next inspection cycle begins in the autumn.'

const SAME_STORY_DIFFERENT_WORDS =
  'Following an eleven month review the panel released conclusions on Tuesday. Twelve regional sites were inspected and over two hundred employees spoke to investigators. Ageing ventilation plant should be replaced ahead of the autumn inspection round, the document argues.'

test('the same article at two addresses is read once', () => {
  const kept = dropRepeats(
    [
      { url: 'https://news.example/story', text: ARTICLE },
      { url: 'https://mirror.example/amp/story', text: ARTICLE }
    ],
    (one) => one.text
  )
  assert.equal(kept.kept.length, 1)
  assert.equal(kept.kept[0].url, 'https://news.example/story', 'the first, because the list arrives best-first')
  assert.equal(kept.repeats[0].dropped.url, 'https://mirror.example/amp/story')
})

test('two separate accounts of one story are both kept', () => {
  const kept = dropRepeats(
    [
      { url: 'https://a.example/', text: ARTICLE },
      { url: 'https://b.example/', text: SAME_STORY_DIFFERENT_WORDS }
    ],
    (one) => one.text
  )
  assert.equal(kept.kept.length, 2, 'sharing facts is not sharing phrasing; dropping a real second source is the worse mistake')
})

test('a page too short to judge is kept rather than guessed at', () => {
  const kept = dropRepeats([{ text: 'Short.' }, { text: 'Short.' }], (one) => one.text)
  assert.equal(kept.kept.length, 2)
})

test('an extract of a long article still reads as the same text', () => {
  const long = `${ARTICLE} ${ARTICLE} ${ARTICLE}`
  assert.ok(overlap(fingerprint(ARTICLE), fingerprint(long)) >= 0.8)
})

test('two pages about nothing alike share nothing', () => {
  assert.ok(overlap(fingerprint(ARTICLE), fingerprint('Recipes for bread require flour water salt and yeast mixed well')) < 0.1)
})

test('a number is read with what it is about, and its size suffix applied', () => {
  const found = statedNumbers('The laptop costs 55,000 rupees today. Battery life reaches 14 hours. Revenue hit 2.5 million dollars.')
  const values = found.map((one) => one.value)
  assert.ok(values.includes(55000), values.join(','))
  assert.ok(values.includes(14))
  assert.ok(values.includes(2_500_000), values.join(','))
})

test('a number with nothing said about it is not collected, because it cannot be compared', () => {
  assert.deepEqual(statedNumbers('42'), [])
})

test('sources stating different prices for the same thing are reported as disagreeing', () => {
  const found = disagreements([
    { n: 1, text: 'The laptop price today is 55,000 rupees at most retailers.' },
    { n: 2, text: 'The laptop price today is 40,000 rupees after the discount.' }
  ])
  assert.equal(found.length, 1, JSON.stringify(found))
  assert.deepEqual(found[0].readings.map((r) => r.n), [1, 2])
  assert.deepEqual(found[0].readings.map((r) => r.value), [55000, 40000])
})

test('a rounding is not a disagreement', () => {
  const found = disagreements([
    { n: 1, text: 'The laptop price today is 55,000 rupees at most retailers.' },
    { n: 2, text: 'The laptop price today is 55,400 rupees at most retailers.' }
  ])
  assert.deepEqual(found, [])
})

test('numbers about different things are not compared with each other', () => {
  const found = disagreements([
    { n: 1, text: 'Battery life reaches 14 hours of video playback.' },
    { n: 2, text: 'The warranty covers 36 months of accidental damage.' }
  ])
  assert.deepEqual(found, [])
})

test('what Orion is told states both figures and refuses to pick one', () => {
  const note = disagreementNote(
    disagreements([
      { n: 1, text: 'The laptop price today is 55,000 rupees at most retailers.' },
      { n: 3, text: 'The laptop price today is 40,000 rupees after the discount.' }
    ])
  )!
  assert.ok(note.includes('[1]'))
  assert.ok(note.includes('[3]'))
  assert.ok(note.includes('has not decided which is right'), note)
  assert.ok(note.includes('do not quietly pick one'), note)
})

test('sources that agree produce nothing to say', () => {
  assert.equal(disagreementNote([]), null)
})
