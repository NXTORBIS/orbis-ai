import {
  CATEGORY_NAMES,
  isAvailable,
  WIDGETS,
  type WidgetCategory,
  type WidgetDefinition,
  type WidgetInstance,
  type WidgetSize
} from '../../../src/shared/widgets.ts'
import {
  galleryState,
  packBoard,
  presetInstances,
  visibleWidgets,
  WIDGET_PRESETS,
  type GalleryFilter,
  type GalleryQuery,
  type WidgetBoard,
  type WidgetPreset
} from '../../../src/shared/widgetBoard.ts'
import { sizePixels } from './studioLogic.ts'

/**
 * The parts of the gallery that are sums and words rather than drawing.
 *
 * Which bands of the gallery have anything in them, how far a widget has to shrink to fit a tile, and the shape of
 * the little picture of the start page. All of it reads the one catalogue and the one board model, so what the
 * gallery lists and what the start page holds cannot drift apart: they are worked out from the same two files.
 *
 * Pure: no DOM, no clock, no storage.
 */

// ---------------------------------------------------------------- what the gallery is being asked for

export const GALLERY_FILTERS: readonly { id: GalleryFilter; label: string }[] = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'On your start page' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'offline', label: 'Works offline' }
])

const FILTER_IDS = new Set<string>(GALLERY_FILTERS.map((one) => one.id))

export const asFilter = (value: string | undefined): GalleryFilter => (value !== undefined && FILTER_IDS.has(value) ? (value as GalleryFilter) : 'all')

const CATEGORY_IDS = new Set<string>(Object.keys(CATEGORY_NAMES))

export const asCategory = (value: string | undefined): WidgetCategory | 'all' => (value !== undefined && CATEGORY_IDS.has(value) ? (value as WidgetCategory) : 'all')

/** What the person typed and chose, as the catalogue's search takes it. */
export const queryOf = (route: { query?: string; category?: string; filter?: string }): GalleryQuery => ({
  query: (route.query ?? '').trim(),
  category: asCategory(route.category),
  filter: asFilter(route.filter)
})

/**
 * Whether the person is looking for something in particular.
 *
 * Searching, or in a group, or filtered: then the gallery is one list of what matches, and the bands below are not
 * drawn at all. Everything untouched: the gallery is its bands.
 */
export const isBrowsing = (route: { query?: string; category?: string; filter?: string }): boolean => {
  const asked = queryOf(route)
  return (asked.query ?? '') !== '' || asked.category !== 'all' || asked.filter !== 'all'
}

// ---------------------------------------------------------------- what may be offered

export type Offer = { ok: true } | { ok: false; reason: string }

/** The ids this page can draw, however they were handed in. */
const holds = (drawable: ReadonlySet<string> | readonly string[], id: string): boolean =>
  drawable instanceof Set ? drawable.has(id) : (drawable as readonly string[]).includes(id)

/**
 * Whether a widget can be put on the start page, and if not, why in words.
 *
 * Two things have to be true and both are checked here: the catalogue has to allow it, and this page has to be able
 * to draw it. A widget nobody has written a drawing for is listed and explained rather than offered with a button
 * that would do nothing.
 */
export function offerWidget(definition: WidgetDefinition, drawable: ReadonlySet<string> | readonly string[]): Offer {
  if (definition.unavailable) return { ok: false, reason: definition.unavailable }
  if (!isAvailable(definition)) return { ok: false, reason: `${definition.name} cannot go on the start page yet.` }
  if (!holds(drawable, definition.id)) return { ok: false, reason: `The start page cannot draw ${definition.name} yet.` }
  return { ok: true }
}

/** The widgets that can be offered today, in the catalogue's own order. */
export const offeredWidgets = (drawable: ReadonlySet<string> | readonly string[]): WidgetDefinition[] => WIDGETS.filter((one) => offerWidget(one, drawable).ok)

// ---------------------------------------------------------------- the bands of the gallery

export type SectionId = 'board' | 'featured' | 'installed' | 'favourites' | 'recent' | 'presets' | 'layouts' | 'category' | 'missing'

