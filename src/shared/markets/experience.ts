import { INDICATORS, type IndicatorKind } from './indicators.ts'
import { INTERVALS, type Interval } from './provider.ts'
import { ALL_COLUMNS, DEFAULT_COLUMNS, TICKER_FIELDS, type TickerField } from './surfaces.ts'

/**
 * How Markets should behave for the person using it.
 *
 * There is one Markets. This file is the layer that decides how much of it is on screen at once, how much is explained,
 * and in whose vocabulary — and nothing else. The rule that makes the whole idea defensible: **every experience level
 * reads the same market data through the same gateway.** A beginner is not shown a rounder number, a simpler truth or a
 * kinder freshness label; they are shown the same figure with a sentence saying what it is. Presentation adapts. Data
 * does not.
 *
 * Two things follow from that, and both are enforced below rather than intended.
 *
 * **A preset is a default, not a cage.** `overrides` holds what somebody set by hand, and it wins over every preset
 * forever after. An application that keeps restoring its own idea of the right chart type is one nobody trusts with a
 * setting — so switching from Beginner to Professional changes the settings nobody has touched, and leaves the rest.
 *
 * **Beginner does not mean less capability.** Nothing here removes a feature. `showDerivatives` decides whether a panel
 * is on screen by default, not whether it exists; `screenerAdvanced` decides which filters are in front of you, not
 * which ones the engine will run. Every level can reach everything, which is why there is no allow-list anywhere in
 * this file.
 */

// ---------------------------------------------------------------- what somebody told us

export type ExperienceLevel =
  | 'beginner'
  | 'learning'
  | 'intermediate'
  | 'advanced'
  | 'professional'
  | 'expert'
  | 'custom'

export const EXPERIENCE_LEVELS: ExperienceLevel[] = [
  'beginner',
  'learning',
  'intermediate',
  'advanced',
  'professional',
  'expert',
  'custom'
]

/** How familiar somebody says they are with something. Their words about their own experience, and nothing more. */
export type Familiarity = 'none' | 'learning' | 'basic' | 'comfortable' | 'advanced' | 'professional'

export const FAMILIARITY: Familiarity[] = ['none', 'learning', 'basic', 'comfortable', 'advanced', 'professional']

export type TradingExperience = 'never' | 'paper' | 'occasional' | 'regular' | 'active' | 'professional'

export const TRADING_EXPERIENCE: TradingExperience[] = [
  'never',
  'paper',
  'occasional',
  'regular',
  'active',
  'professional'
]

export type InterfaceStyle = 'simple' | 'balanced' | 'professional' | 'data' | 'terminal'

export const INTERFACE_STYLES: InterfaceStyle[] = ['simple', 'balanced', 'professional', 'data', 'terminal']

export type DrawingUse = 'never' | 'sometimes' | 'often' | 'advanced'

export type PanelWish = 'no' | 'sometimes' | 'yes'

export type NewsWish = 'none' | 'headlines' | 'balanced' | 'detailed' | 'professional'

export type AlertWish = 'none' | 'price' | 'priceVolume' | 'technical' | 'all'

export type RiskWish = 'minimal' | 'balanced' | 'detailed' | 'advanced'

/**
 * The goals somebody can say they have. Each one is a thing Markets actually does, which is why there is no
 * "portfolio rebalancing" or "tax reporting" in the list.
 */
export const GOALS = [
  'learn',
  'track',
  'research',
  'news',
  'charts',
  'watchlists',
  'volatility',
  'paper',
  'backtest',
  'technical',
  'portfolio',
  'alerts',
  'compare',
  'trends'
] as const

export type Goal = (typeof GOALS)[number]

/** The research angles Orbis can honestly serve. Deliberately short: on-chain and DeFi metrics have no provider here. */
export const RESEARCH_INTERESTS = ['price', 'technical', 'structure', 'derivatives', 'news', 'sentiment'] as const

export type ResearchInterest = (typeof RESEARCH_INTERESTS)[number]

/** Discovery preferences. Not recommendations, and never read as any. */
export const ASSET_INTERESTS = [
  'bitcoin',
  'ethereum',
  'largeCap',
  'altcoins',
  'stablecoins',
  'layer1',
  'layer2',
  'ai',
  'gaming',
  'meme',
  'movers'
] as const

export type AssetInterest = (typeof ASSET_INTERESTS)[number]

/** What somebody wants Orion to do about markets. */
export const ORION_HELP = ['explain', 'concise', 'analyse', 'learn', 'research', 'charts', 'screen', 'monitor'] as const

export type OrionHelp = (typeof ORION_HELP)[number]

/** Which live figures matter most, used to order the dashboard rather than to decide what exists. */
export const DATA_INTERESTS = ['price', 'volume', 'book', 'trades', 'marketCap', 'volatility', 'derivatives'] as const

export type DataInterest = (typeof DATA_INTERESTS)[number]

// ---------------------------------------------------------------- what the interface does about it

export type Density = 'minimal' | 'balanced' | 'detailed' | 'dense' | 'maximum'

export const DENSITIES: Density[] = ['minimal', 'balanced', 'detailed', 'dense', 'maximum']

/** How much is explained without being asked. `guided` is learning mode; `minimal` never volunteers a definition. */
export type ExplanationLevel = 'minimal' | 'contextual' | 'guided'

export const EXPLANATION_LEVELS: ExplanationLevel[] = ['minimal', 'contextual', 'guided']

/** Whose vocabulary. Never a different fact — "market cap" is market cap at every level. */
export type Terminology = 'plain' | 'standard' | 'technical'

export const TERMINOLOGIES: Terminology[] = ['plain', 'standard', 'technical']

export type OrionStyle = 'concise' | 'balanced' | 'detailed' | 'technical' | 'educational'

export const ORION_STYLES: OrionStyle[] = ['concise', 'balanced', 'detailed', 'technical', 'educational']

/** `words` is "10.4 million", `compact` is "10.4M". Same number, and full precision either way where it matters. */
export type NumberStyle = 'words' | 'compact'

export type RiskDetail = 'simple' | 'balanced' | 'detailed' | 'advanced'

