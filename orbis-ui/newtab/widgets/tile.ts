import type { PageDeps, WidgetCard, WidgetDefinition } from './api.ts'
import { createCard } from './card.ts'
import { h } from './dom.ts'
import { tileBadges, tileFit } from './galleryLogic.ts'
import { defaultSettings, previewInstance } from './studioLogic.ts'
import type { WidgetBoard } from '../../../src/shared/widgetBoard.ts'

/**
 * One widget in the gallery, drawn as itself.
 *
 * The picture on a tile is not a picture of the widget: it is the widget, built by the same `createCard` the start
 * page builds with, at its real size, shrunk as one piece to fit. So a tile cannot show something the widget does
 * not do, and a widget that changes changes here with it. It is drawn from the sample data every preview uses --
 * nothing of the person's is read to fill the gallery.
 *
 * The drawing is only made when the tile comes into view and is taken away again when it leaves, because twenty-odd
 * live widgets at once is twenty-odd widgets' worth of work for a page somebody is scrolling past.
 */

export interface TileOptions {
  definition: WidgetDefinition
  deps: PageDeps
  /** How things stand right now, read fresh each time rather than kept. */
  board(): WidgetBoard | null
  /** Drawn larger, for the band at the top. */
  hero?: boolean
}

export interface WidgetTile {
  element: HTMLElement
  widget: string
  /** Builds the widget inside the tile. Called when it comes into view. */
  build(): void
  /** Takes the drawing away again and leaves the tile standing. */
  idle(): void
  /** Shows how things stand now: what is on the start page, what is a favourite, what can be pressed. */
  refresh(): void
  /** What the keyboard lands on when this tile is the one. */
  handle: HTMLElement
  /** Puts it on the start page, as pressing the round button would. */
  add(): void
  /** Marks it, or stops marking it. */
  favourite(): void
  destroy(): void
}

/** How much room a tile keeps for the widget, before it has been measured. */
const STAGE = { plain: { width: 182, height: 150 }, hero: { width: 300, height: 190 } }

export function createTile(options: TileOptions): WidgetTile {
  const { definition, deps } = options
  const stage = h('div', { class: 'wg-tile-stage', 'aria-hidden': 'true' }, h('div', { class: 'wg-skeleton wg-tile-wait' }))
  let card: WidgetCard | null = null
  let busy = false

  const open = h('button', { class: 'wg-tile-open', type: 'button' }, h('span', { class: 'wg-tile-name', text: definition.name }))
  open.addEventListener('click', () => deps.go({ view: 'widget', widget: definition.id }))

  const star = h('button', { class: 'wg-icon-btn wg-tile-star', type: 'button', 'aria-pressed': 'false', 'aria-label': `Make ${definition.name} a favourite` },
    h('span', { class: 'wg-tile-star-mark', 'aria-hidden': 'true', text: '★' }))
  star.addEventListener('click', favourite)

  const plus = h('button', { class: 'wg-icon-btn wg-tile-add', type: 'button', 'aria-label': `Add ${definition.name} to the start page` },
    h('span', { 'aria-hidden': 'true', text: '+' }))
  plus.addEventListener('click', add)

  const badges = h('div', { class: 'wg-tile-badges' })
  const element = h('article', { class: 'wg-tile', 'data-widget': definition.id, 'data-size': definition.defaultSize, ...(options.hero ? { 'data-hero': 'true' } : {}) },
    stage,
    h('div', { class: 'wg-tile-meta' },
      h('h3', { class: 'wg-tile-head' }, open),
      h('p', { class: 'wg-tile-say', text: definition.description }),
      badges
    ),
    h('div', { class: 'wg-tile-acts' }, star, plus)
  )
  refresh()

  function refresh(): void {
    const board = options.board()
    const connected = deps.link.connected()
    const marked = board ? board.favourites.includes(definition.id) : false
    star.setAttribute('aria-pressed', marked ? 'true' : 'false')
    star.setAttribute('aria-label', marked ? `${definition.name} is a favourite` : `Make ${definition.name} a favourite`)
    star.toggleAttribute('data-on', marked)
    const stuck = !connected || board === null
    star.disabled = stuck || busy
    plus.disabled = stuck || busy
    plus.title = stuck ? 'Orbis is not answering yet.' : `Add ${definition.name} to the start page`
    badges.replaceChildren()
    if (!board) return
    for (const badge of tileBadges(definition, board)) badges.append(h('span', { class: 'wg-chip wg-tile-badge', 'data-tone': badge.tone, text: badge.text }))
  }

  function add(): void {
    if (plus.disabled) return
    busy = true
    refresh()
    void deps.link.act({ type: 'add', widget: definition.id }).then((reply) => {
      busy = false
      refresh()
      if (!reply.ok) return deps.say(reply.message)
      if (reply.already) return deps.say(reply.said)
      deps.say(`${definition.name} added`, { label: 'Undo', press: () => void deps.link.act({ type: 'undo' }) })
    })
  }

  function favourite(): void {
    if (star.disabled) return
    const board = options.board()
    const on = board ? !board.favourites.includes(definition.id) : true
    busy = true
    refresh()
    void deps.link.act({ type: 'favourite', widget: definition.id, on }).then((reply) => {
      busy = false
      refresh()
      deps.say(reply.ok ? reply.said : reply.message)
    })
  }

  return {
    element,
    widget: definition.id,
    handle: open,
    add,
    favourite,
    refresh,
    build() {
      if (card) return
      const room = stage.getBoundingClientRect()
      const box = { width: room.width || (options.hero ? STAGE.hero.width : STAGE.plain.width), height: room.height || (options.hero ? STAGE.hero.height : STAGE.plain.height) }
      const fit = tileFit(definition.defaultSize, box)
      card = createCard({
        instance: previewInstance(definition, definition.defaultSize, defaultSettings(definition)),
        preview: true,
        link: deps.link,
        hour12: deps.hour12()
      })
      const real = h('div', { class: 'wg-tile-real', style: { width: `${fit.width}px`, height: `${fit.height}px`, transform: `scale(${fit.scale})` } }, card.element)
      stage.replaceChildren(h('div', { class: 'wg-tile-shrink', style: { width: `${fit.boxWidth}px`, height: `${fit.boxHeight}px` } }, real))
    },
    idle() {
      if (!card) return
      card.destroy()
      card = null
      stage.replaceChildren(h('div', { class: 'wg-skeleton wg-tile-wait' }))
    },
    destroy() {
      card?.destroy()
      card = null
      element.remove()
    }
  }
}
