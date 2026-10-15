/**
 * Investigation report: a readable, self-contained Markdown record of what was
 * computed, by what method, at what exactness, under what assumptions.
 *
 * The JSON export in `schema.ts` records an investigation's *configuration* so
 * it can be reopened. This module records the *analysis*: the settings as a
 * readable table, the results that were actually on screen, each with its
 * exactness label and the engine's own explanation, and every chart as a data
 * table. For work that informs a decision the record matters as much as the
 * number, and that record has to be readable by someone who does not have this
 * application.
 *
 * Rules this module enforces, because a report is the artefact someone else
 * reads and trusts:
 *
 *  - Nothing is invented to fill a section. A result that was not computed, or
 *    that sits behind an un-run button, is reported as missing, naming what is
 *    missing. An empty section is honest; a plausible number is not.
 *  - A refusal is carried through: the `EngineError` message is printed as the
 *    section's outcome rather than the section being dropped.
 *  - A confidence interval for a parameter and percentiles of simulated
 *    outcomes are worded differently and never share a format, because they are
 *    different statements.
 *  - Everything is generated here, in the browser, from values already on
 *    screen. There is no network call in this module and no file path in its
 *    output.
 *  - The output is Markdown, never HTML. Every piece of text that came from a
 *    user or an imported file — investigation names, descriptions, pasted data,
 *    labels — is escaped or fenced, so a hostile name cannot inject markup into
 *    a report someone else opens.
 */
import type { Exactness, Explanation } from '../engine/core/result';
import type { Investigation } from './schema';

/* ------------------------------------------------------------- the contract */

/** A value a report can print. `null`/`undefined` print as "not available". */
export type ReportValue = string | number | boolean | null | undefined;

/** One label/value line, for example "Expected total loss — 24,180 GBP". */
export interface ReportRow {
  label: string;
  value: ReportValue;
  /** Optional clarification printed after the value. */
  note?: string;
}

/** Tabular data. This is the shape a chart's accessible table / CSV already has. */
export interface ReportTable {
  caption: string;
  columns: string[];
  rows: ReportValue[][];
  /** Printed under the table, e.g. a precision or truncation note. */
  note?: string;
}

/**
 * A chart, as its data. A report cannot carry a drawing, and a picture of
 * numbers is not a record of them, so a chart contributes the same rows its
 * "Show values" table and CSV export use.
 */
export interface ReportChart {
  title: string;
  /** What is plotted: the chart's own accessible description. */
  description?: string;
  table: ReportTable;
}

/**
 * An interval result. `kind` is not decoration: it chooses the wording, which
 * is how the report keeps an interval for a parameter distinct from the spread
 * of simulated outcomes.
 */
export interface ReportInterval {
  /** What the interval is about, e.g. "the mean" or "total loss". */
  label: string;
  kind:
    | 'confidence-interval'
    | 'credible-interval'
    /** A range for one future observation: a different statement again. */
    | 'prediction-interval'
    | 'simulated-percentile-range'
    | 'bound'
    | 'interval-estimate';
  lower: ReportValue;
  upper: ReportValue;
  /** Confidence/credibility level as a fraction, e.g. 0.95. */
  level?: number;
  /** For a percentile range: the percentiles themselves, e.g. [5, 95]. */
  percentiles?: [number, number];
  note?: string;
}

/**
 * One result block. A screen hands the report a list of these; nothing else is
 * required of it, and a screen that hands over nothing still exports its
 * configuration.
 */
export interface ReportSection {
  title: string;
  /** Prose introducing the section, from the screen. */
  description?: string;
  /**
   * Set when there is no result to report: not computed yet, behind an un-run
   * button, or not applicable in this mode. The text must name what is missing.
   */
  missing?: string;
  /** Set when a computation failed: the EngineError message, verbatim. */
  refusal?: string;
  exactness?: Exactness;
  /** The engine's own explanation: method, formula, steps, assumptions, limits. */
  explanation?: Explanation;
  rows?: ReportRow[];
  intervals?: ReportInterval[];
  tables?: ReportTable[];
  charts?: ReportChart[];
  /** Engine warnings, printed verbatim. */
  warnings?: string[];
  /** Assumptions/limitations when the screen has them outside an Explanation. */
  assumptions?: string[];
  limitations?: string[];
  /** Nested sub-results, one level deep. */
  subsections?: ReportSection[];
}