/**
 * The panels a dashboard can be made of.
 *
 * Every one of these is a surface that exists. There is no `funding`, `openInterest` or `liquidations` here, because no
 * configured provider reports them — a preset that put them on a professional's dashboard would be a preset that
 * promises three empty boxes.
 */
export const PANELS = [
  'overview',
  'movers',
  'heatmap',
  'breadth',
  'watchlist',
  'chart',
  'book',
  'trades',
  'news',
  'screener',
  'alerts',
  'portfolio',
  'learn'
] as const

export type Panel = (typeof PANELS)[number]

/**
 * The sections Markets has.
 *
 * Every one of them is reachable at every experience level. What the level decides is which are in front and which are
 * one click further away, which is the difference between arranging a screen and taking something away.
 */
export const SECTIONS = ['markets', 'screener', 'alerts', 'portfolio', 'backtest', 'replay', 'news'] as const

export type Section = (typeof SECTIONS)[number]

/**
 * Which sections sit in the header, in reading order.
 *
 * The rest go behind "More" — still one click away, still with the same keyboard route, never removed. One function
 * decides it so the header and the tests agree about what "in front" means.
 */
export function primarySections(settings: ExperienceSettings): Section[] {
  const wanted = new Set<Section>(['markets'])
  if (settings.panels.includes('screener')) wanted.add('screener')
  if (settings.panels.includes('alerts')) wanted.add('alerts')
  /**
   * Paper trading is always in the header, whatever somebody said about their experience.
   *
   * It used to appear only when the chosen level happened to include it, so somebody who said they had never traded
   * -- exactly the person a practice account is for -- found it behind a "More" menu, under a name that does not
   * say what it is. A place to practise without risking anything is not an advanced feature to be earned; it is the
   * first thing somebody new should be able to find.
   */
  wanted.add('portfolio')
  // Backtesting and replay are the advanced half. They come forward for somebody whose chart already has an advanced
  // toolbar, which is the same answer read twice rather than a second rule about who is advanced.
  if (settings.chartAdvancedToolbar) {
    wanted.add('backtest')
    wanted.add('replay')
  }
  if (settings.newsDetail !== 'none') wanted.add('news')
  return SECTIONS.filter((one) => wanted.has(one))
}

/** Where Markets opens. Each is a real section. */
export const LANDINGS = ['overview', 'watchlist', 'chart', 'news', 'portfolio', 'screener'] as const

export type Landing = (typeof LANDINGS)[number]

/**
 * The resolved configuration: what the interface actually asks.
 *
 * Flat and declarative on purpose. A component asks `settings.chartAdvancedToolbar` and never asks what level somebody
 * is — which is the difference between one adaptation layer and eleven copies of `if (beginner)` scattered through the
 * screens, each drifting from the others.
 */
export interface ExperienceSettings {
  density: Density
  explanations: ExplanationLevel
  terminology: Terminology
  numberStyle: NumberStyle
  orionStyle: OrionStyle
  /** Whether a feature explains itself the first time it is opened. Never twice for the same thing. */
  autoEducation: boolean
  /** The "What is this?" and "Learn this" affordances beside a figure. */
  learnActions: boolean
  /** Whether hovering a term shows its definition. */
  glossaryTooltips: boolean
  chartType: string
  chartAdvancedToolbar: boolean
  chartDrawing: boolean
  defaultIndicators: IndicatorKind[]
  quickIntervals: Interval[]
  defaultInterval: Interval
  showOrderBook: boolean
  showTrades: boolean
  /**
   * Whether advanced futures data is on screen by default *when a provider supplies it*.
   *
   * True for somebody who knows what funding is. It gates a default, never access: there is no configured provider for
   * it today, and this is the setting that will place the panel the day there is one.
   */
  showDerivatives: boolean
  panels: Panel[]
  landing: Landing
  columns: string[]
  screenerAdvanced: boolean
  alertsAdvanced: boolean
  riskDetail: RiskDetail
  newsDetail: NewsWish
  tickerFields: TickerField[]
  /** Which prompts Orion offers. `learning` asks what things mean; `analysis` asks about structure. */
  suggestions: 'learning' | 'balanced' | 'analysis'
  /** Whether paper trading is introduced with an explanation of what simulated means. */
  paperGuidance: boolean
  /**
   * Whether the order book and the trade tape introduce themselves.
   *
   * Separate from `explanations` because it answers a narrower question: somebody can be entirely comfortable with charts
   * and never have read a book of resting orders, and the two halves of a market page should be able to differ about it.
   */
  bookGuidance: boolean
}

export type SettingKey = keyof ExperienceSettings

/**
 * What Markets does for somebody who has said nothing at all.
 *
 * Balanced, not beginner: assuming somebody needs everything explained is as wrong as assuming they need nothing
 * explained, and this is also what a skipped onboarding gets.
 */
export const DEFAULT_SETTINGS: ExperienceSettings = {
  density: 'balanced',
  explanations: 'contextual',
  terminology: 'standard',
  numberStyle: 'compact',
  orionStyle: 'balanced',
  autoEducation: false,
  learnActions: true,
  glossaryTooltips: true,
  chartType: 'candles',
  chartAdvancedToolbar: false,
  chartDrawing: false,
  defaultIndicators: [],
  quickIntervals: ['15m', '1h', '4h', '1d'],
  defaultInterval: '1h',
  showOrderBook: false,
  showTrades: false,
  showDerivatives: false,
  panels: ['overview', 'movers', 'watchlist', 'chart', 'news'],
  landing: 'overview',
  columns: [...DEFAULT_COLUMNS],
  screenerAdvanced: false,
  alertsAdvanced: false,
  riskDetail: 'balanced',
  newsDetail: 'balanced',
  tickerFields: ['price', 'changePercent'],
  suggestions: 'balanced',
  paperGuidance: true,
  bookGuidance: true
}

/**
 * The presets.
 *
 * One table, and the only place a level turns into behaviour. A component that wants to know whether to show the
 * advanced toolbar asks the resolved settings; nothing outside this file reads `level` to decide what to draw.
 */
