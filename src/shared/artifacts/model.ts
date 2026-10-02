import type { Table } from '../compute/data.ts'
import type { StructuredDocument } from '../compute/document.ts'
import { formatById, type FormatId, type LossReport, type VerifyResult } from '../compute/interchange.ts'
import type { Plot } from '../compute/plot.ts'
import type { Artifact as Diagram } from '../pages/builders.ts'
import { canWrite, isArtifactKindId, type ArtifactKindId } from './kinds.ts'

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
 *
 * **Nothing is ever replaced.** A change to an artifact is a new version beside the old one, and the old one keeps its
 * files. Restoring is making an older version current again -- as a new version, with a reason -- so the history is
 * only ever added to. The dangerous change is not the one that fails; it is the plausible one, and the old copy is
 * the only thing that lets anybody check.
 */

export type ArtifactBody =
  | { kind: 'table'; table: Table }
  | { kind: 'document'; document: StructuredDocument }
  /** A chart: the plot engine's own model, with its axes already decided. `as: 'pie'` draws its one series as shares of a whole. */
  | { kind: 'plot'; plot: Plot; as?: 'pie' }
  /** Boxes and arrows: the builders' own editable artifact, never a picture. */
  | { kind: 'diagram'; diagram: Diagram }
  /** One source file: its language and its text, exactly as written. Never run. */
  | { kind: 'code'; code: { language: string; source: string } }

const ID_PATTERN = /^artifact_[0-9a-f]{32}$/
const VERSION_PATTERN = /^v[0-9a-f]{32}$/

/** Checked wherever an id arrives from outside, because a folder name is assembled from it. */
export const isArtifactId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value)

/** A version id, checked for the same reason: it names a folder. */
export const isVersionId = (value: unknown): value is string => typeof value === 'string' && VERSION_PATTERN.test(value)

/** A new id from 32 hex characters of randomness. Anything else is refused rather than padded. */
export function makeArtifactId(random: string): string {
  const hex = random.toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('An artifact id needs 32 hexadecimal characters of randomness.')
  return `artifact_${hex}`
}

export function makeVersionId(random: string): string {
  const hex = random.toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('A version id needs 32 hexadecimal characters of randomness.')
  return `v${hex}`
}

/** One earlier version of an artifact: enough to list it, open it and bring it back. Its files are kept beside it. */
export interface VersionSummary {
  versionId: string
  version: number
  createdAt: number
  /** Why this version was made, in the words that made it. Empty for the first. */
  reason: string
  format: FormatId
  file: string
  bytes: number
  hash: string
  shape: { rows: number; columns: number }
}

/** What is kept about an artifact. No content: that is on disk, in the file this record names. */
export interface ArtifactRecord {
  artifactId: string
  /** This version's own id. A new one for every version; never reused. */
  versionId: string
  /** 1 for the first version, counting up. Never reset by a restore: restoring is a new version too. */
  version: number
  /** Every earlier version, oldest first. Their files are kept under the artifact's own folder. */
  versions: VersionSummary[]
  /** Why this version was made. Empty for the first. */
  reason: string
  /** The artifact and version this was made as a copy of, when it was. Never a copy of content, only a pointer. */
  derivedFrom: { artifactId: string; versionId: string; title: string } | null
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
  /**
   * The chat this was made in, when it was made in one. A pointer, never a copy of the conversation: it is what lets
   * "add a chart to it" find the thing "it" is, and what lets a conversation list what was made in it.
   */
  conversationId?: string
}

/** The handle that crosses every boundary: enough to find, name and trust an artifact, and nothing to leak. */
export interface ArtifactRef {
  artifactId: string
  versionId: string
  version: number
  kind: ArtifactKindId
  title: string
  format: FormatId
  bytes: number
  hash: string
  verified: boolean
}

export const refOf = (record: ArtifactRecord): ArtifactRef => ({
  artifactId: record.artifactId,
  versionId: record.versionId,
  version: record.version,
  kind: record.kind,
  title: record.title,
  format: record.format,
  bytes: record.bytes,
  hash: record.hash,
  verified: record.verified.ok
})

/**
 * A pointer that arrived from somewhere not trusted to shape it -- a saved chat, a page. Null unless every part is
 * what it should be. A pointer is only ever a way to ask the library; nothing on it is believed without asking.
 */
