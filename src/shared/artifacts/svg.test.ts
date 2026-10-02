import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlot, isPlotError, seriesFromPoints } from '../compute/plot.ts'
import { hashOf } from '../compute/interchange.ts'
import { flowToArtifact, levelsOf } from './diagram.ts'
import { diagramToSvg, pieProblem, pieToSvg, plotToSvg, verifySvgFile } from './svg.ts'

const plot = (series: Parameters<typeof buildPlot>[1], options: Parameters<typeof buildPlot>[2] = {}) => {
  const made = buildPlot('p', series, options)
  if (isPlotError(made)) throw new Error(made.message)
  return made
}

const count = (svg: string, tag: string): number => (svg.match(new RegExp(`<${tag}[\\s/>]`, 'g')) ?? []).length

test('a line plot has axes with readable ticks, a path per series, and a legend when there is more than one', () => {
  const a = seriesFromPoints('a', 'Consumption', [1, 2, 3, 4, 5].map((x) => ({ x, y: x * 10 })), { kind: 'line', provenance: 'measured' })
  const b = seriesFromPoints('b', 'Model', [1, 2, 3, 4, 5].map((x) => ({ x, y: x * 8 + 3 })), { kind: 'line', provenance: 'simulated' })
  const { svg, notes } = plotToSvg(plot([a, b], { title: 'Energy', x: { label: 'Day' }, y: { label: 'MWh' } }))
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(svg.includes('>Energy</text>'))
  assert.ok(svg.includes('>Day</text>'))
  assert.ok(svg.includes('>MWh</text>'))
  assert.equal(count(svg, 'path'), 2)
  assert.ok(svg.includes('stroke-dasharray'), 'a simulated series is dashed')
  assert.ok(svg.includes('Model (simulated)'), 'and the legend says so')
  assert.ok(count(svg, 'text') > 8, 'ticks have labels')
  assert.ok(Array.isArray(notes))
})

test('bars start from zero even when the data does not go near it', () => {
  const s = seriesFromPoints('s', 'Sites', [{ x: 1, y: 412 }, { x: 2, y: 288 }, { x: 3, y: 530 }], { kind: 'bar' })
  const made = plot([s])
  // The engine includes zero and then pads the range a little past it; the baseline the bars stand on is still zero.
  assert.ok(made.y.range.low <= 0 && made.y.range.high >= 530)
  const { svg } = plotToSvg(made)
  const rects = [...svg.matchAll(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)" fill="#/g)].map((m) => ({ y: Number(m[1]), h: Number(m[2]) }))
  assert.equal(rects.length, 3)
  const bottoms = rects.map((r) => Math.round(r.y + r.h))
  assert.equal(new Set(bottoms).size, 1, 'every bar ends on the same baseline')
  const tallest = rects.reduce((a, b) => (b.h > a.h ? b : a))
  assert.ok(tallest.h > rects[1].h * 1.7, '530 is drawn proportionally taller than 288')
})

test('a break in a series is a break in the drawing, not a line across it', () => {
  const gapped = seriesFromPoints('g', 'Gapped', [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 10, y: 3 }, { x: 11, y: 4 }], { kind: 'line', gapLargerThan: 3 })
  assert.equal(gapped.segments.length, 2)
  const { svg } = plotToSvg(plot([gapped]))
  assert.equal(count(svg, 'path'), 2, 'one path per segment')
})

test('a very long series is decimated with the count said, and never silently', () => {
  const long = seriesFromPoints('l', 'Long', Array.from({ length: 50_000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) * 100 + (i % 997 === 0 ? 500 : 0) })), { kind: 'line' })
  const { svg, notes } = plotToSvg(plot([long]))
  assert.ok(svg.length < 400_000, 'the file is bounded')
  assert.ok(notes.some((one) => /reduced to|drawn/.test(one)), notes.join(' | '))
})

test('error bars are drawn one per point', () => {
  const s = seriesFromPoints('e', 'Measured', [{ x: 1, y: 10 }, { x: 2, y: 12 }], { kind: 'scatter', errorY: [1, 2] })
  const { svg } = plotToSvg(plot([s]))
  assert.equal(count(svg, 'circle'), 2)
  assert.ok(count(svg, 'line') >= 6, 'a stem and two caps per point, on top of the grid')
})

