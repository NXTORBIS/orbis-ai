import { aggregateCells, asNumber, cellOut, groupBy, isDataError, profileTable, type Aggregate, type Cell, type Column, type ColumnProfile, type Table } from '../../shared/compute/data.ts'
import { emptyDocument, text, type Block, type StructuredDocument, type TableCell } from '../../shared/compute/document.ts'
import { num } from '../../shared/artifacts/analysis.ts'
import { PIE_LIMITS } from '../../shared/artifacts/svg.ts'
import { formulaName, type TransformStep } from '../../shared/artifacts/transform.ts'

/**
 * A dashboard: one table read, and a document made of its figures and its charts.
 *
 * It is a document, not a new kind of thing. There is no grid, nothing live and nothing interactive -- a document is
 * one block after another, and that is what this builds: the headline numbers, a breakdown by the first thing the
 * table is about, and two or three charts chosen by the shape of the data. It leaves as PDF, Word, HTML or slides
 * through the writers that already exist.
 *
 * Every number in it is worked out by the engines -- `profileTable` for the shape of each column, `aggregateCells`
 * for a total, `groupBy` for a breakdown -- and no number is ever asked of a model. Every chart is a request for the
 * chart path to draw, so a chart on a dashboard is a real chart artifact with its own provenance that the document
 * points at, exactly like a figure placed by hand. That is why this file is in two halves: `planDashboard` works out
 * what the dashboard says and which charts it wants, the service draws them, and `dashboardDocument` puts the
 * drawings in. A chart the service could not draw leaves a sentence saying so, never a gap.
 *
 * Two things it is careful about, because both are ways a dashboard lies:
 *
 * - **It says what it left out.** A column of identifiers has no meaningful total; a column of rates has no
 *   meaningful sum; a chart over time cannot be read when the rows are not in date order. Each of those is named,
 *   with the reason, rather than quietly skipped.
 * - **It is of one version.** The figures are of the table as it is now, and do not follow it. The charts do follow
 *   their own artifacts, because a figure is a reference; the numbers in the text do not. Both are said.
 *
 * The word "dashboard" is also used in `src/shared/dashboards.ts` for the arrangements of widgets on the browser's
 * start page. They are unrelated: nothing here touches a widget, and nothing there holds a figure.
 */

export const DASHBOARD_LIMITS = Object.freeze({
  /** Two or three charts. More than three and nobody reads any of them. */
  charts: 3,
  /** How many columns of numbers get a headline figure each. */
  headlineColumns: 3,
  /** How many series one chart may draw. */
  series: 3,
  /** How many rows of the breakdown are shown. */
  breakdownRows: 40,
  /** Past this many distinct values a column is a list of labels, not something to break down by. */
  categories: 60,
  /** Past this many bars a bar chart cannot be read. */
  bars: 40
})

export interface DashboardHeadline {
  label: string
  value: string
  /** How it was worked out, so the figure carries its own method. */
  how: string
}

export interface DashboardFigure {
  /** The id of the image block this chart will fill. Fixed at planning time so the service can match them up. */
  blockId: string
  kind: 'line' | 'bar' | 'pie'
  /** The column across the bottom, or the one the slices are named by: its id in the table the chart is drawn from. */
  x: string
  /** The columns of numbers, by id -- or by name, where a step below made the column. */
  y: string[]
  caption: string
  alt: string
  /** Why this chart and not another, in plain words. It goes under the figure. */
  why: string
  /**
   * Steps the table has to go through before this chart can be drawn.
   *
   * A chart is drawn from a table's own rows, so "spending by region" over a table with many rows per region needs
   * the table totalled by region first. Where that is so, the steps are here and the chart is of the table they
   * make -- a real table of its own, with its own provenance, not a number conjured in the chart.
   */
  steps?: TransformStep[]
}

export interface DashboardBreakdown {
  by: string
  headers: string[]
  rows: string[][]
  caption: string
  /** How many groups there were in all, which is more than the rows shown when the table is long. */
  groups: number
}

export interface DashboardPlan {
  title: string
  source: string
  intro: string
  headlines: DashboardHeadline[]
  breakdown: DashboardBreakdown | null
  figures: DashboardFigure[]
  /** Columns the dashboard did not use, and why. */
  leftOut: { column: string; why: string }[]
  /** Sentences for the artifact's notes. */
  notes: string[]
  /** How the whole thing was worked out, for the last section. */
  method: string[]
}

