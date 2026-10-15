import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCaption, countAgainst, insertSection, toggleChip, parseBounded, formatElapsed, isTerminal, CAPTION_MAX } from './composer.ts'

test('caption keeps the brief verbatim and appends chips', () => {
  assert.equal(buildCaption({ brief: 'a  slow song ', chips: ['piano'], tempoBpm: 80 }), 'a  slow song. piano, 80 BPM')
  assert.equal(buildCaption({ brief: ' x ', chips: [], tempoBpm: null }), ' x ')
  assert.equal(buildCaption({ brief: '', chips: ['jazz'], tempoBpm: null }), 'jazz')
})
test('counts never truncate', () => {
  const c = countAgainst('a'.repeat(600), CAPTION_MAX)
  assert.equal(c.over, true); assert.equal(c.used, 600); assert.equal(c.remaining, -88)
})
test('insertSection puts a tag on its own line and keeps text', () => {
  const r = insertSection('la la', 'Chorus', 5)
  assert.equal(r.text, 'la la\n[Chorus]\n')
  assert.equal(r.caret, r.text.length)
  assert.equal(insertSection('', 'Verse', 0).text, '[Verse]\n')
  assert.equal(insertSection('ab', 'Verse', 99).text, 'ab\n[Verse]\n')
})
test('chips toggle, numbers are bounded, time formats', () => {
  assert.deepEqual(toggleChip(['a'], 'b'), ['a', 'b']); assert.deepEqual(toggleChip(['a', 'b'], 'a'), ['b'])
  assert.equal(parseBounded('', { min: 40, max: 220 }), null)
  assert.equal(parseBounded('500', { min: 40, max: 220 }), null)
  assert.equal(parseBounded('90', { min: 40, max: 220 }), 90)
  assert.equal(formatElapsed(65000), '1:05')
  assert.equal(isTerminal('failed'), true); assert.equal(isTerminal('running'), false)
})
