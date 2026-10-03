import type { WidgetContext, WidgetRenderer } from '../../api.ts'
import { clockTime, dayName, h, svg } from '../../dom.ts'
import { parseWorldClocks, zoneOffsetMinutes } from '../../../../../src/shared/widgetData.ts'
import { clockParts, dayFraction, handAngles, offsetShort, offsetWords, timeText, weekStrip } from './sums.ts'
import { flag, onCircle, said, text } from './parts.ts'

/**
 * The two clocks: the one that says what time it is here, and the one that says what time it is where somebody else
 * is.
 *
 * Both are drawn once and afterwards only changed, never rebuilt. A dial thrown away and made again every second
 * cannot have a second hand that sweeps, because the sweep would start over each time; and a card that replaces all
 * its own nodes once a second is a card the browser repaints all day for nothing. So the hands are nodes a tick
 * turns, the numerals are nodes a tick writes into, and the only thing a tick ever builds is the part that has
 * changed day.
 */

// ---------------------------------------------------------------- the clock here

export const clock: WidgetRenderer = (ctx) => {
  const face = text(ctx.settings, 'face', 'digital') === 'analog' ? 'analog' : 'digital'
  const look: ClockLook = {
    seconds: flag(ctx.settings, 'seconds'),
    withDate: flag(ctx.settings, 'date', true),
    // The widget's own switch only ever turns the twelve-hour clock on. The start page's setting is what the person
    // chose for the whole page, and one widget quietly overruling it is how two clocks come to disagree.
    hour12: flag(ctx.settings, 'hour12') || ctx.hour12
  }

  const root = h('div', { class: 'wg-clock', 'data-size': ctx.size, 'data-face': face })
  ctx.body.appendChild(root)
  const tick = face === 'analog' ? analogue(ctx, root, look) : digital(ctx, root, look)
  tick()
  // Every second whichever face it wears: a second hand needs it, and a face without one still has to catch the
  // minute as it turns rather than up to a minute afterwards.
  ctx.every(1000, tick)
}

interface ClockLook {
  seconds: boolean
  withDate: boolean
  hour12: boolean
}

/**
 * Numerals in the display face, with the date under them.
 *
 * More room is not the same numerals larger: medium gains the thin line showing how far through the day it is, and
 * large gains the week the day sits in. A widget that only ever scales is a widget with one idea.
 */
function digital(ctx: WidgetContext, root: HTMLElement, look: ClockLook): () => void {
  const hm = h('span', { class: 'wg-clock-hm' })
  const secs = look.seconds ? h('span', { class: 'wg-clock-sec' }) : null
  const suffix = h('span', { class: 'wg-clock-ampm' })
  const date = look.withDate ? h('p', { class: 'wg-clock-date' }) : null
  const stack = h('div', { class: 'wg-clock-stack' }, h('p', { class: 'wg-clock-face' }, hm, secs, suffix), date)
  root.appendChild(stack)

  const run = ctx.size === 'small' ? null : h('span', { class: 'wg-clock-day-run' })
  if (run) root.appendChild(h('div', { class: 'wg-clock-day', 'aria-hidden': 'true' }, run))
  const week = ctx.size === 'large' ? h('div', { class: 'wg-clock-week' }) : null
  if (week) root.appendChild(week)

  let day = ''
  return () => {
    const now = ctx.now()
    const parts = clockParts(now)
    if (!parts) return
    const shown = timeText(now, look.hour12, look.seconds)
    if (hm.textContent !== shown.hm) hm.textContent = shown.hm
    if (secs && secs.textContent !== shown.seconds) secs.textContent = shown.seconds
    if (suffix.textContent !== shown.suffix) suffix.textContent = shown.suffix
    if (run) run.style.setProperty('width', `${(dayFraction(parts) * 100).toFixed(2)}%`)
    const key = `${parts.year}-${parts.month}-${parts.day}`
    if (key !== day) {
      day = key
      if (date) date.textContent = dayName(now)
      if (week) drawWeek(week, now)
    }
  }
}

