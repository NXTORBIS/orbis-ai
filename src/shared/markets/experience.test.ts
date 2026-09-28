import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanExperience,
  cleanSettings,
  DEFAULT_EXPERIENCE,
  DEFAULT_SETTINGS,
  describeExperience,
  EXPERIENCE_LEVELS,
  inferExperience,
  LANDINGS,
  orionContext,
  PANELS,
  PRESETS,
  PRESET_PREVIEW,
  readExperienceRequest,
  resolveExperience,
  type ExperienceSettings,
  type MarketsExperienceProfile
} from './experience.ts'
import { INDICATORS } from './indicators.ts'
import { INTERVALS } from './provider.ts'
import { ALL_COLUMNS, TICKER_FIELDS } from './surfaces.ts'

const profile = (patch: Partial<MarketsExperienceProfile> = {}): MarketsExperienceProfile => ({
  ...DEFAULT_EXPERIENCE,
  ...patch
})

// ---------------------------------------------------------------- the presets are made of real things

test('every preset only asks for panels, columns, indicators and intervals that exist', () => {
  const kinds = new Set(INDICATORS.map((one) => one.kind))
  for (const [level, preset] of Object.entries(PRESETS)) {
    for (const panel of preset.panels ?? []) {
      assert.ok(PANELS.includes(panel), `${level} wants a panel that does not exist: ${panel}`)
    }
    for (const column of preset.columns ?? []) {
      assert.ok(ALL_COLUMNS.includes(column), `${level} wants a column no provider reports: ${column}`)
    }
    for (const kind of preset.defaultIndicators ?? []) {
      assert.ok(kinds.has(kind), `${level} wants an indicator Orbis cannot calculate: ${kind}`)
    }
    for (const interval of preset.quickIntervals ?? []) {
      assert.ok(INTERVALS.includes(interval), `${level} wants an interval no provider serves: ${interval}`)
    }
    for (const field of preset.tickerFields ?? []) {
      assert.ok(TICKER_FIELDS.includes(field), `${level} wants a ticker field that does not exist: ${field}`)
    }
    if (preset.landing) assert.ok(LANDINGS.includes(preset.landing), `${level} opens somewhere that does not exist`)
  }
})

test('no panel promises data no configured provider reports', () => {
  // Funding, open interest and liquidations come from a futures API Orbis has no provider for. A panel for them would be
  // an empty box with a confident title.
  for (const forbidden of ['funding', 'openInterest', 'liquidations', 'basis', 'markPrice']) {
    assert.ok(!(PANELS as readonly string[]).includes(forbidden), `${forbidden} is offered as a panel but has no data`)
  }
})

test('every preset resolves to a complete configuration', () => {
  for (const level of EXPERIENCE_LEVELS) {
    const resolved = resolveExperience(profile({ level }))
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ExperienceSettings)[]) {
      assert.notEqual(resolved.settings[key], undefined, `${level} left ${key} undefined`)
    }
    assert.ok(resolved.settings.panels.length > 0, `${level} has no panels`)
  }
})

test('each preset is previewed with the number of lines the chooser shows', () => {
  for (const level of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
    assert.ok(PRESET_PREVIEW[level].length >= 3, `${level} is not described`)
  }
})

// ---------------------------------------------------------------- a level actually changes the experience

test('beginner and professional differ in every way that matters', () => {
  const beginner = resolveExperience(profile({ level: 'beginner' })).settings
  const pro = resolveExperience(profile({ level: 'professional' })).settings

  assert.notEqual(beginner.density, pro.density)
  assert.notEqual(beginner.explanations, pro.explanations)
  assert.notEqual(beginner.terminology, pro.terminology)
  assert.notEqual(beginner.orionStyle, pro.orionStyle)
  assert.notEqual(beginner.chartType, pro.chartType)
  assert.notEqual(beginner.numberStyle, pro.numberStyle)
  assert.notEqual(beginner.panels.join(), pro.panels.join())
  assert.notEqual(beginner.columns.length, pro.columns.length)
  assert.equal(beginner.autoEducation, true)
  assert.equal(pro.autoEducation, false)
  assert.equal(beginner.defaultIndicators.length, 0)
  assert.ok(pro.defaultIndicators.length >= 2)
  assert.equal(beginner.showOrderBook, false)
  assert.equal(pro.showOrderBook, true)
})

