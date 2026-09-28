import type { PaperPosition } from './paper.ts'

/**
 * Leverage, margin and liquidation, as a simulation.
 *
 * **This is Orbis's model, not an exchange's rules.** Every venue computes maintenance margin differently — tiered by
 * position size, adjusted for insurance funds, with its own mark price and its own liquidation mechanics. A number from
 * this file is what *this model* says, and every screen that shows one says so beside it.
 *
 * That honesty is the whole point. A liquidation price presented as though it came from an exchange would be the single
 * most dangerous number Orbis could display: somebody would size a position against it. So the model is simple, stated,
 * and labelled — and it is never described as the price at which a real venue would close a real position.
 *
 * Two rules underneath:
 *
 * **A position with no leverage has no liquidation price.** Spot holdings cannot be liquidated; a long that is fully
 * paid for goes to zero at worst. Returning a number for those would be inventing a risk that does not exist.
 *
 * **Nothing here is annualised, projected or predicted.** These are arithmetic on a position as it stands.
 */

/** Maintenance margin as a fraction of notional. Orbis's own figure, flat rather than tiered, and said to be so. */
export const MAINTENANCE_RATE = 0.005

/** The most leverage the simulator will apply. Not a venue's limit — a limit on how wrong this model can be. */
export const MAX_LEVERAGE = 50

export interface MarginSettings {
  /**
   * Whether positions are margined at all.
   *
   * Off by default. A simulation that quietly leveraged a position would be teaching the wrong lesson about the most
   * consequential decision in trading.
   */
  enabled: boolean
  /** How many times equity a position may be. 1 is no leverage, which is the same as off for every calculation. */
  leverage: number
  /** Maintenance margin as a fraction of notional. */
  maintenanceRate: number
}

export const DEFAULT_MARGIN: MarginSettings = {
  enabled: false,
  leverage: 1,
  maintenanceRate: MAINTENANCE_RATE
}

/** A leverage setting read from anywhere. Clamped, so a file cannot ask for a thousand times. */
export function cleanLeverage(raw: unknown): number {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1
  if (value < 1) return 1
  if (value > MAX_LEVERAGE) return MAX_LEVERAGE
  return Math.round(value * 100) / 100
}

export function cleanMargin(raw: unknown): MarginSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MARGIN }
  const o = raw as Record<string, unknown>
  const rate =
    typeof o.maintenanceRate === 'number' && Number.isFinite(o.maintenanceRate) && o.maintenanceRate > 0 && o.maintenanceRate < 0.5
      ? o.maintenanceRate
      : MAINTENANCE_RATE
  return {
    enabled: o.enabled === true,
    leverage: cleanLeverage(o.leverage),
    maintenanceRate: rate
  }
}

/** What a position costs to hold and what it is worth, under this model. */
export interface PositionMargin {
  /** Price times size, ignoring which way it points. */
  notional: number
  /** What is set aside for it: notional divided by leverage. */
  initialMargin: number
  /** The least that may be set aside before it is closed out. */
  maintenanceMargin: number
  /** Profit or loss at the current price. Negative eats into the margin. */
  unrealised: number
  /** Margin plus unrealised. What the position is actually worth to the account. */
  equity: number
  /**
   * The price at which equity would reach maintenance margin, under this model.
   *
   * Null for an unleveraged position, because one cannot be liquidated. Null also when the inputs do not allow it to be
   * worked out — never a zero, which would read as "liquidates at zero" rather than "unknown".
   */
  liquidationPrice: number | null
  /** How far that is from the current price, as a fraction. Null for the same reasons. */
  distanceFraction: number | null
}

/**
 * One position's margin, at a price.
 *
 * `leverage` of 1 means no leverage, and the liquidation price is null — which is the correct answer for a spot holding
 * and the reason this is not simply arithmetic that always produces a number.
 */
