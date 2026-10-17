/**
 * The page's icons, as path data rather than as files.
 *
 * Built node by node with `createElementNS`, for the same reason everything else on this page is: no markup is ever
 * parsed. They are drawn here rather than loaded as images so they take the colour of whatever they sit in -- every
 * one uses `currentColor` -- which is what makes an icon turn cyan when its button is on, in both themes, with no
 * second copy of the file.
 *
 * Add a new one by adding a row. A screen asking for a name that is not here gets an empty square rather than a
 * crash, so a missing icon is a gap on screen and not a broken page.
 */

const SVG = 'http://www.w3.org/2000/svg'

/** Each entry is the 24-unit path data for one icon, stroked rather than filled unless its name says otherwise. */
const PATHS: Record<string, readonly string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5.5 9.5V21h13V9.5'],
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z', 'm15.5 15.5 5 5'],
  library: ['M4 4h4v16H4z', 'M10 4h4v16h-4z', 'm16.5 5 3.5 1-3 14-3.5-1z'],
  heart: ['M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 7.8a4.1 4.1 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3.5 6h.01', 'M3.5 12h.01', 'M3.5 18h.01'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3.5 2'],
  compass: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm15.5 8.5-2 5-5 2 2-5z'],
  ear: ['M8 9a4 4 0 1 1 8 0c0 2-1.5 2.8-2.5 4-.8 1-.5 2.5-2 2.5', 'M8.5 18.5a3 3 0 0 0 3 2.5'],
  folder: ['M3.5 7.5h5l2 2.5h10v9.5h-17z', 'M3.5 7.5V5.5h5'],
  file: ['M6 3.5h7l5 5v15H6z', 'M13 3.5v5h5'],
  settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M12 2.5v3', 'M12 18.5v3', 'M2.5 12h3', 'M18.5 12h3', 'm5.2 5.2 2.1 2.1', 'm16.7 16.7 2.1 2.1', 'm18.8 5.2-2.1 2.1', 'm7.3 16.7-2.1 2.1'],
  play: ['M8 5.5v13l11-6.5z'],
  pause: ['M9 5.5v13', 'M15 5.5v13'],
  prev: ['M18 5.5v13L8 12z', 'M6 5.5v13'],
  next: ['M6 5.5v13L16 12z', 'M18 5.5v13'],
  shuffle: ['M3.5 7h4l9 10h4', 'm18 14 2.5 3-2.5 3', 'M3.5 17h4l2-2.2', 'm14.5 9.2 2-2.2h4', 'm18 4 2.5 3-2.5 3'],
  repeat: ['M7 5.5h10l-2.5-2.5', 'M20 8.5v7a3 3 0 0 1-3 3H7l2.5 2.5', 'M4 15.5v-7a3 3 0 0 1 3-3'],
  volume: ['M4 10v4h3l4 3.5v-15L7 10z', 'M14.5 9a4 4 0 0 1 0 6', 'M17 6.5a7.5 7.5 0 0 1 0 11'],
  mute: ['M4 10v4h3l4 3.5v-15L7 10z', 'm15 10 5 5', 'm20 10-5 5'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['m6 6 12 12', 'm18 6-12 12'],
  back: ['m11 5-7 7 7 7', 'M4 12h16'],
  forward: ['m13 5 7 7-7 7', 'M20 12H4'],
  note: ['M9 18V6l9-2v12', 'M6.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M15.5 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  panel: ['M3.5 4.5h17v15h-17z', 'M14.5 4.5v15'],
  edit: ['M4 20h4l11-11-4-4L4 16z'],
  more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  dj: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  refresh: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v4h-4']
}

/** The names a screen may ask for, so a screen file can be checked against them. */
export const ICON_NAMES: readonly string[] = Object.freeze(Object.keys(PATHS))

/**
 * One icon, at whatever size the box it sits in gives it.
 *
 * `aria-hidden` on all of them: an icon is never the name of a control. The button around it carries the words, which
 * is why `button()` in dom.ts refuses to make one without an accessible name.
 */
export function icon(name: string, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.6')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  // Play and pause read as solid shapes rather than outlines, which is the one place a filled icon is right.
  const filled = name === 'play'
  if (filled) {
    svg.setAttribute('fill', 'currentColor')
    svg.setAttribute('stroke', 'none')
  }
  for (const data of PATHS[name] ?? []) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', data)
    svg.append(path)
  }
  return svg
}
