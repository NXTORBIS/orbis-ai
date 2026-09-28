import { INDICATORS } from './indicators.ts'
import { INTERVALS } from './provider.ts'
import { isSupported } from './currency.ts'
import {
  ASSET_INTERESTS,
  cleanExperience,
  DEFAULT_EXPERIENCE,
  DENSITIES,
  EXPERIENCE_LEVELS,
  FAMILIARITY,
  GOAL_LABELS,
  GOALS,
  INTERFACE_STYLES,
  LEVEL_LABELS,
  ORION_HELP,
  RESEARCH_INTERESTS,
  TRADING_EXPERIENCE,
  type ExperienceLevel,
  type MarketsExperienceProfile
} from './experience.ts'

/**
 * The first time somebody opens Markets.
 *
 * A schema, not a screen. Every question below says what it asks, what it stores, when it is worth asking, and — the
 * part that makes the difference between this and a questionnaire — the answer is read by the adaptation engine, so
 * changing it changes Markets. A question that influenced nothing would be a question that wasted somebody's time on
 * first launch, so there are none: the test beside this file walks every step and asserts that each one moves the
 * resolved configuration.
 *
 * Two shapes of promise are kept here.
 *
 * **Nothing is committed until it is valid.** Answers live in a draft. The draft is written as somebody goes, so closing
 * Orbis halfway through does not lose the eight screens they already did, but the real profile is replaced in one step
 * at the end, after validation. A half-applied profile is worse than no profile, because it looks like a configuration.
 *
 * **Nothing here asks about money.** Not income, not wealth, not how much somebody can afford to lose. It asks how they
 * want an interface to behave. The one question that mentions risk asks how prominent risk *figures* should be, which is
 * a question about a layout.
 */

export type SetupPath = '' | 'quick' | 'full'

export type StepId =
  | 'welcome'
  | 'path'
  | 'experience'
  | 'goals'
  | 'primaryGoal'
  | 'crypto'
  | 'trading'
  | 'spot'
  | 'technical'
  | 'derivatives'
  | 'research'
  | 'interests'
  | 'assets'
  | 'chart'
  | 'timeframes'
  | 'indicators'
  | 'drawing'
  | 'data'
  | 'book'
  | 'trades'
  | 'risk'
  | 'style'
  | 'density'
  | 'news'
  | 'alerts'
  | 'ticker'
  | 'tickerAssets'
  | 'currency'
  | 'orion'
  | 'review'

/** The state machine, as the interface moves through it. */
export type OnboardingState = 'notStarted' | 'running' | 'applying' | 'completed' | 'saveError'

export interface AssetChoice {
  instrumentId: string
  symbol: string
  name: string
}

/**
 * What somebody has answered so far.
 *
 * Written to disk as they go. It is not the profile and never becomes one by accident: `applyDraft` is the only way
 * across, and it validates on the way.
 */
export interface OnboardingDraft {
  version: number
  step: StepId
  path: SetupPath
  /** The answers, as a partial experience profile. */
  profile: Partial<MarketsExperienceProfile>
  /** Whether the strip along the bottom of the browser is wanted. `later` leaves whatever it is set to now. */
  ticker: '' | 'yes' | 'no' | 'later'
  /** Which markets go in the ticker, resolved against the real registry before they get here. */
  tickerAssets: AssetChoice[]
  currencyMode: '' | 'automatic' | 'manual'
  currency: string
  /** Markets for a first watchlist. Real instruments; nothing invented. */
  watchlistAssets: AssetChoice[]
  watchlistName: string
  startedAt: number
  updatedAt: number
}

export const ONBOARDING_VERSION = 1

export const EMPTY_DRAFT: OnboardingDraft = {
  version: ONBOARDING_VERSION,
  step: 'welcome',
  path: '',
  profile: {},
  ticker: '',
  tickerAssets: [],
  currencyMode: '',
  currency: '',
  watchlistAssets: [],
  watchlistName: '',
  startedAt: 0,
  updatedAt: 0
}

export interface OnboardingRecord {
  completed: boolean
  /** Which version of the questions was answered, so a later Orbis can add one without asking everything again. */
  version: number
  /** True when somebody chose to skip rather than answer. Their settings are the balanced defaults, deliberately. */
  skipped: boolean
  completedAt: number
  /** Where they were, if they stopped partway. Cleared once the profile is committed. */
  draft: OnboardingDraft | null
}

export const EMPTY_ONBOARDING: OnboardingRecord = {
  completed: false,
  version: 0,
  skipped: false,
  completedAt: 0,
  draft: null
}

// ---------------------------------------------------------------- the questions

export interface StepOption {
  value: string
  label: string
  /** One line under the label. What the answer means, not a sales line for it. */
  detail?: string
}

