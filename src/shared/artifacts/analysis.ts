import { asNumber, DATA_ASSUMPTIONS, profileTable, type ColumnProfile, type Table, type TableProfile } from '../compute/data.ts'
import { emptyDocument, text, type Block, type Inline, type StructuredDocument, type TableCell } from '../compute/document.ts'
import { describeCorrelation, isStatisticsError, pearson } from '../compute/statistics.ts'
import { assessQuality, checkFinding, type ColumnFacts, type Finding, type QualityProfile } from '../pages/analyzer.ts'

/**
 * A table analysed, and the analysis written up as a document.
 *
 * Nothing here is a model's opinion. Every number comes from the data engine's own profile of the table, the quality
 * assessment that already exists, and Pearson's correlation from the statistics engine; every finding carries the
 * rows, column or computation it rests on, because the analyzer's own `Finding` type has nowhere to put one that does
 * not. The write-up is built block by block from those numbers, so "Analyze this dataset" produces a report whose
 * figures are measured, and says so.
 *
 * What it does not do is interpret. "Column X is 40% empty" is a measurement; "this looks like sales data" is not,
 * and there is no field here for the second kind of claim.
 */

export interface Correlation {
  a: string
  b: string
  r: number
  describe: string
}

export interface TableAnalysis {
  profile: TableProfile
  quality: QualityProfile
  correlations: Correlation[]
  findings: Finding[]
  /** Short sentences a person can read first. Each is also a finding below. */
  headlines: string[]
}

const ANALYZER_ID = 'orbis.table-profile'
const MAX_NUMERIC_PAIRS = 12
const MIN_ROWS_FOR_OUTLIERS = 8

/** A number written for a person: whole numbers as they are, others to four significant figures. */
export const num = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  if (Number.isInteger(value)) return value.toLocaleString('en')
  if (Math.abs(value) >= 1e6 || Math.abs(value) < 1e-4) return value.toExponential(3)
  return String(parseFloat(value.toPrecision(4)))
}

const pct = (share: number): string => `${Math.round(share * 100)}%`

/** The rows whose value in a column is more than three standard deviations from its mean. */
const outlierRows = (table: Table, columnIndex: number, mean: number, sd: number): number[] => {
  if (!(sd > 0)) return []
  const ids: number[] = []
  for (const row of table.rows) {
    const value = asNumber(row.cells[columnIndex] ?? null)
    if (value !== null && Math.abs(value - mean) / sd > 3) ids.push(row.id)
  }
  return ids
}

