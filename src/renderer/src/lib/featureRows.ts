import { Compass, FolderOpen, MessageSquare, Search, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { FEATURE_FACTS, blurbFor, capabilityFor, factsFor, type FeatureFacts, type SurfaceId } from '../../../shared/featureVisibility'
import { CHOICE_GROUPS } from '../../../shared/featureChoiceGroups'
import { CHOICE_ICONS } from './features'

/**
 * Everything Orbis has, as the Features screen in Settings lists it.
 *
 * Settings is the other half of the first-run question. The first run asks what somebody is here for; this is where
 * they change their mind, and whether that feels safe to do is what decides whether anybody ever tidies anything up.
 * So the two show the same things under the same headings, from `featureChoiceGroups.ts` — the list the first-run
 * step itself draws — rather than each inventing a grouping.
 *
 * What it adds is the group the first run has no reason to show: the parts with no switch. Leaving them out would
 * make a list of sixteen in an app that has twenty-five, and somebody looking for the chat would conclude the list
 * was wrong rather than that the chat was never a choice.
 *
 * Its own file, not `features.ts`. That file is the *menu* — the screens one person sees, with their icons on — and
 * this is the opposite list: everything there is, including the parts that are not a feature screen at all.
 */

/**
 * The parts of Orbis that are not one of the nineteen screens, drawn with an icon anyway.
 *
 * `featureVisibility.ts` classifies them because the question "is this in my menu?" is asked about them too, but
 * five of the six have no capability, so the registry has no icon for them and neither `ICONS` nor `CHOICE_ICONS`
 * carries them. Settings has to show them all the same: a list of what Orbis has that leaves out the chat and the
 * browser is not a list of what Orbis has. Chance is in `CHOICE_ICONS` already, because the first run offers it.
 */
const CORE_ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  chat: MessageSquare,
  browser: Compass,
  files: FolderOpen,
  settings: SlidersHorizontal,
  palette: Search
})

/** What somebody might type looking for one of the core parts, which have no capability to take keywords from. */
const CORE_KEYWORDS: Readonly<Record<string, string[]>> = Object.freeze({
  chat: ['chat', 'orion', 'talk', 'ask', 'conversation', 'message'],
  browser: ['browser', 'web', 'tab', 'internet', 'page', 'address bar'],
  files: ['file', 'document', 'download', 'folder'],
  settings: ['settings', 'options', 'preferences'],
  palette: ['search', 'palette', 'command', 'ctrl k', 'jump']
})

/** One row: what it is called, what it does, and whether the window can really draw it. */
export interface Surface {
  id: SurfaceId
  label: string
  /** One line in everyday words — the registry's own description where there is one. */
  hint: string
  icon: LucideIcon
  /** It has no switch, in the type as well as in the interface. */
  essential: boolean
  /** Other parts of the interface that go away with it, in plain words. */
  alsoHides: readonly string[]
  /** What somebody might type looking for it: the capability's own keywords, or the ones written above. */
  keywords: string[]
  /**
   * A sentence when this version of the window has nothing to open for it, and null when it has.
   *
   * Not a guess, and the reason this field exists. A surface is in the list because `featureVisibility.ts`
   * classifies it, which is a different question from whether there is a screen behind it: a capability whose `app`
   * has no icon is dropped from the launcher quietly by design, and the core parts are drawn by the window itself.
   * So a switch can be on with nothing behind it — a feature that is *enabled* and not *operational* — and that must
   * be said rather than drawn as a healthy tick.
   */
  missing: string | null
}

const surfaceOf = (facts: FeatureFacts): Surface => {
  const capability = capabilityFor(facts.id)
  const icon: LucideIcon | undefined = CHOICE_ICONS[facts.id] ?? CORE_ICONS[facts.id]
  return {
    id: facts.id,
    // The classification's own label, which is what the first-run step shows, so the two call everything the same.
    label: facts.label,
    hint: blurbFor(facts.id),
    icon: icon ?? Search,
    essential: facts.standing === 'essential',
    alsoHides: facts.alsoHides,
    keywords: capability ? [...capability.keywords] : [...(CORE_KEYWORDS[facts.id] ?? [])],
    missing: icon !== undefined ? null : 'This version of Orbis has no screen to open for it, so switching it on would not give you anything to look at.'
  }
}

export interface SurfaceGroup {
  id: string
  label: string
  /** One line under the heading. Context, never instruction. */
  blurb: string
  items: readonly Surface[]
}

/**
 * The four choosing headings from the first run, and then the ones with no switch.
 *
 * The essentials come last on purpose. Everything above them is something to do; they are there to be read once.
 */
export const SURFACE_GROUPS: readonly SurfaceGroup[] = Object.freeze(
  [
    ...CHOICE_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      blurb: group.blurb,
      items: group.ids.map((id) => factsFor(id)).filter((one): one is FeatureFacts => one !== undefined).map(surfaceOf)
    })),
    {
      id: 'always',
      label: 'Always there',
      blurb: 'These have no switch. They are how you reach everything else, including this screen, so nothing can take them away.',
      items: FEATURE_FACTS.filter((one) => one.standing === 'essential').map(surfaceOf)
    }
  ].filter((group) => group.items.length > 0)
)

/** Every row, flat, in the order the groups put them in. */
export const SURFACE_LIST: readonly Surface[] = Object.freeze(SURFACE_GROUPS.flatMap((group) => group.items))

export const surfaceById = (id: string): Surface | undefined => SURFACE_LIST.find((one) => one.id === id)
