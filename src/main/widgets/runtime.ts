import type { ExperienceConfig } from '../../shared/experience.ts'
import type { WidgetInstance } from '../../shared/widgets.ts'
import type { WidgetBoard } from '../../shared/widgetBoard.ts'
import { applyWidgetAction, fromLegacyBoard, normalizeBoard } from '../../shared/widgetBoard.ts'
import type { WidgetBoardState, WidgetEvent, WidgetRendered, WidgetReply, WidgetRequest } from '../../shared/widgetFeed.ts'
import { MAX_DASHBOARDS, newDashboard } from '../../shared/dashboards.ts'
import { normalizeWidgets, widgetById } from '../../shared/widgets.ts'
import type { WidgetRuntimeApi } from './contract.ts'

/**
 * The one place the start page's widgets are changed.
 *
 * The board itself lives where everything else personal lives -- in this profile's personalisation file, through the
 * store that already owns it. There is no widget store: a second place to keep the same list is how the start page
 * and the rest of Orbis came to disagree about what was on the page in the first place.
 *
 * Everything that changes the board comes through `act`, whoever is asking -- the start page, the gallery, Orion.
 * Each request is applied by the pure reducer, saved, and then READ BACK from the store and compared with what was
 * meant. Only then is it called done. That is the whole point: "I added the weather widget" is a claim about the
 * person's start page, and the only way to know it is true is to look.
 *
 * A saved layout is a snapshot of the board, not a second living copy of it: using one puts its widgets on the page,
 * and changing the page afterwards changes the page, not the layout. Saving under the same name again brings the
 * layout up to date. That is deliberate: two lists both claiming to be what is on screen is exactly how the start
 * page and the rest of Orbis came to disagree.
 *
 * No Electron here. It is handed a store and a clock and nothing else, so it can be tested without either.
 */

export interface RuntimeStore {
  current(): ExperienceConfig
  save(next: ExperienceConfig, reason?: string): Promise<{ config: ExperienceConfig; changes: unknown[] }>
  onChange(listener: (config: ExperienceConfig) => void): () => void
  readonly profile: string
}

export interface RuntimeDeps {
  store: RuntimeStore
  now?: () => number
  makeId?: () => string
}

/** How long a start page's account of what it has drawn is worth anything. After this, nothing is known. */
const RENDER_FRESH_MS = 15_000

/** How many changes back can be taken. Enough for an evening of arranging; not a second copy of the history. */
const HISTORY = 50

const boardOf = (config: ExperienceConfig): WidgetBoard =>
  normalizeBoard({ enabled: config.newTab.widgets, instances: config.widgets, favourites: config.widgetFavourites, recent: config.widgetRecent })

/** The same board, back into the shape the personalisation file keeps. */
const intoConfig = (config: ExperienceConfig, board: WidgetBoard): ExperienceConfig => ({
  ...config,
  widgets: board.instances,
  widgetFavourites: board.favourites,
  widgetRecent: board.recent,
  newTab: { ...config.newTab, widgets: board.enabled }
})

/** What two boards disagree about, in a form that can be compared as text. */
const sameBoard = (a: WidgetBoard, b: WidgetBoard): boolean => JSON.stringify(a) === JSON.stringify(b)

