/**
 * A price and a day's change, in the words a person reads them in.
 *
 * The number goes through the browser's own formatter, so somebody in India sees lakhs and somebody in Germany sees
 * a comma where the decimal point goes, without this file knowing anything about either. A change carries its sign
 * as well as its colour, because a colour alone says nothing to somebody who cannot see it.
 *
 * Nothing here fills a gap: a price that is not a number has no words at all, and the card then shows no price
 * rather than a zero.
 *
 * Pure.
 */

/** A currency the formatter will accept: three letters and nothing else. */
const CODE = /^[A-Za-z]{3}$/

/**
 * How many decimal places a price is worth showing.
 *
 * Two for anything a person would call a price. A coin worth a fraction of a penny needs more, or every one of them
 * is shown as 0.00 and they all look the same.
 */
export function pricePlaces(price: number): number {
  const size = Math.abs(price)
  if (!Number.isFinite(size) || size >= 1) return 2
  if (size >= 0.01) return 4
  return size > 0 ? 6 : 2
}

/**
 * A price in its own currency: "$64,250.00".
 *
 * A currency the browser does not know is not guessed at and not dropped: the number is shown plainly with the code
 * beside it, which is less pretty and still true.
 */
export function formatPrice(price: number, currency: string, locale?: string): string {
  if (!Number.isFinite(price)) return ''
  const places = pricePlaces(price)
  const code = String(currency ?? '').trim().toUpperCase()
  if (CODE.test(code)) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: code, minimumFractionDigits: places, maximumFractionDigits: places }).format(price)
    } catch {
      // An unknown three-letter code. The plain number below is still the price.
    }
  }
  const plain = new Intl.NumberFormat(locale, { minimumFractionDigits: places, maximumFractionDigits: places }).format(price)
  return code === '' ? plain : `${plain} ${code}`
}

export type Direction = 'up' | 'down' | 'flat'

export interface ChangeWords {
  direction: Direction
  /** What the pill shows: "+1.84%", "−0.42%", "0.00%". */
  text: string
  /** The same thing spoken, for somebody who hears the page rather than sees it. */
  said: string
}

/**
 * The day's change, as a pill and as a sentence.
 *
 * Two places, because a hundredth of a percent is the smallest move a day is quoted in. A move too small to show at
 * two places is called no change rather than shown as "−0.00%", which is a minus sign in front of nothing.
 */
export function changeWords(change: number): ChangeWords | null {
  if (!Number.isFinite(change)) return null
  const size = Math.abs(change).toFixed(2)
  if (Number(size) === 0) return { direction: 'flat', text: `${size}%`, said: 'No change today' }
  const up = change > 0
  return { direction: up ? 'up' : 'down', text: `${up ? '+' : '−'}${size}%`, said: `${up ? 'Up' : 'Down'} ${size} per cent today` }
}

/**
 * A symbol as it is shown on the card: upper case, and short enough not to push the price off the edge.
 *
 * Cut rather than shrunk, because a symbol nobody can read is worth no more than a symbol that is missing, and a
 * price squeezed to fit a long one is the thing a person actually came for.
 */
export const tickerText = (symbol: string): string => String(symbol ?? '').trim().toUpperCase().slice(0, 12)
