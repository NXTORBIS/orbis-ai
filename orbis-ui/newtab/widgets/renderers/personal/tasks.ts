import type { WidgetContext } from '../../api.ts'
import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import { ago, h, svg, until } from '../../dom.ts'
import { arcDash, asCount, countOf, dayMarks, dayTurn, dayWord, moreWords, onDial, readTasks, rowsFor, snippet, viewWords, type DayMark, type TaskItem, type TaskReading } from './sums.ts'
import { flash, glyph, press, saidAloud, spoken } from './parts.ts'

/**
 * Tasks: how many are due, drawn on a dial of the day, with the next few under it to tick off.
 *
 * The dial is a real picture of a real thing. The ring is today: midnight at the top, the painted part is the day so
 * far, the bright dot is now, and each tick on the rim is one of the tasks listed below that has a time on it. A task
 * with only a date has no hour, so it has no tick -- it is counted in the middle and nowhere else. Nothing on the
 * dial stands for anything Orbis was not told.
 */

const VIEWS = ['today', 'overdue', 'flagged', 'all'] as const
type TaskView = (typeof VIEWS)[number]

const viewOf = (value: unknown): TaskView => ((VIEWS as readonly string[]).includes(String(value)) ? (String(value) as TaskView) : 'today')

/** How many tasks each size lists. Small lists none: it is the dial and the count, and that is the whole of it. */
const ROWS: Record<WidgetSize, number> = { small: 1, medium: 3, tall: 5, large: 6, wide: 3 }
const DIAL: Record<WidgetSize, number> = { small: 112, medium: 88, tall: 104, large: 100, wide: 88 }

/** What the card says when there is nothing, in the words of the tasks the person asked to see. */
const nothingWords = (view: TaskView): string =>
  view === 'overdue' ? 'Nothing overdue' : view === 'flagged' ? 'Nothing marked important' : view === 'all' ? 'No tasks' : 'Nothing due'

/** When a task is wanted, in as few words as a row has room for. */
function dueWords(one: TaskItem, now: number): string {
  if (one.dueAt === null || !Number.isFinite(one.dueAt)) return ''
  if (one.overdue) return 'Overdue'
  if (one.hasTime) return until(one.dueAt, now)
  return dayWord(one.dueAt, now) || (one.dueAt < now ? ago(one.dueAt, now) : until(one.dueAt, now))
}

/**
 * The dial: today as a ring, the count in the middle, and the whole thing a way into Tasks.
 *
 * Pressed, it opens Tasks. It is the one thing on the card at every size, so it is the one thing that has to be a way
 * in -- a row of buttons underneath would be a second answer to the same question and would not fit a small card.
 */
function dial(ctx: WidgetContext, reading: TaskReading, marks: readonly DayMark[], px: number, word: string): HTMLElement {
  const half = px / 2
  const thickness = Math.max(5, Math.round(px * 0.075))
  const radius = half - thickness / 2 - 2
  const round = 2 * Math.PI * radius
  const turn = dayTurn(ctx.now())
  const art = svg('svg', { class: 'wg-tasks-art', viewBox: `0 0 ${px} ${px}`, width: px, height: px, 'aria-hidden': 'true', focusable: 'false' })
  art.append(svg('circle', { class: 'wg-tasks-track', cx: half, cy: half, r: radius, 'stroke-width': thickness }))
  art.append(
    svg('circle', {
      class: 'wg-tasks-day',
      cx: half,
      cy: half,
      r: radius,
      'stroke-width': thickness,
      'stroke-linecap': 'round',
      'stroke-dasharray': arcDash(turn, round),
      transform: `rotate(-90 ${half} ${half})`
    })
  )
  for (const mark of marks) {
    const inner = onDial(mark.turn, radius - thickness / 2 - 0.5, half)
    const outer = onDial(mark.turn, radius + thickness / 2 + 1.5, half)
    art.append(svg('line', { class: 'wg-tasks-mark', ...(mark.overdue ? { 'data-late': 'yes' } : {}), x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, 'stroke-width': 2.6, 'stroke-linecap': 'round' }))
  }
  const at = onDial(turn, radius, half)
  art.append(svg('circle', { class: 'wg-tasks-now', cx: at.x, cy: at.y, r: Math.max(2.2, thickness * 0.38) }))

  const middle = h(
    'span',
    { class: 'wg-tasks-mid' },
    h('span', { class: 'wg-big wg-tasks-count', text: String(reading.total) }),
    h('span', { class: 'wg-label wg-tasks-word', text: word })
  )
  const late = reading.whole && reading.overdue > 0 ? `, ${reading.overdue} of them overdue` : ''
  const face = press(ctx, `Open Tasks. ${countOf(reading.total, 'task', 'tasks')} ${word}${late}.`, () => void ctx.run({ do: 'panel.open', view: 'tasks' }), [art, middle], 'wg-tasks-dial')
  face.style.setProperty('--wg-dial', `${px}px`)
  face.title = 'Open Tasks'
  return face
}