export const PRESETS: Record<Exclude<ExperienceLevel, 'custom'>, Partial<ExperienceSettings>> = {
  beginner: {
    density: 'minimal',
    explanations: 'guided',
    terminology: 'plain',
    numberStyle: 'words',
    orionStyle: 'educational',
    autoEducation: true,
    learnActions: true,
    glossaryTooltips: true,
    chartType: 'line',
    chartAdvancedToolbar: false,
    chartDrawing: false,
    defaultIndicators: [],
    quickIntervals: ['1h', '1d', '1w'],
    defaultInterval: '1d',
    showOrderBook: false,
    showTrades: false,
    showDerivatives: false,
    panels: ['overview', 'watchlist', 'chart', 'news', 'learn'],
    landing: 'overview',
    columns: ['symbol', 'name', 'price', 'changePercent'],
    screenerAdvanced: false,
    alertsAdvanced: false,
    riskDetail: 'simple',
    newsDetail: 'headlines',
    tickerFields: ['price', 'changePercent'],
    suggestions: 'learning',
    paperGuidance: true,
    bookGuidance: true
  },
  learning: {
    density: 'balanced',
    explanations: 'guided',
    terminology: 'plain',
    numberStyle: 'words',
    orionStyle: 'educational',
    autoEducation: true,
    learnActions: true,
    glossaryTooltips: true,
    chartType: 'candles',
    chartAdvancedToolbar: false,
    chartDrawing: false,
    defaultIndicators: ['sma'],
    quickIntervals: ['1h', '4h', '1d', '1w'],
    defaultInterval: '1d',
    showOrderBook: false,
    showTrades: false,
    showDerivatives: false,
    panels: ['overview', 'movers', 'watchlist', 'chart', 'news', 'learn'],
    landing: 'overview',
    columns: ['symbol', 'name', 'price', 'changePercent', 'volume'],
    screenerAdvanced: false,
    alertsAdvanced: false,
    riskDetail: 'balanced',
    newsDetail: 'balanced',
    tickerFields: ['price', 'changePercent'],
    suggestions: 'learning',
    paperGuidance: true,
    bookGuidance: true
  },
  intermediate: {
    density: 'balanced',
    explanations: 'contextual',
    terminology: 'standard',
    numberStyle: 'compact',
    orionStyle: 'balanced',
    autoEducation: false,
    learnActions: true,
    glossaryTooltips: true,
    chartType: 'candles',
    chartAdvancedToolbar: false,
    chartDrawing: false,
    defaultIndicators: ['ema'],
    quickIntervals: ['15m', '1h', '4h', '1d'],
    defaultInterval: '1h',
    showOrderBook: false,
    showTrades: false,
    showDerivatives: false,
    panels: ['overview', 'movers', 'heatmap', 'watchlist', 'chart', 'news'],
    landing: 'overview',
    columns: [...DEFAULT_COLUMNS],
    screenerAdvanced: false,
    alertsAdvanced: false,
    riskDetail: 'balanced',
    newsDetail: 'balanced',
    tickerFields: ['price', 'changePercent'],
    suggestions: 'balanced',
    paperGuidance: true,
    bookGuidance: true
  },
  advanced: {
    density: 'detailed',
    explanations: 'contextual',
    terminology: 'technical',
    numberStyle: 'compact',
    orionStyle: 'detailed',
    autoEducation: false,
    learnActions: true,
    glossaryTooltips: true,
    chartType: 'candles',
    chartAdvancedToolbar: true,
    chartDrawing: true,
    defaultIndicators: ['ema', 'rsi'],
    quickIntervals: ['5m', '15m', '1h', '4h', '1d'],
    defaultInterval: '1h',
    showOrderBook: true,
    showTrades: false,
    showDerivatives: false,
    panels: ['overview', 'movers', 'heatmap', 'breadth', 'watchlist', 'chart', 'book', 'screener', 'alerts', 'news'],
    landing: 'chart',
    columns: ['symbol', 'price', 'change', 'changePercent', 'volume', 'dayHigh', 'dayLow'],
    screenerAdvanced: true,
    alertsAdvanced: true,
    riskDetail: 'detailed',
    newsDetail: 'detailed',
    tickerFields: ['price', 'changePercent', 'volume'],
    suggestions: 'analysis',
    paperGuidance: false,
    bookGuidance: false
  },
  professional: {
    density: 'dense',
    explanations: 'minimal',
    terminology: 'technical',
    numberStyle: 'compact',
    orionStyle: 'technical',
    autoEducation: false,
    // Still on. A professional who wants a definition should get one; what changes is that nothing volunteers it.
    learnActions: true,
    glossaryTooltips: false,
    chartType: 'candles',
    chartAdvancedToolbar: true,
    chartDrawing: true,
    defaultIndicators: ['ema', 'rsi', 'macd'],
    quickIntervals: ['1m', '5m', '15m', '1h', '4h', '1d'],
    defaultInterval: '15m',
    showOrderBook: true,
    showTrades: true,
    showDerivatives: true,
    panels: [
      'overview',
      'movers',
      'heatmap',
      'breadth',
      'watchlist',
      'chart',
      'book',
      'trades',
      'screener',
      'alerts',
      'portfolio',
      'news'
    ],
    landing: 'chart',
    columns: ['symbol', 'price', 'change', 'changePercent', 'volume', 'dayHigh', 'dayLow', 'bid', 'ask'],
    screenerAdvanced: true,
    alertsAdvanced: true,
    riskDetail: 'advanced',
    newsDetail: 'professional',
    tickerFields: ['price', 'change', 'changePercent', 'volume'],
    suggestions: 'analysis',
    paperGuidance: false,
    bookGuidance: false
  },
  expert: {
    density: 'maximum',
    explanations: 'minimal',
    terminology: 'technical',
    numberStyle: 'compact',
    orionStyle: 'technical',
    autoEducation: false,
    learnActions: true,
    glossaryTooltips: false,
    chartType: 'candles',
    chartAdvancedToolbar: true,
    chartDrawing: true,
    defaultIndicators: ['ema', 'rsi', 'macd', 'atr'],
    quickIntervals: [...INTERVALS],
    defaultInterval: '5m',
    showOrderBook: true,
    showTrades: true,
    showDerivatives: true,
    panels: PANELS.filter((panel) => panel !== 'learn'),
    landing: 'chart',
    columns: [...ALL_COLUMNS],
    screenerAdvanced: true,
    alertsAdvanced: true,
    riskDetail: 'advanced',
    newsDetail: 'professional',
    tickerFields: [...TICKER_FIELDS],
    suggestions: 'analysis',
    paperGuidance: false,
    bookGuidance: false
  }
}

