import type { OrbisTrack, TrackNames } from '../../shared/music.ts'
import { canonicalTrack, compare, duplicateOf, versionLabel, versionOf, type Comparison } from '../../shared/music/identity.ts'
import { explainEmpty, providersFor, searchAcross, type LocalTrackRow, type MusicProvider } from '../../shared/music/provider.ts'
import { arrange, parseSearch, queryFor, type ArrangedSearch, type SearchRow } from '../../shared/music/search.ts'

/**
 * Searching, and knowing whether something is already here.
 *
 * This is the layer between Orbis Music's library and the pure platform modules. Its job is to turn library rows
 * into the shape the providers and the search code expect, and to turn what comes back into something a surface
 * can draw -- including, crucially, the case where there was nowhere to look.
 *
 * ## The one claim it will not make
 *
 * Orbis has no music catalogue, and this layer says so. A search for a song nobody owns returns "there is nowhere
 * to search yet" with the reason, never an empty list. An empty list is a lie: it says Orbis looked and found
 * nothing, when what happened is that there was nothing to look in.
 *
 * Everything here reads the library; nothing writes it. Adding is still the library's own job, so there is one
 * place a track can enter.
 */

export interface PlatformDeps {
  /** Every track in this profile's library. */
  tracks(): Promise<readonly OrbisTrack[]>
}

/** A library row in the shape the local provider understands. */
function asLocalRow(one: OrbisTrack): LocalTrackRow {
  return {
    id: one.id,
    title: one.title,
    artist: one.artist,
    album: one.album ?? null,
    duration: one.duration > 0 ? one.duration : null,
    year: typeof one.year === 'number' ? one.year : null,
    genre: one.genre ?? null,
    language: null,
    path: one.file ?? '',
    artwork: one.artwork ?? null,
    // Playable means there is a file Orbis has read. Anything else is a row that cannot be played, and says so.
    present: Boolean(one.file)
  }
}

export class MusicPlatform {
  private readonly o: PlatformDeps
  private readonly providers: MusicProvider[]

  constructor(o: PlatformDeps) {
    this.o = o
    this.providers = providersFor({ all: async () => (await o.tracks()).map(asLocalRow) })
  }

  /** Which providers there are, and which of them can be asked anything. Shown in Music Settings. */
  async sources(): Promise<{ id: string; name: string; kind: string; ready: boolean; why: string }[]> {
    const out: { id: string; name: string; kind: string; ready: boolean; why: string }[] = []
    for (const provider of this.providers) {
      const ready = await Promise.resolve(provider.ready()).catch(() => false)
      out.push({ id: provider.id, name: provider.name, kind: provider.kind, ready, why: ready ? '' : provider.why() })
    }
    return out
  }

  /**
   * A search, read the way it was asked.
   *
   * A name is looked up; a description becomes constraints. Both go to every provider that is ready, and what each
   * one could not do is reported rather than swallowed.
   */
  async search(said: string, options: { limit?: number } = {}): Promise<ArrangedSearch & { parsed: ReturnType<typeof parseSearch> }> {
    const parsed = parseSearch(said)
    const held = await this.o.tracks()
    const result = await searchAcross(this.providers, queryFor(parsed, options.limit ?? 60))

    const byId = new Map(held.map((one) => [one.id, one]))
    const rows: SearchRow[] = result.tracks.map((one) => {
      // A row that came from the local provider *is* a library row, so its own state is known exactly.
      const mine = one.from === 'local' ? byId.get(one.canonical.sources.find((x) => x.provider === 'local')?.id ?? '') : undefined
      const match = mine ? null : duplicateOf({ title: one.canonical.title, artist: one.canonical.artist, album: one.canonical.album, duration: one.canonical.duration, isrc: one.canonical.isrc }, held)
      const inLibrary = Boolean(mine) || match?.comparison.verdict === 'exact-duplicate'
      const library = mine ?? (match?.comparison.verdict === 'exact-duplicate' ? match.track : null)
      return {
        canonical: one.canonical,
        from: one.from,
        playable: one.playable,
        source: one.source,
        artwork: one.artwork ?? library?.artwork ?? null,
        inLibrary,
        libraryId: library?.id ?? null,
        favourite: Boolean(library?.favourite),
        plays: library?.playCount ?? 0
      }
    })

    return { ...arrange(result, rows, parsed, explainEmpty), parsed }
  }

  /**
   * Whether something is already here, and in what sense.
   *
   * Four different answers, because the interface has four different things to say: it is already here, it is here
   * under different details, a different version is here, or it is new. "Already in your library" shown for a
   * remix is the mistake this exists to prevent.
   */
  async check(names: TrackNames & { duration?: number | null; isrc?: string | null }): Promise<{
    verdict: Comparison['verdict']
    why: string
    confidence: number
    track: OrbisTrack | null
    version: string
    /** What the interface should offer. Never "add" alone when a duplicate was found. */
    offer: readonly ('play' | 'open' | 'add-anyway' | 'add' | 'playlist')[]
  }> {
    const held = await this.o.tracks()
    const wanted = { title: names.title, artist: names.artist, album: names.album ?? null, duration: names.duration ?? null, isrc: names.isrc ?? null }
    const found = duplicateOf(wanted, held)
    const version = versionLabel(versionOf(names.title))

    if (!found) {
      return { verdict: 'new-track', why: 'Not in your library.', confidence: 0.9, track: null, version, offer: ['add', 'playlist'] }
    }
    const { comparison, track } = found
    const offer: ('play' | 'open' | 'add-anyway' | 'add' | 'playlist')[] =
      comparison.verdict === 'exact-duplicate'
        ? ['play', 'open', 'playlist']
        : comparison.verdict === 'same-track-different-metadata'
          ? ['play', 'open', 'add-anyway']
          : ['play', 'open', 'add-anyway', 'playlist']
    return { verdict: comparison.verdict, why: comparison.why, confidence: comparison.confidence, track, version, offer }
  }

  /** The versions of one song already in the library, so a track page can show them together. */
  async versionsOf(trackId: string): Promise<{ track: OrbisTrack; version: string; current: boolean }[]> {
    const held = await this.o.tracks()
    const one = held.find((x) => x.id === trackId)
    if (!one) return []
    return held
      .filter((other) => {
        if (other.id === one.id) return true
        const out = compare({ title: one.title, artist: one.artist }, { title: other.title, artist: other.artist })
        return out.verdict !== 'new-track'
      })
      .map((other) => ({ track: other, version: versionLabel(versionOf(other.title)) || 'Original', current: other.id === one.id }))
  }

  /** The canonical identity of a library row, for anything that needs to compare across providers. */
  async canonical(trackId: string): Promise<ReturnType<typeof canonicalTrack> | null> {
    const held = await this.o.tracks()
    const one = held.find((x) => x.id === trackId)
    if (!one) return null
    return canonicalTrack({
      title: one.title,
      artist: one.artist,
      album: one.album ?? null,
      duration: one.duration > 0 ? one.duration : null,
      year: typeof one.year === 'number' ? one.year : null,
      provider: 'local',
      providerId: one.id
    })
  }
}
