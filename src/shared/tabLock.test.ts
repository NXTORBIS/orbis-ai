import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aiMayUse,
  cleanGroups,
  cleanPattern,
  cleanPolicy,
  cleanRules,
  cleanSchedule,
  DEFAULT_POLICY,
  describeDelay,
  effectivePolicy,
  explainProtection,
  labelRevealsSite,
  MAX_DELAY_MS,
  MAX_RULES,
  nextLockAt,
  POLICY_PRESETS,
  ruleFor,
  ruleMatches,
  safeTabInfo,
  scheduleCovers,
  shouldLock,
  tabLockedRefusal,
  type DomainRule,
  type TabLockPolicy
} from './tabLock.ts'

const GMAIL = { tabId: 7, title: 'Inbox (23) — Gmail', url: 'https://mail.google.com/mail/u/0/#inbox', favicon: 'https://mail.google.com/favicon.ico' }

const policy = (over: Partial<TabLockPolicy> = {}): TabLockPolicy => ({ ...DEFAULT_POLICY, ...over })

// ================================================================ what a locked tab may say
//
// The most important tests in the file. Everything else is convenience; this is the promise.

test('a locked tab reveals nothing about what it is', () => {
  const safe = safeTabInfo(GMAIL, true, DEFAULT_POLICY)

  assert.equal(safe.title, 'Locked Tab', 'not the page title')
  assert.equal(safe.url, null, 'not the address')
  assert.equal(safe.favicon, null, 'not the site icon')
  assert.equal(safe.contentAvailable, false, 'not the content')
  assert.equal(safe.previewAvailable, false, 'not a picture of it')

  // The decisive check: nothing anywhere in what is handed out names the site.
  const everything = JSON.stringify(safe).toLowerCase()
  for (const giveaway of ['gmail', 'google', 'inbox', 'mail', '23']) {
    assert.ok(!everything.includes(giveaway), `"${giveaway}" leaked through safeTabInfo`)
  }
})

test('an unlocked tab is passed through untouched', () => {
  const safe = safeTabInfo(GMAIL, false, DEFAULT_POLICY)
  assert.equal(safe.title, GMAIL.title)
  assert.equal(safe.url, GMAIL.url)
  assert.equal(safe.favicon, GMAIL.favicon)
  assert.equal(safe.contentAvailable, true)
  assert.equal(safe.previewAvailable, true)
})

test('hidden fields are null, not empty, so a caller that forgets to check gets nothing usable', () => {
  const safe = safeTabInfo(GMAIL, true, DEFAULT_POLICY)
  assert.strictEqual(safe.url, null)
  assert.strictEqual(safe.favicon, null)
  assert.notStrictEqual(safe.url, '', 'an empty string looks like an address that happens to be blank')
})

test('a person who chose to show the title gets the title, and still not the address', () => {
  const safe = safeTabInfo(GMAIL, true, policy({ hideTitle: false }))
  assert.equal(safe.title, GMAIL.title, 'they asked for it')
  assert.equal(safe.url, null, 'but that was a separate decision')
})

test("the content of a locked tab is never available, whatever the metadata settings say", () => {
  const everythingShown = policy({
    hideTitle: false,
    hideFavicon: false,
    hideUrl: false,
    hidePreview: false,
    hideFromAi: false
  })
  const safe = safeTabInfo(GMAIL, true, everythingShown)
  assert.equal(safe.contentAvailable, false, 'locked is locked; the settings govern metadata, not the page')
})

test('a custom label is used, and a label that names the site is warned about', () => {
  assert.equal(safeTabInfo(GMAIL, true, policy({ label: 'Private' })).title, 'Private')
  assert.equal(labelRevealsSite('Private', GMAIL.url), false)
  assert.equal(labelRevealsSite('Gmail', GMAIL.url), true)
  assert.equal(labelRevealsSite('google stuff', GMAIL.url), true)
  assert.equal(labelRevealsSite('Work', GMAIL.url), false)
  assert.equal(labelRevealsSite('', GMAIL.url), false, 'nothing typed is not a warning')
})

