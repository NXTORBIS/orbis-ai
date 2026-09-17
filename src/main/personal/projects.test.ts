import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newWorkspace, normalizeWorkspace, projectsMentioned, withoutProjectItem, withProjectItem } from '../../shared/workspaces.ts'

test('a workspace becomes a project by having a goal and items, and keeps only valid references', () => {
  const plain = newWorkspace({ id: 'w1', name: 'Kitchen renovation' })
  assert.equal(plain.project, undefined)
  const project = withProjectItem(withProjectItem(plain, 'note:abc', 5), 'search:s1', 6)
  assert.deepEqual(project.project!.items.map((i) => i.ref), ['note:abc', 'search:s1'])
  assert.equal(withProjectItem(project, 'note:abc').project!.items.length, 2, 'adding again changes nothing')
  assert.deepEqual(withoutProjectItem(project, 'note:abc').project!.items.map((i) => i.ref), ['search:s1'])

  const loaded = normalizeWorkspace({ ...project, project: { goal: '  Finish   by March  ', items: [...project.project!.items, { ref: 'file:C:/Windows/system32', addedAt: 1 }, { ref: 'javascript:alert(1)', addedAt: 1 }, { ref: 'note:abc', addedAt: 9 }] } })!
  assert.equal(loaded.project!.goal, 'Finish by March')
  assert.deepEqual(loaded.project!.items.map((i) => i.ref), ['note:abc', 'search:s1'], 'references to files, scripts and repeats are dropped')
  assert.equal(normalizeWorkspace({ ...plain })!.project, undefined, 'and a workspace without one stays without')
})

test('a message is about a project only when it names it whole', () => {
  const list = [
    { id: 'p1', name: 'Orbis', project: { goal: '', items: [] } },
    { id: 'p2', name: 'Kitchen renovation', project: { goal: '', items: [] } },
    { id: 'p3', name: 'Art', project: { goal: '', items: [] } },
    { id: 'w1', name: 'Reading', project: undefined }
  ]
  assert.deepEqual(projectsMentioned('Continue my Orbis project', list), ['p1'])
  assert.deepEqual(projectsMentioned("what's left on kitchen renovation?", list), ['p2'])
  assert.deepEqual(projectsMentioned('How do I start painting?', list), [], '"Art" is not in "start"')
  assert.deepEqual(projectsMentioned('I am reading a book', list), [], 'a workspace that is not a project is never picked')
})
