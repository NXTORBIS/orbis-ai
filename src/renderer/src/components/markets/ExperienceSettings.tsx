import { useCallback, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useExperience } from './useExperience'
import {
  DENSITIES,
  EXPLANATION_LEVELS,
  LEVEL_LABELS,
  ORION_STYLES,
  PRESET_PREVIEW,
  TERMINOLOGIES,
  type ExperienceLevel,
  type ExperienceSettings as Settings,
  type SettingKey
} from '../../../../shared/markets/experience'

/**
 * Markets Experience, in Settings.
 *
 * The same preferences the first-launch questions set, in the place somebody looks for them afterwards — one settings
 * system, not a second one for the answers. Everything here is live: changing a control writes it and the Markets screen
 * follows, because both read the same resolved profile.
 *
 * The important behaviour is the mark beside a control that says *set by you*. Anything with that mark is an override and
 * no preset will touch it again — which is what makes the level switcher safe to use more than once. Switching from
 * Beginner to Professional is offered with that said out loud, rather than quietly rearranging work somebody did.
 */

const LEVELS: ExperienceLevel[] = ['beginner', 'learning', 'intermediate', 'advanced', 'professional', 'expert']

/** One control. The mark is the point: it says whether a preset can still change this. */
function Choice<K extends SettingKey>({
  label,
  help,
  setting,
  options,
  labels,
  experience
}: {
  label: string
  help?: string
  setting: K
  options: readonly string[]
  labels?: Record<string, string>
  experience: ReturnType<typeof useExperience>
}): React.JSX.Element {
  const mine = experience.source(setting) === 'user'
  return (
    <label className="tl-field mk-xp-field">
      <span>
        {label}
        {mine ? <em className="mk-xp-mine">set by you</em> : null}
      </span>
      <select
        value={String(experience.get(setting))}
        onChange={(event) => void experience.override(setting, event.target.value as Settings[K])}
      >
        {options.map((one) => (
          <option key={one} value={one}>
            {labels?.[one] ?? one[0].toUpperCase() + one.slice(1)}
          </option>
        ))}
      </select>
      {help ? <small className="pw-note is-quiet">{help}</small> : null}
    </label>
  )
}

function Switch({
  label,
  help,
  setting,
  experience
}: {
  label: string
  help?: string
  setting: 'autoEducation' | 'learnActions' | 'glossaryTooltips' | 'chartAdvancedToolbar' | 'showOrderBook' | 'showTrades'
  experience: ReturnType<typeof useExperience>
}): React.JSX.Element {
  const mine = experience.source(setting) === 'user'
  return (
    <label className="tl-check">
      <input
        type="checkbox"
        checked={experience.get(setting)}
        onChange={(event) => void experience.override(setting, event.target.checked)}
      />
      <span>
        {label}
        {mine ? <em className="mk-xp-mine">set by you</em> : null}
        {help ? <small className="pw-note is-quiet">{help}</small> : null}
      </span>
    </label>
  )
}

