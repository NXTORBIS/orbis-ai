import type { PageDeps, WidgetCard } from './api.ts'
import { createCard } from './card.ts'
import { button, h } from './dom.ts'
import { offerWidget } from './galleryLogic.ts'
import { drawMark } from './miniature.ts'
import { createSettingsForm } from './settingsForm.ts'
import { createSizePicker } from './sizePicker.ts'
import { defaultSettings, networkWords, placeWords, previewInstance, refreshWords, scaleWords, stageFit, type Settings } from './studioLogic.ts'
import { RENDERERS } from './renderers/index.ts'
import { CATEGORY_NAMES, permissionsOf, SIZE_NAMES, widgetById, type WidgetSize } from '../../../src/shared/widgets.ts'
import { orderedWidgets, type WidgetBoard } from '../../../src/shared/widgetBoard.ts'

/**
 * One widget's own page: what it is, what it would look like, and putting it on the start page.
 *
 * The big drawing is the widget itself at the size that is chosen, on the same backdrop the start page has, so the
 * choice between hands and digits is made by looking at both rather than by reading the words "analog" and
 * "digital". Nothing on this page is saved anywhere: the settings are tried on the drawing, and only pressing Add
 * sends anything, which is why a person can look before they leap.
 *
 * Every fact below the drawing comes out of the catalogue, and each one is shown only when there is one: a widget
 * that reads nothing of yours has no line saying so.
 */

