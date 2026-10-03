/**
 * What each widget is handed to show, and what it may ask to have done.
 *
 * A widget on the start page never reads a store. It asks for one of the named sources below and is handed a small,
 * fixed shape: titles and times, never whole notes; the last few things, never the whole history. The main process
 * builds these from the stores it already has, for the profile that is in use, and the page draws them. That is the
 * whole of a widget's reach -- there is no source here for passwords, cookies, the Secrets Vault or another profile,
 * so there is nothing a widget could be handed by mistake.
 *
 * The same shapes have a sample each, for the gallery. A preview is the real widget drawn from the sample, so the
 * gallery shows what a widget looks like without reading anything of the person's to do it.
 *
 * Pure types and constants.
 */

export type WidgetSource = 'tasks' | 'reminders' | 'notes' | 'clipboard' | 'workspaces' | 'whiteboard' | 'bookmarks' | 'downloads' | 'recent' | 'tabs' | 'weather' | 'news' | 'markets'

export const WIDGET_SOURCES: readonly WidgetSource[] = Object.freeze(['tasks', 'reminders', 'notes', 'clipboard', 'workspaces', 'whiteboard', 'bookmarks', 'downloads', 'recent', 'tabs', 'weather', 'news', 'markets'])

export interface WidgetFeedMap {
  tasks: { items: { id: string; title: string; dueAt: number | null; hasTime: boolean; important: boolean; overdue: boolean }[]; total: number }
  reminders: { items: { id: string; title: string; at: number }[]; total: number }
  notes: { items: { id: string; title: string; excerpt: string; updatedAt: number }[]; total: number }
  clipboard: { items: { id: string; preview: string; kind: 'text' | 'link' | 'image' | 'other'; at: number }[]; total: number }
  workspaces: { items: { id: string; name: string; tabs: number; current: boolean }[] }
  whiteboard: { items: { id: string; name: string; elements: number; updatedAt: number }[] }
  bookmarks: { items: { title: string; url: string }[]; total: number }
  downloads: { items: { id: string; name: string; state: 'done' | 'downloading' | 'paused' | 'failed'; received: number; total: number; at: number }[] }
  recent: { items: { title: string; url: string; host: string; at: number }[] }
  tabs: { count: number; groups: number; items: { id: number; title: string; url: string; active: boolean }[] }
  weather: {
    place: string
    temperature: number
    unit: 'c' | 'f'
    /** In words: "Mostly sunny". */
    summary: string
    /** Which picture to draw: one of the names in WEATHER_SYMBOLS. */
    symbol: WeatherSymbol
    hours: { at: number; temperature: number; symbol: WeatherSymbol }[]
    /** Who the forecast is from, which the licence asks to be shown. */
    attribution: string
  }
  news: { items: { title: string; url: string; source: string; at: number | null }[]; failed: string[] }
  markets: {
    symbol: string
    name: string
    price: number
    /** Change over the day, in percent. */
    change: number
    currency: string
    /** The day's prices, oldest first, for the small line. Empty when there is none to draw. */
    points: number[]
    /** When the price was read. */
    asOf: number
  }
}

export type WeatherSymbol = 'clear' | 'partly' | 'cloudy' | 'rain' | 'showers' | 'snow' | 'sleet' | 'fog' | 'thunder' | 'night' | 'unknown'

export const WEATHER_SYMBOLS: readonly WeatherSymbol[] = Object.freeze(['clear', 'partly', 'cloudy', 'rain', 'showers', 'snow', 'sleet', 'fog', 'thunder', 'night', 'unknown'])

/**
 * What a source answered.
 *
 * `live` was read just now. `cached` is the last good answer, shown because a new one could not be had -- with when
 * it was read, so "33°C" from this morning is not passed off as now. `offline` and `unavailable` have no value and a
 * reason in words.
 */
