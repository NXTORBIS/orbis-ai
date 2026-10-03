import type { WidgetBoardState, WidgetCommand, WidgetCommandResult, WidgetEvent, WidgetFeed, WidgetFeedRequest, WidgetRendered, WidgetReply, WidgetRequest, WidgetSource } from '../../shared/widgetFeed.ts'

/**
 * What the two halves of the widget service promise each other and everything that calls them.
 *
 * `WidgetRuntimeApi` is the board: what is on the start page, and every change to it. `WidgetDataApi` is what the
 * widgets show and what pressing something on one does. The helper's channels and Orion's capabilities are written
 * against these two and nothing else, so there is one way to change the board and one way to read a source, whoever
 * is asking.
 *
 * Types only. No Electron here, and nothing that runs.
 */

export interface WidgetRuntimeApi {
  /** How things stand for the profile in use. */
  state(): Promise<WidgetBoardState>
  /** One request, applied, saved and read back. `by` says who asked, for the history of changes. */
  act(request: WidgetRequest, by?: 'page' | 'orion'): Promise<WidgetReply>
  /** Called with every change to the board, from whoever made it. Returns a way to stop. */
  onEvent(listener: (event: WidgetEvent) => void): () => void
  /** What an open start page last said it had drawn, or null when none has said anything lately. */
  rendered(): (WidgetRendered & { at: number }) | null
  /** An open start page reporting what it has drawn. */
  report(rendered: WidgetRendered): void
  /** Waits until an open start page reports this revision or a later one. False when none does in time. */
  waitForRender(revision: number, timeoutMs?: number): Promise<boolean>
}

export interface WidgetDataApi {
  /**
   * One source, for the profile in use. Never throws: a source that cannot be read answers with why.
   *
   * Typed by the source asked for, so what comes back is the shape that source has and nothing has to be guessed
   * at the other end.
   */
  feed<S extends WidgetSource>(request: WidgetFeedRequest & { source: S }): Promise<WidgetFeed<S>>
  /** One thing a widget asked to have done. */
  run(command: WidgetCommand): Promise<WidgetCommandResult>
  /** Called when a source has something new, so widgets showing it can ask again. Returns a way to stop. */
  onChange(listener: (source: WidgetSource) => void): () => void
}