/** What a tool screen contributes to its report. */
export interface ToolReportContent {
  sections: ReportSection[];
  /**
   * Readable settings rows. When omitted the configuration is rendered
   * generically from the stored configuration object.
   */
  configRows?: ReportRow[];
  /** Printed under the configuration table, e.g. "mode: loss distribution". */
  configNote?: string;
}

export interface ReportInput {
  /** The saved investigation, when there is one. */
  investigation: Investigation | null;
  tool: { name: string; description: string; category: string };
  /** The live configuration, when it is not the saved one. */
  config?: unknown;
  content?: ToolReportContent;
  /** Why no results are present, when the caller knows (e.g. exporting from the library). */
  noResultsReason?: string;
  generatedAt?: Date;
  appName?: string;
  appVersion?: string;
}

export const REPORT_FORMAT_NOTE =
  'This report was generated by Orbis Chance in your web browser. Every figure in it was computed locally on this computer; nothing was uploaded and no external service was involved.';

/** Caps, so a hostile or very large configuration cannot produce a huge file. */
export const MAX_TABLE_ROWS = 500;
export const MAX_CONFIG_ROWS = 400;

/* ------------------------------------------------------------- escaping */

/**
 * Escape text for Markdown so that content from a user or an imported file is
 * printed as text and never interpreted — as markup, as a heading, or as HTML.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([`*_[\]#|])/g, '\\$1')
    .replace(/\r\n?/g, '\n')
    // A line that begins with a list or quote marker would otherwise become one.
    // Only a real marker: "- " or "> ", not the minus sign of a number.
    .replace(/^([ \t]*)([-+>])(?=[ \t]|$)/gm, '$1\\$2')
    .replace(/^([ \t]*\d+)\.(?=[ \t])/gm, '$1\\.');
}

/** Escape for a table cell: no line breaks may escape the row. */
export function escapeCell(text: string): string {
  return escapeMarkdown(text).replace(/\n+/g, ' ').trim();
}

/**
 * Fence content that is too long or too structured to inline (pasted data, a
 * multi-line description). A fenced block is never interpreted, so the fence is
 * made longer than any run of backticks inside it.
 */
function fence(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((a, b) => Math.max(a, b.length), 0);
  const bars = '`'.repeat(Math.max(3, longest + 1));
  // A fence cannot be closed early from inside, and the content is not escaped
  // because nothing inside a fence is interpreted.
  return `${bars}text\n${text.replace(/\r\n?/g, '\n')}\n${bars}`;
}

/** Long or multi-line user text goes in a fence; short text is escaped inline. */
function userText(text: string): string {
  return text.includes('\n') || text.length > 400 ? fence(text) : escapeMarkdown(text);
}

/* ------------------------------------------------------------- formatting */

export function formatReportValue(value: ReportValue): string {
  if (value === null || value === undefined) return 'not available';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return formatNumber(value);
  return value;
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'not a number';
  if (!Number.isFinite(value)) return value > 0 ? 'infinity' : 'negative infinity';
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return value.toLocaleString('en-US');
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e12)) return value.toExponential(6);
  return String(Number(value.toPrecision(8)));
}

function cell(value: ReportValue): string {
  return escapeCell(formatReportValue(value));
}

/** Humanise a configuration key: `perEventCap` → "Per event cap". */
export function humaniseKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    // camelCase becomes words, and the words stay lower case so a setting
    // reads as a sentence rather than as a Title.
    .replace(/([a-z0-9])([A-Z])/g, (_m, a: string, b: string) => `${a} ${b.toLowerCase()}`)
    .replace(/\s+/g, ' ')
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/* ------------------------------------------------------------- markdown bits */