export function analyseTable(table: Table): TableAnalysis {
  const profile = profileTable(table)
  const findings: Finding[] = []
  const headlines: string[] = []
  let next = 0
  const add = (finding: Omit<Finding, 'id' | 'analyzerId'>): void => {
    const whole: Finding = { id: `f-${++next}`, analyzerId: ANALYZER_ID, ...finding }
    // The analyzer's own rule: a finding without evidence is an assertion, and is not kept.
    if (checkFinding(whole).ok) findings.push(whole)
  }

  // ---- shape and duplicates
  add({
    type: 'shape',
    severity: 'info',
    summary: `${num(profile.rows)} rows and ${num(profile.columns)} columns.`,
    certainty: 'measured',
    evidence: [{ kind: 'value', label: 'rows', value: profile.rows }, { kind: 'value', label: 'columns', value: profile.columns }],
    method: 'Counted.',
    suggestion: '',
    assumptions: []
  })
  if (profile.duplicateRows.length > 0) {
    headlines.push(`${profile.duplicateRows.length} row${profile.duplicateRows.length === 1 ? ' is' : 's are'} identical to an earlier row.`)
    add({
      type: 'duplicate-rows',
      severity: 'warning',
      summary: `${profile.duplicateRows.length} row${profile.duplicateRows.length === 1 ? ' is' : 's are'} identical to an earlier row across every column.`,
      certainty: 'measured',
      evidence: [{ kind: 'rows', ids: profile.duplicateRows.slice(0, 200) }],
      method: 'Every cell of each row compared with every earlier row.',
      suggestion: 'Decide whether they are repeats or real; Orbis flags them and removes nothing.',
      assumptions: ['Two rows with the same text in every cell are the same record.']
    })
  }

  // ---- quality, from the facts the profile measured
  const facts: ColumnFacts[] = profile.columnProfiles.map((one) => {
    const index = table.columns.findIndex((column) => column.id === one.columnId)
    const stats = one.statistics
    return {
      name: one.name,
      present: one.present,
      missing: one.empty,
      distinct: one.distinct,
      duplicated: Math.max(0, one.present - one.distinct),
      types: { [one.type]: one.present },
      numeric: stats ? { min: stats.minimum, max: stats.maximum, outliers: outlierRows(table, index, stats.mean, stats.standardDeviation) } : null
    }
  })
  const quality = assessQuality(profile.rows, facts)
  for (const issue of quality.issues) {
    const serious = issue.kind === 'missing' ? issue.share >= 0.2 : issue.kind === 'constant' || issue.kind === 'suspicious-outlier'
    if (issue.kind === 'missing' && issue.share >= 0.2) headlines.push(`"${issue.column}" is ${pct(issue.share)} empty.`)
    if (issue.kind === 'constant') headlines.push(`"${issue.column}" has one value throughout.`)
    add({
      type: `quality-${issue.kind}`,
      severity: serious ? 'warning' : 'notice',
      summary: issue.describe,
      certainty: 'measured',
      evidence: [issue.evidence],
      method: 'From the column profile: counts of present, missing, distinct and out-of-range values.',
      suggestion: issue.suggestion,
      assumptions: []
    })
  }

  // ---- each numeric column, summarised
  const numeric = profile.columnProfiles.filter((one) => one.statistics !== null && one.statistics.count >= 2)
  for (const one of numeric) {
    const s = one.statistics!
    add({
      type: 'summary',
      severity: 'info',
      summary: `"${one.name}": mean ${num(s.mean)}, median ${num(s.median)}, from ${num(s.minimum)} to ${num(s.maximum)}${one.unit ? ` ${one.unit}` : ''}, over ${num(s.count)} values.`,
      certainty: 'computed',
      evidence: [{ kind: 'computation', operation: 'statistics.summarise', inputs: `column "${one.name}", ${s.count} values`, result: `mean ${num(s.mean)}, median ${num(s.median)}, sd ${num(s.standardDeviation)}` }],
      method: 'Mean, median, range and standard deviation of every readable value in the column.',
      suggestion: s.notes[0] ?? '',
      assumptions: ['Values that could not be read as numbers are left out of the statistics and counted separately.']
    })
    if (Math.abs(s.mean - s.median) > s.standardDeviation * 0.5 && s.count >= MIN_ROWS_FOR_OUTLIERS) {
      headlines.push(`"${one.name}" is skewed: mean ${num(s.mean)} against median ${num(s.median)}.`)
    }
  }

  // ---- relationships between numeric columns
  const correlations: Correlation[] = []
  const pairs = numeric.slice(0, MAX_NUMERIC_PAIRS)
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const ai = table.columns.findIndex((column) => column.id === pairs[i].columnId)
      const bi = table.columns.findIndex((column) => column.id === pairs[j].columnId)
      const xs: number[] = []
      const ys: number[] = []
      for (const row of table.rows) {
        const x = asNumber(row.cells[ai] ?? null)
        const y = asNumber(row.cells[bi] ?? null)
        if (x !== null && y !== null) {
          xs.push(x)
          ys.push(y)
        }
      }
      if (xs.length < 3) continue
      const r = pearson(xs, ys)
      if (isStatisticsError(r) || !Number.isFinite(r)) continue
      if (Math.abs(r) < 0.5) continue
      const describe = describeCorrelation(r)
      correlations.push({ a: pairs[i].name, b: pairs[j].name, r, describe })
      headlines.push(`"${pairs[i].name}" and "${pairs[j].name}" move together (r = ${num(r)}).`)
      add({
        type: 'correlation',
        severity: 'notice',
        summary: `"${pairs[i].name}" and "${pairs[j].name}": r = ${num(r)} over ${xs.length} rows. ${describe}`,
        certainty: 'computed',
        evidence: [{ kind: 'computation', operation: 'statistics.correlate', inputs: `${xs.length} rows where both are present`, result: `r = ${num(r)}` }],
        method: "Pearson's correlation over the rows where both columns have a readable number.",
        suggestion: 'A correlation says the two vary together. It does not say one causes the other.',
        assumptions: ['The relationship is roughly a straight line; Pearson’s r does not see a curved one.']
      })
    }
  }

  // ---- the profile's own warnings, each tied to its column
  for (const column of profile.columnProfiles) {
    for (const warning of column.warnings) {
      add({
        type: 'column-note',
        severity: 'notice',
        summary: `"${column.name}": ${warning}`,
        certainty: 'measured',
        evidence: [{ kind: 'column', name: column.name }],
        method: 'From the column profile.',
        suggestion: '',
        assumptions: []
      })
    }
  }

  return { profile, quality, correlations, findings, headlines }
}

// ---------------------------------------------------------------- the write-up

let blockCount = 0
const id = (): string => `an-${++blockCount}`
const para = (runs: Inline[]): Block => ({ id: id(), sectionId: '', kind: 'paragraph', content: runs })
const heading = (level: 1 | 2 | 3, value: string): Block => ({ id: id(), sectionId: '', kind: 'heading', level, content: [text(value)] })
const cell = (value: string, header = false, align: TableCell['align'] = 'left'): TableCell => ({ content: [text(value)], colSpan: 1, rowSpan: 1, header, align })
const tableBlock = (headers: string[], rows: string[][], caption: string, numericFrom = 1): Block => ({
  id: id(),
  sectionId: '',
  kind: 'table',
  columns: headers.length,
  rows: [headers.map((one) => cell(one, true)), ...rows.map((row) => row.map((value, i) => cell(value, false, i >= numericFrom ? 'right' : 'left')))],
  caption,
  label: ''
})
const list = (items: string[]): Block => ({ id: id(), sectionId: '', kind: 'list', style: 'bullet', items: items.map((one) => ({ content: [text(one)], checked: false, depth: 0 })) })