test('no two levels resolve to the same experience', () => {
  const seen = new Map<string, string>()
  for (const level of EXPERIENCE_LEVELS) {
    if (level === 'custom') continue
    const key = JSON.stringify(resolveExperience(profile({ level })).settings)
    const already = seen.get(key)
    assert.equal(already, undefined, `${level} and ${already} are the same experience with two names`)
    seen.set(key, level)
  }
})

test('a professional still gets the definition when they ask for it', () => {
  // The difference is that nothing volunteers one. Turning the affordance off would be locking a professional out of the
  // glossary for having said they were experienced.
  assert.equal(resolveExperience(profile({ level: 'professional' })).get('learnActions'), true)
  assert.equal(resolveExperience(profile({ level: 'expert' })).get('learnActions'), true)
})

test('a beginner can still be given every panel, because nothing here is an allow-list', () => {
  const resolved = resolveExperience(
    profile({ level: 'beginner', overrides: { panels: [...PANELS], showOrderBook: true, showTrades: true } })
  )
  assert.equal(resolved.get('panels').length, PANELS.length)
  assert.equal(resolved.get('showOrderBook'), true)
  assert.equal(resolved.get('showTrades'), true)
})

// ---------------------------------------------------------------- precedence

test('what somebody set by hand beats the preset, the workspace and the answers', () => {
  const resolved = resolveExperience(
    profile({ level: 'beginner', densityWish: 'dense', overrides: { density: 'minimal' } }),
    { density: 'maximum' }
  )
  assert.equal(resolved.get('density'), 'minimal')
  assert.equal(resolved.source('density'), 'user')
  assert.equal(resolved.isOverridden('density'), true)
})

test('a workspace beats the preset and the answers, and nothing else', () => {
  const resolved = resolveExperience(profile({ level: 'beginner', densityWish: 'detailed' }), { density: 'maximum' })
  assert.equal(resolved.get('density'), 'maximum')
  assert.equal(resolved.source('density'), 'workspace')
  assert.equal(resolved.isOverridden('density'), false)
})

test('the answers beat the preset', () => {
  const resolved = resolveExperience(profile({ level: 'beginner', chartPreference: 'candles' }))
  assert.equal(resolved.get('chartType'), 'candles')
  assert.equal(resolved.source('chartType'), 'answers')
})

test('the preset beats the default', () => {
  const resolved = resolveExperience(profile({ level: 'professional' }))
  assert.equal(resolved.source('density'), 'preset')
  assert.notEqual(resolved.get('density'), DEFAULT_SETTINGS.density)
})

test('switching level keeps what somebody set by hand', () => {
  const set = { chartType: 'ohlc', columns: ['symbol', 'price'] } as Partial<ExperienceSettings>
  const asBeginner = resolveExperience(profile({ level: 'beginner', overrides: set }))
  const asPro = resolveExperience(profile({ level: 'professional', overrides: set }))
  assert.equal(asBeginner.get('chartType'), 'ohlc')
  assert.equal(asPro.get('chartType'), 'ohlc')
  assert.deepEqual(asPro.get('columns'), ['symbol', 'price'])
  // Everything they did not touch did change, which is the point of switching.
  assert.notEqual(asBeginner.get('density'), asPro.get('density'))
})

// ---------------------------------------------------------------- the answers, one at a time

test('learning mode raises the explanations whatever the level says', () => {
  for (const level of ['professional', 'expert', 'advanced'] as const) {
    const resolved = resolveExperience(profile({ level, learningMode: true }))
    assert.equal(resolved.get('explanations'), 'guided')
    assert.equal(resolved.get('autoEducation'), true)
    assert.equal(resolved.get('orionStyle'), 'educational')
  }
})

