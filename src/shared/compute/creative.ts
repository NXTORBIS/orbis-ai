/**
 * Creative work: music theory, colour, and the scales that layout is built on.
 *
 * The shared creative engine for Orbis Pages. Scales and chords are built from interval patterns rather than looked
 * up, colour contrast is computed by the standard that accessibility is actually judged against, and every result
 * that rests on a convention names the convention.
 *
 * ## What this shares with the acoustics engine and what it does not
 *
 * `acoustics` converts a frequency to a note and measures the interval between two frequencies — the physics.
 * This is the theory: which notes are in a key, what a chord is made of, how a progression is numbered. They meet
 * at the note name, and neither duplicates the other.
 *
 * ## Why equal temperament is stated rather than assumed
 *
 * Twelve-tone equal temperament makes every semitone the same ratio, which means no interval except the octave is
 * exactly in tune. A just major third is 386 cents and an equal-tempered one is 400 — audible, and the reason a
 * string quartet does not play in equal temperament. Every frequency here says which tuning it used.
 *
 * ## Why contrast is computed to the standard and not to taste
 *
 * WCAG contrast ratio is the number accessibility is judged against, it has defined thresholds, and it is
 * computable. It also has known flaws — it under-rates dark-on-light text and over-rates some colour pairs — and
 * APCA was designed to fix them. Both are reported, with the thresholds each one uses.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * note         vs  pitch class      -- C4 against "a C somewhere"
 * interval     vs  distance in semitones -- a third against four semitones; a diminished fourth is also four
 * key          vs  scale            -- the tonal centre against the set of notes
 * equal        vs  just tuning      -- and the 14 cents between their major thirds
 * hue          vs  wavelength       -- a coordinate in a colour model against light of one frequency
 * contrast     vs  legibility       -- a ratio against whether anybody can read it
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface CreativeError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'unknown-name' | 'no-solution' | 'too-many'
  message: string
}

export const isCreativeError = (value: unknown): value is CreativeError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: CreativeError['error'], message: string): CreativeError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const CREATIVE_LIMITS = Object.freeze({ notes: 200, steps: 64, colours: 200, levels: 20 })

// ---------------------------------------------------------------- notes

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const LETTER_SEMITONES: Readonly<Record<string, number>> = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })

export interface Note {
  /** 0 is C, 1 is C#, up to 11 for B. */
  pitchClass: number
  /** Scientific pitch notation: C4 is middle C. */
  octave: number
  /** The MIDI number, where 60 is middle C. */
  midi: number
  name: string
}

/**
 * Parse a note name into a pitch class, an octave and a MIDI number.
 *
 * Accepts sharps, flats, doubles, and a missing octave (which defaults to 4, the octave of middle C). B# and Cb are
 * accepted and cross the octave boundary, because they are real notation — B#3 and C4 are the same key on a piano
 * and are not the same note in a score.
 */
