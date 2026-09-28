/**
 * Money, in whatever the person actually uses.
 *
 * Three separate things live here and are deliberately kept apart:
 *
 *  - **What a currency is** — its code, name, symbol and how many decimals it really has. A registry, so the ticker and
 *    the portfolio cannot disagree about whether the yen has cents.
 *  - **Which one to use** — decided from what Orbis already knows about the person's region, never from asking for their
 *    coordinates. A currency preference is not worth a location permission.
 *  - **How to say a number in it** — through `Intl`, which knows that a lakh is grouped differently from a thousand.
 *
 * What is *not* here is the exchange rate. A rate is data with a time on it and a source, so it comes from a provider
 * like every other number in Markets, and a converted price carries the rate's freshness as well as the market's. A
 * price that is live in dollars and converted through yesterday's rate is not a live price in rupees, and this module
 * exists partly to make that impossible to forget.
 */

export interface Currency {
  code: string
  name: string
  symbol: string
  /** How many decimal places this currency really has. The yen has none; the dinar has three. */
  decimals: number
  /** A locale that formats this currency the way its users expect. */
  locale: string
  /** Where it is the everyday currency, as ISO 3166 alpha-2. */
  countries: string[]
}

/**
 * The currencies Orbis offers.
 *
 * Decimals are the currency's own, not two everywhere: writing ¥1,500.00 is wrong in a way that looks like a rounding
 * bug, and writing KWD 1.23 loses a digit that matters.
 */
export const CURRENCIES: Currency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, locale: 'en-US', countries: ['US', 'EC', 'SV', 'PA', 'TL', 'ZW'] },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, locale: 'de-DE', countries: ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'IE', 'FI', 'GR', 'SK', 'SI', 'LT', 'LV', 'EE', 'LU', 'CY', 'MT', 'HR'] },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2, locale: 'en-GB', countries: ['GB'] },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, locale: 'en-IN', countries: ['IN'] },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, locale: 'ja-JP', countries: ['JP'] },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2, locale: 'zh-CN', countries: ['CN'] },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', decimals: 0, locale: 'ko-KR', countries: ['KR'] },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2, locale: 'en-AU', countries: ['AU'] },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2, locale: 'en-CA', countries: ['CA'] },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimals: 2, locale: 'de-CH', countries: ['CH', 'LI'] },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2, locale: 'en-SG', countries: ['SG'] },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', decimals: 2, locale: 'zh-HK', countries: ['HK'] },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', decimals: 2, locale: 'en-NZ', countries: ['NZ'] },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', decimals: 2, locale: 'sv-SE', countries: ['SE'] },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', decimals: 2, locale: 'nb-NO', countries: ['NO'] },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', decimals: 2, locale: 'da-DK', countries: ['DK'] },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', decimals: 2, locale: 'pl-PL', countries: ['PL'] },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', decimals: 2, locale: 'cs-CZ', countries: ['CZ'] },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', decimals: 2, locale: 'hu-HU', countries: ['HU'] },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', decimals: 2, locale: 'tr-TR', countries: ['TR'] },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2, locale: 'en-ZA', countries: ['ZA'] },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimals: 2, locale: 'pt-BR', countries: ['BR'] },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', decimals: 2, locale: 'es-MX', countries: ['MX'] },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimals: 2, locale: 'ar-AE', countries: ['AE'] },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', decimals: 2, locale: 'ar-SA', countries: ['SA'] },
  { code: 'QAR', name: 'Qatari Riyal', symbol: '﷼', decimals: 2, locale: 'ar-QA', countries: ['QA'] },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', decimals: 3, locale: 'ar-KW', countries: ['KW'] },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب', decimals: 3, locale: 'ar-BH', countries: ['BH'] },
  { code: 'OMR', name: 'Omani Rial', symbol: '﷼', decimals: 3, locale: 'ar-OM', countries: ['OM'] },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪', decimals: 2, locale: 'he-IL', countries: ['IL'] },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', decimals: 2, locale: 'th-TH', countries: ['TH'] },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', decimals: 2, locale: 'ms-MY', countries: ['MY'] },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimals: 2, locale: 'id-ID', countries: ['ID'] },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', decimals: 2, locale: 'en-PH', countries: ['PH'] },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', decimals: 0, locale: 'vi-VN', countries: ['VN'] },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$', decimals: 2, locale: 'zh-TW', countries: ['TW'] }
]

