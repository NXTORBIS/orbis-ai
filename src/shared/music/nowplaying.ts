/**
 * The thinking behind the "playing now" screen.
 *
 * Two jobs, both of them decisions rather than drawings, so both of them live here where they can be checked with no
 * browser and no disk:
 *
 *   - **the colours behind the cover.** They are counted out of the cover's own pixels. Nothing here holds a palette
 *     of nice colours to fall back on, and nothing guesses a colour from a track's name: either the picture was read
 *     and the colours are its own, or there are no colours and the screen uses the Orbis accent, which is honest
 *     because it is plainly Orbis's colour and not a claim about the record.
 *   - **the facts about the track.** Every line comes from a field the music service really filled in. A field that
 *     is absent leaves its line out altogether rather than printing "Unknown", because a list of unknowns reads as a
 *     broken screen, and a guessed value would be worse than either.
 *
 * The rule the whole file keeps is the one running through the rest of Orbis Music: no value is ever invented. A
 * length that is not known is a dash, a play count that was never recorded is no line at all, and a cover that could
 * not be read is no colour at all.
 */

import type { OrbisTrack } from '../music.ts'

// ---------------------------------------------------------------- colours measured out of the cover

/** One colour found in a picture, with how much of the picture it covered. */
export interface Swatch {
  readonly r: number
  readonly g: number
  readonly b: number
  /** The share of the pixels that were counted, 0 to 1. */
  readonly share: number
}

/** How coarsely colours are grouped: 5 bits a channel, so two colours a person cannot tell apart count as one. */
const STEP = 8
/** Pixels below this are too see-through to say anything about the picture. */
const SOLID_ENOUGH = 128

/**
 * How colourful a colour is, 0 to 1. Plain maths, not a perceptual model -- it only has to rank, not to measure.
 */
function liveliness(r: number, g: number, b: number): number {
  const top = Math.max(r, g, b)
  const bottom = Math.min(r, g, b)
  return top === 0 ? 0 : (top - bottom) / top
}

/** How far apart two colours are, so three swatches are three different colours rather than one colour three times. */
const apart = (a: Swatch, b: Swatch): number => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)

/**
 * The colours a picture is actually made of, strongest first.
 *
 * Fed the four-numbers-per-pixel run of bytes a canvas gives back. Colours are grouped into coarse buckets and the
 * buckets are counted; a bucket's standing is its count lifted a little by how colourful it is, because the eye reads
 * a record's colour off the colourful part of the sleeve and not off the large black border around it. Each colour
 * returned is the average of the pixels in its bucket, so it is a colour that was really in the picture.
 *
 * An empty list is a real answer: a picture that is entirely see-through, or a run of bytes that is not pixels at
 * all, has no colours to report and the caller is expected to fall back to the Orbis accent rather than to a guess.
 */
export function dominantColours(data: ArrayLike<number>, wanted = 3): Swatch[] {
  if (wanted < 1 || data.length < 4) return []
  const sums = new Map<number, { r: number; g: number; b: number; count: number }>()
  let counted = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3] as number
    if (!Number.isFinite(alpha) || alpha < SOLID_ENOUGH) continue
    const r = data[i] as number
    const g = data[i + 1] as number
    const b = data[i + 2] as number
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue
    const key = (Math.floor(r / STEP) << 10) | (Math.floor(g / STEP) << 5) | Math.floor(b / STEP)
    const held = sums.get(key)
    if (held) {
      held.r += r
      held.g += g
      held.b += b
      held.count += 1
    } else sums.set(key, { r, g, b, count: 1 })
    counted += 1
  }
  if (counted === 0) return []
  const buckets = [...sums.values()].map((one) => {
    const r = Math.round(one.r / one.count)
    const g = Math.round(one.g / one.count)
    const b = Math.round(one.b / one.count)
    return { swatch: { r, g, b, share: one.count / counted } as Swatch, standing: one.count * (0.5 + liveliness(r, g, b)) }
  })
  buckets.sort((a, b) => b.standing - a.standing)
  const out: Swatch[] = []
  for (const bucket of buckets) {
    if (out.length >= wanted) break
    // Far enough from everything already chosen to be a second colour rather than the same colour again.
    if (out.some((one) => apart(one, bucket.swatch) < 60)) continue
    out.push(bucket.swatch)
  }
  // A picture of one flat colour is a real picture, so if nothing cleared the distance test the strongest still goes
  // out on its own rather than the screen being told there were no colours.
  if (out.length === 0 && buckets[0]) out.push(buckets[0].swatch)
  return out
}

/** A colour as CSS. Written out here so a screen never does arithmetic inside a style string. */
export function rgbText(swatch: Swatch, alpha = 1): string {
  const level = Math.min(Math.max(alpha, 0), 1)
  return level >= 1 ? `rgb(${swatch.r} ${swatch.g} ${swatch.b})` : `rgb(${swatch.r} ${swatch.g} ${swatch.b} / ${level})`
}

/**
 * The two colours a header's gradient is painted with, or null when the cover gave none.
 *
 * Null rather than a pair of nice defaults: the screen's own stylesheet already falls back to the Orbis accent, and a
 * made-up pair would look exactly like a measurement.
 */
