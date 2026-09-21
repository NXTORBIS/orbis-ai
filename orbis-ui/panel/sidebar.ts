/**
 * The Orbis sidebar inside the built-in Orbis page (chrome://orbis): the launcher rail of the old Electron browser, with its groups,
 * pinned panels, and the compact / labels / icons-only settings. It is the same arrangement the Orbis app keeps for this profile
 * (src/shared/browserSidebar.ts is the one source of what an arrangement may hold), read and saved through the helper's
 * sidebar:get / sidebar:save channels, so a change here and a change in the Orbis window are one change.
 *
 * Each row does what it can really do here:
 *  - a panel this page has (Orion, Blocking, Notes, Tasks, Workflows, Galaxy, Secrets) opens that panel;
 *  - a row with a view of its own in the rail (Tabs, Tab groups, Media, Controls, Saved pages, Screenshots, Reminders, Clipboard,
 *    Whiteboard, Research, Sources, Workspaces; see ./rail) opens that view, which reads the real browser or store through the helper;
 *  - a browser feature Chromium already has (Bookmarks, History, Downloads, Extensions, Settings...) opens Chromium's own page for it;
 *  - anything else has no implementation in the Chromium build yet, and its row says so instead of pretending.
 * Nothing is drawn from state that does not exist.
 *
 * Arranging: pin, hide, move up/down, or drag a row to another place or group; add, rename, move and delete groups; drag the rail's
 * right edge (or use the arrow keys on it) to change its width. All of it is saved through sidebar:save.
 *
 * Bundled to sidebar.js by scripts/build-extension.mjs (which also bundles the rail's own views).
 */
import { MAX_WIDTH, MIN_WIDTH, PANELS, addGroup, defaultLayout, isPinned, locate, moveGroup, movePanel, movePinned, panelInfo, removeGroup, renameGroup, setDensity, setGroupCollapsed, setMode, setPanelHidden, setPanelPinned, visibleLayout } from '../../src/shared/browserSidebar.ts'
import type { PanelId, SidebarLayout } from '../../src/shared/browserSidebar.ts'
// @ts-expect-error the helper client is plain JavaScript shared by the built-in pages
import { call, HelperDown } from './helper.js'
// @ts-expect-error plain JavaScript: the rail's own views, and the one icon family
import { hasView, icon, showView } from './rail/index.js'