/** The ones offered before somebody searches. Not a judgement about importance — just the most commonly asked for. */
export const SUGGESTED = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SGD']

const BY_CODE = new Map(CURRENCIES.map((one) => [one.code, one]))

export const currencyFor = (code: string): Currency | undefined => BY_CODE.get(String(code ?? '').toUpperCase())

export const isSupported = (code: string): boolean => BY_CODE.has(String(code ?? '').toUpperCase())

/** The currency of a country, by ISO 3166 alpha-2. Undefined when Orbis does not offer that country's currency. */
export function currencyForCountry(country: string): Currency | undefined {
  const wanted = String(country ?? '').toUpperCase()
  if (wanted.length !== 2) return undefined
  return CURRENCIES.find((one) => one.countries.includes(wanted))
}

/**
 * The currency implied by a locale, from its region.
 *
 * The region, not the language. `en-IN` is rupees and `en-US` is dollars, and reading "English" as "dollars" is how an
 * application tells somebody in Mumbai what their coffee costs in a currency they do not use.
 */
export function currencyForLocale(locale: string): Currency | undefined {
  const tag = String(locale ?? '').trim()
  if (!tag) return undefined
  // `Intl.Locale` understands `en-Latn-IN` and `zh-Hant-TW`; splitting on dashes does not.
  try {
    const region = new Intl.Locale(tag).maximize().region
    if (region) {
      const found = currencyForCountry(region)
      if (found) return found
    }
  } catch {
    // An unparseable tag is not a region. Falls through to the simple reading below.
  }
  const parts = tag.split(/[-_]/)
  const last = parts[parts.length - 1]
  return last && last.length === 2 ? currencyForCountry(last) : undefined
}

export type CurrencyMode = 'automatic' | 'manual'

export interface CurrencyPreference {
  mode: CurrencyMode
  /** What is displayed. In automatic mode this is what detection settled on. */
  code: string
  /** The region detection used, for the settings screen to explain itself. Empty when nothing was detected. */
  detectedRegion: string
  /** Currencies pinned to the top of the chooser. */
  favourites: string[]
  /** Recently chosen, newest first, bounded. */
  recents: string[]
  /** Whether large numbers are shortened. */
  compact: boolean
}

export const DEFAULT_CURRENCY_PREFERENCE: CurrencyPreference = {
  mode: 'automatic',
  // Not a claim about the right currency — just the one Orbis falls back to when it has learned nothing at all.
  code: 'USD',
  detectedRegion: '',
  favourites: [],
  recents: [],
  compact: true
}

export interface DetectionSignals {
  /** What the operating system or browser says, for example `en-IN`. */
  locale?: string
  /** A region Orbis already knows for another reason, as ISO 3166 alpha-2. */
  region?: string
}

export interface Detection {
  currency: Currency
  /** Which signal decided it, so the settings screen can say rather than imply. */
  from: 'region' | 'locale' | 'fallback'
  region: string
}

/**
 * Which currency to start with.
 *
 * A strict order, and nothing in it is a location request: a region Orbis already has, then the system locale, then
 * dollars. There is deliberately no step that asks for coordinates — a currency preference is not worth a location
 * permission, and a coarse region answers the question just as well.
 */
export function detectCurrency(signals: DetectionSignals): Detection {
  const region = String(signals.region ?? '').toUpperCase()
  if (region.length === 2) {
    const found = currencyForCountry(region)
    if (found) return { currency: found, from: 'region', region }
  }
  const byLocale = signals.locale ? currencyForLocale(signals.locale) : undefined
  if (byLocale) {
    let where = ''
    try {
      where = new Intl.Locale(signals.locale as string).maximize().region ?? ''
    } catch {
      where = ''
    }
    return { currency: byLocale, from: 'locale', region: where }
  }
  return { currency: BY_CODE.get('USD') as Currency, from: 'fallback', region: '' }
}

/**
 * The preference after detection, respecting what the person chose.
 *
 * Manual wins, always and permanently. Somebody who switched to dollars while travelling did not ask to be switched
 * back when they landed, and an application that keeps undoing a choice is one nobody trusts with a setting.
 */
