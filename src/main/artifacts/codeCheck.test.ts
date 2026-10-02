import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileJavaScript } from './codeCheck.ts'

test('JavaScript that compiles is fine, and nothing in it runs', () => {
  const marker = '__orbis_code_check_ran__'
  assert.equal(compileJavaScript(`globalThis.${marker} = true; process.exit(7)`), null)
  assert.equal((globalThis as Record<string, unknown>)[marker], undefined, 'the file was compiled, not run')
  assert.equal(compileJavaScript('function f(a, b) { return a + b }\nconst x = f(1, 2)'), null)
})

test('JavaScript that does not compile comes back with the engine\'s complaint and its line', () => {
  const problem = compileJavaScript('const a = 1\nfunction f( {\n  return 2\n}')
  assert.ok(problem && problem !== 'module')
  // The engine says where it noticed, which for an unclosed bracket is a line or two after where it was opened.
  assert.match(String(problem), /\(line [23]\)$/)
  assert.ok(String(problem).length <= 200)
})

test('import and export are reported as something this check cannot read, not as an error in the file', () => {
  assert.equal(compileJavaScript("import fs from 'node:fs'\nfs.readFileSync('x')"), 'module')
  assert.equal(compileJavaScript('export const a = 1'), 'module')
})
