import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Columns2,
  LayoutGrid,
  Pin,
  PinOff,
  RotateCcw,
  Rows2,
  X
} from 'lucide-react'
import {
  MIN_RATIO,
  marketFor,
  normaliseRatios,
  removePanel,
  resizeSplit,
  setPanelKind,
  setPanelMarket,
  splitPanel,
  type Direction,
  type Layout,
  type LayoutNode,
  type PanelNode
} from '../../../../shared/markets/panels'
import { PANELS, type Panel } from '../../../../shared/markets/experience'
import type { NoticeKind } from '../../App'

/**
 * The workspace: several panels at once, arranged however somebody wants them.
 *
 * The tree is the engine's; this renders it and hands every change straight back. Nothing here decides what a valid
 * layout is — `splitPanel`, `removePanel` and `resizeSplit` do, and they are tested. A second opinion about ratios
 * living in the renderer is how a workspace ends up with a pane 2% wide that cannot be grabbed to fix.
 *
 * ## Following, and pinning
 *
 * A panel follows the workspace's market by default, which is what makes clicking a watchlist row change the chart, the
 * book and the tape together. Pinning one holds it on a market while the rest moves — the thing somebody wants when
 * they are watching bitcoin and looking at something else.
 *
 * ## Resizing
 *
 * Dragging a divider writes through `resizeSplit`, which allocates the minimum to every pane first and shares only what
 * is left. Clamping and then rescaling — the obvious way — pushes the clamped pane straight back under its minimum.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

const PANEL_LABEL: Record<Panel, string> = {
  overview: 'Overview',
  movers: 'Movers',
  heatmap: 'Heatmap',
  breadth: 'Breadth',
  watchlist: 'Watchlist',
  chart: 'Chart',
  book: 'Order book',
  trades: 'Trades',
  news: 'News',
  screener: 'Screener',
  alerts: 'Alerts',
  portfolio: 'Portfolio',
  learn: 'Learn'
}

export interface PanelWorkspaceProps {
  /** The market the workspace follows. Panels use it unless they are pinned to their own. */
  instrumentId: string
  /** What to draw inside one pane. The workspace owns the frame; the caller owns the contents. */
  render(panel: Panel, instrumentId: string, node: PanelNode): React.ReactNode
  /** A short label for a market id, for the pin menu. */
  symbolOf(instrumentId: string): string
  /** Markets worth offering to pin to: the watchlist, the recents. */
  pinnable: { instrumentId: string; symbol: string }[]
  onNotify(message: string, kind?: NoticeKind): void
}