export interface WidgetFeed<S extends WidgetSource = WidgetSource> {
  source: S
  status: 'live' | 'cached' | 'offline' | 'unavailable'
  value: WidgetFeedMap[S] | null
  /** When the value was read. 0 when there is none. */
  at: number
  /** Why there is no value, or why it is not fresh. */
  error?: string
  /** Something the person has to do first, when that is why there is nothing: "Choose a city". */
  needs?: string
}

/** What a widget asks a source for. Only what is here is read; anything else in a request is ignored. */
export interface WidgetFeedRequest {
  source: WidgetSource
  /** How many rows, at most. Each source has its own ceiling. */
  limit?: number
  /** tasks: which ones. */
  view?: 'today' | 'overdue' | 'flagged' | 'all'
  /** weather: the city, and the unit. */
  city?: string
  unit?: 'c' | 'f'
  /** news: the feed addresses. */
  feeds?: string[]
  /** markets: the symbol. */
  symbol?: string
  /** Asked for by pressing refresh: go and read again rather than answer from what was kept. */
  fresh?: boolean
}

export const FEED_LIMITS: Readonly<Record<WidgetSource, number>> = Object.freeze({ tasks: 20, reminders: 20, notes: 12, clipboard: 12, workspaces: 12, whiteboard: 10, bookmarks: 20, downloads: 12, recent: 20, tabs: 20, weather: 12, news: 20, markets: 1 })

/**
 * Something a widget asks to have done, when a person presses something on it.
 *
 * A short closed list. Each is one thing the rest of Orbis already does: a task ticked off is ticked off in Tasks.
 * A widget cannot ask for anything that is not here.
 */
export type WidgetCommand =
  | { do: 'task.complete'; id: string }
  | { do: 'note.create' }
  | { do: 'clip.copy'; id: string }
  | { do: 'workspace.open'; id: string }
  | { do: 'tab.activate'; id: number }
  | { do: 'download.show'; id: string }
  /** Opens one of Orbis's own screens in the browser's side panel: 'tasks', 'notes', 'workspaces', 'markets', 'ask'. */
  | { do: 'panel.open'; view: string }
  | { do: 'orion.ask'; text: string }

export const WIDGET_COMMANDS: readonly WidgetCommand['do'][] = Object.freeze(['task.complete', 'note.create', 'clip.copy', 'workspace.open', 'tab.activate', 'download.show', 'panel.open', 'orion.ask'])

// ---------------------------------------------------------------- what the page and the app say to each other

/** What the start page is handed when it asks how things stand. */
export interface WidgetBoardState {
  /** Counts up with every change, so a page can tell that what it holds is old. */
  revision: number
  profileId: string
  board: import('./widgetBoard.ts').WidgetBoard
  /** Whether the last change can be taken back, and whether one taken back can be made again. */
  canUndo: boolean
  canRedo: boolean
  /** Layouts the person saved by name. */
  layouts: { id: string; name: string; widgets: number }[]
}

/** What a watching page is sent as things change. */
export type WidgetEvent =
  | { type: 'state'; state: WidgetBoardState }
  /** One of the sources has new things to show; widgets reading it ask again. */
  | { type: 'feed'; source: WidgetSource }

/**
 * Everything that can be asked of the board, by the start page or by Orion.
 *
 * The board's own actions, and a few things that are about the board rather than on it: taking the last change back,
 * saved layouts, and bringing in the widgets the start page used to keep for itself.
 */
export type WidgetRequest =
  | import('./widgetBoard.ts').WidgetAction
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'layout.save'; name: string }
  | { type: 'layout.use'; id: string }
  | { type: 'layout.remove'; id: string }
  /** The start page's old board, as it was kept in the browser. Taken in once; afterwards this changes nothing. */
  | { type: 'adopt'; legacy: unknown }

export const WIDGET_REQUESTS: readonly WidgetRequest['type'][] = Object.freeze([
  'add', 'remove', 'move', 'resize', 'configure', 'look', 'lock', 'hide', 'reset', 'revive', 'favourite', 'used', 'preset', 'clear', 'enable',
  'undo', 'redo', 'layout.save', 'layout.use', 'layout.remove', 'adopt'
])

