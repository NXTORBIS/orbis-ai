import { fail } from '../browserControl/registry.ts'
import type { BrowserControl } from '../browserControl/registry.ts'
import type { ExperienceStore } from './store.ts'
import type { WidgetInstance, WidgetSize, ZoneName } from '../../shared/widgets.ts'
import { MAX_WIDGETS, newWidgetInstance, permissionsOf, placeWidget, searchWidgets, widgetById, widgetsInZone, WIDGETS, ZONES } from '../../shared/widgets.ts'

/**
 * Orion's hands on the new tab's widgets.
 *
 * Widgets already existed, were already laid out in zones, and were already stored with the rest of the
 * personalisation. What was missing was any way for Orion to change them, which meant "add a clock widget" was a
 * sentence Orion could say and not a thing Orion could do. These capabilities close that, through the control layer
 * everything else goes through — no second widget API, no second store, no second layout model.
 *
 * Every one of them that changes something reads the layout back afterwards and says whether the change is really
 * there. That is not ceremony: the whole point of going through the control layer is that "I added the weather
 * widget" is checked against the widget actually being on the page, and a capability that returned success without
 * looking would be exactly the fake progress the rest of Orbis refuses to produce.
 */

const ZONE_WORDS: Record<ZoneName, string> = {
  top: 'across the top',
  left: 'down the left',
  centre: 'in the middle',
  right: 'down the right',
  bottom: 'across the bottom'
}

const SIZES: WidgetSize[] = ['small', 'medium', 'large']

/** What a widget instance looks like from outside: what it is, where it is, how big — never another profile's. */
const describe = (instance: WidgetInstance): Record<string, unknown> => {
  const definition = widgetById(instance.widget)
  return {
    instanceId: instance.id,
    widget: instance.widget,
    name: definition?.name ?? instance.widget,
    zone: instance.zone,
    where: ZONE_WORDS[instance.zone],
    order: instance.order,
    size: instance.size,
    collapsed: instance.collapsed,
    // Set aside after repeated failures, which is worth saying rather than quietly showing nothing.
    setAside: instance.disabled,
    settings: instance.settings
  }
}

