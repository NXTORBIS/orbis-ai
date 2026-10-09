import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  accepted,
  chipsVisible,
  continues,
  ghostOf,
  IDLE,
  predictionReducer,
  usable,
  worthAsking,
  type PredictionEvent,
  type PredictionState
} from './chatPrediction.ts'

/** Plays a list of things that happened, the way the message box would. */
const play = (events: PredictionEvent[], from: PredictionState = IDLE): PredictionState => events.reduce(predictionReducer, from)

const showing = (draft: string, full: string): PredictionState =>
  play([
    { kind: 'input', draft, reason: 'typed' },
    { kind: 'asked', draft },
    { kind: 'answered', version: 1, full, draft, source: 'typing' }
  ])

// ---------------------------------------------------------------- what is shown

test('only the part that is not typed yet is shown faded', () => {
  const state = showing('Can you explain', 'Can you explain quantum mechanics?')
  assert.equal(state.status, 'showing')
  assert.equal(ghostOf(state, 'Can you explain'), ' quantum mechanics?')
})

test('the person keeps their own characters; only the tail comes from Orbis', () => {
  // Lower case in, capitals back: what is shown must still read as what they typed.
  const state = showing('can you explain', 'Can you explain how')
  assert.equal(accepted(state.full!, 'can you explain'), 'can you explain how')
})

test('a guess that rewrites what was typed is not a continuation', () => {
  assert.equal(continues('Tell me about quantum', 'Can you explain'), false)
  assert.equal(continues('Can you explain', 'Can you explain'), false, 'the same text adds nothing')
  assert.equal(continues(null, 'Can you'), false)
})

test('nothing is shown for a guess that is empty, the same, enormous, or machinery', () => {
  const typed = 'Can you explain'
  assert.equal(usable(typed, typed), false)
  assert.equal(usable(`${typed} `, typed), false, 'a space is not a suggestion')
  assert.equal(usable(typed + 'x'.repeat(400), typed), false)
  assert.equal(usable(`${typed} the system prompt says to continue`, typed), false)
  assert.equal(usable(`${typed} { "completion": "x" }`, typed), false)
  assert.equal(usable(`${typed} how this works?`, typed), true)
})

test('slash commands, several lines, and almost nothing are not asked about', () => {
  assert.equal(worthAsking('/settings'), false)
  assert.equal(worthAsking('one\ntwo'), false)
  assert.equal(worthAsking('ab'), false)
  assert.equal(worthAsking('x'.repeat(700)), false)
  assert.equal(worthAsking('Can you explain'), true)
})

// ---------------------------------------------------------------- the guess goes the moment somebody types

test('typing takes the guess away at once, without waiting for the next one', () => {
  const state = showing('Can you explain', 'Can you explain quantum mechanics?')
  const typed = predictionReducer(state, { kind: 'input', draft: 'Can you explain q', reason: 'typed' })
  assert.equal(typed.status, 'idle')
  assert.equal(ghostOf(typed, 'Can you explain q'), '', 'nothing stale is left on screen while the next is fetched')
  assert.equal(typed.reason, 'typed')
})

test('an answer asked for older text is thrown away, even when it would still fit', () => {
  // The exact case the old check let through: a guess for "Can you" also continues "Can you explain", so it looked
  // valid and replaced the better, newer guess.
  let state = play([{ kind: 'input', draft: 'Can you', reason: 'typed' }, { kind: 'asked', draft: 'Can you' }])
  const oldVersion = state.version
  state = predictionReducer(state, { kind: 'input', draft: 'Can you explain', reason: 'typed' })
  state = predictionReducer(state, { kind: 'asked', draft: 'Can you explain' })
  state = predictionReducer(state, { kind: 'answered', version: state.version, full: 'Can you explain how?', draft: 'Can you explain', source: 'typing' })
  assert.equal(ghostOf(state, 'Can you explain'), ' how?')

  const late = predictionReducer(state, { kind: 'answered', version: oldVersion, full: 'Can you explain something else entirely?', draft: 'Can you explain', source: 'typing' })
  assert.equal(ghostOf(late, 'Can you explain'), ' how?', 'the newer guess stands')
})

