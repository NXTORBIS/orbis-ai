import type { WidgetContext } from '../../api.ts'
import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import { ago, h } from '../../dom.ts'
import { asCount, moreWords, rowsFor, snippet } from './sums.ts'
import { flash, glyph, openPanel, press, saidAloud } from './parts.ts'

/**
 * Notes: the last few, as small sheets of paper.
 *
 * A sheet is a picture of a note and nothing more -- its name, the first line of it, and when it was last touched.
 * It is not a button, because Orbis has no way for a widget to open one note; the two things this card really can do
 * are start a note and open Notes, and they are the two buttons on it.
 */

const SHEETS: Record<WidgetSize, number> = { small: 1, medium: 2, tall: 3, large: 4, wide: 4 }

export function drawNotes(ctx: WidgetContext): void {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 4), SHEETS)
  const said = saidAloud()

  const start = (root: HTMLElement): HTMLButtonElement =>
    press(
      ctx,
      'New note',
      async () => {
        const result = await ctx.run({ do: 'note.create' })
        flash(ctx, root, said, result.ok ? (result.message ?? 'A new note is started.') : result.message, 2600)
      },
      [glyph('plus', 13), h('span', { text: 'New note' })],
      'wg-btn primary wg-notes-new'
    )

  ctx.feed(
    { source: 'notes', limit },
    (feed) => {
      const now = ctx.now()
      const root = h('div', { class: 'wg-notes', 'data-size': ctx.size }, said)
      const sheets = h('div', { class: 'wg-notes-sheets' })
      for (const one of feed.value.items.slice(0, limit)) {
        const excerpt = snippet(one.excerpt, 140)
        sheets.append(
          h(
            'article',
            { class: 'wg-notes-paper' },
            h('h3', { class: 'wg-notes-name', text: snippet(one.title, 70) || 'Untitled note' }),
            excerpt !== '' && h('p', { class: 'wg-notes-excerpt', text: excerpt }),
            h('p', { class: 'wg-label wg-notes-when', text: ago(one.updatedAt, now) })
          )
        )
      }
      root.append(sheets, h('div', { class: 'wg-row wg-notes-feet' }, start(root), openPanel(ctx, 'notes', 'Open Notes')))
      ctx.body.append(root)
      const more = moreWords(Math.min(limit, feed.value.items.length), Math.max(feed.value.total, feed.value.items.length))
      if (more !== '') ctx.show.note(more)
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: 'No notes yet',
      emptyAction: { label: 'New note', press: () => void ctx.run({ do: 'note.create' }) }
    }
  )
}
