import type { CardOptions, FeedOptions, WidgetCard, WidgetContext } from './api.ts'
import { ago, button, clear, h, icon, prefersStill } from './dom.ts'
import { RENDERERS } from './renderers/index.ts'
import { clampWidgetSetting, widgetById, type WidgetSize } from '../../../src/shared/widgets.ts'
import { SAMPLE_NOW, sampleFeed, type WidgetFeed, type WidgetFeedRequest, type WidgetSource } from '../../../src/shared/widgetFeed.ts'

/**
 * One widget, in the card every widget shares.
 *
 * The card owns everything that is the same whatever the widget is: the surface it sits on, the quiet bar while
 * something is being read, the words when there is nothing to show, the words when something has to be chosen
 * first, and what is shown when the widget itself breaks. A widget draws only its own subject, and so the hundred
 * small decisions about honesty are made once, here, rather than twenty times over.
 *
 * It is also what keeps one broken widget from taking the page with it. The drawing, the callbacks it hands out and
 * the timers it starts all run inside a catch: a widget that throws loses its own content, says so, and offers to
 * try again. Nothing else on the page notices.
 *
 * A preview is the same card, with the same renderer, handed the sample instead of the person's own things. That is
 * the whole difference -- which is why what the gallery shows cannot drift from what a person gets.
 */

/** Widgets that are about the time itself, where a preview showing a fixed moment would look broken. */
const REAL_TIME = new Set(['clock', 'worldclock', 'greeting', 'timer'])

const sameSettings = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => JSON.stringify(a) === JSON.stringify(b)

