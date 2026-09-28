import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allowedValues,
  applyDraft,
  canLeave,
  cleanDraft,
  cleanOnboarding,
  EMPTY_DRAFT,
  isAnswered,
  needsOnboarding,
  nextStep,
  previousStep,
  problemsWith,
  progressOf,
  REGISTRIES,
  reviewOf,
  skippedSetup,
  STEPS,
  stepFor,
  suggestedSearches,
  visibleSteps,
  type OnboardingDraft
} from './onboarding.ts'
import { DEFAULT_EXPERIENCE, resolveExperience, type MarketsExperienceProfile } from './experience.ts'
import { CURRENCIES } from './currency.ts'

const draft = (patch: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
  ...EMPTY_DRAFT,
  ...patch,
  profile: { ...(patch.profile ?? {}) }
})

const asset = (symbol: string) => ({
  instrumentId: `binance:${symbol}USDT`,
  symbol: `${symbol}USDT`,
  name: symbol
})

// ---------------------------------------------------------------- every question earns its place

test('every question stores something the adaptation engine reads', () => {
  // The audit the spec asks for, done mechanically rather than promised. For each question with a field and a set of
  // answers, at least two of those answers must resolve to different configurations — otherwise the question changes
  // nothing and should not be on somebody's screen on first launch.
  const undone: string[] = []
  for (const step of STEPS) {
    if (!step.field || !step.options || step.options.length < 2) continue
    // One question steers the asset chooser instead of the settings. It is checked below, against the searches it
    // produces -- not excused from having an effect.
    if (step.outsideSettings) continue
    const resolved = new Set<string>()
    for (const option of step.options) {
      const base: MarketsExperienceProfile = { ...DEFAULT_EXPERIENCE }
      const value = step.kind === 'multi' ? [option.value] : option.value
      const profile = { ...base, [step.field]: value } as MarketsExperienceProfile
      resolved.add(JSON.stringify(resolveExperience(profile).settings))
    }
    if (resolved.size < 2) undone.push(`${step.id} (${step.field})`)
  }
  assert.deepEqual(
    undone,
    [],
    `these questions change nothing, so they should not be asked:\n  ${undone.join('\n  ')}`
  )
})

test('every question says what it changes', () => {
  for (const step of STEPS) {
    assert.ok(step.affects.length > 10, `${step.id} does not say what it affects`)
  }
})

test('no question offers an option the profile would refuse', () => {
  const allowed: Record<string, readonly string[]> = {
    level: REGISTRIES.levels,
    goals: REGISTRIES.goals,
    primaryGoal: REGISTRIES.goals,
    cryptoKnowledge: REGISTRIES.familiarity,
    spotExperience: REGISTRIES.familiarity,
    derivativesExperience: REGISTRIES.familiarity,
    technicalExperience: REGISTRIES.familiarity,
    tradingExperience: REGISTRIES.trading,
    researchInterests: REGISTRIES.research,
    assetInterests: REGISTRIES.interests,
    orionHelp: REGISTRIES.orion,
    interfaceStyle: REGISTRIES.styles,
    densityWish: REGISTRIES.densities,
    indicators: REGISTRIES.indicators,
    timeframes: REGISTRIES.intervals
  }
  for (const step of STEPS) {
    const list = step.field ? allowed[step.field] : undefined
    if (!list) continue
    for (const value of allowedValues(step)) {
      assert.ok(list.includes(value), `${step.id} offers ${value}, which the profile would drop`)
    }
  }
})

test('the indicators offered are the ones Orbis can calculate, and no others', () => {
  const step = stepFor('indicators')
  assert.ok(step)
  assert.deepEqual(allowedValues(step), [...REGISTRIES.indicators])
})

test('no question asks about money, income, wealth or age', () => {
  const asText = JSON.stringify(STEPS).toLowerCase()
  for (const forbidden of [
    'income',
    'net worth',
    'how much can you afford',
    'salary',
    'your age',
    'employment',
    'wealth',
    'afford to lose'
  ]) {
    assert.ok(!asText.includes(forbidden), `a question asks about ${forbidden}`)
  }
})

test('no question asks for a location', () => {
  // The questions themselves, not the explanatory text: the currency screen mentions location precisely to say Orbis
  // never asks for one, and a test that could not tell the two apart would be a test that forbade saying so.
  const asked = STEPS.map((one) => `${one.title} ${one.question}`.toLowerCase()).join(' | ')
  for (const forbidden of ['location', 'where do you live', 'coordinates', 'gps', 'postcode', 'zip code', 'country']) {
    assert.ok(!asked.includes(forbidden), `a question asks for ${forbidden}`)
  }
  assert.ok(stepFor('currency')?.description?.includes('never asks for your location'))
})

