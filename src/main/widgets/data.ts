import type { WeatherSymbol, WidgetCommand, WidgetCommandResult, WidgetFeed, WidgetFeedMap, WidgetFeedRequest, WidgetSource } from '../../shared/widgetFeed.ts'
import { FEED_LIMITS, WIDGET_COMMANDS, WIDGET_SOURCES } from '../../shared/widgetFeed.ts'
import type { Task } from '../../shared/tasks.ts'
import type { Note } from '../../shared/notes.ts'
import type { ClipItem } from '../../shared/clipboardHistory.ts'
import type { Workspace } from '../../shared/workspaces.ts'
/** One whiteboard, without what is drawn on it. */
export interface BoardSummary {
  id: string
  name: string
  /** How many things are on it. */
  count: number
  updatedAt: number
}
import type { Weather } from '../../shared/widgetData.ts'
import { mergeFeeds, parseFeedList, recentSites, temperatureIn, type Feed } from '../../shared/widgetData.ts'
import type { WidgetDataApi } from './contract.ts'

/**
 * What the widgets on the start page are shown, and what pressing something on one does.
 *
 * A widget never reads a store. It names one of the sources below and is handed a small, fixed shape -- titles and
 * times, never whole notes; the last few things, never a history. Everything is read for the profile in use, from
 * the stores Orbis already has, and nothing here can reach a password, a cookie, the Secrets Vault or another
 * profile: there is deliberately no source for any of them, so there is nothing to hand over by mistake.
 *
 * Honesty is the whole job. `live` was read just now. `cached` is the last good answer, with the time it was really
 * read, because "33 degrees" from this morning passed off as now is worse than saying nothing. `offline` and
 * `unavailable` carry no value at all and a reason in words. Nothing here ever invents a number.
 *
 * No Electron: every reader is handed in, so this can be tested with nothing running.
 */

export interface WidgetDataDeps {
  // ---- the person's own things, read from the stores the app already has, for the profile in use
  /** Every task in this profile. Wired to TasksStore.all() in src/main/personal/tasks.ts. */
  tasks?: () => Promise<readonly Task[]> | readonly Task[]
  /** Ticks one off. Wired to the same store's update; answers false when there is no such task. */
  completeTask?: (id: string) => Promise<boolean>
  /** Every note. Wired to NotesStore.all(); archived ones are left out here. */
  notes?: () => Promise<readonly Note[]> | readonly Note[]
  /** Makes an empty note and answers its id, or null when notes are not available. Wired to NotesStore.create. */
  createNote?: () => Promise<string | null>
  /** What has been copied, newest first. Wired to the clipboard history store. */
  clips?: () => Promise<readonly ClipItem[]> | readonly ClipItem[]
  /** Puts a clip back on the clipboard. Wired to whatever already does that for the clipboard screen. */
  copyClip?: (id: string) => Promise<boolean>
  workspaces?: () => Promise<readonly Workspace[]> | readonly Workspace[]
  /** Which workspace is open, when one is. */
  currentWorkspace?: () => Promise<string | null> | string | null
  openWorkspace?: (id: string) => Promise<boolean>
  /**
   * Whiteboards, as names and counts only.
   *
   * What is drawn on a board never comes here. A card shows that a board exists and how much is on it, which is all
   * it has room for and all it has any business reading.
   */
  boards?: () => Promise<readonly BoardSummary[]> | readonly BoardSummary[]

  // ---- the browser's own things
  /** Bookmarks, as Orbis keeps its copy of the browser's. Wired to browserLibrary. */
  bookmarks?: () => Promise<readonly { title: string; url: string; addedAt?: number }[]>
  downloads?: () => Promise<readonly { id: string; name: string; state: string; received: number; total: number; at: number }[]>
  /** Show a finished download in the folder it went to. */
  showDownload?: (id: string) => Promise<boolean>
  /** Where this profile has been, newest first. Wired to browserLibrary's history. */
  history?: () => Promise<readonly { url: string; title: string; visitedAt: number }[]>
  /** The tabs that are open, and how many groups. Wired to the browser control layer's view of the window. */
  tabs?: () => Promise<{ count: number; groups: number; items: { id: number; title: string; url: string; active: boolean }[] }>
  activateTab?: (id: number) => Promise<boolean>