function heading(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}

function table(columns: string[], rows: ReportValue[][], cap = MAX_TABLE_ROWS): string[] {
  const out: string[] = [];
  const head = columns.map((c) => escapeCell(c));
  out.push(`| ${head.join(' | ')} |`);
  out.push(`| ${head.map(() => '---').join(' | ')} |`);
  const shown = rows.slice(0, cap);
  for (const row of shown) {
    const cells = head.map((_, i) => cell(row[i]));
    out.push(`| ${cells.join(' | ')} |`);
  }
  if (rows.length > shown.length) {
    out.push('');
    out.push(
      `*${rows.length - shown.length} further row(s) are not printed here; this report prints at most ${cap} rows per table. The complete data is available from the chart's CSV export on the tool screen.*`,
    );
  }
  return out;
}

function renderTable(t: ReportTable, level: number): string[] {
  const out: string[] = [heading(level, escapeMarkdown(t.caption)), ''];
  if (!t.rows.length) {
    out.push('*This table has no rows: no values were produced for it.*', '');
    return out;
  }
  out.push(...table(t.columns, t.rows), '');
  if (t.note) out.push(`*${escapeCell(t.note)}*`, '');
  return out;
}

const EXACTNESS_TEXT: Record<Exactness, string> = {
  exact: 'Exact — follows exactly from the inputs by the formula stated; only floating-point rounding limits its precision.',
  numerical: 'Numerical approximation — produced by a deterministic numerical method with documented accuracy, not by closed-form arithmetic.',
  empirical: 'Empirical estimate — estimated from a finite number of observations or simulated trials, and therefore subject to sampling error.',
  assumed:
    'User assumption — a value supplied as a judgement rather than measured or computed. Conclusions that rest on it rest on that judgement being right.',
};

function intervalLine(iv: ReportInterval): string {
  const label = escapeMarkdown(iv.label);
  const range = `${cell(iv.lower)} to ${cell(iv.upper)}`;
  const pct = iv.level !== undefined && Number.isFinite(iv.level) ? `${formatNumber(iv.level * 100)}%` : null;
  switch (iv.kind) {
    case 'confidence-interval':
      return `- **${pct ? `${pct} confidence interval` : 'Confidence interval'} for ${label}:** ${range}. This is an interval for the quantity being *estimated*; it is not a range of individual outcomes.`;
    case 'credible-interval':
      return `- **${pct ? `${pct} credible interval` : 'Credible interval'} for ${label}:** ${range}. This is a posterior interval for the quantity being estimated, under the stated prior; it is not a range of individual outcomes.`;
    case 'prediction-interval':
      return `- **${pct ? `${pct} prediction interval` : 'Prediction interval'} for ${label}:** ${range}. This is a range for a single future observation, not a confidence interval for a mean and not a range of simulated trials.`;
    case 'simulated-percentile-range': {
      const p = iv.percentiles ? `${formatNumber(iv.percentiles[0])}th to ${formatNumber(iv.percentiles[1])}th percentile` : 'percentile range';
      return `- **Simulated outcomes, ${p} of ${label}:** ${range}. These are percentiles of the simulated outcomes themselves — how spread out the outcomes are — and not a confidence interval for any estimate.`;
    }
    case 'bound':
      return `- **Bound on ${label} (lower, upper):** ${range}. These are bounds. No value between them is a best guess; on the information given there is no best guess.`;
    case 'interval-estimate':
      return `- **Interval for ${label}:** ${range}.`;
  }
}

