import type { BoardView, PageDeps, WidgetCard } from './api.ts'
import { createCard } from './card.ts'
import { button, clear, h, icon } from './dom.ts'
import { closeMenus, openMenu, type MenuItem } from './menu.ts'
import { cellAt, layoutIfMoved, nearestSize, orderFromCell, spanFromPixels, stepOrder, stepSize, type GridBox } from './boardMath.ts'
import { columnsFor, GRID, orderedWidgets, packBoard, visibleWidgets, type WidgetBoard } from '../../../src/shared/widgetBoard.ts'
import { SIZE_NAMES, TONE_NAMES, widgetById, type WidgetInstance, type WidgetLook, type WidgetSize } from '../../../src/shared/widgets.ts'
import type { WidgetBoardState } from '../../../src/shared/widgetFeed.ts'

/**
 * The board of widgets under the search box, and arranging it.
 *
 * Every card is placed on the grid by `packBoard` -- the same sum the gallery's miniature and the outline shown
 * while dragging use -- so what is on the page, what the gallery shows and where a card is about to land cannot
 * disagree with one another.
 *
 * Nothing here keeps its own copy of the board. A change is asked for, and the board is drawn again from what Orbis
 * sends back. That is slower than guessing by a few milliseconds and it means the page is never showing a
 * rearrangement that was in fact refused.
 *
 * At rest there is nothing on a card but what the widget is for: no title bar, no buttons. Pressing "Arrange"
 * brings out the handles, the tray of hidden widgets, undo and redo.
 */

/** How long to wait before saying Orbis is not running: it starts a moment after the browser does. */
const PATIENCE = 4_000

