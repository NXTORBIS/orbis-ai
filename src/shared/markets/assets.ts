import type { Instrument } from './instrument.ts'

/**
 * What an asset *is*, as opposed to what it is trading at.
 *
 * One registry, so that BTC is Bitcoin with the Bitcoin logo everywhere it appears — the ticker, a watchlist row, a
 * search result, a portfolio holding, an alert, an Orion answer. The alternative is each surface resolving its own
 * icon, which is how an application ends up showing one coin's logo beside another coin's price.
 *
 * Three rules, and the first two are about not lying:
 *
 * **A pair is not an asset.** `BTCUSDT` is a market; `BTC` is the thing being bought. The logo belongs to the asset, so
 * the quote currency is stripped before anything is looked up. Using the exchange's symbol directly would ask for a
 * logo for "BTCUSDT", which does not exist and never will.
 *
 * **A name is not invented from a ticker.** `BTC` is Bitcoin because that is a fact worth writing down; `ZZZ` is `ZZZ`,
 * not "Zzz Coin". An asset Orbis cannot name keeps its symbol, and an asset Orbis has no logo for gets a neutral mark
 * with its own letters — never a generic coin that makes every unknown asset look identical, and never another asset's
 * logo.
 *
 * **Symbols collide.** The identity carries the provider and the exchange it came from, so a future second provider
 * calling something `SOL` cannot silently inherit Solana's logo.
 */

export interface AssetIdentity {
  /** Canonical across Orbis: `crypto:btc`. Stable, lower case, and never an exchange's pair symbol. */
  assetId: string
  /** The base asset's ticker, upper case. */
  symbol: string
  /** What it is called. The symbol itself when Orbis cannot honestly name it. */
  name: string
  /** Whether `name` is a real name or a stand-in for one, so a caller can choose not to show it twice. */
  named: boolean
  /** Where a logo can be fetched, or null when there is no point trying. */
  logoUrl: string | null
  logoSource: string | null
  /** Other ways somebody might write it, for matching prose and search. */
  aliases: string[]
}

/**
 * The icons, from a real published set.
 *
 * `cryptocurrency-icons` on a public CDN: CC0, so there is no licence to honour and nothing to attribute, and it is a
 * set somebody maintains rather than images scraped from exchanges. A symbol it does not have answers 404 and the
 * interface falls back — which is why nothing here needs a list of what the set contains.
 */
const LOGO_BASE = 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color'
export const LOGO_SOURCE = 'cryptocurrency-icons (CC0)'

/** The shape a symbol must have for a logo to be worth asking for. */
const LOGO_SHAPED = /^[A-Z0-9]{2,10}$/

/**
 * Names Orbis can stand behind, with how people write them.
 *
 * Deliberately finite. Every entry is an asset whose name is well enough established to print beside a price; anything
 * absent keeps its ticker, which is true rather than plausible.
 */
const KNOWN: Record<string, { name: string; aliases?: string[] }> = {
  BTC: { name: 'Bitcoin', aliases: ['bitcoin', 'xbt'] },
  ETH: { name: 'Ethereum', aliases: ['ethereum', 'ether'] },
  USDT: { name: 'Tether', aliases: ['tether'] },
  USDC: { name: 'USD Coin', aliases: ['usd coin'] },
  BNB: { name: 'BNB', aliases: ['binance coin'] },
  SOL: { name: 'Solana', aliases: ['solana'] },
  XRP: { name: 'XRP', aliases: ['ripple'] },
  ADA: { name: 'Cardano', aliases: ['cardano'] },
  DOGE: { name: 'Dogecoin', aliases: ['dogecoin'] },
  TRX: { name: 'TRON', aliases: ['tron'] },
  TON: { name: 'Toncoin', aliases: ['toncoin'] },
  AVAX: { name: 'Avalanche', aliases: ['avalanche'] },
  DOT: { name: 'Polkadot', aliases: ['polkadot'] },
  LINK: { name: 'Chainlink', aliases: ['chainlink'] },
  MATIC: { name: 'Polygon', aliases: ['polygon'] },
  POL: { name: 'Polygon', aliases: ['polygon'] },
  LTC: { name: 'Litecoin', aliases: ['litecoin'] },
  SHIB: { name: 'Shiba Inu', aliases: ['shiba inu'] },
  BCH: { name: 'Bitcoin Cash', aliases: ['bitcoin cash'] },
  UNI: { name: 'Uniswap', aliases: ['uniswap'] },
  ATOM: { name: 'Cosmos', aliases: ['cosmos'] },
  XLM: { name: 'Stellar', aliases: ['stellar'] },
  NEAR: { name: 'NEAR Protocol', aliases: ['near protocol'] },
  ARB: { name: 'Arbitrum', aliases: ['arbitrum'] },
  OP: { name: 'Optimism', aliases: ['optimism'] },
  APT: { name: 'Aptos', aliases: ['aptos'] },
  SUI: { name: 'Sui', aliases: ['sui network'] },
  FIL: { name: 'Filecoin', aliases: ['filecoin'] },
  ICP: { name: 'Internet Computer', aliases: ['internet computer'] },
  HBAR: { name: 'Hedera', aliases: ['hedera'] },
  VET: { name: 'VeChain', aliases: ['vechain'] },
  ALGO: { name: 'Algorand', aliases: ['algorand'] },
  XMR: { name: 'Monero', aliases: ['monero'] },
  ETC: { name: 'Ethereum Classic', aliases: ['ethereum classic'] },
  AAVE: { name: 'Aave', aliases: ['aave'] },
  MKR: { name: 'Maker', aliases: ['maker'] },
  INJ: { name: 'Injective', aliases: ['injective'] },
  RUNE: { name: 'THORChain', aliases: ['thorchain'] },
  GRT: { name: 'The Graph', aliases: ['the graph'] },
  SAND: { name: 'The Sandbox', aliases: ['the sandbox'] },
  MANA: { name: 'Decentraland', aliases: ['decentraland'] },
  AXS: { name: 'Axie Infinity', aliases: ['axie infinity'] },
  FTM: { name: 'Fantom', aliases: ['fantom'] },
  EOS: { name: 'EOS' },
  XTZ: { name: 'Tezos', aliases: ['tezos'] },
  THETA: { name: 'Theta Network', aliases: ['theta'] },
  EGLD: { name: 'MultiversX', aliases: ['multiversx', 'elrond'] },
  FLOW: { name: 'Flow' },
  CHZ: { name: 'Chiliz', aliases: ['chiliz'] },
  ZEC: { name: 'Zcash', aliases: ['zcash'] },
  DASH: { name: 'Dash' },
  COMP: { name: 'Compound', aliases: ['compound'] },
  CRV: { name: 'Curve DAO', aliases: ['curve'] },
  SNX: { name: 'Synthetix', aliases: ['synthetix'] },
  LDO: { name: 'Lido DAO', aliases: ['lido'] },
  STX: { name: 'Stacks', aliases: ['stacks'] },
  IMX: { name: 'Immutable', aliases: ['immutable'] },
  RNDR: { name: 'Render', aliases: ['render'] },
  PEPE: { name: 'Pepe', aliases: ['pepe'] },
  WIF: { name: 'dogwifhat', aliases: ['dogwifhat'] },
  BONK: { name: 'Bonk', aliases: ['bonk'] },
  DAI: { name: 'Dai', aliases: ['dai'] },
  BUSD: { name: 'Binance USD' },
  WBTC: { name: 'Wrapped Bitcoin', aliases: ['wrapped bitcoin'] }
}

