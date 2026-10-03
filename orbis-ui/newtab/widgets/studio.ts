import type { PageDeps, WidgetCard } from './api.ts'
import { createCard } from './card.ts'
import { button, h, svg } from './dom.ts'
import { drawMark } from './miniature.ts'
import { createSettingsForm, type SettingsForm } from './settingsForm.ts'
import { createSizePicker } from './sizePicker.ts'
import { diffDraft, isAsItComes, placeWords, scaleWords, stageFit } from './studioLogic.ts'
import { LOOK_TONES, SIZE_NAMES, TONE_NAMES, widgetById, type WidgetInstance, type WidgetLook, type WidgetSize } from '../../../src/shared/widgets.ts'
import { orderedWidgets } from '../../../src/shared/widgetBoard.ts'
import type { WidgetReply, WidgetRequest } from '../../../src/shared/widgetFeed.ts'

/**
 * Setting up one widget that is already on the start page.
 *
 * The widget on the left is not a preview: it is the person's own, with their own things in it, and every control on
 * the right changes the start page the moment it is used. There is no Save button, because nothing is held back to
 * save -- what is on this screen is what is on the start page, and anything that goes wrong is one Undo away.
 *
 * What is typed waits a breath before it is sent, and is sent on the way out, so leaving mid-word never loses a word.
 * Everything else happens on the press.
 */

const DENSITY: readonly { value: WidgetLook['density']; label: string }[] = Object.freeze([
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' }
])

export function showStudio(host: HTMLElement, instanceId: string, deps: PageDeps): () => void {
  let teardown: (() => void) | null = null
  let waiting: (() => void) | null = null
  let settled = false

  const found = (): WidgetInstance | null => deps.link.state()?.board.instances.find((one) => one.id === instanceId) ?? null
  const start = (one: WidgetInstance): void => {
    teardown = build(host, one, instanceId, deps)
  }

  const first = found()
  if (first) {
    settled = true
    start(first)
  } else {
    // Orbis answers a moment after the page opens. Until it has, nothing is known about this widget -- not even
    // whether it exists -- so the screen waits rather than saying it has gone.
    host.replaceChildren(h('div', { class: 'wg-studio wg-studio-lost' }, h('div', { class: 'wg-state' }, h('p', { class: 'wg-skeleton' }), h('p', { class: 'wg-note', text: 'Asking Orbis about this widget…' }))))
    const listener = (state: { board: { instances: WidgetInstance[] } } | null): void => {
      if (settled || !state) return
      settled = true
      const one = state.board.instances.find((other) => other.id === instanceId) ?? null
      if (one) start(one)
      else lost(host, deps)
      waiting?.()
      waiting = null
    }
    waiting = deps.link.subscribe(listener)
    if (settled) {
      waiting()
      waiting = null
    }
  }

  return () => {
    settled = true
    waiting?.()
    waiting = null
    teardown?.()
    teardown = null
    host.replaceChildren()
  }
}

function lost(host: HTMLElement, deps: PageDeps): void {
  host.replaceChildren(h('div', { class: 'wg-studio wg-studio-lost' },
    h('div', { class: 'wg-state' },
      h('p', { class: 'wg-big', text: 'It is not there' }),
      h('p', { text: 'That widget is no longer on the start page.' }),
      button('Back to all widgets', () => deps.go({ view: 'home' }), 'Back to all widgets', 'wg-btn primary')
    )
  ))
}

// ---------------------------------------------------------------- the whole screen

