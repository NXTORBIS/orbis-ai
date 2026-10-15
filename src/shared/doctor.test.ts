import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diskCheck, fileCheck, headline, sortChecks } from './doctor.ts'

test('problems come before warnings before passes, and the headline counts them', () => {
  const list = sortChecks([
    { id: 'a', name: 'A', state: 'ok', detail: '' },
    { id: 'b', name: 'B', state: 'bad', detail: '' },
    { id: 'c', name: 'C', state: 'warn', detail: '' }
  ])
  assert.deepEqual(list.map((c) => c.state), ['bad', 'warn', 'ok'])
  assert.equal(headline(list), '1 problem and 1 thing to look at, out of 3 checks.')
  assert.equal(headline([{ id: 'a', name: 'A', state: 'ok', detail: '' }]), 'All 1 checks passed.')
})

test('a damaged file is named, and clean files are not alarming', () => {
  assert.equal(fileCheck('Data', [{ file: 'notes.json', error: null }]).state, 'ok')
  const c = fileCheck('Data', [{ file: 'notes.json', error: 'Unexpected end' }, { file: 'tasks.json', error: null }])
  assert.equal(c.state, 'bad')
  assert.ok(c.detail.includes('notes.json') && c.detail.includes('1 of 2'))
})

test('low disk space escalates, and an unreadable figure is a warning rather than a pass', () => {
  assert.equal(diskCheck(null).state, 'warn')
  assert.equal(diskCheck(0.5 * 1024 ** 3).state, 'bad')
  assert.equal(diskCheck(3 * 1024 ** 3).state, 'warn')
  assert.equal(diskCheck(50 * 1024 ** 3).state, 'ok')
})
