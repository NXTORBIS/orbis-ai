/**
 * What Orbis thinks you are about to type, and when that guess stops being true.
 *
 * Three different things wear the word "suggestion" in the chat, and keeping them apart is most of this file:
 *
 * **The placeholder** -- "What would you like to ask?" -- is not a guess at anything. It shows when the box is empty.
 *
 * **The ghost** is a guess shown faded inside the message box, after what you have typed. It comes from one of two
 * places: after a reply, from the reply itself ("post-response"); while you type, from what you have typed so far
 * ("typing"). Both are the same thing on screen and both are accepted with Tab, so they are one state here.
 *
 * **The chips** under a reply -- "Explain further", "Give an example" -- belong to that reply, not to the message box.
 * They have their own life, and the rule nothing used to honour is: the moment you start writing something of your
 * own, they go. Not when you send it. When you start.
 *
 * The ghost is never part of what you typed. The message box holds your characters and nothing else, so sending a
 * message with a ghost on screen sends your words, not the guess -- which is the only safe answer, because the guess
 * was Orbis's and the message is yours.
 *
 * ## Why a version number
 *
 * A guess is asked for over the network and arrives whenever it arrives. Type "Can you", pause, type "explain", and
 * the answer to the first question can land after the answer to the second. The old check -- "does this still
 * continue what is typed?" -- lets that happen: a guess made for "Can you" may well also continue "Can you explain",
 * and it then replaces the newer, better one. So every ask carries the version of the box it was asked for, and an
 * answer for an older version is thrown away without being looked at.
 */

/** Where a ghost came from. Kept for working out what is going on, never shown to anybody. */
export type PredictionSource = 'post-response' | 'typing'

/** Why a ghost went away. Only ever read in a log or a test. */
export type InvalidReason =
  | 'typed'
  | 'pasted'
  | 'accepted'
  | 'dismissed'
  | 'submitted'
  | 'cleared'
  | 'conversation-changed'
  | 'reply-changed'
  | 'attachment-changed'
  | 'model-changed'
  | 'stale'
  | 'timeout'
  | 'error'
  | 'blurred'
  | 'gone'

export type PredictionStatus = 'idle' | 'asking' | 'showing' | 'accepted' | 'invalid'

export interface PredictionState {
  status: PredictionStatus
  /** The whole sentence as guessed: what is typed, plus the rest. Null when there is nothing to show. */
  full: string | null
  source: PredictionSource | null
  /** The version of the box this guess was made for. An answer for an older version is not used. */
  version: number
  /** The box as it was when this was asked for, so a guess cannot be shown against text it never saw. */
  askedFor: string | null
  /** Guesses the person has pressed Escape on. Not offered again for the same text. */
  dismissed: readonly string[]
  reason: InvalidReason | null
}

export const IDLE: PredictionState = Object.freeze({
  status: 'idle',
  full: null,
  source: null,
  version: 0,
  askedFor: null,
  dismissed: Object.freeze([]) as readonly string[],
  reason: null
})

/** How many dismissed guesses are remembered. Enough that pressing Escape twice is not undone, small enough to forget. */
export const DISMISSED_KEPT = 8

/** How long a guess is waited for before it is given up on. A guess that arrives after this is not wanted. */
export const PREDICTION_TIMEOUT_MS = 6000

/** How long typing must pause before a guess is asked for. */
export const PREDICTION_DEBOUNCE_MS = 450

/** Shortest and longest draft worth guessing at. */
export const MIN_DRAFT = 3
export const MAX_DRAFT = 600

/** Longest continuation worth showing. Beyond this it is an answer, not a guess at what you are typing. */
export const MAX_GHOST = 160

/** Whether a candidate carries on from what is typed, rather than rewriting it. Case is ignored; the text is not. */
export function continues(candidate: string | null | undefined, typed: string): candidate is string {
  if (!candidate) return false
  if (candidate.length <= typed.length) return false
  return candidate.toLowerCase().startsWith(typed.toLowerCase())
}

/**
 * The part of a guess that is not already typed -- the only part shown faded.
 *
 * The guess keeps the person's own characters exactly: it is their capitals and their spacing that stay, and only the
 * tail comes from Orbis. That is what stops "Can you explain" + "Can you explain how" rendering the opening twice.
 */
export function ghostOf(state: PredictionState, typed: string): string {
  if (state.status !== 'showing' || !continues(state.full, typed)) return ''
  return state.full.slice(typed.length)
}

/**
 * Whether a guess is worth showing at all.
 *
 * Everything here is a reason a guess would be wrong rather than merely unhelpful: it repeats what is typed, it is
 * nothing, it is long enough to be an answer, or it carries instructions that were never meant to be read by anybody.
 */
export function usable(full: string | null | undefined, typed: string): full is string {
  if (!continues(full, typed)) return false
  const rest = full.slice(typed.length)
  if (rest.trim().length < 2) return false
  if (rest.length > MAX_GHOST) return false
  // A guess is plain text in a message box. Anything that looks like it came from inside the machinery is not shown.
  if (/\b(system prompt|internal context|as an ai language model)\b/i.test(rest)) return false
  if (/^\s*\{/.test(rest) && /\}\s*$/.test(rest)) return false
  return true
}

