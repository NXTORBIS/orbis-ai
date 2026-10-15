/**
 * Finding a download by what is inside it.
 *
 * Only the browser's own download list is searched (never the rest of the disk), only files that exist, and only files a
 * plain-text reader can honestly read. A PDF, a spreadsheet or an archive is not searched, and the result says how many
 * were skipped for that reason, so "no match" is never mistaken for "searched everything".
 */

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h',
  'cpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'ps1', 'sql', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'srt', 'vtt',
  'tex', 'rtf', 'svg', 'lrc'
])

export const MAX_SEARCH_BYTES = 5 * 1024 * 1024
export const MAX_HITS = 50

export interface DownloadRow {
  id?: string
  filename?: string
  path?: string
  url?: string
  state?: string
  exists?: boolean
  totalBytes?: number
  receivedBytes?: number
}

export interface ContentHit {
  id: string
  name: string
  path: string
  line: number
  snippet: string
  /** `name` when only the file name matched. */
  kind: 'content' | 'name'
}

export interface ContentSearchResult {
  query: string
  hits: ContentHit[]
  searched: number
  /** Files that could not be read as text, or were too large, so they were not looked inside. */
  skipped: number
  missing: number
  truncated: boolean
}

export const extensionOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export const isSearchable = (name: string, size: number | undefined): boolean =>
  TEXT_EXTS.has(extensionOf(name)) && (size === undefined || size <= MAX_SEARCH_BYTES)

function snippetAround(line: string, at: number, length: number): string {
  const from = Math.max(0, at - 50)
  const to = Math.min(line.length, at + length + 80)
  return `${from > 0 ? '…' : ''}${line.slice(from, to).trim()}${to < line.length ? '…' : ''}`
}

/**
 * `read` returns the file's text, or null when it cannot be read. It is injected so the search itself touches no disk.
 */
export async function searchDownloads(
  rows: DownloadRow[],
  rawQuery: string,
  read: (path: string) => Promise<string | null>
): Promise<ContentSearchResult> {
  const query = rawQuery.trim().slice(0, 200)
  const out: ContentSearchResult = { query, hits: [], searched: 0, skipped: 0, missing: 0, truncated: false }
  if (query.length < 2) return out
  const needle = query.toLowerCase()

  for (const row of rows) {
    if (out.hits.length >= MAX_HITS) {
      out.truncated = true
      break
    }
    const path = typeof row.path === 'string' ? row.path : ''
    const name = typeof row.filename === 'string' && row.filename ? row.filename : path.split(/[\\/]/).pop() ?? ''
    if (!path || row.state !== 'completed') continue
    if (row.exists === false) {
      out.missing++
      continue
    }
    const id = String(row.id ?? path)
    const nameMatch = name.toLowerCase().includes(needle)
    if (!isSearchable(name, row.totalBytes)) {
      out.skipped++
      if (nameMatch) out.hits.push({ id, name, path, line: 0, snippet: name, kind: 'name' })
      continue
    }
    const text = await read(path)
    if (text === null) {
      out.skipped++
      if (nameMatch) out.hits.push({ id, name, path, line: 0, snippet: name, kind: 'name' })
      continue
    }
    out.searched++
    const lines = text.split(/\r?\n/)
    let found = false
    for (let i = 0; i < lines.length; i++) {
      const at = lines[i].toLowerCase().indexOf(needle)
      if (at < 0) continue
      out.hits.push({ id, name, path, line: i + 1, snippet: snippetAround(lines[i], at, needle.length), kind: 'content' })
      found = true
      break // one hit per file: the search answers "which file", not "every occurrence"
    }
    if (!found && nameMatch) out.hits.push({ id, name, path, line: 0, snippet: name, kind: 'name' })
  }
  return out
}
