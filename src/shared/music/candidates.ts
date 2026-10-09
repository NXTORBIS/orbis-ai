import { STAGE_LIMITS } from './config.ts'
import { mostLike, similarity, type TrackFeatures } from './features.ts'
import type { Constraints, IntentState } from './intent.ts'
import { affinity, opinionOn, type UserTaste } from './taste.ts'
import type { Candidate, CandidateSource, Known, Strategy } from './ranking.ts'
import { STRATEGY_SIMILARITY } from './ranking.ts'

/**
 * Finding things worth considering, from several directions at once.
 *
 * One source produces one kind of answer, and the kind is always wrong somewhere: pure similarity loops back on
 * itself, pure favourites never discover anything, pure novelty is noise. So each source proposes separately, the
 * proposals are merged, and a track found by several routes is recorded as such -- which is a signal in itself.
 *
 * ## The graph is built from what is there
 *
 * There is no licensed catalogue behind this. The artist and genre relationships come from the person's own library:
 * two artists are related because the same genres, eras and sounds run through their tracks. That is a real
 * relationship, measured from real files, and it is honest about its limits -- it can only ever relate things the
 * person already has something by.
 *
 * ## Nothing is proposed that cannot be played
 *
 * A candidate reaching here is a track the library holds with audio on the computer. "Could be interesting but there
 * is no file" belongs in search results, not in a queue.
 */

export interface Library {
  /** Every track that can actually be played, with what is known about it. */
  features: readonly TrackFeatures[]
  /** Per track: how it has been treated. */
  stats: ReadonlyMap<string, { playCount: number; lastPlayedAt: number | null; favourite: boolean; everCompleted: boolean }>
}

export interface Pool {
  candidates: Candidate[]
  /** How many each source proposed, for the inspector. */
  counts: Partial<Record<CandidateSource, number>>
}

const DAY = 24 * 60 * 60 * 1000

const asCandidate = (features: TrackFeatures, library: Library, source: CandidateSource, retrieval: number, now: number): Candidate => {
  const stats = library.stats.get(features.trackId)
  return {
    trackId: features.trackId,
    features,
    sources: [source],
    retrieval,
    lastPlayedDaysAgo: stats?.lastPlayedAt ? (now - stats.lastPlayedAt) / DAY : null,
    playCount: stats?.playCount ?? 0,
    favourite: stats?.favourite ?? false,
    everCompleted: stats?.everCompleted ?? false
  }
}

/** Everything the person has ever been near, for working out what is new. */
export function knownFrom(library: Library): Known {
  const artists = new Set<string>()
  const genres = new Set<string>()
  const languages = new Set<string>()
  const eras = new Set<number>()
  const playedTrackIds = new Set<string>()
  for (const one of library.features) {
    const stats = library.stats.get(one.trackId)
    if (!stats || stats.playCount === 0) continue
    playedTrackIds.add(one.trackId)
    artists.add(one.artistKey)
    if (one.genre) genres.add(one.genre)
    if (one.language) languages.add(one.language)
    if (one.era !== null) eras.add(one.era)
  }
  return { artists, genres, languages, eras, playedTrackIds }
}

// ---------------------------------------------------------------- the graph, from the library itself

export interface MusicGraph {
  /** Artist to the artists that share genres, eras and a sound with it, strongest first. */
  relatedArtists: ReadonlyMap<string, { artist: string; strength: number }[]>
  /** Genre to the genres that keep appearing alongside it. */
  relatedGenres: ReadonlyMap<string, { genre: string; strength: number }[]>
  /** Artist to its tracks. */
  byArtist: ReadonlyMap<string, TrackFeatures[]>
  byGenre: ReadonlyMap<string, TrackFeatures[]>
  byEra: ReadonlyMap<number, TrackFeatures[]>
}

/**
 * Builds the relationships out of the library.
 *
 * Two artists are related when their tracks share genres, sit in the same era, and sound alike -- each of which is
 * measured from the files. It is recomputed when the library changes rather than on every request: for ten thousand
 * tracks this is the most expensive thing here, and it has no business running while somebody presses next.
 */
