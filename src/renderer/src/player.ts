/**
 * The one thing in Orbis that actually makes sound.
 *
 * This runs in a window nobody sees. It holds a single `<audio>` element, does what the main process tells it, and
 * reports back what the element really says -- its position, its length, whether it is playing, and what went wrong
 * when something did. Nothing here decides anything: the queue, the repeat setting and what counts as a play all
 * live in the main process, and this is only the part that can be heard.
 *
 * Every number sent back is read off the element. A position is `audio.currentTime`, not a clock that was started
 * when play was pressed -- those two drift apart the moment the file stalls, and a progress bar that keeps moving
 * while the sound has stopped is the clearest possible way to tell somebody a lie.
 */

interface PlayerCommand {
  kind: 'load' | 'play' | 'pause' | 'seek' | 'volume' | 'muted' | 'stop' | 'measure'
  /** For `load`: the track's id. The audio is fetched as `orbis-audio://track/<id>`; no path ever comes in here. */
  trackId?: string
  /** For `load`: where to start, in seconds. Used to carry on from where a track was left. */
  at?: number
  seconds?: number
  value?: number
  on?: boolean
}

export interface PlayerReport {
  trackId: string | null
  playing: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  /** True while the browser is still fetching enough to play. Not the same as paused. */
  buffering: boolean
  ended: boolean
  /** What the element said went wrong, in words. Null when nothing did. */
  problem: string | null
}

import { ANALYSE_RATE, measure, type Measured } from '../../shared/music/analyse'

const sound = document.getElementById('sound') as HTMLAudioElement
let trackId: string | null = null
let problem: string | null = null

const report = (): void => {
  const state: PlayerReport = {
    trackId,
    playing: !sound.paused && !sound.ended && sound.readyState >= 2,
    position: Number.isFinite(sound.currentTime) ? sound.currentTime : 0,
    // An element that does not know the length says NaN. That is reported as zero and shown as a blank, never as a
    // made-up length.
    duration: Number.isFinite(sound.duration) ? sound.duration : 0,
    volume: sound.volume,
    muted: sound.muted,
    buffering: sound.readyState < 3 && !sound.paused,
    ended: sound.ended,
    problem
  }
  window.player.report(state)
}

/** What the element's own error code means, in words somebody can act on. */
const errorWords = (): string => {
  switch (sound.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Playing this track was stopped before it started.'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'This track could not be read all the way through.'
    case MediaError.MEDIA_ERR_DECODE:
      return 'This file is damaged, or is not the kind of audio it says it is.'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'This computer cannot play this kind of audio file.'
    default:
      return 'This track could not be played.'
  }
}