export type StepKind =
  | 'welcome'
  | 'single'
  | 'multi'
  | 'assets'
  | 'tickerAssets'
  | 'ticker'
  | 'currency'
  | 'path'
  | 'review'

export interface OnboardingStep {
  id: StepId
  /** The section heading, for the progress rail. */
  section: string
  title: string
  question: string
  description?: string
  kind: StepKind
  /** Which field of the profile it stores, for the plain single/multi steps. */
  field?: keyof MarketsExperienceProfile
  options?: StepOption[]
  /** How many a multi step needs, and at most how many it takes. */
  min?: number
  max?: number
  /** Whether this step is worth asking, given what has been answered already. */
  visibleWhen?(draft: OnboardingDraft): boolean
  /** Whether it has an answer. A step with no answer cannot be left, unless it is optional. */
  optional?: boolean
  /** What this answer changes, shown in the review and asserted by the audit test. */
  affects: string
  /**
   * True when what this answer changes is not one of the resolved settings.
   *
   * There is exactly one: the interests question steers what the asset chooser searches for. It still has to change
   * something, and the audit checks that separately against `suggestedSearches` — the marker says which test to apply,
   * not that the question is exempt from having an effect.
   */
  outsideSettings?: boolean
}

const level = (draft: OnboardingDraft): ExperienceLevel => draft.profile.level ?? DEFAULT_EXPERIENCE.level

const goals = (draft: OnboardingDraft): string[] => draft.profile.goals ?? []

const isAdvanced = (draft: OnboardingDraft): boolean =>
  level(draft) === 'advanced' || level(draft) === 'professional' || level(draft) === 'expert'

const wantsCharts = (draft: OnboardingDraft): boolean =>
  goals(draft).includes('charts') || goals(draft).includes('technical') || isAdvanced(draft)

const tradesAtAll = (draft: OnboardingDraft): boolean =>
  (draft.profile.tradingExperience ?? 'never') !== 'never' ||
  goals(draft).includes('paper') ||
  goals(draft).includes('backtest')

/** Only the indicators that exist, in the order the catalogue lists them. */
const INDICATOR_OPTIONS: StepOption[] = INDICATORS.map((one) => ({
  value: one.kind,
  label: one.name,
  detail: one.needsVolume ? 'Needs volume data' : one.group
}))

const INTERVAL_OPTIONS: StepOption[] = INTERVALS.map((one) => ({ value: one, label: one }))

/**
 * Every question, in order.
 *
 * The order is the reading order of the rail on the left. Which of them are actually asked depends on the answers —
 * somebody who has never traded is not asked which order types they use, because there is no useful thing to do with the
 * answer and asking it anyway is how an onboarding comes to feel like a form.
 */
