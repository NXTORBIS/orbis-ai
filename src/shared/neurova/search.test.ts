import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newProject, type Project } from './project.ts'
import { searchProjects } from './search.ts'

const mk = (id: string, title: string, brief = '', lyrics = ''): Project => newProject(id, title, brief, lyrics, 1)
const ver = (p: Project, id: string, name: string, note: string, art: string): Project => ({ ...p, versions: [...p.versions, { id, name, artifactId: art, parentId: null, kind: 'first', note, createdAt: 1 }] })

test('title, brief, diacritics and case', () => {
  const ps = [mk('a', 'Café Nocturne', 'slow jazz'), mk('b', 'Other', 'CAFE vibes')]
  const h = searchProjects(ps, 'cafe')
  assert.deepEqual(h.map((x) => [x.projectId, x.field]), [['a', 'title'], ['b', 'brief']])
})
test('lyrics only when asked', () => {
  const ps = [mk('a', 'X', '', 'moonlight over water')]
  assert.equal(searchProjects(ps, 'moonlight').length, 0)
  assert.equal(searchProjects(ps, 'moonlight', { includeLyrics: true })[0].field, 'lyrics')
})
test('versions deduped per artifact and bounded', () => {
  let p = mk('a', 'X')
  p = ver(p, 'v1', 'bright mix', 'bright', 'art1'); p = ver(p, 'v2', 'bright again', '', 'art1')
  const h = searchProjects([p], 'bright')
  assert.equal(h.length, 1); assert.equal(h[0].kind, 'version')
  const many = Array.from({ length: 30 }, (_, i) => mk(`p${i}`, 'song'))
  assert.equal(searchProjects(many, 'song', { limit: 5 }).length, 5)
  assert.equal(searchProjects(many, '  ').length, 0)
})
