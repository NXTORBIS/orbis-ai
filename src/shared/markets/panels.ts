import { PANELS, type Panel } from './experience.ts'

/**
 * Arranging Markets into panels.
 *
 * A layout is a tree of splits with panels at the leaves. Stored as a tree rather than a list of rectangles because a
 * tree is what resizing preserves: dragging a divider changes one node's ratio and everything inside it reflows, whereas
 * a list of pixel rectangles has to be recomputed from scratch and drifts every time a window changes size.
 *
 * Two things this file refuses to produce.
 *
 * **A layout with a panel that does not exist.** Every leaf is checked against the real panel registry. A saved layout
 * naming a panel that has since gone loses that leaf and keeps the rest, rather than rendering an empty box with a
 * confident title.
 *
 * **A layout that cannot be used.** Ratios are clamped so no pane can be squeezed to nothing, empty splits collapse into
 * their remaining child, and a tree that ends up with no panels at all is refused in favour of the default — because a
 * blank workspace somebody cannot get out of is worse than one they did not choose.
 */

export type Direction = 'row' | 'column'

/** A leaf: one panel, possibly pinned to its own market. */
export interface PanelNode {
  type: 'panel'
  id: string
  panel: Panel
  /**
   * The market this panel shows, or empty to follow the workspace.
   *
   * Following is the default, which is what makes clicking a watchlist row change the chart, the book and the tape at
   * once. Pinning is how somebody keeps one chart on bitcoin while the rest of the screen moves.
   */
  instrumentId: string
  /** Panel-specific state — a timeframe, a filter. Opaque here; each panel reads its own. */
  state?: Record<string, string | number | boolean>
}

/** A branch: several children sharing a direction. */
export interface SplitNode {
  type: 'split'
  id: string
  direction: Direction
  /** How the space divides. Always the same length as `children`, and always sums to 1. */
  ratios: number[]
  children: LayoutNode[]
}

export type LayoutNode = PanelNode | SplitNode

export interface Layout {
  version: 1
  root: LayoutNode
  /** The market panels follow unless pinned. */
  instrumentId: string
}

/** The least of the space any one pane may have. Below this it cannot be read or grabbed to resize. */
export const MIN_RATIO = 0.08

let counter = 0
/** Ids are only ever compared to each other, so a counter is enough and keeps layouts reproducible in tests. */
const nextId = (): string => `n${(counter += 1)}`

export const panelNode = (panel: Panel, instrumentId = ''): PanelNode => ({
  type: 'panel',
  id: nextId(),
  panel,
  instrumentId
})

/** Ratios that sum to one and give nothing less than the minimum. */
export function normaliseRatios(ratios: number[], count: number): number[] {
  if (count <= 0) return []
  const usable = ratios.length === count ? ratios.map((one) => (Number.isFinite(one) && one > 0 ? one : 0)) : []
  const total = usable.reduce((sum, one) => sum + one, 0)
  // Nothing usable: an even split, which is the only fair thing to do with no information.
  const even = Array.from({ length: count }, () => 1 / count)
  if (usable.length !== count || total <= 0) return even

  // More panes than the minimum allows: an even split is the only layout where all of them are usable.
  if (MIN_RATIO * count > 1) return even

  /*
   * The minimum first, then the rest in proportion.
   *
   * Clamping and rescaling looks equivalent and is not: dividing by the new total pushes the clamped pane straight back
   * under the minimum it was just raised to. Allocating the floor up front and sharing only what is left guarantees both
   * properties at once -- nothing below the minimum, and a total of exactly one.
   */
  const remainder = 1 - MIN_RATIO * count
  const scaled = usable.map((one) => one / total)
  return scaled.map((one) => MIN_RATIO + one * remainder)
}

export const splitNode = (direction: Direction, children: LayoutNode[], ratios?: number[]): SplitNode => ({
  type: 'split',
  id: nextId(),
  direction,
  ratios: normaliseRatios(ratios ?? [], children.length),
  children
})

// ---------------------------------------------------------------- walking the tree

/** Every panel leaf, in reading order. */
export function panelsIn(node: LayoutNode): PanelNode[] {
  if (node.type === 'panel') return [node]
  return node.children.flatMap((child) => panelsIn(child))
}

