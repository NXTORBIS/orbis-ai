import type { WidgetRenderer } from '../../api.ts'
import { clockTime, h, svg } from '../../dom.ts'
import { TIMER_LENGTHS, timerStanding, timerText, type TimerSettings, type TimerState } from './sums.ts'
import { number, pressable, ring, text } from './parts.ts'

/**
 * A stretch of focused work, and the rest after it.
 *
 * What it keeps is the moment it ends, not a count of seconds. A timer that counts its own ticks loses them: the tab
 * goes to the back, the laptop is shut, and twenty minutes later the card says nineteen minutes are left. An end
 * time, kept with the widget's own settings, is still the end time after a reload, after a sleep, and in the other
 * window.
 *
 * It makes no sound. A card that could start a noise on a page nobody is looking at is a card nobody would leave
 * open, so when it runs out it says so where it stands -- once, politely, and out loud only to whatever is reading
 * the page aloud.
 */

export const timer: WidgetRenderer = (ctx) => {
  const live: TimerSettings = {
    minutes: number(ctx.settings, 'minutes', 25),
    breakMinutes: number(ctx.settings, 'breakMinutes', 5),
    phase: text(ctx.settings, 'phase', 'focus'),
    endsAt: number(ctx.settings, 'endsAt', 0),
    pausedMs: number(ctx.settings, 'pausedMs', 0),
    finishedAt: number(ctx.settings, 'finishedAt', 0)
  }
  const small = ctx.size === 'small'

  const root = h('div', { class: 'wg-timer', 'data-size': ctx.size })
  const leftText = h('span', { class: 'wg-timer-left' })
  const unit = h('span', { class: 'wg-timer-unit', 'aria-hidden': 'true' })
  const band = ring({ fraction: 1, width: 8, arcClass: 'wg-timer-arc' })
  const dial = h('div', { class: 'wg-timer-dial' }, band, h('div', { class: 'wg-timer-face' }, leftText, unit))
  const side = h('div', { class: 'wg-timer-side' })
  const announce = h('p', { class: small ? 'wg-time-said' : 'wg-timer-say', role: 'status', 'aria-live': 'polite' })
  root.append(dial, side, announce)
  ctx.body.appendChild(root)

  const lengthOf = (phase: string): number => Math.max(60_000, Math.round(phase === 'rest' ? live.breakMinutes : live.minutes) * 60_000)

  /** Keeps a change on the widget itself, and redraws from it at once instead of waiting for the save to come back. */
  const keep = (change: Partial<TimerSettings>): void => {
    Object.assign(live, change)
    const out: Record<string, string | number | boolean> = {}
    if (change.minutes !== undefined) out.minutes = change.minutes
    if (change.phase !== undefined) out.phase = change.phase
    if (change.endsAt !== undefined) out.endsAt = change.endsAt
    if (change.pausedMs !== undefined) out.pausedMs = change.pausedMs
    if (change.finishedAt !== undefined) out.finishedAt = change.finishedAt
    ctx.save(out)
    paint()
  }

  const begin = (phase: 'focus' | 'rest', carryOn = false): void => {
    const run = carryOn && live.pausedMs > 0 ? live.pausedMs : lengthOf(phase)
    keep({ phase, endsAt: ctx.now() + run, pausedMs: 0, finishedAt: 0 })
  }
  const pause = (): void => keep({ pausedMs: Math.max(1000, live.endsAt - ctx.now()), endsAt: 0 })
  const reset = (): void => keep({ phase: 'focus', endsAt: 0, pausedMs: 0, finishedAt: 0 })
  const choose = (minutes: number): void => keep({ minutes, phase: 'focus', endsAt: 0, pausedMs: 0, finishedAt: 0 })

  /** The controls, which are not the same two buttons in every state, and the words beside them. */
  function paint(): void {
    const standing = timerStanding(live, ctx.now())
    root.dataset.state = standing.state
    root.dataset.phase = standing.phase

    const keys = h('div', { class: 'wg-timer-keys' })
    const add = (label: string, run: () => void, mark: SVGElement, primary = false): void => {
      keys.appendChild(pressable(ctx.preview, label, run, small ? mark : label, small ? 'wg-icon-btn' : primary ? 'wg-btn primary' : 'wg-btn'))
    }

    if (standing.state === 'running') add('Pause', pause, pauseGlyph(), true)
    else if (standing.state === 'done' && standing.phase === 'focus') add('Start the rest', () => begin('rest'), playGlyph(), true)
    else if (standing.state === 'paused') add('Carry on', () => begin(standing.phase, true), playGlyph(), true)
    else add(standing.state === 'done' ? 'Start another stretch' : 'Start', () => begin('focus'), playGlyph(), true)
    if (standing.state !== 'idle') add('Reset', reset, resetGlyph())

    side.replaceChildren()
    if (!small) {
      side.appendChild(h('p', { class: 'wg-timer-phase', text: standing.phase === 'rest' ? 'Rest' : 'Focus' }))
      if (standing.state === 'running') side.appendChild(h('p', { class: 'wg-timer-ends', text: `Ends at ${clockTime(live.endsAt, ctx.hour12)}` }))
      else if (standing.state === 'idle') side.appendChild(lengths())
    }
    side.appendChild(keys)
    announce.textContent = standing.state !== 'done' ? '' : standing.phase === 'rest' ? 'The rest is over.' : 'Focus time is up. Take a rest.'
    show(standing.state, standing.leftMs, standing.totalMs, standing.phase)
  }

  /** A few lengths at a press. Anything else is typed into the widget's settings, where there is room to type it. */
  function lengths(): HTMLElement {
    const row = h('div', { class: 'wg-timer-lengths', role: 'group', 'aria-label': 'How long' })
    for (const minutes of TIMER_LENGTHS) {
      const chip = pressable(ctx.preview, `${minutes} minutes of focus`, () => choose(minutes), String(minutes), 'wg-timer-length')
      chip.setAttribute('aria-pressed', Math.round(live.minutes) === minutes ? 'true' : 'false')
      row.appendChild(chip)
    }
    return row
  }

  /** The numerals and how much of the ring is left to drain. The only part a running second has to change. */
  function show(state: TimerState, leftMs: number, totalMs: number, phase: 'focus' | 'rest'): void {
    leftText.textContent = timerText(state === 'done' ? 0 : leftMs)
    unit.textContent = state === 'done' ? 'Time is up' : state === 'paused' ? 'Paused' : phase === 'rest' ? 'Rest' : 'Focus'
    const run = totalMs > 0 ? Math.min(1, Math.max(0, leftMs / totalMs)) : 0
    band.querySelector('.wg-time-ring-arc')?.setAttribute('stroke-dasharray', `${(run * 100).toFixed(2)} 100`)
  }

  const tick = (): void => {
    const standing = timerStanding(live, ctx.now())
    if (standing.state === 'done' && live.endsAt > 0) {
      // It ran out while nobody was pressing anything. Writing that down is what lets a reload still know it
      // finished, rather than quietly showing a fresh twenty-five minutes as though nothing had happened.
      const ended = live.endsAt
      keep({ endsAt: 0, pausedMs: 0, finishedAt: ended })
      return
    }
    if (standing.state === 'running') show(standing.state, standing.leftMs, standing.totalMs, standing.phase)
  }

  paint()
  ctx.every(1000, tick)
}

const glyph = (...children: SVGElement[]): SVGElement => svg('svg', { class: 'wg-timer-glyph', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' }, ...children)

const playGlyph = (): SVGElement => glyph(svg('path', { d: 'M5.2 3.3 13 8l-7.8 4.7Z' }))

const pauseGlyph = (): SVGElement => glyph(svg('rect', { x: 4.2, y: 3.4, width: 2.8, height: 9.2, rx: 1.2 }), svg('rect', { x: 9, y: 3.4, width: 2.8, height: 9.2, rx: 1.2 }))

const resetGlyph = (): SVGElement =>
  glyph(svg('path', { class: 'wg-timer-stroke', d: 'M12.9 8a4.9 4.9 0 1 1-1.7-3.7', fill: 'none' }), svg('path', { d: 'M12.5 1.8v3.5H9Z' }))
