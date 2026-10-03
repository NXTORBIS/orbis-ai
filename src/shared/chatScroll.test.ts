import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  distanceFromBottom,
  FOLLOW_THRESHOLD,
  JUMP_THRESHOLD,
  keepAnchored,
  newChatScrollState,
  onJumpPressed,
  onLayoutChanged,
  onRendered,
  onScrolled,
  roomUnderTurn,
  scrollIsTheirs,
  settled,
  TURN_MARGIN,
  type ChatScrollState,
  type Viewport
} from './chatScroll.ts'

const HEIGHT = 3000
const CLIENT = 600
const END = HEIGHT - CLIENT

/** A scroller 600 tall showing a 3000-tall conversation, positioned however the test needs. */
const view = (scrollTop: number, scrollHeight = HEIGHT, clientHeight = CLIENT): Viewport => ({
  scrollTop,
  scrollHeight,
  clientHeight
})
const atEnd = (): Viewport => view(END)

/** Opening a conversation, and recording where the scroll Orbis performed actually left things. */
const opened = (conversationId = 'c1', lastUserId: string | null = 'u1'): ChatScrollState => {
  const { state } = onRendered(newChatScrollState(), { conversationId, lastUserId })
  return settled(state, END)
}

// ---------------------------------------------------------------- opening a conversation

test('opening a conversation lands at the end, and following', () => {
  const { state, action } = onRendered(newChatScrollState(), { conversationId: 'c1', lastUserId: 'u1' })
  assert.deepEqual(action, { kind: 'toBottom', smooth: false })
  assert.equal(state.mode, 'following')
  assert.equal(state.conversationId, 'c1')
  assert.equal(state.shownTurnId, 'u1', 'the question already there is not a new one')
})

test('opening a conversation does not then treat its newest question as new', () => {
  const s = opened()
  assert.notEqual(
    onRendered(s, { conversationId: 'c1', lastUserId: 'u1' }).action.kind,
    'toTurn',
    'it would jump to the top of an answer nobody just asked for'
  )
})

test('a different conversation is a different place', () => {
  let s = opened()
  s = onScrolled(s, view(400), false).state
  assert.deepEqual(onRendered(s, { conversationId: 'c2', lastUserId: 'u9' }).action, {
    kind: 'toBottom',
    smooth: false
  })
})

// ---------------------------------------------------------------- a new question

test('a new question is put at the top, and its answer is followed from there', () => {
  const { state, action } = onRendered(opened(), { conversationId: 'c1', lastUserId: 'u2' })
  assert.deepEqual(action, { kind: 'toTurn', messageId: 'u2' })
  // Following, not reading. While the answer is shorter than the view the foot of the page is "the question at the
  // top", so following moves nothing; when the answer outgrows the view, following is what keeps its newest line in
  // sight. Somebody who really is reading scrolls up, and that is what turns this back to 'reading'.
  assert.equal(state.mode, 'following')
})

test('the same question is moved to once, and after that the answer is kept in sight', () => {
  const asked = onRendered({ ...newChatScrollState(), conversationId: 'c1', shownTurnId: 'u1' }, { conversationId: 'c1', lastUserId: 'u2' })
  assert.deepEqual(asked.action, { kind: 'toTurn', messageId: 'u2' })
  // Every redraw after it keeps the foot of the answer in view -- which, while the room under the question lasts, is
  // the very place the question was put.
  let state = asked.state
  for (let i = 0; i < 4; i++) {
    const again = onRendered(state, { conversationId: 'c1', lastUserId: 'u2' })
    assert.deepEqual(again.action, { kind: 'toBottom', smooth: false }, `redraw ${i} did not keep up with the answer`)
    state = again.state
  }
  // And once they scroll up to read, nothing follows them any more.
  const reading = onScrolled(state, { scrollTop: 100, scrollHeight: 4000, clientHeight: 600 }, false, true, false).state
  assert.equal(reading.mode, 'reading')
  assert.deepEqual(onRendered(reading, { conversationId: 'c1', lastUserId: 'u2' }).action, { kind: 'none' })
})

