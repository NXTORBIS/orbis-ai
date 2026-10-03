import { svg } from '../../dom.ts'
import { hasPart, lookOf } from './sky.ts'
import type { WeatherSymbol } from '../../../../../src/shared/widgetFeed.ts'

/**
 * The weather, drawn.
 *
 * Every piece is built here out of circles, lines and one or two paths, so a forecast is a picture rather than a
 * word over a number -- and so it is the same picture at 86 pixels on a small card and at 150 on a large one, with
 * no second set of artwork to fall out of step.
 *
 * Nothing carries its own colour. Every piece asks the stylesheet for one by class name, which is what lets the
 * same sun read as a sun on a dark page and on a light one. The only exception is a mask, where black and white are
 * not colours but which parts of a shape are kept.
 *
 * Movement is left to the stylesheet too: a cloud drifts and rain falls because of a class, so a person who asked
 * for less of it gets a still picture from the same code.
 */

/** Masks need a name of their own, and several weather cards can be on one page. */
let made = 0
const nextId = (name: string): string => `wg-${name}-${(made += 1)}`

const at = (x: number, y: number, scale = 1): string => `translate(${x} ${y})${scale === 1 ? '' : ` scale(${scale})`}`

/**
 * A cloud: three risen lumps on a flat base.
 *
 * Overlapping circles of one colour rather than an outline, because an outlined cloud at 24 pixels is a grey smudge
 * with a darker edge, and a filled one is still a cloud.
 */
function cloud(cls: string): SVGElement {
  return svg('g', { class: cls },
    svg('circle', { cx: -15, cy: -3, r: 13 }),
    svg('circle', { cx: 2, cy: -10, r: 17 }),
    svg('circle', { cx: 18, cy: -1, r: 12 }),
    svg('rect', { x: -28, y: -1, width: 56, height: 14, rx: 7 }))
}

/** The sun: a disc, a soft halo around it, and rays that turn slowly enough to be noticed only if you look. */
function sun(cx: number, cy: number, r: number): SVGElement {
  const rays = svg('g', { class: 'wg-weather-rays' })
  for (let turn = 0; turn < 8; turn += 1) {
    const angle = (turn * Math.PI) / 4
    const from = r + 5
    const to = r + 12
    rays.appendChild(svg('line', {
      x1: (Math.cos(angle) * from).toFixed(2),
      y1: (Math.sin(angle) * from).toFixed(2),
      x2: (Math.cos(angle) * to).toFixed(2),
      y2: (Math.sin(angle) * to).toFixed(2)
    }))
  }
  return svg('g', { class: 'wg-weather-sun', transform: at(cx, cy) },
    svg('circle', { class: 'wg-weather-halo', cx: 0, cy: 0, r: r + 16 }),
    rays,
    svg('circle', { class: 'wg-weather-disc', cx: 0, cy: 0, r }))
}

/** The moon: a disc with a second disc taken out of it, which is the only honest way to draw a crescent. */
function moon(cx: number, cy: number, r: number, cls: string): SVGElement {
  const id = nextId('moon')
  return svg('g', { class: cls, transform: at(cx, cy) },
    svg('defs', null,
      svg('mask', { id },
        svg('circle', { cx: 0, cy: 0, r, fill: '#fff' }),
        svg('circle', { cx: r * 0.62, cy: -r * 0.46, r: r * 0.88, fill: '#000' }))),
    svg('circle', { cx: 0, cy: 0, r, mask: `url(#${id})` }))
}

/** Rain, as slanted strokes under a cloud. Each one starts a little after the one before, so it falls as rain does. */
function rainfall(drops: { x: number; delay: number }[]): SVGElement {
  const group = svg('g', { class: 'wg-weather-rain' })
  for (const drop of drops) {
    group.appendChild(svg('line', {
      class: 'wg-weather-drop',
      style: { '--wg-d': `${drop.delay}s` },
      x1: drop.x, y1: 0, x2: drop.x - 4, y2: 11
    }))
  }
  return group
}

/** A snowflake: six arms from one point, turning as it comes down. */
function flake(x: number, y: number, size: number, delay: number): SVGElement {
  const arms = svg('g', { class: 'wg-weather-flake-arms' })
  for (let turn = 0; turn < 3; turn += 1) {
    const angle = (turn * Math.PI) / 3
    const dx = Math.cos(angle) * size
    const dy = Math.sin(angle) * size
    arms.appendChild(svg('line', { x1: (-dx).toFixed(2), y1: (-dy).toFixed(2), x2: dx.toFixed(2), y2: dy.toFixed(2) }))
  }
  return svg('g', { transform: at(x, y) },
    svg('g', { class: 'wg-weather-flake', style: { '--wg-d': `${delay}s` } }, arms))
}