export function readRef(value: unknown): ArtifactRef | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (!isArtifactId(r.artifactId) || !isVersionId(r.versionId) || !isArtifactKindId(r.kind)) return null
  if (typeof r.version !== 'number' || !Number.isInteger(r.version) || r.version < 1) return null
  if (typeof r.title !== 'string' || typeof r.format !== 'string' || formatById(r.format) === null) return null
  return {
    artifactId: r.artifactId,
    versionId: r.versionId,
    version: r.version,
    kind: r.kind,
    title: r.title.slice(0, 300),
    format: r.format as FormatId,
    bytes: typeof r.bytes === 'number' && Number.isFinite(r.bytes) && r.bytes >= 0 ? r.bytes : 0,
    hash: typeof r.hash === 'string' ? r.hash.slice(0, 128) : '',
    verified: r.verified === true
  }
}

/** What a reply did with an artifact, as the card under it shows. */
export type CardAction = 'made' | 'changed' | 'drew' | 'kept' | 'shown'
const CARD_ACTIONS: readonly CardAction[] = Object.freeze(['made', 'changed', 'drew', 'kept', 'shown'])

/** The cards on a message, as it is saved: a pointer, what was done, and the format that was asked for. */
export interface ArtifactCardRef {
  ref: ArtifactRef
  action: CardAction
  did: string[]
  format?: FormatId
}

/** The cards on a saved message, with anything that is not a card left out. Never throws: a chat is worth more than its cards. */
export function readCards(value: unknown): ArtifactCardRef[] {
  if (!Array.isArray(value)) return []
  const out: ArtifactCardRef[] = []
  for (const one of value.slice(0, 12)) {
    if (typeof one !== 'object' || one === null) continue
    const c = one as Record<string, unknown>
    const ref = readRef(c.ref)
    if (!ref || !CARD_ACTIONS.includes(c.action as CardAction)) continue
    const did = Array.isArray(c.did) ? c.did.filter((line): line is string => typeof line === 'string').slice(0, 8).map((line) => line.slice(0, 400)) : []
    out.push({ ref, action: c.action as CardAction, did, ...(typeof c.format === 'string' && canWrite(ref.kind, c.format) ? { format: c.format } : {}) })
  }
  return out
}

/** This version, as it will be listed once something newer replaces it. */
export const summaryOf = (record: ArtifactRecord): VersionSummary => ({
  versionId: record.versionId,
  version: record.version,
  createdAt: record.updatedAt,
  reason: record.reason,
  format: record.format,
  file: record.file,
  bytes: record.bytes,
  hash: record.hash,
  shape: record.shape
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

/**
 * A record read from disk, accepted field by field -- and brought forward when it was written before versions existed.
 *
 * A record from the first days has no version fields. It is not refused: it is given version 1, a version id derived
 * from its hash, no history and no origin, which is exactly what was true of it. Refusing it would make every artifact
 * made before this change vanish from the library with no message, which is the failure this function exists to
 * prevent.
 */
export function readRecord(value: unknown): ArtifactRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  const base =
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
  if (!base) return null
  const record = r as unknown as ArtifactRecord
  const versionId = isVersionId(r.versionId) ? r.versionId : makeVersionId(String(r.hash).replace(/[^0-9a-f]/gi, '').padEnd(32, '0').slice(0, 32))
  const derived = r.derivedFrom
  const derivedFrom =
    typeof derived === 'object' && derived !== null && isArtifactId((derived as Record<string, unknown>).artifactId)
      ? {
          artifactId: (derived as Record<string, unknown>).artifactId as string,
          versionId: String((derived as Record<string, unknown>).versionId ?? ''),
          title: String((derived as Record<string, unknown>).title ?? '')
        }
      : null
  const { conversationId: _conversation, ...rest } = record
  return {
    ...rest,
    versionId,
    version: typeof r.version === 'number' && r.version >= 1 ? Math.floor(r.version) : 1,
    versions: Array.isArray(r.versions) ? (r.versions as unknown[]).filter(isVersionSummary) : [],
    reason: typeof r.reason === 'string' ? r.reason : '',
    derivedFrom,
    // Only a plain id is kept. Anything else that turned up in that field is dropped rather than trusted.
    ...(isConversationId(r.conversationId) ? { conversationId: r.conversationId } : {})
  }
}

/** A conversation id as Orbis makes them: short, and made of characters that mean nothing to a file system. */
export const isConversationId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)

const isVersionSummary = (value: unknown): value is VersionSummary => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return isVersionId(v.versionId) && typeof v.version === 'number' && typeof v.createdAt === 'number' && typeof v.file === 'string' && typeof v.hash === 'string'
}

/** Whether a value is a complete record. Kept for callers that want a yes or no rather than a normalised copy. */
export const isArtifactRecord = (value: unknown): value is ArtifactRecord => readRecord(value) !== null
