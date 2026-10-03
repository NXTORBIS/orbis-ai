import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ChatMessage } from './types.ts'
import { branchList, dropBranch, labelFor, MAX_BRANCHES, parkTail, readBranches, switchToBranch, type Branched } from './conversationBranch.ts'

const NOW = new Date('2026-10-03T12:00:00').getTime()

const say = (role: ChatMessage['role'], content: string, n: number): ChatMessage => ({ id: `m${n}`, role, content, createdAt: NOW + n })

const chat = (...texts: string[]): Branched => ({
  id: 'c1',
  title: 'A chat',
  model: 'm',
  messages: texts.map((text, i) => say(i % 2 === 0 ? 'user' : 'assistant', text, i)),
  createdAt: NOW,
  updatedAt: NOW
})

test('changing an earlier message keeps what came after it instead of destroying it', () => {
  const before = chat('What is X?', 'X is a thing.', 'And Y?', 'Y is another.')
  const after = parkTail(before, 2, NOW, 'b1')

  assert.deepEqual(after.messages.map((m) => m.content), ['What is X?', 'X is a thing.'])
  assert.equal(after.branches?.length, 1)
  assert.deepEqual(after.branches?.[0].messages.map((m) => m.content), ['And Y?', 'Y is another.'])
})

test('a branch is named from its own first words, not by a model', () => {
  const after = parkTail(chat('a', 'b', 'Tell me about octopuses please and thank you very much indeed', 'ok'), 2, NOW, 'b1')
  assert.equal(after.branches?.[0].label, 'Tell me about octopuses please and thank')
})

test('going back to an earlier answer parks the one you are leaving, so nothing is lost either way', () => {
  const parked = parkTail(chat('Q', 'first answer', 'follow up', 'more'), 1, NOW, 'b1')
  const grown: Branched = { ...parked, messages: [...parked.messages, say('assistant', 'second answer', 9)] }

  const back = switchToBranch(grown, 'b1', NOW + 1, 'b2')
  assert.deepEqual(back.messages.map((m) => m.content), ['Q', 'first answer', 'follow up', 'more'])
  assert.equal(back.branches?.length, 1, 'the answer being left is now the parked one')
  assert.deepEqual(back.branches?.[0].messages.map((m) => m.content), ['second answer'])

  // And back again: this is a swap, so it can be done for ever without losing anything.
  const forward = switchToBranch(back, back.branches![0].id, NOW + 2, 'b3')
  assert.deepEqual(forward.messages.map((m) => m.content), ['Q', 'second answer'])
})

test('a branch only holds the part that differs, never the part both paths share', () => {
  const after = parkTail(chat('shared one', 'shared two', 'differs'), 2, NOW, 'b1')
  const texts = after.branches![0].messages.map((m) => m.content)
  assert.ok(!texts.includes('shared one'), texts.join('|'))
  assert.ok(!texts.includes('shared two'), texts.join('|'))
})

test('parking nothing parks nothing, rather than making a branch nobody can return to', () => {
  const before = chat('only this')
  assert.equal(parkTail(before, 1, NOW, 'b1').branches, undefined)
})

test('asking for a branch that is not there leaves the conversation exactly as it was', () => {
  const before = parkTail(chat('a', 'b', 'c'), 2, NOW, 'b1')
  assert.deepEqual(switchToBranch(before, 'nope', NOW, 'b2'), before)
})

test('old branches go once there are too many, newest kept', () => {
  let one = chat('a', 'b', 'c')
  for (let i = 0; i < MAX_BRANCHES + 4; i++) {
    one = { ...one, messages: [...one.messages.slice(0, 2), say('user', `try ${i}`, i)] }
    one = parkTail(one, 2, NOW + i, `b${i}`)
  }
  assert.equal(one.branches?.length, MAX_BRANCHES)
  assert.equal(branchList(one)[0].id, `b${MAX_BRANCHES + 3}`, 'the newest is first and still there')
})

test('one can be thrown away on purpose, and that is the only thing here that loses anything', () => {
  const one = parkTail(chat('a', 'b', 'c'), 2, NOW, 'b1')
  assert.deepEqual(dropBranch(one, 'b1').branches, [])
})

test('a conversation saved before any of this existed still reads', () => {
  const old = chat('a', 'b')
  assert.deepEqual(branchList(old), [])
  assert.deepEqual(readBranches(undefined), [])
})

test('a damaged branch is dropped rather than repaired into something misleading', () => {
  const read = readBranches([
    { id: 'good', fromIndex: 1, messages: [{ id: 'x', role: 'user', content: 'hi', createdAt: 1 }], at: 5 },
    { id: 'empty', fromIndex: 1, messages: [], at: 6 },
    { id: '', messages: [{ role: 'user', content: 'hi' }], at: 7 },
    'nonsense'
  ])
  assert.deepEqual(read.map((one) => one.id), ['good'])
})

test('a branch with no label is given one from its own messages rather than left blank', () => {
  const read = readBranches([{ id: 'a', fromIndex: 0, messages: [{ id: 'x', role: 'user', content: 'tell me about rain', createdAt: 1 }], at: 1 }])
  assert.equal(read[0].label, 'tell me about rain')
})

test('an empty conversation still gets a label rather than crashing', () => {
  assert.equal(labelFor([]), 'Empty')
})
