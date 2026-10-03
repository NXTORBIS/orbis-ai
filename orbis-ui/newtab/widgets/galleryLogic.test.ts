import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asCategory, asFilter, categoryMark, foundWords, homeSections, isBrowsing, markFor, miniatureShape, nextTile, offerWidget, offeredWidgets, presetLayout, presetNote, presetOffered, queryOf, tileBadges, tileFit } from './galleryLogic.ts'
import { emptyBoard, WIDGET_PRESETS, type WidgetBoard } from '../../../src/shared/widgetBoard.ts'
import { newWidgetInstance, widgetById, WIDGETS, type WidgetInstance, type WidgetSize } from '../../../src/shared/widgets.ts'

/** Everything the catalogue has, as though every one of them could be drawn. */
const ALL = WIDGETS.map((one) => one.id)

let made = 0
const put = (widget: string, size?: WidgetSize): WidgetInstance => {
  const one = newWidgetInstance(widget, 'centre', made)!
  return { ...one, id: `i${made}`, order: made++, size: size ?? one.size, addedAt: 1000 + made }
}

const boardWith = (instances: WidgetInstance[], more: Partial<WidgetBoard> = {}): WidgetBoard => ({ ...emptyBoard(), instances, ...more })

// ---------------------------------------------------------------- what the gallery was asked for

test('a group or a filter that is not one of ours is simply everything', () => {
  assert.equal(asFilter('favourites'), 'favourites')
  assert.equal(asFilter('nonsense'), 'all')
  assert.equal(asFilter(undefined), 'all')
  assert.equal(asCategory('time'), 'time')
  assert.equal(asCategory('<script>'), 'all')
})

test('looking for something in particular, or not', () => {
  assert.equal(isBrowsing({}), false)
  assert.equal(isBrowsing({ query: '   ' }), false)
  assert.equal(isBrowsing({ query: 'clock' }), true)
  assert.equal(isBrowsing({ category: 'time' }), true)
  assert.equal(isBrowsing({ filter: 'favourites' }), true)
  // Nonsense in the address is not a search: the gallery shows its bands rather than an empty result.
  assert.equal(isBrowsing({ category: 'nope', filter: 'nope' }), false)
  assert.deepEqual(queryOf({ query: ' clock ', category: 'time' }), { query: 'clock', category: 'time', filter: 'all' })
})

// ---------------------------------------------------------------- what may be offered

test('a widget is only offered when the catalogue allows it and this page can draw it', () => {
  const clock = widgetById('clock')!
  assert.deepEqual(offerWidget(clock, ALL), { ok: true })
  const nothingDrawn = offerWidget(clock, [])
  assert.equal(nothingDrawn.ok, false)
  assert.match(nothingDrawn.ok === false ? nothingDrawn.reason : '', /cannot draw Clock/)
  // The catalogue's own reason is used word for word when it has one.
  const games = widgetById('games')!
  const refused = offerWidget(games, ALL)
  assert.equal(refused.ok, false)
  assert.equal(refused.ok === false ? refused.reason : '', games.unavailable)
})

test('the offered widgets keep the catalogue order and leave out the rest', () => {
  const offered = offeredWidgets(ALL).map((one) => one.id)
  assert.ok(!offered.includes('games'))
  assert.deepEqual(offered, WIDGETS.filter((one) => !one.unavailable && one.surfaces.includes('start')).map((one) => one.id))
})

// ---------------------------------------------------------------- the bands

test('an untouched start page has no bands about it, and every widget still cannot be added', () => {
  const sections = homeSections({ board: emptyBoard(), layouts: [], drawable: [] })
  assert.deepEqual(sections.map((one) => one.id), ['missing'])
  assert.equal(sections[0].missing?.length, WIDGETS.length)
  assert.ok(sections[0].missing?.every((one) => one.reason !== ''))
})

test('with nothing on the start page: featured, then the ready-made layouts, then the groups', () => {
  const sections = homeSections({ board: emptyBoard(), layouts: [], drawable: ALL })
  const ids = sections.map((one) => one.key)
  assert.deepEqual(ids.slice(0, 2), ['featured', 'presets'])
  // No board picture, nothing installed, no favourites, nothing used lately: those bands are not drawn at all.
  assert.ok(!ids.includes('board'))
  assert.ok(!ids.includes('installed'))
  assert.ok(!ids.includes('favourites'))
  assert.ok(!ids.includes('recent'))
  assert.ok(!ids.includes('layouts'))
  assert.ok(ids.includes('category:time'))
  assert.equal(ids[ids.length - 1], 'missing')
})

