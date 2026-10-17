import { Crown, Dices, Gamepad2, Music2, CandlestickChart, ClipboardList, FilePlus2, FlaskConical, BookMarked, GraduationCap, LayoutGrid, LayoutTemplate, Mic, PenTool, CalendarClock, Wrench, Globe2, Orbit, Flag, Swords, Trophy, type LucideIcon } from 'lucide-react'
import type { AppFeature } from '../../../shared/commandCenter'
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

const ICONS: Readonly<Record<AppFeature, LucideIcon>> = Object.freeze({
  chess: Crown,
  create: FilePlus2,
  neurova: Music2,
  pages: LayoutTemplate,
  labs: FlaskConical,
  markets: CandlestickChart,
  whiteboard: PenTool,
  clipboard: ClipboardList,
  workspaces: LayoutGrid,
  schedules: CalendarClock,
  notes: Mic,
  student: GraduationCap,
  courses: BookMarked,
  toolkit: Wrench,
  eye: Globe2,
  cosmos: Orbit,
  f1: Flag,
  football: Trophy,
  arena: Swords,
  arcade: Gamepad2
})

/**
 * The icon for each screen the first run offers as a choice.
 *
 * The launcher's own icons, plus Chance -- which is a core surface rather than one of the nineteen, so it has no
 * capability, is in no `ICONS` entry, and would be drawn as an empty square in a picker that only knew that map.
 * `src/shared/featureChoiceGroups.test.ts` fails when an optional screen is missing from here.
 */
export const CHOICE_ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  ...ICONS,
  chance: Dices
})

export interface Feature extends MenuFeature {
  icon: LucideIcon
}

const withIcon = (one: MenuFeature): Feature | null => {
  const icon = (ICONS as Partial<Record<AppFeature, LucideIcon>>)[one.id]
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
