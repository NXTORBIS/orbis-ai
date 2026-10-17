/**
 * Which screen is showing, and why the browser's own back button works on a page that never reloads.
 *
 * The address bar's hash is the only thing that decides what is on screen. Going somewhere pushes an entry into the
 * tab's history, so Back and Forward -- the browser's, the mouse's side buttons, the keyboard's Alt+Left -- all work
 * without this page knowing anything about them. The page's own back and forward buttons do nothing more than call
 * `history.back()` and `history.forward()`: they are the same two presses, not a second history kept here, because
 * two histories is how the two come to disagree.
 *
 * Reading an address is in src/shared/music/fulltab.ts and is tested. This file is only the part that needs a window.
 */

import { parseRoute, routeHash, sameRoute, type MusicRoute, type MusicScreenName } from '../../src/shared/music/fulltab.ts'

type Listener = (route: MusicRoute) => void

let listeners: Listener[] = []
let showing: MusicRoute = parseRoute(location.hash)

export const route = (): MusicRoute => showing

/** Listens for the screen changing. Returns the way to stop listening. */
export function onRoute(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((one) => one !== listener)
  }
}

function settle(): void {
  const fresh = parseRoute(location.hash)
  if (sameRoute(fresh, showing)) return
  showing = fresh
  for (const listener of listeners) listener(showing)
}

/**
 * Goes to a screen, leaving an entry in the tab's history.
 *
 * Writing the hash is what moves: the browser raises `hashchange`, which is handled in one place below, so going
 * somewhere by pressing a link in the page and going somewhere by typing an address take exactly the same path.
 */
export function go(screen: MusicScreenName, of = '', said = ''): void {
  const next = routeHash({ screen, of, said })
  if (location.hash === next) return
  location.hash = next
}

/**
 * Goes to a screen *without* leaving an entry in the history.
 *
 * For a search box, where every letter typed is a new address: thirty entries for one search would make Back useless.
 */
export function replace(screen: MusicScreenName, of = '', said = ''): void {
  const next = routeHash({ screen, of, said })
  if (location.hash === next) return
  history.replaceState(null, '', next)
  settle()
}

export const back = (): void => history.back()
export const forward = (): void => history.forward()

/**
 * Starts listening to the address.
 *
 * A tab opened with no hash is put on Home with `replaceState`, so the first Back press leaves the page rather than
 * going from Home to a blank address that then goes to Home.
 */
export function startRouting(): void {
  if (!location.hash || location.hash === '#') history.replaceState(null, '', routeHash({ screen: 'home' }))
  showing = parseRoute(location.hash)
  addEventListener('hashchange', settle)
}
