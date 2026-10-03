import { inflateRawSync } from 'node:zlib'
import ExcelJS from 'exceljs'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import PptxGenJS from 'pptxgenjs'
import { asText, isInvalid, isMissing, isQuantityCell, type Cell, type Column, type Table as DataTable } from '../../shared/compute/data.ts'
import { blockText, inlineText, numbering, resolveReferences, type Block, type Inline, type StructuredDocument } from '../../shared/compute/document.ts'
import { hashOf, type VerifyResult } from '../../shared/compute/interchange.ts'
import { isZipError, readDirectory, readEntry } from '../../shared/portable/zip.ts'
import { planFormulas, sameNumber, type FormulaOptions, type XlsxFormulas } from '../../shared/artifacts/formula.ts'
import type { WrittenShape } from '../../shared/artifacts/validate.ts'

/**
 * The Office formats: a workbook from a table, a Word document and a slide deck from a document.
 *
 * Three libraries write the bytes -- exceljs, docx and pptxgenjs, each MIT -- and the reading back is Orbis's own.
 * A workbook is re-opened with exceljs and its rows, columns and headings compared with the table it came from, which
 * is a true round trip. A Word document and a deck are ZIP packages, so they are opened with the hardened ZIP reader
 * every imported archive goes through, and the parts a real file must have are looked for and counted. Nothing here
 * reports a file as written on the strength of its size and hash alone.
 *
 * What is written is editable where the format allows it: headings are Word's heading styles, lists are Word's
 * numbering, a date in Excel is a date and a number is a number. Nothing is flattened into a picture.
 */

export interface OfficeResult {
  bytes: Uint8Array
  notes: string[]
  /** Slides for a deck, rows for a workbook, paragraphs for a document. */
  count: number
  /** How many pictures were put in, so the read-back can count them. */
  pictures?: number
  /** For a workbook written with live formulas: which cells hold one, so the read-back can look for exactly those. */
  formulas?: XlsxFormulas
}

/** A figure as pixels: what a Word document or a deck can hold. Keyed by the id of the block it stands for. */
export interface Picture {
  png: Uint8Array
  width: number
  height: number
}

export type Pictures = ReadonlyMap<string, Picture>

const NO_PICTURES: Pictures = new Map()

