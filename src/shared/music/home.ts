/**
 * The thinking behind the Home screen of the full-tab Orbis Music page.
 *
 * Home is rows of cards, and a row of cards is almost entirely decisions rather than drawing: what the greeting says
 * at this hour, which rows are worth showing at all, what the second line under a card reads, whether a card can be
 * played and what to say when it cannot, and which covers are worth asking for first. All of that is here, as plain
 * values in and plain values out, so it is checked by `home.test.ts` with no browser and no disk. The screen file
 * beside the page does nothing but turn these values into nodes.
 *
 * Two rules run through the whole file, and they are the reason it exists rather than the rows being built inline.
 *
 * Nothing here invents anything. Every card comes from something the music service really answered: a track in the
 * library, a group worked out from those tracks, a song Orbis noticed on a web page, or one of the six fixed ways of
 * exploring the engine offers. There is no catalogue behind Orbis Music -- no charts, no new releases, no "because
 * you listened to" -- so a row that a streaming service would fill from the internet is simply not here. A thin
 * library gets fewer rows, which is the honest answer.
 *
 * And a row with nothing in it is not drawn. An empty row with a heading over it reads as something that broke,
 * where a Home screen of three rows instead of six reads as a library with three rows' worth of music in it. The one
 * thing that does get said in words is a library that is genuinely empty, because then there is something to do
 * about it.
 */

import type { Grouped, OrbisTrack } from '../music.ts'
import { playableOffline, whyNotPlayable } from '../music.ts'
import { countText } from './fulltab.ts'

// ---------------------------------------------------------------- the greeting

/**
 * What the top of the screen says, by the hour on this computer's clock.
 *
 * Four of them rather than three, because somebody opening their music at two in the morning is not having a
 * morning. Nothing is addressed to a name: Orbis Music does not know one, and "Good evening, friend" is the kind of
 * invented warmth this house does not do.
 */
export function greetingFor(hour: number): string {
  if (!Number.isFinite(hour)) return 'Your music'
  const whole = Math.floor(hour)
  if (whole >= 5 && whole < 12) return 'Good morning'
  if (whole >= 12 && whole < 18) return 'Good afternoon'
  if (whole >= 18 && whole < 23) return 'Good evening'
  return 'Still up'
}

// ---------------------------------------------------------------- one card

export interface HomeCard {
  /** Unique within its row, so a row can be redrawn without two cards claiming one key. */
  readonly key: string
  readonly name: string
  /** The line under the name. Always something a person reads; never a blank line holding space open. */
  readonly under: string
  /** Which track's cover stands for this card. Absent when there is no track behind it at all. */
  readonly coverTrackId?: string
  /** What pressing the card plays, in order. Empty means there is nothing here to play. */
  readonly trackIds: readonly string[]
  /** Why it cannot be played, in the music service's own words. Set only when `trackIds` is empty. */
  readonly why?: string
  /** True for an artist, which is drawn as a circle rather than a square. */
  readonly round?: boolean
  /** Set only on a card that starts one of the engine's ways of exploring, which plays by its own name. */
  readonly stationId?: string
}

export type ShelfKind = 'recent' | 'stations' | 'favourites' | 'noticed' | 'albums' | 'artists'

export interface HomeShelf {
  readonly kind: ShelfKind
  readonly title: string
  /** One sentence under the heading, where the row needs explaining. Most rows do not. */
  readonly detail?: string
  readonly cards: readonly HomeCard[]
  /** The screen the "See all" link goes to, when there is a screen for the whole lot. */
  readonly more?: 'recent' | 'liked' | 'noticed' | 'library' | 'discover'
}

/**
 * One track as a card.
 *
 * A track with no audio on this computer is still a card and still looks like a song, because it is one. What changes
 * is that it has nothing to play and carries the reason instead -- the same sentence the rest of the page shows, from
 * the library itself, so a recognised song is never dressed up as a file somebody has.
 */
export function trackCard(track: OrbisTrack): HomeCard {
  const playable = playableOffline(track)
  return {
    key: track.id,
    name: track.title || 'No title',
    under: track.artist || 'No artist named',
    coverTrackId: track.id,
    trackIds: playable ? [track.id] : [],
    ...(playable ? {} : { why: whyNotPlayable(track) ?? 'Orbis has no audio for this track.' })
  }
}

