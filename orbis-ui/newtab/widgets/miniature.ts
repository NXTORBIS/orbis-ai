import { svg } from './dom.ts'
import { markFor, miniatureShape, type MiniatureAsk, type MiniatureShape } from './galleryLogic.ts'
import { widgetById, type WidgetInstance } from '../../../src/shared/widgets.ts'

/**
 * The little picture of a start page.
 *
 * One block per widget, at the real proportions, laid out by the same sum the start page itself lays out with. It is
 * used twice: for the page as it is now, at the top of the gallery, and for what a ready-made layout would make of
 * it. Both are drawn from real instances -- nothing here invents a layout to look busy.
 *
 * A picture, not a control: it is one `<svg>` with a name spoken in place of it, and nothing inside it can be
 * reached by the keyboard.
 */

/** One of the small marks that stand for a widget, drawn on its own. */
export function drawMark(icon: string, size: number): SVGElement {
  return svg('svg', { class: 'wg-mark', viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' }, svg('path', { d: markFor(icon) }))
}

export interface MiniatureOptions extends MiniatureAsk {
  /** Said in place of the picture: "Your start page, 6 widgets". */
  label: string
}

export interface Miniature {
  element: SVGElement
  shape: MiniatureShape
}

/** The largest and smallest a mark is drawn inside a block, so one cell is legible and four cells is not a billboard. */
const MARK = { least: 9, most: 26, share: 0.4 }

/**
 * The picture, and the shape it was drawn from.
 *
 * The shape comes back as well because the gallery has something to say about it -- how many widgets were left out
 * when the page is taller than the picture -- and working it out twice would be two answers waiting to disagree.
 */
export function drawMiniature(instances: readonly WidgetInstance[], options: MiniatureOptions): Miniature {
  const shape = miniatureShape(instances, options)
  const picture = svg('svg', {
    class: 'wg-mini',
    viewBox: `0 0 ${Math.round(shape.width)} ${Math.round(shape.height)}`,
    width: Math.round(shape.width),
    height: Math.round(shape.height),
    role: 'img',
    'aria-label': options.label,
    focusable: 'false'
  })
  const radius = Math.max(2, Math.min(8, shape.cell * 0.18))
  for (const block of shape.blocks) {
    const definition = widgetById(block.widget)
    picture.append(svg('rect', { class: 'wg-mini-block', x: round(block.x), y: round(block.y), width: round(block.w), height: round(block.h), rx: round(radius) }))
    const side = Math.max(MARK.least, Math.min(MARK.most, Math.min(block.w, block.h) * MARK.share))
    // The mark is one path on a 24 by 24 square, so it is moved into the block and scaled there rather than redrawn.
    const scale = side / 24
    picture.append(
      svg('g', {
        class: 'wg-mini-mark',
        transform: `translate(${round(block.x + block.w / 2 - side / 2)} ${round(block.y + block.h / 2 - side / 2)}) scale(${round(scale, 4)})`,
        'stroke-width': round(1.75 / scale, 2)
      }, svg('path', { d: markFor(definition?.icon ?? '') }))
    )
  }
  return { element: picture, shape }
}

const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places
