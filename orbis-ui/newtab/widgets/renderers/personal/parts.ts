import type { WidgetContext } from '../../api.ts'
import { favicon, h, hostOf, svg } from '../../dom.ts'
import { arcDash, monogram, shareOf, snippet } from './sums.ts'

/**
 * The pieces the personal widgets are built from.
 *
 * Each one is here because more than one of them draws it, and because the honest version is the easy one to get
 * wrong: a button that must do nothing in a preview, a site picture that falls back to a letter rather than a hole,
 * an arc that is a real fraction of a real whole. Nothing here invents anything; every piece is handed what it shows.
 *
 * These are the group's shared classes, so they are named `wg-p-…` rather than after any one widget.
 */

/** What goes inside something drawn here. `false` and `null` are left out, so a part can be there only sometimes. */
type Content = Node | string | false | null

/** How a drawn shape is coloured. Never the only thing that says what it means: there are words beside all of them. */
export type Tone = 'accent' | 'green' | 'amber' | 'red' | 'muted'

// ---------------------------------------------------------------- pressing things

/**
 * A button that does what it says, and in a preview does nothing at all.
 *
 * The gallery draws the real widget from sample data, so without this every button on a preview would copy a clip
 * nobody copied or open a site nobody saved. On a preview these are out of the tab order and do nothing when pressed,
 * which is what a picture of a button should do.
 */
export function press(ctx: WidgetContext, label: string, act: () => void, content: Content[], cls = 'wg-btn'): HTMLButtonElement {
  const node = h('button', {
    class: cls,
    type: 'button',
    'aria-label': label,
    ...(ctx.preview ? { tabindex: '-1', 'aria-disabled': 'true' } : {})
  })
  for (const one of content) if (one !== false && one !== null) node.append(one)
  node.addEventListener('click', () => {
    if (!ctx.preview) act()
  })
  return node
}

/** A button that opens one of Orbis's own screens beside the page: Tasks, Notes, Workspaces. */
export const openPanel = (ctx: WidgetContext, view: string, label: string, cls = 'wg-btn'): HTMLButtonElement =>
  press(ctx, label, () => void ctx.run({ do: 'panel.open', view }), [label], cls)

/** The quiet line a card speaks through. Never seen; always read out. */
export const saidAloud = (): HTMLElement => h('p', { class: 'wg-p-said', role: 'status', 'aria-live': 'polite' })

/** Words for somebody who cannot see the picture beside them, and nothing at all for anybody who can. */
export const spoken = (text: string): HTMLElement => h('span', { class: 'wg-p-said', text })

/**
 * Says something on the card for a moment: "Copied".
 *
 * Spoken as well as shown, because a word that appears and goes again is nothing to somebody who cannot see it. The
 * waiting is undone with the widget, so a card drawn again mid-flash leaves nothing running.
 */
export function flash(ctx: WidgetContext, where: HTMLElement, said: HTMLElement, text: string, ms = 1800): void {
  said.textContent = text
  where.classList.add('wg-p-flash')
  where.setAttribute('data-said', text)
  const end = setTimeout(() => {
    said.textContent = ''
    where.classList.remove('wg-p-flash')
    where.removeAttribute('data-said')
  }, ms)
  ctx.onCleanup(() => clearTimeout(end))
}

// ---------------------------------------------------------------- pictures of sites

/**
 * A site's own small picture, with its first letter underneath it.
 *
 * The letter is drawn first and the picture laid over it, so a site the browser has no icon for shows a letter
 * rather than a hole and nothing ever flashes empty on the way. The picture is asked of the browser, never of the
 * site.
 */
export function siteMark(url: string, name: string, px = 20): HTMLElement {
  const box = h('span', { class: 'wg-p-site', style: { '--wg-site': `${px}px` } }, h('span', { class: 'wg-p-site-letter', text: monogram(name || hostOf(url)) }))
  const picture = h('img', { class: 'wg-p-site-img', src: favicon(url, px * 2), alt: '', width: String(px), height: String(px), loading: 'lazy', decoding: 'async' })
  // The letter steps aside only once a real picture has arrived, so nothing ever flashes empty and nothing is blank.
  picture.addEventListener('load', () => box.setAttribute('data-icon', 'yes'))
  picture.addEventListener('error', () => picture.remove())
  box.append(picture)
  return box
}

/**
 * One site as a tile: its picture, its name, and a line under it when there is one.
 *
 * Pressing it opens the address, which is the whole of what a bookmark, or a page you were just on, is for. The name
 * is the site's own; a site with no name is called by its host rather than by anything made up.
 */
export function siteTile(ctx: WidgetContext, url: string, title: string, sub: string): HTMLElement {
  const name = snippet(title, 60) || hostOf(url)
  const lines: Content[] = [siteMark(url, name, 26), h('span', { class: 'wg-p-tile-name', text: name })]
  if (sub !== '') lines.push(h('span', { class: 'wg-p-tile-sub', text: sub }))
  return press(ctx, `${name}, ${hostOf(url)}`, () => ctx.open(url), lines, 'wg-p-tile')
}

// ---------------------------------------------------------------- drawn shapes

/**
 * A ring with part of it painted: how far a download has come, how much of the day has gone.
 *
 * `share` is a real fraction of a real whole, or nothing at all -- a ring with nothing to measure is drawn as a bare
 * track rather than as a full circle, which would read as finished.
 */