const snowfall = (flakes: { x: number; y: number; size: number; delay: number }[]): SVGElement =>
  svg('g', { class: 'wg-weather-snow' }, ...flakes.map((one) => flake(one.x, one.y, one.size, one.delay)))

/** Fog: bands lying across the picture, drifting sideways at different speeds. */
function fogBands(): SVGElement {
  const bands = [{ x: 24, y: 74, w: 72, d: 0 }, { x: 34, y: 86, w: 54, d: 1.6 }, { x: 26, y: 98, w: 64, d: 0.8 }]
  return svg('g', { class: 'wg-weather-fog' },
    ...bands.map((band) => svg('rect', { class: 'wg-weather-band', style: { '--wg-d': `${band.d}s` }, x: band.x, y: band.y, width: band.w, height: 6, rx: 3 })))
}

/** Lightning: one stroke, held for an instant and gone, the way it is seen. */
const bolt = (x: number, y: number): SVGElement =>
  svg('path', { class: 'wg-weather-bolt', transform: at(x, y), d: 'M6 0 L-6 16 L1 16 L-4 32 L12 11 L4 11 Z' })

const stars = (): SVGElement => {
  const places = [{ x: 22, y: 24, r: 1.6, d: 0 }, { x: 38, y: 14, r: 1.1, d: 1.1 }, { x: 15, y: 48, r: 1.4, d: 2.2 }, { x: 46, y: 36, r: 1, d: 0.6 }, { x: 30, y: 60, r: 1.2, d: 1.7 }, { x: 54, y: 20, r: 1.5, d: 2.8 }, { x: 12, y: 33, r: 1, d: 3.4 }]
  return svg('g', { class: 'wg-weather-stars' },
    ...places.map((one) => svg('circle', { class: 'wg-weather-star', style: { '--wg-d': `${one.d}s` }, cx: one.x, cy: one.y, r: one.r })))
}

const RAIN_MANY = [{ x: 30, delay: 0 }, { x: 41, delay: 0.55 }, { x: 52, delay: 0.2 }, { x: 63, delay: 0.75 }, { x: 74, delay: 0.35 }, { x: 36, delay: 0.95 }, { x: 58, delay: 1.15 }]
const RAIN_FEW = [{ x: 38, delay: 0 }, { x: 54, delay: 0.6 }, { x: 70, delay: 0.3 }]
const SNOW_ALL = [{ x: 34, y: 84, size: 5, delay: 0 }, { x: 52, y: 80, size: 6, delay: 1.1 }, { x: 70, y: 86, size: 4.5, delay: 0.5 }, { x: 44, y: 98, size: 4, delay: 1.7 }, { x: 62, y: 100, size: 5, delay: 0.8 }]
const SNOW_MIXED = [{ x: 36, y: 84, size: 5, delay: 0 }, { x: 66, y: 88, size: 4.5, delay: 0.9 }]

/**
 * The whole picture for one kind of weather.
 *
 * It says what it is: the group carries the name of the picture, so a person using a screen reader is told "the sun
 * behind a cloud" and not "image". The forecast's own wording sits beside it on the card and is read separately,
 * because the two are different things -- one is what Orbis drew, the other is what the forecast said.
 */
export function weatherArt(symbol: WeatherSymbol): SVGElement {
  const look = lookOf(symbol)
  const art = svg('svg', { class: 'wg-weather-art', viewBox: '0 0 120 120', role: 'img', 'aria-label': look.said, focusable: 'false' })
  const withCloud = hasPart(look, 'cloud-small') || hasPart(look, 'cloud-big')

  if (hasPart(look, 'stars')) art.appendChild(stars())
  if (hasPart(look, 'sun')) art.appendChild(withCloud ? sun(84, 32, 14) : sun(72, 48, 22))
  if (hasPart(look, 'moon')) art.appendChild(moon(80, 40, 18, 'wg-weather-moon'))
  if (hasPart(look, 'cloud-small')) {
    const back = svg('g', { class: 'wg-weather-cloud wg-weather-cloud-back', transform: at(hasPart(look, 'cloud-big') ? 74 : 58, hasPart(look, 'cloud-big') ? 46 : 54, 0.74) }, cloud('wg-weather-puff'))
    art.appendChild(back)
  }
  if (hasPart(look, 'cloud-big')) art.appendChild(svg('g', { class: 'wg-weather-cloud', transform: at(54, 64) }, cloud('wg-weather-puff')))
  if (hasPart(look, 'bolt')) art.appendChild(bolt(52, 74))
  if (hasPart(look, 'drops-many')) art.appendChild(svg('g', { transform: at(0, 80) }, rainfall(RAIN_MANY)))
  if (hasPart(look, 'drops-few')) art.appendChild(svg('g', { transform: at(0, hasPart(look, 'cloud-big') ? 84 : 72) }, rainfall(RAIN_FEW)))
  if (hasPart(look, 'flakes')) art.appendChild(snowfall(SNOW_ALL))
  if (hasPart(look, 'mixed')) {
    art.appendChild(svg('g', { transform: at(0, 80) }, rainfall(RAIN_FEW)))
    art.appendChild(snowfall(SNOW_MIXED))
  }
  if (hasPart(look, 'fog')) art.appendChild(fogBands())
  if (hasPart(look, 'blank')) {
    art.appendChild(svg('circle', { class: 'wg-weather-blank-ring', cx: 60, cy: 58, r: 27 }))
    art.appendChild(svg('circle', { class: 'wg-weather-blank-dot', cx: 60, cy: 58, r: 4.5 }))
  }
  return art
}