export interface DashboardRefusal {
  error: 'bad-input'
  message: string
}

export const isDashboardRefusal = (value: DashboardPlan | DashboardRefusal): value is DashboardRefusal => 'error' in value

/** A chart that was drawn: which block it goes in, and which artifact it is. */
export interface DrawnFigure {
  blockId: string
  artifactId: string
  title: string
}

/** A chart that could not be drawn, and the reason to put in its place. */
export interface UndrawnFigure {
  blockId: string
  why: string
}

// ---------------------------------------------------------------- reading the columns

const NUMERIC: ReadonlySet<Column['type']> = new Set(['number', 'integer', 'quantity'])

/** Names a column of identifiers goes by. A total of these is a number with no meaning. */
const IDENTIFIER = /^(id|ids|no|number|num|code|ref|reference|key|index|row|rowid|uuid|guid|year|years)$/

const idLike = (column: Column): boolean => IDENTIFIER.test(formulaName(column.name)) || /_(id|no|code|ref|key)$/.test(formulaName(column.name))

/** A column that is already a rate, a share or an average of something. Adding these up gives nothing. */
const rateLike = (column: Column): boolean =>
  column.name.includes('%') ||
  (column.unit?.display ?? '').includes('%') ||
  /(^|_)(percent|pct|percentage|share|rate|ratio|average|avg|mean|median|score|per)(_|$)/.test(formulaName(column.name))

interface Role {
  column: Column
  index: number
  profile: ColumnProfile
}

const unitOf = (column: Column): string => (column.unit ? ` ${column.unit.display}` : '')

/** A figure for a person: the number as the analysis writes it, with the column's own unit after it. */
const figure = (value: number | null, column: Column): string => (value === null ? '—' : `${num(value)}${unitOf(column)}`)