export default function PanelWorkspace({
  instrumentId,
  render,
  symbolOf,
  pinnable,
  onNotify
}: PanelWorkspaceProps): React.JSX.Element {
  const [layout, setLayout] = useState<Layout | null>(null)
  const [presets, setPresets] = useState<{ id: string; name: string; describe: string }[]>([])
  const [menu, setMenu] = useState<string | null>(null)
  /** The divider being dragged: which split, which gap, and where the pointer started. */
  const dragging = useRef<{ splitId: string; index: number; startX: number; startY: number; ratios: number[]; size: number } | null>(null)

  useEffect(() => {
    void window.api.marketsPanels().then((result) => {
      if (refused(result)) return
      setLayout(result.layout)
      setPresets(result.presets)
    })
  }, [])

  /**
   * A layout saved.
   *
   * Written through to the main process on every change rather than on a timer, because a workspace somebody arranged
   * and then closed without it being saved is the kind of loss that is not worth the saved writes.
   */
  const commit = useCallback(
    (next: Layout) => {
      setLayout(next)
      void window.api.marketsSetPanels(next).then((result) => {
        if (refused(result)) onNotify(result.message ?? 'The layout could not be saved', 'error')
      })
    },
    [onNotify]
  )

  // The workspace's own market follows the screen's, so opening something from a watchlist moves every unpinned panel.
  useEffect(() => {
    if (!layout || layout.instrumentId === instrumentId || instrumentId === '') return
    commit({ ...layout, instrumentId })
  }, [instrumentId, layout, commit])

  // ---------------------------------------------------------------- resizing

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const drag = dragging.current
      if (!drag || !layout) return
      // `startY` of -1 was set for a horizontal split, so one handler covers both directions without a second branch.
      const travelled = drag.startY === -1 ? event.clientX - drag.startX : event.clientY - drag.startY
      const moved = drag.size === 0 ? 0 : travelled / drag.size
      const next = [...drag.ratios]
      // Only the two panes either side of this divider move. Dragging one gap must not disturb the rest of the row.
      next[drag.index] = drag.ratios[drag.index] + moved
      next[drag.index + 1] = drag.ratios[drag.index + 1] - moved
      if (next[drag.index] < MIN_RATIO || next[drag.index + 1] < MIN_RATIO) return
      setLayout((current) => (current ? resizeSplit(current, drag.splitId, next) : current))
    }
    const onUp = (): void => {
      if (dragging.current && layout) {
        dragging.current = null
        // Saved once at the end, not on every pixel of the drag.
        void window.api.marketsSetPanels(layout)
      }
      dragging.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [layout])

  if (!layout) return <p className="mk-quiet">Loading the workspace…</p>

  const panelCount = (node: LayoutNode): number =>
    node.type === 'panel' ? 1 : node.children.reduce((total, one) => total + panelCount(one), 0)
  const total = panelCount(layout.root)

  // ---------------------------------------------------------------- the tree

  const drawNode = (node: LayoutNode): React.ReactNode => {
    if (node.type === 'panel') return drawPanel(node)

    const ratios = normaliseRatios(node.ratios, node.children.length)
    return (
      <div key={node.id} className={`mk-ws-split is-${node.direction}`}>
        {node.children.map((child, i) => (
          <div
            key={child.id}
            className="mk-ws-pane"
            style={{ flexBasis: `${ratios[i] * 100}%`, flexGrow: 0, flexShrink: 0 }}
          >
            {drawNode(child)}
            {i < node.children.length - 1 && (
              <div
                className={`mk-ws-divider is-${node.direction}`}
                role="separator"
                aria-orientation={node.direction === 'row' ? 'vertical' : 'horizontal'}
                aria-label="Resize"
                tabIndex={0}
                onPointerDown={(event) => {
                  const box = event.currentTarget.closest('.mk-ws-split')?.getBoundingClientRect()
                  if (!box) return
                  dragging.current = {
                    splitId: node.id,
                    index: i,
                    // startY of -1 marks a horizontal drag, so one handler serves both directions.
                    startX: event.clientX,
                    startY: node.direction === 'row' ? -1 : event.clientY,
                    ratios,
                    size: node.direction === 'row' ? box.width : box.height
                  }
                }}
                onKeyDown={(event) => {
                  // Resizable from the keyboard too: a divider that only a mouse can move is a divider some people
                  // cannot use at all.
                  const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -0.02 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 0.02 : 0
                  if (step === 0) return
                  event.preventDefault()
                  const next = [...ratios]
                  next[i] += step
                  next[i + 1] -= step
                  if (next[i] < MIN_RATIO || next[i + 1] < MIN_RATIO) return
                  commit(resizeSplit(layout, node.id, next))
                }}
              />
            )}
          </div>
        ))}
      </div>
    )
  }

  const drawPanel = (node: PanelNode): React.ReactNode => {
    const market = marketFor(node, layout)
    const pinned = node.instrumentId !== ''
    return (
      <section key={node.id} className="mk-ws-panel" aria-label={PANEL_LABEL[node.panel]}>
        <header className="mk-ws-head">
          <select
            value={node.panel}
            aria-label="What this panel shows"
            onChange={(event) => commit(setPanelKind(layout, node.id, event.target.value as Panel))}
          >
            {PANELS.map((one) => (
              <option key={one} value={one}>
                {PANEL_LABEL[one]}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`mk-ws-pin${pinned ? ' on' : ''}`}
            onClick={() => setMenu(menu === node.id ? null : node.id)}
            title={
              pinned
                ? `Pinned to ${symbolOf(market)} — it will not follow the rest of the screen`
                : 'Following the screen. Pin it to hold one market.'
            }
            aria-expanded={menu === node.id}
          >
            {pinned ? <Pin size={12} /> : <PinOff size={12} />}
            <span>{pinned ? symbolOf(market) : 'following'}</span>
          </button>

          {menu === node.id && (
            <div className="mk-ws-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className={pinned ? '' : 'on'}
                onClick={() => {
                  commit(setPanelMarket(layout, node.id, ''))
                  setMenu(null)
                }}
              >
                Follow the screen
              </button>
              {pinnable.slice(0, 12).map((one) => (
                <button
                  key={one.instrumentId}
                  type="button"
                  role="menuitem"
                  className={node.instrumentId === one.instrumentId ? 'on' : ''}
                  onClick={() => {
                    commit(setPanelMarket(layout, node.id, one.instrumentId))
                    setMenu(null)
                  }}
                >
                  Pin to {one.symbol}
                </button>
              ))}
            </div>
          )}

          <span className="mk-ws-spacer" />

          <button
            type="button"
            className="tl-icon"
            title="Split this panel side by side"
            aria-label="Split side by side"
            onClick={() => commit(splitPanel(layout, node.id, 'row' as Direction, node.panel))}
          >
            <Columns2 size={12} />
          </button>
          <button
            type="button"
            className="tl-icon"
            title="Split this panel top and bottom"
            aria-label="Split top and bottom"
            onClick={() => commit(splitPanel(layout, node.id, 'column' as Direction, node.panel))}
          >
            <Rows2 size={12} />
          </button>
          <button
            type="button"
            className="tl-icon mk-danger"
            // The last panel cannot be closed: a workspace with nothing in it has no way to get a panel back.
            disabled={total <= 1}
            title={total <= 1 ? 'The last panel cannot be closed' : 'Close this panel'}
            aria-label="Close this panel"
            onClick={() => commit(removePanel(layout, node.id))}
          >
            <X size={12} />
          </button>
        </header>

        <div className="mk-ws-body">
          {market === '' ? (
            <p className="mk-quiet mk-ws-empty">
              No market chosen yet. Open one from the watchlist and every panel that is following will show it.
            </p>
          ) : (
            render(node.panel, market, node)
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="mk-ws" onClick={() => menu && setMenu(null)}>
      <div className="mk-ws-bar">
        <LayoutGrid size={13} />
        <span className="mk-quiet">
          {total} panel{total === 1 ? '' : 's'}
        </span>
        <span className="mk-ws-spacer" />
        {presets.map((one) => (
          <button
            key={one.id}
            type="button"
            className="queue-btn tiny ghost"
            title={one.describe}
            onClick={() => {
              void window.api.marketsPanelsPreset(one.id).then((result) => {
                if (refused(result)) {
                  onNotify(result.message ?? 'That layout could not be applied', 'error')
                  return
                }
                setLayout(result.layout)
              })
            }}
          >
            {one.name}
          </button>
        ))}
        <button
          type="button"
          className="queue-btn tiny ghost"
          title="Back to the starting arrangement"
          onClick={() => {
            void window.api.marketsPanelsReset().then((result) => {
              if (refused(result)) {
                onNotify(result.message ?? 'That could not be reset', 'error')
                return
              }
              setLayout(result.layout)
              onNotify('Workspace reset')
            })
          }}
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      <div className="mk-ws-tree">{drawNode(layout.root)}</div>
    </div>
  )
}