/** A drawn dial: sixty markings, three hands, and a date window where a made watch keeps one. */
function analogue(ctx: WidgetContext, root: HTMLElement, look: ClockLook): () => void {
  const dial = svg('svg', { class: 'wg-clock-dial', viewBox: '0 0 100 100', role: 'img', 'aria-label': 'Clock', 'data-sweep': ctx.still ? 'off' : 'on' })
  dial.appendChild(svg('circle', { class: 'wg-clock-well', cx: 50, cy: 50, r: 47 }))
  dial.appendChild(svg('circle', { class: 'wg-clock-rim', cx: 50, cy: 50, r: 47, fill: 'none' }))

  const marks = svg('g', { class: 'wg-clock-marks' })
  for (let at = 0; at < 60; at++) {
    const hourMark = at % 5 === 0
    const outer = onCircle(at * 6, 43)
    const inner = onCircle(at * 6, hourMark ? 36.5 : 40.2)
    marks.appendChild(
      svg('line', { class: hourMark ? 'wg-clock-mark wg-clock-mark-hour' : 'wg-clock-mark', x1: inner.x.toFixed(2), y1: inner.y.toFixed(2), x2: outer.x.toFixed(2), y2: outer.y.toFixed(2) })
    )
  }
  dial.appendChild(marks)

  let dateWindow: SVGElement | null = null
  if (look.withDate) {
    dial.appendChild(svg('rect', { class: 'wg-clock-window', x: 58.5, y: 44.4, width: 25.5, height: 11.2, rx: 3 }))
    dateWindow = svg('text', { class: 'wg-clock-window-text', x: 71.25, y: 52.5, 'text-anchor': 'middle' })
    dial.appendChild(dateWindow)
  }

  const hour = svg('g', { class: 'wg-clock-hand wg-clock-hour' }, svg('line', { x1: 50, y1: 57, x2: 50, y2: 27 }))
  const minute = svg('g', { class: 'wg-clock-hand wg-clock-minute' }, svg('line', { x1: 50, y1: 60, x2: 50, y2: 14 }))
  const sweeper = svg(
    'g',
    { class: 'wg-clock-sweeper' },
    svg('line', { class: 'wg-clock-second', x1: 50, y1: 62, x2: 50, y2: 11 }),
    svg('circle', { class: 'wg-clock-counter', cx: 50, cy: 65, r: 2.4 })
  )
  dial.append(hour, minute, sweeper)
  dial.appendChild(svg('circle', { class: 'wg-clock-pin', cx: 50, cy: 50, r: 2.8 }))
  dial.appendChild(svg('circle', { class: 'wg-clock-pin-eye', cx: 50, cy: 50, r: 1 }))
  root.appendChild(h('div', { class: 'wg-clock-dialwrap' }, dial))

  // Medium puts the dial beside the numerals, because at 326 by 156 a dial alone leaves half the card empty.
  const besideTime = ctx.size === 'medium' ? h('span', { class: 'wg-clock-hm' }) : null
  const besideDate = ctx.size === 'medium' && look.withDate ? h('p', { class: 'wg-clock-date' }) : null
  if (besideTime) root.appendChild(h('div', { class: 'wg-clock-beside' }, besideTime, besideDate))
  const underDate = ctx.size === 'large' && look.withDate ? h('p', { class: 'wg-clock-date' }) : null
  if (underDate) root.appendChild(underDate)
  const week = ctx.size === 'large' ? h('div', { class: 'wg-clock-week' }) : null
  if (week) root.appendChild(week)

  const turn = (node: SVGElement, degrees: number): void => node.style.setProperty('--wg-turn', `${degrees.toFixed(3)}deg`)
  const short = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  let lastMinute = -1
  let day = ''
  return () => {
    const now = ctx.now()
    const parts = clockParts(now)
    if (!parts) return
    const angles = handAngles(parts)
    turn(hour, angles.hour)
    turn(minute, angles.minute)
    // Set every second as well as swept, so the hand is still right for anybody whose browser is not animating it.
    turn(sweeper, angles.second)
    if (parts.minute !== lastMinute) {
      lastMinute = parts.minute
      // The sweep is a sixty-second turn given a head start, so it begins already where the seconds are. It is set
      // again each minute because an animation's clock and the computer's drift apart over an afternoon.
      sweeper.style.setProperty('animation-delay', `-${(parts.second + (now % 1000) / 1000).toFixed(3)}s`)
      dial.setAttribute('aria-label', `${clockTime(now, look.hour12)}${look.withDate ? `, ${dayName(now)}` : ''}`)
      if (besideTime) {
        const shown = timeText(now, look.hour12)
        besideTime.textContent = shown.suffix ? `${shown.hm} ${shown.suffix}` : shown.hm
      }
    }
    const key = `${parts.year}-${parts.month}-${parts.day}`
    if (key !== day) {
      day = key
      if (dateWindow) dateWindow.textContent = `${short.format(now).toUpperCase().slice(0, 3)} ${parts.day}`
      if (besideDate) besideDate.textContent = dayName(now)
      if (underDate) underDate.textContent = dayName(now)
      if (week) drawWeek(week, now)
    }
  }
}

/** The week this day sits in: seven letters, one of them standing out, and the whole name said for anyone listening. */
function drawWeek(host: HTMLElement, now: number): void {
  host.replaceChildren(
    ...weekStrip(now).map((day) =>
      h(
        'div',
        { class: 'wg-clock-weekday', 'data-today': day.today ? 'yes' : 'no' },
        h('span', { class: 'wg-clock-weekletter', text: day.letter, 'aria-hidden': 'true' }),
        h('span', { class: 'wg-clock-weeknum', text: String(day.day), 'aria-hidden': 'true' }),
        said(day.today ? `${day.label}, today` : day.label)
      )
    )
  )
}