export function createWidgetRuntime(deps: RuntimeDeps): WidgetRuntimeApi {
  const now = deps.now ?? (() => Date.now())
  const makeId = deps.makeId ?? (() => crypto.randomUUID())
  const store = deps.store

  let revision = 1
  let profile = store.profile
  /** Boards as they were before each change, newest last. Kept in memory: a history is this session's, not a record. */
  let past: WidgetBoard[] = []
  let future: WidgetBoard[] = []
  let lastRendered: (WidgetRendered & { at: number }) | null = null
  /** Saves this runtime is in the middle of. Its own save is already being announced; it must not be announced twice. */
  let saving = 0
  const listeners = new Set<(event: WidgetEvent) => void>()
  const waiting = new Set<{ revision: number; tell: (seen: boolean) => void }>()

  const state = (): WidgetBoardState => ({
    revision,
    profileId: store.profile,
    board: boardOf(store.current()),
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    layouts: store.current().dashboards.map((one) => ({ id: one.id, name: one.name, widgets: one.widgets.length }))
  })

  const announce = (): void => {
    const snapshot = state()
    for (const listener of [...listeners]) {
      try {
        listener({ type: 'state', state: snapshot })
      } catch {
        // A page that cannot be told is a page that has gone away. It is dropped when its own listener is removed.
      }
    }
  }

  const changed = (): void => {
    revision += 1
    announce()
  }

  // Changes made anywhere else -- another window, a profile switch, Customize -- are changes to the same board.
  store.onChange(() => {
    if (saving > 0 && store.profile === profile) return
    if (store.profile !== profile) {
      // A different person's board. Taking back a change made to somebody else's page is not an undo.
      profile = store.profile
      past = []
      future = []
    }
    changed()
  })

  /**
   * Saves a board and proves it is really there.
   *
   * The store normalises what it is given, so what comes back is what the start page will actually be drawn from --
   * not what was asked for. If they differ, the change did not take, and saying it did would be the one thing this
   * whole arrangement exists to prevent.
   */
  const put = async (board: WidgetBoard, reason: string): Promise<{ ok: true } | { ok: false; message: string }> => {
    const config = store.current()
    const next = intoConfig(config, board)
    saving += 1
    try {
      await store.save(next, reason)
    } catch (err) {
      return { ok: false, message: `That could not be saved: ${err instanceof Error ? err.message : 'the personalisation file would not take it'}.` }
    } finally {
      saving -= 1
    }
    const after = boardOf(store.current())
    if (!sameBoard(after, board)) {
      return { ok: false, message: 'That was saved and then read back differently, so it has been left as it was.' }
    }
    return { ok: true }
  }

  const reply = (said: string, extra: { id?: string; already?: boolean } = {}): WidgetReply => ({ ok: true, state: state(), said, ...extra })
  const refuse = (error: string, message: string): WidgetReply => ({ ok: false, error, message })

  /** A change to the board, with the board it replaces remembered so it can be taken back. */
  const commit = async (before: WidgetBoard, board: WidgetBoard, reason: string, said: string, extra: { id?: string; already?: boolean } = {}): Promise<WidgetReply> => {
    const saved = await put(board, reason)
    if (!saved.ok) return refuse('not-saved', saved.message)
    past = [...past, before].slice(-HISTORY)
    future = []
    changed()
    return reply(said, extra)
  }

  const act = async (request: WidgetRequest, by: 'page' | 'orion' = 'page'): Promise<WidgetReply> => {
    if (!request || typeof request !== 'object' || typeof (request as { type?: unknown }).type !== 'string') {
      return refuse('bad-input', 'Say what to do.')
    }
    const before = boardOf(store.current())
    const who = by === 'orion' ? ' (asked for by Orion)' : ''

    switch (request.type) {
      case 'undo': {
        const back = past[past.length - 1]
        if (!back) return refuse('nothing-to-undo', 'There is nothing to take back.')
        const saved = await put(back, `Took back the last widget change${who}`)
        if (!saved.ok) return refuse('not-saved', saved.message)
        past = past.slice(0, -1)
        future = [...future, before].slice(-HISTORY)
        changed()
        return reply('The last change to the widgets was taken back.')
      }

      case 'redo': {
        const forward = future[future.length - 1]
        if (!forward) return refuse('nothing-to-redo', 'There is nothing to put back.')
        const saved = await put(forward, `Put the widget change back${who}`)
        if (!saved.ok) return refuse('not-saved', saved.message)
        future = future.slice(0, -1)
        past = [...past, before].slice(-HISTORY)
        changed()
        return reply('That change is back.')
      }

      case 'layout.save': {
        const name = String(request.name ?? '').trim()
        if (!name) return refuse('bad-input', 'Give the layout a name.')
        if (before.instances.length === 0) return refuse('bad-input', 'There are no widgets on the start page to save.')
        const config = store.current()
        const already = config.dashboards.find((one) => one.name.toLowerCase() === name.toLowerCase())
        if (!already && config.dashboards.length >= MAX_DASHBOARDS) return refuse('full', `Orbis keeps ${MAX_DASHBOARDS} layouts. Forget one first.`)
        // The same name again is the same layout, brought up to date -- not a second one with the same name.
        const made = already ? { ...already, widgets: before.instances } : newDashboard(name, before.instances, now())
        const dashboards = already ? config.dashboards.map((one) => (one.id === already.id ? made : one)) : [...config.dashboards, made]
        saving += 1
        try {
          await store.save({ ...config, dashboards, activeDashboardId: made.id }, `Saved the widget layout “${made.name}”`)
        } catch (err) {
          return refuse('not-saved', `That could not be saved: ${err instanceof Error ? err.message : 'the personalisation file would not take it'}.`)
        } finally {
          saving -= 1
        }
        const kept = store.current().dashboards.find((one) => one.id === made.id)
        if (!kept || kept.widgets.length !== before.instances.length) return refuse('not-saved', 'The layout was saved and then read back differently, so nothing was kept.')
        changed()
        return reply(already ? `The layout “${made.name}” now holds what is on the start page.` : `The start page is saved as the layout “${made.name}”.`, { id: made.id })
      }

      case 'layout.use': {
        const config = store.current()
        const found = config.dashboards.find((one) => one.id === request.id)
        if (!found) return refuse('not-found', 'There is no saved layout with that name.')
        const instances = normalizeWidgets(found.widgets)
        const board: WidgetBoard = { ...before, enabled: instances.length > 0 ? true : before.enabled, instances }
        const next = intoConfig(config, board)
        saving += 1
        try {
          await store.save({ ...next, activeDashboardId: found.id }, `Put the widget layout “${found.name}” on the start page${who}`)
        } catch (err) {
          return refuse('not-saved', `That could not be saved: ${err instanceof Error ? err.message : 'the personalisation file would not take it'}.`)
        } finally {
          saving -= 1
        }
        if (!sameBoard(boardOf(store.current()), normalizeBoard({ enabled: board.enabled, instances, favourites: board.favourites, recent: board.recent }))) {
          return refuse('not-saved', 'The layout was put on and then read back differently, so the start page has been left as it was.')
        }
        past = [...past, before].slice(-HISTORY)
        future = []
        changed()
        return reply(`The start page now shows the layout “${found.name}”: ${instances.length} ${instances.length === 1 ? 'widget' : 'widgets'}.`, { id: found.id })
      }

      case 'layout.remove': {
        const config = store.current()
        const found = config.dashboards.find((one) => one.id === request.id)
        if (!found) return refuse('not-found', 'There is no saved layout with that name.')
        saving += 1
        try {
          await store.save(
            { ...config, dashboards: config.dashboards.filter((one) => one.id !== found.id), activeDashboardId: config.activeDashboardId === found.id ? null : config.activeDashboardId },
            `Forgot the widget layout “${found.name}”`
          )
        } catch (err) {
          return refuse('not-saved', `That could not be saved: ${err instanceof Error ? err.message : 'the personalisation file would not take it'}.`)
        } finally {
          saving -= 1
        }
        changed()
        return reply(`The layout “${found.name}” is forgotten. The widgets on the start page were left alone.`)
      }

      case 'adopt': {
        const config = store.current()
        if (config.widgetsAdopted) return { ok: true, state: state(), said: 'The start page’s own widgets were already brought in.', already: true }
        const { instances, dropped } = fromLegacyBoard(request.legacy, now(), makeId)
        const board: WidgetBoard = {
          ...before,
          enabled: instances.length > 0 ? true : before.enabled,
          instances: [...before.instances, ...instances]
        }
        const next = { ...intoConfig(config, board), widgetsAdopted: true }
        saving += 1
        try {
          await store.save(next, 'Brought in the widgets the start page was keeping')
        } catch (err) {
          return refuse('not-saved', `Those widgets could not be kept: ${err instanceof Error ? err.message : 'the personalisation file would not take them'}.`)
        } finally {
          saving -= 1
        }
        if (!store.current().widgetsAdopted) return refuse('not-saved', 'The start page’s widgets were brought in and then not kept, so nothing was changed.')
        changed()
        const said = instances.length === 0
          ? 'The start page had no widgets of its own to bring in.'
          : `${instances.length} ${instances.length === 1 ? 'widget' : 'widgets'} the start page was keeping ${instances.length === 1 ? 'is' : 'are'} now kept with the rest of Orbis.${dropped.length ? ` ${dropped.length} Orbis no longer has ${dropped.length === 1 ? 'was' : 'were'} left out.` : ''}`
        return reply(said)
      }

      default: {
        const result = applyWidgetAction(before, request, now(), makeId)
        if (!result.ok) return refuse(result.error, result.message)
        if (result.already && sameBoard(result.board, before)) return { ok: true, state: state(), said: result.said, ...(result.id ? { id: result.id } : {}), already: true }
        // A widget added while the area is switched off would be kept and never seen. Adding one turns it on.
        const board = request.type === 'add' || request.type === 'preset' || request.type === 'revive' ? { ...result.board, enabled: true } : result.board
        return commit(before, board, `Widgets: ${result.said.slice(0, 80) || request.type}${who}`, result.said, { ...(result.id ? { id: result.id } : {}), ...(result.already ? { already: true } : {}) })
      }
    }
  }

  return {
    state: async () => state(),
    act,
    onEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    rendered: () => (lastRendered && now() - lastRendered.at <= RENDER_FRESH_MS ? lastRendered : null),
    report: (rendered) => {
      const ids = (list: unknown): string[] => (Array.isArray(list) ? list.filter((one): one is string => typeof one === 'string').slice(0, 64) : [])
      lastRendered = {
        revision: typeof rendered?.revision === 'number' ? rendered.revision : 0,
        shown: ids(rendered?.shown),
        failed: ids(rendered?.failed),
        columns: typeof rendered?.columns === 'number' ? rendered.columns : 0,
        gallery: rendered?.gallery === true,
        arranging: rendered?.arranging === true,
        at: now()
      }
      for (const one of [...waiting]) {
        if (lastRendered.revision >= one.revision) {
          waiting.delete(one)
          one.tell(true)
        }
      }
    },
    waitForRender: (wanted, timeoutMs = 1500) =>
      new Promise((resolve) => {
        if (lastRendered && now() - lastRendered.at <= RENDER_FRESH_MS && lastRendered.revision >= wanted) return resolve(true)
        const entry = { revision: wanted, tell: (seen: boolean) => (clearTimeout(timer), resolve(seen)) }
        const timer = setTimeout(() => {
          waiting.delete(entry)
          resolve(false)
        }, Math.max(0, timeoutMs))
        // A wait that outlives the thing waited for must not keep the process up.
        timer.unref?.()
        waiting.add(entry)
      })
  }
}

/** A widget on the board by its own id, the widget it is an instance of, or that widget's name. For Orion. */
export function findOnBoard(instances: readonly WidgetInstance[], asked: string): { one: WidgetInstance } | { many: WidgetInstance[] } | { none: true } {
  const text = asked.trim().toLowerCase()
  if (!text) return { none: true }
  const byOwnId = instances.find((one) => one.id.toLowerCase() === text)
  if (byOwnId) return { one: byOwnId }
  const matching = instances.filter((one) => one.widget === text || widgetById(one.widget)?.name.toLowerCase() === text)
  if (matching.length === 1) return { one: matching[0] }
  if (matching.length > 1) return { many: matching }
  return { none: true }
}
