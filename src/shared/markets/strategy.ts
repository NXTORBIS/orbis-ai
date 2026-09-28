import { calculate, type Candle, type IndicatorKind, type Series } from './indicators.ts'

/**
 * A strategy: rules a machine can evaluate the same way twice.
 *
 * Deliberately not a language. Every rule compares two operands, and an operand is either a number, a price, or one
 * indicator from the shared engine — the same engine the charts and the screener use, so an EMA(50) in a strategy is the
 * EMA(50) somebody looked at before writing it. Nothing here can express "and then it felt like it was going up", and
 * that is the point: a rule that cannot be evaluated identically on two runs cannot be backtested.
 *
 * The one thing worth understanding about the shape: **every indicator series is causal.** `sma[i]` is computed from
 * candles up to and including `i` and from nothing after it. That is what makes it safe to compute the whole series once
 * and then walk it — the alternative, recomputing over a growing slice at every bar, is the same arithmetic done
 * thousands of times over. It is also the property the backtester depends on entirely, so it is asserted in the tests
 * rather than assumed here.
 */

export type Comparator = 'above' | 'below' | 'crosses-above' | 'crosses-below'

export const COMPARATORS: { id: Comparator; label: string }[] = [
  { id: 'above', label: 'is above' },
  { id: 'below', label: 'is below' },
  { id: 'crosses-above', label: 'crosses above' },
  { id: 'crosses-below', label: 'crosses below' }
]

/** One side of a comparison. */
export type Operand =
  /** A fixed number the person typed. */
  | { kind: 'value'; value: number }
  /** The bar's own price. */
  | { kind: 'price'; field?: 'close' | 'open' | 'high' | 'low' }
  /** One series from the shared indicator engine. */
  | { kind: 'indicator'; indicator: IndicatorKind; series?: string; options?: Record<string, number> }

export interface Rule {
  left: Operand
  comparator: Comparator
  right: Operand
}

export interface RuleGroup {
  /** Whether every rule must hold, or any one of them. */
  match: 'all' | 'any'
  rules: Rule[]
}

export type SizingKind = 'fixed-quantity' | 'fixed-notional' | 'percent-equity' | 'risk-per-trade'

export interface Sizing {
  kind: SizingKind
  /**
   * What the number means, by kind: units, currency, a percentage of equity, or the percentage of equity risked between
   * entry and stop.
   */
  value: number
}

export interface Strategy {
  id: string
  name: string
  /** Bumped on every edit, so a stored result can say which version produced it. */
  version: number
  instrumentId: string
  interval: string
  /** Which way it is allowed to trade. Shorting a spot market is a simulation choice and is stated as one. */
  direction: 'long' | 'short'
  entry: RuleGroup
  exit: RuleGroup
  /** A percentage below the entry (above, for a short). Absent means no stop. */
  stopLossPercent?: number
  takeProfitPercent?: number
  /** Follows the best price reached, by this percentage. Absent means no trailing stop. */
  trailingStopPercent?: number
  sizing: Sizing
  /** Bars to wait after a position closes before another may open. */
  cooldownBars: number
  createdAt: number
  updatedAt: number
}

export const DEFAULT_STRATEGY: Omit<Strategy, 'id' | 'instrumentId' | 'createdAt' | 'updatedAt'> = {
  name: 'New strategy',
  version: 1,
  interval: '1h',
  direction: 'long',
  entry: {
    match: 'all',
    rules: [
      {
        left: { kind: 'indicator', indicator: 'rsi', options: { period: 14 } },
        comparator: 'crosses-below',
        right: { kind: 'value', value: 30 }
      }
    ]
  },
  exit: {
    match: 'any',
    rules: [
      {
        left: { kind: 'indicator', indicator: 'rsi', options: { period: 14 } },
        comparator: 'crosses-above',
        right: { kind: 'value', value: 55 }
      }
    ]
  },
  stopLossPercent: 3,
  takeProfitPercent: 6,
  sizing: { kind: 'percent-equity', value: 25 },
  cooldownBars: 0
}

