import type { RoundTrip } from '../../../../shared/markets/portfolio'
import type { BacktestResult } from '../../../../shared/markets/backtest'

/**
 * The trade journal.
 *
 * Deliberately not a store. A journal entry is a note about a trade, and Orbis already has notes — with searching,
 * tagging, pinning, archiving and a screen to read them on. A second notes system living inside Markets would be a
 * worse notes system that nothing else in Orbis could see.
 *
 * So this is only the writing: what a trade or a run looks like as a note, tagged `markets` so every one of them can be
 * found together. Everything a figure claims is a figure the simulation produced, and the word SIMULATED is in the body
 * rather than only in the title, because a note read in six months should not need its origin remembered.
 */

const money = (value: number, digits = 2): string =>
  value.toLocaleString(undefined, { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits })

const percent = (value: number | null): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—'

const when = (ms: number): string => new Date(ms).toLocaleString()

export interface JournalNote {
  title: string
  body: string
  tags: string[]
}

/** One completed simulated trade, as a note somebody can add their reasoning to. */
export function tradeNote(trip: RoundTrip, symbol: string, currency: string): JournalNote {
  const held = Math.max(0, trip.closedAt - trip.openedAt)
  const heldText =
    held < 60_000 ? `${Math.round(held / 1000)}s` : held < 3_600_000 ? `${Math.round(held / 60_000)} min` : `${(held / 3_600_000).toFixed(1)} h`

  return {
    title: `${symbol} ${trip.direction} ${percent(trip.returnPercent)}`,
    body: [
      `**Simulated trade — Orbis paper account. No order reached an exchange.**`,
      '',
      `- Market: ${symbol}`,
      `- Direction: ${trip.direction}`,
      `- Opened: ${when(trip.openedAt)} at ${money(trip.entryPrice, 6)}`,
      `- Closed: ${when(trip.closedAt)} at ${money(trip.exitPrice, 6)}`,
      `- Quantity: ${trip.quantity}`,
      `- Result: ${money(trip.net)} ${currency} (${percent(trip.returnPercent)}) after ${money(trip.fees, 4)} of simulated fees`,
      `- Held for: ${heldText}`,
      '',
      '## Why I took it',
      '',
      '## What I would do differently',
      ''
    ].join('\n'),
    // `markets` finds every one of them; `paper-trade` separates a trade from a backtest in the same list.
    tags: ['markets', 'paper-trade', symbol]
  }
}

/** A backtest, as a note — with the caveats that came back with it, not just the return. */
export function backtestNote(result: BacktestResult, strategyName: string, symbol: string, rules: string[]): JournalNote {
  return {
    title: `${strategyName} on ${symbol} — ${percent(result.stats.totalReturnPercent)}`,
    body: [
      `**Simulated over past candles. Not a forecast.**`,
      '',
      `- Strategy: ${strategyName} (version ${result.strategyVersion})`,
      `- Market: ${symbol} at ${result.interval}`,
      `- Period: ${new Date(result.from).toLocaleDateString()} to ${new Date(result.to).toLocaleDateString()} (${result.bars} bars)`,
      `- Return: ${percent(result.stats.totalReturnPercent)}`,
      `- Buying and holding the same market: ${percent(result.stats.benchmarkReturnPercent)}`,
      `- Trades: ${result.trades.length}, win rate ${result.stats.performance.winRate === null ? '—' : `${result.stats.performance.winRate.toFixed(0)}%`}`,
      `- Worst drawdown: ${result.stats.maxDrawdownPercent.toFixed(2)}%`,
      '',
      '## Rules',
      ...rules.map((one) => `- ${one}`),
      '',
      '## What this run assumed',
      ...result.assumptions.map((one) => `- ${one}`),
      `- Slippage ${(result.costs.slippage * 100).toFixed(3)}% and fees ${(result.costs.feeRate * 100).toFixed(3)}% a side.`,
      // The warnings travel into the note. A return copied out without them is the thing this whole feature avoids.
      ...(result.warnings.length > 0 ? ['', '## Worth knowing', ...result.warnings.map((one) => `- ${one}`)] : []),
      '',
      '## What I make of it',
      ''
    ].join('\n'),
    tags: ['markets', 'backtest', symbol]
  }
}

/** Writes one, through the notes Orbis already has. */
export async function saveJournalNote(note: JournalNote): Promise<void> {
  await window.api.createNote({ title: note.title, body: note.body, tags: note.tags })
}
