import { CAPABILITIES, CATEGORIES, searchCapabilities, unavailableBecause, type AppFeature, type OrbisCapability, type Readiness } from './commandCenter.ts'
import { featureState, isVisible, type VisibilityChoice } from './featureVisibility.ts'

/**
 * What somebody's menu holds, and what the box of everything finds -- worked out in one place, by the one question.
 *
 * Two screens read this: the wordmark menu down the side (`src/renderer/src/lib/features.ts`, which puts the icons
 * on) and the Ctrl+K box (`src/renderer/src/components/CommandPalette.tsx`, which draws the rows). Neither decides
 * anything itself, because the two halves of Orbis each keeping their own idea of which features exist is exactly
 * how they once drifted nine features apart.
 *
 * It lives in `shared/` rather than in the renderer for one practical reason: the renderer's copy imports
 * lucide-react and React, so nothing can test it. Here the real rules -- a hidden screen is out of the menu, a
 * hidden screen is still found by name, an empty category leaves no heading behind -- are plain code with a test
 * beside them.
 *
 * ## The rule, in one sentence
 *
 * **The menu shows what is visible. The search box finds everything Orbis has, and says which of it is switched
 * off.** That asymmetry is the whole design: hiding a screen is how somebody gets a menu they can read, and the
 * search box is how they find the thing they did not pick. A feature that is hidden *and* unfindable has been
 * deleted, which is not what anybody asked for.
 */

/** One of the window's screens, as a menu needs it. The icon is the renderer's business and is not here. */
export interface MenuFeature {
  id: AppFeature
  label: string
  /** One line, in the words somebody would use. The registry's own description. */
  hint: string
  category: string
  categoryLabel: string
}

const menuFeature = (capability: OrbisCapability): MenuFeature | null => {
  if (!capability.app) return null
  return {
    id: capability.app,
    label: capability.name,
    hint: capability.description,
    category: capability.category,
    categoryLabel: CATEGORIES.find((one) => one.id === capability.category)?.label ?? 'Orbis'
  }
}

/** Every screen the window can open, in the registry's order, whatever anybody has chosen. */
export const ALL_MENU_FEATURES: readonly MenuFeature[] = Object.freeze(
  CAPABILITIES.map(menuFeature).filter((one): one is MenuFeature => one !== null)
)

/**
 * The screens this person has showing.
 *
 * `choice` may be null -- Orbis has not finished reading the file yet, or this is a context that never loads it. Null
 * answers the essentials and nothing else, which is `isVisible`'s own rule and the safe direction: a menu that is
 * briefly short is a menu, and a menu that briefly offers a hidden screen is a broken promise.
 */
export const menuFeatures = (choice: VisibilityChoice | null): readonly MenuFeature[] =>
  Object.freeze(ALL_MENU_FEATURES.filter((one) => isVisible(one.id, choice)))

export interface MenuGroup {
  id: string
  label: string
  items: readonly MenuFeature[]
}

/**
 * The same screens under their categories, with nothing empty left behind.
 *
 * A heading over no rows is the clutter this whole change is about, in miniature: somebody who switched off both
 * sports should not still be looking at the word "Arena" with nothing under it. So a category with no visible screen
 * in it is dropped, heading and all.
 */
export const menuGroups = (choice: VisibilityChoice | null): readonly MenuGroup[] => {
  const showing = menuFeatures(choice)
  return Object.freeze(
    CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      items: Object.freeze(showing.filter((one) => one.category === category.id))
    }))
      .filter((group) => group.items.length > 0)
      // The Arena is the one place new sport lands, so it leads the list rather than trailing off the bottom of it.
      .sort((x, y) => (x.id === 'arena' ? 0 : 1) - (y.id === 'arena' ? 0 : 1))
  )
}

// ---------------------------------------------------------------- the box of everything

/** What pressing Enter on a row does. */
export type PaletteAction =
  /** Open one of the window's screens. */
  | 'open'
  /** Open the browser, where this capability lives. */
  | 'open-browser'
  /** Switch this screen on, and go to it. */
  | 'turn-on'
  /** Nothing: the row is there to say something, not to be pressed. */
  | 'none'

export interface PaletteHit {
  id: string
  name: string
  /** The line under the name: the reason when there is one, the description when there is not. */
  detail: string
  /** The screen this opens, when it is one of the window's. */
  feature: AppFeature | null
  /**
   * Why this cannot be done at all, in words. Null when it can.
   *
   * Being switched off is **not** one of these: it is something that can be done about, and `turn-on` is doing it.
   * This is for a capability whose engine is not there -- "Notes needs the browser running" -- which somebody can
   * act on and which Orbis must never quietly swallow.
   */
  why: string | null
  /** Orbis has this and the person has it switched off. */
  off: boolean
  action: PaletteAction
}

/**
 * What the Ctrl+K box offers.
 *
 * With nothing typed: this person's own menu, as a menu. Fifty-four rows including eleven `chrome://` deep links is
 * a wall, and the screens they chose are what somebody opening the box without a word in mind is nearly always
 * after.
 *
 * With something typed: **everything Orbis has**, scored by the same `searchCapabilities` the browser's Command
 * Centre uses -- including the screens that are switched off, marked as switched off, with Enter turning one on.
 *
 * That last part is the point of the whole feature. Somebody who did not pick Chess World at setup has no way to
 * learn it exists from a menu that correctly leaves it out; typing "chess" is how they find it, and being told
 * "Orbis has nothing like that" would be a lie. So a hidden screen is found, said to be off, and one keypress from
 * being on.
 */
export function paletteHits(query: string, ready: Readiness, choice: VisibilityChoice | null, limit = 10): readonly PaletteHit[] {
  if (query.trim() === '') {
    return Object.freeze(
      menuFeatures(choice).map((one) => ({
        id: one.id as string,
        name: one.label,
        detail: one.hint,
        feature: one.id,
        why: null,
        off: false,
        action: 'open' as PaletteAction
      }))
    )
  }

  return Object.freeze(
    searchCapabilities(query, ready, limit).map(({ capability }) => {
      const app = capability.app ?? null
      // A capability that is not one of the window's screens has no visibility of its own: it lives in the browser,
      // and whether it can be used is the readiness question below.
      const state = app ? featureState(app, choice) : null

      if (state && !state.visible) {
        // Switched off, and switching it on is something somebody can do from this row.
        if (!state.chosen) {
          return {
            id: capability.id,
            name: capability.name,
            detail: 'Switched off — press Enter to turn it on and open it.',
            feature: app,
            why: null,
            off: true,
            action: 'turn-on' as PaletteAction
          }
        }
        // Switched on, and still not showing: something it needs is off. Turning *this* on would change nothing, so
        // the row says what is really in the way and cannot be pressed.
        return {
          id: capability.id,
          name: capability.name,
          detail: state.hiddenBecause ?? `${capability.name} is not in your menu.`,
          feature: app,
          why: state.hiddenBecause ?? `${capability.name} is not in your menu.`,
          off: true,
          action: 'none' as PaletteAction
        }
      }

      const why = unavailableBecause(capability, ready)
      return {
        id: capability.id,
        name: capability.name,
        detail: why ?? capability.description,
        feature: app,
        why,
        off: false,
        action: why !== null ? ('none' as PaletteAction) : app ? ('open' as PaletteAction) : ('open-browser' as PaletteAction)
      }
    })
  )
}

/** A row Enter may land on. The ones that are only there to say something are not among them. */
export const reachableHits = (hits: readonly PaletteHit[]): readonly PaletteHit[] => Object.freeze(hits.filter((one) => one.action !== 'none'))