function build(host: HTMLElement, first: WidgetInstance, instanceId: string, deps: PageDeps): () => void {
  const definition = widgetById(first.widget)
  if (!definition) {
    lost(host, deps)
    return () => host.replaceChildren()
  }

  let current: WidgetInstance = first
  let card: WidgetCard | null = null
  let form: SettingsForm | null = null
  let watcher: ResizeObserver | null = null
  let stop: (() => void) | null = null
  /** Set when this screen itself took the widget off, so leaving does not flash "it is not there" on the way out. */
  let removed = false

  const back = (): void => deps.go({ view: 'home' })

  const ask = async (request: WidgetRequest, undoable = true): Promise<WidgetReply> => {
    const reply = await deps.link.act(request)
    if (!reply.ok) deps.say(reply.message)
    else if (reply.said !== '') deps.say(reply.said, undoable && !reply.already ? { label: 'Undo', press: () => void deps.link.act({ type: 'undo' }) } : undefined)
    return reply
  }

  const name = h('h2', { class: 'wg-studio-name', tabindex: '-1', text: definition.name })
  const where = h('p', { class: 'wg-studio-where' })
  const floor = h('div', { class: 'wg-stage-floor' })
  const scaleNote = h('p', { class: 'wg-stage-note' })
  const controls = h('div', { class: 'wg-studio-controls' })

  const element = h('div', { class: 'wg-studio' },
    h('div', { class: 'wg-studio-bar' }, button('Back to all widgets', back, ['← ', 'All widgets'], 'wg-btn wg-studio-back')),
    h('header', { class: 'wg-studio-head' },
      h('div', { class: 'wg-studio-title' }, drawMark(definition.icon, 24), name),
      where
    ),
    h('div', { class: 'wg-studio-body' },
      h('section', { class: 'wg-stage wg-studio-live', 'aria-label': `${definition.name} as it is on your start page` },
        floor,
        scaleNote,
        h('p', { class: 'wg-note', text: 'This is the one on your start page, with your own things in it. Every change below happens there at once.' })
      ),
      controls
    )
  )
  host.replaceChildren(element)

  // ---------------------------------------------------------------- the widget itself, live

  card = createCard({
    instance: first,
    preview: false,
    link: deps.link,
    hour12: deps.hour12(),
    onSettings: () => {
      const firstControl = form?.element.querySelector('input, select, textarea')
      if (firstControl instanceof HTMLElement) firstControl.focus()
    }
  })
  floor.replaceChildren(h('div', { class: 'wg-stage-shrink' }, h('div', { class: 'wg-stage-real' }, card.element)))

  /** Drawn at its true pixel size and shrunk as one picture, so the studio never shows a second, squashed layout. */
  function layout(size: WidgetSize): void {
    const shrink = floor.querySelector('.wg-stage-shrink')
    const real = floor.querySelector('.wg-stage-real')
    if (!(shrink instanceof HTMLElement) || !(real instanceof HTMLElement)) return
    const room = floor.getBoundingClientRect()
    const fit = stageFit(size, room.width || 520, room.height || 340)
    real.style.width = `${fit.width}px`
    real.style.height = `${fit.height}px`
    real.style.transform = `scale(${fit.scale})`
    shrink.style.width = `${Math.round(fit.width * fit.scale)}px`
    shrink.style.height = `${Math.round(fit.height * fit.scale)}px`
    scaleNote.textContent = `${SIZE_NAMES[size]} · ${scaleWords(fit.scale).toLowerCase()}`
  }
  layout(first.size)
  watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout(current.size)) : null
  watcher?.observe(floor)

  // ---------------------------------------------------------------- settings

  form = createSettingsForm({
    definition,
    settings: first.settings,
    waitMs: 300,
    onChange: (settings) => {
      const changed = diffDraft(definition, current.settings, settings)
      if (Object.keys(changed).length === 0) return
      void ask({ type: 'configure', id: instanceId, settings: changed })
    }
  })
  controls.append(section('Settings', form.element))

  // ---------------------------------------------------------------- size

  const picker = createSizePicker({
    sizes: definition.sizes,
    value: first.size,
    name: `wg-studio-size-${instanceId}`,
    legend: 'Size',
    onPick: (size) => void ask({ type: 'resize', id: instanceId, size })
  })
  if (definition.sizes.length > 1) controls.append(section('Size', picker.element, 'How much of the page it takes.'))

  // ---------------------------------------------------------------- look

  const toneInputs = new Map<WidgetLook['tone'], HTMLInputElement>()
  const tones = h('div', { class: 'wg-tones', role: 'radiogroup', 'aria-label': 'Card' })
  for (const tone of LOOK_TONES) {
    const id = `wg-tone-${instanceId}-${tone}`
    const input = h('input', { class: 'wg-tones-input', type: 'radio', name: `wg-tone-${instanceId}`, id, value: tone, checked: tone === first.look.tone, 'aria-label': TONE_NAMES[tone] })
    input.addEventListener('change', () => {
      if (input.checked) void ask({ type: 'look', id: instanceId, look: { tone } })
    })
    toneInputs.set(tone, input)
    tones.append(input, h('label', { class: 'wg-tones-one', for: id, 'data-tone': tone }, drawToneSwatch(), h('span', { class: 'wg-tones-name', text: TONE_NAMES[tone] })))
  }

  const densityInputs = new Map<WidgetLook['density'], HTMLInputElement>()
  const densities = h('div', { class: 'wg-form-seg', role: 'radiogroup', 'aria-label': 'Spacing' })
  for (const one of DENSITY) {
    const id = `wg-density-${instanceId}-${one.value}`
    const input = h('input', { class: 'wg-form-seg-input', type: 'radio', name: `wg-density-${instanceId}`, id, value: one.value, checked: one.value === first.look.density })
    input.addEventListener('change', () => {
      if (input.checked) void ask({ type: 'look', id: instanceId, look: { density: one.value } })
    })
    densityInputs.set(one.value, input)
    densities.append(input, h('label', { class: 'wg-form-seg-one', for: id, text: one.label }))
  }
  controls.append(section('Look', h('div', { class: 'wg-studio-look' }, tones, h('div', { class: 'wg-form-row' }, h('span', { class: 'wg-form-label', text: 'Spacing' }), densities))))

  // ---------------------------------------------------------------- kept where it is, kept out of the way

  const lock = switchRow(`wg-lock-${instanceId}`, 'Keep it where it is', 'While this is on it cannot be moved or taken off.', (on) => void ask({ type: 'lock', id: instanceId, locked: on }))
  const hide = switchRow(`wg-hide-${instanceId}`, 'Hide it for now', 'It is kept with its settings, but is not drawn on the start page.', (on) => void ask({ type: 'hide', id: instanceId, hidden: on }))
  lock.input.checked = first.locked
  hide.input.checked = first.hidden
  controls.append(section('Keeping it', h('div', { class: 'wg-studio-switches' }, lock.element, hide.element)))

  // ---------------------------------------------------------------- starting over, and taking it off

  const reset = h('button', { class: 'wg-btn', type: 'button', text: 'Back to how it comes' })
  reset.addEventListener('click', () => {
    form?.flush()
    void ask({ type: 'reset', id: instanceId })
  })
  const removeRow = h('div', { class: 'wg-studio-remove' })

  function drawRemove(): void {
    const open = h('button', { class: 'wg-btn wg-studio-danger', type: 'button', text: 'Remove from start page' })
    open.addEventListener('click', () => {
      const yes = h('button', { class: 'wg-btn wg-studio-danger', type: 'button', text: 'Yes, take it off' })
      const no = h('button', { class: 'wg-btn', type: 'button', text: 'Keep it' })
      yes.addEventListener('click', () => {
        yes.disabled = true
        no.disabled = true
        void deps.link.act({ type: 'remove', id: instanceId }).then((reply) => {
          if (!reply.ok) {
            yes.disabled = false
            no.disabled = false
            return deps.say(reply.message)
          }
          removed = true
          deps.say(reply.said, { label: 'Undo', press: () => void deps.link.act({ type: 'undo' }) })
          back()
        })
      })
      no.addEventListener('click', () => {
        drawRemove()
        const again = removeRow.querySelector('button')
        if (again instanceof HTMLElement) again.focus()
      })
      removeRow.replaceChildren(
        h('p', { class: 'wg-note', text: `Take ${definition!.name} off the start page? Its settings go with it, and Undo brings it back.` }),
        h('div', { class: 'wg-row' }, yes, no)
      )
      yes.focus()
    })
    removeRow.replaceChildren(open)
  }
  drawRemove()
  controls.append(section('Starting over', h('div', { class: 'wg-studio-end' }, reset, removeRow)))

  // ---------------------------------------------------------------- keeping up with the start page

  function showInstance(one: WidgetInstance | null): void {
    if (!one) {
      if (!removed) lost(host, deps)
      return
    }
    current = one
    const at = orderedWidgets(deps.link.state()?.board.instances ?? []).findIndex((other) => other.id === one.id)
    where.textContent = `On your start page · ${placeWords(one, Math.max(0, at))}${isAsItComes(definition!, one.settings) ? '' : ' · changed'}`
    card?.update(one)
    layout(one.size)
    picker.set(one.size)
    const tone = toneInputs.get(one.look.tone)
    if (tone) tone.checked = true
    const density = densityInputs.get(one.look.density)
    if (density) density.checked = true
    if (document.activeElement !== lock.input) lock.input.checked = one.locked
    if (document.activeElement !== hide.input) hide.input.checked = one.hidden
    // Not while somebody is typing: putting the saved value back under their hands is how a form eats a word.
    if (form && !form.busy()) form.set(one.settings)
  }

  stop = deps.link.subscribe(() => showInstance(deps.link.state()?.board.instances.find((one) => one.id === instanceId) ?? null))
  showInstance(first)
  name.focus()

  // Ctrl+Z takes back the last change, which here is the one just made on this screen. Inside a box being typed in it
  // is left alone: there it means "undo my typing", and the browser already does that better.
  const onKey = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) return
    if (event.target instanceof HTMLInputElement && (event.target.type === 'text' || event.target.type === 'number')) return
    event.preventDefault()
    form?.flush()
    void ask({ type: 'undo' }, false)
  }
  element.addEventListener('keydown', onKey)

  return () => {
    form?.flush()
    element.removeEventListener('keydown', onKey)
    stop?.()
    stop = null
    watcher?.disconnect()
    watcher = null
    form?.destroy()
    form = null
    card?.destroy()
    card = null
    host.replaceChildren()
  }
}