export const STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    section: 'Welcome',
    title: 'Welcome to Orbis Markets',
    question: 'Let us set up your market experience.',
    description:
      'Orbis will match the interface, the charts, how much is explained and how Orion answers to the way you use crypto markets. Everything here can be changed later.',
    kind: 'welcome',
    affects: 'Nothing. It says what the next few screens are for.'
  },
  {
    id: 'path',
    section: 'Welcome',
    title: 'Setup',
    question: 'How much would you like to set up now?',
    kind: 'path',
    affects: 'How many of the questions below are asked.',
    options: [
      { value: 'quick', label: 'Quick', detail: 'Pick a level and start. Everything else uses sensible defaults.' },
      { value: 'full', label: 'Customise everything', detail: 'Charts, indicators, panels, news, alerts and Orion.' }
    ]
  },
  {
    id: 'experience',
    section: 'Experience',
    title: 'Experience',
    question: 'How familiar are you with crypto markets?',
    description: 'This sets the starting point for how much is on screen and how much is explained. It is not a claim about anything else.',
    kind: 'single',
    field: 'level',
    affects: 'Density, explanations, terminology, chart defaults, panels and Orion’s style.',
    options: [
      { value: 'beginner', label: 'Beginner', detail: 'I am new to crypto and want things explained clearly.' },
      { value: 'learning', label: 'Learning', detail: 'I know the basics and want to learn more.' },
      {
        value: 'intermediate',
        label: 'Intermediate',
        detail: 'I follow crypto markets and understand the common terms.'
      },
      { value: 'advanced', label: 'Advanced', detail: 'I analyse markets and use technical data.' },
      { value: 'professional', label: 'Professional', detail: 'I use advanced market data and trading tools.' },
      { value: 'expert', label: 'Expert', detail: 'Give me the full market terminal.' }
    ]
  },
  {
    id: 'goals',
    section: 'Goals',
    title: 'Goals',
    question: 'What do you mainly want to use Markets for?',
    kind: 'multi',
    field: 'goals',
    min: 1,
    affects: 'Which panels are on the dashboard and which sections are in front.',
    options: GOALS.map((goal) => ({ value: goal, label: GOAL_LABELS[goal] }))
  },
  {
    id: 'primaryGoal',
    section: 'Goals',
    title: 'Primary goal',
    question: 'Which of those matters most?',
    description: 'Markets will open here.',
    kind: 'single',
    field: 'primaryGoal',
    visibleWhen: (draft) => goals(draft).length > 1,
    affects: 'Where Markets opens.',
    options: GOALS.map((goal) => ({ value: goal, label: GOAL_LABELS[goal] }))
  },
  {
    id: 'crypto',
    section: 'Crypto',
    title: 'Crypto knowledge',
    question: 'How familiar are you with cryptocurrency itself?',
    description: 'Separate from trading. Somebody can know a great deal about crypto and have never placed an order.',
    kind: 'single',
    field: 'cryptoKnowledge',
    affects: 'Whether terms are given in plain words, and whether definitions appear on hover.',
    options: [
      { value: 'none', label: 'New to crypto' },
      { value: 'learning', label: 'Learning the basics' },
      { value: 'basic', label: 'Basic understanding' },
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'advanced', label: 'Advanced' },
      { value: 'professional', label: 'Professional' }
    ]
  },
  {
    id: 'trading',
    section: 'Trading',
    title: 'Trading',
    question: 'Have you traded crypto before?',
    description: 'Used only to decide what to explain. Orbis has no exchange connection and cannot place a real order.',
    kind: 'single',
    field: 'tradingExperience',
    affects: 'Whether paper trading is introduced with an explanation of what simulated means.',
    options: [
      { value: 'never', label: 'Never' },
      { value: 'paper', label: 'Only simulated' },
      { value: 'occasional', label: 'Occasionally' },
      { value: 'regular', label: 'Regularly' },
      { value: 'active', label: 'Actively' },
      { value: 'professional', label: 'Professionally' }
    ]
  },
  {
    id: 'spot',
    section: 'Trading',
    title: 'Spot markets',
    question: 'How familiar are you with spot markets?',
    kind: 'single',
    field: 'spotExperience',
    visibleWhen: (draft) => draft.path === 'full',
    optional: true,
    affects: 'How much the order book and the trade tape explain themselves.',
    options: [
      { value: 'none', label: 'Not familiar' },
      { value: 'basic', label: 'Basic' },
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'advanced', label: 'Advanced' }
    ]
  },
  {
    id: 'technical',
    section: 'Charts',
    title: 'Technical analysis',
    question: 'How familiar are you with technical analysis?',
    kind: 'single',
    field: 'technicalExperience',
    affects: 'Whether a chart opens with indicators and an advanced toolbar, or with price alone.',
    options: [
      { value: 'none', label: 'New to it' },
      { value: 'basic', label: 'Basic' },
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'advanced', label: 'Advanced' },
      { value: 'professional', label: 'Professional' }
    ]
  },
  {
    id: 'derivatives',
    section: 'Trading',
    title: 'Futures',
    question: 'How familiar are you with crypto futures and perpetuals?',
    description:
      'No configured provider reports funding, open interest or liquidations yet, so there is no derivatives panel to place. Your answer decides the vocabulary these terms are explained in, and where the panel will go when a provider supplies them.',
    kind: 'single',
    field: 'derivativesExperience',
    visibleWhen: (draft) => draft.path === 'full',
    optional: true,
    affects: 'Terminology for funding, open interest and liquidations, and the default place for a derivatives panel.',
    options: [
      { value: 'none', label: 'Not familiar' },
      { value: 'learning', label: 'Learning' },
      { value: 'basic', label: 'Basic' },
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'advanced', label: 'Advanced' },
      { value: 'professional', label: 'Professional' }
    ]
  },
  {
    id: 'research',
    section: 'Research',
    title: 'Research',
    question: 'What kind of research interests you?',
    description: 'Only the angles Orbis has real data for are listed.',
    kind: 'multi',
    field: 'researchInterests',
    visibleWhen: (draft) => draft.path === 'full' && (goals(draft).includes('research') || goals(draft).includes('trends')),
    optional: true,
    affects: 'How detailed news is, and whether the screener opens with its advanced filters.',
    options: [
      { value: 'price', label: 'Price action' },
      { value: 'technical', label: 'Technical analysis' },
      { value: 'structure', label: 'Market structure' },
      { value: 'derivatives', label: 'Derivatives' },
      { value: 'news', label: 'News' },
      { value: 'sentiment', label: 'Market sentiment' }
    ]
  },
  {
    id: 'interests',
    section: 'Assets',
    title: 'Interests',
    question: 'What would you like to follow?',
    description: 'A discovery preference. Not a recommendation, and Orbis will never read it as one.',
    kind: 'multi',
    field: 'assetInterests',
    optional: true,
    outsideSettings: true,
    affects: 'What the asset chooser searches the real market registry for.',
    options: [
      { value: 'bitcoin', label: 'Bitcoin' },
      { value: 'ethereum', label: 'Ethereum' },
      { value: 'largeCap', label: 'Large-cap crypto' },
      { value: 'altcoins', label: 'Altcoins' },
      { value: 'stablecoins', label: 'Stablecoins' },
      { value: 'layer1', label: 'Layer 1' },
      { value: 'layer2', label: 'Layer 2' },
      { value: 'ai', label: 'AI-related tokens' },
      { value: 'gaming', label: 'Gaming' },
      { value: 'meme', label: 'Memecoins' },
      { value: 'movers', label: 'Top movers' }
    ]
  },
  {
    id: 'assets',
    section: 'Assets',
    title: 'Your markets',
    question: 'Which markets would you like to start with?',
    description: 'These become your first watchlist. Searched against the real market registry, so nothing here is invented.',
    kind: 'assets',
    optional: true,
    affects: 'Creates a real watchlist with these markets in it.'
  },
  {
    id: 'chart',
    section: 'Charts',
    title: 'Charts',
    question: 'How do you usually look at price?',
    kind: 'single',
    field: 'chartPreference',
    visibleWhen: wantsCharts,
    optional: true,
    affects: 'The chart type a market opens with.',
    options: [
      { value: 'line', label: 'Simple line' },
      { value: 'candles', label: 'Candlesticks' },
      { value: 'ohlc', label: 'OHLC bars' },
      { value: 'area', label: 'Area' }
    ]
  },
  {
    id: 'timeframes',
    section: 'Charts',
    title: 'Timeframes',
    question: 'Which timeframes do you use most?',
    description: 'These become the quick buttons. Every other timeframe stays available.',
    kind: 'multi',
    field: 'timeframes',
    visibleWhen: (draft) => draft.path === 'full' && wantsCharts(draft),
    optional: true,
    affects: 'The quick timeframe buttons, and which one a chart opens on.',
    options: INTERVAL_OPTIONS
  },
  {
    id: 'indicators',
    section: 'Charts',
    title: 'Indicators',
    question: 'Which indicators do you use?',
    description: 'Only the ones Orbis actually calculates are listed.',
    kind: 'multi',
    field: 'indicators',
    max: 8,
    visibleWhen: (draft) =>
      draft.path === 'full' && wantsCharts(draft) && (draft.profile.technicalExperience ?? 'basic') !== 'none',
    optional: true,
    affects: 'Which indicators are already on a chart when it opens.',
    options: INDICATOR_OPTIONS
  },
  {
    id: 'drawing',
    section: 'Charts',
    title: 'Drawing',
    question: 'Do you use chart drawing tools?',
    kind: 'single',
    field: 'drawingTools',
    visibleWhen: (draft) => draft.path === 'full' && wantsCharts(draft),
    optional: true,
    affects: 'Whether the drawing tools are in the toolbar from the start.',
    options: [
      { value: 'never', label: 'Never' },
      { value: 'sometimes', label: 'Sometimes' },
      { value: 'often', label: 'Often' },
      { value: 'advanced', label: 'Constantly' }
    ]
  },
  {
    id: 'data',
    section: 'Information',
    title: 'Live data',
    question: 'Which live data matters most to you?',
    kind: 'multi',
    field: 'dataInterests',
    visibleWhen: (draft) => draft.path === 'full',
    optional: true,
    affects: 'Which panels are on the dashboard.',
    options: [
      { value: 'price', label: 'Price' },
      { value: 'volume', label: 'Volume' },
      { value: 'book', label: 'Order book' },
      { value: 'trades', label: 'Recent trades' },
      { value: 'marketCap', label: 'Market cap' },
      { value: 'volatility', label: 'Volatility' },
      { value: 'derivatives', label: 'Funding and open interest', detail: 'No provider reports these yet' }
    ]
  },
  {
    id: 'book',
    section: 'Information',
    title: 'Order book',
    question: 'Show the order book by default?',
    kind: 'single',
    field: 'orderBookWish',
    visibleWhen: (draft) => draft.path === 'full',
    optional: true,
    affects: 'Whether a market opens with its order book showing.',
    options: [
      { value: 'no', label: 'No' },
      { value: 'sometimes', label: 'Leave it to my level' },
      { value: 'yes', label: 'Yes' }
    ]
  },
  {
    id: 'trades',
    section: 'Information',
    title: 'Live trades',
    question: 'Show live trade flow by default?',
    kind: 'single',
    field: 'tradesWish',
    visibleWhen: (draft) => draft.path === 'full',
    optional: true,
    affects: 'Whether a market opens with the trade tape streaming.',
    options: [
      { value: 'no', label: 'No' },
      { value: 'sometimes', label: 'Leave it to my level' },
      { value: 'yes', label: 'Yes' }
    ]
  },
  {
    id: 'risk',
    section: 'Information',
    title: 'Risk figures',
    question: 'How prominently should risk figures be shown?',
    description:
      'A question about the layout. Orbis does not judge what risk suits you and does not give financial advice.',
    kind: 'single',
    field: 'riskPresentation',
    visibleWhen: (draft) => draft.path === 'full' && tradesAtAll(draft),
    optional: true,
    affects: 'How much of the drawdown, volatility and exposure detail is shown at once.',
    options: [
      { value: 'minimal', label: 'Minimal' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'detailed', label: 'Detailed' },
      { value: 'advanced', label: 'Everything available' }
    ]
  },
  {
    id: 'style',
    section: 'Interface',
    title: 'Interface',
    question: 'How should Markets feel?',
    kind: 'single',
    field: 'interfaceStyle',
    visibleWhen: (draft) => draft.path === 'full',
    optional: true,
    affects: 'Information density across every panel and table.',
    options: [
      { value: 'simple', label: 'Simple' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'professional', label: 'Professional' },
      { value: 'data', label: 'Data dense' },
      { value: 'terminal', label: 'Terminal' }
    ]
  },
  {
    id: 'density',
    section: 'Interface',
    title: 'Density',
    question: 'How much information do you want visible at once?',
    kind: 'single',
    field: 'densityWish',
    // Only worth asking of somebody who said they want a lot. A beginner starts balanced and can change it whenever.
    visibleWhen: (draft) => draft.path === 'full' && isAdvanced(draft),
    optional: true,
    affects: 'Row heights, how many metrics a card shows, and how many panels fit.',
    options: DENSITIES.map((one) => ({ value: one, label: one[0].toUpperCase() + one.slice(1) }))
  },
  {
    id: 'news',
    section: 'Information',
    title: 'News',
    question: 'How much market news do you want?',
    description: 'From the feeds Orbis already reads. Nothing is generated.',
    kind: 'single',
    field: 'newsWish',
    affects: 'How much news is shown, and whether the news panel is there at all.',
    options: [
      { value: 'none', label: 'None' },
      { value: 'headlines', label: 'Headlines' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'detailed', label: 'Detailed' },
      { value: 'professional', label: 'Everything, with sources and tags' }
    ]
  },
  {
    id: 'alerts',
    section: 'Alerts',
    title: 'Alerts',
    question: 'Which alerts would you like to be able to set?',
    description: 'Nothing is created now. This decides which conditions the builder offers first.',
    kind: 'single',
    field: 'alertWish',
    affects: 'Whether the alerts panel appears, and whether its advanced conditions are offered first.',
    options: [
      { value: 'none', label: 'No alerts' },
      { value: 'price', label: 'Price alerts' },
      { value: 'priceVolume', label: 'Price and volume' },
      { value: 'technical', label: 'Technical conditions' },
      { value: 'all', label: 'Everything supported' }
    ]
  },
  {
    id: 'ticker',
    section: 'Ticker',
    title: 'Live ticker',
    question: 'Would you like the live market ticker along the bottom of Orbis?',
    description: 'Real prices from the exchange, in your currency. It can be switched off at any time.',
    kind: 'ticker',
    affects: 'Turns the strip at the bottom of the browser on or off.',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'later', label: 'I will decide later' }
    ]
  },
  {
    id: 'tickerAssets',
    section: 'Ticker',
    title: 'Ticker markets',
    question: 'Which markets should the ticker show?',
    kind: 'tickerAssets',
    visibleWhen: (draft) => draft.ticker === 'yes',
    optional: true,
    affects: 'What the strip at the bottom actually shows.'
  },
  {
    id: 'currency',
    section: 'Currency',
    title: 'Currency',
    question: 'Which currency should prices be shown in?',
    description:
      'Automatic uses your system region. Orbis never asks for your location and never stores one — only the currency code.',
    kind: 'currency',
    affects: 'Every price on every Markets surface, converted at the real published rate.'
  },
  {
    id: 'orion',
    section: 'Orion',
    title: 'Orion',
    question: 'How would you like Orion to help with markets?',
    kind: 'multi',
    field: 'orionHelp',
    optional: true,
    affects: 'How Orion answers about markets, and which prompts it offers.',
    options: [
      { value: 'explain', label: 'Explain things' },
      { value: 'concise', label: 'Answer concisely' },
      { value: 'analyse', label: 'Analyse markets' },
      { value: 'learn', label: 'Help me learn' },
      { value: 'research', label: 'Help me research' },
      { value: 'charts', label: 'Help me read charts' },
      { value: 'screen', label: 'Help me build screens' },
      { value: 'monitor', label: 'Help me monitor markets' }
    ]
  },
  {
    id: 'review',
    section: 'Review',
    title: 'Review',
    question: 'Your Markets setup',
    kind: 'review',
    affects: 'Nothing. It shows what is about to be applied.'
  }
]

