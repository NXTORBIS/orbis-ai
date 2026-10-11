import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CHAT,
  INITIAL_NAV,
  featureOf,
  navReducer,
  showingBrowser,
  showingImages,
  type Intent,
  type NavState
} from './navigation.ts'

const after = (...intents: Intent[]): NavState => intents.reduce(navReducer, INITIAL_NAV)

test('only one thing is ever on screen', () => {
  // The fault this replaces: a feature and the gallery and the browser were three independent booleans, so all
  // three could be true and the last one drawn covered the other two.
  const open = after({ kind: 'feature', id: 'markets' }, { kind: 'images' })
  assert.equal(featureOf(open), null)
  assert.equal(showingImages(open), true)

  const back = navReducer(open, { kind: 'feature', id: 'whiteboard' })
  assert.equal(showingImages(back), false)
  assert.equal(featureOf(back), 'whiteboard')
})

test('opening a screen while the browser is in front puts the screen in front', () => {
  // Opening a feature from a notification used to leave the browser covering it: the feature mounted, the browser
  // stayed in front, and the window looked like it had ignored the press.
  const state = after({ kind: 'browser' }, { kind: 'feature', id: 'markets' })
  assert.equal(featureOf(state), 'markets')
  assert.equal(showingBrowser(state), false)
  // Still running, though. That is the whole point of keeping the view mounted.
  assert.equal(state.browserLaunched, true)
})

test('the browser view stays mounted until Chromium actually closes', () => {
  // The guard on the one thing that must not be clever. The view hands a measured rectangle to the main process,
  // which positions a real window with it; unmounting it while the browser runs loses the rectangle.
  let state = after({ kind: 'browser' })
  assert.equal(state.browserLaunched, true)
  for (const intent of [
    { kind: 'chat' },
    { kind: 'images' },
    { kind: 'feature', id: 'markets' },
    { kind: 'browserDismissed' },
    { kind: 'escape' },
    { kind: 'toggleImages' }
  ] as Intent[]) {
    state = navReducer(state, intent)
    assert.equal(state.browserLaunched, true, `${intent.kind} must not unmount the browser view`)
  }
  state = navReducer(state, { kind: 'browserGone' })
  assert.equal(state.browserLaunched, false)
})

test('leaving the browser goes back to what it was opened over, not to the chat', () => {
  const state = after({ kind: 'feature', id: 'markets' }, { kind: 'browser' }, { kind: 'browserDismissed' })
  assert.equal(featureOf(state), 'markets')
})

test('leaving the browser can never land on the browser', () => {
  // `behind` is written only when moving TO the browser, so asking for the browser twice cannot make it its own
  // way out -- which would be a window with no way back to the chat at all.
  const state = after({ kind: 'browser' }, { kind: 'browserShown' }, { kind: 'browserDismissed' })
  assert.deepEqual(state.surface, CHAT)
})

test('Chromium closing while it is in front leaves the chat, not an empty browser', () => {
  const state = after({ kind: 'feature', id: 'markets' }, { kind: 'browser' }, { kind: 'browserGone' })
  assert.equal(featureOf(state), 'markets')
  assert.equal(state.browserLaunched, false)
})

test('Chromium closing in the background leaves the screen alone', () => {
  const state = after({ kind: 'browser' }, { kind: 'feature', id: 'markets' }, { kind: 'browserGone' })
  assert.equal(featureOf(state), 'markets')
  assert.equal(state.browserLaunched, false)
})

test('pressing the screen you are already on goes back to the chat', () => {
  const open = after({ kind: 'toggleFeature', id: 'markets' })
  assert.equal(featureOf(open), 'markets')
  assert.deepEqual(navReducer(open, { kind: 'toggleFeature', id: 'markets' }).surface, CHAT)
  // A different screen replaces it rather than closing it.
  assert.equal(featureOf(navReducer(open, { kind: 'toggleFeature', id: 'whiteboard' })), 'whiteboard')
})

test('Escape means out of this, except in the browser', () => {
  assert.deepEqual(navReducer(after({ kind: 'feature', id: 'markets' }), { kind: 'escape' }).surface, CHAT)
  assert.deepEqual(navReducer(after({ kind: 'images' }), { kind: 'escape' }).surface, CHAT)
  // A page, a find bar and a dialog all want Escape, and none of them is the window.
  const browsing = after({ kind: 'browser' })
  assert.deepEqual(navReducer(browsing, { kind: 'escape' }), browsing)
})

test('the reducer never mutates what it was given', () => {
  const start = after({ kind: 'feature', id: 'markets' })
  const copy = JSON.parse(JSON.stringify(start))
  navReducer(start, { kind: 'browser' })
  navReducer(start, { kind: 'escape' })
  assert.deepEqual(JSON.parse(JSON.stringify(start)), copy)
})
