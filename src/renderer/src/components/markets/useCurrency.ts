import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  combinedFreshness,
  convert,
  currencyFor,
  formatAmount,
  formatMoney,
  type Converted,
  type Currency,
  type FormatOptions
} from '../../../../shared/markets/currency'
import type { CurrencyAnswer } from '../../../../main/markets/ipc'

/**
 * The one way a market price becomes text.
 *
 * Every surface formats through this, so the ticker, a watchlist row and the portfolio cannot disagree about what a
 * bitcoin is worth or what currency they are quoting it in. Each of them converting on its own is how an application
 * ends up showing a dollar figure with a rupee sign in front of it.
 *
 * The rule that shapes it: **a conversion that cannot be done produces nothing.** `money()` on a price with no rate
 * returns null rather than the unconverted number wearing the wrong symbol, and the caller shows the source-currency
 * price instead — which is true, and visibly in another currency.
 *
 * Freshness is combined, not passed through. A price that is live in dollars, converted through a rate published
 * yesterday, is not a live price in rupees; `freshnessOf` says so, and every caller shows what it says.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

export interface MoneyResult {
  /** The converted amount, or null when no conversion was possible. */
  value: number | null
  /** Ready to show. A dash when there is nothing to show. */
  text: string
  /** True when this had to be left in the source currency because no rate was available. */
  fellBack: boolean
  freshness: string
}

export interface CurrencyState {
  /** Null until the first answer arrives. */
  answer: CurrencyAnswer | null
  /** What is being displayed, or dollars until the answer arrives. */
  code: string
  currency: Currency | undefined
  /** The currency prices arrive in, which is what is being converted from. */
  base: string
  /** True when a conversion is happening at all. */
  converting: boolean
  /** True when a conversion is wanted but no rate could be had. */
  unavailable: boolean
  /** How old the rate is, in words, or empty when nothing is being converted. */
  rateNote: string
  /** Converts and formats in one step — what almost every caller wants. */
  money(value: number | null | undefined, options?: FormatOptions): MoneyResult
  /** Converts without formatting, for an axis or a calculation. */
  toDisplay(value: number | null | undefined): Converted
  /** Formats a number already in the display currency. */
  format(value: number | null | undefined, options?: FormatOptions): string
  /** A plain number in the display currency's conventions, without a symbol. */
  amount(value: number | null | undefined, options?: FormatOptions): string
  /** The market's freshness and the rate's, combined. */
  freshnessOf(marketFreshness: string): string
  choose(code: string): Promise<void>
  reset(): Promise<void>
  refresh(): Promise<void>
  compact: boolean
}

export function useCurrency(): CurrencyState {
  const [answer, setAnswer] = useState<CurrencyAnswer | null>(null)

  const refresh = useCallback(async () => {
    const got = await window.api.marketsCurrency()
    if (!refused(got)) setAnswer(got)
  }, [])

  useEffect(() => {
    void refresh()
    // Rates are daily, so this is about noticing a failure clearing rather than catching a move.
    const timer = window.setInterval(() => void refresh(), 10 * 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  return useMemo(() => {
    const code = answer?.preference.code ?? 'USD'
    const base = answer?.base ?? 'USD'
    const rate = answer?.rate ?? null
    const converting = code !== base
    const compact = answer?.preference.compact !== false
    const unavailable = converting && rate === null

    const toDisplay = (value: number | null | undefined): Converted =>
      convert(typeof value === 'number' ? value : null, base, code, rate, Date.now())

    const money = (value: number | null | undefined, options: FormatOptions = {}): MoneyResult => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { value: null, text: '—', fellBack: false, freshness: 'unavailable' }
      }
      const converted = toDisplay(value)
      if (converted.value === null) {
        // No rate: the source-currency price, which is true, rather than this number wearing the wrong symbol.
        return {
          value,
          text: formatMoney(value, base, { compact, ...options }),
          fellBack: true,
          freshness: 'unavailable'
        }
      }
      return {
        value: converted.value,
        text: formatMoney(converted.value, code, { compact, ...options }),
        fellBack: false,
        freshness: converted.freshness
      }
    }

    const at = answer?.rate?.at ?? null
    const rateNote = !converting
      ? ''
      : rate === null
        ? 'No exchange rate is available, so prices are shown in their source currency.'
        : `Converted from ${base} at ${rate.rate.toLocaleString(undefined, { maximumFractionDigits: 4 })}, ${
            at ? `from ${new Date(at).toLocaleDateString()}` : 'date unknown'
          }${answer?.fxSource ? ` (${answer.fxSource})` : ''}.`

    return {
      answer,
      code,
      currency: currencyFor(code),
      base,
      converting,
      unavailable,
      rateNote,
      money,
      toDisplay,
      format: (value, options = {}) => formatMoney(value, code, { compact, ...options }),
      amount: (value, options = {}) => formatAmount(value, code, { compact, ...options }),
      // Never the market's alone: converting through an old rate makes a live price something less than live.
      freshnessOf: (marketFreshness) =>
        converting ? combinedFreshness(marketFreshness, answer?.freshness ?? 'unavailable') : marketFreshness,
      choose: async (wanted: string) => {
        const got = await window.api.marketsSetCurrency(wanted)
        if (!refused(got)) setAnswer(got)
      },
      reset: async () => {
        const got = await window.api.marketsResetCurrency()
        if (!refused(got)) setAnswer(got)
      },
      refresh,
      compact
    }
  }, [answer, refresh])
}
