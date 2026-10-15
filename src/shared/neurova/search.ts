// Pure project search. Nothing is indexed or stored; every call reads the projects it is given.
import type { Project } from './project.ts'

export type SearchField = 'title' | 'brief' | 'lyrics' | 'versionName' | 'versionNote'
export interface SearchHit { projectId: string; kind: 'project' | 'version'; versionId?: string; snippet: string; field: SearchField }

export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function snippet(text: string, at: number, len: number): string {
  const from = Math.max(0, at - 30)
  const out = text.slice(from, at + len + 50).replace(/\s+/g, ' ').trim()
  return (from > 0 ? '...' : '') + out
}

export function searchProjects(projects: readonly Project[], query: string, opts: { includeLyrics?: boolean; limit?: number } = {}): SearchHit[] {
  const q = fold(query.trim())
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200))
  if (!q) return []
  const out: SearchHit[] = []
  const seen = new Set<string>()
  const take = (hit: Omit<SearchHit, 'snippet'>, key: string, text: string): boolean => {
    const at = fold(text).indexOf(q)
    if (at < 0) return false
    if (seen.has(key)) return true
    seen.add(key)
    out.push({ ...hit, snippet: snippet(text, at, q.length) })
    return true
  }
  for (const p of projects) {
    take({ projectId: p.id, kind: 'project', field: 'title' }, `p:${p.id}:title`, p.title)
    if (out.length >= limit) break
    take({ projectId: p.id, kind: 'project', field: 'brief' }, `p:${p.id}:brief`, p.brief)
    if (out.length >= limit) break
    if (opts.includeLyrics) take({ projectId: p.id, kind: 'project', field: 'lyrics' }, `p:${p.id}:lyrics`, p.lyrics)
    if (out.length >= limit) break
    for (const v of p.versions) {
      // One hit per artifact: a second version of the same audio does not repeat the result.
      const key = `a:${p.id}:${v.artifactId}`
      if (!take({ projectId: p.id, kind: 'version', versionId: v.id, field: 'versionName' }, key, v.name)) {
        take({ projectId: p.id, kind: 'version', versionId: v.id, field: 'versionNote' }, key, v.note)
      }
      if (out.length >= limit) break
    }
    if (out.length >= limit) break
  }
  return out.slice(0, limit)
}
