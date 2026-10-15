import assert from 'node:assert/strict'
import { test } from 'node:test'
import { restoreEscapedBreaks } from './escapes.ts'

test('a file that arrived with literal \\n breaks is restored', () => {
  const r = restoreEscapedBreaks('import random\\nfrom midiutil import MIDIFile\\n\\ndef generate(n=32):\\n    return n')
  assert.equal(r.fixed, true)
  assert.equal(r.text, 'import random\nfrom midiutil import MIDIFile\n\ndef generate(n=32):\n    return n')
})

test('real line breaks are never touched', () => {
  const src = 'import a\nprint("x\\ny")\n'
  assert.deepEqual(restoreEscapedBreaks(src), { text: src, fixed: false })
})

test('a one-line program with \\n in a string is left alone', () => {
  const src = 'print("a\\nb\\nc")'
  assert.deepEqual(restoreEscapedBreaks(src), { text: src, fixed: false })
})

test('an escaped backslash survives as the single backslash the source meant', () => {
  const r = restoreEscapedBreaks('import os\\nprint("a\\\\nb")\\nx = 1')
  assert.equal(r.fixed, true)
  assert.equal(r.text, 'import os\nprint("a\\nb")\nx = 1')
})
