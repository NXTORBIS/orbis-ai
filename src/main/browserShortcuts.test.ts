import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RESERVED, comboOf, combosFor, decideShortcut, isAutomatedInput, noteAutomatedInput } from './browserShortcuts.ts'
import type { KeyInput } from './browserShortcuts.ts'

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({ type: 'keyDown', key: k, ...mods })
const action = (input: KeyInput): string | null => {
  const d = decideShortcut(input)
  return d.handled ? d.shortcut.action : null
}

test('standard tab, navigation, address, find and zoom shortcuts are recognised', () => {
  assert.equal(action(key('t', { control: true })), 'new-tab')
  assert.equal(action(key('w', { control: true })), 'close-tab')
  assert.equal(action(key('T', { control: true, shift: true })), 'reopen-tab')
  assert.equal(action(key('Tab', { control: true })), 'next-tab')
  assert.equal(action(key('Tab', { control: true, shift: true })), 'prev-tab')
  assert.deepEqual(decideShortcut(key('3', { control: true })), { handled: true, shortcut: { action: 'select-tab', index: 3 }, run: true, consume: true })
  assert.equal(action(key('9', { control: true })), 'last-tab')
  assert.equal(action(key('PageUp', { control: true, shift: true })), 'move-tab-left')
  assert.equal(action(key('ArrowLeft', { alt: true })), 'back')
  assert.equal(action(key('ArrowRight', { alt: true })), 'forward')
  assert.equal(action(key('r', { control: true })), 'reload')
  assert.equal(action(key('F5')), 'reload')
  assert.equal(action(key('R', { control: true, shift: true })), 'hard-reload')
  assert.equal(action(key('F5', { control: true })), 'hard-reload')
  for (const k of [key('l', { control: true }), key('d', { alt: true }), key('F6')]) assert.equal(action(k), 'focus-url')
  assert.equal(action(key('f', { control: true })), 'find')
  assert.equal(action(key('F3')), 'find-next')
  assert.equal(action(key('F3', { shift: true })), 'find-prev')
  assert.equal(action(key('G', { control: true, shift: true })), 'find-prev')
  assert.equal(action(key('=', { control: true })), 'zoom-in')
  assert.equal(action(key('+', { control: true, shift: true })), 'zoom-in')
  assert.equal(action(key('-', { control: true })), 'zoom-out')
  assert.equal(action(key('0', { control: true })), 'zoom-reset')
  assert.equal(action(key('t', { meta: true })), 'new-tab', 'Cmd counts as Ctrl')
})

test('Orion and Orbis shortcuts are never taken by the browser', () => {
  for (const combo of ['o', 'n'].map((k) => key(k.toUpperCase(), { control: true, shift: true }))) assert.equal(decideShortcut(combo).handled, false)
  for (const k of ['b', ',', 'n', 'q', 'z', 'x', 'c', 'v', 'k']) assert.equal(decideShortcut(key(k, { control: true })).handled, false, `Ctrl+${k}`)
  assert.equal(decideShortcut(key('Z', { control: true, shift: true })).handled, false)
  assert.equal(decideShortcut(key('I', { control: true, shift: true })).handled, false)
  for (const combo of RESERVED) for (const a of ['new-tab', 'reload', 'history', 'bookmarks'] as const) assert.ok(!combosFor(a).includes(combo))
})

test('plain typing keys, Tab and page scrolling keys are left to the page', () => {
  for (const k of ['a', 't', 'Tab', ' ', 'Enter', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowLeft', 'ArrowDown', 'Backspace']) {
    assert.equal(decideShortcut(key(k)).handled, false, k)
  }
  assert.equal(decideShortcut(key('Tab', { shift: true })).handled, false, 'Shift+Tab moves focus')
  assert.equal(decideShortcut(key('Home', { control: true })).handled, false, 'Ctrl+Home scrolls the page')
  assert.equal(decideShortcut(key('a', { control: true })).handled, false, 'select all stays with the page')
})

test('a held key never repeats one-off actions such as new tab, but tab cycling and zoom repeat', () => {
  const held = (k: KeyInput): KeyInput => ({ ...k, isAutoRepeat: true })
  assert.deepEqual(decideShortcut(held(key('t', { control: true }))), { handled: true, shortcut: { action: 'new-tab' }, run: false, consume: true })
  assert.equal((decideShortcut(held(key('w', { control: true }))) as { run: boolean }).run, false)
  assert.equal((decideShortcut(held(key('F5'))) as { run: boolean }).run, false)
  assert.equal((decideShortcut(held(key('Tab', { control: true }))) as { run: boolean }).run, true)
  assert.equal((decideShortcut(held(key('=', { control: true }))) as { run: boolean }).run, true)
  assert.equal(decideShortcut({ type: 'keyUp', key: 't', control: true }).handled, false, 'key-up never acts')
  assert.equal(decideShortcut({ type: 'char', key: 't', control: true }).handled, false)
})

test('key presses from browser automation are recognised as automated for a moment only', () => {
  noteAutomatedInput(7, 1000)
  assert.equal(isAutomatedInput(7, 1200), true)
  assert.equal(isAutomatedInput(8, 1200), false)
  assert.equal(isAutomatedInput(7, 1500), false)
})

test('Esc stops loading but still reaches the page; other shortcuts are kept from the page', () => {
  assert.deepEqual(decideShortcut(key('Escape')), { handled: true, shortcut: { action: 'stop' }, run: true, consume: false })
  assert.equal((decideShortcut(key('f', { control: true })) as { consume: boolean }).consume, true)
  assert.equal(comboOf(key('Esc')), 'Escape')
  assert.equal(comboOf(key('t', { control: true, alt: true, shift: true })), 'Ctrl+Alt+Shift+T')
})
