import {
  clampWidgetSetting,
  DEFAULT_LOOK,
  isAvailable,
  LOOK_TONES,
  MAX_WIDGETS,
  newWidgetInstance,
  normalizeLook,
  normalizeWidgets,
  SIZE_NAMES,
  widgetById,
  WIDGETS,
  CATEGORY_NAMES,
  type WidgetCategory,
  type WidgetDefinition,
  type WidgetInstance,
  type WidgetLook,
  type WidgetSize
} from './widgets.ts'

/**
 * The start page's board of widgets: the grid it is laid out on, and everything that may be done to it.
 *
 * One model, used three ways. The start page lays its cards out with `packBoard`. The gallery's miniature of the
 * start page is `packBoard` drawn small. And while a card is dragged, the place it would land is `packBoard` run on
 * the order it would have. So the miniature, the drop target and the page cannot disagree: they are the same sum.
 *
 * Everything that changes the board is an action through `applyWidgetAction`. The start page, the gallery and Orion
 * all send actions; none of them edits a list. An action either gives back the new board and a sentence saying what
 * happened, or a refusal with a reason -- never a board that is half changed.
 *
 * Pure: no DOM, no storage, no clock unless one is handed in.
 */

// ---------------------------------------------------------------- the grid

/** How many cells of the grid each size covers, across and down. */
export const SIZE_SPAN: Readonly<Record<WidgetSize, { w: number; h: number }>> = Object.freeze({
  small: { w: 1, h: 1 },
  medium: { w: 2, h: 1 },
  tall: { w: 1, h: 2 },
  large: { w: 2, h: 2 },
  // A full row, however many columns the page has.
  wide: { w: 99, h: 1 }
})

export const GRID = Object.freeze({
  /** The side of one cell at its smallest, and the space between cells. */
  cell: 156,
  gap: 14,
  /** The most columns, on the widest page. */
  maxColumns: 6
})

/** How many columns fit a page this wide. One on a narrow page, six on the widest. */
export function columnsFor(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1
  const fit = Math.floor((width + GRID.gap) / (GRID.cell + GRID.gap))
  return Math.min(GRID.maxColumns, Math.max(1, fit))
}

export interface PlacedWidget {
  id: string
  /** Column and row, counted from 0. */
  x: number
  y: number
  w: number
  h: number
}

/**
 * Where every shown widget sits on a grid of this many columns.
 *
 * In order, left to right and top to bottom, each one in the first place it fits at or after the one before it --
 * so the order on the page is the order of the list, and moving a widget "earlier" always moves it up or left. A
 * widget wider than the page is as wide as the page. Hidden and set-aside widgets take no room.
 */
export function packBoard(instances: readonly WidgetInstance[], columns: number): { placed: PlacedWidget[]; rows: number } {
  const cols = Math.max(1, Math.floor(columns))
  const taken: boolean[][] = []
  const free = (x: number, y: number, w: number, h: number): boolean => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (taken[r]?.[c]) return false
    return true
  }
  const placed: PlacedWidget[] = []
  let from = 0
  for (const one of visibleWidgets(instances)) {
    const span = SIZE_SPAN[one.size]
    const w = Math.min(cols, span.w)
    const h = span.h
    let at = from
    for (;;) {
      const x = at % cols
      const y = Math.floor(at / cols)
      if (x + w <= cols && free(x, y, w, h)) {
        for (let r = y; r < y + h; r++) {
          taken[r] ??= []
          for (let c = x; c < x + w; c++) taken[r][c] = true
        }
        placed.push({ id: one.id, x, y, w, h })
        from = at
        break
      }
      at += 1
    }
  }
  return { placed, rows: placed.reduce((most, one) => Math.max(most, one.y + one.h), 0) }
}

/** The widgets that are drawn: in order, without the hidden ones and the ones set aside after failing. */
export const visibleWidgets = (instances: readonly WidgetInstance[]): WidgetInstance[] =>
  [...instances].filter((one) => !one.hidden && !one.disabled).sort((a, b) => a.order - b.order || a.addedAt - b.addedAt)