export function resolvePreference(saved: CurrencyPreference, signals: DetectionSignals): CurrencyPreference {
  if (saved.mode === 'manual' && isSupported(saved.code)) return saved
  const detected = detectCurrency(signals)
  return { ...saved, mode: 'automatic', code: detected.currency.code, detectedRegion: detected.region }
}

// ---------------------------------------------------------------- saying a number

export interface FormatOptions {
  /** Shorten large numbers: 1.2M rather than 1,200,000. */
  compact?: boolean
  /** Override the currency's own decimals — for a crypto price of 0.00001234, which needs more. */
  decimals?: number
  /** Show the code as well as the symbol, for currencies whose symbol is ambiguous. */
  withCode?: boolean
}

/** Currencies whose symbol alone does not say which currency it is. */
const AMBIGUOUS = new Set(['USD', 'AUD', 'CAD', 'SGD', 'NZD', 'HKD', 'MXN', 'BRL', 'TWD', 'CNY', 'JPY', 'SEK', 'NOK', 'DKK', 'SAR', 'QAR', 'OMR'])

export const symbolIsAmbiguous = (code: string): boolean => AMBIGUOUS.has(String(code ?? '').toUpperCase())

/**
 * How many decimals a price deserves.
 *
 * A currency's own decimals for ordinary amounts, and more for a price small enough that two would hide all of it: a
 * token at 0.00001234 formatted to two decimals is 0.00, which is not a rounding error but a deleted price.
 */
export function decimalsFor(currency: Currency, value: number): number {
  const abs = Math.abs(value)
  if (!Number.isFinite(value) || abs === 0) return currency.decimals
  if (abs >= 1) return currency.decimals
  if (abs >= 0.01) return Math.max(currency.decimals, 4)
  if (abs >= 0.0001) return Math.max(currency.decimals, 6)
  return Math.max(currency.decimals, 8)
}

/**
 * An amount, written the way its currency is written.
 *
 * Through `Intl`, which groups Indian numbers in lakhs and puts the euro sign where German readers expect it. Writing
 * the grouping by hand is how ₹1,234,567 appears in an application used in India.
 */
export function formatMoney(value: number | null | undefined, code: string, options: FormatOptions = {}): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const currency = currencyFor(code)
  if (!currency) return value.toLocaleString()

  const decimals = options.decimals ?? decimalsFor(currency, value)
  const compact = options.compact === true && Math.abs(value) >= 10_000

  try {
    const formatted = new Intl.NumberFormat(currency.locale, {
      style: 'currency',
      currency: currency.code,
      notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: compact ? 0 : Math.min(decimals, currency.decimals),
      maximumFractionDigits: compact ? 2 : decimals
    }).format(value)
    return options.withCode && symbolIsAmbiguous(currency.code) ? `${formatted} ${currency.code}` : formatted
  } catch {
    // A runtime without this currency's data still has to print something true.
    return `${currency.symbol}${value.toFixed(Math.min(decimals, 8))}`
  }
}

/** A plain number in a currency's conventions, without the symbol — for an axis, where the symbol is in the label. */
export function formatAmount(value: number | null | undefined, code: string, options: FormatOptions = {}): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const currency = currencyFor(code) ?? { locale: 'en-US', decimals: 2 }
  const decimals = options.decimals ?? decimalsFor(currency as Currency, value)
  const compact = options.compact === true && Math.abs(value) >= 10_000
  try {
    return new Intl.NumberFormat(currency.locale, {
      notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: 0,
      maximumFractionDigits: compact ? 2 : decimals
    }).format(value)
  } catch {
    return value.toFixed(Math.min(decimals, 8))
  }
}

/** Currencies matching what somebody typed: the code, the name, or the symbol. */
export function searchCurrencies(query: string): Currency[] {
  const wanted = String(query ?? '').trim().toLowerCase()
  if (!wanted) return CURRENCIES
  return CURRENCIES.filter(
    (one) =>
      one.code.toLowerCase().includes(wanted) ||
      one.name.toLowerCase().includes(wanted) ||
      one.symbol.toLowerCase().includes(wanted) ||
      // "dollar" should find every dollar, which is why the code is always shown beside the symbol.
      one.name.toLowerCase().split(' ').some((word) => word.startsWith(wanted))
  )
}

