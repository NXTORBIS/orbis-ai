import type { WidgetContext } from '../../api.ts'
import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import { ago, h } from '../../dom.ts'
import { asCount, clipWord, moreWords, rowsFor, snippet } from './sums.ts'
import { flash, glyph, press, saidAloud, spoken } from './parts.ts'

/**
 * Clipboard: the last few things you copied, ready to copy again.
 *
 * Each one is a scrap of what it was, with a mark saying what kind of thing it is. A picture that was copied is drawn
 * as a picture mark and described in words -- never as the picture itself, because the card was handed a description
 * of it and not the thing.
 *
 * Pressing one copies it again and the scrap says "Copied" for a moment, which is the only way anybody would know
 * that an invisible thing had happened.
 */

const SCRAPS: Record<WidgetSize, number> = { small: 2, medium: 2, tall: 4, large: 4, wide: 3 }

export function drawClipboard(ctx: WidgetContext): void {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 4), SCRAPS)
  ctx.feed(
    { source: 'clipboard', limit },
    (feed) => {
      const now = ctx.now()
      const said = saidAloud()
      const root = h('div', { class: 'wg-clipboard', 'data-size': ctx.size }, said)
      for (const one of feed.value.items.slice(0, limit)) {
        const kind = clipWord(one.kind)
        const text = snippet(one.preview, 160)
        const scrap = press(
          ctx,
          `Copy again: ${kind}. ${text}`,
          async () => {
            const result = await ctx.run({ do: 'clip.copy', id: one.id })
            flash(ctx, scrap, said, result.ok ? 'Copied' : result.message, result.ok ? 1600 : 3200)
          },
          [
            h('span', { class: 'wg-clipboard-kind' }, glyph(one.kind, 13), h('span', { class: 'wg-label', text: kind })),
            h('span', { class: 'wg-clipboard-text', text }),
            h('span', { class: 'wg-clipboard-when wg-label', text: ago(one.at, now) }),
            spoken('Press to copy it again.')
          ],
          'wg-clipboard-scrap'
        )
        scrap.setAttribute('data-kind', one.kind)
        root.append(scrap)
      }
      ctx.body.append(root)
      const more = moreWords(Math.min(limit, feed.value.items.length), Math.max(feed.value.total, feed.value.items.length))
      if (more !== '') ctx.show.note(more)
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: 'Nothing copied yet',
      everyMs: 60_000
    }
  )
}
