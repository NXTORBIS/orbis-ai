import { canonicalTrack, type CanonicalTrack, type Identifiable } from './identity.ts'

/**
 * Where music can be looked up, and what happens when there is nowhere.
 *
 * Orbis ships with exactly one provider: the music on this computer. That is a deliberate position rather than an
 * unfinished one. A catalogue provider needs an account, a key and a licence, and Orbis has none of those -- so
 * rather than a search box that returns nothing and lets a student think their search failed, searching says
 * plainly that no catalogue is set up and offers what it genuinely can: their own library.
 *
 * ## The rule this file exists to enforce
 *
 * **A result is never invented.** Not a plausible-looking row, not a "preview", not a title scraped from a page and
 * shown as though it were a catalogue entry. If a provider is not configured, the honest answer is `unavailable`
 * with a reason, and every surface shows that reason instead of an empty list. An empty list is a lie: it says "we
 * looked and there is nothing", when what happened is that nobody looked.
 *
 * ## The second rule
 *
 * **Finding a track is not the same as being able to play it.** A provider can describe music it cannot hand over,
 * so `playable` is reported separately and the interface must act on it. Nothing here ever works around DRM, a
 * paywall or a sign-in; a track that cannot legitimately be played is shown as a track that cannot be played.
 */

export type ProviderKind = 'local' | 'catalogue' | 'metadata'

export interface ProviderQuery {
  text: string
  limit?: number
  /** Narrowings the provider may apply itself, when it can. */
  year?: { from?: number; to?: number }
  language?: string
  artist?: string
  album?: string
}

export interface ProviderTrack extends Identifiable {
  /** Whether this provider can actually hand the audio over. */
  playable: boolean
  /** Where the audio is, when it is playable. A local path, or an address the player already understands. */
  source?: string | null
  artwork?: string | null
  language?: string | null
  explicit?: boolean | null
  genre?: string | null
}

export interface ProviderArtist {
  id: string
  name: string
  artwork?: string | null
  genres?: readonly string[]
}

export interface ProviderAlbum {
  id: string
  title: string
  artist: string
  year?: number | null
  artwork?: string | null
  trackCount?: number | null
}

/** Either an answer or a reason there is none. Never an empty answer standing in for a reason. */
export type Answer<T> = { ok: true; items: readonly T[] } | { ok: false; reason: string; retry: boolean }

export interface MusicProvider {
  id: string
  name: string
  kind: ProviderKind
  /** Whether this provider can be asked anything at all right now. */
  ready(): boolean | Promise<boolean>
  /** Why not, when it is not ready. One sentence, for a student. */
  why(): string
  searchTracks(query: ProviderQuery): Promise<Answer<ProviderTrack>>
  searchArtists?(query: ProviderQuery): Promise<Answer<ProviderArtist>>
  searchAlbums?(query: ProviderQuery): Promise<Answer<ProviderAlbum>>
  getTrack?(id: string): Promise<ProviderTrack | null>
  getArtist?(id: string): Promise<ProviderArtist | null>
  getAlbum?(id: string): Promise<{ album: ProviderAlbum; tracks: readonly ProviderTrack[] } | null>
  getArtwork?(id: string): Promise<string | null>
  getAvailability?(id: string): Promise<{ playable: boolean; why?: string }>
  getRelated?(id: string): Promise<Answer<ProviderTrack>>
}

export interface SearchResult {
  tracks: readonly { canonical: CanonicalTrack; from: string; playable: boolean; source: string | null; artwork: string | null }[]
  artists: readonly (ProviderArtist & { from: string })[]
  albums: readonly (ProviderAlbum & { from: string })[]
  /**
   * Which providers answered, and which could not and why.
   *
   * `ready` is what separates the two reasons a provider did not answer: one that was never set up, and one that
   * was asked and failed. They call for different sentences -- set it up, or try again -- so they cannot be the
   * same record.
   */
  asked: readonly { id: string; name: string; ok: boolean; ready: boolean; reason?: string }[]
  /** True when nothing could be asked at all, which is a different thing from finding nothing. */
  nowhereToLook: boolean
}

/**
 * Asks every provider that is ready, and keeps the record of the ones that were not.
 *
 * Results are merged on the canonical key, so the same recording from two providers is one row with two sources
 * rather than two rows. A provider that throws is recorded as having failed rather than being allowed to take the
 * whole search down with it -- one broken provider must not mean no search.
 */
