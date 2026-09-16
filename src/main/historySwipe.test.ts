import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  directionOf,
  HistorySwipeRecognizer,
  HISTORY_SWIPE_ACTIVATION_DISTANCE,
  HISTORY_SWIPE_COMMIT_DISTANCE,
  HISTORY_SWIPE_MAX_VERTICAL_DRIFT,
  isHorizontal
} from '../shared/historySwipe.ts'
import type { HistorySwipeContext, NormalizedTrackpadGesture } from '../shared/historySwipe.ts'

const BOTH_WAYS: HistorySwipeContext = { canGoBack: true, canGoForward: true, pageCanScrollHorizontally: false }
const FIRST_PAGE: HistorySwipeContext = { canGoBack: false, canGoForward: false, pageCanScrollHorizontally: false }
const SCROLLABLE: HistorySwipeContext = { canGoBack: true, canGoForward: true, pageCanScrollHorizontally: true }

let clock = 0
const event = (patch: Partial<NormalizedTrackpadGesture>): NormalizedTrackpadGesture => ({
  type: 'update',
  fingers: 2,
  deltaX: 0,
  deltaY: 0,
  timestamp: (clock += 16),
  ...patch
})

/** Drags the fingers a distance in steps, the way a trackpad reports it. Returns the last outcome. */
function drag(r: HistorySwipeRecognizer, context: HistorySwipeContext, totalX: number, totalY = 0, steps = 10) {
  let last = r.handle(event({ type: 'begin' }), context)
  for (let i = 0; i < steps; i++) last = r.handle(event({ deltaX: totalX / steps, deltaY: totalY / steps }), context)
  return last
}

test('which way a swipe goes: pulling the page rightwards is Back, leftwards is Forward', () => {
  // A trackpad reports how the content moved, so dragging two fingers right sends a negative deltaX.
  assert.equal(directionOf(-200), 'back')
  assert.equal(directionOf(200), 'forward')
  assert.equal(directionOf(0), 'none')
})

test('sideways movement is told apart from a scroll, with a dead zone so a resting finger decides nothing', () => {
  assert.equal(isHorizontal(-100, 5), true)
  assert.equal(isHorizontal(-100, 80), false, 'a diagonal drag is a scroll')
  assert.equal(isHorizontal(-4, 0), false, 'the smallest movement decides nothing')
  assert.equal(isHorizontal(0, -100), false)
})

test('nothing happens until the fingers lift, however far they travel', () => {
  const r = new HistorySwipeRecognizer()
  const pulled = drag(r, BOTH_WAYS, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60))
  assert.equal(pulled.navigate, null, 'past the point of no return, still nothing')
  assert.equal(pulled.view.state, 'tracking')
  assert.equal(pulled.view.willCommit, true, 'but the preview says it would')
  assert.equal(pulled.show, true)

  const released = r.handle(event({ type: 'end' }), BOTH_WAYS)
  assert.equal(released.navigate, 'back', 'and lifting the fingers is what navigates')
  assert.equal(released.hide, true)
})

test('a swipe that is pulled back before the fingers lift leaves you where you were', () => {
  const r = new HistorySwipeRecognizer()
  drag(r, BOTH_WAYS, -(HISTORY_SWIPE_COMMIT_DISTANCE + 40))
  // The user thinks better of it and drags all the way back.
  const reversed = r.handle(event({ deltaX: HISTORY_SWIPE_COMMIT_DISTANCE + 40 }), BOTH_WAYS)
  assert.equal(reversed.view.state, 'cancelled')
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, null)
})

test('a short pull shows a preview but does not navigate', () => {
  const r = new HistorySwipeRecognizer()
  const short = drag(r, BOTH_WAYS, -(HISTORY_SWIPE_ACTIVATION_DISTANCE + 10))
  assert.equal(short.view.state, 'tracking', 'far enough to be a swipe')
  assert.equal(short.view.willCommit, false, 'but not far enough to mean it')
  assert.ok(short.view.progress > 0 && short.view.progress < 1)
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, null)
})

test('the preview follows the fingers rather than playing on its own', () => {
  const r = new HistorySwipeRecognizer()
  r.handle(event({ type: 'begin' }), BOTH_WAYS)
  r.handle(event({ deltaX: -HISTORY_SWIPE_ACTIVATION_DISTANCE - 1 }), BOTH_WAYS)
  const quarter = r.handle(event({ deltaX: -(HISTORY_SWIPE_COMMIT_DISTANCE / 4) }), BOTH_WAYS).view.progress
  const half = r.handle(event({ deltaX: -(HISTORY_SWIPE_COMMIT_DISTANCE / 4) }), BOTH_WAYS).view.progress
  assert.ok(half > quarter, 'further fingers, further along')
  assert.ok(half <= 1)
  // Going back the other way winds the preview back down instead of carrying on.
  const wound = r.handle(event({ deltaX: HISTORY_SWIPE_COMMIT_DISTANCE / 4 }), BOTH_WAYS).view.progress
  assert.ok(wound < half)
})