/** What each preset actually does, in the words the chooser shows. Written from the table above, not beside it. */
export const PRESET_PREVIEW: Record<Exclude<ExperienceLevel, 'custom'>, string[]> = {
  beginner: ['Simple line charts', 'Clear explanations', 'Guided tools', 'Learning-focused Orion'],
  learning: ['Candles with one average', 'Explanations kept on', 'Movers and news', 'Orion that teaches'],
  intermediate: ['Balanced interface', 'Standard market tools', 'Explanations on request', 'Balanced Orion'],
  advanced: ['Detailed interface', 'Indicators and drawing', 'Order book', 'Screener and alerts'],
  professional: ['Dense interface', 'Advanced charts', 'Book and live trades', 'Concise technical Orion'],
  expert: ['Maximum information', 'Every panel', 'Every timeframe', 'Technical Orion']
}

// ---------------------------------------------------------------- the profile

/**
 * Everything somebody told Markets about how they want to use it.
 *
 * A preference layer on the existing Orbis profile — not a second identity and not an account. It lives in this
 * profile's own markets file, so two profiles on one machine have two of these and neither can see the other's.
 *
 * What is deliberately *not* here: income, wealth, age, employment, risk tolerance as a financial judgement,
 * investment suitability, or a location. None of it is needed to lay out a dashboard, and collecting it would make this
 * a financial profile wearing an interface profile's label. `riskPresentation` is about how prominent risk *figures*
 * are, and nothing else.
 *
 * Accessibility is also not here. Orbis already has reduced motion, contrast and text size, and they outrank every
 * setting in this file; a second copy under Markets would be two switches for one behaviour.
 */
export interface MarketsExperienceProfile {
  /** Bumped when the shape changes, so a later Orbis can migrate rather than guess. */
  version: number
  level: ExperienceLevel
  goals: Goal[]
  primaryGoal: Goal | ''
  cryptoKnowledge: Familiarity
  tradingExperience: TradingExperience
  spotExperience: Familiarity
  derivativesExperience: Familiarity
  technicalExperience: Familiarity
  researchInterests: ResearchInterest[]
  assetInterests: AssetInterest[]
  /** More explanations than the level would give, chosen deliberately. */
  learningMode: boolean
  interfaceStyle: InterfaceStyle | ''
  orionHelp: OrionHelp[]
  chartPreference: string
  timeframes: Interval[]
  indicators: IndicatorKind[]
  drawingTools: DrawingUse
  dataInterests: DataInterest[]
  orderBookWish: PanelWish
  tradesWish: PanelWish
  newsWish: NewsWish
  alertWish: AlertWish
  riskPresentation: RiskWish
  densityWish: Density | ''
  /**
   * What somebody set by hand.
   *
   * The reason switching preset is safe. Anything in here survives every preset change, because it is the one thing in
   * this file that was not a guess.
   */
  overrides: Partial<ExperienceSettings>
  /** Terms already explained, so the same definition is not pushed at somebody twice. */
  learned: string[]
  /** Hints already shown, for the same reason. */
  seenHints: string[]
  updatedAt: number
}

export const EXPERIENCE_VERSION = 1

/**
 * Somebody who has told us nothing.
 *
 * `level` is `intermediate` rather than `beginner`: guessing that a new person needs everything explained is a guess
 * either way, and the balanced one is the guess that annoys fewer people.
 */
export const DEFAULT_EXPERIENCE: MarketsExperienceProfile = {
  version: EXPERIENCE_VERSION,
  level: 'intermediate',
  goals: [],
  primaryGoal: '',
  cryptoKnowledge: 'basic',
  tradingExperience: 'never',
  spotExperience: 'basic',
  derivativesExperience: 'none',
  technicalExperience: 'basic',
  researchInterests: [],
  assetInterests: [],
  learningMode: false,
  interfaceStyle: '',
  orionHelp: [],
  chartPreference: '',
  timeframes: [],
  indicators: [],
  drawingTools: 'never',
  dataInterests: [],
  orderBookWish: 'sometimes',
  tradesWish: 'sometimes',
  newsWish: 'balanced',
  alertWish: 'none',
  riskPresentation: 'balanced',
  densityWish: '',
  overrides: {},
  learned: [],
  seenHints: [],
  updatedAt: 0
}

// ---------------------------------------------------------------- the adaptation engine

const DENSITY_STYLE: Record<InterfaceStyle, Density> = {
  simple: 'minimal',
  balanced: 'balanced',
  professional: 'detailed',
  data: 'dense',
  terminal: 'maximum'
}

const NEWS_PANEL_WANTED = new Set<NewsWish>(['headlines', 'balanced', 'detailed', 'professional'])

const familiarityRank = (value: Familiarity): number => FAMILIARITY.indexOf(value)

const NEWS_ORDER: NewsWish[] = ['none', 'headlines', 'balanced', 'detailed', 'professional']

/** The more detailed of two news wishes, so an interest cannot quietly reduce what somebody asked for. */
const maxNews = (a: NewsWish, b: NewsWish): NewsWish => (NEWS_ORDER.indexOf(a) >= NEWS_ORDER.indexOf(b) ? a : b)