/** Several tracks as cards, newest first order left as the caller gave it, capped. */
export const trackCards = (tracks: readonly OrbisTrack[], limit = 12): readonly HomeCard[] => tracks.slice(0, Math.max(0, limit)).map(trackCard)

/**
 * The tracks of a group that can actually be played, in the order the group gave them.
 *
 * Pressing an album plays the album, so what is sent is the files that exist. A group of nothing but names has
 * nothing to send, and the card says so rather than starting something silent.
 */
export const playableIn = (group: Grouped): readonly string[] => group.tracks.filter((one) => playableOffline(one)).map((one) => one.id)

/** When a group was last added to, which is the only ordering the library can honestly give a shelf of albums. */
export const newestIn = (group: Grouped): number => group.tracks.reduce((most, one) => (one.addedAt > most ? one.addedAt : most), 0)

/**
 * Albums as cards, the most recently added first.
 *
 * Sorted by what arrived most recently rather than by anything like popularity, because there is no popularity
 * figure anywhere in Orbis Music and inventing one out of play counts and calling it a chart would be a guess
 * wearing a number.
 */
export function albumCards(groups: readonly Grouped[], limit = 12): readonly HomeCard[] {
  return [...groups]
    .sort((a, b) => newestIn(b) - newestIn(a))
    .slice(0, Math.max(0, limit))
    .map((group) => {
      const ids = playableIn(group)
      const year = typeof group.year === 'number' && group.year > 0 ? ` · ${group.year}` : ''
      return {
        key: `${group.name}|${group.by ?? ''}`,
        name: group.name,
        under: `${group.by ?? 'Unknown artist'}${year}`,
        coverTrackId: group.tracks[0]?.id,
        trackIds: ids,
        ...(ids.length === 0 ? { why: 'There is no audio for this album on this computer.' } : {})
      }
    })
}

/** Artists as cards, the ones with most in the library first, drawn round. */
export function artistCards(groups: readonly Grouped[], limit = 12): readonly HomeCard[] {
  return [...groups]
    .sort((a, b) => b.tracks.length - a.tracks.length)
    .slice(0, Math.max(0, limit))
    .map((group) => {
      const ids = playableIn(group)
      return {
        key: group.name,
        name: group.name,
        under: countText(group.tracks.length, 'song', 'songs'),
        coverTrackId: group.tracks[0]?.id,
        trackIds: ids,
        round: true,
        ...(ids.length === 0 ? { why: 'There is no audio for this artist on this computer.' } : {})
      }
    })
}

/** What a song Orbis noticed on a web page carries. Only the fields Home reads. */
export interface NoticedLike {
  readonly id: string
  readonly title: string
  readonly artist: string
  readonly provider: string
  /** Set only when the person already has a copy, which is the one case there is something to play. */
  readonly trackId?: string
}

/**
 * Songs noticed while browsing, as cards.
 *
 * Noticing is not owning, and that distinction is kept on the card: one of these plays only when Orbis has found the
 * person's own copy of it. Without a copy there is a name and nothing else, and the card says so in the same words
 * the rest of Orbis Music uses, because a card that looks playable and then is not is worse than one that never did.
 */
export function noticedCards(songs: readonly NoticedLike[], limit = 12): readonly HomeCard[] {
  return songs.slice(0, Math.max(0, limit)).map((song) => ({
    key: song.id,
    name: song.title || 'No title',
    under: song.artist || song.provider || 'No artist named',
    coverTrackId: song.trackId,
    trackIds: song.trackId ? [song.trackId] : [],
    ...(song.trackId ? {} : { why: 'Orbis knows this song by name. Bring in your own copy to play it here.' })
  }))
}

/** One of the engine's fixed ways of exploring. Only the fields Home reads. */
export interface StationLike {
  readonly id: string
  readonly label: string
  readonly blurb: string
}

/**
 * The ways of exploring, as cards.
 *
 * These six are the engine's own and are not a list this file keeps: whatever it answers is what is drawn, so a
 * seventh added to the engine appears here with no edit. They have no cover and nothing to hand to the player --
 * pressing one asks the engine to work a run out, and it either does or says why.
 */
