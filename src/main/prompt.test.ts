import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt, RESPONSE_STYLE } from './prompt.ts'
import type { Settings } from '../shared/types.ts'

const settings = (extra: Partial<Settings> = {}): Settings => ({ assistantName: 'Orbis', userName: '', userTitle: '', systemPrompt: '', ...extra }) as Settings
const day = new Date('2026-10-16T12:00:00Z')

test('the response-style prompt is the default and names the assistant and the date', () => {
  const p = buildSystemPrompt(settings(), day)
  assert.match(p, /^You are Orbis\. Today is /)
  assert.ok(p.includes(RESPONSE_STYLE))
})

test('it asks for the answer first, honest certainty, and no filler', () => {
  for (const needle of [/Lead with the answer/, /Match length to the question/, /Never invent facts/, /Do not open with filler/, /Follow explicit format instructions/]) {
    assert.match(RESPONSE_STYLE, needle)
  }
})

test('the earlier prompt stays available for comparison', () => {
  const p = buildSystemPrompt(settings(), day, 'v1')
  assert.ok(!p.includes('Lead with the answer'))
  assert.match(p, /Use Markdown: tables for comparisons/)
})

test("the person's own instructions come last, so they win over the defaults", () => {
  const p = buildSystemPrompt(settings({ systemPrompt: 'Always answer in French.', userName: 'Sam', userTitle: 'Dr' }), day)
  assert.ok(p.indexOf('User: Sam (Dr)') > p.indexOf('How to answer:'))
  assert.ok(p.trim().endsWith('Always answer in French.'))
})

test('it is not so long that it crowds out the conversation', () => {
  assert.ok(RESPONSE_STYLE.length < 2200)
})
