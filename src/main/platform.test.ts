import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nullPlatform } from './platform.ts'
import type { ClipboardImage, Platform } from './platform.ts'
import { ClipboardHistory } from './personal/clipboard.ts'
import { WorkflowStore } from './workflows/store.ts'

/**
 * These services must be able to run with no browser underneath them at all — that is the whole point of the platform
 * interfaces, and the reason they will move to Chromium unchanged. Everything here runs in plain Node: if one of them
 * ever reaches for Electron again, these tests stop working.
 */

/** A clipboard that lives in a variable, standing in for the machine's. */
function fakePlatform(): Platform & { held: { text: string; image: ClipboardImage | null } } {
  const held: { text: string; image: ClipboardImage | null } = { text: '', image: null }
  const key = Buffer.from('orbis-test-key')
  return {
    held,
    clipboard: {
      readText: async () => held.text,
      writeText: async (text) => {
        held.text = text
        held.image = null
      },
      readImage: async () => held.image,
      writeImage: async (image) => {
        held.image = image
        held.text = ''
      }
    },
    secrets: {
      available: () => true,
      // Not real encryption; enough to prove the store keeps nothing in the clear and reads back what it wrote.
      encrypt: (value) => Buffer.from(Buffer.from(value).map((b, i) => b ^ key[i % key.length])),
      decrypt: (value) => Buffer.from(Buffer.from(value).map((b, i) => b ^ key[i % key.length])).toString()
    }
  }
}

async function withTemp<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-platform-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('clipboard history works with no browser underneath it', async () => {
  await withTemp(async (dir) => {
    const platform = fakePlatform()
    const history = new ClipboardHistory({
      userData: dir,
      clipboard: platform.clipboard,
      isActive: () => true,
      context: () => ({})
    })

    platform.held.text = 'something copied'
    await history.check()
    const clips = await history.all()
    assert.equal(clips.length, 1, 'what was copied is remembered')
    assert.equal(clips[0].content, 'something copied')

    // Putting an earlier entry back reaches the machine's clipboard through the same small surface.
    platform.held.text = 'something else'
    await history.check()
    await history.copyToClipboard(clips[0].id)
    assert.equal(platform.held.text, 'something copied')
  })
})

test('a picture on the clipboard is remembered, and measured only if the machine can measure it', async () => {
  await withTemp(async (dir) => {
    const platform = fakePlatform()
    const history = new ClipboardHistory({
      userData: dir,
      clipboard: platform.clipboard,
      // No way to measure a picture here; the entry is still kept rather than dropped.
      isActive: () => true,
      context: () => ({})
    })

    platform.held.image = { type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }
    await history.check()
    const clips = await history.all()
    assert.equal(clips.length, 1)
    assert.equal(clips[0].kind, 'image')
    assert.match(clips[0].content, /^data:image\/png;base64,/)
  })
})

test('workflow secrets are kept only where the machine can encrypt them', async () => {
  await withTemp(async (dir) => {
    const platform = fakePlatform()
    const store = new WorkflowStore(dir, platform.secrets)
    assert.equal(store.canRememberSecrets(), true)

    await store.rememberSecret('w1', 'token', 'hunter2')
    assert.equal(await store.secret('w1', 'token'), 'hunter2')
    assert.deepEqual(await store.rememberedSecretNames('w1'), ['token'])

    // Another workflow's secret of the same name is a different secret.
    assert.equal(await store.secret('w2', 'token'), null)
  })
})

test('a machine that cannot encrypt is told about, and keeps nothing rather than keeping it badly', async () => {
  await withTemp(async (dir) => {
    const store = new WorkflowStore(dir, nullPlatform().secrets)
    assert.equal(store.canRememberSecrets(), false)
    await assert.rejects(() => store.rememberSecret('w1', 'token', 'hunter2'), /can't encrypt stored secrets/)
    assert.equal(await store.secret('w1', 'token'), null)
  })
})

test('the empty platform does nothing, safely, so a service can always be constructed', async () => {
  const platform = nullPlatform()
  assert.equal(await platform.clipboard.readText(), '')
  assert.equal(await platform.clipboard.readImage(), null)
  await platform.clipboard.writeText('ignored')
  assert.equal(platform.secrets.available(), false)
})
