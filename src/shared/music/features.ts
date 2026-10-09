import type { OrbisTrack } from '../music.ts'
import { plainly } from '../music.ts'

/**
 * What a track is like, as numbers, and how alike two tracks are.
 *
 * ## Only what is actually known
 *
 * A recommender is only as honest as its features. Half of these come from the file's own tags -- the year, the
 * genre, the length -- and the rest come from listening to the audio itself, once, when the track is first read
 * (`src/main/music/analyse.ts` decodes it and measures it). Anything that has not been measured is `null`, not zero:
 * a track with no measured energy must not look like the quietest track in the library.
 *
 * `known` says which dimensions a track actually has, and similarity is worked out over the dimensions two tracks
 * *share*. Comparing a measured track with an unmeasured one over "energy" would be comparing something with nothing.
 *
 * ## Several kinds of alike
 *
 * Two songs can be alike in sound, in words, in who made them, in when they were made, or in what they are for --
 * and those are different questions. So there is not one similarity but several, and what is being asked decides
 * which ones matter. "Something like this but calmer" cares about sound and ignores era; "more by this sort of
 * artist" is the other way round.
 */

/** What can be measured from the audio itself. All in 0..1 unless said otherwise. */
export interface AudioFeatures {
  /** How loud and busy it is. Measured from the signal, not guessed from the genre. */
  energy: number
  /** Beats per minute, measured by looking for a repeating pulse. Null when no steady pulse was found. */
  tempo: number | null
  /** How strong and regular the beat is. A steady pulse with sharp onsets scores high. */
  danceability: number
  /** Bright or dark, from where the energy sits in the spectrum. */
  brightness: number
  /** How much the loudness moves about: a quiet verse and a loud chorus score high. */
  dynamics: number
  /** How much of it is quiet. A piece with long silences is not the same as a wall of sound. */
  sparseness: number
  /** Whether it sounds like a voice is present, from the mid-band and its variation. Not a transcription. */
  vocalness: number
  /** How rough the loudest parts are, which separates an acoustic recording from a compressed one. */
  roughness: number
  /** When it was measured, and with which version of the measuring, so old numbers can be redone. */
  measuredAt: number
  version: number
}

export const FEATURES_VERSION = 1

/** Everything about a track that a recommendation can be made from. */
export interface TrackFeatures {
  trackId: string
  /** Measured from the audio, when it has been. */
  audio: AudioFeatures | null
  /** The decade it belongs to, from the year. Null when the year is not known. */
  era: number | null
  /** Seconds. Always known. */
  duration: number
  genre: string | null
  artistKey: string
  albumKey: string
  /** The language, when it can be told from the tags. Never guessed from the artist's name. */
  language: string | null
  /** Words from the title that carry meaning, for finding songs that are about the same sort of thing. */
  themes: readonly string[]
  /** Which of the above are actually known, so nothing is compared against a blank. */
  known: ReadonlySet<FeatureName>
}

export type FeatureName =
  | 'energy'
  | 'tempo'
  | 'danceability'
  | 'brightness'
  | 'dynamics'
  | 'sparseness'
  | 'vocalness'
  | 'roughness'
  | 'era'
  | 'duration'
  | 'genre'
  | 'artist'
  | 'album'
  | 'language'
  | 'themes'

/** Words that say nothing about what a song is like. Dropped before themes are taken from a title. */
const EMPTY_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'in',
  'on',
  'to',
  'for',
  'with',
  'from',
  'by',
  'at',
  'is',
  'it',
  'this',
  'that',
  'my',
  'your',
  'me',
  'you',
  'i',
  'we',
  'feat',
  'ft',
  'featuring',
  'remix',
  'remastered',
  'version',
  'edit',
  'live',
  'official',
  'video',
  'audio',
  'mix'
])

/** The words of a title that might mean something, for comparing what two songs are about. */
export function themesOf(track: Pick<OrbisTrack, 'title' | 'genre'>): string[] {
  const words = plainly(track.title)
    .split(' ')
    .filter((word) => word.length > 2 && !EMPTY_WORDS.has(word))
  const genre = plainly(track.genre ?? '')
    .split(' ')
    .filter((word) => word.length > 2)
  return [...new Set([...words, ...genre])].slice(0, 12)
}