/** Whether a draft is the sort of thing worth asking about. Slash commands and several lines are not. */
export function worthAsking(draft: string): boolean {
  const typed = draft.trim()
  if (typed.length < MIN_DRAFT || draft.length > MAX_DRAFT) return false
  if (draft.startsWith('/')) return false
  if (draft.includes('\n')) return false
  return true
}

// ---------------------------------------------------------------- the things that happen to a guess

export type PredictionEvent =
  /** The box changed because somebody typed, pasted or cut. The version goes up and any guess stops being true. */
  | { kind: 'input'; draft: string; reason: Extract<InvalidReason, 'typed' | 'pasted' | 'cleared'> }
  /** A guess has been asked for, for this exact draft. */
  | { kind: 'asked'; draft: string }
  /** A guess came back. `version` is the version it was asked for; anything older is dropped here. */
  | { kind: 'answered'; version: number; full: string | null; draft: string; source: PredictionSource }
  /** A reply finished and brought a guess with it. */
  | { kind: 'reply'; full: string | null; draft: string }
  | { kind: 'accept'; draft: string }
  | { kind: 'dismiss' }
  /** Everything about the surroundings changed: another conversation, another reply, a file added, another model. */
  | { kind: 'reset'; reason: InvalidReason }

/**
 * The one place a guess changes.
 *
 * Every path through this either shows a guess that matches the box as it is now, or shows nothing. There is no path
 * that shows a guess made for text somebody has since changed, which was the whole of the old trouble.
 */
export function predictionReducer(state: PredictionState, event: PredictionEvent): PredictionState {
  switch (event.kind) {
    case 'input': {
      // The version goes up on every change, which is what makes every guess already in flight an old one. The guess
      // on screen goes at the same moment -- not after the next one arrives, so nothing stale is ever left showing.
      const next = { ...state, version: state.version + 1, full: null, source: null, askedFor: null }
      if (event.draft === '') return { ...next, status: 'idle', reason: 'cleared' }
      return { ...next, status: 'idle', reason: event.reason }
    }
    case 'asked':
      return { ...state, status: 'asking', askedFor: event.draft, reason: null }
    case 'answered': {
      // The one check that matters: was this asked for the box as it is now?
      if (event.version !== state.version) return state.status === 'asking' ? { ...state, status: 'idle', reason: 'stale' } : state
      if (!usable(event.full, event.draft) || state.dismissed.includes(event.full ?? '')) {
        return { ...state, status: 'idle', full: null, source: null, reason: null }
      }
      return { ...state, status: 'showing', full: event.full, source: event.source, reason: null }
    }
    case 'reply': {
      if (!usable(event.full, event.draft) || state.dismissed.includes(event.full ?? '')) {
        return { ...state, status: 'idle', full: null, source: null, reason: null }
      }
      return { ...state, status: 'showing', full: event.full, source: 'post-response', reason: null }
    }
    case 'accept': {
      if (!continues(state.full, event.draft)) return state
      // Accepted guesses are remembered as dismissed as well. Otherwise the same reply's guess, which is still sitting
      // in its props, continues the longer text it just produced and comes straight back -- a guess that accepts
      // itself for ever. One press, one acceptance, and then nothing until somebody types.
      return {
        ...state,
        status: 'accepted',
        full: null,
        source: null,
        askedFor: null,
        version: state.version + 1,
        dismissed: [...state.dismissed, state.full].slice(-DISMISSED_KEPT),
        reason: 'accepted'
      }
    }
    case 'dismiss': {
      if (state.status !== 'showing' || state.full === null) return state
      return {
        ...state,
        status: 'invalid',
        full: null,
        source: null,
        version: state.version + 1,
        dismissed: [...state.dismissed, state.full].slice(-DISMISSED_KEPT),
        reason: 'dismissed'
      }
    }
    case 'reset':
      // A different conversation or a different reply: even what was dismissed is forgotten, because it was dismissed
      // about something else.
      return { ...IDLE, version: state.version + 1, reason: event.reason }
  }
}

/** What the person's message box actually holds once a guess is taken. Their characters, then the rest. */
export function accepted(full: string, typed: string): string {
  return typed + full.slice(typed.length)
}

// ---------------------------------------------------------------- the chips under a reply

export interface ChipsState {
  conversationId: string | null
  responseId: string | null
  /** True once there is something of the person's own in the message box. */
  draftStarted: boolean
}

/**
 * Whether a reply's chips may be on screen.
 *
 * The rule that was missing: they belong to the last reply, in this conversation, and only while the message box is
 * empty of anything the person has written. Starting to write is the end of them -- immediately, on the first
 * character, with no waiting for a send or for another reply. They were there to answer "what now?", and somebody who
 * is typing has answered it.
 */
export function chipsVisible(state: ChipsState, forResponseId: string, inConversationId: string | null): boolean {
  if (state.draftStarted) return false
  if (state.responseId !== forResponseId) return false
  if (state.conversationId !== inConversationId) return false
  return true
}
