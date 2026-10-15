import assert from 'node:assert/strict'
import { test } from 'node:test'
import { active, add, correct, emptyMemory, exportMemory, explainInfluence, importMemory, rejectSuggestion, type Memory } from './memory.ts'

const ok = (r: ReturnType<typeof add>): Memory => { assert.equal(r.ok, true); return r.memory }

test('add and scope filter', () => {
  let m = ok(add(emptyMemory(), { scope: 'project', kind: 'hard-constraint', text: 'no vocals', createdAt: 1 }))
  m = ok(add(m, { scope: 'version', kind: 'observation', text: 'drums felt thin', createdAt: 2 }))
  assert.equal(active(m).length, 2)
  assert.equal(active(m, 'project').length, 1)
  assert.equal(add(m, { scope: 'project', kind: 'decision', text: '  ', createdAt: 3 }).ok, false)
})
test('correct supersedes without deleting', () => {
  let m = ok(add(emptyMemory(), { scope: 'project', kind: 'soft-preference', text: 'warm tone', createdAt: 1 }))
  const r = correct(m, 'm1', 'bright tone', 2)
  assert.equal(r.ok, true)
  m = r.memory
  assert.equal(m.records.length, 2)
  assert.equal(m.records[0].status, 'superseded')
  assert.equal(m.records[1].supersedes, 'm1')
  assert.deepEqual(active(m).map((x) => x.text), ['bright tone'])
  assert.equal(correct(m, 'm1', 'x', 3).ok, false)
})
test('rejected suggestion never returns', () => {
  let m = ok(add(emptyMemory(), { scope: 'project', kind: 'suggestion', text: 'Add strings!', createdAt: 1 }))
  const r = rejectSuggestion(m, 'm1')
  assert.equal(r.ok, true)
  m = r.memory
  assert.equal(active(m).length, 0)
  assert.equal(add(m, { scope: 'project', kind: 'suggestion', text: 'add strings', createdAt: 2 }).ok, false)
  assert.equal(rejectSuggestion(ok(add(m, { scope: 'project', kind: 'decision', text: 'd', createdAt: 3 })), 'm2').ok, false)
})
test('explain influence', () => {
  let m = ok(add(emptyMemory(), { scope: 'project', kind: 'soft-preference', text: 'warm piano', createdAt: 1 }))
  m = ok(add(m, { scope: 'project', kind: 'hard-constraint', text: 'no vocals', createdAt: 2 }))
  m = ok(add(m, { scope: 'project', kind: 'soft-preference', text: 'jagged noise', createdAt: 3 }))
  const e = explainInfluence(m, 'A warm piano piece at 90 bpm')
  assert.deepEqual(e.map((x) => x.id), ['m1', 'm2'])
  assert.ok(/not found as wording/.test(e[1].why))
})
test('export/import validates', () => {
  let m = ok(add(emptyMemory(), { scope: 'project', kind: 'decision', text: 'keep 90 bpm', createdAt: 1 }))
  assert.deepEqual(importMemory(exportMemory(m)).memory, m)
  const bad = JSON.stringify({ version: 1, records: [{ id: 'a', scope: 'galaxy', kind: 'decision', text: 't', status: 'active', createdAt: 1 }, 5, { id: 'm1', scope: 'project', kind: 'decision', text: 't', status: 'active', createdAt: 1 }], rejectedSuggestions: [] })
  const r = importMemory(bad)
  assert.equal(r.memory.records.length, 1)
  assert.equal(r.rejected.length, 2)
  assert.ok(importMemory('{nope').error)
  assert.ok(importMemory('{"version":2,"records":[]}').error)
})
