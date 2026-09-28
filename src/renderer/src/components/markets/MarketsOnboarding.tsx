import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, Search, Sparkles, X } from 'lucide-react'
import AssetLogo from './AssetLogo'
import {
  canLeave,
  EMPTY_DRAFT,
  isAnswered,
  nextStep,
  previousStep,
  problemsWith,
  progressOf,
  reviewOf,
  stepFor,
  suggestedSearches,
  visibleSteps,
  type AssetChoice,
  type OnboardingDraft,
  type OnboardingStep
} from '../../../../shared/markets/onboarding'
import {
  LEVEL_LABELS,
  PRESET_PREVIEW,
  type ExperienceLevel,
  type MarketsExperienceProfile
} from '../../../../shared/markets/experience'
import type { Instrument } from '../../../../shared/markets/instrument'
import type { CurrencyAnswer } from '../../../../main/markets/ipc'

/**
 * The first time somebody opens Markets.
 *
 * Rendered from the same schema the main process validates against, so a question cannot be on screen with an answer the
 * store would refuse, and a question that was skipped as irrelevant cannot still be required. The alternative — a form
 * here and a list of fields there — is how an onboarding comes to have a screen whose answer is silently discarded.
 *
 * Three things this screen is careful about.
 *
 * **Nothing here invents a market.** The asset chooser searches the real registry through the real providers. What comes
 * back is what a provider has; a search with no results shows none rather than a plausible row.
 *
 * **Nothing is committed until the end.** Every answer goes into a draft that is written as somebody goes, so closing
 * Orbis eight screens in does not lose eight screens. The profile itself is replaced once, after validation.
 *
 * **It is skippable.** Somebody who does not want to answer questions gets the balanced defaults and a complete
 * configuration, not a half-configured Markets.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

type Phase = 'asking' | 'applying' | 'done' | 'error'

export default function MarketsOnboarding({
  onFinished,
  onNotify
}: {
  /** Called once the profile has actually been applied. */
  onFinished(): void
  onNotify(message: string, kind?: 'error' | 'info'): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<OnboardingDraft>({ ...EMPTY_DRAFT })
  const [phase, setPhase] = useState<Phase>('asking')
  const [resumed, setResumed] = useState(false)
  const [currency, setCurrency] = useState<CurrencyAnswer | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---------------------------------------------------------------- resuming

  useEffect(() => {
    void (async () => {
      const [record, money] = await Promise.all([window.api.marketsOnboarding(), window.api.marketsCurrency()])
      if (!refused(money)) setCurrency(money)
      if (!refused(record) && record.record.draft) {
        setDraft(record.record.draft)
        setResumed(true)
      }
    })()
  }, [])

  /**
   * Writes the draft down, a moment after somebody stops changing it.
   *
   * Debounced because choosing five goals is five changes and one intention. The draft is the only thing written while
   * the questions are open: nothing reaches the experience profile until the end.
   */
  const remember = useCallback((next: OnboardingDraft) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void window.api.marketsOnboardingDraft(next)
    }, 500)
  }, [])

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  const change = useCallback(
    (edit: (held: OnboardingDraft) => OnboardingDraft) => {
      setDraft((held) => {
        const next = edit(held)
        remember(next)
        return next
      })
    },
    [remember]
  )

  const answer = useCallback(
    (field: keyof MarketsExperienceProfile, value: unknown) => {
      change((held) => ({ ...held, profile: { ...held.profile, [field]: value } }))
    },
    [change]
  )

  // ---------------------------------------------------------------- where we are

  const visible = useMemo(() => visibleSteps(draft), [draft])
  const step = useMemo(() => stepFor(draft.step) ?? visible[0], [draft.step, visible])
  const progress = useMemo(() => progressOf(draft), [draft])
  const problems = useMemo(() => problemsWith(draft), [draft])
  const review = useMemo(() => reviewOf(draft), [draft])
  const onLast = step?.id === 'review'
  const canGo = step ? canLeave(step, draft) : false

  const go = useCallback(
    (where: 'next' | 'back') => {
      setDraft((held) => {
        const next = { ...held, step: where === 'next' ? nextStep(held) : previousStep(held) }
        remember(next)
        return next
      })
    },
    [remember]
  )

  // ---------------------------------------------------------------- finishing

  const finish = useCallback(async () => {
    setPhase('applying')
    const got = await window.api.marketsOnboardingApply(draft)
    if (refused(got) || !got.ok) {
      setPhase('error')
      onNotify(refused(got) ? (got.message ?? 'Markets could not save your setup.') : 'Some answers are missing.', 'error')
      return
    }
    if (typeof got.missing === 'number' && got.missing > 0) {
      // Said rather than hidden. A watchlist that came back short should say so.
      onNotify(`${got.missing} market${got.missing === 1 ? '' : 's'} could not be found and were left out.`, 'info')
    }
    setPhase('done')
  }, [draft, onNotify])

  const skip = useCallback(async () => {
    setPhase('applying')
    const got = await window.api.marketsOnboardingSkip()
    if (refused(got)) {
      setPhase('error')
      onNotify(got.message ?? 'Markets could not save that.', 'error')
      return
    }
    onFinished()
  }, [onFinished, onNotify])

  // ---------------------------------------------------------------- the keyboard

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (phase !== 'asking') return
      const target = event.target as HTMLElement | null
      // Enter inside a search box belongs to the search box.
      if (target?.tagName === 'INPUT' && event.key === 'Enter') return
      if (event.key === 'Enter' && canGo) {
        event.preventDefault()
        if (onLast) void finish()
        else go('next')
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        go('back')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [phase, canGo, onLast, finish, go])

  // ---------------------------------------------------------------- the screens

  if (phase === 'done') {
    return <Finished draft={draft} onEnter={onFinished} />
  }

  if (phase === 'applying') {
    return (
      <div className="mk-onboard" role="status">
        <div className="mk-onboard-centre">
          <Loader2 className="mk-spin" size={28} />
          {/* Only the states that are actually happening. A fake progress bar would be the one dishonest thing on the
              screen that set everything else up honestly. */}
          <h2>Applying your setup</h2>
          <p className="mk-quiet">Saving your preferences and configuring Markets.</p>
        </div>
      </div>
    )
  }

  if (!step) return <div className="mk-onboard" />

  return (
    <div className="mk-onboard">
      <header className="mk-onboard-top">
        <span className="mk-onboard-brand">
          <Sparkles size={14} /> Orbis Markets
        </span>
        <span className="mk-onboard-rail" aria-hidden="true">
          {visible.map((one) => (
            <i key={one.id} className={one.id === step.id ? 'on' : isAnswered(one, draft) ? 'done' : ''} />
          ))}
        </span>
        <span className="mk-onboard-count">
          {step.section} · {progress.at} of {progress.of}
        </span>
        <button type="button" className="mk-onboard-skip" onClick={() => void skip()}>
          Skip setup
        </button>
      </header>

      {resumed && step.id !== 'review' ? (
        <p className="mk-onboard-resumed">Picking up where you left off.</p>
      ) : null}

      <div className="mk-onboard-body" key={step.id}>
        <h1>{step.question}</h1>
        {step.description ? <p className="mk-onboard-why">{step.description}</p> : null}

        {step.kind === 'welcome' ? <Welcome /> : null}
        {step.kind === 'path' || step.kind === 'single' || step.kind === 'ticker' ? (
          <Choices step={step} draft={draft} onChange={change} onAnswer={answer} />
        ) : null}
        {step.kind === 'multi' ? <Choices step={step} draft={draft} onChange={change} onAnswer={answer} multi /> : null}
        {step.kind === 'assets' || step.kind === 'tickerAssets' ? (
          <Assets step={step} draft={draft} onChange={change} />
        ) : null}
        {step.kind === 'currency' ? <Currency draft={draft} onChange={change} answer={currency} /> : null}
        {step.kind === 'review' ? <Review lines={review} problems={problems.map((one) => one.message)} /> : null}

        {step.kind !== 'welcome' && step.kind !== 'review' ? (
          // Said for every question, because a question whose effect is not visible is a question that feels like a form.
          <p className="mk-onboard-affects">
            <b>What this changes:</b> {step.affects}
          </p>
        ) : null}
      </div>

      <footer className="mk-onboard-foot">
        <button type="button" onClick={() => go('back')} disabled={progress.at <= 1}>
          <ArrowLeft size={14} /> Back
        </button>
        {onLast ? (
          <button type="button" className="mk-primary" onClick={() => void finish()} disabled={problems.length > 0}>
            <Check size={14} /> Finish
          </button>
        ) : (
          <button type="button" className="mk-primary" onClick={() => go('next')} disabled={!canGo}>
            {step.optional && !isAnswered(step, draft) ? 'Skip this' : 'Continue'} <ArrowRight size={14} />
          </button>
        )}
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------- the pieces

function Welcome(): React.JSX.Element {
  return (
    <div className="mk-onboard-welcome">
      <p>
        Orbis will match the interface, the charts, how much is explained and how Orion answers to the way you use crypto
        markets.
      </p>
      <ul>
        <li>Every experience level reads the same real market data.</li>
        <li>Nothing is hidden from you — only arranged differently.</li>
        <li>You can change any of it afterwards, at any time.</li>
      </ul>
    </div>
  )
}

/**
 * The option cards.
 *
 * One component for every question with a fixed set of answers, whether one or several — which is what keeps a new
 * question to a line in the schema rather than a new screen here.
 */
function Choices({
  step,
  draft,
  onChange,
  onAnswer,
  multi = false
}: {
  step: OnboardingStep
  draft: OnboardingDraft
  onChange(edit: (held: OnboardingDraft) => OnboardingDraft): void
  onAnswer(field: keyof MarketsExperienceProfile, value: unknown): void
  multi?: boolean
}): React.JSX.Element {
  const chosen = useMemo((): string[] => {
    if (step.kind === 'path') return draft.path ? [draft.path] : []
    if (step.kind === 'ticker') return draft.ticker ? [draft.ticker] : []
    const value = step.field ? draft.profile[step.field] : undefined
    if (Array.isArray(value)) return value as string[]
    return typeof value === 'string' && value ? [value] : []
  }, [step, draft])

  const choose = (value: string): void => {
    if (step.kind === 'path') {
      onChange((held) => ({ ...held, path: value as OnboardingDraft['path'] }))
      return
    }
    if (step.kind === 'ticker') {
      onChange((held) => ({ ...held, ticker: value as OnboardingDraft['ticker'] }))
      return
    }
    if (!step.field) return
    if (!multi) {
      onAnswer(step.field, value)
      return
    }
    const next = chosen.includes(value) ? chosen.filter((one) => one !== value) : [...chosen, value]
    onAnswer(step.field, step.max && next.length > step.max ? next.slice(-step.max) : next)
  }

  const isLevels = step.id === 'experience'

  return (
    <div className={`mk-onboard-cards${isLevels ? ' is-levels' : ''}${step.options && step.options.length > 8 ? ' is-many' : ''}`} role={multi ? 'group' : 'radiogroup'}>
      {(step.options ?? []).map((option) => {
        const on = chosen.includes(option.value)
        const preview = isLevels ? (PRESET_PREVIEW[option.value as keyof typeof PRESET_PREVIEW] ?? []) : []
        return (
          <button
            key={option.value}
            type="button"
            className={`mk-onboard-card${on ? ' on' : ''}`}
            onClick={() => choose(option.value)}
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={on}
          >
            <b>{option.label}</b>
            {option.detail ? <small>{option.detail}</small> : null}
            {preview.length > 0 ? (
              // What choosing this actually does, from the same table the engine resolves from.
              <span className="mk-onboard-preview">
                {preview.map((line) => (
                  <i key={line}>{line}</i>
                ))}
              </span>
            ) : null}
            {on ? <Check size={14} className="mk-onboard-tick" /> : null}
          </button>
        )
      })}
      {multi && step.max ? <p className="mk-quiet">Up to {step.max}.</p> : null}
    </div>
  )
}

/**
 * Choosing real markets.
 *
 * Searched against the real registry through the real providers, so nothing on this screen is a market that does not
 * exist. The suggestions come from what somebody said they follow — as searches, never as assets, so an interest can only
 * ever surface something a provider actually has.
 */
function Assets({
  step,
  draft,
  onChange
}: {
  step: OnboardingStep
  draft: OnboardingDraft
  onChange(edit: (held: OnboardingDraft) => OnboardingDraft): void
}): React.JSX.Element {
  const forTicker = step.kind === 'tickerAssets'
  const chosen = forTicker ? draft.tickerAssets : draft.watchlistAssets
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Instrument[]>([])
  const [searching, setSearching] = useState(false)
  const [note, setNote] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const look = useCallback(async (wanted: string) => {
    if (wanted.trim().length < 2) {
      setResults([])
      setNote('')
      return
    }
    setSearching(true)
    const got = await window.api.marketsSearch(wanted.trim())
    setSearching(false)
    if (refused(got)) {
      setResults([])
      setNote(got.message ?? 'That search did not work.')
      return
    }
    setResults(got.results.slice(0, 24))
    // Nothing found is said as nothing found, not left as an empty box that looks like it is still loading.
    setNote(got.results.length === 0 ? 'No market matches that.' : '')
  }, [])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void look(query), 250)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, look])

  // The first thing on screen: a search for whatever they said they follow.
  const suggestions = useMemo(() => suggestedSearches(draft.profile.assetInterests ?? []), [draft.profile.assetInterests])
  useEffect(() => {
    if (query === '' && suggestions.searches.length > 0) void look(suggestions.searches[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (instrument: Instrument): void => {
    const choice: AssetChoice = {
      instrumentId: instrument.instrumentId,
      symbol: instrument.symbol,
      name: instrument.name
    }
    onChange((held) => {
      const list = forTicker ? held.tickerAssets : held.watchlistAssets
      const next = list.some((one) => one.instrumentId === choice.instrumentId)
        ? list.filter((one) => one.instrumentId !== choice.instrumentId)
        : [...list, choice]
      return forTicker ? { ...held, tickerAssets: next } : { ...held, watchlistAssets: next }
    })
  }

  return (
    <div className="mk-onboard-assets">
      <label className="mk-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search bitcoin, ETH, SOL…"
          aria-label="Search markets"
        />
      </label>

      {suggestions.searches.length > 0 ? (
        <span className="mk-onboard-suggest">
          {suggestions.searches.slice(0, 8).map((one) => (
            <button key={one} type="button" onClick={() => setQuery(one)}>
              {one}
            </button>
          ))}
        </span>
      ) : null}

      {chosen.length > 0 ? (
        <span className="mk-onboard-chosen">
          {chosen.map((one) => (
            <button
              key={one.instrumentId}
              type="button"
              onClick={() =>
                onChange((held) => {
                  const list = forTicker ? held.tickerAssets : held.watchlistAssets
                  const next = list.filter((other) => other.instrumentId !== one.instrumentId)
                  return forTicker ? { ...held, tickerAssets: next } : { ...held, watchlistAssets: next }
                })
              }
            >
              <AssetLogo symbol={one.symbol} size="tiny" />
              {one.symbol}
              <X size={12} />
            </button>
          ))}
        </span>
      ) : null}

      {searching ? <em className="mk-quiet">Searching…</em> : null}
      {note ? <em className="mk-quiet">{note}</em> : null}

      <ul className="mk-onboard-results">
        {results.map((one) => {
          const on = chosen.some((other) => other.instrumentId === one.instrumentId)
          return (
            <li key={one.instrumentId}>
              <button type="button" className={on ? 'on' : ''} onClick={() => toggle(one)} aria-pressed={on}>
                <AssetLogo symbol={one.symbol} size="small" />
                <b>{one.symbol}</b>
                <small>{one.name}</small>
                {on ? <Check size={14} /> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The currency.
 *
 * Automatic reads the system's region and nothing else. There is no location prompt here and no coordinate stored
 * anywhere — what is kept is a three-letter code.
 */
function Currency({
  draft,
  onChange,
  answer
}: {
  draft: OnboardingDraft
  onChange(edit: (held: OnboardingDraft) => OnboardingDraft): void
  answer: CurrencyAnswer | null
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const detected = answer?.preference.code ?? ''
  const region = answer?.preference.detectedRegion ?? ''
  const currencies = answer?.currencies ?? []
  const matching = useMemo(() => {
    const wanted = query.trim().toLowerCase()
    if (!wanted) return currencies.slice(0, 24)
    return currencies
      .filter((one) => `${one.code} ${one.name} ${one.symbol}`.toLowerCase().includes(wanted))
      .slice(0, 24)
  }, [currencies, query])

  return (
    <div className="mk-onboard-currency">
      <div className="mk-onboard-cards">
        <button
          type="button"
          className={`mk-onboard-card${draft.currencyMode === 'automatic' ? ' on' : ''}`}
          onClick={() => onChange((held) => ({ ...held, currencyMode: 'automatic', currency: '' }))}
          role="radio"
          aria-checked={draft.currencyMode === 'automatic'}
        >
          <b>Automatic</b>
          <small>
            {detected
              ? `Your system suggests ${detected}${region ? ` (region ${region})` : ''}.`
              : 'From your system region.'}
          </small>
          {draft.currencyMode === 'automatic' ? <Check size={14} className="mk-onboard-tick" /> : null}
        </button>
        <button
          type="button"
          className={`mk-onboard-card${draft.currencyMode === 'manual' ? ' on' : ''}`}
          onClick={() => onChange((held) => ({ ...held, currencyMode: 'manual' }))}
          role="radio"
          aria-checked={draft.currencyMode === 'manual'}
        >
          <b>Choose one</b>
          <small>Orbis will not change it afterwards.</small>
          {draft.currencyMode === 'manual' ? <Check size={14} className="mk-onboard-tick" /> : null}
        </button>
      </div>

      {draft.currencyMode === 'manual' ? (
        <>
          <label className="mk-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search currencies…"
              aria-label="Search currencies"
            />
          </label>
          <ul className="mk-onboard-results is-currency">
            {matching.map((one) => (
              <li key={one.code}>
                <button
                  type="button"
                  className={draft.currency === one.code ? 'on' : ''}
                  onClick={() => onChange((held) => ({ ...held, currency: one.code }))}
                  aria-label={`${one.name} (${one.code})`}
                >
                  <span className="mk-onboard-symbol">{one.symbol}</span>
                  <b>{one.code}</b>
                  <small>{one.name}</small>
                  {draft.currency === one.code ? <Check size={14} /> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {answer && answer.preference.code !== 'USD' ? (
        <p className="mk-quiet">
          {answer.rate
            ? `Prices are quoted in ${answer.base} and converted at the published rate.`
            : 'Prices will be shown in their source currency until an exchange rate is available.'}
        </p>
      ) : null}
    </div>
  )
}

function Review({ lines, problems }: { lines: { label: string; value: string }[]; problems: string[] }): React.JSX.Element {
  return (
    <div className="mk-onboard-review">
      {problems.length > 0 ? (
        <ul className="mk-onboard-problems">
          {problems.map((one) => (
            <li key={one}>{one}</li>
          ))}
        </ul>
      ) : null}
      <dl>
        {lines.map((one) => (
          <div key={one.label}>
            <dt>{one.label}</dt>
            <dd>{one.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mk-quiet">
        These choices customise your Markets interface. You can change any of them later in Settings → Markets.
      </p>
    </div>
  )
}

function Finished({ draft, onEnter }: { draft: OnboardingDraft; onEnter(): void }): React.JSX.Element {
  const level = (draft.profile.level ?? 'intermediate') as ExperienceLevel
  const teaching = level === 'beginner' || level === 'learning' || draft.profile.learningMode === true
  return (
    <div className="mk-onboard">
      <div className="mk-onboard-centre">
        <h2>Your Markets experience is ready.</h2>
        <ul className="mk-onboard-summary">
          <li>{LEVEL_LABELS[level]}</li>
          {draft.profile.primaryGoal ? <li>{draft.profile.primaryGoal}</li> : null}
          {draft.currencyMode === 'manual' && draft.currency ? <li>{draft.currency}</li> : null}
          {draft.ticker === 'yes' ? <li>Live ticker on</li> : null}
          {teaching ? <li>Guided explanations</li> : null}
        </ul>
        <button type="button" className="mk-primary" onClick={onEnter}>
          {teaching ? 'Start learning' : 'Enter Markets'} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}