/** A panel of this page: the id of the tab button to press. */
const OWN_PANEL: Partial<Record<PanelId, string>> = {
  orion: 'tab-ask',
  adblock: 'tab-block',
  notes: 'tab-notes',
  tasks: 'tab-tasks',
  workflows: 'tab-workflows',
  galaxy: 'tab-galaxy',
  secrets: 'tab-secrets'
}
/** The view name (as panel.js and ./rail know it) behind each own panel, to mark the open row. */
const VIEW_OF: Partial<Record<PanelId, string>> = { orion: 'ask', adblock: 'block', notes: 'notes', tasks: 'tasks', workflows: 'workflows', galaxy: 'galaxy', secrets: 'secrets' }
/** A panel that Chromium itself provides as a page of its own. */
const CHROMIUM_PAGE: Partial<Record<PanelId, string>> = {
  bookmarks: 'chrome://bookmarks/',
  history: 'chrome://history/',
  downloads: 'chrome://downloads/',
  readingList: 'chrome://bookmarks/',
  extensions: 'chrome://extensions/',
  profiles: 'chrome://settings/manageProfile',
  customize: 'chrome://settings/',
  privacy: 'chrome://settings/privacy',
  tracking: 'chrome://settings/privacy'
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

type DragItem = { kind: 'panel'; id: PanelId } | { kind: 'group'; id: string }

export async function mountSidebar(rail: HTMLElement): Promise<void> {
  let layout: SidebarLayout = defaultLayout()
  let editing = false
  let problem = ''
  let openId: string = 'ask'
  let dragging: DragItem | null = null
  let renamingGroup: string | null = null

  const persist = async (next: SidebarLayout): Promise<void> => {
    layout = next
    draw()
    try {
      layout = (await call('sidebar:save', [next])) as SidebarLayout
      problem = ''
    } catch (err) {
      problem = err instanceof HelperDown ? 'Orbis is not running, so this arrangement is not kept.' : 'The arrangement could not be saved.'
    }
    draw()
  }

  const open = (id: PanelId): void => {
    const tab = OWN_PANEL[id]
    if (tab) return void document.getElementById(tab)?.click()
    if (hasView(id)) return showView(id)
    const page = CHROMIUM_PAGE[id]
    if (page) window.open(page, '_blank')
  }
  const availability = (id: PanelId): 'here' | 'chromium' | 'none' => (OWN_PANEL[id] || hasView(id) ? 'here' : CHROMIUM_PAGE[id] ? 'chromium' : 'none')
  const viewName = (id: PanelId): string => VIEW_OF[id] ?? id

  const iconTool = (label: string, name: string, on: () => void, opts: { disabled?: boolean; pressed?: boolean; cls?: string } = {}): HTMLButtonElement => {
    const b = el('button', `rail-tool${opts.cls ? ` ${opts.cls}` : ''}`)
    b.type = 'button'
    b.append(icon(name, 15))
    b.setAttribute('aria-label', label)
    b.title = label
    b.disabled = opts.disabled === true
    if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed))
    b.addEventListener('click', on)
    return b
  }

  /** Where a drop lands in the panel's group: before or after the row it is over, by which half of the row the pointer is in. */
  const dropIndex = (groupId: string, overId: PanelId, after: boolean): number => {
    const group = layout.groups.find((g) => g.id === groupId)
    const at = group ? group.items.indexOf(overId) : -1
    return at < 0 ? (group?.items.length ?? 0) : at + (after ? 1 : 0)
  }

  const row = (id: PanelId, where: { groupId?: string; index?: number; count?: number; pinned?: boolean }): HTMLElement => {
    const info = panelInfo(id)
    const kind = availability(id)
    const label = info?.label ?? id
    const item = el('div', 'rail-row')
    item.dataset.panel = id
    const main = el('button', 'rail-item')
    main.type = 'button'
    main.dataset.railItem = id
    const mark = el('span', 'rail-mark')
    mark.append(icon(id, 16))
    main.append(mark)
    if (layout.mode === 'labels') main.append(el('span', 'rail-label', label))
    main.setAttribute('aria-label', label)
    main.title = kind === 'none' ? `${label}: not in the Chromium build yet` : `${label}: ${info?.description ?? ''}`
    if (kind === 'none') main.setAttribute('aria-disabled', 'true')
    if (viewName(id) === openId && kind === 'here') main.setAttribute('aria-current', 'page')
    main.addEventListener('click', () => (kind === 'none' ? undefined : open(id)))
    item.append(main)
    if (editing) {
      item.draggable = true
      item.classList.add('arranging')
      item.addEventListener('dragstart', (event) => {
        dragging = { kind: 'panel', id }
        event.dataTransfer?.setData('text/plain', id)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        item.classList.add('dragging')
      })
      item.addEventListener('dragend', () => {
        dragging = null
        item.classList.remove('dragging')
        rail.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-into'))
      })
      item.addEventListener('dragover', (event) => {
        if (dragging?.kind !== 'panel' || dragging.id === id) return
        event.preventDefault()
        const box = item.getBoundingClientRect()
        const after = event.clientY > box.top + box.height / 2
        item.classList.toggle('drop-after', after)
        item.classList.toggle('drop-before', !after)
      })
      item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'))
      item.addEventListener('drop', (event) => {
        if (dragging?.kind !== 'panel' || dragging.id === id) return
        event.preventDefault()
        const box = item.getBoundingClientRect()
        const after = event.clientY > box.top + box.height / 2
        const moving = dragging.id
        dragging = null
        if (where.pinned) {
          const at = layout.pinned.indexOf(id) + (after ? 1 : 0)
          void persist(movePinned(setPanelPinned(layout, moving, true), moving, at))
        } else if (where.groupId) {
          // The panel leaves where it was first, so an index that came after it shifts back by one when it was in the same group above.
          const from = locate(layout, moving)
          let to = dropIndex(where.groupId, id, after)
          if (from && from.groupId === where.groupId && from.index < to) to -= 1
          void persist(movePanel(layout, moving, where.groupId, to))
        }
      })
      const tools = el('span', 'rail-tools')
      const pinned = isPinned(layout, id)
      tools.append(iconTool(`${pinned ? 'Unpin' : 'Pin'}: ${label}`, 'star', () => void persist(setPanelPinned(layout, id, !pinned)), { pressed: pinned, cls: pinned ? 'on' : '' }))
      if (where.groupId !== undefined && where.index !== undefined) {
        tools.append(iconTool(`Move up: ${label}`, 'up', () => void persist(movePanel(layout, id, where.groupId!, where.index! - 1)), { disabled: where.index === 0 }))
        tools.append(iconTool(`Move down: ${label}`, 'down', () => void persist(movePanel(layout, id, where.groupId!, where.index! + 1)), { disabled: where.index === (where.count ?? 1) - 1 }))
      }
      tools.append(iconTool(`Hide: ${label}`, 'eyeHide', () => void persist(setPanelHidden(layout, id, true))))
      item.append(tools)
    }
    return item
  }

  /** A group's heading. While arranging it can be renamed, moved (buttons or drag), deleted, and takes dropped panels. */
  const groupHead = (group: SidebarLayout['groups'][number], index: number, total: number): HTMLElement => {
    const head = el('div', 'rail-headrow')
    head.dataset.group = group.id
    if (renamingGroup === group.id) {
      const input = el('input', 'rail-rename')
      input.type = 'text'
      input.maxLength = 40
      input.value = group.label
      input.setAttribute('aria-label', `New name for the group ${group.label}`)
      const done = (save: boolean): void => {
        const name = input.value.trim()
        renamingGroup = null
        if (save && name && name !== group.label) void persist(renameGroup(layout, group.id, name))
        else draw()
      }
      input.addEventListener('keydown', (e) => (e.key === 'Enter' ? done(true) : e.key === 'Escape' ? done(false) : undefined))
      input.addEventListener('blur', () => done(true))
      head.append(input)
      queueMicrotask(() => (input.focus(), input.select()))
      return head
    }
    const button = el('button', 'rail-head')
    button.type = 'button'
    button.setAttribute('aria-expanded', String(!group.collapsed))
    button.append(icon(group.collapsed ? 'chevronRight' : 'chevronDown', 12), el('span', undefined, group.label))
    button.addEventListener('click', () => void persist(setGroupCollapsed(layout, group.id, !group.collapsed)))
    head.append(button)
    if (editing) {
      head.draggable = true
      head.addEventListener('dragstart', (event) => {
        dragging = { kind: 'group', id: group.id }
        event.dataTransfer?.setData('text/plain', group.id)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      })
      head.addEventListener('dragend', () => {
        dragging = null
        rail.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-into'))
      })
      head.addEventListener('dragover', (event) => {
        if (!dragging || (dragging.kind === 'group' && dragging.id === group.id)) return
        event.preventDefault()
        head.classList.toggle('drop-into', dragging.kind === 'panel')
        head.classList.toggle('drop-before', dragging.kind === 'group')
      })
      head.addEventListener('dragleave', () => head.classList.remove('drop-into', 'drop-before'))
      head.addEventListener('drop', (event) => {
        if (!dragging) return
        event.preventDefault()
        const drag = dragging
        dragging = null
        if (drag.kind === 'panel') void persist(movePanel(layout, drag.id, group.id, group.items.length))
        else void persist(moveGroup(layout, drag.id, index))
      })
      const tools = el('span', 'rail-tools')
      tools.append(iconTool(`Rename the group ${group.label}`, 'edit', () => ((renamingGroup = group.id), draw())))
      tools.append(iconTool(`Move the group ${group.label} up`, 'up', () => void persist(moveGroup(layout, group.id, index - 1)), { disabled: index === 0 }))
      tools.append(iconTool(`Move the group ${group.label} down`, 'down', () => void persist(moveGroup(layout, group.id, index + 1)), { disabled: index === total - 1 }))
      tools.append(iconTool(`Delete the group ${group.label} (its panels move to the group above)`, 'trash', () => void persist(removeGroup(layout, group.id)), { disabled: total <= 1 }))
      head.append(tools)
    }
    return head
  }

  /** Arrow keys, Home and End move between the rows, so the whole rail is one tab stop's worth of travel. */
  const keys = (list: HTMLElement): void => {
    list.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const target = event.target as HTMLElement
      if (target.closest('.rail-tools') || target.tagName === 'INPUT') return
      const stops = [...list.querySelectorAll<HTMLElement>('.rail-item, .rail-head')]
      const at = stops.indexOf(target)
      if (at < 0) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? stops.length - 1 : Math.max(0, Math.min(stops.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
      stops[next]?.focus()
    })
  }

  /** The right edge: drag to resize (saved when let go), or focus it and use the arrow keys. */
  const resizer = (): HTMLElement => {
    const grip = el('div', 'rail-resizer')
    grip.setAttribute('role', 'separator')
    grip.setAttribute('aria-orientation', 'vertical')
    grip.setAttribute('aria-label', 'Sidebar width')
    grip.setAttribute('aria-valuemin', String(MIN_WIDTH))
    grip.setAttribute('aria-valuemax', String(MAX_WIDTH))
    grip.setAttribute('aria-valuenow', String(layout.width))
    grip.tabIndex = 0
    grip.title = 'Drag to change the width of the sidebar'
    const clamp = (n: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)))
    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      grip.setPointerCapture(event.pointerId)
      const startX = event.clientX
      const start = layout.width
      let latest = start
      const move = (e: PointerEvent): void => {
        latest = clamp(start + e.clientX - startX)
        rail.style.width = `${latest}px`
        grip.setAttribute('aria-valuenow', String(latest))
      }
      const up = (): void => {
        grip.removeEventListener('pointermove', move)
        grip.removeEventListener('pointerup', up)
        grip.removeEventListener('pointercancel', up)
        if (latest !== start) void persist({ ...layout, width: latest })
      }
      grip.addEventListener('pointermove', move)
      grip.addEventListener('pointerup', up)
      grip.addEventListener('pointercancel', up)
    })
    grip.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 32 : 12
      const delta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : event.key === 'Home' ? MIN_WIDTH - layout.width : event.key === 'End' ? MAX_WIDTH - layout.width : 0
      if (!delta) return
      event.preventDefault()
      void persist({ ...layout, width: clamp(layout.width + delta) }).then(() => rail.querySelector<HTMLElement>('.rail-resizer')?.focus())
    })
    return grip
  }

  function draw(): void {
    const keep = document.activeElement instanceof HTMLElement && rail.contains(document.activeElement) ? document.activeElement.dataset.railItem : undefined
    rail.replaceChildren()
    rail.dataset.mode = layout.mode
    rail.dataset.density = layout.density
    rail.dataset.arranging = String(editing)
    rail.style.width = layout.mode === 'labels' ? `${layout.width}px` : ''
    const view = visibleLayout(layout)
    const list = el('div', 'rail-list')
    list.setAttribute('role', 'navigation')
    list.setAttribute('aria-label', 'Panels')
    if (view.pinned.length) {
      const pinned = el('div', 'rail-group')
      if (layout.mode === 'labels') pinned.append(el('div', 'rail-head static', 'Pinned'))
      for (const id of view.pinned) pinned.append(row(id, { pinned: true }))
      list.append(pinned)
    }
    const total = layout.groups.length
    view.groups.forEach((group, shownIndex) => {
      const fullIndex = layout.groups.findIndex((g) => g.id === group.id)
      if (!group.items.length && !editing) return
      const box = el('div', 'rail-group')
      if (layout.mode === 'labels') box.append(groupHead(group, fullIndex, total))
      else box.append(el('hr', 'rail-sep'))
      if (!group.collapsed || layout.mode === 'icons') group.items.forEach((id, index) => box.append(row(id, { groupId: group.id, index: layout.groups[fullIndex].items.indexOf(id), count: layout.groups[fullIndex].items.length })))
      if (editing && !group.items.length) box.append(el('p', 'rail-hint', 'Drop panels here'))
      void shownIndex
      list.append(box)
    })
    if (editing) {
      const hidden = layout.hidden.filter((id) => PANELS.some((p) => p.id === id))
      if (hidden.length) {
        const box = el('div', 'rail-group')
        box.append(el('div', 'rail-head static', 'Hidden'))
        for (const id of hidden) {
          const b = el('button', 'rail-item hidden-item')
          b.type = 'button'
          const mark = el('span', 'rail-mark')
          mark.append(icon('eye', 16))
          b.append(mark)
          if (layout.mode === 'labels') b.append(el('span', 'rail-label', `Show ${panelInfo(id)?.label ?? id}`))
          b.setAttribute('aria-label', `Show ${panelInfo(id)?.label ?? id}`)
          b.title = `Show ${panelInfo(id)?.label ?? id} in the sidebar again`
          b.addEventListener('click', () => void persist(setPanelHidden(layout, id, false)))
          box.append(b)
        }
        list.append(box)
      }
    }
    keys(list)
    const foot = el('div', 'rail-foot')
    foot.setAttribute('role', 'toolbar')
    foot.setAttribute('aria-label', 'Sidebar layout')
    const iconsOnly = layout.mode === 'icons'
    foot.append(iconTool(iconsOnly ? 'Show names' : 'Icons only', iconsOnly ? 'panelLabels' : 'panelIcons', () => void persist(setMode(layout, iconsOnly ? 'labels' : 'icons')), { pressed: iconsOnly }))
    foot.append(iconTool(layout.density === 'compact' ? 'Roomier rows' : 'Compact rows', 'density', () => void persist(setDensity(layout, layout.density === 'compact' ? 'comfortable' : 'compact')), { pressed: layout.density === 'compact' }))
    if (editing) foot.append(iconTool('New group', 'plus', () => void persist(addGroup(layout, 'New group')).then(() => undefined), { disabled: layout.groups.length >= 12 }))
    foot.append(iconTool(editing ? 'Done arranging' : 'Arrange the sidebar (pin, reorder, drag, hide, groups)', editing ? 'check' : 'arrange', () => { editing = !editing; renamingGroup = null; draw() }, { pressed: editing }))
    rail.append(list, foot)
    if (layout.mode === 'labels') rail.append(resizer())
    if (problem) {
      const p = el('p', 'rail-problem', problem)
      p.setAttribute('role', 'status')
      rail.append(p)
    }
    if (keep) rail.querySelector<HTMLElement>(`[data-rail-item="${CSS.escape(keep)}"]`)?.focus()
  }

  document.addEventListener('orbis:view', (event) => {
    openId = (event as CustomEvent<{ name?: string }>).detail?.name ?? openId
    for (const b of rail.querySelectorAll<HTMLElement>('[data-rail-item]')) {
      const id = b.dataset.railItem as PanelId
      if (viewName(id) === openId && availability(id) === 'here') b.setAttribute('aria-current', 'page')
      else b.removeAttribute('aria-current')
    }
  })

  draw()
  try {
    layout = (await call('sidebar:get')) as SidebarLayout
  } catch (err) {
    problem = err instanceof HelperDown ? 'Orbis is not running: this is the default arrangement and changes are not kept.' : 'The saved arrangement could not be read.'
  }
  draw()
}

const rail = document.getElementById('rail')
if (rail) void mountSidebar(rail)