/** The indicators a strategy may reference, with the series each one produces. */
export const STRATEGY_INDICATORS: { kind: IndicatorKind; label: string; series: string[]; defaults: Record<string, number> }[] = [
  { kind: 'sma', label: 'SMA', series: ['sma'], defaults: { period: 20 } },
  { kind: 'ema', label: 'EMA', series: ['ema'], defaults: { period: 20 } },
  { kind: 'wma', label: 'WMA', series: ['wma'], defaults: { period: 20 } },
  { kind: 'rsi', label: 'RSI', series: ['rsi'], defaults: { period: 14 } },
  { kind: 'macd', label: 'MACD', series: ['macd', 'signal', 'histogram'], defaults: { fast: 12, slow: 26, signal: 9 } },
  { kind: 'bollinger', label: 'Bollinger', series: ['upper', 'middle', 'lower'], defaults: { period: 20, deviations: 2 } },
  { kind: 'atr', label: 'ATR', series: ['atr'], defaults: { period: 14 } },
  { kind: 'stochastic', label: 'Stochastic', series: ['k', 'd'], defaults: { period: 14, smoothD: 3 } },
  { kind: 'cci', label: 'CCI', series: ['cci'], defaults: { period: 20 } },
  { kind: 'roc', label: 'ROC', series: ['roc'], defaults: { period: 12 } },
  { kind: 'adx', label: 'ADX', series: ['adx', 'plusDi', 'minusDi'], defaults: { period: 14 } },
  { kind: 'vwap', label: 'VWAP', series: ['vwap'], defaults: {} },
  { kind: 'obv', label: 'OBV', series: ['obv'], defaults: {} }
]

const indicatorMeta = (kind: IndicatorKind): (typeof STRATEGY_INDICATORS)[number] | undefined =>
  STRATEGY_INDICATORS.find((one) => one.kind === kind)