function renderExplanation(e: Explanation, level: number): string[] {
  const out: string[] = [heading(level, 'How this was calculated'), ''];
  out.push(`**Method.** ${escapeMarkdown(e.method)}`, '');
  out.push(`**Exactness.** ${EXACTNESS_TEXT[e.exactness]}`, '');
  if (e.formula) out.push('**Formula.**', '', fence(e.formula), '');
  if (e.steps.length) {
    out.push('**Working.**', '');
    e.steps.forEach((s, i) => {
      const parts = [`${i + 1}. ${escapeMarkdown(s.label)}`];
      if (s.expression) parts.push(`   - Expression: \`${s.expression.replace(/`/g, "'")}\``);
      if (s.value) parts.push(`   - Value: ${escapeCell(s.value)}`);
      out.push(parts.join('\n'));
    });
    out.push('');
  }
  if (e.assumptions.length) {
    out.push('**Assumptions this result depends on.**', '');
    out.push(...e.assumptions.map((a) => `- ${escapeMarkdown(a)}`), '');
  }
  if (e.limitations.length) {
    out.push('**Limitations.**', '');
    out.push(...e.limitations.map((a) => `- ${escapeMarkdown(a)}`), '');
  }
  return out;
}

function renderSection(section: ReportSection, level: number): string[] {
  const out: string[] = [heading(level, escapeMarkdown(section.title)), ''];
  if (section.description) out.push(userText(section.description), '');

  if (section.exactness) out.push(`**Exactness:** ${EXACTNESS_TEXT[section.exactness]}`, '');

  if (section.refusal) {
    out.push('**No result: the computation was refused.** The engine reported:', '');
    out.push(`> ${escapeCell(section.refusal)}`, '');
    out.push('*No figure is given for this section. A refusal is the result here, and substituting a number would misrepresent it.*', '');
  } else if (section.missing) {
    out.push(`**No result available.** ${escapeMarkdown(section.missing)}`, '');
  }

  if (section.intervals?.length) {
    out.push(...section.intervals.map(intervalLine), '');
    for (const iv of section.intervals) if (iv.note) out.push(`*${escapeCell(iv.note)}*`, '');
  }

  if (section.rows?.length) {
    out.push(
      ...table(
        ['Figure', 'Value'],
        section.rows.map((r) => [r.label, r.note ? `${formatReportValue(r.value)} — ${r.note}` : r.value]),
      ),
      '',
    );
  }

  for (const t of section.tables ?? []) out.push(...renderTable(t, level + 1));

  for (const chart of section.charts ?? []) {
    out.push(heading(level + 1, `Chart data: ${escapeMarkdown(chart.title)}`), '');
    if (chart.description) out.push(escapeMarkdown(chart.description), '');
    out.push(
      '*The chart itself is a drawing of these numbers; this is the same data the chart plots, taken from its own values table.*',
      '',
    );
    if (!chart.table.rows.length) out.push('*No data points were produced for this chart.*', '');
    else {
      out.push(...table(chart.table.columns, chart.table.rows), '');
      if (chart.table.note) out.push(`*${escapeCell(chart.table.note)}*`, '');
    }
  }

  if (section.warnings?.length) {
    out.push('**Warnings reported by the engine.**', '');
    out.push(...section.warnings.map((w) => `- ${escapeMarkdown(w)}`), '');
  }
  if (section.assumptions?.length) {
    out.push('**Assumptions.**', '');
    out.push(...section.assumptions.map((w) => `- ${escapeMarkdown(w)}`), '');
  }
  if (section.limitations?.length) {
    out.push('**Limitations.**', '');
    out.push(...section.limitations.map((w) => `- ${escapeMarkdown(w)}`), '');
  }

  if (section.explanation) out.push(...renderExplanation(section.explanation, level + 1));

  for (const sub of section.subsections ?? []) out.push(...renderSection(sub, Math.min(level + 1, 6)));

  return out;
}

/* ------------------------------------------------------ configuration table */

/**
 * Flatten a tool configuration into readable setting/value rows. Keys become
 * words, nesting becomes a path, and arrays of primitives are joined. Values
 * are never interpreted: a string stays a string.
 */
