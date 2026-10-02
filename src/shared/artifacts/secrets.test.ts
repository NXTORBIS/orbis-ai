import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gateForWrite } from './secrets.ts'

// Shaped like a GitHub token. Not a real one: the pattern wants the prefix and twenty-plus characters after it.
const KEY = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'

test('a file with something key-shaped in it is not written', () => {
  const gate = gateForWrite('notes.csv', `name,token\nalice,${KEY}\n`, false)
  assert.equal(gate.ok, false)
  assert.equal(gate.findings.length, 1)
  assert.equal(gate.findings[0].line, 2)
  assert.match(gate.message, /GitHub token/)
  assert.match(gate.message, /line 2/)
})

test('the refusal never quotes the key', () => {
  const gate = gateForWrite('notes.csv', `token\n${KEY}\n`, false)
  assert.equal(gate.message.includes(KEY), false)
  assert.equal(JSON.stringify(gate.findings).includes(KEY), false)
})

test('a person who was shown the findings can have it written anyway', () => {
  const gate = gateForWrite('notes.csv', `token\n${KEY}\n`, true)
  assert.equal(gate.ok, true)
  // The findings are still reported, so the caller can say what it is writing.
  assert.equal(gate.findings.length, 1)
})

test('ordinary text passes with nothing to say', () => {
  const gate = gateForWrite('notes.csv', 'name,age\nalice,30\n', false)
  assert.equal(gate.ok, true)
  assert.equal(gate.message, '')
})