/** Every widget on the board in order, shown or not. */
export const orderedWidgets = (instances: readonly WidgetInstance[]): WidgetInstance[] => [...instances].sort((a, b) => a.order - b.order || a.addedAt - b.addedAt)

// ---------------------------------------------------------------- the board

export interface WidgetBoard {
  /** Whether widgets are shown on the start page at all. */
  enabled: boolean
  instances: WidgetInstance[]
  /** Widget ids the person has marked, newest first. */
  favourites: string[]
  /** Which widgets were added or used lately, newest first. Kept on this computer; never a count of anybody else. */
  recent: { widget: string; at: number }[]
}

export const BOARD_LIMITS = Object.freeze({ favourites: 40, recent: 12 })

export const emptyBoard = (): WidgetBoard => ({ enabled: true, instances: [], favourites: [], recent: [] })

/** A board read back safely from wherever it was kept. Anything that is not what it should be is left out. */
export function normalizeBoard(raw: unknown): WidgetBoard {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WidgetBoard>
  const known = (id: unknown): id is string => typeof id === 'string' && widgetById(id) !== null
  const favourites = [...new Set((Array.isArray(r.favourites) ? r.favourites : []).filter(known))].slice(0, BOARD_LIMITS.favourites)
  const seen = new Set<string>()
  const recent = (Array.isArray(r.recent) ? r.recent : [])
    .filter((one): one is { widget: string; at: number } => Boolean(one) && typeof one === 'object' && known((one as { widget?: unknown }).widget) && typeof (one as { at?: unknown }).at === 'number')
    .filter((one) => (seen.has(one.widget) ? false : (seen.add(one.widget), true)))
    .slice(0, BOARD_LIMITS.recent)
  return { enabled: r.enabled !== false, instances: renumber(normalizeWidgets(r.instances)), favourites, recent }
}

/** The same widgets, numbered 0, 1, 2 in the order they are in, so "order" is always plain. */
const renumber = (instances: WidgetInstance[]): WidgetInstance[] => orderedWidgets(instances).map((one, order) => (one.order === order && one.zone === 'centre' ? one : { ...one, order, zone: 'centre' as const }))

// ---------------------------------------------------------------- actions

export type WidgetAction =
  /** `once`: if one is there already, that one is the answer and nothing is added. Without it, a second is a choice. */
  | { type: 'add'; widget: string; size?: WidgetSize; settings?: Record<string, unknown>; at?: number; once?: boolean; id?: string }
  | { type: 'remove'; id: string }
  /** `to` is the place in the order of everything on the board, counted from 0. */
  | { type: 'move'; id: string; to: number }
  | { type: 'resize'; id: string; size: WidgetSize }
  | { type: 'configure'; id: string; settings: Record<string, unknown> }
  | { type: 'look'; id: string; look: Partial<WidgetLook> }
  | { type: 'lock'; id: string; locked: boolean }
  | { type: 'hide'; id: string; hidden: boolean }
  /** Its settings and its look back to how the widget comes. Its place and size are left alone. */
  | { type: 'reset'; id: string }
  /** Brings back a widget that was set aside after failing. */
  | { type: 'revive'; id: string }
  | { type: 'favourite'; widget: string; on: boolean }
  /** Noted as used, for "recently used". */
  | { type: 'used'; widget: string }
  | { type: 'preset'; preset: string }
  /** Every widget taken off the start page. Favourites are kept. */
  | { type: 'clear' }
  | { type: 'enable'; on: boolean }

export type WidgetActionResult =
  | { ok: true; board: WidgetBoard; said: string; id?: string; already?: boolean }
  | { ok: false; error: 'unknown-widget' | 'unavailable' | 'not-found' | 'full' | 'locked' | 'bad-size' | 'bad-input' | 'unknown-preset'; message: string }

const nameOf = (instance: WidgetInstance): string => widgetById(instance.widget)?.name ?? instance.widget

