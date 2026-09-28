import { describeComparison } from '../../src/shared/tray.ts'
import type { Cell, Comparison, TrayItem } from '../../src/shared/tray.ts'
// @ts-expect-error the helper client is plain JavaScript shared with the side panel
import { call } from '../panel/helper.js'

/**
 * The comparison tray, in the space beside the verticals.
 *
 * A search gives you a list; deciding from a list means opening six tabs and holding six half-remembered numbers in
 * your head. This is the other half of that job. Pin results from any vertical, and Orbis reads the pinned pages and
 * lays out what they say against each other.
 *
 * It sits in the header rather than in one vertical's results because that is what it is for: a video, a paper and a
 * shop listing can all be pinned into the same tray, and the strip is the one part of this page that outlives the
 * vertical you are looking at.
 *
 * The rule the whole feature rests on is enforced in src/shared/tray.ts, not here: a cell exists only if the words
 * that say it are in the page it claims to come from. This file draws what survived that, including the gaps -- a
 * column a page did not answer is shown empty, because an empty cell is information and a filled-in one would be a
 * lie. Every value carries the sentence it came from, so nothing in the table has to be taken on trust.
 */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const button = (className: string, text: string, onClick: () => void, label?: string): HTMLButtonElement => {
  const b = el('button', className, text)
  b.type = 'button'
  if (label) {
    b.setAttribute('aria-label', label)
    b.title = label
  }
  b.addEventListener('click', onClick)
  return b
}

type Pinned = Omit<TrayItem, 'text'> & { read?: boolean }

/** What is pinned, as far as this page knows. Read from the helper, never guessed at. */
let pinned: Pinned[] = []
let strip: HTMLElement | null = null
let count: HTMLElement | null = null
let panel: HTMLDialogElement | null = null
let announce: (message: string) => void = () => {}
/** Redrawn when the tray changes, so a pin button anywhere on the page shows the truth. */
const pinButtons = new Map<string, HTMLButtonElement[]>()

const isPinned = (url: string): boolean => pinned.some((p) => p.url === url)

function paintPins(): void {
  for (const [url, buttons] of pinButtons) {
    const on = isPinned(url)
    for (const b of buttons) {
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
      b.title = on ? 'Pinned for comparison. Click to unpin' : 'Pin this to compare it with others'
    }
  }
}

function paintStrip(): void {
  if (!strip || !count) return
  strip.classList.toggle('has', pinned.length > 0)
  count.textContent = String(pinned.length)
  strip.setAttribute('aria-label', pinned.length ? `Comparison tray, ${pinned.length} pinned` : 'Comparison tray, empty')
}

async function refresh(): Promise<void> {
  try {
    const answer = (await call('tray:list')) as { items?: Pinned[] }
    pinned = Array.isArray(answer?.items) ? answer.items : []
  } catch {
    // The helper is not answering. An empty tray is the honest thing to show; it is not a claim that nothing is pinned.
    pinned = []
  }
  paintStrip()
  paintPins()
}

/**
 * A pin, for one result. The same page pinned from Images and from All is one pin, because it is one page -- which is
 * also why the button is keyed by address rather than by where it appeared.
 */
/**
 * A small line-drawn icon, built as elements rather than parsed from a string.
 *
 * These were `innerHTML = '<svg .../>'`, which a chrome:// page refuses: WebUI runs under Trusted Types, so assigning
 * a plain string to innerHTML throws. It threw here, in `mountTray`, on the line that runs just before the page starts
 * its search -- so the search never started and Orbis Search sat on "Searching..." for ever, on every query. Building
 * the nodes is not a workaround for that rule; it is what the rule asks for.
 */
function lineIcon(size: number, shapes: { tag: 'path' | 'rect'; attrs: Record<string, string> }[]): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': size > 15 ? '1.7' : '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  })) {
    svg.setAttribute(k, v)
  }
  for (const shape of shapes) {
    const node = document.createElementNS(NS, shape.tag)
    for (const [k, v] of Object.entries(shape.attrs)) node.setAttribute(k, v)
    svg.append(node)
  }
  return svg
}

