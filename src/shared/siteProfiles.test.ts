import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { hostOf, noteChallenge, noteOutcome, prune, readProfile, skillOf, summarise, type SiteProfile } from './siteProfiles.ts'

const NOW = new Date('2026-10-03T12:00:00').getTime()
const DAY = 24 * 60 * 60 * 1000

const after = (profile: SiteProfile | undefined, host: string, skill: Parameters<typeof noteOutcome>[2], worked: boolean, times: number, at = NOW): SiteProfile => {
  let out = profile
  for (let i = 0; i < times; i++) out = noteOutcome(out, host, skill, worked, at)
  return out!
}

test('a site is a site, not a page, and not everything is one', () => {
  assert.equal(hostOf('https://www.example.org/some/page?q=1'), 'example.org')
  assert.equal(hostOf('http://shop.example.org/'), 'shop.example.org')
  assert.equal(hostOf('chrome://settings/'), null)
  assert.equal(hostOf('file:///C:/a.html'), null)
  assert.equal(hostOf('not a url'), null)
})

test('capabilities map to the kind of thing they exercise, and most map to nothing', () => {
  assert.equal(skillOf('page.click'), 'click')
  assert.equal(skillOf('page.find'), 'find')
  assert.equal(skillOf('page.read'), 'read')
  assert.equal(skillOf('navigation.reload'), 'navigate')
  // These say nothing about a site's compatibility, so they are not recorded against one.
  assert.equal(skillOf('tabs.create'), null)
  assert.equal(skillOf('bookmarks.add'), null)
  assert.equal(skillOf('history.clear'), null)
})

test('a site Orbis has never worked on has nothing to say', () => {
  const profile = after(undefined, 'example.org', 'click', true, 1)
  assert.equal(summarise(profile, NOW), null, 'one thing working is not worth a note')
})

test('a site where everything works stays quiet', () => {
  const profile = after(undefined, 'example.org', 'click', true, 20)
  assert.equal(summarise(profile, NOW), null, 'the agent already assumes things work; saying so is noise')
})

test('a site where something keeps failing says so', () => {
  let profile = after(undefined, 'awkward.example', 'find', false, 4)
  profile = after(profile, 'awkward.example', 'click', true, 5)
  const note = summarise(profile, NOW)
  assert.ok(note?.includes('awkward.example'))
  assert.ok(note?.includes('find has failed 4 of 4'), note ?? '')
  assert.ok(!note?.includes('click'), 'what works is not mentioned')
})

test('two failures are not a pattern', () => {
  const profile = after(undefined, 'example.org', 'find', false, 2)
  assert.equal(summarise(profile, NOW), null)
})

test('failing less often than succeeding is not worth mentioning', () => {
  let profile = after(undefined, 'example.org', 'click', true, 5)
  profile = after(profile, 'example.org', 'click', false, 2)
  assert.equal(summarise(profile, NOW), null)
})

test('a site that asks people to verify themselves is worth knowing about', () => {
  const once = noteChallenge(undefined, 'guarded.example', NOW)
  assert.ok(summarise(once, NOW)?.includes('once'))
  const twice = noteChallenge(noteChallenge(undefined, 'guarded.example', NOW), 'guarded.example', NOW)
  assert.ok(summarise(twice, NOW)?.includes('2 times'))
})

test('what Orbis learned a long time ago is not used, because sites change', () => {
  const old = after(undefined, 'example.org', 'find', false, 5, NOW - 90 * DAY)
  assert.equal(summarise(old, NOW), null)
  assert.deepEqual(prune([old], 300, NOW), [], 'and it is not kept either')
})

test('a profile never contains anything about the person or a thing to click', () => {
  let profile = after(undefined, 'example.org', 'type', true, 3)
  profile = noteChallenge(profile, 'example.org', NOW)
  const keys = new Set(Object.keys(profile))
  // The whole shape, stated here so adding a field that stores content fails this test.
  assert.deepEqual([...keys].sort(), ['challenges', 'firstSeen', 'host', 'lastChallenge', 'lastSeen', 'skills'].sort())
  const asText = JSON.stringify(profile)
  assert.ok(!/selector|xpath|click|steps|script|query|text/i.test(asText.replace(/"skills"|"challenges"/g, '')), asText)
})

test('recording does not change what was there before', () => {
  const first = after(undefined, 'example.org', 'click', true, 1)
  const second = noteOutcome(first, 'example.org', 'click', false, NOW)
  assert.equal(first.skills.click?.failed, 0, 'the earlier profile is untouched')
  assert.equal(second.skills.click?.failed, 1)
})

test('the most recently used sites are kept, and the rest go', () => {
  const sites = Array.from({ length: 10 }, (_, i) => after(undefined, `s${i}.example`, 'click', true, 1, NOW - i * 1000))
  const kept = prune(sites, 3, NOW)
  assert.deepEqual(kept.map((one) => one.host), ['s0.example', 's1.example', 's2.example'])
})

test('a damaged record is dropped rather than repaired into something that might mislead', () => {
  assert.equal(readProfile(null), null)
  assert.equal(readProfile({ host: '' }), null)
  assert.equal(readProfile({ host: 'a.example' }), null, 'no dates, no profile')
  const good = readProfile({ host: 'a.example', firstSeen: NOW, lastSeen: NOW, challenges: 2, skills: { click: { worked: 1, failed: 0, at: NOW } } })
  assert.equal(good?.host, 'a.example')
  assert.equal(good?.challenges, 2)
  const bent = readProfile({ host: 'a.example', firstSeen: NOW, lastSeen: NOW, challenges: -5, skills: { click: 'nonsense' } })
  assert.equal(bent?.challenges, 0, 'a negative count is not a count')
  assert.deepEqual(bent?.skills, {}, 'and a skill that is not one is dropped')
})