const BY_ID = new Map(STEPS.map((one) => [one.id, one]))

export const stepFor = (id: StepId): OnboardingStep | undefined => BY_ID.get(id)

/**
 * Which steps are worth asking, given the answers so far.
 *
 * Recomputed as answers change, which is why going back and choosing something different can shorten the rest: somebody
 * who switches from Professional to Beginner should not still be walked through density and drawing tools.
 */
export function visibleSteps(draft: OnboardingDraft): OnboardingStep[] {
  return STEPS.filter((step) => !step.visibleWhen || step.visibleWhen(draft))
}

/** Whether a step has an answer. The one thing that decides if Next is available. */
export function isAnswered(step: OnboardingStep, draft: OnboardingDraft): boolean {
  switch (step.kind) {
    case 'welcome':
    case 'review':
      return true
    case 'path':
      return draft.path !== ''
    case 'ticker':
      return draft.ticker !== ''
    case 'currency':
      return draft.currencyMode === 'automatic' || (draft.currencyMode === 'manual' && isSupported(draft.currency))
    case 'assets':
      return draft.watchlistAssets.length > 0
    case 'tickerAssets':
      return draft.tickerAssets.length > 0
    case 'multi': {
      const value = step.field ? draft.profile[step.field] : undefined
      return Array.isArray(value) && value.length >= (step.min ?? 1)
    }
    case 'single': {
      const value = step.field ? draft.profile[step.field] : undefined
      return typeof value === 'string' && value !== ''
    }
    default:
      return true
  }
}