export interface GallerySection {
  id: SectionId
  /** Tells one band from another, including one category band from the next. */
  key: string
  title: string
  /** A quiet line under the title, when there is something worth saying. */
  note?: string
  /** Catalogue ids drawn as tiles, in the order they should appear. */
  widgets: string[]
  /** Ready-made layouts, by id. Only the presets band has these. */
  presets?: string[]
  /** Layouts the person saved, by id. Only the saved-layouts band has these. */
  layouts?: string[]
  /** Widgets that cannot be added, each with its reason. Only the last band has these. */
  missing?: { widget: string; reason: string }[]
  /** Drawn larger than the rest. */
  hero?: boolean
}

export interface HomeInput {
  board: WidgetBoard
  /** Layouts the person saved by name, as Orbis reports them. */
  layouts: readonly { id: string; name: string; widgets: number }[]
  /** The ids this page has a drawing for. */
  drawable: ReadonlySet<string> | readonly string[]
}

const countWidgets = (n: number): string => (n === 1 ? '1 widget' : `${n} widgets`)

/**
 * The bands of the gallery's front page, in order, each only when it has something in it.
 *
 * "Recently used" leaves out whatever is on the start page right now, because the band above it is exactly those and
 * a gallery that shows the same four widgets three times over is a gallery nobody scrolls. Everything else is shown
 * as it is: a band with nothing in it is not drawn at all rather than drawn empty.
 */
export function homeSections(input: HomeInput): GallerySection[] {
  const { board, layouts, drawable } = input
  const can = new Set(offeredWidgets(drawable).map((one) => one.id))
  const sections: GallerySection[] = []

  const shown = visibleWidgets(board.instances)
  if (shown.length > 0) sections.push({ id: 'board', key: 'board', title: 'Your start page', note: `${countWidgets(shown.length)}, as they sit now.`, widgets: [] })

  const featured = WIDGETS.filter((one) => one.featured && can.has(one.id)).map((one) => one.id)
  if (featured.length > 0) sections.push({ id: 'featured', key: 'featured', title: 'Featured', note: 'Chosen by Orbis.', widgets: featured, hero: true })

  const onBoard: string[] = []
  for (const one of shown) if (can.has(one.widget) && !onBoard.includes(one.widget)) onBoard.push(one.widget)
  if (onBoard.length > 0) sections.push({ id: 'installed', key: 'installed', title: 'On your start page', widgets: onBoard })

  const favourites = board.favourites.filter((id) => can.has(id))
  if (favourites.length > 0) sections.push({ id: 'favourites', key: 'favourites', title: 'Favourites', widgets: favourites })

  const recent = board.recent.map((one) => one.widget).filter((id) => can.has(id) && !onBoard.includes(id))
  if (recent.length > 0) sections.push({ id: 'recent', key: 'recent', title: 'Recently used', note: 'Kept on this computer.', widgets: recent })

  const presets = WIDGET_PRESETS.filter((one) => presetOffered(one, can)).map((one) => one.id)
  if (presets.length > 0) sections.push({ id: 'presets', key: 'presets', title: 'Ready-made layouts', note: 'Each one sets out the whole start page.', widgets: [], presets })

  if (layouts.length > 0) sections.push({ id: 'layouts', key: 'layouts', title: 'Saved layouts', note: 'Layouts you kept by name.', widgets: [], layouts: layouts.map((one) => one.id) })

  for (const category of Object.keys(CATEGORY_NAMES) as WidgetCategory[]) {
    const widgets = WIDGETS.filter((one) => one.category === category && can.has(one.id)).map((one) => one.id)
    if (widgets.length > 0) sections.push({ id: 'category', key: `category:${category}`, title: CATEGORY_NAMES[category], widgets })
  }

  const missing = WIDGETS.map((one) => ({ one, offer: offerWidget(one, drawable) }))
    .filter((pair): pair is { one: WidgetDefinition; offer: { ok: false; reason: string } } => !pair.offer.ok)
    .map((pair) => ({ widget: pair.one.id, reason: pair.offer.reason }))
  if (missing.length > 0) sections.push({ id: 'missing', key: 'missing', title: 'Not available yet', note: 'These are in Orbis but cannot go on the start page.', widgets: [], missing })

  return sections
}

// ---------------------------------------------------------------- words

/** "Nothing found", "1 widget", "7 widgets" -- how many a search came to. */
export const foundWords = (count: number): string => (count === 0 ? 'Nothing found' : countWidgets(count))

