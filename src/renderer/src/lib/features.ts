import { createElement, type ComponentType } from 'react'
import type { AppFeature } from '../../../shared/commandCenter'
import { FEATURE_LOGOS } from './featureLogos'
import { ALL_MENU_FEATURES, menuFeatures, menuGroups, type MenuFeature } from '../../../shared/featureMenu'
import { everythingChoice, type VisibilityChoice } from '../../../shared/featureVisibility'

/**
 * The window's screens, with their pictures on.
 *
 * `Sidebar.tsx` used to hold `FEATURES`: eleven entries with their own labels, icons, hints and order, sitting
 * beside a registry that already knew all eleven. The two drifted nine features apart -- six capabilities claimed
 * a screen the window had deleted, three screens the window really had were in no capability at all -- and neither
 * side could tell, because neither ever asked the other anything.
 *
 * So the launcher is derived. A screen appears in it because a capability says the window can open it and because
 * this person has it switched on, and for no other reason. Which screens exist and what they are called is
 * `shared/commandCenter.ts`; which of them one person sees is `shared/featureVisibility.ts`; the two put together is
 * `shared/featureMenu.ts`, which is plain code with a test beside it.
 *
 * The one thing that genuinely belongs on this side is the icon. The registry names icons from the browser's own
 * set (`orbis-ui/panel/rail/icons.js`), which the window does not have and should not grow a second copy of, so
 * the mapping from those names to lucide lives here. A missing one is a visible gap rather than a crash, and
 * `src/shared/featureLauncher.test.ts` fails on it.
 */

/** Whatever draws a screen's picture: a line icon or the screen's own logo. Both take a size. */
export type FeatureIcon = ComponentType<{ size?: number; className?: string; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>

/**
 * A feature's own logo, drawn where its icon was. The logo is wider than a square icon, so it is given the height an
 * icon of that size would have and its width follows the picture.
 */
const logoIcon = (id: string): FeatureIcon => {
  const src = FEATURE_LOGOS[id]
  const Logo: FeatureIcon = ({ size = 14, className }) =>
    createElement('img', { src, alt: '', draggable: false, className: ['feature-logo-icon', className].filter(Boolean).join(' '), style: { height: size * 2, width: 'auto', display: 'block' } })
  return Logo
}

const ICONS: Readonly<Record<AppFeature, FeatureIcon>> = Object.freeze({
  chess: logoIcon('chess'),
  create: logoIcon('create'),
  neurova: logoIcon('neurova'),
  pages: logoIcon('pages'),
  labs: logoIcon('labs'),
  markets: logoIcon('markets'),
  whiteboard: logoIcon('whiteboard'),
  clipboard: logoIcon('clipboard'),
  workspaces: logoIcon('workspaces'),
  schedules: logoIcon('schedules'),
  notes: logoIcon('notes'),
  student: logoIcon('student'),
  courses: logoIcon('courses'),
  toolkit: logoIcon('toolkit'),
  eye: logoIcon('eye'),
  cosmos: logoIcon('cosmos'),
  f1: logoIcon('f1'),
  football: logoIcon('football'),
  arena: logoIcon('arena'),
  arcade: logoIcon('arcade')
})

/**
 * The icon for each screen the first run offers as a choice.
 *
 * The launcher's own icons, plus Chance -- which is a core surface rather than one of the nineteen, so it has no
 * capability, is in no `ICONS` entry, and would be drawn as an empty square in a picker that only knew that map.
 * `src/shared/featureChoiceGroups.test.ts` fails when an optional screen is missing from here.
 */
export const CHOICE_ICONS: Readonly<Record<string, FeatureIcon>> = Object.freeze({
  ...ICONS,
  chance: logoIcon('chance')
})

export interface Feature extends MenuFeature {
  icon: FeatureIcon
}

const withIcon = (one: MenuFeature): Feature | null => {
  const icon = (ICONS as Partial<Record<AppFeature, FeatureIcon>>)[one.id]
  return icon ? { ...one, icon } : null
}

const drawn = (list: readonly MenuFeature[]): readonly Feature[] => Object.freeze(list.map(withIcon).filter((one): one is Feature => one !== null))

/** Every screen the window can open, in the registry's order, whatever anybody has chosen. */
export const FEATURE_LIST: readonly Feature[] = drawn(ALL_MENU_FEATURES)

/**
 * The screens this person has showing.
 *
 * `choice` may be null while Orbis is still reading the file, or in a context that never loads it. Null answers the
 * essentials and nothing else, which is `isVisible`'s own rule and the safe direction: a menu that is briefly short
 * is a menu, and one that briefly offers a screen somebody switched off is "never claim a thing is on when it is
 * off" broken on every start.
 */
export const featureListFor = (choice: VisibilityChoice | null): readonly Feature[] => drawn(menuFeatures(choice))

export interface FeatureGroup {
  id: string
  label: string
  items: readonly Feature[]
}

/**
 * The same screens gathered under their categories, with nothing empty left behind.
 *
 * Nineteen rows flat is a list somebody has to read all of; the same rows under their headings is a list somebody
 * can skip most of. A category whose every screen is switched off is dropped, heading included -- a heading over
 * nothing is the clutter this change exists to fix, in miniature.
 *
 * There is deliberately no unfiltered `FEATURE_GROUPS` any more. A menu built from one would show screens somebody
 * switched off, and the only way to be sure nothing does that is for the full list not to be available as a menu.
 * `ALL_FEATURES_GROUPED` below is for Settings, where the point is to list everything there is to choose.
 */
export const featureGroupsFor = (choice: VisibilityChoice | null): readonly FeatureGroup[] =>
  Object.freeze(
    menuGroups(choice)
      .map((group) => ({ id: group.id, label: group.label, items: drawn(group.items) }))
      .filter((group) => group.items.length > 0)
  )

/** Every screen there is, grouped: what a chooser lists. Not a menu -- see above. */
export const ALL_FEATURES_GROUPED: readonly FeatureGroup[] = featureGroupsFor(everythingChoice())

export const featureById = (id: string): Feature | undefined => FEATURE_LIST.find((one) => one.id === id)