test('the interests question steers the asset chooser, and every option it offers does something', () => {
  const step = stepFor('interests')
  assert.ok(step)
  for (const value of allowedValues(step)) {
    const { searches, movers } = suggestedSearches([value])
    assert.ok(searches.length > 0 || movers, `the interest ${value} suggests nothing at all`)
  }
})

test('the futures question says outright that there is no provider for it yet', () => {
  const step = stepFor('derivatives')
  assert.ok(step?.description?.includes('No configured provider'))
})

// ---------------------------------------------------------------- which questions get asked

test('the quick path asks far fewer questions than the long one', () => {
  const quick = visibleSteps(draft({ path: 'quick', profile: { level: 'beginner' } })).length
  const full = visibleSteps(draft({ path: 'full', profile: { level: 'professional', goals: ['charts'] } })).length
  assert.ok(full > quick + 5, `quick asked ${quick} and full asked ${full}`)
})

test('somebody who did not ask about charts is not walked through timeframes and drawing tools', () => {
  const ids = visibleSteps(draft({ path: 'full', profile: { level: 'beginner', goals: ['track', 'news'] } })).map(
    (one) => one.id
  )
  assert.ok(!ids.includes('timeframes'))
  assert.ok(!ids.includes('drawing'))
  assert.ok(!ids.includes('chart'))
})

test('somebody who has never used an indicator is not asked which indicators they use', () => {
  const ids = visibleSteps(
    draft({ path: 'full', profile: { level: 'advanced', goals: ['charts'], technicalExperience: 'none' } })
  ).map((one) => one.id)
  assert.ok(ids.includes('chart'))
  assert.ok(!ids.includes('indicators'))
})

test('a beginner is not asked to choose an information density', () => {
  const beginner = visibleSteps(draft({ path: 'full', profile: { level: 'beginner' } })).map((one) => one.id)
  const pro = visibleSteps(draft({ path: 'full', profile: { level: 'professional' } })).map((one) => one.id)
  assert.ok(!beginner.includes('density'))
  assert.ok(pro.includes('density'))
})

test('the ticker markets are only asked for when the ticker was wanted', () => {
  assert.ok(!visibleSteps(draft({ ticker: 'no' })).some((one) => one.id === 'tickerAssets'))
  assert.ok(!visibleSteps(draft({ ticker: 'later' })).some((one) => one.id === 'tickerAssets'))
  assert.ok(visibleSteps(draft({ ticker: 'yes' })).some((one) => one.id === 'tickerAssets'))
})

test('the primary goal is only asked for when there is more than one goal', () => {
  assert.ok(!visibleSteps(draft({ profile: { goals: ['learn'] } })).some((one) => one.id === 'primaryGoal'))
  assert.ok(visibleSteps(draft({ profile: { goals: ['learn', 'track'] } })).some((one) => one.id === 'primaryGoal'))
})

test('changing an earlier answer shortens what is left to ask', () => {
  const asPro = visibleSteps(draft({ path: 'full', profile: { level: 'professional', goals: ['charts'] } })).length
  const asBeginner = visibleSteps(draft({ path: 'full', profile: { level: 'beginner', goals: ['track'] } })).length
  assert.ok(asBeginner < asPro)
})

// ---------------------------------------------------------------- moving through them

test('next and back walk only the questions being asked', () => {
  const held = draft({ path: 'quick', step: 'welcome' })
  assert.equal(nextStep(held), 'path')
  assert.equal(nextStep({ ...held, step: 'path' }), 'experience')
  assert.equal(previousStep({ ...held, step: 'experience' }), 'path')
  // Back from the first step stays put rather than walking off the front.
  assert.equal(previousStep({ ...held, step: 'welcome' }), 'welcome')
})

test('going forward from the last question stays on the review', () => {
  assert.equal(nextStep(draft({ step: 'review' })), 'review')
})

test('progress counts only the questions actually being asked', () => {
  const held = draft({ path: 'quick', step: 'experience' })
  const progress = progressOf(held)
  assert.equal(progress.at, 3)
  assert.equal(progress.of, visibleSteps(held).length)
})

test('a question cannot be left unanswered unless it was optional', () => {
  const experience = stepFor('experience')
  assert.ok(experience)
  assert.equal(canLeave(experience, draft()), false)
  assert.equal(canLeave(experience, draft({ profile: { level: 'beginner' } })), true)

  const interests = stepFor('interests')
  assert.ok(interests)
  assert.equal(canLeave(interests, draft()), true)
  assert.equal(isAnswered(interests, draft()), false)
})

