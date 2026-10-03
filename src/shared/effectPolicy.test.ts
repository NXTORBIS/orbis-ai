import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DEFAULT_EFFECT_POLICY, decidingEffect, EFFECTS, readEffectPolicy, refusalFor, ruleFor } from './effectPolicy.ts'

/**
 * What Orbis may do for you, by what it does rather than which part of the browser it touches.
 *
 * The switches were per area, which answers "may Orion touch downloads" -- rarely the question anybody has. The
 * question is "read whatever you like, ask before changing anything, never delete", and that cuts across every area.
 */

test('reading and writing go ahead by default; anything hard to undo asks', () => {
  assert.equal(DEFAULT_EFFECT_POLICY.read, 'allow')
  assert.equal(DEFAULT_EFFECT_POLICY.write, 'allow')
  for (const effect of ['delete', 'communicate', 'execute', 'authenticate'] as const) {
    assert.equal(DEFAULT_EFFECT_POLICY[effect], 'ask', effect)
  }
})

test('nothing starts at never, so a switch nobody chose cannot make Orbis look broken', () => {
  for (const effect of EFFECTS) assert.notEqual(DEFAULT_EFFECT_POLICY[effect], 'never', effect)
})

test('the strictest rule among an action’s effects decides', () => {
  const policy = readEffectPolicy({ read: 'allow', write: 'allow', delete: 'never', communicate: 'ask' })
  assert.equal(ruleFor(['read'], policy), 'allow')
  assert.equal(ruleFor(['write', 'communicate'], policy), 'ask', 'sending is the part that cannot be taken back')
  assert.equal(ruleFor(['write', 'delete'], policy), 'never')
})

test('an action that declares nothing is treated as a change, not as harmless', () => {
  assert.equal(ruleFor([], readEffectPolicy({ write: 'never' })), 'never')
})

test('a refusal names what it would have done, so the setting can be found', () => {
  const said = refusalFor(['write', 'delete'])
  assert.ok(said.includes('remove things'), said)
  assert.ok(said.includes('What Orion may do'), said)
})

test('the deciding effect is the strongest one, not the first one', () => {
  assert.equal(decidingEffect(['read', 'write', 'delete']), 'delete')
  assert.equal(decidingEffect(['write', 'communicate']), 'communicate')
  assert.equal(decidingEffect([]), 'write')
})

test('a damaged or missing setting takes the default, never the loosest value', () => {
  const read = readEffectPolicy({ delete: 'nonsense', write: null })
  assert.equal(read.delete, 'ask', 'not "allow"')
  assert.equal(read.write, 'allow')
  assert.deepEqual(readEffectPolicy(undefined), DEFAULT_EFFECT_POLICY)
  assert.deepEqual(readEffectPolicy('rubbish'), DEFAULT_EFFECT_POLICY)
})

test('a setting that is there is kept exactly', () => {
  const read = readEffectPolicy({ ...DEFAULT_EFFECT_POLICY, read: 'never' })
  assert.equal(read.read, 'never')
})

test('every kind of effect has words a person would use', () => {
  for (const effect of EFFECTS) assert.ok(refusalFor([effect]).length > 20, effect)
})