/** Whether Next should be available: answered, or a question that did not need one. */
export const canLeave = (step: OnboardingStep, draft: OnboardingDraft): boolean =>
  step.optional === true || isAnswered(step, draft)

const stepIndex = (draft: OnboardingDraft): number => {
  const list = visibleSteps(draft)
  const at = list.findIndex((one) => one.id === draft.step)
  return at < 0 ? 0 : at
}

export function nextStep(draft: OnboardingDraft): StepId {
  const list = visibleSteps(draft)
  return list[Math.min(list.length - 1, stepIndex(draft) + 1)]?.id ?? 'review'
}

export function previousStep(draft: OnboardingDraft): StepId {
  const list = visibleSteps(draft)
  return list[Math.max(0, stepIndex(draft) - 1)]?.id ?? 'welcome'
}

/** How far along, for the rail. Out of the steps that are actually being asked. */
export function progressOf(draft: OnboardingDraft): { at: number; of: number } {
  const list = visibleSteps(draft)
  return { at: stepIndex(draft) + 1, of: list.length }
}

// ---------------------------------------------------------------- reading a draft back

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function cleanAsset(raw: unknown): AssetChoice | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const instrumentId = text(o.instrumentId, 200)
  const symbol = text(o.symbol, 40)
  // Without both there is nothing to add to a list and nothing to draw. Refused rather than repaired: an invented
  // symbol would be exactly the fabricated asset this system must never produce.
  if (!instrumentId || !symbol) return null
  return { instrumentId, symbol, name: text(o.name, 120) }
}