/** A size scaled down to fit inside a box, never up, with its proportions kept. */
const fit = (width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } => {
  const scale = Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

const inflate = (data: Uint8Array): Uint8Array => new Uint8Array(inflateRawSync(data))

const formatBytes = (count: number): string => {
  if (count < 1024) return `${count} B`
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`
  return `${(count / (1024 * 1024)).toFixed(1)} MB`
}

const fileChecks = (expected: WrittenShape, readBack: Uint8Array): VerifyResult['checks'] => [
  { what: 'written', passed: readBack.length === expected.bytes, describe: `The file on disk is ${formatBytes(readBack.length)}; ${formatBytes(expected.bytes)} was written.` },
  { what: 'checksum', passed: hashOf(readBack) === expected.hash, describe: 'The hash of the file on disk matches the one recorded when it was written.' }
]

/** The parts of an Office package, listed through the reader that refuses hostile archives. */
const partsOf = (bytes: Uint8Array): { paths: string[]; read: (path: string) => string | null } | null => {
  const listing = readDirectory(bytes)
  if (isZipError(listing)) return null
  return {
    paths: listing.map((one) => one.path),
    read: (path) => {
      const entry = listing.find((one) => one.path === path)
      if (!entry) return null
      const data = readEntry(bytes, entry, inflate)
      return isZipError(data) ? null : new TextDecoder().decode(data)
    }
  }
}

// ---------------------------------------------------------------- workbook

/** A sheet name Excel accepts: at most 31 characters and none of the seven it forbids. */
const sheetName = (title: string): string => {
  const cleaned = title.replace(/[[\]:*?/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31)
  return cleaned === '' ? 'Sheet1' : cleaned
}

const headingOf = (column: Column): string => (column.unit ? `${column.name} (${column.unit.display})` : column.name)

/** A cell as the Excel value it should be: a number stays a number, a date becomes a date, a bad value stays text. */
const excelValue = (cell: Cell, column: Column): ExcelJS.CellValue => {
  if (cell === null || cell === undefined || isMissing(cell)) return null
  if (isInvalid(cell)) return cell.raw
  if (isQuantityCell(cell)) return cell.value
  if (typeof cell === 'boolean') return cell
  if (typeof cell === 'number') {
    if (column.type === 'date' && Number.isFinite(cell)) return new Date(cell)
    return Number.isFinite(cell) ? cell : null
  }
  return String(cell)
}

/**
 * What else a workbook may hold besides its values.
 *
 * Both are off unless they are asked for, so a table with nothing computed in it is written exactly as it always was.
 * `computed` turns the engine's computed columns into real Excel formulas and `totals` adds a row of them underneath;
 * which cells those are, and whether each one could be written at all, is worked out and proved by
 * `shared/artifacts/formula.ts`, never here.
 */
export type XlsxOptions = Pick<FormulaOptions, 'computed' | 'totals'>

export async function writeXlsx(table: DataTable, title: string, options: XlsxOptions = {}): Promise<OfficeResult> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Orbis'
  workbook.created = new Date(0)
  const sheet = workbook.addWorksheet(sheetName(title))

  sheet.columns = table.columns.map((column, i) => {
    const sample = table.rows.slice(0, 200).map((row) => asText(row.cells[i] ?? null).length)
    const width = Math.min(60, Math.max(10, headingOf(column).length + 2, ...sample.map((n) => n + 2)))
    return { header: headingOf(column), key: column.id, width }
  })
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of table.rows) {
    sheet.addRow(table.columns.map((column, i) => excelValue(row.cells[i] ?? null, column)))
  }
  table.columns.forEach((column, i) => {
    if (column.type === 'date') sheet.getColumn(i + 1).numFmt = 'yyyy-mm-dd'
  })
  if (table.rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: table.rows.length + 1, column: table.columns.length } }
  }

  // Formulas go in after the values, over the top of the cells they belong in, so a table with nothing computed in it
  // goes down exactly the path it always did and the cached value in a formula cell is the number that was already
  // there. Every one of these was proved against the engine's own answer before it got here.
  const plan = planFormulas(table, { ...options, firstDataRow: 2 })
  if (plan.totals) {
    const row = sheet.addRow(table.columns.map((_, i) => (plan.totals && i + 1 === plan.totals.labelColumn ? plan.totals.label : null)))
    row.font = { bold: true }
    row.border = { top: { style: 'thin', color: { argb: 'FFC9CED8' } } }
  }
  for (const cell of plan.cells) {
    sheet.getCell(cell.address).value = { formula: cell.formula, result: cell.value }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const notes: string[] = [...plan.notes]
  if (table.columns.some((one) => one.unit)) notes.push('Units are written into the column headings; Excel has no unit of its own.')
  return {
    bytes: new Uint8Array(buffer as ArrayBuffer),
    notes,
    count: table.rows.length,
    ...(plan.cells.length > 0 ? { formulas: { cells: plan.cells, totalsRow: plan.totals ? plan.totals.row : null } } : {})
  }
}

/**
 * The workbook re-opened and compared with the table: sheets, rows, columns and headings.
 *
 * `written` is what `writeXlsx` said it put in. Given it, the formulas and the numbers cached beside them are looked
 * for in the file itself, cell by cell -- because a formula is the one thing in a workbook that can be wrong while
 * every count still agrees, and a cell nobody read back is a cell nobody checked.
 */
export async function verifyXlsx(table: DataTable, expected: WrittenShape, readBack: Uint8Array, written?: XlsxFormulas): Promise<VerifyResult> {
  const checks = fileChecks(expected, readBack)
  const differences: string[] = []
  let reimported: VerifyResult['reimported'] = null
  const totalsRows = written && written.totalsRow !== null ? 1 : 0
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(readBack as unknown as ExcelJS.Buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet) {
      checks.push({ what: 'opens', passed: false, describe: 'The workbook opened but has no sheet in it.' })
    } else {
      checks.push({ what: 'opens', passed: true, describe: `The workbook opens, with ${workbook.worksheets.length} sheet${workbook.worksheets.length === 1 ? '' : 's'}.` })
      const rows = Math.max(0, sheet.rowCount - 1 - totalsRows)
      const columns = sheet.actualColumnCount
      reimported = { rows, columns }
      const headings = table.columns.map(headingOf)
      const found = (sheet.getRow(1).values as unknown[]).slice(1, headings.length + 1).map((one) => String(one ?? ''))
      const sameShape = rows === table.rows.length && columns === table.columns.length
      const sameHeadings = headings.every((one, i) => found[i] === one)
      checks.push({
        what: 'round trip',
        passed: sameShape && sameHeadings,
        describe: `Reading the workbook back gives ${rows} rows and ${columns} columns${totalsRows ? ', and a row of totals under them' : ''}; the table had ${table.rows.length} and ${table.columns.length}.`
      })
      if (!sameShape) differences.push(`Shape differs: ${table.rows.length}×${table.columns.length} became ${rows}×${columns}.`)
      if (!sameHeadings) differences.push(`The headings read back differ from the table's.`)

      if (written && written.cells.length > 0) {
        let formulasFound = 0
        let valuesFound = 0
        for (const cell of written.cells) {
          const held = sheet.getCell(cell.address).value as { formula?: string; sharedFormula?: string; result?: unknown } | null
          const formula = typeof held === 'object' && held !== null ? (held.formula ?? held.sharedFormula) : undefined
          if (typeof formula === 'string' && formula.replace(/^=/, '') === cell.formula) formulasFound += 1
          else differences.push(`${cell.address} should hold the formula ${cell.formula}${typeof formula === 'string' ? `, and holds ${formula}` : ', and holds no formula'}.`)
          const result = typeof held === 'object' && held !== null ? held.result : undefined
          const same = typeof cell.value === 'number' ? typeof result === 'number' && sameNumber(result, cell.value) : (result ?? '') === ''
          if (same) valuesFound += 1
          else differences.push(`${cell.address} should have ${cell.value === '' ? 'nothing' : cell.value} worked out beside its formula, and has ${result === undefined || result === null ? 'nothing' : String(result)}.`)
        }
        const total = written.cells.length
        checks.push({
          what: 'formulas',
          passed: formulasFound === total,
          describe: `${formulasFound} of ${total} cell${total === 1 ? '' : 's'} in the file hold${formulasFound === 1 ? 's' : ''} the formula that was written for ${total === 1 ? 'it' : 'them'}.`
        })
        checks.push({
          what: 'cached values',
          passed: valuesFound === total,
          describe: `${valuesFound} of ${total} formula${total === 1 ? '' : 's'} have the number Orbis worked out beside them, so the file shows figures before Excel recalculates.`
        })
      }
    }
  } catch (err) {
    checks.push({ what: 'opens', passed: false, describe: `The workbook could not be opened: ${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}` })
  }
  return { ok: checks.every((one) => one.passed), checks, reimported, differences: differences.slice(0, 20) }
}

