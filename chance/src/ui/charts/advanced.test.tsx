// @vitest-environment jsdom
/**
 * Tests for the advanced chart components.
 *
 * The suite's centre of gravity is the "no non-finite number ever reaches an
 * SVG attribute" check: a domain spanning ±1e308, a single point, an all-
 * identical series and NaN/Infinity mixed into real data have all previously
 * produced `x="NaN"` in this codebase's scales, which removes the mark
 * silently rather than failing loudly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  AcfChart,
  BoxPlot,
  CalibrationChart,
  FanChart,
  FrontierChart,
  NetworkGraph,
  PpChart,
  PrecisionRecallChart,
  QQChart,
  RocChart,
  StepChart,
  TreeDiagram,
  assignNetworkLayers,
  layoutNetwork,
  layoutTree,
  stepPath,
  type BandMeaning,
  type TreeNode,
} from './advanced';

afterEach(cleanup);

/* ------------------------------------------------------------- Fixtures */

const stepSeries = [
  {
    label: 'Treatment',
    points: [
      { x: 0, y: 1 },
      { x: 2, y: 0.9 },
      { x: 5, y: 0.72 },
      { x: 9, y: 0.51 },
    ],
    band: [
      { x: 0, lower: 1, upper: 1 },
      { x: 2, lower: 0.78, upper: 0.97 },
      { x: 5, lower: 0.58, upper: 0.85 },
      { x: 9, lower: 0.34, upper: 0.69 },
    ],
    censored: [3, 7],
  },
  {
    label: 'Control',
    points: [
      { x: 0, y: 1 },
      { x: 3, y: 0.82 },
      { x: 8, y: 0.4 },
    ],
    dashed: true,
  },
];

const fanX = [0, 1, 2, 3, 4];
const fanBands = [
  { label: '90% band', lower: [10, 8, 6, 4, 2], upper: [10, 12, 14, 16, 18] },
  { label: '50% band', lower: [10, 9, 8.2, 7.4, 6.5], upper: [10, 11, 11.9, 12.8, 13.8] },
];
const fanCenter = { label: 'Median path', values: [10, 10.1, 10.2, 10.3, 10.4] };

const boxGroups = [
  { label: 'Control', min: 1, q1: 3, median: 5, q3: 7, max: 9, outliers: [12, -1], mean: 5.2, n: 48, medianLower: 4.4, medianUpper: 5.6 },
  { label: 'Dose A', min: 2, q1: 4, median: 6.5, q3: 8, max: 11, outliers: [15], mean: 6.6, n: 51 },
  { label: 'Dose B', min: 0.5, q1: 2, median: 3, q3: 4.5, max: 7, mean: 3.3, n: 12 },
];

const rocCurves = [
  { label: 'Model A', points: [{ fpr: 0, tpr: 0 }, { fpr: 0.1, tpr: 0.5 }, { fpr: 0.4, tpr: 0.85 }, { fpr: 1, tpr: 1 }], auc: 0.81 },
  { label: 'Model B', points: [{ fpr: 0, tpr: 0 }, { fpr: 0.3, tpr: 0.45 }, { fpr: 1, tpr: 1 }], auc: 0.62 },
];

const prCurves = [
  { label: 'Model A', points: [{ recall: 0, precision: 1 }, { recall: 0.5, precision: 0.7 }, { recall: 1, precision: 0.3 }], auc: 0.66 },
];

const qqPoints = [
  { theoretical: -1.6, sample: -1.9 },
  { theoretical: -0.6, sample: -0.5 },
  { theoretical: 0, sample: 0.1 },
  { theoretical: 0.6, sample: 0.7 },
  { theoretical: 1.6, sample: 2.1 },
];

const acfData = [
  { lag: 0, value: 1 },
  { lag: 1, value: 0.62 },
  { lag: 2, value: 0.31 },
  { lag: 3, value: 0.08 },
  { lag: 4, value: -0.27 },
];

const graphNodes = [
  { id: 'rain', label: 'Rain', badge: 'P=0.20' },
  { id: 'sprinkler', label: 'Sprinkler', badge: 'P=0.35' },
  { id: 'wet', label: 'Grass wet', badge: 'P=0.61' },
  { id: 'slip', label: 'Slippery', badge: 'P=0.44' },
];
const graphEdges = [
  { from: 'rain', to: 'wet', label: 'causes' },
  { from: 'sprinkler', to: 'wet' },
  { from: 'wet', to: 'slip', emphasis: true },
];

const treeRoot: TreeNode = {
  id: 'root',
  kind: 'decision',
  label: 'Launch?',
  value: 420,
  children: [
    {
      id: 'go',
      kind: 'chance',
      label: 'Launch',
      value: 420,
      chosen: true,
      children: [
        { id: 'go-win', kind: 'terminal', label: 'Strong demand', probability: 0.4, value: 1200, chosen: true },
        { id: 'go-lose', kind: 'terminal', label: 'Weak demand', probability: 0.6, value: -100 },
      ],
    },
    { id: 'stay', kind: 'terminal', label: 'Do not launch', value: 0 },
  ],
};

