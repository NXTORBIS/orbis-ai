import { useCallback, useEffect, useState } from 'react'
import { Filter, Play, Plus, Save, Trash2, X } from 'lucide-react'
import {
  DEFAULT_QUERY,
  FIELDS,
  fieldInfo,
  PRESETS,
  queryNeedsCandles,
  type SavedScreen,
  type ScreenerCondition,
  type ScreenerField,
  type ScreenerOperator,
  type ScreenerGroup,
  type ScreenerQuery
} from '../../../../shared/markets/screener'
import type { ScreenAnswer } from '../../../../main/markets/ipc'
import { compactNumber } from './MarketChart'
import AssetLogo from './AssetLogo'
import { useCurrency } from './useCurrency'
import type { NoticeKind } from '../../lib/notices'

/**
 * The screener.
 *
 * Conditions in, real markets out. The part of this worth reading carefully is what it says about its own cost: a
 * condition on RSI needs a candle series per market, so a screen with one cannot examine every market on the exchange.
 * When that happens the footer says how many were examined and how many were left out, and which ones were chosen.
 *
 * A screen that quietly examined the most convenient fifty and printed the result would look exactly like one that swept
 * the market. That is the difference this panel exists to make visible.
 */

const OPERATORS: { id: ScreenerOperator; label: string }[] = [
  { id: 'gt', label: 'above' },
  { id: 'lt', label: 'below' },
  { id: 'between', label: 'between' }
]

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

const INTERVALS = ['5m', '15m', '1h', '4h', '1d']

/** Which fields are money, and so must be converted rather than printed as they arrive. */
const MONEY_FIELDS = new Set<ScreenerField>(['price', 'turnover'])

/**
 * A value in the unit its field is measured in.
 *
 * Money is converted; a percentage and an RSI are not. Running everything through the currency formatter would put a
 * rupee sign in front of an RSI of 31, which is a different kind of wrong from a missing conversion.
 */
const show = (
  value: number | null | undefined,
  field: ScreenerField,
  money: (value: number | null | undefined) => string
): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (MONEY_FIELDS.has(field)) return money(value)
  const unit = fieldInfo(field)?.unit
  if (unit === 'percent') return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
  if (unit === 'amount' && Math.abs(value) >= 10_000) return compactNumber(value)
  const digits = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 4 : 8
  return value.toLocaleString(undefined, { maximumFractionDigits: digits })
}


/**
 * One condition, wherever it sits.
 *
 * Identical at the top level and inside a group, because a condition means the same thing in both: a field, an
 * operator, a value, and the extras that particular field needs.
 */