for (const event of ['play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'waiting', 'playing', 'seeked', 'canplay'] as const) {
  sound.addEventListener(event, report)
}
sound.addEventListener('error', () => {
  problem = errorWords()
  report()
})
sound.addEventListener('ended', () => {
  // The main process decides what comes next; this only says that this one finished.
  report()
  window.player.finished(trackId)
})

window.player.onCommand((command: PlayerCommand) => {
  switch (command.kind) {
    case 'load': {
      if (!command.trackId) return
      problem = null
      trackId = command.trackId
      sound.src = `orbis-audio://track/${encodeURIComponent(command.trackId)}`
      sound.currentTime = 0
      // Carrying on from where it was left: set once the element knows how long the track is, or the seek is ignored.
      if (command.at && command.at > 0) {
        const settle = (): void => {
          sound.currentTime = Math.min(command.at ?? 0, Number.isFinite(sound.duration) ? sound.duration - 1 : (command.at ?? 0))
          sound.removeEventListener('loadedmetadata', settle)
        }
        sound.addEventListener('loadedmetadata', settle)
      }
      void sound.play().catch(() => {
        // A play that was refused is reported as it is, with whatever the element says about why.
        problem = sound.error ? errorWords() : 'This track could not be played.'
        report()
      })
      break
    }
    case 'play':
      void sound.play().catch(() => {
        problem = sound.error ? errorWords() : 'This track could not be played.'
        report()
      })
      break
    case 'pause':
      sound.pause()
      break
    case 'seek':
      if (typeof command.seconds !== 'number' || !Number.isFinite(command.seconds)) break
      // Clamped against the length when the element knows it. It is not required to know it: a stream whose length
      // has not arrived yet can still be sought, and refusing on that basis ignored every seek.
      sound.currentTime = Math.max(0, Number.isFinite(sound.duration) ? Math.min(command.seconds, sound.duration) : command.seconds)
      break
    case 'volume':
      if (typeof command.value === 'number') sound.volume = Math.max(0, Math.min(1, command.value))
      break
    case 'muted':
      sound.muted = command.on === true
      break
    case 'stop':
      sound.pause()
      sound.removeAttribute('src')
      sound.load()
      trackId = null
      problem = null
      report()
      break
    case 'measure':
      // Measuring is nothing to do with playing: it decodes the file on its own and does not touch the element.
      if (command.trackId) void measureTrack(command.trackId)
      break
  }
})

/**
 * Listening to a track properly, once, to find out what it is like.
 *
 * This window is the only part of Orbis with an audio decoder, which is why the measuring happens here. The file
 * is fetched through the same `orbis-audio://` route playing uses, decoded, mixed down to one channel, resampled
 * to the rate the measuring expects, and a half-minute from the middle is measured -- the middle, because the
 * first thirty seconds of a track is often an introduction and tells you the least about it.
 *
 * Nothing is kept: the samples exist for the length of the call. What goes back is eight numbers.
 */
async function measureTrack(id: string): Promise<void> {
  try {
    const response = await fetch(`orbis-audio://track/${encodeURIComponent(id)}`)
    if (!response.ok) {
      window.player.measured(id, null, `the track could not be read (${response.status})`)
      return
    }
    const bytes = await response.arrayBuffer()
    // An offline context decodes without making a sound, which is what is wanted while something else plays.
    const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: ANALYSE_RATE })
    const decoded = await context.decodeAudioData(bytes)

    // One channel: the average of what there is, so a stereo track is not measured twice.
    const frames = decoded.length
    const mono = new Float32Array(frames)
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel)
      for (let i = 0; i < frames; i += 1) mono[i] += data[i] / decoded.numberOfChannels
    }

    // Resampled to the measuring rate by taking the nearest sample, which is accurate enough for loudness,
    // brightness and a beat, and costs almost nothing.
    const ratio = decoded.sampleRate / ANALYSE_RATE
    const wantedSeconds = 30
    const totalSeconds = frames / decoded.sampleRate
    const startSecond = Math.max(0, (totalSeconds - wantedSeconds) / 2)
    const length = Math.min(Math.round(wantedSeconds * ANALYSE_RATE), Math.round((totalSeconds - startSecond) * ANALYSE_RATE))
    const samples = new Float32Array(Math.max(0, length))
    const offset = Math.round(startSecond * decoded.sampleRate)
    for (let i = 0; i < samples.length; i += 1) {
      const at = offset + Math.round(i * ratio)
      samples[i] = at < frames ? mono[at] : 0
    }
    if (samples.length < ANALYSE_RATE) {
      window.player.measured(id, null, 'there is not enough audio in this file to measure')
      return
    }
    window.player.measured(id, measure(samples, ANALYSE_RATE), null)
  } catch (err) {
    // A file that cannot be decoded is reported as that, and never as a set of middling numbers.
    window.player.measured(id, null, err instanceof Error ? err.message.slice(0, 120) : 'it could not be decoded')
  }
}

// Said once at the start, so the main process knows the player is there and listening.
window.player.ready()

declare global {
  interface Window {
    /** Put there by the player window's own bridge, and nowhere else in Orbis. */
    player: {
      onCommand(listener: (command: PlayerCommand) => void): void
      report(state: PlayerReport): void
      finished(trackId: string | null): void
      /** What a track turned out to sound like, or why it could not be measured. */
      measured(trackId: string, features: Measured | null, problem: string | null): void
      ready(): void
    }
  }
}