test('nothing may read a locked tab, whatever the AI setting is', () => {
  assert.equal(aiMayUse(false, DEFAULT_POLICY), true, 'an unlocked tab is ordinary')
  assert.equal(aiMayUse(true, DEFAULT_POLICY), false)
  assert.equal(aiMayUse(true, policy({ hideFromAi: false })), false, 'locked is locked')
})

test('a refusal says it is a lock, not a failure, so a caller can ask for the password', () => {
  const said = tabLockedRefusal()
  assert.equal(said.error, 'TAB_LOCKED')
  assert.equal(said.needs, 'user-authentication')
  assert.ok(said.message.length > 0)
})

// ================================================================ matching a site

test('a bare host matches the site and its subdomains', () => {
  assert.equal(ruleMatches('example.com', 'https://example.com/anything'), true)
  assert.equal(ruleMatches('example.com', 'https://mail.example.com/x'), true)
  assert.equal(ruleMatches('example.com', 'https://deep.mail.example.com/x'), true)
})

test('a host does not match something that merely ends with it', () => {
  // The bug this guards against: `endsWith('example.com')` matching `notexample.com`.
  assert.equal(ruleMatches('example.com', 'https://notexample.com/'), false)
  assert.equal(ruleMatches('bank.com', 'https://fakebank.com/'), false)
})

test('an explicit subdomain wildcard says the same thing', () => {
  assert.equal(ruleMatches('*.example.com', 'https://mail.example.com/'), true)
  assert.equal(ruleMatches('*.example.com', 'https://example.com/'), true)
})

test('a path narrows a rule to part of a site', () => {
  assert.equal(ruleMatches('example.com/work', 'https://example.com/work'), true)
  assert.equal(ruleMatches('example.com/work', 'https://example.com/work/notes'), true)
  assert.equal(ruleMatches('example.com/work', 'https://example.com/personal'), false)
  // And a path prefix must be a whole segment: /work must not match /workshop.
  assert.equal(ruleMatches('example.com/work', 'https://example.com/workshop'), false)
})

test('a scheme in the pattern is tolerated, and case does not matter', () => {
  assert.equal(ruleMatches('https://Example.COM', 'https://example.com/'), true)
  assert.equal(ruleMatches('example.com', 'HTTPS://EXAMPLE.COM/'), true)
})

test('an address that is not a site matches nothing', () => {
  for (const url of ['', 'about:blank', 'chrome://newtab/', 'not a url', 'javascript:void(0)']) {
    assert.equal(ruleMatches('example.com', url), false, `${url} should match nothing`)
  }
})

test('an empty or nonsense pattern matches nothing rather than everything', () => {
  // The failure mode worth being certain about: a broken rule that protects every tab, or none silently.
  for (const pattern of ['', '   ', '*', '*.', '/', '//']) {
    assert.equal(ruleMatches(pattern, 'https://example.com/'), false, `"${pattern}" must match nothing`)
  }
})

// ================================================================ schedules

const NINE_TO_FIVE = { days: [1, 2, 3, 4, 5] as const, fromMinutes: 9 * 60, toMinutes: 17 * 60 }

const at = (day: number, hour: number, minute = 0): number => {
  // 2026-09-27 is a Sunday, so adding `day` lands on that weekday.
  const d = new Date(2026, 8, 27 + day, hour, minute)
  return d.getTime()
}

test('a weekday schedule covers its hours on its days only', () => {
  const s = { ...NINE_TO_FIVE, days: [...NINE_TO_FIVE.days] }
  assert.equal(scheduleCovers(s, at(1, 10)), true, 'Monday morning')
  assert.equal(scheduleCovers(s, at(1, 8, 59)), false, 'just before nine')
  assert.equal(scheduleCovers(s, at(1, 17)), false, 'five is the end, not inside it')
  assert.equal(scheduleCovers(s, at(0, 10)), false, 'Sunday')
  assert.equal(scheduleCovers(s, at(6, 10)), false, 'Saturday')
})

