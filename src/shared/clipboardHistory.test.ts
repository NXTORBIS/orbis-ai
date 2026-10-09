import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CLIP_IMAGE_BYTES, MAX_CLIP_IMAGE_CHARS, MAX_CLIP_TEXT, clipKind, clipPreview, normalizeClip, searchClips, shouldCapture, DEFAULT_CLIPBOARD_SETTINGS } from './clipboardHistory.ts'

/**
 * What a clip is allowed to be.
 *
 * The picture rules are here because of a bug that left every large copied image showing as a broken-image box: the
 * byte limit was applied to the *character* length of a base64 data url, which is four characters for every three
 * bytes, so anything over about three megabytes lost a third of its tail on every read. A data url cut mid-base64
 * is not a smaller picture; it is one nothing can decode.
 */

const dataUrl = (chars: number): string => `data:image/png;base64,${'A'.repeat(chars)}`

describe('a picture clip', () => {
  test('the character limit allows every picture the byte limit allows', () => {
    // Base64 is 4 characters per 3 bytes. A picture at exactly the byte limit must still fit.
    const asBase64 = Math.ceil(MAX_CLIP_IMAGE_BYTES / 3) * 4
    assert.ok(MAX_CLIP_IMAGE_CHARS >= asBase64, `${MAX_CLIP_IMAGE_CHARS} is not enough for ${asBase64} characters of base64`)
    // And the old mistake -- using the byte number as a character count -- would not have been.
    assert.ok(MAX_CLIP_IMAGE_BYTES < asBase64, 'the byte limit is smaller than the same picture as base64, which is the whole bug')
  })

  test('is never trimmed, because every character of base64 is load-bearing', () => {
    const whole = dataUrl(1000)
    const kept = normalizeClip({ id: 'a', kind: 'image', content: whole, copiedAt: 1, times: 1, bytes: 1000 })
    assert.equal(kept?.content, whole)
  })

  test('a picture at the limit survives a round trip whole', () => {
    const big = dataUrl(Math.ceil(MAX_CLIP_IMAGE_BYTES / 3) * 4)
    const kept = normalizeClip({ id: 'a', kind: 'image', content: big, copiedAt: 1, times: 1, bytes: MAX_CLIP_IMAGE_BYTES })
    assert.ok(kept, 'a picture within the byte limit is kept')
    assert.equal(kept.content.length, big.length, 'and not one character shorter')
  })

  test('one that cannot be a picture within the limit is refused rather than trimmed', () => {
    const absurd = dataUrl(MAX_CLIP_IMAGE_CHARS + 1)
    assert.equal(normalizeClip({ id: 'a', kind: 'image', content: absurd, copiedAt: 1, times: 1, bytes: 1 }), null)
  })

  test('anything that is not a data url is not a picture', () => {
    assert.equal(normalizeClip({ id: 'a', kind: 'image', content: 'https://example.com/a.png', copiedAt: 1, times: 1, bytes: 1 }), null)
    assert.equal(normalizeClip({ id: 'a', kind: 'image', content: '', copiedAt: 1, times: 1, bytes: 1 }), null)
  })

  test('says what it is without reading the whole of it', () => {
    assert.equal(clipPreview('image', dataUrl(100), { width: 1920, height: 1080 }), 'Image 1920×1080')
    assert.equal(clipPreview('image', dataUrl(100)), 'Image')
  })
})

describe('a text clip', () => {
  test('is trimmed, because a long one is still readable shorter', () => {
    const long = 'x'.repeat(MAX_CLIP_TEXT + 500)
    const kept = normalizeClip({ id: 'a', kind: 'text', content: long, copiedAt: 1, times: 1, bytes: long.length })
    assert.equal(kept?.content.length, MAX_CLIP_TEXT)
  })

  test('is recognised by what it looks like', () => {
    assert.equal(clipKind('https://example.com/a'), 'link')
    assert.equal(clipKind('#1b2b3c'), 'color')
    assert.equal(clipKind('const a = 1'), 'code')
    assert.equal(clipKind('just some words'), 'text')
  })
})

describe('what is kept at all', () => {
  test('nothing that looks like a secret, when that is switched on', () => {
    const settings = { ...DEFAULT_CLIPBOARD_SETTINGS, skipSecrets: true }
    for (const secret of [
      'sk-abcdefghijklmnopqrstuvwxyz0123456789',
      'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123',
      'sk_live_abcdefghij1234567890',
      'ghp_abcdefghijklmnopqrstuvwxyz012345',
      'AKIAIOSFODNN7EXAMPLE'
    ]) {
      assert.equal(shouldCapture(secret, settings, {}).keep, false, secret.slice(0, 12))
    }
  })

  test('and ordinary things are still kept', () => {
    const settings = { ...DEFAULT_CLIPBOARD_SETTINGS, skipSecrets: true }
    for (const fine of ['a note about cats', 'https://example.com/a-page-with-a-long-name', 'const total = price * quantity']) {
      assert.equal(shouldCapture(fine, settings, {}).keep, true, fine.slice(0, 20))
    }
  })

  test('nothing too large to be worth keeping', () => {
    assert.equal(shouldCapture('x'.repeat(MAX_CLIP_TEXT + 1), DEFAULT_CLIPBOARD_SETTINGS, {}).keep, false)
  })
})

describe('searching', () => {
  const clip = (id: string, kind: 'text' | 'image', content: string, preview: string): never =>
    ({ id, kind, content, preview, copiedAt: 1, times: 1, pinned: false, bytes: content.length }) as never

  test('a picture is found by what it says it is, never by its bytes', () => {
    const list = [clip('a', 'image', dataUrl(200), 'Image 800×600'), clip('b', 'text', 'a note about cats', 'a note about cats')]
    assert.deepEqual(
      searchClips(list, 'image', 'all').map((one) => one.id),
      ['a']
    )
    // The base64 is full of letters; searching for one of them must not match the picture.
    assert.deepEqual(
      searchClips(list, 'AAAA', 'all').map((one) => one.id),
      []
    )
  })
})
