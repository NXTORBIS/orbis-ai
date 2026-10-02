import type { Table } from '../compute/data.ts'
import { fromMarkdown, isDocumentError } from '../compute/document.ts'
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

const fileChecks = (expected: ExportResult, readBack: Uint8Array): VerifyResult['checks'] => [
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

/** A document's file: size, hash, and that it reads back as a document with the same number of blocks. */
export function verifyDocumentFile(blocks: number, expected: ExportResult, readBack: Uint8Array): VerifyResult {
  const checks = fileChecks(expected, readBack)
  const differences: string[] = []
  let reimported: VerifyResult['reimported'] = null
  if (expected.format === 'markdown') {
    const parsed = fromMarkdown(decode(readBack), 'verify')
    if (isDocumentError(parsed)) {
      checks.push({ what: 'round trip', passed: false, describe: `The file could not be read back as a document: ${parsed.message}` })
    } else {
      reimported = { rows: parsed.blocks.length, columns: 0 }
      const same = parsed.blocks.length === blocks
      checks.push({
        what: 'round trip',
        passed: same,
        describe: `Reading the file back gives ${parsed.blocks.length} blocks; the document had ${blocks}.`
      })
      if (!same) differences.push(`Block count differs: ${blocks} became ${parsed.blocks.length}.`)
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