/** A language from a tag, when a tag says so. Nothing is inferred from a name. */
const LANGUAGE_WORDS: Record<string, string> = {
  tamil: 'tamil',
  hindi: 'hindi',
  telugu: 'telugu',
  malayalam: 'malayalam',
  kannada: 'kannada',
  punjabi: 'punjabi',
  bengali: 'bengali',
  marathi: 'marathi',
  korean: 'korean',
  kpop: 'korean',
  japanese: 'japanese',
  jpop: 'japanese',
  spanish: 'spanish',
  latin: 'spanish',
  french: 'french',
  german: 'german',
  portuguese: 'portuguese',
  arabic: 'arabic',
  turkish: 'turkish',
  english: 'english'
}

/** The language a track's own tags name, or null. */
export function languageOf(track: Pick<OrbisTrack, 'genre' | 'album' | 'title'>): string | null {
  const haystack = plainly([track.genre, track.album].filter(Boolean).join(' '))
  for (const [word, language] of Object.entries(LANGUAGE_WORDS)) {
    if (haystack.split(' ').includes(word)) return language
  }
  return null
}

/** Everything known about a track, gathered from its row and whatever was measured from the audio. */
export function featuresOf(track: OrbisTrack, audio: AudioFeatures | null): TrackFeatures {
  const known = new Set<FeatureName>(['duration', 'artist', 'album', 'themes'])
  if (audio) for (const name of ['energy', 'tempo', 'danceability', 'brightness', 'dynamics', 'sparseness', 'vocalness', 'roughness'] as const) {
    if (name === 'tempo' && audio.tempo === null) continue
    known.add(name)
  }
  const era = track.year && track.year > 1900 ? Math.floor(track.year / 10) * 10 : null
  if (era !== null) known.add('era')
  const genre = (track.genre ?? '').trim() || null
  if (genre) known.add('genre')
  const language = languageOf(track)
  if (language) known.add('language')
  return {
    trackId: track.id,
    audio,
    era,
    duration: track.duration,
    genre: genre ? plainly(genre) : null,
    artistKey: plainly(track.artist) || 'unknown',
    albumKey: plainly(track.album) || 'unknown',
    language,
    themes: themesOf(track),
    known
  }
}

// ---------------------------------------------------------------- how alike two tracks are

/** The kinds of alike that can be asked about, each answered from different dimensions. */
export type SimilarityKind = 'sound' | 'words' | 'artist' | 'era' | 'mood' | 'overall'

export interface Similarity {
  /** 0..1 over the dimensions the two tracks share. */
  score: number
  /** How much of this was actually measured rather than assumed. Low means "do not lean on this". */
  confidence: number
  /** Which dimensions the answer came from, for explaining it. */
  from: readonly FeatureName[]
}

const NOT_ALIKE: Similarity = Object.freeze({ score: 0, confidence: 0, from: [] })

/** How close two numbers are, as 0..1, over a range that makes sense for that dimension. */
const closeness = (a: number, b: number, span: number): number => Math.max(0, 1 - Math.abs(a - b) / span)

