/**
 * When Orbis Chat may move the page, and when it must not.
 *
 * All of the deciding is here, with no DOM in sight, because the decisions are the part that was wrong and the part
 * worth testing. `ChatView` measures the scroller, asks this what to do, and does it. Nothing in this file can scroll
 * anything, so nothing in this file can scroll something by accident.
 *
 * There are exactly three things that entitle Orbis to move the view:
 *
 *  - Opening a conversation. A different conversation is a different place.
 *  - A question that was not there a moment ago. The person just asked it and wants to see it answered.
 *  - The person asking, by putting themselves at the foot of the answer or pressing the jump button.
 *
 * An answer getting longer is not one of them. That is the whole point: a reply arriving in pieces must not drag the
 * reader down the page, and a long reply must begin at its beginning rather than its last paragraph.
 */

/** Whether Orbis is keeping up with the newest output, or the person is reading. */
export type ScrollMode = 'following' | 'reading'

export interface ChatScrollState {
  mode: ScrollMode
  /**
   * Where Orbis last put the scroller, or null when it has not.
   *
   * This is how an event Orbis caused is told from one the person caused, and it is a position rather than a flag for
   * a reason. A flag has to be consumed by the next event -- but a scroll to a place the scroller is already at fires
   * no event at all, so the flag would still be set when the person's own first scroll arrived, and that scroll would
   * be thrown away. Comparing positions has no such hole: an event whose position is the one Orbis asked for is
   * Orbis's, and an event at any other position is theirs, whether or not anything was fired in between.
   */
  settledAt: number | null
  /** The conversation the view is in, so opening another one is recognisable. */
  conversationId: string | null
  /** The newest question the view has already been moved to, so the same one is never moved to twice. */
  shownTurnId: string | null
}