/** Panels somebody's stated goals imply, in the order a dashboard reads best in. */
function panelsForGoals(profile: MarketsExperienceProfile, base: Panel[]): Panel[] {
  const wanted = new Set<Panel>(base)
  const goals = new Set<Goal>(profile.goals)
  if (goals.has('charts') || goals.has('technical')) wanted.add('chart')
  if (goals.has('watchlists') || goals.has('track')) wanted.add('watchlist')
  if (goals.has('news') || goals.has('research')) wanted.add('news')
  if (goals.has('learn')) wanted.add('learn')
  if (goals.has('portfolio') || goals.has('paper')) wanted.add('portfolio')
  if (goals.has('alerts')) wanted.add('alerts')
  if (goals.has('compare') || goals.has('trends')) wanted.add('movers')
  if (goals.has('volatility')) wanted.add('breadth')
  if (goals.has('research')) wanted.add('screener')
  for (const interest of profile.dataInterests) {
    if (interest === 'book') wanted.add('book')
    if (interest === 'trades') wanted.add('trades')
    if (interest === 'volume' || interest === 'marketCap') wanted.add('movers')
    if (interest === 'volatility') wanted.add('breadth')
  }
  // News is a panel somebody can switch off entirely, and "none" means none.
  if (!NEWS_PANEL_WANTED.has(profile.newsWish)) wanted.delete('news')
  if (profile.alertWish === 'none') wanted.delete('alerts')
  return PANELS.filter((panel) => wanted.has(panel))
}

const LANDING_FOR_GOAL: Partial<Record<Goal, Landing>> = {
  learn: 'overview',
  track: 'watchlist',
  watchlists: 'watchlist',
  charts: 'chart',
  technical: 'chart',
  news: 'news',
  research: 'overview',
  portfolio: 'portfolio',
  paper: 'portfolio',
  backtest: 'chart',
  trends: 'overview',
  compare: 'overview',
  volatility: 'overview',
  alerts: 'overview'
}

/**
 * How Orion should answer about markets.
 *
 * Their request first, their level second. Somebody who asked to be taught gets taught however advanced they said they
 * were — because that is a request, and the level was only ever a guess at one.
 */
function orionStyleFor(profile: MarketsExperienceProfile): OrionStyle {
  const help = new Set<OrionHelp>(profile.orionHelp)
  if (help.has('learn') || help.has('explain')) return 'educational'
  if (help.has('concise')) return 'concise'
  if (help.has('analyse') || help.has('charts') || help.has('screen')) {
    return profile.level === 'professional' || profile.level === 'expert' ? 'technical' : 'detailed'
  }
  if (help.has('research')) return 'detailed'
  if (help.has('monitor')) return 'concise'
  return DEFAULT_SETTINGS.orionStyle
}

/**
 * What somebody's answers imply, over and above their level.
 *
 * This is the part that makes the questions worth asking. A professional who has never used technical analysis gets a
 * dense interface and no indicators; a beginner who chose candlesticks gets candlesticks. Without this layer the
 * onboarding would be thirteen screens that all mean the same as the first one.
 */
function fromAnswers(profile: MarketsExperienceProfile): Partial<ExperienceSettings> {
  const out: Partial<ExperienceSettings> = {}

  if (profile.interfaceStyle) out.density = DENSITY_STYLE[profile.interfaceStyle]
  if (profile.densityWish) out.density = profile.densityWish

  if (profile.learningMode) {
    out.explanations = 'guided'
    out.autoEducation = true
    out.learnActions = true
    out.glossaryTooltips = true
    out.suggestions = 'learning'
    // Learning mode asks for teaching, and a terminal-style answer does not teach.
    out.orionStyle = 'educational'
  }

  // Somebody new to crypto gets the plain words for things whatever their charting is like.
  if (familiarityRank(profile.cryptoKnowledge) <= familiarityRank('learning')) {
    out.terminology = 'plain'
    out.glossaryTooltips = true
  } else if (familiarityRank(profile.cryptoKnowledge) >= familiarityRank('advanced')) {
    out.terminology = 'technical'
  }

  if (profile.chartPreference) out.chartType = profile.chartPreference
  if (profile.timeframes.length > 0) {
    out.quickIntervals = [...profile.timeframes]
    out.defaultInterval = profile.timeframes[0]
  }
  if (profile.indicators.length > 0) out.defaultIndicators = [...profile.indicators]
  // Never used an indicator, and did not ask for one: an empty chart is the honest start.
  if (profile.technicalExperience === 'none' && profile.indicators.length === 0) {
    out.defaultIndicators = []
    if (!profile.chartPreference) out.chartType = 'line'
  }
  if (familiarityRank(profile.technicalExperience) >= familiarityRank('comfortable')) {
    out.chartAdvancedToolbar = true
  }
  if (profile.drawingTools === 'often' || profile.drawingTools === 'advanced') {
    out.chartDrawing = true
    out.chartAdvancedToolbar = true
  } else if (profile.drawingTools === 'never') {
    out.chartDrawing = false
  }

  if (profile.orderBookWish === 'yes') out.showOrderBook = true
  if (profile.orderBookWish === 'no') out.showOrderBook = false
  if (profile.tradesWish === 'yes') out.showTrades = true
  if (profile.tradesWish === 'no') out.showTrades = false

  // Advanced futures data is put in front of somebody who knows what it is, and nobody else.
  out.showDerivatives =
    familiarityRank(profile.derivativesExperience) >= familiarityRank('basic') ||
    profile.dataInterests.includes('derivatives')

  out.newsDetail = profile.newsWish
  out.alertsAdvanced = profile.alertWish === 'technical' || profile.alertWish === 'all'
  out.riskDetail =
    profile.riskPresentation === 'minimal'
      ? 'simple'
      : profile.riskPresentation === 'advanced'
        ? 'advanced'
        : profile.riskPresentation === 'detailed'
          ? 'detailed'
          : 'balanced'

  // Somebody who has not read an order book before is shown what one is, whatever their charting is like.
  out.bookGuidance = familiarityRank(profile.spotExperience) <= familiarityRank('basic')

  // Somebody who has never traded is told what simulated means; somebody who trades professionally is not.
  out.paperGuidance =
    profile.tradingExperience === 'never' || profile.tradingExperience === 'paper' || profile.goals.includes('learn')

  if (profile.researchInterests.includes('news')) out.newsDetail = maxNews(profile.newsWish, 'balanced')
  if (profile.researchInterests.includes('structure') || profile.researchInterests.includes('derivatives')) {
    out.screenerAdvanced = true
  }

  if (profile.orionHelp.length > 0) out.orionStyle = orionStyleFor(profile)

  const landing = profile.primaryGoal ? LANDING_FOR_GOAL[profile.primaryGoal] : undefined
  if (landing) out.landing = landing

  return out
}

