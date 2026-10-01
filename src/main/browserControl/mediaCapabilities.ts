import type { ParamSpec } from '../../shared/browserControl.ts'
import type { BrowserControl } from './registry.ts'
import type { ControlContext } from './registry.ts'
import type { PageHandle } from '../pageHandle.ts'
import * as page from './page.ts'

/**
 * What is playing on the page, and waiting for it to change.
 *
 * Orbis could open a video and it could mute a tab, and between those two it knew nothing: whether anything was
 * playing, where it had got to, or whether it had finished. So "when this video ends, go to the next one" -- the
 * ordinary shape of watching anything -- was not a thing Orbis could be asked, and the only way to approximate it
 * was to wait a fixed number of seconds and hope. A thirty-second wait is wrong for every video that is not thirty
 * seconds long.
 *
 * These read and act on the real media elements of the page, through the same page bridge every other page
 * capability uses. There is no second mechanism here.
 *
 * ## What they will not do
 *
 * **They never guess that something ended.** Ended is the media's own `ended`, or its position having reached its
 * duration. A video that is buffering is buffering, a video that is paused is paused, and neither is finished --
 * confusing those is how an automation skips to the next thing while somebody is still watching this one.
 *
 * **They never poll in a loop.** Waiting is done by listening to the media's own events inside the page and
 * resolving when one arrives. A timeout is a safeguard against a video that will never end, not the mechanism.
 *
 * **They never reach past the page.** A media element is a page's own, found by the same page bridge, and nothing
 * here can touch a tab the command was not aimed at.
 */

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const num = (description: string, required = false, range?: { min?: number; max?: number }): ParamSpec => ({
  type: 'number',
  description,
  required,
  ...range
})
const int = (description: string, required = false, range?: { min?: number; max?: number }): ParamSpec => ({
  type: 'integer',
  description,
  required,
  ...range
})

/** The states a media element can be in, as a person would name them. */
export type MediaState = 'playing' | 'paused' | 'buffering' | 'ended' | 'idle'

export interface MediaReading {
  index: number
  kind: 'video' | 'audio'
  state: MediaState
  currentTime: number
  duration: number
  muted: boolean
  volume: number
  /** Whether it is the one worth calling "the video": the largest visible one that is playing, or else the largest. */
  primary: boolean
  /** Enough of the source to tell one video from the next, without carrying a whole URL around. */
  source: string
  visible: boolean
}

/**
 * Reading the page's media, as a script the page runs.
 *
 * Shared by the reading and the waiting so there is one definition of what "playing" means. `ended` is taken from the
 * media itself first and from the position only as a fallback -- some players never fire `ended` but do run the clock
 * to the end, and some report a duration of zero while they are still working out what they are.
 */
const READ_SCRIPT = `(() => {
  const seen = [...document.querySelectorAll('video, audio')]
  const area = (el) => { const r = el.getBoundingClientRect(); return Math.max(0, r.width) * Math.max(0, r.height) }
  const onScreen = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < (window.innerHeight || 0)
  }
  const read = seen.map((el, index) => {
    const duration = Number.isFinite(el.duration) ? el.duration : 0
    const at = Number.isFinite(el.currentTime) ? el.currentTime : 0
    // Ended as the element says it, or as the clock says it: a quarter of a second from the end is the end.
    /*
     * Ended, as the media says it, or as the clock says it.
     *
     * The clock is only a fallback: some players never fire an ended event but do run to the end. The margin is small on
     * purpose -- a quarter of a second is a noticeable amount of a short video to cut off, and measured against a
     * real one it fired while the picture was still moving.
     */
    const finished = el.ended === true || (duration > 0 && at >= duration - 0.08)
    const state = finished
      ? 'ended'
      : el.paused
        ? (at > 0 ? 'paused' : 'idle')
        // readyState below HAVE_FUTURE_DATA while not paused is a player that wants to play and cannot yet.
        : el.readyState < 3
          ? 'buffering'
          : 'playing'
    return {
      index,
      kind: el.tagName.toLowerCase() === 'audio' ? 'audio' : 'video',
      state,
      currentTime: at,
      duration,
      muted: el.muted === true,
      volume: typeof el.volume === 'number' ? el.volume : 1,
      source: String(el.currentSrc || el.src || '').slice(-120),
      visible: onScreen(el),
      area: area(el)
    }
  })
  // The one worth calling "the video": the biggest thing on screen that is playing, else the biggest on screen.
  const rank = (m) => (m.visible ? 1 : 0) * 1e9 + (m.state === 'playing' ? 1 : 0) * 1e8 + m.area
  let best = -1
  read.forEach((m, i) => { if (best < 0 || rank(m) > rank(read[best])) best = i })
  return read.map((m, i) => { const { area, ...rest } = m; return { ...rest, primary: i === best } })
})()`