/** What the scroller looks like right now. Three numbers, which is all any of this needs. */
export interface Viewport {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** What Orbis should do to the scroller. */
export type ScrollAction =
  | { kind: 'none' }
  | { kind: 'toBottom'; smooth: boolean }
  /** Put the top of this message at the top of the view: the question, with its answer beginning under it. */
  | { kind: 'toTurn'; messageId: string }

/**
 * Close enough to the end to count as watching it.
 *
 * Not the last pixel. A person who has scrolled down to read the newest sentence is watching the answer, and asking
 * them to land exactly on the bottom before Orbis keeps up would make following it feel broken.
 */
export const FOLLOW_THRESHOLD = 80

/**
 * Far enough from the end that a way back is worth offering.
 *
 * Deliberately much larger than the follow threshold. Between the two, Orbis neither follows nor offers to jump --
 * which is the quiet band that stops a button flickering in and out while somebody nudges the wheel.
 */
export const JUMP_THRESHOLD = 240

export const newChatScrollState = (): ChatScrollState => ({
  mode: 'following',
  settledAt: null,
  conversationId: null,
  shownTurnId: null
})

/**
 * Records where Orbis's own scroll actually left the scroller.
 *
 * Called by whoever performed the action, with the position that resulted. Until this is called the state has no
 * settled position, so every event is read as the person's -- which is the safe way round to be wrong.
 */
export const settled = (state: ChatScrollState, scrollTop: number): ChatScrollState => ({
  ...state,
  settledAt: scrollTop
})

export const distanceFromBottom = (v: Viewport): number =>
  Math.max(0, v.scrollHeight - v.scrollTop - v.clientHeight)

/**
 * Whether to offer a way back to the newest output, from where the scroller is now.
 *
 * Two thresholds rather than one, and the answer between them is whatever it already was. That band is what stops the
 * button appearing and vanishing while somebody nudges a wheel near the edge of it.
 *
 * Asked after a deliberate move as well as after a scroll event, because a move can land without producing an event
 * that means anything -- a scroll to where the scroller already is fires nothing, and a scroll Orbis caused is
 * deliberately ignored as its own echo. Left to events alone, the button would stay up after the very press that made
 * it unnecessary.
 */
export function jumpVisible(v: Viewport, showJumpNow: boolean): boolean {
  const distance = distanceFromBottom(v)
  if (distance > JUMP_THRESHOLD) return true
  if (distance <= FOLLOW_THRESHOLD) return false
  return showJumpNow
}

export interface Turn {
  conversationId: string | null
  /** The newest message from the person, which is what makes a turn new. */
  lastUserId: string | null
  /**
   * The conversation has only just begun: this is its first question, and the answer to it is being written now.
   *
   * It is a new place, like any conversation that has just been opened -- but there is nothing in it to land at the
   * end of. Treated as an opened conversation it was followed to the foot, so a first answer longer than the window
   * was shown from its last line. It is a question that was just asked, and it is treated as one.
   */
  started?: boolean
}

export interface Decision {
  state: ChatScrollState
  action: ScrollAction
}

/**
 * What to do now that the messages have been drawn.
 *
 * Called after every render, including the hundreds that a streaming answer causes -- so the common answer is
 * `none`, and the interesting part is which two cases are not.
 */
export function onRendered(state: ChatScrollState, turn: Turn, reducedMotion = false): Decision {
  // A conversation that began a moment ago with this question: the question, and the answer beginning under it.
  if (turn.conversationId !== state.conversationId && turn.started && turn.lastUserId) {
    return {
      state: { mode: 'reading', settledAt: null, conversationId: turn.conversationId, shownTurnId: turn.lastUserId },
      action: { kind: 'toTurn', messageId: turn.lastUserId }
    }
  }

  // A different conversation. It lands where opening a chat has always landed: at the end, ready to carry on.
  if (turn.conversationId !== state.conversationId) {
    return {
      state: { mode: 'following', settledAt: null, conversationId: turn.conversationId, shownTurnId: turn.lastUserId },
      action: { kind: 'toBottom', smooth: false }
    }
  }

  /*
   * A question that was not there before. The view goes to it, and then stays there.
   *
   * `mode` becomes 'reading' rather than 'following', and that is the point of the whole arrangement: an answer is
   * read from its beginning. A thirty-paragraph answer that dragged the page to its last paragraph while it was
   * being written would be unreadable, and a person who wanted its foot can say so -- by scrolling there, or by
   * pressing Latest, which is the one control that moves the page to the newest output.
   *
   * Following is a mode somebody enters deliberately. It is never entered because an answer happens to be arriving.
   */
  if (turn.lastUserId && turn.lastUserId !== state.shownTurnId) {
    return {
      state: { ...state, mode: 'reading', shownTurnId: turn.lastUserId },
      action: { kind: 'toTurn', messageId: turn.lastUserId }
    }
  }

  // Everything else is the same turn getting longer.
  if (state.mode === 'following') {
    return { state, action: { kind: 'toBottom', smooth: false } }
  }
  // Reduced motion is irrelevant when nothing moves, and is taken here only so the signature is the same either way.
  void reducedMotion
  return { state, action: { kind: 'none' } }
}

export interface ScrollOutcome {
  state: ChatScrollState
  /** Whether to offer a way back to the newest output. */
  showJump: boolean
}

/**
 * What a scroll event means.
 *
 * The first question is whose it was. An event that Orbis caused says nothing about what the person wants, so it is
 * used only to hand ownership back -- the next event really is theirs. Without this, every move Orbis made would
 * immediately be read as the person having moved, and the decision behind it would be thrown away a frame later.
 */
export function onScrolled(state: ChatScrollState, v: Viewport, showJumpNow: boolean, theirs = true, room = false): ScrollOutcome {
  const distance = distanceFromBottom(v)
  if (!theirs) {
    // Nobody scrolled. The content changed size and the browser put the scroller where it still fits -- a card
    // above folding away, a line of status arriving, a fraction of a pixel of rounding. Read by position alone this
    // looked like the person moving to the foot of the page, and Orbis began following an answer they were reading
    // from its top. Where the scroller now is becomes where Orbis left it, and the mode is what it was.
    return { state: { ...state, settledAt: v.scrollTop }, showJump: jumpVisible(v, showJumpNow) }
  }
  if (state.settledAt !== null && state.settledAt === v.scrollTop) {
    // The scroller is exactly where Orbis put it, so this event is the echo of Orbis's own move and says nothing about
    // what the person wants. The mode is left as the decision that caused the move set it.
    return { state, showJump: showJumpNow }
  }

  // Theirs. Being at the foot of the answer is how somebody says "keep showing me the newest part"; leaving it is how
  // they say they are reading instead.
  //
  // Unless there is still empty room under the newest turn. Then the end of the page is not the foot of the answer:
  // it is wherever the room happens to stop, and a nudge of the wheel while reading the first lines would otherwise
  // count as arriving there.
  const mode: ScrollMode = distance <= FOLLOW_THRESHOLD && !room ? 'following' : 'reading'
  // The settled position is cleared: the person has moved the scroller, so Orbis no longer knows of a position that
  // would be its own doing.
  return { state: { ...state, mode, settledAt: null }, showJump: jumpVisible(v, showJumpNow) }
}

/**
 * The person asked for the newest output.
 *
 * An explicit request, so following resumes -- unlike a new answer starting, which does not. Smoothly, because this is
 * a move somebody asked for and watching it travel tells them where they went; instantly when they have asked for
 * less movement.
 */
export function onJumpPressed(state: ChatScrollState, reducedMotion = false): Decision {
  return {
    state: { ...state, mode: 'following' },
    action: { kind: 'toBottom', smooth: !reducedMotion }
  }
}

/**
 * The view is about to be re-laid-out by something other than new messages -- the window resizing, the sidebar
 * opening, an image finishing loading, a code block being highlighted.
 *
 * Following means staying at the end afterwards. Reading means the number of pixels above has just changed under the
 * person, so it is put back: `keepAnchored` says by how much.
 */
export function onLayoutChanged(state: ChatScrollState): ScrollAction {
  return state.mode === 'following' ? { kind: 'toBottom', smooth: false } : { kind: 'none' }
}

/** How far below the top edge a question that was scrolled to sits. The same number the stylesheet uses. */
export const TURN_MARGIN = 16

/**
 * How much empty room to leave under the newest turn, so its question can sit at the top of the view.
 *
 * A scroller can only go as far as its content. A question that has just been asked is the last thing on the page,
 * with nothing under it yet, so "put it at the top" is impossible: it lands at the foot of the view and its answer
 * is written out of sight below it. Room under the turn is what makes the move possible -- exactly as much as lets
 * the question reach the top, and less as the answer fills it, until the answer is a screen long and none is left.
 *
 * `view` is the height of the scroller and `below` is everything from the top of the question to the end of the
 * content, not counting this room.
 */
export function roomUnderTurn(view: number, below: number): number {
  if (!Number.isFinite(view) || !Number.isFinite(below)) return 0
  // Rounded up, never down: half a pixel too little and the scroller cannot quite reach where it was put, the
  // browser moves it back by that half pixel, and a move nobody made has happened.
  return Math.max(0, Math.ceil(view - below - TURN_MARGIN))
}

/** How long after a wheel turn, a key or a touch a scroll is still that gesture's doing. */
export const GESTURE_MS = 700
/** How close together two scroll events have to be to be the same glide. */
export const GLIDE_MS = 150

/**
 * Whether a scroll event is the person's.
 *
 * A scroll event does not say who caused it. It is theirs when they are holding the scroller (dragging its bar,
 * selecting text past its edge), when it follows something they did that scrolls, or when it carries on a glide
 * that began that way. Anything else is the page rearranging itself.
 */
export function scrollIsTheirs(now: number, input: { pressed: boolean; actedAt: number; lastTheirsAt: number }): boolean {
  return input.pressed || now - input.actedAt < GESTURE_MS || now - input.lastTheirsAt < GLIDE_MS
}

/**
 * What the reader is looking at: one message, and where it sat.
 *
 * The position is measured against a *thing*, not against the document's height. That distinction is the whole reason
 * this works. Comparing heights cannot tell growth above the reader from growth below it -- a code block being
 * highlighted two messages up and an answer getting longer underneath both make the document taller -- and
 * compensating for the second one is itself the jump it was meant to prevent. Comparing where one message sits
 * answers the only question that matters: did the thing they are reading move?
 */
export interface Anchored {
  /** Where the scroller was. */
  scrollTop: number
  /** How far the anchor message sat from the top of all the messages. */
  anchorTop: number
}

/**
 * Where to put the scroller so the anchor message is still under the reader's eye.
 *
 * `most` is the furthest the scroller can go, which the caller knows and this deliberately does not assume: clamping
 * to a stale height is how a correction ends up one screen past the end.
 *
 * Returns null when the anchor has not moved, so the caller does not write a value it does not need to -- and writing
 * `scrollTop` needlessly is not free: it produces a scroll event.
 */
export function keepAnchored(before: Anchored, after: { anchorTop: number }, most: number): number | null {
  const moved = after.anchorTop - before.anchorTop
  if (moved === 0) return null
  const next = Math.min(Math.max(0, most), Math.max(0, before.scrollTop + moved))
  return next === before.scrollTop ? null : next
}
