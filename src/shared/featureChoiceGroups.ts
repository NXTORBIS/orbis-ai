/**
 * The optional screens, gathered under what somebody would be here for.
 *
 * `featureVisibility.ts` says which screens are a choice and what each one is. It does not say how to *ask*, and a
 * flat list of sixteen is the clutter this whole change exists to undo -- sixteen rows is a list nobody reads, and
 * the one somebody wanted is the one they scroll past.
 *
 * So: four headings, in the order somebody is likely to care about them, and every optional screen under exactly
 * one of them. The headings are written here rather than taken from the registry's categories on purpose. The
 * registry files these by what part of Orbis they belong to -- eight of the sixteen are `tools` -- which is true and
 * is no help at all to somebody being asked what they want. "Learn something" and "Follow the world" are the words
 * a person would use.
 *
 * This file invents no feature and no classification. The ids, the labels and the one-line descriptions all come
 * from `featureVisibility.ts` and the capability registry, so adding a screen there is enough; the only thing that
 * has to be decided here is which heading it sits under, and `featureChoiceGroups.test.ts` fails when a new optional
 * screen has not been given one.
 *
 * Pure: no React, no icons. The lucide icon for each lives in `src/renderer/src/lib/features.ts` beside the rest.
 */

import { OPTIONAL_IDS, blurbFor, factsFor, type SurfaceId } from './featureVisibility.ts'

export interface ChoiceGroup {
  id: string
  /** The heading, in everyday words. What this handful of screens is *for*. */
  label: string
  /** One line under the heading. Context, never instruction. */
  blurb: string
  ids: readonly SurfaceId[]
}

/** Which heading each optional screen sits under. The order inside a group is the order it is offered in. */
const PLAN: readonly { id: string; label: string; blurb: string; ids: readonly SurfaceId[] }[] = Object.freeze([
  Object.freeze({
    id: 'make',
    label: 'Make things',
    blurb: 'Turn an answer into something you can keep, send or draw on.',
    ids: Object.freeze(['create', 'whiteboard', 'neurova'] as SurfaceId[])
  }),
  Object.freeze({
    id: 'learn',
    label: 'Learn something',
    blurb: 'Study, work things out, and run experiments.',
    ids: Object.freeze(['courses', 'student', 'labs', 'toolkit'] as SurfaceId[])
  }),
  Object.freeze({
    id: 'follow',
    label: 'Follow the world',
    blurb: 'Prices and live sport, as they happen.',
    ids: Object.freeze(['markets', 'football', 'f1', 'arena'] as SurfaceId[])
  }),
  Object.freeze({
    id: 'play',
    label: 'Explore and play',
    blurb: 'Places to look around, and games to play.',
    ids: Object.freeze(['cosmos', 'eye', 'chess', 'arcade', 'chance'] as SurfaceId[])
  })
])

/** The four headings, with only the screens this version really has under them. */
export const CHOICE_GROUPS: readonly ChoiceGroup[] = Object.freeze(
  PLAN.map((group) =>
    Object.freeze({
      ...group,
      // An id with no entry in the classification is dropped rather than drawn as an empty row: a screen removed
      // from Orbis must not leave a switch behind that turns nothing on.
      ids: Object.freeze(group.ids.filter((id) => factsFor(id)?.standing === 'optional'))
    })
  ).filter((group) => group.ids.length > 0)
)

/** One optional screen, as the picker draws it: its name, and the single line that says what it is. */
export interface ChoiceEntry {
  id: SurfaceId
  label: string
  blurb: string
}

export const choiceEntry = (id: SurfaceId): ChoiceEntry => ({
  id,
  label: factsFor(id)?.label ?? id,
  blurb: blurbFor(id)
})

/** Optional screens that no heading claims. Empty, or `featureChoiceGroups.test.ts` is failing. */
export const UNGROUPED_IDS: readonly SurfaceId[] = Object.freeze(OPTIONAL_IDS.filter((id) => !CHOICE_GROUPS.some((group) => group.ids.includes(id))))
