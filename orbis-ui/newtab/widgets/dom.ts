// @ts-expect-error The browser's own icon set: a plain script beside this one in the built page, with no types of its own.
import { icon as railIcon } from './orbis-icons.js'

/**
 * Building what the widgets draw.
 *
 * These pages forbid turning a string into markup -- `innerHTML` throws -- so everything is made a node at a time.
 * `h` and `svg` are the two ways in, and nothing here ever parses text as markup: a title that happened to contain a
 * tag is shown as the characters it is.
 */

type Child = Node | string | number | null | undefined | false

type Props = {
  class?: string
  text?: string
  /** Attributes set as written. `aria-*`, `role`, `data-*`, `href`, `type`, `title`, `tabindex` and the like. */
  [name: string]: unknown
}

const SVG = 'http://www.w3.org/2000/svg'

function apply(node: Element, props: Props | null | undefined, ns: boolean): void {
  if (!props) return
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (name === 'class') node.setAttribute('class', String(value))
    else if (name === 'text') node.textContent = String(value)
    else if (name === 'style' && typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, string>)) (node as HTMLElement).style.setProperty(k, v)
    // An event: onclick, onkeydown. Never set from anything but code in this folder.
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value as EventListener)
    else if (!ns && name in node && typeof value !== 'string' && name !== 'list') (node as unknown as Record<string, unknown>)[name] = value
    else node.setAttribute(name, value === true ? '' : String(value))
  }
}

function add(node: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child)
  }
}

/** An element. `h('button', { class: 'wg-btn', type: 'button', onclick: press }, 'Add')`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  apply(node, props, false)
  add(node, children)
  return node
}

/** An SVG element. `svg('circle', { cx: 12, cy: 12, r: 8 })`. The outermost one is `svg('svg', { viewBox: '0 0 24 24' }, ...)`. */
export function svg(tag: string, props?: Props | null, ...children: Child[]): SVGElement {
  const node = document.createElementNS(SVG, tag) as SVGElement
  apply(node, props, true)
  add(node, children)
  return node
}

/** One of the browser's own icons, by name. An unknown name is a plain circle rather than nothing. */
export const icon = (name: string, size = 16): SVGElement => railIcon(name, size) as SVGElement

/** Empties a node. */
export const clear = (node: Element): void => node.replaceChildren()

/** A button that says what it does to somebody who cannot see it. `label` is spoken; `content` is what is drawn. */
export function button(label: string, press: (event: MouseEvent) => void, content: Child | Child[] = label, cls = 'wg-btn'): HTMLButtonElement {
  const node = h('button', { class: cls, type: 'button', 'aria-label': label, title: typeof content === 'string' ? undefined : label })
  add(node, Array.isArray(content) ? content : [content])
  node.addEventListener('click', press)
  return node
}

// ---------------------------------------------------------------- words for times and sizes

/** "10:42" or "10:42 AM". */
export function clockTime(at: number, hour12: boolean, seconds = false, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12, ...(timeZone ? { timeZone } : {}) }).format(at)
  } catch {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12 }).format(at)
  }
}

/** "Monday 5 October". */
export const dayName = (at: number, timeZone?: string): string => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(timeZone ? { timeZone } : {}) }).format(at)

/** "just now", "5 minutes ago", "yesterday", "3 days ago", then the date. `now` is handed in so a preview can be fixed. */
export function ago(at: number, now: number): string {
  const gap = now - at
  if (!Number.isFinite(gap)) return ''
  if (gap < 60_000) return 'just now'
  const minutes = Math.floor(gap / 60_000)
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(at)
}

/** "in 5 minutes", "in 2 hours", "tomorrow", then the date. For something that has not happened yet. */
export function until(at: number, now: number): string {
  const gap = at - now
  if (gap <= 0) return 'now'
  const minutes = Math.ceil(gap / 60_000)
  if (minutes < 60) return minutes === 1 ? 'in 1 minute' : `in ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'in 1 hour' : `in ${hours} hours`
  const days = Math.round(hours / 24)
  if (days === 1) return 'tomorrow'
  if (days < 7) return `in ${days} days`
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(at)
}

/** "184 KB", "41.9 MB". */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** The site an address belongs to, without "www.". The address itself when it is not one. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Whether an address is one a widget may open: a web page and nothing else. */
export function isWeb(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** The browser's own small picture for a site. Asked of the browser, never of the site. */
export const favicon = (url: string, size = 32): string => `chrome://favicon2/?size=${size}&scaleFactor=2x&pageUrl=${encodeURIComponent(url)}`

/** Whether the person asked the system for less movement. */
export const prefersStill = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
