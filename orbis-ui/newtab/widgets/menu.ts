import { h } from './dom.ts'

/**
 * The small menu that opens on a card, and the one behind "Layouts" while arranging.
 *
 * A real menu: arrow keys move through it, Enter chooses, Escape closes it and gives the keyboard back to whatever
 * opened it, and pressing anywhere else closes it too. It is put in the page rather than inside the card so that a
 * card near the bottom of the window opens its menu upwards instead of off the screen.
 */

export interface MenuItem {
  label: string
  /** Shown faintly and not choosable: something that cannot be done right now, with the reason as its label. */
  disabled?: boolean
  /** A tick beside it: the size a widget already is, the layout already in use. */
  on?: boolean
  press?: () => void
  /** Items of its own, shown in a menu that opens beside this one. */
  items?: MenuItem[]
  /** A line above this item. */
  separated?: boolean
}

export interface OpenMenu {
  close(): void
}

let open: OpenMenu | null = null

/** Closes whatever menu is open. Called before another opens, so there is never more than one. */
export const closeMenus = (): void => {
  open?.close()
  open = null
}

export function openMenu(at: { x: number; y: number }, items: MenuItem[], options: { label: string; returnTo?: HTMLElement | null } = { label: 'Menu' }): OpenMenu {
  closeMenus()
  const list = h('div', { class: 'wg-menu', role: 'menu', 'aria-label': options.label, tabindex: '-1' })
  const buttons: HTMLButtonElement[] = []
  let childMenu: OpenMenu | null = null

  const shut = (): void => {
    childMenu?.close()
    childMenu = null
    document.removeEventListener('pointerdown', awayPointer, true)
    document.removeEventListener('keydown', keys, true)
    window.removeEventListener('resize', shut)
    list.remove()
    if (open === mine) open = null
    options.returnTo?.focus()
  }

  const mine: OpenMenu = { close: shut }

  for (const item of items) {
    if (item.separated) list.append(h('div', { class: 'wg-menu-line', role: 'separator' }))
    const node = h('button', {
      class: `wg-menu-item${item.on ? ' on' : ''}`,
      type: 'button',
      role: 'menuitem',
      disabled: item.disabled === true,
      'aria-checked': item.on === true ? 'true' : undefined,
      'aria-haspopup': item.items ? 'true' : undefined
    })
    node.append(h('span', { class: 'wg-menu-tick', 'aria-hidden': 'true', text: item.on ? '✓' : '' }), h('span', { class: 'wg-menu-words', text: item.label }))
    if (item.items) node.append(h('span', { class: 'wg-menu-more', 'aria-hidden': 'true', text: '›' }))
    node.addEventListener('click', (event) => {
      event.stopPropagation()
      if (item.disabled) return
      if (item.items) {
        const where = node.getBoundingClientRect()
        const nested = openMenuNested({ x: where.right - 6, y: where.top }, item.items, node)
        childMenu = nested
        return
      }
      shut()
      item.press?.()
    })
    buttons.push(node)
    list.append(node)
  }

  // Opened where it was asked for, then moved back onto the screen if it would hang off an edge.
  list.style.left = '0px'
  list.style.top = '0px'
  document.body.append(list)
  const size = list.getBoundingClientRect()
  const x = Math.max(8, Math.min(at.x, window.innerWidth - size.width - 8))
  const y = Math.max(8, Math.min(at.y, window.innerHeight - size.height - 8))
  list.style.left = `${Math.round(x)}px`
  list.style.top = `${Math.round(y)}px`

  const awayPointer = (event: PointerEvent): void => {
    if (!list.contains(event.target as Node)) shut()
  }
  const keys = (event: KeyboardEvent): void => {
    if (!document.body.contains(list)) return
    const usable = buttons.filter((one) => !one.disabled)
    const at = usable.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      shut()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = event.key === 'ArrowDown' ? (at + 1) % usable.length : (at <= 0 ? usable.length : at) - 1
      usable[next]?.focus()
    }
  }
  document.addEventListener('pointerdown', awayPointer, true)
  document.addEventListener('keydown', keys, true)
  window.addEventListener('resize', shut)

  buttons.find((one) => !one.disabled)?.focus()
  open = mine
  return mine
}

/** A menu opened beside an item of another menu. It does not close the one it came from. */
function openMenuNested(at: { x: number; y: number }, items: MenuItem[], returnTo: HTMLElement): OpenMenu {
  const keep = open
  const nested = openMenu(at, items, { label: 'More', returnTo })
  // The parent stays open and stays the one that outside presses close, so the pair behave as one menu.
  open = keep
  return nested
}
