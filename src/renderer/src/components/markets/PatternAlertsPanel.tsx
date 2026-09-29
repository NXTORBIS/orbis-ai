import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bell, BellOff, Info, Plus, Trash2 } from 'lucide-react'
import type { PatternAlertRule, MuteRule } from '../../../../shared/markets/patternAlerts'

/**
 * Rules for when a detected pattern should say something.
 *
 * These are rules only. Nothing here delivers a notification: the alert goes out through the notification path Orbis
 * already has, and this screen writes the conditions it fires on. A second delivery mechanism would eventually disagree
 * with the first about what was sent.
 *
 * ## An unsatisfiable rule is refused, not accepted quietly
 *
 * The problems a rule can have are checked in the main process and shown here beside it. The one worth catching is a
 * requirement that can never be met -- a volume condition with context analysis switched off, or a rule watching
 * specific markets and naming none. Those sit in a list looking like coverage, and the whole value of an alert is that
 * its absence means nothing happened.
 */

interface RuleRow {
  rule: PatternAlertRule
  problems: { field: string; describe: string }[]
}

const VOLUME_CHOICES = ['well-below-average', 'below-average', 'average', 'above-average', 'well-above-average'] as const
const PLACEMENT_CHOICES = ['at-support', 'at-resistance', 'between'] as const
const AGREEMENT_CHOICES = ['aligned', 'mixed', 'opposed'] as const

const readable = (value: string): string => value.replace(/-/g, ' ')

const COOLDOWNS = [
  { value: 0, label: 'No cooldown' },
  { value: 5 * 60_000, label: '5 minutes' },
  { value: 15 * 60_000, label: '15 minutes' },
  { value: 60 * 60_000, label: 'An hour' },
  { value: 4 * 60 * 60_000, label: 'Four hours' },
  { value: 24 * 60 * 60_000, label: 'A day' }
]

export interface PatternAlertsPanelProps {
  /** The market open now, offered as the one a new rule starts on. */
  instrumentId?: string
  symbol?: string
  interval?: string
}