export function parseNote(name: string): Note | CreativeError {
  if (typeof name !== 'string') return fail('invalid-argument', 'A note name has to be text.')
  const match = /^([A-Ga-g])([#b♯♭]{0,2})(-?\d{1,2})?$/.exec(name.trim())
  if (match === null) {
    return fail(
      'unknown-name',
      `"${name}" is not a note name. Names look like C, F#, Bb4 or Ebb3 — a letter A to G, optional sharps or flats, and an optional octave.`
    )
  }
  const letter = match[1].toUpperCase()
  const accidentals = (match[2] ?? '').replace(/♯/g, '#').replace(/♭/g, 'b')
  const octave = match[3] === undefined ? 4 : Number(match[3])
  if (!Number.isInteger(octave) || octave < -1 || octave > 10) {
    return fail('out-of-range', 'The octave runs from -1 to 10, which covers everything MIDI can name.')
  }
  let shift = 0
  for (const one of accidentals) shift += one === '#' ? 1 : -1

  const raw = LETTER_SEMITONES[letter] + shift
  // B# is in the next octave and Cb in the previous one, which the modulo handles and the octave has to follow.
  const octaveShift = Math.floor(raw / 12)
  const pitchClass = ((raw % 12) + 12) % 12
  const midi = (octave + octaveShift + 1) * 12 + pitchClass
  if (midi < 0 || midi > 127) return fail('out-of-range', `${name} is MIDI note ${midi}, outside the 0 to 127 MIDI can address.`)

  return { pitchClass, octave: octave + octaveShift, midi, name: `${letter}${accidentals}${octave}` }
}

export type Tuning = 'equal-temperament' | 'just-intonation' | 'pythagorean'

export const TUNINGS: readonly Tuning[] = Object.freeze(['equal-temperament', 'just-intonation', 'pythagorean'])

export const TUNING_FACTS: Readonly<Record<Tuning, { label: string; describe: string; tradeoff: string }>> =
  Object.freeze({
    'equal-temperament': {
      label: 'Twelve-tone equal temperament',
      describe: 'Every semitone is the twelfth root of two. The octave is exact and nothing else is.',
      tradeoff: 'You can play in any key and every key is equally slightly wrong. The standard since the nineteenth century.'
    },
    'just-intonation': {
      label: 'Just intonation',
      describe: 'Intervals are small whole-number ratios: 3:2 for a fifth, 5:4 for a major third.',
      tradeoff:
        'Intervals in the home key are exactly in tune and distant keys are badly out. A string quartet drifts toward this without meaning to.'
    },
    pythagorean: {
      label: 'Pythagorean',
      describe: 'Every interval built from stacked perfect fifths at 3:2.',
      tradeoff:
        'Fifths are perfect and thirds are noticeably sharp. Twelve fifths do not close the octave, and the gap — the Pythagorean comma — is where all the trouble comes from.'
    }
  })

/** Just ratios for the twelve semitones, from the standard five-limit set. */
const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8]

export interface FrequencyReport {
  note: string
  midi: number
  /** Hz. */
  frequency: number
  tuning: Tuning
  referenceA4: number
  /** Hz in equal temperament, for comparison. */
  equalTemperedFrequency: number
  /** Cents away from the equal-tempered note. 100 cents is a semitone. */
  centsFromEqual: number
  describe: string
  tradeoff: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The frequency of a note in a named tuning, with the cents it differs from equal temperament.
 *
 * The cents figure is the point. A just major third is 14 cents flat of the equal-tempered one, which is clearly
 * audible and is why a choir singing unaccompanied does not sound like a piano.
 */
export function frequencyOf(input: {
  note: string
  tuning?: Tuning
  /** Hz. 440 is the modern standard; orchestras use 442 or 443, and baroque pitch is around 415. */
  referenceA4?: number
  /** The tonic the just or Pythagorean intervals are measured from. Required for those tunings. */
  tonic?: string
}): FrequencyReport | CreativeError {
  const note = parseNote(input.note)
  if (isCreativeError(note)) return note
  const tuning = input.tuning ?? 'equal-temperament'
  const facts = TUNING_FACTS[tuning]
  if (!facts) return fail('invalid-argument', `"${tuning}" is not one of: ${TUNINGS.join(', ')}.`)
  const reference = input.referenceA4 ?? 440
  if (!finite(reference) || reference <= 0) return fail('invalid-argument', 'The reference pitch has to be greater than zero.')

  const equal = reference * Math.pow(2, (note.midi - 69) / 12)
  let frequency = equal
  const warnings: string[] = []

  if (tuning !== 'equal-temperament') {
    if (input.tonic === undefined) {
      return fail(
        'invalid-argument',
        `${facts.label} measures every interval from a tonic, so the tonic is needed. Unlike equal temperament, the same note has a different frequency depending on what key you are in — that is the whole difference between them.`
      )
    }
    const tonic = parseNote(input.tonic)
    if (isCreativeError(tonic)) return tonic
    const tonicEqual = reference * Math.pow(2, (tonic.midi - 69) / 12)
    const semitones = note.midi - tonic.midi
    const octaves = Math.floor(semitones / 12)
    const within = ((semitones % 12) + 12) % 12
    // Pythagorean stacks fifths and folds them back into the octave; just intonation uses the five-limit ratios.
    const ratio = tuning === 'just-intonation' ? JUST_RATIOS[within] : pythagoreanRatio(within)
    frequency = tonicEqual * ratio * Math.pow(2, octaves)
  }

  const cents = 1200 * Math.log2(frequency / equal)
  if (Math.abs(cents) > 5) {
    warnings.push(
      `This is ${cents.toFixed(1)} cents from the equal-tempered pitch. Anything past about five cents is audible as being out of tune against a piano, which is exactly the point of the tuning.`
    )
  }

  return {
    note: note.name,
    midi: note.midi,
    frequency,
    tuning,
    referenceA4: reference,
    equalTemperedFrequency: equal,
    centsFromEqual: cents,
    describe: facts.describe,
    tradeoff: facts.tradeoff,
    notes: Object.freeze([
      `${note.name} is ${frequency.toFixed(3)} Hz in ${facts.label} with A4 at ${reference} Hz.`,
      `${facts.describe} ${facts.tradeoff}`,
      `In equal temperament it would be ${equal.toFixed(3)} Hz — a difference of ${cents.toFixed(2)} cents.`,
      'A4 at 440 Hz is a twentieth-century agreement, not a fact about music. Orchestras often play at 442 or 443, and baroque pitch is around 415, a semitone lower.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Pythagorean ratio for a number of semitones above the tonic, from stacked fifths folded into one octave. */
function pythagoreanRatio(semitones: number): number {
  // Which power of 3/2 lands on this semitone, taking the shortest route round the circle of fifths.
  const fifths = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5][semitones]
  let ratio = Math.pow(3 / 2, fifths)
  while (ratio >= 2) ratio /= 2
  while (ratio < 1) ratio *= 2
  return ratio
}

// ---------------------------------------------------------------- scales and chords

export type ScaleName =
  | 'major'
  | 'natural-minor'
  | 'harmonic-minor'
  | 'melodic-minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'major-pentatonic'
  | 'minor-pentatonic'
  | 'blues'
  | 'whole-tone'
  | 'chromatic'

export const SCALE_NAMES: readonly ScaleName[] = Object.freeze([
  'major',
  'natural-minor',
  'harmonic-minor',
  'melodic-minor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'locrian',
  'major-pentatonic',
  'minor-pentatonic',
  'blues',
  'whole-tone',
  'chromatic'
])

/** Semitone steps from the tonic. Patterns, not lookup tables of notes — the notes are built from these. */
export const SCALE_PATTERNS: Readonly<Record<ScaleName, { intervals: readonly number[]; describe: string }>> =
  Object.freeze({
    major: { intervals: [0, 2, 4, 5, 7, 9, 11], describe: 'The Ionian mode. The reference every other scale is described against.' },
    'natural-minor': { intervals: [0, 2, 3, 5, 7, 8, 10], describe: 'The Aeolian mode. The same notes as its relative major, started three semitones lower.' },
    'harmonic-minor': { intervals: [0, 2, 3, 5, 7, 8, 11], describe: 'Natural minor with a raised seventh, which gives a dominant chord that resolves.' },
    'melodic-minor': { intervals: [0, 2, 3, 5, 7, 9, 11], describe: 'Raised sixth and seventh going up. Classically it descends as natural minor, which no interval pattern can express.' },
    dorian: { intervals: [0, 2, 3, 5, 7, 9, 10], describe: 'Minor with a raised sixth. Folk and modal jazz.' },
    phrygian: { intervals: [0, 1, 3, 5, 7, 8, 10], describe: 'Minor with a flattened second. Flamenco and metal.' },
    lydian: { intervals: [0, 2, 4, 6, 7, 9, 11], describe: 'Major with a raised fourth.' },
    mixolydian: { intervals: [0, 2, 4, 5, 7, 9, 10], describe: 'Major with a flattened seventh. Blues and rock.' },
    locrian: { intervals: [0, 1, 3, 5, 6, 8, 10], describe: 'Diminished fifth, so the tonic chord is unstable. Rarely used as a key.' },
    'major-pentatonic': { intervals: [0, 2, 4, 7, 9], describe: 'The major scale without its two semitone steps, so nothing clashes.' },
    'minor-pentatonic': { intervals: [0, 3, 5, 7, 10], describe: 'The minor equivalent, and the basis of most blues and rock soloing.' },
    blues: { intervals: [0, 3, 5, 6, 7, 10], describe: 'Minor pentatonic with the flattened fifth added.' },
    'whole-tone': { intervals: [0, 2, 4, 6, 8, 10], describe: 'All whole steps, so it has no tonic and only two transpositions exist.' },
    chromatic: { intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], describe: 'Every semitone. Not a key — it has no tonal centre at all.' }
  })

export interface ScaleReport {
  scale: ScaleName
  tonic: string
  /** The notes, spelled to suit the key. */
  notes: readonly { degree: number; name: string; pitchClass: number; semitonesFromTonic: number; role: string }[]
  intervals: readonly number[]
  /** The chords built on each degree, in the scale itself. */
  diatonicChords: readonly { degree: string; root: string; quality: string; notes: readonly string[] }[] | null
  /** The key with the same notes and a different tonic. */
  relative: string | null
  /** Sharps or flats in the key signature, with the sign. */
  keySignature: number | null
  describe: string
  notesText: readonly string[]
  warnings: readonly string[]
}

const CIRCLE_OF_FIFTHS: Readonly<Record<number, number>> = Object.freeze({
  // Pitch class of the major tonic to the number of sharps (positive) or flats (negative).
  0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1
})

/**
 * Build a scale from its interval pattern, spelled the way the key is written.
 *
 * The spelling is not decoration. F major has a B flat, not an A sharp, because a scale uses each letter once — and
 * a Page showing "A#" in F major has shown something no musician would write. Sharp keys are spelled with sharps
 * and flat keys with flats, decided from the circle of fifths rather than by guessing.
 */
export function scale(input: { tonic: string; scale?: ScaleName }): ScaleReport | CreativeError {
  const name = input.scale ?? 'major'
  const pattern = SCALE_PATTERNS[name]
  if (!pattern) return fail('invalid-argument', `"${name}" is not a scale this knows: ${SCALE_NAMES.join(', ')}.`)
  const tonic = parseNote(input.tonic)
  if (isCreativeError(tonic)) return tonic

  // Flat keys get flat spellings. Decided from the circle of fifths, not guessed.
  const signature = CIRCLE_OF_FIFTHS[tonic.pitchClass] ?? 0
  const useFlats = signature < 0 || /b/.test(input.tonic)
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES

  const roles = ['tonic', 'supertonic', 'mediant', 'subdominant', 'dominant', 'submediant', 'leading note']
  const scaleNotes = pattern.intervals.map((semitones, i) => ({
    degree: i + 1,
    name: names[(tonic.pitchClass + semitones) % 12],
    pitchClass: (tonic.pitchClass + semitones) % 12,
    semitonesFromTonic: semitones,
    role: pattern.intervals.length === 7 ? roles[i] : `degree ${i + 1}`
  }))

  // Diatonic chords, only for seven-note scales — a pentatonic scale does not have them.
  let diatonicChords: ScaleReport['diatonicChords'] = null
  if (pattern.intervals.length === 7) {
    const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
    diatonicChords = pattern.intervals.map((_, i) => {
      const triad = [0, 2, 4].map((step) => pattern.intervals[(i + step) % 7] + (i + step >= 7 ? 12 : 0))
      const third = (triad[1] - triad[0] + 12) % 12
      const fifth = (triad[2] - triad[0] + 12) % 12
      const quality =
        third === 4 && fifth === 7
          ? 'major'
          : third === 3 && fifth === 7
            ? 'minor'
            : third === 3 && fifth === 6
              ? 'diminished'
              : third === 4 && fifth === 8
                ? 'augmented'
                : 'other'
      const numeral = quality === 'major' || quality === 'augmented' ? numerals[i] : numerals[i].toLowerCase()
      return {
        degree: `${numeral}${quality === 'diminished' ? '°' : quality === 'augmented' ? '+' : ''}`,
        root: scaleNotes[i].name,
        quality,
        notes: Object.freeze(triad.map((one) => names[(tonic.pitchClass + one) % 12]))
      }
    })
  }

  // The relative major or minor: the same notes with a different tonic.
  let relative: string | null = null
  if (name === 'major') relative = `${names[(tonic.pitchClass + 9) % 12]} natural minor`
  else if (name === 'natural-minor') relative = `${names[(tonic.pitchClass + 3) % 12]} major`

  const warnings: string[] = []
  if (name === 'melodic-minor') {
    warnings.push(
      'The melodic minor ascends with raised sixth and seventh and classically descends as natural minor. An interval pattern cannot express a scale that differs going up and down, so only the ascending form is here.'
    )
  }
  if (name === 'chromatic' || name === 'whole-tone') {
    warnings.push(`The ${name.replace('-', ' ')} scale has no tonal centre, so the note given is a starting point rather than a tonic and there is no key signature.`)
  }

  return {
    scale: name,
    tonic: tonic.name,
    notes: Object.freeze(scaleNotes),
    intervals: pattern.intervals,
    diatonicChords: diatonicChords === null ? null : Object.freeze(diatonicChords),
    relative,
    keySignature: name === 'major' ? signature : name === 'natural-minor' ? (CIRCLE_OF_FIFTHS[(tonic.pitchClass + 3) % 12] ?? 0) : null,
    describe: pattern.describe,
    notesText: Object.freeze([
      `${tonic.name.replace(/\d+$/, '')} ${name.replace(/-/g, ' ')}: ${scaleNotes.map((one) => one.name).join(' ')}.`,
      pattern.describe,
      `Spelled with ${useFlats ? 'flats' : 'sharps'}, because that is how this key is written. F major has a B flat and not an A sharp — a scale uses each letter once.`,
      diatonicChords === null
        ? 'Scales with fewer than seven notes do not have diatonic chords built on every degree.'
        : `The chords in this key: ${diatonicChords.map((one) => `${one.degree} (${one.root} ${one.quality})`).join(', ')}.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export type ChordQuality =
  | 'major'
  | 'minor'
  | 'diminished'
  | 'augmented'
  | 'major-7'
  | 'minor-7'
  | 'dominant-7'
  | 'half-diminished-7'
  | 'diminished-7'
  | 'minor-major-7'
  | 'suspended-2'
  | 'suspended-4'
  | 'major-6'
  | 'minor-6'
  | 'dominant-9'

export const CHORD_QUALITIES: readonly ChordQuality[] = Object.freeze([
  'major',
  'minor',
  'diminished',
  'augmented',
  'major-7',
  'minor-7',
  'dominant-7',
  'half-diminished-7',
  'diminished-7',
  'minor-major-7',
  'suspended-2',
  'suspended-4',
  'major-6',
  'minor-6',
  'dominant-9'
])

export const CHORD_PATTERNS: Readonly<Record<ChordQuality, { intervals: readonly number[]; symbol: string; describe: string }>> =
  Object.freeze({
    major: { intervals: [0, 4, 7], symbol: '', describe: 'Root, major third, perfect fifth.' },
    minor: { intervals: [0, 3, 7], symbol: 'm', describe: 'Root, minor third, perfect fifth.' },
    diminished: { intervals: [0, 3, 6], symbol: 'dim', describe: 'Two minor thirds stacked. Unstable, wants to resolve.' },
    augmented: { intervals: [0, 4, 8], symbol: 'aug', describe: 'Two major thirds stacked. Symmetrical, so it has only four distinct forms.' },
    'major-7': { intervals: [0, 4, 7, 11], symbol: 'maj7', describe: 'Major triad with a major seventh. Restful rather than driving.' },
    'minor-7': { intervals: [0, 3, 7, 10], symbol: 'm7', describe: 'Minor triad with a minor seventh.' },
    'dominant-7': { intervals: [0, 4, 7, 10], symbol: '7', describe: 'Major triad with a minor seventh. The chord that wants to resolve, and the engine of tonal harmony.' },
    'half-diminished-7': { intervals: [0, 3, 6, 10], symbol: 'm7b5', describe: 'Diminished triad with a minor seventh. The ii of a minor key.' },
    'diminished-7': { intervals: [0, 3, 6, 9], symbol: 'dim7', describe: 'Three minor thirds. Fully symmetrical, so it has only three distinct forms and can resolve four ways.' },
    'minor-major-7': { intervals: [0, 3, 7, 11], symbol: 'mMaj7', describe: 'Minor triad with a major seventh. Uneasy.' },
    'suspended-2': { intervals: [0, 2, 7], symbol: 'sus2', describe: 'The third replaced by a second, so it is neither major nor minor.' },
    'suspended-4': { intervals: [0, 5, 7], symbol: 'sus4', describe: 'The third replaced by a fourth.' },
    'major-6': { intervals: [0, 4, 7, 9], symbol: '6', describe: 'Major triad with a sixth. The same notes as a minor seventh on the sixth degree.' },
    'minor-6': { intervals: [0, 3, 7, 9], symbol: 'm6', describe: 'Minor triad with a major sixth.' },
    'dominant-9': { intervals: [0, 4, 7, 10, 14], symbol: '9', describe: 'Dominant seventh with a ninth on top.' }
  })

export interface ChordReport {
  root: string
  quality: ChordQuality
  symbol: string
  notes: readonly { name: string; midi: number; intervalName: string; semitones: number }[]
  /** The inversions, as note orders. */
  inversions: readonly { name: string; notes: readonly string[]; bass: string }[]
  describe: string
  /** Where this chord sits in the keys that contain it. */
  functionsIn: readonly { key: string; numeral: string }[]
  notesText: readonly string[]
  warnings: readonly string[]
}

const INTERVAL_NAMES = [
  'unison',
  'minor second',
  'major second',
  'minor third',
  'major third',
  'perfect fourth',
  'tritone',
  'perfect fifth',
  'minor sixth',
  'major sixth',
  'minor seventh',
  'major seventh'
]

/**
 * Build a chord from its interval pattern, with its inversions and the keys it belongs to.
 *
 * The keys it functions in are computed rather than tabulated: a G major triad is V in C, I in G and IV in D, and a
 * Page that shows only one of those has hidden most of what the chord does.
 */
export function chord(input: { root: string; quality?: ChordQuality }): ChordReport | CreativeError {
  const quality = input.quality ?? 'major'
  const pattern = CHORD_PATTERNS[quality]
  if (!pattern) return fail('invalid-argument', `"${quality}" is not a chord this knows: ${CHORD_QUALITIES.join(', ')}.`)
  const root = parseNote(input.root)
  if (isCreativeError(root)) return root

  const signature = CIRCLE_OF_FIFTHS[root.pitchClass] ?? 0
  const names = signature < 0 || /b/.test(input.root) ? FLAT_NAMES : SHARP_NAMES

  const chordNotes = pattern.intervals.map((semitones) => ({
    name: names[(root.pitchClass + semitones) % 12],
    midi: root.midi + semitones,
    intervalName: INTERVAL_NAMES[semitones % 12] + (semitones >= 12 ? ' (an octave up)' : ''),
    semitones
  }))

  const ordinals = ['root position', 'first inversion', 'second inversion', 'third inversion', 'fourth inversion']
  const inversions = pattern.intervals.map((_, i) => {
    const order = [...chordNotes.slice(i), ...chordNotes.slice(0, i)]
    return { name: ordinals[i] ?? `inversion ${i}`, notes: Object.freeze(order.map((one) => one.name)), bass: order[0].name }
  })

  // Which major keys contain this chord, and as what.
  const functionsIn: ChordReport['functionsIn'][number][] = []
  const numerals = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
  const majorPattern = SCALE_PATTERNS.major.intervals
  for (let keyClass = 0; keyClass < 12; keyClass += 1) {
    for (let degree = 0; degree < 7; degree += 1) {
      const degreeRoot = (keyClass + majorPattern[degree]) % 12
      if (degreeRoot !== root.pitchClass) continue
      const triad = [0, 2, 4].map((step) => (keyClass + majorPattern[(degree + step) % 7]) % 12)
      const chordClasses = pattern.intervals.slice(0, 3).map((one) => (root.pitchClass + one) % 12)
      if (chordClasses.every((one) => triad.includes(one)) && triad.every((one) => chordClasses.includes(one))) {
        functionsIn.push({ key: `${SHARP_NAMES[keyClass]} major`, numeral: numerals[degree] })
      }
    }
  }

  const warnings: string[] = []
  if (quality === 'diminished-7' || quality === 'augmented') {
    warnings.push(
      `A ${quality.replace('-', ' ')} chord is symmetrical, so the same set of notes has several roots. Which note is the root is a matter of what the music does next, not of the notes themselves.`
    )
  }
  if (functionsIn.length === 0) {
    warnings.push('This chord does not appear as a plain triad in any major key, so no numeral is given. That is true of most sevenths and every altered chord.')
  }

  return {
    root: root.name,
    quality,
    symbol: `${root.name.replace(/\d+$/, '')}${pattern.symbol}`,
    notes: Object.freeze(chordNotes),
    inversions: Object.freeze(inversions),
    describe: pattern.describe,
    functionsIn: Object.freeze(functionsIn),
    notesText: Object.freeze([
      `${root.name.replace(/\d+$/, '')}${pattern.symbol}: ${chordNotes.map((one) => one.name).join(' ')}.`,
      pattern.describe,
      functionsIn.length === 0
        ? 'This chord is not a plain triad of any major key.'
        : `It is ${functionsIn.map((one) => `${one.numeral} in ${one.key}`).join(', ')} — the same chord does different work in each.`,
      'The inversions are the same notes in a different order. Which is in the bass changes the harmony’s function, not its name.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface TempoReport {
  /** Beats per minute. */
  tempo: number
  /** Milliseconds per beat. */
  beatMs: number
  /** Milliseconds for each common note value. */
  noteValues: readonly { value: string; milliseconds: number; hertz: number }[]
  /** Milliseconds for the dotted and triplet versions, which is what delay times are set from. */
  dotted: readonly { value: string; milliseconds: number }[]
  triplets: readonly { value: string; milliseconds: number }[]
  /** How long a given number of bars lasts. */
  barSeconds: number
  timeSignature: string
  notesText: readonly string[]
}

/**
 * Tempo in milliseconds per note value, including the dotted and triplet figures.
 *
 * These are the numbers a delay or a sequencer is actually set from. A dotted eighth delay at 120 bpm is 375 ms, and
 * it is the setting behind a great deal of recognisable guitar sound — the arithmetic is trivial and getting it
 * wrong is audible immediately.
 */
export function tempo(input: {
  /** Beats per minute. */
  beatsPerMinute: number
  /** Beats per bar. */
  beatsPerBar?: number
  /** Which note value gets the beat: 4 for a quarter note. */
  beatUnit?: number
}): TempoReport | CreativeError {
  const { beatsPerMinute } = input
  if (!finite(beatsPerMinute) || beatsPerMinute <= 0) return fail('invalid-argument', 'The tempo has to be greater than zero beats per minute.')
  if (beatsPerMinute > 1000) return fail('out-of-range', 'Above about 1000 bpm the beat is no longer a beat — it is a pitch.')
  const beatsPerBar = input.beatsPerBar ?? 4
  const beatUnit = input.beatUnit ?? 4
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) return fail('invalid-argument', 'The beats per bar has to be a whole number of at least 1.')
  if (![1, 2, 4, 8, 16, 32].includes(beatUnit)) return fail('invalid-argument', 'The beat unit is 1, 2, 4, 8, 16 or 32.')

  const beatMs = 60000 / beatsPerMinute
  // A beat is the beat unit, so a whole note is beatUnit beats long.
  const wholeMs = beatMs * beatUnit
  const values: readonly { value: string; divisor: number }[] = [
    { value: 'whole', divisor: 1 },
    { value: 'half', divisor: 2 },
    { value: 'quarter', divisor: 4 },
    { value: 'eighth', divisor: 8 },
    { value: 'sixteenth', divisor: 16 },
    { value: 'thirty-second', divisor: 32 }
  ]

  return {
    tempo: beatsPerMinute,
    beatMs,
    noteValues: Object.freeze(
      values.map((one) => ({
        value: one.value,
        milliseconds: wholeMs / one.divisor,
        hertz: 1000 / (wholeMs / one.divisor)
      }))
    ),
    dotted: Object.freeze(values.map((one) => ({ value: `dotted ${one.value}`, milliseconds: (wholeMs / one.divisor) * 1.5 }))),
    triplets: Object.freeze(values.map((one) => ({ value: `${one.value} triplet`, milliseconds: (wholeMs / one.divisor) / 1.5 }))),
    barSeconds: (beatMs * beatsPerBar) / 1000,
    timeSignature: `${beatsPerBar}/${beatUnit}`,
    notesText: Object.freeze([
      `At ${beatsPerMinute} bpm a beat is ${beatMs.toFixed(2)} ms, and a ${beatsPerBar}/${beatUnit} bar is ${((beatMs * beatsPerBar) / 1000).toFixed(3)} s.`,
      'A dotted note is one and a half times its plain value; a triplet is two thirds. Those are the figures a delay is set from.',
      'The beat unit decides what a beat is. In 6/8 the beat is usually a dotted quarter rather than the eighth the signature names, which no arithmetic can tell you — it is a matter of how the music is felt.'
    ])
  }
}

// ---------------------------------------------------------------- colour

export interface Colour {
  red: number
  green: number
  blue: number
}

const clamp255 = (value: number): number => Math.max(0, Math.min(255, value))

export function parseColour(text: string): Colour | CreativeError {
  if (typeof text !== 'string') return fail('invalid-argument', 'A colour has to be text.')
  const trimmed = text.trim()
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed)
  if (hex !== null) {
    const digits = hex[1]
    const full = digits.length === 3 ? digits.split('').map((one) => one + one).join('') : digits
    return {
      red: Number.parseInt(full.slice(0, 2), 16),
      green: Number.parseInt(full.slice(2, 4), 16),
      blue: Number.parseInt(full.slice(4, 6), 16)
    }
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(trimmed)
  if (rgb !== null) {
    return { red: clamp255(Number(rgb[1])), green: clamp255(Number(rgb[2])), blue: clamp255(Number(rgb[3])) }
  }
  return fail('unknown-name', `"${text}" is not a colour this reads. It takes hex like #3366cc or #36c, and rgb(51, 102, 204).`)
}

/** The relative luminance of a colour, exactly as WCAG 2.1 defines it. */
export function relativeLuminance(colour: Colour): number {
  const channel = (value: number): number => {
    const s = value / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(colour.red) + 0.7152 * channel(colour.green) + 0.0722 * channel(colour.blue)
}

export interface ContrastReport {
  foreground: string
  background: string
  /** WCAG 2.1 contrast ratio, from 1 to 21. */
  ratio: number
  /** Which WCAG thresholds this passes. */
  passes: readonly { level: string; requirement: number; forText: string; passed: boolean }[]
  /** The APCA lightness contrast, which was designed to fix WCAG's known biases. */
  apcaLc: number
  /** Whether APCA and WCAG disagree about this pair, which happens and is worth knowing. */
  standardsDisagree: boolean
  luminance: { foreground: number; background: number }
  notesText: readonly string[]
  warnings: readonly string[]
}

/**
 * Colour contrast by both the standard that is enforced and the one that is more accurate.
 *
 * WCAG 2.1 is what accessibility is legally judged against and it has defined thresholds, so it is the number that
 * matters in practice. It also has known biases — it under-rates dark text on light backgrounds and over-rates some
 * mid-tone pairs — and APCA was built to correct them. Where the two disagree, that is reported, because a pair that
 * passes WCAG and fails APCA is genuinely harder to read than the ratio suggests.
 */
export function contrast(input: {
  foreground: string
  background: string
  /** Point size, for the WCAG large-text threshold. */
  fontSize?: number
  bold?: boolean
}): ContrastReport | CreativeError {
  const foreground = parseColour(input.foreground)
  if (isCreativeError(foreground)) return foreground
  const background = parseColour(input.background)
  if (isCreativeError(background)) return background

  const lf = relativeLuminance(foreground)
  const lb = relativeLuminance(background)
  const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)

  const size = input.fontSize ?? 16
  const isLarge = size >= 18 || (input.bold === true && size >= 14)
  const passes = [
    { level: 'AA', requirement: isLarge ? 3 : 4.5, forText: isLarge ? 'large text (18pt, or 14pt bold)' : 'body text', passed: ratio >= (isLarge ? 3 : 4.5) },
    { level: 'AAA', requirement: isLarge ? 4.5 : 7, forText: isLarge ? 'large text' : 'body text', passed: ratio >= (isLarge ? 4.5 : 7) },
    { level: 'AA (non-text)', requirement: 3, forText: 'icons, borders and focus indicators', passed: ratio >= 3 }
  ]

  // APCA, in the form that matches the published algorithm closely enough to flag disagreement.
  const toY = (colour: Colour): number =>
    0.2126729 * Math.pow(colour.red / 255, 2.4) + 0.7151522 * Math.pow(colour.green / 255, 2.4) + 0.072175 * Math.pow(colour.blue / 255, 2.4)
  const yText = toY(foreground)
  const yBackground = toY(background)
  let apca: number
  if (yBackground > yText) {
    // Dark text on a light background.
    apca = (Math.pow(yBackground, 0.56) - Math.pow(yText, 0.57)) * 1.14 * 100
    apca = apca < 7.5 ? 0 : apca - 2.7
  } else {
    apca = (Math.pow(yBackground, 0.65) - Math.pow(yText, 0.62)) * 1.14 * 100
    apca = apca > -7.5 ? 0 : apca + 2.7
  }

  // APCA's rough equivalent of the AA body-text threshold is an absolute Lc of 60.
  const wcagPasses = ratio >= (isLarge ? 3 : 4.5)
  const apcaPasses = Math.abs(apca) >= (isLarge ? 45 : 60)
  const disagree = wcagPasses !== apcaPasses

  const warnings: string[] = []
  if (disagree) {
    warnings.push(
      `WCAG ${wcagPasses ? 'passes' : 'fails'} this pair and APCA ${apcaPasses ? 'passes' : 'fails'} it. WCAG is what gets audited; APCA is the more accurate model. A pair that passes one and fails the other is worth looking at rather than shipping on the favourable number.`
    )
  }
  if (ratio < 3) {
    warnings.push(`A ratio of ${ratio.toFixed(2)} fails every WCAG threshold, including the one for icons and borders.`)
  }

  return {
    foreground: input.foreground,
    background: input.background,
    ratio,
    passes: Object.freeze(passes),
    apcaLc: apca,
    standardsDisagree: disagree,
    luminance: { foreground: lf, background: lb },
    notesText: Object.freeze([
      `Contrast ratio ${ratio.toFixed(2)}:1. ${isLarge ? 'Large' : 'Body'} text needs ${isLarge ? 3 : 4.5} for AA and ${isLarge ? 4.5 : 7} for AAA.`,
      `APCA lightness contrast is ${apca.toFixed(1)}. It is signed: negative means light text on a dark background, which the ratio cannot express at all.`,
      'The WCAG ratio is what accessibility is judged against, and it is symmetrical — it cannot tell dark-on-light from light-on-dark, though those read very differently.',
      'Neither number is legibility. Font, weight, spacing and the reader all matter, and a passing ratio in a thin light typeface is still hard to read.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export type Harmony = 'complementary' | 'analogous' | 'triadic' | 'tetradic' | 'split-complementary' | 'monochromatic'

export const HARMONIES: readonly Harmony[] = Object.freeze([
  'complementary',
  'analogous',
  'triadic',
  'tetradic',
  'split-complementary',
  'monochromatic'
])

export interface PaletteReport {
  harmony: Harmony
  base: string
  colours: readonly { hex: string; hue: number; saturation: number; lightness: number; role: string; contrastWithBase: number }[]
  describe: string
  notesText: readonly string[]
  warnings: readonly string[]
}

const toHsl = (colour: Colour): { hue: number; saturation: number; lightness: number } => {
  const r = colour.red / 255
  const g = colour.green / 255
  const b = colour.blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return { hue: 0, saturation: 0, lightness }
  const d = max - min
  const saturation = lightness > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hue: number
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) hue = ((b - r) / d + 2) / 6
  else hue = ((r - g) / d + 4) / 6
  return { hue: hue * 360, saturation, lightness }
}

const fromHsl = (hue: number, saturation: number, lightness: number): Colour => {
  const h = (((hue % 360) + 360) % 360) / 360
  const s = Math.max(0, Math.min(1, saturation))
  const l = Math.max(0, Math.min(1, lightness))
  if (s === 0) {
    const value = Math.round(l * 255)
    return { red: value, green: value, blue: value }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return {
    red: Math.round(channel(h + 1 / 3) * 255),
    green: Math.round(channel(h) * 255),
    blue: Math.round(channel(h - 1 / 3) * 255)
  }
}

const toHex = (colour: Colour): string =>
  `#${[colour.red, colour.green, colour.blue].map((one) => clamp255(Math.round(one)).toString(16).padStart(2, '0')).join('')}`

/**
 * A palette from a colour-wheel relationship, with the contrast between every colour and the base.
 *
 * The contrast figures are the point. A triadic palette generated by rotating the hue looks balanced and can have
 * two colours a percent apart in luminance — which means text in one on a background of the other is unreadable,
 * and nothing about the hue relationship tells you that.
 *
 * These relationships come from the RGB colour wheel, which is a convention rather than a fact about perception.
 * Rotating hue by 180 degrees gives a mathematically opposite colour and not necessarily one that looks opposite.
 */
export function palette(input: { base: string; harmony?: Harmony; steps?: number }): PaletteReport | CreativeError {
  const harmony = input.harmony ?? 'complementary'
  if (!HARMONIES.includes(harmony)) return fail('invalid-argument', `"${harmony}" is not one of: ${HARMONIES.join(', ')}.`)
  const base = parseColour(input.base)
  if (isCreativeError(base)) return base
  const { hue, saturation, lightness } = toHsl(base)
  const steps = Math.round(input.steps ?? 5)
  if (!Number.isInteger(steps) || steps < 2 || steps > CREATIVE_LIMITS.levels) {
    return fail('invalid-argument', `The step count has to be between 2 and ${CREATIVE_LIMITS.levels}.`)
  }

  const built: { hue: number; saturation: number; lightness: number; role: string }[] = []
  switch (harmony) {
    case 'complementary':
      built.push({ hue, saturation, lightness, role: 'base' }, { hue: hue + 180, saturation, lightness, role: 'complement' })
      break
    case 'analogous':
      built.push(
        { hue: hue - 30, saturation, lightness, role: 'left neighbour' },
        { hue, saturation, lightness, role: 'base' },
        { hue: hue + 30, saturation, lightness, role: 'right neighbour' }
      )
      break
    case 'triadic':
      built.push(
        { hue, saturation, lightness, role: 'base' },
        { hue: hue + 120, saturation, lightness, role: 'second' },
        { hue: hue + 240, saturation, lightness, role: 'third' }
      )
      break
    case 'tetradic':
      built.push(
        { hue, saturation, lightness, role: 'base' },
        { hue: hue + 90, saturation, lightness, role: 'second' },
        { hue: hue + 180, saturation, lightness, role: 'complement' },
        { hue: hue + 270, saturation, lightness, role: 'fourth' }
      )
      break
    case 'split-complementary':
      built.push(
        { hue, saturation, lightness, role: 'base' },
        { hue: hue + 150, saturation, lightness, role: 'split one' },
        { hue: hue + 210, saturation, lightness, role: 'split two' }
      )
      break
    default:
      for (let i = 0; i < steps; i += 1) {
        const level = 0.1 + (0.8 * i) / (steps - 1)
        built.push({ hue, saturation, lightness: level, role: `lightness ${Math.round(level * 100)}%` })
      }
      break
  }

  const baseLuminance = relativeLuminance(base)
  const colours = built.map((one) => {
    const colour = fromHsl(one.hue, one.saturation, one.lightness)
    const luminance = relativeLuminance(colour)
    return {
      hex: toHex(colour),
      hue: ((one.hue % 360) + 360) % 360,
      saturation: one.saturation,
      lightness: one.lightness,
      role: one.role,
      contrastWithBase: (Math.max(luminance, baseLuminance) + 0.05) / (Math.min(luminance, baseLuminance) + 0.05)
    }
  })

  const warnings: string[] = []
  const tooClose = colours.filter((one) => one.role !== 'base' && one.contrastWithBase < 1.5)
  if (tooClose.length > 0) {
    warnings.push(
      `${tooClose.map((one) => one.hex).join(', ')} ${tooClose.length === 1 ? 'is' : 'are'} within a contrast ratio of 1.5 of the base. The hues are far apart and the luminance is not, so text in one on the other would be unreadable — which is the failure mode of every palette generated by rotating hue.`
    )
  }

  const describes: Readonly<Record<Harmony, string>> = {
    complementary: 'Opposite hues. Maximum hue separation, and no guarantee of luminance separation.',
    analogous: 'Neighbouring hues. Harmonious and low contrast, so it needs lightness variation to be usable.',
    triadic: 'Three hues evenly spaced. Balanced, and hard to use without one dominating.',
    tetradic: 'Four hues in two complementary pairs. A lot of colour to control.',
    'split-complementary': 'The complement split in two. The contrast of complementary with less tension.',
    monochromatic: 'One hue at different lightnesses. The only one of these that guarantees usable contrast.'
  }

  return {
    harmony,
    base: toHex(base),
    colours: Object.freeze(colours),
    describe: describes[harmony],
    notesText: Object.freeze([
      `${harmony.replace('-', ' ')} from ${toHex(base)}: ${colours.map((one) => one.hex).join(' ')}.`,
      describes[harmony],
      'The contrast with the base is given for every colour, because a hue relationship says nothing about whether two colours can be used together for text.',
      'These relationships come from the RGB colour wheel, which is a convention rather than a fact about perception — a hue rotated 180 degrees is mathematically opposite and not necessarily opposite to the eye.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface ScaleStepsReport {
  /** Each step, from the base outward. */
  steps: readonly { step: number; value: number; rounded: number; label: string }[]
  ratio: number
  ratioName: string
  base: number
  notesText: readonly string[]
  warnings: readonly string[]
}

export const SCALE_RATIOS: Readonly<Record<string, { ratio: number; describe: string }>> = Object.freeze({
  'minor-second': { ratio: 1.067, describe: 'Very tight. Barely distinguishable steps; suits dense interfaces.' },
  'major-second': { ratio: 1.125, describe: 'Tight and practical for interface text.' },
  'minor-third': { ratio: 1.2, describe: 'A common web default. Clear steps without dramatic jumps.' },
  'major-third': { ratio: 1.25, describe: 'Noticeably stepped. Good for editorial layouts.' },
  'perfect-fourth': { ratio: 1.333, describe: 'Strong hierarchy. Large sizes arrive quickly.' },
  'perfect-fifth': { ratio: 1.5, describe: 'Dramatic. Three steps up from 16px is 54px.' },
  'golden-ratio': { ratio: 1.618, describe: 'Very dramatic, and no better founded than any other ratio despite what is often claimed about it.' }
})

/**
 * A modular scale for type sizes or spacing.
 *
 * The ratio names are borrowed from musical intervals, which is a metaphor and not a claim: there is no evidence
 * that a perfect-fifth type scale is harmonious in the way a perfect fifth is consonant. The golden ratio in
 * particular carries a great deal of unfounded lore, and it is offered here as one ratio among several.
 */
export function modularScale(input: {
  base: number
  /** A named ratio, or a number. */
  ratio?: string | number
  /** How many steps above the base. */
  up?: number
  /** How many below. */
  down?: number
  /** Round to whole pixels, which is what a browser does anyway. */
  round?: boolean
}): ScaleStepsReport | CreativeError {
  const { base } = input
  if (!finite(base) || base <= 0) return fail('invalid-argument', 'The base size has to be greater than zero.')
  let ratio: number
  let ratioName: string
  if (typeof input.ratio === 'number') {
    ratio = input.ratio
    ratioName = `custom ${input.ratio}`
  } else {
    const key = input.ratio ?? 'minor-third'
    const named = Object.prototype.hasOwnProperty.call(SCALE_RATIOS, key) ? SCALE_RATIOS[key] : undefined
    if (!named) return fail('invalid-argument', `"${key}" is not a ratio this knows: ${Object.keys(SCALE_RATIOS).join(', ')}.`)
    ratio = named.ratio
    ratioName = key
  }
  if (!finite(ratio) || ratio <= 1) return fail('invalid-argument', 'The ratio has to be greater than 1, or the scale would shrink upward.')

  const up = Math.round(input.up ?? 5)
  const down = Math.round(input.down ?? 2)
  if (!Number.isInteger(up) || up < 0 || !Number.isInteger(down) || down < 0) {
    return fail('invalid-argument', 'The step counts have to be whole numbers of zero or more.')
  }
  if (up + down + 1 > CREATIVE_LIMITS.steps) return fail('too-many', `That is more than the ${CREATIVE_LIMITS.steps} steps this builds.`)

  const steps: ScaleStepsReport['steps'][number][] = []
  for (let i = -down; i <= up; i += 1) {
    const value = base * Math.pow(ratio, i)
    steps.push({
      step: i,
      value,
      rounded: Math.round(value),
      label: i === 0 ? 'base' : i > 0 ? `+${i}` : `${i}`
    })
  }

  const warnings: string[] = []
  const collisions = steps.filter((one, i) => i > 0 && one.rounded === steps[i - 1].rounded)
  if (collisions.length > 0 && input.round !== false) {
    warnings.push(
      `${collisions.length} step${collisions.length === 1 ? '' : 's'} round to the same whole pixel as the one below. A tighter ratio than ${ratio} does not produce distinguishable sizes at this base.`
    )
  }

  return {
    steps: Object.freeze(steps),
    ratio,
    ratioName,
    base,
    notesText: Object.freeze([
      `${ratioName} (${ratio}) from a base of ${base}: ${steps.map((one) => (input.round === false ? one.value.toFixed(2) : one.rounded)).join(', ')}.`,
      typeof input.ratio === 'number' ? 'A custom ratio.' : SCALE_RATIOS[ratioName].describe,
      'The ratio names are borrowed from musical intervals as a metaphor. There is no evidence that a perfect-fifth type scale is harmonious the way a perfect fifth is consonant.',
      'The golden ratio carries a lot of unfounded lore. It is one ratio among several here and nothing more.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const CREATIVE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Scales and chords are built from interval patterns, not looked up, so the spelling follows the key — F major has a B flat and not an A sharp.',
  'Every frequency names its tuning. In equal temperament no interval except the octave is exactly in tune, and the cents difference from just intonation is reported.',
  'A4 at 440 Hz is a twentieth-century agreement rather than a fact about music, and it is an argument here.',
  'The melodic minor differs going up and down, which an interval pattern cannot express. Only the ascending form is available and it says so.',
  'Symmetrical chords have several possible roots, and which is the root depends on the music rather than the notes.',
  'Colour contrast is reported by both WCAG 2.1, which is what gets audited, and APCA, which is more accurate. Where they disagree the result says so.',
  'The WCAG ratio is symmetrical and cannot tell dark-on-light from light-on-dark, though those read very differently. APCA is signed.',
  'Neither contrast number is legibility. Font, weight and spacing matter and are not in the arithmetic.',
  'Colour-wheel harmonies are a convention of the RGB model, not a fact about perception, and every palette reports the contrast between its colours because a hue relationship guarantees nothing about readability.',
  'Modular scale ratios are named after musical intervals as a metaphor. The golden ratio has no special standing here.'
])
