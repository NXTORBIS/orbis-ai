/**
 * Working out which place a weather query is about (§42).
 *
 * "weather in chennai", "chennai weather", "what's the forecast for Tokyo tomorrow" -- all the same question with the
 * place in a different spot. This finds it, and says so when it cannot, because the alternative is fetching the
 * weather for a word that was never a place and showing it as though it were an answer.
 *
 * Only the place is decided here. The forecast itself comes from MET Norway, which Orbis already uses for the weather
 * widget, so there is one real source rather than a second invented one.
 */

/** Words that are part of asking, not part of the place. Stripped so what remains is the place or nothing. */
const ASKING = /\b(what(?:'s| is)?|whats|the|weather|forecast|temperature|temp|climate|conditions|like|today|tonight|tomorrow|now|currently|current|this (?:week|weekend|morning|afternoon|evening)|for|in|at|of|on)\b/gi

const TRAILING = /[?.!,]+$/

/** Whether this query is asking about the weather at all. */
export function isWeatherQuery(query: string): boolean {
  return /\b(weather|forecast|temperature|how (?:hot|cold|warm)|rain(?:ing)?|snow(?:ing)?|humidity|sunrise|sunset)\b/i.test(query)
}

/**
 * The place, or null.
 *
 * Null covers two different situations and both are handled the same way on purpose: the query names no place
 * ("weather"), or it names something this cannot recognise. In either case Orbis does not guess -- it asks, or shows
 * nothing, rather than reporting the weather somewhere the person did not mean.
 */
export function placeFromQuery(query: string): string | null {
  const raw = String(query ?? '').trim().replace(TRAILING, '')
  if (!raw || !isWeatherQuery(raw)) return null

  // "weather in X" and "forecast for X" name the place outright, which is the most reliable reading.
  const named = /\b(?:weather|forecast|temperature|temp|conditions)\s+(?:in|at|for|of)\s+([a-zÀ-ɏ\s'.-]{2,60})$/i.exec(raw)
  if (named) {
    const place = named[1].replace(ASKING, ' ').replace(/\s+/g, ' ').trim()
    if (place.length >= 2) return place
  }

  // Otherwise take out the asking and see whether anything is left. "chennai weather" leaves "chennai".
  const left = raw.replace(ASKING, ' ').replace(/\s+/g, ' ').trim()
  if (left.length >= 2 && /[a-z]/i.test(left)) return left
  return null
}

/** How the page says it when the query is about weather but names nowhere. Asking beats guessing. */
export const NO_PLACE = 'Which place? Add one, like "weather in Chennai".'
