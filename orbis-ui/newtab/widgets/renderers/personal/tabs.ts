import type { WidgetContext } from '../../api.ts'
import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import { h, hostOf } from '../../dom.ts'
import { asCount, countOf, rowsFor, snippet, stackOf } from './sums.ts'
import { flash, press, saidAloud, siteMark } from './parts.ts'

/**
 * Open tabs: how many there are, over a pile of the pages themselves.
 *
 * The number is the whole point of the card, so it is the whole of the small one. Under it the pages are piled like
 * cards in a hand, each one its own picture -- a count you can see the shape of. Bigger cards put names to the first
 * few and let you go straight to one.
 */

const ROWS: Record<WidgetSize, number> = { small: 4, medium: 3, tall: 6, large: 6, wide: 4 }

/** How many pictures go in the pile. More than this and they stop being separate things. */
const PILE: Record<WidgetSize, number> = { small: 5, medium: 4, tall: 5, large: 5, wide: 5 }

export function drawTabs(ctx: WidgetContext): void {
  const rows = rowsFor(ctx.size, asCount(ctx.settings.limit, 5), ROWS)
  ctx.feed(
    { source: 'tabs', limit: Math.max(rows, PILE[ctx.size]) },
    (feed) => {
      const said = saidAloud()
      const { count, groups, items } = feed.value
      const lists = ctx.size !== 'small'
      const pile = stackOf(items, PILE[ctx.size], count)
      const root = h('div', { class: 'wg-tabs', 'data-size': ctx.size }, said)

      const face = h(
        'div',
        { class: 'wg-tabs-face' },
        h('span', { class: 'wg-big wg-tabs-count', text: String(count) }),
        h('span', { class: 'wg-label wg-tabs-word', text: count === 1 ? 'open tab' : 'open tabs' })
      )
      if (groups > 0) face.append(h('span', { class: 'wg-chip wg-tabs-groups', text: countOf(groups, 'group', 'groups') }))

      const heap = h('div', { class: 'wg-tabs-pile', role: 'img', 'aria-label': `${countOf(count, 'tab', 'tabs')} open` })
      for (const one of pile.shown) heap.append(h('span', { class: 'wg-tabs-card', ...(one.active ? { 'data-here': 'yes' } : {}) }, siteMark(one.url, one.title || hostOf(one.url), 22)))
      if (pile.hidden > 0) heap.append(h('span', { class: 'wg-tabs-card wg-tabs-rest', text: `+${pile.hidden}` }))
      root.append(h('div', { class: 'wg-tabs-head' }, face, heap))

      if (lists) {
        const list = h('div', { class: 'wg-list wg-tabs-list' })
        for (const one of items.slice(0, rows)) {
          const name = snippet(one.title, 80) || hostOf(one.url)
          const here = one.active === true
          const button = press(
            ctx,
            here ? `${name}. The tab you are on.` : `Go to ${name}`,
            async () => {
              const result = await ctx.run({ do: 'tab.activate', id: one.id })
              if (!result.ok) flash(ctx, button, said, result.message, 3200)
            },
            [
              siteMark(one.url, name, 18),
              h('span', { class: 'wg-row-main', text: name }),
              here && h('span', { class: 'wg-chip wg-tabs-here', text: 'Here' })
            ],
            'wg-tabs-row'
          )
          if (here) button.setAttribute('data-here', 'yes')
          list.append(button)
        }
        root.append(list)
      }
      ctx.body.append(root)
    },
    { empty: (value) => value.count === 0 && value.items.length === 0, emptyText: 'No tabs open' }
  )
}