test('labels are escaped', () => {
  const s = seriesFromPoints('x', 'A<b>&"c"', [{ x: 1, y: 1 }, { x: 2, y: 2 }], { kind: 'line' })
  const t = seriesFromPoints('y', 'Other', [{ x: 1, y: 2 }, { x: 2, y: 1 }], { kind: 'line' })
  const { svg } = plotToSvg(plot([s, t], { title: '<script>' }))
  assert.equal(svg.includes('<script>'), false)
  assert.ok(svg.includes('&lt;script&gt;'))
  assert.ok(svg.includes('A&lt;b&gt;&amp;&quot;c&quot;'))
})

test('a flowchart is laid out by level, with a loop back drawn as a loop', () => {
  const levels = levelsOf(
    [
      { id: 'start', label: 'Start', shape: 'start' },
      { id: 'check', label: 'Valid?', shape: 'decision' },
      { id: 'fix', label: 'Fix it', shape: 'step' },
      { id: 'done', label: 'Done', shape: 'end' }
    ],
    [
      { from: 'start', to: 'check', label: '' },
      { from: 'check', to: 'done', label: 'yes' },
      { from: 'check', to: 'fix', label: 'no' },
      { from: 'fix', to: 'check', label: '' }
    ]
  )
  assert.equal(levels.get('start'), 0)
  assert.equal(levels.get('check'), 1)
  assert.equal(levels.get('fix'), 2)
  assert.equal(levels.get('done'), 2)
})

test('a flowchart becomes an editable diagram and draws with boxes, arrows and labels', () => {
  const artifact = flowToArtifact({
    title: 'Login',
    nodes: [
      { id: 'a', label: 'Enter details', shape: 'start' },
      { id: 'b', label: 'Password right?', shape: 'decision' },
      { id: 'c', label: 'Signed in', shape: 'end' }
    ],
    edges: [
      { from: 'a', to: 'b', label: '' },
      { from: 'b', to: 'c', label: 'yes' },
      { from: 'b', to: 'a', label: 'no' },
      { from: 'b', to: 'nowhere', label: '' }
    ]
  })
  assert.equal(artifact.objects.length, 3)
  assert.equal(artifact.connectors.length, 3, 'an edge to a node that is not there is dropped')
  assert.equal(artifact.objects[1].type, 'decision')
  // The "no" loop back runs under the boxes, not through them: down, along a lane, and up into the first box.
  const loop = artifact.connectors[2]
  assert.equal(loop.waypoints.length, 2)
  const lowest = Math.max(...artifact.objects.map((one) => one.box.y + one.box.height))
  assert.ok(loop.waypoints.every((one) => one.y > lowest), 'the lane is below every box')
  assert.equal(loop.waypoints[0].x, artifact.objects[1].box.x + artifact.objects[1].box.width / 2, 'it leaves from the middle of the decision')
  assert.equal(loop.waypoints[1].x, artifact.objects[0].box.x + artifact.objects[0].box.width / 2, 'and arrives at the middle of the start')
  assert.deepEqual(artifact.connectors[0].waypoints, [], 'a forward edge is a straight line')
  const { svg, notes } = diagramToSvg(artifact)
  const loopPath = [...svg.matchAll(/<path d="([^"]+)" fill="none"/g)].map((m) => m[1]).find((d) => d.split(' ').length >= 8)
  assert.ok(loopPath, 'the loop is drawn with four points')
  assert.match(loopPath!, /^M\d+(?:\.\d+)? 80 /, 'it starts at the bottom edge of the decision')
  const paperHeight = Number(/<svg[^>]* height="(\d+)"/.exec(svg)?.[1])
  const lowestBend = Math.max(...loopPath!.split(' ').filter((_, i) => i % 2 === 1).map(Number))
  assert.ok(paperHeight > lowestBend, 'the paper is tall enough to hold the loop')
  assert.equal(count(svg, 'polygon'), 1, 'a decision is a diamond')
  assert.equal(count(svg, 'rect'), 1 + 2 + 2, 'paper, two boxes, two label backgrounds')
  assert.ok(svg.includes('marker-end="url(#arrow)"'))
  assert.ok(svg.includes('>yes</text>'))
  assert.ok(svg.includes('>Password right?</text>'))
  assert.equal(notes.length, 0)
})