/**
 * One action applied to a board.
 *
 * `now` and `makeId` are handed in so the same action on the same board gives the same answer, which is what lets
 * this be tested without a clock and lets a retry be recognised as a retry.
 */
export function applyWidgetAction(board: WidgetBoard, action: WidgetAction, now = Date.now(), makeId: () => string = () => crypto.randomUUID()): WidgetActionResult {
  const instances = orderedWidgets(board.instances)
  const refuse = (error: Extract<WidgetActionResult, { ok: false }>['error'], message: string): WidgetActionResult => ({ ok: false, error, message })
  const done = (next: WidgetInstance[], said: string, more: { id?: string; already?: boolean; recent?: string } = {}): WidgetActionResult => ({
    ok: true,
    board: { ...board, instances: renumber(next), ...(more.recent ? { recent: noteUsed(board.recent, more.recent, now) } : {}) },
    said,
    ...(more.id ? { id: more.id } : {}),
    ...(more.already ? { already: true } : {})
  })
  const find = (id: string): WidgetInstance | null => instances.find((one) => one.id === id) ?? null
  const patch = (id: string, change: (one: WidgetInstance) => WidgetInstance): WidgetInstance[] => instances.map((one) => (one.id === id ? change(one) : one))

  switch (action.type) {
    case 'add': {
      const definition = widgetById(action.widget)
      if (!definition) return refuse('unknown-widget', `Orbis has no widget called "${String(action.widget).slice(0, 40)}".`)
      if (!isAvailable(definition)) return refuse('unavailable', definition.unavailable ?? `${definition.name} cannot be put on the start page.`)
      const there = instances.find((one) => one.widget === definition.id)
      if (action.once && there) {
        // Asked for again when it is already there: shown again if it was hidden, and otherwise simply the answer.
        if (there.hidden || there.disabled) return done(patch(there.id, (one) => ({ ...one, hidden: false, disabled: false })), `${definition.name} is back on the start page.`, { id: there.id, already: true })
        return { ok: true, board, said: `${definition.name} is already on the start page.`, id: there.id, already: true }
      }
      // The same request sent twice (a double click, a retry after a slow answer) is one widget, not two.
      if (action.id && find(action.id)) return { ok: true, board, said: `${definition.name} is on the start page.`, id: action.id, already: true }
      if (instances.length >= MAX_WIDGETS) return refuse('full', `The start page holds ${MAX_WIDGETS} widgets. Take one off first.`)
      if (action.size !== undefined && !definition.sizes.includes(action.size)) {
        return refuse('bad-size', `${definition.name} does not come in ${SIZE_NAMES[action.size] ?? String(action.size)}. It comes in: ${definition.sizes.map((one) => SIZE_NAMES[one]).join(', ')}.`)
      }
      const made = newWidgetInstance(definition.id, 'centre', 0)
      if (!made) return refuse('unknown-widget', `Orbis has no widget called "${definition.id}".`)
      const instance: WidgetInstance = {
        ...made,
        id: action.id && /^[A-Za-z0-9_-]{6,80}$/.test(action.id) ? action.id : makeId(),
        size: action.size ?? definition.defaultSize,
        settings: mergeSettings(definition, made.settings, action.settings ?? {}),
        addedAt: now
      }
      const at = typeof action.at === 'number' && Number.isInteger(action.at) ? Math.min(instances.length, Math.max(0, action.at)) : instances.length
      const next = [...instances.slice(0, at), instance, ...instances.slice(at)].map((one, order) => ({ ...one, order }))
      return done(next, `${definition.name} is on the start page.`, { id: instance.id, recent: definition.id })
    }

    case 'remove': {
      const one = find(action.id)
      if (!one) return refuse('not-found', 'That widget is not on the start page.')
      return done(instances.filter((other) => other.id !== action.id), `${nameOf(one)} was taken off the start page.`)
    }

    case 'move': {
      const one = find(action.id)
      if (!one) return refuse('not-found', 'That widget is not on the start page.')
      if (one.locked) return refuse('locked', `${nameOf(one)} is locked where it is. Unlock it to move it.`)
      if (typeof action.to !== 'number' || !Number.isFinite(action.to)) return refuse('bad-input', 'Say where to move it.')
      const others = instances.filter((other) => other.id !== action.id)
      const to = Math.min(others.length, Math.max(0, Math.round(action.to)))
      const next = [...others.slice(0, to), one, ...others.slice(to)].map((other, order) => ({ ...other, order }))
      const from = instances.indexOf(one)
      if (from === to) return { ok: true, board, said: `${nameOf(one)} is already there.`, id: one.id, already: true }
      return done(next, `${nameOf(one)} was moved to place ${to + 1} of ${next.length}.`, { id: one.id })
    }

    case 'resize': {
      const one = find(action.id)
      if (!one) return refuse('not-found', 'That widget is not on the start page.')
      if (one.locked) return refuse('locked', `${nameOf(one)} is locked as it is. Unlock it to change its size.`)
      const definition = widgetById(one.widget)!
      if (!definition.sizes.includes(action.size)) {
        return refuse('bad-size', `${definition.name} does not come in ${SIZE_NAMES[action.size] ?? String(action.size)}. It comes in: ${definition.sizes.map((size) => SIZE_NAMES[size]).join(', ')}.`)
      }
      if (one.size === action.size) return { ok: true, board, said: `${definition.name} is already ${SIZE_NAMES[action.size].toLowerCase()}.`, id: one.id, already: true }
      return done(patch(one.id, (it) => ({ ...it, size: action.size })), `${definition.name} is now ${SIZE_NAMES[action.size].toLowerCase()}.`, { id: one.id })
    }

    case 'configure': {
      const one = find(action.id)
      if (!one) return refuse('not-found', 'That widget is not on the start page.')
      const definition = widgetById(one.widget)!
      const given = action.settings && typeof action.settings === 'object' ? action.settings : {}
      const unknown = Object.keys(given).filter((name) => !definition.settings.some((spec) => spec.name === name))
      if (unknown.length > 0) {
        return refuse('bad-input', `${definition.name} has no setting called "${unknown[0].slice(0, 40)}". It has: ${definition.settings.map((spec) => spec.name).join(', ') || 'none'}.`)
      }
      const settings = mergeSettings(definition, one.settings, given)
      const changed = definition.settings.filter((spec) => settings[spec.name] !== one.settings[spec.name])
      if (changed.length === 0) return { ok: true, board, said: `${definition.name} was already set that way.`, id: one.id, already: true }
      return done(patch(one.id, (it) => ({ ...it, settings })), `${definition.name}: ${changed.map((spec) => `${spec.label.toLowerCase()} is now ${wordFor(spec, settings[spec.name])}`).join('; ')}.`, { id: one.id, recent: definition.id })
    }

    case 'look': {
      const one = find(action.id)
      if (!one) return refuse('not-found', 'That widget is not on the start page.')
      const given = action.look && typeof action.look === 'object' ? action.look : {}
      if (given.tone !== undefined && !LOOK_TONES.includes(given.tone)) return refuse('bad-input', `A card can be: ${LOOK_TONES.join(', ')}.`)
      const look = normalizeLook({ ...one.look, ...given })
      if (look.tone === one.look.tone && look.density === one.look.density) return { ok: true, board, said: `${nameOf(one)} already looks that way.`, id: one.id, already: true }
      return done(patch(one.id, (it) => ({ ...it, look })), `${nameOf(one)} now looks different.`, { id: one.id })
    }

    case 'lock': {
      const one = find(action.id)
      if (!one) return refuse('not-found', 'That widget is not on the start page.')
      const locked = action.locked === true
      if (one.locked === locked) return { ok: true, board, said: `${nameOf(one)} is already ${locked ? 'locked' : 'unlocked'}.`, id: one.id, already: true }
      return done(patch(one.id, (it) => ({ ...it, locked })), locked ? `${nameOf(one)} is locked where it is.` : `${nameOf(one)} can be moved again.`, { id: one.id })
    }

    case 'hide': {
      const one = find(action.id)
      if (!one) return refuse('not-found', 'That widget is not on the start page.')
      const hidden = action.hidden === true
      if (one.hidden === hidden) return { ok: true, board, said: `${nameOf(one)} is already ${hidden ? 'hidden' : 'shown'}.`, id: one.id, already: true }
      return done(patch(one.id, (it) => ({ ...it, hidden })), hidden ? `${nameOf(one)} is hidden. Its settings are kept.` : `${nameOf(one)} is shown again.`, { id: one.id })
    }

    case 'reset': {
      const one = find(action.id)
      if (!one) return refuse('not-found', 'That widget is not on the start page.')
      const definition = widgetById(one.widget)!
      const settings = Object.fromEntries(definition.settings.map((spec) => [spec.name, spec.default]))
      return done(patch(one.id, (it) => ({ ...it, settings, look: { ...DEFAULT_LOOK } })), `${definition.name} is back to how it comes. Where it sits and its size were left alone.`, { id: one.id })
    }

    case 'revive': {
      const one = find(action.id)
      if (!one) return refuse('not-found', 'That widget is not on the start page.')
      if (!one.disabled) return { ok: true, board, said: `${nameOf(one)} is already running.`, id: one.id, already: true }
      return done(patch(one.id, (it) => ({ ...it, disabled: false })), `${nameOf(one)} is running again.`, { id: one.id })
    }

    case 'favourite': {
      const definition = widgetById(action.widget)
      if (!definition) return refuse('unknown-widget', `Orbis has no widget called "${String(action.widget).slice(0, 40)}".`)
      const on = action.on === true
      const has = board.favourites.includes(definition.id)
      if (has === on) return { ok: true, board, said: `${definition.name} is ${on ? 'already a favourite' : 'not a favourite'}.`, already: true }
      const favourites = on ? [definition.id, ...board.favourites].slice(0, BOARD_LIMITS.favourites) : board.favourites.filter((id) => id !== definition.id)
      return { ok: true, board: { ...board, favourites }, said: on ? `${definition.name} is a favourite.` : `${definition.name} is no longer a favourite.` }
    }

    case 'used': {
      const definition = widgetById(action.widget)
      if (!definition) return refuse('unknown-widget', `Orbis has no widget called "${String(action.widget).slice(0, 40)}".`)
      return { ok: true, board: { ...board, recent: noteUsed(board.recent, definition.id, now) }, said: '' }
    }

    case 'preset': {
      const preset = WIDGET_PRESETS.find((one) => one.id === action.preset)
      if (!preset) return refuse('unknown-preset', `Orbis has no layout called "${String(action.preset).slice(0, 40)}". It has: ${WIDGET_PRESETS.map((one) => one.name).join(', ')}.`)
      // Checked whole before anything is touched: a layout that cannot be made in full is not made in part.
      const made = presetInstances(preset, now, makeId)
      if ('error' in made) return refuse('unavailable', made.error)
      return done(made.instances, `The start page is set out as "${preset.name}": ${made.instances.map(nameOf).join(', ')}.`)
    }

    case 'clear':
      if (instances.length === 0) return { ok: true, board, said: 'The start page has no widgets on it.', already: true }
      return done([], `All ${instances.length} widgets were taken off the start page.`)

    case 'enable': {
      const on = action.on === true
      if (board.enabled === on) return { ok: true, board, said: `Widgets are already ${on ? 'shown' : 'hidden'} on the start page.`, already: true }
      return { ok: true, board: { ...board, enabled: on }, said: on ? 'Widgets are shown on the start page.' : 'Widgets are hidden on the start page. They are all kept.' }
    }
  }
}