/** A stable name for one operand's computed series, so the same indicator is not calculated twice. */
export function operandKey(operand: Operand): string {
  if (operand.kind === 'value') return `value:${operand.value}`
  if (operand.kind === 'price') return `price:${operand.field ?? 'close'}`
  const options = Object.entries(operand.options ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join(',')
  return `ind:${operand.indicator}:${operand.series ?? ''}:${options}`
}

/** Every operand a strategy mentions, deduplicated. */
export function operandsOf(strategy: Strategy): Operand[] {
  const seen = new Map<string, Operand>()
  for (const group of [strategy.entry, strategy.exit]) {
    for (const rule of group.rules) {
      for (const operand of [rule.left, rule.right]) {
        const key = operandKey(operand)
        if (!seen.has(key)) seen.set(key, operand)
      }
    }
  }
  return [...seen.values()]
}

/**
 * The series for every operand a strategy mentions, computed once over the whole candle set.
 *
 * Safe because the indicators are causal: nothing at index `i` is influenced by a candle after `i`. The backtester then
 * reads only up to the bar it has reached, which is what keeps it honest — and it is checked by a test that computes a
 * series over a truncated history and compares it with the same stretch of the full one.
 */
export function seriesFor(strategy: Strategy, candles: Candle[]): Map<string, Series> {
  const out = new Map<string, Series>()
  const length = candles.length

  for (const operand of operandsOf(strategy)) {
    const key = operandKey(operand)
    if (operand.kind === 'value') {
      out.set(key, new Array(length).fill(operand.value))
      continue
    }
    if (operand.kind === 'price') {
      const field = operand.field ?? 'close'
      out.set(
        key,
        candles.map((candle) => candle[field])
      )
      continue
    }
    let computed: Record<string, Series> = {}
    try {
      computed = calculate(operand.indicator, candles, operand.options ?? {})
    } catch {
      computed = {}
    }
    const name = operand.series ?? indicatorMeta(operand.indicator)?.series[0] ?? operand.indicator
    // A series that could not be computed is all-null, so every rule mentioning it is simply not satisfied rather than
    // the run failing. An indicator with too little history is the ordinary case at the start of any backtest.
    out.set(key, computed[name] ?? new Array(length).fill(null))
  }
  return out
}

/**
 * Whether one rule holds at bar `i`.
 *
 * A crossing needs the previous bar as well, and is false when either bar is missing a value — the first bar after an
 * indicator warms up has nothing to have crossed from, and calling that a crossing would open a position on the first
 * bar of every backtest.
 */
export function ruleHolds(rule: Rule, series: Map<string, Series>, i: number): boolean {
  const left = series.get(operandKey(rule.left))
  const right = series.get(operandKey(rule.right))
  if (!left || !right) return false

  const a = left[i]
  const b = right[i]
  if (typeof a !== 'number' || !Number.isFinite(a)) return false
  if (typeof b !== 'number' || !Number.isFinite(b)) return false

  if (rule.comparator === 'above') return a > b
  if (rule.comparator === 'below') return a < b

  if (i === 0) return false
  const previousA = left[i - 1]
  const previousB = right[i - 1]
  if (typeof previousA !== 'number' || !Number.isFinite(previousA)) return false
  if (typeof previousB !== 'number' || !Number.isFinite(previousB)) return false

  return rule.comparator === 'crosses-above'
    ? previousA <= previousB && a > b
    : previousA >= previousB && a < b
}

export interface GroupOutcome {
  holds: boolean
  /** Each rule's own answer, so a signal can explain itself rather than being asserted. */
  rules: { rule: Rule; holds: boolean; left: number | null; right: number | null }[]
}

export function groupHolds(group: RuleGroup, series: Map<string, Series>, i: number): GroupOutcome {
  const rules = group.rules.map((rule) => {
    const left = series.get(operandKey(rule.left))?.[i] ?? null
    const right = series.get(operandKey(rule.right))?.[i] ?? null
    return {
      rule,
      holds: ruleHolds(rule, series, i),
      left: typeof left === 'number' && Number.isFinite(left) ? left : null,
      right: typeof right === 'number' && Number.isFinite(right) ? right : null
    }
  })
  // An empty group holds nothing. An entry that fires on no rules at all would be "buy every bar", which is a thing
  // somebody might want but never by leaving the rules empty.
  if (rules.length === 0) return { holds: false, rules }
  return { holds: group.match === 'all' ? rules.every((r) => r.holds) : rules.some((r) => r.holds), rules }
}

/**
 * The first bar at which every series a strategy needs has a value.
 *
 * Trading before this is trading on an indicator that has not warmed up. A strategy whose series never produce a value —
 * too little history for the periods it asks for — has no such bar, and the run says so rather than producing no trades
 * and looking like a strategy that simply never triggered.
 */
export function warmupIndex(series: Map<string, Series>, length: number): number | null {
  if (length === 0) return null
  for (let i = 0; i < length; i++) {
    let ready = true
    for (const values of series.values()) {
      const value = values[i]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        ready = false
        break
      }
    }
    // One bar beyond, so a crossing at the first usable bar has a previous bar to have crossed from.
    if (ready) return Math.min(length - 1, i + 1)
  }
  return null
}

/** How many units to buy, from the sizing rule. Null when the rule cannot produce a sensible quantity. */
export function quantityFor(
  sizing: Sizing,
  equity: number,
  price: number,
  stopPrice: number | null
): number | null {
  if (!Number.isFinite(price) || price <= 0) return null
  if (!Number.isFinite(equity) || equity <= 0) return null

  if (sizing.kind === 'fixed-quantity') return sizing.value > 0 ? sizing.value : null
  if (sizing.kind === 'fixed-notional') return sizing.value > 0 ? sizing.value / price : null
  if (sizing.kind === 'percent-equity') {
    if (sizing.value <= 0) return null
    return (equity * (sizing.value / 100)) / price
  }
  // Risk per trade needs a stop: without one the loss is unbounded and the size it implies is meaningless. Null rather
  // than quietly falling back to a percentage of equity, which would silently size the trade by a different rule.
  if (stopPrice === null || !Number.isFinite(stopPrice)) return null
  const perUnit = Math.abs(price - stopPrice)
  if (perUnit <= 0) return null
  const risked = equity * (sizing.value / 100)
  return risked > 0 ? risked / perUnit : null
}

