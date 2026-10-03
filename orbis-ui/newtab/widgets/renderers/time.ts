import type { RendererTable } from '../api.ts'
import { clock, worldclock } from './time/clock.ts'
import { countdown } from './time/countdown.ts'
import { timer } from './time/timer.ts'
import { calculator } from './time/calculator.ts'
import { greetingWidget, notepad, quote } from './time/notes.ts'

/**
 * The widgets about time, and the two that keep what you type on the card itself.
 *
 * What they have in common is that none of them reads anything: there is no source behind a clock, a countdown or a
 * note. Everything they show they work out from the moment, from their own settings, or from a collection Orbis
 * already holds -- so they are the widgets that keep working with no connection at all, and the ones with nothing
 * to be honest about except their own arithmetic.
 */
export const TIME_RENDERERS: RendererTable = Object.freeze({
  clock,
  worldclock,
  countdown,
  timer,
  calculator,
  greeting: greetingWidget,
  quote,
  notepad
})
