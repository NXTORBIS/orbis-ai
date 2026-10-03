import type { WidgetRenderer } from '../../api.ts'
import { dayName, h, svg } from '../../dom.ts'
import { greeting, partOfDay } from '../../../../../src/shared/widgetData.ts'
import { roomLeft } from '../../studioLogic.ts'
import { clockParts, dayFraction } from './sums.ts'
import { lineFor } from './quotes.ts'
import { flag, number, pressable, quiet, resume, text, typing } from './parts.ts'

/**
 * The three widgets made of words: the greeting, the line worth reading, and the note you write yourself.
 */

// ---------------------------------------------------------------- the greeting

export const greetingWidget: WidgetRenderer = (ctx) => {
  const withDate = flag(ctx.settings, 'date', true)
  const root = h('div', { class: 'wg-greet', 'data-size': ctx.size })
  const hello = h('p', { class: 'wg-greet-hello' })
  const date = withDate ? h('p', { class: 'wg-greet-date' }) : null
  root.appendChild(h('div', { class: 'wg-greet-words' }, hello, date))

  // The sky is the picture: one disc riding a full day's circle, so where it sits says the hour before the words do.
  const sky = svg('svg', { class: 'wg-greet-sky', viewBox: '0 0 200 100', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid slice' })
  sky.appendChild(svg('rect', { class: 'wg-greet-air', x: 0, y: 0, width: 200, height: 100 }))
  for (const star of STARS) sky.appendChild(svg('circle', { class: 'wg-greet-star', cx: star[0], cy: star[1], r: star[2] }))
  sky.appendChild(svg('path', { class: 'wg-greet-track', d: 'M38 78A62 62 0 0 1 162 78', fill: 'none' }))
  const glow = svg('circle', { class: 'wg-greet-glow', cx: 100, cy: 16, r: 19 })
  const disc = svg('circle', { class: 'wg-greet-disc', cx: 100, cy: 16, r: 10.5 })
  sky.append(glow, disc)
  sky.appendChild(svg('path', { class: 'wg-greet-ground', d: 'M0 78H200', fill: 'none' }))
  root.appendChild(sky)
  ctx.body.appendChild(root)

  const tick = (): void => {
    const now = ctx.now()
    const when = new Date(now)
    const parts = clockParts(now)
    if (!parts) return
    hello.textContent = greeting(when, text(ctx.settings, 'name'))
    if (date) date.textContent = dayName(now)
    root.dataset.part = partOfDay(when)
    // Midnight at the bottom of the circle, dawn on the left, noon at the top: the disc is under the ground line for
    // exactly as much of the day as it is dark, because it is the same circle either way.
    const turn = dayFraction(parts) * Math.PI * 2
    const x = 100 - 62 * Math.sin(turn)
    const y = 78 + 62 * Math.cos(turn)
    for (const node of [glow, disc]) {
      node.setAttribute('cx', x.toFixed(2))
      node.setAttribute('cy', y.toFixed(2))
    }
  }
  tick()
  ctx.every(60_000, tick)
}

/** Fixed specks of light, so the night sky is a sky. They stand for nothing and are not read out. */
const STARS: readonly [number, number, number][] = Object.freeze([
  [24, 20, 1.1],
  [52, 38, 0.8],
  [78, 14, 1.3],
  [118, 28, 0.9],
  [146, 46, 1.1],
  [172, 18, 1.2],
  [96, 52, 0.7],
  [12, 54, 0.9]
])

// ---------------------------------------------------------------- the quote

export const quote: WidgetRenderer = (ctx) => {
  const rotation = text(ctx.settings, 'rotation', 'daily')
  const pick = number(ctx.settings, 'pick', 0)
  const line = lineFor(rotation, ctx.now(), pick, typeof performance === 'object' ? performance.timeOrigin : 0)

  const words = h('p', { class: 'wg-quote-words', text: line.text })
  const who = h('figcaption', { class: 'wg-quote-who', text: line.who })
  const root = h('figure', { class: 'wg-quote', 'data-size': ctx.size }, mark(), h('blockquote', { class: 'wg-quote-line' }, words), who)

  if (rotation === 'manual') {
    root.appendChild(
      pressable(
        ctx.preview,
        'Another line',
        () => {
          const next = Math.trunc(pick) + 1
          ctx.save({ pick: next })
          const shown = lineFor(rotation, ctx.now(), next, 0)
          words.textContent = shown.text
          who.textContent = shown.who
        },
        'Another',
        'wg-quote-more'
      )
    )
  }
  ctx.body.appendChild(root)
}

/** The opening quotation mark, drawn rather than typed, so it can be the size a piece of set type would be. */
const mark = (): SVGElement =>
  svg(
    'svg',
    { class: 'wg-quote-mark', viewBox: '0 0 40 30', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: 'M0 30V17.5C0 7.8 5.4 1.4 15.4 0l1.8 5.2C11.3 6.6 8 10 7.8 14.6h6.6V30Z' }),
    svg('path', { d: 'M22.8 30V17.5C22.8 7.8 28.2 1.4 38.2 0L40 5.2c-5.9 1.4-9.2 4.8-9.4 9.4h6.6V30Z' })
  )

// ---------------------------------------------------------------- the sticky note

/** The longest a note may be, which is what the catalogue says it may be. */
const NOTE_MOST = 4000

export const notepad: WidgetRenderer = (ctx) => {
  const kept = typing(ctx.body, text(ctx.settings, 'text'))
  const root = h('div', { class: 'wg-notepad', 'data-size': ctx.size, 'data-paper': text(ctx.settings, 'colour', 'amber') })

  const paper = quiet(
    ctx.preview,
    h('textarea', {
      class: 'wg-notepad-text',
      'aria-label': 'Your note',
      placeholder: 'Write something',
      maxlength: String(NOTE_MOST),
      spellcheck: 'true',
      rows: '2'
    })
  )
  paper.value = kept.text
  const left = h('p', { class: 'wg-notepad-left', 'aria-hidden': 'true' })
  root.append(paper, left)
  ctx.body.appendChild(root)

  const count = (): void => {
    left.textContent = roomLeft(paper.value.length, NOTE_MOST)
  }

  if (!ctx.preview) {
    paper.addEventListener('input', () => {
      kept.text = paper.value
      kept.caret = paper.selectionStart ?? paper.value.length
      ctx.save({ text: paper.value })
      count()
    })
    paper.addEventListener('keyup', () => {
      kept.caret = paper.selectionStart ?? paper.value.length
    })
    paper.addEventListener('click', () => {
      kept.caret = paper.selectionStart ?? paper.value.length
    })
    // The card waits a moment before saving and starts that wait again whenever it is redrawn, so what is on the
    // paper is offered again here rather than being left behind in a gap nobody can see.
    if (kept.text !== kept.base) ctx.save({ text: kept.text })
  }
  resume(paper, kept)
  count()
}
