/**
 * Two-finger history swiping: the rules, with no browser and no platform in them.
 *
 * A trackpad sends a stream of small horizontal movements. Deciding what they mean is the whole problem: the page may
 * want them for its own sideways scrolling, a diagonal drag is really a scroll, a flick that carries on after the
 * fingers lift must not count as a new gesture, and nothing may happen until the fingers come up — pulling the page
 * halfway and changing your mind has to leave you where you were.
 *
 * This module takes normalized gesture events and answers one question: what, if anything, should the browser do. It
 * holds no history of its own and navigates nothing; the browser does that through the same code the Back button uses.
 *
 * Pure — no browser, no storage, no platform.
 */

// ---------------------------------------------------------------- what the gesture must do to count

/** How far, in pixels, the fingers must travel sideways before this is treated as a history swipe at all. */
export const HISTORY_SWIPE_ACTIVATION_DISTANCE = 60
/** How far it must have gone, when the fingers lift, for the browser to actually navigate. */
export const HISTORY_SWIPE_COMMIT_DISTANCE = 140
/** Sideways movement must beat up-and-down movement by this much, or it is an ordinary scroll. */
export const HISTORY_SWIPE_HORIZONTAL_RATIO = 2
/** Drifting further up or down than this during a gesture means it was never a horizontal swipe. */
export const HISTORY_SWIPE_MAX_VERTICAL_DRIFT = 70
/** Below this much movement nothing is decided yet, so a resting finger cannot start anything. */
export const HISTORY_SWIPE_DEAD_ZONE = 8
/** Where the preview shows the point of no return, as a fraction of the commit distance. */
export const HISTORY_SWIPE_COMMIT_POINT = 1

export type HistorySwipeState = 'idle' | 'possible' | 'tracking' | 'committing' | 'cancelled'
export type HistoryDirection = 'back' | 'forward' | 'none'

/** One trackpad gesture event, in the same shape whatever the platform sent. */
export interface NormalizedTrackpadGesture {
  type: 'begin' | 'update' | 'end' | 'cancel'
  fingers: number
  deltaX: number
  deltaY: number
  velocityX?: number
  velocityY?: number
  timestamp: number
  /** The movement is the trackpad coasting after the fingers lifted, not the fingers themselves. */
  momentum?: boolean
  modifiers?: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }
}

/** What the browser can do about it, decided from the page and the tab rather than assumed. */
export interface HistorySwipeContext {
  canGoBack: boolean
  canGoForward: boolean
  /**
   * The page itself can still scroll sideways where the gesture started, so it has first claim on the movement.
   * Worked out once when a gesture starts, never per event.
   */
  pageCanScrollHorizontally: boolean
}

export interface HistorySwipeView {
  state: HistorySwipeState
  direction: HistoryDirection
  /** How far through the pull we are, 0 to 1, for the preview to follow. */
  progress: number
  /** The fingers have gone far enough that lifting them now would navigate. */
  willCommit: boolean
  /** Sideways travel so far, in pixels. */
  distance: number
}

/** What the browser should do as a result of this event. Navigation happens once, when the fingers lift. */
export interface HistorySwipeOutcome {
  view: HistorySwipeView
  /** Set exactly once, on release, and only when everything lined up. */
  navigate: HistoryDirection | null
  /** The preview should be shown or updated. */
  show: boolean
  /** The preview should be taken away. */
  hide: boolean
}

const IDLE_VIEW: HistorySwipeView = { state: 'idle', direction: 'none', progress: 0, willCommit: false, distance: 0 }

/**
 * Which way a gesture goes. A trackpad reports how the *content* moved, so dragging two fingers to the right sends a
 * negative deltaX — the same convention as a scrollbar. Pulling the page rightwards reveals what came before it, which
 * is Back; pulling it leftwards is Forward.
 */
export function directionOf(totalDeltaX: number): HistoryDirection {
  if (totalDeltaX < 0) return 'back'
  if (totalDeltaX > 0) return 'forward'
  return 'none'
}

/** Whether the movement so far is sideways enough to be a swipe rather than a scroll. */
export const isHorizontal = (deltaX: number, deltaY: number): boolean =>
  Math.abs(deltaX) > HISTORY_SWIPE_DEAD_ZONE && Math.abs(deltaX) > Math.abs(deltaY) * HISTORY_SWIPE_HORIZONTAL_RATIO

/**
 * The recogniser. One of these follows one gesture at a time; it is fed normalized events and says what to do.
 *
 * It deliberately keeps no browser state: whether there is anywhere to go back to, and whether the page wants the
 * movement for itself, are asked of the browser when a gesture starts and passed in.
 */