export function stationCards(stations: readonly StationLike[]): readonly HomeCard[] {
  return stations.map((one) => ({ key: one.id, name: one.label, under: one.blurb, trackIds: [], stationId: one.id }))
}

// ---------------------------------------------------------------- the whole screen

/** Everything Home was able to read. Anything a call failed on comes in empty and simply means no row. */
export interface HomeParts {
  readonly played: readonly OrbisTrack[]
  readonly stations: readonly StationLike[]
  readonly favourites: readonly OrbisTrack[]
  readonly noticed: readonly NoticedLike[]
  readonly albums: readonly Grouped[]
  readonly artists: readonly Grouped[]
}

/**
 * The rows, in order, with every empty one left out.
 *
 * The order is the one that matches how people actually use a music app: what you were just listening to, then the
 * ways to start something new, then the things you said you liked, then the rest of what you have. A row of albums
 * and a row of artists both come out of the same library, so neither is shown when there is only one album in it --
 * a row of one card is a row that was not worth a heading.
 */
export function homeShelves(parts: HomeParts): readonly HomeShelf[] {
  const shelves: HomeShelf[] = []
  const recent = trackCards(parts.played)
  if (recent.length > 0) shelves.push({ kind: 'recent', title: 'Carry on where you were', cards: recent, more: 'recent' })

  const stations = stationCards(parts.stations)
  if (stations.length > 0)
    shelves.push({
      kind: 'stations',
      title: 'Start something',
      detail: 'Orbis works each of these out from your own music as it goes.',
      cards: stations,
      more: 'discover'
    })

  const favourites = trackCards(parts.favourites)
  if (favourites.length > 0) shelves.push({ kind: 'favourites', title: 'Your favourites', cards: favourites, more: 'liked' })

  const noticed = noticedCards(parts.noticed)
  if (noticed.length > 0)
    shelves.push({
      kind: 'noticed',
      title: 'Noticed while browsing',
      detail: 'Songs Orbis worked out from web pages. Knowing the name is not having the song.',
      cards: noticed,
      more: 'noticed'
    })

  const albums = albumCards(parts.albums)
  if (albums.length > 1) shelves.push({ kind: 'albums', title: 'Albums in your music', cards: albums, more: 'library' })

  const artists = artistCards(parts.artists)
  if (artists.length > 1) shelves.push({ kind: 'artists', title: 'Artists in your music', cards: artists, more: 'library' })

  return shelves
}

/**
 * Which covers to ask for, in the order they appear.
 *
 * Covers arrive sixty at a time and are heavy, so the order matters: the first row on screen is asked about before
 * the last. Duplicates are dropped -- the same song is often both recently played and a favourite -- because asking
 * twice costs a place in the batch that another card could have had.
 */
export function coverWants(shelves: readonly HomeShelf[], limit = 60): readonly string[] {
  const wanted: string[] = []
  const seen = new Set<string>()
  for (const shelf of shelves) {
    for (const card of shelf.cards) {
      const id = card.coverTrackId
      if (!id || seen.has(id)) continue
      seen.add(id)
      wanted.push(id)
      if (wanted.length >= limit) return wanted
    }
  }
  return wanted
}

/**
 * True when there is genuinely no music, rather than when Home merely could not read any.
 *
 * The number comes from the player's own summary, which is one answer about the whole library, so it is the only
 * thing on this screen that can tell "you have no music" apart from "six calls failed". Everything else treats a
 * failure as no row.
 */
export const libraryIsEmpty = (summary: { readonly tracks: number } | null | undefined): boolean => summary !== null && summary !== undefined && summary.tracks === 0

/** How many songs Home can say the person has, for the line under the greeting. Null when it does not know yet. */
export function haveWords(summary: { readonly tracks: number; readonly offline: number; readonly reference: number } | null | undefined): string | null {
  if (!summary) return null
  const parts = [countText(summary.tracks, 'song', 'songs'), `${summary.offline} playable here`]
  // The third number is the songs Orbis has by name with no audio. It is said everywhere else in Orbis Music, and
  // leaving it off the busiest screen would be the one place the distinction quietly disappeared.
  if (summary.reference > 0) parts.push(`${summary.reference} saved by name`)
  return parts.join(' · ')
}
