import type { WidgetRenderer } from '../../api.ts'
import { h } from '../../dom.ts'
import { countdownFigure, progress, readDay, span } from './sums.ts'
import { ring, said, text } from './parts.ts'

/**
 * How long until something.
 *
 * The ring is the part that has to be honest. A countdown's arc has to be measured from somewhere, and the only
 * start the person actually chose is the day they put the widget on the page -- so that is what it measures, and a
 * countdown that has no usable start (one added after its own date, say) draws the quiet track and no arc at all
 * rather than an arc that means nothing.
 */

const DATE_IN_FULL = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export const countdown: WidgetRenderer = (ctx) => {
  const title = text(ctx.settings, 'title').trim()
  const when = readDay(text(ctx.settings, 'date'))
  if (when === null) {
    ctx.show.needs('Choose a date to count down to', 'Choose a date')
    return
  }

  const root = h('div', { class: 'wg-countdown', 'data-size': ctx.size })
  const big = h('span', { class: 'wg-countdown-big' })
  const unit = h('span', { class: 'wg-countdown-unit', 'aria-hidden': 'true' })
  const face = h('div', { class: 'wg-countdown-face' }, big, unit)
  const dial = h('div', { class: 'wg-countdown-dial' }, face)
  root.appendChild(dial)

  const sub = h('p', { class: 'wg-countdown-sub' })
  const words = h('div', { class: 'wg-countdown-words' }, title === '' ? null : h('p', { class: 'wg-countdown-title', text: title }), sub)
  if (ctx.size !== 'small') words.appendChild(h('p', { class: 'wg-countdown-when', text: DATE_IN_FULL.format(when) }))
  root.appendChild(words)

  const spoken = said('')
  root.appendChild(spoken)
  ctx.body.appendChild(root)

  let drawn = ''
  const tick = (): void => {
    const now = ctx.now()
    const gap = span(when, now)
    const figure = countdownFigure(gap)
    const run = progress(ctx.instance.addedAt, when, now)
    const key = `${figure.big}|${figure.unit}|${figure.sub}|${run === null ? 'none' : run.toFixed(3)}`
    if (key === drawn) return
    drawn = key

    big.textContent = figure.big
    unit.textContent = figure.unit
    sub.textContent = figure.sub
    root.dataset.past = gap.past ? 'yes' : 'no'
    // The arc is rebuilt rather than nudged: it is two circles, and making two circles once a minute costs nothing.
    const arc = ring({ fraction: gap.past ? 1 : run, width: 7, arcClass: 'wg-countdown-arc' })
    const old = dial.querySelector('.wg-time-ring')
    if (old) old.replaceWith(arc)
    else dial.insertBefore(arc, face)
    spoken.textContent = `${figure.big} ${figure.unit}${figure.sub ? ` ${figure.sub}` : ''}${title ? ` until ${title}` : ''}, ${DATE_IN_FULL.format(when)}`
  }

  tick()
  // A minute is the smallest thing it ever shows, so half of one is as often as it can possibly need to change.
  ctx.every(30_000, tick)
}