// ---------------------------------------------------------------- shared document resolution

interface Resolved {
  references: Map<string, string>
  numbers: Map<string, { as: string; number: number }>
  footnotes: Map<string, number>
  footnoteBlocks: Map<string, Extract<Block, { kind: 'footnote' }>>
}

/** The same resolution the HTML writer does: numbers from position, references to text, footnotes in order of use. */
const resolve = (document: StructuredDocument): Resolved => {
  const references = new Map<string, string>()
  for (const one of resolveReferences(document).runsTo) references.set(one.blockId, one.display)
  const numbers = new Map(numbering(document).map((one) => [one.blockId, { as: one.as, number: one.number }]))
  const footnoteBlocks = new Map(document.blocks.filter((one): one is Extract<Block, { kind: 'footnote' }> => one.kind === 'footnote').map((one) => [one.noteId, one]))
  const footnotes = new Map<string, number>()
  for (const block of document.blocks) {
    for (const run of runsIn(block)) if (run.kind === 'footnote' && footnoteBlocks.has(run.noteId) && !footnotes.has(run.noteId)) footnotes.set(run.noteId, footnotes.size + 1)
  }
  return { references, numbers, footnotes, footnoteBlocks }
}

const runsIn = (block: Block): Inline[] => {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'callout':
    case 'footnote':
      return block.content
    case 'list':
      return block.items.flatMap((one) => one.content)
    case 'table':
      return block.rows.flatMap((row) => row.flatMap((cell) => cell.content))
    default:
      return []
  }
}

