/**
 * Reading somebody else's playlist file into rows Orbis can match.
 *
 * ## Four shapes, one output
 *
 * M3U, M3U8, CSV and JSON. They have nothing in common except that each line names a track, so each reader ends at
 * the same place: a list of `Wanted`, in the file's own order, with whatever the file actually gave. Nothing is
 * invented to fill a column the exporter left out — a missing artist stays missing, and the matcher is the thing
 * that decides what to do about it.
 *
 * ## A row that cannot be read is reported, never dropped
 *
 * Every reader returns `skipped` with the line number and the reason. A playlist of 400 that imports 380 and says
 * nothing about the other 20 is how somebody loses twenty tracks without ever knowing it happened.
 *
 * ## Headers are guessed, and the guess is shown
 *
 * CSV exporters disagree about everything: Spotify writes "Track Name", TuneMyMusic writes "Track name", a
 * spreadsheet somebody made by hand writes "song". So the columns are matched loosely and the mapping comes back
 * in the result, so a screen can say "reading column 3 as the artist" and let somebody correct it.
 */

import type { Wanted } from './matching.ts'

export type FileKind = 'm3u' | 'csv' | 'json' | 'text'

export interface Skipped {
  line: number
  text: string
  why: string
}

export interface ReadFile {
  kind: FileKind
  tracks: Wanted[]
  skipped: Skipped[]
  /** The playlist's own name, when the file carries one. */
  name: string | null
  /** Which column was read as what, for CSV. Shown so it can be corrected. */
  columns?: Readonly<Record<string, string>>
  says: string
}

/** What the file looks like, from its name and its first lines. Never from the extension alone. */
export function kindOf(filename: string, text: string): FileKind {
  const head = text.slice(0, 400).trimStart()
  if (head.startsWith('{') || head.startsWith('[')) return 'json'
  if (/\.m3u8?$/i.test(filename) || head.startsWith('#EXTM3U')) return 'm3u'
  if (/\.csv$/i.test(filename)) return 'csv'
  // A first line with several commas or tabs and no scheme is a table, whatever it is called.
  const first = text.split(/\r?\n/)[0] ?? ''
  if ((first.split(',').length >= 3 || first.split('\t').length >= 3) && !/^https?:/i.test(first)) return 'csv'
  return 'text'
}

const seconds = (value: string): number | null => {
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) {
    // Exporters disagree: Spotify writes milliseconds, M3U writes seconds. Anything over an hour is milliseconds.
    return n > 3600 ? Math.round(n / 1000) : Math.round(n)
  }
  const clock = /^(\d+):([0-5]?\d)$/.exec(value.trim())
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  return null
}

// ---------------------------------------------------------------- M3U

/**
 * M3U and M3U8.
 *
 * `#EXTINF:` carries a length and a title, and the line after it is a path or a URL. The title is usually
 * `Artist - Title`, which is a convention rather than a rule, so it is split only when there is exactly one
 * separator — a title containing a dash is far more common than an artist containing one.
 */
export function readM3u(text: string): ReadFile {
  const lines = text.split(/\r?\n/)
  const tracks: Wanted[] = []
  const skipped: Skipped[] = []
  let name: string | null = null
  let pending: { title: string; artist: string | null; duration: number | null } | null = null

  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (line === '') return
    if (line.startsWith('#')) {
      const playlist = /^#PLAYLIST:(.*)$/i.exec(line)
      if (playlist) {
        name = playlist[1].trim() || null
        return
      }
      const info = /^#EXTINF:(-?[\d.]+)\s*,\s*(.*)$/i.exec(line)
      if (!info) return
      const length = Number(info[1])
      const label = info[2].trim()
      const parts = label.split(' - ')
      pending =
        parts.length === 2
          ? { artist: parts[0].trim() || null, title: parts[1].trim(), duration: length > 0 ? Math.round(length) : null }
          : { artist: null, title: label, duration: length > 0 ? Math.round(length) : null }
      return
    }

    // A path or a URL. The filename is the only title when there was no #EXTINF above it.
    const fromPath = line.split(/[\\/]/).pop() ?? line
    const bare = fromPath.replace(/\.[a-z0-9]{1,5}$/i, '')
    const title = pending?.title ?? bare
    if (!title || title.trim() === '') {
      skipped.push({ line: index + 1, text: line.slice(0, 120), why: 'Nothing in that line names a track.' })
      pending = null
      return
    }
    tracks.push({
      title,
      artist: pending?.artist ?? null,
      album: null,
      duration: pending?.duration ?? null
    })
    pending = null
  })

  return {
    kind: 'm3u',
    tracks,
    skipped,
    name,
    says: sentence(tracks.length, skipped.length)
  }
}

