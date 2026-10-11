/**
 * What is on screen in the Orbis window, decided in one place.
 *
 * There used to be four pieces of state for this -- which feature was open, whether the image gallery was open,
 * whether the browser had been started, and whether the browser was in front -- and they were independent. Every
 * place that opened something had to remember to close the other three, and the places that forgot are the bug:
 * opening a screen from a notification left the browser covering it, and opening the browser over a screen left the
 * screen mounted underneath, so closing the browser revealed a screen nobody had asked for.
 *
 * There are not four things here. There is ONE thing on screen, and one fact about whether the browser is running.
 * Written that way, "two screens at once" stops being a bug to remember and becomes a sentence that cannot be said.
 *
 * Nothing in this file knows about React, the DOM or Electron, which is what lets `navigation.test.ts` check the
 * rules rather than a screenshot of them.
 */
import type { AppFeature } from './commandCenter'

/** The one thing being looked at. */
export type Surface =
  | { readonly kind: 'chat' }
  | { readonly kind: 'feature'; readonly id: AppFeature }
  | { readonly kind: 'images' }
  | { readonly kind: 'browser' }

export interface NavState {
  readonly surface: Surface
  /**
   * Whether Chromium has been started -- which is NOT whether it is in front.
   *
   * The browser is a real window parented into this one, positioned from a rectangle the renderer measures. Taking
   * its view out of the tree while the browser is still running loses that rectangle, so the view stays mounted for
   * as long as this is true and is merely hidden when something else is in front. That is what makes going to the
   * chat and back keep every tab.
   */
  readonly browserLaunched: boolean
  /**
   * Where leaving the browser goes back to. Never a browser itself, so dismissing the browser can never land on
   * the browser.
   */
  readonly behind: Surface
}

export type Intent =
  /** Show the conversation. */
  | { readonly kind: 'chat' }
  | { readonly kind: 'feature'; readonly id: AppFeature }
  /** The sidebar: pressing the screen you are already on goes back to the chat. */
  | { readonly kind: 'toggleFeature'; readonly id: AppFeature }
  | { readonly kind: 'images' }
  | { readonly kind: 'toggleImages' }
  /** This window asked for the browser. */
  | { readonly kind: 'browser' }
  /** The main process says the browser is now in front -- it may have been brought there from outside this window. */
  | { readonly kind: 'browserShown' }
  /** "Return to chat": the browser goes behind, still running. */
  | { readonly kind: 'browserDismissed' }
  /** Chromium has actually closed. The only thing that unsets `browserLaunched`. */
  | { readonly kind: 'browserGone' }
  /** Escape, after every screen has had its chance to claim the key. */
  | { readonly kind: 'escape' }

export const CHAT: Surface = Object.freeze({ kind: 'chat' })

export const INITIAL_NAV: NavState = Object.freeze({ surface: CHAT, browserLaunched: false, behind: CHAT })

export const sameSurface = (a: Surface, b: Surface): boolean =>
  a.kind === b.kind && (a.kind !== 'feature' || b.kind !== 'feature' || a.id === b.id)

/** Moving to the browser; everything else stays put. `behind` is only ever written here. */
const toBrowser = (state: NavState): NavState => ({
  surface: { kind: 'browser' },
  browserLaunched: true,
  behind: state.surface.kind === 'browser' ? state.behind : state.surface
})

const to = (state: NavState, surface: Surface): NavState => ({ ...state, surface })

export function navReducer(state: NavState, intent: Intent): NavState {
  switch (intent.kind) {
    case 'chat':
      return to(state, CHAT)
    case 'feature':
      return to(state, { kind: 'feature', id: intent.id })
    case 'toggleFeature':
      return to(state, sameSurface(state.surface, { kind: 'feature', id: intent.id }) ? CHAT : { kind: 'feature', id: intent.id })
    case 'images':
      return to(state, { kind: 'images' })
    case 'toggleImages':
      return to(state, state.surface.kind === 'images' ? CHAT : { kind: 'images' })
    case 'browser':
    case 'browserShown':
      return toBrowser(state)
    case 'browserDismissed':
      // Still running. Back to whatever the browser was opened over.
      return state.surface.kind === 'browser' ? to(state, state.behind) : state
    case 'browserGone':
      // The one intent that unsets `browserLaunched`. If the browser was in front, there is nothing there now.
      return { surface: state.surface.kind === 'browser' ? state.behind : state.surface, browserLaunched: false, behind: CHAT }
    case 'escape':
      // The browser keeps its own Escape -- a page, a find bar and a dialog all want it, and none of them is this.
      return state.surface.kind === 'browser' ? state : to(state, CHAT)
  }
}

/** Which of Orbis's own screens is open, or null for the chat. The shape the window's props already expect. */
export const featureOf = (state: NavState): AppFeature | null => (state.surface.kind === 'feature' ? state.surface.id : null)

export const showingImages = (state: NavState): boolean => state.surface.kind === 'images'

/** The browser is running AND in front. Settings and the shortcut sheet still draw over it; that is the window's business. */
export const showingBrowser = (state: NavState): boolean => state.browserLaunched && state.surface.kind === 'browser'