/** A run as the text a format without links or marks would show. */
const runPlain = (run: Inline, resolved: Resolved): string => {
  switch (run.kind) {
    case 'text':
    case 'link':
      return run.text
    case 'math':
      return run.source
    case 'reference':
      return resolved.references.get(run.targetId) ?? `[missing ${run.as}]`
    case 'citation':
      return `[${run.sourceId}${run.locator ? `, ${run.locator}` : ''}]`
    case 'footnote': {
      const n = resolved.footnotes.get(run.noteId)
      return n === undefined ? '' : `[${n}]`
    }
  }
}

// ---------------------------------------------------------------- Word

const MONO = 'Consolas'

const docxRuns = (runs: readonly Inline[], resolved: Resolved): (TextRun | ExternalHyperlink)[] =>
  runs.map((run) => {
    switch (run.kind) {
      case 'text':
        return new TextRun({
          text: run.text,
          bold: run.marks.includes('bold'),
          italics: run.marks.includes('italic'),
          underline: run.marks.includes('underline') ? {} : undefined,
          strike: run.marks.includes('strike'),
          subScript: run.marks.includes('subscript'),
          superScript: run.marks.includes('superscript'),
          highlight: run.marks.includes('highlight') ? 'yellow' : undefined,
          font: run.marks.includes('code') ? MONO : undefined
        })
      case 'link': {
        const text = new TextRun({ text: run.text, style: 'Hyperlink', bold: run.marks.includes('bold'), italics: run.marks.includes('italic') })
        return /^https?:/i.test(run.href) ? new ExternalHyperlink({ children: [text], link: run.href }) : new TextRun({ text: run.text, underline: {} })
      }
      case 'math':
        return new TextRun({ text: run.source, font: MONO })
      case 'reference':
        return new TextRun({ text: resolved.references.get(run.targetId) ?? `[missing ${run.as}]`, color: resolved.references.has(run.targetId) ? undefined : 'B3261E' })
      case 'citation':
        return new TextRun({ text: `[${run.sourceId}${run.locator ? `, ${run.locator}` : ''}]`, superScript: true })
      case 'footnote': {
        const n = resolved.footnotes.get(run.noteId)
        return new TextRun({ text: n === undefined ? '' : String(n), superScript: true })
      }
    }
  })

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6] as const