/** One line of plain words: anything that would read back as markup in the stored copy is taken out. */
const plain = (value: string): string =>
  value
    .replace(/[*[\]\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// ---------------------------------------------------------------- the plan

/**
 * What a dashboard of this table says, and which charts it wants drawn.
 *
 * Deterministic: the same table gives the same plan, every figure included. There is no clock in it and no random
 * choice -- the charts are picked by the shape of the data in a fixed order of preference, so two people asking for
 * the same dashboard get the same dashboard.
 */
export function planDashboard(table: Table, tableTitle: string, version: number): DashboardPlan | DashboardRefusal {
  if (table.columns.length === 0) return { error: 'bad-input', message: 'There is nothing to show: the table has no columns.' }
  if (table.rows.length === 0) return { error: 'bad-input', message: `"${tableTitle}" has no rows yet, so there are no figures to put on a dashboard.` }

  const profile = profileTable(table)
  const roles: Role[] = table.columns.map((column, index) => ({ column, index, profile: profile.columnProfiles[index] }))
  const leftOut: { column: string; why: string }[] = []

  // ---- which columns of numbers mean anything
  const numbers: Role[] = []
  for (const role of roles) {
    if (!NUMERIC.has(role.column.type)) continue
    if (role.profile.statistics === null || role.profile.statistics.count === 0) {
      leftOut.push({ column: role.column.name, why: 'it holds no value Orbis could read as a number' })
      continue
    }
    if (idLike(role.column)) {
      leftOut.push({ column: role.column.name, why: 'it reads as a label rather than an amount, and a total of labels means nothing' })
      continue
    }
    numbers.push(role)
  }
  if (numbers.length === 0) {
    return {
      error: 'bad-input',
      message: `A dashboard needs a column of numbers, and "${tableTitle}" has none Orbis can total: ${table.columns.map((one) => `"${one.name}" holds ${one.type === 'date' ? 'dates' : one.type === 'boolean' ? 'yes or no' : one.type === 'number' || one.type === 'integer' || one.type === 'quantity' ? 'numbers it could not read' : 'text'}`).join(', ')}.`
    }
  }

  const dates = roles.filter((one) => one.column.type === 'date')
  const labels = roles.filter(
    (one) => (one.column.type === 'category' || one.column.type === 'text') && one.profile.distinct >= 2 && one.profile.distinct <= DASHBOARD_LIMITS.categories
  )
  for (const role of roles) {
    if ((role.column.type === 'category' || role.column.type === 'text') && role.profile.distinct > DASHBOARD_LIMITS.categories) {
      leftOut.push({ column: role.column.name, why: `it has ${num(role.profile.distinct)} different values, too many to break anything down by` })
    }
  }

  // ---- the headline figures
  const headlines: DashboardHeadline[] = [
    { label: 'Rows', value: num(profile.rows), how: 'Counted.' },
    { label: 'Columns', value: num(profile.columns), how: 'Counted.' }
  ]
  const shown = numbers.slice(0, DASHBOARD_LIMITS.headlineColumns)
  for (const role of shown) {
    const cells = table.rows.map((row) => row.cells[role.index] ?? null)
    const average = asNumber(aggregateCells(cells, 'mean', role.column))
    if (rateLike(role.column)) {
      headlines.push({ label: `Average ${role.column.name}`, value: figure(average, role.column), how: `The mean of the ${num(role.profile.statistics!.count)} values in "${role.column.name}". It is already a rate, so it is not added up.` })
      continue
    }
    const total = asNumber(aggregateCells(cells, 'sum', role.column))
    headlines.push({ label: `Total ${role.column.name}`, value: figure(total, role.column), how: `Every value Orbis could read in "${role.column.name}" added up (${num(role.profile.statistics!.count)} of ${num(profile.rows)} rows).` })
    headlines.push({ label: `Average ${role.column.name}`, value: figure(average, role.column), how: `The mean of the same ${num(role.profile.statistics!.count)} values.` })
  }
  if (numbers.length > shown.length) {
    leftOut.push({ column: numbers.slice(shown.length).map((one) => one.column.name).join(', '), why: `the headline figures stop at ${DASHBOARD_LIMITS.headlineColumns} columns of numbers; the breakdown below still totals ${numbers.length > shown.length + 1 ? 'them' : 'it'}` })
  }

  // ---- the breakdown, and the biggest and smallest with it
  const by = labels[0] ?? null
  let breakdown: DashboardBreakdown | null = null
  const notes: string[] = []
  if (by === null) {
    notes.push('There is no breakdown: no column of this table holds a small enough set of names to group the rows by.')
  } else {
    const totals: { columnId: string; aggregate: Aggregate; as: string }[] = numbers.map((role) => ({
      columnId: role.column.id,
      aggregate: rateLike(role.column) ? 'mean' : 'sum',
      as: `${rateLike(role.column) ? 'Average' : 'Total'} ${role.column.name}`
    }))
    const groups = groupBy(table, [by.column.id], [{ columnId: by.column.id, aggregate: 'count', as: 'Rows' }, ...totals])
    if (isDataError(groups)) {
      notes.push(`There is no breakdown: ${groups.message}`)
    } else {
      const first = totals[0]
      const ordered = [...groups].sort((a, b) => {
        const av = asNumber(a.values[first.as] ?? null)
        const bv = asNumber(b.values[first.as] ?? null)
        if (av !== bv) return (bv ?? Number.NEGATIVE_INFINITY) - (av ?? Number.NEGATIVE_INFINITY)
        return a.keyText[0].localeCompare(b.keyText[0])
      })
      const headers = [by.column.name, 'Rows', ...totals.map((one) => one.as)]
      const rows = ordered.slice(0, DASHBOARD_LIMITS.breakdownRows).map((group) => [
        plain(cellOut(group.key[0] ?? null, by.column) || '(empty)'),
        num(group.rows.length),
        ...totals.map((one, at) => figure(asNumber(group.values[one.as] ?? null), numbers[at].column))
      ])
      breakdown = {
        by: by.column.name,
        headers,
        rows,
        caption: `Every row of "${tableTitle}" gathered by ${by.column.name}, biggest ${first.as.toLowerCase()} first${ordered.length > rows.length ? `. The ${num(rows.length)} biggest of ${num(ordered.length)} are shown` : ''}.`,
        groups: ordered.length
      }
      if (ordered.length >= 2) {
        const top = ordered[0]
        const bottom = ordered[ordered.length - 1]
        const amount = (value: Cell | undefined): string => figure(asNumber(value ?? null), numbers[0].column)
        headlines.push({
          label: `Biggest ${by.column.name}`,
          value: plain(`${top.keyText[0] || '(empty)'} — ${amount(top.values[first.as])}`),
          how: `Rows gathered by ${by.column.name} and ${first.as.toLowerCase()} compared across ${num(ordered.length)} of them.`
        })
        headlines.push({
          label: `Smallest ${by.column.name}`,
          value: plain(`${bottom.keyText[0] || '(empty)'} — ${amount(bottom.values[first.as])}`),
          how: `The same comparison, the other end.`
        })
      }
    }
  }

  // ---- the charts
  const figures: DashboardFigure[] = []
  const addFigure = (one: Omit<DashboardFigure, 'blockId'>): void => {
    if (figures.length >= DASHBOARD_LIMITS.charts) return
    figures.push({ ...one, blockId: `figure-${figures.length + 1}` })
  }

  // Over time: a line, which is the only shape that says "and then". The rows have to be in date order, because the
  // chart engine draws a column of dates in row order -- out of order it draws a line that means nothing.
  const date = dates[0] ?? null
  if (date !== null) {
    const series = numbers.slice(0, DASHBOARD_LIMITS.series)
    const seen = table.rows.map((row) => asNumber(row.cells[date.index] ?? null)).filter((one): one is number => one !== null)
    const inOrder = seen.every((value, at) => at === 0 || seen[at - 1] <= value)
    addFigure({
      kind: 'line',
      x: date.column.id,
      y: series.map((one) => one.column.id),
      caption: plain(`${series.map((one) => one.column.name).join(', ')} over ${date.column.name}`),
      alt: plain(`A line of ${series.map((one) => one.column.name).join(', ')} against ${date.column.name}`),
      why: inOrder
        ? `A line, because "${date.column.name}" holds dates and a line is what says "and then".`
        : `A line, because "${date.column.name}" holds dates. The rows are not in date order, so they are sorted by it first and the chart is of the sorted table.`,
      ...(inOrder ? {} : { steps: [{ op: 'sort', by: [{ column: date.column.id, descending: false }] }] })
    })
  }

  if (by !== null) {
    const onePerName = by.profile.distinct === table.rows.length
    if (onePerName && table.rows.length <= DASHBOARD_LIMITS.bars) {
      const series = numbers.slice(0, DASHBOARD_LIMITS.series)
      addFigure({
        kind: 'bar',
        x: by.column.id,
        y: series.map((one) => one.column.id),
        caption: plain(`${series.map((one) => one.column.name).join(', ')} by ${by.column.name}`),
        alt: plain(`Bars of ${series.map((one) => one.column.name).join(', ')} by ${by.column.name}`),
        why: `Bars, because "${by.column.name}" names one thing per row and bars are what compare amounts side by side.`
      })
      // Parts of a whole: only with few enough slices to read, and only where nothing is negative -- a share of a
      // total that something was taken away from is not a share of anything.
      const amounts = table.rows.map((row) => asNumber(row.cells[numbers[0].index] ?? null))
      const positive = amounts.filter((one): one is number => one !== null)
      if (
        !rateLike(numbers[0].column) &&
        by.profile.distinct <= PIE_LIMITS.slices &&
        positive.length === amounts.length &&
        positive.every((one) => one >= 0) &&
        positive.some((one) => one > 0)
      ) {
        addFigure({
          kind: 'pie',
          x: by.column.id,
          y: [numbers[0].column.id],
          caption: plain(`${numbers[0].column.name} as shares of the total`),
          alt: plain(`A pie of ${numbers[0].column.name} by ${by.column.name}`),
          why: `A pie, because there are ${num(by.profile.distinct)} of them and every amount is positive, so each one really is a share of one total.`
        })
      }
    } else if (!onePerName) {
      const as = `Total ${numbers[0].column.name}`
      addFigure({
        kind: 'bar',
        x: by.column.id,
        y: [as],
        caption: plain(`${as} by ${by.column.name}`),
        alt: plain(`Bars of ${as} by ${by.column.name}`),
        why: `Bars of the totals, because "${by.column.name}" appears on more than one row: the table is totalled by it first and the chart is of those totals.`,
        steps: [{ op: 'group', by: [by.column.id], totals: [{ column: numbers[0].column.id, how: 'sum', as }] }]
      })
    } else {
      leftOut.push({ column: by.column.name, why: `a chart by it would need ${num(table.rows.length)} bars, which cannot be read; the breakdown above has the figures instead` })
    }
  }

  if (figures.length === 0) {
    notes.push('No chart was drawn: this table has no dates to draw against and no column of names to compare by. The figures above are all of it there is to show.')
  }

  const source = `Computed by Orbis from "${tableTitle}" (version ${version})`
  const intro = `${num(profile.rows)} rows and ${num(profile.columns)} columns${profile.source ? `, from ${plain(profile.source)}` : ''}. Every figure here was worked out by Orbis from the table; nothing on this page was written by a model. The figures are of version ${version}: they do not change when the table does, so draw the dashboard again when it has.`

  const method = [
    'Counts, totals and averages come from reading every cell: a value that could not be read as a number is left out of the figure and counted separately.',
    'The breakdown gathers the rows by one column and totals each group with the same engine the rest of Orbis totals with.',
    'Each chart is a chart of its own, drawn from the table\'s columns. The page points at it, so a chart redrawn later is the chart this page shows next time it is saved.'
  ]

  return { title: `Dashboard of ${tableTitle}`, source, intro, headlines, breakdown, figures, leftOut, notes, method }
}

// ---------------------------------------------------------------- the document

const cell = (value: string, header = false, align: TableCell['align'] = 'left'): TableCell => ({ content: [text(value)], colSpan: 1, rowSpan: 1, header, align })

/**
 * The plan as a document, with the charts that were drawn put in as figures.
 *
 * A figure is a reference -- `artifact:<id>` -- which is how the existing chart figures work: the drawing is read from
 * the chart when the document is written out, so a chart redrawn after its table changed is the chart this page shows
 * the next time it is saved. A chart that was not drawn leaves the sentence saying why, in the place it would have
 * been, because a missing picture with nothing said is the one thing a reader cannot see.
 */
export function dashboardDocument(plan: DashboardPlan, drawn: readonly DrawnFigure[] = [], undrawn: readonly UndrawnFigure[] = []): StructuredDocument {
  const document = emptyDocument('dashboard', plan.title)
  document.metadata.source = plan.source
  const blocks: Block[] = []
  let n = 0
  const id = (): string => `d-${++n}`
  const heading = (level: 1 | 2, value: string): Block => ({ id: id(), sectionId: '', kind: 'heading', level, content: [text(value)] })
  const para = (value: string): Block => ({ id: id(), sectionId: '', kind: 'paragraph', content: [text(value)] })

  blocks.push(heading(1, plan.title))
  blocks.push(para(plan.intro))

  blocks.push(heading(2, 'In short'))
  blocks.push({
    id: id(),
    sectionId: '',
    kind: 'table',
    columns: 3,
    rows: [
      [cell('Figure', true), cell('Value', true, 'right'), cell('How it was worked out', true)],
      ...plan.headlines.map((one) => [cell(one.label), cell(one.value, false, 'right'), cell(one.how)])
    ],
    caption: 'Every one of these was computed from the table.',
    label: ''
  })

  if (plan.figures.length > 0) {
    blocks.push(heading(2, 'Charts'))
    for (const want of plan.figures) {
      const made = drawn.find((one) => one.blockId === want.blockId)
      if (made) {
        blocks.push({ id: want.blockId, sectionId: '', kind: 'image', source: `artifact:${made.artifactId}`, alt: want.alt, caption: want.caption, label: '' })
        blocks.push(para(want.why))
        continue
      }
      const why = undrawn.find((one) => one.blockId === want.blockId)?.why ?? 'it could not be drawn'
      blocks.push(para(`There is no chart of ${want.caption.toLowerCase()} here, because ${why}.`))
    }
  }

  if (plan.breakdown) {
    const breakdown = plan.breakdown
    blocks.push(heading(2, `By ${breakdown.by}`))
    blocks.push({
      id: id(),
      sectionId: '',
      kind: 'table',
      columns: breakdown.headers.length,
      rows: [
        breakdown.headers.map((one, at) => cell(one, true, at === 0 ? 'left' : 'right')),
        ...breakdown.rows.map((row) => row.map((value, at) => cell(value, false, at === 0 ? 'left' : 'right')))
      ],
      caption: breakdown.caption,
      label: ''
    })
  }

  if (plan.leftOut.length > 0) {
    blocks.push(heading(2, 'What was left out'))
    blocks.push({
      id: id(),
      sectionId: '',
      kind: 'list',
      style: 'bullet',
      items: plan.leftOut.map((one) => ({ content: [text(`"${one.column}": ${one.why}.`)], checked: false, depth: 0 }))
    })
  }

  blocks.push(heading(2, 'How this was worked out'))
  blocks.push({
    id: id(),
    sectionId: '',
    kind: 'list',
    style: 'bullet',
    items: [...plan.method, ...plan.notes].map((one) => ({ content: [text(one)], checked: false, depth: 0 }))
  })

  document.blocks = blocks
  return document
}
