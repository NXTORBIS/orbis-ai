import assert from 'node:assert/strict'
import test from 'node:test'
import { convertLine, convertList } from './dnr.ts'

const one = (line: string) => convertLine(line, {})

test('a host rule becomes a case-insensitive DNR block rule', () => {
  const r = one('||ads.example.com^')!.rule
  assert.equal(r.action.type, 'block')
  assert.deepEqual(r.condition, { urlFilter: '||ads.example.com^', isUrlFilterCaseSensitive: false })
})

test('resource types, third-party and domain options are kept exactly', () => {
  const r = one('||cdn.example.net/x.js$script,third-party,domain=a.com|~b.a.com')!.rule
  assert.deepEqual(r.condition.resourceTypes, ['script'])
  assert.equal(r.condition.domainType, 'thirdParty')
  assert.deepEqual(r.condition.initiatorDomains, ['a.com'])
  assert.deepEqual(r.condition.excludedInitiatorDomains, ['b.a.com'])
})

test('an exception outranks a block, and $important outranks an exception', () => {
  const block = one('||a.com^')!.rule.priority
  const allow = one('@@||a.com^')!.rule
  const important = one('||a.com^$important')!.rule.priority
  assert.equal(allow.action.type, 'allow')
  assert.ok(allow.priority > block && important > allow.priority)
})

test('@@...$document switches blocking off for the whole page', () => {
  const r = one('@@||shop.example^$document')!.rule
  assert.equal(r.action.type, 'allowAllRequests')
  assert.deepEqual(r.condition.resourceTypes, ['main_frame', 'sub_frame'])
})

test('rules DNR cannot express are skipped with the reason, never approximated', () => {
  const skipped: Record<string, number> = {}
  assert.equal(convertLine('||a.com^$redirect=noopjs', skipped), null)
  assert.equal(convertLine('||a.com^$removeparam=utm', skipped), null)
  assert.equal(convertLine('/(?=a)b/', skipped), null)
  assert.equal(convertLine('||a.com^$domain=google.*', skipped), null)
  assert.equal(skipped['$redirect'], 1)
  assert.equal(skipped['$removeparam'], 1)
})

test('cosmetic and scriptlet rules are left to the page engine', () => {
  assert.equal(one('example.com##.ad'), null)
  assert.equal(one('example.com#@#.ad'), null)
  assert.equal(one('example.com##+js(abort-on-property-read, x)'), null)
})

test('a generic rule on a site\'s own scripts is Standard-safe: third-party only, first-party only in Strict', () => {
  const c = convertList('/adsbygoogle.$script\n||tracker.example^$script')
  const generic = c.standard.find((r) => r.condition.urlFilter === '/adsbygoogle.')!
  assert.equal(generic.condition.domainType, 'thirdParty')
  assert.equal(c.strictExtra.length, 1)
  assert.equal(c.strictExtra[0].condition.domainType, 'firstParty')
  assert.equal(c.standard.find((r) => r.condition.urlFilter === '||tracker.example^')!.condition.domainType, undefined, 'host-anchored rules stay as they are')
})

test('$badfilter cancels the rule it names and duplicates collapse', () => {
  const c = convertList('||a.com^\n||a.com^$badfilter\n||b.com^\n||b.com^')
  assert.deepEqual(c.standard.map((r) => r.condition.urlFilter), ['||b.com^'])
})