test('somebody who has never used an indicator gets a chart with none on it', () => {
  const resolved = resolveExperience(profile({ level: 'professional', technicalExperience: 'none' }))
  assert.deepEqual(resolved.get('defaultIndicators'), [])
  assert.equal(resolved.get('chartType'), 'line')
  // And still a dense interface, because that is a different question and they answered it differently.
  assert.equal(resolved.get('density'), 'dense')
})

test('indicators somebody chose are the ones a chart opens with', () => {
  const resolved = resolveExperience(profile({ level: 'beginner', indicators: ['rsi', 'macd'] }))
  assert.deepEqual(resolved.get('defaultIndicators'), ['rsi', 'macd'])
})

test('chosen timeframes become the quick buttons, fastest first, and the first one is where a chart opens', () => {
  const resolved = resolveExperience(profile({ timeframes: ['4h', '5m', '1d'] }))
  // `cleanExperience` is what keeps them in market order; a profile built by hand is taken as given.
  assert.deepEqual(resolved.get('quickIntervals'), ['4h', '5m', '1d'])
  assert.equal(resolved.get('defaultInterval'), '4h')
  const cleaned = cleanExperience({ timeframes: ['4h', '5m', '1d'] })
  assert.deepEqual(cleaned.timeframes, ['5m', '4h', '1d'])
})

test('somebody new to crypto gets the plain words, however advanced their charting is', () => {
  const resolved = resolveExperience(profile({ level: 'expert', cryptoKnowledge: 'none' }))
  assert.equal(resolved.get('terminology'), 'plain')
  assert.equal(resolved.get('glossaryTooltips'), true)
})

test('futures familiarity decides whether advanced futures data is placed by default', () => {
  assert.equal(resolveExperience(profile({ derivativesExperience: 'none' })).get('showDerivatives'), false)
  assert.equal(resolveExperience(profile({ derivativesExperience: 'advanced' })).get('showDerivatives'), true)
  assert.equal(resolveExperience(profile({ dataInterests: ['derivatives'] })).get('showDerivatives'), true)
})

test('spot familiarity decides whether the order book introduces itself', () => {
  assert.equal(resolveExperience(profile({ spotExperience: 'none' })).get('bookGuidance'), true)
  assert.equal(resolveExperience(profile({ spotExperience: 'advanced' })).get('bookGuidance'), false)
})

test('somebody who has never traded is told what simulated means', () => {
  assert.equal(resolveExperience(profile({ tradingExperience: 'never' })).get('paperGuidance'), true)
  assert.equal(resolveExperience(profile({ tradingExperience: 'professional' })).get('paperGuidance'), false)
})

test('goals add panels rather than replacing them, and the primary goal decides where Markets opens', () => {
  const resolved = resolveExperience(
    profile({ level: 'beginner', goals: ['portfolio', 'alerts', 'learn'], primaryGoal: 'portfolio', alertWish: 'price' })
  )
  assert.ok(resolved.get('panels').includes('portfolio'))
  assert.ok(resolved.get('panels').includes('alerts'))
  // The beginner preset's own panels survive beside them.
  assert.ok(resolved.get('panels').includes('watchlist'))
  assert.equal(resolved.get('landing'), 'portfolio')
})

test('no news means no news panel, and no alerts means no alerts panel', () => {
  const resolved = resolveExperience(profile({ level: 'professional', newsWish: 'none', alertWish: 'none' }))
  assert.ok(!resolved.get('panels').includes('news'))
  assert.ok(!resolved.get('panels').includes('alerts'))
  assert.equal(resolved.get('newsDetail'), 'none')
})

test('what somebody asked Orion for outranks what their level implies', () => {
  const resolved = resolveExperience(profile({ level: 'expert', orionHelp: ['learn'] }))
  assert.equal(resolved.get('orionStyle'), 'educational')
  assert.equal(resolveExperience(profile({ level: 'beginner', orionHelp: ['concise'] })).get('orionStyle'), 'concise')
})

