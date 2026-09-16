import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GestureInputAdapter, GESTURE_END_AFTER_SILENCE_MS } from './gestureAdapter.ts'
import type { WheelLikeEvent } from './gestureAdapter.ts'
import type { NormalizedTrackpadGesture } from '../shared/historySwipe.ts'

/** An adapter with time and timers under the test's control, so a pause can be made to happen exactly when wanted. */
function makeAdapter(platform: NodeJS.Platform = 'win32') {
  const events: NormalizedTrackpadGesture[] = []
  let clock = 1000
  let pending: { run: () => void; at: number } | null = null
  let nextHandle = 1
  const adapter = new GestureInputAdapter({
    platform,
    emit: (event) => events.push(event),
    now: () => clock,
    setTimer: (run, ms) => {
      pending = { run, at: clock + ms }
      return nextHandle++
    },
    clearTimer: () => {
      pending = null
    }
  })
  return {
    adapter,
    events,
    tick: (ms: number) => {
      clock += ms
      if (pending && clock >= pending.at) {
        const run = pending.run
        pending = null
        run()
      }
    },
    get hasTimer() {
      return pending !== null
    }
  }
}

const wheel = (patch: Partial<WheelLikeEvent>): WheelLikeEvent => ({ type: 'mouseWheel', hasPreciseScrollingDeltas: true, deltaX: 0, deltaY: 0, ...patch })

test('only a precision trackpad counts: a mouse wheel is not this gesture', () => {
  assert.equal(GestureInputAdapter.isTrackpad(wheel({ deltaX: -40 })), true)
  assert.equal(GestureInputAdapter.isTrackpad(wheel({ hasPreciseScrollingDeltas: false, deltaX: -120 })), false, 'a wheel notch is not two fingers')
  assert.equal(GestureInputAdapter.isTrackpad({ type: 'mouseWheel', deltaX: -120 }), false, 'nor is one that says nothing about itself')
  assert.equal(GestureInputAdapter.isTrackpad({ type: 'mouseMove', hasPreciseScrollingDeltas: true }), false, 'nor is pointer movement')
  assert.equal(GestureInputAdapter.isTrackpad({ type: 'mouseDown' }), false)
})

test('a mouse wheel costs nothing: it is dropped before any gesture is started', () => {
  const a = makeAdapter()
  for (let i = 0; i < 20; i++) a.adapter.handleWheel(wheel({ hasPreciseScrollingDeltas: false, deltaX: -120 }))
  assert.deepEqual(a.events, [])
  assert.equal(a.hasTimer, false, 'and nothing is left running')
})

test('trackpad movement becomes a gesture that begins, updates and ends by itself', () => {
  const a = makeAdapter()
  a.adapter.handleWheel(wheel({ deltaX: -20 }))
  a.tick(16)
  a.adapter.handleWheel(wheel({ deltaX: -25 }))
  assert.deepEqual(a.events.map((e) => e.type), ['begin', 'update', 'update'])
  assert.equal(a.events[1].fingers, 2)
  assert.equal(a.events[1].deltaX, -20)

  // The fingers lift: nothing arrives for a while, and the gesture is ended.
  a.tick(GESTURE_END_AFTER_SILENCE_MS + 1)
  assert.deepEqual(a.events.map((e) => e.type), ['begin', 'update', 'update', 'end'])
})

test('a pause shorter than the fingers lifting keeps the same gesture going', () => {
  const a = makeAdapter()
  a.adapter.handleWheel(wheel({ deltaX: -20 }))
  a.tick(GESTURE_END_AFTER_SILENCE_MS - 20)
  a.adapter.handleWheel(wheel({ deltaX: -20 }))
  a.tick(GESTURE_END_AFTER_SILENCE_MS - 20)
  a.adapter.handleWheel(wheel({ deltaX: -20 }))
  assert.equal(a.events.filter((e) => e.type === 'begin').length, 1, 'still one gesture')
  assert.equal(a.events.filter((e) => e.type === 'end').length, 0)
})

test('fingers down again after a gesture start a new one', () => {
  const a = makeAdapter()
  a.adapter.handleWheel(wheel({ deltaX: -20 }))
  a.tick(GESTURE_END_AFTER_SILENCE_MS + 1)
  a.adapter.handleWheel(wheel({ deltaX: -20 }))
  assert.deepEqual(a.events.map((e) => e.type), ['begin', 'update', 'end', 'begin', 'update'])
})

test('an interrupted gesture is cancelled, and only when one was running', () => {
  const a = makeAdapter()
  a.adapter.handleWheel(wheel({ deltaX: -20 }))
  a.adapter.cancel()
  assert.equal(a.events.at(-1)?.type, 'cancel')
  assert.equal(a.hasTimer, false, 'the pending end is called off with it')

  const before = a.events.length
  a.adapter.cancel()
  assert.equal(a.events.length, before, 'cancelling when nothing is happening does nothing')
})

test('on macOS the platform says when the fingers lift, rather than a pause deciding it', () => {
  const a = makeAdapter('darwin')
  a.adapter.handleScrollTouch('begin')
  a.adapter.handleWheel(wheel({ deltaX: -30 }))
  assert.deepEqual(a.events.map((e) => e.type), ['begin', 'update'])
  a.adapter.handleScrollTouch('end')
  assert.deepEqual(a.events.map((e) => e.type), ['begin', 'update', 'end'])
  assert.equal(a.hasTimer, false)
})

test('on macOS, coasting after the fingers lift is marked as such', () => {
  const a = makeAdapter('darwin')
  a.adapter.handleWheel(wheel({ deltaX: -30 }))
  a.adapter.handleWheel(wheel({ deltaX: -80, accelerationRatioX: 0.8 }))
  const updates = a.events.filter((e) => e.type === 'update')
  assert.equal(updates[0].momentum, false, 'the fingers are still down')
  assert.equal(updates[1].momentum, true, 'this is the trackpad carrying on by itself')
})

test('elsewhere nothing is claimed about coasting, because the platform does not say', () => {
  const a = makeAdapter('win32')
  a.adapter.handleWheel(wheel({ deltaX: -80, accelerationRatioX: 0.8 }))
  assert.equal(a.events.filter((e) => e.type === 'update')[0].momentum, false)
  // And the macOS-only phases are ignored rather than half-applied.
  a.adapter.handleScrollTouch('end')
  assert.equal(a.events.filter((e) => e.type === 'end').length, 0)
})
