import type { WidgetDefinition, WidgetInstance, WidgetLook, WidgetSize } from '../../../src/shared/widgets.ts'
import type { WidgetBoardState, WidgetCommand, WidgetCommandResult, WidgetFeed, WidgetFeedRequest, WidgetRendered, WidgetReply, WidgetRequest, WidgetSource } from '../../../src/shared/widgetFeed.ts'

/**
 * What the pieces of the start page's widgets promise each other.
 *
 * There is one way a widget is drawn, and it is used everywhere a widget appears: on the start page, in the gallery's
 * tiles, in the large preview and in the studio. A renderer is handed a `WidgetContext` and draws into `ctx.body`. It
 * does not know whether it is live or a preview -- it asks `ctx.feed` for what to show and is handed either the
 * person's own or the sample, and that is the whole difference. So a preview cannot drift from the real thing: it is
 * the real thing.
 *
 * ## What a renderer must do
 *
 * - Build its nodes with `h()` and `svg()` from `dom.ts`. Never `innerHTML`: these pages forbid it and it throws.
 * - Draw for the size it is given (`ctx.size`), and look right at every size its definition lists.
 * - Start nothing that outlives it. Timers go through `ctx.every`, anything else through `ctx.onCleanup`.
 * - Say nothing it was not given. No invented numbers, no placeholder text standing in for an answer.
 * - Leave loading, empty and failed states to `ctx.feed` and `ctx.show`, which draw them the same way on every card.
 *
 * Types only.
 */

export interface WidgetContext {
  /** Where to draw. Empty when the renderer is called; the renderer owns everything inside it. */
  body: HTMLElement
  instance: WidgetInstance
  definition: WidgetDefinition
  size: WidgetSize
  /** The instance's settings, already brought within what the widget takes. */
  settings: Readonly<Record<string, string | number | boolean>>
  look: WidgetLook
  /** Drawn in the gallery or the studio from sample data. Nothing pressed in a preview does anything. */
  preview: boolean
  /** The person asked for less movement: no looping or sweeping animation. */
  still: boolean
  /** The start page's clock setting. */
  hour12: boolean
  /** The time. In a preview of anything but a clock this is a fixed moment, so the preview looks the same each time. */
  now(): number

  /**
   * Asks for a source and draws it, now and whenever it changes.
   *
   * While it is being read the card shows that it is loading. When it has nothing the card says so, with `empty`
   * (and what the person can do about it). When it cannot be read the card says why, with a way to try again.
   * `draw` is only ever called with something to show -- `feed.value` is never null there -- and is told through
   * `feed.status` when what it is showing is the last good answer rather than a new one.
   */
  feed<S extends WidgetSource>(request: WidgetFeedRequest & { source: S }, draw: (feed: WidgetFeed<S> & { value: NonNullable<WidgetFeed<S>['value']> }) => void, options?: FeedOptions<S>): void

  /** Does one thing. In a preview it does nothing and says so. */
  run(command: WidgetCommand): Promise<WidgetCommandResult>
  /** Keeps a change to this widget's own settings: the words in a sticky note, a timer's length. Not undoable noise: saved quietly. */
  save(settings: Record<string, string | number | boolean>): void
  /** Opens a web address in this tab. Only http and https are opened; anything else is ignored. */
  open(url: string): void

  /** Calls `tick` every `ms` until the widget goes away. Not called while the page is hidden; called once on return. */
  every(ms: number, tick: () => void): void
  /** Something to undo when the widget goes away or is drawn again. */
  onCleanup(undo: () => void): void

  /** The card's own states, for a widget that reads no source but still has nothing to show. */
  show: {
    /** "Nothing here yet", with an optional thing to press. Replaces whatever is in the body. */
    empty(text: string, action?: { label: string; press: () => void }): void
    /** Something the person has to choose first: "Choose a city". Pressing opens this widget's settings. */
    needs(text: string, label?: string): void
    /** A small line under the content: "Updated 10 minutes ago", "No connection -- showing the last answer". */
    note(text: string): void
  }
}

export interface FeedOptions<S extends WidgetSource> {
  /** Whether what came back counts as nothing to show, and what to say when it does. */
  empty?: (value: NonNullable<WidgetFeed<S>['value']>) => boolean
  emptyText?: string
  emptyAction?: { label: string; press: () => void }
  /** Ask again this often, on top of asking when the source says it changed. 0 or absent: only when it changes. */
  everyMs?: number
}

export type WidgetRenderer = (ctx: WidgetContext) => void

/** Every widget that can be drawn, by its id in the catalogue. A catalogue entry with no renderer is not offered. */
export type RendererTable = Readonly<Record<string, WidgetRenderer>>

// ---------------------------------------------------------------- the link to Orbis

/**
 * The page's one connection to Orbis.
 *
 * Everything the board, the gallery and the studio know comes through here, so there is one copy of how things stand
 * and every part of the page sees the same one.
 */
