import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failureFor, fromOrbisWindow, MESSAGE_LIMIT } from './senderCheck.ts'

/**
 * The two decisions that were different between the thirteen hand-written copies of the sender check.
 *
 * Everything else about them agreed. These did not, and both differences were the kind that shows up as a crash or
 * a leak rather than as a wrong answer.
 */

const windowLike = (overrides: { destroyed?: boolean; contents?: unknown } = {}): { getWindow(): never } => {
  const webContents = overrides.contents ?? { id: 1 }
  const win = {
    isDestroyed: () => overrides.destroyed === true,
    get webContents() {
      // Electron throws here once the window has gone. The check must never reach this on a destroyed window.
      if (overrides.destroyed === true) throw new Error('Object has been destroyed')
      return webContents
    }
  }
  return { getWindow: () => win as never }
}

test('a message from the Orbis window is allowed', () => {
  const contents = { id: 7 }
  assert.equal(fromOrbisWindow(windowLike({ contents }), { sender: contents as never }), true)
})

test('a message from anything else is refused', () => {
  assert.equal(fromOrbisWindow(windowLike({ contents: { id: 7 } }), { sender: { id: 9 } as never }), false)
})

test('with no window at all, nothing is allowed', () => {
  assert.equal(fromOrbisWindow({ getWindow: () => null }, { sender: { id: 1 } as never }), false)
})

test('a destroyed window is refused without its webContents being read', () => {
  // Twelve of the thirteen copies read `win.webContents` with no destroyed test in front of it. On a window that
  // has closed, that THROWS -- turning a refusal into an uncaught error in the main process, which is how "A
  // JavaScript error occurred in the main process" reached the screen from the permission handlers. The fake window
  // above throws from its getter on purpose, so this test fails if the order is ever swapped back.
  assert.equal(fromOrbisWindow(windowLike({ destroyed: true }), { sender: { id: 1 } as never }), false)
})

test('a failure is a code and a sentence', () => {
  assert.deepEqual(failureFor(new Error('That tab is locked.')), { error: 'failed', message: 'That tab is locked.' })
})

test('a message long enough to be a path or a URL is replaced', () => {
  // The three copies this replaces capped at 160, 200 and 300 characters, for the same sentence in the same place.
  assert.deepEqual(failureFor(new Error('x'.repeat(400))), { error: 'failed', message: 'That did not work.' })
})

test('something thrown that is not an Error still gets a sentence', () => {
  for (const thrown of ['a string', undefined, null, { message: 'pretending to be an error' }, 42]) {
    assert.deepEqual(failureFor(thrown), { error: 'failed', message: 'That did not work.' })
  }
})

test('the limit is where it says it is', () => {
  const justUnder = 'y'.repeat(MESSAGE_LIMIT - 1)
  assert.equal(failureFor(new Error(justUnder)).message, justUnder)
  assert.equal(failureFor(new Error('y'.repeat(MESSAGE_LIMIT))).message, 'That did not work.')
})
