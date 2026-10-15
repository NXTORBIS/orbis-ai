/**
 * Placement of the token-styled tooltips (`data-tip`, drawn by CSS as `::after`).
 *
 * The tooltip is centred under its element by default. Panels are rounded floating cards that clip
 * their content (`overflow: hidden`), so a tooltip of a button near a card edge (the first and last
 * toolbar buttons) or near the window edge would be cut off. When the element is hovered or focused,
 * this measures the tooltip text against the nearest clipping ancestors and the window, and aligns it
 * to the element's start or end edge (`data-tip-align`) or shows it above (`data-tip-pos`) instead.
 */
let ctx: CanvasRenderingContext2D | null = null;

function textWidth(text: string, el: Element): number {
  const root = getComputedStyle(document.documentElement);
  const size = root.getPropertyValue('--fs-xs').trim() || '11px';
  const family = getComputedStyle(el).fontFamily || 'sans-serif';
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 6.5;
  ctx.font = `${size} ${family}`;
  return ctx.measureText(text).width;
}

/** The visible area an element's overflow can occupy: the window narrowed by every clipping ancestor. */
function clipBounds(el: HTMLElement): { left: number; right: number; bottom: number } {
  let left = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = p.getBoundingClientRect();
    if (cs.overflowX !== 'visible') {
      left = Math.max(left, r.left);
      right = Math.min(right, r.right);
    }
    if (cs.overflowY !== 'visible') bottom = Math.min(bottom, r.bottom);
  }
  return { left, right, bottom };
}

export function placeTooltip(el: HTMLElement): void {
  const tip = el.getAttribute('data-tip');
  if (!tip) return;
  const r = el.getBoundingClientRect();
  const width = textWidth(tip, el) + 20; // horizontal padding and border of the tooltip
  const height = 26;
  const b = clipBounds(el);
  const centre = r.left + r.width / 2;
  const align = centre - width / 2 < b.left + 2 ? 'start' : centre + width / 2 > b.right - 2 ? 'end' : null;
  if (align) el.setAttribute('data-tip-align', align);
  else el.removeAttribute('data-tip-align');
  if (r.bottom + 6 + height > b.bottom && r.top - 6 - height > 0) el.setAttribute('data-tip-pos', 'above');
  else el.removeAttribute('data-tip-pos');
}

export function installTooltipPlacement(): void {
  const onEnter = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.('[data-tip]');
    if (el instanceof HTMLElement) placeTooltip(el);
  };
  document.addEventListener('mouseover', onEnter, true);
  document.addEventListener('focusin', onEnter, true);
}