export async function searchAcross(providers: readonly MusicProvider[], query: ProviderQuery): Promise<SearchResult> {
  const asked: { id: string; name: string; ok: boolean; ready: boolean; reason?: string }[] = []
  const byKey = new Map<string, SearchResult['tracks'][number]>()
  const artists: (ProviderArtist & { from: string })[] = []
  const albums: (ProviderAlbum & { from: string })[] = []
  let anyAsked = false

  for (const provider of providers) {
    const ready = await Promise.resolve(provider.ready()).catch(() => false)
    if (!ready) {
      asked.push({ id: provider.id, name: provider.name, ok: false, ready: false, reason: provider.why() })
      continue
    }
    anyAsked = true
    const answer = await provider.searchTracks(query).catch((error: unknown) => ({ ok: false as const, reason: String((error as Error)?.message ?? 'That provider could not be reached.').slice(0, 200), retry: true }))
    if (!answer.ok) {
      asked.push({ id: provider.id, name: provider.name, ok: false, ready: true, reason: answer.reason })
      continue
    }
    asked.push({ id: provider.id, name: provider.name, ok: true, ready: true })
    for (const one of answer.items) {
      const canonical = canonicalTrack({ ...one, provider: provider.id, providerId: one.providerId ?? null })
      const held = byKey.get(canonical.key)
      if (held) {
        // The same recording, found twice. Kept once, and playable if either provider can play it.
        byKey.set(canonical.key, {
          ...held,
          playable: held.playable || one.playable,
          source: held.source ?? one.source ?? null,
          artwork: held.artwork ?? one.artwork ?? null
        })
        continue
      }
      byKey.set(canonical.key, { canonical, from: provider.id, playable: one.playable, source: one.source ?? null, artwork: one.artwork ?? null })
    }

    if (provider.searchArtists) {
      const found = await provider.searchArtists(query).catch(() => ({ ok: false as const, reason: '', retry: false }))
      if (found.ok) for (const one of found.items) artists.push({ ...one, from: provider.id })
    }
    if (provider.searchAlbums) {
      const found = await provider.searchAlbums(query).catch(() => ({ ok: false as const, reason: '', retry: false }))
      if (found.ok) for (const one of found.items) albums.push({ ...one, from: provider.id })
    }
  }

  return {
    // Playable things first: a list whose top row cannot be played is a list that reads as broken.
    tracks: [...byKey.values()].sort((a, b) => Number(b.playable) - Number(a.playable)),
    artists,
    albums,
    asked,
    nowhereToLook: !anyAsked
  }
}

/**
 * What to say when a search found nothing.
 *
 * Three different sentences for three different situations, because they call for three different things from the
 * student: set a provider up, try again, or search for something else.
 */
export function explainEmpty(result: SearchResult, text: string): { title: string; detail: string; retry: boolean } {
  if (result.nowhereToLook) {
    const reasons = result.asked.filter((one) => !one.ok).map((one) => one.reason).filter(Boolean)
    return {
      title: 'There is nowhere to search yet',
      detail: reasons[0] ?? 'No music catalogue is set up, so Orbis can only search the music on this computer.',
      retry: false
    }
  }
  /*
   * A provider that broke is not a provider that was never set up.
   *
   * Only a provider that was *ready* and then failed means "try again" -- the catalogue Orbis does not have is
   * not a failure, it is a fact, and reporting it as one made every fruitless search look like a broken search.
   */
  const broke = result.asked.filter((one) => !one.ok && one.ready)
  if (broke.length > 0 && result.tracks.length === 0) {
    return { title: 'Search could not finish', detail: broke[0].reason ?? 'A provider could not be reached.', retry: true }
  }
  const missing = result.asked.filter((one) => !one.ok && !one.ready)
  return {
    title: 'Nothing matched',
    detail: missing.length > 0
      ? `Nothing in your music matches “${text.slice(0, 60)}”. ${missing[0].reason ?? ''}`.trim()
      : `Nothing in your music matches “${text.slice(0, 60)}”.`,
    retry: false
  }
}

// ---------------------------------------------------------------- the one provider Orbis ships with

export interface LocalTrackRow {
  id: string
  title: string
  artist: string
  album: string | null
  duration: number | null
  year: number | null
  genre: string | null
  language: string | null
  path: string
  artwork: string | null
  /** False when the file has gone, which happens and must not be hidden. */
  present: boolean
}

export interface LocalLibraryAccess {
  all(): Promise<readonly LocalTrackRow[]> | readonly LocalTrackRow[]
}

/**
 * The music on this computer.
 *
 * Always ready, because it needs nothing: no account, no key, no network. It is also the only provider that can
 * promise playback, which is why `playable` follows whether the file is actually still there.
 */