/** Where each resolved setting came from, for the diagnostics and for the settings screen's "set by you" mark. */
export type SettingSource = 'default' | 'preset' | 'answers' | 'workspace' | 'user'

export interface ResolvedExperience {
  level: ExperienceLevel
  settings: ExperienceSettings
  /** One value. The only way a component should read any of this. */
  get<K extends SettingKey>(key: K): ExperienceSettings[K]
  /** Where that value came from. */
  source(key: SettingKey): SettingSource
  /** True when somebody set this by hand, which is what a preset must not undo. */
  isOverridden(key: SettingKey): boolean
}

/**
 * Turns a profile into the configuration the interface reads.
 *
 * Precedence, lowest to highest: Orbis default, the level's preset, what the other answers imply, a workspace's
 * override, and then what somebody set by hand. The order is the whole design — it is what lets a preset be a helpful
 * starting point rather than something that keeps overwriting a deliberate choice.
 *
 * Pure, and cheap enough to call on a render, but nothing calls it on a market tick: the result is held by the hook and
 * by the runtime, and replaced when a preference changes rather than when a price does.
 */
export function resolveExperience(
  profile: MarketsExperienceProfile,
  workspaceOverrides: Partial<ExperienceSettings> = {}
): ResolvedExperience {
  const preset = profile.level === 'custom' ? {} : PRESETS[profile.level]
  const layers: { source: SettingSource; values: Partial<ExperienceSettings> }[] = [
    { source: 'preset', values: preset },
    { source: 'answers', values: fromAnswers(profile) },
    { source: 'workspace', values: workspaceOverrides },
    { source: 'user', values: profile.overrides }
  ]

  const settings: ExperienceSettings = { ...DEFAULT_SETTINGS }
  const sources = new Map<SettingKey, SettingSource>()
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) sources.set(key, 'default')
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.values) as [SettingKey, unknown][]) {
      if (value === undefined) continue
      ;(settings as unknown as Record<string, unknown>)[key] = value
      sources.set(key, layer.source)
    }
  }

  // Panels are the one setting a goal adds to rather than replaces: somebody who asked for news and a portfolio should
  // get both panels beside whatever their level brings, not one instead of the other.
  if (!profile.overrides.panels && !workspaceOverrides.panels) {
    const derived = panelsForGoals(profile, settings.panels)
    if (derived.length > 0 && derived.join() !== settings.panels.join()) {
      settings.panels = derived
      sources.set('panels', 'answers')
    }
  }

  return {
    level: profile.level,
    settings,
    get: (key) => settings[key],
    source: (key) => sources.get(key) ?? 'default',
    isOverridden: (key) => Object.prototype.hasOwnProperty.call(profile.overrides, key)
  }
}

// ---------------------------------------------------------------- reading one from a file

const KNOWN_INDICATORS = INDICATORS.map((one) => one.kind)
const CHART_TYPES = new Set(['candles', 'line', 'area', 'ohlc'])

const pickOne = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

const pickMany = <T extends string>(value: unknown, allowed: readonly T[], max = 40): T[] => {
  if (!Array.isArray(value)) return []
  const out: T[] = []
  for (const one of value) {
    if (typeof one !== 'string' || !(allowed as readonly string[]).includes(one)) continue
    if (out.includes(one as T)) continue
    out.push(one as T)
    if (out.length >= max) break
  }
  return out
}

const boolOr = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

/** Free text that is only ever compared to itself: a term somebody has read, a hint already shown. */
function pickText(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const one of value) {
    if (typeof one !== 'string') continue
    const clean = one.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40)
    if (!clean || out.includes(clean)) continue
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

/**
 * One set of overrides read from a file, or nothing.
 *
 * Strict, and deliberately so. This is the part of the profile an export can carry and an import can bring back, so it
 * is the part somebody could edit by hand — an unknown key is dropped, an indicator that does not exist is dropped, and
 * a label is never treated as anything a screen will run.
 */
export function cleanSettings(raw: unknown): Partial<ExperienceSettings> {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const out: Partial<ExperienceSettings> = {}
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(o, key)

  if (has('density')) out.density = pickOne(o.density, DENSITIES, DEFAULT_SETTINGS.density)
  if (has('explanations')) out.explanations = pickOne(o.explanations, EXPLANATION_LEVELS, DEFAULT_SETTINGS.explanations)
  if (has('terminology')) out.terminology = pickOne(o.terminology, TERMINOLOGIES, 'standard')
  if (has('numberStyle')) out.numberStyle = pickOne(o.numberStyle, ['words', 'compact'] as const, 'compact')
  if (has('orionStyle')) out.orionStyle = pickOne(o.orionStyle, ORION_STYLES, DEFAULT_SETTINGS.orionStyle)
  if (has('autoEducation')) out.autoEducation = boolOr(o.autoEducation, false)
  if (has('learnActions')) out.learnActions = boolOr(o.learnActions, true)
  if (has('glossaryTooltips')) out.glossaryTooltips = boolOr(o.glossaryTooltips, true)
  if (has('chartType') && typeof o.chartType === 'string' && CHART_TYPES.has(o.chartType)) out.chartType = o.chartType
  if (has('chartAdvancedToolbar')) out.chartAdvancedToolbar = boolOr(o.chartAdvancedToolbar, false)
  if (has('chartDrawing')) out.chartDrawing = boolOr(o.chartDrawing, false)
  if (has('defaultIndicators')) out.defaultIndicators = pickMany(o.defaultIndicators, KNOWN_INDICATORS, 8)
  if (has('quickIntervals')) {
    const intervals = pickMany(o.quickIntervals, INTERVALS, INTERVALS.length)
    // The market's order, not the file's, so the buttons read left to right from fast to slow however they were stored.
    if (intervals.length > 0) out.quickIntervals = INTERVALS.filter((one) => intervals.includes(one))
  }
  if (has('defaultInterval')) {
    out.defaultInterval = pickOne(o.defaultInterval, INTERVALS, DEFAULT_SETTINGS.defaultInterval)
  }
  if (has('showOrderBook')) out.showOrderBook = boolOr(o.showOrderBook, false)
  if (has('showTrades')) out.showTrades = boolOr(o.showTrades, false)
  if (has('showDerivatives')) out.showDerivatives = boolOr(o.showDerivatives, false)
  if (has('panels')) {
    const panels = pickMany(o.panels, PANELS, PANELS.length)
    if (panels.length > 0) out.panels = PANELS.filter((one) => panels.includes(one))
  }
  if (has('landing')) out.landing = pickOne(o.landing, LANDINGS, DEFAULT_SETTINGS.landing)
  if (has('columns')) {
    const columns = pickMany(o.columns, ALL_COLUMNS, ALL_COLUMNS.length)
    if (columns.length > 0) out.columns = columns
  }
  if (has('screenerAdvanced')) out.screenerAdvanced = boolOr(o.screenerAdvanced, false)
  if (has('alertsAdvanced')) out.alertsAdvanced = boolOr(o.alertsAdvanced, false)
  if (has('riskDetail')) {
    out.riskDetail = pickOne(o.riskDetail, ['simple', 'balanced', 'detailed', 'advanced'] as const, 'balanced')
  }
  if (has('newsDetail')) out.newsDetail = pickOne(o.newsDetail, NEWS_ORDER, 'balanced')
  if (has('tickerFields')) {
    const fields = pickMany(o.tickerFields, TICKER_FIELDS, TICKER_FIELDS.length)
    if (fields.length > 0) out.tickerFields = fields
  }
  if (has('suggestions')) {
    out.suggestions = pickOne(o.suggestions, ['learning', 'balanced', 'analysis'] as const, 'balanced')
  }
  if (has('paperGuidance')) out.paperGuidance = boolOr(o.paperGuidance, true)
  if (has('bookGuidance')) out.bookGuidance = boolOr(o.bookGuidance, true)
  return out
}

