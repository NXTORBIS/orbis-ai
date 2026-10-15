import { PANE_COUNT, type Layout, type PaneArrangement } from './schema';
import { normalizeRatios } from './resolve';

/**
 * Fitting a layout into the current window. The saved layout is never
 * changed; the window shows the closest arrangement that fits and the user
 * is told what was adjusted. Steps are applied in a fixed, documented order
 * so the result is predictable.
 */

export const MIN_PANE_WIDTH = 280;
export const MIN_PANE_HEIGHT = 180;
/** Title bar, tab strip, toolbar and status bar at their smallest. */
export const CHROME_HEIGHT = 140;

export const ARRANGEMENT_GRID: Record<PaneArrangement, { cols: number; rows: number }> = {
  single: { cols: 1, rows: 1 }, dual: { cols: 2, rows: 1 }, 'dual-stacked': { cols: 1, rows: 2 }, triple: { cols: 3, rows: 1 }, quad: { cols: 2, rows: 2 },
};

export interface FitResult { layout: Layout; adjustments: string[] }

export function requiredSize(l: Layout): { width: number; height: number } {
  const g = ARRANGEMENT_GRID[l.panes.arrangement];
  const side = (l.sidebar.visible ? l.sidebar.width : 0) + (l.details.visible && l.details.position !== 'bottom' ? l.details.width : 0);
  const bottom = l.details.visible && l.details.position === 'bottom' ? l.details.height : 0;
  const ops = l.operations.dock === 'bottom' ? l.operations.height : 0;
  return { width: side + g.cols * MIN_PANE_WIDTH, height: CHROME_HEIGHT + g.rows * MIN_PANE_HEIGHT + bottom + ops };
}

export function fitLayout(input: Layout, width: number, height: number): FitResult {
  const l: Layout = structuredClone(input);
  const adjustments: string[] = [];
  const fitsW = () => requiredSize(l).width <= width;
  const fitsH = () => requiredSize(l).height <= height;
  const setArrangement = (a: PaneArrangement, why: string) => {
    l.panes.arrangement = a;
    l.panes.ratios = normalizeRatios(a, []);
    adjustments.push(why);
  };

  if (!fitsW() && l.details.visible && l.details.position !== 'bottom' && l.details.width > 260) {
    l.details.width = Math.max(260, l.details.width - (requiredSize(l).width - width));
    adjustments.push('The details panel was narrowed to fit the window.');
  }
  if (!fitsW() && l.panes.arrangement === 'triple') setArrangement('dual', 'Three panes do not fit; two are shown.');
  if (!fitsW() && l.panes.arrangement === 'quad') setArrangement('dual-stacked', 'Four panes do not fit side by side; two stacked panes are shown.');
  if (!fitsW() && l.details.visible && l.details.position !== 'bottom') {
    l.details.visible = false;
    adjustments.push('The details panel is hidden while the window is this narrow.');
  }
  if (!fitsW() && l.sidebar.visible && l.sidebar.width > 180) {
    l.sidebar.width = Math.max(180, l.sidebar.width - (requiredSize(l).width - width));
    adjustments.push('The sidebar was narrowed to fit the window.');
  }
  if (!fitsW() && l.panes.arrangement === 'dual') setArrangement(height >= CHROME_HEIGHT + 2 * MIN_PANE_HEIGHT ? 'dual-stacked' : 'single', 'Two panes side by side do not fit; they are shown stacked or as one.');
  if (!fitsW() && l.sidebar.visible) {
    l.sidebar.visible = false;
    l.addressBar.visible = true;
    adjustments.push('The sidebar is hidden while the window is this narrow (the address bar stays available).');
  }
  // Height
  if (!fitsH() && l.operations.dock === 'bottom') {
    l.operations.dock = 'overlay';
    adjustments.push('The operations area opens as a panel instead of a docked strip.');
  }
  if (!fitsH() && l.details.visible && l.details.position === 'bottom') {
    l.details.height = Math.max(160, l.details.height - (requiredSize(l).height - height));
    if (!fitsH()) {
      l.details.visible = false;
      adjustments.push('The bottom details panel is hidden while the window is this short.');
    } else adjustments.push('The bottom details panel was made shorter to fit the window.');
  }
  if (!fitsH() && (l.panes.arrangement === 'quad' || l.panes.arrangement === 'dual-stacked')) {
    setArrangement(width >= requiredSize({ ...l, panes: { arrangement: 'dual', ratios: [0.5] } }).width ? 'dual' : 'single', 'Stacked panes do not fit the window height.');
  }
  return { layout: l, adjustments };
}

/** Pane count for an arrangement. */
export const paneCount = (a: PaneArrangement): number => PANE_COUNT[a];
