import { bigEnough, clamp, moved, pastThreshold, rectBetween, resized, type Corner, type Point, type Rect, type Size } from './geometry.ts'

/**
 * The states a Visual Search can be in, and the only ways between them.
 *
 * It is a reducer rather than a set of flags for one reason, learned from the rest of this application: a feature
 * built out of booleans gets a combination nobody designed. `selecting` and `analysing` both true is a stuck overlay
 * over a result; `armed` left true after the modifier came up is a browser that will not let you click a link. Here
 * there is exactly one state at a time, every transition is named, and the illegal combinations cannot be written
 * down.
 *
 * It is also pure, which is what lets the awkward sequences be tested as a list of events rather than acted out with
 * a mouse: Escape halfway through a drag, the window losing focus during analysis, a second drag starting before the
 * first answer came back, the tab changing underneath a running request.
 */

export type Phase =
  /** Nothing is happening, and the page behaves exactly as it would without Orbis. */
  | 'idle'
  /** The modifier is down. Still nothing has been taken over: a click is a click. */
  | 'armed'
  /** The pointer is down and has gone far enough. This is now a selection. */
  | 'selecting'
  /** Dragging an existing selection's corner, or the whole of it. */
  | 'adjusting'
  /** A selection exists and is waiting for a question. */
  | 'ready'
  /** The pixels are being taken. */
  | 'capturing'
  /** Orion is looking. */
  | 'analysing'
  /** There is an answer. */
  | 'answered'
  /** Something went wrong, and it is a thing the person can act on. */
  | 'failed'

export type Event =
  | { kind: 'modifier-down' }
  | { kind: 'modifier-up' }
  | { kind: 'pointer-down'; at: Point }
  | { kind: 'pointer-move'; at: Point }
  | { kind: 'pointer-up'; at: Point }
  | { kind: 'grab-handle'; corner: Corner; at: Point }
  | { kind: 'grab-inside'; at: Point }
  | { kind: 'ask'; question: string }
  | { kind: 'captured' }
  | { kind: 'answer' }
  | { kind: 'fail'; code: string; says: string }
  | { kind: 'retry' }
  | { kind: 'reselect' }
  | { kind: 'cancel' }
  /** The window resized: the selection is re-clamped, or given up on if there is nothing left of it. */
  | { kind: 'room'; room: Size }
  /** The tab changed, the page navigated, or the window lost focus. Anything in flight stops. */
  | { kind: 'interrupted' }

export interface State {
  readonly phase: Phase
  /** Where the drag started. Kept through `selecting` and `adjusting`, and nowhere else. */
  readonly from: Point | null
  /** The selection, in CSS pixels, always normalised and always inside the room. */
  readonly rect: Rect | null
  /** Which corner is being dragged, when one is. */
  readonly corner: Corner | null
  /** Where the pointer was when an adjustment began, so a move is a delta rather than a jump. */
  readonly held: Point | null
  readonly room: Size
  readonly question: string
  readonly failure: { code: string; says: string } | null
  /**
   * Which run this is. Incremented whenever a new selection begins, and carried on every request, so an answer from
   * a request the person has already moved on from can be recognised and dropped instead of appearing over the new
   * one. This is the whole defence against a stale result, and it is here rather than in the page because it has to
   * survive every path back to `idle`.
   */
  readonly run: number
}

export function start(room: Size): State {
  return { phase: 'idle', from: null, rect: null, corner: null, held: null, room, question: '', failure: null, run: 0 }
}

/** Back to nothing, keeping the run number so a late answer from the run just abandoned is still recognisable. */
function cleared(state: State): State {
  return { ...state, phase: 'idle', from: null, rect: null, corner: null, held: null, question: '', failure: null }
}

/** The phases where something is in flight and a cancel has work to do. */
export function inFlight(phase: Phase): boolean {
  return phase === 'capturing' || phase === 'analysing'
}

/** The phases where the overlay is on screen and the page must not receive the pointer. */
export function overlaid(phase: Phase): boolean {
  return phase !== 'idle' && phase !== 'armed'
}