const cleanAssets = (raw: unknown, max: number): AssetChoice[] => {
  if (!Array.isArray(raw)) return []
  const out: AssetChoice[] = []
  const seen = new Set<string>()
  for (const one of raw) {
    const asset = cleanAsset(one)
    if (!asset || seen.has(asset.instrumentId)) continue
    seen.add(asset.instrumentId)
    out.push(asset)
    if (out.length >= max) break
  }
  return out
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

/**
 * A draft read back from disk.
 *
 * The answers go through the profile's own cleaner, so a draft cannot carry in a level, an indicator or a timeframe that
 * the profile itself would refuse. Only the fields that were actually answered survive — a draft is a partial profile
 * and must stay one, or resuming would silently fill in defaults as though somebody had chosen them.
 */
export function cleanDraft(raw: unknown, at = Date.now()): OnboardingDraft {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_DRAFT, startedAt: at, updatedAt: at }
  const o = raw as Record<string, unknown>
  const answered = (o.profile && typeof o.profile === 'object' ? o.profile : {}) as Record<string, unknown>
  const whole = cleanExperience({ ...DEFAULT_EXPERIENCE, ...answered }, at)
  const profile: Partial<MarketsExperienceProfile> = {}
  for (const key of Object.keys(answered) as (keyof MarketsExperienceProfile)[]) {
    if (!(key in DEFAULT_EXPERIENCE)) continue
    ;(profile as Record<string, unknown>)[key] = whole[key]
  }
  return {
    version: ONBOARDING_VERSION,
    step: pick(o.step, STEPS.map((one) => one.id), 'welcome'),
    path: pick(o.path, ['', 'quick', 'full'] as const, ''),
    profile,
    ticker: pick(o.ticker, ['', 'yes', 'no', 'later'] as const, ''),
    tickerAssets: cleanAssets(o.tickerAssets, 30),
    currencyMode: pick(o.currencyMode, ['', 'automatic', 'manual'] as const, ''),
    currency: isSupported(text(o.currency, 8).toUpperCase()) ? text(o.currency, 8).toUpperCase() : '',
    watchlistAssets: cleanAssets(o.watchlistAssets, 50),
    watchlistName: text(o.watchlistName, 60),
    startedAt: finite(o.startedAt) || at,
    updatedAt: at
  }
}

