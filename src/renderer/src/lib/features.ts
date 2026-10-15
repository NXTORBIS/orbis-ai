import { CandlestickChart, ClipboardList, FilePlus2, FlaskConical, BookMarked, GraduationCap, LayoutGrid, LayoutTemplate, Mic, PenTool, CalendarClock, Wrench, Globe2, Orbit, Flag, Swords, Trophy, type LucideIcon } from 'lucide-react'
import { CAPABILITIES, CATEGORIES, type AppFeature, type OrbisCapability } from '../../../shared/commandCenter'

/**
 * The window's screens, taken from the one list both halves of Orbis read.
 *
 * `Sidebar.tsx` used to hold `FEATURES`: eleven entries with their own labels, icons, hints and order, sitting
 * beside a registry that already knew all eleven. The two drifted nine features apart -- six capabilities claimed
 * a screen the window had deleted, three screens the window really had were in no capability at all -- and neither
 * side could tell, because neither ever asked the other anything.
 *
 * So the launcher is derived now. A screen appears in it because a capability says the window can open it, and for
 * no other reason; adding one means adding a line to the registry, which is the line the browser's Command Centre
 * reads too.
 *
 * The one thing that genuinely belongs on this side is the icon. The registry names icons from the browser's own
 * set (`orbis-ui/panel/rail/icons.js`), which the window does not have and should not grow a second copy of, so
 * the mapping from those names to lucide lives here. A missing one is a visible gap rather than a crash, and the
 * test beside this file fails on it.
 */

const ICONS: Readonly<Record<AppFeature, LucideIcon>> = Object.freeze({
  create: FilePlus2,
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
  arena: Swords
})

export interface Feature {
  id: AppFeature
  label: string
  hint: string
  icon: LucideIcon
  /** The category it is filed under, so the launcher can group rather than list eleven things flat. */
  category: string
  categoryLabel: string
}

const featureOf = (capability: OrbisCapability): Feature | null => {
  if (!capability.app) return null
  const icon = ICONS[capability.app]
  if (!icon) return null
  const category = CATEGORIES.find((one) => one.id === capability.category)
  return {
    id: capability.app,
    label: capability.name,
    hint: capability.description,
    icon,
    category: capability.category,
    categoryLabel: category?.label ?? 'Orbis'
  }
}

/** Every screen the window can open, in the registry's order. */
export const FEATURE_LIST: readonly Feature[] = Object.freeze(CAPABILITIES.map(featureOf).filter((one): one is Feature => one !== null))

/**
 * The same screens, gathered under their categories.
 *
 * Eleven rows flat is a list somebody has to read all of; the same eleven under four headings is a list somebody
 * can skip most of. The order is the registry's own category order, so it matches the browser's panel.
 */
export const FEATURE_GROUPS: readonly { id: string; label: string; items: readonly Feature[] }[] = Object.freeze(
  CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    items: FEATURE_LIST.filter((one) => one.category === category.id)
  }))
    .filter((group) => group.items.length > 0)
    // The Arena is the one place new sport lands, so it leads the list rather than trailing off the bottom of it.
    .sort((x, y) => (x.id === 'arena' ? 0 : 1) - (y.id === 'arena' ? 0 : 1))
)

export const featureById = (id: string): Feature | undefined => FEATURE_LIST.find((one) => one.id === id)