/** What a request is answered with: how things stand now and what happened in words, or why not. */
export type WidgetReply =
  | { ok: true; state: WidgetBoardState; said: string; id?: string; already?: boolean }
  | { ok: false; error: string; message: string }

/**
 * What an open start page says it has actually drawn.
 *
 * This is how Orion checks its own work: a widget that is in the list and not on the screen has not been added as far
 * as the person can see. `failed` are the ones whose drawing threw; `gallery` is whether the gallery is open.
 */
export interface WidgetRendered {
  revision: number
  shown: string[]
  failed: string[]
  columns: number
  gallery: boolean
  arranging: boolean
}

/** What doing a command came to. */
export type WidgetCommandResult = { ok: true; message?: string } | { ok: false; message: string }

/**
 * The channels between the browser's start page and Orbis, and what each carries.
 *
 *   widgets:get       []                    -> WidgetBoardState
 *   widgets:act       [WidgetRequest]       -> WidgetReply
 *   widgets:watch     []                    -> never answers; sends a WidgetEvent each time something changes
 *   widgets:data      [WidgetFeedRequest]   -> WidgetFeed
 *   widgets:do        [WidgetCommand]       -> WidgetCommandResult
 *   widgets:rendered  [WidgetRendered]      -> true
 */
export const WIDGET_CHANNELS = Object.freeze({ get: 'widgets:get', act: 'widgets:act', watch: 'widgets:watch', data: 'widgets:data', do: 'widgets:do', rendered: 'widgets:rendered' })

// ---------------------------------------------------------------- samples, for previews only

const DAY = 86_400_000
/** A fixed moment, so a preview looks the same every time: Monday 5 October 2026, 10:42 in the morning. */
export const SAMPLE_NOW = Date.UTC(2026, 9, 5, 10, 42, 0)

/**
 * One sample per source: what a widget is drawn from in the gallery.
 *
 * Plainly generic and the same for everybody. Nothing here was read from anywhere, and nothing here is shown on the
 * start page: an added widget shows the person's own, or says it has nothing yet.
 */
