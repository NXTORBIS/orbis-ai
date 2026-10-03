import { h, svg } from './dom.ts'
import { sizeGlyph, sizeMeasure, sizeSpoken } from './studioLogic.ts'
import { SIZE_NAMES, type WidgetSize } from '../../../src/shared/widgets.ts'

/**
 * Choosing how much room a widget takes.
 *
 * Exactly the sizes the widget says it comes in, never a list of all five with some of them refused afterwards: a
 * choice that would be turned down is not offered. Each one is a little drawn patch of the start page's grid with
 * the cells it would cover filled in, so the difference between Tall and Medium is seen rather than read.
 *
 * Real radio buttons, so the arrow keys move between the sizes and a screen reader says how many are on offer
 * without being told.
 */

export interface SizePickerOptions {
  sizes: readonly WidgetSize[]
  value: WidgetSize
  /** Tells this set of buttons apart from every other on the page. */
  name: string
  /** What the whole group is for: "Size". */
  legend: string
  onPick(size: WidgetSize): void
}

export interface SizePicker {
  element: HTMLElement
  /** Shows a size as the chosen one, without telling anybody it was picked. */
  set(size: WidgetSize): void
}

export function createSizePicker(options: SizePickerOptions): SizePicker {
  const chosen = new Map<WidgetSize, HTMLInputElement>()
  const group = h('div', { class: 'wg-sizes', role: 'radiogroup' })
  for (const size of options.sizes) {
    const id = `${options.name}-${size}`
    const input = h('input', { class: 'wg-sizes-input', type: 'radio', name: options.name, id, value: size, checked: size === options.value, 'aria-label': sizeSpoken(size) })
    input.addEventListener('change', () => {
      if (input.checked) options.onPick(size)
    })
    chosen.set(size, input)
    group.append(
      input,
      h('label', { class: 'wg-sizes-one', for: id },
        drawSizeGlyph(size),
        h('span', { class: 'wg-sizes-name', text: SIZE_NAMES[size] }),
        h('span', { class: 'wg-sizes-cells', text: sizeMeasure(size) })
      )
    )
  }
  const element = h('fieldset', { class: 'wg-sizes-set' }, h('legend', { class: 'wg-label', text: options.legend }), group)
  return {
    element,
    set(size) {
      const input = chosen.get(size)
      if (input) input.checked = true
    }
  }
}

/**
 * The little patch of grid that stands for a size.
 *
 * Every cell of the patch is drawn faintly and the ones the widget would cover are filled, so the mark reads as
 * "this much of the page" rather than as an abstract rectangle.
 */
export function drawSizeGlyph(size: WidgetSize, cell = 9, gap = 2.5): SVGElement {
  const { columns, rows, w, h: tall } = sizeGlyph(size)
  const width = columns * cell + (columns - 1) * gap
  const height = rows * cell + (rows - 1) * gap
  const picture = svg('svg', { class: 'wg-sizes-glyph', viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true', focusable: 'false' })
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      picture.append(svg('rect', {
        class: row < tall && column < w ? 'wg-sizes-on' : 'wg-sizes-off',
        x: column * (cell + gap),
        y: row * (cell + gap),
        width: cell,
        height: cell,
        rx: 2
      }))
    }
  }
  return picture
}