/** The analysis as a document: a report whose every figure was measured, and which says how. */
export function analysisDocument(analysis: TableAnalysis, tableTitle: string): StructuredDocument {
  blockCount = 0
  const { profile, quality, correlations } = analysis
  const document = emptyDocument('analysis', `Analysis of ${tableTitle}`)
  document.metadata.source = `Computed by Orbis from "${tableTitle}"`
  const blocks: Block[] = []

  blocks.push(heading(1, `Analysis of ${tableTitle}`))
  blocks.push(para([text(`${num(profile.rows)} rows and ${num(profile.columns)} columns${profile.source ? `, from ${profile.source}` : ''}. Every figure below was computed by Orbis from the table; nothing in this report was written by a model.`)]))

  if (analysis.headlines.length > 0) {
    blocks.push(heading(2, 'In short'))
    blocks.push(list(analysis.headlines))
  }

  blocks.push(heading(2, 'Columns'))
  blocks.push(
    tableBlock(
      ['Column', 'Type', 'Present', 'Empty', 'Distinct'],
      profile.columnProfiles.map((one: ColumnProfile) => [one.name, one.unit ? `${one.type} (${one.unit})` : one.type, num(one.present), num(one.empty), num(one.distinct)]),
      'What each column holds.',
      2
    )
  )

  const numeric = profile.columnProfiles.filter((one) => one.statistics !== null && one.statistics.count >= 2)
  if (numeric.length > 0) {
    blocks.push(heading(2, 'Numbers'))
    blocks.push(
      tableBlock(
        ['Column', 'Count', 'Mean', 'Median', 'Minimum', 'Maximum', 'Std. dev.'],
        numeric.map((one) => {
          const s = one.statistics!
          return [one.name, num(s.count), num(s.mean), num(s.median), num(s.minimum), num(s.maximum), num(s.standardDeviation)]
        }),
        'Summary statistics of every readable value in each numeric column.'
      )
    )
    const skewed = numeric.filter((one) => one.statistics!.notes.length > 0)
    for (const one of skewed) blocks.push(para([text(`"${one.name}": ${one.statistics!.notes.join(' ')}`)]))
  }

  const categorical = profile.columnProfiles.filter((one) => one.common.length > 1 && one.statistics === null)
  if (categorical.length > 0) {
    blocks.push(heading(2, 'Commonest values'))
    for (const one of categorical.slice(0, 8)) {
      blocks.push(para([text(`"${one.name}" (${num(one.distinct)} distinct): ${one.common.slice(0, 5).map((v) => `${v.value || '(empty)'} ×${num(v.count)}`).join(', ')}.`)]))
    }
  }

  blocks.push(heading(2, 'Quality'))
  if (quality.issues.length === 0) {
    blocks.push(para([text(`Nothing out of the ordinary was found in ${quality.clean.length} column${quality.clean.length === 1 ? '' : 's'}: no missing values, no duplicated values, no constant columns, no outliers beyond three standard deviations.`)]))
  } else {
    blocks.push(list(quality.issues.map((one) => `${one.describe}${one.suggestion ? ` ${one.suggestion}` : ''}`)))
  }
  if (profile.duplicateRows.length > 0) {
    blocks.push(para([text(`${num(profile.duplicateRows.length)} row${profile.duplicateRows.length === 1 ? ' is' : 's are'} identical to an earlier row (row id${profile.duplicateRows.length === 1 ? '' : 's'} ${profile.duplicateRows.slice(0, 20).join(', ')}${profile.duplicateRows.length > 20 ? ', …' : ''}). They are flagged, not removed.`)]))
  }

  if (correlations.length > 0) {
    blocks.push(heading(2, 'Relationships'))
    blocks.push(
      tableBlock(
        ['Column', 'Column', 'r', 'Reading'],
        correlations.map((one) => [one.a, one.b, num(one.r), one.describe]),
        "Pearson's correlation between numeric columns, where |r| is at least 0.5. A correlation does not say one causes the other.",
        2
      )
    )
  }

  blocks.push(heading(2, 'How this was worked out'))
  blocks.push(para([text('Counts, distinct values and the commonest values come from reading every cell. Mean, median, range and standard deviation are computed over the values that could be read as numbers. Correlations are Pearson’s r over the rows where both columns have a number. Outliers are values more than three standard deviations from the column’s mean.')]))
  blocks.push(list([...DATA_ASSUMPTIONS]))

  document.blocks = blocks
  return document
}
