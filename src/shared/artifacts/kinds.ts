import { FORMATS, type FormatId } from '../compute/interchange.ts'

/**
 * What Orbis can create, in one table.
 *
 * This is the single answer to "what can Orbis make?" -- asked by the planner, by the interface, by the one IPC
 * channel, and by the test that keeps the list honest. Nothing else may assume a kind or a format exists: an engine
 * that is not in this table is not an engine, however finished its code is.
 *
 * The rule for what goes in `writes` is strict on purpose: a format is listed only when there is a writer for it that
 * is tested and whose output is read back and checked. A format Orbis *could* write, or writes badly, is not listed.
 * `exportDocument` produces blank lines for anything but Markdown, so `document` writes Markdown and nothing else
 * until an HTML writer exists -- a listed format that silently empties a document would be worse than an unlisted one.
 *
 * Every id and every format name here is a stable, plain word. A model is shown this table and may name only what
 * is in it; the plain words are the ones it is told to use.
 */

export type ArtifactKindId = 'table' | 'document'

export interface ArtifactKind {
  id: ArtifactKindId
  /** What a person would call it. */
  name: string
  /** One sentence, for the interface and for the model. */
  describe: string
  /** The existing Orbis model it is built from. Named so nobody writes a second one. */
  builtFrom: string
  /** The formats Orbis writes for this kind today. Only what has a tested writer whose output is verified. */
  writes: readonly FormatId[]
  /** The format the stored copy is kept in. The source of every export, so it has to carry everything. */
  stores: FormatId
  /** The formats Orbis can read into this kind. */
  reads: readonly FormatId[]
  /** Whether a model may name this kind when planning. */
  orionMayName: boolean
}

export const ARTIFACT_KINDS: Readonly<Record<ArtifactKindId, ArtifactKind>> = Object.freeze({
  table: Object.freeze({
    id: 'table',
    name: 'Table',
    describe: 'Rows and columns of values, with a type and optionally a unit for each column.',
    builtFrom: 'Table in src/shared/compute/data.ts',
    writes: Object.freeze(['csv', 'tsv', 'json', 'ndjson'] as const),
    stores: 'json',
    reads: Object.freeze(['csv', 'tsv', 'json', 'ndjson'] as const),
    orionMayName: true
  }),
  document: Object.freeze({
    id: 'document',
    name: 'Document',
    describe: 'Headings, paragraphs, lists, tables and figures, with numbering and references.',
    builtFrom: 'StructuredDocument in src/shared/compute/document.ts',
    writes: Object.freeze(['markdown'] as const),
    stores: 'markdown',
    reads: Object.freeze(['markdown', 'html'] as const),
    orionMayName: true
  })
})

export const ARTIFACT_KIND_IDS: readonly ArtifactKindId[] = Object.freeze(Object.keys(ARTIFACT_KINDS) as ArtifactKindId[])

export const isArtifactKindId = (value: unknown): value is ArtifactKindId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ARTIFACT_KINDS, value)

/** A kind by id, or null. Never indexes the table with an unchecked string. */
export const kindById = (id: unknown): ArtifactKind | null => (isArtifactKindId(id) ? ARTIFACT_KINDS[id] : null)

/** Whether a kind can be written in a format. The only place this question is answered. */
export const canWrite = (kind: ArtifactKindId, format: string): format is FormatId =>
  (ARTIFACT_KINDS[kind].writes as readonly string[]).includes(format)

/** The first format a kind writes: what is used when nobody asked for one. */
export const defaultFormatFor = (kind: ArtifactKindId): FormatId => ARTIFACT_KINDS[kind].writes[0]

/** The extension a format's files carry, with its dot. */
export const extensionFor = (format: FormatId): string => FORMATS[format].extensions[0]

/** The media type a format's files are served and saved as. */
export const mediaTypeFor = (format: FormatId): string => FORMATS[format].mediaTypes[0]

export interface KindSummary {
  id: ArtifactKindId
  name: string
  describe: string
  writes: { format: FormatId; name: string; extension: string; limitations: readonly string[] }[]
  reads: FormatId[]
}

/**
 * The table, in the shape the interface and the model see it.
 *
 * Built from `ARTIFACT_KINDS` every time rather than kept as a second constant, so the two cannot drift. Each format
 * carries its own limitations from the format registry, because "CSV cannot hold units" belongs next to "CSV".
 */
export function describeKinds(): KindSummary[] {
  return ARTIFACT_KIND_IDS.map((id) => {
    const kind = ARTIFACT_KINDS[id]
    return {
      id,
      name: kind.name,
      describe: kind.describe,
      writes: kind.writes.map((format) => ({
        format,
        name: FORMATS[format].name,
        extension: FORMATS[format].extensions[0],
        limitations: FORMATS[format].limitations
      })),
      reads: [...kind.reads]
    }
  })
}