export function configurationRows(config: unknown, limit = MAX_CONFIG_ROWS): { rows: ReportRow[]; omitted: number } {
  const rows: ReportRow[] = [];
  let omitted = 0;

  const walk = (value: unknown, path: string[]): void => {
    if (rows.length >= limit) {
      omitted++;
      return;
    }
    const label = path.map(humaniseKey).join(' › ');
    if (value === null || value === undefined) {
      rows.push({ label, value: null });
      return;
    }
    if (Array.isArray(value)) {
      const primitives = value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
      if (!value.length) {
        rows.push({ label, value: '(empty list)' });
      } else if (primitives) {
        const shown = value.slice(0, 40).map((v) => formatReportValue(v as ReportValue));
        rows.push({
          label,
          value: shown.join(', '),
          note: value.length > shown.length ? `${value.length} values in total; the first ${shown.length} are listed` : undefined,
        });
      } else {
        value.slice(0, 40).forEach((v, i) => walk(v, [...path, `item ${i + 1}`]));
        if (value.length > 40) omitted += value.length - 40;
      }
      return;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (!entries.length) rows.push({ label, value: '(no settings)' });
      for (const [key, v] of entries) walk(v, [...path, key]);
      return;
    }
    rows.push({ label, value: value as ReportValue });
  };

  if (config === null || config === undefined || typeof config !== 'object') {
    if (config !== null && config !== undefined) rows.push({ label: 'Configuration', value: config as ReportValue });
  } else {
    for (const [key, v] of Object.entries(config as Record<string, unknown>)) walk(v, [key]);
  }
  return { rows, omitted };
}

/* ------------------------------------------------------------- the report */

/** A file name for the report. Contains no path, only a name. */
export function reportFilename(name: string, at = new Date()): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'investigation';
  return `${base}-report-${at.toISOString().slice(0, 10)}.md`;
}

function describeDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'not recorded' : d.toLocaleString();
}

/**
 * Build the whole report. Pure: it takes values already computed and on screen
 * and returns Markdown. It computes nothing, and it can therefore never
 * contribute a number the engine did not produce.
 */