test('a loop back never runs through a box: over the top when a box sits below, round the outside when boxed in', () => {
  const boxes = (artifact: ReturnType<typeof flowToArtifact>) => artifact.objects.map((one) => one.box)
  /** True when any straight piece of the route passes through the inside of a box that is not one of its ends. */
  const crosses = (artifact: ReturnType<typeof flowToArtifact>, connectorIndex: number): boolean => {
    const connector = artifact.connectors[connectorIndex]
    const ends = new Set([connector.from, connector.to])
    const centre = (id: string) => {
      const box = artifact.objects.find((one) => one.id === id)!.box
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const points = [centre(connector.from), ...connector.waypoints, centre(connector.to)]
    const others = artifact.objects.filter((one) => !ends.has(one.id)).map((one) => one.box)
    for (let i = 0; i + 1 < points.length; i++) {
      for (let t = 0; t <= 1; t += 0.01) {
        const x = points[i].x + (points[i + 1].x - points[i].x) * t
        const y = points[i].y + (points[i + 1].y - points[i].y) * t
        if (others.some((box) => x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height)) return true
      }
    }
    return false
  }

  // "Try again" has "Signed in" under it, so its loop back to "Enter details" goes over the top.
  const signIn = flowToArtifact({
    title: 'Sign in',
    nodes: [
      { id: 'start', label: 'Start', shape: 'start' },
      { id: 'enter', label: 'Enter details', shape: 'step' },
      { id: 'ok', label: 'Right?', shape: 'decision' },
      { id: 'again', label: 'Try again', shape: 'step' },
      { id: 'done', label: 'Signed in', shape: 'end' }
    ],
    edges: [
      { from: 'start', to: 'enter', label: '' },
      { from: 'enter', to: 'ok', label: '' },
      { from: 'ok', to: 'again', label: 'no' },
      { from: 'ok', to: 'done', label: 'yes' },
      { from: 'again', to: 'enter', label: '' }
    ]
  })
  const over = signIn.connectors[4]
  assert.equal(over.waypoints.length, 2)
  assert.ok(over.waypoints.every((one) => one.y < Math.min(...boxes(signIn).map((box) => box.y))), 'the lane is above every box')
  assert.equal(crosses(signIn, 4), false)
  const drawn = diagramToSvg(signIn)
  assert.equal(drawn.notes.length, 0)
  assert.ok(Number(/<svg[^>]* height="(\d+)"/.exec(drawn.svg)?.[1]) >= 96 + 56 + 28 + 48, 'the paper grows to hold the lane above')

  // A loop from the middle of a column to the middle of another has boxes above and below both ends: it goes out
  // through the gaps between columns and along a lane under everything.
  const boxedIn = flowToArtifact({
    title: 'Boxed in',
    nodes: [
      { id: 's', label: 'S', shape: 'start' },
      { id: 'a1', label: 'A1', shape: 'step' },
      { id: 'a2', label: 'A2', shape: 'step' },
      { id: 'a3', label: 'A3', shape: 'step' },
      { id: 'b1', label: 'B1', shape: 'step' },
      { id: 'b2', label: 'B2', shape: 'step' },
      { id: 'b3', label: 'B3', shape: 'step' }
    ],
    edges: [
      { from: 's', to: 'a1', label: '' },
      { from: 's', to: 'a2', label: '' },
      { from: 's', to: 'a3', label: '' },
      { from: 'a1', to: 'b1', label: '' },
      { from: 'a2', to: 'b2', label: '' },
      { from: 'a3', to: 'b3', label: '' },
      { from: 'b2', to: 'a2', label: 'again' }
    ]
  })
  const round = boxedIn.connectors[6]
  assert.equal(round.waypoints.length, 4)
  assert.equal(crosses(boxedIn, 6), false)

  // A step that leads back to itself is a small loop under its own box, not a dot.
  const self = flowToArtifact({ title: 'Self', nodes: [{ id: 'a', label: 'Wait', shape: 'step' }], edges: [{ from: 'a', to: 'a', label: 'not yet' }] })
  assert.equal(self.connectors[0].waypoints.length, 2)
  assert.notEqual(self.connectors[0].waypoints[0].x, self.connectors[0].waypoints[1].x)
})

test('an SVG file is read back as SVG with something drawn in it', () => {
  const s = seriesFromPoints('s', 'S', [{ x: 1, y: 1 }, { x: 2, y: 3 }], { kind: 'line' })
  const { svg } = plotToSvg(plot([s]))
  const bytes = new TextEncoder().encode(svg)
  const good = verifySvgFile({ bytes: bytes.length, hash: hashOf(bytes) }, bytes)
  assert.equal(good.ok, true, JSON.stringify(good.checks))
  assert.deepEqual(good.checks.map((one) => one.what), ['written', 'checksum', 'svg', 'drawn'])
  const junk = new TextEncoder().encode('<html>no</html>')
  const bad = verifySvgFile({ bytes: junk.length, hash: hashOf(junk) }, junk)
  assert.equal(bad.ok, false)
  assert.equal(bad.checks.find((one) => one.what === 'svg')?.passed, false)
})

test('a long flow runs down the page, and its loop back goes along the side without crossing a box', () => {
  const steps = ['Order placed', 'Payment taken', 'Stock checked', 'Packed', 'Label printed', 'Collected', 'Delivered']
  const long = flowToArtifact({
    title: 'Order',
    nodes: steps.map((label, i) => ({ id: `s${i}`, label, shape: i === 0 ? ('start' as const) : i === steps.length - 1 ? ('end' as const) : ('step' as const) })),
    edges: [...steps.slice(1).map((_, i) => ({ from: `s${i}`, to: `s${i + 1}`, label: '' })), { from: 's3', to: 's1', label: 'out of stock' }]
  })
  const xs = new Set(long.objects.map((one) => one.box.x))
  assert.equal(xs.size, 1, 'one column')
  assert.deepEqual(long.objects.map((one) => one.box.y), steps.map((_, i) => i * 96), 'each step under the one before')
  const loop = long.connectors[long.connectors.length - 1]
  assert.equal(loop.waypoints.length, 2)
  const right = Math.max(...long.objects.map((one) => one.box.x + one.box.width))
  assert.ok(loop.waypoints.every((one) => one.x > right), 'the lane runs beside the column, not through it')
  assert.equal(loop.waypoints[0].y, long.objects[3].box.y + 28, 'level with the middle of the box it leaves')
  const { svg } = diagramToSvg(long)
  const width = Number(/<svg[^>]* width="(\d+)"/.exec(svg)?.[1])
  const height = Number(/<svg[^>]* height="(\d+)"/.exec(svg)?.[1])
  assert.ok(height > width, 'taller than it is wide')
  assert.ok(width < 320, `narrow enough to read at full size (${width})`)
  assert.ok(svg.includes('>out of stock</text>'))

  // A short flow still runs across.
  const short = flowToArtifact({ title: 'Short', nodes: [{ id: 'a', label: 'A', shape: 'start' }, { id: 'b', label: 'B', shape: 'end' }], edges: [{ from: 'a', to: 'b', label: '' }] })
  assert.equal(short.objects[1].box.y, short.objects[0].box.y)
  assert.ok(short.objects[1].box.x > short.objects[0].box.x)
})

test('every bar sits inside the frame, whether there are two of them or twenty', () => {
  for (const n of [1, 2, 6, 20]) {
    const a = seriesFromPoints('a', 'A', Array.from({ length: n }, (_, i) => ({ x: i, y: 100 + i * 7 })), { kind: 'bar' })
    const b = seriesFromPoints('b', 'B', Array.from({ length: n }, (_, i) => ({ x: i, y: 40 + i })), { kind: 'bar' })
    const made = plot([a, b])
    assert.ok(made.x.range.low < 0 && made.x.range.high > n - 1, `${n}: the axis runs past the first and last bar`)
    const { svg } = plotToSvg(made)
    const frame = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" fill="none" stroke="#c9ced8"/.exec(svg)
    assert.ok(frame, `${n}: there is a frame`)
    const left = Number(frame![1])
    const right = left + Number(frame![2])
    const bars = [...svg.matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)" height="[\d.]+" fill="#[0-9a-fA-F]+" fill-opacity="0\.9"\/>/g)].map((m) => ({ x: Number(m[1]), w: Number(m[2]) }))
    assert.equal(bars.length, n * 2, `${n}: two bars for each x`)
    for (const bar of bars) {
      assert.ok(bar.x >= left - 0.5, `${n}: a bar starts at ${bar.x}, left of the frame at ${left}`)
      assert.ok(bar.x + bar.w <= right + 0.5, `${n}: a bar ends at ${bar.x + bar.w}, right of the frame at ${right}`)
    }
  }
  // A range somebody insisted on is left alone.
  const fixed = plot([seriesFromPoints('a', 'A', [{ x: 0, y: 1 }, { x: 1, y: 2 }], { kind: 'bar' })], { x: { range: { low: 0, high: 1 } } })
  assert.deepEqual([fixed.x.range.low, fixed.x.range.high], [0, 1])
})

const categories = (values: number[], labels: string[]) => {
  const made = plot([seriesFromPoints('a', 'Spend', values.map((y, x) => ({ x, y })), { kind: 'bar', provenance: 'measured' })], { title: 'Spend by category' })
  return { ...made, x: { ...made.x, ticks: labels.map((label, value) => ({ value, label, major: true })) } }
}

test('a pie is one slice per row, each its share of the total, with the amounts and shares written beside it', () => {
  const { svg, notes } = pieToSvg(categories([50, 30, 20], ['Rent', 'Food', 'Travel']))
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.equal(count(svg, 'path'), 3, 'three slices')
  assert.ok(svg.includes('>Spend by category</text>'))
  for (const said of ['>Rent</text>', '>Food</text>', '>Travel</text>', '50  ·  50.0%', '30  ·  30.0%', '20  ·  20.0%', 'Spend: 100 in all']) assert.ok(svg.includes(said), said)
  assert.ok(notes.some((one) => /Each slice is its share of the total, 100\./.test(one)))
  // The first slice starts at twelve o'clock and covers half the circle: its arc ends straight below the centre.
  const first = /<path d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+) A[\d.]+ [\d.]+ 0 (\d) 1 ([\d.]+) ([\d.]+) Z"/.exec(svg)
  assert.ok(first)
  const [cx, cy, x1, y1, , x2, y2] = first.slice(1).map(Number)
  assert.ok(Math.abs(x1 - cx) < 0.01 && y1 < cy, 'starts above the centre')
  assert.ok(Math.abs(x2 - cx) < 0.01 && y2 > cy, 'and half the whole ends below it')
})

