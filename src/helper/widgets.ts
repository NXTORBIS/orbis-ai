import type { Handler, HandlerContext } from './server.ts'
import { HelperError } from './server.ts'
import type { WidgetRuntimeApi, WidgetDataApi } from '../main/widgets/contract.ts'
import type { WidgetCommand, WidgetFeedRequest, WidgetRequest, WidgetSource } from '../shared/widgetFeed.ts'
import { WIDGET_COMMANDS, WIDGET_REQUESTS, WIDGET_SOURCES } from '../shared/widgetFeed.ts'

/**
 * The channels between the browser's start page and Orbis's widgets.
 *
 * The start page is a page in a different program from the one that keeps the widgets, so it asks over the helper,
 * exactly as every other Orbis page does. These are the only six things it can ask, and each is checked at the door:
 * a request whose type is not one Orbis has, a source that is not a source, a command that is not a command are all
 * refused in words here, before anything is read or changed.
 *
 * `widgets:watch` never answers. It sends how things stand, and then one event each time anything changes -- a
 * widget added in another window, a profile switched, a note written. That is what keeps an open start page right
 * without asking again every few seconds.
 */

export interface WidgetsDeps {
  runtime: WidgetRuntimeApi
  data: WidgetDataApi
}

/** What the page sent, as a request Orbis has -- or a refusal. Nothing half understood is passed on. */
const asRequest = (value: unknown): WidgetRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HelperError('invalid-params', 'Say what to do with the widgets.')
  const type = (value as { type?: unknown }).type
  if (typeof type !== 'string' || !WIDGET_REQUESTS.includes(type as WidgetRequest['type'])) {
    throw new HelperError('invalid-params', `Orbis cannot do "${String(type).slice(0, 40)}" to the widgets.`)
  }
  return value as WidgetRequest
}

const asFeedRequest = (value: unknown): WidgetFeedRequest => {
  const asked = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as { source?: unknown }
  if (typeof asked.source !== 'string' || !WIDGET_SOURCES.includes(asked.source as WidgetSource)) {
    throw new HelperError('invalid-params', `A widget cannot be shown "${String(asked.source).slice(0, 40)}".`)
  }
  return value as WidgetFeedRequest
}

const asCommand = (value: unknown): WidgetCommand => {
  const asked = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as { do?: unknown }
  if (typeof asked.do !== 'string' || !WIDGET_COMMANDS.includes(asked.do as WidgetCommand['do'])) {
    throw new HelperError('invalid-params', `A widget cannot ask for "${String(asked.do).slice(0, 40)}".`)
  }
  return value as WidgetCommand
}

export function createWidgetHandlers(widgets: () => WidgetsDeps | null | undefined): Record<string, Handler> {
  const need = (): WidgetsDeps => {
    // Read at call time: the start page is created with the browser window, which is earlier than Orbis itself.
    const ready = widgets()
    if (!ready) throw new HelperError('not-ready', 'Orbis is still starting. The widgets will be here in a moment.')
    return ready
  }

  return {
    'widgets:get': async () => need().runtime.state(),

    'widgets:act': async ([request]) => need().runtime.act(asRequest(request), 'page'),

    'widgets:data': async ([request]) => need().data.feed(asFeedRequest(request)),

    'widgets:do': async ([command]) => need().data.run(asCommand(command)),

    'widgets:rendered': async ([rendered]) => {
      if (!rendered || typeof rendered !== 'object') throw new HelperError('invalid-params', 'Say what the page has drawn.')
      need().runtime.report(rendered as never)
      return true
    },

    'widgets:watch': async (_args, context: HandlerContext) => {
      const { runtime, data } = need()
      context.emit({ type: 'state', state: await runtime.state() })
      const stopRuntime = runtime.onEvent((event) => context.emit(event))
      const stopData = data.onChange((source) => context.emit({ type: 'feed', source }))
      // Nothing is left listening for a page that has gone: a start page is closed every time a tab is.
      return new Promise<never>((_resolve, reject) => {
        const done = (): void => {
          stopRuntime()
          stopData()
          reject(new HelperError('stopped', 'The page stopped watching the widgets.'))
        }
        if (context.signal.aborted) return done()
        context.signal.addEventListener('abort', done, { once: true })
      })
    }
  }
}