test('interface style and a density answer both move the density, and the density answer wins', () => {
  assert.equal(resolveExperience(profile({ interfaceStyle: 'terminal' })).get('density'), 'maximum')
  assert.equal(
    resolveExperience(profile({ interfaceStyle: 'terminal', densityWish: 'minimal' })).get('density'),
    'minimal'
  )
})

test('drawing tools appear for somebody who uses them and not for somebody who does not', () => {
  assert.equal(resolveExperience(profile({ drawingTools: 'advanced' })).get('chartDrawing'), true)
  assert.equal(resolveExperience(profile({ level: 'expert', drawingTools: 'never' })).get('chartDrawing'), false)
})

test('the risk answer is about how much is shown and nothing else', () => {
  assert.equal(resolveExperience(profile({ riskPresentation: 'minimal' })).get('riskDetail'), 'simple')
  assert.equal(resolveExperience(profile({ riskPresentation: 'advanced' })).get('riskDetail'), 'advanced')
})

test('a research interest in structure opens the screener on its advanced filters', () => {
  assert.equal(resolveExperience(profile({ researchInterests: ['structure'] })).get('screenerAdvanced'), true)
})

test('asking for the order book or the tape by name gets it, and refusing it keeps it away', () => {
  assert.equal(resolveExperience(profile({ level: 'beginner', orderBookWish: 'yes' })).get('showOrderBook'), true)
  assert.equal(resolveExperience(profile({ level: 'expert', orderBookWish: 'no' })).get('showOrderBook'), false)
  assert.equal(resolveExperience(profile({ level: 'expert', tradesWish: 'no' })).get('showTrades'), false)
})

// ---------------------------------------------------------------- reading one from a file

test('a level, an indicator or an interval that does not exist is dropped, and the rest survives', () => {
  const cleaned = cleanExperience({
    level: 'wizard',
    indicators: ['rsi', 'moonbeam'],
    timeframes: ['1h', '3y'],
    goals: ['learn', 'become rich'],
    chartPreference: 'spaghetti',
    cryptoKnowledge: 'advanced'
  })
  assert.equal(cleaned.level, DEFAULT_EXPERIENCE.level)
  assert.deepEqual(cleaned.indicators, ['rsi'])
  assert.deepEqual(cleaned.timeframes, ['1h'])
  assert.deepEqual(cleaned.goals, ['learn'])
  assert.equal(cleaned.chartPreference, '')
  assert.equal(cleaned.cryptoKnowledge, 'advanced')
})

test('an override for a setting that does not exist is not stored', () => {
  const cleaned = cleanSettings({ density: 'dense', somethingElse: true, panels: ['chart', 'wormhole'] })
  assert.equal(cleaned.density, 'dense')
  assert.equal('somethingElse' in cleaned, false)
  assert.deepEqual(cleaned.panels, ['chart'])
})

test('an override is only recorded when the file actually had one', () => {
  // The difference between "set to false" and "not set" is the whole precedence order: a stored false would pin the
  // setting for ever, and a preset would never be able to change it again.
  assert.equal('showTrades' in cleanSettings({}), false)
  assert.equal('showTrades' in cleanSettings({ showTrades: false }), true)
})

test('nothing in a stored profile can carry text a screen would run', () => {
  const cleaned = cleanExperience({ learned: ['<script>alert(1)</script>', 'rsi'], seenHints: ['a/../b'] })
  assert.deepEqual(cleaned.learned, ['scriptalert1script', 'rsi'])
  assert.deepEqual(cleaned.seenHints, ['a..b'])
})

test('reading a profile twice gives the same profile', () => {
  const once = cleanExperience({ level: 'advanced', goals: ['charts'], overrides: { density: 'dense' } }, 1000)
  const twice = cleanExperience(once, 1000)
  assert.deepEqual(twice, once)
})

// ---------------------------------------------------------------- somebody who was already using Markets