/** One node by id, anywhere in the tree. */
export function findNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node
  if (node.type === 'panel') return null
  for (const child of node.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

/** The tree with one node replaced, or removed when the replacement is null. Structure-sharing, so React sees the change. */
export function replaceNode(node: LayoutNode, id: string, replacement: LayoutNode | null): LayoutNode | null {
  if (node.id === id) return replacement
  if (node.type === 'panel') return node
  const children: LayoutNode[] = []
  const ratios: number[] = []
  node.children.forEach((child, i) => {
    const next = replaceNode(child, id, replacement)
    if (next === null) return
    children.push(next)
    ratios.push(node.ratios[i] ?? 1 / node.children.length)
  })
  if (children.length === 0) return null
  // A split with one child is not a split. Collapsed, or every removal would leave a layer of empty nesting behind.
  if (children.length === 1) return children[0]
  return { ...node, children, ratios: normaliseRatios(ratios, children.length) }
}

/**
 * Splits one panel in two.
 *
 * The existing panel keeps its place and the new one joins it, which is what makes "split right" feel like splitting
 * rather than replacing.
 */
export function splitPanel(layout: Layout, panelId: string, direction: Direction, panel: Panel): Layout {
  const target = findNode(layout.root, panelId)
  if (!target || target.type !== 'panel') return layout
  const replacement = splitNode(direction, [target, panelNode(panel, target.instrumentId)])
  const root = replaceNode(layout.root, panelId, replacement)
  return root ? { ...layout, root } : layout
}

/** Removes one panel. The last one is kept, because a workspace with nothing in it cannot be worked out of. */
export function removePanel(layout: Layout, panelId: string): Layout {
  if (panelsIn(layout.root).length <= 1) return layout
  const root = replaceNode(layout.root, panelId, null)
  return root ? { ...layout, root } : layout
}

/** Changes what one panel shows. */
export function setPanelMarket(layout: Layout, panelId: string, instrumentId: string): Layout {
  const node = findNode(layout.root, panelId)
  if (!node || node.type !== 'panel') return layout
  const root = replaceNode(layout.root, panelId, { ...node, instrumentId })
  return root ? { ...layout, root } : layout
}

/** Swaps one panel for another kind, keeping its place and its market. */
export function setPanelKind(layout: Layout, panelId: string, panel: Panel): Layout {
  const node = findNode(layout.root, panelId)
  if (!node || node.type !== 'panel') return layout
  // State belongs to the kind that was there, so it goes with it.
  const root = replaceNode(layout.root, panelId, { ...node, panel, state: undefined })
  return root ? { ...layout, root } : layout
}

/** Drags a divider. The ratios are renormalised, so no pane is squeezed to nothing. */
export function resizeSplit(layout: Layout, splitId: string, ratios: number[]): Layout {
  const node = findNode(layout.root, splitId)
  if (!node || node.type !== 'split') return layout
  const root = replaceNode(layout.root, splitId, {
    ...node,
    ratios: normaliseRatios(ratios, node.children.length)
  })
  return root ? { ...layout, root } : layout
}

/** What a panel actually shows: its own market when pinned, the workspace's otherwise. */
export const marketFor = (node: PanelNode, layout: Layout): string => node.instrumentId || layout.instrumentId

// ---------------------------------------------------------------- reading one back

const PANEL_NAMES = new Set<string>(PANELS)

/**
 * A node read from a file.
 *
 * Null when it cannot be rendered. A leaf naming a panel that no longer exists is dropped and the rest of the layout
 * survives — which is what a layout saved by an older Orbis should do, rather than failing whole.
 */
function cleanNode(raw: unknown, depth = 0): LayoutNode | null {
  if (!raw || typeof raw !== 'object') return null
  // A tree deep enough to be a problem is a tree nobody built by hand.
  if (depth > 8) return null
  const o = raw as Record<string, unknown>

  if (o.type === 'panel') {
    const panel = typeof o.panel === 'string' && PANEL_NAMES.has(o.panel) ? (o.panel as Panel) : null
    if (!panel) return null
    const state: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries((o.state ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'string') state[key.slice(0, 32)] = value.slice(0, 80)
      else if (typeof value === 'number' && Number.isFinite(value)) state[key.slice(0, 32)] = value
      else if (typeof value === 'boolean') state[key.slice(0, 32)] = value
    }
    return {
      type: 'panel',
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : nextId(),
      panel,
      instrumentId: typeof o.instrumentId === 'string' ? o.instrumentId.slice(0, 200) : '',
      state: Object.keys(state).length > 0 ? state : undefined
    }
  }

  if (o.type === 'split') {
    const children = (Array.isArray(o.children) ? o.children : [])
      .map((child) => cleanNode(child, depth + 1))
      .filter((child): child is LayoutNode => child !== null)
    if (children.length === 0) return null
    if (children.length === 1) return children[0]
    return {
      type: 'split',
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : nextId(),
      direction: o.direction === 'column' ? 'column' : 'row',
      ratios: normaliseRatios(Array.isArray(o.ratios) ? (o.ratios as number[]) : [], children.length),
      children
    }
  }
  return null
}

/** A sensible starting layout: a watchlist beside a chart, with the tape under it. */
export function defaultLayout(instrumentId = ''): Layout {
  return {
    version: 1,
    instrumentId,
    root: splitNode(
      'row',
      [panelNode('watchlist'), splitNode('column', [panelNode('chart'), panelNode('trades')], [0.7, 0.3])],
      [0.3, 0.7]
    )
  }
}

/** A layout read from a file. Falls back to the default rather than leaving somebody with a blank workspace. */
export function cleanLayout(raw: unknown): Layout {
  if (!raw || typeof raw !== 'object') return defaultLayout()
  const o = raw as Record<string, unknown>
  const root = cleanNode(o.root)
  // No panels survived, so there is nothing to show and no way to add one. The default is the only usable answer.
  if (!root || panelsIn(root).length === 0) return defaultLayout(typeof o.instrumentId === 'string' ? o.instrumentId : '')
  return {
    version: 1,
    root,
    instrumentId: typeof o.instrumentId === 'string' ? o.instrumentId.slice(0, 200) : ''
  }
}

/** Layouts worth offering, each one a real arrangement of panels that exist. */
export const LAYOUT_PRESETS: { id: string; name: string; describe: string; build(instrumentId?: string): Layout }[] = [
  {
    id: 'overview',
    name: 'Overview',
    describe: 'A watchlist beside a chart, with recent trades underneath.',
    build: (instrumentId = '') => defaultLayout(instrumentId)
  },
  {
    id: 'analysis',
    name: 'Technical analysis',
    describe: 'A large chart with the watchlist and the screener beside it.',
    build: (instrumentId = '') => ({
      version: 1,
      instrumentId,
      root: splitNode(
        'row',
        [splitNode('column', [panelNode('watchlist'), panelNode('screener')], [0.5, 0.5]), panelNode('chart')],
        [0.28, 0.72]
      )
    })
  },
  {
    id: 'microstructure',
    name: 'Order flow',
    describe: 'The book and the tape beside a chart.',
    build: (instrumentId = '') => ({
      version: 1,
      instrumentId,
      root: splitNode(
        'row',
        [panelNode('chart'), splitNode('column', [panelNode('book'), panelNode('trades')], [0.55, 0.45])],
        [0.6, 0.4]
      )
    })
  },
  {
    id: 'monitor',
    name: 'Market monitor',
    describe: 'Movers, breadth, the watchlist and news, with no single chart dominating.',
    build: (instrumentId = '') => ({
      version: 1,
      instrumentId,
      root: splitNode(
        'column',
        [
          splitNode('row', [panelNode('movers'), panelNode('breadth')], [0.5, 0.5]),
          splitNode('row', [panelNode('watchlist'), panelNode('news')], [0.5, 0.5])
        ],
        [0.5, 0.5]
      )
    })
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    describe: 'The simulated portfolio with alerts and a chart.',
    build: (instrumentId = '') => ({
      version: 1,
      instrumentId,
      root: splitNode(
        'row',
        [panelNode('portfolio'), splitNode('column', [panelNode('chart'), panelNode('alerts')], [0.6, 0.4])],
        [0.5, 0.5]
      )
    })
  }
]
