/**
 * On the Beat: the song and the notes you tap, made together out of one structure.
 *
 * There are no sound files in Orbis, so the music is synthesized a note at a time -- and that is exactly why the chart
 * and the tune are the same object here. The game plays `notes[i]` as the song clock passes `notes[i].ms`, and draws
 * `notes[i]` arriving at the line at `notes[i].ms`. One list, one clock: the sound and the thing you are aiming at
 * cannot drift apart, because there is nothing to drift from.
 *
 * What the test holds this to is `chartValid`: notes in order, every one of them on the beat grid, never two in one lane
 * so close together that a single tap could honestly be meant for either, and never more than two at once. An
 * ambiguous chart is unfair in a way the player cannot even see.
 */

import { range, seeded } from './random.ts'

export const LANES = 4
export type Difficulty = 'easy' | 'normal' | 'hard'

/** How late or early a tap may be, in milliseconds, for each verdict. */
export const WINDOWS = { perfect: 45, good: 90, ok: 135 } as const
export type Grade = 'perfect' | 'good' | 'ok' | 'miss'

/** Two notes in one lane must be further apart than a tap could be wrong by, in both directions. */
export const MIN_LANE_GAP_MS = WINDOWS.ok * 2

export interface Note {
  ms: number
  lane: number
  /** What it sounds like. The lane and the note are the same decision, which is why a chart sounds like a tune. */
  freq: number
  lengthMs: number
}

export interface BackingHit {
  ms: number
  freq: number
  lengthMs: number
  kind: 'kick' | 'hat'
}

export interface Song {
  bpm: number
  bars: number
  beatMs: number
  barMs: number
  lengthMs: number
  notes: Note[]
  backing: BackingHit[]
  seed: number
  difficulty: Difficulty
}

/** A five note scale, so a melody put together out of pieces never lands on a sour note. */
const SCALE = [0, 2, 4, 7, 9]
const noteFreq = (step: number): number => Math.round(220 * 2 ** ((SCALE[((step % SCALE.length) + SCALE.length) % SCALE.length] + 12 * Math.floor(step / SCALE.length)) / 12) * 100) / 100

/** Where in a bar the notes fall, in sixteenths. The bank a bar is drawn from is what makes a song feel written. */
const PATTERNS: Record<Difficulty, number[][]> = {
  easy: [[0, 8], [0, 4, 8], [0, 8, 12], [0], [4, 12], [0, 4, 8, 12]],
  normal: [[0, 4, 8, 12], [0, 2, 4, 8], [0, 4, 6, 8, 12], [0, 3, 8, 11], [0, 4, 8, 10, 12], [2, 6, 10, 14], [0, 8]],
  hard: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 4, 8, 10, 12], [0, 1, 4, 5, 8, 9, 12], [0, 3, 6, 9, 12], [0, 2, 6, 8, 14], [0, 4, 8, 12], [0, 2, 4, 6, 8]]
}

const BARS: Record<Difficulty, number> = { easy: 24, normal: 32, hard: 36 }
const BPM: Record<Difficulty, number> = { easy: 96, normal: 112, hard: 128 }

/**
 * A song, and the chart that is the same thing.
 *
 * The first four bars are deliberately thin: nobody can read a wall of notes they have not seen the shape of yet.
 */
export function makeSong(seed: number, difficulty: Difficulty): Song {
  const rng = seeded(seed)
  const bpm = BPM[difficulty]
  const beatMs = 60000 / bpm
  const barMs = beatMs * 4
  const sixteenth = beatMs / 4
  const bars = BARS[difficulty]
  const bank = PATTERNS[difficulty]
  const notes: Note[] = []
  const backing: BackingHit[] = []
  const lastInLane = Array.from({ length: LANES }, () => -Infinity)
  let step = 5

  for (let bar = 0; bar < bars; bar++) {
    const opening = bar < 4
    const pattern = opening ? [[0, 8], [0, 4, 8, 12]][bar % 2] : bank[range(rng, 0, bank.length - 1)]
    for (const sixteenths of pattern) {
      const ms = Math.round(bar * barMs + sixteenths * sixteenth)
      // Move along the scale, then put it in the lane that step belongs to. A lane that has just been used is skipped,
      // so no tap is ever ambiguous.
      step += range(rng, -2, 2)
      step = Math.max(0, Math.min(SCALE.length * 2 - 1, step))
      let chosen = step % LANES
      for (let tries = 0; tries < LANES && ms - lastInLane[chosen] < MIN_LANE_GAP_MS; tries++) chosen = (chosen + 1) % LANES
      if (ms - lastInLane[chosen] < MIN_LANE_GAP_MS) continue
      lastInLane[chosen] = ms
      notes.push({ ms, lane: chosen, freq: noteFreq(step), lengthMs: Math.round(sixteenth * 1.5) })
    }
    // The beat underneath: a kick on each beat, a tick between them.
    for (let beat = 0; beat < 4; beat++) {
      backing.push({ ms: Math.round(bar * barMs + beat * beatMs), freq: beat % 2 === 0 ? 68 : 84, lengthMs: 120, kind: 'kick' })
      if (!opening) backing.push({ ms: Math.round(bar * barMs + beat * beatMs + beatMs / 2), freq: 1700, lengthMs: 28, kind: 'hat' })
    }
  }
  notes.sort((a, b) => a.ms - b.ms || a.lane - b.lane)
  backing.sort((a, b) => a.ms - b.ms)
  return { bpm, bars, beatMs, barMs, lengthMs: Math.round(bars * barMs), notes, backing, seed, difficulty }
}