test('somebody with strategies and a simulated account is not treated as a beginner', () => {
  const inferred = inferExperience({ hasStrategies: true, hasPaper: true, hasAlerts: true })
  assert.notEqual(inferred.level, 'beginner')
  assert.equal(inferred.level, 'advanced')
})

test('an existing configuration becomes an override, so no preset can undo it', () => {
  const inferred = inferExperience({
    columns: ['symbol', 'price', 'bid', 'ask'],
    chartType: 'ohlc',
    interval: '4h',
    indicators: [{ kind: 'rsi' }, { kind: 'macd' }]
  })
  assert.deepEqual(inferred.overrides.columns, ['symbol', 'price', 'bid', 'ask'])
  assert.equal(inferred.overrides.chartType, 'ohlc')
  assert.equal(inferred.overrides.defaultInterval, '4h')
  // And the override survives a switch to the preset that would otherwise have replaced it.
  const asBeginner = resolveExperience({ ...inferred, level: 'beginner' })
  assert.equal(asBeginner.get('chartType'), 'ohlc')
  assert.equal(asBeginner.get('defaultInterval'), '4h')
})

test('nothing is inferred about somebody from settings that say nothing', () => {
  const inferred = inferExperience({})
  assert.deepEqual(inferred.overrides, {})
  assert.equal(inferred.level, 'intermediate')
})

// ---------------------------------------------------------------- what Orion is told

test('Orion is told a style and a vocabulary, and nothing about the person', () => {
  const context = orionContext(resolveExperience(profile({ level: 'beginner', tradingExperience: 'professional' })))
  assert.deepEqual(Object.keys(context).sort(), ['defineTerms', 'level', 'style', 'suggestions', 'terminology'].sort())
  // Their trading history was answered as "professional" and must not reach Orion in any form.
  const asText = JSON.stringify(context)
  for (const leaked of ['professional', 'tradingExperience', 'goals', 'assetInterests']) {
    assert.ok(!asText.includes(leaked), `Orion is being told about ${leaked}`)
  }
})

test('minimal explanations mean Orion does not define its terms unasked', () => {
  assert.equal(orionContext(resolveExperience(profile({ level: 'professional' }))).defineTerms, false)
  assert.equal(orionContext(resolveExperience(profile({ level: 'beginner' }))).defineTerms, true)
})

test('the summary says what the interface is doing and nothing about the person', () => {
  const summary = describeExperience(resolveExperience(profile({ level: 'advanced', tradingExperience: 'active' })))
  const labels = summary.map((one) => one.label)
  for (const forbidden of ['Trading', 'Goals', 'Crypto knowledge']) {
    assert.ok(!labels.includes(forbidden), `the summary is showing ${forbidden}`)
  }
  assert.ok(labels.includes('Experience'))
  assert.ok(labels.includes('Information density'))
})

// ---------------------------------------------------------------- asking for a change in words

test('a request to make Markets easier is read as one', () => {
  assert.deepEqual(readExperienceRequest('make markets beginner-friendly'), { level: 'beginner', learningMode: true })
  assert.deepEqual(readExperienceRequest('make this easier to understand'), { level: 'beginner', learningMode: true })
  assert.equal(readExperienceRequest('switch me to professional mode')?.level, 'professional')
  assert.equal(readExperienceRequest('give me the full expert experience')?.level, 'expert')
})

test('a request to stop explaining is read as one, and not as a request to be a beginner', () => {
  const patch = readExperienceRequest('stop explaining basic terms')
  assert.equal(patch?.learningMode, false)
  assert.equal(patch?.overrides?.explanations, 'minimal')
  assert.equal(patch?.level, undefined)
})

test('an ordinary sentence is not read as a request to rearrange somebody’s interface', () => {
  for (const said of [
    'what is the bitcoin price',
    'show me the order book',
    'add ethereum to my watchlist',
    'how much is solana in rupees',
    ''
  ]) {
    assert.equal(readExperienceRequest(said), null, `"${said}" was read as a request to change the experience`)
  }
})