// ---------------------------------------------------------------- small pieces

function section(title: string, body: HTMLElement, note?: string): HTMLElement {
  return h('section', { class: 'wg-studio-part' },
    h('h3', { class: 'wg-label wg-studio-part-title', text: title }),
    note ? h('p', { class: 'wg-note', text: note }) : null,
    body
  )
}

function switchRow(id: string, label: string, note: string, onChange: (on: boolean) => void): { element: HTMLElement; input: HTMLInputElement } {
  const hintId = `${id}-hint`
  const input = h('input', { class: 'wg-form-switch', type: 'checkbox', id, role: 'switch', 'aria-describedby': hintId })
  input.addEventListener('change', () => onChange(input.checked))
  return {
    input,
    element: h('div', { class: 'wg-form-row wg-form-row-switch wg-studio-switch' },
      input,
      h('label', { class: 'wg-form-label', for: id, text: label }),
      h('p', { class: 'wg-form-hint', id: hintId, text: note })
    )
  }
}

/** The little card that stands for one way a widget's card can look. The tone itself is painted on by the stylesheet. */
function drawToneSwatch(): SVGElement {
  return svg('svg', { class: 'wg-tones-swatch', viewBox: '0 0 44 30', width: 44, height: 30, 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { class: 'wg-tones-card', x: 1, y: 1, width: 42, height: 28, rx: 7 }),
    svg('rect', { class: 'wg-tones-line', x: 8, y: 10, width: 20, height: 3, rx: 1.5 }),
    svg('rect', { class: 'wg-tones-line wg-tones-line-2', x: 8, y: 17, width: 13, height: 3, rx: 1.5 })
  )
}
