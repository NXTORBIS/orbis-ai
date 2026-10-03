import type { GalleryRoute, GalleryView, PageDeps } from './api.ts'
import { button, h, svg } from './dom.ts'
import { showWidgetDetail } from './detail.ts'
import { showStudio } from './studio.ts'
import { createTile, type WidgetTile } from './tile.ts'
import { drawMark, drawMiniature } from './miniature.ts'
import {
  categoryMark,
  foundWords,
  GALLERY_FILTERS,
  homeSections,
  isBrowsing,
  nextTile,
  offerWidget,
  presetLayout,
  presetNote,
  queryOf,
  type GallerySection
} from './galleryLogic.ts'
import { RENDERERS } from './renderers/index.ts'
import { widgetById, type WidgetDefinition } from '../../../src/shared/widgets.ts'
import { emptyBoard, findWidgets, galleryCategories, searchSuggestions, visibleWidgets, WIDGET_PRESETS, type WidgetBoard } from '../../../src/shared/widgetBoard.ts'
import type { WidgetBoardState } from '../../../src/shared/widgetFeed.ts'

/**
 * Where a person browses every widget Orbis has, and puts one on the start page.
 *
 * Every widget here is drawn for real, by the same code that draws it on the page, from the sample data a preview
 * uses. Nothing in the gallery is a picture of a widget or a description standing in for one, so what is chosen is
 * what arrives.
 *
 * It is a layer over the whole window rather than a page of its own, and where it is -- what was typed, which group,
 * which widget is open -- lives in the page's address. So Back closes what was opened, a reload comes back to the
 * same place, and Orion can open it by opening an address.
 *
 * Drawings are made when a tile scrolls into view and taken away again when it leaves, and none at all are made
 * until the gallery is opened for the first time. A start page nobody customises pays nothing for this screen.
 */

