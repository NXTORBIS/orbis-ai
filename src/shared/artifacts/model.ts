import type { Table } from '../compute/data.ts'
import type { StructuredDocument } from '../compute/document.ts'
import type { FormatId, LossReport, VerifyResult } from '../compute/interchange.ts'
import type { ArtifactKindId } from './kinds.ts'

/**
 * What an artifact is, apart from how it is written out.
 *
 * Two decisions here shape everything built on top, and both are about what crosses a boundary.
 *
 * **The body is a tagged union over models Orbis already has.** A table is `Table`; a document is
 * `StructuredDocument`. There is no sixth document model and no artifact-specific table, because every writer, every
 * analysis and every verification already speaks those types. A new kind is a new member of this union pointing at an
 * existing model, never a new model.
 *
 * **Content never crosses IPC. A record does.** The renderer and a Page see `ArtifactRecord` -- a title, a kind, a
 * format, sizes, hashes and the verification -- and ask for content separately, bounded. Bytes travel as arrays of
 * small integers at four characters each and the message limit is 256 KB, so a design in which the renderer carries an
 * artifact's bytes works for a short CSV and fails for the first real one.
 */

export type ArtifactBody = { kind: 'table'; table: Table } | { kind: 'document'; document: StructuredDocument }

const ID_PATTERN = /^artifact_[0-9a-f]{32}$/

/** Checked wherever an id arrives from outside, because a folder name is assembled from it. */
export const isArtifactId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value)

/** A new id from 32 hex characters of randomness. Anything else is refused rather than padded. */
export function makeArtifactId(random: string): string {
  const hex = random.toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('An artifact id needs 32 hexadecimal characters of randomness.')
  return `artifact_${hex}`
}

/** What is kept about an artifact. No content: that is on disk, in the file this record names. */
export interface ArtifactRecord {
  artifactId: string
  kind: ArtifactKindId
  title: string
  createdAt: number
  updatedAt: number
  /** The format the stored copy is in: the source every export is rendered from. */
  format: FormatId
  /** The stored file's name inside the artifact's own folder. Fixed by Orbis, never by a caller. */
  file: string
  bytes: number
  /** SHA-256 of the stored bytes, as `verifyExport` records it. */
  hash: string
  /** What the stored format could not carry, worked out before it was written. */
  loss: LossReport
  /** The checks that ran on the stored copy after it was read back. An artifact with `verified.ok === false` is not kept. */
  verified: VerifyResult
  /** Where the content came from, in a sentence: a file name, "pasted", an operation. */
  source: string
  /** For a table: how big. For a document: how many blocks. So a list can say without opening anything. */
  shape: { rows: number; columns: number }
  tags: string[]
  /**
   * What a person should know about where this came from, in sentences. "The columns were chosen by a model." "The
   * rows are examples." Kept with the artifact because provenance that lives only in the moment of creation is lost
   * the moment the screen changes.
   */
  notes: string[]
}

/** The handle that crosses every boundary: enough to find, name and trust an artifact, and nothing to leak. */
export interface ArtifactRef {
  artifactId: string
  kind: ArtifactKindId
  title: string
  format: FormatId
  bytes: number
  hash: string
  verified: boolean
}

export const refOf = (record: ArtifactRecord): ArtifactRef => ({
  artifactId: record.artifactId,
  kind: record.kind,
  title: record.title,
  format: record.format,
  bytes: record.bytes,
  hash: record.hash,
  verified: record.verified.ok
})

/** What an export produced: where it went and what was checked after it got there. */
export interface ExportOutcome {
  artifactId: string
  format: FormatId
  path: string
  bytes: number
  hash: string
  loss: LossReport
  verified: VerifyResult
}

/** Whether a value read from disk is a record. Field by field, so a damaged file is refused rather than trusted. */
export function isArtifactRecord(value: unknown): value is ArtifactRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    isArtifactId(r.artifactId) &&
    typeof r.kind === 'string' &&
    typeof r.title === 'string' &&
    typeof r.createdAt === 'number' &&
    typeof r.updatedAt === 'number' &&
    typeof r.format === 'string' &&
    typeof r.file === 'string' &&
    typeof r.bytes === 'number' &&
    typeof r.hash === 'string' &&
    typeof r.loss === 'object' &&
    r.loss !== null &&
    typeof r.verified === 'object' &&
    r.verified !== null &&
    typeof (r.verified as Record<string, unknown>).ok === 'boolean' &&
    typeof r.source === 'string' &&
    typeof r.shape === 'object' &&
    r.shape !== null &&
    Array.isArray(r.tags) &&
    Array.isArray(r.notes)
  )
}