// ---------------------------------------------------------------- reading one back

const text = (value: unknown, max: number, fallback = ''): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : fallback

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const COMPARATOR_NAMES = new Set<Comparator>(['above', 'below', 'crosses-above', 'crosses-below'])
const INDICATOR_NAMES = new Set(STRATEGY_INDICATORS.map((one) => one.kind))
const SIZING_NAMES = new Set<SizingKind>(['fixed-quantity', 'fixed-notional', 'percent-equity', 'risk-per-trade'])

export function cleanOperand(raw: unknown): Operand | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.kind === 'value') {
    const value = finite(o.value)
    return value === null ? null : { kind: 'value', value }
  }
  if (o.kind === 'price') {
    const field = o.field === 'open' || o.field === 'high' || o.field === 'low' ? o.field : 'close'
    return { kind: 'price', field }
  }
  if (o.kind === 'indicator' && INDICATOR_NAMES.has(o.indicator as IndicatorKind)) {
    const meta = indicatorMeta(o.indicator as IndicatorKind)
    const options: Record<string, number> = {}
    for (const [name, value] of Object.entries((o.options ?? {}) as Record<string, unknown>)) {
      const number = finite(value)
      // A period of zero is not a period; the indicator would refuse it anyway, and keeping it would store a strategy
      // that can never run.
      if (number !== null && number >= 1 && number <= 500) options[name.slice(0, 20)] = Math.round(number)
    }
    const series = text(o.series, 20)
    return {
      kind: 'indicator',
      indicator: o.indicator as IndicatorKind,
      series: meta && meta.series.includes(series) ? series : undefined,
      options: Object.keys(options).length > 0 ? options : { ...(meta?.defaults ?? {}) }
    }
  }
  return null
}

export function cleanRule(raw: unknown): Rule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const left = cleanOperand(o.left)
  const right = cleanOperand(o.right)
  if (!left || !right) return null
  return {
    left,
    right,
    comparator: COMPARATOR_NAMES.has(o.comparator as Comparator) ? (o.comparator as Comparator) : 'above'
  }
}

export function cleanGroup(raw: unknown): RuleGroup {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rules: Rule[] = []
  for (const one of Array.isArray(o.rules) ? o.rules : []) {
    const rule = cleanRule(one)
    if (rule) rules.push(rule)
    if (rules.length >= 8) break
  }
  return { match: o.match === 'any' ? 'any' : 'all', rules }
}

export function cleanStrategy(raw: unknown, at = Date.now()): Strategy | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 80)
  const instrumentId = text(o.instrumentId, 200)
  // Without these two there is nothing to run and nothing to run it on.
  if (!id || !instrumentId) return null

  const percent = (value: unknown): number | undefined => {
    const number = finite(value)
    return number !== null && number > 0 && number <= 100 ? number : undefined
  }
  const sizingRaw = (o.sizing && typeof o.sizing === 'object' ? o.sizing : {}) as Record<string, unknown>
  const sizingValue = finite(sizingRaw.value)

  return {
    id,
    instrumentId,
    name: text(o.name, 60) || 'Strategy',
    version: Math.max(1, Math.round(finite(o.version) ?? 1)),
    interval: text(o.interval, 8) || '1h',
    direction: o.direction === 'short' ? 'short' : 'long',
    entry: cleanGroup(o.entry),
    exit: cleanGroup(o.exit),
    stopLossPercent: percent(o.stopLossPercent),
    takeProfitPercent: percent(o.takeProfitPercent),
    trailingStopPercent: percent(o.trailingStopPercent),
    sizing: {
      kind: SIZING_NAMES.has(sizingRaw.kind as SizingKind) ? (sizingRaw.kind as SizingKind) : 'percent-equity',
      value: sizingValue !== null && sizingValue > 0 ? sizingValue : 25
    },
    cooldownBars: Math.min(500, Math.max(0, Math.round(finite(o.cooldownBars) ?? 0))),
    createdAt: finite(o.createdAt) ?? at,
    updatedAt: finite(o.updatedAt) ?? at
  }
}

