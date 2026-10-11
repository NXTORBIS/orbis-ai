import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoursesStore } from './store.ts'
import { cleanCourse } from '../../shared/courses/validate.ts'

/**
 * A course file is the only copy of what it holds.
 *
 * A built-in course can be installed again from what Orbis ships, but a course somebody imported, or one Orion wrote
 * for them, exists nowhere else. So the thing these tests hold down is the difference between "there is no course
 * here" and "there is something here and Orbis does not know what": the first may be written over, the second must
 * either be kept under another name first or left completely alone.
 */

const here = async (): Promise<string> => mkdtemp(join(tmpdir(), 'orbis-courses-'))
const fileFor = (userData: string, id: string): string => join(userData, 'courses', `${id}.json`)
/** A course the store will accept. Built through the real validator so nothing here is a shape only a test believes. */
const course = (id = 'demo'): NonNullable<ReturnType<typeof cleanCourse>> =>
  cleanCourse({ id, title: 'Demo', origin: 'imported', modules: [{ id: 'm1', title: 'One', lessons: [] }] }, 1_700_000_000_000)!

test('a course comes back as it was installed', async () => {
  const dir = await here()
  const store = new CoursesStore(dir)
  await store.install(course())
  await store.flush()
  assert.equal((await new CoursesStore(dir).course('demo'))?.title, 'Demo')
})

test('a file Orbis cannot make sense of is moved aside, not written over', async () => {
  const dir = await here()
  await fs.mkdir(join(dir, 'courses'), { recursive: true })
  // Half a file: exactly what a crash mid-write leaves, readable and unparsable.
  await fs.writeFile(fileFor(dir, 'demo'), '{"id":"demo","title":"Demo","modu')

  const store = new CoursesStore(dir)
  assert.equal(await store.course('demo'), null, 'nothing is handed back that was not understood')
  assert.ok(store.problem('demo')?.includes('Nothing was deleted'), store.problem('demo') ?? 'nothing said')

  const kept = (await fs.readdir(join(dir, 'courses'))).filter((name) => name.includes('.unreadable-'))
  assert.equal(kept.length, 1, 'the original words are still on the disk under another name')
  assert.ok((await fs.readFile(join(dir, 'courses', kept[0]), 'utf8')).includes('"modu'), 'and they are the same words')

  // Moved aside means safe to write: the course can be installed again over a path that holds nothing of value.
  await store.install(course())
  assert.equal((await store.course('demo'))?.title, 'Demo')
  await store.flush()
})

test('valid JSON that is not a course is damage, not an absence', async () => {
  const dir = await here()
  await fs.mkdir(join(dir, 'courses'), { recursive: true })
  await fs.writeFile(fileFor(dir, 'demo'), '{"hello":"world"}')

  const store = new CoursesStore(dir)
  assert.equal(await store.course('demo'), null)
  assert.ok(store.problem('demo'), 'it is reported, where before it was silently the same as no file at all')
  assert.equal((await fs.readdir(join(dir, 'courses'))).filter((name) => name.includes('.unreadable-')).length, 1)
})

test('a file that could not be read is left alone, and installing over it is refused', async () => {
  const dir = await here()
  await fs.mkdir(join(dir, 'courses'), { recursive: true })
  // A directory where a file is expected cannot be read, and fails with something other than "there is no file".
  await fs.mkdir(fileFor(dir, 'demo'))

  const store = new CoursesStore(dir)
  assert.equal(await store.course('demo'), null)
  assert.ok(store.problem('demo')?.includes('nothing has been written over it'), store.problem('demo') ?? 'nothing said')
  assert.equal((await fs.readdir(join(dir, 'courses'))).filter((name) => name.includes('.unreadable-')).length, 0, 'and nothing was moved either')

  await assert.rejects(store.install(course()), /could not read/)
  assert.equal((await fs.stat(fileFor(dir, 'demo'))).isDirectory(), true, 'what was there is still there')

  // The lock clears: the same store, asked again, now installs -- so refusing cost nothing.
  await fs.rmdir(fileFor(dir, 'demo'))
  await store.install(course())
  assert.equal(store.problem('demo'), null)
  assert.equal((await store.course('demo'))?.title, 'Demo')
  await store.flush()
})

test('no file still means no course, and still allows a write', async () => {
  const dir = await here()
  const store = new CoursesStore(dir)
  assert.equal(await store.course('demo'), null)
  assert.equal(store.problem('demo'), null, 'a missing course is not a problem to report')
  await store.install(course())
  assert.equal(JSON.parse(await fs.readFile(fileFor(dir, 'demo'), 'utf8')).title, 'Demo')
  assert.equal((await fs.readdir(join(dir, 'courses'))).filter((name) => name.includes('.unreadable-')).length, 0)
  await store.flush()
})

test('uninstalling clears what was noted about the file, so the id is installable again', async () => {
  const dir = await here()
  await fs.mkdir(join(dir, 'courses'), { recursive: true })
  await fs.mkdir(fileFor(dir, 'demo'))

  const store = new CoursesStore(dir)
  await store.course('demo')
  assert.ok(store.problem('demo'))

  await fs.rmdir(fileFor(dir, 'demo'))
  await store.uninstall('demo')
  assert.equal(store.problem('demo'), null)
  await store.install(course())
  assert.equal((await store.course('demo'))?.title, 'Demo')
  await store.flush()
})
