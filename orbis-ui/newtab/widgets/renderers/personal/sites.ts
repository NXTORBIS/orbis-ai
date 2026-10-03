import type { WidgetContext } from '../../api.ts'
import type { WidgetSize } from '../../../../../src/shared/widgets.ts'
import { ago, h, isWeb } from '../../dom.ts'
import { asCount, moreWords, rowsFor } from './sums.ts'
import { siteTile } from './parts.ts'

/**
 * Bookmarks and recent sites: the same picture, asked a different question.
 *
 * Both are a grid of sites, each one its own small picture with its name under it, and pressing one goes there. The
 * only difference is that a page you were just on also says when -- which is the thing that tells two visits to the
 * same site apart, and the thing a bookmark has nothing to say about.
 *
 * Addresses that are not web pages are left out rather than drawn as tiles that would do nothing when pressed.
 */

const BOOKMARKS: Record<WidgetSize, number> = { small: 4, medium: 4, tall: 6, large: 8, wide: 6 }
const RECENT: Record<WidgetSize, number> = { small: 3, medium: 3, tall: 4, large: 6, wide: 5 }

export function drawBookmarks(ctx: WidgetContext): void {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 6), BOOKMARKS)
  ctx.feed(
    { source: 'bookmarks', limit },
    (feed) => {
      const sites = feed.value.items.filter((one) => isWeb(one.url)).slice(0, limit)
      ctx.body.append(h('div', { class: 'wg-p-grid wg-bookmarks', 'data-size': ctx.size }, ...sites.map((one) => siteTile(ctx, one.url, one.title, ''))))
      const more = moreWords(sites.length, Math.max(feed.value.total, feed.value.items.length))
      if (more !== '') ctx.show.note(more)
    },
    {
      empty: (value) => value.items.filter((one) => isWeb(one.url)).length === 0,
      emptyText: 'No bookmarks yet'
    }
  )
}

export function drawRecent(ctx: WidgetContext): void {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 6), RECENT)
  ctx.feed(
    { source: 'recent', limit },
    (feed) => {
      const now = ctx.now()
      const sites = feed.value.items.filter((one) => isWeb(one.url)).slice(0, limit)
      ctx.body.append(h('div', { class: 'wg-p-grid wg-recent', 'data-size': ctx.size }, ...sites.map((one) => siteTile(ctx, one.url, one.title || one.host, ago(one.at, now)))))
    },
    {
      empty: (value) => value.items.filter((one) => isWeb(one.url)).length === 0,
      emptyText: 'No sites visited yet',
      everyMs: 60_000
    }
  )
}