test('a question asked while reading old messages still brings the reader to it', () => {
  let s = opened()
  s = onScrolled(s, view(100), false).state
  assert.equal(s.mode, 'reading')
  assert.deepEqual(
    onRendered(s, { conversationId: 'c1', lastUserId: 'u2' }).action,
    { kind: 'toTurn', messageId: 'u2' },
    'they asked it; they should see it'
  )
})

// ---------------------------------------------------------------- whose scroll was it

test("the echo of Orbis own scroll is not mistaken for the person's", () => {
  // The loop this guards against: Orbis moves to a new turn, the browser reports a scroll, and the handler reads it as
  // the person having scrolled -- undoing the decision a frame after making it.
  const moved = onRendered(opened(), { conversationId: 'c1', lastUserId: 'u2' })
  assert.equal(moved.state.mode, 'following')

  // Orbis's scroll left the scroller at 1180. Landing that close to the end would, under a naive handler, turn
  // following back on and drag the reader off the top of the answer they were just shown.
  const s = settled(moved.state, END)
  const echo = onScrolled(s, view(END), false)
  assert.equal(echo.state.mode, 'following', 'the decision stands')
})

test("a scroll to where the scroller already was does not swallow the person's next one", () => {
  // Following, already at the end: Orbis asks for the end again and the browser fires nothing, because nothing moved.
  // A one-shot "that one was mine" flag would still be armed here, and would eat the real scroll below.
  let s = opened()
  assert.equal(s.mode, 'following')
  s = settled(onRendered(s, { conversationId: 'c1', lastUserId: 'u1' }).state, END)

  // The person scrolls up. This is the first event to arrive, and it is theirs.
  s = onScrolled(s, view(300), false).state
  assert.equal(s.mode, 'reading', 'their scroll was heard')
})

test('the person scrolling to the end asks to follow', () => {
  let s = opened()
  s = onScrolled(s, view(300), false).state
  assert.equal(s.mode, 'reading')
  s = onScrolled(s, atEnd(), true).state
  assert.equal(s.mode, 'following')
})

test('the person scrolling away asks to be left alone, for as long as the answer goes on', () => {
  let s = onScrolled(opened(), view(200), false).state
  assert.equal(s.mode, 'reading')
  for (let i = 0; i < 50; i++) {
    const { action, state } = onRendered(s, { conversationId: 'c1', lastUserId: 'u1' })
    assert.deepEqual(action, { kind: 'none' })
    s = state
  }
})

test('following keeps up', () => {
  const s = opened()
  assert.equal(s.mode, 'following')
  assert.deepEqual(onRendered(s, { conversationId: 'c1', lastUserId: 'u1' }).action, {
    kind: 'toBottom',
    smooth: false
  })
})

test('the thresholds are where they say they are', () => {
  const s = onScrolled(opened(), view(10), false).state
  assert.equal(onScrolled(s, atEnd(), false).state.mode, 'following')
  assert.equal(onScrolled(s, view(END - FOLLOW_THRESHOLD), false).state.mode, 'following')
  assert.equal(onScrolled(s, view(END - FOLLOW_THRESHOLD - 1), false).state.mode, 'reading')
})

// ---------------------------------------------------------------- the way back

test('a way back is offered only from far enough away, and does not flicker', () => {
  const s = onScrolled(opened(), view(10), false).state
  assert.equal(onScrolled(s, atEnd(), false).showJump, false)
  assert.equal(onScrolled(s, view(END - JUMP_THRESHOLD - 1), false).showJump, true)

  // Between the two thresholds nothing changes, which is what stops a button blinking as somebody nudges the wheel.
  assert.equal(onScrolled(s, view(END - FOLLOW_THRESHOLD - 10), true).showJump, true, 'still shown')
  assert.equal(onScrolled(s, view(END - FOLLOW_THRESHOLD - 10), false).showJump, false, 'still hidden')
})