/**
 * The small glyph that stands for one hour in the strip of coming hours.
 *
 * Built apart from the big picture rather than shrunk out of it: at twelve pixels a cloud with rain under it is a
 * grey blob, and what an hour needs is one readable mark. It is drawn for the eye only -- the hour, its temperature
 * and its weather are in the words the strip reads out.
 */
export function weatherMini(symbol: WeatherSymbol): SVGElement {
  const mark = lookOf(symbol).mini
  const glyph = svg('svg', { class: 'wg-weather-mini', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' })
  if (mark === 'sun') {
    const rays = svg('g', { class: 'wg-weather-mini-rays' })
    for (let turn = 0; turn < 8; turn += 1) {
      const angle = (turn * Math.PI) / 4
      rays.appendChild(svg('line', { x1: (12 + Math.cos(angle) * 7.5).toFixed(2), y1: (12 + Math.sin(angle) * 7.5).toFixed(2), x2: (12 + Math.cos(angle) * 10).toFixed(2), y2: (12 + Math.sin(angle) * 10).toFixed(2) }))
    }
    glyph.appendChild(rays)
    glyph.appendChild(svg('circle', { class: 'wg-weather-mini-disc', cx: 12, cy: 12, r: 5.5 }))
  } else if (mark === 'partly') {
    glyph.appendChild(svg('circle', { class: 'wg-weather-mini-disc', cx: 15, cy: 8.5, r: 4.5 }))
    glyph.appendChild(svg('g', { class: 'wg-weather-mini-cloud', transform: at(11, 15, 0.3) }, cloud('wg-weather-puff')))
  } else if (mark === 'cloud') {
    glyph.appendChild(svg('g', { class: 'wg-weather-mini-cloud', transform: at(12, 14, 0.34) }, cloud('wg-weather-puff')))
  } else if (mark === 'drop') {
    glyph.appendChild(svg('path', { class: 'wg-weather-mini-drop', d: 'M12 3 C12 3 5 12 5 16 a7 7 0 0 0 14 0 C19 12 12 3 12 3 Z' }))
  } else if (mark === 'flake') {
    const arms = svg('g', { class: 'wg-weather-mini-flake' })
    for (let turn = 0; turn < 3; turn += 1) {
      const angle = (turn * Math.PI) / 3
      arms.appendChild(svg('line', { x1: (12 - Math.cos(angle) * 8).toFixed(2), y1: (12 - Math.sin(angle) * 8).toFixed(2), x2: (12 + Math.cos(angle) * 8).toFixed(2), y2: (12 + Math.sin(angle) * 8).toFixed(2) }))
    }
    glyph.appendChild(arms)
  } else if (mark === 'bolt') {
    glyph.appendChild(svg('path', { class: 'wg-weather-mini-bolt', d: 'M14 2 L6 13 L11 13 L9 22 L18 10 L13 10 Z' }))
  } else if (mark === 'haze') {
    glyph.appendChild(svg('g', { class: 'wg-weather-mini-haze' },
      svg('rect', { x: 3, y: 8, width: 18, height: 2.4, rx: 1.2 }),
      svg('rect', { x: 5, y: 13, width: 14, height: 2.4, rx: 1.2 }),
      svg('rect', { x: 3, y: 18, width: 16, height: 2.4, rx: 1.2 })))
  } else if (mark === 'moon') {
    glyph.appendChild(moon(12, 12, 8, 'wg-weather-mini-moon'))
  } else {
    glyph.appendChild(svg('circle', { class: 'wg-weather-mini-none', cx: 12, cy: 12, r: 3 }))
  }
  return glyph
}