export function pinButton(result: { url: string; title: string; site: string }, vertical: string): HTMLButtonElement {
  const b = button('pin', '', () => void toggle(result, vertical), 'Pin this to compare it with others')
  b.classList.add('pin')
  b.append(lineIcon(15, [{ tag: 'path', attrs: { d: 'M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3z' } }]))
  const list = pinButtons.get(result.url) ?? []
  list.push(b)
  pinButtons.set(result.url, list)
  const on = isPinned(result.url)
  b.classList.toggle('on', on)
  b.setAttribute('aria-pressed', String(on))
  return b
}

async function toggle(result: { url: string; title: string; site: string }, vertical: string): Promise<void> {
  const already = pinned.find((p) => p.url === result.url)
  try {
    if (already) {
      await call('tray:remove', [already.id])
      announce('Unpinned.')
    } else {
      const outcome = (await call('tray:add', [{ url: result.url, title: result.title, site: result.site, vertical }])) as {
        added?: boolean
        message?: string | null
      }
      if (outcome?.message) announce(outcome.message)
      else if (outcome?.added) announce('Pinned. Open the tray to compare.')
    }
  } catch {
    announce('Orbis could not change the tray just now.')
    return
  }
  await refresh()
}

// ---------------------------------------------------------------- the table

/** A value, with the page's own words behind it. The quote is the reason to believe the cell, so it is always reachable. */
function cellNode(cell: Cell | null, extra: Cell[] | undefined): HTMLElement {
  const td = el('td')
  if (!cell) {
    // Not "0", not "-", not blank: a word, because the reason this is empty matters and is not the same as a zero.
    td.append(el('span', 'unsaid', 'not stated'))
    return td
  }
  const value = el('span', 'val', cell.value)
  value.title = `"${cell.quote}"`
  td.append(value)
  if (extra && extra.length > 1) {
    // The page said more than one thing here. Both are shown, because choosing one silently is the failure mode.
    const other = el('details', 'disagree')
    other.append(el('summary', undefined, `and ${extra.length - 1} other${extra.length === 2 ? '' : 's'} on this page`))
    for (const c of extra.slice(1)) {
      const p = el('p', 'alt', c.value)
      p.title = `"${c.quote}"`
      other.append(p)
    }
    td.append(other)
  }
  const why = el('span', 'why')
  why.textContent = cell.quote
  td.append(why)
  return td
}

function tableNode(comparison: Comparison): HTMLElement {
  const wrap = el('div', 'cmp-wrap')
  if (!comparison.columns.length || !comparison.rows.length) return wrap

  const table = el('table', 'cmp')
  const head = el('tr')
  head.append(el('th', 'what', ''))
  for (const column of comparison.columns) {
    const th = el('th', undefined, column.label)
    // How many of the pinned pages actually answered this. A column three of five answered is not a column of five.
    th.append(el('small', undefined, `${column.filled} of ${comparison.rows.length}`))
    head.append(th)
  }
  const thead = el('thead')
  thead.append(head)
  table.append(thead)

  const body = el('tbody')
  for (const row of comparison.rows) {
    const tr = el('tr')
    const what = el('th', 'what')
    const link = el('a')
    link.href = row.url
    link.textContent = row.title
    link.rel = 'noreferrer'
    what.append(link)
    tr.append(what)
    for (const column of comparison.columns) tr.append(cellNode(row.cells[column.key], row.disagreements[column.key]))
    body.append(tr)
  }
  table.append(body)
  wrap.append(table)
  return wrap
}

function pinnedList(onChanged: () => void): HTMLElement {
  const list = el('ul', 'tray-list')
  for (const item of pinned) {
    const li = el('li')
    const link = el('a')
    link.href = item.url
    link.textContent = item.title
    link.rel = 'noreferrer'
    li.append(link, el('small', undefined, item.site || item.vertical))
    li.append(
      button('drop', '', async () => {
        await call('tray:remove', [item.id]).catch(() => undefined)
        await refresh()
        onChanged()
      }, `Unpin ${item.title}`)
    )
    list.append(li)
  }
  return list
}