export interface WidgetLink {
  /** How things stand, or null until Orbis has answered. */
  state(): WidgetBoardState | null
  /** Whether Orbis is answering. When it is not, the page says so plainly instead of showing an empty board. */
  connected(): boolean
  /** Called now, and then with every change. Returns a way to stop. */
  subscribe(listener: (state: WidgetBoardState | null, connected: boolean) => void): () => void
  /** Asks for a change. The answer says what happened in words; a refusal says why. Never throws. */
  act(request: WidgetRequest): Promise<WidgetReply>
  /** One source. Never throws. */
  feed(request: WidgetFeedRequest): Promise<WidgetFeed>
  /** Called when a source has something new. Returns a way to stop. */
  onFeed(listener: (source: WidgetSource) => void): () => void
  run(command: WidgetCommand): Promise<WidgetCommandResult>
  /** Tells Orbis what this page has actually drawn, which is how Orion checks its own work. Sent quietly; never throws. */
  report(rendered: WidgetRendered): void
}

// ---------------------------------------------------------------- one card

export interface CardOptions {
  instance: WidgetInstance
  /** A size to draw at instead of the instance's own, for the gallery's size picker. */
  size?: WidgetSize
  preview: boolean
  link: WidgetLink
  hour12: boolean
  /** Asked for when the widget needs its settings opened ("Choose a city"). Absent in a preview. */
  onSettings?: (instance: WidgetInstance) => void
  /** Called when drawing the widget threw, with the instance and what was thrown. */
  onFailure?: (instance: WidgetInstance, error: unknown) => void
}

/**
 * One drawn widget: the card and what is in it.
 *
 * Made by `createCard` in `card.ts`. The card is the frame every widget shares -- its surface, its states, its
 * failure message -- and holds one renderer's output inside. A widget that throws takes down its own card's content
 * and nothing else: the card shows that it failed and offers to try again.
 */
export interface WidgetCard {
  /** The card's element: `<article class="wg-card" data-widget data-size data-tone data-density>`. */
  element: HTMLElement
  /** Draws it again from a changed instance, keeping the element. Cheap when nothing that matters changed. */
  update(instance: WidgetInstance, size?: WidgetSize): void
  /** Whether the last draw failed. */
  failed(): boolean
  /** Stops everything the widget started and empties the card. */
  destroy(): void
}

// ---------------------------------------------------------------- the parts of the page

/** The start page's board: the grid of cards under the search box, and arranging them. */
export interface BoardView {
  /** Turns arranging on or off: dragging, resizing, and each card's controls. */
  arrange(on: boolean): void
  arranging(): boolean
  /** Opens one widget's settings in the studio. */
  destroy(): void
}

/** What the gallery can be asked to show. Kept in the page's address after `#`, so Back and a reload both work. */
export type GalleryRoute =
  | { view: 'closed' }
  | { view: 'home'; query?: string; category?: string; filter?: string }
  /** One widget from the catalogue: its large preview, its sizes, and adding it. */
  | { view: 'widget'; widget: string }
  /** One widget that is on the start page: its settings and its look, with a live preview. */
  | { view: 'instance'; id: string }

export interface GalleryView {
  show(route: GalleryRoute): void
  route(): GalleryRoute
  destroy(): void
}

export type { WidgetDefinition, WidgetInstance, WidgetLook, WidgetSize }

// ---------------------------------------------------------------- who makes what
//
// One file each, so the parts can be built apart and still fit:
//
//   link.ts      export function createLink(): WidgetLink
//   card.ts      export function createCard(options: CardOptions): WidgetCard
//   board.ts     export function mountBoard(host: HTMLElement, deps: PageDeps): BoardView
//   gallery.ts   export function mountGallery(host: HTMLElement, deps: PageDeps): GalleryView
//   detail.ts    export function showWidgetDetail(host: HTMLElement, widget: string, deps: PageDeps): () => void
//   studio.ts    export function showStudio(host: HTMLElement, instanceId: string, deps: PageDeps): () => void
//   renderers/index.ts   export const RENDERERS: RendererTable
//   main.ts      export function mountWidgets(options): void   -- what newtab.js calls
//
// `showWidgetDetail` and `showStudio` draw into the host they are given and return a way to take it all away again.

/** What every part of the page is handed. */
export interface PageDeps {
  link: WidgetLink
  /** The start page's 12-hour clock setting, read each time it is needed. */
  hour12(): boolean
  /** Goes to a place in the gallery, or closes it. Changes the page's address, so Back undoes it. */
  go(route: GalleryRoute): void
  /** Turns arranging the start page on or off. Turning it on closes the gallery. */
  arrange(on: boolean): void
  /** Says something briefly at the bottom of the page: "Weather added", or why something could not be done. */
  say(text: string, action?: { label: string; press: () => void }): void
}