export const WIDGET_SAMPLES: { readonly [S in WidgetSource]: WidgetFeedMap[S] } = Object.freeze({
  tasks: {
    items: [
      { id: 's1', title: 'Send the report', dueAt: SAMPLE_NOW + 3 * 3_600_000, hasTime: true, important: true, overdue: false },
      { id: 's2', title: 'Book the dentist', dueAt: SAMPLE_NOW, hasTime: false, important: false, overdue: false },
      { id: 's3', title: 'Water the plants', dueAt: SAMPLE_NOW, hasTime: false, important: false, overdue: false },
      { id: 's4', title: 'Call the bank', dueAt: SAMPLE_NOW - DAY, hasTime: false, important: false, overdue: true }
    ],
    total: 4
  },
  reminders: {
    items: [
      { id: 's1', title: 'Team call', at: SAMPLE_NOW + 78 * 60_000 },
      { id: 's2', title: 'Pick up the parcel', at: SAMPLE_NOW + 6 * 3_600_000 },
      { id: 's3', title: 'Pay the rent', at: SAMPLE_NOW + 2 * DAY }
    ],
    total: 3
  },
  notes: {
    items: [
      { id: 's1', title: 'Ideas for the talk', excerpt: 'Start with the question, not the answer.', updatedAt: SAMPLE_NOW - 3_600_000 },
      { id: 's2', title: 'Reading list', excerpt: 'Three books for the summer.', updatedAt: SAMPLE_NOW - DAY },
      { id: 's3', title: 'Recipe to try', excerpt: 'Lemon, garlic, twenty minutes.', updatedAt: SAMPLE_NOW - 3 * DAY }
    ],
    total: 3
  },
  clipboard: {
    items: [
      { id: 's1', preview: 'Meet at the north entrance at six', kind: 'text', at: SAMPLE_NOW - 120_000 },
      { id: 's2', preview: 'https://example.org/timetable', kind: 'link', at: SAMPLE_NOW - 1_500_000 },
      { id: 's3', preview: '14 Orchard Lane', kind: 'text', at: SAMPLE_NOW - 7_200_000 }
    ],
    total: 3
  },
  workspaces: { items: [{ id: 's1', name: 'Study', tabs: 6, current: true }, { id: 's2', name: 'Trip planning', tabs: 4, current: false }, { id: 's3', name: 'Work', tabs: 9, current: false }] },
  whiteboard: { items: [{ id: 's1', name: 'Project map', elements: 14, updatedAt: SAMPLE_NOW - DAY }, { id: 's2', name: 'Kitchen plan', elements: 6, updatedAt: SAMPLE_NOW - 4 * DAY }] },
  bookmarks: { items: [{ title: 'Example library', url: 'https://example.org/library' }, { title: 'Example news', url: 'https://example.com/news' }, { title: 'Example maps', url: 'https://example.net/maps' }, { title: 'Example recipes', url: 'https://example.org/recipes' }], total: 4 },
  downloads: {
    items: [
      { id: 's1', name: 'timetable.pdf', state: 'done', received: 184_320, total: 184_320, at: SAMPLE_NOW - 600_000 },
      { id: 's2', name: 'photos.zip', state: 'downloading', received: 41_943_040, total: 104_857_600, at: SAMPLE_NOW - 30_000 }
    ]
  },
  recent: {
    items: [
      { title: 'Example library', url: 'https://example.org/library', host: 'example.org', at: SAMPLE_NOW - 300_000 },
      { title: 'Example news', url: 'https://example.com/news', host: 'example.com', at: SAMPLE_NOW - 2_400_000 },
      { title: 'Example maps', url: 'https://example.net/maps', host: 'example.net', at: SAMPLE_NOW - 9_000_000 }
    ]
  },
  tabs: { count: 7, groups: 2, items: [{ id: 1, title: 'Example library', url: 'https://example.org/library', active: true }, { id: 2, title: 'Example news', url: 'https://example.com/news', active: false }, { id: 3, title: 'Example maps', url: 'https://example.net/maps', active: false }] },
  weather: {
    place: 'Your city',
    temperature: 24,
    unit: 'c',
    summary: 'Partly cloudy',
    symbol: 'partly',
    hours: [
      { at: SAMPLE_NOW + 3_600_000, temperature: 25, symbol: 'partly' },
      { at: SAMPLE_NOW + 2 * 3_600_000, temperature: 26, symbol: 'clear' },
      { at: SAMPLE_NOW + 3 * 3_600_000, temperature: 26, symbol: 'clear' },
      { at: SAMPLE_NOW + 4 * 3_600_000, temperature: 24, symbol: 'showers' }
    ],
    attribution: 'MET Norway'
  },
  news: {
    items: [
      { title: 'A headline from a feed you choose', url: 'https://example.com/1', source: 'Your feed', at: SAMPLE_NOW - 3_600_000 },
      { title: 'Another headline, newest first', url: 'https://example.com/2', source: 'Your feed', at: SAMPLE_NOW - 2 * 3_600_000 },
      { title: 'Nothing is chosen for you', url: 'https://example.com/3', source: 'Your feed', at: SAMPLE_NOW - 5 * 3_600_000 }
    ],
    failed: []
  },
  markets: { symbol: 'BTC', name: 'Bitcoin', price: 64_250, change: 1.84, currency: 'USD', points: [62_900, 63_050, 62_800, 63_300, 63_650, 63_500, 63_900, 64_100, 63_950, 64_250], asOf: SAMPLE_NOW }
})

/** A sample, as a feed a widget can be drawn from. */
export const sampleFeed = <S extends WidgetSource>(source: S): WidgetFeed<S> => ({ source, status: 'live', value: WIDGET_SAMPLES[source], at: SAMPLE_NOW })
