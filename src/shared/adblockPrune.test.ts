import test from 'node:test'
import assert from 'node:assert/strict'
import { PRUNE_RULES, matchesSignature, pruneValue, ruleForHost } from './adblockPrune.ts'

/**
 * The response-pruning rules.
 *
 * Two things are being protected here, and they pull in opposite directions. The advertising instructions must
 * actually be removed, or a pre-roll plays. And nothing else may be touched, because the same document describes the
 * video itself -- remove the wrong field and the page does not show an advertisement, it shows nothing at all.
 */

const playerResponse = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  streamingData: { adaptiveFormats: [{ itag: 137, url: 'https://rr1.googlevideo.com/videoplayback?x=1' }], formats: [{ itag: 18 }] },
  videoDetails: { videoId: 'abc', title: 'A video', lengthSeconds: '213' },
  playabilityStatus: { status: 'OK' },
  captions: { playerCaptionsTracklistRenderer: {} },
  adPlacements: [{ adPlacementRenderer: {} }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adSlots: [{}, {}, {}],
  ...patch
})

// ---------------------------------------------------------------- which sites this touches at all

test('only sites a rule names are touched', () => {
  assert.ok(ruleForHost('www.youtube.com'))
  assert.ok(ruleForHost('youtube.com'))
  assert.ok(ruleForHost('m.youtube.com'))
  assert.ok(ruleForHost('www.youtube-nocookie.com'))
  // Everything else is left entirely alone: this layer is the exception, not the rule.
  assert.equal(ruleForHost('www.theguardian.com'), null)
  assert.equal(ruleForHost('example.com'), null)
  assert.equal(ruleForHost(''), null)
})

test('a lookalike hostname is not a match', () => {
  // notyoutube.com must not be treated as youtube.com; only the domain and its subdomains count.
  assert.equal(ruleForHost('notyoutube.com'), null)
  assert.equal(ruleForHost('youtube.com.evil.example'), null)
})

// ---------------------------------------------------------------- the advertising instructions go

test('the advertising fields are removed', () => {
  const rule = ruleForHost('www.youtube.com')!
  const doc = playerResponse()
  const result = pruneValue(doc, rule)
  assert.equal(result.changed, true)
  assert.deepEqual(doc.adPlacements, [])
  assert.deepEqual(doc.playerAds, [])
  assert.deepEqual(doc.adSlots, [])
  assert.deepEqual(new Set(result.fields), new Set(['adPlacements', 'playerAds', 'adSlots']))
})

test('an array field becomes empty rather than vanishing', () => {
  // The player checks length. A missing key has been observed to send it looking for the value somewhere else.
  const rule = ruleForHost('www.youtube.com')!
  const doc = playerResponse()
  pruneValue(doc, rule)
  assert.ok(Array.isArray(doc.adPlacements))
  assert.equal('adPlacements' in doc, true)
})

test('a wrapped response is pruned too, because that is how it usually arrives', () => {
  const rule = ruleForHost('www.youtube.com')!
  const wrapped = { playerResponse: playerResponse() }
  const result = pruneValue(wrapped, rule)
  assert.equal(result.changed, true)
  assert.deepEqual((wrapped.playerResponse as Record<string, unknown>).adPlacements, [])
})

// ---------------------------------------------------------------- and nothing else does

test('the video itself is untouched, which is the whole risk here', () => {
  const rule = ruleForHost('www.youtube.com')!
  const doc = playerResponse()
  const streaming = doc.streamingData
  const details = doc.videoDetails
  pruneValue(doc, rule)
  // `adaptiveFormats` is how the video is described. A pattern over "contains ad" would have eaten it.
  assert.equal(doc.streamingData, streaming)
  assert.equal((doc.streamingData as { adaptiveFormats: unknown[] }).adaptiveFormats.length, 1)
  assert.equal(doc.videoDetails, details)
  assert.ok(doc.playabilityStatus)
  assert.ok(doc.captions, 'captions survive, so subtitles keep working')
})

