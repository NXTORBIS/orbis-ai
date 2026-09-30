import { useEffect, useState } from 'react'
import { assetFor, assetOf, describeAsset, LOGO_SIZES, type AssetIdentity, type LogoSize } from '../../../../shared/markets/assets'
import type { Instrument } from '../../../../shared/markets/instrument'

/**
 * One asset's logo, everywhere.
 *
 * The only place in Orbis that turns an asset into a picture. Every market surface uses this — the ticker, a watchlist
 * row, a search result, a heatmap tile, a portfolio holding, an alert — so an asset looks the same wherever it appears
 * and there is one place to fix if it ever does not.
 *
 * What it will not do:
 *
 * **It never shows another asset's logo.** A logo that fails to load becomes that asset's own letters on a neutral
 * mark, never a generic coin and never a substitute. Showing the wrong logo is worse than showing none, because the
 * screen looks entirely normal while being wrong about which coin you are reading.
 *
 * **It does not ask twice for something that is not there.** Results are remembered for the session, so a watchlist of
 * forty rows with the same asset in three of them makes one request, and an asset the icon set has never heard of is
 * asked about once rather than once per render.
 *
 * **It is never the only thing saying which asset this is.** The accessible name carries the asset's name and symbol,
 * and every caller shows the symbol in text beside it.
 */

/**
 * What is known about each logo url this session.
 *
 * Module level, deliberately: it outlives the components and is shared between them, which is the whole point. The
 * browser caches the bytes; this caches the *answer*, so a 404 is not re-requested by the next row that renders.
 */
const known = new Map<string, 'loading' | 'ok' | 'missing'>()

/** Told when an entry settles, so rows already on screen stop waiting. */
const waiting = new Set<() => void>()

function settle(url: string, state: 'ok' | 'missing'): void {
  known.set(url, state)
  for (const listener of [...waiting]) listener()
}

/**
 * Asks for a logo once.
 *
 * Through `Image` rather than `fetch`, so a successful load populates the browser's own cache and the `<img>` that
 * follows is instant rather than a second request.
 */
function probe(url: string): void {
  if (known.has(url)) return
  known.set(url, 'loading')
  const image = new Image()
  image.onload = () => settle(url, 'ok')
  image.onerror = () => settle(url, 'missing')
  image.src = url
}

/**
 * A colour derived from the symbol itself.
 *
 * So that a coin with no logo anywhere still gets a mark of its own rather than being one of a row of identical grey
 * circles. Some coins genuinely have no logo in existence -- a market listed days ago, a tokenised stock nothing has
 * catalogued -- and for those this *is* the artwork, so it should look chosen rather than missing.
 *
 * From the letters, so it is the same colour on every screen, every session and every machine, with no table to keep.
 * Saturation and lightness are fixed, so every one of these sits at the same weight beside the real logos next to it
 * and none of them shouts.
 *
 * It is never identity on its own: the letters are in the mark and the symbol is in text beside it, because two coins
 * can land on the same hue and a colour is not a name.
 */
function hueOf(symbol: string): number {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    // A rolling hash. The multiplier is odd and not a power of two, so an anagram is a different colour.
    hash = (hash * 31 + symbol.charCodeAt(i)) % 360_000
  }
  return hash % 360
}

/** A mark with the asset's own letters, in its own colour. Used only when there is no real logo to show. */
function Initials({ asset, pixels }: { asset: AssetIdentity; pixels: number }): React.JSX.Element {
  // Two letters at most: three in a 14-pixel circle is a smudge.
  const letters = asset.symbol.slice(0, pixels >= LOGO_SIZES.large ? 3 : 2)
  const hue = hueOf(asset.symbol)
  return (
    <span
      className="mk-logo-fallback"
      style={{
        width: pixels,
        height: pixels,
        fontSize: Math.max(7, Math.round(pixels * 0.38)),
        ['--mk-logo-hue' as string]: String(hue)
      }}
      aria-hidden="true"
    >
      {letters}
    </span>
  )
}

export interface AssetLogoProps {
  /** Either the instrument being shown, or the base asset's symbol. */
  instrument?: Instrument
  symbol?: string
  size?: LogoSize
  /** True when a label beside it already names the asset, so the logo can be decorative to a screen reader. */
  labelled?: boolean
}

export default function AssetLogo({
  instrument,
  symbol,
  size = 'small',
  labelled = true
}: AssetLogoProps): React.JSX.Element {
  const asset = instrument ? assetOf(instrument) : assetFor(symbol ?? '')
  const pixels = LOGO_SIZES[size]
  const candidates = asset.logoUrls
  const [, redraw] = useState(0)

  /**
   * The first candidate that has not been ruled out.
   *
   * One set does not have every coin. Rather than a blank mark the moment the first place answers 404, the next is
   * asked -- and only when every place has been asked and none had it does the asset show its own letters. That is
   * still never a substitute logo: the answer "nobody has this one" is a real answer, and it is the one shown.
   */
  const firstUsable = (): string | null => {
    for (const one of candidates) {
      if (known.get(one) !== 'missing') return one
    }
    return null
  }
  const url = firstUsable()

  useEffect(() => {
    if (!url) return
    probe(url)
    if (known.get(url) !== 'loading') return
    // Only while it is in flight: a settled entry needs no listener, and a watchlist of forty would otherwise hold
    // forty subscriptions to something that already has its answer. A redraw after one fails is also what moves
    // this on to the next candidate, because the next render asks `firstUsable` again.
    const listener = (): void => redraw((n) => n + 1)
    waiting.add(listener)
    return () => {
      waiting.delete(listener)
    }
  }, [url])

  const state = url ? known.get(url) : 'missing'

  // A compact neutral space while it loads. Never a placeholder logo, which would flash the wrong coin.
  if (url && state === 'loading') {
    return (
      <span
        className="mk-logo mk-logo-loading"
        style={{ width: pixels, height: pixels }}
        aria-hidden={labelled ? 'true' : undefined}
        aria-label={labelled ? undefined : describeAsset(asset)}
        role={labelled ? undefined : 'img'}
      />
    )
  }

  if (!url || state === 'missing') {
    return (
      <span
        className="mk-logo"
        style={{ width: pixels, height: pixels }}
        title={describeAsset(asset)}
        aria-hidden={labelled ? 'true' : undefined}
        aria-label={labelled ? undefined : describeAsset(asset)}
        role={labelled ? undefined : 'img'}
      >
        <Initials asset={asset} pixels={pixels} />
      </span>
    )
  }

  return (
    <img
      className="mk-logo"
      src={url}
      width={pixels}
      height={pixels}
      // Empty alt where a label beside it already names the asset, so a screen reader does not read it twice.
      alt={labelled ? '' : describeAsset(asset)}
      aria-hidden={labelled ? 'true' : undefined}
      title={describeAsset(asset)}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => {
        // A url that passed the probe and then failed: remembered, so the fallback is immediate next time.
        settle(url, 'missing')
      }}
    />
  )
}

/** Forgets what is known about logos. For tests, and for a profile switch that should not inherit a failure. */
export function forgetLogos(): void {
  known.clear()
}
