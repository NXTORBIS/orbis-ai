import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_MODEL, CORE, MAX, resolveModel, routeModel, ULTRA } from '../shared/modelRoute.ts'
import { isKnownModel, MODELS } from '../shared/models.ts'

test('quick everyday questions get the fast model', () => {
  for (const text of ['hi', 'What is the capital of France?', 'Recommend a good sci-fi movie', 'what time is it in Tokyo']) {
    assert.equal(routeModel({ text }).model, CORE, text)
  }
})

test('reasoning, maths and code get the most careful model', () => {
  for (const text of [
    'Prove that the square root of 2 is irrational',
    'Compare SQLite and Postgres for a desktop app and explain the trade-offs',
    'Why does my React component render twice?',
    'Debug this: TypeError: cannot read properties of undefined',
    'const x = items.map((i) => i.id); why is x empty?',
    'what is 17 * 23 + 4 =',
    'Write a python function that reverses a linked list'
  ]) {
    assert.equal(routeModel({ text }).model, MAX, text)
  }
})

test('writing gets the writing model', () => {
  for (const text of ['Write a short poem about the monsoon', 'Draft an email to my landlord about the leaking tap', 'Polish this paragraph so it sounds friendlier']) {
    assert.equal(routeModel({ text }).model, ULTRA, text)
  }
})

test('long material gets the careful model even when the question is simple', () => {
  assert.equal(routeModel({ text: 'what is this about?', attachmentChars: 20_000 }).model, MAX)
})

test('Auto is resolved to a real model, and a model someone chose is never overridden', () => {
  assert.equal(resolveModel(AUTO_MODEL, { text: 'hi' }).model, CORE)
  assert.deepEqual(resolveModel(ULTRA, { text: 'Prove Fermat' }), { model: ULTRA, reason: 'chosen' })
  for (const route of [routeModel({ text: 'x' }), routeModel({ text: 'prove it' }), routeModel({ text: 'write a poem' })]) {
    assert.ok(isKnownModel(route.model) && route.model !== AUTO_MODEL, `${route.model} is a real model`)
  }
  assert.ok(MODELS.some((m) => m.id === AUTO_MODEL), 'Auto can be picked')
})
