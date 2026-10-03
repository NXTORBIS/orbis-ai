import type { WidgetContext } from '../../api.ts'
import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import { ago, bytes, h } from '../../dom.ts'
import { asCount, downloadShare, leadDownload, restWords, rowsFor, snippet, stillComing, type DownloadItem } from './sums.ts'
import { flash, glyph, press, progressBar, progressRing, saidAloud, type GlyphName, type Tone } from './parts.ts'

/**
 * Downloads: how far each one has come, drawn.
 *
 * Every row carries a ring of its own progress, and on a tall card whatever is still arriving is shown large above
 * them. A file whose size the server never gave has no ring to fill, so it is drawn as a bare track with the amount
 * received beside it -- a full circle there would say "finished" about something that is not.
 *
 * Only a finished download is a button, because showing where a file is is the only thing Orbis can do with one from
 * here, and a half-arrived file is not anywhere yet.
 */

const ROWS: Record<WidgetSize, number> = { small: 2, medium: 3, tall: 5, large: 5, wide: 3 }

const MARKS: Record<DownloadItem['state'], { glyph: GlyphName; tone: Tone }> = {
  done: { glyph: 'tick', tone: 'green' },
  downloading: { glyph: 'down', tone: 'accent' },
  paused: { glyph: 'pause', tone: 'amber' },
  failed: { glyph: 'alert', tone: 'red' }
}

/** The size of a download: what it will be when it has all arrived, or what has arrived when nothing said. */
const sizeWords = (one: DownloadItem): string => bytes(one.total > 0 ? one.total : one.received)

/** How a download is going, in a line. Everything in it was handed over; nothing is worked out from nothing. */
function stateWords(one: DownloadItem, now: number): string {
  const share = downloadShare(one)
  const percent = share === null ? '' : `${Math.round(share * 100)}%`
  if (one.state === 'done') return [`Done`, sizeWords(one), ago(one.at, now)].filter((part) => part !== '').join(' · ')
  if (one.state === 'failed') return 'Failed'
  if (one.state === 'paused') return share === null ? `Paused · ${bytes(one.received)} so far` : `Paused · ${percent}`
  return share === null ? `${bytes(one.received)} so far` : `${percent} · ${bytes(one.received)} of ${bytes(one.total)}`
}

/** One download: a ring of its progress, its name, and how it is going. */
function row(ctx: WidgetContext, one: DownloadItem, now: number, said: HTMLElement): HTMLElement {
  const name = snippet(one.name, 80) || 'A file'
  const mark = MARKS[one.state] ?? MARKS.downloading
  const share = one.state === 'done' ? 1 : downloadShare(one)
  const words = stateWords(one, now)
  const inside = h('span', { class: 'wg-downloads-inside' }, glyph(mark.glyph, 13))
  const body = [
    progressRing(share, 34, 3, mark.tone, inside),
    h('span', { class: 'wg-downloads-text' }, h('span', { class: 'wg-row-main wg-downloads-name', text: name }), h('span', { class: 'wg-downloads-state', text: words }))
  ]
  if (one.state !== 'done') return h('div', { class: 'wg-downloads-row', 'data-state': one.state }, ...body)
  const button = press(
    ctx,
    `Show ${name}. ${words}.`,
    async () => {
      const result = await ctx.run({ do: 'download.show', id: one.id })
      if (!result.ok) flash(ctx, button, said, result.message, 3200)
    },
    body,
    'wg-downloads-row'
  )
  button.setAttribute('data-state', one.state)
  return button
}

/** Whatever is arriving right now, shown large: the share as a numeral, the name, and a bar under both. */
function lead(ctx: WidgetContext, one: DownloadItem, now: number): HTMLElement {
  const share = downloadShare(one)
  const percent = share === null ? bytes(one.received) : `${Math.round(share * 100)}%`
  return h(
    'div',
    { class: 'wg-downloads-lead', 'data-state': one.state, 'data-still': ctx.still ? 'yes' : 'no' },
    h('div', { class: 'wg-row wg-downloads-leadtop' }, h('span', { class: 'wg-big wg-downloads-pc', text: percent }), glyph(MARKS[one.state].glyph, 15)),
    h('p', { class: 'wg-downloads-leadname', text: snippet(one.name, 70) || 'A file' }),
    progressBar(share, MARKS[one.state].tone),
    h('p', { class: 'wg-label wg-downloads-leadstate', text: stateWords(one, now) })
  )
}

export function drawDownloads(ctx: WidgetContext): void {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 4), ROWS)
  // One more than the card shows, so it can tell whether what came back was everything there is.
  const asked = limit + 1
  ctx.feed(
    { source: 'downloads', limit: asked },
    (feed) => {
      const now = ctx.now()
      const said = saidAloud()
      const items = feed.value.items
      const root = h('div', { class: 'wg-downloads', 'data-size': ctx.size }, said)
      // Only a tall card has the room to show one large and still list the rest; a medium one is all rows.
      const big = ctx.size === 'tall' || ctx.size === 'large' ? leadDownload(items) : null
      if (big) root.append(lead(ctx, big, now))
      const rest = items.filter((one) => one !== big).slice(0, big ? limit - 1 : limit)
      if (rest.length > 0) root.append(h('div', { class: 'wg-list wg-downloads-list' }, ...rest.map((one) => row(ctx, one, now, said))))
      ctx.body.append(root)
      const shown = rest.length + (big ? 1 : 0)
      const left = restWords(shown, items.length, asked)
      // "2 still coming" is only true of the whole list, and the list is whole only when fewer came back than were asked for.
      const coming = items.length < asked && !big ? items.filter(stillComing).length : 0
      const note = left !== '' ? left : coming > 0 ? (coming === 1 ? '1 still coming' : `${coming} still coming`) : ''
      if (note !== '') ctx.show.note(note)
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: 'Nothing downloaded yet',
      everyMs: 60_000
    }
  )
}