const docxBlock = (block: Block, resolved: Resolved, pictures: Pictures = NO_PICTURES): (Paragraph | Table)[] => {
  switch (block.kind) {
    case 'paragraph':
      return [new Paragraph({ children: docxRuns(block.content, resolved), spacing: { after: 160 } })]
    case 'heading':
      return [new Paragraph({ heading: HEADINGS[block.level - 1], children: docxRuns(block.content, resolved) })]
    case 'list':
      return block.items.map(
        (item) =>
          new Paragraph({
            children: [...(block.style === 'task' ? [new TextRun({ text: item.checked ? '☒ ' : '☐ ' })] : []), ...docxRuns(item.content, resolved)],
            ...(block.style === 'ordered' ? { numbering: { reference: 'orbis-numbers', level: Math.min(2, Math.max(0, item.depth)) } } : { bullet: { level: Math.min(2, Math.max(0, item.depth)) } })
          })
      )
    case 'quote':
      return [
        new Paragraph({
          children: docxRuns(block.content, resolved).map((one) => one),
          indent: { left: 720 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'C9CED8', space: 8 } },
          spacing: { after: 160 }
        }),
        ...(block.attribution ? [new Paragraph({ children: [new TextRun({ text: `— ${block.attribution}`, italics: true, color: '6B7280' })], indent: { left: 720 }, spacing: { after: 160 } })] : [])
      ]
    case 'code':
      return block.source.split('\n').map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line === '' ? ' ' : line, font: MONO, size: 18 })],
            shading: { type: ShadingType.CLEAR, fill: 'F4F5F8' },
            spacing: { after: 0 }
          })
      )
    case 'equation': {
      const n = resolved.numbers.get(block.id)
      return [new Paragraph({ children: [new TextRun({ text: block.source, font: MONO }), ...(n ? [new TextRun({ text: `    (${n.number})`, color: '6B7280' })] : [])], alignment: AlignmentType.CENTER, spacing: { after: 160 } })]
    }
    case 'table': {
      const n = resolved.numbers.get(block.id)
      const caption = n || block.caption ? [new Paragraph({ children: [new TextRun({ text: `${n ? `Table ${n.number}. ` : ''}${block.caption}`, italics: true, color: '4B5160', size: 18 })], spacing: { before: 80, after: 200 } })] : []
      const table = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: block.rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: docxRuns(cell.content, resolved).map((run) => (cell.header && run instanceof TextRun ? new TextRun({ text: inlineText(cell.content), bold: true }) : run)), alignment: cell.align === 'center' ? AlignmentType.CENTER : cell.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT })],
                    columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
                    rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
                    shading: cell.header ? { type: ShadingType.CLEAR, fill: 'F4F5F8' } : undefined
                  })
              )
            })
        )
      })
      return [table, ...caption]
    }
    case 'image': {
      const n = resolved.numbers.get(block.id)
      const picture = pictures.get(block.id)
      if (picture) {
        // The page is about six and a half inches wide between its margins; a figure fills it at most.
        const size = fit(picture.width, picture.height, 600, 760)
        const caption = n || block.caption ? [new Paragraph({ children: [new TextRun({ text: `${n ? `Figure ${n.number}. ` : ''}${block.caption}`, italics: true, color: '6B7280', size: 20 })], alignment: AlignmentType.CENTER, spacing: { after: 200 } })] : []
        return [
          new Paragraph({
            children: [new ImageRun({ type: 'png', data: Buffer.from(picture.png), transformation: size, altText: { title: block.alt || block.caption || 'Figure', description: block.alt || block.caption || 'Figure', name: block.id } })],
            alignment: AlignmentType.CENTER,
            spacing: { after: caption.length ? 80 : 200 }
          }),
          ...caption
        ]
      }
      // Nothing is fetched. A figure with no picture to hand is written as what it is: a numbered place with its description.
      return [new Paragraph({ children: [new TextRun({ text: `[${n ? `Figure ${n.number}: ` : ''}${block.alt || block.caption || 'image'}]`, italics: true, color: '6B7280' })], spacing: { after: 160 } })]
    }
    case 'callout':
      return [
        new Paragraph({
          children: [...(block.title ? [new TextRun({ text: `${block.title}  `, bold: true })] : []), ...docxRuns(block.content, resolved)],
          border: { left: { style: BorderStyle.SINGLE, size: 24, color: block.tone === 'warning' ? 'C77D00' : block.tone === 'danger' ? 'B3261E' : block.tone === 'success' ? '1F8A4C' : '0B5FB0', space: 8 } },
          shading: { type: ShadingType.CLEAR, fill: 'F8F9FB' },
          spacing: { after: 160 }
        })
      ]
    case 'divider':
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D8DBE2', space: 1 } }, spacing: { after: 240 } })]
    case 'footnote':
      return []
    case 'embed':
      return [
        ...block.snapshot.split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line === '' ? ' ' : line, font: MONO, size: 18 })], spacing: { after: 0 } })),
        new Paragraph({ children: [new TextRun({ text: `${block.source.describe}${block.live ? '' : ' (may be out of date)'}`, italics: true, color: '6B7280', size: 18 })], spacing: { after: 160 } })
      ]
  }
}