test('a schedule that wraps past midnight is one stretch, not an empty one', () => {
  // A night shift: Friday 22:00 to 06:00.
  const night = { days: [5 as const], fromMinutes: 22 * 60, toMinutes: 6 * 60 }
  assert.equal(scheduleCovers(night, at(5, 23)), true, 'Friday night')
  assert.equal(scheduleCovers(night, at(6, 2)), true, 'and the small hours of Saturday belong to it')
  assert.equal(scheduleCovers(night, at(6, 7)), false, 'but not Saturday morning')
  assert.equal(scheduleCovers(night, at(5, 21, 59)), false)
})

test('a schedule with no days, or a zero-length window, covers nothing', () => {
  assert.equal(scheduleCovers({ days: [], fromMinutes: 0, toMinutes: 600 }, at(1, 5)), false)
  assert.equal(scheduleCovers({ days: [1], fromMinutes: 600, toMinutes: 600 }, at(1, 10)), false)
})

test('the first enabled rule that applies now is the one that wins', () => {
  const rules: DomainRule[] = [
    { id: 'off', pattern: 'example.com', enabled: false, groupId: 'a', schedule: null },
    { id: 'work', pattern: 'example.com', enabled: true, groupId: 'work', schedule: { ...NINE_TO_FIVE, days: [...NINE_TO_FIVE.days] } },
    { id: 'always', pattern: 'example.com', enabled: true, groupId: 'personal', schedule: null }
  ]
  assert.equal(ruleFor(rules, 'https://example.com/', at(1, 10))?.id, 'work', 'inside working hours')
  assert.equal(ruleFor(rules, 'https://example.com/', at(1, 22))?.id, 'always', 'outside them, the unscheduled rule')
  assert.equal(ruleFor(rules, 'https://other.example/', at(1, 10)), null, 'and a site nothing covers')
})

// ================================================================ which policy wins

test('the most specific setting wins, field by field', () => {
  const profile = policy({ inactivity: 60_000, tabSwitch: null, label: 'Locked Tab' })
  const group = { ...profile, inactivity: 30_000, label: 'Work' }
  const tab = { tabSwitch: 0 }

  const effective = effectivePolicy(profile, group, tab)
  assert.equal(effective.tabSwitch, 0, 'the tab overrode this')
  assert.equal(effective.inactivity, 30_000, 'the group overrode this')
  assert.equal(effective.label, 'Work', 'and this')
  assert.equal(effective.onSystemLock, profile.onSystemLock, 'everything else came from the profile')
})

test('a tab that overrides one field keeps the rest of its group', () => {
  const profile = policy()
  const group = { ...profile, hideTitle: false, label: 'Work' }
  const effective = effectivePolicy(profile, group, { inactivity: 1000 })
  assert.equal(effective.hideTitle, false, 'still the group\'s')
  assert.equal(effective.label, 'Work')
  assert.equal(effective.inactivity, 1000)
})

test('no group and no tab settings means the profile default', () => {
  assert.deepEqual(effectivePolicy(DEFAULT_POLICY, null, null), DEFAULT_POLICY)
})

// ================================================================ when a tab locks

const moment = (trigger: Parameters<typeof shouldLock>[1]['trigger'], sinceMs = 0, active = false): Parameters<typeof shouldLock>[1] => ({
  trigger,
  sinceMs,
  active
})

test('asking locks it, immediately, whatever the policy says', () => {
  const nothingOn = policy({ inactivity: null, onSystemLock: false, onSleep: false, onStartup: false })
  assert.equal(shouldLock(nothingOn, moment('manual'), false), true)
  assert.equal(shouldLock(nothingOn, moment('panic'), false), true)
})

test('an already locked tab is not locked again', () => {
  for (const trigger of ['manual', 'panic', 'systemLock', 'inactivity'] as const) {
    assert.equal(shouldLock(DEFAULT_POLICY, moment(trigger, MAX_DELAY_MS), true), false, `${trigger} locked it twice`)
  }
})

test('a trigger that is switched off does nothing', () => {
  const off = policy({ tabSwitch: null, windowBlur: null, inactivity: null, minimize: null, onSystemLock: false, onSleep: false, onStartup: false })
  for (const trigger of ['tabSwitch', 'windowBlur', 'inactivity', 'minimize', 'systemLock', 'sleep', 'startup'] as const) {
    assert.equal(shouldLock(off, moment(trigger, MAX_DELAY_MS), false), false, `${trigger} fired while off`)
  }
})