// ---------------------------------------------------------------- converting

export type RateFreshness = 'real-time' | 'recent' | 'stale' | 'unavailable'

export interface Rate {
  from: string
  to: string
  rate: number
  /** When the provider says the rate was true. */
  at: number
  source: string
}

export interface Converted {
  /** Null when there is no rate. A price with no conversion is not a price of zero. */
  value: number | null
  rate: number | null
  at: number | null
  source: string | null
  freshness: RateFreshness
}

/**
 * How old a rate may be before it stops being described as current.
 *
 * Shaped by how the data is actually published rather than by round numbers. Reference rates come out once each working
 * day, so Friday's rate is the current rate all weekend — calling it stale on a Monday morning would be crying wolf
 * about the ordinary case, and a warning that fires every weekend is one nobody reads by the second week.
 *
 * Past four days, though, something has genuinely gone wrong: even a long public holiday does not close the market that
 * long, so the rate is old and the interface should say so.
 */
export const RATE_RECENT_MS = 18 * 3600_000
export const RATE_STALE_MS = 96 * 3600_000

export function freshnessOfRate(at: number | null, now: number): RateFreshness {
  if (at === null || !Number.isFinite(at)) return 'unavailable'
  const age = now - at
  if (age < 0) return 'recent'
  if (age <= RATE_RECENT_MS) return 'real-time'
  if (age <= RATE_STALE_MS) return 'recent'
  return 'stale'
}

/**
 * Converts an amount, or says why it could not.
 *
 * Same currency both ways is not a conversion and is reported as such, with no rate and no age — otherwise a dollar
 * price would carry a dollar-to-dollar rate's freshness and eventually be called stale.
 */
export function convert(value: number | null, from: string, to: string, rate: Rate | null, now: number): Converted {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { value: null, rate: null, at: null, source: null, freshness: 'unavailable' }
  }
  const source = String(from ?? '').toUpperCase()
  const target = String(to ?? '').toUpperCase()
  if (source === target) return { value, rate: 1, at: null, source: null, freshness: 'real-time' }

  if (!rate || !Number.isFinite(rate.rate) || rate.rate <= 0) {
    // No invented number. The caller shows the source-currency price instead, which is true.
    return { value: null, rate: null, at: null, source: null, freshness: 'unavailable' }
  }
  return {
    value: value * rate.rate,
    rate: rate.rate,
    at: rate.at,
    source: rate.source,
    freshness: freshnessOfRate(rate.at, now)
  }
}

/**
 * The freshness of a converted price: the worse of the market's and the rate's.
 *
 * A live dollar price through yesterday's rate is not a live rupee price, and saying so is the whole reason this
 * function exists rather than the market's freshness being passed through.
 */
export function combinedFreshness(market: string, rate: RateFreshness): string {
  const order = ['real-time', 'recent', 'delayed', 'stale', 'unavailable']
  const marketRank = order.indexOf(market) === -1 ? order.length - 1 : order.indexOf(market)
  const rateRank = order.indexOf(rate) === -1 ? order.length - 1 : order.indexOf(rate)
  return order[Math.max(marketRank, rateRank)]
}

// ---------------------------------------------------------------- reading one back

const text = (value: unknown, max: number, fallback = ''): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : fallback

export function cleanCurrencyPreference(raw: unknown): CurrencyPreference {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CURRENCY_PREFERENCE }
  const o = raw as Record<string, unknown>
  const code = text(o.code, 8).toUpperCase()
  const list = (value: unknown, max: number): string[] => {
    const out: string[] = []
    for (const one of Array.isArray(value) ? value : []) {
      const wanted = text(one, 8).toUpperCase()
      // A currency Orbis no longer offers is dropped rather than kept as a choice that cannot be made.
      if (isSupported(wanted) && !out.includes(wanted)) out.push(wanted)
      if (out.length >= max) break
    }
    return out
  }
  return {
    mode: o.mode === 'manual' ? 'manual' : 'automatic',
    code: isSupported(code) ? code : DEFAULT_CURRENCY_PREFERENCE.code,
    detectedRegion: text(o.detectedRegion, 2).toUpperCase(),
    favourites: list(o.favourites, 12),
    recents: list(o.recents, 8),
    compact: o.compact !== false
  }
}
