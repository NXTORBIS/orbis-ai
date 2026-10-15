import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newProject, type Project } from '../../shared/neurova/project.ts'
import { backupAll, restoreBackup, verifyBackup, type BackupStorage } from './backup.ts'

async function world() {
  const root = await mkdtemp(join(tmpdir(), 'nv-'))
  const projects = new Map<string, Project>()
  const storage = (name: string): BackupStorage => ({
    listProjects: async () => [...projects.values()],
    writeProject: async (p) => { projects.set(p.id, p) },
    audioDir: (id) => join(root, name, id)
  })
  return { root, projects, storage }
}
async function seed(w: Awaited<ReturnType<typeof world>>) {
  const p = { ...newProject('p1', 'Song', 'brief', '', 1), artifacts: [{ id: 'a1', file: 'a.wav', sha256: 'x', bytes: 4, durationSec: 0, sampleRate: 1, channels: 1, bitDepth: 16, source: 'imported' as const, createdAt: 1 }] }
  w.projects.set('p1', p)
  await mkdir(join(w.root, 'src', 'p1'), { recursive: true })
  await writeFile(join(w.root, 'src', 'p1', 'a.wav'), 'RIFF')
}

test('backup, verify, restore as new id', async () => {
  const w = await world(); await seed(w)
  const src = w.storage('src')
  const b = await backupAll(src, w.root, Date.UTC(2026, 0, 2))
  assert.match(b.dir, /neurova-backup-2026-01-02$/)
  assert.equal((await verifyBackup(b.dir)).ok, true)
  const r = await restoreBackup(b.dir, src, () => 'p1-new')
  assert.deepEqual(r.restored, [{ from: 'p1', to: 'p1-new' }])
  assert.equal(await readFile(join(w.root, 'src', 'p1-new', 'a.wav'), 'utf8'), 'RIFF')
  assert.equal(w.projects.get('p1')!.id, 'p1')
  await rm(w.root, { recursive: true })
})
test('corrupt, missing and extra files are reported and block restore', async () => {
  const w = await world(); await seed(w)
  const b = await backupAll(w.storage('src'), w.root)
  await writeFile(join(b.dir, 'audio', 'p1', 'a.wav'), 'XXXX')
  await writeFile(join(b.dir, 'stray.txt'), 'x')
  const v = await verifyBackup(b.dir)
  assert.deepEqual([v.corrupt, v.extra, v.ok], [['audio/p1/a.wav'], ['stray.txt'], false])
  const r = await restoreBackup(b.dir, w.storage('dst'))
  assert.equal(r.ok, false); assert.equal(r.restored.length, 0)
  await rm(w.root, { recursive: true })
})
test('hostile manifest paths are refused', async () => {
  const w = await world()
  for (const bad of ['../evil.txt', '/abs.txt', 'C:\\x.txt', 'audio/../../x']) {
    const dir = join(w.root, 'bk'); await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ schema: 1, createdAt: 1, projectIds: ['p1'], files: [{ path: bad, sha256: 'x', bytes: 1, projectId: 'p1' }] }))
    const v = await verifyBackup(dir)
    assert.deepEqual(v.unsafe, [bad])
    const r = await restoreBackup(dir, w.storage('dst'))
    assert.equal(r.ok, false); assert.equal(r.restored.length, 0)
  }
  await rm(w.root, { recursive: true })
})