// ---------------------------------------------------------------- the clock somewhere else

export const worldclock: WidgetRenderer = (ctx) => {
  const asked = parseWorldClocks(text(ctx.settings, 'zones', ''), 8)
  const hour12 = flag(ctx.settings, 'hour12') || ctx.hour12
  if (asked.clocks.length === 0) {
    const named = asked.unknown.slice(0, 2).join(', ')
    // A place that cannot be read is named back. Guessing at "Asia/Atalanta" would show somebody the wrong time all
    // day without ever giving them the one clue they need to fix it.
    ctx.show.needs(named === '' ? 'Add a place to see the time there' : `This computer does not know a place called ${named}`, 'Choose places')
    return
  }

  const most = ctx.size === 'small' ? 1 : ctx.size === 'medium' ? 3 : 5
  const stacked = ctx.size === 'tall'
  const root = h('div', { class: 'wg-world', 'data-size': ctx.size })
  ctx.body.appendChild(root)
  const places = asked.clocks.slice(0, most).map((one) => drawPlace(root, one, { hour12, stacked }))

  const over = asked.clocks.length - places.length
  const left: string[] = []
  if (over > 0) left.push(over === 1 ? '1 more place is set' : `${over} more places are set`)
  if (asked.unknown.length > 0) left.push(`not a known place: ${asked.unknown.slice(0, 2).join(', ')}`)
  if (left.length > 0) ctx.show.note(left.join(' · '))

  const tick = (): void => {
    const now = ctx.now()
    for (const place of places) place(now)
  }
  tick()
  // A minute is the smallest thing shown, so a quarter of one keeps the marker and the numerals honest without
  // waking the page sixty times a minute to change nothing.
  ctx.every(15_000, tick)
}

interface WorldLook {
  hour12: boolean
  /** A tall card is a list: the dial shrinks to a glyph and the time moves out beside it. */
  stacked: boolean
}

/** One place: a dial split into its night half and its day half, the time, and how far it is from here. */
function drawPlace(root: HTMLElement, place: { label: string; zone: string }, look: WorldLook): (now: number) => void {
  const dial = svg('svg', { class: 'wg-world-dial', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' })
  const half = (cls: string, from: number): SVGElement =>
    svg('circle', { class: cls, cx: 50, cy: 50, r: 41, fill: 'none', 'stroke-width': 10, pathLength: 100, 'stroke-dasharray': '50 50', 'stroke-dashoffset': -from, transform: 'rotate(-90 50 50)' })
  // Midnight at the top and noon at the bottom, so the lit half of the ring is always the lower half and the marker
  // riding round it says the hour without anybody having to read a number.
  dial.append(half('wg-world-night', 75), half('wg-world-day', 25))
  const marker = svg('circle', { class: 'wg-world-marker', cx: 50, cy: 9, r: 5 })
  dial.appendChild(marker)
  const inside = look.stacked ? null : svg('text', { class: 'wg-world-inside', x: 50, y: 56, 'text-anchor': 'middle' })
  if (inside) dial.appendChild(inside)

  const label = h('span', { class: 'wg-world-label' })
  const gap = h('span', { class: 'wg-world-gap' })
  const aside = look.stacked ? h('span', { class: 'wg-world-time' }) : null
  const spoken = said('')
  const row = h('div', { class: 'wg-world-place' }, dial, h('div', { class: 'wg-world-words' }, label, gap), aside, spoken)
  root.appendChild(row)

  return (now: number) => {
    label.textContent = place.label
    const parts = clockParts(now, place.zone)
    if (!parts) {
      gap.textContent = 'Not a place this computer knows'
      spoken.textContent = `${place.label}: not a place this computer knows`
      return
    }
    const at = onCircle(dayFraction(parts) * 360, 41)
    marker.setAttribute('cx', at.x.toFixed(2))
    marker.setAttribute('cy', at.y.toFixed(2))
    const shown = timeText(now, look.hour12, false, place.zone)
    const full = shown.suffix ? `${shown.hm} ${shown.suffix}` : shown.hm
    if (inside) inside.textContent = shown.hm
    if (aside) aside.textContent = full
    const minutes = zoneOffsetMinutes(place.zone, new Date(now)) + new Date(now).getTimezoneOffset()
    // Where the words fit they are the words; where they do not, the short form carries the same fact and the whole
    // sentence is still read out to anybody who cannot see either.
    gap.textContent = look.stacked ? offsetWords(minutes) : offsetShort(minutes)
    spoken.textContent = `${place.label}, ${full}, ${offsetWords(minutes)}`
  }
}