export function PatternAlertsPanel({ instrumentId, symbol, interval }: PatternAlertsPanelProps): React.JSX.Element {
  const [rows, setRows] = useState<RuleRow[]>([])
  const [mutes, setMutes] = useState<MuteRule[]>([])
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await window.api.marketsPatternRules()
      if ('error' in result) {
        setProblem(result.message ?? 'That did not work.')
        return
      }
      setProblem('')
      setRows(result.rules)
      setMutes(result.mutes)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (rule: Partial<PatternAlertRule>) => {
      setBusy(true)
      try {
        const result = await window.api.marketsPatternRuleSave(rule)
        if ('error' in result) {
          setProblem(result.message ?? 'That did not save.')
          return
        }
        setProblem('')
        await load()
        setEditing(result.rule.id)
      } catch (err) {
        setProblem(err instanceof Error ? err.message : 'That did not save.')
      } finally {
        setBusy(false)
      }
    },
    [load]
  )

  const remove = useCallback(
    async (id: string) => {
      setBusy(true)
      try {
        await window.api.marketsPatternRuleRemove(id)
        await load()
        if (editing === id) setEditing(null)
      } finally {
        setBusy(false)
      }
    },
    [load, editing]
  )

  const addRule = useCallback(() => {
    void save({
      name: symbol ? `Patterns on ${symbol}` : 'Pattern alert',
      enabled: true,
      scope: instrumentId ? 'instruments' : 'watchlist',
      instrumentIds: instrumentId ? [instrumentId] : [],
      intervals: interval ? [interval] : [],
      patternIds: [],
      categories: [],
      directions: [],
      minimumStructuralMatch: 0.2,
      minimumDataQuality: 'reduced',
      requireVolume: null,
      requirePlacement: null,
      requireTimeframeAgreement: null,
      excludeWhenConflicted: false,
      allowDeveloping: false,
      cooldownMs: 15 * 60_000
    })
  }, [save, instrumentId, symbol, interval])

  const patch = useCallback((rule: PatternAlertRule, change: Partial<PatternAlertRule>) => void save({ ...rule, ...change }), [save])

  /** A requirement list that is either off entirely or a set of allowed readings. Empty is never a saved state. */
  const Requirement = <T extends string,>({
    label,
    choices,
    value,
    onChange,
    note
  }: {
    label: string
    choices: readonly T[]
    value: T[] | null
    onChange(next: T[] | null): void
    note: string
  }): React.JSX.Element => (
    <div className="mk-setting">
      <label className="mk-switch">
        <input
          type="checkbox"
          checked={value !== null}
          disabled={busy}
          // Turning it on starts with every reading allowed rather than none, because an empty list matches nothing.
          onChange={(e) => onChange(e.target.checked ? [...choices] : null)}
        />
        <span>{label}</span>
      </label>
      {value !== null && (
        <>
          <div className="mk-chips">
            {choices.map((one) => {
              const on = value.includes(one)
              return (
                <button
                  key={one}
                  type="button"
                  className={on ? 'mk-chip mk-chip-on' : 'mk-chip'}
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => {
                    const next = on ? value.filter((x) => x !== one) : [...value, one]
                    // An empty selection would be a rule that can never fire, so it becomes no requirement instead.
                    onChange(next.length === 0 ? null : next)
                  }}
                >
                  {readable(one)}
                </button>
              )
            })}
          </div>
          <p className="mk-setting-note">{note}</p>
        </>
      )}
    </div>
  )

  return (
    <section className="mk-panel" aria-label="Candlestick pattern alerts">
      <header className="mk-panel-head">
        <h3>
          <Bell size={15} aria-hidden /> Pattern alerts
        </h3>
        <button type="button" className="mk-mini" onClick={addRule} disabled={busy}>
          <Plus size={13} aria-hidden /> New rule
        </button>
      </header>

      {problem !== '' && (
        <p className="mk-problem" role="alert">
          <AlertTriangle size={14} aria-hidden /> {problem}
        </p>
      )}

      {rows.length === 0 && problem === '' && (
        <p className="mk-empty">
          No pattern alert rules yet. Detection runs without them: the chart and the patterns panel show what was found
          whether or not anything is set to interrupt you.
        </p>
      )}

      <ul className="mk-rule-list">
        {rows.map(({ rule, problems }) => {
          const open = editing === rule.id
          return (
            <li key={rule.id} className={open ? 'mk-rule mk-rule-open' : 'mk-rule'}>
              <div className="mk-rule-head">
                <label className="mk-switch">
                  <input type="checkbox" checked={rule.enabled} disabled={busy} onChange={(e) => patch(rule, { enabled: e.target.checked })} />
                  <span className="mk-sr">Enabled</span>
                </label>
                <button type="button" className="mk-rule-name" onClick={() => setEditing(open ? null : rule.id)} aria-expanded={open}>
                  {rule.name}
                </button>
                <span className="mk-panel-sub">
                  {rule.scope === 'instruments' ? `${rule.instrumentIds.length} market${rule.instrumentIds.length === 1 ? '' : 's'}` : rule.scope}
                  {rule.intervals.length > 0 && ` · ${rule.intervals.join(', ')}`}
                </span>
                <button type="button" className="mk-mini mk-danger" onClick={() => void remove(rule.id)} disabled={busy} aria-label={`Delete ${rule.name}`}>
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>

              {problems.length > 0 && (
                <ul className="mk-rule-problems" role="alert">
                  {problems.map((one) => (
                    <li key={one.field}>
                      <AlertTriangle size={13} aria-hidden /> {one.describe}
                    </li>
                  ))}
                </ul>
              )}

              {open && (
                <div className="mk-rule-body">
                  <label className="mk-field">
                    <span>Name</span>
                    <input value={rule.name} disabled={busy} onChange={(e) => patch(rule, { name: e.target.value })} spellCheck={false} />
                  </label>

                  <label className="mk-field">
                    <span>Which markets</span>
                    <select value={rule.scope} disabled={busy} onChange={(e) => patch(rule, { scope: e.target.value as PatternAlertRule['scope'] })}>
                      <option value="instruments">Only the markets named below</option>
                      <option value="watchlist">Anything in a watchlist</option>
                      <option value="favourites">Anything favourited</option>
                    </select>
                  </label>

                  {rule.scope === 'instruments' && (
                    <div className="mk-setting">
                      <span className="mk-setting-label">Markets</span>
                      <div className="mk-chips">
                        {rule.instrumentIds.map((one) => (
                          <button
                            key={one}
                            type="button"
                            className="mk-chip mk-chip-on"
                            disabled={busy}
                            onClick={() => patch(rule, { instrumentIds: rule.instrumentIds.filter((x) => x !== one) })}
                          >
                            {one} ×
                          </button>
                        ))}
                        {instrumentId !== undefined && !rule.instrumentIds.includes(instrumentId) && (
                          <button type="button" className="mk-chip" disabled={busy} onClick={() => patch(rule, { instrumentIds: [...rule.instrumentIds, instrumentId] })}>
                            <Plus size={12} aria-hidden /> {symbol ?? instrumentId}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mk-setting">
                    <span className="mk-setting-label">Which kinds</span>
                    <div className="mk-chips">
                      {(['reversal', 'continuation', 'indecision'] as const).map((one) => {
                        const on = rule.categories.includes(one)
                        return (
                          <button
                            key={one}
                            type="button"
                            className={on ? 'mk-chip mk-chip-on' : 'mk-chip'}
                            aria-pressed={on}
                            disabled={busy}
                            onClick={() => patch(rule, { categories: on ? rule.categories.filter((x) => x !== one) : [...rule.categories, one] })}
                          >
                            {one}
                          </button>
                        )
                      })}
                    </div>
                    <p className="mk-setting-note">Nothing selected means any kind.</p>
                  </div>

                  <div className="mk-setting">
                    <span className="mk-setting-label">Which directions</span>
                    <div className="mk-chips">
                      {(['bullish', 'bearish', 'neutral'] as const).map((one) => {
                        const on = rule.directions.includes(one)
                        return (
                          <button
                            key={one}
                            type="button"
                            className={on ? 'mk-chip mk-chip-on' : 'mk-chip'}
                            aria-pressed={on}
                            disabled={busy}
                            onClick={() => patch(rule, { directions: on ? rule.directions.filter((x) => x !== one) : [...rule.directions, one] })}
                          >
                            {one}
                          </button>
                        )
                      })}
                    </div>
                    <p className="mk-setting-note">Nothing selected means any direction.</p>
                  </div>

                  <label className="mk-field">
                    <span>Only above this match strength</span>
                    <input
                      type="range"
                      min={0}
                      max={0.9}
                      step={0.05}
                      value={rule.minimumStructuralMatch}
                      disabled={busy}
                      onChange={(e) => patch(rule, { minimumStructuralMatch: Number(e.target.value) })}
                    />
                    <output>{(rule.minimumStructuralMatch * 100).toFixed(0)}%</output>
                  </label>
                  <p className="mk-setting-note">
                    How comfortably the candles must clear the definition&rsquo;s thresholds. Not a probability of anything.
                  </p>

                  <label className="mk-field">
                    <span>Only at this data quality or better</span>
                    <select
                      value={rule.minimumDataQuality}
                      disabled={busy}
                      onChange={(e) => patch(rule, { minimumDataQuality: e.target.value as PatternAlertRule['minimumDataQuality'] })}
                    >
                      <option value="poor">Poor and above</option>
                      <option value="reduced">Reduced and above</option>
                      <option value="high">High only</option>
                    </select>
                  </label>

                  <Requirement
                    label="Only at these volume readings"
                    choices={VOLUME_CHOICES}
                    value={rule.requireVolume as (typeof VOLUME_CHOICES)[number][] | null}
                    onChange={(next) => patch(rule, { requireVolume: next as PatternAlertRule['requireVolume'] })}
                    note="Needs context analysis switched on. With it off this condition cannot be met, and the rule will not fire."
                  />

                  <Requirement
                    label="Only where the formation sits here"
                    choices={PLACEMENT_CHOICES}
                    value={rule.requirePlacement as (typeof PLACEMENT_CHOICES)[number][] | null}
                    onChange={(next) => patch(rule, { requirePlacement: next as PatternAlertRule['requirePlacement'] })}
                    note="Needs context analysis switched on, and at least two turns at the same price for a level to exist at all."
                  />

                  <Requirement
                    label="Only with the other timeframes like this"
                    choices={AGREEMENT_CHOICES}
                    value={rule.requireTimeframeAgreement as (typeof AGREEMENT_CHOICES)[number][] | null}
                    onChange={(next) => patch(rule, { requireTimeframeAgreement: next as PatternAlertRule['requireTimeframeAgreement'] })}
                    note="Needs the multi-timeframe reading switched on, with at least one other interval chosen."
                  />

                  <div className="mk-setting">
                    <label className="mk-switch">
                      <input
                        type="checkbox"
                        checked={rule.excludeWhenConflicted}
                        disabled={busy}
                        onChange={(e) => patch(rule, { excludeWhenConflicted: e.target.checked })}
                      />
                      <span>Skip formations with something pointing against them</span>
                    </label>
                    <p className="mk-setting-note">
                      Needs context analysis switched on. With it off there is nothing to check, so the condition counts as
                      unmet and the rule will not fire.
                    </p>
                  </div>

                  <div className="mk-setting">
                    <label className="mk-switch">
                      <input type="checkbox" checked={rule.allowDeveloping} disabled={busy} onChange={(e) => patch(rule, { allowDeveloping: e.target.checked })} />
                      <span>Fire before the candle closes</span>
                    </label>
                    <p className="mk-setting-note">
                      A formation on a candle that is still forming can stop being one before it closes, and a notification
                      that has gone out cannot be recalled. Off unless you want that.
                    </p>
                  </div>

                  <label className="mk-field">
                    <span>Then wait at least</span>
                    <select value={rule.cooldownMs} disabled={busy} onChange={(e) => patch(rule, { cooldownMs: Number(e.target.value) })}>
                      {COOLDOWNS.map((one) => (
                        <option key={one.value} value={one.value}>
                          {one.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mk-setting-note">
                    Per market and interval. The same formation never fires twice regardless of the cooldown: it is
                    identified by its own candle, so refreshing that candle is not a new event.
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {mutes.length > 0 && (
        <div className="mk-setting">
          <span className="mk-setting-label">
            <BellOff size={13} aria-hidden /> Muted
          </span>
          <ul className="mk-pattern-rules">
            {mutes.map((one, i) => (
              <li key={`${one.instrumentId ?? 'all'}-${one.until}-${i}`}>
                {one.instrumentId ?? 'every market'}
                {one.patternId !== undefined && `, ${one.patternId}`}
                {one.interval !== undefined && `, ${one.interval}`} until {new Date(one.until).toLocaleString()}
                {one.reason !== '' && ` — ${one.reason}`}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mk-mini"
            disabled={busy}
            onClick={() => {
              void window.api.marketsPatternMutesSave([]).then(() => void load())
            }}
          >
            Unmute everything
          </button>
        </div>
      )}

      <p className="mk-note mk-pattern-foot" role="note">
        <Info size={14} aria-hidden /> An alert says a shape appeared. It is not a recommendation, and Orbis has no path
        from a detection to an exchange: nothing here can place, change or cancel an order.
      </p>
    </section>
  )
}
