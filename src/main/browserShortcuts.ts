/**
 * Browser keyboard shortcuts: one table, matched in the main process before a key reaches a web page or the Orbis
 * window's menu, and delivered once to the browser panel.
 *
 * Priority: combinations Orion and the rest of Orbis already use are never taken (see RESERVED); keys a page needs
 * (typing, Space, Page Up/Down, Home/End, arrows) are not in the table, so pages keep handling them natively.
 */

export type BrowserShortcutAction =
  | 'new-tab'
  | 'close-tab'
  | 'reopen-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'select-tab'
  | 'last-tab'
  | 'move-tab-left'
  | 'move-tab-right'
  | 'back'
  | 'forward'
  | 'reload'
  | 'hard-reload'
  | 'stop'
  | 'focus-url'
  | 'find'
  | 'find-next'
  | 'find-prev'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'fullscreen'
  | 'history'
  | 'downloads'
  | 'bookmark'
  | 'bookmark-all'
  | 'bookmarks'
  | 'print'
  | 'save-page'
  | 'view-source'
  | 'devtools'

export interface BrowserShortcut {
  action: BrowserShortcutAction
  /** For select-tab: the tab number, 1 to 8. */
  index?: number
}

interface Rule extends BrowserShortcut {
  /** Holding the keys repeats the action (tab cycling, zoom, find next); everything else acts once per press. */
  repeatable?: boolean
  /** The key still reaches the page (Esc: pages use it to close their own dialogs). */
  passthrough?: boolean
}

/** The parts of an Electron input event the matcher needs. */
export interface KeyInput {
  type: string
  key: string
  control?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  isAutoRepeat?: boolean
}

/**
 * Combinations Orion and Orbis already own, which the browser must never take: new chat, incognito chat, chat history,
 * settings (app shortcuts); New Chat, Quit, undo/redo/cut/copy/paste and developer tools (app menu).
 * Ctrl+R is not listed: outside the browser it stays the menu's reload; the browser only takes it while it has focus.
 */
export const RESERVED = new Set(['Ctrl+Shift+O', 'Ctrl+Shift+N', 'Ctrl+B', 'Ctrl+,', 'Ctrl+N', 'Ctrl+Q', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Ctrl+Shift+I', 'Ctrl+K'])

const KEY_ALIASES: Record<string, string> = { Left: 'ArrowLeft', Right: 'ArrowRight', Esc: 'Escape', Add: '+', Subtract: '-' }

/** The combination as a string such as "Ctrl+Shift+T", with Cmd treated as Ctrl. */
export function comboOf(input: KeyInput): string {
  let key = KEY_ALIASES[input.key] ?? input.key
  if (key.length === 1) key = key.toUpperCase()
  const parts = [input.control || input.meta ? 'Ctrl' : '', input.alt ? 'Alt' : '', input.shift ? 'Shift' : ''].filter(Boolean)
  return [...parts, key].join('+')
}

const rules = new Map<string, Rule>()
const add = (combos: string[], rule: Rule): void => combos.forEach((combo) => rules.set(combo, rule))

add(['Ctrl+T'], { action: 'new-tab' })
add(['Ctrl+W', 'Ctrl+F4'], { action: 'close-tab' })
add(['Ctrl+Shift+T'], { action: 'reopen-tab' })
add(['Ctrl+Tab', 'Ctrl+PageDown'], { action: 'next-tab', repeatable: true })
add(['Ctrl+Shift+Tab', 'Ctrl+PageUp'], { action: 'prev-tab', repeatable: true })
for (let n = 1; n <= 8; n++) add([`Ctrl+${n}`], { action: 'select-tab', index: n })
add(['Ctrl+9'], { action: 'last-tab' })
add(['Ctrl+Shift+PageUp'], { action: 'move-tab-left', repeatable: true })
add(['Ctrl+Shift+PageDown'], { action: 'move-tab-right', repeatable: true })
add(['Alt+ArrowLeft', 'BrowserBack'], { action: 'back' })
add(['Alt+ArrowRight', 'BrowserForward'], { action: 'forward' })
add(['Ctrl+R', 'F5', 'BrowserRefresh'], { action: 'reload' })
add(['Ctrl+Shift+R', 'Ctrl+F5', 'Shift+F5'], { action: 'hard-reload' })
add(['Escape'], { action: 'stop', passthrough: true })
add(['Ctrl+L', 'Alt+D', 'F6'], { action: 'focus-url' })
add(['Ctrl+F'], { action: 'find' })
add(['F3', 'Ctrl+G'], { action: 'find-next', repeatable: true })
add(['Shift+F3', 'Ctrl+Shift+G'], { action: 'find-prev', repeatable: true })
add(['Ctrl+=', 'Ctrl++', 'Ctrl+Shift+=', 'Ctrl+Shift++'], { action: 'zoom-in', repeatable: true })
add(['Ctrl+-', 'Ctrl+Shift+-', 'Ctrl+_'], { action: 'zoom-out', repeatable: true })
add(['Ctrl+0'], { action: 'zoom-reset' })
add(['F11'], { action: 'fullscreen' })
add(['Ctrl+H'], { action: 'history' })
add(['Ctrl+J'], { action: 'downloads' })
add(['Ctrl+D'], { action: 'bookmark' })
add(['Ctrl+Shift+D'], { action: 'bookmark-all' })
add(['Ctrl+Shift+B'], { action: 'bookmarks' })
add(['Ctrl+P'], { action: 'print' })
add(['Ctrl+S'], { action: 'save-page' })
add(['Ctrl+U'], { action: 'view-source' })
add(['F12'], { action: 'devtools' })

// The table must never claim a combination Orion or Orbis owns.
for (const combo of rules.keys()) if (RESERVED.has(combo)) throw new Error(`Browser shortcut ${combo} conflicts with an Orbis shortcut`)

export type ShortcutDecision =
  /** Not a browser shortcut: the key goes where it was going (page, Orbis, menu). */
  | { handled: false }
  /** A browser shortcut. `run` is false for a held key that doesn't repeat; `consume` keeps the key from the page and menu. */
  | { handled: true; shortcut: BrowserShortcut; run: boolean; consume: boolean }

/** What to do with a key press. Only key-down events are considered; key-up, char and automated input are never shortcuts. */
export function decideShortcut(input: KeyInput): ShortcutDecision {
  if (input.type !== 'keyDown') return { handled: false }
  const combo = comboOf(input)
  if (RESERVED.has(combo)) return { handled: false }
  const rule = rules.get(combo)
  if (!rule) return { handled: false }
  const shortcut: BrowserShortcut = rule.index ? { action: rule.action, index: rule.index } : { action: rule.action }
  return { handled: true, shortcut, run: !input.isAutoRepeat || Boolean(rule.repeatable), consume: !rule.passthrough }
}

/** Key presses Orbis's browser automation sends into a page, which must never act as shortcuts. */
const automatedUntil = new Map<number, number>()

/** Marks a tab as receiving automated key input for the next moment. */
export function noteAutomatedInput(webContentsId: number, now = Date.now()): void {
  automatedUntil.set(webContentsId, now + 400)
}

export function isAutomatedInput(webContentsId: number, now = Date.now()): boolean {
  const until = automatedUntil.get(webContentsId)
  if (until === undefined) return false
  if (until > now) return true
  automatedUntil.delete(webContentsId)
  return false
}

/** All combinations for an action, for help text. */
export function combosFor(action: BrowserShortcutAction): string[] {
  return [...rules.entries()].filter(([, rule]) => rule.action === action).map(([combo]) => combo)
}