export function localProvider(library: LocalLibraryAccess): MusicProvider {
  const matches = (row: LocalTrackRow, query: ProviderQuery): boolean => {
    const text = query.text.trim().toLowerCase()
    if (query.artist && !row.artist.toLowerCase().includes(query.artist.toLowerCase())) return false
    if (query.album && !(row.album ?? '').toLowerCase().includes(query.album.toLowerCase())) return false
    if (query.language && (row.language ?? '').toLowerCase() !== query.language.toLowerCase()) return false
    if (query.year && row.year !== null) {
      if (query.year.from !== undefined && row.year < query.year.from) return false
      if (query.year.to !== undefined && row.year > query.year.to) return false
    }
    if (!text) return true
    return [row.title, row.artist, row.album ?? '', row.genre ?? ''].some((one) => one.toLowerCase().includes(text))
  }

  return {
    id: 'local',
    name: 'Music on this computer',
    kind: 'local',
    ready: () => true,
    why: () => '',
    searchTracks: async (query) => {
      const rows = await Promise.resolve(library.all())
      const found = rows
        .filter((one) => matches(one, query))
        .slice(0, Math.max(1, Math.min(500, query.limit ?? 60)))
        .map<ProviderTrack>((one) => ({
          providerId: one.id,
          provider: 'local',
          title: one.title,
          artist: one.artist,
          album: one.album,
          duration: one.duration,
          year: one.year,
          language: one.language,
          genre: one.genre,
          artwork: one.artwork,
          // A row whose file has gone is listed and marked unplayable, never quietly dropped.
          playable: one.present,
          source: one.present ? one.path : null
        }))
      return { ok: true, items: found }
    },
    searchArtists: async (query) => {
      const rows = await Promise.resolve(library.all())
      const text = query.text.trim().toLowerCase()
      const names = new Map<string, number>()
      for (const one of rows) {
        if (text && !one.artist.toLowerCase().includes(text)) continue
        names.set(one.artist, (names.get(one.artist) ?? 0) + 1)
      }
      return {
        ok: true,
        items: [...names.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([name]) => ({ id: name, name }))
      }
    },
    searchAlbums: async (query) => {
      const rows = await Promise.resolve(library.all())
      const text = query.text.trim().toLowerCase()
      const found = new Map<string, ProviderAlbum & { count: number }>()
      for (const one of rows) {
        if (!one.album) continue
        if (text && !one.album.toLowerCase().includes(text) && !one.artist.toLowerCase().includes(text)) continue
        const key = `${one.album}|${one.artist}`
        const held = found.get(key)
        if (held) held.count += 1
        else found.set(key, { id: key, title: one.album, artist: one.artist, year: one.year, artwork: one.artwork, trackCount: 1, count: 1 })
      }
      return { ok: true, items: [...found.values()].map(({ count, ...one }) => ({ ...one, trackCount: count })).slice(0, 20) }
    },
    getTrack: async (id) => {
      const rows = await Promise.resolve(library.all())
      const one = rows.find((row) => row.id === id)
      if (!one) return null
      return {
        providerId: one.id,
        provider: 'local',
        title: one.title,
        artist: one.artist,
        album: one.album,
        duration: one.duration,
        year: one.year,
        language: one.language,
        genre: one.genre,
        artwork: one.artwork,
        playable: one.present,
        source: one.present ? one.path : null
      }
    },
    getAvailability: async (id) => {
      const rows = await Promise.resolve(library.all())
      const one = rows.find((row) => row.id === id)
      if (!one) return { playable: false, why: 'That track is not in your library.' }
      return one.present ? { playable: true } : { playable: false, why: 'The file for this track has moved or been deleted.' }
    }
  }
}

/**
 * A provider that is described but not set up.
 *
 * It exists so the interface can say *which* catalogue is missing and what would make it work, rather than showing
 * a blank. It answers nothing, ever -- `ready` is false and there is no code path that returns a result.
 */
export function unconfiguredProvider(id: string, name: string, reason: string): MusicProvider {
  return {
    id,
    name,
    kind: 'catalogue',
    ready: () => false,
    why: () => reason,
    searchTracks: async () => ({ ok: false, reason, retry: false })
  }
}

/** The providers Orbis has. One real, and the catalogue it does not have, named honestly. */
export function providersFor(library: LocalLibraryAccess): MusicProvider[] {
  return [
    localProvider(library),
    unconfiguredProvider(
      'catalogue',
      'Music catalogue',
      'Orbis has no music catalogue set up, so it can only search the music on this computer. Adding one needs an account and a licence from a music service.'
    )
  ]
}
