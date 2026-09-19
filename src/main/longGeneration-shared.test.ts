import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  continuationInstruction,
  dedupeSeam,
  detectRequestedLength,
  isLongFormRequest,
  MAX_DURATION_MS,
  MAX_SEGMENTS,
  MAX_TOTAL_WORDS,
  shouldContinue,
  wordCount
} from '../shared/longGeneration.ts'

// ---------------------------------------------------------------- reading what was actually asked for

test('an explicit word count is read as the target, and marks the request as long-form', () => {
  assert.deepEqual(detectRequestedLength('Write a 10,000-word essay about artificial intelligence.'), { words: 10_000, wantsLong: true })
  assert.deepEqual(detectRequestedLength('Generate a 20000 word report'), { words: 20_000, wantsLong: true })
  assert.deepEqual(detectRequestedLength('write 500 words'), { words: 500, wantsLong: true })
})

test('a page count is converted to an approximate word target', () => {
  assert.deepEqual(detectRequestedLength('Write a 10-page report'), { words: 5_000, wantsLong: true })
})

test('"comprehensive", "complete guide" and the like ask for long without a number', () => {
  for (const text of ['Write a comprehensive guide to gardening', 'Give me a complete guide to Python', 'Explain this in depth', 'Write a very detailed report on this topic', 'write everything you know about it']) {
    assert.deepEqual(detectRequestedLength(text), { words: null, wantsLong: true }, text)
  }
})

test('an ordinary short request is not treated as long-form', () => {
  assert.deepEqual(detectRequestedLength('Explain photosynthesis.'), { words: null, wantsLong: false })
  assert.deepEqual(detectRequestedLength('Answer this in 2 paragraphs.'), { words: null, wantsLong: false })
  assert.deepEqual(detectRequestedLength('What is the capital of France?'), { words: null, wantsLong: false })
})

test('isLongFormRequest is true for either signal, false for neither', () => {
  assert.equal(isLongFormRequest({ words: 10_000, wantsLong: true }), true)
  assert.equal(isLongFormRequest({ words: null, wantsLong: true }), true)
  assert.equal(isLongFormRequest({ words: null, wantsLong: false }), false)
})

test('word counting is plain and ignores extra whitespace', () => {
  assert.equal(wordCount('one two three'), 3)
  assert.equal(wordCount('  one   two  '), 2)
  assert.equal(wordCount(''), 0)
  assert.equal(wordCount('   '), 0)
})

// ---------------------------------------------------------------- deciding whether to continue

test('a normal finish is never continued, no matter what was asked for', () => {
  assert.equal(shouldContinue({ truncated: false, length: { words: 10_000, wantsLong: true }, generatedWords: 200, segments: 1, elapsedMs: 0 }), false)
})

test('an output-limit stop continues while short of an explicit target', () => {
  assert.equal(shouldContinue({ truncated: true, length: { words: 10_000, wantsLong: true }, generatedWords: 4_000, segments: 1, elapsedMs: 0 }), true)
})

test('stops once close enough to the explicit target — not one word short forever, not far past it', () => {
  assert.equal(shouldContinue({ truncated: true, length: { words: 10_000, wantsLong: true }, generatedWords: 9_800, segments: 3, elapsedMs: 0 }), false)
  assert.equal(shouldContinue({ truncated: true, length: { words: 10_000, wantsLong: true }, generatedWords: 9_600, segments: 3, elapsedMs: 0 }), true)
})

test('a soft "make it long" request continues on truncation without a fixed number to chase', () => {
  assert.equal(shouldContinue({ truncated: true, length: { words: null, wantsLong: true }, generatedWords: 50_000, segments: 2, elapsedMs: 0 }), true)
})

test('an ordinary short request never continues, even if somehow truncated', () => {
  assert.equal(shouldContinue({ truncated: true, length: { words: null, wantsLong: false }, generatedWords: 50, segments: 1, elapsedMs: 0 }), false)
})

test('every safety ceiling stops continuation on its own, regardless of the target', () => {
  const base = { truncated: true, length: { words: 100_000, wantsLong: true }, generatedWords: 100, elapsedMs: 0 }
  assert.equal(shouldContinue({ ...base, segments: MAX_SEGMENTS }), false, 'segment ceiling')
  assert.equal(shouldContinue({ ...base, segments: 1, generatedWords: MAX_TOTAL_WORDS }), false, 'word ceiling')
  assert.equal(shouldContinue({ ...base, segments: 1, elapsedMs: MAX_DURATION_MS }), false, 'time ceiling')
})

// ---------------------------------------------------------------- the continuation instruction itself

test('the continuation instruction carries the original request and never says to restart or summarize', () => {
  const instruction = continuationInstruction({ originalRequest: 'Write a 10,000-word essay about AI.', length: { words: 10_000, wantsLong: true }, generatedWords: 4_000 })
  assert.match(instruction, /Write a 10,000-word essay about AI\./)
  assert.match(instruction, /[Dd]o not restart/)
  assert.match(instruction, /[Dd]o not.*repeat/i)
  assert.match(instruction, /6,000 more words/)
})

test('the continuation instruction says nothing about a remaining count when none was given', () => {
  const instruction = continuationInstruction({ originalRequest: 'Write a comprehensive guide.', length: { words: null, wantsLong: true }, generatedWords: 1_200 })
  assert.doesNotMatch(instruction, /more words would complete/)
})

// ---------------------------------------------------------------- the seam between two segments

test('a sentence the model restarts at the seam is stripped from the new segment, not the old one', () => {
  const before = 'This transformation affects education systems by changing'
  const after = 'education systems by changing how students learn and communicate.'
  // The leading space is kept on purpose: joined onto `before`, which does not end in one, it is what separates
  // the two words rather than fusing them — dropping it would produce "changinghow".
  assert.equal(dedupeSeam(before, after), ' how students learn and communicate.')
  assert.equal(before + dedupeSeam(before, after), 'This transformation affects education systems by changing how students learn and communicate.')
})

test('no overlap means the continuation is left exactly as it was written', () => {
  assert.equal(dedupeSeam('The story began on a quiet morning.', 'A knock came at the door.'), 'A knock came at the door.')
})

test('an overlap only found deep inside the continuation, not at its start, is left alone', () => {
  // "the" appearing again 40 characters in is a coincidence of a common word, not a restarted sentence.
  const before = 'the cat sat on the mat'
  const after = 'Meanwhile, somewhere else entirely, the cat watched from a distance.'
  assert.equal(dedupeSeam(before, after), after)
})

test('a numbered list continues its own numbering rather than being touched by seam dedup', () => {
  assert.equal(dedupeSeam('47. Item forty-seven\n48. Item forty-eight', '49. Item forty-nine\n50. Item fifty'), '49. Item forty-nine\n50. Item fifty')
})
