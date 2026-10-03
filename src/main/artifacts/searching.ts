import { ARTIFACT_KINDS, isArtifactKindId, type ArtifactKindId } from '../../shared/artifacts/kinds.ts'

/**
 * Finding the things you made, for a search that is not the Create screen.
 *
 * The Create screen has its own search (`artifact.search` in service.ts), and it reads the stored copy of every
 * artifact looking for the words -- up to a megabyte of a file each time. That is the right trade there: somebody is
 * standing in their own library, looking for one thing they know is in it, and a slow answer is fine.
 *
 * This is the other place: a search in the browser, where artifacts are one group among web results, nobody asked for
 * them by name, and the answer has to arrive while the page is still being drawn. So this reads nothing off disk. It
 * is given the records the store already holds -- a title, a kind, a size, when it changed, and the sentences kept
 * with it -- and ranks those. A record is a few hundred bytes; a table is not.
 *
 * Three things it deliberately will not do:
 *
 *   - **It never opens an artifact.** No content is read, so no content can be handed back: the snippet is one of the
 *     sentences Orbis itself wrote about where the thing came from, never a slice of what is in it. That matters more
 *     here than on the Create screen, because this runs inside a browser page: an artifact kept with "write it
 *     anyway" past the secret gate would otherwise have its key read out in a list of search results.
 *   - **It never searches a table's column names.** They are not in the record -- they are in the table -- and reading
 *     the table to find them is the thing this file exists not to do. A caller that has such words cheaply to hand can
 *     pass them as `words`; nothing passes them today, and the doc comment on the field says so rather than implying
 *     a search that does not happen.
 *   - **It never throws.** A group of your own files is an extra on a page of search results. Anything that goes
 *     wrong here means that group is not there, and never that the search failed.
 *
 * An empty query finds nothing. The Create screen lists everything when nothing is typed, because listing is what a
 * library is for; here a search for nothing in particular would put every file you own on a page you did not ask to
 * put them on.
 */

export const MADE_LIMITS = Object.freeze({
  /** How much of a query is read. Past this is not a search, it is a paste. */
  query: 120,
  /** How many words of it are matched. */
  words: 8,
  /** How many records are looked at, newest first. A profile with more has its oldest left out, not read. */
  records: 400,
  /** How many rows are handed back. A group, not a second results page. */
  rows: 5,
  /** How long a snippet may be. */
  snippet: 180,
  /** How much of one record's kept sentences is matched against. */
  kept: 2_000
})

/** What the store already knows about one artifact. Everything here is in its record; nothing is read off disk. */
export interface MadeArtifact {
  artifactId: string
  title: string
  kind: ArtifactKindId
  /** When it last changed, as milliseconds. Turned into "changed yesterday" for the person reading it. */
  updatedAt: number
  /** For a table, rows and columns. For a document, how many parts. For code, lines. Named by `sizeOf` per kind. */
  shape: { rows: number; columns: number }
  /** The sentences kept with the artifact: where it came from, and what a model had a hand in. */
  notes: readonly string[]
  /** Where the content came from, in a few words: a file name, "pasted", an operation. */
  source: string
  /**
   * More words to match, when a caller has them without opening anything.
   *
   * Nothing passes this today. It is here so that if the store ever keeps a summary of its own -- a table's column
   * names, say -- the words can be searched without this file learning how to read a table.
   */
  words?: string
}

/** One row of the group: enough to draw it and to open it, and nothing else. */
export interface MadeRow {
  /** The artifact id, which is the handle the browser sends back to open it. */
  id: string
  title: string
  kind: ArtifactKindId
  /** What it is, in words: "Table, 120 rows, changed yesterday". */
  summary: string
  /** One sentence Orbis kept about it, or empty. Never any of its content. */
  snippet: string
}