const calibrationBins = [
  { predicted: 0.05, observed: 0.03, n: 3000, lower: 0.02, upper: 0.04 },
  { predicted: 0.3, observed: 0.26, n: 800, lower: 0.22, upper: 0.3 },
  { predicted: 0.6, observed: 0.64, n: 120, lower: 0.54, upper: 0.73 },
  { predicted: 0.9, observed: 0.72, n: 3, lower: 0.2, upper: 0.98 },
];

const frontierLine = [
  { risk: 0.05, return: 0.03 },
  { risk: 0.1, return: 0.06 },
  { risk: 0.2, return: 0.09 },
  { risk: 0.3, return: 0.105 },
];
const frontierAssets = [
  { risk: 0.08, return: 0.02, label: 'Bonds' },
  { risk: 0.25, return: 0.07, label: 'Equities' },
];

/** Render each chart with representative data. */
function renderAll(): { name: string; node: React.ReactElement }[] {
  return [
    { name: 'StepChart', node: <StepChart title="Survival" description="Kaplan–Meier survival estimate by arm, with pointwise confidence bands and censoring ticks." series={stepSeries} xLabel="Months" yLabel="Surviving share" referenceLines={[{ value: 0.5, label: 'median', axis: 'y' }]} /> },
    { name: 'FanChart', node: <FanChart title="Forecast" description="Simulated path ensemble with nested quantile bands and the median path." x={fanX} bands={fanBands} center={fanCenter} bandMeaning="paths" observed={{ label: 'History', points: [{ x: -2, y: 9.4 }, { x: -1, y: 9.8 }, { x: 0, y: 10 }] }} forecastStart={0} xLabel="Year" yLabel="Level" /> },
    { name: 'BoxPlot', node: <BoxPlot title="Groups" description="Five-number summaries for three treatment groups, with means and flagged outliers." groups={boxGroups} valueLabel="Response" groupLabel="Group" /> },
    { name: 'BoxPlot horizontal', node: <BoxPlot title="Groups" description="Five-number summaries drawn horizontally." groups={boxGroups} valueLabel="Response" groupLabel="Group" orientation="horizontal" /> },
    { name: 'RocChart', node: <RocChart title="ROC" description="Receiver operating characteristic curves for two classifiers against the chance diagonal." curves={rocCurves} /> },
    { name: 'PrecisionRecallChart', node: <PrecisionRecallChart title="PR" description="Precision against recall for one classifier, with the prevalence baseline." curves={prCurves} prevalence={0.18} /> },
    { name: 'QQChart', node: <QQChart title="Q–Q" description="Sample quantiles against normal theoretical quantiles with a bootstrap envelope." points={qqPoints} referenceLine={{ slope: 1, intercept: 0, label: 'Identity' }} envelope={[{ theoretical: -1.6, lower: -2.3, upper: -1.1 }, { theoretical: 0, lower: -0.3, upper: 0.3 }, { theoretical: 1.6, lower: 1.1, upper: 2.3 }]} /> },
    { name: 'PpChart', node: <PpChart title="P–P" description="Empirical against theoretical cumulative probabilities." points={[{ theoretical: 0.1, sample: 0.12 }, { theoretical: 0.5, sample: 0.47 }, { theoretical: 0.9, sample: 0.93 }]} /> },
    { name: 'AcfChart', node: <AcfChart title="ACF" description="Autocorrelation by lag with the significance bound." data={acfData} bounds={0.3} /> },
    { name: 'AcfChart per-lag', node: <AcfChart title="ACF" description="Autocorrelation by lag with per-lag significance bounds." data={acfData} bounds={acfData.map((d) => ({ lag: d.lag, bound: 0.25 + d.lag * 0.02 }))} /> },
    { name: 'NetworkGraph', node: <NetworkGraph title="Network" description="A Bayesian network drawn as layers from causes to effects, with current marginal probabilities." nodes={graphNodes} edges={graphEdges} highlight={['rain']} /> },
    { name: 'TreeDiagram', node: <TreeDiagram title="Decision" description="A decision tree with rolled-back values and the chosen branch marked." root={treeRoot} /> },
    { name: 'CalibrationChart', node: <CalibrationChart title="Reliability" description="Observed frequency against forecast probability per bin, with marker area proportional to the bin count." bins={calibrationBins} baseRate={0.22} /> },
    { name: 'FrontierChart', node: <FrontierChart title="Frontier" description="Efficient frontier with individual assets and two highlighted portfolios." frontier={frontierLine} assets={frontierAssets} highlights={[{ risk: 0.05, return: 0.03, label: 'Minimum variance' }, { risk: 0.2, return: 0.09, label: 'Maximum Sharpe' }]} capitalMarketLine={{ riskFree: 0.01, tangencyRisk: 0.2, tangencyReturn: 0.09, label: 'Capital market line' }} /> },
  ];
}

