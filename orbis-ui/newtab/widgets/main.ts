import type { GalleryRoute, GalleryView, PageDeps } from './api.ts'
import { createLink } from './link.ts'
import { mountBoard } from './board.ts'
import { mountGallery } from './gallery.ts'
import { createToast } from './toast.ts'
import { closeMenus } from './menu.ts'
import { h } from './dom.ts'
import { readRoute, writeRoute } from './route.ts'

/**
 * The widgets on the browser's start page: one connection to Orbis, the board, and the gallery over it.
 *
 * This is everything `newtab.js` has to know. It hands over the place the board goes, a way to read the page's own
 * clock setting, and whatever the start page used to keep in its own storage -- which is offered to Orbis once, so
 * widgets somebody had before there was one catalogue are not quietly lost.
 *
 * Where the gallery is lives in the page's address (`#widgets`), so Back closes it, a reload stays where it was,
 * and Orion can open it by opening an address like any other page.
 */

export interface MountOptions {
  /** Where the board of cards goes: the element under the search box. */
  host: HTMLElement
  /** The start page's own 12-hour setting, read each time a card is drawn. */
  hour12: () => boolean
  /** The board the start page used to keep for itself, offered to Orbis once. Never deleted by this page. */
  legacy?: unknown
}

export interface MountedWidgets {
  openGallery(): void
  arrange(on: boolean): void
  destroy(): void
}

export function mountWidgets(options: MountOptions): MountedWidgets {
  const link = createLink()
  const layer = h('div', { class: 'wg-layer', hidden: true })
  document.body.append(layer)
  const toast = createToast(document.body)

  let gallery: GalleryView | null = null
  let route: GalleryRoute = readRoute(location.hash)

  const go = (next: GalleryRoute): void => {
    const hash = writeRoute(next)
    if (hash === writeRoute(route)) return show(next)
    // Pushed rather than replaced, so the browser's own Back button closes what was opened.
    if (hash) location.hash = hash
    else if (location.hash) history.pushState(null, '', location.pathname)
    else return show(next)
  }

  const deps: PageDeps = {
    link,
    hour12: options.hour12,
    go,
    arrange: (on) => {
      if (on) go({ view: 'closed' })
      board.arrange(on)
    },
    say: (text, action) => toast.say(text, action)
  }

  const board = mountBoard(options.host, deps)

  const show = (next: GalleryRoute): void => {
    route = next
    closeMenus()
    const open = next.view !== 'closed'
    layer.hidden = !open
    document.body.classList.toggle('wg-gallery-open', open)
    if (open && !gallery) gallery = mountGallery(layer, deps)
    gallery?.show(next)
  }

  const fromAddress = (): void => show(readRoute(location.hash))
  window.addEventListener('hashchange', fromAddress)
  window.addEventListener('popstate', fromAddress)
  show(route)

  /**
   * The start page's own widgets, brought in once.
   *
   * Offered as soon as Orbis has answered, and only then: with no answer there is nowhere to put them. Orbis
   * remembers that it has done this, so a second tab opening does not lay them over whatever has happened since.
   */
  let offered = false
  const stopOffering = link.subscribe((state) => {
    if (offered || !state) return
    offered = true
    stopOffering()
    if (Array.isArray(options.legacy) && options.legacy.length > 0) void link.act({ type: 'adopt', legacy: options.legacy })
  })

  return {
    openGallery: () => go({ view: 'home' }),
    arrange: (on) => deps.arrange(on),
    destroy: () => {
      window.removeEventListener('hashchange', fromAddress)
      window.removeEventListener('popstate', fromAddress)
      stopOffering()
      gallery?.destroy()
      board.destroy()
      toast.destroy()
      layer.remove()
    }
  }
}