export interface TileBadge {
  text: string
  /** `on` is on the start page, `net` needs the internet, `off` works without it. */
  tone: 'on' | 'net' | 'off'
}

/** The quiet lines under a tile: whether it is already on the start page, and whether it needs the internet. */
export function tileBadges(definition: WidgetDefinition, board: WidgetBoard): TileBadge[] {
  const badges: TileBadge[] = []
  const standing = galleryState(definition, board)
  if (standing.count > 0) badges.push({ text: standing.count === 1 ? 'On your start page' : `On your start page · ${standing.count}`, tone: 'on' })
  badges.push(definition.network ? { text: 'Needs the internet', tone: 'net' } : { text: 'Works offline', tone: 'off' })
  return badges
}

/**
 * What a ready-made layout would do to the start page, said before it is pressed.
 *
 * Applying one replaces everything on the page rather than adding to it -- that is what the board's `preset` action
 * does -- so the number that is about to go is said out loud, not discovered afterwards.
 */
export function presetNote(preset: WidgetPreset, board: WidgetBoard): string {
  const made = presetLayout(preset)
  const count = made ? made.length : preset.widgets.length
  const there = visibleWidgets(board.instances).length
  if (there === 0) return `Puts ${countWidgets(count)} on the start page.`
  return `Replaces the ${countWidgets(there)} on your start page with ${countWidgets(count)}.`
}

/** The widgets a ready-made layout would put on the page, or nothing when it cannot be made here. */
export function presetLayout(preset: WidgetPreset): WidgetInstance[] | null {
  let at = 0
  const made = presetInstances(preset, 0, () => `preset-${preset.id}-${at++}`)
  return 'error' in made ? null : made.instances
}

/**
 * Whether a ready-made layout can be offered: the board would take it, and this page can draw every widget in it.
 *
 * A layout with one widget this page cannot draw would be applied and then show a gap, so it is not offered at all.
 */
export const presetOffered = (preset: WidgetPreset, drawable: ReadonlySet<string> | readonly string[]): boolean =>
  presetLayout(preset) !== null && preset.widgets.every((one) => holds(drawable, one.widget))

// ---------------------------------------------------------------- a tile's preview

export interface TileFit {
  /** The widget's real size on the start page, in pixels. It is drawn at this size and then shrunk. */
  width: number
  height: number
  /** 1 when it fits as it is, less when it has to be shrunk, never more: a tile is not a magnifier. */
  scale: number
  /** What the shrunken drawing takes up, which is what the tile keeps room for. */
  boxWidth: number
  boxHeight: number
}

/** The smallest a widget is drawn in a tile. Below this it is a smudge rather than a preview. */
export const TILE_SMALLEST = 0.28

/**
 * How a widget is drawn into a tile of a given size.
 *
 * It is always drawn at its true pixel size and then shrunk as one picture, so a small widget in a tile is the same
 * drawing as on the start page and not a second, squashed layout. A wide widget is measured against the columns it
 * would really have, which is why the number of them is asked for.
 */
export function tileFit(size: WidgetSize, room: { width: number; height: number }, columns = 2): TileFit {
  const { width, height } = sizePixels(size, columns)
  const fits = (side: number, of: number): number => (Number.isFinite(side) && side > 0 ? side / of : 1)
  const raw = Math.min(1, fits(room.width, width), fits(room.height, height))
  const scale = Math.max(TILE_SMALLEST, Math.round(raw * 1000) / 1000)
  return { width, height, scale, boxWidth: Math.round(width * scale), boxHeight: Math.round(height * scale) }
}

// ---------------------------------------------------------------- the little picture of the start page

export interface MiniatureBlock {
  id: string
  widget: string
  /** Where the block sits in the picture, in pixels from its top left corner. */
  x: number
  y: number
  w: number
  h: number
}

export interface MiniatureShape {
  width: number
  height: number
  blocks: MiniatureBlock[]
  /** The side of one cell and the space between cells, in the picture's own pixels. */
  cell: number
  gap: number
  columns: number
  rows: number
  /** Widgets left out because the picture was cut off, so it can be said rather than hidden. */
  hidden: number
}

/** The space between cells as a share of a cell, taken from the start page's own grid so the shape is true. */
const GAP_SHARE = 14 / 156

