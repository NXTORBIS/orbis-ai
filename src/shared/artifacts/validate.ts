import type { Table } from '../compute/data.ts'
import { fromHtml, fromMarkdown, isDocumentError } from '../compute/document.ts'
import { hashOf, verifyExport, type ExportResult, type VerifyResult } from '../compute/interchange.ts'

/**
 * A written file, read back and checked.
 *
 * `verifyExport` already proves that the *text* Orbis produced round-trips. This proves the *file* does: that what is
 * on disk has the size and hash that were recorded, and that it parses back into the shape it came from. Nothing may
 * report an artifact as saved before one of these returns `ok`, and the checks are named so "verified" means a list a
 * person can read rather than a badge.
 *
 * Pure: the bytes come in as an argument. Reading the file is the caller's job, because the caller is the one that
 * knows where it was written.
 */

const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: false }).decode(bytes)

const formatBytes = (count: number): string => {
  if (count < 1024) return `${count} B`
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`
  return `${(count / (1024 * 1024)).toFixed(1)} MB`
}

/** What was written, as far as the file is concerned: its length and its hash. The text formats carry more. */
export interface WrittenShape {
  bytes: number
  hash: string
}

const fileChecks = (expected: WrittenShape, readBack: Uint8Array): VerifyResult['checks'] => [
  {
    what: 'written',
    passed: readBack.length === expected.bytes,
    describe: `The file on disk is ${formatBytes(readBack.length)}; ${formatBytes(expected.bytes)} was written.`
  },
  {
    what: 'checksum',
    passed: hashOf(readBack) === expected.hash,
    describe: 'The hash of the file on disk matches the one recorded when it was written.'
  }
]

/** A table's file: size, hash, and the round trip through the parser. */
export function verifyTableFile(original: Table, expected: ExportResult, readBack: Uint8Array): VerifyResult {
  const checks = fileChecks(expected, readBack)
  // The round trip runs on what is on disk, not on the text that was meant to be written. That is the difference.
  const roundTrip = verifyExport(original, { ...expected, text: decode(readBack) })
  return {
    ok: checks.every((one) => one.passed) && roundTrip.ok,
    checks: [...checks, ...roundTrip.checks],
    reimported: roundTrip.reimported,
    differences: roundTrip.differences
  }
}

/**
 * A document's file: size, hash, and that it reads back as a document.
 *
 * Markdown round-trips block for block, so a different count is a failed check. HTML is read back through the
 * importer's allow-list, which folds some structure (a figure's caption, a footnote section) into other blocks, so
 * for HTML the check is that it reads back as a document at all, and a different count is reported as a difference
 * rather than a failure -- the honest description of what was checked.
 */
export function verifyDocumentFile(blocks: number, expected: ExportResult, readBack: Uint8Array): VerifyResult {
  const checks = fileChecks(expected, readBack)
  const differences: string[] = []
  let reimported: VerifyResult['reimported'] = null
  if (expected.format === 'markdown' || expected.format === 'html') {
    const text = decode(readBack)
    const parsed = expected.format === 'markdown' ? fromMarkdown(text, 'verify') : fromHtml(text, 'verify')
    if (isDocumentError(parsed)) {
      checks.push({ what: 'round trip', passed: false, describe: `The file could not be read back as a document: ${parsed.message}` })
    } else {
      reimported = { rows: parsed.blocks.length, columns: 0 }
      const same = parsed.blocks.length === blocks
      if (expected.format === 'markdown') {
        checks.push({ what: 'round trip', passed: same, describe: `Reading the file back gives ${parsed.blocks.length} blocks; the document had ${blocks}.` })
      } else {
        checks.push({ what: 'round trip', passed: parsed.blocks.length > 0, describe: `Reading the file back through the HTML importer gives ${parsed.blocks.length} blocks; the document had ${blocks}.` })
      }
      if (!same) differences.push(`Block count differs: ${blocks} became ${parsed.blocks.length}.${expected.format === 'html' ? ' The HTML importer folds captions and notes into neighbouring blocks, so this is expected for a document with figures or footnotes.' : ''}`)
    }
  } else {
    checks.push({
      what: 'round trip',
      passed: true,
      describe: `${expected.format} is not read back for comparison; the size and checksum were checked.`
    })
  }
  return { ok: checks.every((one) => one.passed), checks, reimported, differences }
}

/** How many pages a PDF declares. Counted from its own page objects; `/Type /Pages` is the tree and is not a page. */
export function pdfPageCount(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes)
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)
  return matches ? matches.length : 0
}

/** A PDF file: size, hash, that it is a PDF at all, and that it has at least one page. */
export function verifyPdfFile(expected: WrittenShape, readBack: Uint8Array): VerifyResult {
  const checks = fileChecks(expected, readBack)
  const head = new TextDecoder('latin1').decode(readBack.subarray(0, 5))
  checks.push({ what: 'pdf', passed: head === '%PDF-', describe: head === '%PDF-' ? 'The file begins the way every PDF does.' : 'The file does not begin as a PDF does.' })
  const pages = pdfPageCount(readBack)
  checks.push({ what: 'pages', passed: pages > 0, describe: pages > 0 ? `The PDF has ${pages} page${pages === 1 ? '' : 's'}.` : 'The PDF declares no pages.' })
  return { ok: checks.every((one) => one.passed), checks, reimported: pages > 0 ? { rows: pages, columns: 0 } : null, differences: [] }
}
