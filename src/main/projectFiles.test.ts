import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectFiles } from './projectFiles.ts'

/**
 * A project's file list used to be read inside `try { ... } catch { return { files: [] } }`, which makes a damaged
 * list indistinguishable from a project nobody has added anything to -- and the write that followed had no guard at
 * all. So a files.json cut off halfway through a save read as "no files here", and the next file added renamed a
 * one-file list over the six the project really held, with no copy of the old list left anywhere.
 */

const here = (): string => mkdtempSync(join(tmpdir(), 'orbis-project-files-'))

const dirOf = (userData: string, projectId: string): string => join(userData, 'project-files', projectId)

const files = (userData: string): ProjectFiles => new ProjectFiles({ userData, profileId: () => 'default' })

test('a project with no list yet is empty, and files can be added to it', async () => {
  const dir = here()
  try {
    const held = files(dir)
    assert.deepEqual(await held.list('alpha'), [])
    const added = await held.add('alpha', 'spec.md', 'the words of the spec')
    assert.equal(added.ok, true)
    assert.deepEqual((await held.list('alpha')).map((one) => one.name), ['spec.md'])
    assert.equal(readdirSync(dirOf(dir, 'alpha')).includes('files.json'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file list that will not parse is moved aside with its words, never read as an empty project', async () => {
  const dir = here()
  try {
    const held = files(dir)
    await held.add('alpha', 'spec.md', 'the words of the spec')
    await held.add('alpha', 'data.csv', 'a,b,c')
    const path = join(dirOf(dir, 'alpha'), 'files.json')
    const whole = readFileSync(path, 'utf8')
    // A save that was cut off: every byte up to the cut is readable, and none of it parses.
    writeFileSync(path, whole.slice(0, -3))

    const fresh = files(dir)
    assert.deepEqual(await fresh.list('alpha'), [], 'nothing can be listed out of a list that makes no sense')
    assert.equal((await fresh.add('alpha', 'notes.md', 'something new')).ok, true, 'and a fresh list may be started')

    const aside = readdirSync(dirOf(dir, 'alpha')).filter((name) => name.includes('.unreadable-'))
    assert.equal(aside.length, 1, 'the damaged list was moved aside, never deleted')
    const kept = readFileSync(join(dirOf(dir, 'alpha'), aside[0]), 'utf8')
    assert.equal(kept, whole.slice(0, -3))
    assert.ok(kept.includes('the words of the spec'), 'the words of both files are still on the disk')
    assert.ok(kept.includes('a,b,c'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('nothing is written over a list that is there and could not be read, and the person is told why', async () => {
  const dir = here()
  try {
    const held = files(dir)
    await held.add('alpha', 'spec.md', 'the words of the spec')
    const path = join(dirOf(dir, 'alpha'), 'files.json')
    const whole = readFileSync(path, 'utf8')
    rmSync(path)
    // A folder where the list belongs: reading it fails with EISDIR, not ENOENT. It stands in for the real cases --
    // something holding the file open, a backup copying it -- which cannot be made to happen reliably in a test.
    mkdirSync(path)

    const fresh = files(dir)
    assert.deepEqual(await fresh.list('alpha'), [])
    const refused = await fresh.add('alpha', 'notes.md', 'something new')
    assert.equal(refused.ok, false)
    assert.ok(refused.ok === false && /could not be read/.test(refused.message), refused.ok === false ? refused.message : '')
    assert.equal(await fresh.remove('alpha', 'whatever'), false, 'and nothing is reported as removed from it either')

    assert.deepEqual(readdirSync(dirOf(dir, 'alpha')), ['files.json'], 'it was not moved aside: it may be perfectly good')
    assert.equal(readdirSync(path).length, 0, 'and nothing was written in its place')
    assert.ok(whole.includes('the words of the spec'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a list that parses is used as it is, and removing a file rewrites it', async () => {
  const dir = here()
  try {
    const held = files(dir)
    const one = await held.add('alpha', 'spec.md', 'the words of the spec')
    await held.add('alpha', 'data.csv', 'a,b,c')
    assert.equal(one.ok && (await held.remove('alpha', one.file.id)), true)
    assert.deepEqual((await files(dir).list('alpha')).map((f) => f.name), ['data.csv'])
    assert.deepEqual(await files(dir).forSearch('alpha'), [{ name: 'data.csv', text: 'a,b,c' }])
    assert.equal(readdirSync(dirOf(dir, 'alpha')).some((name) => name.includes('.unreadable-')), false, 'nothing was moved: nothing was damaged')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
