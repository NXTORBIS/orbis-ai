import type { WidgetContext, WidgetSize } from '../../api.ts'
import type { WeatherSymbol } from '../../../../../src/shared/widgetFeed.ts'
import { clear, h, svg } from '../../dom.ts'
import { areaPath, curvePoints, smoothPath } from './curve.ts'
import { lookOf } from './sky.ts'
import { said } from './parts.ts'
import { weatherArt, weatherMini } from './weatherArt.ts'

/**
 * The weather, as a picture of the sky over a number.
 *
 * The card is washed in a sky that changes with the forecast and carries a drawn illustration of it, because the one
 * thing a person wants from this widget at a glance is already a picture in their head. The temperature, the place
 * and the forecast's own wording sit on top of it; the coming hours are a drawn line with a mark on each hour, and
 * they appear only where there is room to read them.
 *
 * Nothing here decides what the weather is. Everything shown comes from the feed -- including the credit line, which
 * the forecast's licence asks to be shown and which is therefore drawn at every size, small included.
 *
 * With no city chosen the feed answers saying one is needed, and the card asks for it. This file is never reached.
 */

/** What fits at each size: how many hours, how tall their strip is, and whether each hour gets its own small glyph. */
interface Strip {
  width: number
  height: number
  count: number
  mini: boolean
  /** Where the baselines and the band of the line sit inside the strip. */
  tempY: number
  bandTop: number
  bandHeight: number
  hourY: number
}

/**
 * The widths are the card's own, less the padding the card keeps: 326 and 156 wide cards with 14px either side.
 * The strip is drawn at that size and scales to fit, so the hours sit on whole pixels at the size it is really used.
 */
const STRIPS: Readonly<Record<WidgetSize, Strip | null>> = Object.freeze({
  small: null,
  medium: { width: 298, height: 46, count: 5, mini: false, tempY: 9, bandTop: 14, bandHeight: 18, hourY: 43 },
  large: { width: 298, height: 86, count: 7, mini: true, tempY: 32, bandTop: 38, bandHeight: 30, hourY: 82 },
  tall: { width: 128, height: 84, count: 4, mini: true, tempY: 30, bandTop: 36, bandHeight: 28, hourY: 80 },
  wide: { width: 298, height: 46, count: 6, mini: false, tempY: 9, bandTop: 14, bandHeight: 18, hourY: 43 }
})

/** "11", "11 AM" -- short enough for a column, and in the clock the person set. */
function hourText(at: number, hour12: boolean): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', hour12 }).format(at)
  } catch {
    return ''
  }
}

const degrees = (value: number): string => `${Math.round(value)}°`

/**
 * The coming hours: one drawn line, with each hour's temperature above its own mark and the hour beneath it.
 *
 * Drawn as one picture rather than a line with labels laid over it, so a label can never slide away from the mark it
 * belongs to. It is read aloud as a list of hours and temperatures; the line itself says nothing a sighted reader
 * does not already have from those numbers.
 */
function hoursStrip(hours: { at: number; temperature: number; symbol: WeatherSymbol }[], strip: Strip, hour12: boolean): SVGElement | null {
  const shown = hours.slice(0, strip.count).filter((one) => Number.isFinite(one.temperature))
  if (shown.length < 2) return null
  const points = curvePoints(shown.map((one) => one.temperature), { width: strip.width, height: strip.bandHeight, pad: 4, padX: strip.width / (2 * shown.length) })
  if (points.length === 0) return null

  const spoken = shown.map((one) => `${hourText(one.at, hour12)}, ${Math.round(one.temperature)} degrees`).join('; ')
  const node = svg('svg', {
    class: 'wg-weather-strip',
    viewBox: `0 0 ${strip.width} ${strip.height}`,
    role: 'img',
    'aria-label': `The next ${shown.length} hours: ${spoken}`,
    focusable: 'false'
  })

  const line = smoothPath(points, { width: strip.width, height: strip.bandHeight, pad: 4 })
  const band = svg('g', { transform: `translate(0 ${strip.bandTop})` })
  band.appendChild(svg('path', { class: 'wg-weather-curve-fill', d: areaPath(line, points, strip.bandHeight + 4) }))
  band.appendChild(svg('path', { class: 'wg-weather-curve-line', d: line }))
  for (const point of points) band.appendChild(svg('circle', { class: 'wg-weather-curve-dot', cx: point.x, cy: point.y, r: 2.6 }))
  node.appendChild(band)

  shown.forEach((hour, index) => {
    const x = points[index].x
    if (strip.mini) {
      const glyph = weatherMini(hour.symbol)
      glyph.setAttribute('x', String(x - 8))
      glyph.setAttribute('y', '2')
      glyph.setAttribute('width', '16')
      glyph.setAttribute('height', '16')
      node.appendChild(glyph)
    }
    node.appendChild(svg('text', { class: 'wg-weather-hourtemp', x, y: strip.tempY, 'text-anchor': 'middle' }, degrees(hour.temperature)))
    node.appendChild(svg('text', { class: 'wg-weather-hourtime', x, y: strip.hourY, 'text-anchor': 'middle' }, hourText(hour.at, hour12)))
  })
  return node
}

export function weather(ctx: WidgetContext): void {
  const city = String(ctx.settings.city ?? '')
  const unit = ctx.settings.unit === 'f' ? 'f' : 'c'
  const wanted = ctx.settings.hours !== false
  const strip = STRIPS[ctx.size] ?? null

  ctx.feed({ source: 'weather', city, unit }, (feed) => {
    const value = feed.value
    const look = lookOf(value.symbol)
    clear(ctx.body)

    const root = h('div', { class: 'wg-weather', 'data-sky': look.sky, 'data-size': ctx.size, ...(ctx.still ? { 'data-still': '' } : {}) })
    root.appendChild(h('span', { class: 'wg-weather-sky', 'aria-hidden': 'true' }))
    root.appendChild(weatherArt(value.symbol))

    const head = h('div', { class: 'wg-weather-head' })
    if (Number.isFinite(value.temperature)) {
      const mark = unit === 'f' ? 'F' : 'C'
      head.appendChild(h('p', { class: 'wg-weather-temp' },
        said(`${Math.round(value.temperature)} degrees ${mark === 'F' ? 'Fahrenheit' : 'Celsius'}`),
        h('span', { class: 'wg-weather-deg', 'aria-hidden': 'true', text: String(Math.round(value.temperature)) }),
        h('span', { class: 'wg-weather-unit', 'aria-hidden': 'true' },
          h('span', { class: 'wg-weather-ring', text: '°' }),
          h('span', { text: mark }))))
    }
    if (value.summary) head.appendChild(h('p', { class: 'wg-weather-sum', text: value.summary }))
    root.appendChild(head)
    root.appendChild(h('span', { class: 'wg-weather-gap', 'aria-hidden': 'true' }))

    const hours = wanted && strip ? hoursStrip(value.hours ?? [], strip, ctx.hour12) : null
    root.setAttribute('data-hours', hours ? 'on' : 'off')
    if (hours) root.appendChild(hours)

    const foot = h('div', { class: 'wg-weather-foot' })
    if (value.place) foot.appendChild(h('p', { class: 'wg-weather-where', text: value.place }))
    // The forecast's licence asks for its name to be shown wherever the forecast is, which includes the smallest card.
    if (value.attribution) foot.appendChild(h('p', { class: 'wg-weather-credit', text: value.attribution }))
    root.appendChild(foot)

    ctx.body.appendChild(root)
  }, { everyMs: ctx.definition.refreshMs })
}
