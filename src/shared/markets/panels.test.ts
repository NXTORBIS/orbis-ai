import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanLayout,
  defaultLayout,
  findNode,
  LAYOUT_PRESETS,
  marketFor,
  MIN_RATIO,
  normaliseRatios,
  panelNode,
  panelsIn,
  removePanel,
  replaceNode,
  resizeSplit,
  setPanelKind,
  setPanelMarket,
  splitNode,
  splitPanel,
  type Layout
} from './panels.ts'
import { PANELS } from './experience.ts'

const BTC = 'binance:crypto:binance:btcusdt'
const ETH = 'binance:crypto:binance:ethusdt'

// ---------------------------------------------------------------- ratios

test('ratios always sum to one', () => {
  for (const input of [[1, 1], [3, 1], [0.2, 0.3, 0.5], []]) {
    const count = input.length || 3
    const result = normaliseRatios(input, count)
    assert.equal(result.length, count)
    assert.ok(Math.abs(result.reduce((sum, one) => sum + one, 0) - 1) < 1e-9, JSON.stringify(result))
  }
})

test('no pane can be squeezed to nothing', () => {
  const result = normaliseRatios([0.999, 0.001], 2)
  assert.ok(result.every((one) => one >= MIN_RATIO - 1e-9), JSON.stringify(result))
})

test('nonsense ratios become an even split rather than a broken layout', () => {
  assert.deepEqual(normaliseRatios([Number.NaN, -1], 2), [0.5, 0.5])
  assert.deepEqual(normaliseRatios([0, 0], 2), [0.5, 0.5])
  // Mismatched length is no information at all.
  assert.deepEqual(normaliseRatios([0.5], 2), [0.5, 0.5])
})

test('more panes than the minimum allows fall back to an even split', () => {
  // Twenty panes cannot each have 8%, so the only layout where all of them are usable is an even one.
  const result = normaliseRatios(Array.from({ length: 20 }, () => 1), 20)
  assert.ok(Math.abs(result.reduce((sum, one) => sum + one, 0) - 1) < 1e-9)
  assert.ok(result.every((one) => Math.abs(one - 0.05) < 1e-9))
})

// ---------------------------------------------------------------- the tree

test('the default layout has real panels in it', () => {
  const layout = defaultLayout(BTC)
  const panels = panelsIn(layout.root)
  assert.ok(panels.length >= 3)
  for (const one of panels) assert.ok(PANELS.includes(one.panel), one.panel)
})

test('splitting a panel keeps it and adds the new one beside it', () => {
  const layout = defaultLayout()
  const chart = panelsIn(layout.root).find((one) => one.panel === 'chart')
  assert.ok(chart)
  const after = splitPanel(layout, chart.id, 'row', 'book')
  const panels = panelsIn(after.root)
  assert.ok(panels.some((one) => one.panel === 'chart'))
  assert.ok(panels.some((one) => one.panel === 'book'))
  assert.equal(panels.length, panelsIn(layout.root).length + 1)
})

test('a new panel inherits the market of the one it was split from', () => {
  const layout: Layout = { version: 1, instrumentId: '', root: panelNode('chart', BTC) }
  const chart = panelsIn(layout.root)[0]
  const after = splitPanel(layout, chart.id, 'column', 'book')
  assert.ok(panelsIn(after.root).every((one) => one.instrumentId === BTC))
})

test('removing a panel collapses the split it leaves behind', () => {
  const layout: Layout = {
    version: 1,
    instrumentId: '',
    root: splitNode('row', [panelNode('chart'), panelNode('book')])
  }
  const book = panelsIn(layout.root).find((one) => one.panel === 'book')
  assert.ok(book)
  const after = removePanel(layout, book.id)
  // One child left, so the split is gone rather than leaving a layer of empty nesting.
  assert.equal(after.root.type, 'panel')
  assert.equal(panelsIn(after.root).length, 1)
})

test('the last panel cannot be removed, because an empty workspace cannot be worked out of', () => {
  const layout: Layout = { version: 1, instrumentId: '', root: panelNode('chart') }
  const only = panelsIn(layout.root)[0]
  assert.equal(panelsIn(removePanel(layout, only.id).root).length, 1)
})

test('a node can be found and replaced anywhere in the tree', () => {
  const layout = defaultLayout()
  const trades = panelsIn(layout.root).find((one) => one.panel === 'trades')
  assert.ok(trades)
  assert.equal(findNode(layout.root, trades.id)?.id, trades.id)
  const replaced = replaceNode(layout.root, trades.id, panelNode('news'))
  assert.ok(panelsIn(replaced!).some((one) => one.panel === 'news'))
  assert.ok(!panelsIn(replaced!).some((one) => one.panel === 'trades'))
})

// ---------------------------------------------------------------- following and pinning

test('a panel follows the workspace unless it is pinned', () => {
  const layout: Layout = { version: 1, instrumentId: BTC, root: splitNode('row', [panelNode('chart'), panelNode('book', ETH)]) }
  const [chart, book] = panelsIn(layout.root)
  assert.equal(marketFor(chart, layout), BTC)
  // Pinned, so the workspace moving does not move it.
  assert.equal(marketFor(book, layout), ETH)
  assert.equal(marketFor(book, { ...layout, instrumentId: 'something:else:1:2' }), ETH)
})