export function buildGraph(library: Library): MusicGraph {
  const byArtist = new Map<string, TrackFeatures[]>()
  const byGenre = new Map<string, TrackFeatures[]>()
  const byEra = new Map<number, TrackFeatures[]>()
  for (const one of library.features) {
    const artist = byArtist.get(one.artistKey) ?? []
    artist.push(one)
    byArtist.set(one.artistKey, artist)
    if (one.genre) {
      const genre = byGenre.get(one.genre) ?? []
      genre.push(one)
      byGenre.set(one.genre, genre)
    }
    if (one.era !== null) {
      const era = byEra.get(one.era) ?? []
      era.push(one)
      byEra.set(one.era, era)
    }
  }

  // Genres that keep turning up together, by the artists they share.
  const genreArtists = new Map<string, Set<string>>()
  for (const [genre, tracks] of byGenre) genreArtists.set(genre, new Set(tracks.map((one) => one.artistKey)))
  const relatedGenres = new Map<string, { genre: string; strength: number }[]>()
  for (const [genre, artists] of genreArtists) {
    const out: { genre: string; strength: number }[] = []
    for (const [other, otherArtists] of genreArtists) {
      if (other === genre) continue
      const shared = [...artists].filter((one) => otherArtists.has(one)).length
      if (shared === 0) continue
      out.push({ genre: other, strength: shared / Math.min(artists.size, otherArtists.size) })
    }
    relatedGenres.set(genre, out.sort((a, b) => b.strength - a.strength).slice(0, 8))
  }

  // Artists related by genre, era and sound. One representative track per artist keeps this affordable.
  const representative = new Map<string, TrackFeatures>()
  for (const [artist, tracks] of byArtist) representative.set(artist, tracks[0])
  const relatedArtists = new Map<string, { artist: string; strength: number }[]>()
  const artists = [...byArtist.keys()]
  for (const artist of artists) {
    const mine = byArtist.get(artist)!
    const myGenres = new Set(mine.map((one) => one.genre).filter(Boolean) as string[])
    const myEras = new Set(mine.map((one) => one.era).filter((one) => one !== null) as number[])
    const out: { artist: string; strength: number }[] = []
    for (const other of artists) {
      if (other === artist) continue
      const theirs = byArtist.get(other)!
      const sharedGenre = theirs.some((one) => one.genre && myGenres.has(one.genre)) ? 1 : 0
      const sharedEra = theirs.some((one) => one.era !== null && myEras.has(one.era)) ? 0.5 : 0
      const sound = similarity(representative.get(artist)!, representative.get(other)!, 'sound')
      const alike = sound.score * sound.confidence
      /*
       * A shared genre, or a genuinely similar sound. Never an era on its own.
       *
       * Being released in the same decade is not a relationship: it put a quiet ambient act next to a pop act
       * purely because both were recorded in the 2020s. The era can strengthen a real link and cannot be one.
       */
      if (sharedGenre === 0 && alike < 0.62) continue
      const strength = sharedGenre + sharedEra + alike
      if (strength < 0.6) continue
      out.push({ artist: other, strength })
    }
    relatedArtists.set(artist, out.sort((a, b) => b.strength - a.strength).slice(0, 10))
  }
  return { relatedArtists, relatedGenres, byArtist, byGenre, byEra }
}

// ---------------------------------------------------------------- the sources

export interface GenerateOptions {
  library: Library
  graph: MusicGraph
  taste: UserTaste
  intent: IntentState
  /** What is playing, to find things like it and things that follow it. */
  seed: TrackFeatures | null
  /** What has already been played this sitting, so a source does not propose them again. */
  exclude: ReadonlySet<string>
  strategy: Strategy
  now: number
  /** How many each source may propose. */
  perSource?: number
}

/**
 * Proposals from every direction, merged.
 *
 * The strategy in use leans the mix -- `discovery` asks the unheard and adjacent sources for more, `safe` asks the
 * favourites -- but every source still contributes something, because a mix of weak sources beats one strong source
 * that has nothing new to say.
 */