  // ---- things from the internet, through the fetchers the app already has
  /** Wired to WidgetFeeds.weather(city) in src/main/widgetFeeds.ts. */
  weather?: (city: string) => Promise<{ ok: true; data: Weather; fetchedAt: number; stale: boolean } | { ok: false; reason: string }>
  /** Wired to WidgetFeeds.feed(url). */
  newsFeed?: (url: string) => Promise<{ ok: true; data: Feed; fetchedAt: number; stale: boolean } | { ok: false; reason: string }>
  /** One price from Orbis Markets. null when Markets are not set up or the symbol is not one it knows. */
  marketQuote?: (symbol: string) => Promise<{ symbol: string; name: string; price: number; change: number; currency: string; points: number[]; asOf: number } | null>

  // ---- the rest
  /** Whether this computer has a connection. Decides between "no connection" and "that did not work". */
  online?: () => boolean
  /** Opens one of Orbis's own screens in the browser's side panel. Answers false when there is no such screen. */
  openPanel?: (view: string) => Promise<boolean>
  /** Hands words to Orion. Answers false when Orion cannot be reached. */
  askOrion?: (text: string) => Promise<boolean>
  /** Tells this service that a store has changed, so widgets reading it ask again. */
  onStoreChange?: (listen: (source: WidgetSource) => void) => () => void
  now?: () => number
  /**
   * Where the last good answer from the internet is kept between runs, per profile.
   *
   * Without it the last answer is kept in memory only, and a restart means the weather card says it is reading
   * rather than showing this morning's with its time on it.
   */
  cache?: { read(key: string): Promise<unknown>; write(key: string, value: unknown): Promise<void> }
}

/**
 * Which of Orbis's own screens a widget may ask the browser's side panel to open.
 *
 * Exactly the ones the panel really has (orbis-ui/panel/panel.js names them). A widget cannot offer to open a screen
 * that does not exist: pressing it would quietly show the panel's home, which is a button that lies about what it does.
 */
export const PANEL_VIEWS: readonly string[] = Object.freeze(['home', 'search', 'recall', 'schedules', 'notes', 'tasks', 'workflows', 'galaxy'])

/** The longest question a widget may hand to Orion. A card is not a place to paste an essay from. */
export const ASK_LIMIT = 500

const CLIP_PREVIEW = 160
const NOTE_EXCERPT = 120

/** MET Norway's symbol codes, as the pictures the start page draws. Their code, our pictures. */
export function weatherSymbol(code: string): WeatherSymbol {
  const name = code.toLowerCase()
  const night = name.endsWith('_night')
  if (name.startsWith('clearsky') || name.startsWith('fair')) return night ? 'night' : 'clear'
  if (name.startsWith('partlycloudy')) return 'partly'
  if (name.startsWith('cloudy')) return 'cloudy'
  if (name.includes('thunder')) return 'thunder'
  if (name.includes('sleet')) return 'sleet'
  if (name.includes('snow')) return 'snow'
  if (name.includes('showers')) return 'showers'
  if (name.includes('rain')) return 'rain'
  if (name.startsWith('fog')) return 'fog'
  return 'unknown'
}

/** A day with no time of its own: a task due "today" rather than at a quarter past three. */
const startOfDay = (at: number): number => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '')

const clipKind = (kind: string): 'text' | 'link' | 'image' | 'other' => (kind === 'text' || kind === 'link' || kind === 'image' ? kind : 'other')

const downloadState = (state: string): 'done' | 'downloading' | 'paused' | 'failed' => {
  const name = state.toLowerCase()
  if (name.includes('complete') || name === 'done' || name === 'finished') return 'done'
  if (name.includes('pause') || name.includes('interrupt')) return name.includes('cancel') || name.includes('fail') ? 'failed' : 'paused'
  if (name.includes('cancel') || name.includes('fail') || name.includes('error')) return 'failed'
  return 'downloading'
}