/** One task: a round button to tick it off, what it is, and when it is wanted. */
function taskRow(ctx: WidgetContext, one: TaskItem, now: number, said: HTMLElement): HTMLElement {
  const title = snippet(one.title, 90) || 'Untitled task'
  const row = h('div', { class: 'wg-tasks-row', ...(one.overdue ? { 'data-late': 'yes' } : {}) })
  const tick = press(
    ctx,
    `Tick off ${title}`,
    async () => {
      const result = await ctx.run({ do: 'task.complete', id: one.id })
      if (!result.ok) {
        flash(ctx, row, said, result.message, 3200)
        return
      }
      // Ticked off for real: the row says so at once rather than waiting for the list to be read again.
      row.setAttribute('data-done', 'yes')
      tick.disabled = true
      flash(ctx, row, said, `${title} is ticked off.`)
    },
    [glyph('tick', 13)],
    'wg-tasks-tick'
  )
  const name = h('span', { class: 'wg-row-main wg-tasks-name', text: title })
  const when = dueWords(one, now)
  row.append(tick)
  if (one.important) row.append(glyph('star', 13), spoken('Important. '))
  row.append(name)
  if (when !== '') row.append(h('span', { class: 'wg-row-side wg-tasks-when', text: when }))
  return row
}

export function drawTasks(ctx: WidgetContext): void {
  const view = viewOf(ctx.settings.view)
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 5), ROWS)
  ctx.feed(
    { source: 'tasks', view, limit },
    (feed) => {
      const now = ctx.now()
      const reading = readTasks(feed.value)
      const word = viewWords(view)
      const lists = ctx.size !== 'small'
      const marks = lists ? dayMarks(feed.value.items, now) : []
      const said = saidAloud()
      const face = dial(ctx, reading, marks, DIAL[ctx.size], word)

      const root = h('div', { class: 'wg-tasks', 'data-size': ctx.size }, said)
      if (ctx.size === 'large') {
        const chips = h('div', { class: 'wg-tasks-chips' })
        if (reading.whole && reading.overdue > 0) chips.append(h('span', { class: 'wg-chip', 'data-wg-tone': 'red' }, glyph('alert', 12), h('span', { text: countOf(reading.overdue, 'overdue', 'overdue') })))
        if (reading.whole && reading.important > 0) chips.append(h('span', { class: 'wg-chip', 'data-wg-tone': 'amber' }, glyph('star', 12), h('span', { text: countOf(reading.important, 'important', 'important') })))
        root.append(h('div', { class: 'wg-tasks-head' }, face, chips))
      } else {
        root.append(face)
      }

      if (lists) {
        root.append(h('div', { class: 'wg-list wg-tasks-list' }, ...feed.value.items.slice(0, limit).map((one) => taskRow(ctx, one, now, said))))
      }
      ctx.body.append(root)
      const more = moreWords(lists ? Math.min(limit, feed.value.items.length) : 0, reading.total)
      if (lists && more !== '') ctx.show.note(more)
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: nothingWords(view),
      emptyAction: { label: 'Open Tasks', press: () => void ctx.run({ do: 'panel.open', view: 'tasks' }) },
      everyMs: 60_000
    }
  )
}