export function cleanOnboarding(raw: unknown, at = Date.now()): OnboardingRecord {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ONBOARDING }
  const o = raw as Record<string, unknown>
  const completed = o.completed === true
  return {
    completed,
    version: Math.max(0, Math.round(finite(o.version))),
    skipped: o.skipped === true,
    completedAt: finite(o.completedAt),
    // A finished onboarding has no draft. Keeping one would be keeping a half-answered copy of a settled configuration.
    draft: !completed && o.draft ? cleanDraft(o.draft, at) : null
  }
}

// ---------------------------------------------------------------- committing it

export interface DraftProblem {
  step: StepId
  message: string
}

/**
 * What is wrong with a draft, if anything.
 *
 * Checked before anything is written. The list is deliberately short: almost everything invalid was already dropped on
 * the way in by `cleanDraft`, and what is left is the questions that genuinely must be answered.
 */
export function problemsWith(draft: OnboardingDraft): DraftProblem[] {
  const problems: DraftProblem[] = []
  for (const step of visibleSteps(draft)) {
    if (!canLeave(step, draft)) problems.push({ step: step.id, message: `${step.title} has not been answered.` })
  }
  if (draft.currencyMode === 'manual' && !isSupported(draft.currency)) {
    problems.push({ step: 'currency', message: 'That currency is not one Orbis can convert to.' })
  }
  return problems
}

/** What applying a draft asks the rest of Markets to do. */
export interface AppliedSetup {
  profile: MarketsExperienceProfile
  /** null leaves the ticker exactly as it is, which is what "decide later" means. */
  ticker: { enabled: boolean; instrumentIds: string[] } | null
  /** null leaves the currency on automatic, which is already the default. */
  currency: { mode: 'automatic' | 'manual'; code: string } | null
  /** null creates no watchlist. An empty one would be a list somebody has to delete. */
  watchlist: { name: string; assets: AssetChoice[] } | null
}

/**
 * Turns a draft into the things that actually change.
 *
 * The one crossing from "what somebody answered" to "what Markets is". Everything not answered stays at its default
 * rather than being guessed at, and every id here was resolved against the real registry before it reached the draft —
 * this function invents nothing, which is why it takes assets as they were found rather than as they were typed.
 *
 * `level` becomes `custom` when somebody took the long path and disagreed with their own preset, because that is what
 * happened: they are no longer on a preset, and saying they are would mean a later preset change quietly undoing their
 * answers.
 */
export function applyDraft(draft: OnboardingDraft, at = Date.now()): AppliedSetup {
  const profile = cleanExperience({ ...DEFAULT_EXPERIENCE, ...draft.profile, updatedAt: at }, at)

  const watchlist =
    draft.watchlistAssets.length > 0
      ? { name: draft.watchlistName || 'My markets', assets: draft.watchlistAssets }
      : null

  const ticker =
    draft.ticker === 'yes'
      ? {
          enabled: true,
          // Their ticker markets, or the watchlist they just chose, so choosing "yes" and nothing else still gives a
          // ticker with something in it rather than an empty strip.
          instrumentIds: (draft.tickerAssets.length > 0 ? draft.tickerAssets : draft.watchlistAssets).map(
            (one) => one.instrumentId
          )
        }
      : draft.ticker === 'no'
        ? { enabled: false, instrumentIds: [] }
        : null

  const currency =
    draft.currencyMode === 'manual' && isSupported(draft.currency)
      ? { mode: 'manual' as const, code: draft.currency }
      : draft.currencyMode === 'automatic'
        ? { mode: 'automatic' as const, code: '' }
        : null

  return { profile, ticker, currency, watchlist }
}

/**
 * What somebody gets for skipping.
 *
 * The balanced defaults, and nothing pretending to be an answer. Skipping is a legitimate choice and must leave a
 * complete, defined configuration — an application that left half its settings undefined because nobody answered a
 * questionnaire would be one that breaks differently for every person who skipped.
 */