/** Opens the tray. Nothing is compared until asked: reading a dozen pages is work, and it should be somebody's choice. */
function openPanel(): void {
  if (!panel) return
  const body = panel.querySelector('.tray-body') as HTMLElement
  const draw = (): void => {
    body.replaceChildren()
    if (!pinned.length) {
      body.append(el('p', 'tray-empty', 'Nothing is pinned. Use the pin on any result to put it here, from any of the tabs above.'))
      return
    }
    body.append(pinnedList(draw))
    const compare = button('go', `Compare ${pinned.length}`, () => void run(), 'Read the pinned pages and compare them')
    const actions = el('div', 'tray-actions')
    actions.append(compare, button('clear', 'Clear', async () => {
      await call('tray:clear').catch(() => undefined)
      await refresh()
      draw()
    }, 'Unpin everything'))
    body.append(actions)
  }

  const run = async (): Promise<void> => {
    const status = el('p', 'tray-status', 'Working…')
    body.replaceChildren(pinnedList(draw), status)
    try {
      const answer = (await call('tray:compare', [], {
        // The steps are the real steps: which pages are being read, and what it is looking for.
        onEvent: (event: { type?: string; message?: string }) => {
          if (event?.type === 'status' && event.message) status.textContent = event.message
        }
      })) as { comparison?: Comparison; summary?: string }
      const comparison = answer?.comparison
      if (!comparison) {
        status.textContent = 'Orbis could not compare these.'
        return
      }
      body.replaceChildren()
      body.append(el('p', 'tray-summary', answer.summary || describeComparison(comparison)))
      const table = tableNode(comparison)
      if (table.childElementCount) body.append(table)
      if (comparison.unread.length) {
        const problems = el('ul', 'tray-unread')
        for (const u of comparison.unread) {
          const li = el('li')
          const a = el('a')
          a.href = u.url
          a.textContent = u.title
          a.rel = 'noreferrer'
          li.append(a, el('small', undefined, u.problem))
          problems.append(li)
        }
        body.append(el('h3', undefined, 'Not read'), problems)
      }
      const again = el('div', 'tray-actions')
      again.append(button('go', 'Compare again', () => void run(), 'Read the pages again'), button('clear', 'Back', draw, 'Back to what is pinned'))
      body.append(again)
    } catch (error) {
      status.textContent = (error as { message?: string })?.message || 'Orbis could not compare these.'
    }
  }

  draw()
  panel.showModal()
}

/**
 * Puts the tray in the header. `say` is the page's own way of telling somebody something, so pinning reports itself the
 * same way everything else on this page does.
 */
export function mountTray(host: HTMLElement, say: (message: string) => void): void {
  announce = say

  strip = el('div', 'tray-strip')
  const open = button('tray-open', '', () => openPanel(), 'Comparison tray')
  open.append(
    lineIcon(16, [
      { tag: 'rect', attrs: { x: '3', y: '4', width: '18', height: '16', rx: '2' } },
      { tag: 'path', attrs: { d: 'M3 10h18M9 10v10' } }
    ])
  )
  const word = el('span', 'tray-word', 'Compare')
  count = el('span', 'tray-count', '0')
  open.append(word, count)
  strip.append(open)
  host.append(strip)

  panel = el('dialog', 'tray-panel') as HTMLDialogElement
  const head = el('header')
  head.append(el('h2', undefined, 'Comparison tray'))
  head.append(button('x', '✕', () => panel?.close(), 'Close'))
  panel.append(head, el('div', 'tray-body'))
  document.body.append(panel)

  paintStrip()
  void refresh()
}

/** Called after results are drawn, so the pins on them show what is really in the tray. */
export const syncPins = (): void => paintPins()