/**
 * What is wrong with a chart, in a sentence, or null when there is nothing wrong with it. The generator above cannot
 * produce one of these faults; this is what proves that rather than assuming it.
 */
export function chartValid(song: Song): string | null {
  const sixteenth = song.beatMs / 4
  const lastInLane = Array.from({ length: LANES }, () => -Infinity)
  const atTime = new Map<number, number>()
  for (let i = 0; i < song.notes.length; i++) {
    const note = song.notes[i]
    if (i && note.ms < song.notes[i - 1].ms) return 'the notes are out of order'
    if (note.lane < 0 || note.lane >= LANES || !Number.isInteger(note.lane)) return `lane ${note.lane} does not exist`
    if (note.ms < 0 || note.ms > song.lengthMs) return 'a note outside the song'
    if (!(note.freq > 40 && note.freq < 4000)) return `a note nobody can hear: ${note.freq}`
    // On the grid, give or take the rounding to whole milliseconds.
    const offGrid = Math.abs(note.ms / sixteenth - Math.round(note.ms / sixteenth))
    if (offGrid > 0.02) return `a note off the beat grid at ${note.ms}ms`
    if (note.ms - lastInLane[note.lane] < MIN_LANE_GAP_MS) return `two notes in lane ${note.lane} only ${Math.round(note.ms - lastInLane[note.lane])}ms apart`
    lastInLane[note.lane] = note.ms
    const together = (atTime.get(note.ms) ?? 0) + 1
    if (together > 2) return `${together} notes at once at ${note.ms}ms`
    atTime.set(note.ms, together)
  }
  if (song.notes.length < song.bars) return 'barely any notes'
  if (!song.backing.length) return 'no beat underneath'
  return null
}

/**
 * How a tap landed. `deltaMs` is the tap less the note, so it is negative when the tap came early -- and the sign is
 * kept, because "you are consistently early" is the single most useful thing this game can tell anybody.
 */
export function judge(deltaMs: number): { grade: Grade; early: boolean } {
  const off = Math.abs(deltaMs)
  const early = deltaMs < 0
  if (off <= WINDOWS.perfect) return { grade: 'perfect', early }
  if (off <= WINDOWS.good) return { grade: 'good', early }
  if (off <= WINDOWS.ok) return { grade: 'ok', early }
  return { grade: 'miss', early }
}

export const GRADE_POINTS: Record<Grade, number> = { perfect: 300, good: 200, ok: 100, miss: 0 }

/** What a note is worth: its grade, and up to half again for a run of them. */
export function notePoints(grade: Grade, combo: number): number {
  if (grade === 'miss') return 0
  return Math.round(GRADE_POINTS[grade] * (1 + Math.min(50, Math.max(0, combo)) / 100))
}

export type Counts = Record<Grade, number>

export const emptyCounts = (): Counts => ({ perfect: 0, good: 0, ok: 0, miss: 0 })

/** Accuracy out of a hundred: a perfect note counts for one, a good one for two thirds, an ok one for a third. */
export function accuracyOf(counts: Counts): number {
  const total = counts.perfect + counts.good + counts.ok + counts.miss
  if (!total) return 0
  const weighted = counts.perfect + counts.good * (2 / 3) + counts.ok / 3
  return Math.round((weighted / total) * 1000) / 10
}

/** What to call a run. Said plainly, and never congratulating somebody for missing half the song. */
export function rank(accuracy: number): string {
  if (accuracy >= 99) return 'Every note'
  if (accuracy >= 95) return 'Nearly perfect'
  if (accuracy >= 88) return 'Very good'
  if (accuracy >= 75) return 'Good'
  if (accuracy >= 60) return 'Getting there'
  return 'Keep at it'
}

/** Which note a tap in a lane was meant for: the nearest one still open, if it is near enough to count at all. */
export function nearestOpen(notes: Note[], open: boolean[], lane: number, atMs: number): number {
  let best = -1
  let bestOff = Infinity
  for (let i = 0; i < notes.length; i++) {
    if (!open[i] || notes[i].lane !== lane) continue
    const off = Math.abs(atMs - notes[i].ms)
    if (off > WINDOWS.ok) continue
    if (off < bestOff) {
      bestOff = off
      best = i
    }
  }
  return best
}