export interface MiniatureAsk {
  /** How wide the picture may be, in pixels. */
  width: number
  /** How many columns the start page is being drawn with. */
  columns?: number
  /** The most rows to draw before cutting the picture off. */
  mostRows?: number
}

/**
 * The shape of the little picture of the start page: where every block goes, at the real proportions.
 *
 * The same `packBoard` the start page itself lays out with, so the picture cannot show an arrangement the page does
 * not have. Cells and the space between them keep their true ratio, so a widget that is twice as wide as it is tall
 * is twice as wide as it is tall here too.
 */
export function miniatureShape(instances: readonly WidgetInstance[], ask: MiniatureAsk): MiniatureShape {
  const columns = Math.max(1, Math.floor(ask.columns ?? 4))
  const mostRows = Math.max(1, Math.floor(ask.mostRows ?? 4))
  const width = Math.max(1, ask.width)
  // width = columns * cell + (columns - 1) * cell * GAP_SHARE, solved for one cell.
  const cell = width / (columns + (columns - 1) * GAP_SHARE)
  const gap = cell * GAP_SHARE
  const packed = packBoard(instances, columns)
  const kept = packed.placed.filter((one) => one.y + one.h <= mostRows)
  const byId = new Map(instances.map((one) => [one.id, one.widget]))
  const at = (n: number): number => n * (cell + gap)
  const blocks = kept.map((one) => ({
    id: one.id,
    widget: byId.get(one.id) ?? '',
    x: at(one.x),
    y: at(one.y),
    w: one.w * cell + (one.w - 1) * gap,
    h: one.h * cell + (one.h - 1) * gap
  }))
  const rows = Math.min(mostRows, packed.rows)
  return { width, height: Math.max(cell, rows * cell + Math.max(0, rows - 1) * gap), blocks, cell, gap, columns, rows, hidden: packed.placed.length - kept.length }
}

// ---------------------------------------------------------------- moving about with the keyboard

/**
 * Where an arrow key moves within a grid of tiles.
 *
 * It stays inside: the end of a row does not jump to the start of the next one, because a person pressing Right at
 * the edge means "further right", and being thrown down a line is how a grid loses somebody.
 */
export function nextTile(from: number, key: string, columns: number, count: number): number {
  if (count <= 0) return -1
  const cols = Math.max(1, Math.floor(columns))
  const at = Math.min(count - 1, Math.max(0, from))
  const to =
    key === 'ArrowRight' ? at + 1
      : key === 'ArrowLeft' ? at - 1
        : key === 'ArrowDown' ? at + cols
          : key === 'ArrowUp' ? at - cols
            : key === 'Home' ? 0
              : key === 'End' ? count - 1
                : at
  return Math.min(count - 1, Math.max(0, to))
}

// ---------------------------------------------------------------- the marks the gallery draws

/**
 * One small drawn mark for each widget and each group, as a single path on a 24 by 24 square.
 *
 * The browser's own icon set does not have a shape for every widget in the catalogue, and an icon it does not have
 * comes back as a plain circle -- a picture of the start page where half the blocks are circles says nothing. These
 * are drawn here instead, in the same weight as that set, so every block is marked by something that means it.
 */
