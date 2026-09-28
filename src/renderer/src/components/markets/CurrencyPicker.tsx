import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Search, Star } from 'lucide-react'
import { searchCurrencies, type Currency } from '../../../../shared/markets/currency'
import type { CurrencyState } from './useCurrency'

/**
 * Choosing what money is shown in.
 *
 * The ISO code is always beside the symbol, because `$` is five currencies and `¥` is two — a chooser offering a row of
 * bare symbols asks somebody to guess which dollar they are picking.
 *
 * It also says *why* the current currency is the current one. "Automatic, detected India" and "you chose this" are
 * different situations, and somebody wondering why their prices are in dollars deserves an answer rather than a
 * setting that simply is what it is.
 */

function Row({
  currency,
  selected,
  favourite,
  onChoose,
  onFavourite
}: {
  currency: Currency
  selected: boolean
  favourite: boolean
  onChoose(): void
  onFavourite(): void
}): React.JSX.Element {
  return (
    <li className={selected ? 'is-on' : ''}>
      <button
        type="button"
        onClick={onChoose}
        // "Indian Rupee, INR, selected" — the name, the code, and the state, in that order.
        aria-label={`${currency.name}, ${currency.code}${selected ? ', selected' : ''}`}
        aria-current={selected ? 'true' : undefined}
      >
        <span className="mk-cur-symbol" aria-hidden="true">
          {currency.symbol}
        </span>
        <b>{currency.code}</b>
        <span className="mk-name">{currency.name}</span>
        {selected && <Check size={12} />}
      </button>
      <button
        type="button"
        className="tl-icon"
        aria-label={favourite ? `Unpin ${currency.code}` : `Pin ${currency.code} to the top`}
        title={favourite ? 'Unpin' : 'Pin to the top'}
        onClick={onFavourite}
      >
        <Star size={11} className={favourite ? 'is-on' : ''} />
      </button>
    </li>
  )
}

export default function CurrencyPicker({ currency }: { currency: CurrencyState }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement | null>(null)
  const field = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    field.current?.focus()
    const away = (event: MouseEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const preference = currency.answer?.preference
  const favourites = preference?.favourites ?? []
  const suggested = currency.answer?.suggested ?? []
  const found = searchCurrencies(query)

  const pinned = query ? [] : found.filter((one) => favourites.includes(one.code))
  const recommended = query
    ? []
    : found.filter((one) => !favourites.includes(one.code) && suggested.includes(one.code))
  const rest = query ? found : found.filter((one) => !favourites.includes(one.code) && !suggested.includes(one.code))

  const toggleFavourite = (code: string): void => {
    const next = favourites.includes(code) ? favourites.filter((one) => one !== code) : [...favourites, code]
    void window.api.marketsCurrencyOptions({ favourites: next }).then(() => void currency.refresh())
  }

  const choose = (code: string): void => {
    void currency.choose(code)
    setOpen(false)
    setQuery('')
  }

  const label = currency.currency

  return (
    <div className="mk-currency" ref={box}>
      <button
        type="button"
        className="mk-currency-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={
          preference?.mode === 'manual'
            ? `${label?.name ?? currency.code} — you chose this`
            : `${label?.name ?? currency.code} — chosen automatically${preference?.detectedRegion ? ` for ${preference.detectedRegion}` : ''}`
        }
        onClick={() => setOpen((on) => !on)}
      >
        <span aria-hidden="true">{label?.symbol ?? ''}</span>
        <b>{currency.code}</b>
        {/* The one state worth showing on the button: prices are not in the currency it names. */}
        {currency.unavailable && <AlertTriangle size={11} className="mk-cur-warn" />}
      </button>

      {open && (
        <div className="mk-currency-menu" role="listbox" aria-label="Display currency">
          <div className="mk-search">
            <Search size={13} />
            <input
              ref={field}
              value={query}
              placeholder="Search currencies…"
              maxLength={30}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && found[0]) choose(found[0].code)
              }}
            />
          </div>

          <div className="mk-currency-list">
            {pinned.length > 0 && (
              <>
                <h6>Pinned</h6>
                <ul>
                  {pinned.map((one) => (
                    <Row
                      key={one.code}
                      currency={one}
                      selected={one.code === currency.code}
                      favourite
                      onChoose={() => choose(one.code)}
                      onFavourite={() => toggleFavourite(one.code)}
                    />
                  ))}
                </ul>
              </>
            )}
            {recommended.length > 0 && (
              <>
                <h6>Common</h6>
                <ul>
                  {recommended.map((one) => (
                    <Row
                      key={one.code}
                      currency={one}
                      selected={one.code === currency.code}
                      favourite={false}
                      onChoose={() => choose(one.code)}
                      onFavourite={() => toggleFavourite(one.code)}
                    />
                  ))}
                </ul>
              </>
            )}
            {rest.length > 0 && (
              <>
                {!query && <h6>All currencies</h6>}
                <ul>
                  {rest.map((one) => (
                    <Row
                      key={one.code}
                      currency={one}
                      selected={one.code === currency.code}
                      favourite={favourites.includes(one.code)}
                      onChoose={() => choose(one.code)}
                      onFavourite={() => toggleFavourite(one.code)}
                    />
                  ))}
                </ul>
              </>
            )}
            {found.length === 0 && <p className="mk-quiet">No currency matches that.</p>}
          </div>

          <div className="mk-currency-foot">
            {/* Why it is what it is. Somebody wondering why their prices are in dollars deserves an answer. */}
            <p className="mk-quiet">
              {preference?.mode === 'manual'
                ? 'You chose this currency. Orbis will not change it.'
                : preference?.detectedRegion
                  ? `Chosen automatically from your system region (${preference.detectedRegion}).`
                  : 'Chosen automatically. Orbis could not tell your region, so it is using US dollars.'}
            </p>
            {currency.rateNote && <p className="mk-quiet">{currency.rateNote}</p>}
            {currency.answer?.fxFailing && (
              <p className="pw-note">
                <AlertTriangle size={11} /> {currency.answer.fxFailing}
              </p>
            )}
            <label className="tl-switch">
              <input
                type="checkbox"
                checked={currency.compact}
                onChange={(e) =>
                  void window.api
                    .marketsCurrencyOptions({ compact: e.target.checked })
                    .then(() => void currency.refresh())
                }
              />
              <span>Shorten large numbers</span>
            </label>
            {preference?.mode === 'manual' && (
              <button
                type="button"
                className="queue-btn tiny ghost"
                onClick={() => {
                  void currency.reset()
                  setOpen(false)
                }}
              >
                Back to automatic
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