/** Render each chart with no data at all. */
function renderAllEmpty(): { name: string; node: React.ReactElement }[] {
  return [
    { name: 'StepChart', node: <StepChart title="Survival" description="Empty." series={[]} xLabel="Months" yLabel="Surviving share" /> },
    { name: 'FanChart', node: <FanChart title="Forecast" description="Empty." x={[]} bands={[]} center={{ label: 'Median', values: [] }} bandMeaning="paths" xLabel="Year" yLabel="Level" /> },
    { name: 'BoxPlot', node: <BoxPlot title="Groups" description="Empty." groups={[]} valueLabel="Response" groupLabel="Group" /> },
    { name: 'RocChart', node: <RocChart title="ROC" description="Empty." curves={[]} /> },
    { name: 'PrecisionRecallChart', node: <PrecisionRecallChart title="PR" description="Empty." curves={[]} prevalence={0.2} /> },
    { name: 'QQChart', node: <QQChart title="Q–Q" description="Empty." points={[]} /> },
    { name: 'PpChart', node: <PpChart title="P–P" description="Empty." points={[]} /> },
    { name: 'AcfChart', node: <AcfChart title="ACF" description="Empty." data={[]} bounds={0.3} /> },
    { name: 'NetworkGraph', node: <NetworkGraph title="Network" description="Empty." nodes={[]} edges={[]} /> },
    { name: 'TreeDiagram', node: <TreeDiagram title="Decision" description="Empty." root={null} /> },
    { name: 'CalibrationChart', node: <CalibrationChart title="Reliability" description="Empty." bins={[]} baseRate={0.2} /> },
    { name: 'FrontierChart', node: <FrontierChart title="Frontier" description="Empty." frontier={[]} assets={[]} /> },
  ];
}

/* --------------------------------------------------------- Smoke renders */

describe('advanced charts render', () => {
  for (const { name, node } of renderAll()) {
    it(`${name} renders with representative data`, () => {
      const { container } = render(node);
      expect(container.querySelector('svg')).not.toBeNull();
    });
  }
});

describe('advanced charts empty states', () => {
  for (const { name, node } of renderAllEmpty()) {
    it(`${name} renders its empty state`, () => {
      const { container } = render(node);
      // The empty state replaces the plot, so there is no svg plot, but the
      // title and an explanatory message are still shown.
      expect(container.textContent ?? '').not.toBe('');
      expect(container.querySelector('.oc-chart')).not.toBeNull();
    });
  }
});

/* ------------------------------------- The non-finite-geometry guarantee */

const HUGE = 1e308;

