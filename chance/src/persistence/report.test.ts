/**
 * Tests for the investigation report builder.
 *
 * The things that matter here are not formatting niceties: a report is read by
 * someone who was not there when it was produced. So these tests check that a
 * result which does not exist is reported as missing rather than filled in,
 * that a refusal is carried through verbatim, that an interval keeps the kind
 * of statement it is, and that hostile text cannot inject markup.
 */
import { describe, expect, it } from 'vitest';
import {
  buildReportMarkdown,
  configurationRows,
  escapeMarkdown,
  humaniseKey,
  reportFilename,
  type ReportInput,
  type ReportSection,
} from './report';
import { investigationSchema, type Investigation } from './schema';
import type { Explanation } from '../engine/core/result';

function makeInvestigation(over: Partial<Investigation> = {}): Investigation {
  const now = '2026-03-04T10:11:12.000Z';
  return investigationSchema.parse({
    id: 'inv-1',
    name: 'Supplier failure exposure',
    description: 'How much could a supplier failure cost over a year?',
    toolId: 'risk',
    config: { mode: 'aggregate', aggregate: { threshold: 50000, unit: 'GBP', useCap: false }, levels: [0.95, 0.99] },
    simulation: { trials: 100000, seed: 'risk-1', keepSamples: true },
    assumptions: ['The failure rate is assumed constant over the period.'],
    tags: ['supply chain'],
    createdAt: now,
    updatedAt: now,
    ...over,
  });
}

const TOOL = { name: 'Risk explorer', description: 'An aggregate loss model with Value at Risk.', category: 'Analysis' };

function build(sections: ReportSection[], over: Partial<ReportInput> = {}): string {
  return buildReportMarkdown({
    investigation: makeInvestigation(),
    tool: TOOL,
    content: { sections },
    generatedAt: new Date('2026-03-05T09:00:00.000Z'),
    ...over,
  });
}