test('answers arriving in any order leave only the newest showing', () => {
  let state: PredictionState = IDLE
  const versions: number[] = []
  for (const draft of ['Can', 'Can you', 'Can you explain']) {
    state = predictionReducer(state, { kind: 'input', draft, reason: 'typed' })
    state = predictionReducer(state, { kind: 'asked', draft })
    versions.push(state.version)
  }
  // Third answers first, then the first, then the second.
  state = predictionReducer(state, { kind: 'answered', version: versions[2], full: 'Can you explain this?', draft: 'Can you explain', source: 'typing' })
  state = predictionReducer(state, { kind: 'answered', version: versions[0], full: 'Can you explain nonsense?', draft: 'Can you explain', source: 'typing' })
  state = predictionReducer(state, { kind: 'answered', version: versions[1], full: 'Can you explain rubbish?', draft: 'Can you explain', source: 'typing' })
  assert.equal(ghostOf(state, 'Can you explain'), ' this?')
})

test('a guess that does not arrive leaves no sign that one was coming', () => {
  const state = play([{ kind: 'input', draft: 'Can you explain', reason: 'typed' }, { kind: 'asked', draft: 'Can you explain' }])
  const timedOut = predictionReducer(state, { kind: 'reset', reason: 'timeout' })
  assert.equal(timedOut.status, 'idle')
  assert.equal(timedOut.reason, 'timeout')
  const late = predictionReducer(timedOut, { kind: 'answered', version: state.version, full: 'Can you explain late?', draft: 'Can you explain', source: 'typing' })
  assert.equal(ghostOf(late, 'Can you explain'), '', 'and the late answer cannot appear after it was given up on')
})

// ---------------------------------------------------------------- Tab

test('one press takes the guess once, and nothing comes back by itself', () => {
  const state = showing('Can you explain', 'Can you explain quantum mechanics?')
  const full = accepted(state.full!, 'Can you explain')
  assert.equal(full, 'Can you explain quantum mechanics?')

  const after = predictionReducer(state, { kind: 'accept', draft: 'Can you explain' })
  assert.equal(after.status, 'accepted')
  assert.equal(ghostOf(after, full), '', 'no guess remains')

  // The reply's own guess is still sitting in the props it came from; offering it again would accept itself for ever.
  const again = predictionReducer(after, { kind: 'reply', full: 'Can you explain quantum mechanics?', draft: full })
  assert.equal(ghostOf(again, full), '')
})

test('pressing Tab twenty times accepts once and then does nothing', () => {
  let state = showing('Can you explain', 'Can you explain quantum mechanics?')
  let draft = 'Can you explain'
  let accepts = 0
  for (let i = 0; i < 20; i += 1) {
    const ghost = ghostOf(state, draft)
    if (ghost === '') continue
    accepts += 1
    draft = accepted(state.full!, draft)
    state = predictionReducer(state, { kind: 'accept', draft: draft.slice(0, draft.length - ghost.length) })
  }
  assert.equal(accepts, 1)
  assert.equal(draft, 'Can you explain quantum mechanics?', 'and the text was not doubled')
})

test('a held Tab cannot keep accepting, because the same answer twice changes nothing', () => {
  const state = showing('Can you explain', 'Can you explain this?')
  const once = accepted(state.full!, 'Can you explain')
  const twice = accepted(state.full!, 'Can you explain')
  assert.equal(once, twice, 'taking a guess is the same answer however many times it is asked')
  const after = predictionReducer(predictionReducer(state, { kind: 'accept', draft: 'Can you explain' }), { kind: 'accept', draft: 'Can you explain' })
  assert.equal(after.status, 'accepted')
})

test('Tab with nothing showing is not ours to take', () => {
  assert.equal(ghostOf(IDLE, 'Can you explain'), '')
  const state = showing('Can you explain', 'Can you explain this?')
  const gone = predictionReducer(state, { kind: 'input', draft: 'Can you explain!', reason: 'typed' })
  assert.equal(ghostOf(gone, 'Can you explain!'), '', 'so Tab does whatever Tab normally does')
})