export function registerWidgetCapabilities(control: BrowserControl, store: ExperienceStore): void {
  const common = { domain: 'experience' as const }
  const widgets = (): WidgetInstance[] => store.current().widgets
  const shown = (): boolean => store.current().newTab.widgets

  /** Saves a new set of widgets, leaving everything else about the personalisation exactly as it was. */
  const put = async (next: WidgetInstance[], why: string): Promise<void> => {
    const config = store.current()
    await store.save({ ...config, widgets: next }, why)
  }

  /** The instance a command means: by its own id, or by the widget it is an instance of when there is only one. */
  const find = (what: unknown): WidgetInstance => {
    const asked = String(what ?? '').trim()
    if (!asked) fail('invalid-params', 'Say which widget, by its name or its instance id.')
    const byInstance = widgets().find((w) => w.id === asked)
    if (byInstance) return byInstance
    const matching = widgets().filter((w) => w.widget === asked.toLowerCase() || (widgetById(w.widget)?.name.toLowerCase() === asked.toLowerCase()))
    if (!matching.length) fail('not-found', `There is no ${asked} widget on the new tab. Read experience.widgets for what is there.`, true)
    if (matching.length > 1) {
      fail('invalid-params', `There are ${matching.length} ${asked} widgets. Say which one by its instance id: ${matching.map((w) => w.id).join(', ')}.`)
    }
    return matching[0]
  }

  // ---------------------------------------------------------------- what is there

  control.register({
    ...common,
    id: 'experience.widgets',
    name: 'List the widgets on the new tab',
    description: 'What widgets are on the user\'s new tab page, where each one sits, how big it is and what it is set to. Also says whether the widget area is switched on at all.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => ({
      on: shown(),
      count: widgets().filter((w) => !w.disabled).length,
      zones: ZONES.map((zone) => ({ zone, where: ZONE_WORDS[zone], widgets: widgetsInZone(widgets(), zone).map(describe) })).filter((z) => z.widgets.length),
      setAside: widgets().filter((w) => w.disabled).map(describe)
    })
  })

  control.register({
    ...common,
    id: 'experience.widgetCatalogue',
    name: 'List the widgets Orbis has',
    description: 'Every widget that can be added to the new tab, what it shows, what it needs access to, and which sizes it supports. Only widgets that really work are listed; there is nothing here that is not implemented.',
    params: { query: { type: 'string', description: 'Narrows the list by name or description.' }, category: { type: 'string', description: 'time, productivity, information, browser, orion or utility.' } },
    mutates: false,
    confirmation: 'none',
    run: (p) => {
      const category = String(p.category ?? 'all')
      const list = p.query || p.category ? searchWidgets(String(p.query ?? ''), category === 'all' ? 'all' : (category as never)) : WIDGETS
      return list.map((definition) => ({
        widget: definition.id,
        name: definition.name,
        what: definition.description,
        category: definition.category,
        sizes: definition.sizes,
        // Said plainly, because adding a widget is granting it what it needs.
        needs: permissionsOf(definition)
      }))
    }
  })

  // ---------------------------------------------------------------- changing what is there

  control.register({
    ...common,
    id: 'experience.addWidget',
    name: 'Add a widget to the new tab',
    description: 'Puts a widget on the user\'s new tab page. The widget must be one Orbis has (read experience.widgetCatalogue). Adding one grants it the access it declares, so it asks first.',
    params: {
      widget: { type: 'string', description: 'Which widget, by its id: clock, greeting, worldclock, countdown, timer, weather, news, tasks, notes, bookmarks, recent, downloads, tabs, workspaces, clipboard, whiteboard, quote, games or calculator.', required: true },
      zone: { type: 'string', description: 'Where it goes.', enum: [...ZONES] },
      size: { type: 'string', description: 'How big.', enum: SIZES }
    },
    mutates: true,
    // Adding a widget gives it whatever it needs — history, downloads, the clipboard — so the user is asked.
    confirmation: 'when-consequential',
    describe: (p) => `Add the ${widgetById(String(p.widget))?.name ?? p.widget} widget to the new tab`,
    assess: (p, ctx) => {
      if (ctx.source === 'user') return { decision: 'run', reason: '' }
      const definition = widgetById(String(p.widget ?? ''))
      const needs = definition ? permissionsOf(definition) : []
      return needs.length ? { decision: 'confirm', reason: `It reads ${needs.join(' and ')}.` } : { decision: 'run', reason: '' }
    },
    run: async (p) => {
      const widget = String(p.widget ?? '').toLowerCase()
      const definition = widgetById(widget)
      if (!definition) {
        const near = searchWidgets(widget).slice(0, 4).map((w) => w.id)
        fail('not-found', `Orbis has no "${widget}" widget.${near.length ? ` Did you mean ${near.join(', ')}?` : ''} Read experience.widgetCatalogue for the list.`)
      }
      const current = widgets()
      if (current.length >= MAX_WIDGETS) fail('blocked', `The new tab already holds ${MAX_WIDGETS} widgets, which is as many as Orbis keeps.`)

      const zone = (ZONES as readonly string[]).includes(String(p.zone)) ? (p.zone as ZoneName) : 'centre'
      const instance = newWidgetInstance(widget, zone, current.filter((w) => w.zone === zone).length)
      if (!instance) fail('failed', `The ${definition!.name} widget could not be made.`)
      if (p.size && definition!.sizes.includes(p.size as WidgetSize)) instance!.size = p.size as WidgetSize

      await put([...current, instance!], `Added the ${definition!.name} widget`)
      return { ...describe(instance!), on: shown() }
    },
    verify: (data) => {
      // Read back from the store, not from what was just written: the question is whether it is really there.
      const id = (data as { instanceId?: string })?.instanceId
      const there = widgets().find((w) => w.id === id)
      if (!there) return { verified: false, detail: 'The widget is not on the new tab.' }
      return {
        verified: true,
        detail: shown()
          ? `The ${widgetById(there.widget)?.name ?? there.widget} widget is on the new tab, ${ZONE_WORDS[there.zone]}.`
          : // Honest rather than encouraging: it is really there, and the user will not see it until widgets are on.
            `The widget was added, but the new tab is not showing widgets at the moment, so it is not visible yet.`
      }
    }
  })

  control.register({
    ...common,
    id: 'experience.removeWidget',
    name: 'Take a widget off the new tab',
    description: 'Removes a widget from the new tab. This takes away the widget, never what it shows: removing the tasks widget does not delete any tasks, and removing the notes widget does not delete any notes.',
    params: { widget: { type: 'string', description: 'Which widget, by name or instance id.', required: true } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Take the ${p.widget} widget off the new tab`,
    run: async (p) => {
      const instance = find(p.widget)
      await put(widgets().filter((w) => w.id !== instance.id), `Removed the ${widgetById(instance.widget)?.name ?? instance.widget} widget`)
      return { instanceId: instance.id, widget: instance.widget, name: widgetById(instance.widget)?.name ?? instance.widget }
    },
    verify: (data) => {
      const id = (data as { instanceId?: string })?.instanceId
      const gone = !widgets().some((w) => w.id === id)
      return { verified: gone, detail: gone ? `The ${(data as { name?: string })?.name} widget is off the new tab. Nothing it showed was deleted.` : 'The widget is still on the new tab.' }
    }
  })

  control.register({
    ...common,
    id: 'experience.moveWidget',
    name: 'Move a widget',
    description: 'Moves a widget to another part of the new tab, or to another position within the part it is already in.',
    params: {
      widget: { type: 'string', description: 'Which widget, by name or instance id.', required: true },
      zone: { type: 'string', description: 'Where to move it.', enum: [...ZONES] },
      position: { type: 'integer', description: 'Where among the others, 1 being first. Left out, it goes last.' }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Move the ${p.widget} widget ${p.zone ? ZONE_WORDS[p.zone as ZoneName] : ''}`.trim(),
    run: async (p) => {
      const instance = find(p.widget)
      const zone = (ZONES as readonly string[]).includes(String(p.zone)) ? (p.zone as ZoneName) : instance.zone
      const asked = Number(p.position)
      // Said as 1, 2, 3 by a person; kept as 0, 1, 2 inside. A position past the end simply means last.
      const index = Number.isFinite(asked) ? Math.max(0, Math.round(asked) - 1) : widgetsInZone(widgets(), zone).length
      await put(placeWidget(widgets(), instance.id, zone, index), `Moved the ${widgetById(instance.widget)?.name ?? instance.widget} widget`)
      return { instanceId: instance.id, zone, wanted: index }
    },
    verify: (data) => {
      const { instanceId, zone } = data as { instanceId: string; zone: ZoneName }
      const inZone = widgetsInZone(widgets(), zone)
      const at = inZone.findIndex((w) => w.id === instanceId)
      if (at === -1) return { verified: false, detail: 'The widget did not end up where it was asked to go.' }
      return { verified: true, detail: `It is ${ZONE_WORDS[zone]}, ${at === 0 ? 'first' : `number ${at + 1} of ${inZone.length}`}.` }
    }
  })

  control.register({
    ...common,
    id: 'experience.resizeWidget',
    name: 'Resize a widget',
    description: 'Makes a widget smaller or larger. Each widget supports only the sizes it was built for; asking for one it does not support says so rather than leaving it unchanged and claiming otherwise.',
    params: {
      widget: { type: 'string', description: 'Which widget, by name or instance id.', required: true },
      size: { type: 'string', description: 'How big.', enum: SIZES, required: true }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Make the ${p.widget} widget ${p.size}`,
    run: async (p) => {
      const instance = find(p.widget)
      const definition = widgetById(instance.widget)
      const size = String(p.size) as WidgetSize
      if (!definition?.sizes.includes(size)) {
        fail('invalid-params', `The ${definition?.name ?? instance.widget} widget cannot be ${size}. It can be ${(definition?.sizes ?? []).join(' or ')}.`)
      }
      await put(widgets().map((w) => (w.id === instance.id ? { ...w, size } : w)), `Resized the ${definition!.name} widget`)
      return { instanceId: instance.id, size, name: definition!.name }
    },
    verify: (data) => {
      const { instanceId, size, name } = data as { instanceId: string; size: WidgetSize; name: string }
      const now = widgets().find((w) => w.id === instanceId)
      return now?.size === size ? { verified: true, detail: `The ${name} widget is ${size}.` } : { verified: false, detail: 'The widget is still the size it was.' }
    }
  })

  control.register({
    ...common,
    id: 'experience.showWidget',
    name: 'Fold a widget away, or open it again',
    description: 'Folds a widget down to its heading so the new tab stays clear, or opens it again. Folding is not removing: the widget stays where it is and keeps its settings.',
    params: {
      widget: { type: 'string', description: 'Which widget, by name or instance id.', required: true },
      shown: { type: 'boolean', description: 'True to open it, false to fold it away.', required: true }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `${p.shown === false ? 'Fold away' : 'Open'} the ${p.widget} widget`,
    run: async (p) => {
      const instance = find(p.widget)
      const collapsed = p.shown === false
      const name = widgetById(instance.widget)?.name ?? instance.widget
      await put(
        // Opening one that was set aside after failing gives it another go, which is what a person means by it.
        widgets().map((w) => (w.id === instance.id ? { ...w, collapsed, disabled: collapsed ? w.disabled : false } : w)),
        `${collapsed ? 'Folded away' : 'Opened'} the ${name} widget`
      )
      return { instanceId: instance.id, collapsed, name }
    },
    verify: (data) => {
      const { instanceId, collapsed, name } = data as { instanceId: string; collapsed: boolean; name: string }
      const now = widgets().find((w) => w.id === instanceId)
      if (!now || now.collapsed !== collapsed) return { verified: false, detail: 'The widget did not change.' }
      return { verified: true, detail: `The ${name} widget is ${collapsed ? 'folded away' : 'open'}.` }
    }
  })

  control.register({
    ...common,
    id: 'experience.configureWidget',
    name: 'Change what a widget is set to',
    description: 'Changes one of a widget\'s own settings — the clock\'s format, a countdown\'s date, how many bookmarks to show. Only settings the widget declares can be set, and each is checked against what it accepts.',
    params: {
      widget: { type: 'string', description: 'Which widget, by name or instance id.', required: true },
      setting: { type: 'string', description: 'Which setting. Read experience.widgets to see what a widget is set to now.', required: true },
      value: { type: 'any', description: 'What to set it to.', required: true }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Set the ${p.widget} widget's ${p.setting}`,
    run: async (p) => {
      const instance = find(p.widget)
      const definition = widgetById(instance.widget)
      const name = String(p.setting ?? '')
      const spec = definition?.settings.find((s) => s.name === name)
      if (!spec) {
        fail('invalid-params', `The ${definition?.name ?? instance.widget} widget has no "${name}" setting. It has ${(definition?.settings ?? []).map((s) => s.name).join(', ') || 'no settings'}.`)
      }

      // Checked against what the widget said it accepts, so a bad value is refused rather than stored and broken.
      let value: string | number | boolean
      if (spec!.type === 'boolean') value = p.value === true || p.value === 'true'
      else if (spec!.type === 'number') {
        const asked = Number(p.value)
        if (!Number.isFinite(asked)) fail('invalid-params', `${spec!.label} has to be a number.`)
        value = Math.min(spec!.max ?? Number.MAX_SAFE_INTEGER, Math.max(spec!.min ?? Number.MIN_SAFE_INTEGER, asked))
      } else if (spec!.type === 'choice') {
        const asked = String(p.value)
        const choice = spec!.choices?.find((c) => c.value === asked || c.label.toLowerCase() === asked.toLowerCase())
        if (!choice) fail('invalid-params', `${spec!.label} can be ${(spec!.choices ?? []).map((c) => c.value).join(' or ')}.`)
        value = choice!.value
      } else value = String(p.value).slice(0, 200)

      await put(
        widgets().map((w) => (w.id === instance.id ? { ...w, settings: { ...w.settings, [name]: value } } : w)),
        `Changed the ${definition!.name} widget's ${spec!.label.toLowerCase()}`
      )
      return { instanceId: instance.id, setting: name, value, label: spec!.label, name: definition!.name }
    },
    verify: (data) => {
      const { instanceId, setting, value, label, name } = data as { instanceId: string; setting: string; value: unknown; label: string; name: string }
      const now = widgets().find((w) => w.id === instanceId)
      return now?.settings[setting] === value
        ? { verified: true, detail: `The ${name} widget's ${label.toLowerCase()} is ${String(value)}.` }
        : { verified: false, detail: 'The setting did not change.' }
    }
  })

  control.register({
    ...common,
    id: 'experience.widgetArea',
    name: 'Show or hide the widget area',
    description: 'Switches the new tab\'s widgets on or off altogether. Switching them off keeps every widget and every setting; it only stops showing them.',
    params: { on: { type: 'boolean', description: 'True to show widgets on the new tab.', required: true } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `${p.on === false ? 'Hide' : 'Show'} the new tab's widgets`,
    run: async (p) => {
      const on = p.on !== false
      const config = store.current()
      await store.save({ ...config, newTab: { ...config.newTab, widgets: on } }, on ? 'Showed the new tab widgets' : 'Hid the new tab widgets')
      return { on }
    },
    verify: (data) => {
      const wanted = (data as { on: boolean }).on
      return shown() === wanted
        ? { verified: true, detail: wanted ? `The new tab is showing its ${widgets().filter((w) => !w.disabled).length} widgets.` : 'The new tab is not showing widgets. They are all kept.' }
        : { verified: false, detail: 'The widget area did not change.' }
    }
  })
}
