/**
 * The Orbis sidebar inside the built-in Orbis page (chrome://orbis): the launcher rail of the old Electron browser, with its groups,
 * pinned panels, and the compact / labels setting. It is the same arrangement the Orbis app keeps for this profile
 * (src/shared/browserSidebar.ts is the one source of what an arrangement may hold), read and saved through the helper's
 * sidebar:get / sidebar:save channels, so a change here and a change in the Orbis window are one change.
 *
 * Each row does what it can really do here:
 *  - a panel this page has (Orion, Blocking, Notes, Tasks, Workflows, Galaxy, Secrets) opens that panel;
 *  - a browser feature Chromium already has (Bookmarks, History, Downloads, Extensions, Settings...) opens Chromium's own page for it;
 *  - anything else has no implementation in the Chromium build yet, and its row says so instead of pretending.
 * Nothing is drawn from state that does not exist.
 *
 * Bundled to sidebar.js by scripts/build-extension.mjs.
 */
import { PANELS, defaultLayout, isPinned, panelInfo, setDensity, setGroupCollapsed, setMode, setPanelHidden, setPanelPinned, visibleLayout, movePanel } from '../../src/shared/browserSidebar.ts'
import type { PanelId, SidebarLayout } from '../../src/shared/browserSidebar.ts'
// @ts-expect-error the helper client is plain JavaScript shared by the built-in pages
import { call, HelperDown } from './helper.js'

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

const monogram = (id: PanelId): string => (panelInfo(id)?.label ?? id).slice(0, 1).toUpperCase()

export async function mountSidebar(rail: HTMLElement): Promise<void> {
  let layout: SidebarLayout = defaultLayout()
  let editing = false
  let problem = ''

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
    const page = CHROMIUM_PAGE[id]
    if (page) window.open(page, '_blank')
  }
  const availability = (id: PanelId): 'here' | 'chromium' | 'none' => (OWN_PANEL[id] ? 'here' : CHROMIUM_PAGE[id] ? 'chromium' : 'none')

  const row = (id: PanelId, where: { groupId?: string; index?: number; count?: number }): HTMLElement => {
    const info = panelInfo(id)
    const kind = availability(id)
    const item = el('div', 'rail-row')
    const main = el('button', 'rail-item')
    main.type = 'button'
    main.append(el('span', 'rail-mark', monogram(id)))
    if (layout.mode === 'labels') main.append(el('span', 'rail-label', info?.label ?? id))
    main.setAttribute('aria-label', info?.label ?? id)
    main.title = kind === 'none' ? `${info?.label}: not in the Chromium build yet` : `${info?.label}: ${info?.description ?? ''}`
    if (kind === 'none') main.setAttribute('aria-disabled', 'true')
    main.addEventListener('click', () => (kind === 'none' ? undefined : open(id)))
    item.append(main)
    if (editing) {
      const tools = el('span', 'rail-tools')
      const tool = (label: string, glyph: string, on: () => void, disabled = false): void => {
        const b = el('button', 'rail-tool', glyph)
        b.type = 'button'
        b.setAttribute('aria-label', `${label}: ${info?.label}`)
        b.title = label
        b.disabled = disabled
        b.addEventListener('click', on)
        tools.append(b)
      }
      tool(isPinned(layout, id) ? 'Unpin' : 'Pin', isPinned(layout, id) ? '★' : '☆', () => void persist(setPanelPinned(layout, id, !isPinned(layout, id))))
      if (where.groupId !== undefined && where.index !== undefined) {
        tool('Move up', '↑', () => void persist(movePanel(layout, id, where.groupId!, where.index! - 1)), where.index === 0)
        tool('Move down', '↓', () => void persist(movePanel(layout, id, where.groupId!, where.index! + 1)), where.index === (where.count ?? 1) - 1)
      }
      tool('Hide', '×', () => void persist(setPanelHidden(layout, id, true)))
      item.append(tools)
    }
    return item
  }

  function draw(): void {
    rail.replaceChildren()
    rail.dataset.mode = layout.mode
    rail.dataset.density = layout.density
    const view = visibleLayout(layout)
    const list = el('div', 'rail-list')
    if (view.pinned.length) {
      const pinned = el('div', 'rail-group')
      for (const id of view.pinned) pinned.append(row(id, {}))
      list.append(pinned)
    }
    for (const group of view.groups) {
      if (!group.items.length) continue
      const box = el('div', 'rail-group')
      if (layout.mode === 'labels') {
        const head = el('button', 'rail-head', group.label)
        head.type = 'button'
        head.setAttribute('aria-expanded', String(!group.collapsed))
        head.addEventListener('click', () => void persist(setGroupCollapsed(layout, group.id, !group.collapsed)))
        box.append(head)
      } else {
        box.append(el('hr', 'rail-sep'))
      }
      if (!group.collapsed || layout.mode === 'icons') group.items.forEach((id, index) => box.append(row(id, { groupId: group.id, index, count: group.items.length })))
      list.append(box)
    }
    if (editing) {
      const hidden = layout.hidden.filter((id) => PANELS.some((p) => p.id === id))
      if (hidden.length) {
        const box = el('div', 'rail-group')
        box.append(el('div', 'rail-head', 'Hidden'))
        for (const id of hidden) {
          const b = el('button', 'rail-item', `Show ${panelInfo(id)?.label ?? id}`)
          b.type = 'button'
          b.addEventListener('click', () => void persist(setPanelHidden(layout, id, false)))
          box.append(b)
        }
        list.append(box)
      }
    }
    const foot = el('div', 'rail-foot')
    const control = (label: string, glyph: string, on: () => void, pressed?: boolean): void => {
      const b = el('button', 'rail-tool', glyph)
      b.type = 'button'
      b.setAttribute('aria-label', label)
      b.title = label
      if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed))
      b.addEventListener('click', on)
      foot.append(b)
    }
    control(layout.mode === 'icons' ? 'Show names' : 'Icons only', layout.mode === 'icons' ? '»' : '«', () => void persist(setMode(layout, layout.mode === 'icons' ? 'labels' : 'icons')))
    control(layout.density === 'compact' ? 'Roomier rows' : 'Compact rows', '≡', () => void persist(setDensity(layout, layout.density === 'compact' ? 'comfortable' : 'compact')), layout.density === 'compact')
    control(editing ? 'Done arranging' : 'Arrange the sidebar (pin, reorder, hide)', '✎', () => { editing = !editing; draw() }, editing)
    rail.append(list, foot)
    if (problem) {
      const p = el('p', 'rail-problem', problem)
      p.setAttribute('role', 'status')
      rail.append(p)
    }
  }

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