export function buildReportMarkdown(input: ReportInput): string {
  const at = input.generatedAt ?? new Date();
  const inv = input.investigation;
  const appName = input.appName ?? 'Orbis Chance';
  const appVersion = input.appVersion ?? '1.0.0';
  const content = input.content;
  const out: string[] = [];

  const name = inv?.name ?? input.tool.name;
  out.push(heading(1, `Investigation report: ${escapeMarkdown(name)}`), '');

  const metaRows: ReportValue[][] = [
    ['Investigation', inv ? inv.name : `(unsaved — this report covers the ${input.tool.name} screen as it stands)`],
    ['Tool', `${input.tool.name} (${input.tool.category})`],
    ['Report generated', at.toLocaleString()],
  ];
  if (inv) {
    metaRows.push(['Created', describeDate(inv.createdAt)]);
    metaRows.push(['Last changed', describeDate(inv.updatedAt)]);
    if (inv.tags.length) metaRows.push(['Tags', inv.tags.join(', ')]);
    if (inv.simulation) {
      metaRows.push(['Simulation', `${inv.simulation.trials.toLocaleString('en-US')} trials, seed ${inv.simulation.seed}`]);
    }
    if (inv.origin) metaRows.push(['Started from', inv.origin.kind === 'blank' ? 'a blank investigation' : `${inv.origin.kind}${inv.origin.ref ? `: ${inv.origin.ref}` : ''}`]);
  }
  metaRows.push(['Produced by', `${appName} ${appVersion}, locally in a web browser`]);
  out.push(...table(['', ''], metaRows), '');

  out.push(heading(2, 'What this tool does'), '', escapeMarkdown(input.tool.description), '');

  if (inv?.description?.trim()) {
    out.push(heading(2, 'The question this investigation answers'), '', userText(inv.description.trim()), '');
  }

  if (inv?.assumptions.length) {
    out.push(
      heading(2, 'Assumptions recorded with this investigation'),
      '',
      'These are notes written by whoever set the investigation up. They are judgements, not computed or measured values.',
      '',
      ...inv.assumptions.map((a) => `- ${userText(a)}`),
      '',
    );
  }

  /* Configuration. */
  out.push(heading(2, 'Configuration'), '');
  const configSource = input.config !== undefined ? input.config : inv?.config;
  if (content?.configRows?.length) {
    out.push(...table(['Setting', 'Value'], content.configRows.map((r) => [r.label, r.note ? `${formatReportValue(r.value)} — ${r.note}` : r.value])), '');
  } else {
    const { rows, omitted } = configurationRows(configSource);
    if (!rows.length) {
      out.push('*This investigation has no stored configuration, so there are no settings to report.*', '');
    } else {
      out.push(...table(['Setting', 'Value'], rows.map((r) => [r.label, r.note ? `${formatReportValue(r.value)} — ${r.note}` : r.value]), MAX_CONFIG_ROWS), '');
      if (omitted > 0) out.push(`*${omitted} further setting(s) are not printed; the complete configuration is in the JSON export of this investigation.*`, '');
    }
  }
  if (content?.configNote) out.push(escapeMarkdown(content.configNote), '');

  /* Results. */
  out.push(heading(2, 'Results'), '');
  const sections = content?.sections ?? [];
  if (!sections.length) {
    out.push('**No results are included in this report.**', '');
    out.push(
      input.noResultsReason
        ? escapeMarkdown(input.noResultsReason)
        : 'This screen supplied no results to the report, so none are shown. Nothing has been inferred from the configuration above: a configuration states what would be computed, not what was computed.',
      '',
    );
    if (inv?.resultSummary?.headline) {
      out.push(
        heading(3, 'Summary figure saved with the investigation'),
        '',
        'This figure was saved when the investigation was last computed. It is a stored summary, not a result computed for this report, and it carries no exactness label or explanation of its own. Open the investigation in the tool to produce a full report.',
        '',
        ...table(
          ['Saved figure', 'Value'],
          [
            [inv.resultSummary.label ?? 'Result', inv.resultSummary.headline],
            ...(inv.resultSummary.figures ?? []).map((f) => [f.label, f.value] as ReportValue[]),
            ['Computed at', inv.resultSummary.computedAt ? describeDate(inv.resultSummary.computedAt) : 'not recorded'],
            ['From a simulation', inv.resultSummary.fromSimulation ?? false],
          ],
        ),
        '',
      );
    }
  } else {
    for (const section of sections) out.push(...renderSection(section, 3));
  }

  /* Provenance. */
  const anyAssumed =
    sections.some((s) => s.exactness === 'assumed' || s.explanation?.exactness === 'assumed') || Boolean(inv?.assumptions.length);
  out.push(heading(2, 'Provenance'), '');
  out.push(REPORT_FORMAT_NOTE, '');
  out.push(
    `Every number above was produced by the ${appName} mathematical engine from the configuration shown, and copied into this report unchanged. No figure in this report was generated by a language model, and no value was supplied in place of a computation that failed: where a computation was refused, the refusal is printed instead of a number, and where a result was not computed, the section says so.`,
    '',
  );
  out.push(
    'Each result carries one of four exactness labels. **Exact** follows from the inputs by the stated formula. **Numerical approximation** is computed by a numerical method to a documented accuracy. **Empirical estimate** comes from a finite sample or a finite number of simulated trials and would differ slightly on a re-run with a different seed. **User assumption** is not a measurement or a computation at all: it is a stated judgement, and any conclusion drawn from a figure labelled *assumed* rests on that judgement being correct rather than on evidence.',
    '',
  );
  if (anyAssumed) {
    out.push(
      '**This report contains figures that rest on stated judgements rather than measurements.** They are labelled above, and they should be read as assumptions whose consequences were calculated, not as findings.',
      '',
    );
  }
  out.push(
    'A confidence or credible interval and a range of simulated outcomes are labelled separately throughout, because they answer different questions: the first is about how precisely a quantity is known, the second about how widely outcomes vary.',
    '',
  );
  out.push(
    `Report generated ${at.toLocaleString()} by ${appName} ${appVersion}. The investigation's configuration can be exported separately as a JSON file and reopened to reproduce this analysis; a simulation reproduces exactly when re-run with the seed recorded above.`,
    '',
  );

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