const DIMENSIONS: Record<SimilarityKind, readonly { name: FeatureName; weight: number }[]> = {
  sound: [
    { name: 'energy', weight: 1 },
    { name: 'tempo', weight: 0.8 },
    { name: 'danceability', weight: 0.7 },
    { name: 'brightness', weight: 0.6 },
    { name: 'roughness', weight: 0.5 },
    { name: 'sparseness', weight: 0.4 }
  ],
  words: [
    { name: 'themes', weight: 1 },
    { name: 'vocalness', weight: 0.4 },
    { name: 'language', weight: 0.6 }
  ],
  artist: [
    { name: 'artist', weight: 1 },
    { name: 'album', weight: 0.6 },
    { name: 'genre', weight: 0.5 }
  ],
  era: [
    { name: 'era', weight: 1 },
    { name: 'genre', weight: 0.4 },
    { name: 'roughness', weight: 0.3 }
  ],
  mood: [
    { name: 'energy', weight: 1 },
    { name: 'brightness', weight: 0.9 },
    { name: 'dynamics', weight: 0.5 },
    { name: 'sparseness', weight: 0.5 },
    { name: 'themes', weight: 0.4 }
  ],
  overall: [
    { name: 'energy', weight: 0.9 },
    { name: 'tempo', weight: 0.6 },
    { name: 'danceability', weight: 0.5 },
    { name: 'brightness', weight: 0.5 },
    { name: 'genre', weight: 0.8 },
    { name: 'artist', weight: 0.7 },
    { name: 'era', weight: 0.4 },
    { name: 'themes', weight: 0.5 },
    { name: 'language', weight: 0.4 },
    { name: 'duration', weight: 0.2 }
  ]
}

/** How alike one dimension is between two tracks, or null when one of them does not have it. */
function dimension(name: FeatureName, a: TrackFeatures, b: TrackFeatures): number | null {
  if (!a.known.has(name) || !b.known.has(name)) return null
  switch (name) {
    case 'energy':
      return closeness(a.audio!.energy, b.audio!.energy, 1)
    case 'tempo': {
      /*
       * A tempo and exactly double it are the same groove counted differently -- and only exactly.
       *
       * Allowing sixty beats of slack on the doubled comparison made almost any pair "the same groove": sixty-two
       * against a hundred and twenty came out at 0.93, because a hundred and twenty-four is near a hundred and
       * twenty. That one number then related a quiet ambient act to a pop act in the artist graph. The ratio has to
       * be within a few per cent of two, or the tempos are simply compared.
       */
      const slow = Math.min(a.audio!.tempo!, b.audio!.tempo!)
      const fast = Math.max(a.audio!.tempo!, b.audio!.tempo!)
      const ratio = fast / slow
      if (Math.abs(ratio - 2) < 0.04) return 0.9
      return closeness(slow, fast, 60)
    }
    case 'danceability':
      return closeness(a.audio!.danceability, b.audio!.danceability, 1)
    case 'brightness':
      return closeness(a.audio!.brightness, b.audio!.brightness, 1)
    case 'dynamics':
      return closeness(a.audio!.dynamics, b.audio!.dynamics, 1)
    case 'sparseness':
      return closeness(a.audio!.sparseness, b.audio!.sparseness, 1)
    case 'vocalness':
      return closeness(a.audio!.vocalness, b.audio!.vocalness, 1)
    case 'roughness':
      return closeness(a.audio!.roughness, b.audio!.roughness, 1)
    case 'era':
      return closeness(a.era!, b.era!, 30)
    case 'duration':
      return closeness(a.duration, b.duration, 240)
    case 'genre':
      return a.genre === b.genre ? 1 : a.genre!.split(' ').some((word) => b.genre!.split(' ').includes(word)) ? 0.6 : 0
    case 'artist':
      return a.artistKey === b.artistKey ? 1 : 0
    case 'album':
      return a.albumKey === b.albumKey ? 1 : 0
    case 'language':
      return a.language === b.language ? 1 : 0
    case 'themes': {
      if (a.themes.length === 0 || b.themes.length === 0) return null
      const shared = a.themes.filter((one) => b.themes.includes(one)).length
      return shared / Math.min(a.themes.length, b.themes.length)
    }
  }
}

/**
 * How alike two tracks are, in one of the ways they can be alike.
 *
 * Worked out only over the dimensions both tracks have, and `confidence` says how much of the asked-for weight that
 * covered. A pair where only the genre is known comes back with a score and a low confidence, which is the honest
 * answer -- not a confident score built from one field.
 */
