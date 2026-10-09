/**
 * What is on screen right now, so Orbis does not announce something you are already looking at.
 *
 * The rule itself was written, tested and shipped: a notification whose group matches what is being watched is held
 * back while Orbis is in front (`notifications.ts`, "nothing is said about what you are already watching"). Nothing
 * ever told the main process what was being watched, so the answer was always "nothing" and the rule never once ran --
 * a download finishing while you sat on the downloads list still raised a notification about it.
 *
 * This is the one place the two vocabularies meet: the screen's own names on one side, notification groups on the
 * other. Null means nothing in particular is being watched, which is the honest answer for the chat.
 */

/** The groups notifications are put into. Taken from the templates in `notifications.ts`. */
export const WATCHABLE_GROUPS = ['workflows', 'schedules', 'downloads', 'research', 'artifacts', 'pages'] as const

export type WatchableGroup = (typeof WATCHABLE_GROUPS)[number]

/**
 * Which group a screen is showing, by the screen's own name.
 *
 * Only screens that really show the thing being announced are listed. Notes is not downloads, and the chat is not
 * anything -- a notification about a download is news there even though Orbis is in front.
 */
const BY_SURFACE: Record<string, WatchableGroup> = {
  create: 'artifacts',
  pages: 'pages',
  schedules: 'schedules',
  workflows: 'workflows',
  downloads: 'downloads',
  library: 'downloads',
  research: 'research'
}

/** The group a screen is watching, or null when it is not watching any of them. */
export function watchingGroup(surface: string | null | undefined): WatchableGroup | null {
  if (!surface) return null
  return BY_SURFACE[surface] ?? null
}
