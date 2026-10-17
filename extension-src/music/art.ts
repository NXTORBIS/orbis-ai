/**
 * Covers, and the tile that stands in for one.
 *
 * Covers arrive the only way a browser page can get them: the picture itself written into text, 160 pixels on its
 * longest side, sixty tracks per request. There is no address for a cover and no full-size version -- the music
 * service keeps the real file inside the profile folder and never serves it -- so a sharp hero image is not something
 * this page can have. It does not pretend otherwise: a big header stretches the small picture behind a blur, which
 * reads as a wash of the record's own colours rather than as a photograph somebody is meant to look at.
 *
 * Two things are remembered: the covers that came back, and the tracks that were asked about and had none. Without
 * the second, a library of files with no pictures in them would be asked about once a second for as long as the page
 * was open. The pictures are heavy in memory, so the oldest are dropped past a limit.
 */

import { ARTWORK_KEPT, artworkBatches, hueFor, tileLetter } from '../../src/shared/music/fulltab.ts'
import { covers } from './client.ts'
import { el } from './dom.ts'

const held = new Map<string, string>()
const tried = new Set<string>()
let listeners: (() => void)[] = []
let asking = false

/** Called when new covers have arrived, so whatever is on screen can draw them. */
export function onCovers(listener: () => void): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((one) => one !== listener)
  }
}

export const coverFor = (trackId: string | undefined): string | undefined => (trackId ? held.get(trackId) : undefined)

/**
 * Asks for the covers of whatever is on screen.
 *
 * Give it the ids in the order they appear, top first: what is nearest the top is fetched first, and only one batch
 * goes out per call, so a scroll through fifty thousand tracks does not turn into eight hundred requests.
 */
export async function want(trackIds: readonly string[]): Promise<void> {
  if (asking) return
  const batches = artworkBatches(trackIds, new Set(held.keys()), tried)
  if (batches.length === 0) return
  asking = true
  try {
    for (const batch of batches) {
      const answer = await covers(batch)
      // Every id in the batch is marked tried either way. A failed ask is not a track with no cover, but asking again
      // immediately would mean asking forever; the next time the screen is drawn afresh it clears and asks again.
      for (const id of batch) tried.add(id)
      if (!answer.got) return
      for (const [id, picture] of Object.entries(answer.value)) held.set(id, picture)
      while (held.size > ARTWORK_KEPT) {
        const oldest = held.keys().next()
        if (oldest.done) break
        held.delete(oldest.value)
      }
      for (const listener of listeners) listener()
    }
  } finally {
    asking = false
  }
}

/** Forgets which tracks were asked about, so a screen being opened again has another go at the ones that failed. */
export const askAgain = (): void => tried.clear()

export interface TileOf {
  readonly id?: string
  readonly title: string
  readonly artist?: string
  readonly album?: string
  /** A path inside the profile, which a browser page cannot read -- only used to pick the stand-in colour. */
  readonly artwork?: string
}

/**
 * A square for a track, an album or an artist.
 *
 * When there is a cover it is the cover. When there is not, it is a coloured square with the first letter of the
 * name, in a colour worked out from the words themselves -- so one song looks the same in a list, in the sidebar and
 * in the player bar. No stock images and no invented covers: a letter on a square is plainly a stand-in, where a
 * picture of a record that does not exist is a small lie.
 */
export function tile(of: TileOf, options: { readonly size?: 'sm' | 'md' | 'lg' | 'xl'; readonly round?: boolean } = {}): HTMLElement {
  const picture = coverFor(of.id)
  const words = `${of.album ?? ''}|${of.artist ?? ''}|${of.title}`
  const node = el('div', {
    cls: `om-tile om-tile-${options.size ?? 'md'}${options.round ? ' om-tile-round' : ''}${picture ? ' om-tile-has' : ''}`,
    style: { '--om-hue': String(hueFor(words)) },
    attrs: { 'aria-hidden': 'true' }
  })
  if (picture) {
    const image = el('img', { cls: 'om-tile-img', attrs: { src: picture, alt: '', decoding: 'async', loading: 'lazy' } })
    node.append(image)
  } else {
    node.append(el('span', { cls: 'om-tile-letter', text: tileLetter(of.title) }))
  }
  return node
}

/**
 * The wash behind a big header.
 *
 * The small cover, stretched and blurred well past any detail. Not an attempt at a large picture: it is there to
 * carry the record's own colours into the page, and when there is no cover it falls back to the Orbis accent through
 * the stylesheet, so the band is never an empty rectangle.
 */
export function wash(trackId: string | undefined): HTMLElement {
  const picture = coverFor(trackId)
  const node = el('div', { cls: 'om-wash', attrs: { 'aria-hidden': 'true' } })
  // Checked rather than trusted: the picture goes into a CSS value, and a value with a quote in it would end the
  // string early. A cover is always base64 from the music service, so anything else is dropped rather than written.
  if (picture && /^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+$/.test(picture)) node.style.setProperty('--om-wash-image', `url("${picture}")`)
  return node
}