/** Settings as the widget takes them: every one it declares, each within its limits, with the new ones laid over the old. */
function mergeSettings(definition: WidgetDefinition, current: Record<string, string | number | boolean>, given: Record<string, unknown>): Record<string, string | number | boolean> {
  return Object.fromEntries(definition.settings.map((spec) => [spec.name, clampWidgetSetting(spec, Object.prototype.hasOwnProperty.call(given, spec.name) ? given[spec.name] : current[spec.name])]))
}

const wordFor = (spec: WidgetDefinition['settings'][number], value: string | number | boolean): string => {
  if (spec.type === 'boolean') return value ? 'on' : 'off'
  if (spec.type === 'choice') return (spec.choices ?? []).find((one) => one.value === value)?.label.toLowerCase() ?? String(value)
  const text = String(value)
  return text === '' ? 'empty' : text.length > 60 ? `"${text.slice(0, 57)}…"` : `"${text}"`
}

const noteUsed = (recent: WidgetBoard['recent'], widget: string, at: number): WidgetBoard['recent'] => [{ widget, at }, ...recent.filter((one) => one.widget !== widget)].slice(0, BOARD_LIMITS.recent)

// ---------------------------------------------------------------- ready-made layouts

export interface WidgetPreset {
  id: string
  name: string
  describe: string
  widgets: { widget: string; size?: WidgetSize; settings?: Record<string, unknown> }[]
}

