import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Pause, Play, Plus, Trash2, Workflow, Zap } from 'lucide-react'
import { MIN_TRIGGER_COOLDOWN, type MarketTrigger, type TriggerKind } from '../../../../shared/markets/triggers'
import type { AlertSubject, Comparison } from '../../../../shared/markets/alerts'
import type { NoticeKind } from '../../lib/notices'
import type { ExperienceState } from './useExperience'

/**
 * What can start a workflow.
 *
 * A trigger fires on the **edge**, never on the state: "price above 100" starts the workflow when the price crosses
 * 100, not once a second for as long as it stays there. That is the difference between a control and a fire hose, and
 * it is why every trigger here also has a cooldown with a floor under it — a workflow does real work, and a workflow
 * doing real work every thirty seconds is a workflow nobody wanted.
 *
 * A trigger with no workflow is refused rather than saved and quietly ignored, so this panel will not let one be built
 * without choosing what it starts. A control that can never do anything is worse than no control, because it looks
 * like it is working.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

const KINDS: { id: TriggerKind; label: string; describe: string }[] = [
  { id: 'market', label: 'A market condition', describe: 'Measured the same way an alert is.' },
  { id: 'alert', label: 'An alert firing', describe: 'Reuses an alert you have already set, rather than restating it.' },
  { id: 'screen', label: 'A screen finding something', describe: 'Runs a saved screen and fires on what comes back.' },
  { id: 'connection', label: 'The feed changing', describe: 'About the connection rather than about the market.' }
]

const SUBJECTS: { id: string; label: string }[] = [
  { id: 'price', label: 'Price' },
  { id: 'change-percent', label: '24h change (%)' },
  { id: 'volume', label: '24h volume' },
  { id: 'spread', label: 'Bid-ask spread' },
  { id: 'funding', label: 'Funding rate' },
  { id: 'open-interest', label: 'Open interest' },
  { id: 'availability', label: 'Market reachable' }
]

const COMPARISONS: { id: Comparison; label: string }[] = [
  { id: 'crosses-above', label: 'crosses above' },
  { id: 'crosses-below', label: 'crosses below' },
  { id: 'above', label: 'is above' },
  { id: 'below', label: 'is below' },
  { id: 'changes-by', label: 'moves by' }
]

const COOLDOWNS = [MIN_TRIGGER_COOLDOWN, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000]

const cooldownLabel = (ms: number): string => {
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`
  return 'a day'
}

export default function TriggersPanel({
  instrumentId,
  symbol,
  experience,
  onNotify
}: {
  /** The market the screen is on, so a new trigger starts on the one being looked at. */
  instrumentId: string
  symbol: string
  experience: ExperienceState
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [rows, setRows] = useState<{ trigger: MarketTrigger; describe: string }[]>([])
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([])
  const [alerts, setAlerts] = useState<{ id: string; label: string; instrumentId: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // ---- the builder
  const [kind, setKind] = useState<TriggerKind>('market')
  const [workflowId, setWorkflowId] = useState('')
  const [subject, setSubject] = useState('price')
  const [comparison, setComparison] = useState<Comparison>('crosses-above')
  const [value, setValue] = useState('')
  const [alertId, setAlertId] = useState('')
  const [connection, setConnection] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected')
  const [cooldown, setCooldown] = useState(COOLDOWNS[2])
  const [dailyLimit, setDailyLimit] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.marketsTriggers()
      if (!refused(result)) setRows(result.triggers)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The workflows that exist, so the menu offers real ones rather than asking somebody to type an id.
  useEffect(() => {
    void window.api.getWorkflowLibrary().then((library) => {
      if (!library || refused(library)) return
      setWorkflows(library.workflows.map((one) => ({ id: one.id, name: one.name })))
    })
    void window.api.marketsAlerts().then((result) => {
      if (refused(result)) return
      setAlerts(
        result.alerts.map((one) => ({
          id: one.id,
          label: one.label || one.id,
          instrumentId: one.instrumentId
        }))
      )
    })
  }, [])

  const save = useCallback(async () => {
    // Refused here as well as in the engine, so the message names the missing thing rather than being generic.
    if (workflowId === '') {
      onNotify('Choose what this should start. A trigger with no workflow can never do anything.', 'error')
      return
    }
    const patch: Partial<MarketTrigger> = {
      workflowId,
      kind,
      instrumentId: kind === 'market' ? instrumentId : '',
      enabled: true,
      cooldownMs: cooldown,
      dailyLimit
    }
    if (kind === 'market') {
      const threshold = Number(value)
      if (!Number.isFinite(threshold)) {
        onNotify('A market condition needs a number to compare against.', 'error')
        return
      }
      patch.subject = { kind: subject } as AlertSubject
      patch.comparison = comparison
      patch.value = threshold
    }
    if (kind === 'alert') {
      if (alertId === '') {
        onNotify('Choose which alert should start it.', 'error')
        return
      }
      patch.alertId = alertId
    }
    if (kind === 'connection') patch.connection = connection

    setBusy(true)
    try {
      const result = await window.api.marketsTriggerSave(patch)
      if (refused(result)) {
        onNotify(result.message ?? 'That trigger could not be saved', 'error')
        return
      }
      await load()
      setValue('')
      onNotify('Trigger added')
    } finally {
      setBusy(false)
    }
  }, [workflowId, kind, instrumentId, cooldown, dailyLimit, value, subject, comparison, alertId, connection, load, onNotify])

  const toggle = useCallback(
    async (trigger: MarketTrigger) => {
      const result = await window.api.marketsTriggerSave({ ...trigger, enabled: !trigger.enabled })
      if (refused(result)) {
        onNotify(result.message ?? 'That could not be changed', 'error')
        return
      }
      await load()
    },
    [load, onNotify]
  )

  const remove = useCallback(
    async (id: string) => {
      const result = await window.api.marketsTriggerRemove(id)
      if (refused(result)) {
        onNotify(result.message ?? 'That could not be removed', 'error')
        return
      }
      await load()
    },
    [load, onNotify]
  )

  const nameOf = useCallback(
    (id: string): string => workflows.find((one) => one.id === id)?.name ?? id,
    [workflows]
  )

  const usableAlerts = useMemo(
    () => alerts.filter((one) => one.instrumentId === instrumentId || kind !== 'market'),
    [alerts, instrumentId, kind]
  )

  return (
    <section className="mk-triggers" aria-label="Workflow triggers">
      <div className="mk-triggers-intro">
        <Zap size={15} />
        <p>
          A trigger starts a workflow when something happens. It fires on the <b>change</b>, not on the state — “price
          above 100” starts it as the price crosses 100, not repeatedly while it stays there.
        </p>
      </div>

      {workflows.length === 0 && (
        <p className="mk-problem">
          <AlertTriangle size={13} /> There are no workflows to start yet. Build one first, then come back — a trigger
          has to have something to start.
        </p>
      )}

      <div className="mk-trigger-build">
        <div className="mk-alert-row">
          <select value={kind} aria-label="What starts it" onChange={(e) => setKind(e.target.value as TriggerKind)}>
            {KINDS.map((one) => (
              <option key={one.id} value={one.id}>
                {one.label}
              </option>
            ))}
          </select>
          <span className="mk-quiet">{KINDS.find((one) => one.id === kind)?.describe}</span>
        </div>

        {kind === 'market' && (
          <div className="mk-alert-row">
            <span className="mk-quiet">On {symbol}:</span>
            <select value={subject} aria-label="What to watch" onChange={(e) => setSubject(e.target.value)}>
              {SUBJECTS.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.label}
                </option>
              ))}
            </select>
            <select
              value={comparison}
              aria-label="Condition"
              onChange={(e) => setComparison(e.target.value as Comparison)}
            >
              {COMPARISONS.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={value}
              placeholder="value"
              aria-label="Threshold"
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        )}

        {kind === 'alert' && (
          <div className="mk-alert-row">
            <select value={alertId} aria-label="Which alert" onChange={(e) => setAlertId(e.target.value)}>
              <option value="">Choose an alert…</option>
              {usableAlerts.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.label}
                </option>
              ))}
            </select>
            {usableAlerts.length === 0 && <span className="mk-quiet">No alerts set yet.</span>}
          </div>
        )}

        {kind === 'connection' && (
          <div className="mk-alert-row">
            <select
              value={connection}
              aria-label="Which connection state"
              onChange={(e) => setConnection(e.target.value as typeof connection)}
            >
              <option value="disconnected">when the feed drops</option>
              <option value="reconnecting">when it starts reconnecting</option>
              <option value="connected">when it comes back</option>
            </select>
          </div>
        )}

        {kind === 'screen' && (
          <p className="pw-note is-quiet">
            A screen trigger runs a saved screen on a schedule and fires on what it returns. Save a screen in the
            Screener first, then it can be chosen here.
          </p>
        )}

        <div className="mk-alert-row">
          <label className="mk-inline">
            <span>Starts</span>
            <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} aria-label="Which workflow">
              <option value="">Choose a workflow…</option>
              {workflows.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mk-inline">
            <span>At most every</span>
            <select value={String(cooldown)} onChange={(e) => setCooldown(Number(e.target.value))}>
              {COOLDOWNS.map((ms) => (
                <option key={ms} value={ms}>
                  {cooldownLabel(ms)}
                </option>
              ))}
            </select>
          </label>
          <label className="mk-inline">
            <span>Daily cap</span>
            <input
              type="number"
              min={0}
              max={200}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
              aria-label="Most times a day"
            />
          </label>
          <button
            type="button"
            className="queue-btn small"
            disabled={busy || workflows.length === 0}
            onClick={() => void save()}
          >
            <Plus size={13} /> Add trigger
          </button>
        </div>

        <p className="pw-note is-quiet">
          A minute is the shortest gap allowed between two firings, because a workflow does real work. A daily cap of 0
          means no cap.
        </p>
      </div>

      <div className="mk-alert-list">
        <div className="mk-alert-head">
          <h4>
            {rows.length} trigger{rows.length === 1 ? '' : 's'}
          </h4>
        </div>

        {loading && rows.length === 0 && <p className="mk-quiet">Loading…</p>}

        {!loading && rows.length === 0 ? (
          <div className="mk-empty-small">
            <p>Nothing set yet.</p>
            <p className="pw-note is-quiet">
              A trigger is judged as data arrives, not on a timer, so it starts a workflow when the market does
              something rather than when a clock says so.
            </p>
          </div>
        ) : (
          <ul className="mk-rows">
            {rows.map(({ trigger, describe }) => (
              <li key={trigger.id} className={`mk-row mk-alert${trigger.enabled ? '' : ' is-off'}`}>
                <span className="mk-row-name">
                  <Workflow size={13} />
                  <b>{nameOf(trigger.workflowId)}</b>
                </span>
                {/* The engine's own sentence, so the list says exactly what the engine will judge. */}
                <span className="mk-alert-condition">{describe}</span>
                <span className="mk-quiet">
                  {trigger.lastFiredAt
                    ? `last ran ${new Date(trigger.lastFiredAt).toLocaleString()}`
                    : 'has not run yet'}
                  {trigger.dailyLimit > 0 && ` · ${trigger.firedToday ?? 0}/${trigger.dailyLimit} today`}
                </span>
                <button
                  type="button"
                  className="tl-icon"
                  onClick={() => void toggle(trigger)}
                  title={trigger.enabled ? 'Pause' : 'Resume'}
                  aria-label={trigger.enabled ? 'Pause this trigger' : 'Resume this trigger'}
                >
                  {trigger.enabled ? <Pause size={13} /> : <Play size={13} />}
                </button>
                <button
                  type="button"
                  className="tl-icon mk-danger"
                  onClick={() => void remove(trigger.id)}
                  title="Delete"
                  aria-label="Delete this trigger"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {experience.get('explanations') !== 'minimal' && (
        <p className="pw-note is-quiet">
          Nothing here places an order. A trigger starts a workflow, and what that workflow does is whatever you built
          it to do.
        </p>
      )}
    </section>
  )
}