export async function writeDocx(document: StructuredDocument, pictures: Pictures = NO_PICTURES): Promise<OfficeResult> {
  const resolved = resolve(document)
  const children: (Paragraph | Table)[] = []
  const hasTopHeading = document.blocks.some((one) => one.kind === 'heading' && one.level === 1)
  if (document.metadata.title !== '' && !hasTopHeading) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(document.metadata.title)] }))
  for (const block of document.blocks) children.push(...docxBlock(block, resolved, pictures))
  if (resolved.footnotes.size > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Notes')] }))
    for (const [noteId, n] of [...resolved.footnotes.entries()].sort((a, b) => a[1] - b[1])) {
      children.push(new Paragraph({ children: [new TextRun({ text: `${n}. `, superScript: true }), ...docxRuns(resolved.footnoteBlocks.get(noteId)!.content, resolved)], spacing: { after: 80 } }))
    }
  }

  const made = new Document({
    title: document.metadata.title || undefined,
    // Never invented: an empty author is left empty.
    creator: document.metadata.author || undefined,
    description: document.metadata.source || undefined,
    numbering: {
      config: [
        {
          reference: 'orbis-numbers',
          levels: [0, 1, 2].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } }))
        }
      ]
    },
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }]
  })
  const buffer = await Packer.toBuffer(made)
  const notes: string[] = []
  const drawn = document.blocks.filter((one) => one.kind === 'image' && pictures.has(one.id)).length
  const images = document.blocks.filter((one) => one.kind === 'image').length - drawn
  if (images > 0) notes.push(`${images} image${images === 1 ? ' is' : 's are'} written as ${images === 1 ? 'its' : 'their'} description; nothing is fetched.`)
  const paragraphs = children.filter((one) => one instanceof Paragraph).length
  return { bytes: new Uint8Array(buffer), notes, count: paragraphs, pictures: drawn }
}

/** The Word package opened as the ZIP it is, its main part found, and its paragraphs counted. */
export function verifyDocx(expected: WrittenShape & { pictures?: number }, readBack: Uint8Array): VerifyResult {
  const checks = fileChecks(expected, readBack)
  const parts = partsOf(readBack)
  if (!parts) {
    checks.push({ what: 'package', passed: false, describe: 'The file is not a package Word would open.' })
    return { ok: false, checks, reimported: null, differences: [] }
  }
  const hasParts = parts.paths.includes('[Content_Types].xml') && parts.paths.includes('word/document.xml')
  checks.push({ what: 'package', passed: hasParts, describe: hasParts ? 'The package has the parts a Word document must have.' : 'The package is missing word/document.xml or its content types.' })
  const xml = hasParts ? parts.read('word/document.xml') : null
  const paragraphs = xml ? (xml.match(/<w:p[ >]/g) ?? []).length : 0
  checks.push({ what: 'paragraphs', passed: paragraphs > 0, describe: paragraphs > 0 ? `The document has ${paragraphs} paragraph${paragraphs === 1 ? '' : 's'}.` : 'The document has no paragraphs in it.' })
  if ((expected.pictures ?? 0) > 0) checks.push(pictureCheck(parts.paths, 'word/media/', expected.pictures ?? 0))
  return { ok: checks.every((one) => one.passed), checks, reimported: paragraphs > 0 ? { rows: paragraphs, columns: 0 } : null, differences: [] }
}

// ---------------------------------------------------------------- PowerPoint

const BULLETS_PER_SLIDE = 7
const BULLET_CHARS = 220

/** Whether the package holds the pictures that were put in it. */
const pictureCheck = (paths: readonly string[], folder: string, expected: number): VerifyResult['checks'][number] => {
  const found = paths.filter((one) => one.startsWith(folder) && /\.png$/i.test(one)).length
  return { what: 'pictures', passed: found >= expected, describe: `The file holds ${found} picture${found === 1 ? '' : 's'}; ${expected} ${expected === 1 ? 'was' : 'were'} put in.` }
}

interface SlideDraft {
  /** The figure this slide shows, when it is a slide for one. */
  picture?: string
  title: string
  bullets: { text: string; indent: number; mono?: boolean; italic?: boolean }[]
  table: { rows: string[][]; caption: string } | null
  notes: string[]
}

/**
 * A deck planned from the document's own structure.
 *
 * A heading starts a slide; what follows it becomes that slide's bullets, up to seven, and then a continued slide.
 * A table gets a slide of its own. Everything a section says goes into the slide's speaker notes in full, so a
 * sentence that was too long for a bullet is not lost -- it is where a presenter would want it.
 */