/**
 * Layouts to start from. Each is a list of real widgets at real sizes; applying one replaces what is on the start
 * page (the runtime keeps what was there, so it can be undone). None of them fills in anything about the person: a
 * weather widget arrives with no city and says so.
 */
export const WIDGET_PRESETS: readonly WidgetPreset[] = Object.freeze([
  { id: 'minimal', name: 'Minimal', describe: 'A clock and a note. Nothing else on the page.', widgets: [{ widget: 'clock', size: 'medium' }, { widget: 'notepad', size: 'small' }] },
  {
    id: 'study',
    name: 'Study',
    describe: 'Time left, a focus timer, what is due, and somewhere to jot.',
    widgets: [{ widget: 'clock', size: 'small' }, { widget: 'countdown', size: 'small' }, { widget: 'timer', size: 'medium' }, { widget: 'tasks', size: 'tall' }, { widget: 'notepad', size: 'medium' }, { widget: 'calculator', size: 'small' }]
  },
  {
    id: 'work',
    name: 'Work',
    describe: 'Today’s tasks and reminders, the time where your colleagues are, and your notes.',
    widgets: [{ widget: 'greeting', size: 'wide' }, { widget: 'tasks', size: 'large' }, { widget: 'reminders', size: 'medium' }, { widget: 'worldclock', size: 'medium' }, { widget: 'notes', size: 'medium' }, { widget: 'weather', size: 'small' }]
  },
  {
    id: 'research',
    name: 'Research',
    describe: 'Where you have been, what you saved, your notes, and the feeds you follow.',
    widgets: [{ widget: 'recent', size: 'tall' }, { widget: 'bookmarks', size: 'medium' }, { widget: 'notes', size: 'medium' }, { widget: 'news', size: 'large' }, { widget: 'notepad', size: 'medium' }, { widget: 'orion', size: 'medium' }]
  },
  {
    id: 'development',
    name: 'Development',
    describe: 'Open tabs, downloads, the clipboard, and a timer for the next stretch.',
    widgets: [{ widget: 'clock', size: 'small' }, { widget: 'timer', size: 'small' }, { widget: 'tabs', size: 'tall' }, { widget: 'downloads', size: 'medium' }, { widget: 'clipboard', size: 'medium' }, { widget: 'calculator', size: 'small' }, { widget: 'workspaces', size: 'medium' }]
  },
  {
    id: 'personal',
    name: 'Personal',
    describe: 'A greeting, the weather, a line worth reading, a price you follow, and a note.',
    widgets: [{ widget: 'greeting', size: 'wide' }, { widget: 'weather', size: 'medium' }, { widget: 'quote', size: 'medium' }, { widget: 'markets', size: 'small' }, { widget: 'notepad', size: 'small' }, { widget: 'clock', size: 'small', settings: { face: 'analog' } }]
  }
])

