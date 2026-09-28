import test from 'node:test'
import assert from 'node:assert/strict'
import { isFollowUp, needsContext, ordinalIn, resolve } from './orbReference.ts'
import type { Perception } from './orbTask.ts'

const seen = (over: Partial<Perception> = {}): Perception => ({
  at: 1,
  capabilities: [],
  tabs: [
    { id: 't1', title: 'Docs', url: 'https://docs.example.com', active: true },
    { id: 't2', title: 'News', url: 'https://news.example.com', active: false }
  ],
  page: { url: 'https://docs.example.com', title: 'Docs', selection: '' },
  ...over
})

test('"this page" is the page really in front', () => {
  const r = resolve('summarise this page', seen())
  assert.equal(r.referent?.kind, 'page')
  assert.equal((r.referent as { url: string }).url, 'https://docs.example.com')
})

test('"this page" with no web page in front resolves to nothing, and says so', () => {
  const r = resolve('summarise this page', seen({ page: { url: 'chrome://newtab', title: 'New tab' } }))
  assert.equal(r.referent, null)
  assert.match(r.ask ?? '', /no web page/i)
})

test('the selection is the real selection, and its absence is not filled in', () => {
  const withText = resolve('translate the selected text', seen({ page: { url: 'https://a.com', title: 'A', selection: 'bonjour' } }))
  assert.deepEqual(withText.referent, { kind: 'selection', text: 'bonjour' })
  const without = resolve('translate the selected text', seen())
  assert.equal(without.referent, null)
  assert.match(without.ask ?? '', /nothing is selected/i)
})

test('"the other tab" resolves when there is exactly one, and asks when there are several', () => {
  const one = resolve('close the other tab', seen())
  assert.equal(one.referent?.kind, 'tab')
  assert.equal((one.referent as { id: string }).id, 't2')

  const many = resolve('close the other tab', seen({
    tabs: [
      { id: 't1', title: 'A', url: 'https://a.com', active: true },
      { id: 't2', title: 'B', url: 'https://b.com', active: false },
      { id: 't3', title: 'C', url: 'https://c.com', active: false }
    ]
  }))
  // Guessing here would close the wrong tab, which is not recoverable by noticing.
  assert.equal(many.referent, null)
  assert.match(many.ask ?? '', /which one/i)
})

test('a position is read however it is written', () => {
  assert.deepEqual(ordinalIn('open the second result'), { index: 1, of: 'result' })
  assert.deepEqual(ordinalIn('open the 3rd result'), { index: 2, of: 'result' })
  assert.deepEqual(ordinalIn('the last tab'), { index: -1, of: 'tab' })
  assert.equal(ordinalIn('open the result'), null)
})

test('"the second tab" points at the real second tab', () => {
  const r = resolve('switch to the second tab', seen())
  assert.equal((r.referent as { id: string }).id, 't2')
})

test('a position in something that is not tabs is carried forward rather than invented', () => {
  const r = resolve('open the third result', seen())
  assert.deepEqual(r.referent, { kind: 'ordinal', index: 2, of: 'result' })
})

test('"the result we just found" is the last thing that actually came back', () => {
  const r = resolve('use the result we just found', seen(), { a: 'first', b: 'second' }, ['a', 'b'])
  assert.equal((r.referent as { name: string }).name, 'b')
})

test('asking for an earlier result before anything was produced resolves to nothing', () => {
  const r = resolve('use the previous result', seen(), {}, [])
  assert.equal(r.referent, null)
  assert.match(r.ask ?? '', /no earlier result/i)
})

test('a bare "it" prefers the last result, and falls back to the page', () => {
  const withResult = resolve('it', seen(), { out: 42 }, ['out'])
  assert.equal((withResult.referent as { name: string }).name, 'out')
  const withoutResult = resolve('it', seen(), {}, [])
  assert.equal(withoutResult.referent?.kind, 'page')
})

test('a request that names its own subject needs no resolving', () => {
  assert.equal(needsContext('open wikipedia.org'), false)
  assert.equal(resolve('open wikipedia.org', seen()).referent, null)
  assert.equal(needsContext('summarise this page'), true)
  assert.equal(needsContext('open the second result'), true)
})

test('a follow-up is recognised only when there is something to follow', () => {
  assert.equal(isFollowUp('make it darker', true), true)
  assert.equal(isFollowUp('add a border', true), true)
  assert.equal(isFollowUp('continue from where we stopped', true), true)
  // The same words with nothing before them are a new request, not a change to a previous one.
  assert.equal(isFollowUp('make it darker', false), false)
  assert.equal(isFollowUp('what is the capital of Japan', true), false)
})

test('every unresolved reference comes with something a person can answer', () => {
  for (const request of ['summarise this page', 'use the previous result', 'close the other tab']) {
    const r = resolve(request, seen({ page: { url: 'chrome://newtab', title: 'New tab' }, tabs: [] }), {}, [])
    if (r.referent === null) assert.ok(r.ask && r.ask.length > 0, request)
  }
})