test('pinning a panel changes only that panel', () => {
  const layout = defaultLayout(BTC)
  const chart = panelsIn(layout.root).find((one) => one.panel === 'chart')
  assert.ok(chart)
  const after = setPanelMarket(layout, chart.id, ETH)
  const panels = panelsIn(after.root)
  assert.equal(panels.find((one) => one.panel === 'chart')?.instrumentId, ETH)
  assert.equal(panels.find((one) => one.panel === 'watchlist')?.instrumentId, '')
})

test('swapping a panel’s kind keeps its place and drops the old one’s state', () => {
  const layout: Layout = {
    version: 1,
    instrumentId: '',
    root: splitNode('row', [{ ...panelNode('chart', BTC), state: { interval: '4h' } }, panelNode('news')])
  }
  const chart = panelsIn(layout.root)[0]
  const after = setPanelKind(layout, chart.id, 'book')
  const swapped = panelsIn(after.root)[0]
  assert.equal(swapped.panel, 'book')
  assert.equal(swapped.instrumentId, BTC)
  // State belonged to the chart, so it went with it.
  assert.equal(swapped.state, undefined)
})

// ---------------------------------------------------------------- resizing

test('dragging a divider renormalises, so no pane vanishes', () => {
  const layout: Layout = { version: 1, instrumentId: '', root: splitNode('row', [panelNode('chart'), panelNode('book')]) }
  const split = layout.root as { id: string }
  const after = resizeSplit(layout, split.id, [0.99, 0.01])
  const ratios = (after.root as { ratios: number[] }).ratios
  assert.ok(ratios.every((one) => one >= MIN_RATIO - 1e-9))
  assert.ok(Math.abs(ratios.reduce((sum, one) => sum + one, 0) - 1) < 1e-9)
})

test('resizing something that is not a split changes nothing', () => {
  const layout: Layout = { version: 1, instrumentId: '', root: panelNode('chart') }
  assert.deepEqual(resizeSplit(layout, layout.root.id, [1]), layout)
})

// ---------------------------------------------------------------- reading one back

test('a layout naming a panel that no longer exists loses that leaf and keeps the rest', () => {
  const cleaned = cleanLayout({
    root: {
      type: 'split',
      direction: 'row',
      children: [
        { type: 'panel', panel: 'chart' },
        { type: 'panel', panel: 'hyperspace' }
      ]
    }
  })
  const panels = panelsIn(cleaned.root)
  assert.equal(panels.length, 1)
  assert.equal(panels[0].panel, 'chart')
})

test('a layout with nothing left in it falls back to the default rather than a blank workspace', () => {
  const cleaned = cleanLayout({ root: { type: 'split', children: [{ type: 'panel', panel: 'nowhere' }] } })
  assert.ok(panelsIn(cleaned.root).length >= 3)
  assert.equal(cleanLayout(null).root.type, 'split')
  assert.equal(cleanLayout('nonsense').root.type, 'split')
})

test('a tree deep enough to be a problem is refused', () => {
  let node: unknown = { type: 'panel', panel: 'chart' }
  for (let i = 0; i < 30; i++) node = { type: 'split', direction: 'row', children: [node, { type: 'panel', panel: 'news' }] }
  const cleaned = cleanLayout({ root: node })
  // It does not throw, and what comes back is usable.
  assert.ok(panelsIn(cleaned.root).length >= 1)
})

test('panel state is read back as the simple values it is, and nothing else', () => {
  const cleaned = cleanLayout({
    root: { type: 'panel', panel: 'chart', state: { interval: '4h', depth: 20, on: true, bad: { nested: 1 } } }
  })
  const panel = panelsIn(cleaned.root)[0]
  assert.equal(panel.state?.interval, '4h')
  assert.equal(panel.state?.depth, 20)
  assert.equal(panel.state?.on, true)
  assert.equal(panel.state?.bad, undefined)
})

test('a layout survives being written down and read back', () => {
  const layout = LAYOUT_PRESETS[2].build(BTC)
  const again = cleanLayout(JSON.parse(JSON.stringify(layout)))
  assert.deepEqual(
    panelsIn(again.root).map((one) => one.panel),
    panelsIn(layout.root).map((one) => one.panel)
  )
  assert.equal(again.instrumentId, BTC)
})

// ---------------------------------------------------------------- presets

test('every preset builds a real layout out of panels that exist', () => {
  for (const preset of LAYOUT_PRESETS) {
    const layout = preset.build(BTC)
    const panels = panelsIn(layout.root)
    assert.ok(panels.length >= 2, preset.id)
    for (const one of panels) assert.ok(PANELS.includes(one.panel), `${preset.id} wants ${one.panel}`)
    assert.ok(preset.describe.length > 10, preset.id)
    // And it survives being read back, which is what it will be on the next launch.
    assert.equal(panelsIn(cleanLayout(JSON.parse(JSON.stringify(layout))).root).length, panels.length)
  }
})

test('no two presets are the same arrangement with two names', () => {
  const shapes = LAYOUT_PRESETS.map((one) =>
    panelsIn(one.build().root)
      .map((panel) => panel.panel)
      .join()
  )
  assert.equal(new Set(shapes).size, shapes.length)
})