/** Why a strategy cannot be run. Empty when it can. */
export function problemsWith(strategy: Strategy): string[] {
  const problems: string[] = []
  if (strategy.entry.rules.length === 0) problems.push('There is no entry rule, so nothing would ever be bought.')
  if (
    strategy.exit.rules.length === 0 &&
    strategy.stopLossPercent === undefined &&
    strategy.takeProfitPercent === undefined &&
    strategy.trailingStopPercent === undefined
  ) {
    // A position that is never closed is not a strategy, and its result would be buy-and-hold under another name.
    problems.push('There is no exit rule, stop or target, so a position once opened would never be closed.')
  }
  if (strategy.sizing.kind === 'risk-per-trade' && strategy.stopLossPercent === undefined) {
    problems.push('Risk per trade needs a stop loss: without one the risk on a trade is not defined.')
  }
  if (strategy.sizing.kind === 'percent-equity' && strategy.sizing.value > 100) {
    problems.push('A position cannot be more than all of the equity without borrowing, which this does not simulate.')
  }
  return problems
}

/** A strategy in words, so what will run can be read before it runs. */
export function describeOperand(operand: Operand): string {
  if (operand.kind === 'value') return String(operand.value)
  if (operand.kind === 'price') return operand.field ?? 'close'
  const meta = indicatorMeta(operand.indicator)
  const options = Object.values(operand.options ?? {}).join(', ')
  const series = operand.series && meta && meta.series.length > 1 ? ` ${operand.series}` : ''
  return `${meta?.label ?? operand.indicator}${series}${options ? `(${options})` : ''}`
}

export function describeRule(rule: Rule): string {
  const comparator = COMPARATORS.find((one) => one.id === rule.comparator)?.label ?? rule.comparator
  return `${describeOperand(rule.left)} ${comparator} ${describeOperand(rule.right)}`
}

export function describeStrategy(strategy: Strategy): string[] {
  const lines: string[] = []
  const join = (group: RuleGroup): string =>
    group.rules.map(describeRule).join(group.match === 'all' ? ' and ' : ' or ')
  if (strategy.entry.rules.length > 0) lines.push(`Enter ${strategy.direction} when ${join(strategy.entry)}.`)
  if (strategy.exit.rules.length > 0) lines.push(`Exit when ${join(strategy.exit)}.`)
  if (strategy.stopLossPercent !== undefined) lines.push(`Stop out ${strategy.stopLossPercent}% against the entry.`)
  if (strategy.takeProfitPercent !== undefined) lines.push(`Take profit at ${strategy.takeProfitPercent}%.`)
  if (strategy.trailingStopPercent !== undefined) {
    lines.push(`Trail the stop ${strategy.trailingStopPercent}% behind the best price reached.`)
  }
  const sizing = strategy.sizing
  lines.push(
    sizing.kind === 'fixed-quantity'
      ? `Trade ${sizing.value} units.`
      : sizing.kind === 'fixed-notional'
        ? `Trade ${sizing.value} of the quote currency.`
        : sizing.kind === 'percent-equity'
          ? `Use ${sizing.value}% of equity.`
          : `Risk ${sizing.value}% of equity between entry and stop.`
  )
  if (strategy.cooldownBars > 0) lines.push(`Wait ${strategy.cooldownBars} bars after closing before entering again.`)
  return lines
}