const GOALS_OR_BLANK: readonly (Goal | '')[] = [...GOALS, '']
const STYLES_OR_BLANK: readonly (InterfaceStyle | '')[] = [...INTERFACE_STYLES, '']
const DENSITY_OR_BLANK: readonly (Density | '')[] = [...DENSITIES, '']

/**
 * A profile read from a file, an import or an older Orbis.
 *
 * Never throws and never refuses the whole thing: an answer that no longer means anything is dropped and everything
 * around it survives. Migrating from a version that did not have a field is the same operation as reading a file
 * somebody edited badly — which is why there is one function rather than a reader and a migrator that can disagree.
 */
export function cleanExperience(raw: unknown, at = Date.now()): MarketsExperienceProfile {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EXPERIENCE, updatedAt: at }
  const o = raw as Record<string, unknown>
  const timeframes = pickMany(o.timeframes, INTERVALS, INTERVALS.length)
  return {
    version: EXPERIENCE_VERSION,
    level: pickOne(o.level, EXPERIENCE_LEVELS, DEFAULT_EXPERIENCE.level),
    goals: pickMany(o.goals, GOALS, GOALS.length),
    primaryGoal: pickOne(o.primaryGoal, GOALS_OR_BLANK, ''),
    cryptoKnowledge: pickOne(o.cryptoKnowledge, FAMILIARITY, DEFAULT_EXPERIENCE.cryptoKnowledge),
    tradingExperience: pickOne(o.tradingExperience, TRADING_EXPERIENCE, DEFAULT_EXPERIENCE.tradingExperience),
    spotExperience: pickOne(o.spotExperience, FAMILIARITY, DEFAULT_EXPERIENCE.spotExperience),
    derivativesExperience: pickOne(o.derivativesExperience, FAMILIARITY, DEFAULT_EXPERIENCE.derivativesExperience),
    technicalExperience: pickOne(o.technicalExperience, FAMILIARITY, DEFAULT_EXPERIENCE.technicalExperience),
    researchInterests: pickMany(o.researchInterests, RESEARCH_INTERESTS, RESEARCH_INTERESTS.length),
    assetInterests: pickMany(o.assetInterests, ASSET_INTERESTS, ASSET_INTERESTS.length),
    learningMode: boolOr(o.learningMode, false),
    interfaceStyle: pickOne(o.interfaceStyle, STYLES_OR_BLANK, ''),
    orionHelp: pickMany(o.orionHelp, ORION_HELP, ORION_HELP.length),
    chartPreference:
      typeof o.chartPreference === 'string' && CHART_TYPES.has(o.chartPreference) ? o.chartPreference : '',
    // Kept in the market's order however it was stored, so the quick buttons never come back shuffled.
    timeframes: INTERVALS.filter((one) => timeframes.includes(one)),
    indicators: pickMany(o.indicators, KNOWN_INDICATORS, 8),
    drawingTools: pickOne(o.drawingTools, ['never', 'sometimes', 'often', 'advanced'] as const, 'never'),
    dataInterests: pickMany(o.dataInterests, DATA_INTERESTS, DATA_INTERESTS.length),
    orderBookWish: pickOne(o.orderBookWish, ['no', 'sometimes', 'yes'] as const, 'sometimes'),
    tradesWish: pickOne(o.tradesWish, ['no', 'sometimes', 'yes'] as const, 'sometimes'),
    newsWish: pickOne(o.newsWish, NEWS_ORDER, 'balanced'),
    alertWish: pickOne(o.alertWish, ['none', 'price', 'priceVolume', 'technical', 'all'] as const, 'none'),
    riskPresentation: pickOne(o.riskPresentation, ['minimal', 'balanced', 'detailed', 'advanced'] as const, 'balanced'),
    densityWish: pickOne(o.densityWish, DENSITY_OR_BLANK, ''),
    overrides: cleanSettings(o.overrides),
    learned: pickText(o.learned, 120),
    seenHints: pickText(o.seenHints, 120),
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : at
  }
}

/**
 * A profile for somebody who already had Markets set up before any of this existed.
 *
 * Their settings are the truth and are not touched. What can be read off them safely is read — a ticker with four
 * fields is somebody who wanted detail, a watchlist with nine columns is somebody who wanted density — and nothing else
 * is assumed. Their existing configuration becomes `overrides`, so no preset can later overwrite a choice they already
 * made.
 */