test('a used start page shows its picture, what is on it, favourites and saved layouts, in that order', () => {
  const board = boardWith([put('clock'), put('tasks'), put('clock')], { favourites: ['weather'], recent: [{ widget: 'markets', at: 5 }, { widget: 'clock', at: 4 }] })
  const sections = homeSections({ board, layouts: [{ id: 'l1', name: 'Mornings', widgets: 4 }], drawable: ALL })
  const ids = sections.map((one) => one.key)
  assert.deepEqual(ids.slice(0, 7), ['board', 'featured', 'installed', 'favourites', 'recent', 'presets', 'layouts'])
  assert.equal(sections[0].note, '3 widgets, as they sit now.')
  // One tile per kind of widget, not one per widget: two clocks are one "Clock".
  assert.deepEqual(sections[2].widgets, ['clock', 'tasks'])
  assert.deepEqual(sections[3].widgets, ['weather'])
  // "Recently used" leaves out what is on the start page already, which the band above it is.
  assert.deepEqual(sections[4].widgets, ['markets'])
  assert.deepEqual(sections[6].layouts, ['l1'])
})

test('a hidden widget is still on the start page, and still counted as there', () => {
  const hidden = { ...put('notes'), hidden: true }
  const board = boardWith([hidden])
  const sections = homeSections({ board, layouts: [], drawable: ALL })
  // Nothing is shown, so there is no picture of the page -- but the widget is on it, so it is not offered as new.
  assert.ok(!sections.some((one) => one.id === 'board'))
  assert.deepEqual(tileBadges(widgetById('notes')!, board)[0], { text: 'On your start page', tone: 'on' })
})

test('every widget named in a band is one that can really be added', () => {
  const board = boardWith([put('clock')], { favourites: ['games'], recent: [{ widget: 'games', at: 1 }] })
  const sections = homeSections({ board, layouts: [], drawable: ALL })
  const named = sections.flatMap((one) => one.widgets)
  assert.ok(named.length > 0)
  for (const id of named) assert.deepEqual(offerWidget(widgetById(id)!, ALL), { ok: true })
})

// ---------------------------------------------------------------- words

test('how many were found, in words', () => {
  assert.equal(foundWords(0), 'Nothing found')
  assert.equal(foundWords(1), '1 widget')
  assert.equal(foundWords(7), '7 widgets')
})

test('a tile says whether it is already on the page and whether it needs the internet', () => {
  const board = boardWith([put('weather'), put('weather')])
  assert.deepEqual(tileBadges(widgetById('weather')!, board), [{ text: 'On your start page · 2', tone: 'on' }, { text: 'Needs the internet', tone: 'net' }])
  assert.deepEqual(tileBadges(widgetById('clock')!, emptyBoard()), [{ text: 'Works offline', tone: 'off' }])
})

test('a ready-made layout says it replaces what is there, with the number that would go', () => {
  const minimal = WIDGET_PRESETS.find((one) => one.id === 'minimal')!
  assert.equal(presetNote(minimal, emptyBoard()), 'Puts 2 widgets on the start page.')
  assert.equal(presetNote(minimal, boardWith([put('clock')])), 'Replaces the 1 widget on your start page with 2 widgets.')
  const made = presetLayout(minimal)
  assert.equal(made?.length, 2)
  assert.deepEqual(made?.map((one) => one.widget), ['clock', 'notepad'])
  // Every layout Orbis ships can really be made, or the gallery would offer one that fails.
  for (const preset of WIDGET_PRESETS) assert.ok(presetLayout(preset) !== null, preset.id)
})

test('a layout with a widget this page cannot draw is not offered at all', () => {
  const minimal = WIDGET_PRESETS.find((one) => one.id === 'minimal')!
  assert.equal(presetOffered(minimal, ALL), true)
  assert.equal(presetOffered(minimal, ['clock']), false)
  const sections = homeSections({ board: emptyBoard(), layouts: [], drawable: ['clock'] })
  assert.ok(!sections.some((one) => one.id === 'presets'))
})

// ---------------------------------------------------------------- a tile's preview