export function createWidgetData(deps: WidgetDataDeps = {}): WidgetDataApi {
  const now = deps.now ?? (() => Date.now())
  const listeners = new Set<(source: WidgetSource) => void>()
  /** The last good answer from the internet, by source and what was asked for. */
  const kept = new Map<string, { value: unknown; at: number }>()

  deps.onStoreChange?.((source) => {
    for (const listener of [...listeners]) {
      try {
        listener(source)
      } catch {
        // A page that cannot be told has gone away; it drops its own listener.
      }
    }
  })

  const live = <S extends WidgetSource>(source: S, value: WidgetFeedMap[S]): WidgetFeed<S> => ({ source, status: 'live', value, at: now() })
  const nothing = <S extends WidgetSource>(source: S, why: string, needs?: string): WidgetFeed<S> => ({
    source,
    status: deps.online?.() === false ? 'offline' : 'unavailable',
    value: null,
    at: 0,
    error: why,
    ...(needs ? { needs } : {})
  })
  const missing = <S extends WidgetSource>(source: S, what: string): WidgetFeed<S> => ({
    source,
    status: 'unavailable',
    value: null,
    at: 0,
    error: `${what} is not available here. Widgets read it from Orbis, which has to be running.`
  })

  /**
   * An answer from the internet, kept so the card can show the last good one when a new one cannot be had.
   *
   * This is where "cached" comes from, and the time kept with it is the time it was really read -- never now.
   */
  const remembered = async <S extends WidgetSource>(source: S, key: string, read: () => Promise<{ value: WidgetFeedMap[S] } | { error: string; needs?: string }>, fresh: boolean): Promise<WidgetFeed<S>> => {
    const place = `${source}:${key}`
    if (!kept.has(place) && deps.cache) {
      try {
        const stored = (await deps.cache.read(place)) as { value: unknown; at: number } | null
        if (stored && typeof stored.at === 'number' && stored.value !== undefined) kept.set(place, stored)
      } catch {
        // Nothing kept, or it could not be read. The card simply has nothing old to fall back on.
      }
    }
    const had = kept.get(place)
    if (!fresh && had && now() - had.at < 15_000) return { source, status: 'live', value: had.value as WidgetFeedMap[S], at: had.at }
    const result = await read()
    if ('value' in result) {
      kept.set(place, { value: result.value, at: now() })
      void deps.cache?.write(place, { value: result.value, at: now() }).catch(() => undefined)
      return live(source, result.value)
    }
    if (had) return { source, status: 'cached', value: had.value as WidgetFeedMap[S], at: had.at, error: result.error }
    return nothing(source, result.error, result.needs)
  }

  const feed = async (request: WidgetFeedRequest): Promise<WidgetFeed> => {
    const source = request && typeof request === 'object' ? request.source : undefined
    if (typeof source !== 'string' || !WIDGET_SOURCES.includes(source as WidgetSource)) {
      return { source: 'tasks', status: 'unavailable', value: null, at: 0, error: 'That is not something a widget can be shown.' }
    }
    const ceiling = FEED_LIMITS[source as WidgetSource]
    const asked = typeof request.limit === 'number' && Number.isFinite(request.limit) ? Math.max(1, Math.floor(request.limit)) : ceiling
    const limit = Math.min(ceiling, asked)
    const fresh = request.fresh === true

    try {
      switch (source as WidgetSource) {
        case 'tasks': {
          if (!deps.tasks) return missing('tasks', 'Tasks')
          const view = request.view === 'overdue' || request.view === 'flagged' || request.view === 'all' ? request.view : 'today'
          const today = startOfDay(now()) + 86_400_000
          const open = (await deps.tasks()).filter((one) => !one.done)
          const overdue = (one: Task): boolean => typeof one.due === 'number' && one.due < (one.hasTime ? now() : startOfDay(now()))
          const chosen = open.filter((one) => {
            if (view === 'all') return true
            if (view === 'overdue') return overdue(one)
            if (view === 'flagged') return one.priority === 'high' || one.priority === 'medium'
            return typeof one.due === 'number' && one.due < today
          })
          const items = chosen
            .slice()
            .sort((a, b) => (a.due ?? Number.MAX_SAFE_INTEGER) - (b.due ?? Number.MAX_SAFE_INTEGER) || a.order - b.order)
            .slice(0, limit)
            .map((one) => ({ id: one.id, title: text(one.title, 120), dueAt: typeof one.due === 'number' ? one.due : null, hasTime: one.hasTime === true, important: one.priority === 'high', overdue: overdue(one) }))
          return live('tasks', { items, total: chosen.length })
        }

        case 'reminders': {
          if (!deps.tasks) return missing('reminders', 'Tasks')
          // A reminder is a task with a time on it that has not happened yet. Orbis keeps no second list of them.
          const coming = (await deps.tasks())
            .filter((one) => !one.done && one.hasTime && typeof one.due === 'number' && one.due >= now())
            .sort((a, b) => (a.due ?? 0) - (b.due ?? 0))
          return live('reminders', { items: coming.slice(0, limit).map((one) => ({ id: one.id, title: text(one.title, 120), at: one.due as number })), total: coming.length })
        }

        case 'notes': {
          if (!deps.notes) return missing('notes', 'Notes')
          const mine = (await deps.notes()).filter((one) => !one.archived)
          const items = mine
            .slice()
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
            .slice(0, limit)
            // The first line is the title; a short piece of the rest is all a card ever sees of a note.
            .map((one) => ({ id: one.id, title: text(one.title, 120) || 'Untitled note', excerpt: text(one.body, NOTE_EXCERPT), updatedAt: one.updatedAt }))
          return live('notes', { items, total: mine.length })
        }

        case 'clipboard': {
          if (!deps.clips) return missing('clipboard', 'The clipboard history')
          const all = await deps.clips()
          const items = all
            .slice(0, limit)
            // Only the short line the clipboard screen itself shows, never the copied text.
            .map((one) => ({ id: one.id, preview: text(one.preview || (one.kind === 'image' ? 'A picture' : ''), CLIP_PREVIEW), kind: clipKind(one.kind), at: one.copiedAt }))
          return live('clipboard', { items, total: all.length })
        }

        case 'workspaces': {
          if (!deps.workspaces) return missing('workspaces', 'Workspaces')
          const current = (await deps.currentWorkspace?.()) ?? null
          const items = (await deps.workspaces())
            .slice()
            .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.order - b.order)
            .slice(0, limit)
            .map((one) => ({ id: one.id, name: text(one.name, 80) || 'Workspace', tabs: one.tabs.length, current: one.id === current }))
          return live('workspaces', { items })
        }

        case 'whiteboard': {
          if (!deps.boards) return missing('whiteboard', 'Whiteboards')
          const items = (await deps.boards())
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, limit)
            .map((one) => ({ id: one.id, name: text(one.name, 80) || 'Board', elements: one.count, updatedAt: one.updatedAt }))
          return live('whiteboard', { items })
        }

        case 'bookmarks': {
          if (!deps.bookmarks) return missing('bookmarks', 'Bookmarks')
          const all = await deps.bookmarks()
          const items = all.slice(0, limit).map((one) => ({ title: text(one.title, 120) || one.url, url: one.url }))
          return live('bookmarks', { items, total: all.length })
        }

        case 'downloads': {
          if (!deps.downloads) return missing('downloads', 'Downloads')
          const all = await deps.downloads()
          const items = all
            .slice()
            .sort((a, b) => b.at - a.at)
            .slice(0, limit)
            .map((one) => ({ id: one.id, name: text(one.name, 120), state: downloadState(one.state), received: Math.max(0, one.received), total: Math.max(0, one.total), at: one.at }))
          return live('downloads', { items })
        }

        case 'recent': {
          if (!deps.history) return missing('recent', 'Your browsing history')
          const history = await deps.history()
          // The same sum the rest of Orbis uses for "sites you use", so the card and the screen agree.
          const items = recentSites(history.map((one) => ({ url: one.url, title: one.title, visitedAt: one.visitedAt })), limit).map((one) => ({
            title: text(one.title, 120) || one.host,
            url: one.url,
            host: one.host,
            at: one.visitedAt
          }))
          return live('recent', { items })
        }

        case 'tabs': {
          if (!deps.tabs) return missing('tabs', 'The tabs you have open')
          const open = await deps.tabs()
          return live('tabs', {
            count: Math.max(0, open.count),
            groups: Math.max(0, open.groups),
            items: open.items.slice(0, limit).map((one) => ({ id: one.id, title: text(one.title, 120) || one.url, url: one.url, active: one.active === true }))
          })
        }

        case 'weather': {
          if (!deps.weather) return missing('weather', 'The weather')
          const city = text(request.city, 100)
          if (!city) return { source: 'weather', status: 'unavailable', value: null, at: 0, error: 'No city chosen yet.', needs: 'Choose a city' }
          const unit: 'c' | 'f' = request.unit === 'f' ? 'f' : 'c'
          return remembered(
            'weather',
            `${city.toLowerCase()}|${unit}`,
            async () => {
              const answer = await deps.weather!(city)
              if (!answer.ok) return { error: answer.reason }
              const data = answer.data
              const degrees = (celsius: number): number => (unit === 'f' ? Math.round((celsius * 9) / 5 + 32) : Math.round(celsius))
              return {
                value: {
                  place: data.place,
                  temperature: degrees(data.now.temperature),
                  unit,
                  summary: data.now.condition,
                  symbol: weatherSymbol(data.now.symbol),
                  hours: data.hours.slice(0, limit).map((one) => ({ at: one.at, temperature: degrees(one.temperature), symbol: weatherSymbol(one.symbol) })),
                  attribution: data.attribution
                } satisfies WidgetFeedMap['weather']
              }
            },
            fresh
          )
        }

        case 'news': {
          if (!deps.newsFeed) return missing('news', 'News')
          const wanted = parseFeedList(Array.isArray(request.feeds) ? request.feeds.filter((one) => typeof one === 'string').join('\n') : '')
          if (wanted.length === 0) return { source: 'news', status: 'unavailable', value: null, at: 0, error: 'No feeds chosen yet.', needs: 'Add a feed' }
          return remembered(
            'news',
            wanted.join(','),
            async () => {
              const answers = await Promise.all(wanted.map(async (url) => ({ url, got: await deps.newsFeed!(url) })))
              const good: Feed[] = []
              const failed: string[] = []
              for (const one of answers) {
                if (one.got.ok) good.push(one.got.data)
                else failed.push(`${hostOf(one.url)}: ${one.got.reason}`)
              }
              if (good.length === 0) return { error: failed[0] ?? 'None of those feeds could be read.' }
              return {
                value: {
                  items: mergeFeeds(good, limit).map((one) => ({ title: text(one.title, 200), url: one.url, source: text(one.source, 60), at: typeof one.publishedAt === 'number' ? one.publishedAt : null })),
                  failed
                } satisfies WidgetFeedMap['news']
              }
            },
            fresh
          )
        }

        case 'markets': {
          if (!deps.marketQuote) return missing('markets', 'Orbis Markets')
          const symbol = text(request.symbol, 24).toUpperCase()
          if (!symbol) return { source: 'markets', status: 'unavailable', value: null, at: 0, error: 'No symbol chosen yet.', needs: 'Choose what to follow' }
          return remembered(
            'markets',
            symbol,
            async () => {
              const quote = await deps.marketQuote!(symbol)
              if (!quote) return { error: `Orbis Markets has no price for ${symbol}.` }
              return {
                value: {
                  symbol: quote.symbol,
                  name: quote.name,
                  price: quote.price,
                  change: quote.change,
                  currency: quote.currency,
                  points: quote.points.slice(-60),
                  asOf: quote.asOf
                } satisfies WidgetFeedMap['markets']
              }
            },
            fresh
          )
        }
      }
    } catch (err) {
      return { source: source as WidgetSource, status: 'unavailable', value: null, at: 0, error: `That could not be read: ${err instanceof Error ? err.message : 'something went wrong'}.` }
    }
    return { source: source as WidgetSource, status: 'unavailable', value: null, at: 0, error: 'That is not something a widget can be shown.' }
  }

  const run = async (command: WidgetCommand): Promise<WidgetCommandResult> => {
    const name = command && typeof command === 'object' ? (command as { do?: unknown }).do : undefined
    if (typeof name !== 'string' || !WIDGET_COMMANDS.includes(name as WidgetCommand['do'])) return { ok: false, message: 'A widget cannot ask for that.' }
    try {
      switch (command.do) {
        case 'task.complete': {
          if (!deps.completeTask) return { ok: false, message: 'Tasks are not available here.' }
          const done = await deps.completeTask(String(command.id ?? ''))
          return done ? { ok: true, message: 'Ticked off.' } : { ok: false, message: 'That task is no longer there.' }
        }
        case 'note.create': {
          if (!deps.createNote) return { ok: false, message: 'Notes are not available here.' }
          const id = await deps.createNote()
          return id ? { ok: true, message: 'A new note is waiting in Notes.' } : { ok: false, message: 'That note could not be made.' }
        }
        case 'clip.copy': {
          if (!deps.copyClip) return { ok: false, message: 'The clipboard history is not available here.' }
          const copied = await deps.copyClip(String(command.id ?? ''))
          return copied ? { ok: true, message: 'Copied.' } : { ok: false, message: 'That is no longer in the clipboard history.' }
        }
        case 'workspace.open': {
          if (!deps.openWorkspace) return { ok: false, message: 'Workspaces are not available here.' }
          const opened = await deps.openWorkspace(String(command.id ?? ''))
          return opened ? { ok: true } : { ok: false, message: 'That workspace could not be opened.' }
        }
        case 'tab.activate': {
          if (!deps.activateTab) return { ok: false, message: 'The tabs cannot be reached from here.' }
          const went = await deps.activateTab(Number(command.id))
          return went ? { ok: true } : { ok: false, message: 'That tab is closed.' }
        }
        case 'download.show': {
          if (!deps.showDownload) return { ok: false, message: 'Downloads are not available here.' }
          const shown = await deps.showDownload(String(command.id ?? ''))
          return shown ? { ok: true } : { ok: false, message: 'That file is no longer where it was downloaded.' }
        }
        case 'panel.open': {
          const view = String(command.view ?? '')
          if (!PANEL_VIEWS.includes(view)) return { ok: false, message: 'Orbis has no such screen.' }
          if (!deps.openPanel) return { ok: false, message: 'That screen cannot be opened from here.' }
          const opened = await deps.openPanel(view)
          return opened ? { ok: true } : { ok: false, message: 'That screen could not be opened.' }
        }
        case 'orion.ask': {
          const words = text(command.text, ASK_LIMIT)
          if (!words) return { ok: false, message: 'Type a question first.' }
          if (!deps.askOrion) return { ok: false, message: 'Orion cannot be reached from here.' }
          const asked = await deps.askOrion(words)
          return asked ? { ok: true, message: 'Orion is reading it.' } : { ok: false, message: 'Orion could not be reached.' }
        }
      }
    } catch (err) {
      return { ok: false, message: `That did not work: ${err instanceof Error ? err.message : 'something went wrong'}.` }
    }
    return { ok: false, message: 'A widget cannot ask for that.' }
  }

  return {
    // Typed by the source asked for at the surface; inside, each source is narrowed by hand.
    feed: feed as WidgetDataApi['feed'],
    run,
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export { temperatureIn }