const WAIT_TO_SEARCH = 220
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function mountGallery(host: HTMLElement, deps: PageDeps): GalleryView {
  const drawable = Object.keys(RENDERERS)
  type HomeRoute = Extract<GalleryRoute, { view: 'home' }>
  let route: GalleryRoute = { view: 'closed' }
  /** Where the gallery's front page was, so coming back from a widget comes back to the same search. */
  let lastHome: HomeRoute = { view: 'home' }
  let state: WidgetBoardState | null = null
  let connected = false
  let shell: Shell | null = null
  let page: (() => void) | null = null
  let cameFrom: HTMLElement | null = null
  let typing: ReturnType<typeof setTimeout> | null = null
  let shape = ''

  const tiles = new Map<string, WidgetTile>()
  const byElement = new Map<Element, WidgetTile>()
  let seeing: IntersectionObserver | null = null

  const board = (): WidgetBoard => state?.board ?? emptyBoard()

  const stop = deps.link.subscribe((next, up) => {
    state = next
    connected = up
    if (!shell || route.view === 'closed') return
    const now = signature(state, connected)
    if (now === shape) {
      for (const tile of tiles.values()) tile.refresh()
      return
    }
    shape = now
    draw()
  })

  // ---------------------------------------------------------------- the layer, made once it is first wanted

  interface Shell {
    home: HTMLElement
    body: HTMLElement
    banners: HTMLElement
    rail: HTMLElement
    chips: HTMLElement
    search: HTMLInputElement
    clear: HTMLButtonElement
    pageHost: HTMLElement
    count: HTMLElement
  }

  function ensure(): Shell {
    if (shell) return shell
    host.classList.add('wg-gallery')
    host.setAttribute('role', 'dialog')
    host.setAttribute('aria-modal', 'true')
    host.setAttribute('aria-label', 'Widgets')

    const search = h('input', { class: 'wg-gal-search-input', type: 'search', 'aria-label': 'Search widgets', placeholder: 'Search widgets', autocomplete: 'off', spellcheck: false })
    const clear = h('button', { class: 'wg-icon-btn wg-gal-search-clear', type: 'button', 'aria-label': 'Clear the search' }, h('span', { 'aria-hidden': 'true', text: '✕' }))
    search.addEventListener('input', () => {
      if (typing !== null) clearTimeout(typing)
      typing = setTimeout(() => {
        typing = null
        goHome({ query: search.value.trim() })
      }, WAIT_TO_SEARCH)
    })
    clear.addEventListener('click', () => {
      search.value = ''
      goHome({ query: '' })
      search.focus()
    })

    const banners = h('div', { class: 'wg-gal-banners' })
    const rail = h('nav', { class: 'wg-gal-rail', 'aria-label': 'Groups of widgets' })
    const chips = h('div', { class: 'wg-gal-chips', role: 'group', 'aria-label': 'Which widgets to show' })
    const body = h('div', { class: 'wg-gal-body' })
    const count = h('p', { class: 'wg-gal-count', role: 'status', 'aria-live': 'polite' })

    const home = h('div', { class: 'wg-gal-home' },
      h('header', { class: 'wg-gal-head' },
        h('div', { class: 'wg-gal-head-top' },
          h('h1', { class: 'wg-gal-title', tabindex: '-1', text: 'Widgets' }),
          button('Done, close the widgets', () => deps.go({ view: 'closed' }), 'Done', 'wg-btn primary wg-gal-done')
        ),
        h('div', { class: 'wg-gal-find' },
          h('div', { class: 'wg-gal-search' }, drawMark('ui-search', 18), search, clear),
          chips
        ),
        rail
      ),
      banners,
      count,
      body,
      h('p', { class: 'wg-gal-hint', text: 'Arrow keys move between widgets. Enter opens one, A adds it, F makes it a favourite. Escape goes back.' })
    )
    const pageHost = h('div', { class: 'wg-gal-page' })
    host.replaceChildren(home, pageHost)

    for (const group of [{ id: 'all' as const, name: 'All', count: 0 }, ...galleryCategories()]) {
      const one = h('button', { class: 'wg-gal-rail-one', type: 'button', 'data-group': group.id, 'aria-pressed': 'false' },
        svg('svg', { class: 'wg-mark', viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' }, svg('path', { d: categoryMark(group.id) })),
        h('span', { class: 'wg-gal-rail-name', text: group.name }),
        group.count > 0 ? h('span', { class: 'wg-gal-rail-count', text: String(group.count) }) : null
      )
      one.addEventListener('click', () => goHome({ category: group.id === 'all' ? '' : group.id }))
      rail.append(one)
    }

    for (const filter of GALLERY_FILTERS) {
      const chip = h('button', { class: 'wg-chip wg-gal-chip', type: 'button', 'data-filter': filter.id, 'aria-pressed': 'false', text: filter.label })
      chip.addEventListener('click', () => goHome({ filter: filter.id === 'all' ? '' : filter.id }))
      chips.append(chip)
    }

    host.addEventListener('keydown', onKey)
    seeing = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const tile = byElement.get(entry.target)
          if (!tile) continue
          if (entry.isIntersecting) tile.build()
          else tile.idle()
        }
      }, { root: null, rootMargin: '400px 0px' })
      : null

    shell = { home, body, banners, rail, chips, search, clear, pageHost, count }
    return shell
  }

  /** Goes to the front page, changing only what was asked for and keeping the rest of what was being looked at. */
  function goHome(change: { query?: string; category?: string; filter?: string }): void {
    const was: HomeRoute = route.view === 'home' ? route : lastHome
    const query = change.query ?? was.query ?? ''
    const category = change.category ?? was.category ?? ''
    const filter = change.filter ?? was.filter ?? ''
    deps.go({ view: 'home', ...(query ? { query } : {}), ...(category ? { category } : {}), ...(filter ? { filter } : {}) })
  }

  // ---------------------------------------------------------------- being told where to be

  function show(next: GalleryRoute): void {
    const was = route
    route = next
    if (next.view === 'closed') {
      close()
      return
    }
    const parts = ensure()
    if (was.view === 'closed') {
      cameFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null
      host.removeAttribute('hidden')
      host.classList.add('wg-gallery-open')
      shape = signature(state, connected)
    }
    if (next.view === 'home') {
      lastHome = next
      page?.()
      page = null
      parts.pageHost.replaceChildren()
      parts.pageHost.hidden = true
      parts.home.hidden = false
      draw()
      if (was.view === 'closed') parts.search.focus()
      return
    }
    // A widget's own page, or one that is on the start page: the front page stays made but goes out of the way, and
    // every tile on it stops being drawn, because nothing hidden can be seen by the watcher.
    parts.home.hidden = true
    parts.pageHost.hidden = false
    if (nameOf(was) === nameOf(next)) return
    page?.()
    page = next.view === 'widget' ? showWidgetDetail(parts.pageHost, next.widget, deps) : showStudio(parts.pageHost, next.id, deps)
  }

  function close(): void {
    page?.()
    page = null
    if (typing !== null) clearTimeout(typing)
    typing = null
    for (const tile of tiles.values()) tile.destroy()
    tiles.clear()
    byElement.clear()
    if (shell) {
      shell.body.replaceChildren()
      shell.pageHost.replaceChildren()
    }
    host.setAttribute('hidden', '')
    host.classList.remove('wg-gallery-open')
    cameFrom?.focus()
    cameFrom = null
  }

  // ---------------------------------------------------------------- drawing the front page

  function draw(): void {
    const parts = ensure()
    if (route.view !== 'home') return
    const asked = queryOf(route)
    const here = board()

    if (!parts.search.matches(':focus') && parts.search.value !== (asked.query ?? '')) parts.search.value = asked.query ?? ''
    parts.clear.hidden = parts.search.value === ''
    for (const one of parts.rail.children) {
      if (one instanceof HTMLElement) one.setAttribute('aria-pressed', one.dataset.group === (asked.category === 'all' ? 'all' : asked.category) ? 'true' : 'false')
    }
    for (const one of parts.chips.children) {
      if (one instanceof HTMLElement) one.setAttribute('aria-pressed', one.dataset.filter === asked.filter ? 'true' : 'false')
    }

    drawBanners(parts.banners, here)

    const wanted = new Set<string>()
    const body = h('div', { class: 'wg-gal-sections' })

    if (isBrowsing(route)) {
      const found = findWidgets(asked, here)
      const ready = found.filter((one) => offerWidget(one, drawable).ok)
      const notYet = found.filter((one) => !offerWidget(one, drawable).ok)
      parts.count.textContent = `${foundWords(ready.length)}${notYet.length > 0 ? `, and ${notYet.length} that cannot be added yet` : ''}`
      if (found.length === 0) body.append(drawNothing(asked.query ?? ''))
      else {
        if (ready.length > 0) body.append(drawGrid('results', ready.map((one) => one.id), false, wanted))
        if (notYet.length > 0) body.append(drawSection({ id: 'missing', key: 'results-missing', title: 'Not available yet', widgets: [], missing: notYet.map((one) => ({ widget: one.id, reason: reasonFor(one) })) }, here, wanted))
      }
    } else {
      parts.count.textContent = ''
      for (const section of homeSections({ board: here, layouts: state?.layouts ?? [], drawable })) body.append(drawSection(section, here, wanted))
    }

    for (const [key, tile] of [...tiles]) {
      if (wanted.has(key)) continue
      byElement.delete(tile.element)
      seeing?.unobserve(tile.element)
      tile.destroy()
      tiles.delete(key)
    }
    parts.body.replaceChildren(body)
  }

  function drawBanners(into: HTMLElement, here: WidgetBoard): void {
    into.replaceChildren()
    if (!connected) {
      into.append(h('div', { class: 'wg-gal-banner', role: 'status' },
        h('p', { class: 'wg-gal-banner-say', text: 'Orbis is not answering, so nothing can be added yet. What is shown below is still what each widget looks like.' })
      ))
    }
    if (state && !here.enabled) {
      const show = h('button', { class: 'wg-btn primary', type: 'button', text: 'Show widgets on the start page' })
      show.addEventListener('click', () => {
        show.disabled = true
        void deps.link.act({ type: 'enable', on: true }).then((reply) => {
          show.disabled = false
          deps.say(reply.ok ? reply.said : reply.message)
        })
      })
      into.append(h('div', { class: 'wg-gal-banner', 'data-tone': 'warn' },
        h('p', { class: 'wg-gal-banner-say', text: 'Widgets are switched off on the start page. They are all still here.' }),
        show
      ))
    }
  }

  function drawNothing(query: string): HTMLElement {
    const block = h('div', { class: 'wg-state wg-gal-nothing' },
      h('p', { class: 'wg-big', text: 'Nothing found' }),
      h('p', { text: query === '' ? 'No widget matches what you chose.' : `No widget matches "${query}".` })
    )
    const tries = h('div', { class: 'wg-row wg-gal-tries' })
    for (const word of searchSuggestions(5)) {
      tries.append(button(`Search for ${word}`, () => goHome({ query: word, category: '', filter: '' }), word, 'wg-chip'))
    }
    block.append(button('Start again', () => goHome({ query: '', category: '', filter: '' }), 'Start again', 'wg-btn primary'), tries)
    return block
  }

  // ---------------------------------------------------------------- one band

  function drawSection(section: GallerySection, here: WidgetBoard, wanted: Set<string>): HTMLElement {
    const block = h('section', { class: 'wg-band', 'data-band': section.id },
      h('div', { class: 'wg-band-head' },
        h('h2', { class: 'wg-band-title', text: section.title }),
        section.note ? h('p', { class: 'wg-band-note', text: section.note }) : null
      )
    )
    if (section.id === 'board') block.append(drawBoardPicture(here))
    else if (section.presets) block.append(drawPresets(section.presets, here))
    else if (section.layouts) block.append(drawLayouts(section.layouts))
    else if (section.missing) block.append(drawMissing(section.missing))
    else block.append(drawGrid(section.key, section.widgets, section.hero === true, wanted))
    return block
  }

  function drawGrid(key: string, widgets: string[], hero: boolean, wanted: Set<string>): HTMLElement {
    const grid = h('div', { class: 'wg-grid', role: 'list', ...(hero ? { 'data-hero': 'true' } : {}) })
    for (const id of widgets) {
      const definition = widgetById(id)
      if (!definition) continue
      const mine = `${key}:${id}`
      wanted.add(mine)
      let tile = tiles.get(mine)
      if (!tile) {
        tile = createTile({ definition, deps, board: () => state?.board ?? null, hero })
        tiles.set(mine, tile)
        byElement.set(tile.element, tile)
        seeing?.observe(tile.element)
      } else {
        tile.refresh()
      }
      tile.element.setAttribute('role', 'listitem')
      grid.append(tile.element)
    }
    grid.addEventListener('keydown', (event) => onGridKey(event, grid))
    return grid
  }

  function onGridKey(event: KeyboardEvent, grid: HTMLElement): void {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains('wg-tile-open')) return
    const handles = [...grid.querySelectorAll<HTMLElement>('.wg-tile-open')]
    const at = handles.indexOf(target)
    if (at < 0) return
    const key = event.key
    if (key === 'a' || key === 'A' || key === 'f' || key === 'F') {
      const tile = byElement.get(target.closest('.wg-tile') ?? target)
      if (!tile) return
      event.preventDefault()
      if (key === 'a' || key === 'A') tile.add()
      else tile.favourite()
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return
    const top = handles[0].getBoundingClientRect().top
    const columns = Math.max(1, handles.filter((one) => Math.abs(one.getBoundingClientRect().top - top) < 4).length)
    const to = nextTile(at, key, columns, handles.length)
    if (to === at || to < 0) return
    event.preventDefault()
    handles[to].focus()
  }

  function drawBoardPicture(here: WidgetBoard): HTMLElement {
    const shown = visibleWidgets(here.instances)
    const picture = drawMiniature(shown, { width: 320, columns: 4, mostRows: 4, label: `Your start page, ${shown.length === 1 ? '1 widget' : `${shown.length} widgets`}` })
    const arrange = h('button', { class: 'wg-btn primary', type: 'button', text: 'Arrange' })
    arrange.addEventListener('click', () => deps.arrange(true))
    return h('div', { class: 'wg-board-picture' },
      h('div', { class: 'wg-board-picture-art' }, picture.element),
      h('div', { class: 'wg-board-picture-say' },
        picture.shape.hidden > 0 ? h('p', { class: 'wg-note', text: `${picture.shape.hidden} more below what is drawn here.` }) : null,
        h('p', { class: 'wg-sub', text: 'Move them about, change their size, or take one off.' }),
        arrange
      )
    )
  }

  function drawPresets(ids: string[], here: WidgetBoard): HTMLElement {
    const row = h('div', { class: 'wg-presets', role: 'list' })
    for (const id of ids) {
      const preset = WIDGET_PRESETS.find((one) => one.id === id)
      const made = preset ? presetLayout(preset) : null
      if (!preset || !made) continue
      const use = h('button', { class: 'wg-btn primary', type: 'button', text: 'Use this layout' })
      use.disabled = !connected || state === null
      use.addEventListener('click', () => {
        use.disabled = true
        void deps.link.act({ type: 'preset', preset: preset.id }).then((reply) => {
          use.disabled = false
          if (!reply.ok) return deps.say(reply.message)
          deps.say(reply.said, { label: 'Undo', press: () => void deps.link.act({ type: 'undo' }) })
        })
      })
      row.append(h('article', { class: 'wg-preset', role: 'listitem' },
        h('div', { class: 'wg-preset-art' }, drawMiniature(made, { width: 236, columns: 4, mostRows: 3, label: `What the ${preset.name} layout looks like` }).element),
        h('h3', { class: 'wg-preset-name', text: preset.name }),
        h('p', { class: 'wg-preset-say', text: preset.describe }),
        h('p', { class: 'wg-note', text: presetNote(preset, here) }),
        use
      ))
    }
    return row
  }

  function drawLayouts(ids: string[]): HTMLElement {
    const list = h('ul', { class: 'wg-saved', role: 'list' })
    for (const id of ids) {
      const saved = state?.layouts.find((one) => one.id === id)
      if (!saved) continue
      const row = h('li', { class: 'wg-saved-one' })
      const acts = h('div', { class: 'wg-row wg-saved-acts' })
      const use = h('button', { class: 'wg-btn primary', type: 'button', text: 'Use it' })
      use.addEventListener('click', () => {
        use.disabled = true
        void deps.link.act({ type: 'layout.use', id }).then((reply) => {
          use.disabled = false
          if (!reply.ok) return deps.say(reply.message)
          deps.say(reply.said, { label: 'Undo', press: () => void deps.link.act({ type: 'undo' }) })
        })
      })
      const forget = h('button', { class: 'wg-btn', type: 'button', text: 'Forget it' })
      forget.addEventListener('click', () => {
        const yes = h('button', { class: 'wg-btn wg-studio-danger', type: 'button', text: `Forget "${saved.name}"` })
        const no = h('button', { class: 'wg-btn', type: 'button', text: 'Keep it' })
        yes.addEventListener('click', () => {
          yes.disabled = true
          void deps.link.act({ type: 'layout.remove', id }).then((reply) => deps.say(reply.ok ? reply.said : reply.message))
        })
        no.addEventListener('click', () => {
          acts.replaceChildren(use, forget)
          forget.focus()
        })
        acts.replaceChildren(yes, no)
        yes.focus()
      })
      acts.append(use, forget)
      row.append(
        h('div', { class: 'wg-saved-say' },
          h('h3', { class: 'wg-saved-name', text: saved.name }),
          h('p', { class: 'wg-sub', text: saved.widgets === 1 ? '1 widget' : `${saved.widgets} widgets` })
        ),
        acts
      )
      list.append(row)
    }
    return list
  }

  function drawMissing(missing: { widget: string; reason: string }[]): HTMLElement {
    const list = h('ul', { class: 'wg-missing', role: 'list' })
    for (const one of missing) {
      const definition = widgetById(one.widget)
      if (!definition) continue
      list.append(h('li', { class: 'wg-missing-one' },
        drawMark(definition.icon, 22),
        h('div', { class: 'wg-missing-say' },
          h('h3', { class: 'wg-missing-name', text: definition.name }),
          h('p', { class: 'wg-sub', text: one.reason })
        )
      ))
    }
    return list
  }

  const reasonFor = (definition: WidgetDefinition): string => {
    const offer = offerWidget(definition, drawable)
    return offer.ok ? '' : offer.reason
  }

  // ---------------------------------------------------------------- the keyboard, over the whole layer

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (route.view === 'widget' || route.view === 'instance') deps.go(lastHome)
      else deps.go({ view: 'closed' })
      return
    }
    if (event.key === '/' && !inABox(event.target)) {
      event.preventDefault()
      shell?.search.focus()
      shell?.search.select()
      return
    }
    if (event.key !== 'Tab') return
    const inside = [...host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((one) => one.getClientRects().length > 0)
    if (inside.length === 0) return
    const first = inside[0]
    const last = inside[inside.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  host.setAttribute('hidden', '')

  return {
    show,
    route: () => route,
    destroy() {
      stop()
      close()
      seeing?.disconnect()
      seeing = null
      host.removeEventListener('keydown', onKey)
      host.replaceChildren()
      shell = null
    }
  }
}

// ---------------------------------------------------------------- small things

/** Which exact screen a route asks for, so going to the one already open does not take it apart and build it again. */
const nameOf = (route: GalleryRoute): string => (route.view === 'widget' ? `widget:${route.widget}` : route.view === 'instance' ? `instance:${route.id}` : route.view)

const inABox = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)

/**
 * What the gallery's bands are made of, in one line.
 *
 * Only a change to this changes which bands are drawn; anything else -- a widget being resized, a setting changed --
 * leaves the gallery as it is and simply tells each tile to look again. Without this, every keystroke somewhere else
 * on the page would rebuild the gallery under the person's hands.
 */
function signature(state: WidgetBoardState | null, connected: boolean): string {
  if (!state) return `none:${connected}`
  const board = state.board
  return [
    connected,
    board.enabled,
    visibleWidgets(board.instances).map((one) => one.widget).join(','),
    board.instances.length,
    board.favourites.join(','),
    board.recent.map((one) => one.widget).join(','),
    state.layouts.map((one) => `${one.id}/${one.name}/${one.widgets}`).join(',')
  ].join('|')
}