export function progressRing(share: number | null, px: number, thickness: number, tone: Tone, inside?: Node): HTMLElement {
  const half = px / 2
  const radius = half - thickness / 2
  const round = 2 * Math.PI * radius
  const drawing = svg(
    'svg',
    { class: 'wg-p-ring-art', viewBox: `0 0 ${px} ${px}`, width: px, height: px, 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { class: 'wg-p-ring-track', cx: half, cy: half, r: radius, 'stroke-width': thickness })
  )
  if (share !== null) {
    drawing.append(
      svg('circle', {
        class: 'wg-p-ring-arc',
        cx: half,
        cy: half,
        r: radius,
        'stroke-width': thickness,
        'stroke-linecap': 'round',
        'stroke-dasharray': arcDash(share, round),
        transform: `rotate(-90 ${half} ${half})`
      })
    )
  }
  const box = h('span', { class: 'wg-p-ring', 'data-wg-tone': tone, style: { '--wg-ring': `${px}px` } }, drawing)
  if (inside) box.append(h('span', { class: 'wg-p-ring-mid' }, inside))
  return box
}

/** A straight bar of the same thing, for a row that is wider than it is tall. */
export function progressBar(share: number | null, tone: Tone): HTMLElement {
  const bar = h('span', { class: 'wg-p-bar', 'data-wg-tone': tone })
  if (share !== null) bar.append(h('span', { class: 'wg-p-bar-fill', style: { width: `${Math.round(shareOf(share, 1) * 1000) / 10}%` } }))
  return bar
}

export type GlyphName = 'text' | 'link' | 'image' | 'other' | 'board' | 'stack' | 'tick' | 'pause' | 'alert' | 'down' | 'plus' | 'clock' | 'star' | 'paper'

/** A small drawn mark that stands for a kind of thing, never for any one thing in particular. */
export function glyph(name: GlyphName, px = 16): SVGElement {
  const parts: Record<GlyphName, () => SVGElement[]> = {
    text: () => [svg('path', { d: 'M4.5 6h11M4.5 10h11M4.5 14h6.5', 'stroke-width': 1.6, 'stroke-linecap': 'round' })],
    link: () => [
      svg('path', { d: 'M8.6 11.4a3.3 3.3 0 0 0 4.7 0l2.1-2.1a3.3 3.3 0 0 0-4.7-4.7l-1 1', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      svg('path', { d: 'M11.4 8.6a3.3 3.3 0 0 0-4.7 0l-2.1 2.1a3.3 3.3 0 0 0 4.7 4.7l1-1', 'stroke-width': 1.6, 'stroke-linecap': 'round' })
    ],
    image: () => [
      svg('rect', { x: 3, y: 4.5, width: 14, height: 11, rx: 2, 'stroke-width': 1.5 }),
      svg('circle', { cx: 7.4, cy: 8.6, r: 1.3, fill: 'currentColor', stroke: 'none' }),
      svg('path', { d: 'M3.8 13.8l3.6-3.4 2.6 2.4 2.4-2.1 3.4 3.1', 'stroke-width': 1.5, 'stroke-linejoin': 'round' })
    ],
    other: () => [svg('circle', { cx: 10, cy: 10, r: 5.6, 'stroke-width': 1.6 }), svg('circle', { cx: 10, cy: 10, r: 1.4, fill: 'currentColor', stroke: 'none' })],
    board: () => [
      svg('rect', { x: 2.5, y: 3.5, width: 15, height: 11, rx: 1.8, 'stroke-width': 1.5 }),
      svg('path', { d: 'M10 14.5v2.2M7 17.2h6', 'stroke-width': 1.5, 'stroke-linecap': 'round' })
    ],
    stack: () => [
      svg('rect', { x: 2.5, y: 6.5, width: 15, height: 10, rx: 2, 'stroke-width': 1.5 }),
      svg('path', { d: 'M5 4.4h10M6.6 2.4h6.8', 'stroke-width': 1.5, 'stroke-linecap': 'round' })
    ],
    tick: () => [svg('path', { d: 'M5 10.4l3.5 3.5L15.2 7', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })],
    pause: () => [svg('path', { d: 'M8 6.4v7.2M12 6.4v7.2', 'stroke-width': 2, 'stroke-linecap': 'round' })],
    alert: () => [svg('path', { d: 'M10 5.4v5.4', 'stroke-width': 2, 'stroke-linecap': 'round' }), svg('circle', { cx: 10, cy: 14.3, r: 1.1, fill: 'currentColor', stroke: 'none' })],
    down: () => [svg('path', { d: 'M10 4.6v8.6M6.3 9.6L10 13.3l3.7-3.7', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })],
    plus: () => [svg('path', { d: 'M10 5.2v9.6M5.2 10h9.6', 'stroke-width': 1.8, 'stroke-linecap': 'round' })],
    clock: () => [svg('circle', { cx: 10, cy: 10, r: 6.4, 'stroke-width': 1.5 }), svg('path', { d: 'M10 6.3V10l2.6 1.6', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })],
    star: () => [svg('path', { d: 'M10 3.4l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L3.2 8.4l4.7-.7z', 'stroke-width': 1.4, 'stroke-linejoin': 'round' })],
    paper: () => [
      svg('path', { d: 'M4.5 3h7.2l4 4v10a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4a1 1 0 0 1 .8-1z', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
      svg('path', { d: 'M11.6 3v4.2h4', 'stroke-width': 1.5, 'stroke-linejoin': 'round' })
    ]
  }
  return svg('svg', { class: 'wg-p-glyph', viewBox: '0 0 20 20', width: px, height: px, stroke: 'currentColor', fill: 'none', 'aria-hidden': 'true', focusable: 'false' }, ...parts[name]())
}