test('a delayed trigger waits out its delay', () => {
  const p = policy({ windowBlur: 30_000 })
  assert.equal(shouldLock(p, moment('windowBlur', 29_999), false), false)
  assert.equal(shouldLock(p, moment('windowBlur', 30_000), false), true)
})

test('a zero delay means the instant it happens', () => {
  assert.equal(shouldLock(policy({ windowBlur: 0 }), moment('windowBlur', 0), false), true)
})

test('leaving a tab locks it; the tab you moved to is not "left"', () => {
  const p = policy({ tabSwitch: 0 })
  assert.equal(shouldLock(p, moment('tabSwitch', 0, false), false), true, 'the one left behind')
  assert.equal(shouldLock(p, moment('tabSwitch', 0, true), false), false, 'the one now in front')
})

test('the machine locking, sleeping, or Orbis starting are switches, not delays', () => {
  assert.equal(shouldLock(policy({ onSystemLock: true }), moment('systemLock', 0), false), true)
  assert.equal(shouldLock(policy({ onSleep: true }), moment('sleep', 0), false), true)
  assert.equal(shouldLock(policy({ onStartup: true }), moment('startup', 0), false), true)
})

test('the soonest timed lock is worked out once, so one timer serves every tab', () => {
  const p = policy({ tabSwitch: 5_000, windowBlur: 30_000, inactivity: 60_000, minimize: null })
  const soonest = nextLockAt(p, { leftTabAt: 1_000, blurredAt: 2_000, lastActivityAt: 500, minimizedAt: 900 })
  assert.equal(soonest, 6_000, 'left the tab at 1000 plus five seconds')

  assert.equal(nextLockAt(p, {}), null, 'nothing has happened, so nothing is owed')
  assert.equal(nextLockAt(policy({ tabSwitch: null, windowBlur: null, inactivity: null, minimize: null }), { leftTabAt: 1 }), null)
  // A trigger that is off contributes nothing even when its moment is known.
  assert.equal(nextLockAt(policy({ tabSwitch: null, inactivity: 10_000, windowBlur: null, minimize: null }), { leftTabAt: 0, lastActivityAt: 0 }), 10_000)
})

// ================================================================ the presets are real

test('every preset is a different real policy, not a name', () => {
  const seen = new Set(Object.values(POLICY_PRESETS).map((p) => JSON.stringify(p)))
  assert.equal(seen.size, Object.keys(POLICY_PRESETS).length, 'two presets are secretly identical')
})

test('every preset hides what a locked tab is', () => {
  for (const [name, p] of Object.entries(POLICY_PRESETS)) {
    const safe = safeTabInfo(GMAIL, true, p)
    assert.equal(safe.url, null, `${name} showed the address`)
    assert.equal(safe.title, p.label, `${name} showed the title`)
    assert.equal(safe.contentAvailable, false, `${name} allowed the content`)
  }
})

test('the strongest preset locks the moment you look away', () => {
  const most = POLICY_PRESETS.maximum
  assert.equal(shouldLock(most, moment('tabSwitch', 0, false), false), true)
  assert.equal(shouldLock(most, moment('windowBlur', 0), false), true)
})

// ================================================================ explaining itself

test('a tab can say why it is protected without saying what it is', () => {
  const rule: DomainRule = { id: 'r', pattern: 'bank.example', enabled: true, groupId: 'g', schedule: null }
  const said = explainProtection({ rule, group: { id: 'g', name: 'Personal', policy: DEFAULT_POLICY, createdAt: 0, updatedAt: 0 } }, DEFAULT_POLICY)
  assert.ok(said.length > 0)
  assert.ok(said.some((line) => line.includes('bank.example')), 'the rule is named, because the person wrote it')
  assert.ok(said.some((line) => line.includes('Personal')))
  assert.ok(said.some((line) => /locks when this computer locks/i.test(line)))
})