export function next(state: State, event: Event): State {
  switch (event.kind) {
    case 'room': {
      const room = event.room
      if (!state.rect) return { ...state, room }
      const kept = clamp(state.rect, room)
      // A window shrunk until the selection no longer fits is a selection about something that is no longer there.
      if (!bigEnough(kept)) return { ...cleared(state), room, run: state.run + 1 }
      return { ...state, room, rect: kept }
    }

    case 'modifier-down':
      return state.phase === 'idle' ? { ...state, phase: 'armed' } : state

    case 'modifier-up':
      /*
       * Letting go of Ctrl mid-drag does not cancel.
       *
       * It was the obvious reading of the gesture and it was wrong in use: the modifier is how you *start*, and
       * people let go of it the moment the rectangle is under way. Cancelling there threw away a selection somebody
       * was halfway through drawing. So it only matters while nothing has begun.
       */
      return state.phase === 'armed' ? { ...state, phase: 'idle' } : state

    case 'pointer-down':
      if (state.phase !== 'armed') return state
      return { ...state, from: event.at, rect: null }

    case 'pointer-move': {
      if (state.phase === 'armed') {
        // Not yet a selection. The page keeps the pointer until the threshold says otherwise.
        if (!state.from || !pastThreshold(state.from, event.at)) return state
        return { ...state, phase: 'selecting', rect: clamp(rectBetween(state.from, event.at), state.room), run: state.run + 1 }
      }
      if (state.phase === 'selecting') {
        if (!state.from) return state
        return { ...state, rect: clamp(rectBetween(state.from, event.at), state.room) }
      }
      if (state.phase === 'adjusting') {
        if (!state.rect) return state
        // The arithmetic lives in geometry.ts, where it is tested on its own. Repeating it here is how the
        // opposite-corner table ends up written twice and disagreeing with itself.
        if (state.corner) return { ...state, rect: resized(state.rect, state.corner, event.at, state.room) }
        if (!state.held) return state
        return {
          ...state,
          held: event.at,
          rect: moved(state.rect, { x: event.at.x - state.held.x, y: event.at.y - state.held.y }, state.room)
        }
      }
      return state
    }

    case 'pointer-up': {
      if (state.phase === 'selecting') {
        const rect = state.rect ? clamp(state.rect, state.room) : null
        // A drag that crossed the threshold and still selected nothing: the gesture happened, so the overlay has to
        // go, but there is nothing to ask about and nothing is claimed to have been captured.
        if (!rect || !bigEnough(rect)) return cleared(state)
        return { ...state, phase: 'ready', from: null, rect }
      }
      if (state.phase === 'adjusting') {
        const rect = state.rect ? clamp(state.rect, state.room) : null
        if (!rect || !bigEnough(rect)) return cleared(state)
        return { ...state, phase: 'ready', corner: null, held: null, rect }
      }
      // A click that never became a drag. The start point is dropped, so the *next* pointer-down is measured from
      // where it happened rather than from where an earlier click did.
      if (state.phase === 'armed') return { ...state, from: null }
      return state
    }

    case 'grab-handle':
      if (state.phase !== 'ready' && state.phase !== 'answered' && state.phase !== 'failed') return state
      if (!state.rect) return state
      return { ...state, phase: 'adjusting', corner: event.corner, held: event.at, failure: null }

    case 'grab-inside':
      if (state.phase !== 'ready' && state.phase !== 'answered' && state.phase !== 'failed') return state
      if (!state.rect) return state
      return { ...state, phase: 'adjusting', corner: null, held: event.at, failure: null }

    case 'ask': {
      if (state.phase !== 'ready' && state.phase !== 'answered' && state.phase !== 'failed') return state
      if (!state.rect) return state
      /*
       * A new question is a new run, even over the same selection.
       *
       * Without this, pressing Enter twice quickly gave two requests with the same run number, and the slower one
       * then overwrote the faster one's answer -- the "stale result" bug, arriving from the same selection rather
       * than from a different one.
       */
      return { ...state, phase: 'capturing', question: event.question, failure: null, run: state.run + 1 }
    }

    case 'captured':
      return state.phase === 'capturing' ? { ...state, phase: 'analysing' } : state

    case 'answer':
      return state.phase === 'analysing' ? { ...state, phase: 'answered' } : state

    case 'fail':
      // A failure that arrives after the person has moved on is not shown; the phase check is what drops it.
      if (!inFlight(state.phase)) return state
      return { ...state, phase: 'failed', failure: { code: event.code, says: event.says } }

    case 'retry':
      if (state.phase !== 'failed' || !state.rect) return state
      return { ...state, phase: 'capturing', failure: null, run: state.run + 1 }

    case 'reselect':
      // Straight back to armed rather than idle: the modifier is still the way in, and the person has said they want
      // to select again, so the next drag should work without pressing Ctrl a second time.
      return { ...cleared(state), phase: 'armed', run: state.run + 1 }

    case 'cancel':
      return { ...cleared(state), run: state.run + 1 }

    case 'interrupted':
      // Not a failure: nothing went wrong, the thing being looked at went away.
      return { ...cleared(state), run: state.run + 1 }

    default:
      return state
  }
}

/** Whether an answer or failure belongs to the run the person is actually waiting for. */
export function current(state: State, run: number): boolean {
  return state.run === run
}
