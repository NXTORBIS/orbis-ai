import type { WidgetContext } from '../../api.ts'
import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import { clockTime, h, svg, until } from '../../dom.ts'
import { asCount, dayWord, moreWords, rowsFor, snippet } from './sums.ts'
import { spoken } from './parts.ts'

/**
 * Reminders: what is coming, as a line you read downwards.
 *
 * The next one is the whole top of the card -- the time it happens, large, and how long that is from now in words --
 * because the one thing somebody wants from this card is whether they have to move yet. The rest hang off a rail
 * under it in the order they arrive. Nothing is invented: a reminder with no time is not a reminder and never
 * reaches this card.
 */

/** How many go on the rail under the next one, by size. */
const ROWS: Record<WidgetSize, number> = { small: 2, medium: 3, tall: 5, large: 5, wide: 3 }

/** The drawn bead on the rail, which is the only thing holding the line together. */
const pip = (lead: boolean): SVGElement =>
  svg(
    'svg',
    { class: 'wg-reminders-pip', ...(lead ? { 'data-lead': 'yes' } : {}), viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { class: 'wg-reminders-pip-ring', cx: 6, cy: 6, r: 4.4 }),
    svg('circle', { class: 'wg-reminders-pip-dot', cx: 6, cy: 6, r: lead ? 2.6 : 1.8 })
  )

/** The day a reminder falls on, when that is not today. Today needs no saying: the time alone says it. */
const dayPart = (at: number, now: number): string => {
  const word = dayWord(at, now)
  if (word === 'Today') return ''
  return word !== '' ? word : new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(at)
}

export function drawReminders(ctx: WidgetContext): void {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 5), ROWS)
  ctx.feed(
    { source: 'reminders', limit: limit + 1 },
    (feed) => {
      const now = ctx.now()
      const items = feed.value.items
      const [next, ...rest] = items
      const root = h('div', { class: 'wg-reminders', 'data-size': ctx.size, 'data-still': ctx.still ? 'yes' : 'no' })

      const when = dayPart(next.at, now)
      const lead = h(
        'div',
        { class: 'wg-reminders-next' },
        h('div', { class: 'wg-reminders-face' }, pip(true), h('span', { class: 'wg-big wg-reminders-time', text: clockTime(next.at, ctx.hour12) })),
        h('p', { class: 'wg-sub wg-reminders-title', text: snippet(next.title, 90) || 'Untitled reminder' }),
        h('p', { class: 'wg-reminders-away' }, spoken('Starts '), h('span', { text: until(next.at, now) }), when !== '' && h('span', { class: 'wg-reminders-day', text: when }))
      )
      root.append(lead)

      const others = rest.slice(0, limit)
      if (others.length > 0) {
        const rail = h('ul', { class: 'wg-list wg-reminders-rail' })
        for (const one of others) {
          const side = dayPart(one.at, now)
          rail.append(
            h(
              'li',
              { class: 'wg-reminders-row' },
              h('span', { class: 'wg-reminders-stem' }, pip(false)),
              h('span', { class: 'wg-row-main', text: snippet(one.title, 70) || 'Untitled reminder' }),
              h('span', { class: 'wg-row-side wg-reminders-at', text: side === '' ? clockTime(one.at, ctx.hour12) : `${side} ${clockTime(one.at, ctx.hour12)}` })
            )
          )
        }
        root.append(rail)
      }
      ctx.body.append(root)
      const more = moreWords(1 + others.length, Math.max(feed.value.total, items.length))
      if (more !== '') ctx.show.note(more)
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: 'Nothing coming up',
      emptyAction: { label: 'Open Tasks', press: () => void ctx.run({ do: 'panel.open', view: 'tasks' }) },
      everyMs: 60_000
    }
  )
}
