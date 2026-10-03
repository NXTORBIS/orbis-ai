import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import type { WidgetFeedMap } from '../../../../../src/shared/widgetFeed.ts'

/**
 * The sums behind the personal widgets: how many rows a size has room for, what an arc measures, and the few readings
 * a row needs before anything can be drawn.
 *
 * They live here rather than in the drawing because none of them touches the page, and because a widget that says
 * "2 overdue" had better be right at every size it is drawn at. The rule that shapes most of this: a count of part of
 * a list is not a count of the list, so anything that would be a guess comes back as nothing instead.
 *
 * Pure: no DOM, no clock of its own, no words that need a language.
 */

const DAY = 86_400_000

// ---------------------------------------------------------------- room

/** How many rows each size has room for. Every widget writes its own; `medium` is the one they all have. */
export type SizeCaps = Partial<Record<WidgetSize, number>> & { medium: number }

/**
 * How many things to ask a source for: never more than the person asked for, never more than the size can show.
 *
 * Asking for what fits is the whole point -- a small card that asked for twenty rows would read nineteen of them to
 * throw them away, and a card that clipped them would be hiding things without saying so.
 */
export function rowsFor(size: WidgetSize, asked: number, caps: SizeCaps): number {
  const room = caps[size] ?? caps.medium
  const wanted = Number.isFinite(asked) ? Math.floor(asked) : room
  return Math.max(1, Math.min(room, wanted))
}

/** A setting read back as a number, or what the widget comes with when it is not one. */
export const asCount = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback)

// ---------------------------------------------------------------- parts of a whole