export function backdropColours(swatches: readonly Swatch[]): { readonly near: string; readonly far: string } | null {
  const first = swatches[0]
  if (!first) return null
  const second = swatches[1] ?? first
  // Carried at less than full strength so the words on top stay readable whatever the record's colours are, which a
  // cover of pure yellow would otherwise decide for us.
  return { near: rgbText(first, 0.55), far: rgbText(second, 0.22) }
}

// ---------------------------------------------------------------- the real facts about a track

export interface TrackFact {
  readonly label: string
  readonly value: string
}

/** A date a person reads, from a moment. Nothing relative: "Added 3 days ago" ages wrongly on a screen left open. */
export function dayWords(at: number | undefined, now: number): string {
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at > now + 86400000) return ''
  const when = new Date(at)
  const today = new Date(now)
  const sameDay = when.toDateString() === today.toDateString()
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today, ${time}`
  const yesterday = new Date(now - 86400000)
  if (when.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`
  const sameYear = when.getFullYear() === today.getFullYear()
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: sameYear ? undefined : 'numeric' })
}

/**
 * Where a track came from, in words.
 *
 * Both halves of it: how it got into the library, and how its names were arrived at. The second matters because a
 * song Orbis read off a web page's own player is a different kind of thing from a file with tags in it, and this
 * screen is the one place with room to say so.
 */
export function originWords(track: Pick<OrbisTrack, 'provenance' | 'method' | 'source'>): string {
  const came =
    track.provenance === 'user-file'
      ? 'A file you added'
      : track.provenance === 'watched-folder'
        ? 'A file in a folder Orbis watches'
        : track.provenance === 'download'
          ? 'Downloaded through Orbis'
          : 'Noticed while browsing'
  const how =
    track.method === 'file-tags'
      ? 'named from the file itself'
      : track.method === 'media-session'
        ? "named from the web page's own player"
        : track.method === 'vision'
          ? 'named by Orbis reading the player on screen'
          : track.method === 'page-metadata'
            ? 'named from the page'
            : track.method === 'accessibility'
              ? 'named from what the page tells a screen reader'
              : 'named by you'
  const where = track.source?.provider ? `, on ${track.source.provider}` : ''
  return `${came}, ${how}${where}`
}

/** How sure Orbis is about the names, said only when it is worth saying. A confirmed name needs no line. */
export function sureWords(confidence: OrbisTrack['confidence']): string {
  if (confidence === 'low') return 'Orbis is not certain about these names'
  if (confidence === 'medium') return 'Orbis is fairly sure about these names'
  return ''
}

/** What can honestly be played of this track, as one sentence. */
export function availabilityWords(availability: OrbisTrack['availability'], hasFile: boolean): string {
  if (availability === 'local') return hasFile ? 'A file on this computer' : 'Orbis has no file for it'
  if (availability === 'reference') return 'Kept by name only, with no audio on this computer'
  if (availability === 'missing') return 'The file is not where it was'
  return 'This computer cannot play this kind of audio file'
}

/** A file size a person reads. Left out entirely when the service did not record one. */
export function sizeWords(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} bytes`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/**
 * Everything true about this track, as lines for the screen.
 *
 * Only what is really there. A track with no year has no year line; a track nobody has played all the way through has
 * no "times played" line, because the music service only counts a play once enough of the track has gone by, and a
 * zero would read as "Orbis thinks you have never liked this" rather than as "nothing has been measured yet".
 */
export function trackFacts(track: OrbisTrack, now: number, lengthText: string): readonly TrackFact[] {
  const facts: TrackFact[] = []
  if (lengthText && lengthText !== '—') facts.push({ label: 'Length', value: lengthText })
  if (track.albumArtist && track.albumArtist !== track.artist) facts.push({ label: 'Album artist', value: track.albumArtist })
  if (track.genre) facts.push({ label: 'Genre', value: track.genre })
  if (typeof track.year === 'number' && Number.isFinite(track.year) && track.year > 0) facts.push({ label: 'Year', value: String(track.year) })
  if (typeof track.trackNumber === 'number' && track.trackNumber > 0) {
    const disc = typeof track.discNumber === 'number' && track.discNumber > 0 ? `, disc ${track.discNumber}` : ''
    facts.push({ label: 'Track', value: `${track.trackNumber}${disc}` })
  }
  const added = dayWords(track.addedAt, now)
  if (added) facts.push({ label: 'Added', value: added })
  const plays = track.playCount
  if (typeof plays === 'number' && Number.isFinite(plays) && plays > 0) {
    facts.push({ label: 'Played', value: plays === 1 ? 'Once, all the way through' : `${plays} times, all the way through` })
  }
  const last = dayWords(track.lastPlayedAt, now)
  if (last) facts.push({ label: 'Last played', value: last })
  facts.push({ label: 'Where it came from', value: originWords(track) })
  facts.push({ label: 'What Orbis has', value: availabilityWords(track.availability, Boolean(track.file)) })
  const size = sizeWords(track.fileSize)
  if (size) facts.push({ label: 'File size', value: size })
  if (track.edited) facts.push({ label: 'Names', value: 'Edited by you, so recognising it again will not overwrite them' })
  const sure = sureWords(track.confidence)
  if (sure) facts.push({ label: 'How sure', value: sure })
  return facts
}
