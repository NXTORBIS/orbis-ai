import type { WidgetContext } from '../../api.ts'
import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import { ago, h, svg } from '../../dom.ts'
import { asCount, boardWords, restWords, rowsFor, snippet } from './sums.ts'

/**
 * Whiteboards: your boards, with their names and how much is on each.
 *
 * The mark on every tile is the same mark. Orbis hands this card a name, a count and a date -- nothing at all about
 * what was drawn on the board -- so a little sketch here would be a picture of something nobody drew. One honest
 * frame, the same for every board, says "a board" and claims nothing else.
 *
 * The tiles are not buttons either: there is no way for a widget to ask Orbis to open a board, and a tile that did
 * nothing when pressed would be worse than a tile that never looked pressable.
 */

const TILES: Record<WidgetSize, number> = { small: 2, medium: 3, tall: 4, large: 6, wide: 4 }

/** A board, drawn: a frame on a stand, with the faint rule of a board behind it and no drawing on it. */
const frame = (): SVGElement =>
  svg(
    'svg',
    { class: 'wg-whiteboard-art', viewBox: '0 0 48 36', width: 48, height: 36, 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { class: 'wg-whiteboard-face', x: 2.5, y: 2.5, width: 43, height: 26, rx: 3.5 }),
    svg('path', { class: 'wg-whiteboard-rule', d: 'M9 10h30M9 16h30M9 22h18', 'stroke-width': 1.2, 'stroke-linecap': 'round' }),
    svg('path', { class: 'wg-whiteboard-stand', d: 'M24 28.5v5M16 33.5h16', 'stroke-width': 1.8, 'stroke-linecap': 'round' })
  )

export function drawWhiteboard(ctx: WidgetContext): void {
  const tiles = rowsFor(ctx.size, asCount(ctx.settings.limit, 3), TILES)
  const asked = tiles + 1
  ctx.feed(
    { source: 'whiteboard', limit: asked },
    (feed) => {
      const now = ctx.now()
      const items = feed.value.items
      const root = h('div', { class: 'wg-p-grid wg-whiteboard', 'data-size': ctx.size })
      for (const one of items.slice(0, tiles)) {
        const name = snippet(one.name, 50) || 'Untitled board'
        root.append(
          h(
            'article',
            { class: 'wg-whiteboard-tile' },
            frame(),
            h('h3', { class: 'wg-whiteboard-name', text: name }),
            h('p', { class: 'wg-label wg-whiteboard-held', text: `${boardWords(one.elements)} · ${ago(one.updatedAt, now)}` })
          )
        )
      }
      ctx.body.append(root)
      const rest = restWords(Math.min(tiles, items.length), items.length, asked)
      if (rest !== '') ctx.show.note(rest)
    },
    { empty: (value) => value.items.length === 0, emptyText: 'No boards yet' }
  )
}