export function planSlides(document: StructuredDocument, pictured: ReadonlySet<string> = new Set()): SlideDraft[] {
  const resolved = resolve(document)
  const slides: SlideDraft[] = []
  let current: SlideDraft | null = null
  // The section the text belongs to, so what follows a table slide continues that section rather than starting
  // one named after the whole document.
  let section: { title: string; used: boolean } | null = null
  const open = (title: string): SlideDraft => {
    const slide: SlideDraft = { title, bullets: [], table: null, notes: [] }
    slides.push(slide)
    return slide
  }
  const ensure = (): SlideDraft => {
    if (current) return current
    const title = section ? (section.used ? `${section.title} (continued)` : section.title) : document.metadata.title || 'Overview'
    current = open(title)
    return current
  }
  const bullet = (text: string, indent = 0, extra: Partial<SlideDraft['bullets'][number]> = {}): void => {
    const slide = ensure()
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (trimmed === '') return
    slide.notes.push(trimmed)
    slide.bullets.push({ text: trimmed.length > BULLET_CHARS ? `${trimmed.slice(0, BULLET_CHARS - 1)}…` : trimmed, indent, ...extra })
    if (section) section.used = true
  }

  const plain = (runs: readonly Inline[]): string => runs.map((one) => runPlain(one, resolved)).join('')

  for (const block of document.blocks) {
    switch (block.kind) {
      case 'heading':
        if (block.level <= 2 || current === null) {
          const title = plain(block.content)
          current = open(title)
          section = { title, used: false }
        } else bullet(plain(block.content), 0, { italic: false })
        break
      case 'paragraph':
        bullet(plain(block.content))
        break
      case 'list':
        for (const item of block.items) bullet(`${block.style === 'task' ? (item.checked ? '☒ ' : '☐ ') : ''}${plain(item.content)}`, Math.min(2, Math.max(0, item.depth)))
        break
      case 'quote':
        bullet(`“${plain(block.content)}”${block.attribution ? ` — ${block.attribution}` : ''}`, 0, { italic: true })
        break
      case 'code':
        for (const line of block.source.split('\n').slice(0, 6)) bullet(line, 0, { mono: true })
        if (block.source.split('\n').length > 6) ensure().notes.push(block.source)
        break
      case 'equation':
        bullet(block.source, 0, { mono: true })
        break
      case 'table': {
        const n = resolved.numbers.get(block.id)
        const slide = open(`${n ? `Table ${n.number}` : 'Table'}${block.caption ? `: ${block.caption}` : ''}`)
        slide.table = { rows: block.rows.map((row) => row.map((cell) => plain(cell.content))), caption: block.caption }
        slide.notes.push(blockText(block))
        current = null
        break
      }
      case 'image': {
        const n = resolved.numbers.get(block.id)
        if (pictured.has(block.id)) {
          // A figure with a picture gets a slide of its own, like a table: shrunk beside bullets it cannot be read.
          const slide = open(`${n ? `Figure ${n.number}` : 'Figure'}${block.caption ? `: ${block.caption}` : ''}`)
          slide.picture = block.id
          slide.notes.push(block.alt || block.caption || 'Figure')
          current = null
          break
        }
        bullet(`[${n ? `Figure ${n.number}: ` : ''}${block.alt || block.caption || 'image'}]`, 0, { italic: true })
        break
      }
      case 'callout':
        bullet(`${block.title ? `${block.title}: ` : ''}${plain(block.content)}`)
        break
      case 'embed':
        bullet(block.snapshot.split('\n')[0] ?? '', 0, { mono: true })
        ensure().notes.push(block.snapshot, block.source.describe)
        break
      case 'divider':
      case 'footnote':
        break
    }
  }

  // Too many bullets for one slide run on to a continued one, which keeps the first slide's notes.
  const paged: SlideDraft[] = []
  for (const slide of slides) {
    if (slide.bullets.length <= BULLETS_PER_SLIDE) {
      paged.push(slide)
      continue
    }
    for (let i = 0; i < slide.bullets.length; i += BULLETS_PER_SLIDE) {
      paged.push({ title: i === 0 ? slide.title : `${slide.title} (continued)`, bullets: slide.bullets.slice(i, i + BULLETS_PER_SLIDE), table: null, notes: i === 0 ? slide.notes : [] })
    }
  }
  // A slide with nothing on it is not written. A figure's slide has its picture on it, which is not nothing.
  return paged.filter((one) => one.bullets.length > 0 || one.table !== null || one.picture !== undefined)
}

