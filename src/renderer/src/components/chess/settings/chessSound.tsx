import type { ChessSettings } from '../../../../../shared/chess/settings'

/**
 * The move sounds, made rather than played.
 *
 * There are no sound files. Each of these is a few dozen milliseconds of a tone with an envelope on it, built by
 * the browser's own audio engine, which means nothing is downloaded, nothing is licensed, and nothing is added to
 * the size of Orbis. It also means the four sounds can be *described* truthfully in the settings -- "a short tap",
 * "a lower, harder knock" -- because that is all they are.
 *
 * ## What is deliberate about the shapes
 *
 * A piece going down is a short, dull tap: a triangle wave at a low pitch, decaying in forty milliseconds. A piece
 * being taken is lower and longer with a harder attack, because the one thing these sounds have to do is let
 * somebody know *which* happened without looking. Check is two quick high notes, which cuts through both. The end
 * of a game is a falling pair, which is the one shape nothing else uses.
 *
 * ## Volume
 *
 * The setting is 0 to 100 and it is multiplied by a ceiling of 0.22, not by 1. A move sound at full gain in a
 * window somebody is also listening to something in is a sound they turn off, and a sound they turn off is a
 * sound that never tells them anything again. The honest version is quiet.
 */

export type ChessSoundName = 'move' | 'capture' | 'castle' | 'check' | 'end'

/** The ceiling. The loudest the setting can ask for is still a sound you can talk over. */
const CEILING = 0.22

interface Note {
  /** Hertz at the start, and at the end when it slides. */
  from: number
  to?: number
  /** Seconds. */
  length: number
  shape: OscillatorType
  /** Seconds after the sound starts. */
  at: number
  /** A share of the volume, for a note meant to sit under another. */
  share: number
}

const VOICES: Readonly<Record<ChessSoundName, readonly Note[]>> = Object.freeze({
  move: [{ from: 190, to: 150, length: 0.045, shape: 'triangle', at: 0, share: 1 }],
  /* Castling is two pieces travelling, so it is two taps very close together -- the same tap as a move, said
     twice. It is the only move you can hear is a castle without looking, which is the whole reason it is here. */
  castle: [
    { from: 200, to: 160, length: 0.04, shape: 'triangle', at: 0, share: 0.9 },
    { from: 170, to: 136, length: 0.045, shape: 'triangle', at: 0.055, share: 0.9 }
  ],
  capture: [
    { from: 110, to: 72, length: 0.09, shape: 'square', at: 0, share: 0.7 },
    { from: 220, to: 140, length: 0.055, shape: 'triangle', at: 0, share: 0.5 }
  ],
  check: [
    { from: 880, length: 0.05, shape: 'sine', at: 0, share: 0.6 },
    { from: 1180, length: 0.05, shape: 'sine', at: 0.075, share: 0.6 }
  ],
  end: [
    { from: 440, to: 430, length: 0.14, shape: 'sine', at: 0, share: 0.65 },
    { from: 294, to: 288, length: 0.26, shape: 'sine', at: 0.13, share: 0.65 }
  ]
})

/** Which setting decides whether each sound is made at all. */
const SWITCH: Readonly<Record<ChessSoundName, keyof ChessSettings['sound']>> = Object.freeze({
  move: 'onMove',
  capture: 'onCapture',
  // Castling has no switch of its own: it is a move, and it is on or off with the other move sounds. Adding a
  // fifth switch would mean a fifth thing kept per profile for a sound nobody would turn off on its own.
  castle: 'onMove',
  check: 'onCheck',
  end: 'onEnd'
})

export const SOUND_LABEL: Readonly<Record<ChessSoundName, string>> = Object.freeze({
  move: 'A move',
  capture: 'A capture',
  castle: 'Castling',
  check: 'Check',
  end: 'The end of a game'
})

let context: AudioContext | null = null

/**
 * The audio engine, made the first time a sound is asked for and not before.
 *
 * Browsers refuse to start one until somebody has clicked something, and making it at module load would leave a
 * suspended engine behind in every window that merely loaded Chess World. Null when the browser has no audio at
 * all, which is a real answer and is what the screen says.
 */
function engine(): AudioContext | null {
  if (context) return context
  const Maker = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Maker) return null
  try {
    context = new Maker()
    return context
  } catch {
    return null
  }
}

export type SoundResult = 'played' | 'off' | 'this-one-off' | 'silent' | 'no-audio'

/**
 * Makes one of the sounds, and says what it did.
 *
 * The four answers are different things and the screen tells them apart: the sound is off altogether, this
 * particular sound is off, the volume is nothing, or this computer has no audio engine to ask. A button that
 * reported "played" for all four would be a button that lies about silence.
 */
export function playChessSound(name: ChessSoundName, settings: ChessSettings): SoundResult {
  const sound = settings.sound
  if (!sound.enabled) return 'off'
  if (!sound[SWITCH[name]]) return 'this-one-off'
  if (sound.volume <= 0) return 'silent'

  const audio = engine()
  if (!audio) return 'no-audio'
  // A window that was in the background has its engine suspended; resuming is what makes the first sound audible.
  if (audio.state === 'suspended') void audio.resume().catch(() => undefined)

  const gain = (sound.volume / 100) * CEILING
  const start = audio.currentTime + 0.01

  for (const note of VOICES[name]) {
    const osc = audio.createOscillator()
    const level = audio.createGain()
    osc.type = note.shape
    osc.frequency.setValueAtTime(note.from, start + note.at)
    if (note.to !== undefined) osc.frequency.exponentialRampToValueAtTime(note.to, start + note.at + note.length)

    // An envelope rather than a bare start and stop: a tone that begins and ends at full level clicks, and the
    // click is louder than the note.
    const peak = Math.max(0.0001, gain * note.share)
    level.gain.setValueAtTime(0.0001, start + note.at)
    level.gain.exponentialRampToValueAtTime(peak, start + note.at + 0.006)
    level.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length)

    osc.connect(level)
    level.connect(audio.destination)
    osc.start(start + note.at)
    osc.stop(start + note.at + note.length + 0.02)
  }
  return 'played'
}

export const SOUND_RESULT_WORDS: Readonly<Record<SoundResult, string>> = Object.freeze({
  played: 'Played.',
  off: 'Sound is off, so nothing was made.',
  'this-one-off': 'That one is switched off, so nothing was made.',
  silent: 'The volume is nothing, so nothing was made.',
  'no-audio': 'This computer gave Orbis no way to make a sound.'
})

/** Lets go of the audio engine. The screen does this when it closes, so nothing is left running. */
export function releaseChessSound(): void {
  const audio = context
  context = null
  if (audio) void audio.close().catch(() => undefined)
}