// ---------------------------------------------------------------- CSV

const CSV_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  title: ['track name', 'track title', 'track', 'title', 'song', 'song name', 'name'],
  artist: ['artist name', 'artist name(s)', 'artist(s)', 'artist', 'artists', 'album artist', 'performer'],
  album: ['album name', 'album', 'release'],
  duration: ['duration (ms)', 'duration ms', 'duration', 'length', 'time', 'track duration (ms)'],
  isrc: ['isrc', 'isrc code'],
  providerId: ['track uri', 'spotify uri', 'track id', 'uri', 'id', 'url']
}

/** Splits one CSV line, honouring quotes and doubled quotes inside them. */
export function splitCsvLine(line: string, separator: string): string[] {
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (let at = 0; at < line.length; at += 1) {
    const ch = line[at]
    if (quoted) {
      if (ch === '"') {
        if (line[at + 1] === '"') {
          cell += '"'
          at += 1
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === separator) {
      out.push(cell)
      cell = ''
      continue
    }
    cell += ch
  }
  out.push(cell)
  return out.map((one) => one.trim())
}

export function readCsv(text: string): ReadFile {
  const lines = text.split(/\r?\n/).filter((one) => one.trim() !== '')
  if (lines.length === 0) {
    return { kind: 'csv', tracks: [], skipped: [], name: null, says: 'That file is empty.' }
  }
  const separator = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? '\t' : ','
  const header = splitCsvLine(lines[0], separator).map((one) => one.toLowerCase().replace(/^"|"$/g, ''))

  const where: Record<string, number> = {}
  const columns: Record<string, string> = {}
  for (const [field, names] of Object.entries(CSV_COLUMNS)) {
    const at = header.findIndex((one) => names.includes(one))
    if (at >= 0) {
      where[field] = at
      columns[field] = splitCsvLine(lines[0], separator)[at]
    }
  }

  /*
   * No recognised title column means this is not a playlist table.
   *
   * Reading the first column as the title anyway is how a file of email addresses becomes 400 unmatched tracks.
   */
  if (where.title === undefined) {
    return {
      kind: 'csv',
      tracks: [],
      skipped: [],
      name: null,
      columns,
      says: 'No column in that file looks like a track name. Expected a column called Track Name, Title or Song.'
    }
  }

  const tracks: Wanted[] = []
  const skipped: Skipped[] = []
  lines.slice(1).forEach((raw, index) => {
    const cells = splitCsvLine(raw, separator)
    const at = (field: string): string => (where[field] === undefined ? '' : (cells[where[field]] ?? '').replace(/^"|"$/g, '').trim())
    const title = at('title')
    if (!title) {
      skipped.push({ line: index + 2, text: raw.slice(0, 120), why: 'No track name in that row.' })
      return
    }
    const length = at('duration')
    tracks.push({
      title,
      artist: at('artist') || null,
      album: at('album') || null,
      duration: length ? seconds(length) : null,
      isrc: at('isrc') || null,
      providerId: at('providerId') || null
    })
  })

  return { kind: 'csv', tracks, skipped, name: null, columns, says: sentence(tracks.length, skipped.length) }
}

// ---------------------------------------------------------------- JSON

/** The field names exports actually use, tried in order. */
const pick = (row: Record<string, unknown>, names: readonly string[]): string | null => {
  for (const name of names) {
    const value = row[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    // Spotify nests the artist as an array of objects, and Apple as an object.
    if (Array.isArray(value)) {
      const named = value
        .map((one) => (typeof one === 'string' ? one : one && typeof one === 'object' ? (one as Record<string, unknown>).name : null))
        .filter((one): one is string => typeof one === 'string' && one.trim() !== '')
      if (named.length) return named.join(', ')
    }
    if (value && typeof value === 'object') {
      const nested = (value as Record<string, unknown>).name
      if (typeof nested === 'string' && nested.trim() !== '') return nested.trim()
    }
  }
  return null
}

export function readJson(text: string): ReadFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'json', tracks: [], skipped: [], name: null, says: 'That file is not readable as JSON.' }
  }

  // The rows live in a different place in every export, so look where each one puts them.
  let rows: unknown[] = []
  let name: string | null = null
  const asRecord = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  if (Array.isArray(parsed)) rows = parsed
  else if (asRecord) {
    name = typeof asRecord.name === 'string' ? asRecord.name : typeof asRecord.playlistName === 'string' ? asRecord.playlistName : null
    for (const key of ['tracks', 'items', 'songs', 'entries']) {
      const value = asRecord[key]
      if (Array.isArray(value)) {
        rows = value
        break
      }
      // Spotify's own export wraps them again: { tracks: { items: [...] } }
      if (value && typeof value === 'object') {
        const inner = (value as Record<string, unknown>).items
        if (Array.isArray(inner)) {
          rows = inner
          break
        }
      }
    }
  }

  if (rows.length === 0) {
    return { kind: 'json', tracks: [], skipped: [], name, says: 'Nothing in that file looks like a list of tracks.' }
  }

  const tracks: Wanted[] = []
  const skipped: Skipped[] = []
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') {
      skipped.push({ line: index + 1, text: String(row).slice(0, 80), why: 'That entry is not a track.' })
      return
    }
    // Both shapes: the track at the top level, or wrapped as { track: {...} }.
    const outer = row as Record<string, unknown>
    const inner = outer.track && typeof outer.track === 'object' ? (outer.track as Record<string, unknown>) : outer
    const title = pick(inner, ['name', 'title', 'trackName', 'track_name', 'song'])
    if (!title) {
      skipped.push({ line: index + 1, text: JSON.stringify(outer).slice(0, 80), why: 'That entry has no track name.' })
      return
    }
    const length = pick(inner, ['duration_ms', 'durationMs', 'duration', 'length'])
    const external = inner.external_ids && typeof inner.external_ids === 'object' ? (inner.external_ids as Record<string, unknown>) : null
    tracks.push({
      title,
      artist: pick(inner, ['artists', 'artist', 'artistName', 'artist_name', 'albumArtist']),
      album: pick(inner, ['album', 'albumName', 'album_name', 'release']),
      duration: length ? seconds(length) : null,
      isrc: pick(inner, ['isrc']) ?? (external && typeof external.isrc === 'string' ? external.isrc : null),
      providerId: pick(inner, ['uri', 'id', 'trackId', 'track_id'])
    })
  })

  return { kind: 'json', tracks, skipped, name, says: sentence(tracks.length, skipped.length) }
}

