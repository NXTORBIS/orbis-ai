import type { WidgetContext, WidgetSize } from '../../api.ts'
import { ago, clear, favicon, h, hostOf, isWeb } from '../../dom.ts'

/**
 * Headlines from the feeds the person chose, newest first.
 *
 * The newest one is given the room a headline wants -- its own block, its source and when it arrived -- and the rest
 * follow as single lines, because four headlines at the same weight is a list and one headline with four behind it
 * is a front page.
 *
 * Orbis chooses none of them. There is no default feed anywhere in this file: with nothing chosen the feed says a
 * feed is needed and the card asks for one. A feed that could not be read is named rather than quietly dropped, so a
 * short list is never mistaken for a quiet day.
 */

/** How many lines follow the lead headline at each size. More room means more headlines, not a bigger headline. */
const AFTER: Readonly<Record<WidgetSize, number>> = Object.freeze({ small: 0, medium: 2, tall: 4, large: 5, wide: 3 })

/**
 * How long ago, short enough to sit at the end of a line: "now", "5 min", "3 hr", "2 days", then the date.
 *
 * The lead headline has room for the whole phrase and uses it. These are the lines where the full wording would push
 * the headline itself off the card, and a headline nobody can read is worse than a time nobody reads twice.
 */
function briefly(at: number, now: number): string {
  const gap = now - at
  if (!Number.isFinite(gap) || gap < 0) return ''
  if (gap < 60_000) return 'now'
  const minutes = Math.floor(gap / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? '1 day' : `${days} days`
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(at)
}

/** The site's own small picture, asked of the browser. A site the browser has none for simply has none: the row still reads. */
function mark(url: string): HTMLElement | null {
  if (!isWeb(url)) return null
  const image = h('img', { class: 'wg-news-mark', src: favicon(url, 32), alt: '', width: 16, height: 16, loading: 'lazy' })
  image.addEventListener('error', () => image.remove())
  return image
}

/** A headline that opens where it came from. In a preview it has no address, which is what makes it unpressable. */
function headline(ctx: WidgetContext, url: string, cls: string, inside: (HTMLElement | string | null)[]): HTMLElement {
  const openable = isWeb(url) && !ctx.preview
  const node = h('a', {
    class: cls,
    ...(openable ? { href: url, title: hostOf(url) } : {}),
    onclick: (event: Event) => {
      event.preventDefault()
      if (openable) ctx.open(url)
    }
  })
  for (const one of inside) if (one) node.append(one)
  return node
}

export function news(ctx: WidgetContext): void {
  const feeds = String(ctx.settings.feeds ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '')
  const limit = Math.max(1, Math.round(Number(ctx.settings.limit) || 1))

  ctx.feed({ source: 'news', feeds, limit }, (feed) => {
    const value = feed.value
    const now = ctx.now()
    clear(ctx.body)

    const root = h('div', { class: 'wg-news', 'data-size': ctx.size })
    const items = value.items.slice(0, limit)
    const [lead, ...rest] = items

    if (lead) {
      const when = typeof lead.at === 'number' ? ago(lead.at, now) : ''
      root.appendChild(headline(ctx, lead.url, 'wg-news-lead', [
        h('span', { class: 'wg-news-from' },
          mark(lead.url),
          h('span', { class: 'wg-news-source', text: lead.source || hostOf(lead.url) }),
          when ? h('span', { class: 'wg-news-when', text: when }) : null),
        h('span', { class: 'wg-news-title', text: lead.title })
      ]))
    }

    const more = rest.slice(0, AFTER[ctx.size] ?? 2)
    if (more.length > 0) {
      const list = h('ul', { class: 'wg-list wg-news-rest' })
      for (const one of more) {
        const when = typeof one.at === 'number' ? briefly(one.at, now) : ''
        list.appendChild(h('li', null, headline(ctx, one.url, 'wg-news-row wg-row', [
          mark(one.url),
          h('span', { class: 'wg-row-main', text: one.title }),
          when ? h('span', { class: 'wg-row-side', text: when }) : null
        ])))
      }
      root.appendChild(list)
    }

    if (value.failed.length > 0) {
      const names = value.failed.map((one) => hostOf(one))
      const words = names.length <= 2 ? `${names.join(' and ')} did not answer` : `${names.length} feeds did not answer`
      root.appendChild(h('p', { class: 'wg-note wg-news-failed', title: names.join(', '), text: words }))
    }

    ctx.body.appendChild(root)
  }, {
    empty: (value) => value.items.length === 0 && value.failed.length === 0,
    emptyText: 'Nothing new from your feeds yet',
    everyMs: ctx.definition.refreshMs
  })
}
