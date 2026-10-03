import type { WidgetContext } from '../../api.ts'
import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import { h, svg } from '../../dom.ts'
import { countOf, currentFirst, restWords, snippet } from './sums.ts'
import { flash, press, saidAloud } from './parts.ts'

/**
 * Workspaces: your saved sets of pages, as a shelf of them.
 *
 * Each one is drawn as a little stack, because that is what a workspace is -- several pages held together. How many
 * it holds is written under its name, and the one you are in carries the word "Now" as well as a brighter edge, so
 * it is never colour alone that tells you where you are.
 */

const TILES: Record<WidgetSize, number> = { small: 2, medium: 3, tall: 4, large: 6, wide: 4 }

/** A stack of pages, drawn. Three sheets whatever the count: it stands for a workspace, not for its contents. */
const stack = (): SVGElement =>
  svg(
    'svg',
    { class: 'wg-workspaces-art', viewBox: '0 0 44 34', width: 44, height: 34, 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { class: 'wg-workspaces-back', x: 8.5, y: 2.5, width: 27, height: 20, rx: 4 }),
    svg('rect', { class: 'wg-workspaces-mid', x: 5.5, y: 6.5, width: 33, height: 22, rx: 4.5 }),
    svg('rect', { class: 'wg-workspaces-front', x: 2.5, y: 10.5, width: 39, height: 21, rx: 5 }),
    svg('path', { class: 'wg-workspaces-line', d: 'M8 17h14M8 22h22', 'stroke-width': 1.6, 'stroke-linecap': 'round' })
  )

export function drawWorkspaces(ctx: WidgetContext): void {
  // A workspace has no "How many" of its own: how many fit is the only thing that decides it.
  const tiles = TILES[ctx.size]
  // One more than fits, so the card can tell whether anything was left out.
  const asked = tiles + 1
  ctx.feed(
    { source: 'workspaces', limit: asked },
    (feed) => {
      const said = saidAloud()
      const items = currentFirst(feed.value.items)
      const root = h('div', { class: 'wg-p-grid wg-workspaces', 'data-size': ctx.size }, said)
      for (const one of items.slice(0, tiles)) {
        const name = snippet(one.name, 50) || 'Untitled workspace'
        const held = countOf(one.tabs, 'page', 'pages')
        const tile = press(
          ctx,
          one.current ? `${name}. The workspace you are in. ${held}.` : `Open ${name}. ${held}.`,
          async () => {
            const result = await ctx.run({ do: 'workspace.open', id: one.id })
            if (!result.ok) flash(ctx, tile, said, result.message, 3200)
          },
          [
            stack(),
            h('span', { class: 'wg-workspaces-name', text: name }),
            h('span', { class: 'wg-label wg-workspaces-held', text: held }),
            one.current && h('span', { class: 'wg-chip wg-workspaces-now', text: 'Now' })
          ],
          'wg-p-tile wg-workspaces-tile'
        )
        if (one.current) tile.setAttribute('data-here', 'yes')
        root.append(tile)
      }
      ctx.body.append(root)
      const rest = restWords(Math.min(tiles, items.length), items.length, asked)
      if (rest !== '') ctx.show.note(rest)
    },
    // There is no "Open Workspaces" to offer here: the side panel has no workspaces screen, and a button that
    // quietly showed something else would be a button that lies about what it does.
    { empty: (value) => value.items.length === 0, emptyText: 'No workspaces saved yet' }
  )
}
