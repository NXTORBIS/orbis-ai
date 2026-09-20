import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardedSource, isolateScriptlet } from './adblockInjector.ts'

test('a scriptlet runs in its own scope', () => {
  assert.match(isolateScriptlet('var a = 1'), /^\(function \(\) \{[\s\S]*var a = 1[\s\S]*\}\)\(\);$/)
})

test('the registered code only runs on the matching domain and is valid JavaScript', () => {
  const src = guardedSource('example.com', ['var x = 1'], ['.ad { display:none !important }'])
  assert.doesNotThrow(() => new Function(src))
  assert.match(src, /"example\.com"/)
  assert.match(src, /display:none/)
  const noStyles = guardedSource('example.com', ['var x = 1'])
  assert.doesNotMatch(noStyles, /addStyle/)
})
