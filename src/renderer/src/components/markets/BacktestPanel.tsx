import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  FlaskConical,
  Footprints,
  NotebookPen,
  Play,
  Plus,
  Save,
  Search,
  Shuffle,
  Trash2,
  X
} from 'lucide-react'
import {
  COMPARATORS,
  DEFAULT_STRATEGY,
  describeRule,
  STRATEGY_INDICATORS,
  type Comparator,
  type Operand,
  type Rule,
  type RuleGroup,
  type SizingKind,
  type Strategy
} from '../../../../shared/markets/strategy'
import type { MonteCarloResult, WalkSummary } from '../../../../shared/markets/validation'
import type { SweepPoint } from '../../../../shared/markets/backtest'
import type { BacktestAnswer, StrategiesAnswer } from '../../../../main/markets/ipc'
import type { Instrument } from '../../../../shared/markets/instrument'
import type { IndicatorKind } from '../../../../shared/markets/indicators'
import EquityChart from './EquityChart'
import AssetLogo from './AssetLogo'
import { backtestNote, saveJournalNote } from './journal'
import type { NoticeKind } from '../../lib/notices'

/**
 * Strategies, and running them over history.
 *
 * The screen is arranged around one idea: **a backtest result is only as good as what it assumed**, so the assumptions
 * and the warnings are not tucked behind a link. A run over forty bars with three trades and an ambiguous exit is shown
 * saying exactly that, next to its return, because the return on its own would be the most persuasive and least
 * informative thing on the page.
 *
 * Nothing here computes anything about a market. The engine does the run; this writes the rules, shows what came back,
 * and repeats what the engine says it assumed.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

const INTERVALS = ['5m', '15m', '1h', '4h', '1d']

const SIZING: { id: SizingKind; label: string; unit: string }[] = [
  { id: 'percent-equity', label: 'Percent of equity', unit: '%' },
  { id: 'fixed-notional', label: 'Fixed value', unit: '' },
  { id: 'fixed-quantity', label: 'Fixed quantity', unit: 'units' },
  { id: 'risk-per-trade', label: 'Risk per trade', unit: '%' }
]

const percent = (value: number | null | undefined, digits = 2): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(digits)}%` : '—'

const ratio = (value: number | null | undefined, digits = 2): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'

const way = (value: number | null | undefined): 'up' | 'down' | 'flat' =>
  typeof value !== 'number' || !Number.isFinite(value) || value === 0 ? 'flat' : value > 0 ? 'up' : 'down'

const when = (ms: number): string => (ms > 0 ? new Date(ms).toLocaleDateString() : '—')

/** An operand editor: a number, the bar's price, or one indicator from the shared engine. */
function OperandFields({
  operand,
  onChange
}: {
  operand: Operand
  onChange(next: Operand): void
}): React.JSX.Element {
  const meta = operand.kind === 'indicator' ? STRATEGY_INDICATORS.find((one) => one.kind === operand.indicator) : undefined
  return (
    <>
      <select
        value={operand.kind === 'indicator' ? operand.indicator : operand.kind}
        aria-label="Operand"
        onChange={(e) => {
          const chosen = e.target.value
          if (chosen === 'value') onChange({ kind: 'value', value: 0 })
          else if (chosen === 'price') onChange({ kind: 'price', field: 'close' })
          else {
            const found = STRATEGY_INDICATORS.find((one) => one.kind === chosen)
            onChange({ kind: 'indicator', indicator: chosen as IndicatorKind, options: { ...(found?.defaults ?? {}) } })
          }
        }}
      >
        <option value="value">a number</option>
        <option value="price">the price</option>
        <optgroup label="Indicators">
          {STRATEGY_INDICATORS.map((one) => (
            <option key={one.kind} value={one.kind}>
              {one.label}
            </option>
          ))}
        </optgroup>
      </select>

      {operand.kind === 'value' && (
        <input
          type="number"
          step="any"
          value={operand.value}
          aria-label="Number"
          onChange={(e) => onChange({ kind: 'value', value: Number(e.target.value) })}
        />
      )}

      {operand.kind === 'indicator' && meta && meta.series.length > 1 && (
        <select
          value={operand.series ?? meta.series[0]}
          aria-label="Series"
          onChange={(e) => onChange({ ...operand, series: e.target.value })}
        >
          {meta.series.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
      )}

      {operand.kind === 'indicator' &&
        Object.entries(operand.options ?? {}).map(([name, value]) => (
          <input
            key={name}
            type="number"
            min={1}
            max={500}
            value={value}
            aria-label={`${operand.indicator} ${name}`}
            title={name}
            onChange={(e) => {
              const next = Number(e.target.value)
              // A period of zero is not a period; the indicator would refuse it and the strategy could never run.
              if (!Number.isFinite(next) || next < 1) return
              onChange({ ...operand, options: { ...operand.options, [name]: Math.round(next) } })
            }}
          />
        ))}
    </>
  )
}

function RuleRows({
  group,
  label,
  onChange
}: {
  group: RuleGroup
  label: string
  onChange(next: RuleGroup): void
}): React.JSX.Element {
  const setRule = (at: number, rule: Rule): void =>
    onChange({ ...group, rules: group.rules.map((one, i) => (i === at ? rule : one)) })

  return (
    <div className="mk-rulegroup">
      <div className="mk-rulehead">
        <h5>{label}</h5>
        <select value={group.match} aria-label={`${label} match`} onChange={(e) => onChange({ ...group, match: e.target.value === 'any' ? 'any' : 'all' })}>
          <option value="all">all of these</option>
          <option value="any">any of these</option>
        </select>
        <button
          type="button"
          className="queue-btn tiny"
          onClick={() =>
            onChange({
              ...group,
              rules: [
                ...group.rules,
                { left: { kind: 'price', field: 'close' }, comparator: 'above', right: { kind: 'value', value: 0 } }
              ]
            })
          }
        >
          <Plus size={12} /> Rule
        </button>
      </div>
      {group.rules.length === 0 ? (
        <p className="mk-quiet">No rules.</p>
      ) : (
        <ul className="mk-rules">
          {group.rules.map((rule, at) => (
            <li key={at}>
              <OperandFields operand={rule.left} onChange={(left) => setRule(at, { ...rule, left })} />
              <select
                value={rule.comparator}
                aria-label="Comparator"
                onChange={(e) => setRule(at, { ...rule, comparator: e.target.value as Comparator })}
              >
                {COMPARATORS.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.label}
                  </option>
                ))}
              </select>
              <OperandFields operand={rule.right} onChange={(right) => setRule(at, { ...rule, right })} />
              <button
                type="button"
                className="tl-icon"
                aria-label="Remove this rule"
                onClick={() => onChange({ ...group, rules: group.rules.filter((_v, i) => i !== at) })}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function BacktestPanel({
  onOpenMarket,
  onNotify,
  current
}: {
  onOpenMarket(instrumentId: string): void
  onNotify(message: string, kind?: NoticeKind): void
  current: Instrument | null
}): React.JSX.Element {
  const [state, setState] = useState<StrategiesAnswer | null>(null)
  const [draft, setDraft] = useState<Strategy | null>(null)
  const [answer, setAnswer] = useState<BacktestAnswer | null>(null)
  const [sweepResult, setSweepResult] = useState<{ points: SweepPoint[]; warning: string } | null>(null)
  /**
   * Parameters judged on stretches they had not seen.
   *
   * The headline is the out-of-sample figure and nothing else. In-sample results are shown underneath because the gap
   * between the two is the whole point: rules that do well on data they were tuned on and badly on data they were not
   * have been fitted, and only seeing both says so.
   */
  const [walk, setWalk] = useState<{ summary: WalkSummary; assumptions: string[] } | null>(null)
  /** The same trades in different orders. Generates nothing and forecasts nothing. */
  const [carlo, setCarlo] = useState<{ trades: number; result: MonteCarloResult; assumptions: string[] } | null>(null)
  const [validating, setValidating] = useState<'walk' | 'carlo' | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bars, setBars] = useState(500)
  const [holdBack, setHoldBack] = useState(0)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Instrument[]>([])

  const load = useCallback(async () => {
    const got = await window.api.marketsStrategies()
    if (!refused(got)) setState(got)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const wanted = query.trim()
    if (wanted.length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      void window.api.marketsSearch(wanted).then((got) => setResults(refused(got) ? [] : got.results))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const startDraft = (instrument: Instrument): void => {
    setDraft({
      ...DEFAULT_STRATEGY,
      id: '',
      instrumentId: instrument.instrumentId,
      name: `${instrument.symbol} RSI`,
      createdAt: 0,
      updatedAt: 0
    })
    setAnswer(null)
    setSweepResult(null)
    setWalk(null)
    setCarlo(null)
  }

  const save = async (): Promise<void> => {
    if (!draft || busy) return
    setBusy(true)
    try {
      const got = await window.api.marketsStrategySave(draft)
      if (refused(got)) {
        onNotify(got.message ?? 'That strategy could not be saved.', 'error')
        return
      }
      setState(got)
      setDraft(got.saved)
      onNotify(`Saved “${got.saved.name}” (version ${got.saved.version})`)
    } finally {
      setBusy(false)
    }
  }

  const run = async (strategyId: string): Promise<void> => {
    if (running) return
    setRunning(true)
    setSweepResult(null)
    setWalk(null)
    setCarlo(null)
    try {
      const got = await window.api.marketsBacktest(strategyId, { bars, outOfSamplePercent: holdBack })
      if (refused(got)) {
        setAnswer(null)
        onNotify(got.message ?? 'That backtest could not be run.', 'error')
        return
      }
      setAnswer(got)
      void load()
    } finally {
      setRunning(false)
    }
  }

  const strategies = state?.strategies ?? []
  const problems = draft?.id ? (state?.problems[draft.id] ?? []) : []
  const symbolOf = (instrumentId: string): string =>
    state?.instruments.find((one) => one.instrumentId === instrumentId)?.symbol ??
    instrumentId.split(':').pop() ??
    instrumentId

  const result = answer?.result ?? null

  return (
    <div className="mk-backtest">
      <div className="mk-bt-top">
        {/* ------------------------------------------------------------ the strategies */}
        <div className="mk-bt-list">
          <div className="mk-alert-head">
            <h4>Strategies</h4>
          </div>

          {strategies.length === 0 && !draft && (
            <div className="mk-empty-small">
              <p>No strategies yet.</p>
              <p className="pw-note is-quiet">Choose a market and Orbis will start one you can edit.</p>
            </div>
          )}

          <ul className="mk-rows">
            {strategies.map((one) => (
              <li key={one.id} className={`mk-row${draft?.id === one.id ? ' is-on' : ''}`}>
                <button
                  type="button"
                  className="mk-row-name"
                  onClick={() => {
                    setDraft(one)
                    setAnswer(null)
                    setSweepResult(null)
                    setWalk(null)
                    setCarlo(null)
    setWalk(null)
    setCarlo(null)
                  }}
                >
                  <AssetLogo symbol={symbolOf(one.instrumentId)} size="small" />
                  <b>{one.name}</b>
                  <span className="mk-name">
                    {symbolOf(one.instrumentId)} · {one.interval} · v{one.version}
                  </span>
                </button>
                <button
                  type="button"
                  className="queue-btn tiny"
                  disabled={running || (state?.problems[one.id]?.length ?? 0) > 0}
                  title={state?.problems[one.id]?.[0]}
                  onClick={() => void run(one.id)}
                >
                  <Play size={11} /> Run
                </button>
                <button
                  type="button"
                  className="tl-icon"
                  aria-label={`Delete ${one.name}`}
                  onClick={() => {
                    if (!window.confirm(`Delete “${one.name}”? Its recorded runs go with it.`)) return
                    void window.api.marketsStrategyRemove(one.id).then((got) => {
                      if (refused(got)) return
                      setState(got)
                      if (draft?.id === one.id) setDraft(null)
                    })
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>

          {/* The market being looked at is almost always the one somebody wants to write rules about. */}
          {current && !strategies.some((one) => one.instrumentId === current.instrumentId && draft?.id === one.id) && (
            <button type="button" className="queue-btn small ghost" onClick={() => startDraft(current)}>
              <Plus size={12} /> New strategy on {current.symbol}
            </button>
          )}

          <div className="mk-search">
            <Search size={13} />
            <input
              value={query}
              aria-label="Which market to test the strategy on" placeholder="New strategy on which market?"
              maxLength={60}
              onChange={(e) => setQuery(e.target.value)}
            />
            {results.length > 0 && (
              <ul className="mk-results">
                {results.slice(0, 8).map((one) => (
                  <li key={one.instrumentId}>
                    <button
                      type="button"
                      onClick={() => {
                        startDraft(one)
                        setQuery('')
                        setResults([])
                      }}
                    >
                      <b>{one.symbol}</b>
                      <span className="mk-name">{one.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------ the builder */}
        {draft ? (
          <div className="mk-bt-builder">
            <div className="mk-alert-row">
              <input
                value={draft.name}
                maxLength={60}
                aria-label="Strategy name"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <select value={draft.interval} aria-label="Interval" onChange={(e) => setDraft({ ...draft, interval: e.target.value })}>
                {INTERVALS.map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </select>
              <select
                value={draft.direction}
                aria-label="Direction"
                onChange={(e) => setDraft({ ...draft, direction: e.target.value === 'short' ? 'short' : 'long' })}
              >
                <option value="long">long</option>
                <option value="short">short</option>
              </select>
              <button type="button" className="queue-btn small" disabled={busy} onClick={() => void save()}>
                <Save size={13} /> Save
              </button>
            </div>

            <RuleRows group={draft.entry} label="Enter when" onChange={(entry) => setDraft({ ...draft, entry })} />
            <RuleRows group={draft.exit} label="Exit when" onChange={(exit) => setDraft({ ...draft, exit })} />

            <div className="mk-alert-row">
              {(
                [
                  ['stopLossPercent', 'Stop loss %'],
                  ['takeProfitPercent', 'Take profit %'],
                  ['trailingStopPercent', 'Trailing stop %']
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="mk-inline">
                  <span>{label}</span>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    max={100}
                    value={draft[field] ?? ''}
                    placeholder="none"
                    onChange={(e) => {
                      const next = e.target.value === '' ? undefined : Number(e.target.value)
                      setDraft({ ...draft, [field]: next !== undefined && next > 0 && next <= 100 ? next : undefined })
                    }}
                  />
                </label>
              ))}
            </div>

            <div className="mk-alert-row">
              <label className="mk-inline">
                <span>Size by</span>
                <select
                  value={draft.sizing.kind}
                  onChange={(e) => setDraft({ ...draft, sizing: { ...draft.sizing, kind: e.target.value as SizingKind } })}
                >
                  {SIZING.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={draft.sizing.value}
                  aria-label="Size"
                  onChange={(e) => setDraft({ ...draft, sizing: { ...draft.sizing, value: Number(e.target.value) } })}
                />
                <span>{SIZING.find((one) => one.id === draft.sizing.kind)?.unit}</span>
              </label>
              <label className="mk-inline">
                <span>Cooldown bars</span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={draft.cooldownBars}
                  onChange={(e) => setDraft({ ...draft, cooldownBars: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                />
              </label>
            </div>

            {problems.length > 0 && (
              <ul className="mk-problems" role="alert">
                {problems.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>
            )}

            {/* The rules in words, so what is about to run can be read before it runs. */}
            <ul className="mk-assumptions">
              {[...draft.entry.rules, ...draft.exit.rules].length === 0 ? (
                <li>No rules yet.</li>
              ) : (
                <>
                  <li>
                    Enter {draft.direction} when {draft.entry.rules.map(describeRule).join(draft.entry.match === 'all' ? ' and ' : ' or ')}.
                  </li>
                  {draft.exit.rules.length > 0 && (
                    <li>Exit when {draft.exit.rules.map(describeRule).join(draft.exit.match === 'all' ? ' and ' : ' or ')}.</li>
                  )}
                </>
              )}
            </ul>

            <div className="mk-alert-row">
              <label className="mk-inline">
                <span>History</span>
                <select value={String(bars)} onChange={(e) => setBars(Number(e.target.value))}>
                  <option value="200">200 bars</option>
                  <option value="500">500 bars</option>
                  <option value="1000">1000 bars</option>
                </select>
              </label>
              <label className="mk-inline" title="A stretch at the end kept back, and measured separately">
                <span>Hold back</span>
                <select value={String(holdBack)} onChange={(e) => setHoldBack(Number(e.target.value))}>
                  <option value="0">nothing</option>
                  <option value="20">last 20%</option>
                  <option value="30">last 30%</option>
                </select>
              </label>
              <button
                type="button"
                className="queue-btn small"
                disabled={running || !draft.id}
                title={draft.id ? undefined : 'Save the strategy first'}
                onClick={() => void run(draft.id)}
              >
                <Play size={13} /> {running ? 'Running…' : 'Run backtest'}
              </button>
              <button
                type="button"
                className="queue-btn small ghost"
                disabled={running || !draft.id || draft.stopLossPercent === undefined}
                title={draft.stopLossPercent === undefined ? 'A sweep needs a stop loss to vary' : 'Try several stops'}
                onClick={() => {
                  void window.api
                    .marketsBacktestSweep(draft.id, 'stopLossPercent', [1, 2, 3, 4, 5, 7, 10])
                    .then((got) => {
                      if (refused(got)) {
                        onNotify(got.message ?? 'That sweep could not be run.', 'error')
                        return
                      }
                      setSweepResult(got)
                    })
                }}
              >
                <FlaskConical size={13} /> Sweep the stop
              </button>
              <button
                type="button"
                className="queue-btn small ghost"
                disabled={validating !== null || !draft.id}
                title={draft.id ? 'Judge the parameters on stretches they were not chosen on' : 'Save the strategy first'}
                onClick={() => {
                  setValidating('walk')
                  void window.api
                    .marketsWalkForward(draft.id, { windows: 5, trainRatio: 0.7 })
                    .then((got) => {
                      if (refused(got)) {
                        onNotify(got.message ?? 'That could not be walked forward.', 'error')
                        return
                      }
                      setWalk(got)
                    })
                    .finally(() => setValidating(null))
                }}
              >
                <Footprints size={13} /> {validating === 'walk' ? 'Walking…' : 'Walk forward'}
              </button>
              <button
                type="button"
                className="queue-btn small ghost"
                disabled={validating !== null || !draft.id}
                title={draft.id ? 'Reorder the trades that happened and see what survives' : 'Save the strategy first'}
                onClick={() => {
                  setValidating('carlo')
                  void window.api
                    .marketsMonteCarlo(draft.id, { runs: 1000, seed: 1 })
                    .then((got) => {
                      if (refused(got)) {
                        onNotify(got.message ?? 'That could not be run.', 'error')
                        return
                      }
                      setCarlo(got)
                    })
                    .finally(() => setValidating(null))
                }}
              >
                <Shuffle size={13} /> {validating === 'carlo' ? 'Reordering…' : 'Reorder trades'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mk-empty-small">
            <p>Choose a strategy on the left, or search for a market to start one.</p>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ the result */}
      {result && (
        <div className="mk-bt-result">
          <div className="mk-pf-head">
            <div>
              <p className="mk-sim-badge">
                <AlertTriangle size={13} /> Simulated over past candles — not a forecast
              </p>
              <div className="mk-big">
                <strong className={`mk-change ${way(result.stats.totalReturnPercent)}`}>
                  {percent(result.stats.totalReturnPercent)}
                </strong>
                <span className="mk-quiet">
                  over {result.bars.toLocaleString()} bars, {when(result.from)} to {when(result.to)} ·{' '}
                  {result.trades.length} trade{result.trades.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>
            <div className="mk-pf-actions">
              <button
                type="button"
                className="queue-btn tiny ghost"
                title="Write this run up in Notes, with its assumptions and warnings"
                onClick={() =>
                  void saveJournalNote(
                    backtestNote(result, draft?.name ?? 'Strategy', symbolOf(result.instrumentId), answer?.description ?? [])
                  ).then(
                    () => onNotify('Written up in Notes'),
                    () => onNotify('That could not be saved to Notes.', 'error')
                  )
                }
              >
                <NotebookPen size={11} /> Journal
              </button>
              <button type="button" className="queue-btn tiny ghost" onClick={() => onOpenMarket(result.instrumentId)}>
                Open {symbolOf(result.instrumentId)}
              </button>
            </div>
          </div>

          {/* Warnings first. The return above is the most persuasive number on the page and these are what qualify it. */}
          {result.warnings.length > 0 && (
            <ul className="mk-problems">
              {result.warnings.map((one) => (
                <li key={one}>{one}</li>
              ))}
            </ul>
          )}

          <div className="mk-pf-stats">
            <span title="Buying and holding the same market over the same period with the same money">
              Buy and hold <b className={`mk-change ${way(result.stats.benchmarkReturnPercent)}`}>{percent(result.stats.benchmarkReturnPercent)}</b>
            </span>
            <span>
              Max drawdown <b>{result.stats.maxDrawdownPercent === 0 ? '0%' : `−${result.stats.maxDrawdownPercent.toFixed(2)}%`}</b>
            </span>
            <span>
              Win rate <b>{result.stats.performance.winRate === null ? '—' : `${result.stats.performance.winRate.toFixed(0)}%`}</b>
            </span>
            <span>
              Profit factor <b>{ratio(result.stats.performance.profitFactor)}</b>
            </span>
            <span>
              Sharpe <b>{ratio(result.stats.sharpe)}</b>
            </span>
            <span>
              Sortino <b>{ratio(result.stats.sortino)}</b>
            </span>
            <span title="Annualised return over the worst drawdown. Unavailable when there was no drawdown.">
              Calmar <b>{ratio(result.stats.calmar)}</b>
            </span>
            <span title="The share of bars with a position open">
              Time in market <b>{result.stats.exposurePercent.toFixed(0)}%</b>
            </span>
          </div>

          <EquityChart equity={result.equity} height={200} />

          {result.outOfSample && (
            <div className="mk-out-of-sample">
              <h5>Held back: {when(result.outOfSample.from)} to {when(result.outOfSample.to)}</h5>
              <div className="mk-pf-stats">
                <span>
                  Return{' '}
                  <b className={`mk-change ${way(result.outOfSample.stats.totalReturnPercent)}`}>
                    {percent(result.outOfSample.stats.totalReturnPercent)}
                  </b>
                </span>
                <span>
                  Trades <b>{result.outOfSample.trades}</b>
                </span>
                <span>
                  Max drawdown <b>−{result.outOfSample.stats.maxDrawdownPercent.toFixed(2)}%</b>
                </span>
                <span>
                  Sharpe <b>{ratio(result.outOfSample.stats.sharpe)}</b>
                </span>
              </div>
              <p className="mk-quiet">
                This stretch was not used while the rules were being chosen. Rules that do well before it and badly here
                were fitted to what already happened.
              </p>
            </div>
          )}

          {walk && (
            <div className="mk-validate">
              <h5>
                <Footprints size={13} /> Walked forward
              </h5>
              {walk.summary.tested === 0 ? (
                <p className="mk-quiet">
                  There was not enough history to split into windows with a meaningful stretch on each side, so nothing
                  was judged. A longer backtest range would give it something to work with.
                </p>
              ) : (
                <>
                  {/*
                    * The out-of-sample figure is the headline, alone, in the large type. The in-sample number is shown
                    * beside it in small type because the gap between them is what the whole exercise is for -- but if
                    * only one number is read, it has to be the one from data the rules had not seen.
                    */}
                  <div className="mk-validate-head">
                    <div className="mk-validate-headline">
                      <span>Out of sample</span>
                      <b className={`mk-change ${way(walk.summary.averageTestReturn)}`}>
                        {percent(walk.summary.averageTestReturn)}
                      </b>
                      <small className="mk-quiet">
                        averaged over {walk.summary.tested} window{walk.summary.tested === 1 ? '' : 's'} it had never
                        seen
                      </small>
                    </div>
                    <div className="mk-stats">
                      <div className="mk-stat">
                        <span>In sample</span>
                        <b className="mk-quiet">{percent(walk.summary.averageTrainReturn)}</b>
                      </div>
                      <div className="mk-stat">
                        <span>Efficiency</span>
                        <b className={walk.summary.efficiency !== null && walk.summary.efficiency < 0.5 ? 'mk-down' : ''}>
                          {walk.summary.efficiency === null ? '—' : walk.summary.efficiency.toFixed(2)}
                        </b>
                      </div>
                      <div className="mk-stat">
                        <span>Windows in profit</span>
                        <b>
                          {walk.summary.profitable === null
                            ? '—'
                            : `${walk.summary.profitable} of ${walk.summary.tested}`}
                        </b>
                      </div>
                    </div>
                  </div>

                  {walk.summary.warnings.map((one) => (
                    <p key={one} className="mk-problem">
                      <AlertTriangle size={13} /> {one}
                    </p>
                  ))}

                  <div className="mk-table-wrap">
                    <table className="mk-table">
                      <thead>
                        <tr>
                          <th scope="col">Window</th>
                          <th scope="col">Chosen on the training stretch</th>
                          <th scope="col">In sample</th>
                          <th scope="col">Out of sample</th>
                        </tr>
                      </thead>
                      <tbody>
                        {walk.summary.windows.map((one) => (
                          <tr key={one.window.index}>
                            <th scope="row">
                              {new Date(one.window.testFrom).toLocaleDateString()} →{' '}
                              {new Date(one.window.testTo).toLocaleDateString()}
                            </th>
                            <td className="mk-quiet">
                              {Object.entries(one.chosen).length === 0
                                ? '—'
                                : Object.entries(one.chosen)
                                    .map(([field, value]) => `${field} ${value}`)
                                    .join(', ')}
                            </td>
                            <td className={`mk-change ${way(one.train?.totalReturnPercent ?? null)}`}>
                              {percent(one.train?.totalReturnPercent ?? null)}
                            </td>
                            <td className={`mk-change ${way(one.test?.totalReturnPercent ?? null)}`}>
                              <b>{percent(one.test?.totalReturnPercent ?? null)}</b>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <ul className="mk-assumptions">
                {walk.assumptions.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>
            </div>
          )}

          {carlo && (
            <div className="mk-validate">
              <h5>
                <Shuffle size={13} /> {carlo.trades} trades, reordered {carlo.result.runs} times
              </h5>
              {/*
                * The note is above the numbers, not below them. It says this is not a forecast, and somebody reading
                * downward meets that before they meet a percentile they might mistake for one.
                */}
              <p className="mk-validate-note">{carlo.result.note}</p>

              <div className="mk-stats">
                <div className="mk-stat">
                  <span>Median</span>
                  <b className={`mk-change ${way(carlo.result.median)}`}>{percent(carlo.result.median)}</b>
                </div>
                <div className="mk-stat">
                  <span>5th to 95th</span>
                  <b>
                    {percent(carlo.result.fifth)} … {percent(carlo.result.ninetyFifth)}
                  </b>
                </div>
                <div className="mk-stat">
                  <span>Worst fall seen</span>
                  <b className="mk-down">
                    {carlo.result.worstDrawdown === null ? '—' : `−${Math.abs(carlo.result.worstDrawdown).toFixed(2)}%`}
                  </b>
                </div>
                <div className="mk-stat">
                  <span>Ended in profit</span>
                  <b>
                    {carlo.result.profitableShare === null
                      ? '—'
                      : `${(carlo.result.profitableShare * 100).toFixed(0)}% of orders`}
                  </b>
                </div>
              </div>

              {/* The spread of outcomes, drawn from the sorted returns the engine returned. */}
              {carlo.result.returns.length > 1 && (
                <svg className="mk-carlo" viewBox="0 0 640 90" role="img" aria-label="Spread of reordered outcomes">
                  {(() => {
                    const values = carlo.result.returns
                    const low = values[0]
                    const high = values[values.length - 1]
                    const span = high - low || 1
                    const x = (value: number): number => 10 + ((value - low) / span) * 620
                    // A bar per reordering would be 1000 bars in 620 pixels; binned instead, which is what a
                    // distribution is anyway.
                    const bins = 48
                    const counts = new Array<number>(bins).fill(0)
                    for (const one of values) {
                      counts[Math.min(bins - 1, Math.floor(((one - low) / span) * bins))] += 1
                    }
                    const tallest = Math.max(...counts, 1)
                    return (
                      <>
                        {counts.map((count, i) => (
                          <rect
                            key={i}
                            x={10 + (i / bins) * 620}
                            y={70 - (count / tallest) * 58}
                            width={620 / bins - 1}
                            height={(count / tallest) * 58}
                            className={low + (span * (i + 0.5)) / bins >= 0 ? 'mk-carlo-up' : 'mk-carlo-down'}
                          />
                        ))}
                        {/* Break-even, where it falls. The line people actually look for. */}
                        {low < 0 && high > 0 && <line x1={x(0)} x2={x(0)} y1={8} y2={72} className="mk-carlo-zero" />}
                        <text x={10} y={86} className="mk-carlo-label">
                          {percent(low)}
                        </text>
                        <text x={630} y={86} className="mk-carlo-label" textAnchor="end">
                          {percent(high)}
                        </text>
                      </>
                    )
                  })()}
                </svg>
              )}

              <ul className="mk-assumptions">
                {carlo.assumptions.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>
            </div>
          )}

          {sweepResult && (
            <div className="mk-sweep">
              <h5>Stop loss swept</h5>
              <div className="mk-table-wrap">
                <table className="mk-table">
                  <thead>
                    <tr>
                      <th>Stop</th>
                      <th>Return</th>
                      <th>Max drawdown</th>
                      <th>Sharpe</th>
                      <th>Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sweepResult.points.map((point) => (
                      <tr key={point.value}>
                        <td>{point.value}%</td>
                        <td className={`mk-change ${way(point.totalReturnPercent)}`}>{percent(point.totalReturnPercent)}</td>
                        <td>−{point.maxDrawdownPercent.toFixed(2)}%</td>
                        <td>{ratio(point.sharpe)}</td>
                        <td>{point.trades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="pw-note">{sweepResult.warning}</p>
            </div>
          )}

          <h4>Trades</h4>
          {result.trades.length === 0 ? (
            <p className="mk-quiet">No trades were taken.</p>
          ) : (
            <div className="mk-table-wrap">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th>In</th>
                    <th>Out</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Result</th>
                    <th>Why it closed</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((trade, i) => (
                    <tr key={`${trade.entryIndex}-${i}`}>
                      <td>{new Date(trade.entryTime).toLocaleString()}</td>
                      <td>{new Date(trade.exitTime).toLocaleString()}</td>
                      <td>{trade.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                      <td>{trade.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                      <td className={`mk-change ${way(trade.net)}`}>{percent(trade.returnPercent)}</td>
                      <td>
                        {trade.exitReason}
                        {/* An assumption, not an observation — and the only honest way to show it is next to the trade. */}
                        {trade.ambiguousBar && (
                          <span className="mk-ambiguous" title="This bar contained both the stop and the target. The data does not say which came first, so the stop was assumed.">
                            {' '}assumed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4>What this run assumed</h4>
          <ul className="mk-assumptions">
            {result.assumptions.map((one) => (
              <li key={one}>{one}</li>
            ))}
            <li>
              Slippage {(result.costs.slippage * 100).toFixed(3)}% and fees {(result.costs.feeRate * 100).toFixed(3)}% a
              side, on {result.startingCash.toLocaleString()} of starting capital.
            </li>
            <li>
              {answer?.candlesGot.toLocaleString()} candles were available of the {answer?.candlesAsked.toLocaleString()}{' '}
              asked for, and the first {result.warmupBars} went to warming the indicators up.
            </li>
          </ul>
        </div>
      )}

      {/* ------------------------------------------------------------ what has been run before */}
      {(state?.runs.length ?? 0) > 0 && (
        <div className="mk-bt-runs">
          <div className="mk-alert-head">
            <h4>Earlier runs</h4>
            <button
              type="button"
              className="queue-btn tiny ghost"
              onClick={() => void window.api.marketsBacktestRunsClear().then(() => void load())}
            >
              Clear
            </button>
          </div>
          <div className="mk-table-wrap">
            <table className="mk-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Market</th>
                  <th>Return</th>
                  <th>Buy and hold</th>
                  <th>Drawdown</th>
                  <th>Trades</th>
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                {(state?.runs ?? []).map((one) => (
                  <tr key={one.id}>
                    <td>
                      {one.strategyName} <small className="mk-quiet">v{one.strategyVersion}</small>
                    </td>
                    <td>{symbolOf(one.instrumentId)}</td>
                    <td className={`mk-change ${way(one.totalReturnPercent)}`}>{percent(one.totalReturnPercent)}</td>
                    <td className={`mk-change ${way(one.benchmarkReturnPercent)}`}>{percent(one.benchmarkReturnPercent)}</td>
                    <td>−{one.maxDrawdownPercent.toFixed(2)}%</td>
                    <td>{one.trades}</td>
                    <td className="mk-quiet">{new Date(one.at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