export function skippedSetup(at = Date.now()): AppliedSetup {
  return {
    profile: { ...DEFAULT_EXPERIENCE, updatedAt: at },
    // The ticker is left alone, which means off: a strip nobody asked for is a permanent band across their browser.
    ticker: null,
    currency: null,
    watchlist: null
  }
}

// ---------------------------------------------------------------- the review

export interface ReviewLine {
  label: string
  value: string
}

/**
 * What the review screen shows, and the final screen after it.
 *
 * Read off the draft, so it cannot describe something other than what is about to be applied — a summary written
 * separately from the thing it summarises is a summary that eventually lies.
 */
export function reviewOf(draft: OnboardingDraft): ReviewLine[] {
  const p = draft.profile
  const lines: ReviewLine[] = []
  const say = (label: string, value: string): void => {
    if (value) lines.push({ label, value })
  }
  say('Experience', p.level ? LEVEL_LABELS[p.level] : '')
  say('Goals', (p.goals ?? []).map((one) => GOAL_LABELS[one]).join(', '))
  say('Primary goal', p.primaryGoal ? GOAL_LABELS[p.primaryGoal] : '')
  say('Crypto knowledge', p.cryptoKnowledge ?? '')
  say('Trading', p.tradingExperience ?? '')
  say('Technical analysis', p.technicalExperience ?? '')
  say('Charts', p.chartPreference ?? '')
  say('Timeframes', (p.timeframes ?? []).join(', '))
  say('Indicators', (p.indicators ?? []).join(', '))
  say('Interface', p.interfaceStyle ?? '')
  say('Density', p.densityWish ?? '')
  say('News', p.newsWish ?? '')
  say('Alerts', p.alertWish ?? '')
  say('Watchlist', draft.watchlistAssets.map((one) => one.symbol).join(', '))
  say('Ticker', draft.ticker === 'yes' ? 'On' : draft.ticker === 'no' ? 'Off' : draft.ticker === 'later' ? 'Later' : '')
  say('Currency', draft.currencyMode === 'manual' ? draft.currency : draft.currencyMode === 'automatic' ? 'Automatic' : '')
  say('Orion', (p.orionHelp ?? []).join(', '))
  return lines
}

/** Whether the questions somebody answered are still the current set. False means there is something new to ask. */
export const isCurrentVersion = (record: OnboardingRecord): boolean => record.version >= ONBOARDING_VERSION

/** Whether to show onboarding at all. Once, per profile, and never again after it is finished or skipped. */
export const needsOnboarding = (record: OnboardingRecord): boolean => !record.completed

/**
 * What the asset chooser searches for, given what somebody said they follow.
 *
 * Searches, not assets. Each of these goes to the real registry and comes back with whatever the provider has — so an
 * interest can never put a market on screen that does not exist, and an interest the provider knows nothing about simply
 * produces nothing. `movers` is not a search: it means "show me what is actually moving", which the discovery snapshot
 * already answers from real prices.
 */
export function suggestedSearches(interests: readonly string[]): { searches: string[]; movers: boolean } {
  const searches: string[] = []
  let movers = false
  const add = (...words: string[]): void => {
    for (const word of words) if (!searches.includes(word)) searches.push(word)
  }
  for (const interest of interests) {
    switch (interest) {
      case 'bitcoin':
        add('bitcoin')
        break
      case 'ethereum':
        add('ethereum')
        break
      case 'largeCap':
        add('bitcoin', 'ethereum', 'bnb')
        break
      case 'altcoins':
        add('cardano', 'polkadot', 'chainlink')
        break
      case 'stablecoins':
        add('usdt', 'usdc', 'dai')
        break
      case 'layer1':
        add('solana', 'avalanche', 'sui')
        break
      case 'layer2':
        add('arbitrum', 'optimism', 'polygon')
        break
      case 'ai':
        add('render', 'fetch', 'graph')
        break
      case 'gaming':
        add('immutable', 'sand', 'axie')
        break
      case 'meme':
        add('doge', 'shiba', 'pepe')
        break
      case 'movers':
        movers = true
        break
      default:
        break
    }
  }
  return { searches, movers }
}

/** Every option value a step will accept, for the audit test and for validating what arrives over IPC. */
export const allowedValues = (step: OnboardingStep): string[] => (step.options ?? []).map((one) => one.value)

/** The lists the steps were built from, exported so a test can check no step offers something that does not exist. */
export const REGISTRIES = {
  levels: EXPERIENCE_LEVELS,
  goals: GOALS,
  familiarity: FAMILIARITY,
  trading: TRADING_EXPERIENCE,
  research: RESEARCH_INTERESTS,
  interests: ASSET_INTERESTS,
  orion: ORION_HELP,
  styles: INTERFACE_STYLES,
  densities: DENSITIES,
  indicators: INDICATORS.map((one) => one.kind),
  intervals: INTERVALS
}