/** A layout as the instances it would put on the page, or why it cannot be made. Makes nothing: it only works it out. */
export function presetInstances(preset: WidgetPreset, now = Date.now(), makeId: () => string = () => crypto.randomUUID()): { instances: WidgetInstance[] } | { error: string } {
  const out: WidgetInstance[] = []
  for (const [order, wanted] of preset.widgets.entries()) {
    const definition = widgetById(wanted.widget)
    if (!definition) return { error: `The "${preset.name}" layout needs a widget Orbis does not have: ${wanted.widget}.` }
    if (!isAvailable(definition)) return { error: `The "${preset.name}" layout needs ${definition.name}, which cannot be added: ${definition.unavailable ?? 'it is not available here'}` }
    const size = wanted.size ?? definition.defaultSize
    if (!definition.sizes.includes(size)) return { error: `The "${preset.name}" layout asks for ${definition.name} in ${SIZE_NAMES[size]}, which it does not come in.` }
    const made = newWidgetInstance(definition.id, 'centre', order)!
    out.push({ ...made, id: makeId(), order, size, settings: mergeSettings(definition, made.settings, wanted.settings ?? {}), addedAt: now + order })
  }
  return { instances: out }
}

// ---------------------------------------------------------------- finding a widget

export type GalleryFilter = 'all' | 'installed' | 'favourites' | 'offline'