test('the currency question needs either automatic or a currency Orbis can convert to', () => {
  const step = stepFor('currency')
  assert.ok(step)
  assert.equal(isAnswered(step, draft({ currencyMode: '' })), false)
  assert.equal(isAnswered(step, draft({ currencyMode: 'automatic' })), true)
  assert.equal(isAnswered(step, draft({ currencyMode: 'manual', currency: 'ZZZ' })), false)
  assert.equal(isAnswered(step, draft({ currencyMode: 'manual', currency: CURRENCIES[0].code })), true)
})

// ---------------------------------------------------------------- reading a draft back

test('a draft keeps only the answers that were actually given', () => {
  const cleaned = cleanDraft({ step: 'goals', path: 'full', profile: { level: 'advanced' } })
  assert.deepEqual(Object.keys(cleaned.profile), ['level'])
  assert.equal(cleaned.profile.level, 'advanced')
  // Not filled in with defaults, because a default written into a draft would read later as a deliberate answer.
  assert.equal('goals' in cleaned.profile, false)
})

test('a draft cannot carry in an answer the profile would refuse', () => {
  const cleaned = cleanDraft({ profile: { level: 'wizard', indicators: ['rsi', 'moonbeam'] } })
  assert.equal(cleaned.profile.level, DEFAULT_EXPERIENCE.level)
  assert.deepEqual(cleaned.profile.indicators, ['rsi'])
})

test('a market with no id or no symbol is not kept, because there would be nothing behind it', () => {
  const cleaned = cleanDraft({
    watchlistAssets: [asset('BTC'), { instrumentId: '', symbol: 'GHOST' }, { instrumentId: 'x:Y', symbol: '' }]
  })
  assert.equal(cleaned.watchlistAssets.length, 1)
  assert.equal(cleaned.watchlistAssets[0].symbol, 'BTCUSDT')
})

test('the same market twice is one market', () => {
  const cleaned = cleanDraft({ watchlistAssets: [asset('BTC'), asset('BTC'), asset('ETH')] })
  assert.equal(cleaned.watchlistAssets.length, 2)
})

test('a currency the file names that Orbis cannot convert to is dropped', () => {
  assert.equal(cleanDraft({ currency: 'ZZZ' }).currency, '')
  assert.equal(cleanDraft({ currency: 'inr' }).currency, 'INR')
})

test('a finished onboarding keeps no draft', () => {
  const record = cleanOnboarding({ completed: true, version: 1, draft: { step: 'goals' } })
  assert.equal(record.draft, null)
  const unfinished = cleanOnboarding({ completed: false, draft: { step: 'goals' } })
  assert.equal(unfinished.draft?.step, 'goals')
})

test('onboarding is shown once and then never again', () => {
  assert.equal(needsOnboarding(cleanOnboarding(null)), true)
  assert.equal(needsOnboarding(cleanOnboarding({ completed: true, version: 1 })), false)
  assert.equal(needsOnboarding(cleanOnboarding({ completed: true, version: 1, skipped: true })), false)
})

// ---------------------------------------------------------------- committing it

test('an unanswered question stops the whole thing being applied', () => {
  const problems = problemsWith(draft({ path: 'full' }))
  assert.ok(problems.some((one) => one.step === 'experience'))
  assert.ok(problems.some((one) => one.step === 'goals'))
})

test('a complete draft has nothing wrong with it', () => {
  const held = draft({
    path: 'quick',
    profile: { level: 'beginner', goals: ['learn'], cryptoKnowledge: 'none', technicalExperience: 'none', newsWish: 'headlines', alertWish: 'none', tradingExperience: 'never' },
    ticker: 'yes',
    tickerAssets: [asset('BTC')],
    currencyMode: 'automatic'
  })
  assert.deepEqual(problemsWith(held), [])
})

test('applying a draft produces a profile, a ticker, a currency and a watchlist', () => {
  const applied = applyDraft(
    draft({
      profile: { level: 'professional', goals: ['charts'], indicators: ['rsi'] },
      ticker: 'yes',
      tickerAssets: [asset('BTC'), asset('ETH')],
      currencyMode: 'manual',
      currency: 'INR',
      watchlistAssets: [asset('SOL')],
      watchlistName: 'Mine'
    }),
    1000
  )
  assert.equal(applied.profile.level, 'professional')
  assert.deepEqual(applied.profile.indicators, ['rsi'])
  assert.equal(applied.ticker?.enabled, true)
  assert.deepEqual(applied.ticker?.instrumentIds, ['binance:BTCUSDT', 'binance:ETHUSDT'])
  assert.deepEqual(applied.currency, { mode: 'manual', code: 'INR' })
  assert.equal(applied.watchlist?.name, 'Mine')
  assert.equal(applied.watchlist?.assets.length, 1)
})

