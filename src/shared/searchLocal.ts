/**
 * Places (§37).
 *
 * OpenStreetMap, through Nominatim, is what Orbis can actually reach for places. It is a real gazetteer and it gives
 * real answers: what a place is called, what kind of place it is, where it is, and where it sits on a map.
 *
 * It does not give ratings, review counts, opening hours or telephone numbers, and §37 asks for all four. So they are
 * not here. A card showing "4.6 stars" that nobody sourced is the most persuasive lie a search engine can tell about
 * a business, and the fact that competitors show one is not a reason to invent it. What is shown is what is known.
 */

export interface Place {
  /** The place itself: "Amethyst Cafe", "Apollo Hospital". The first part of what the gazetteer returns. */
  name: string
  /** Where it is, as the gazetteer writes it, with the name taken off the front so it is not said twice. */
  address: string
  /** "cafe", "hospital", "restaurant" -- the kind of place, in the gazetteer's own words. */
  kind: string
  /** Its page on the map. */
  url: string
  /** Directions to it, when the coordinates are known. */
  directions?: string
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/** Tidies "cafe · amenity" into "Cafe". The gazetteer's vocabulary, capitalised and de-duplicated. */
function readKind(raw: string): string {
  const parts = clean(raw)
    .split(/[·,]/)
    .map((p) => p.trim().replace(/_/g, ' '))
    .filter((p) => p && !/^(yes|amenity|building|place|tourism|shop|office)$/i.test(p))
  const first = parts[0]
  return first ? first[0].toUpperCase() + first.slice(1) : ''
}

/** The coordinates out of an OpenStreetMap link, which is where the engine puts them. */
export function coordsFrom(url: string): { lat: string; lon: string } | null {
  const found = /[?&]mlat=([-\d.]+)&mlon=([-\d.]+)/.exec(String(url ?? ''))
  return found ? { lat: found[1], lon: found[2] } : null
}

/**
 * One gazetteer result as a place, or null.
 *
 * Nominatim returns the whole address as one long string with the place at the front. Splitting it puts the name
 * where a name goes and the address underneath, rather than showing the same forty characters twice.
 */
export function readPlace(raw: { title?: unknown; content?: unknown; url?: unknown }): Place | null {
  const title = clean(raw?.title)
  const url = clean(raw?.url)
  if (!title || !/^https?:\/\//i.test(url)) return null

  const parts = title.split(',').map((p) => p.trim()).filter(Boolean)
  const name = parts[0] ?? title
  const address = parts.slice(1).join(', ')
  const coords = coordsFrom(url)

  return {
    name,
    address,
    kind: readKind(clean(raw?.content)),
    url,
    // Directions are a link to the map's own routing, not a route Orbis worked out.
    ...(coords ? { directions: `https://www.openstreetmap.org/directions?to=${coords.lat},${coords.lon}` } : {})
  }
}

/** What the page says about what it cannot know, so the gaps are explained rather than merely empty. */
export const PLACES_NOTE = 'From OpenStreetMap. Ratings, opening hours and phone numbers are not available from this source.'