describe('report header and configuration', () => {
  it('names the investigation, the tool and the date, and renders the configuration as a table', () => {
    const md = build([]);
    expect(md).toContain('# Investigation report: Supplier failure exposure');
    expect(md).toContain('Risk explorer (Analysis)');
    expect(md).toContain('| Setting | Value |');
    // Readable settings, not raw JSON.
    expect(md).toContain('Aggregate › Threshold');
    expect(md).toContain('50,000');
    expect(md).not.toContain('"aggregate"');
    // Simulation provenance, so the figures can be reproduced.
    expect(md).toContain('100,000 trials, seed risk-1');
  });

  it('humanises configuration keys and flattens nesting without losing values', () => {
    expect(humaniseKey('perEventCap')).toBe('Per event cap');
    expect(humaniseKey('seasonal_d')).toBe('Seasonal d');
    const { rows } = configurationRows({ a: { b: 2 }, list: [1, 2, 3], empty: [], nothing: null });
    expect(rows).toEqual(
      expect.arrayContaining([
        { label: 'A › B', value: 2 },
        { label: 'List', value: '1, 2, 3', note: undefined },
        { label: 'Empty', value: '(empty list)' },
        { label: 'Nothing', value: null },
      ]),
    );
  });

  it('includes the provenance footer, naming the application and local computation', () => {
    const md = build([]);
    expect(md).toContain('## Provenance');
    expect(md).toContain('Orbis Chance');
    expect(md).toContain('computed locally on this computer; nothing was uploaded');
    // The 'assumed' label is explained as a judgement rather than a measurement.
    expect(md).toContain('it is a stated judgement');
    // No local file paths anywhere.
    expect(md).not.toMatch(/\/(home|Users|var|tmp)\//);
  });

  it('builds a file name with no path in it', () => {
    const name = reportFilename('Supplier failure exposure', new Date('2026-03-05T09:00:00.000Z'));
    expect(name).toBe('supplier-failure-exposure-report-2026-03-05.md');
    expect(name).not.toContain('/');
  });
});

describe('a section with no result present', () => {
  it('says exactly what is missing and invents no number', () => {
    const md = build([
      {
        title: 'Aggregate loss model',
        missing: 'The loss simulation had not been run, so there is no Value at Risk to report.',
      },
    ]);
    expect(md).toContain('### Aggregate loss model');
    expect(md).toContain('**No result available.** The loss simulation had not been run');
    // Nothing that could be read as a figure.
    expect(md).not.toMatch(/\|\s*Figure\s*\|/);
  });

  it('states plainly that no results were supplied when a screen supplies none', () => {
    const md = buildReportMarkdown({
      investigation: makeInvestigation(),
      tool: TOOL,
      generatedAt: new Date('2026-03-05T09:00:00.000Z'),
    });
    expect(md).toContain('**No results are included in this report.**');
    expect(md).toContain('a configuration states what would be computed, not what was computed');
    // The configuration is still there.
    expect(md).toContain('| Setting | Value |');
  });

  it('marks a stored summary figure as stored rather than computed for the report', () => {
    const md = buildReportMarkdown({
      investigation: makeInvestigation({
        resultSummary: { label: 'Expected loss', headline: '24,180 GBP', computedAt: '2026-03-01T00:00:00.000Z', fromSimulation: true },
      }),
      tool: TOOL,
      noResultsReason: 'Exported from the saved-investigations list, where the results are not on screen.',
      generatedAt: new Date('2026-03-05T09:00:00.000Z'),
    });
    expect(md).toContain('Exported from the saved-investigations list');
    expect(md).toContain('Summary figure saved with the investigation');
    expect(md).toContain('It is a stored summary, not a result computed for this report');
    expect(md).toContain('24,180 GBP');
  });
});

describe('a refusal', () => {
  it('carries the EngineError message through instead of omitting the row', () => {
    const md = build([
      {
        title: 'Risk register',
        refusal: 'At least 2 simulated outcomes are needed to compute risk metrics.',
      },
    ]);
    expect(md).toContain('**No result: the computation was refused.**');
    expect(md).toContain('> At least 2 simulated outcomes are needed to compute risk metrics.');
    expect(md).toContain('A refusal is the result here');
  });

  it('keeps a refused subsection beside sections that succeeded', () => {
    const md = build([
      {
        title: 'Combining two sources',
        rows: [{ label: 'Conflict mass', value: 0.25 }],
        subsections: [
          { title: "Dempster's rule", refusal: 'The two sources are in total conflict; Dempster’s rule is undefined.' },
          { title: "Yager's rule", rows: [{ label: 'Belief', value: 0.4 }] },
        ],
      },
    ]);
    expect(md).toContain('#### Dempster&amp;#x27;s rule'.replace('&amp;#x27;', "\\'").slice(0, 10));
    expect(md).toContain('total conflict');
    expect(md).toContain('Belief');
  });
});

describe('interval results', () => {
  it('keeps a confidence interval for an estimate textually distinct from simulated percentiles', () => {
    const md = build([
      {
        title: 'Headline risk figures',
        exactness: 'empirical',
        intervals: [
          { label: 'the expected total loss', kind: 'confidence-interval', lower: 23900, upper: 24460, level: 0.95 },
          {
            label: 'the total loss in a single period',
            kind: 'simulated-percentile-range',
            lower: 0,
            upper: 96000,
            percentiles: [5, 95],
          },
        ],
      },
    ]);
    expect(md).toContain('**95% confidence interval for the expected total loss:** 23,900 to 24,460');
    expect(md).toContain('it is not a range of individual outcomes');
    expect(md).toContain('**Simulated outcomes, 5th to 95th percentile of the total loss in a single period:** 0 to 96,000');
    expect(md).toContain('not a confidence interval for any estimate');
    // The two statements must not be rendered by the same sentence.
    expect(md.indexOf('confidence interval for the expected total loss')).not.toBe(
      md.indexOf('Simulated outcomes, 5th to 95th percentile'),
    );
  });

  it('reports a bound as a bound, with no best guess between the ends', () => {
    const md = build([
      {
        title: 'Lower and upper probability of {rain, snow}',
        exactness: 'exact',
        intervals: [{ label: 'the probability of {rain, snow}', kind: 'bound', lower: 0.2, upper: 0.75 }],
      },
    ]);
    expect(md).toContain('**Bound on the probability of {rain, snow} (lower, upper):** 0.2 to 0.75');
    expect(md).toContain('No value between them is a best guess');
  });

  it('distinguishes a prediction interval from both of the others', () => {
    const md = build([
      {
        title: 'Forecast',
        intervals: [{ label: 'the observation at step h = 6', kind: 'prediction-interval', lower: 101, upper: 140, level: 0.9 }],
      },
    ]);
    expect(md).toContain('**90% prediction interval for the observation at step h = 6:** 101 to 140');
    expect(md).toContain('range for a single future observation');
  });

  it('prints an unavailable interval end as unavailable rather than as zero', () => {
    const md = build([
      { title: 'Forecast', intervals: [{ label: 'the next observation', kind: 'prediction-interval', lower: null, upper: undefined }] },
    ]);
    expect(md).toContain('not available to not available');
    expect(md).not.toContain('0 to 0');
  });
});

describe('explanations, charts and warnings', () => {
  const explanation: Explanation = {
    method: 'Monte Carlo over the compound loss model',
    formula: 'VaR_p = inf { x : F(x) >= p }',
    steps: [{ label: 'Sort the simulated totals', expression: 'sort(x)', value: '100,000 values' }],
    assumptions: ['Event counts are independent of severities.'],
    limitations: ['Tail figures at 99.9% need far more trials than this run used.'],
    exactness: 'empirical',
  };

  it("prints the engine's own explanation in full", () => {
    const md = build([{ title: 'Value at Risk', explanation }]);
    expect(md).toContain('How this was calculated');
    expect(md).toContain('Monte Carlo over the compound loss model');
    expect(md).toContain('VaR_p = inf { x : F(x) >= p }');
    expect(md).toContain('1. Sort the simulated totals');
    expect(md).toContain('Event counts are independent of severities.');
    expect(md).toContain('Tail figures at 99.9% need far more trials');
    expect(md).toContain('Empirical estimate');
  });

  it('writes a chart as a data table and says so', () => {
    const md = build([
      {
        title: 'Loss exceedance curve',
        charts: [
          {
            title: 'Loss exceedance curve',
            description: 'Probability of exceeding each loss level.',
            table: { caption: 'Exceedance by level', columns: ['Loss', 'Probability'], rows: [[1000, 0.42], [2000, 0.2]] },
          },
        ],
      },
    ]);
    expect(md).toContain('#### Chart data: Loss exceedance curve');
    expect(md).toContain('| Loss | Probability |');
    expect(md).toContain('1,000');
    expect(md).toContain('0.42');
    expect(md).toContain('same data the chart plots');
  });

  it('reports an empty chart as empty rather than drawing nothing silently', () => {
    const md = build([
      { title: 'Curve', charts: [{ title: 'Curve', table: { caption: 'Curve', columns: ['x', 'y'], rows: [] } }] },
    ]);
    expect(md).toContain('No data points were produced for this chart.');
  });

  it('prints engine warnings verbatim', () => {
    const md = build([{ title: 'Value at Risk', warnings: ['Only 14 trials fall beyond the 99.9% quantile.'] }]);
    expect(md).toContain('Only 14 trials fall beyond the 99.9% quantile.');
  });

  it('notes in the provenance footer when a figure rests on a judgement', () => {
    const md = build([{ title: 'Risk register', exactness: 'assumed', rows: [{ label: 'Total expected loss', value: 42000 }] }]);
    expect(md).toContain('rest on stated judgements rather than measurements');
  });
});

describe('escaping hostile content', () => {
  const hostile = '<script>alert(1)</script> **bold** [link](http://x) `code` | pipe # heading';

  it('escapes a hostile investigation name so no markup survives', () => {
    const md = buildReportMarkdown({
      investigation: makeInvestigation({ name: hostile, description: hostile }),
      tool: TOOL,
      content: { sections: [] },
      generatedAt: new Date('2026-03-05T09:00:00.000Z'),
    });
    expect(md).not.toContain('<script>');
    expect(md).not.toContain('</script>');
    expect(md).toContain('&lt;script&gt;');
    // The markdown specials are escaped, so none of them is interpreted.
    expect(md).toContain('\\*\\*bold\\*\\*');
    expect(md).toContain('\\[link\\]');
    expect(md).toContain('\\`code\\`');
    expect(md).toContain('\\# heading');
    expect(md).toContain('\\|');
    // A pipe cannot break the metadata table it sits in.
    for (const line of md.split('\n')) {
      // Unescaped pipes only: an escaped one is literal text inside the cell.
      if (line.startsWith('| Investigation ')) expect(line.split(/(?<!\\)\|/).length).toBe(4);
    }
  });

  it('escapes hostile labels, values and section titles', () => {
    const md = build([
      {
        title: hostile,
        rows: [{ label: hostile, value: hostile }],
        tables: [{ caption: hostile, columns: [hostile], rows: [[hostile]] }],
        warnings: [hostile],
      },
    ]);
    expect(md).not.toContain('<script>');
    expect(md).toContain('&lt;script&gt;');
    for (const line of md.split('\n')) {
      // Every table row keeps its own column count: a pipe in the data cannot add one.
      if (line.startsWith('| ') && line.includes('script')) expect(line.split(/(?<!\\)\|/).length).toBeLessThanOrEqual(4);
    }
  });

  it('fences pasted data and multi-line text instead of inlining it', () => {
    const pasted = '12.5\n13.1\n```\nnot a fence\n```';
    const md = buildReportMarkdown({
      investigation: makeInvestigation({ description: pasted }),
      tool: TOOL,
      content: { sections: [] },
      generatedAt: new Date('2026-03-05T09:00:00.000Z'),
    });
    // The fence is longer than the longest backtick run inside the content.
    expect(md).toContain('````text');
    expect(md).toContain('not a fence');
  });

  it('escapes HTML entities so an entity in user text cannot become markup', () => {
    expect(escapeMarkdown('&lt;img&gt;')).toContain('&amp;lt;');
    expect(escapeMarkdown('a\\b')).toContain('\\\\');
  });

  it('caps a very long table and says how many rows were left out', () => {
    const rows = Array.from({ length: 900 }, (_, i) => [i, i * 2]);
    const md = build([{ title: 'Big', tables: [{ caption: 'Big table', columns: ['i', '2i'], rows }] }]);
    expect(md).toContain('further row(s) are not printed here');
    expect(md.split('\n').filter((l) => l.startsWith('| ')).length).toBeLessThan(700);
  });
});