export const MARKS: Readonly<Record<string, string>> = Object.freeze({
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7.5V12l3.2 2',
  hourglass: 'M7 3h10M7 21h10M7 3c0 4 5 5.5 5 9s-5 5-5 9M17 3c0 4-5 5.5-5 9s5 5 5 9',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 1 0 0 16M12 9.5V13h3M9.5 2.5h5M18.6 6.2l1.4-1.4',
  check: 'M6.5 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2M8.5 12l2.5 2.5 4.5-5',
  note: 'M6 3.5h8l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 6 3.5M14 3.5V8h4.5M8 13h8M8 17h5',
  bookmark: 'M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-3.8L5.5 21V4.5a1 1 0 0 1 1-1',
  download: 'M12 3.5v11m0 0-3.8-3.8M12 14.5l3.8-3.8M4.5 17v2.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V17',
  tabs: 'M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2M3.5 9.5h17M9 4.5v5',
  layers: 'M12 3.2 3.5 7.6 12 12l8.5-4.4zM3.5 12.4 12 16.8l8.5-4.4M3.5 16.9 12 21.3l8.5-4.4',
  clipboard: 'M9 3.5h6a1 1 0 0 1 1 1v1.6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1M16 5.3h2.5A1.5 1.5 0 0 1 20 6.8v12.7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5V6.8a1.5 1.5 0 0 1 1.5-1.5H8',
  board: 'M5 3.5h14A1.5 1.5 0 0 1 20.5 5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5M12 16.5v4M8.5 20.5h7M7.5 12l3-3.5 2.5 2.5 2.5-3.5',
  quote: 'M9.5 7.5h-4v5h4v2a2.5 2.5 0 0 1-2.5 2.5M19.5 7.5h-4v5h4v2a2.5 2.5 0 0 1-2.5 2.5',
  game: 'M7.5 7h9a5 5 0 0 1 5 5 4 4 0 0 1-7 2.8l-.8-.8h-4.4l-.8.8A4 4 0 0 1 2.5 12a5 5 0 0 1 5-5M8 10.5v3M6.5 12h3M15.2 11h.01M17.6 13h.01',
  calculator: 'M7 3h10a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 3M8.5 7h7M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h3',
  sun: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M3.2 10h17.6M3.2 14h17.6M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3',
  cloud: 'M7.6 19.5h9.7a4.2 4.2 0 0 0 .5-8.4A6 6 0 0 0 6.4 9.9a4.8 4.8 0 0 0 1.2 9.6',
  news: 'M5.5 4.5h10A1.5 1.5 0 0 1 17 6v13.5H6a2 2 0 0 1-2-2V6a1.5 1.5 0 0 1 1.5-1.5M17 8.5h2A1.5 1.5 0 0 1 20.5 10v7.5a2 2 0 0 1-2 2M7 8h7M7 11.5h7M7 15h4',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.9-6.4L3.5 8M3.5 3.5V8h4.5M12 7.5V12l3.2 2',
  sticky: 'M6 4h12a1.5 1.5 0 0 1 1.5 1.5V14L14 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4M19.5 14H15.5a1.5 1.5 0 0 0-1.5 1.5V20',
  bell: 'M6.5 9a5.5 5.5 0 1 1 11 0c0 6 2.5 8 2.5 8H4s2.5-2 2.5-8M10.2 21a2 2 0 0 0 3.6 0',
  chart: 'M4 19.5h16M6.8 16.5V11M11 16.5V7M15.2 16.5v-6M19.4 16.5V5',
  spark: 'M12 3.2l1.9 4.9 4.9 1.9-4.9 1.9-1.9 4.9-1.9-4.9L5.2 10l4.9-1.9zM18.4 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  // The groups in the rail down the side of the gallery.
  'group-all': 'M5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3A1.5 1.5 0 0 1 5.5 4M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3A1.5 1.5 0 0 1 18.5 10h-3A1.5 1.5 0 0 1 14 8.5v-3A1.5 1.5 0 0 1 15.5 4M5.5 14h3A1.5 1.5 0 0 1 10 15.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3A1.5 1.5 0 0 1 5.5 14M15.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3a1.5 1.5 0 0 1 1.5-1.5',
  'group-information': 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 11v5.5M12 7.6h.01',
  // The gallery's own furniture rather than a widget: the magnifying glass in the search box.
  'ui-search': 'M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14M20.2 20.2 16.4 16.4',
  'group-utility': 'M20.3 5.7a4.8 4.8 0 0 1-6.3 6.3l-7.4 7.4a2.3 2.3 0 0 1-3.2-3.2l7.4-7.4a4.8 4.8 0 0 1 6.3-6.3L14 5.6l1.2 3.2 3.2 1.2z',
  // Anything the catalogue names that is not drawn above: a plain card, which is still a block and not a circle.
  default: 'M6.5 4h11A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4'
})

/** The mark for a name, with a plain card for a name nothing was drawn for. */
export const markFor = (name: string): string => MARKS[name] ?? MARKS.default

/** The mark for one of the gallery's groups. Several groups share a widget's mark, because they mean the same thing. */
export function categoryMark(category: WidgetCategory | 'all'): string {
  const shared: Record<string, string> = { time: 'clock', productivity: 'check', browser: 'tabs', orion: 'spark' }
  return markFor(shared[category] ?? `group-${category}`)
}
