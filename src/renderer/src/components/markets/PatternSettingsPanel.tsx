import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Info, Settings2 } from 'lucide-react'
import type { PatternSettings } from '../../../../shared/markets/patternSettings'

/**
 * The detector's switches, each shown with what it actually stops.
 *
 * The sentence under every control comes from the main process, from the one table the engine itself reads. That is the
 * point: a description written here could drift away from what the switch does, and then the screen would be lying
 * about its own controls. If a switch is ever added without an effect, that table has no entry for it and a test fails.
 */

interface State {
  settings: PatternSettings
  defaults: PatternSettings
  whatStops: Record<string, string>
}

const MODES: { value: PatternSettings['mode']; label: string; describe: string }[] = [
  { value: 'standard', label: 'Standard', describe: 'Balanced. Finds formations that are recognisably the named shape.' },
  { value: 'strict', label: 'Strict', describe: 'Only formations well inside the canonical definition. Misses real ones that are slightly off.' },
  { value: 'research', label: 'Research', describe: 'Includes formations that are only approximately the named shape. More of them, less canonical.' }
]

const RETENTIONS: { value: PatternSettings['retention']; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: 'A year' },
  { value: 'forever', label: 'Until deleted' }
]

export function PatternSettingsPanel(): React.JSX.Element {
  const [state, setState] = useState<State | null>(null)
  const [problem, setProblem] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await window.api.marketsPatternSettings()
      if ('error' in result) {
        setProblem(result.message ?? 'That did not work.')
        return
      }
      setProblem('')
      setState({ settings: result.settings, defaults: result.defaults, whatStops: result.whatStops })
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async (patch: Partial<PatternSettings>) => {
    setSaving(true)
    try {
      const result = await window.api.marketsPatternSettingsSave(patch)
      if ('error' in result) {
        setProblem(result.message ?? 'That did not save.')
        return
      }
      setProblem('')
      setState((held) => (held === null ? held : { ...held, settings: result.settings, whatStops: result.whatStops }))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.')
    } finally {
      setSaving(false)
    }
  }, [])

  if (state === null) {
    return (
      <section className="mk-panel" aria-label="Candlestick pattern settings">
        <header className="mk-panel-head">
          <h3>
            <Settings2 size={15} aria-hidden /> Candlestick patterns
          </h3>
        </header>
        {problem !== '' ? (
          <p className="mk-problem" role="alert">
            <AlertTriangle size={14} aria-hidden /> {problem}
          </p>
        ) : (
          <p className="mk-empty">Loading…</p>
        )}
      </section>
    )
  }

  const { settings, whatStops } = state

  /** A switch, with the sentence the engine itself uses for what it stops. */
  const Toggle = ({ name, label }: { name: keyof PatternSettings & string; label: string }): React.JSX.Element => (
    <div className="mk-setting">
      <label className="mk-switch">
        <input
          type="checkbox"
          checked={settings[name] === true}
          disabled={saving}
          onChange={(e) => void save({ [name]: e.target.checked } as Partial<PatternSettings>)}
        />
        <span>{label}</span>
      </label>
      <p className="mk-setting-note">{whatStops[name]}</p>
    </div>
  )

  return (
    <section className="mk-panel" aria-label="Candlestick pattern settings">
      <header className="mk-panel-head">
        <h3>
          <Settings2 size={15} aria-hidden /> Candlestick patterns
        </h3>
      </header>

      {problem !== '' && (
        <p className="mk-problem" role="alert">
          <AlertTriangle size={14} aria-hidden /> {problem}
        </p>
      )}

      <Toggle name="enabled" label="Detect candlestick patterns" />

      {!settings.enabled && (
        <p className="mk-note" role="note">
          <Info size={14} aria-hidden /> Everything below is inactive while detection is off. Nothing has been reset: the
          rules, the history and the mutes are all where they were.
        </p>
      )}

      <fieldset disabled={!settings.enabled}>
        <legend>What to look for</legend>

        <div className="mk-setting">
          <label className="mk-field">
            <span>How close to the definition</span>
            <select value={settings.mode} disabled={saving} onChange={(e) => void save({ mode: e.target.value as PatternSettings['mode'] })}>
              {MODES.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mk-setting-note">{MODES.find((one) => one.value === settings.mode)?.describe}</p>
          <p className="mk-setting-note">
            This changes how willing the detector is to call a shape by a name. It changes nothing about what the price
            then does.
          </p>
        </div>

        <div className="mk-setting">
          <label className="mk-field">
            <span>Ignore formations below this match strength</span>
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.05}
              value={settings.minimumMatch}
              disabled={saving}
              onChange={(e) => void save({ minimumMatch: Number(e.target.value) })}
            />
            <output>{(settings.minimumMatch * 100).toFixed(0)}%</output>
          </label>
          <p className="mk-setting-note">{whatStops.minimumMatch}</p>
        </div>

        <div className="mk-setting">
          <label className="mk-field">
            <span>Ignore formations below this data quality</span>
            <select
              value={settings.minimumDataQuality}
              disabled={saving}
              onChange={(e) => void save({ minimumDataQuality: e.target.value as PatternSettings['minimumDataQuality'] })}
            >
              <option value="poor">Poor and above</option>
              <option value="reduced">Reduced and above</option>
              <option value="high">High only</option>
            </select>
          </label>
          <p className="mk-setting-note">{whatStops.minimumDataQuality}</p>
        </div>

        <Toggle name="developing" label="Report formations on the candle still forming" />
        <Toggle name="nearMisses" label="Report formations that missed by one rule" />
      </fieldset>

      <fieldset disabled={!settings.enabled}>
        <legend>Context</legend>
        <Toggle name="context" label="Gather the surrounding market context" />
        <Toggle name="multiTimeframe" label="Examine the other timeframes" />
        <div className="mk-setting">
          <span className="mk-setting-label">Which timeframes</span>
          <div className="mk-chips">
            {['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'].map((one) => {
              const on = settings.timeframes.includes(one)
              return (
                <button
                  key={one}
                  type="button"
                  className={on ? 'mk-chip mk-chip-on' : 'mk-chip'}
                  disabled={saving || !settings.multiTimeframe}
                  aria-pressed={on}
                  onClick={() =>
                    void save({ timeframes: on ? settings.timeframes.filter((x) => x !== one) : [...settings.timeframes, one].slice(0, 6) })
                  }
                >
                  {one}
                </button>
              )
            })}
          </div>
          <p className="mk-setting-note">{whatStops.timeframes}</p>
          {settings.multiTimeframe && settings.timeframes.length === 0 && (
            <p className="mk-note" role="note">
              <Info size={14} aria-hidden /> No timeframe is chosen, so the multi-timeframe reading examines none. A rule
              requiring timeframe agreement cannot be satisfied.
            </p>
          )}
        </div>
      </fieldset>

      <fieldset disabled={!settings.enabled}>
        <legend>On the chart</legend>
        <Toggle name="markers" label="Draw markers on the chart" />
        <div className="mk-setting">
          <label className="mk-field">
            <span>How much each marker shows</span>
            <select
              value={settings.markerDetail}
              disabled={saving || !settings.markers}
              onChange={(e) => void save({ markerDetail: e.target.value as PatternSettings['markerDetail'] })}
            >
              <option value="off">Nothing</option>
              <option value="minimal">A bracket only</option>
              <option value="normal">Bracket and direction</option>
              <option value="detailed">Bracket, direction and name</option>
            </select>
          </label>
          <p className="mk-setting-note">{whatStops.markerDetail}</p>
        </div>
      </fieldset>

      <fieldset disabled={!settings.enabled}>
        <legend>Alerts</legend>
        <Toggle name="alerts" label="Alert on detected patterns" />
        <Toggle name="images" label="Include a chart image with each alert" />
        <div className="mk-setting">
          <label className="mk-field">
            <span>Periodic summary</span>
            <select value={settings.digest} disabled={saving} onChange={(e) => void save({ digest: e.target.value as PatternSettings['digest'] })}>
              <option value="off">None</option>
              <option value="quarter-hour">Every fifteen minutes</option>
              <option value="hour">Hourly</option>
              <option value="day">Daily</option>
            </select>
          </label>
          <p className="mk-setting-note">{whatStops.digest}</p>
        </div>
        {!settings.alerts && (
          <p className="mk-note" role="note">
            <Info size={14} aria-hidden /> Alerts are off by default. Detection still runs, so the chart and the panel show
            what was found without anything interrupting you.
          </p>
        )}
      </fieldset>

      <fieldset disabled={!settings.enabled}>
        <legend>History</legend>
        <Toggle name="history" label="Keep a record of what was detected" />
        <div className="mk-setting">
          <label className="mk-field">
            <span>Keep records for</span>
            <select
              value={settings.retention}
              disabled={saving || !settings.history}
              onChange={(e) => void save({ retention: e.target.value as PatternSettings['retention'] })}
            >
              {RETENTIONS.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mk-setting-note">{whatStops.retention}</p>
          {settings.retention === 'forever' && (
            <p className="mk-note" role="note">
              <Info size={14} aria-hidden /> Records and their chart images will be kept until you delete them. The images
              are the part that takes space.
            </p>
          )}
        </div>
      </fieldset>

      <fieldset disabled={!settings.enabled}>
        <legend>Orion</legend>
        <Toggle name="orion" label="Let Orion explain a detection" />
        <p className="mk-setting-note">
          Orion is asked only when you ask it. Detection, alerts, charts and history all keep working whether Orion is
          available or not, because the detector is arithmetic and does not call a model.
        </p>
      </fieldset>

      <p className="mk-note mk-pattern-foot" role="note">
        <AlertTriangle size={14} aria-hidden /> Candlestick patterns describe what the candles did. Detecting one does not
        indicate what the price will do next, and nothing here places an order: Orbis has no path from a detection to an
        exchange.
      </p>
    </section>
  )
}