export class HistorySwipeRecognizer {
  private state: HistorySwipeState = 'idle'
  private direction: HistoryDirection = 'none'
  private totalX = 0
  private totalY = 0
  private context: HistorySwipeContext = { canGoBack: false, canGoForward: false, pageCanScrollHorizontally: false }
  /** Set once a gesture has finished, so coasting movement afterwards cannot start another one. */
  private awaitingFingersDown = false

  get view(): HistorySwipeView {
    if (this.state === 'idle' || this.state === 'cancelled') return { ...IDLE_VIEW, state: this.state }
    const distance = Math.abs(this.totalX)
    const progress = Math.min(1, distance / HISTORY_SWIPE_COMMIT_DISTANCE)
    return { state: this.state, direction: this.direction, progress, willCommit: distance >= HISTORY_SWIPE_COMMIT_DISTANCE, distance }
  }

  /** Whether the browser can go the way this gesture is pulling. */
  private possible(direction: HistoryDirection): boolean {
    if (direction === 'back') return this.context.canGoBack
    if (direction === 'forward') return this.context.canGoForward
    return false
  }

  private reset(state: HistorySwipeState = 'idle'): HistorySwipeOutcome {
    const wasShowing = this.state === 'tracking' || this.state === 'committing'
    this.state = state
    this.direction = 'none'
    this.totalX = 0
    this.totalY = 0
    return { view: { ...IDLE_VIEW, state }, navigate: null, show: false, hide: wasShowing }
  }

  /** Throws the gesture away: the tab closed, the window lost focus, the page navigated under it. */
  cancel(): HistorySwipeOutcome {
    this.awaitingFingersDown = false
    return this.reset('cancelled')
  }

  handle(event: NormalizedTrackpadGesture, context: HistorySwipeContext): HistorySwipeOutcome {
    // Only a two-finger trackpad gesture. A mouse wheel, a single pointer or anything synthetic is not this gesture.
    if (event.fingers !== 2) return this.state === 'idle' ? { view: this.view, navigate: null, show: false, hide: false } : this.cancel()

    if (event.type === 'begin') {
      this.awaitingFingersDown = false
      this.state = 'possible'
      this.direction = 'none'
      this.totalX = 0
      this.totalY = 0
      this.context = context
      return { view: this.view, navigate: null, show: false, hide: false }
    }

    if (event.type === 'cancel') return this.cancel()

    if (event.type === 'end') {
      // Coasting starts once the fingers are up; nothing after this may begin a gesture until they come down again.
      this.awaitingFingersDown = true
      if (this.state !== 'tracking' && this.state !== 'committing') return this.reset()
      const { willCommit, direction } = this.view
      const navigate = willCommit && this.possible(direction) ? direction : null
      this.state = navigate ? 'committing' : 'cancelled'
      const outcome: HistorySwipeOutcome = { view: this.view, navigate, show: false, hide: true }
      this.reset()
      return outcome
    }

    // ---- update
    // Movement that is only the trackpad coasting cannot start a gesture, though it may finish one already under way.
    if (event.momentum && (this.state === 'idle' || this.awaitingFingersDown)) return { view: this.view, navigate: null, show: false, hide: false }
    if (this.state === 'idle') {
      // Some platforms send no "begin", so the first real movement starts it.
      if (this.awaitingFingersDown) return { view: this.view, navigate: null, show: false, hide: false }
      this.state = 'possible'
      this.context = context
    }
    if (this.state === 'cancelled') return { view: this.view, navigate: null, show: false, hide: false }

    this.totalX += event.deltaX
    this.totalY += event.deltaY

    // Wandering too far up or down means this was a scroll all along.
    if (Math.abs(this.totalY) > HISTORY_SWIPE_MAX_VERTICAL_DRIFT) return this.cancel()

    if (this.state === 'possible') {
      if (!isHorizontal(this.totalX, this.totalY)) return { view: this.view, navigate: null, show: false, hide: false }
      if (Math.abs(this.totalX) < HISTORY_SWIPE_ACTIVATION_DISTANCE) return { view: this.view, navigate: null, show: false, hide: false }
      // The page's own sideways scrolling comes first: if it can still scroll, this movement is its.
      if (this.context.pageCanScrollHorizontally) return this.cancel()
      const direction = directionOf(this.totalX)
      // Pulling towards a page that is not there does nothing at all, rather than showing a preview that lies.
      if (!this.possible(direction)) return this.cancel()
      this.direction = direction
      this.state = 'tracking'
      return { view: this.view, navigate: null, show: true, hide: false }
    }

    // ---- tracking: the preview follows the fingers, and reversing past the start gives up
    const direction = directionOf(this.totalX)
    if (direction !== this.direction || Math.abs(this.totalX) < HISTORY_SWIPE_DEAD_ZONE) return this.cancel()
    return { view: this.view, navigate: null, show: true, hide: false }
  }
}
