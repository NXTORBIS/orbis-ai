/**
 * Building things on screen, node by node.
 *
 * Nothing here uses `innerHTML` or a parser. The built-in Orbis pages forbid both -- Trusted Types are enforced on
 * them -- and although an extension page is not under that rule, writing it the same way means a piece of this page
 * can be moved into the panel, or the other way round, without being rewritten. It also means a track title that
 * happens to contain a pointed bracket is a title and never markup.
 */

type Child = Node | string | null | undefined | false

interface Options {
  /** Space-separated class names. */
  readonly cls?: string
  readonly text?: string
  readonly title?: string
  readonly label?: string
  readonly on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>
  readonly attrs?: Record<string, string | number | boolean | null | undefined>
  readonly style?: Record<string, string>
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, options: Options = {}, children: readonly Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (options.cls) node.className = options.cls
  if (options.text !== undefined) node.textContent = options.text
  if (options.title) node.title = options.title
  if (options.label) node.setAttribute('aria-label', options.label)
  for (const [name, item] of Object.entries(options.attrs ?? {})) {
    if (item === null || item === undefined || item === false) continue
    node.setAttribute(name, item === true ? '' : String(item))
  }
  for (const [name, item] of Object.entries(options.style ?? {})) node.style.setProperty(name, item)
  for (const [name, handler] of Object.entries(options.on ?? {})) node.addEventListener(name, handler as EventListener)
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

/** Empties a node. Used rather than assigning to `innerHTML`, which this page never does. */
export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove()
}

/** Replaces everything inside a node in one go, so a half-drawn screen is never on view. */
export function fill(node: Element, ...children: readonly Child[]): void {
  clear(node)
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
}

/** A button that has an accessible name whether or not it has any words in it. */
export function button(options: Options & { readonly onClick?: () => void }, children: readonly Child[] = []): HTMLButtonElement {
  const node = el('button', { ...options, attrs: { type: 'button', ...options.attrs } }, children)
  if (options.onClick) node.addEventListener('click', options.onClick)
  if (!options.label && !options.text && options.title) node.setAttribute('aria-label', options.title)
  return node
}

/**
 * A sentence on screen where a list would be, with the reason it is not a list.
 *
 * A plain sentence rather than a spinner over nothing: a spinner says something is coming, which is a promise this
 * page cannot keep when the Orbis window is shut.
 */
export function says(title: string, detail = '', action?: { readonly label: string; readonly onClick: () => void }): HTMLElement {
  return el('div', { cls: 'om-says', attrs: { role: 'status' } }, [
    el('p', { cls: 'om-says-title', text: title }),
    detail ? el('p', { cls: 'om-says-detail', text: detail }) : null,
    action ? button({ cls: 'om-btn om-btn-quiet', text: action.label, onClick: action.onClick }) : null
  ])
}