export interface GalleryQuery {
  query?: string
  category?: WidgetCategory | 'all'
  filter?: GalleryFilter
}

/** The words a widget can be found by, lower case: its name, what it says it does, its group, its tags, what it reads. */
const haystack = (definition: WidgetDefinition): { name: string; tags: string[]; rest: string } => ({
  name: definition.name.toLowerCase(),
  tags: definition.tags.map((one) => one.toLowerCase()),
  rest: `${definition.description} ${CATEGORY_NAMES[definition.category]} ${definition.sources.join(' ')} ${definition.sizes.map((one) => SIZE_NAMES[one]).join(' ')} ${definition.network ? 'online internet' : 'offline'}`.toLowerCase()
})

/** Words that carry nothing: "I need a widget to track my downloads" is asking about "track" and "downloads". */
const FILLER = new Set(['a', 'an', 'the', 'i', 'my', 'me', 'to', 'for', 'of', 'in', 'on', 'and', 'or', 'need', 'want', 'see', 'show', 'widget', 'widgets', 'something', 'that', 'can', 'help', 'with', 'is', 'it', 'some', 'please', 'add', 'find', 'would', 'like'])

/**
 * The widgets that match, best first.
 *
 * By the words in the catalogue and nothing else: no model, no network, no guess. A name beats a tag, a tag beats a
 * word in the description, and every word asked for has to be found somewhere -- "study timer" is the widgets that
 * are about both, not everything about either.
 */
export function findWidgets(query: GalleryQuery, board: WidgetBoard): WidgetDefinition[] {
  const installed = new Set(board.instances.map((one) => one.widget))
  const words = (query.query ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((one) => one !== '' && !FILLER.has(one))
  const scored: { definition: WidgetDefinition; score: number; at: number }[] = []
  WIDGETS.forEach((definition, at) => {
    if (query.category && query.category !== 'all' && definition.category !== query.category) return
    if (query.filter === 'installed' && !installed.has(definition.id)) return
    if (query.filter === 'favourites' && !board.favourites.includes(definition.id)) return
    if (query.filter === 'offline' && definition.network) return
    const hay = haystack(definition)
    let score = 0
    for (const word of words) {
      // "timers" finds "timer": a plural asked for is still the thing.
      const stem = word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
      const inName = hay.name.includes(stem)
      const inTag = hay.tags.some((tag) => tag.includes(stem) || (stem.length > 3 && stem.includes(tag)))
      const inRest = hay.rest.includes(stem)
      if (!inName && !inTag && !inRest) return
      score += inName ? 6 : inTag ? 3 : 1
    }
    scored.push({ definition, score, at })
  })
  return scored.sort((a, b) => b.score - a.score || Number(b.definition.featured) - Number(a.definition.featured) || a.at - b.at).map((one) => one.definition)
}

/** The groups that have widgets in them, in the catalogue's own order, with how many each has. */
export function galleryCategories(): { id: WidgetCategory; name: string; count: number }[] {
  const order: WidgetCategory[] = []
  for (const one of WIDGETS) if (!order.includes(one.category)) order.push(one.category)
  return order.map((id) => ({ id, name: CATEGORY_NAMES[id], count: WIDGETS.filter((one) => one.category === id).length }))
}

/** Words to try when a search finds nothing: tags that really do find something, the most widely shared first. */
export function searchSuggestions(limit = 4): string[] {
  const counts = new Map<string, number>()
  for (const one of WIDGETS) if (isAvailable(one)) for (const tag of one.tags) if (!tag.includes(' ')) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([tag]) => tag)
}

