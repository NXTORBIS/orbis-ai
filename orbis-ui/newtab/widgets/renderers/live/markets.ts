import type { WidgetContext, WidgetSize } from '../../api.ts'
import { clockTime, clear, h, svg } from '../../dom.ts'
import { areaPath, curvePoints, highLow, smoothPath } from './curve.ts'
import { changeWords, formatPrice, tickerText } from './money.ts'
import { ARROWS, said } from './parts.ts'

/**
 * One price the person follows, and how its day has gone.
 *
 * The price is the picture: a big numeral in the display face, a pill saying which way the day went, and the day
 * itself drawn as a band of colour along the floor of the card. The band is the part most easily faked, so it is the
 * part held most strictly -- it is drawn from the prices the feed sent and from nothing else. A day with no prices
 * behind it has no band at all, not a straight one and not a pretty one.
 *
 * Pressing the card opens Orbis Markets, where the same price has a chart, a book and a tape behind it.
 */

/**
 * The band at the foot of the card, at each size.
 *
 * Measured in the card's own pixels -- the full width of the card, because the band reaches both edges, and the
 * height the stylesheet gives it. The two agree so the drawing is never stretched one way: a mark on the last price
 * stays round.
 */
const BANDS: Readonly<Record<WidgetSize, { width: number; height: number; marks: boolean }>> = Object.freeze({
  small: { width: 156, height: 40, marks: false },
  medium: { width: 326, height: 42, marks: true },
  tall: { width: 156, height: 72, marks: true },
  large: { width: 326, height: 92, marks: true },
  wide: { width: 326, height: 42, marks: true }
})

/**
 * The day, drawn.
 *
 * Nothing comes back when there is nothing to draw from, so the card simply has no band rather than a flat line
 * along its floor. A flat line is a claim that the price did not move, which is a different thing from not knowing
 * whether it did.
 */
function band(points: readonly number[], size: WidgetSize, direction: 'up' | 'down' | 'flat'): SVGElement | null {
  const shape = BANDS[size] ?? BANDS.small
  const box = { width: shape.width, height: shape.height, pad: 7, padX: 0 }
  const plotted = curvePoints(points, box)
  if (plotted.length === 0) return null

  const node = svg('svg', { class: `wg-markets-band wg-${direction}`, viewBox: `0 0 ${shape.width} ${shape.height}`, 'aria-hidden': 'true', focusable: 'false' })
  const line = smoothPath(plotted, box)
  node.appendChild(svg('path', { class: 'wg-markets-wash', d: areaPath(line, plotted, shape.height) }))
  node.appendChild(svg('path', { class: 'wg-markets-line', d: line }))

  const last = plotted[plotted.length - 1]
  node.appendChild(svg('circle', { class: 'wg-markets-head', cx: last.x, cy: last.y, r: 3 }))
  const ends = shape.marks ? highLow(plotted) : null
  if (ends && ends.high.value !== ends.low.value) {
    node.appendChild(svg('circle', { class: 'wg-markets-peak', cx: ends.high.x, cy: ends.high.y, r: 2 }))
    node.appendChild(svg('circle', { class: 'wg-markets-peak', cx: ends.low.x, cy: ends.low.y, r: 2 }))
  }
  return node
}

/** The day's change as a pill: an arrow, a sign and a colour, with the same thing in words behind all three. */
function changePill(change: number): HTMLElement | null {
  const words = changeWords(change)
  if (!words) return null
  const arrow = svg('svg', { class: 'wg-markets-arrow', viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { class: 'line', d: ARROWS[words.direction] }))
  return h('span', { class: `wg-markets-change wg-${words.direction}` }, said(words.said), arrow, h('span', { 'aria-hidden': 'true', text: words.text }))
}

export function markets(ctx: WidgetContext): void {
  const symbol = String(ctx.settings.symbol ?? '').trim()

  ctx.feed({ source: 'markets', symbol }, (feed) => {
    const value = feed.value
    const words = changeWords(value.change)
    const price = formatPrice(value.price, value.currency)
    const ticker = tickerText(value.symbol)
    clear(ctx.body)

    const root = h('div', { class: 'wg-markets', 'data-size': ctx.size })

    root.appendChild(h('div', { class: 'wg-markets-top' },
      h('span', { class: 'wg-markets-ticker', text: ticker }),
      changePill(value.change)))

    const face = h('div', { class: 'wg-markets-face' })
    if (price) face.appendChild(h('p', { class: 'wg-big wg-markets-price', text: price }))
    if (value.name) face.appendChild(h('p', { class: 'wg-sub wg-markets-name', text: value.name }))
    root.appendChild(face)

    if (Number.isFinite(value.asOf) && value.asOf > 0) {
      root.appendChild(h('p', { class: 'wg-markets-asof' },
        said('Price read at '),
        h('span', { text: clockTime(value.asOf, ctx.hour12) })))
    }

    const drawn = band(value.points ?? [], ctx.size, words?.direction ?? 'flat')
    root.setAttribute('data-line', drawn ? 'on' : 'off')
    if (drawn) root.appendChild(h('span', { class: 'wg-markets-chart' }, drawn))

    // One button over the whole card rather than a small one in a corner: the card is the thing being pressed. It is
    // laid over the content instead of wrapped round it, so its spoken name is a sentence rather than every word on
    // the card read back in order.
    const spoken = [value.name || ticker, price, words?.said].filter((one) => one).join('. ')
    const open = h('button', {
      class: 'wg-markets-open',
      type: 'button',
      'aria-label': `Open Markets. ${spoken}`,
      onclick: () => void ctx.run({ do: 'panel.open', view: 'markets' })
    })
    if (ctx.preview) {
      open.setAttribute('disabled', '')
      open.setAttribute('tabindex', '-1')
    }
    root.appendChild(open)

    ctx.body.appendChild(root)
  }, { everyMs: ctx.definition.refreshMs })
}