export function mountBoard(host: HTMLElement, deps: PageDeps): BoardView {
  const bar = h('div', { class: 'wg-arrange-bar', hidden: true })
  const grid = h('div', { class: 'wg-board', role: 'list' })
  const tray = h('div', { class: 'wg-tray', hidden: true })
  const spoken = h('p', { class: 'wg-spoken', role: 'status', 'aria-live': 'polite' })
  host.append(bar, grid, tray, spoken)

  const cards = new Map<string, WidgetCard>()
  let state: WidgetBoardState | null = null
  let connected = false
  let arranging = false
  let columns = 1
  let waitedFrom = Date.now()
  /** A widget set aside by this page after it threw three times: kept here so one bad widget cannot spin. */
  const failures = new Map<string, number>()

  const say = (words: string): void => {
    spoken.textContent = words
  }

  const boardNow = (): WidgetBoard | null => state?.board ?? null

  // ---------------------------------------------------------------- drawing

  const measure = (): GridBox => {
    const where = grid.getBoundingClientRect()
    return { left: where.left, top: where.top, cell: GRID.cell, gap: GRID.gap, columns }
  }

  const place = (node: HTMLElement, at: { x: number; y: number; w: number; h: number }): void => {
    node.style.gridColumn = `${at.x + 1} / span ${at.w}`
    node.style.gridRow = `${at.y + 1} / span ${at.h}`
  }

  const draw = (): void => {
    const board = boardNow()
    const shown = board && board.enabled ? visibleWidgets(board.instances) : []
    grid.style.setProperty('--wg-columns', String(columns))

    // Nothing known yet. Orbis starts a moment after the browser, so the board stays quiet before it says anything.
    if (!board) return Date.now() - waitedFrom > PATIENCE ? drawWaiting() : undefined

    // Cards that have gone.
    for (const [id, card] of [...cards]) {
      if (!shown.some((one) => one.id === id)) {
        card.destroy()
        cards.delete(id)
      }
    }

    const { placed, rows } = packBoard(shown, columns)
    const wraps = new Map<string, HTMLElement>()
    for (const one of shown) {
      let card = cards.get(one.id)
      if (!card) {
        card = createCard({
          instance: one,
          preview: false,
          link: deps.link,
          hour12: deps.hour12(),
          onSettings: (which) => deps.go({ view: 'instance', id: which.id }),
          onFailure: (which) => noteFailure(which)
        })
        cards.set(one.id, card)
      } else {
        card.update(one)
      }
      const wrap = card.element.parentElement?.classList.contains('wg-slot') ? (card.element.parentElement as HTMLElement) : h('div', { class: 'wg-slot', role: 'listitem' })
      if (!wrap.contains(card.element)) wrap.append(card.element)
      wrap.dataset.id = one.id
      wraps.set(one.id, wrap)
    }

    grid.replaceChildren(...placed.map((at) => {
      const wrap = wraps.get(at.id)!
      place(wrap, at)
      dressSlot(wrap, shown.find((one) => one.id === at.id)!)
      return wrap
    }))
    // The outline lives in the grid so it can be placed in its cells, and so it has to be put back after a redraw.
    grid.append(outline)
    grid.style.setProperty('--wg-rows', String(Math.max(1, rows)))
    grid.hidden = shown.length === 0

    drawEmpty(shown.length)
    drawBar()
    drawTray()
    report()
  }

  /** The one line shown when Orbis has not answered: never an empty board passed off as the answer. */
  const drawWaiting = (): void => {
    grid.hidden = true
    tray.hidden = true
    bar.hidden = true
    const already = host.querySelector('.wg-offline')
    if (already) return
    host.append(h('p', { class: 'wg-offline', text: 'Widgets need Orbis to be running.' }))
    report()
  }

  const drawEmpty = (count: number): void => {
    host.querySelector('.wg-offline')?.remove()
    // Orbis has stopped answering but the board is still on screen: said once, quietly, rather than left to look live.
    if (!connected && Date.now() - waitedFrom > PATIENCE) host.append(h('p', { class: 'wg-offline', text: 'Orbis is not answering, so what is shown may be out of date.' }))
    host.querySelector('.wg-add-tile')?.remove()
    const board = boardNow()
    /*
     * With nothing on the board there is one quiet way in, whether or not widgets are switched on.
     *
     * "Switched off" is about hiding widgets somebody has; with none, it hides nothing, and a start page that
     * offered no way to add one would be a feature nobody could find.
     */
    if (count > 0 || !board) return
    const tile = h('button', { class: 'wg-add-tile', type: 'button' })
    tile.append(icon('settings', 20), h('span', { text: 'Add widgets' }))
    tile.addEventListener('click', () => deps.go({ view: 'home' }))
    host.insertBefore(tile, tray)
  }

  // ---------------------------------------------------------------- a card while arranging

  const dressSlot = (wrap: HTMLElement, one: WidgetInstance): void => {
    wrap.querySelector('.wg-handles')?.remove()
    wrap.classList.toggle('arranging', arranging)
    wrap.tabIndex = arranging ? 0 : -1
    if (arranging) {
      const definition = widgetById(one.widget)
      wrap.setAttribute('aria-label', `${definition?.name ?? one.widget}. Arrow keys move it, plus and minus change its size, Enter opens its settings.`)
    } else wrap.removeAttribute('aria-label')
    if (!arranging) return

    const name = widgetById(one.widget)?.name ?? one.widget
    const handles = h('div', { class: 'wg-handles' })
    handles.append(
      button(`Remove ${name}`, () => void change({ type: 'remove', id: one.id }, `${name} removed`, { type: 'undo' }), icon('close', 14), 'wg-icon-btn wg-handle wg-handle-remove'),
      h('div', { class: 'wg-handle-group' },
        button(`${name} settings`, () => deps.go({ view: 'instance', id: one.id }), icon('settings', 14), 'wg-icon-btn wg-handle'),
        button(`Size of ${name}`, (event) => sizeMenu(event, one), icon('tabs', 14), 'wg-icon-btn wg-handle'),
        button(one.locked ? `Unlock ${name}` : `Lock ${name}`, () => void change({ type: 'lock', id: one.id, locked: !one.locked }), icon(one.locked ? 'lock' : 'unlock', 14), 'wg-icon-btn wg-handle'),
        button(`Hide ${name}`, () => void change({ type: 'hide', id: one.id, hidden: true }, `${name} hidden`, { type: 'hide', id: one.id, hidden: false }), icon('history', 14), 'wg-icon-btn wg-handle')
      )
    )
    if (!one.locked) handles.append(h('div', { class: 'wg-grip', 'aria-hidden': 'true' }))
    wrap.append(handles)
  }

  const sizeMenu = (event: MouseEvent, one: WidgetInstance): void => {
    const definition = widgetById(one.widget)
    if (!definition) return
    openMenu({ x: event.clientX, y: event.clientY }, definition.sizes.map((size) => ({
      label: SIZE_NAMES[size],
      on: size === one.size,
      press: () => void change({ type: 'resize', id: one.id, size })
    })), { label: `Size of ${definition.name}`, returnTo: event.currentTarget as HTMLElement })
  }

  // ---------------------------------------------------------------- the bar above the grid

  const drawBar = (): void => {
    bar.hidden = !arranging
    if (!arranging) return
    clear(bar)
    const canUndo = state?.canUndo === true
    const canRedo = state?.canRedo === true
    bar.append(
      button('Add widgets', () => deps.go({ view: 'home' }), [icon('extensions', 15), h('span', { text: 'Add widgets' })], 'wg-btn primary'),
      button('Take back the last change', () => void change({ type: 'undo' }), [icon('history', 15), h('span', { text: 'Undo' })], `wg-btn${canUndo ? '' : ' off'}`),
      button('Put the change back', () => void change({ type: 'redo' }), h('span', { text: 'Redo' }), `wg-btn${canRedo ? '' : ' off'}`),
      button('Layouts', (event) => layoutMenu(event), [icon('workspaces', 15), h('span', { text: 'Layouts' })], 'wg-btn'),
      h('span', { class: 'wg-bar-space' }),
      button('Done arranging', () => arrange(false), h('span', { text: 'Done' }), 'wg-btn')
    )
    for (const [node, on] of [[bar.children[1], canUndo], [bar.children[2], canRedo]] as [HTMLButtonElement, boolean][]) node.disabled = !on
  }

  const layoutMenu = (event: MouseEvent): void => {
    const items: MenuItem[] = [{ label: 'Save this layout…', press: askLayoutName }]
    for (const layout of state?.layouts ?? []) {
      items.push({
        label: `${layout.name} (${layout.widgets} ${layout.widgets === 1 ? 'widget' : 'widgets'})`,
        separated: items.length === 1,
        items: [
          { label: 'Put it on the start page', press: () => void change({ type: 'layout.use', id: layout.id }) },
          { label: 'Forget it', press: () => void change({ type: 'layout.remove', id: layout.id }) }
        ]
      })
    }
    items.push({ label: 'Ready-made layouts…', separated: true, press: () => deps.go({ view: 'home' }) })
    openMenu({ x: event.clientX, y: event.clientY }, items, { label: 'Layouts', returnTo: event.currentTarget as HTMLElement })
  }

  /** Asks for a name in the bar itself. A browser's own prompt box is not something Orbis should be putting up. */
  const askLayoutName = (): void => {
    clear(bar)
    const field = h('input', { class: 'wg-name-field', type: 'text', maxLength: '60', placeholder: 'Name this layout', 'aria-label': 'Name this layout' })
    const save = async (): Promise<void> => {
      const name = field.value.trim()
      if (!name) return void field.focus()
      await change({ type: 'layout.save', name })
      drawBar()
    }
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void save()
      if (event.key === 'Escape') drawBar()
    })
    bar.append(field, button('Save the layout', () => void save(), h('span', { text: 'Save' }), 'wg-btn primary'), button('Cancel', drawBar, h('span', { text: 'Cancel' }), 'wg-btn'))
    field.focus()
  }

  // ---------------------------------------------------------------- hidden and set-aside widgets

  const drawTray = (): void => {
    const board = boardNow()
    const aside = board ? orderedWidgets(board.instances).filter((one) => one.hidden || one.disabled) : []
    tray.hidden = !arranging || aside.length === 0
    if (tray.hidden) return
    clear(tray)
    tray.append(h('p', { class: 'wg-label', text: 'Not on the page' }))
    const row = h('div', { class: 'wg-tray-row' })
    for (const one of aside) {
      const name = widgetById(one.widget)?.name ?? one.widget
      const chip = h('div', { class: 'wg-tray-chip' }, icon(widgetById(one.widget)?.icon ?? 'extensions', 15), h('span', { text: name }))
      if (one.disabled) chip.append(h('span', { class: 'wg-tray-why', text: 'stopped working' }))
      chip.append(
        button(one.disabled ? `Start ${name} again` : `Show ${name} again`, () => void change(one.disabled ? { type: 'revive', id: one.id } : { type: 'hide', id: one.id, hidden: false }), h('span', { text: one.disabled ? 'Start again' : 'Show' }), 'wg-btn'),
        button(`Remove ${name}`, () => void change({ type: 'remove', id: one.id }, `${name} removed`, { type: 'undo' }), icon('close', 13), 'wg-icon-btn')
      )
      row.append(chip)
    }
    tray.append(row)
  }

  // ---------------------------------------------------------------- asking Orbis for a change

  type Request = Parameters<PageDeps['link']['act']>[0]

  const change = async (request: Request, said?: string, undo?: Request): Promise<boolean> => {
    const reply = await deps.link.act(request)
    if (!reply.ok) {
      deps.say(reply.message)
      say(reply.message)
      return false
    }
    const words = said ?? reply.said
    if (words) {
      say(words)
      deps.say(words, undo ? { label: 'Undo', press: () => void change(undo) } : undefined)
    }
    return true
  }

  /**
   * A widget that keeps breaking is set aside, with its reason kept.
   *
   * Three times in a row, not once: a widget can fail because the thing it reads was busy for a moment, and setting
   * it aside for that would be worse than showing it again.
   */
  const noteFailure = (one: WidgetInstance): void => {
    const count = (failures.get(one.id) ?? 0) + 1
    failures.set(one.id, count)
    if (count < 3 || one.disabled) return
    const name = widgetById(one.widget)?.name ?? one.widget
    say(`${name} kept failing and has been set aside.`)
    deps.say(`${name} kept failing and has been set aside. It is under "Not on the page" while arranging.`)
  }

  // ---------------------------------------------------------------- dragging and resizing

  let dragging: { id: string; pointer: number; from: { x: number; y: number }; to: number; node: HTMLElement; box: GridBox; rows: number } | null = null
  let resizing: { id: string; pointer: number; from: { x: number; y: number }; size: WidgetSize; node: HTMLElement; box: GridBox; start: { w: number; h: number } } | null = null
  const outline = h('div', { class: 'wg-drop', hidden: true, 'aria-hidden': 'true' })
  grid.append(outline)

  grid.addEventListener('pointerdown', (event) => {
    if (!arranging || event.button !== 0) return
    const slot = (event.target as HTMLElement).closest('.wg-slot') as HTMLElement | null
    if (!slot) return
    const id = slot.dataset.id ?? ''
    const one = boardNow()?.instances.find((other) => other.id === id)
    if (!one) return
    const onHandle = (event.target as HTMLElement).closest('.wg-handle, .wg-btn, .wg-icon-btn')
    if (onHandle) return

    const grip = (event.target as HTMLElement).closest('.wg-grip')
    if (one.locked) {
      const name = widgetById(one.widget)?.name ?? one.widget
      deps.say(`${name} is locked. Unlock it to move or resize it.`)
      return
    }
    const where = slot.getBoundingClientRect()
    event.preventDefault()
    slot.setPointerCapture(event.pointerId)
    if (grip) {
      resizing = { id, pointer: event.pointerId, from: { x: event.clientX, y: event.clientY }, size: one.size, node: slot, box: measure(), start: { w: where.width, h: where.height } }
      slot.classList.add('resizing')
      return
    }
    const { placed, rows } = packBoard(visibleWidgets(boardNow()?.instances ?? []), columns)
    dragging = { id, pointer: event.pointerId, from: { x: event.clientX, y: event.clientY }, to: placed.findIndex((other) => other.id === id), node: slot, box: measure(), rows }
    slot.classList.add('dragging')
  })

  grid.addEventListener('pointermove', (event) => {
    if (dragging && event.pointerId === dragging.pointer) {
      const dx = event.clientX - dragging.from.x
      const dy = event.clientY - dragging.from.y
      dragging.node.style.setProperty('--wg-drag-x', `${Math.round(dx)}px`)
      dragging.node.style.setProperty('--wg-drag-y', `${Math.round(dy)}px`)
      const cell = cellAt(dragging.box, event.clientX, event.clientY, dragging.rows)
      const to = orderFromCell(boardNow()?.instances ?? [], dragging.id, cell.column, cell.row, columns)
      dragging.to = to
      showDrop(to)
      edgeScroll(event.clientY)
      return
    }
    if (resizing && event.pointerId === resizing.pointer) {
      const definition = widgetById(boardNow()?.instances.find((one) => one.id === resizing!.id)?.widget ?? '')
      if (!definition) return
      const span = spanFromPixels(resizing.box, resizing.start.w + (event.clientX - resizing.from.x), resizing.start.h + (event.clientY - resizing.from.y))
      const size = nearestSize(definition.sizes, span.across, span.down, columns)
      if (size) {
        resizing.size = size
        showResize(resizing.id, size)
      }
    }
  })

  const stop = (event: PointerEvent): void => {
    if (dragging && event.pointerId === dragging.pointer) {
      const { id, to, node } = dragging
      dragging = null
      node.classList.remove('dragging')
      node.style.removeProperty('--wg-drag-x')
      node.style.removeProperty('--wg-drag-y')
      outline.hidden = true
      void change({ type: 'move', id, to })
      return
    }
    if (resizing && event.pointerId === resizing.pointer) {
      const { id, size, node } = resizing
      resizing = null
      node.classList.remove('resizing')
      outline.hidden = true
      void change({ type: 'resize', id, size })
    }
  }
  grid.addEventListener('pointerup', stop)
  grid.addEventListener('pointercancel', () => {
    // The gesture was taken away: put everything back rather than saving a half-finished move.
    if (dragging) {
      dragging.node.classList.remove('dragging')
      dragging.node.style.removeProperty('--wg-drag-x')
      dragging.node.style.removeProperty('--wg-drag-y')
    }
    resizing?.node.classList.remove('resizing')
    dragging = null
    resizing = null
    outline.hidden = true
  })

  /** The outline of where the card would land, worked out by laying the whole board out as it would be. */
  const showDrop = (to: number): void => {
    const laid = layoutIfMoved(boardNow()?.instances ?? [], dragging?.id ?? '', to, columns)
    const at = laid.placed.find((one) => one.id === dragging?.id)
    if (!at) return
    place(outline, at)
    outline.hidden = false
  }

  const showResize = (id: string, size: WidgetSize): void => {
    const board = boardNow()
    if (!board) return
    const laid = packBoard(visibleWidgets(board.instances).map((one) => (one.id === id ? { ...one, size } : one)), columns)
    const at = laid.placed.find((one) => one.id === id)
    if (!at) return
    place(outline, at)
    outline.hidden = false
  }

  let scrolling = 0
  const edgeScroll = (y: number): void => {
    clearTimeout(scrolling)
    const near = 90
    const by = y < near ? -14 : y > window.innerHeight - near ? 14 : 0
    if (by === 0) return
    window.scrollBy({ top: by })
    scrolling = setTimeout(() => edgeScroll(y), 40) as unknown as number
  }

  // ---------------------------------------------------------------- the keyboard, and the menu

  grid.addEventListener('keydown', (event) => {
    const slot = (event.target as HTMLElement).closest('.wg-slot') as HTMLElement | null
    if (!slot || !arranging) return
    const id = slot.dataset.id ?? ''
    const one = boardNow()?.instances.find((other) => other.id === id)
    if (!one) return
    const definition = widgetById(one.widget)
    const name = definition?.name ?? one.widget

    const nudge = (by: 1 | -1): void => {
      const to = stepOrder(boardNow()?.instances ?? [], id, by)
      if (to === null) return void say(`${name} is already at the ${by === 1 ? 'end' : 'start'}.`)
      void change({ type: 'move', id, to }).then((ok) => ok && focusAgain(id))
    }

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        return nudge(-1)
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        return nudge(1)
      case '+':
      case '=': {
        event.preventDefault()
        const size = definition ? stepSize(definition.sizes, one.size, 1) : null
        return size ? void change({ type: 'resize', id, size }).then((ok) => ok && focusAgain(id)) : void say(`${name} is already as large as it comes.`)
      }
      case '-':
      case '_': {
        event.preventDefault()
        const size = definition ? stepSize(definition.sizes, one.size, -1) : null
        return size ? void change({ type: 'resize', id, size }).then((ok) => ok && focusAgain(id)) : void say(`${name} is already as small as it comes.`)
      }
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        return void change({ type: 'remove', id }, `${name} removed`, { type: 'undo' })
      case 'Enter':
        event.preventDefault()
        return deps.go({ view: 'instance', id })
      case 'l':
      case 'L':
        event.preventDefault()
        return void change({ type: 'lock', id, locked: !one.locked })
      case 'h':
      case 'H':
        event.preventDefault()
        return void change({ type: 'hide', id, hidden: true }, `${name} hidden`, { type: 'hide', id, hidden: false })
      case 'F10':
        if (!event.shiftKey) return
        event.preventDefault()
        return cardMenu(slot.getBoundingClientRect().left + 20, slot.getBoundingClientRect().top + 20, one, slot)
      case 'ContextMenu':
        event.preventDefault()
        return cardMenu(slot.getBoundingClientRect().left + 20, slot.getBoundingClientRect().top + 20, one, slot)
      default:
        return
    }
  })

  const focusAgain = (id: string): void => {
    const slot = grid.querySelector(`.wg-slot[data-id="${CSS.escape(id)}"]`) as HTMLElement | null
    slot?.focus()
  }

  grid.addEventListener('contextmenu', (event) => {
    const slot = (event.target as HTMLElement).closest('.wg-slot') as HTMLElement | null
    if (!slot) return
    const one = boardNow()?.instances.find((other) => other.id === slot.dataset.id)
    if (!one) return
    event.preventDefault()
    cardMenu(event.clientX, event.clientY, one, slot)
  })

  const cardMenu = (x: number, y: number, one: WidgetInstance, returnTo: HTMLElement): void => {
    const definition = widgetById(one.widget)
    const name = definition?.name ?? one.widget
    openMenu({ x, y }, [
      { label: 'Settings', press: () => deps.go({ view: 'instance', id: one.id }) },
      { label: 'Size', items: (definition?.sizes ?? []).map((size) => ({ label: SIZE_NAMES[size], on: size === one.size, press: () => void change({ type: 'resize', id: one.id, size }) })) },
      { label: 'Look', items: Object.entries(TONE_NAMES).map(([tone, label]) => ({ label, on: one.look.tone === tone, press: () => void change({ type: 'look', id: one.id, look: { tone: tone as WidgetLook['tone'] } }) })) },
      { label: one.locked ? 'Unlock' : 'Lock', press: () => void change({ type: 'lock', id: one.id, locked: !one.locked }) },
      { label: 'Hide', press: () => void change({ type: 'hide', id: one.id, hidden: true }, `${name} hidden`, { type: 'hide', id: one.id, hidden: false }) },
      { label: 'Remove from the start page', press: () => void change({ type: 'remove', id: one.id }, `${name} removed`, { type: 'undo' }) },
      { label: arranging ? 'Done arranging' : 'Arrange widgets', separated: true, press: () => arrange(!arranging) },
      { label: 'Add widgets', press: () => deps.go({ view: 'home' }) }
    ], { label: name, returnTo })
  }

  // ---------------------------------------------------------------- arranging, and keeping up to date

  const arrange = (on: boolean): void => {
    if (arranging === on) return
    arranging = on
    closeMenus()
    host.classList.toggle('arranging', on)
    draw()
    if (on) {
      say('Arranging. Arrow keys move a widget, plus and minus change its size, Escape finishes.')
      grid.querySelector('.wg-slot')?.setAttribute('tabindex', '0')
    } else say('Finished arranging.')
  }

  const keys = (event: KeyboardEvent): void => {
    if (!arranging) return
    if (event.key === 'Escape') {
      event.preventDefault()
      arrange(false)
      return
    }
    const undo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z'
    const redo = (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))
    if (redo) {
      event.preventDefault()
      void change({ type: 'redo' })
    } else if (undo) {
      event.preventDefault()
      void change({ type: 'undo' })
    }
  }
  document.addEventListener('keydown', keys)

  const report = (): void => {
    deps.link.report({
      revision: state?.revision ?? 0,
      shown: [...cards.keys()].filter((id) => grid.querySelector(`.wg-slot[data-id="${CSS.escape(id)}"]`) !== null),
      failed: [...cards].filter(([, card]) => card.failed()).map(([id]) => id),
      columns,
      gallery: false,
      arranging
    })
  }

  const stopWatching = deps.link.subscribe((next, isConnected) => {
    state = next
    connected = isConnected
    if (!next) waitedFrom = Date.now()
    draw()
  })

  const fit = (): void => {
    const wide = host.clientWidth || host.getBoundingClientRect().width
    const next = columnsFor(wide)
    if (next === columns) return
    columns = next
    draw()
  }
  const watcher = new ResizeObserver(fit)
  watcher.observe(host)
  fit()

  return {
    arrange,
    arranging: () => arranging,
    destroy: () => {
      stopWatching()
      watcher.disconnect()
      document.removeEventListener('keydown', keys)
      for (const card of cards.values()) card.destroy()
      cards.clear()
      bar.remove()
      grid.remove()
      tray.remove()
      spoken.remove()
    }
  }
}