export interface ArtifactSearchDeps {
  /** Every artifact of this profile, as records. Newest first is expected but not relied on. */
  list(): Promise<readonly MadeArtifact[]> | readonly MadeArtifact[]
  /** Now. Injected so "changed yesterday" can be tested. */
  now?(): number
  /** How many rows at most, never more than `MADE_LIMITS.rows`. */
  rows?: number
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** A sentence cut to fit, at a word if there is one, with a mark to say it goes on. */
function shorten(text: string, limit: number): string {
  const said = collapse(text)
  if (said.length <= limit) return said
  const cut = said.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`
}

/**
 * How big it is, in the same words the rest of the engine uses for each kind.
 *
 * A document is counted in parts rather than in blocks: a heading, a paragraph, a list and a table are each one part,
 * and "28 parts" is what somebody reading a search result can make sense of. Empty when a count would say nothing --
 * a chart with no points is drawn from a table that had none, and the chart is still the thing you made.
 */
function sizeOf(kind: ArtifactKindId, shape: { rows: number; columns: number }): string {
  const rows = Number.isFinite(shape?.rows) ? Math.max(0, Math.floor(shape.rows)) : 0
  const columns = Number.isFinite(shape?.columns) ? Math.max(0, Math.floor(shape.columns)) : 0
  const many = (n: number, one: string, more = `${one}s`): string => `${n.toLocaleString('en')} ${n === 1 ? one : more}`
  if (rows === 0 && columns === 0) return ''
  switch (kind) {
    case 'table':
      return many(rows, 'row')
    case 'document':
      return many(rows, 'part')
    case 'plot':
      return many(rows, 'point')
    case 'diagram':
      return columns > 0 ? `${many(rows, 'box', 'boxes')} and ${many(columns, 'arrow')}` : many(rows, 'box', 'boxes')
    case 'code':
      return many(rows, 'line')
    case 'project':
      return many(rows, 'file')
    // A picture and a video say how big they are; a sound says how long it is. Nothing here opens the file.
    case 'image':
    case 'video':
      return columns > 0 && rows > 0 ? `${columns.toLocaleString('en')} × ${rows.toLocaleString('en')}` : ''
    case 'audio':
      return many(rows, 'second')
  }
}

/** The day something happened, so "yesterday" means the day before today and not twenty-four hours ago. */
const dayOf = (ms: number): number => {
  const when = new Date(ms)
  return Date.UTC(when.getFullYear(), when.getMonth(), when.getDate())
}

/**
 * When it last changed, in the words a person would use.
 *
 * Days, not hours: something changed at eleven last night and read at nine this morning changed *yesterday*, however
 * few hours ago that was. Past a week the day itself is more use than a count, and the year is said only when it is
 * not this one. A record whose time is in the future -- a clock that went back, a file copied from another computer --
 * is called today rather than "in 3 days".
 */
export function changedWhen(updatedAt: number, now: number): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 'changed at some point'
  const days = Math.round((dayOf(now) - dayOf(updatedAt)) / 86_400_000)
  if (days <= 0) return now - updatedAt < 120_000 && now >= updatedAt ? 'changed just now' : 'changed today'
  if (days === 1) return 'changed yesterday'
  if (days < 7) return `changed ${days} days ago`
  const when = new Date(updatedAt)
  const sameYear = when.getFullYear() === new Date(now).getFullYear()
  return `changed on ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })}`
}

/** "Table, 120 rows, changed yesterday". The kind first, because it is what tells you whether to press it. */
export function summaryOfMade(one: MadeArtifact, now: number): string {
  const size = sizeOf(one.kind, one.shape ?? { rows: 0, columns: 0 })
  return [ARTIFACT_KINDS[one.kind].name, size, changedWhen(one.updatedAt, now)].filter((part) => part !== '').join(', ')
}

/** Whether a record is one this can rank at all. A damaged one is left out, never guessed at. */
const usable = (one: unknown): one is MadeArtifact => {
  const record = one as MadeArtifact | null
  return (
    !!record &&
    typeof record.artifactId === 'string' &&
    record.artifactId !== '' &&
    typeof record.title === 'string' &&
    collapse(record.title) !== '' &&
    isArtifactKindId(record.kind)
  )
}

/**
 * Artifacts that match, best first, as rows ready to draw.
 *
 * The ranking, in order, and every word has to be found somewhere for a record to count at all:
 *
 *   4  the title is exactly what was typed
 *   3  the title begins with what was typed
 *   2  every word is in the title
 *   1  every word is in the title, the kind's name, where it came from, or the sentences kept with it
 *
 * Then the one changed most recently, and then by name, so the same query always gives the same order.
 */
export async function searchArtifacts(query: unknown, deps: ArtifactSearchDeps): Promise<MadeRow[]> {
  try {
    const asked = collapse(typeof query === 'string' ? query.slice(0, MADE_LIMITS.query) : '').toLowerCase()
    if (asked === '') return []
    const words = asked.split(' ').filter((one) => one !== '').slice(0, MADE_LIMITS.words)
    if (words.length === 0) return []
    const now = deps.now?.() ?? Date.now()
    const wanted = Math.max(1, Math.min(MADE_LIMITS.rows, Math.floor(deps.rows ?? MADE_LIMITS.rows)))

    const all = (await deps.list()) ?? []
    const found: { row: MadeRow; rank: number; at: number }[] = []
    for (const one of Array.from(all).slice(0, MADE_LIMITS.records)) {
      if (!usable(one)) continue
      const title = collapse(one.title).toLowerCase()
      const notes = Array.isArray(one.notes) ? one.notes.filter((note) => typeof note === 'string') : []
      const kept = `${ARTIFACT_KINDS[one.kind].name} ${typeof one.source === 'string' ? one.source : ''} ${notes.join(' ')} ${typeof one.words === 'string' ? one.words : ''}`
        .slice(0, MADE_LIMITS.kept)
        .toLowerCase()
      const rank =
        title === asked
          ? 4
          : title.startsWith(asked)
            ? 3
            : words.every((word) => title.includes(word))
              ? 2
              : words.every((word) => title.includes(word) || kept.includes(word))
                ? 1
                : 0
      if (rank === 0) continue
      // The note that mentions what was asked for, or else the first thing Orbis wrote about it. Not its content.
      const note = notes.find((one) => words.some((word) => one.toLowerCase().includes(word))) ?? notes[0] ?? ''
      found.push({
        rank,
        at: Number.isFinite(one.updatedAt) ? one.updatedAt : 0,
        row: {
          id: one.artifactId,
          title: shorten(one.title, 120),
          kind: one.kind,
          summary: summaryOfMade(one, now),
          snippet: shorten(note, MADE_LIMITS.snippet)
        }
      })
    }

    return found
      .sort((a, b) => b.rank - a.rank || b.at - a.at || a.row.title.localeCompare(b.row.title))
      .slice(0, wanted)
      .map((one) => one.row)
  } catch {
    // A group of your own files is an extra on a page of web results. If this cannot answer, the group is not there.
    return []
  }
}
