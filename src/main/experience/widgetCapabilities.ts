import { fail } from '../browserControl/registry.ts'
import type { BrowserControl } from '../browserControl/registry.ts'
import type { WidgetRuntimeApi } from '../widgets/contract.ts'
import { findOnBoard } from '../widgets/runtime.ts'
import type { WidgetInstance, WidgetSize } from '../../shared/widgets.ts'
import { isAvailable, permissionsOf, searchWidgets, SIZE_NAMES, TONE_NAMES, widgetById, WIDGETS, WIDGET_SIZES, type WidgetLook } from '../../shared/widgets.ts'
import { galleryState, WIDGET_PRESETS } from '../../shared/widgetBoard.ts'
import type { WidgetReply, WidgetRequest } from '../../shared/widgetFeed.ts'

/**
 * Orion's hands on the widgets on the browser's start page.
 *
 * Every one of these goes through the same runtime the start page and the gallery go through, so there is one way a
 * widget is added and one place it is kept, whoever asked. Orion cannot reach the list directly and has no way to
 * write a widget that the person could not have made themselves.
 *
 * And every one that changes something looks afterwards. It reads how things stand, applies one change, reads it
 * back, and -- when a start page is actually open -- waits for that page to say it has drawn the new arrangement.
 * So "I added the weather widget" is checked against the weather widget being on the screen. A capability that
 * reported success without looking would be exactly the fake progress the rest of Orbis refuses to produce.
 */