export function similarity(a: TrackFeatures, b: TrackFeatures, kind: SimilarityKind = 'overall'): Similarity {
  if (a.trackId === b.trackId) return { score: 1, confidence: 1, from: [] }
  const wanted = DIMENSIONS[kind]
  let total = 0
  let weight = 0
  let askedFor = 0
  const from: FeatureName[] = []
  for (const one of wanted) {
    askedFor += one.weight
    const value = dimension(one.name, a, b)
    if (value === null) continue
    total += value * one.weight
    weight += one.weight
    from.push(one.name)
  }
  if (weight === 0) return NOT_ALIKE
  return { score: total / weight, confidence: weight / askedFor, from }
}

/** The tracks most like this one, best first. Nothing below `floor` is offered. */
export function mostLike(one: TrackFeatures, pool: readonly TrackFeatures[], kind: SimilarityKind = 'overall', limit = 25, floor = 0.45): { features: TrackFeatures; similarity: Similarity }[] {
  return pool
    .filter((other) => other.trackId !== one.trackId)
    .map((other) => ({ features: other, similarity: similarity(one, other, kind) }))
    // A confident middling match beats an unconfident perfect one, so confidence is part of the ordering.
    .filter((other) => other.similarity.score >= floor && other.similarity.confidence >= 0.25)
    .sort((x, y) => y.similarity.score * y.similarity.confidence - x.similarity.score * x.similarity.confidence)
    .slice(0, limit)
}

// ---------------------------------------------------------------- the joins between tracks

export interface Transition {
  /** 0..1: how well one track leads into another. */
  score: number
  /** What made it good or bad, in words, for explaining a choice. */
  why: readonly string[]
}

/**
 * How well track A leads into track B.
 *
 * Not the same question as "are they alike": two nearly identical tracks join perfectly and make a dull sequence,
 * and a quiet piece into a loud one is a bad join however well they match on paper. What matters is tempo, loudness
 * and brightness not jumping, with a small allowance for a deliberate lift.
 *
 * With nothing measured for either track, the answer is the middle with nothing claimed about it -- not a confident
 * zero, which would make the sequencer avoid every unmeasured track.
 */
export function transitionScore(a: TrackFeatures, b: TrackFeatures): Transition {
  if (!a.audio || !b.audio) return { score: 0.5, why: ['nothing measured for one of these yet'] }
  const why: string[] = []
  let score = 1

  const energyJump = b.audio.energy - a.audio.energy
  if (Math.abs(energyJump) > 0.45) {
    score -= 0.35
    why.push(energyJump > 0 ? 'a big jump up in energy' : 'a big drop in energy')
  } else if (Math.abs(energyJump) < 0.15) {
    why.push('the energy carries over')
  } else {
    why.push(energyJump > 0 ? 'a lift in energy' : 'an easing off')
  }

  if (a.audio.tempo !== null && b.audio.tempo !== null) {
    const ratio = b.audio.tempo / a.audio.tempo
    /*
     * Exactly half or exactly double is the same pulse counted differently, and that joins fine.
     *
     * The tolerance is tight on purpose. At a twelve per cent allowance, ninety into a hundred and seventy-five
     * counted as "the same tempo" -- which it plainly is not, and a sequencer that believes it will put a sprint
     * straight after a walk and call the join good.
     */
    const halfOrDouble = Math.abs(ratio - 2) < 0.04 || Math.abs(ratio - 0.5) < 0.02
    const gap = Math.abs(b.audio.tempo - a.audio.tempo)
    if (gap < 8 || halfOrDouble) why.push('the tempo matches')
    else if (gap > 40) {
      score -= 0.3
      why.push('the tempo changes sharply')
    } else {
      score -= 0.1
      why.push('the tempo shifts')
    }
  }

  const brightnessJump = Math.abs(b.audio.brightness - a.audio.brightness)
  if (brightnessJump > 0.5) {
    score -= 0.15
    why.push('a very different tone')
  }

  // Something quiet and spacious straight into something dense is the join people actually notice.
  if (a.audio.sparseness > 0.6 && b.audio.sparseness < 0.25) {
    score -= 0.12
    why.push('from something spacious into something dense')
  }

  if (a.artistKey === b.artistKey) {
    score += 0.05
    why.push('the same artist')
  }
  return { score: Math.max(0, Math.min(1, score)), why }
}