test('delays read as a person would say them', () => {
  assert.equal(describeDelay(null), 'never')
  assert.equal(describeDelay(0), 'immediately')
  assert.equal(describeDelay(30_000), '30 seconds')
  assert.equal(describeDelay(60_000), '1 minute')
  assert.equal(describeDelay(5 * 60_000), '5 minutes')
  assert.equal(describeDelay(60 * 60_000), '1 hour')
})

// ================================================================ reading configuration in

test('a policy from elsewhere is bounded field by field', () => {
  const read = cleanPolicy({ inactivity: -5, windowBlur: 1e12, tabSwitch: 'soon', label: '   ', hideUrl: 'yes' })
  assert.equal(read.inactivity, 0, 'a negative delay becomes immediate')
  assert.equal(read.windowBlur, MAX_DELAY_MS, 'and an absurd one is capped')
  assert.equal(read.tabSwitch, DEFAULT_POLICY.tabSwitch, 'a non-number falls back')
  assert.equal(read.label, DEFAULT_POLICY.label, 'and a blank label does too')
  assert.equal(read.hideUrl, true, 'a non-boolean keeps the private default')
})

test('null really means never, and survives being read back', () => {
  assert.equal(cleanPolicy({ inactivity: null }).inactivity, null)
})

test('a policy that says nothing is the default', () => {
  assert.deepEqual(cleanPolicy({}), DEFAULT_POLICY)
  assert.deepEqual(cleanPolicy(null), DEFAULT_POLICY)
  assert.deepEqual(cleanPolicy('nonsense'), DEFAULT_POLICY)
})

test('a pattern is a host, and anything else is refused rather than interpreted', () => {
  assert.equal(cleanPattern('Example.COM/'), 'example.com')
  assert.equal(cleanPattern('https://mail.example.com/work/'), 'mail.example.com/work')
  assert.equal(cleanPattern('*.bank.example'), '*.bank.example')

  for (const bad of ['', '   ', 'localhost', 'no spaces here.com/a b', '*', '*.', '.com', 'example', 'a'.repeat(300)]) {
    assert.equal(cleanPattern(bad), null, `"${bad}" should be refused`)
  }
})

test('rules are read, bounded and deduplicated', () => {
  const one = { id: 'same', pattern: 'example.com', groupId: 'g' }
  assert.equal(cleanRules([one, { ...one, pattern: 'other.example' }]).length, 1, 'deduplicated by id')
  assert.equal(cleanRules([{ id: 'x', pattern: 'not a host', groupId: 'g' }]).length, 0, 'a bad pattern is not a rule')
  assert.equal(cleanRules([{ id: 'x', pattern: 'example.com' }]).length, 0, 'a rule with no credential is not a rule')
  const many = Array.from({ length: MAX_RULES + 20 }, (_, i) => ({ ...one, id: `r${i}` }))
  assert.ok(cleanRules(many).length <= MAX_RULES)
  assert.deepEqual(cleanRules('not a list'), [])
})

test('a schedule from elsewhere is bounded', () => {
  assert.deepEqual(cleanSchedule({ days: [1, 1, 9, 3], fromMinutes: 540, toMinutes: 1020 }), {
    days: [1, 3],
    fromMinutes: 540,
    toMinutes: 1020
  })
  assert.equal(cleanSchedule({ days: [1], fromMinutes: 540, toMinutes: 540 }), null, 'a zero-length window is nothing')
  assert.equal(cleanSchedule({ days: [], fromMinutes: 0, toMinutes: 10 }), null)
  assert.equal(cleanSchedule({ days: [1], fromMinutes: 2000, toMinutes: 10 }), null, 'a minute outside a day')
  assert.equal(cleanSchedule(null), null)
})

test('groups are read, bounded and deduplicated, and carry a real policy', () => {
  const groups = cleanGroups([
    { id: 'a', name: 'Personal', policy: { inactivity: 1000 } },
    { id: 'a', name: 'Duplicate' },
    { id: 'b', name: '' }
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].policy.inactivity, 1000)
  assert.equal(groups[0].policy.hideUrl, true, 'and the rest of the policy is the private default')
})