export function inferExperience(
  existing: {
    columns?: string[]
    tickerFields?: TickerField[]
    interval?: string
    chartType?: string
    indicators?: { kind: string }[]
    hasAlerts?: boolean
    hasStrategies?: boolean
    hasPaper?: boolean
  },
  at = Date.now()
): MarketsExperienceProfile {
  const indicators = pickMany(
    (existing.indicators ?? []).map((one) => one.kind),
    KNOWN_INDICATORS,
    8
  )
  const columns = existing.columns ?? []
  // Backtesting or a simulated account is somebody who found the advanced half of Markets without being shown it.
  const advanced = Boolean(existing.hasStrategies || existing.hasPaper) || indicators.length >= 2
  const dense = columns.length >= 7 || (existing.tickerFields?.length ?? 0) >= 3

  const overrides: Partial<ExperienceSettings> = {}
  if (columns.length > 0) overrides.columns = columns
  if (existing.tickerFields && existing.tickerFields.length > 0) overrides.tickerFields = [...existing.tickerFields]
  if (existing.chartType && CHART_TYPES.has(existing.chartType)) overrides.chartType = existing.chartType
  if (existing.interval && (INTERVALS as string[]).includes(existing.interval)) {
    overrides.defaultInterval = existing.interval as Interval
  }
  if (indicators.length > 0) overrides.defaultIndicators = indicators

  return {
    ...DEFAULT_EXPERIENCE,
    // Never `beginner`. Somebody with strategies and alerts is not a beginner, and an application that decided they
    // were and started explaining what a chart is would be telling them it had not been paying attention.
    level: advanced ? 'advanced' : 'intermediate',
    indicators,
    technicalExperience: indicators.length >= 2 ? 'comfortable' : DEFAULT_EXPERIENCE.technicalExperience,
    alertWish: existing.hasAlerts ? 'price' : 'none',
    tradingExperience: existing.hasPaper ? 'paper' : DEFAULT_EXPERIENCE.tradingExperience,
    densityWish: dense ? 'dense' : '',
    overrides: cleanSettings(overrides),
    updatedAt: at
  }
}

// ---------------------------------------------------------------- saying what it is

export const LEVEL_LABELS: Record<ExperienceLevel, string> = {
  beginner: 'Beginner',
  learning: 'Learning',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  professional: 'Professional',
  expert: 'Expert',
  custom: 'Custom'
}

export const GOAL_LABELS: Record<Goal, string> = {
  learn: 'Learn crypto',
  track: 'Track prices',
  research: 'Research assets',
  news: 'Follow news',
  charts: 'Analyse charts',
  watchlists: 'Build watchlists',
  volatility: 'Monitor volatility',
  paper: 'Paper trade',
  backtest: 'Backtest strategies',
  technical: 'Study technical analysis',
  portfolio: 'Track a portfolio',
  alerts: 'Create alerts',
  compare: 'Compare assets',
  trends: 'Research market trends'
}

/**
 * The summary a settings screen and the diagnostics both show.
 *
 * No secrets in it by construction: there is nothing in this file to leak. It says what somebody chose about their own
 * interface, which is the only thing this system knows.
 */
export function describeExperience(resolved: ResolvedExperience): { label: string; value: string }[] {
  const s = resolved.settings
  return [
    { label: 'Experience', value: LEVEL_LABELS[resolved.level] },
    { label: 'Information density', value: s.density },
    { label: 'Explanations', value: s.explanations },
    { label: 'Terminology', value: s.terminology },
    { label: 'Orion', value: s.orionStyle },
    { label: 'Chart', value: `${s.chartType}, ${s.defaultInterval}` },
    { label: 'Indicators', value: s.defaultIndicators.length ? s.defaultIndicators.join(', ') : 'none' },
    { label: 'Panels', value: s.panels.join(', ') },
    { label: 'Opens at', value: s.landing }
  ]
}

/**
 * What Orion is told about how to answer.
 *
 * Deliberately thin: a style, a vocabulary, and whether to define its terms. Orion does not need to know somebody's
 * trading history to answer a question about market cap, so it is not told.
 */
export interface OrionExperienceContext {
  level: ExperienceLevel
  style: OrionStyle
  terminology: Terminology
  /** Whether to define market terms in passing. */
  defineTerms: boolean
  /** What the prompts beside the box should ask about. */
  suggestions: 'learning' | 'balanced' | 'analysis'
}

export function orionContext(resolved: ResolvedExperience): OrionExperienceContext {
  return {
    level: resolved.level,
    style: resolved.settings.orionStyle,
    terminology: resolved.settings.terminology,
    defineTerms: resolved.settings.explanations !== 'minimal',
    suggestions: resolved.settings.suggestions
  }
}

/**
 * What a spoken or typed request to change the experience means.
 *
 * "Make Markets beginner-friendly", "stop explaining basic terms". Returns a patch for the profile, or null when
 * nothing about it was a request to change anything — which is most sentences, and the reason this returns null rather
 * than guessing.
 */
export function readExperienceRequest(said: string): Partial<MarketsExperienceProfile> | null {
  const text = String(said ?? '').toLowerCase()
  if (!text) return null
  const all = (...words: string[]): boolean => words.every((word) => text.includes(word))

  // The order matters: "stop explaining" is a request about explanations, not about being a beginner, and a sentence
  // that says both is read as the more specific one.
  if (all('stop', 'explain') || all('no', 'explanations') || all('stop', 'teaching')) {
    return { learningMode: false, overrides: { explanations: 'minimal', autoEducation: false } }
  }
  if (all('expert')) return { level: 'expert', learningMode: false }
  if (all('professional') || all('market terminal')) return { level: 'professional', learningMode: false }
  if (all('beginner') || all('easier', 'understand') || all('simpler')) {
    return { level: 'beginner', learningMode: true }
  }
  if (all('advanced')) return { level: 'advanced' }
  if (all('intermediate')) return { level: 'intermediate' }
  if (all('explain', 'everything') || all('teach')) return { learningMode: true }
  if (all('denser') || all('more', 'information')) return { overrides: { density: 'dense' } }
  if (all('less', 'information') || all('cleaner')) return { overrides: { density: 'minimal' } }
  return null
}