/**
 * Waiting for a media condition, inside the page.
 *
 * Built as a script that listens to the media's own events and resolves when the condition holds -- so a video that
 * ends after nine seconds is noticed after nine seconds, and one that ends after nine minutes is noticed then. A
 * slow interval is kept alongside the listeners because a few players mutate the element rather than firing events,
 * and because `timeupdate` stops arriving the moment a video stalls.
 */
const waitScript = (want: string, index: number, position: number, ms: number): string => `(() => new Promise((resolve) => {
  const pick = () => {
    const all = [...document.querySelectorAll('video, audio')]
    if (${index} >= 0) return all[${index}] || null
    // No index given: whichever is playing, else whichever is biggest, which is what "the video" means on a page.
    const score = (el) => {
      const r = el.getBoundingClientRect()
      return (el.paused ? 0 : 1e8) + Math.max(0, r.width) * Math.max(0, r.height)
    }
    return all.sort((a, b) => score(b) - score(a))[0] || null
  }

  const holds = (el) => {
    if (!el) return false
    const duration = Number.isFinite(el.duration) ? el.duration : 0
    const at = Number.isFinite(el.currentTime) ? el.currentTime : 0
    const finished = el.ended === true || (duration > 0 && at >= duration - 0.08)
    switch (${JSON.stringify(want)}) {
      case 'ended': return finished
      case 'playing': return !el.paused && el.readyState >= 3 && !finished
      case 'paused': return el.paused && !finished
      case 'position': return at >= ${position}
      default: return false
    }
  }

  let settled = false
  const finish = (met) => {
    if (settled) return
    settled = true
    clearInterval(tick)
    clearTimeout(limit)
    for (const [el, off] of listeners) off()
    const el = pick()
    /*
     * The state it was met in, not a fresh guess at it.
     *
     * Reading the element again gave answers that contradicted the wait itself: a video half a frame from its end
     * reports paused as false, so a wait for "ended" came back met and said the video was playing. Anything reading
     * that result got two facts that cannot both be true. When the condition held, the condition is the answer.
     */
    const raw = el ? (el.ended ? 'ended' : el.paused ? 'paused' : el.readyState < 3 ? 'buffering' : 'playing') : 'none'
    const atEnd = (() => {
      if (!el) return false
      const duration = Number.isFinite(el.duration) ? el.duration : 0
      const at = Number.isFinite(el.currentTime) ? el.currentTime : 0
      return el.ended === true || (duration > 0 && at >= duration - 0.08)
    })()
    resolve({
      met,
      state: met && ${JSON.stringify(want)} === 'ended' ? 'ended' : atEnd ? 'ended' : raw,
      currentTime: el && Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: el && Number.isFinite(el.duration) ? el.duration : 0,
      source: el ? String(el.currentSrc || el.src || '').slice(-120) : ''
    })
  }

  const check = () => { if (holds(pick())) finish(true) }

  const listeners = []
  const el = pick()
  if (el) {
    for (const name of ['ended', 'pause', 'play', 'playing', 'timeupdate', 'seeked', 'emptied', 'loadedmetadata']) {
      el.addEventListener(name, check)
      listeners.push([el, () => el.removeEventListener(name, check)])
    }
  }
  /*
   * A slow interval beside the listeners, not instead of them.
   *
   * timeupdate stops arriving the moment a video stalls, and a few players swap the element out rather than
   * firing anything at all -- so without this a stall would be waited on until the timeout rather than noticed.
   * Half a second is often enough to catch those and rare enough to cost nothing.
   */
  const tick = setInterval(check, 500)
  const limit = setTimeout(() => finish(false), ${ms})
  check()
}))()`