export function showWidgetDetail(host: HTMLElement, widget: string, deps: PageDeps): () => void {
  const definition = widgetById(widget)
  const back = (): void => deps.go({ view: 'home' })

  if (!definition) {
    host.replaceChildren(h('div', { class: 'wg-detail wg-detail-lost' },
      h('div', { class: 'wg-state' },
        h('p', { class: 'wg-big', text: 'No such widget' }),
        h('p', { text: `Orbis has nothing called "${widget.slice(0, 40)}".` }),
        button('Back to all widgets', back, 'Back to all widgets', 'wg-btn primary')
      )
    ))
    return () => host.replaceChildren()
  }

  const offer = offerWidget(definition, Object.keys(RENDERERS))
  let size: WidgetSize = definition.defaultSize
  let draft: Settings = defaultSettings(definition)
  let card: WidgetCard | null = null
  let stop: (() => void) | null = null

  // ---------------------------------------------------------------- the frame

  const name = h('h2', { class: 'wg-detail-name', tabindex: '-1', text: definition.name })
  const floor = h('div', { class: 'wg-stage-floor' })
  const scaleNote = h('p', { class: 'wg-stage-note' })
  const stage = h('section', { class: 'wg-stage', 'aria-label': `${definition.name}, drawn as it would look` }, floor, scaleNote)
  const mine = h('div', { class: 'wg-detail-mine' })
  const doing = h('div', { class: 'wg-detail-do' })
  const side = h('div', { class: 'wg-detail-side' })

  const element = h('div', { class: 'wg-detail' },
    h('div', { class: 'wg-detail-bar' }, button('Back to all widgets', back, ['← ', 'All widgets'], 'wg-btn wg-detail-back')),
    h('header', { class: 'wg-detail-head' },
      h('div', { class: 'wg-detail-title' }, drawMark(definition.icon, 26), name),
      h('p', { class: 'wg-detail-group' }, h('span', { class: 'wg-chip', text: CATEGORY_NAMES[definition.category] })),
      h('p', { class: 'wg-detail-say', text: definition.description })
    ),
    h('div', { class: 'wg-detail-body' }, stage, side)
  )
  host.replaceChildren(element)

  // ---------------------------------------------------------------- the drawing

  function drawPreview(): void {
    if (!offer.ok) {
      floor.replaceChildren(h('div', { class: 'wg-state' }, h('p', { text: offer.reason })))
      scaleNote.textContent = ''
      return
    }
    const instance = previewInstance(definition!, size, draft)
    if (!card) {
      card = createCard({ instance, preview: true, link: deps.link, hour12: deps.hour12() })
      floor.replaceChildren(h('div', { class: 'wg-stage-shrink' }, h('div', { class: 'wg-stage-real' }, card.element)))
    } else {
      card.update(instance, size)
    }
    layout()
  }

  /** The widget is drawn at its real pixel size and the whole picture is shrunk, so a preview never relays anything out. */
  function layout(): void {
    const shrink = floor.querySelector('.wg-stage-shrink')
    const real = floor.querySelector('.wg-stage-real')
    if (!(shrink instanceof HTMLElement) || !(real instanceof HTMLElement)) return
    const room = floor.getBoundingClientRect()
    const fit = stageFit(size, room.width || 640, room.height || 380)
    real.style.width = `${fit.width}px`
    real.style.height = `${fit.height}px`
    real.style.transform = `scale(${fit.scale})`
    shrink.style.width = `${Math.round(fit.width * fit.scale)}px`
    shrink.style.height = `${Math.round(fit.height * fit.scale)}px`
    scaleNote.textContent = `${SIZE_NAMES[size]} · ${scaleWords(fit.scale).toLowerCase()}`
  }

  const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null
  watcher?.observe(floor)

  // ---------------------------------------------------------------- choosing

  const picker = createSizePicker({
    sizes: definition.sizes,
    value: size,
    name: `wg-detail-size-${definition.id}`,
    legend: 'Size',
    onPick: (picked) => {
      size = picked
      drawPreview()
    }
  })
  if (definition.sizes.length > 1) side.append(picker.element)

  // Trying a setting changes a picture, and a picture says nothing to somebody listening: this line does.
  const said = h('p', { class: 'wg-detail-said', role: 'status', 'aria-live': 'polite' })
  const form = createSettingsForm({
    definition,
    settings: draft,
    waitMs: 150,
    announce: (text) => {
      said.textContent = text
    },
    onChange: (settings) => {
      draft = settings
      drawPreview()
    }
  })
  if (!form.empty) {
    side.append(h('section', { class: 'wg-detail-try' },
      h('p', { class: 'wg-label', text: 'Try the settings' }),
      h('p', { class: 'wg-note', text: 'Changed here, nothing is saved. Adding it keeps what you tried.' }),
      form.element,
      said
    ))
  }

  // ---------------------------------------------------------------- adding, and what is already there

  const add = h('button', { class: 'wg-btn primary wg-detail-add', type: 'button', text: 'Add to start page' })
  add.addEventListener('click', () => {
    add.disabled = true
    void deps.link.act({ type: 'add', widget: definition.id, size, settings: draft }).then((reply) => {
      add.disabled = false
      if (!reply.ok) return deps.say(reply.message)
      deps.say(`${definition.name} added`, { label: 'Undo', press: () => void deps.link.act({ type: 'undo' }) })
    })
  })
  const star = h('button', { class: 'wg-btn wg-detail-star', type: 'button', 'aria-pressed': 'false' })
  star.addEventListener('click', () => {
    const board = deps.link.state()?.board
    const on = board ? !board.favourites.includes(definition.id) : true
    star.disabled = true
    void deps.link.act({ type: 'favourite', widget: definition.id, on }).then((reply) => {
      star.disabled = false
      deps.say(reply.ok ? reply.said : reply.message)
    })
  })
  doing.append(offer.ok ? add : h('p', { class: 'wg-detail-no', text: offer.reason }), star)
  side.append(doing, mine)

  // ---------------------------------------------------------------- the plain facts

  const facts = h('dl', { class: 'wg-facts' })
  const fact = (label: string, lines: string[]): void => {
    if (lines.length === 0) return
    facts.append(h('dt', { class: 'wg-label', text: label }), h('dd', {}, ...lines.map((line) => h('p', { text: line }))))
  }
  fact('What it shows', definition.sources)
  fact('What it can read', permissionsOf(definition))
  fact('Connection', [networkWords(definition)])
  fact('How often it looks again', [`It looks again ${refreshWords(definition.refreshMs)}.`])
  fact('Made by', [definition.author])
  side.append(facts)

  if (definition.tags.length > 0) {
    const tags = h('div', { class: 'wg-detail-tags' }, h('p', { class: 'wg-label', text: 'Also found by' }))
    for (const tag of definition.tags) {
      tags.append(button(`Search the gallery for ${tag}`, () => deps.go({ view: 'home', query: tag }), tag, 'wg-chip wg-detail-tag'))
    }
    side.append(tags)
  }

  // ---------------------------------------------------------------- keeping up with the start page

  function showBoard(board: WidgetBoard | null, connected: boolean): void {
    const marked = board ? board.favourites.includes(definition!.id) : false
    star.textContent = marked ? '★ Favourite' : '☆ Make a favourite'
    star.setAttribute('aria-pressed', marked ? 'true' : 'false')
    star.disabled = !connected || board === null
    add.disabled = !connected || board === null
    if (!connected) add.title = 'Orbis is not answering yet.'
    else add.removeAttribute('title')

    mine.replaceChildren()
    if (!board) return
    const here = orderedWidgets(board.instances).filter((one) => one.widget === definition!.id)
    if (here.length === 0) {
      add.textContent = 'Add to start page'
      return
    }
    add.textContent = 'Add another'
    mine.append(h('p', { class: 'wg-label', text: here.length === 1 ? '1 on the start page' : `${here.length} on the start page` }))
    const list = h('ul', { class: 'wg-list wg-detail-list' })
    for (const [at, one] of here.entries()) {
      const row = h('li', { class: 'wg-row' })
      row.append(
        button(`Set up ${definition!.name}, ${placeWords(one, at)}`, () => deps.go({ view: 'instance', id: one.id }), [placeWords(one, at), one.hidden ? ' · hidden' : ''], 'wg-btn wg-row-main'),
        button(`Take this ${definition!.name} off the start page`, () => {
          void deps.link.act({ type: 'remove', id: one.id }).then((reply) => {
            deps.say(reply.ok ? reply.said : reply.message, reply.ok ? { label: 'Undo', press: () => void deps.link.act({ type: 'undo' }) } : undefined)
          })
        }, h('span', { 'aria-hidden': 'true', text: '✕' }), 'wg-icon-btn')
      )
      list.append(row)
    }
    mine.append(list)
  }

  stop = deps.link.subscribe((state, connected) => showBoard(state?.board ?? null, connected))
  drawPreview()
  name.focus()

  return () => {
    stop?.()
    stop = null
    watcher?.disconnect()
    form.destroy()
    card?.destroy()
    card = null
    host.replaceChildren()
  }
}
