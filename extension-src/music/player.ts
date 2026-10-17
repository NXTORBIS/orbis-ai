/**
 * What is playing, as one value the whole page reads.
 *
 * **This polls, and it polls because there is nothing to subscribe to.** The music service does push -- it sends
 * `music:changed` the moment anything changes -- but that push goes over the Orbis app's own wiring to the Orbis
 * window's screen, and nothing forwards it to the browser side. No helper channel holds a response open or streams
 * events for the player. So this asks, every second, exactly as the browser panel does. If a channel is ever added
 * that streams the change, the only file that needs touching is this one: everything else reads `current()` and
 * listens to `watch()`.
 *
 * Once a second is far too coarse for a seek bar, so the bar is not drawn from the answer. The answer says where the
 * music was when it was asked; between answers the position is carried on with the clock and corrected the moment a
 * new one lands (`progressAt`, in src/shared/music/fulltab.ts, which is tested). That is the difference between a bar
 * that moves and a bar that jumps a second at a time.
 *
 * Nothing here asks while the tab is hidden. A music page left open in a background tab should cost nothing.
 */

import { playbackMark, progressAt, sameMark, type PlaybackMark } from '../../src/shared/music/fulltab.ts'
import { now as askNow, type Answer, type MusicNow } from './client.ts'

/** How often to ask while somebody is looking at the page. */
const EVERY = 1000
/** How long to wait after a press before asking again, rather than guessing what the press did. */
const AFTER_A_PRESS = 200

export interface PlayerState {
  /** The last answer, or null when none has arrived yet. Kept through a failure: a fault is not an empty player. */
  readonly music: MusicNow | null
  /** When that answer arrived, by this computer's clock. The seek bar is carried on from here. */
  readonly answeredAt: number
  /** Why there is no fresh answer, in the helper's own words. Null when the last ask worked. */
  readonly problem: string | null
  /** True when the Orbis window is shut, which is a different thing from something going wrong. */
  readonly shut: boolean
  /** True until the first answer, so a screen can say it is reading rather than saying there is no music. */
  readonly starting: boolean
}

type Listener = (state: PlayerState) => void

let state: PlayerState = { music: null, answeredAt: 0, problem: null, shut: false, starting: true }
let mark: PlaybackMark | null = null
let listeners: Listener[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let asking = false
/** Set while somebody is dragging the seek bar or the volume, so an answer does not yank the handle back. */
let held: { seek?: number; volume?: number } = {}

export const current = (): PlayerState => state

/**
 * Where the music has got to, right now.
 *
 * Read this for the bar rather than `music.playback.position`: the answer is up to a second old and this is not.
 * While somebody is dragging the handle it answers where they are dragging to, because the music has not moved there
 * yet and the handle must not fight the hand.
 */
export function positionNow(): number {
  if (held.seek !== undefined) return held.seek
  const playback = state.music?.playback
  if (!playback) return 0
  // A failed read means the position is no longer being followed. It stays where the last good answer left it, so
  // the seek bar stops instead of running on as if the music were still going.
  if (state.problem !== null || state.shut) return playback.position
  return progressAt(playback, state.answeredAt, Date.now())
}

/** The volume to draw. The hand's value while dragging, the player's otherwise. */
export const volumeNow = (): number => held.volume ?? state.music?.playback.volume ?? 1

/** Says a handle is being dragged, so answers stop moving it. Pass null for that handle when the hand lets go. */
export function holding(what: 'seek' | 'volume', at: number | null): void {
  if (at === null) delete held[what]
  else held[what] = at
  tell()
}

function tell(): void {
  for (const listener of listeners) listener(state)
}

/** Listens for a change. Returns the way to stop listening. */
export function watch(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((one) => one !== listener)
  }
}

/**
 * Asks once, and tells everybody only when something a person could see has changed.
 *
 * The comparison leaves the position out on purpose -- it changes every single time -- so a page that is simply
 * playing redraws nothing, while a new track or a pause or a reordered queue redraws straight away.
 */
async function askOnce(): Promise<void> {
  if (asking) return
  asking = true
  let answer: Answer<MusicNow>
  try {
    answer = await askNow()
  } finally {
    asking = false
  }
  if (answer.got) {
    const fresh = playbackMark(answer.value.playback)
    // Compared before it is kept, so a listener can be told only when something a person could see has changed.
    const changed = !sameMark(mark, fresh) || state.problem !== null || state.starting
    mark = fresh
    state = { music: answer.value, answeredAt: Date.now(), problem: null, shut: false, starting: false }
    // Told whenever something changed. The seek bar is not one of those things: it runs off the clock in the shell,
    // from `answeredAt`, so an answer that only moved the position redraws nothing at all.
    if (changed) tell()
    return
  }
  // The last answer is kept. A page that forgot what was playing because one ask failed would look broken for a
  // second every time the computer was busy.
  state = { music: state.music, answeredAt: state.answeredAt, problem: answer.why, shut: answer.shut, starting: false }
  tell()
}

/** Asks now, whatever the clock says. Use after a press: the player is read back rather than guessed at. */
export const refresh = (): Promise<void> => askOnce()

/** Asks again shortly, which is how a press is confirmed by the player rather than assumed to have worked. */
export function refreshAfterPress(): void {
  setTimeout(() => void askOnce(), AFTER_A_PRESS)
}

function tick(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    if (!document.hidden) void askOnce()
    tick()
  }, EVERY)
}

let started = false

/** Starts asking. Safe to call more than once; only the first does anything. */
export function startWatching(): void {
  if (started) return
  started = true
  void askOnce()
  tick()
  // A tab that was in the background may be a long way out of date, so it asks the moment it is looked at again
  // rather than waiting for the next turn of the clock.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void askOnce()
  })
}