test('a page that can still scroll sideways keeps the movement for itself', () => {
  const r = new HistorySwipeRecognizer()
  const onCarousel = drag(r, SCROLLABLE, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60))
  assert.equal(onCarousel.view.state, 'cancelled', 'the carousel scrolls, the browser stays put')
  assert.equal(r.handle(event({ type: 'end' }), SCROLLABLE).navigate, null)
})

test('swiping towards a page that is not there does nothing, and shows nothing', () => {
  const r = new HistorySwipeRecognizer()
  const nowhere = drag(r, FIRST_PAGE, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60))
  assert.equal(nowhere.view.state, 'cancelled')
  assert.equal(nowhere.show, false, 'no preview that promises something that cannot happen')
  assert.equal(r.handle(event({ type: 'end' }), FIRST_PAGE).navigate, null)

  // Forward works the same way when there is nothing ahead.
  const back = new HistorySwipeRecognizer()
  const onlyBack: HistorySwipeContext = { canGoBack: true, canGoForward: false, pageCanScrollHorizontally: false }
  assert.equal(drag(back, onlyBack, HISTORY_SWIPE_COMMIT_DISTANCE + 60).view.state, 'cancelled')
})

test('a diagonal drag stays a scroll, however far sideways it ends up', () => {
  const r = new HistorySwipeRecognizer()
  const diagonal = drag(r, BOTH_WAYS, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60), HISTORY_SWIPE_MAX_VERTICAL_DRIFT + 20)
  assert.notEqual(diagonal.view.state, 'tracking')
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, null)
})

test('coasting after the fingers lift cannot navigate again', () => {
  const r = new HistorySwipeRecognizer()
  drag(r, BOTH_WAYS, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60))
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, 'back', 'the flick navigates once')

  // The trackpad keeps sending movement as it slows down. None of it may start anything.
  for (let i = 0; i < 20; i++) {
    const coast = r.handle(event({ deltaX: -40, momentum: true }), BOTH_WAYS)
    assert.equal(coast.navigate, null)
    assert.equal(coast.show, false)
  }
  assert.equal(r.handle(event({ type: 'end', momentum: true }), BOTH_WAYS).navigate, null, 'and it cannot navigate on its own')
})

test('a gesture navigates exactly once, and lifting the fingers again does nothing', () => {
  const r = new HistorySwipeRecognizer()
  drag(r, BOTH_WAYS, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60))
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, 'back')
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, null)
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, null)
})

test('anything that is not two fingers is left well alone', () => {
  for (const fingers of [0, 1, 3, 4]) {
    const r = new HistorySwipeRecognizer()
    const wheel = r.handle(event({ fingers, deltaX: -300 }), BOTH_WAYS)
    assert.equal(wheel.view.state, 'idle', `${fingers} fingers is not this gesture`)
    assert.equal(r.handle(event({ type: 'end', fingers }), BOTH_WAYS).navigate, null)
  }

  // A third finger landing part-way through gives the gesture up rather than carrying on regardless.
  const r = new HistorySwipeRecognizer()
  drag(r, BOTH_WAYS, -(HISTORY_SWIPE_COMMIT_DISTANCE + 40))
  assert.equal(r.handle(event({ fingers: 3, deltaX: -20 }), BOTH_WAYS).view.state, 'cancelled')
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, null)
})

test('a gesture interrupted by the tab or the window is dropped, and navigates nothing', () => {
  const r = new HistorySwipeRecognizer()
  drag(r, BOTH_WAYS, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60))
  const dropped = r.cancel()
  assert.equal(dropped.view.state, 'cancelled')
  assert.equal(dropped.hide, true, 'the preview goes away with it')
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, null)

  // The platform's own cancel means the same thing.
  const other = new HistorySwipeRecognizer()
  drag(other, BOTH_WAYS, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60))
  assert.equal(other.handle(event({ type: 'cancel' }), BOTH_WAYS).hide, true)
  assert.equal(other.handle(event({ type: 'end' }), BOTH_WAYS).navigate, null)
})

test('a second swipe after a completed one works normally', () => {
  const r = new HistorySwipeRecognizer()
  drag(r, BOTH_WAYS, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60))
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, 'back')
  // Fingers down again: a fresh gesture, the other way.
  drag(r, BOTH_WAYS, HISTORY_SWIPE_COMMIT_DISTANCE + 60)
  assert.equal(r.handle(event({ type: 'end' }), BOTH_WAYS).navigate, 'forward')
})

test('the browser is asked what is possible at the start, not told', () => {
  // Nothing in here knows about tabs or history: what can happen is handed in, and a swipe towards a page that exists
  // only in another tab's history is impossible here.
  const r = new HistorySwipeRecognizer()
  const outcome = drag(r, { canGoBack: false, canGoForward: true, pageCanScrollHorizontally: false }, -(HISTORY_SWIPE_COMMIT_DISTANCE + 60))
  assert.equal(outcome.view.state, 'cancelled')
})