test('a widget is shrunk to fit a tile and never blown up past its real size', () => {
  // A small widget is 156 by 156. A tile with more room than that draws it at real size.
  assert.equal(tileFit('small', { width: 300, height: 300 }).scale, 1)
  const tight = tileFit('small', { width: 78, height: 78 })
  assert.equal(tight.scale, 0.5)
  assert.equal(tight.boxWidth, 78)
  assert.equal(tight.boxHeight, 78)
  // A medium widget is 326 by 156: it is the width that runs out first in a square tile.
  const medium = tileFit('medium', { width: 163, height: 163 })
  assert.equal(medium.width, 326)
  assert.equal(medium.scale, 0.5)
  assert.equal(medium.boxHeight, 78)
  // A tile that has not been measured yet does not shrink anything to nothing.
  assert.equal(tileFit('small', { width: 0, height: 0 }).scale, 1)
})

test('a wide widget is measured against the columns it would really have', () => {
  const two = tileFit('wide', { width: 1000, height: 1000 }, 2)
  const four = tileFit('wide', { width: 1000, height: 1000 }, 4)
  assert.equal(two.width, 326)
  assert.equal(four.width, 666)
  assert.ok(four.scale < 1 || four.width > two.width)
})

// ---------------------------------------------------------------- the little picture

test('the little picture keeps the start page proportions and its arrangement', () => {
  const shape = miniatureShape([put('clock'), put('tasks', 'medium')], { width: 200, columns: 4 })
  // Four cells and three gaps come to exactly the width asked for.
  assert.ok(Math.abs(4 * shape.cell + 3 * shape.gap - 200) < 0.001)
  // A cell is square, and the gap keeps the start page's own ratio to it.
  assert.ok(Math.abs(shape.gap / shape.cell - 14 / 156) < 0.0001)
  assert.equal(shape.blocks.length, 2)
  assert.equal(shape.blocks[0].x, 0)
  assert.equal(shape.blocks[0].y, 0)
  assert.ok(Math.abs(shape.blocks[0].w - shape.cell) < 0.001)
  // The medium one is two cells and the gap between them wide, and starts one step along.
  assert.ok(Math.abs(shape.blocks[1].w - (2 * shape.cell + shape.gap)) < 0.001)
  assert.ok(Math.abs(shape.blocks[1].x - (shape.cell + shape.gap)) < 0.001)
  assert.equal(shape.hidden, 0)
  assert.equal(shape.rows, 1)
})

test('a picture that would run off the bottom is cut, and says how many it left out', () => {
  const many = Array.from({ length: 12 }, () => put('clock'))
  const shape = miniatureShape(many, { width: 200, columns: 2, mostRows: 2 })
  assert.equal(shape.blocks.length, 4)
  assert.equal(shape.hidden, 8)
  assert.equal(shape.rows, 2)
  assert.ok(Math.abs(shape.height - (2 * shape.cell + shape.gap)) < 0.001)
})

test('a picture of nothing is still a shape, not a crash', () => {
  const shape = miniatureShape([], { width: 200 })
  assert.deepEqual(shape.blocks, [])
  assert.equal(shape.rows, 0)
  assert.ok(shape.height > 0)
})

test('every block in the picture knows which widget it is', () => {
  const shape = miniatureShape([put('weather'), put('notepad')], { width: 240, columns: 3 })
  assert.deepEqual(shape.blocks.map((one) => one.widget), ['weather', 'notepad'])
})

// ---------------------------------------------------------------- the keyboard

test('arrow keys move about the grid and stop at its edges', () => {
  assert.equal(nextTile(0, 'ArrowRight', 4, 10), 1)
  assert.equal(nextTile(0, 'ArrowLeft', 4, 10), 0)
  assert.equal(nextTile(1, 'ArrowDown', 4, 10), 5)
  assert.equal(nextTile(9, 'ArrowDown', 4, 10), 9)
  assert.equal(nextTile(5, 'ArrowUp', 4, 10), 1)
  assert.equal(nextTile(0, 'End', 4, 10), 9)
  assert.equal(nextTile(9, 'Home', 4, 10), 0)
  assert.equal(nextTile(3, 'Enter', 4, 10), 3)
  assert.equal(nextTile(0, 'ArrowRight', 4, 0), -1)
})

// ---------------------------------------------------------------- the marks

test('every widget in the catalogue has a mark drawn for it', () => {
  for (const one of WIDGETS) assert.notEqual(markFor(one.icon), markFor('nothing-is-drawn-for-this'), one.id)
  // A name nothing was drawn for still gives a shape rather than an empty string.
  assert.ok(markFor('nothing-is-drawn-for-this').startsWith('M'))
  for (const category of ['all', 'time', 'productivity', 'information', 'browser', 'orion', 'utility'] as const) {
    assert.ok(categoryMark(category).startsWith('M'), category)
  }
})