test('one slice that is the whole is a circle, a zero is listed and not drawn, and shares are of what is there', () => {
  const whole = pieToSvg(categories([42], ['Everything'])).svg
  assert.equal(count(whole, 'path'), 0)
  assert.equal(count(whole, 'circle'), 1)
  assert.ok(whole.includes('42  ·  100.0%'))

  const withZero = pieToSvg(categories([1, 0, 3], ['a', 'b', 'c'])).svg
  assert.equal(count(withZero, 'path'), 2)
  assert.ok(withZero.includes('0  ·  0.0%'))
  assert.ok(withZero.includes('3  ·  75.0%'))
  assert.ok(pieToSvg(categories([1.5, 2.25], ['a <b>', 'c & d'])).svg.includes('a &lt;b&gt;'), 'labels are escaped')
})

test('what is not shares of one whole is refused in words, not drawn', () => {
  assert.equal(pieProblem(categories([50, 30, 20], ['a', 'b', 'c'])), null)
  assert.match(pieProblem(categories([5, -1], ['a', 'b'])) ?? '', /below zero/)
  assert.match(pieProblem(categories([0, 0], ['a', 'b'])) ?? '', /Every amount is zero/)
  assert.match(pieProblem(categories(Array.from({ length: 13 }, (_, i) => i + 1), Array.from({ length: 13 }, (_, i) => `c${i}`))) ?? '', /13 slices cannot be read: 12 is the most/)
  const two = plot([
    seriesFromPoints('a', 'A', [{ x: 0, y: 1 }], { kind: 'bar', provenance: 'measured' }),
    seriesFromPoints('b', 'B', [{ x: 0, y: 2 }], { kind: 'bar', provenance: 'measured' })
  ])
  assert.match(pieProblem(two) ?? '', /shares of one column/)
})