function ConditionRow({
  condition,
  onChange,
  onRemove
}: {
  condition: ScreenerCondition
  onChange(over: Partial<ScreenerCondition>): void
  onRemove(): void
}): React.JSX.Element {
  const info = fieldInfo(condition.field)
  return (
    <li>
      <select
        value={condition.field}
        aria-label="Field"
        onChange={(e) => {
          const field = e.target.value as ScreenerField
          onChange({ field, period: fieldInfo(field)?.defaultPeriod })
        }}
      >
        {FIELDS.map((one) => (
          <option key={one.field} value={one.field} title={one.hint}>
            {one.label}
            {one.needsCandles ? ' \u2022' : ''}
          </option>
        ))}
      </select>
      <select
        value={condition.operator}
        aria-label="Operator"
        onChange={(e) => onChange({ operator: e.target.value as ScreenerOperator })}
      >
        {OPERATORS.map((one) => (
          <option key={one.id} value={one.id}>
            {one.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={condition.value}
        aria-label="Value"
        onChange={(e) => onChange({ value: Number(e.target.value) })}
      />
      {condition.operator === 'between' && (
        <input
          type="number"
          value={condition.value2 ?? condition.value}
          aria-label="Upper value"
          onChange={(e) => onChange({ value2: Number(e.target.value) })}
        />
      )}
      {info?.defaultPeriod !== undefined && (
        <label className="mk-inline">
          <span>over</span>
          <input
            type="number"
            min={1}
            max={400}
            value={condition.period ?? info.defaultPeriod}
            aria-label="Period"
            onChange={(e) => {
              const next = Number(e.target.value)
              if (!Number.isFinite(next) || next < 1) return
              onChange({ period: Math.round(next) })
            }}
          />
        </label>
      )}
      {info?.needsCandles && (
        <select
          value={condition.interval ?? '1h'}
          aria-label="Interval"
          onChange={(e) => onChange({ interval: e.target.value })}
        >
          {INTERVALS.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="tl-icon" aria-label="Remove this condition" onClick={onRemove}>
        <X size={12} />
      </button>
    </li>
  )
}

export default function ScreenerPanel({
  onOpenMarket,
  onNotify
}: {
  onOpenMarket(instrumentId: string): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const currency = useCurrency()
  const [query, setQuery] = useState<ScreenerQuery>({ ...DEFAULT_QUERY, conditions: [...PRESETS[0].query.conditions], sort: PRESETS[0].query.sort })
  const [answer, setAnswer] = useState<ScreenAnswer | null>(null)
  const [running, setRunning] = useState(false)
  const [problem, setProblem] = useState('')
  const [screens, setScreens] = useState<SavedScreen[]>([])

  const loadScreens = useCallback(async () => {
    const got = await window.api.marketsScreens()
    if (!refused(got)) setScreens(got.screens)
  }, [])

  useEffect(() => {
    void loadScreens()
  }, [loadScreens])

  const run = useCallback(
    async (wanted: ScreenerQuery) => {
      if (running) return
      setRunning(true)
      setProblem('')
      try {
        const got = await window.api.marketsScreen(wanted)
        if (refused(got)) {
          setAnswer(null)
          setProblem(got.message ?? 'That screen could not be run.')
          return
        }
        setAnswer(got)
      } finally {
        setRunning(false)
      }
    },
    [running]
  )

  // The first run happens on its own, so the panel opens with real markets rather than an empty table and a button.
  useEffect(() => {
    void run(query)
    // Deliberately once: every later run is asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setCondition = (at: number, over: Partial<ScreenerCondition>): void =>
    setQuery((current) => ({
      ...current,
      conditions: current.conditions.map((one, i) => (i === at ? { ...one, ...over } : one))
    }))

  const addCondition = (): void =>
    setQuery((current) => ({
      ...current,
      conditions: [...current.conditions, { field: 'changePercent', operator: 'gt', value: 5 }]
    }))

  // ---------------------------------------------------------------- groups
  //
  // One level of nesting, which is what turns "(A and B) or (C and D)" from two separate screens into one. Deeper was
  // deliberately not built: every extra level multiplies what has to be rendered and what somebody has to hold in
  // their head, and two levels covers the queries anybody actually writes.

  const addGroup = (): void =>
    setQuery((current) => ({
      ...current,
      groups: [...(current.groups ?? []), { conditions: [{ field: 'volume', operator: 'gt', value: 1_000_000 }], match: 'all' }],
      // A first group needs a rule for how it joins the top-level conditions. `all` is the narrower reading, and a
      // screen that returns too little is a better default than one that returns too much.
      groupMatch: current.groupMatch ?? 'all'
    }))

  const setGroup = (at: number, over: Partial<ScreenerGroup>): void =>
    setQuery((current) => ({
      ...current,
      groups: (current.groups ?? []).map((one, i) => (i === at ? { ...one, ...over } : one))
    }))

  const removeGroup = (at: number): void =>
    setQuery((current) => {
      const groups = (current.groups ?? []).filter((_one, i) => i !== at)
      // With no groups left there is nothing for `groupMatch` to join, so it goes too rather than lingering.
      return { ...current, groups, ...(groups.length === 0 ? { groupMatch: undefined } : {}) }
    })

  const setGroupCondition = (group: number, at: number, over: Partial<ScreenerCondition>): void =>
    setGroup(group, {
      conditions: (query.groups?.[group]?.conditions ?? []).map((one, i) => (i === at ? { ...one, ...over } : one))
    })

  const cash = (value: number | null | undefined): string => currency.money(value).text
  const expensive = queryNeedsCandles(query)
  const results = answer?.answer.results ?? []
  const columns = answer?.answer.columns ?? []

  return (
    <div className="mk-screener">
      <div className="mk-screener-bar">
        <select
          value=""
          aria-label="Load a screen"
          onChange={(e) => {
            const preset = PRESETS.find((p) => p.name === e.target.value)
            if (preset) {
              setQuery({ ...preset.query })
              void run(preset.query)
            } else {
              const saved = screens.find((one) => one.id === e.target.value)
              if (saved) {
                setQuery({ ...saved.query })
                void run(saved.query)
              }
            }
            e.currentTarget.value = ''
          }}
        >
          <option value="">Load a screen…</option>
          <optgroup label="Built in">
            {PRESETS.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </optgroup>
          {screens.length > 0 && (
            <optgroup label="Saved">
              {screens.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <label className="mk-inline">
          <span>Match</span>
          <select
            value={query.match}
            onChange={(e) => setQuery((c) => ({ ...c, match: e.target.value === 'any' ? 'any' : 'all' }))}
          >
            <option value="all">every condition</option>
            <option value="any">any condition</option>
          </select>
        </label>

        <label className="mk-inline">
          <span>Sort by</span>
          <select
            value={query.sort.field}
            onChange={(e) => setQuery((c) => ({ ...c, sort: { ...c.sort, field: e.target.value as ScreenerField } }))}
          >
            {FIELDS.map((one) => (
              <option key={one.field} value={one.field}>
                {one.label}
              </option>
            ))}
          </select>
          <select
            value={query.sort.direction}
            aria-label="Sort direction"
            onChange={(e) => setQuery((c) => ({ ...c, sort: { ...c.sort, direction: e.target.value === 'asc' ? 'asc' : 'desc' } }))}
          >
            <option value="desc">highest first</option>
            <option value="asc">lowest first</option>
          </select>
        </label>

        <button type="button" className="queue-btn small" disabled={running} onClick={() => void run(query)}>
          <Play size={13} /> {running ? 'Running…' : 'Run'}
        </button>
        <button
          type="button"
          className="queue-btn small ghost"
          onClick={() => {
            const name = window.prompt('Name this screen')
            if (name === null) return
            void window.api.marketsScreenSave(name.trim() || 'Screen', query).then((got) => {
              if (refused(got)) {
                onNotify(got.message ?? 'That screen could not be saved.', 'error')
                return
              }
              setScreens(got.screens)
              // The definition, not the rows: the rows were true for one moment.
              onNotify(`Saved the screen “${got.saved.name}”`)
            })
          }}
        >
          <Save size={13} /> Save
        </button>
      </div>

      <ul className="mk-conditions">
        {query.conditions.map((condition, at) => (
          <ConditionRow
            key={at}
            condition={condition}
            onChange={(over) => setCondition(at, over)}
            onRemove={() => setQuery((c) => ({ ...c, conditions: c.conditions.filter((_v, i) => i !== at) }))}
          />
        ))}
      </ul>

      {(query.groups ?? []).length > 0 && (
        <div className="mk-screen-groups">
          <label className="mk-inline mk-screen-groupmatch">
            <span>Groups join the conditions above by</span>
            <select
              value={query.groupMatch ?? 'all'}
              onChange={(e) => setQuery((c) => ({ ...c, groupMatch: e.target.value === 'any' ? 'any' : 'all' }))}
            >
              <option value="all">and</option>
              <option value="any">or</option>
            </select>
          </label>

          {(query.groups ?? []).map((group, at) => (
            <div key={at} className="mk-screen-group">
              <header>
                <label className="mk-inline">
                  <span>Inside this group, match</span>
                  <select
                    value={group.match}
                    onChange={(e) => setGroup(at, { match: e.target.value === 'any' ? 'any' : 'all' })}
                  >
                    <option value="all">every condition</option>
                    <option value="any">any condition</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="tl-icon"
                  aria-label="Remove this group"
                  onClick={() => removeGroup(at)}
                >
                  <X size={12} />
                </button>
              </header>
              <ul className="mk-conditions">
                {group.conditions.map((condition, i) => (
                  <ConditionRow
                    key={i}
                    condition={condition}
                    onChange={(over) => setGroupCondition(at, i, over)}
                    onRemove={() =>
                      setGroup(at, { conditions: group.conditions.filter((_v, j) => j !== i) })
                    }
                  />
                ))}
                <li>
                  <button
                    type="button"
                    className="queue-btn tiny"
                    onClick={() =>
                      setGroup(at, {
                        conditions: [...group.conditions, { field: 'changePercent', operator: 'gt', value: 5 }]
                      })
                    }
                  >
                    <Plus size={12} /> Condition
                  </button>
                </li>
              </ul>
              {/* An empty group matches everything, which silently widens the screen rather than narrowing it. */}
              {group.conditions.length === 0 && (
                <p className="pw-note is-quiet">
                  An empty group matches every market, so this screen is wider than it looks. Add a condition or remove
                  the group.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <ul className="mk-conditions">
        <li>
          <button type="button" className="queue-btn tiny" onClick={addCondition}>
            <Plus size={12} /> Condition
          </button>
          <button type="button" className="queue-btn tiny ghost" onClick={addGroup}>
            <Plus size={12} /> Group
          </button>
          {expensive && (
            <span className="mk-quiet">
              • needs price history, so only the most-traded markets are examined
            </span>
          )}
        </li>
      </ul>

      {problem && (
        <p className="pw-note" role="alert">
          {problem}
        </p>
      )}

      {!problem && answer && results.length === 0 && (
        <div className="mk-empty-small">
          <p>No markets match these conditions.</p>
          <p className="pw-note is-quiet">
            That is the answer, not a failure — the conditions were evaluated against {answer.answer.universeSize.toLocaleString()}{' '}
            markets.
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Price</th>
                <th>24h</th>
                {columns
                  .filter((field) => field !== 'price' && field !== 'changePercent')
                  .map((field) => (
                    <th key={field} title={fieldInfo(field)?.hint}>
                      {fieldInfo(field)?.label ?? field}
                    </th>
                  ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map(({ row, values }) => {
                const percent = row.quote.changePercent
                const way = typeof percent !== 'number' || percent === 0 ? 'flat' : percent > 0 ? 'up' : 'down'
                return (
                  <tr key={row.instrument.instrumentId}>
                    <td>
                      <button type="button" className="mk-row-name" onClick={() => onOpenMarket(row.instrument.instrumentId)}>
                        <AssetLogo instrument={row.instrument} size="small" />
                        <b>{row.instrument.symbol}</b>
                        <span className="mk-name">{row.instrument.name}</span>
                      </button>
                    </td>
                    <td>{show(row.quote.last, 'price', cash)}</td>
                    <td className={`mk-change ${way}`}>
                      <span aria-hidden="true">{way === 'up' ? '▲' : way === 'down' ? '▼' : '—'}</span>
                      {show(percent, 'changePercent', cash)}
                    </td>
                    {columns
                      .filter((field) => field !== 'price' && field !== 'changePercent')
                      .map((field) => (
                        <td key={field}>{show(values[field], field, cash)}</td>
                      ))}
                    <td>
                      <button type="button" className="queue-btn tiny" onClick={() => onOpenMarket(row.instrument.instrumentId)}>
                        Open
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {answer && (
        <p className="mk-screener-foot">
          <Filter size={12} />
          {/* What it cost, said plainly. A sweep that could not reach every market must not read like one that did. */}
          {answer.cap === null ? (
            <>
              {results.length.toLocaleString()} of {answer.answer.universeSize.toLocaleString()} markets — every one was
              considered, because nothing here needed price history.
            </>
          ) : (
            <>
              {results.length.toLocaleString()} shown. {answer.answer.afterSnapshot.toLocaleString()} markets passed the
              conditions that need no history; {answer.answer.examined.toLocaleString()} of them were examined on{' '}
              {answer.interval} candles
              {answer.answer.skipped > 0 && (
                <>
                  {' '}
                  and <b>{answer.answer.skipped.toLocaleString()} were not</b>, because each one costs a request. The
                  most-traded were examined first
                </>
              )}
              .
            </>
          )}
        </p>
      )}

      {screens.length > 0 && (
        <div className="mk-saved">
          <h5>Saved screens</h5>
          <ul>
            {screens.map((one) => (
              <li key={one.id}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery({ ...one.query })
                    void run(one.query)
                  }}
                >
                  {one.name}
                </button>
                <span className="mk-quiet">
                  {one.query.conditions.length} condition{one.query.conditions.length === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  className="tl-icon"
                  aria-label={`Delete ${one.name}`}
                  onClick={() =>
                    void window.api.marketsScreenRemove(one.id).then((got) => {
                      if (!refused(got)) setScreens(got.screens)
                    })
                  }
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