/** A part of a whole, as 0 to 1. Nothing of nothing is nothing, never a sum that cannot be drawn. */
export function shareOf(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0
  return Math.min(1, Math.max(0, part / whole))
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** The two lengths an SVG arc is drawn from: how much of the circle to paint, and how much to leave bare. */
export function arcDash(fraction: number, circumference: number): string {
  const on = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * Math.max(0, circumference)
  return `${round2(on)} ${round2(Math.max(0, circumference - on))}`
}

/** Where a point sits on a dial, as x and y about a centre. 0 is at the top and it goes round clockwise. */
export function onDial(turn: number, radius: number, centre: number): { x: number; y: number } {
  const angle = (Math.max(0, Math.min(1, Number.isFinite(turn) ? turn : 0)) - 0.25) * Math.PI * 2
  return { x: round2(centre + Math.cos(angle) * radius), y: round2(centre + Math.sin(angle) * radius) }
}

// ---------------------------------------------------------------- counting things, in words

/** "1 task", "4 tasks" -- a count with the right word after it. */
export const countOf = (n: number, one: string, many: string): string => `${Math.max(0, Math.floor(n))} ${Math.floor(n) === 1 ? one : many}`

/** "and 3 more", for a list the size could not show the whole of. Nothing at all when it showed everything. */
export function moreWords(shown: number, total: number): string {
  const left = Math.max(0, Math.floor(total) - Math.floor(shown))
  return left === 0 ? '' : `and ${left} more`
}

/**
 * The same, for a source that never says how many there are in all.
 *
 * Asking for one more row than a card shows is how it finds out whether there are any: fewer came back than were
 * asked for means that was all of them, and the count is exact. Exactly as many as were asked for means there may be
 * more and there is no honest number, so it says "and more" and leaves it at that.
 */
export function restWords(shown: number, read: number, asked: number): string {
  if (read - shown <= 0) return ''
  return read < asked ? moreWords(shown, read) : 'and more'
}

/** What is on a board, in words. The board itself is never drawn: nothing here says what is on it. */
export const boardWords = (elements: number): string => countOf(elements, 'thing', 'things')

/** A line of text fit for one row: no runs of spaces, no newlines, and cut with a mark when it was cut. */
export function snippet(text: string, most: number): string {
  const tidy = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (most <= 0) return ''
  return tidy.length <= most ? tidy : `${tidy.slice(0, most - 1).trimEnd()}…`
}

/** The letter a site stands for while its own picture is missing. Taken from its name, never invented. */
export function monogram(text: string): string {
  const found = String(text ?? '').trim().replace(/^www\./, '').match(/[\p{L}\p{N}]/u)
  return found ? found[0].toUpperCase() : '·'
}

// ---------------------------------------------------------------- days

/** Midnight at the start of the day something falls on, by this computer's own clock. */
export function startOfDay(at: number): number {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** How far through its day a moment is: 0 at midnight, 0.5 at noon. */
export const dayTurn = (at: number): number => shareOf(at - startOfDay(at), DAY)

/** "Today", "Tomorrow", "Yesterday" -- or nothing, when the day is far enough off to want its own name. */
export function dayWord(at: number, now: number): string {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY)
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : ''
}

// ---------------------------------------------------------------- tasks

export type TaskItem = WidgetFeedMap['tasks']['items'][number]

export interface TaskReading {
  /** How many match what was asked for, which is not how many were read. */
  total: number
  shown: number
  overdue: number
  important: number
  /** Whether everything that matches was read. Only then is a count of the ones read a count of them all. */
  whole: boolean
}

/**
 * What a list of tasks comes to.
 *
 * `overdue` and `important` are counted over the tasks that were actually read, so `whole` says whether that was all
 * of them. A card that cannot say "2 overdue" truthfully says nothing instead and marks the rows it can see.
 */
export function readTasks(value: WidgetFeedMap['tasks']): TaskReading {
  const items = value.items ?? []
  const total = Math.max(items.length, Math.floor(value.total ?? 0))
  return {
    total,
    shown: items.length,
    overdue: items.filter((one) => one.overdue).length,
    important: items.filter((one) => one.important).length,
    whole: items.length >= total
  }
}

/** The word under the count, for the tasks the person chose to see. */
export const viewWords = (view: string): string => (view === 'overdue' ? 'overdue' : view === 'flagged' ? 'important' : view === 'all' ? 'in all' : 'due today')

export interface DayMark {
  id: string
  /** Where on a dial of the day it falls, 0 at midnight. */
  turn: number
  overdue: boolean
}

/**
 * The tasks that can be put on a dial of today: the ones with a time on them, today.
 *
 * A task with only a date has no hour, and one due next week has no place on today's dial. Neither is guessed at --
 * they simply have no mark, and the count in the middle still counts them.
 */
export function dayMarks(items: readonly TaskItem[], now: number): DayMark[] {
  const today = startOfDay(now)
  const marks: DayMark[] = []
  for (const one of items) {
    if (one.dueAt === null || !one.hasTime || !Number.isFinite(one.dueAt)) continue
    if (startOfDay(one.dueAt) !== today) continue
    marks.push({ id: one.id, turn: dayTurn(one.dueAt), overdue: one.overdue === true })
  }
  return marks
}

// ---------------------------------------------------------------- downloads

export type DownloadItem = WidgetFeedMap['downloads']['items'][number]

/** Whether a download is still going, one way or another. */
export const stillComing = (one: Pick<DownloadItem, 'state'>): boolean => one.state === 'downloading' || one.state === 'paused'

/** How far a download has come, or nothing at all when the file never said how big it is. */
export const downloadShare = (one: Pick<DownloadItem, 'received' | 'total'>): number | null =>
  Number.isFinite(one.total) && one.total > 0 ? shareOf(one.received, one.total) : null

/** The one download worth showing large: the newest that is still coming. Nothing when they have all finished. */
export function leadDownload(items: readonly DownloadItem[]): DownloadItem | null {
  let lead: DownloadItem | null = null
  for (const one of items) {
    if (!stillComing(one)) continue
    // A download that is running beats one that is paused; between two of a kind, the one that moved last.
    const better = lead === null || (one.state === 'downloading' && lead.state === 'paused') || (one.state === lead.state && one.at > lead.at)
    if (better) lead = one
  }
  return lead
}

// ---------------------------------------------------------------- clipboard

/** What kind of thing a clip is, in a word a person would use for it. */
export const clipWord = (kind: WidgetFeedMap['clipboard']['items'][number]['kind']): string =>
  kind === 'link' ? 'Link' : kind === 'image' ? 'Picture' : kind === 'text' ? 'Text' : 'Copied'

// ---------------------------------------------------------------- workspaces and tabs

export type Workspace = WidgetFeedMap['workspaces']['items'][number]

/**
 * Workspaces with the one in use first.
 *
 * Only because a card shows a few of them and the one you are in is the one you most want to see: on a card that
 * shows them all this changes only the order, never which ones are there.
 */
export const currentFirst = (items: readonly Workspace[]): Workspace[] => [...items].sort((a, b) => Number(b.current) - Number(a.current))

/** The few pictures to pile up, and how many of the whole lot are not in the pile. */
export function stackOf<T>(items: readonly T[], most: number, total: number): { shown: T[]; hidden: number } {
  const shown = items.slice(0, Math.max(0, Math.floor(most)))
  return { shown, hidden: Math.max(0, Math.floor(total) - shown.length) }
}