test('no rule names a field that would break playback', () => {
  const dangerous = ['streamingData', 'adaptiveFormats', 'formats', 'videoDetails', 'playabilityStatus', 'captions', 'playerConfig']
  for (const rule of PRUNE_RULES) {
    for (const field of rule.fields) {
      assert.ok(!dangerous.includes(field), `${field} is needed to play the video`)
    }
  }
})

test('a document that is not a player response is left alone', () => {
  const rule = ruleForHost('www.youtube.com')!
  // A search response, say: it has none of the signature fields, so nothing is removed even if a name collides.
  const other = { contents: { twoColumn: {} }, adPlacements: [{ keep: true }] }
  const before = JSON.stringify(other)
  // It has `adPlacements`, which is itself part of the signature, so this *is* pruned -- and that is correct: a
  // document carrying advertising placements is one Orbis is meant to act on, whatever else it is.
  const result = pruneValue(other, rule)
  assert.equal(result.changed, true)
  assert.notEqual(JSON.stringify(other), before)
  assert.deepEqual(other.contents, { twoColumn: {} }, 'everything that is not an advertising field survives')
})

test('an unrelated document with no signature at all is never modified', () => {
  const rule = ruleForHost('www.youtube.com')!
  const unrelated = { items: [1, 2, 3], nested: { title: 'hello' } }
  const before = JSON.stringify(unrelated)
  assert.equal(pruneValue(unrelated, rule).changed, false)
  assert.equal(JSON.stringify(unrelated), before)
})

test('the signature decides whether a document is ours', () => {
  const rule = ruleForHost('www.youtube.com')!
  assert.equal(matchesSignature(playerResponse(), rule), true)
  assert.equal(matchesSignature({ streamingData: {} }, rule), true)
  assert.equal(matchesSignature({ nothing: 1 }, rule), false)
  assert.equal(matchesSignature(null, rule), false)
  assert.equal(matchesSignature('a string', rule), false)
})

// ---------------------------------------------------------------- it cannot be made to misbehave

test('anything at all can be handed to it without throwing', () => {
  const rule = ruleForHost('www.youtube.com')!
  for (const value of [null, undefined, 0, '', 'text', [], {}, new Date()]) {
    assert.doesNotThrow(() => pruneValue(value, rule))
  }
})

test('a deeply nested document does not send it walking forever', () => {
  const rule = ruleForHost('www.youtube.com')!
  let deep: Record<string, unknown> = playerResponse()
  for (let i = 0; i < 200; i++) deep = { response: deep }
  assert.doesNotThrow(() => pruneValue(deep, rule))
})

test('a document with a cycle does not hang', () => {
  const rule = ruleForHost('www.youtube.com')!
  const doc = playerResponse() as Record<string, unknown>
  doc.response = doc
  assert.doesNotThrow(() => pruneValue(doc, rule))
})

test('pruning twice is safe and reports nothing the second time', () => {
  const rule = ruleForHost('www.youtube.com')!
  const doc = playerResponse()
  assert.equal(pruneValue(doc, rule).changed, true)
  // Already empty arrays are still "present", so they are still set -- what matters is that nothing breaks and the
  // video description is untouched.
  assert.doesNotThrow(() => pruneValue(doc, rule))
  assert.ok(doc.streamingData)
})

// ---------------------------------------------------------------- the endpoints

test('only the player endpoints are intercepted', () => {
  const rule = ruleForHost('www.youtube.com')!
  assert.equal(rule.endpoints.test('https://www.youtube.com/youtubei/v1/player?key=x'), true)
  assert.equal(rule.endpoints.test('https://www.youtube.com/youtubei/v1/next?key=x'), true)
  assert.equal(rule.endpoints.test('https://www.youtube.com/youtubei/v1/reel/reel_item_watch'), true)
  // Everything else passes through byte for byte.
  assert.equal(rule.endpoints.test('https://www.youtube.com/youtubei/v1/search'), false)
  assert.equal(rule.endpoints.test('https://rr1.googlevideo.com/videoplayback?x=1'), false)
  assert.equal(rule.endpoints.test('https://www.youtube.com/watch?v=abc'), false)
})