/**
 * The quote currencies a pair's symbol may end with.
 *
 * Longest first, because `BTCUSDT` ends with both `USDT` and `T`, and trimming the shorter one would leave `BTCUSD`
 * and look for a logo that does not exist.
 */
const QUOTES = [
  'USDT',
  'USDC',
  'BUSD',
  'FDUSD',
  'TUSD',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'TRY',
  'BRL',
  'ARS',
  'BIDR',
  'IDRT',
  'NGN',
  'RUB',
  'UAH',
  'ZAR',
  'PLN',
  'RON',
  'CZK',
  'BTC',
  'ETH',
  'BNB',
  'DAI'
].sort((a, b) => b.length - a.length)

/**
 * The base asset of a market symbol.
 *
 * `BTCUSDT` is Bitcoin bought with Tether, so the asset is `BTC`. A symbol that is entirely its own quote currency —
 * `USDTUSD`, say — keeps the whole thing rather than being trimmed to nothing.
 */
export function baseSymbol(symbol: string, currency = ''): string {
  const upper = String(symbol ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!upper) return ''

  // The provider's own quote currency first: it knows the pair better than any suffix list.
  const quote = String(currency ?? '').toUpperCase()
  if (quote && upper.endsWith(quote) && upper.length > quote.length) return upper.slice(0, -quote.length)

  for (const one of QUOTES) {
    if (upper.endsWith(one) && upper.length > one.length) return upper.slice(0, -one.length)
  }
  return upper
}

/** The identity of one base asset. Always answers — an unknown asset is an identity with no logo and its own name. */
export function assetFor(base: string, provider = 'crypto'): AssetIdentity {
  const symbol = String(base ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const known = KNOWN[symbol]
  return {
    // The provider is part of it, so a future second provider calling something `SOL` cannot silently inherit
    // Solana's logo.
    assetId: `${String(provider ?? 'crypto').toLowerCase()}:${symbol.toLowerCase()}`,
    symbol,
    name: known?.name ?? symbol,
    named: known !== undefined,
    // Worth asking for only when the symbol could be one. The set answers 404 for the rest and the interface falls back.
    logoUrl: symbol && LOGO_SHAPED.test(symbol) ? `${LOGO_BASE}/${symbol.toLowerCase()}.svg` : null,
    logoSource: symbol && LOGO_SHAPED.test(symbol) ? LOGO_SOURCE : null,
    aliases: known?.aliases ?? []
  }
}

/**
 * The identity of what an instrument is a market in.
 *
 * Prefers the provider's own base-asset metadata, because the provider knows its own pairs; falls back to trimming the
 * quote currency off the symbol, which is what a pair's symbol is made of.
 */
export function assetOf(instrument: Instrument): AssetIdentity {
  const meta = instrument.metadata as { base?: unknown } | undefined
  const base =
    typeof meta?.base === 'string' && meta.base
      ? meta.base
      : baseSymbol(instrument.symbol, instrument.currency)
  return assetFor(base, instrument.provider || 'crypto')
}

/** Every alias in the registry, for matching prose. One registry, so news and search agree about what names an asset. */
export const aliasesFor = (symbol: string): string[] => KNOWN[String(symbol ?? '').toUpperCase()]?.aliases ?? []

/** Every symbol Orbis can name, for callers that need the set. */
export const namedSymbols = (): string[] => Object.keys(KNOWN)

/**
 * How large a logo is drawn.
 *
 * Named rather than left to each caller, so the ticker and a table do not drift into slightly different sizes — and so
 * the sizes asked of the CDN stay few enough to be cached.
 */
export const LOGO_SIZES = { tiny: 14, small: 18, medium: 24, large: 40, hero: 56 } as const
export type LogoSize = keyof typeof LOGO_SIZES

/** What a screen reader should hear. The logo is never the only thing saying which asset this is. */
export function describeAsset(asset: AssetIdentity): string {
  return asset.named ? `${asset.name} (${asset.symbol})` : asset.symbol
}