export function registerWidgetCapabilities(control: BrowserControl, runtime: WidgetRuntimeApi): void {
  const common = { domain: 'experience' as const }

  const board = async () => (await runtime.state()).board

  /** What a widget looks like from outside: what it is, where it sits, how big, how it is set. */
  const describe = (one: WidgetInstance, at: number, of: number): Record<string, unknown> => {
    const definition = widgetById(one.widget)
    return {
      id: one.id,
      widget: one.widget,
      name: definition?.name ?? one.widget,
      place: `${at + 1} of ${of}`,
      size: one.size,
      sizeName: SIZE_NAMES[one.size],
      look: TONE_NAMES[one.look.tone],
      locked: one.locked,
      hidden: one.hidden,
      setAside: one.disabled,
      settings: one.settings
    }
  }

  /** The widget a request means, by its own id, by what it is, or by its name. An ambiguous name is refused. */
  const find = async (asked: unknown): Promise<WidgetInstance> => {
    const text = String(asked ?? '').trim()
    if (!text) return fail('invalid-params', 'Say which widget, by its name or its id.')
    const found = findOnBoard((await board()).instances, text)
    if ('one' in found) return found.one
    if ('many' in found) {
      return fail('invalid-params', `There are ${found.many.length} ${widgetById(found.many[0].widget)?.name ?? text} widgets on the start page. Say which one by its id: ${found.many.map((one) => one.id).join(', ')}.`)
    }
    return fail('not-found', `There is no ${text} widget on the start page. Read experience.widgets for what is there.`, true)
  }

  /**
   * One change, applied and then checked.
   *
   * The reply from the runtime is already proof that it was saved and read back. What is added here is the other
   * half: whether a start page that is open has actually drawn it. With no start page open that is said plainly
   * rather than guessed at.
   */
  const apply = async (request: WidgetRequest, expect?: (one: WidgetInstance | null) => boolean): Promise<Record<string, unknown>> => {
    const reply: WidgetReply = await runtime.act(request, 'orion')
    if (!reply.ok) return fail(reply.error === 'not-found' ? 'not-found' : reply.error === 'not-saved' ? 'failed' : 'invalid-params', reply.message, reply.error === 'not-found')

    const after = await runtime.state()
    if (expect) {
      const which = reply.id ? after.board.instances.find((one) => one.id === reply.id) ?? null : null
      if (!expect(which)) return fail('failed', `That was saved and then read back differently, so it has been left alone: ${reply.said}`)
    }

    const page = runtime.rendered()
    const onScreen = !page ? 'no start page is open' : await runtime.waitForRender(after.revision, 1500)
    const shown = typeof onScreen === 'boolean' && onScreen && reply.id ? runtime.rendered()?.shown.includes(reply.id) !== false : onScreen
    return {
      done: reply.said,
      ...(reply.id ? { id: reply.id } : {}),
      ...(reply.already ? { nothingToDo: true } : {}),
      widgets: after.board.instances.length,
      shownOnStartPage: shown,
      canUndo: after.canUndo
    }
  }

  // ---------------------------------------------------------------- what is there

  control.register({
    ...common,
    id: 'experience.widgets',
    name: 'List the widgets on the start page',
    description: 'What widgets are on the browser\'s start page, in order, how big each one is and what it is set to. Also says whether widgets are shown there at all, and which are hidden or were set aside after failing.',
    keywords: ['widget', 'widgets', 'start page', 'new tab', 'cards', 'dashboard', 'clock', 'weather'],
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const state = await runtime.state()
      const all = state.board.instances
      const shown = all.filter((one) => !one.hidden && !one.disabled)
      return {
        shownOnStartPage: state.board.enabled,
        count: shown.length,
        widgets: shown.map((one, at) => describe(one, at, shown.length)),
        hidden: all.filter((one) => one.hidden).map((one, at) => describe(one, at, all.length)),
        setAside: all.filter((one) => one.disabled).map((one, at) => describe(one, at, all.length)),
        favourites: state.board.favourites,
        savedLayouts: state.layouts.map((one) => ({ id: one.id, name: one.name, widgets: one.widgets })),
        canUndo: state.canUndo,
        startPageOpen: runtime.rendered() !== null
      }
    }
  })

  control.register({
    ...common,
    id: 'experience.widgetCatalogue',
    name: 'List the widgets Orbis has',
    description: 'Every widget that can be put on the start page: what it shows, where that comes from, what it can read, which sizes it comes in, and whether it needs the internet. Widgets that cannot be added say why.',
    keywords: ['widget', 'widgets', 'available', 'catalogue', 'gallery', 'add', 'what widgets'],
    params: {
      query: { type: 'string', description: 'Narrows the list by name, what it does, or what it reads.' },
      category: { type: 'string', description: 'time, productivity, information, browser, system, fun' }
    },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const category = String(p.category ?? 'all')
      const list = p.query || p.category ? searchWidgets(String(p.query ?? ''), category === 'all' ? 'all' : (category as never)) : WIDGETS
      const where = await board()
      return list.map((definition) => {
        const state = galleryState(definition, where)
        return {
          widget: definition.id,
          name: definition.name,
          what: definition.description,
          category: definition.category,
          sizes: definition.sizes,
          defaultSize: definition.defaultSize,
          settings: definition.settings.map((spec) => ({ name: spec.name, label: spec.label, type: spec.type, ...(spec.choices ? { choices: spec.choices.map((one) => one.value) } : {}) })),
          shows: definition.sources,
          // Said plainly, because adding a widget is granting it what it needs.
          reads: permissionsOf(definition),
          needsInternet: definition.network,
          onStartPage: state.count,
          ...(state.state === 'unavailable' ? { cannotBeAdded: state.reason } : {})
        }
      })
    }
  })

  control.register({
    ...common,
    id: 'experience.widget',
    name: 'Look at one widget on the start page',
    description: 'Everything about one widget that is on the start page: its size, its place, its settings, its look, and whether it is locked, hidden or was set aside after failing.',
    keywords: ['widget', 'settings of', 'how is set', 'size of'],
    params: { widget: { type: 'string', description: 'Which one, by its name, what it is, or its id.', required: true } },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const one = await find(p.widget)
      const all = (await board()).instances
      const definition = widgetById(one.widget)
      return {
        ...describe(one, all.indexOf(one), all.length),
        comesIn: definition?.sizes ?? [],
        canBeSet: (definition?.settings ?? []).map((spec) => ({ name: spec.name, label: spec.label, type: spec.type, now: one.settings[spec.name], ...(spec.choices ? { choices: spec.choices.map((c) => c.value) } : {}) })),
        shows: definition?.sources ?? [],
        reads: definition ? permissionsOf(definition) : []
      }
    }
  })

  // ---------------------------------------------------------------- adding and taking away

  control.register({
    ...common,
    id: 'experience.addWidget',
    name: 'Add a widget to the start page',
    description: 'Puts a widget on the browser\'s start page. It must be one Orbis has (read experience.widgetCatalogue). Adding one grants it the access it declares, so it is confirmed first unless the person asked for it themselves.',
    keywords: ['add widget', 'put a clock', 'show the weather', 'new tab', 'start page'],
    params: {
      widget: { type: 'string', description: 'Which widget, by its id in the catalogue.', required: true },
      size: { type: 'string', description: 'How big.', enum: [...WIDGET_SIZES] },
      place: { type: 'number', description: 'Where in the order, counted from 1. Left out, it goes last.' },
      settings: { type: 'object', description: 'What to set it to as it is added, by the setting names in the catalogue.' }
    },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Add the ${widgetById(String(p.widget))?.name ?? p.widget} widget to the start page`,
    assess: (p, ctx) => {
      if (ctx.source === 'user') return { decision: 'run', reason: '' }
      const definition = widgetById(String(p.widget ?? '').toLowerCase())
      const needs = definition ? permissionsOf(definition) : []
      return needs.length ? { decision: 'confirm', reason: `It reads ${needs.join(' and ')}.` } : { decision: 'run', reason: '' }
    },
    run: async (p) => {
      const widget = String(p.widget ?? '').toLowerCase()
      const definition = widgetById(widget)
      if (!definition) return fail('invalid-params', `Orbis has no widget called "${widget.slice(0, 40)}". Read experience.widgetCatalogue for the list.`)
      if (!isAvailable(definition)) return fail('invalid-params', definition.unavailable ?? `${definition.name} cannot be put on the start page.`)
      const size = p.size === undefined ? undefined : (String(p.size) as WidgetSize)
      const at = typeof p.place === 'number' && Number.isFinite(p.place) ? Math.max(0, Math.floor(p.place) - 1) : undefined
      return apply(
        { type: 'add', widget, ...(size ? { size } : {}), ...(at === undefined ? {} : { at }), ...(p.settings && typeof p.settings === 'object' ? { settings: p.settings as Record<string, unknown> } : {}) },
        (one) => one !== null && one.widget === widget
      )
    }
  })

  control.register({
    ...common,
    id: 'experience.removeWidget',
    name: 'Take a widget off the start page',
    description: 'Removes one widget from the start page. Its settings go with it; hiding it instead keeps them (experience.showWidget).',
    keywords: ['remove widget', 'take off', 'delete the clock', 'start page'],
    params: { widget: { type: 'string', description: 'Which one, by its name, what it is, or its id.', required: true } },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Take the ${String(p.widget)} widget off the start page`,
    run: async (p) => {
      const one = await find(p.widget)
      const result = await apply({ type: 'remove', id: one.id })
      const still = (await board()).instances.some((other) => other.id === one.id)
      if (still) return fail('failed', 'That widget is still on the start page, so nothing has been changed.')
      return result
    }
  })

  control.register({
    ...common,
    id: 'experience.moveWidget',
    name: 'Move a widget on the start page',
    description: 'Changes where a widget sits in the order on the start page. The order is how the cards are laid out, left to right and top to bottom.',
    keywords: ['move widget', 'reorder', 'first', 'last', 'before', 'after'],
    params: {
      widget: { type: 'string', description: 'Which one, by its name, what it is, or its id.', required: true },
      place: { type: 'string', description: 'Where to, as text: a number counted from 1 ("2"), or "first", "last", "before <widget>", "after <widget>".', required: true }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Move the ${String(p.widget)} widget to ${String(p.place)}`,
    run: async (p) => {
      const one = await find(p.widget)
      const instances = (await board()).instances
      const shown = instances.filter((other) => !other.hidden && !other.disabled)
      const asked = String(p.place ?? '').trim().toLowerCase()
      let to: number
      if (asked === 'first') to = 0
      else if (asked === 'last') to = Math.max(0, shown.length - 1)
      else if (asked.startsWith('before ') || asked.startsWith('after ')) {
        const [word, ...rest] = asked.split(' ')
        const other = await find(rest.join(' '))
        const at = shown.findIndex((item) => item.id === other.id)
        if (at < 0) return fail('not-found', 'That widget is not on the start page.')
        to = word === 'before' ? at : at + 1
      } else {
        const number = Number(asked)
        if (!Number.isFinite(number) || number < 1) return fail('invalid-params', 'Say where to move it: a number counted from 1, or "first", "last", "before <widget>" or "after <widget>".')
        to = Math.floor(number) - 1
      }
      return apply({ type: 'move', id: one.id, to })
    }
  })

  control.register({
    ...common,
    id: 'experience.resizeWidget',
    name: 'Change a widget’s size',
    description: 'Makes one widget on the start page a different size. Only the sizes that widget comes in: read experience.widget or experience.widgetCatalogue.',
    keywords: ['resize', 'bigger', 'smaller', 'size', 'wide', 'tall'],
    params: {
      widget: { type: 'string', description: 'Which one, by its name, what it is, or its id.', required: true },
      size: { type: 'string', description: 'small (one cell), medium (two across), tall (two down), large (two by two), wide (a whole row).', required: true, enum: [...WIDGET_SIZES] }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Make the ${String(p.widget)} widget ${String(p.size)}`,
    run: async (p) => {
      const one = await find(p.widget)
      const size = String(p.size ?? '') as WidgetSize
      if (!WIDGET_SIZES.includes(size)) return fail('invalid-params', `A widget can be: ${WIDGET_SIZES.join(', ')}.`)
      return apply({ type: 'resize', id: one.id, size }, (which) => which === null || which.size === size)
    }
  })

  // ---------------------------------------------------------------- how a widget is set up

  control.register({
    ...common,
    id: 'experience.configureWidget',
    name: 'Change what a widget is set to',
    description: 'Changes one widget\'s own settings: the city a weather widget shows, the feeds a news widget reads, the places a world clock keeps. Read experience.widget for the settings it has and what they are now.',
    keywords: ['set the city', 'change the feed', 'configure', 'settings of a widget', 'symbol'],
    params: {
      widget: { type: 'string', description: 'Which one, by its name, what it is, or its id.', required: true },
      settings: { type: 'object', description: 'The settings to change, by the names the catalogue gives. Anything else is refused by name.', required: true }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Change what the ${String(p.widget)} widget is set to`,
    run: async (p) => {
      const one = await find(p.widget)
      if (!p.settings || typeof p.settings !== 'object' || Array.isArray(p.settings)) return fail('invalid-params', 'Say which settings to change, and to what.')
      return apply({ type: 'configure', id: one.id, settings: p.settings as Record<string, unknown> })
    }
  })

  control.register({
    ...common,
    id: 'experience.widgetLook',
    name: 'Change how a widget’s card looks',
    description: 'The card a widget sits on: glass (the usual), solid, tinted in the accent colour, or no card at all; and comfortable or compact.',
    keywords: ['glass', 'solid', 'transparent', 'compact', 'look of the card', 'tone'],
    params: {
      widget: { type: 'string', description: 'Which one, by its name, what it is, or its id.', required: true },
      card: { type: 'string', description: 'glass, solid, tint or clear.', enum: ['glass', 'solid', 'tint', 'clear'] },
      spacing: { type: 'string', description: 'comfortable or compact.', enum: ['comfortable', 'compact'] }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Change how the ${String(p.widget)} widget’s card looks`,
    run: async (p) => {
      const one = await find(p.widget)
      const look: Partial<WidgetLook> = {}
      if (p.card !== undefined) look.tone = String(p.card) as WidgetLook['tone']
      if (p.spacing !== undefined) look.density = String(p.spacing) === 'compact' ? 'compact' : 'comfortable'
      if (Object.keys(look).length === 0) return fail('invalid-params', 'Say what to change: the card, or the spacing.')
      return apply({ type: 'look', id: one.id, look })
    }
  })

  control.register({
    ...common,
    id: 'experience.resetWidget',
    name: 'Put a widget back to how it comes',
    description: 'Its settings and its card back to how the widget arrives. Where it sits and how big it is are left alone.',
    keywords: ['reset widget', 'default', 'how it comes', 'start again'],
    params: { widget: { type: 'string', description: 'Which one, by its name, what it is, or its id.', required: true } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Put the ${String(p.widget)} widget back to how it comes`,
    run: async (p) => apply({ type: 'reset', id: (await find(p.widget)).id })
  })

  // ---------------------------------------------------------------- shown, hidden, locked

  control.register({
    ...common,
    id: 'experience.showWidget',
    name: 'Show or hide one widget',
    description: 'Hides a widget without taking it off the start page, so everything it is set to is kept; or shows a hidden one again. A widget set aside after failing is started again by this too.',
    keywords: ['hide widget', 'show widget', 'put it back', 'set aside'],
    params: {
      widget: { type: 'string', description: 'Which one, by its name, what it is, or its id.', required: true },
      show: { type: 'boolean', description: 'True to show it, false to hide it.', required: true }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `${p.show === false ? 'Hide' : 'Show'} the ${String(p.widget)} widget`,
    run: async (p) => {
      const one = await find(p.widget)
      const show = p.show !== false
      if (show && one.disabled) return apply({ type: 'revive', id: one.id })
      return apply({ type: 'hide', id: one.id, hidden: !show }, (which) => which === null || which.hidden === !show)
    }
  })

  control.register({
    ...common,
    id: 'experience.lockWidget',
    name: 'Lock or unlock a widget',
    description: 'A locked widget cannot be moved or resized by dragging it, by the keyboard, or by Orion. Everything else about it still works.',
    keywords: ['lock', 'unlock', 'pin in place', 'stop it moving'],
    params: {
      widget: { type: 'string', description: 'Which one, by its name, what it is, or its id.', required: true },
      locked: { type: 'boolean', description: 'True to lock it, false to unlock it.', required: true }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `${p.locked === false ? 'Unlock' : 'Lock'} the ${String(p.widget)} widget`,
    run: async (p) => {
      const one = await find(p.widget)
      const locked = p.locked !== false
      return apply({ type: 'lock', id: one.id, locked }, (which) => which === null || which.locked === locked)
    }
  })

  control.register({
    ...common,
    id: 'experience.widgetArea',
    name: 'Show or hide the widgets on the start page',
    description: 'Whether the start page shows widgets at all. Hiding them keeps every one of them and everything they are set to.',
    keywords: ['widgets off', 'widgets on', 'hide all widgets', 'clean start page'],
    params: { show: { type: 'boolean', description: 'True to show widgets on the start page, false to hide them all.', required: true } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `${p.show === false ? 'Hide' : 'Show'} the widgets on the start page`,
    run: async (p) => apply({ type: 'enable', on: p.show !== false })
  })

  // ---------------------------------------------------------------- the whole board

  control.register({
    ...common,
    id: 'experience.widgetLayout',
    name: 'Set the start page out as a ready-made layout',
    description: `Replaces what is on the start page with one of Orbis's own layouts: ${WIDGET_PRESETS.map((one) => `${one.name} (${one.describe})`).join('; ')}. What was there can be put back with experience.undoWidgets.`,
    keywords: ['layout', 'preset', 'set up my start page', 'study', 'work', 'research', 'minimal'],
    params: { layout: { type: 'string', description: 'Which layout, by name.', required: true, enum: WIDGET_PRESETS.map((one) => one.id) } },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Set the start page out as the "${String(p.layout)}" layout`,
    assess: (_p, ctx) => (ctx.source === 'user' ? { decision: 'run', reason: '' } : { decision: 'confirm', reason: 'It replaces every widget that is on the start page now.' }),
    run: async (p) => {
      const asked = String(p.layout ?? '').trim().toLowerCase()
      const preset = WIDGET_PRESETS.find((one) => one.id === asked || one.name.toLowerCase() === asked)
      if (!preset) return fail('invalid-params', `Orbis has no layout called "${asked.slice(0, 40)}". It has: ${WIDGET_PRESETS.map((one) => one.name).join(', ')}.`)
      return apply({ type: 'preset', preset: preset.id })
    }
  })

  control.register({
    ...common,
    id: 'experience.undoWidgets',
    name: 'Take back the last change to the widgets',
    description: 'Undoes the last change made to the start page’s widgets in this session, whoever made it. There is one step of history per profile and it is not kept after Orbis closes.',
    keywords: ['undo', 'put it back', 'that was wrong', 'revert the widgets'],
    params: {},
    mutates: true,
    confirmation: 'none',
    describe: () => 'Take back the last change to the start page’s widgets',
    run: async () => apply({ type: 'undo' })
  })

  control.register({
    ...common,
    id: 'experience.openWidgetGallery',
    name: 'Open the widget gallery on the start page',
    description: 'Opens the browser\'s start page at the widget gallery, where every widget is shown as the real thing and can be added, or at one widget\'s own page.',
    keywords: ['widget gallery', 'browse widgets', 'add a widget myself', 'show me the widgets'],
    params: { widget: { type: 'string', description: 'One widget to open, by its id in the catalogue. Left out, the gallery opens on everything.' } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => (p.widget ? `Open the ${String(p.widget)} widget in the gallery` : 'Open the widget gallery'),
    run: async (p, ctx) => {
      const widget = String(p.widget ?? '').trim().toLowerCase()
      if (widget && !widgetById(widget)) return fail('invalid-params', `Orbis has no widget called "${widget.slice(0, 40)}".`)
      // Opened through the one capability that sends a tab to a page the browser itself owns.
      const at = widget ? `#widgets/${widget}` : undefined
      const opened = await ctx.control.execute(
        { capability: 'surface.open', params: { name: 'widgets', ...(at ? { at } : {}) } },
        { source: ctx.source, target: ctx.target, signal: ctx.signal, confirm: ctx.confirm }
      )
      if (!opened.ok) {
        return fail('failed', `The start page could not be opened: ${opened.error?.message ?? 'the browser did not answer'}. Open a new tab and press "Widgets".`)
      }
      return { done: widget ? `The gallery is open at ${widgetById(widget)!.name}.` : 'The widget gallery is open.', verified: opened.verification ?? null }
    }
  })
}