test('the ticker falls back to the markets somebody just chose rather than being empty', () => {
  const applied = applyDraft(draft({ ticker: 'yes', watchlistAssets: [asset('BTC')] }))
  assert.deepEqual(applied.ticker?.instrumentIds, ['binance:BTCUSDT'])
})

test('no means off, and later means leave it exactly as it is', () => {
  assert.deepEqual(applyDraft(draft({ ticker: 'no' })).ticker, { enabled: false, instrumentIds: [] })
  assert.equal(applyDraft(draft({ ticker: 'later' })).ticker, null)
  assert.equal(applyDraft(draft({ ticker: '' })).ticker, null)
})

test('no markets chosen creates no watchlist, rather than an empty one to delete', () => {
  assert.equal(applyDraft(draft({})).watchlist, null)
})

test('a currency that was never chosen is left on automatic', () => {
  assert.equal(applyDraft(draft({})).currency, null)
  assert.deepEqual(applyDraft(draft({ currencyMode: 'automatic' })).currency, { mode: 'automatic', code: '' })
  // A manual mode with a currency Orbis cannot convert to is not a manual choice.
  assert.equal(applyDraft(draft({ currencyMode: 'manual', currency: 'ZZZ' })).currency, null)
})

test('applying a draft changes the experience it describes', () => {
  const beginner = applyDraft(draft({ profile: { level: 'beginner', goals: ['learn'] } }))
  const pro = applyDraft(draft({ profile: { level: 'professional', goals: ['charts'] } }))
  const a = resolveExperience(beginner.profile).settings
  const b = resolveExperience(pro.profile).settings
  assert.notEqual(a.density, b.density)
  assert.notEqual(a.explanations, b.explanations)
  assert.notEqual(a.panels.join(), b.panels.join())
})

test('skipping leaves a complete configuration and touches nothing else', () => {
  const skipped = skippedSetup(1000)
  assert.equal(skipped.ticker, null)
  assert.equal(skipped.currency, null)
  assert.equal(skipped.watchlist, null)
  const resolved = resolveExperience(skipped.profile)
  assert.equal(resolved.level, 'intermediate')
  assert.equal(resolved.get('density'), 'balanced')
  assert.ok(resolved.get('panels').length > 0)
})

// ---------------------------------------------------------------- the review

test('the review describes what is about to be applied and nothing else', () => {
  const held = draft({
    profile: { level: 'advanced', goals: ['charts', 'alerts'], indicators: ['rsi'] },
    ticker: 'yes',
    currencyMode: 'manual',
    currency: 'INR',
    watchlistAssets: [asset('BTC')]
  })
  const lines = reviewOf(held)
  const byLabel = new Map(lines.map((one) => [one.label, one.value]))
  assert.equal(byLabel.get('Experience'), 'Advanced')
  assert.equal(byLabel.get('Ticker'), 'On')
  assert.equal(byLabel.get('Currency'), 'INR')
  assert.equal(byLabel.get('Watchlist'), 'BTCUSDT')
  assert.equal(byLabel.get('Indicators'), 'rsi')
  // A question nobody answered is not in the review claiming a value.
  assert.equal(byLabel.has('Density'), false)
})

// ---------------------------------------------------------------- what an interest suggests

test('an interest becomes a search, never an asset', () => {
  const { searches, movers } = suggestedSearches(['bitcoin', 'meme'])
  assert.ok(searches.includes('bitcoin'))
  assert.ok(searches.includes('doge'))
  assert.equal(movers, false)
  // Each of these is a term to search the real registry with -- not a market, not a price, and not a claim that the
  // provider has it.
  for (const search of searches) assert.equal(typeof search, 'string')
})

test('asking for movers is not a search, because the real snapshot already answers it', () => {
  const { searches, movers } = suggestedSearches(['movers'])
  assert.deepEqual(searches, [])
  assert.equal(movers, true)
})

test('an interest nobody recognises suggests nothing rather than something made up', () => {
  assert.deepEqual(suggestedSearches(['tulips']), { searches: [], movers: false })
})