/** Charts fed deliberately pathological data. */
function renderAllPathological(): { name: string; node: React.ReactElement }[] {
  const nasty = [0, NaN, Infinity, -Infinity, HUGE, -HUGE, 1e-320];
  return [
    {
      name: 'StepChart extreme domain',
      node: (
        <StepChart
          title="Pathological"
          description="Extreme and non-finite values."
          series={[
            { label: 'A', points: nasty.map((v, i) => ({ x: v, y: nasty[nasty.length - 1 - i] })), band: nasty.map((v) => ({ x: v, lower: -HUGE, upper: HUGE })), censored: nasty },
            { label: 'B', points: [{ x: 5, y: 5 }] },
          ]}
          xLabel="x"
          yLabel="y"
          referenceLines={[{ value: NaN, label: 'bad', axis: 'y' }, { value: HUGE, label: 'huge', axis: 'x' }]}
        />
      ),
    },
    { name: 'StepChart single point', node: <StepChart title="One" description="A single point." series={[{ label: 'A', points: [{ x: 3, y: 0.5 }] }]} xLabel="x" yLabel="y" /> },
    { name: 'StepChart identical', node: <StepChart title="Flat" description="All identical." series={[{ label: 'A', points: [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }] }]} xLabel="x" yLabel="y" yDomain={[7, 7]} /> },
    {
      name: 'FanChart extreme',
      node: (
        <FanChart
          title="Pathological"
          description="Extreme and non-finite values."
          x={nasty}
          bands={[{ label: 'band', lower: nasty.map((v) => -v), upper: nasty }]}
          center={{ label: 'Median', values: nasty }}
          bandMeaning="mean-uncertainty"
          observed={{ label: 'Observed', points: [{ x: NaN, y: Infinity }, { x: 0, y: 0 }] }}
          forecastStart={NaN}
          xLabel="x"
          yLabel="y"
        />
      ),
    },
    { name: 'FanChart single', node: <FanChart title="One" description="Single step." x={[1]} bands={[{ label: 'band', lower: [0], upper: [2] }]} center={{ label: 'Median', values: [1] }} bandMeaning="paths" xLabel="x" yLabel="y" /> },
    {
      name: 'BoxPlot extreme',
      node: (
        <BoxPlot
          title="Pathological"
          description="Extreme and non-finite summaries."
          groups={[
            { label: 'huge', min: -HUGE, q1: -HUGE / 2, median: 0, q3: HUGE / 2, max: HUGE, outliers: [NaN, Infinity, HUGE], mean: NaN, n: NaN },
            { label: 'flat', min: 4, q1: 4, median: 4, q3: 4, max: 4, mean: 4, n: 1, medianLower: NaN, medianUpper: 4 },
            { label: 'broken', min: NaN, q1: 1, median: 2, q3: 3, max: Infinity },
          ]}
          valueLabel="v"
          groupLabel="g"
        />
      ),
    },
    { name: 'BoxPlot single', node: <BoxPlot title="One" description="One group." groups={[{ label: 'only', min: 1, q1: 1, median: 1, q3: 1, max: 1 }]} valueLabel="v" groupLabel="g" /> },
    {
      name: 'RocChart extreme',
      node: <RocChart title="Pathological" description="Extreme values." curves={[{ label: 'A', points: [{ fpr: NaN, tpr: 1 }, { fpr: -HUGE, tpr: HUGE }, { fpr: 0.5, tpr: 0.5 }], auc: NaN }, { label: 'B', points: [{ fpr: 0, tpr: 0 }], auc: Infinity }]} />,
    },
    {
      name: 'PrecisionRecallChart extreme',
      node: <PrecisionRecallChart title="Pathological" description="Extreme values." curves={[{ label: 'A', points: [{ recall: Infinity, precision: NaN }, { recall: 0.5, precision: 0.5 }], auc: NaN }]} prevalence={NaN} />,
    },
    {
      name: 'QQChart extreme',
      node: (
        <QQChart
          title="Pathological"
          description="Extreme values."
          points={nasty.map((v) => ({ theoretical: v, sample: -v }))}
          referenceLine={{ slope: Infinity, intercept: NaN, label: 'bad' }}
          envelope={nasty.map((v) => ({ theoretical: v, lower: -HUGE, upper: HUGE }))}
        />
      ),
    },
    { name: 'QQChart single', node: <QQChart title="One" description="One pair." points={[{ theoretical: 2, sample: 2 }]} /> },
    { name: 'PpChart extreme', node: <PpChart title="Pathological" description="Extreme values." points={[{ theoretical: NaN, sample: Infinity }, { theoretical: 0.5, sample: 0.5 }]} /> },
    {
      name: 'AcfChart extreme',
      node: <AcfChart title="Pathological" description="Extreme values." data={[{ lag: 0, value: NaN }, { lag: 1, value: Infinity }, { lag: 2, value: HUGE }, { lag: 3, value: -HUGE }, { lag: 4, value: 0.2 }]} bounds={NaN} />,
    },
    { name: 'AcfChart single', node: <AcfChart title="One" description="One lag." data={[{ lag: 0, value: 1 }]} bounds={[{ lag: 0, bound: NaN }]} /> },
    {
      name: 'NetworkGraph pathological',
      node: (
        <NetworkGraph
          title="Pathological"
          description="Unknown targets, a self loop, a cycle and non-finite layers."
          nodes={[{ id: 'a', label: 'A', layer: NaN }, { id: 'b', label: 'B', layer: Infinity }, { id: 'c', label: 'C' }]}
          edges={[{ from: 'a', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' }, { from: 'a', to: 'missing' }]}
          highlight={['a', 'nope']}
        />
      ),
    },
    {
      name: 'TreeDiagram pathological',
      node: (
        <TreeDiagram
          title="Pathological"
          description="Non-finite values and probabilities."
          root={{ id: 'r', kind: 'decision', label: 'R', value: NaN, children: [{ id: 'x', kind: 'chance', label: 'X', probability: Infinity, value: HUGE, children: [{ id: 'y', kind: 'terminal', label: 'Y', probability: NaN, value: -HUGE }] }] }}
        />
      ),
    },
    {
      name: 'CalibrationChart extreme',
      node: (
        <CalibrationChart
          title="Pathological"
          description="Extreme bins."
          bins={[{ predicted: NaN, observed: 0.5, n: 10 }, { predicted: 0.2, observed: Infinity, n: NaN, lower: NaN, upper: 1 }, { predicted: 0.8, observed: 0.9, n: HUGE }]}
          baseRate={Infinity}
        />
      ),
    },
    { name: 'CalibrationChart single', node: <CalibrationChart title="One" description="One bin." bins={[{ predicted: 0.5, observed: 0.5, n: 1 }]} baseRate={0.5} /> },
    {
      name: 'FrontierChart extreme',
      node: (
        <FrontierChart
          title="Pathological"
          description="Extreme values."
          frontier={[{ risk: NaN, return: 1 }, { risk: 0, return: -HUGE }, { risk: HUGE, return: HUGE }]}
          assets={[{ risk: Infinity, return: NaN, label: 'bad' }, { risk: 0.1, return: 0.1, label: 'ok' }]}
          highlights={[{ risk: HUGE, return: -HUGE, label: 'extreme' }]}
          capitalMarketLine={{ riskFree: NaN, tangencyRisk: 0, tangencyReturn: Infinity, label: 'cml' }}
        />
      ),
    },
  ];
}

describe('no chart emits a non-finite number into the markup', () => {
  for (const { name, node } of renderAllPathological()) {
    it(`${name} contains no NaN or Infinity`, () => {
      const { container } = render(node);
      const html = container.innerHTML;
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Infinity');
      // Belt and braces: check every numeric-looking SVG attribute directly.
      for (const el of Array.from(container.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.value).not.toMatch(/NaN|Infinity/);
        }
      }
    });
  }

  it('representative and empty renders are also free of non-finite markup', () => {
    for (const { node } of [...renderAll(), ...renderAllEmpty()]) {
      const { container } = render(node);
      expect(container.innerHTML).not.toContain('NaN');
      expect(container.innerHTML).not.toContain('Infinity');
      cleanup();
    }
  });
});

/* ----------------------------------------------------- NetworkGraph layout */

describe('layoutNetwork', () => {
  it('is deterministic: the same input twice gives byte-identical output', () => {
    const a = JSON.stringify(layoutNetwork(graphNodes, graphEdges));
    const b = JSON.stringify(layoutNetwork(graphNodes, graphEdges));
    expect(a).toBe(b);

    const wide = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
    const wideEdges = Array.from({ length: 39 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
    expect(JSON.stringify(layoutNetwork(wide, wideEdges))).toBe(JSON.stringify(layoutNetwork(wide, wideEdges)));
  });

  it('places a node with no incoming edges in the first layer', () => {
    const { layers } = assignNetworkLayers(graphNodes, graphEdges);
    expect(layers.get('rain')).toBe(0);
    expect(layers.get('sprinkler')).toBe(0);
    const layout = layoutNetwork(graphNodes, graphEdges);
    expect(layout.nodes.find((n) => n.id === 'rain')?.layer).toBe(0);
    expect(layout.nodes.find((n) => n.id === 'sprinkler')?.layer).toBe(0);
  });

  it('gives a chain a→b→c three distinct layers', () => {
    const nodes = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
    const layout = layoutNetwork(nodes, edges);
    const byId = new Map(layout.nodes.map((n) => [n.id, n.layer]));
    expect(byId.get('a')).toBe(0);
    expect(byId.get('b')).toBe(1);
    expect(byId.get('c')).toBe(2);
    expect(new Set(layout.nodes.map((n) => n.layer)).size).toBe(3);
    // Layers run left to right, so x increases with the layer.
    const xs = layout.nodes.sort((p, q) => p.layer - q.layer).map((n) => n.x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it('assigns the longest path, not the shortest, when a node has two routes in', () => {
    // a→b→c and a→c: c must sit in layer 2, after b.
    const nodes = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
    const { layers } = assignNetworkLayers(nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }]);
    expect(layers.get('c')).toBe(2);
  });

  it('reports edges naming an unknown node instead of drawing them', () => {
    const layout = layoutNetwork([{ id: 'a', label: 'A' }], [{ from: 'a', to: 'ghost' }]);
    expect(layout.danglingEdges).toBe(1);
    expect(layout.edges).toHaveLength(0);
  });

  it('stays legible-sized and finite for 40 nodes', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, layer: i % 5 }));
    const edges = Array.from({ length: 39 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
    const layout = layoutNetwork(nodes, edges);
    expect(layout.nodes).toHaveLength(40);
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    const { container } = render(<NetworkGraph title="Big" description="Forty nodes across five layers." nodes={nodes} edges={edges} />);
    expect(container.querySelectorAll('[data-role="graph-node"]')).toHaveLength(40);
  });
});

/* ------------------------------------------------------------ Tree layout */

describe('TreeDiagram depth safety', () => {
  function deepChain(depth: number): TreeNode {
    // Built bottom-up in a loop, so constructing the fixture does not recurse.
    let node: TreeNode = { id: `n${depth}`, kind: 'terminal', label: 'leaf', value: 1 };
    for (let i = depth - 1; i >= 0; i--) {
      node = { id: `n${i}`, kind: i % 2 === 0 ? 'decision' : 'chance', label: `level ${i}`, probability: 0.5, chosen: true, children: [node] };
    }
    return node;
  }

  it('lays out a 2,000-level tree without throwing a RangeError', () => {
    const root = deepChain(2000);
    expect(() => layoutTree(root)).not.toThrow();
    const layout = layoutTree(root);
    expect(layout.truncated).toBe(true);
    // Pruned at the documented limit, so only the drawable part is laid out.
    expect(layout.nodes.length).toBeLessThanOrEqual(26);
    for (const n of layout.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it('renders a 2,000-level tree without throwing, and says it was pruned', () => {
    const { container } = render(<TreeDiagram title="Deep" description="A two-thousand-level chain, pruned at the drawing limit." root={deepChain(2000)} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('deeper than');
  });

  it('lays out the representative tree with the conventional symbols and a path listing', () => {
    const layout = layoutTree(treeRoot);
    expect(layout.nodes.map((n) => n.id)).toEqual(['root', 'go', 'go-win', 'go-lose', 'stay']);
    expect(layout.truncated).toBe(false);
    // Three root-to-leaf paths, one of them entirely on the chosen branch.
    expect(layout.paths).toHaveLength(3);
    const chosen = layout.paths.filter((p) => p.chosen);
    expect(chosen).toHaveLength(1);
    expect(chosen[0].labels).toEqual(['Launch?', 'Launch', 'Strong demand']);
    expect(chosen[0].cumulativeProbability).toBeCloseTo(0.4, 12);

    const { container } = render(<TreeDiagram title="Decision" description="Decision tree." root={treeRoot} />);
    const kinds = Array.from(container.querySelectorAll('[data-role="tree-node"]')).map((e) => e.getAttribute('data-kind'));
    expect(kinds).toEqual(['decision', 'chance', 'terminal', 'terminal', 'terminal']);
    // One square, one circle, three triangles: shape carries the kind.
    expect(container.querySelectorAll('[data-role="tree-node"] rect')).toHaveLength(1);
    expect(container.querySelectorAll('[data-role="tree-node"] circle')).toHaveLength(1);
    expect(container.querySelectorAll('[data-role="tree-branch"][data-chosen="true"]')).toHaveLength(2);
  });

  it('returns an empty layout for a missing root', () => {
    const layout = layoutTree(null);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.paths).toHaveLength(0);
  });
});

/* -------------------------------------------------------------- stepPath */

describe('stepPath', () => {
  const identity = (v: number) => v;

  it('is right-continuous: horizontal first, then vertical', () => {
    const d = stepPath([{ x: 0, y: 1 }, { x: 2, y: 0.5 }, { x: 4, y: 0.25 }], identity, identity);
    expect(d).toBe('M0.00,1.00H2.00V0.50H4.00V0.25');
    // The command sequence alternates H then V after the initial move.
    expect((d.match(/[MHV]/g) ?? []).join('')).toBe('MHVHV');
  });

  it('holds the level until the next x, rather than interpolating', () => {
    const d = stepPath([{ x: 0, y: 1 }, { x: 10, y: 0 }], identity, identity);
    // The horizontal run reaches x=10 while y is still 1; only then does it drop.
    expect(d).toBe('M0.00,1.00H10.00V0.00');
    expect(d).not.toContain('L');
  });

  it('returns an empty path rather than invalid geometry for no usable points', () => {
    expect(stepPath([], identity, identity)).toBe('');
    expect(stepPath([{ x: NaN, y: NaN }], identity, identity)).toBe('');
  });

  it('renders a right-continuous line in the chart itself', () => {
    const { container } = render(
      <StepChart title="ECDF" description="Empirical cumulative distribution function." series={[{ label: 'A', points: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 2, y: 1 }] }]} xLabel="x" yLabel="F(x)" />,
    );
    const d = container.querySelector('[data-role="step-line"]')?.getAttribute('d') ?? '';
    expect((d.match(/[MHV]/g) ?? []).join('')).toBe('MHVHV');
  });

  it('draws one censoring tick per censored observation', () => {
    const { container } = render(
      <StepChart title="Survival" description="Survival curve with censoring." series={[stepSeries[0]]} xLabel="Months" yLabel="Surviving share" />,
    );
    expect(container.querySelectorAll('[data-role="censor-tick"]')).toHaveLength(2);
  });
});

/* -------------------------------------------------------------- FanChart */

describe('FanChart band meaning', () => {
  const captions: Record<BandMeaning, string> = {
    paths: 'of simulated paths',
    'mean-uncertainty': 'confidence interval for the mean path',
  };

  for (const meaning of ['paths', 'mean-uncertainty'] as BandMeaning[]) {
    it(`renders the ${meaning} caption`, () => {
      render(
        <FanChart title="Forecast" description="Simulated ensemble." x={fanX} bands={fanBands} center={fanCenter} bandMeaning={meaning} xLabel="Year" yLabel="Level" />,
      );
      // The caption is deliberately in two places: the visible note and the
      // hidden <desc> for assistive technology.
      expect(screen.getAllByText(new RegExp(captions[meaning])).length).toBeGreaterThanOrEqual(2);
    });
  }

  it('never shows both readings at once', () => {
    const { container } = render(
      <FanChart title="Forecast" description="Simulated ensemble." x={fanX} bands={fanBands} center={fanCenter} bandMeaning="paths" xLabel="Year" yLabel="Level" />,
    );
    expect(container.textContent).toContain(captions.paths);
    expect(container.textContent).not.toContain(captions['mean-uncertainty']);
  });

  it('draws one band per supplied band, plus the central line', () => {
    const { container } = render(
      <FanChart title="Forecast" description="Simulated ensemble." x={fanX} bands={fanBands} center={fanCenter} bandMeaning="paths" xLabel="Year" yLabel="Level" />,
    );
    expect(container.querySelectorAll('[data-role="fan-band"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-role="center-line"]')).toHaveLength(1);
  });

  it('marks where the forecast begins and draws the observed series distinctly', () => {
    const { container } = render(
      <FanChart
        title="Forecast"
        description="Simulated ensemble with history."
        x={fanX}
        bands={fanBands}
        center={fanCenter}
        bandMeaning="paths"
        observed={{ label: 'History', points: [{ x: -2, y: 9.4 }, { x: 0, y: 10 }] }}
        forecastStart={0}
        xLabel="Year"
        yLabel="Level"
      />,
    );
    expect(container.querySelector('[data-role="forecast-divider"]')).not.toBeNull();
    const observed = container.querySelector('[data-role="observed-line"]');
    expect(observed?.getAttribute('stroke-dasharray')).toBe('2 3');
    expect(container.querySelector('[data-role="center-line"]')?.getAttribute('stroke-dasharray')).toBeNull();
  });
});

/* --------------------------------------------------------------- BoxPlot */

describe('BoxPlot geometry', () => {
  it('places the median line between the quartiles, and draws every outlier', () => {
    const { container } = render(
      <BoxPlot title="Groups" description="Group comparison." groups={boxGroups} valueLabel="Response" groupLabel="Group" />,
    );
    const groups = Array.from(container.querySelectorAll('[data-group]'));
    expect(groups).toHaveLength(3);

    for (const g of groups) {
      const box = g.querySelector('[data-role="box"]')!;
      const median = g.querySelector('[data-role="median"]')!;
      const top = Number(box.getAttribute('y'));
      const height = Number(box.getAttribute('height'));
      const my = Number(median.getAttribute('y1'));
      expect(Number.isFinite(my)).toBe(true);
      // The vertical axis is inverted, so q3 is the top of the box.
      expect(my).toBeGreaterThanOrEqual(top - 0.51);
      expect(my).toBeLessThanOrEqual(top + height + 0.51);
      // Both ends of the median line share one value: it is a level, not a slope.
      expect(Number(median.getAttribute('y2'))).toBeCloseTo(my, 6);
    }

    // Three outliers in total across the groups.
    expect(container.querySelectorAll('[data-role="outlier"]')).toHaveLength(3);
    // Mean shown for all three groups, as a diamond rather than a colour.
    expect(container.querySelectorAll('[data-role="mean"]')).toHaveLength(3);
    // A notch only where a median interval was supplied.
    expect(container.querySelectorAll('[data-role="median-notch"]')).toHaveLength(1);
  });

  it('shows n per group in the axis label', () => {
    const { container } = render(
      <BoxPlot title="Groups" description="Group comparison." groups={boxGroups} valueLabel="Response" groupLabel="Group" />,
    );
    expect(container.textContent).toContain('Control (n=48)');
    expect(container.textContent).toContain('Dose B (n=12)');
  });

  it('places the median between the quartiles horizontally too', () => {
    const { container } = render(
      <BoxPlot title="Groups" description="Group comparison." groups={boxGroups} valueLabel="Response" groupLabel="Group" orientation="horizontal" />,
    );
    const g = container.querySelector('[data-group="Control"]')!;
    const box = g.querySelector('[data-role="box"]')!;
    const median = g.querySelector('[data-role="median"]')!;
    const left = Number(box.getAttribute('x'));
    const width = Number(box.getAttribute('width'));
    const mx = Number(median.getAttribute('x1'));
    expect(mx).toBeGreaterThanOrEqual(left - 0.51);
    expect(mx).toBeLessThanOrEqual(left + width + 0.51);
  });
});

/* -------------------------------------------------------------- AcfChart */

describe('AcfChart significance emphasis', () => {
  it('emphasises exactly the lags beyond the bound', () => {
    const { container } = render(<AcfChart title="ACF" description="Autocorrelation by lag." data={acfData} bounds={0.3} />);
    const stems = Array.from(container.querySelectorAll('[data-role="acf-stem"]'));
    const emphasised = stems.filter((s) => s.getAttribute('data-significant') === 'true').map((s) => s.getAttribute('data-lag'));
    // |1| > 0.3, |0.62| > 0.3, |0.31| > 0.3; |0.08| and |-0.27| are not.
    expect(emphasised).toEqual(['0', '1', '2']);
    // Shape carries it: a square marker for the emphasised lags, a circle otherwise.
    for (const s of stems) {
      const significant = s.getAttribute('data-significant') === 'true';
      expect(s.querySelectorAll('rect:not([fill="transparent"])').length > 0).toBe(significant);
      expect(s.querySelectorAll('circle').length > 0).toBe(!significant);
    }
  });

  it('honours a per-lag bound', () => {
    const { container } = render(
      <AcfChart
        title="ACF"
        description="Autocorrelation by lag with per-lag bounds."
        data={[{ lag: 1, value: 0.2 }, { lag: 2, value: 0.2 }]}
        bounds={[{ lag: 1, bound: 0.1 }, { lag: 2, bound: 0.5 }]}
      />,
    );
    const emphasised = Array.from(container.querySelectorAll('[data-role="acf-stem"]'))
      .filter((s) => s.getAttribute('data-significant') === 'true')
      .map((s) => s.getAttribute('data-lag'));
    expect(emphasised).toEqual(['1']);
  });

  it('emphasises nothing when no usable bound was supplied', () => {
    const { container } = render(<AcfChart title="ACF" description="Autocorrelation by lag." data={acfData} bounds={NaN} />);
    expect(container.querySelectorAll('[data-role="acf-stem"][data-significant="true"]')).toHaveLength(0);
    expect(container.querySelector('[data-role="acf-zero"]')).not.toBeNull();
  });
});

/* ------------------------------------------------ ROC, PR and calibration */

describe('ROC and precision–recall', () => {
  it('draws the chance diagonal and states every AUC', () => {
    const { container } = render(<RocChart title="ROC" description="Two classifiers." curves={rocCurves} />);
    expect(container.querySelector('[data-role="chance-diagonal"]')?.getAttribute('stroke-dasharray')).toBe('5 4');
    expect(container.textContent).toContain('no better than chance');
    expect(container.textContent).toContain('AUC 0.81');
    expect(container.textContent).toContain('AUC 0.62');
    expect(container.querySelectorAll('[data-role="roc-curve"]')).toHaveLength(2);
  });

  it('draws the prevalence baseline the caller supplied', () => {
    const { container } = render(<PrecisionRecallChart title="PR" description="One classifier." curves={prCurves} prevalence={0.18} />);
    expect(container.querySelector('[data-role="prevalence-baseline"]')).not.toBeNull();
    expect(container.textContent).toContain('prevalence 18%');
  });

  it('omits the baseline rather than inventing one when no prevalence is usable', () => {
    const { container } = render(<PrecisionRecallChart title="PR" description="One classifier." curves={prCurves} prevalence={NaN} />);
    expect(container.querySelector('[data-role="prevalence-baseline"]')).toBeNull();
    expect(container.textContent).toContain('No prevalence was supplied');
  });
});

describe('CalibrationChart', () => {
  it('sizes markers by bin count so sparse bins look sparse', () => {
    const { container } = render(<CalibrationChart title="Reliability" description="Reliability diagram." bins={calibrationBins} baseRate={0.22} />);
    const bins = Array.from(container.querySelectorAll('[data-role="calibration-bin"]'));
    expect(bins).toHaveLength(4);
    const radii = bins.map((b) => Number(Array.from(b.querySelectorAll('circle')).pop()?.getAttribute('r')));
    // n = 3000, 800, 120, 3: the marker for the three-observation bin is the smallest.
    expect(radii[0]).toBeGreaterThan(radii[1]);
    expect(radii[1]).toBeGreaterThan(radii[2]);
    expect(radii[2]).toBeGreaterThan(radii[3]);
  });

  it('draws the perfect-calibration diagonal, the base rate and the error bars', () => {
    const { container } = render(<CalibrationChart title="Reliability" description="Reliability diagram." bins={calibrationBins} baseRate={0.22} />);
    expect(container.querySelector('[data-role="calibration-diagonal"]')?.getAttribute('stroke-dasharray')).toBe('5 4');
    expect(container.querySelector('[data-role="base-rate"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-role="calibration-interval"]')).toHaveLength(4);
    expect(container.querySelector('[data-role="forecast-histogram"]')).not.toBeNull();
  });
});

/* --------------------------------------------------------- FrontierChart */

describe('FrontierChart', () => {
  it('direct-labels the highlighted portfolios', () => {
    const { container } = render(
      <FrontierChart
        title="Frontier"
        description="Efficient frontier."
        frontier={frontierLine}
        assets={frontierAssets}
        highlights={[{ risk: 0.05, return: 0.03, label: 'Minimum variance' }, { risk: 0.2, return: 0.09, label: 'Maximum Sharpe' }]}
        capitalMarketLine={{ riskFree: 0.01, tangencyRisk: 0.2, tangencyReturn: 0.09, label: 'Capital market line' }}
      />,
    );
    expect(container.textContent).toContain('Minimum variance');
    expect(container.textContent).toContain('Maximum Sharpe');
    expect(container.querySelectorAll('[data-role="highlight-point"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-role="asset-point"]')).toHaveLength(2);
    expect(container.querySelector('[data-role="frontier-line"]')).not.toBeNull();
    expect(container.querySelector('[data-role="capital-market-line"]')).not.toBeNull();
  });

  it('omits an unusable capital market line rather than drawing a guess', () => {
    const { container } = render(
      <FrontierChart title="Frontier" description="Efficient frontier." frontier={frontierLine} assets={frontierAssets} capitalMarketLine={{ riskFree: 0.01, tangencyRisk: 0, tangencyReturn: 0.09, label: 'cml' }} />,
    );
    expect(container.querySelector('[data-role="capital-market-line"]')).toBeNull();
  });
});

/* ---------------------------------------------------- Shared obligations */

describe('shared chart obligations', () => {
  it('every chart offers the values as a table', () => {
    for (const { name, node } of renderAll()) {
      const { container } = render(node);
      const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
      expect(buttons.some((t) => t.includes('Show values')), `${name} has no table alternative`).toBe(true);
      cleanup();
    }
  });

  it('every chart carries a hidden description for assistive technology', () => {
    for (const { name, node } of renderAll()) {
      const { container } = render(node);
      const desc = container.querySelector('desc');
      expect(desc, `${name} has no <desc>`).not.toBeNull();
      expect((desc?.textContent ?? '').length, `${name} has an empty description`).toBeGreaterThan(20);
      cleanup();
    }
  });

  it('says so in the note when non-finite values were dropped', () => {
    const { container } = render(
      <StepChart title="Survival" description="Survival with some unusable values." series={[{ label: 'A', points: [{ x: 0, y: 1 }, { x: NaN, y: 0.5 }, { x: 2, y: 0.4 }] }]} xLabel="Months" yLabel="Surviving share" />,
    );
    expect(container.textContent).toContain('not a finite number');
  });
});