// ---------------------------------------------------------------- plain text

/** A pasted list, one track a line, usually `Artist - Title`. The last resort, and it says so. */
export function readText(text: string): ReadFile {
  const tracks: Wanted[] = []
  const skipped: Skipped[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim().replace(/^\d+[.)]\s*/, '')
    if (line === '' || line.startsWith('#')) return
    const parts = line.split(/\s+[-–]\s+/)
    if (parts.length === 2) tracks.push({ title: parts[1].trim(), artist: parts[0].trim() || null })
    else if (line.length > 1) tracks.push({ title: line, artist: null })
    else skipped.push({ line: index + 1, text: line, why: 'Too short to be a track name.' })
  })
  return { kind: 'text', tracks, skipped, name: null, says: sentence(tracks.length, skipped.length) }
}

// ---------------------------------------------------------------- the door

export function readPlaylistFile(filename: string, text: string): ReadFile {
  const kind = kindOf(filename, text)
  if (kind === 'm3u') return readM3u(text)
  if (kind === 'csv') return readCsv(text)
  if (kind === 'json') return readJson(text)
  return readText(text)
}

function sentence(found: number, skipped: number): string {
  if (found === 0) return skipped > 0 ? `Nothing readable in that file — ${skipped} lines could not be read.` : 'No tracks in that file.'
  const tracks = `${found} ${found === 1 ? 'track' : 'tracks'}`
  return skipped > 0 ? `${tracks}, and ${skipped} ${skipped === 1 ? 'line' : 'lines'} that could not be read.` : `${tracks}.`
}
