import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PagesStore } from './store.ts'

/**
 * What this store does with the file it did not write.
 *
 * Everything else about Pages is checked through the service, with a store on disk underneath it. This file is about
 * the four states the file itself can be in, because three of them used to be treated as one: no file, a file that
 * reads and makes sense, a file that reads and does not, and a file that cannot be read at all.
 *
 * The middle case is the one that lost work. A write interrupted half-way leaves bytes that are perfectly readable
 * and not JSON, and treating that as "there is nothing here" meant starting from defaults and then renaming those
 * defaults over the real file -- every grant, every favourite, every saved project, every application -- with no copy
 * of the original anywhere. So the two things worth asserting are that the person's bytes are still somewhere on the
 * disk afterwards, and that nothing was written where Orbis could not first move the old file out of the way.
 */

const PROFILE = 'default'
const PAGE = 'page_a1b2c3d4e5f6a7b8c9d0e1f2'
const OTHER_PAGE = 'page_b1b2c3d4e5f6a7b8c9d0e1f2'

/** Where the default profile's decisions live. The test has to look at the real path, not at the store's idea of it. */
const fileIn = (dir: string): string => join(dir, 'pages.json')

/** Copies of a damaged file, by the name `quarantine()` gives them. */
const movedAside = async (dir: string): Promise<string[]> =>
  (await readdir(dir)).filter((name) => name.startsWith('pages.json.unreadable-'))

async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-pages-store-'))
  try {
    await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a file that is there and makes sense is read, and left where it is', async () => {
  await withDir(async (dir) => {
    await writeFile(
      fileIn(dir),
      JSON.stringify({ schema: 1, grants: [], favourites: [PAGE], usage: {}, projects: [], approved: {}, applications: [] }),
      'utf8'
    )
    const store = new PagesStore(dir)
    assert.deepEqual(await store.favourites(PROFILE), [PAGE])
    assert.deepEqual(await movedAside(dir), [])
  })
})

test('a half-written file is moved aside, and its words are still on the disk afterwards', async () => {
  await withDir(async (dir) => {
    // Exactly what a write interrupted half-way leaves behind: readable, and not JSON.
    const half = '{"schema":1,"grants":[{"pageId":"page_a1b2c3d4e5f6a7b8c9d0e1f2","capabilityId":"net'
    await writeFile(fileIn(dir), half, 'utf8')

    const store = new PagesStore(dir)
    assert.deepEqual(await store.grants(PROFILE), [])
    assert.deepEqual(await store.favourites(PROFILE), [])

    // The point of the whole fix: the original bytes are still there, under a name that says what happened to them.
    const moved = await movedAside(dir)
    assert.equal(moved.length, 1)
    assert.equal(await readFile(join(dir, moved[0]), 'utf8'), half)

    // And because it was moved rather than overwritten, this session may now save normally.
    assert.equal(await store.setFavourite(PROFILE, PAGE, true), true)
    await store.flush()
    const written = JSON.parse(await readFile(fileIn(dir), 'utf8')) as { favourites: string[] }
    assert.deepEqual(written.favourites, [PAGE])
    assert.equal((await movedAside(dir)).length, 1)
  })
})

test('a file that is there and cannot be read is never written over, however many saves follow', async () => {
  await withDir(async (dir) => {
    // A directory where the file should be is a file that exists and cannot be read -- EISDIR, not ENOENT -- which is
    // the same answer Orbis gets on Windows for the moment something else is holding the real file open.
    await mkdir(fileIn(dir))

    const store = new PagesStore(dir)
    assert.deepEqual(await store.favourites(PROFILE), [])

    await store.setFavourite(PROFILE, PAGE, true)
    await store.flush()
    // Nothing moved, nothing written beside it, nothing left half-written: only the thing that was in the way.
    assert.deepEqual(await readdir(dir), ['pages.json'])

    // And again. The refusal used to clear itself on the way out, so the second save went through and did the damage
    // the first one had just avoided.
    await store.setFavourite(PROFILE, OTHER_PAGE, true)
    await store.flush()
    assert.deepEqual(await readdir(dir), ['pages.json'])
  })
})

test('the quit-time save refuses the file the timed save refuses', async () => {
  await withDir(async (dir) => {
    await mkdir(fileIn(dir))
    const store = new PagesStore(dir)
    await store.setFavourite(PROFILE, PAGE, true)
    store.flushSync()
    assert.deepEqual(await readdir(dir), ['pages.json'])
  })
})

test('no file at all still means defaults, and still allows a write', async () => {
  await withDir(async (dir) => {
    const store = new PagesStore(dir)
    assert.deepEqual(await store.grants(PROFILE), [])
    assert.deepEqual(await store.favourites(PROFILE), [])
    assert.deepEqual(await store.projects(PROFILE), [])

    await store.setFavourite(PROFILE, PAGE, true)
    await store.flush()
    const written = JSON.parse(await readFile(fileIn(dir), 'utf8')) as { favourites: string[]; schema: number }
    assert.deepEqual(written.favourites, [PAGE])
    assert.equal(written.schema, 1)
    // Nothing was moved aside, because there was nothing there to move.
    assert.deepEqual(await movedAside(dir), [])
  })
})