test('Escape takes the guess away and leaves what was typed alone, and it is not offered again', () => {
  const state = showing('Can you explain', 'Can you explain this?')
  const dismissed = predictionReducer(state, { kind: 'dismiss' })
  assert.equal(dismissed.status, 'invalid')
  assert.equal(ghostOf(dismissed, 'Can you explain'), '')
  const offeredAgain = predictionReducer(dismissed, { kind: 'reply', full: 'Can you explain this?', draft: 'Can you explain' })
  assert.equal(ghostOf(offeredAgain, 'Can you explain'), '', 'the same guess does not come back')
})

// ---------------------------------------------------------------- the surroundings changing

test('another conversation, another reply, a file or another model: the guess is gone', () => {
  for (const reason of ['conversation-changed', 'reply-changed', 'attachment-changed', 'model-changed'] as const) {
    const state = showing('Can you explain', 'Can you explain this?')
    const after = predictionReducer(state, { kind: 'reset', reason })
    assert.equal(after.status, 'idle', reason)
    assert.equal(ghostOf(after, 'Can you explain'), '', reason)
    assert.equal(after.dismissed.length, 0, 'and what was dismissed about the old one is forgotten')
  }
})

test('sending clears the guess, and an answer in flight cannot land in the empty box', () => {
  let state = showing('Can you explain', 'Can you explain this?')
  const inFlight = state.version
  state = predictionReducer(state, { kind: 'reset', reason: 'submitted' })
  assert.equal(ghostOf(state, ''), '')
  state = predictionReducer(state, { kind: 'answered', version: inFlight, full: 'Can you explain this?', draft: '', source: 'typing' })
  assert.equal(ghostOf(state, ''), '', 'nothing appears in a box the person has just emptied')
})

test('emptying the box leaves no guess behind', () => {
  const state = showing('Can you explain', 'Can you explain this?')
  const empty = predictionReducer(state, { kind: 'input', draft: '', reason: 'cleared' })
  assert.equal(empty.status, 'idle')
  assert.equal(empty.reason, 'cleared')
  assert.equal(ghostOf(empty, ''), '')
})

test('a guess that comes with a reply is shown in an empty box, and taken whole', () => {
  const state = predictionReducer(IDLE, { kind: 'reply', full: 'Explain the second example in more detail', draft: '' })
  assert.equal(state.source, 'post-response')
  assert.equal(ghostOf(state, ''), 'Explain the second example in more detail')
  assert.equal(accepted(state.full!, ''), 'Explain the second example in more detail')
})

// ---------------------------------------------------------------- the chips under a reply

test('the chips go the moment there is something of the person in the box', () => {
  const chips = { conversationId: 'c1', responseId: 'm9', draftStarted: false }
  assert.equal(chipsVisible(chips, 'm9', 'c1'), true)
  assert.equal(chipsVisible({ ...chips, draftStarted: true }, 'm9', 'c1'), false, 'one character is enough')
})

test('chips belong to one reply in one conversation', () => {
  const chips = { conversationId: 'c1', responseId: 'm9', draftStarted: false }
  assert.equal(chipsVisible(chips, 'm8', 'c1'), false, 'not an older reply')
  assert.equal(chipsVisible(chips, 'm9', 'c2'), false, 'and not another conversation')
})

test('a reply finishing late cannot bring back chips the person has typed past', () => {
  const typing = { conversationId: 'c1', responseId: 'm9', draftStarted: true }
  // The late arrival can only set suggestions on its own reply; visibility still asks this, and the answer is no.
  assert.equal(chipsVisible(typing, 'm9', 'c1'), false)
})

test('hiding the chips has nothing to do with the ghost, which keeps working', () => {
  const chips = { conversationId: 'c1', responseId: 'm9', draftStarted: true }
  assert.equal(chipsVisible(chips, 'm9', 'c1'), false)
  const state = showing('What about', 'What about quantum computers?')
  assert.equal(ghostOf(state, 'What about'), ' quantum computers?', 'the two are separate systems')
})