export interface MediaDeps {
  /** The page a command acts on: the command's target, or the active tab. Each platform provides its own. */
  tab(ctx: ControlContext): PageHandle
  fail(code: string, message: string, recoverable?: boolean): never
}

export function registerMediaCapabilities(control: BrowserControl, d: MediaDeps): void {
  const common = { domain: 'media' as const, requires: ['web-page' as const] }

  control.register({
    ...common,
    id: 'media.state',
    name: 'What is playing',
    description:
      'Every video and audio element on the page: whether it is playing, paused, buffering or ended, where it has got to, how long it is, and which one is the main one.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async (_p: Record<string, unknown>, ctx: ControlContext) => ({ media: await page.exec<MediaReading[]>(d.tab(ctx), READ_SCRIPT, 6000) })
  })

  control.register({
    ...common,
    id: 'media.play',
    name: 'Play',
    description: 'Starts the page’s video or audio. Without an index, the main one.',
    params: { index: int('Which one, from media.state (default: the main one).', false, { min: 0 }) },
    mutates: true,
    confirmation: 'none',
    run: async (p: Record<string, unknown>, ctx: ControlContext) => act(d, ctx, 'play', p.index),
    verify: async (_data: unknown, _p: Record<string, unknown>, ctx: ControlContext) => {
      const media = await page.exec<MediaReading[]>(d.tab(ctx), READ_SCRIPT, 6000)
      const one = media.find((m) => m.primary) ?? media[0]
      // Buffering counts: a player that has been told to play and is fetching is playing as far as anybody asked.
      const playing = Boolean(one && (one.state === 'playing' || one.state === 'buffering'))
      return { verified: playing, detail: one ? `It is ${one.state}.` : 'There is nothing to play on this page.' }
    }
  })

  control.register({
    ...common,
    id: 'media.pause',
    name: 'Pause',
    description: 'Pauses the page’s video or audio. Without an index, the main one.',
    params: { index: int('Which one, from media.state (default: the main one).', false, { min: 0 }) },
    mutates: true,
    confirmation: 'none',
    run: async (p: Record<string, unknown>, ctx: ControlContext) => act(d, ctx, 'pause', p.index),
    verify: async (_data: unknown, _p: Record<string, unknown>, ctx: ControlContext) => {
      const media = await page.exec<MediaReading[]>(d.tab(ctx), READ_SCRIPT, 6000)
      const one = media.find((m) => m.primary) ?? media[0]
      const paused = Boolean(one && (one.state === 'paused' || one.state === 'ended' || one.state === 'idle'))
      return { verified: paused, detail: one ? `It is ${one.state}.` : 'There is nothing playing on this page.' }
    }
  })

  control.register({
    ...common,
    id: 'media.seek',
    name: 'Jump to a point',
    description: 'Moves the page’s video or audio to a number of seconds from the start.',
    params: {
      seconds: num('How far from the start.', true, { min: 0 }),
      index: int('Which one, from media.state (default: the main one).', false, { min: 0 })
    },
    mutates: true,
    confirmation: 'none',
    run: async (p: Record<string, unknown>, ctx: ControlContext) => act(d, ctx, 'seek', p.index, Number(p.seconds))
  })

  control.register({
    ...common,
    id: 'media.volume',
    name: 'Set the volume',
    description: 'Sets how loud the page’s video or audio is, from 0 to 1. Muting a whole tab is tabs.mute.',
    params: {
      level: num('0 is silent, 1 is full.', true, { min: 0, max: 1 }),
      index: int('Which one, from media.state (default: the main one).', false, { min: 0 })
    },
    mutates: true,
    confirmation: 'none',
    run: async (p: Record<string, unknown>, ctx: ControlContext) => act(d, ctx, 'volume', p.index, Number(p.level))
  })

  /**
   * The one that makes reactive watching possible.
   *
   * It is a wait on the media's own events rather than a timer, so "when this finishes" means when this finishes --
   * nine seconds or nine minutes -- and a video that buffers halfway is still being waited on rather than treated as
   * over.
   */
  control.register({
    ...common,
    id: 'media.waitFor',
    name: 'Wait for the video',
    description:
      'Waits until the page’s video or audio reaches a state: ended, playing, paused, or a position in seconds. Listens to the media itself rather than waiting a fixed time, so it is right for a video of any length.',
    params: {
      state: { ...str('ended | playing | paused | position', true), enum: ['ended', 'playing', 'paused', 'position'] },
      seconds: num('For "position": how far in.', false, { min: 0 }),
      index: int('Which one, from media.state (default: the main one).', false, { min: 0 }),
      timeoutMs: int('Give up after this long (default 10 minutes, up to an hour).', false, { min: 1000 })
    },
    mutates: false,
    confirmation: 'none',
    run: async (p: Record<string, unknown>, ctx: ControlContext) => {
      const want = String(p.state)
      if (want === 'position' && !Number.isFinite(Number(p.seconds))) {
        d.fail('invalid-params', 'Say which position to wait for, in seconds.')
      }
      /*
       * Ten minutes by default, an hour at most.
       *
       * A wait with no end is a workflow that can never be finished or cleaned up, and a video that is paused
       * indefinitely would hold one forever. The limit is generous because a long video is a normal thing.
       */
      const ms = Math.min(Math.max(Number(p.timeoutMs) || 600_000, 1000), 3_600_000)
      const index = Number.isInteger(p.index) ? Number(p.index) : -1
      const result = await page.exec<{ met: boolean; state: string; currentTime: number; duration: number; source: string }>(
        d.tab(ctx),
        waitScript(want, index, Number(p.seconds) || 0, ms),
        // The page's own timeout settles first, so this one only catches a page that has stopped answering at all.
        ms + 5000
      )
      if (!result.met) {
        d.fail('timeout', `Waited for the video to be ${want}; it is ${result.state}.`, true)
      }
      return result
    }
  })
}