test('asking for the newest output resumes following, and travels so it can be seen', () => {
  const { state, action } = onJumpPressed(onScrolled(opened(), view(100), false).state)
  assert.equal(state.mode, 'following')
  assert.deepEqual(action, { kind: 'toBottom', smooth: true })
})

test('somebody who asked for less movement is moved without animation', () => {
  assert.deepEqual(onJumpPressed(opened(), true).action, { kind: 'toBottom', smooth: false })
})

// ---------------------------------------------------------------- the page changing shape

test('a resize keeps the end in view for a follower and leaves a reader alone', () => {
  assert.deepEqual(onLayoutChanged({ ...newChatScrollState(), mode: 'following' }), {
    kind: 'toBottom',
    smooth: false
  })
  assert.deepEqual(onLayoutChanged({ ...newChatScrollState(), mode: 'reading' }), { kind: 'none' })
})

test('when the message they are reading moves down, the scroller moves with it', () => {
  // A code block two messages up gets highlighted and grows 140px. The message being read is now 140px further down
  // the document, so the scroller goes 140px further down too and nothing on screen appears to move.
  assert.equal(keepAnchored({ scrollTop: 900, anchorTop: 850 }, { anchorTop: 990 }, 4000), 1040)
})

test('content appearing below them does not move them, because their message has not moved', () => {
  // The answer underneath gets longer. The document is taller, but the message being read sits exactly where it sat --
  // and this is the case that comparing document heights gets wrong, by shifting a reader for whom nothing changed.
  assert.equal(keepAnchored({ scrollTop: 900, anchorTop: 850 }, { anchorTop: 850 }, 4400), null)
})

test('a message that moves up pulls the scroller up with it', () => {
  // Something above collapsed. The message being read is closer to the top now, so the scroller follows it.
  assert.equal(keepAnchored({ scrollTop: 900, anchorTop: 850 }, { anchorTop: 700 }, 4000), 750)
})

test('the correction cannot leave the scroller past the end, or before the start', () => {
  assert.equal(keepAnchored({ scrollTop: 2380, anchorTop: 2300 }, { anchorTop: 2900 }, 2400), 2400)
  assert.equal(keepAnchored({ scrollTop: 40, anchorTop: 300 }, { anchorTop: 50 }, 4000), 0)
})

test('a correction that would change nothing is not made', () => {
  // Writing scrollTop needlessly is not free: it produces a scroll event, which then has to be told from a real one.
  assert.equal(keepAnchored({ scrollTop: 900, anchorTop: 850 }, { anchorTop: 850 }, 4000), null)
  assert.equal(keepAnchored({ scrollTop: 0, anchorTop: 0 }, { anchorTop: 0 }, 4000), null)
})

test('the distance to the end is never negative, however the browser rounds', () => {
  assert.equal(distanceFromBottom({ scrollTop: 2401, scrollHeight: 3000, clientHeight: 600 }), 0)
})

test('a question with nothing under it gets enough room to reach the top', () => {
  // A 600-high view; the question and the reply that has just begun take 150 between them.
  assert.equal(roomUnderTurn(600, 150), 600 - 150 - TURN_MARGIN)
})

test('the room under a turn shrinks as the answer grows, and is gone once the answer is a screen long', () => {
  assert.equal(roomUnderTurn(600, 400), 184)
  assert.equal(roomUnderTurn(600, 584), 0)
  assert.equal(roomUnderTurn(600, 5000), 0)
})

test('the room under a turn is never negative and never a fraction, whatever it is handed', () => {
  assert.equal(roomUnderTurn(0, 0), 0)
  assert.equal(roomUnderTurn(600.4, 100.2), 485, 'rounded up, so the scroller can always reach where it is put')
  assert.equal(roomUnderTurn(Number.NaN, 10), 0)
  assert.equal(roomUnderTurn(600, Number.POSITIVE_INFINITY), 0)
})

