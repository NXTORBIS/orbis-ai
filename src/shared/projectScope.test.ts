import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { conversationRef, newWorkspace, normalizeWorkspace, projectBriefing, projectOfConversation, withProjectItem, withoutProjectItem, type Workspace } from './workspaces.ts'

/**
 * A project that can hold the conversation it is about, and work the way the person asked.
 *
 * Both were missing: a project could list notes, tasks and research but not a chat, and the only thing it could say
 * about how to work was a goal that was explicitly *not* followed. These guard the two halves, and the boundary --
 * instructions apply inside the project and nowhere else.
 */

const project = (name: string, patch: Partial<NonNullable<Workspace['project']>> = {}): Workspace => ({
  ...newWorkspace({ id: name, name }),
  project: { goal: '', instructions: '', items: [], ...patch }
})

test('a project can hold a conversation, which it could not before', () => {
  const put = withProjectItem(project('Physics'), conversationRef('c-1'))
  assert.deepEqual(put.project?.items.map((i) => i.ref), ['conversation:c-1'])
})

test('a project can hold another workspace, which it used to refuse', () => {
  const put = withProjectItem(project('Physics'), 'workspace:w-2')
  assert.equal(put.project?.items.length, 1)
})

test('a chat knows which project it is in, and is only ever in one', () => {
  const physics = withProjectItem(project('Physics'), conversationRef('c-1'))
  const cooking = project('Cooking')
  assert.equal(projectOfConversation('c-1', [physics, cooking])?.name, 'Physics')
  assert.equal(projectOfConversation('c-9', [physics, cooking]), null)
})

test('taking a chat out of a project really takes it out', () => {
  const physics = withProjectItem(project('Physics'), conversationRef('c-1'))
  assert.equal(projectOfConversation('c-1', [withoutProjectItem(physics, conversationRef('c-1'))]), null)
})

test('a project with nothing to say says nothing', () => {
  assert.equal(projectBriefing({ goal: '', instructions: '', items: [] }, 'Empty'), null)
})

test('what a project is for is given as information, and marked as information', () => {
  const said = projectBriefing({ goal: 'compare three laptops', instructions: '', items: [] }, 'Laptops', ['A review', 'A price list'])
  assert.ok(said?.includes('compare three laptops'))
  assert.ok(said?.includes('rather than instructions'), said ?? '')
})

test('how to work in it is given as instructions, because the person typed them', () => {
  const said = projectBriefing({ goal: '', instructions: 'Use SI units.', items: [] }, 'Physics')
  assert.ok(said?.includes('Use SI units.'))
  assert.ok(said?.includes('asked for by the person themselves'), said ?? '')
})

test('item titles are capped, so a large project cannot become most of what Orion is told', () => {
  const titles = Array.from({ length: 90 }, (_, i) => `thing ${i}`)
  const said = projectBriefing({ goal: 'x', instructions: '', items: [] }, 'Big', titles)!
  assert.ok(said.includes('thing 39'))
  assert.ok(!said.includes('thing 40'), 'the list stops at forty')
})

test('instructions read back from disk are kept, trimmed and capped', () => {
  const read = normalizeWorkspace({ id: 'a', name: 'A', project: { goal: ' a   goal ', instructions: `  Use SI units.  ${'x'.repeat(3000)}`, items: [] } })
  assert.equal(read.project?.goal, 'a goal')
  assert.equal(read.project?.instructions.length, 2000)
  assert.ok(read.project?.instructions.startsWith('Use SI units.'))
})

test('a project saved before instructions existed reads as having none, not as broken', () => {
  const read = normalizeWorkspace({ id: 'a', name: 'A', project: { goal: 'old', items: [{ ref: 'note:1', addedAt: 1 }] } })
  assert.equal(read.project?.instructions, '')
  assert.equal(read.project?.items.length, 1)
})