/** One action on one media element, done in the page. */
async function act(d: MediaDeps, ctx: ControlContext, what: string, index: unknown, value = 0): Promise<unknown> {
  const which = Number.isInteger(index) ? Number(index) : -1
  const script = `(() => {
    const all = [...document.querySelectorAll('video, audio')]
    const score = (el) => {
      const r = el.getBoundingClientRect()
      return (el.paused ? 0 : 1e8) + Math.max(0, r.width) * Math.max(0, r.height)
    }
    const el = ${which} >= 0 ? all[${which}] : all.sort((a, b) => score(b) - score(a))[0]
    if (!el) return { ok: false, why: 'nothing' }
    try {
      switch (${JSON.stringify(what)}) {
        case 'play': { const p = el.play(); if (p && p.catch) p.catch(() => undefined); break }
        case 'pause': el.pause(); break
        case 'seek': el.currentTime = ${value}; break
        case 'volume': el.volume = ${value}; el.muted = ${value} <= 0; break
      }
    } catch (err) {
      return { ok: false, why: String(err && err.message ? err.message : err).slice(0, 120) }
    }
    return { ok: true, currentTime: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0 }
  })()`

  const result = await page.exec<{ ok: boolean; why?: string; currentTime?: number; duration?: number }>(d.tab(ctx), script, 6000)
  if (!result.ok) {
    if (result.why === 'nothing') d.fail('not-found', 'There is no video or audio on this page.')
    /*
     * A browser refusing to start a video is not a fault to retry.
     *
     * Autoplay is blocked until somebody has interacted with the page, and trying again changes nothing. Said as it
     * is, so a plan can do something else rather than pressing play three times.
     */
    d.fail('blocked', `The page would not do that: ${result.why ?? 'it gave no reason.'}`)
  }
  return result
}