test('a scroll nobody made changes nothing about who is reading and who is following', () => {
  // The person is reading the top of a new answer, and the scroller is exactly at the end of the page (the room
  // under the turn puts it there). A card above folds away and the browser moves the scroller to where it still fits.
  const reading: ChatScrollState = { ...newChatScrollState(), mode: 'reading', settledAt: 1891.2, conversationId: 'c', shownTurnId: 'u2' }
  const moved: Viewport = { scrollTop: 1360, scrollHeight: 1956, clientHeight: 596 }
  const byPosition = onScrolled(reading, moved, false)
  assert.equal(byPosition.state.mode, 'following', 'read by position alone, this looked like the person going to the foot')
  const known = onScrolled(reading, moved, false, false)
  assert.equal(known.state.mode, 'reading')
  assert.equal(known.state.settledAt, 1360, 'and where it now is is where Orbis left it')
  // Half a pixel of rounding is the same thing, smaller.
  assert.equal(onScrolled(reading, { scrollTop: 1890.4, scrollHeight: 2487, clientHeight: 596 }, false, false).state.mode, 'reading')
  // A real scroll to the foot still means "follow", and a real scroll away still means "reading".
  assert.equal(onScrolled(reading, moved, false, true).state.mode, 'following')
  assert.equal(onScrolled({ ...reading, mode: 'following' }, { scrollTop: 200, scrollHeight: 3000, clientHeight: 600 }, false, true).state.mode, 'reading')
  // The way back is still offered or withdrawn from where the scroller really is.
  assert.equal(onScrolled(reading, { scrollTop: 0, scrollHeight: 3000, clientHeight: 600 }, false, false).showJump, true)
})

test('a scroll is the person\'s when they are holding the scroller, just did something that scrolls, or it carries on a glide', () => {
  const quiet = { pressed: false, actedAt: 0, lastTheirsAt: 0 }
  assert.equal(scrollIsTheirs(10_000, quiet), false)
  assert.equal(scrollIsTheirs(10_000, { ...quiet, pressed: true }), true)
  assert.equal(scrollIsTheirs(10_000, { ...quiet, actedAt: 9_500 }), true)
  assert.equal(scrollIsTheirs(10_000, { ...quiet, actedAt: 9_000 }), false, 'a wheel turn a second ago is over')
  assert.equal(scrollIsTheirs(10_000, { ...quiet, actedAt: 8_000, lastTheirsAt: 9_900 }), true, 'a glide after the finger lifted is still theirs')
  assert.equal(scrollIsTheirs(10_000, { ...quiet, lastTheirsAt: 9_700 }), false)
})

test('a conversation that has just begun opens at its first question, with the answer followed under it', () => {
  const begun = onRendered(newChatScrollState(), { conversationId: 'c1', lastUserId: 'u1', started: true })
  assert.deepEqual(begun.action, { kind: 'toTurn', messageId: 'u1' })
  assert.equal(begun.state.mode, 'following')
  // The answer growing does not move the view after that.
  assert.deepEqual(onRendered(begun.state, { conversationId: 'c1', lastUserId: 'u1', started: true }).action, { kind: 'toBottom', smooth: false })
  // An older conversation being opened still lands at its end, however short it is.
  const opened = onRendered(newChatScrollState(), { conversationId: 'c2', lastUserId: 'u9' })
  assert.deepEqual(opened.action, { kind: 'toBottom', smooth: false })
  assert.equal(opened.state.mode, 'following')
})

test('while there is still room under the newest turn, a small scroll is not "arriving at the foot"', () => {
  const reading: ChatScrollState = { ...newChatScrollState(), mode: 'reading', settledAt: 900, conversationId: 'c', shownTurnId: 'u2' }
  const nudged: Viewport = { scrollTop: 880, scrollHeight: 1500, clientHeight: 600 }
  assert.equal(onScrolled(reading, nudged, false, true, true).state.mode, 'reading')
  assert.equal(onScrolled(reading, nudged, false, true, false).state.mode, 'following', 'with no room left, the end of the page is the foot of the answer')
})