export function generate(o: GenerateOptions): Pool {
  const perSource = o.perSource ?? STAGE_LIMITS.perSource
  const found = new Map<string, Candidate>()
  const counts: Partial<Record<CandidateSource, number>> = {}

  const offer = (features: TrackFeatures, source: CandidateSource, retrieval: number): void => {
    if (o.exclude.has(features.trackId)) return
    // Whatever is playing is not an answer to "what next". Every source finds it, so it is refused in one place.
    if (o.seed && features.trackId === o.seed.trackId) return
    counts[source] = (counts[source] ?? 0) + 1
    const held = found.get(features.trackId)
    if (held) {
      if (!held.sources.includes(source)) held.sources.push(source)
      // Found twice: the better of the two matches stands, and the extra source is the signal.
      held.retrieval = Math.max(held.retrieval, retrieval)
      return
    }
    found.set(features.trackId, asCandidate(features, o.library, source, retrieval, o.now))
  }

  const stats = (id: string): { playCount: number; lastPlayedAt: number | null; favourite: boolean; everCompleted: boolean } =>
    o.library.stats.get(id) ?? { playCount: 0, lastPlayedAt: null, favourite: false, everCompleted: false }

  const discovery = o.intent.constraints.discovery ?? 0.3
  const wide = o.strategy === 'discovery' || o.strategy === 'experimental' || discovery > 0.5

  // ---- what they have shown they like
  const favourites = o.library.features.filter((one) => stats(one.trackId).favourite)
  for (const one of favourites.slice(0, perSource)) offer(one, 'favourite', 0.9)

  const frequent = [...o.library.features]
    .filter((one) => stats(one.trackId).playCount >= 2)
    .sort((a, b) => stats(b.trackId).playCount - stats(a.trackId).playCount)
    .slice(0, perSource)
  for (const one of frequent) offer(one, 'frequent', 0.7)

  // ---- things like what is playing
  if (o.seed) {
    const kind = STRATEGY_SIMILARITY[o.strategy]
    for (const { features, similarity: match } of mostLike(o.seed, o.library.features, kind, perSource, 0.4)) {
      offer(features, kind === 'sound' ? 'similar-sound' : kind === 'words' ? 'similar-words' : kind === 'artist' ? 'similar-artist' : 'similar-sound', match.score)
    }
    // The same artist and the same album, which is what "more of this" usually means.
    for (const one of (o.graph.byArtist.get(o.seed.artistKey) ?? []).slice(0, 12)) offer(one, 'same-artist', 0.8)
    for (const one of o.library.features.filter((other) => other.albumKey === o.seed!.albumKey).slice(0, 12)) offer(one, 'same-album', 0.6)

    // ---- the graph: artists and genres that sit next to this one
    for (const related of (o.graph.relatedArtists.get(o.seed.artistKey) ?? []).slice(0, wide ? 8 : 4)) {
      for (const one of (o.graph.byArtist.get(related.artist) ?? []).slice(0, 4)) offer(one, 'graph-artist', Math.min(1, related.strength / 2))
    }
    if (o.seed.genre) {
      for (const related of (o.graph.relatedGenres.get(o.seed.genre) ?? []).slice(0, wide ? 6 : 3)) {
        for (const one of (o.graph.byGenre.get(related.genre) ?? []).slice(0, 4)) offer(one, 'graph-genre', related.strength)
      }
    }
  }

  // ---- what the taste model likes, whether or not it has been played
  const liked = o.library.features
    .map((one) => ({ one, score: affinity(o.taste, one, o.now) }))
    .filter((entry) => entry.score.score > 0.2 && entry.score.confidence > 0.1)
    .sort((a, b) => b.score.score * b.score.confidence - a.score.score * a.score.confidence)
    .slice(0, perSource)
  for (const entry of liked) offer(entry.one, 'context', entry.score.score)

  // ---- never heard, which is where discovery comes from in a local library
  const unheard = o.library.features.filter((one) => stats(one.trackId).playCount === 0)
  const unheardWanted = wide ? perSource : Math.max(8, Math.round(perSource * discovery))
  // Ordered by what the taste model makes of them, so "new" does not mean "random".
  const unheardRanked = unheard
    .map((one) => ({ one, score: affinity(o.taste, one, o.now).score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, unheardWanted)
  for (const entry of unheardRanked) offer(entry.one, 'unheard', 0.5 + Math.max(0, entry.score) * 0.4)

  // ---- loved once and not heard for a long time
  const forgotten = o.library.features.filter((one) => {
    const held = stats(one.trackId)
    if (held.playCount < 2 && !held.favourite) return false
    return held.lastPlayedAt !== null && o.now - held.lastPlayedAt > 60 * DAY
  })
  for (const one of forgotten.slice(0, 30)) offer(one, 'forgotten', 0.65)

  // ---- whatever is in the library, so there is always something to play
  if (found.size < 20) {
    for (const one of o.library.features.slice(0, perSource)) offer(one, 'library', 0.2)
  }

  // ---- what the constraints explicitly asked for
  for (const rule of o.intent.constraints.only ?? []) {
    for (const one of o.library.features) {
      const have = rule.dimension === 'artist' ? one.artistKey : rule.dimension === 'genre' ? one.genre : rule.dimension === 'language' ? one.language : rule.dimension === 'era' ? (one.era === null ? null : String(one.era)) : one.albumKey
      if (have && rule.values.some((value) => have.includes(value) || value.includes(have))) offer(one, 'requested', 1)
    }
  }

  return { candidates: [...found.values()].slice(0, STAGE_LIMITS.afterFilter), counts }
}

/** Tracks that satisfy a set of constraints at all, for telling somebody there are not enough. */
export function matching(library: Library, constraints: Constraints, known: Known): TrackFeatures[] {
  return library.features.filter((one) => {
    for (const rule of constraints.exclude ?? []) {
      const have = rule.dimension === 'artist' ? one.artistKey : rule.dimension === 'genre' ? one.genre : rule.dimension === 'language' ? one.language : rule.dimension === 'era' ? (one.era === null ? null : String(one.era)) : one.albumKey
      if (have && rule.values.some((value) => have.includes(value) || value.includes(have))) return false
    }
    for (const rule of constraints.only ?? []) {
      const have = rule.dimension === 'artist' ? one.artistKey : rule.dimension === 'genre' ? one.genre : rule.dimension === 'language' ? one.language : rule.dimension === 'era' ? (one.era === null ? null : String(one.era)) : one.albumKey
      if (!have || !rule.values.some((value) => have.includes(value) || value.includes(have))) return false
    }
    if (constraints.heard === 'only-new' && known.playedTrackIds.has(one.trackId)) return false
    if (constraints.heard === 'only-known' && !known.playedTrackIds.has(one.trackId)) return false
    return true
  })
}

/** What somebody has explored and what they have not, for the discovery screen. */
export function explorationMap(library: Library, taste: UserTaste, now: number): { genres: { name: string; played: number; total: number; opinion: number }[]; languages: { name: string; played: number; total: number }[]; eras: { name: number; played: number; total: number }[] } {
  const genres = new Map<string, { played: number; total: number }>()
  const languages = new Map<string, { played: number; total: number }>()
  const eras = new Map<number, { played: number; total: number }>()
  for (const one of library.features) {
    const played = (library.stats.get(one.trackId)?.playCount ?? 0) > 0 ? 1 : 0
    if (one.genre) {
      const held = genres.get(one.genre) ?? { played: 0, total: 0 }
      genres.set(one.genre, { played: held.played + played, total: held.total + 1 })
    }
    if (one.language) {
      const held = languages.get(one.language) ?? { played: 0, total: 0 }
      languages.set(one.language, { played: held.played + played, total: held.total + 1 })
    }
    if (one.era !== null) {
      const held = eras.get(one.era) ?? { played: 0, total: 0 }
      eras.set(one.era, { played: held.played + played, total: held.total + 1 })
    }
  }
  return {
    genres: [...genres.entries()].map(([name, one]) => ({ name, ...one, opinion: opinionOn(taste, 'genre', name, now).value })).sort((a, b) => b.total - a.total),
    languages: [...languages.entries()].map(([name, one]) => ({ name, ...one })).sort((a, b) => b.total - a.total),
    eras: [...eras.entries()].map(([name, one]) => ({ name, ...one })).sort((a, b) => a.name - b.name)
  }
}