export function createCard(options: CardOptions): WidgetCard {
  let instance = options.instance
  let size: WidgetSize = options.size ?? instance.size
  const definition = widgetById(instance.widget)

  const element = h('article', { class: 'wg-card', role: 'group' })
  const body = h('div', { class: 'wg-body' })
  element.append(body)

  let failed = false
  let cleanups: (() => void)[] = []
  let savedTimer = 0
  let pending: Record<string, string | number | boolean> | null = null
  let gone = false

  const dress = (): void => {
    element.dataset.widget = instance.widget
    element.dataset.size = size
    element.dataset.tone = instance.look.tone
    element.dataset.density = instance.look.density
    if (options.preview) element.dataset.preview = 'true'
    if (instance.locked) element.dataset.locked = 'true'
    else delete element.dataset.locked
    element.setAttribute('aria-label', definition?.name ?? instance.widget)
  }

  const undoEverything = (): void => {
    for (const undo of cleanups.splice(0)) {
      try {
        undo()
      } catch {
        // Something a widget started that will not stop. The card is going away regardless.
      }
    }
  }

  /** Keeps a change the widget made to its own settings, a moment after the typing stops. */
  const keep = (settings: Record<string, string | number | boolean>): void => {
    if (options.preview) return
    pending = { ...(pending ?? {}), ...settings }
    clearTimeout(savedTimer)
    savedTimer = setTimeout(flush, 400) as unknown as number
  }

  const flush = (): void => {
    clearTimeout(savedTimer)
    savedTimer = 0
    const settings = pending
    pending = null
    if (!settings) return
    void options.link.act({ type: 'configure', id: instance.id, settings })
  }

  const state = (kind: 'loading' | 'empty' | 'needs' | 'failed', text: string, action?: { label: string; press: () => void }, iconName?: string): void => {
    clear(body)
    const block = h('div', { class: `wg-state wg-state-${kind}` })
    if (kind === 'loading') {
      block.append(h('div', { class: 'wg-skeleton wg-skeleton-wide' }), h('div', { class: 'wg-skeleton' }))
      block.setAttribute('aria-label', `${definition?.name ?? 'The widget'} is loading`)
    } else {
      if (iconName) block.append(h('div', { class: 'wg-state-mark' }, icon(iconName, 20)))
      block.append(h('p', { class: 'wg-state-words', text }))
      if (action) block.append(button(action.label, action.press, action.label, 'wg-btn'))
    }
    body.append(block)
  }

  const note = (text: string): void => {
    const already = body.querySelector('.wg-note')
    if (already) already.remove()
    if (text) body.append(h('p', { class: 'wg-note', text }))
  }

  const draw = (): void => {
    undoEverything()
    clearTimeout(savedTimer)
    savedTimer = 0
    failed = false
    dress()
    clear(body)

    if (!definition) {
      state('failed', 'Orbis no longer has this widget.', undefined, 'settings')
      failed = true
      return
    }
    const render = RENDERERS[definition.id]
    if (!render) {
      state('failed', `${definition.name} cannot be shown on the start page.`, undefined, 'settings')
      failed = true
      return
    }

    const still = options.preview ? true : prefersStill()
    const settings = Object.fromEntries(definition.settings.map((spec) => [spec.name, clampWidgetSetting(spec, instance.settings[spec.name])]))

    const ctx: WidgetContext = {
      body,
      instance,
      definition,
      size,
      settings,
      look: instance.look,
      preview: options.preview,
      still,
      hour12: options.hour12,
      now: () => (options.preview && !REAL_TIME.has(definition.id) ? SAMPLE_NOW : Date.now()),
      feed: (request, drawFeed, feedOptions) => watchFeed(request, drawFeed as (feed: WidgetFeed) => void, feedOptions as FeedOptions<WidgetSource> | undefined),
      run: async (command) => {
        if (options.preview) return { ok: false, message: 'This is a preview.' }
        return options.link.run(command)
      },
      save: keep,
      open: (url) => {
        if (options.preview) return
        try {
          const address = new URL(url)
          // A widget may send the tab to a web page and nowhere else: not to a file, not to one of Orbis's own pages.
          if (address.protocol === 'http:' || address.protocol === 'https:') location.assign(address.href)
        } catch {
          // Not an address at all. Nothing happens, which is better than going somewhere unintended.
        }
      },
      every: (ms, tick) => {
        const wait = Math.max(200, Math.floor(ms))
        let timer = 0
        const run = (): void => {
          if (document.hidden) return
          safely(tick)
        }
        const start = (): void => {
          clearInterval(timer)
          timer = setInterval(run, wait) as unknown as number
        }
        const wake = (): void => {
          if (document.hidden) return
          // A page that was hidden for an hour has an hour-old clock on it. One tick on the way back fixes that.
          run()
          start()
        }
        start()
        document.addEventListener('visibilitychange', wake)
        cleanups.push(() => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', wake)
        })
      },
      onCleanup: (undo) => cleanups.push(undo),
      show: {
        empty: (text, action) => state('empty', text, action, definition.icon),
        needs: (text, label = 'Open settings') => state('needs', text, options.onSettings ? { label, press: () => options.onSettings?.(instance) } : undefined, 'settings'),
        note
      }
    }

    safely(() => render(ctx))
  }

  /** Runs a widget's code where its failing cannot reach the rest of the page. */
  function safely(what: () => void): void {
    if (gone) return
    try {
      what()
    } catch (err) {
      failed = true
      console.error(`[widgets] ${instance.widget} stopped working`, err)
      undoEverything()
      state('failed', 'This widget stopped working.', { label: 'Try again', press: draw }, 'settings')
      options.onFailure?.(instance, err)
    }
  }

  /**
   * One source, drawn now and again whenever it changes.
   *
   * The reading, the waiting and every honest state in between live here, so a widget's own code never has to think
   * about them: it is handed something to draw, or the card is showing why it is not.
   */
  function watchFeed(request: WidgetFeedRequest, drawFeed: (feed: WidgetFeed) => void, feedOptions?: FeedOptions<WidgetSource>): void {
    let first = true
    let last = 0

    const read = async (fresh = false): Promise<void> => {
      if (gone) return
      if (first) state('loading', '')
      const feed = options.preview ? sampleFeed(request.source) : await options.link.feed({ ...request, ...(fresh ? { fresh: true } : {}) })
      if (gone) return
      first = false
      last = Date.now()
      if (!feed.value) {
        if (feed.needs) return ctxNeeds(feed)
        return state('failed', feed.error ?? 'That could not be read.', { label: 'Try again', press: () => void read(true) }, definition?.icon)
      }
      if (feedOptions?.empty?.(feed.value as never)) {
        return state('empty', feedOptions.emptyText ?? 'Nothing here yet.', feedOptions.emptyAction, definition?.icon)
      }
      clear(body)
      safely(() => drawFeed(feed))
      if (failed) return
      // What is on the card is this morning's; saying so is the difference between late and wrong.
      if (feed.status === 'cached') note(`Last read ${ago(feed.at, Date.now())}${navigator.onLine ? '' : ' — no connection'}.`)
    }

    const ctxNeeds = (feed: WidgetFeed): void =>
      state('needs', `${feed.needs}.`, options.onSettings ? { label: feed.needs ?? 'Open settings', press: () => options.onSettings?.(instance) } : undefined, 'settings')

    void read()
    if (options.preview) return

    const stop = options.link.onFeed((source) => {
      if (source === request.source) void read()
    })
    cleanups.push(stop)

    const everyMs = feedOptions?.everyMs ?? 0
    if (everyMs > 0) {
      const timer = setInterval(() => {
        if (!document.hidden) void read(true)
      }, Math.max(30_000, everyMs)) as unknown as number
      cleanups.push(() => clearInterval(timer))
    }

    const wake = (): void => {
      // Back after a while: ask again, because what is on the card was true when the page was last looked at.
      if (!document.hidden && Date.now() - last > 60_000) void read()
    }
    document.addEventListener('visibilitychange', wake)
    cleanups.push(() => document.removeEventListener('visibilitychange', wake))
  }

  draw()

  return {
    element,
    update: (next, nextSize) => {
      const wanted = nextSize ?? next.size
      const nothingChanged =
        next.widget === instance.widget &&
        wanted === size &&
        next.look.tone === instance.look.tone &&
        next.look.density === instance.look.density &&
        next.locked === instance.locked &&
        sameSettings(next.settings, instance.settings)
      instance = next
      size = wanted
      // Drawn again only when something it shows has changed: a redraw costs a half-typed note and a running timer.
      if (nothingChanged) return void dress()
      draw()
    },
    failed: () => failed,
    destroy: () => {
      gone = true
      flush()
      undoEverything()
      clear(body)
      element.remove()
    }
  }
}