/** Where a widget stands with this board: what the gallery's button says, and whether it can be pressed. */
export function galleryState(definition: WidgetDefinition, board: WidgetBoard): { state: 'available' | 'installed' | 'hidden' | 'disabled' | 'unavailable'; count: number; reason?: string } {
  if (!isAvailable(definition)) return { state: 'unavailable', count: 0, reason: definition.unavailable ?? 'Not available on the start page.' }
  const mine = board.instances.filter((one) => one.widget === definition.id)
  if (mine.length === 0) return { state: 'available', count: 0 }
  if (mine.every((one) => one.disabled)) return { state: 'disabled', count: mine.length, reason: 'Set aside after it failed several times. It can be started again.' }
  if (mine.every((one) => one.hidden || one.disabled)) return { state: 'hidden', count: mine.length }
  return { state: 'installed', count: mine.length }
}

// ---------------------------------------------------------------- what the start page used to keep for itself

/**
 * The board the start page kept in its own storage before there was one catalogue, as instances of this one.
 *
 * Same widgets, different words for some settings: its world clock had one place, its countdown called the title a
 * label, its note kept its text the same way. Anything it had that is no longer a widget is left out, and said.
 */
export function fromLegacyBoard(raw: unknown, now = Date.now(), makeId: () => string = () => crypto.randomUUID()): { instances: WidgetInstance[]; dropped: string[] } {
  const instances: WidgetInstance[] = []
  const dropped: string[] = []
  for (const one of Array.isArray(raw) ? raw : []) {
    if (!one || typeof one !== 'object') continue
    const old = one as { widget?: unknown; size?: unknown; settings?: unknown }
    const id = typeof old.widget === 'string' ? old.widget : ''
    const definition = widgetById(id)
    if (!definition || !isAvailable(definition)) {
      if (id !== '') dropped.push(id)
      continue
    }
    const settings = (old.settings && typeof old.settings === 'object' && !Array.isArray(old.settings) ? old.settings : {}) as Record<string, unknown>
    const given: Record<string, unknown> = {}
    if (definition.id === 'worldclock' && typeof settings.zone === 'string' && settings.zone !== '') given.zones = `${settings.zone.split('/').pop()?.replace(/_/g, ' ') ?? settings.zone}=${settings.zone}`
    if (definition.id === 'countdown') {
      if (typeof settings.label === 'string' && settings.label !== '') given.title = settings.label
      if (typeof settings.date === 'string') given.date = settings.date
    }
    if (definition.id === 'notepad' && typeof settings.text === 'string') given.text = settings.text
    const made = newWidgetInstance(definition.id, 'centre', instances.length)!
    const size = definition.sizes.includes(old.size as WidgetSize) ? (old.size as WidgetSize) : definition.defaultSize
    instances.push({ ...made, id: makeId(), size, settings: mergeSettings(definition, made.settings, given), addedAt: now + instances.length })
    if (instances.length >= MAX_WIDGETS) break
  }
  return { instances, dropped }
}