export function marginOf(
  position: Pick<PaperPosition, 'quantity' | 'averagePrice'>,
  price: number | null,
  settings: MarginSettings
): PositionMargin | null {
  const size = Math.abs(position.quantity)
  if (!(size > 0) || !Number.isFinite(position.averagePrice) || position.averagePrice <= 0) return null
  if (price === null || !Number.isFinite(price) || price <= 0) return null

  const leverage = settings.enabled ? cleanLeverage(settings.leverage) : 1
  const notional = price * size
  const initialMargin = (position.averagePrice * size) / leverage
  const maintenanceMargin = notional * settings.maintenanceRate
  const long = position.quantity > 0
  const unrealised = long ? (price - position.averagePrice) * size : (position.averagePrice - price) * size
  const equity = initialMargin + unrealised

  if (leverage <= 1) {
    // No leverage, no liquidation. A fully paid long is not closed out by the venue; it is simply worth less.
    return {
      notional,
      initialMargin,
      maintenanceMargin,
      unrealised,
      equity,
      liquidationPrice: null,
      distanceFraction: null
    }
  }

  /*
   * Where equity meets maintenance margin.
   *
   * For a long: margin + (P − entry)·size = P·size·rate, so P = (margin − entry·size) / (size·(rate − 1)).
   * For a short the sign of the unrealised term flips. Solved rather than stepped, so it is exact for this model.
   */
  const denominator = long ? size * (settings.maintenanceRate - 1) : size * (settings.maintenanceRate + 1)
  const numerator = long
    ? initialMargin - position.averagePrice * size
    : initialMargin + position.averagePrice * size
  const solved = denominator === 0 ? null : numerator / denominator

  // A liquidation price at or below zero is not reachable, so there is none: a long at low leverage runs out of market
  // before it runs out of margin.
  const liquidationPrice = solved !== null && Number.isFinite(solved) && solved > 0 ? solved : null
  return {
    notional,
    initialMargin,
    maintenanceMargin,
    unrealised,
    equity,
    liquidationPrice,
    distanceFraction: liquidationPrice !== null && price > 0 ? Math.abs(price - liquidationPrice) / price : null
  }
}

/** Whether this position would be closed out at this price, under this model. */
export function wouldLiquidate(
  position: Pick<PaperPosition, 'quantity' | 'averagePrice'>,
  price: number | null,
  settings: MarginSettings
): boolean {
  if (!settings.enabled || cleanLeverage(settings.leverage) <= 1) return false
  const margin = marginOf(position, price, settings)
  if (!margin) return false
  /*
   * A tolerance, because the boundary is exactly where this is asked.
   *
   * The liquidation price is solved so that equity equals maintenance margin there -- and at that price the two differ
   * by about 1e-16, which way round depending on the arithmetic. Without a tolerance the model disagrees with the price
   * it just produced, which is the kind of inconsistency nobody can debug from a screen.
   */
  const tolerance = Math.max(Math.abs(margin.maintenanceMargin), 1) * 1e-9
  return margin.equity <= margin.maintenanceMargin + tolerance
}

/** The whole account's margin picture. */
export interface AccountMargin {
  /** Every position's notional added up, whichever way each points. */
  grossNotional: number
  /** Longs minus shorts, so a hedged book reads as small rather than large. */
  netNotional: number
  marginUsed: number
  maintenanceRequired: number
  /** Cash plus every position's equity. */
  equity: number
  /** Equity over maintenance required. Null when nothing requires maintenance. */
  marginRatio: number | null
  /** Gross notional over equity. Null when there is no equity to divide by. */
  effectiveLeverage: number | null
  /** Positions this model says would be closed out at the prices given. */
  atRisk: string[]
  /** Positions that could not be valued, so none of the above includes them. */
  missingPrices: string[]
}

export function accountMargin(
  positions: readonly PaperPosition[],
  cash: number,
  prices: Map<string, number | null>,
  settings: MarginSettings
): AccountMargin {
  let grossNotional = 0
  let netNotional = 0
  let marginUsed = 0
  let maintenanceRequired = 0
  let positionEquity = 0
  const atRisk: string[] = []
  const missingPrices: string[] = []

  for (const position of positions) {
    const price = prices.get(position.instrumentId) ?? null
    const margin = marginOf(position, price, settings)
    if (!margin) {
      // Left out of every total and named, rather than valued at zero -- which would show a loss that never happened.
      missingPrices.push(position.instrumentId)
      continue
    }
    grossNotional += margin.notional
    netNotional += (price ?? 0) * position.quantity
    marginUsed += margin.initialMargin
    maintenanceRequired += margin.maintenanceMargin
    positionEquity += margin.equity
    if (wouldLiquidate(position, price, settings)) atRisk.push(position.instrumentId)
  }

  const equity = cash + positionEquity
  return {
    grossNotional,
    netNotional,
    marginUsed,
    maintenanceRequired,
    equity,
    // Null rather than infinity when nothing needs maintaining, which is the state of an account with no leverage.
    marginRatio: maintenanceRequired > 0 ? equity / maintenanceRequired : null,
    effectiveLeverage: equity > 0 ? grossNotional / equity : null,
    atRisk,
    missingPrices
  }
}

/** What this model assumed, in words, so no figure from it is ever read without them. */
export const MARGIN_ASSUMPTIONS: string[] = [
  'Leverage and liquidation are simulated by Orbis, not by an exchange.',
  `Maintenance margin is a flat ${(MAINTENANCE_RATE * 100).toFixed(1)}% of notional. Real venues tier it by position size.`,
  'Liquidation is computed from the last traded price. Venues use their own mark price.',
  'There is no insurance fund, no partial liquidation and no auto-deleveraging.',
  'A liquidation price from this model is not the price at which a real exchange would close a real position.'
]