export default function ExperienceSettings({
  onRunSetup
}: {
  /** Opens the first-launch questions again. Nothing saved is deleted by doing it. */
  onRunSetup?(): void
}): React.JSX.Element {
  const experience = useExperience()
  const [confirming, setConfirming] = useState<ExperienceLevel | ''>('')
  const [detail, setDetail] = useState(false)

  const changed = Object.keys(experience.profile.overrides).length

  const switchTo = useCallback(
    async (level: ExperienceLevel) => {
      setConfirming('')
      await experience.setLevel(level)
    },
    [experience]
  )

  const restart = useCallback(async () => {
    const got = await window.api.marketsOnboardingRestart()
    if (typeof got === 'object' && got !== null && 'error' in got) return
    await experience.refresh()
    onRunSetup?.()
  }, [experience, onRunSetup])

  return (
    <div className="tl-block mk-xp">
      <h4>
        <Sparkles size={13} /> Markets experience
      </h4>
      <p className="pw-note is-quiet">
        How much of Markets is on screen, how much is explained, and in whose words. Every level reads the same real
        market data — this decides how it is presented, and nothing is ever hidden from you.
      </p>

      {/* ---------------------------------------------------------------- the quick switch */}
      <div className="mk-xp-levels">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`mk-onboard-card${experience.level === level ? ' on' : ''}`}
            onClick={() => {
              if (experience.level === level) return
              // Said out loud when there is something to lose. A switch that silently rearranged work somebody had done
              // is the reason people stop touching settings.
              if (changed > 0) setConfirming(level)
              else void switchTo(level)
            }}
            aria-pressed={experience.level === level}
          >
            <b>{LEVEL_LABELS[level]}</b>
            <span className="mk-onboard-preview">
              {(PRESET_PREVIEW[level as keyof typeof PRESET_PREVIEW] ?? []).slice(0, 3).map((line: string) => (
                <i key={line}>{line}</i>
              ))}
            </span>
          </button>
        ))}
      </div>

      {experience.level === 'custom' ? (
        <p className="pw-note is-quiet">Your settings are your own; no preset is being applied.</p>
      ) : null}

      {confirming ? (
        <div className="mk-xp-confirm" role="alertdialog" aria-label={`Switch to ${LEVEL_LABELS[confirming]}?`}>
          <p>
            Switch to {LEVEL_LABELS[confirming]}? This changes the recommended defaults. The {changed} setting
            {changed === 1 ? '' : 's'} you set yourself will be kept.
          </p>
          <span>
            <button type="button" onClick={() => setConfirming('')}>
              Cancel
            </button>
            <button type="button" className="mk-primary" onClick={() => void switchTo(confirming)}>
              Switch
            </button>
          </span>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- what it resolved to */}
      <dl className="mk-xp-summary">
        {(experience.answer?.summary ?? []).map((one) => (
          <div key={one.label}>
            <dt>{one.label}</dt>
            <dd>{one.value}</dd>
          </div>
        ))}
      </dl>

      <button type="button" className="mk-xp-toggle" onClick={() => setDetail((held) => !held)} aria-expanded={detail}>
        {detail ? 'Hide' : 'Customise'}
      </button>

      {detail ? (
        <div className="mk-xp-detail">
          <Choice
            label="Information density"
            help="Row heights, how many metrics a card shows, and how many panels fit."
            setting="density"
            options={DENSITIES}
            experience={experience}
          />
          <Choice
            label="Explanations"
            help="Guided explains as you go; minimal never volunteers a definition."
            setting="explanations"
            options={EXPLANATION_LEVELS}
            experience={experience}
          />
          <Choice
            label="Terminology"
            help="Plain words, standard market terms, or exact technical wording. The same facts either way."
            setting="terminology"
            options={TERMINOLOGIES}
            experience={experience}
          />
          <Choice
            label="Orion"
            help="How Orion answers about markets."
            setting="orionStyle"
            options={ORION_STYLES}
            experience={experience}
          />
          <Choice
            label="Chart type"
            setting="chartType"
            options={['candles', 'line', 'area', 'ohlc']}
            labels={{ candles: 'Candlesticks', line: 'Line', area: 'Area', ohlc: 'OHLC bars' }}
            experience={experience}
          />
          <Choice
            label="Numbers"
            setting="numberStyle"
            options={['words', 'compact']}
            labels={{ words: '10.4 million', compact: '10.4M' }}
            experience={experience}
          />
          <Switch
            label="Explain features the first time they are opened"
            help="Once each, and never again after it has been read."
            setting="autoEducation"
            experience={experience}
          />
          <Switch
            label="Show the “what is this?” marks"
            help="Available at every level, including Professional."
            setting="learnActions"
            experience={experience}
          />
          <Switch label="Define terms on hover" setting="glossaryTooltips" experience={experience} />
          <Switch label="Advanced chart toolbar" setting="chartAdvancedToolbar" experience={experience} />
          <Switch label="Open markets with the order book" setting="showOrderBook" experience={experience} />
          <Switch label="Open markets with live trades" setting="showTrades" experience={experience} />

          <div className="mk-xp-actions">
            <button type="button" onClick={() => void experience.reset()} disabled={changed === 0}>
              Back to the {LEVEL_LABELS[experience.level]} defaults
            </button>
            <button type="button" onClick={() => void restart()}>
              Run Markets setup again
            </button>
          </div>
          <p className="pw-note is-quiet">
            Resetting clears the {changed} setting{changed === 1 ? '' : 's'} you set yourself and nothing else — your
            watchlists, alerts, strategies and simulated account are untouched, as are your Orbis browser settings.
            Running setup again does not delete anything either.
          </p>
        </div>
      ) : null}
    </div>
  )
}