export async function writePptx(document: StructuredDocument, pictures: Pictures = NO_PICTURES): Promise<OfficeResult> {
  const drafts = planSlides(document, new Set(pictures.keys()))
  let drawn = 0
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = document.metadata.author || 'Orbis'
  pptx.title = document.metadata.title || 'Deck'

  // The title slide, when there is a title to put on it. The author under it when there is one; never the provenance
  // string, which is for the record and reads as nonsense on a slide.
  let count = 0
  if (document.metadata.title !== '') {
    const first = pptx.addSlide()
    first.background = { color: '0B0D12' }
    first.addText(document.metadata.title, { x: 0.6, y: 1.6, w: 8.8, h: 1.4, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI' })
    if (document.metadata.author) first.addText(document.metadata.author, { x: 0.6, y: 3.1, w: 8.8, h: 0.6, fontSize: 14, color: 'A0A7B4', fontFace: 'Segoe UI' })
    count += 1
  }

  for (const draft of drafts) {
    const slide = pptx.addSlide()
    slide.addText(draft.title, { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 26, bold: true, color: '1A1D24', fontFace: 'Segoe UI' })
    const picture = draft.picture ? pictures.get(draft.picture) : undefined
    if (picture) {
      // The space under the title is nine inches by 3.9; the picture is fitted inside it and centred.
      const inches = fit(picture.width, picture.height, 9 * 96, 3.9 * 96)
      const w = inches.width / 96
      const h = inches.height / 96
      slide.addImage({ data: `image/png;base64,${Buffer.from(picture.png).toString('base64')}`, x: 0.5 + (9 - w) / 2, y: 1.3, w, h })
      drawn += 1
    } else if (draft.table) {
      const rows = draft.table.rows.map((row, r) => row.map((text) => ({ text, options: r === 0 ? { bold: true, fill: { color: 'F4F5F8' } } : {} })))
      slide.addTable(rows, { x: 0.5, y: 1.3, w: 9, fontSize: 12, fontFace: 'Segoe UI', border: { type: 'solid', pt: 0.5, color: 'C9CED8' }, autoPage: false })
    } else {
      slide.addText(
        draft.bullets.map((one) => ({
          text: one.text,
          options: { bullet: one.mono ? false : { indent: 18 }, indentLevel: one.indent, fontSize: one.indent > 0 ? 14 : 16, fontFace: one.mono ? 'Consolas' : 'Segoe UI', italic: one.italic === true, color: '1A1D24', breakLine: true }
        })),
        { x: 0.5, y: 1.3, w: 9, h: 3.8, valign: 'top', fontFace: 'Segoe UI' }
      )
    }
    if (draft.notes.length > 0) slide.addNotes(draft.notes.join('\n\n'))
    count += 1
  }

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  const notes = ['Each heading became a slide; the full text of each section is in the speaker notes.']
  return { bytes: new Uint8Array(buffer), notes, count, pictures: drawn }
}

/** The deck opened as the ZIP it is, and its slides counted against the number that were written. */
export function verifyPptx(expected: WrittenShape & { slides: number; pictures?: number }, readBack: Uint8Array): VerifyResult {
  const checks = fileChecks(expected, readBack)
  const parts = partsOf(readBack)
  if (!parts) {
    checks.push({ what: 'package', passed: false, describe: 'The file is not a package PowerPoint would open.' })
    return { ok: false, checks, reimported: null, differences: [] }
  }
  const hasParts = parts.paths.includes('[Content_Types].xml') && parts.paths.includes('ppt/presentation.xml')
  checks.push({ what: 'package', passed: hasParts, describe: hasParts ? 'The package has the parts a deck must have.' : 'The package is missing ppt/presentation.xml or its content types.' })
  const slides = parts.paths.filter((one) => /^ppt\/slides\/slide\d+\.xml$/.test(one)).length
  checks.push({ what: 'slides', passed: slides > 0 && slides === expected.slides, describe: `The deck has ${slides} slide${slides === 1 ? '' : 's'}; ${expected.slides} ${expected.slides === 1 ? 'was' : 'were'} written.` })
  if ((expected.pictures ?? 0) > 0) checks.push(pictureCheck(parts.paths, 'ppt/media/', expected.pictures ?? 0))
  return { ok: checks.every((one) => one.passed), checks, reimported: slides > 0 ? { rows: slides, columns: 0 } : null, differences: [] }
}
