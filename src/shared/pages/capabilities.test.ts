import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  atLeastAsRisky,
  CAPABILITIES,
  capabilityById,
  capabilityChanges,
  checkDeclarations,
  decide,
  describeScope,
  FORBIDDEN_CAPABILITIES,
  grantableCapabilities,
  grantIsLive,
  HANDLE_LIFETIME_MS,
  handleIsValid,
  isGrantableCapability,
  issueHandle,
  NO_SCOPE,
  originScope,
  originScopeCovers,
  pathScopeCovers,
  permissionSummary,
  scopeCovers,
  type DecideInput,
  type OriginScope,
  type PermissionGrant,
  type Scope
} from './capabilities.ts'

const NOW = 1_700_000_000_000
const PAGE = 'page_abcdef123456'
const VERSION = '1.0.0'

const ask = (capabilityId: string, patch: Partial<DecideInput> = {}): ReturnType<typeof decide> =>
  decide({
    capabilityId,
    pageId: PAGE,
    pageVersion: VERSION,
    trust: 'user',
    declared: [capabilityId],
    grants: [],
    now: NOW,
    ...patch
  })

const grant = (capabilityId: string, patch: Partial<PermissionGrant> = {}): PermissionGrant => ({
  pageId: PAGE,
  capabilityId,
  scope: NO_SCOPE,
  grantedAt: NOW - 1000,
  expiresAt: null,
  source: 'user',
  pageVersion: VERSION,
  state: 'active',
  ...patch
})

const origin = (url: string): OriginScope => {
  const scope = originScope(url)
  assert.notEqual(scope, null, `"${url}" should be a usable origin`)
  return scope as OriginScope
}

// ---------------------------------------------------------------- the registry describes itself

test('every capability has a distinct id matching its key, and a real classification', () => {
  for (const [key, definition] of Object.entries({ ...CAPABILITIES, ...FORBIDDEN_CAPABILITIES })) {
    assert.equal(definition.id, key, `${key} does not match its own id`)
    assert.ok(definition.name.length > 0, `${key} has no name`)
    assert.ok(definition.description.length > 10, `${key} has no usable description`)
    assert.ok(['low', 'medium', 'high', 'critical'].includes(definition.risk), `${key} has no risk`)
  }
})

test('every dependency names a capability that exists', () => {
  for (const definition of Object.values(CAPABILITIES)) {
    for (const required of definition.requires ?? []) {
      assert.notEqual(capabilityById(required), null, `${definition.id} requires ${required}, which does not exist`)
      // And a dependency must itself be grantable, or the dependent could never be allowed.
      assert.equal(isGrantableCapability(required), true, `${definition.id} depends on something ungrantable`)
    }
  }
})

test('only capabilities that reach nothing outside the Page are automatic', () => {
  for (const definition of Object.values(CAPABILITIES)) {
    if (definition.consent !== 'automatic') continue
    assert.equal(definition.risk, 'low', `${definition.id} is automatic but not low risk`)
    assert.ok(
      ['computation', 'storage'].includes(definition.category),
      `${definition.id} is automatic but reaches ${definition.category}`
    )
  }
})

test('anything that needs a prompt for a reason says so', () => {
  for (const definition of Object.values(CAPABILITIES)) {
    if (atLeastAsRisky(definition.risk, 'high')) {
      assert.notEqual(definition.consent, 'automatic', `${definition.id} is high risk and automatic`)
    }
  }
})

test('the forbidden capabilities are not grantable and are not in the grantable list', () => {
  for (const id of Object.keys(FORBIDDEN_CAPABILITIES)) {
    assert.equal(isGrantableCapability(id), false, `${id} should not be grantable`)
    assert.equal(grantableCapabilities().some((one) => one.id === id), false)
    // But they resolve, so a refusal can name them.
    assert.notEqual(capabilityById(id), null)
  }
})

// ---------------------------------------------------------------- deny by default

test('an unknown capability is denied, never treated as a wildcard', () => {
  const decision = ask('something.invented', { declared: ['something.invented'] })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.reason, 'unknown-capability')
  assert.match(decision.message, /something.invented/)
})

test('an empty or malformed capability name is denied', () => {
  for (const bad of ['', '   ', 'system', '../../etc']) {
    assert.equal(ask(bad, { declared: [bad] }).outcome, 'deny', `"${bad}" should be denied`)
  }
})

test('a forbidden capability is refused by name, and nothing can grant it', () => {
  for (const id of ['system.secrets', 'system.execute', 'system.credentials', 'system.filesystem']) {
    const decision = ask(id, { declared: [id], grants: [grant(id)], trust: 'system' })
    assert.equal(decision.outcome, 'deny', id)
    assert.equal(decision.reason, 'forbidden-capability', id)
    // A grant in the store does not move it, and neither does being a system Page.
    assert.match(decision.message, /never/)
  }
})

test('a capability the Page never declared is denied even when a grant exists', () => {
  // The declaration is what got reviewed. A grant for something undeclared is a grant nobody looked at.
  const decision = ask('network.fetch', {
    declared: [],
    grants: [grant('network.fetch', { scope: origin('https://api.example.com') })],
    scope: origin('https://api.example.com')
  })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.reason, 'not-declared')
})

test('a profile-level block outranks a user grant', () => {
  // A user cannot consent their way past a rule set for the whole profile.
  const decision = ask('clipboard.write', { grants: [grant('clipboard.write')], blocked: ['clipboard.write'] })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.reason, 'blocked-by-policy')
})

// ---------------------------------------------------------------- unavailable is not denied

test('something the computer cannot do is unavailable, not denied', () => {
  const decision = ask('device.camera', { unavailable: ['device.camera'] })
  assert.equal(decision.outcome, 'unavailable')
  assert.equal(decision.reason, 'not-available-here')
  // The two states send people to different places, so they must not be shown as one.
  assert.notEqual(decision.outcome, 'deny')
})

// ---------------------------------------------------------------- automatic grants

test('local arithmetic needs no permission', () => {
  const decision = ask('computation.arithmetic')
  assert.equal(decision.outcome, 'allow')
  assert.equal(decision.reason, 'automatic')
})

test('a Page can always save its own work', () => {
  assert.equal(ask('storage.page').outcome, 'allow')
})

test('an automatic capability is still denied when policy blocks it', () => {
  assert.equal(ask('computation.arithmetic', { blocked: ['computation.arithmetic'] }).outcome, 'deny')
})

// ---------------------------------------------------------------- prompting

test('a capability that reaches outside the Page asks, rather than being assumed', () => {
  const decision = ask('clipboard.write')
  assert.equal(decision.outcome, 'prompt')
  assert.equal(decision.reason, 'needs-user')
})

test('a granted capability is allowed', () => {
  const decision = ask('clipboard.write', { grants: [grant('clipboard.write')] })
  assert.equal(decision.outcome, 'allow')
  assert.equal(decision.reason, 'granted')
})

test('a standing grant is not enough for something that must be asked every time', () => {
  // A standing grant to read the clipboard reads everything copied afterwards, including a password.
  const decision = ask('clipboard.read', { grants: [grant('clipboard.read')] })
  assert.equal(decision.outcome, 'prompt')
  assert.equal(CAPABILITIES['clipboard.read'].consent, 'prompt-every-time')
})

// ---------------------------------------------------------------- expiry and revocation

test('an expired grant is denied, and says it lapsed', () => {
  const decision = ask('clipboard.write', { grants: [grant('clipboard.write', { expiresAt: NOW - 1 })] })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.reason, 'grant-expired')
})

test('a revoked grant is denied, and says it was withdrawn', () => {
  const decision = ask('clipboard.write', { grants: [grant('clipboard.write', { state: 'revoked' })] })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.reason, 'grant-revoked')
})

test('a grant that has not started yet is not live', () => {
  assert.equal(grantIsLive(grant('clipboard.write', { grantedAt: NOW + 1000 }), NOW), false)
})

test('a malformed grant is not live, because it cannot be trusted to be narrow', () => {
  assert.equal(grantIsLive({ ...grant('clipboard.write'), grantedAt: Number.NaN }, NOW), false)
  assert.equal(grantIsLive({ ...grant('clipboard.write'), expiresAt: Number.NaN }, NOW), false)
  assert.equal(grantIsLive({ ...grant('clipboard.write'), capabilityId: 'system.secrets' }, NOW), false)
  assert.equal(grantIsLive(null as unknown as PermissionGrant, NOW), false)
})

test('a grant for a different Page is not this Page\'s grant', () => {
  const decision = ask('clipboard.write', { grants: [grant('clipboard.write', { pageId: 'page_someoneelse00' })] })
  assert.equal(decision.outcome, 'prompt', 'should be as if no grant exists')
})

// ---------------------------------------------------------------- version changes

test('a grant belongs to the version of the Page that asked for it', () => {
  // Page code that changed is code nobody has agreed to.
  const decision = ask('clipboard.write', {
    pageVersion: '2.0.0',
    grants: [grant('clipboard.write', { pageVersion: '1.0.0' })]
  })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.reason, 'page-version-changed')
})

test('an update that asks for more needs looking at', () => {
  const change = capabilityChanges(['computation.arithmetic'], ['computation.arithmetic', 'files.export'])
  assert.deepEqual(change.added, ['files.export'])
  assert.equal(change.needsReview, true)
  assert.equal(change.highestAdded, 'medium')
  assert.match(change.describe, /asks for/)
})

test('an update that gives something up needs no review', () => {
  const change = capabilityChanges(['computation.arithmetic', 'network.fetch'], ['computation.arithmetic'])
  assert.deepEqual(change.removed, ['network.fetch'])
  assert.equal(change.needsReview, false)
})

test('an update adding something unknown is treated as the worst case, not the best', () => {
  const change = capabilityChanges([], ['not.a.real.capability'])
  assert.equal(change.highestAdded, 'critical')
  assert.equal(change.needsReview, true)
})

test('an update adding only an automatic capability needs no review', () => {
  const change = capabilityChanges(['storage.page'], ['storage.page', 'computation.units'])
  assert.equal(change.needsReview, false)
})

// ---------------------------------------------------------------- dependencies

test('a capability with an unmet dependency is denied, and says which', () => {
  const decision = ask('browser.control', {
    declared: ['browser.control'],
    scope: origin('https://example.com')
  })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.reason, 'dependency-missing')
  assert.deepEqual(decision.blockedBy, ['browser.read-page'])
})

test('a dependency being granted does not grant the dependent', () => {
  const decision = ask('network.stream', {
    declared: ['network.stream', 'network.fetch'],
    grants: [grant('network.fetch', { scope: origin('https://api.example.com') })],
    scope: origin('https://api.example.com')
  })
  // network.fetch is satisfied, so this is about the stream itself -- which still has to be asked for.
  assert.equal(decision.outcome, 'prompt')
  assert.deepEqual(decision.blockedBy, [])
})

test('a dependent being granted does not grant the dependency', () => {
  const decision = ask('network.fetch', {
    declared: ['network.fetch', 'network.stream'],
    grants: [grant('network.stream', { scope: origin('https://api.example.com') })],
    scope: origin('https://api.example.com')
  })
  assert.equal(decision.outcome, 'prompt')
})

test('both halves granted allows the dependent', () => {
  const scope = origin('https://api.example.com')
  const decision = ask('network.stream', {
    declared: ['network.stream', 'network.fetch'],
    grants: [grant('network.fetch', { scope }), grant('network.stream', { scope })],
    scope
  })
  assert.equal(decision.outcome, 'allow')
})

// ---------------------------------------------------------------- origin scopes

test('an origin scope is read strictly', () => {
  assert.deepEqual(originScope('https://api.example.com'), {
    kind: 'origin',
    scheme: 'https',
    host: 'api.example.com',
    port: null,
    subdomains: false
  })
  assert.equal(origin('https://api.example.com:8443').port, 8443)
  assert.equal(origin('https://*.example.com').subdomains, true)
  assert.equal(origin('http://localhost:3000').host, 'localhost')
})

test('a scope that could leak or could mean anything is refused', () => {
  for (const bad of [
    '',
    'example.com',
    'ftp://example.com',
    'https://',
    'https://user:pass@example.com',
    'http://example.com',
    'https://*.com',
    'https://*.localhost',
    'https://ex*ample.com',
    'https://example.com:99999',
    `https://${'a'.repeat(600)}.com`
  ]) {
    assert.equal(originScope(bad), null, `"${bad}" should not be a usable scope`)
  }
})

test('an origin grant is matched label by label, not by prefix', () => {
  const granted = origin('https://api.example.com')
  assert.equal(originScopeCovers(granted, origin('https://api.example.com')), true)
  // The bug this function exists to not have.
  assert.equal(originScopeCovers(granted, origin('https://api.example.com.evil.test')), false)
  assert.equal(originScopeCovers(granted, origin('https://notapi.example.com')), false)
  assert.equal(originScopeCovers(granted, origin('https://example.com')), false)
})

test('a wildcard covers whole subdomain labels and nothing else', () => {
  const granted = origin('https://*.example.com')
  assert.equal(originScopeCovers(granted, origin('https://api.example.com')), true)
  assert.equal(originScopeCovers(granted, origin('https://a.b.example.com')), true)
  assert.equal(originScopeCovers(granted, origin('https://example.com')), false, 'the bare domain is not a subdomain of itself')
  assert.equal(originScopeCovers(granted, origin('https://notexample.com')), false)
  assert.equal(originScopeCovers(granted, origin('https://example.com.evil.test')), false)
})

test('scheme and port are part of the origin', () => {
  assert.equal(originScopeCovers(origin('https://example.com'), origin('https://example.com:443')), true, 'the default port is the same port')
  assert.equal(originScopeCovers(origin('https://example.com:8443'), origin('https://example.com')), false)
  assert.equal(originScopeCovers(origin('http://localhost'), origin('http://localhost:80')), true)
})

test('a request outside the granted origin is denied, and says so specifically', () => {
  const decision = ask('network.fetch', {
    grants: [grant('network.fetch', { scope: origin('https://api.example.com') })],
    scope: origin('https://evil.test')
  })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.reason, 'scope-not-granted')
  assert.match(decision.message, /evil.test/)
})

test('a scoped capability asked for without a scope is denied rather than treated as all of them', () => {
  const decision = ask('network.fetch', { grants: [grant('network.fetch', { scope: origin('https://api.example.com') })] })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.reason, 'scope-unreadable')
})

// ---------------------------------------------------------------- path scopes

test('a path grant covers what is under it and nothing beside it', () => {
  const granted = { kind: 'path' as const, path: '/home/ana/docs', recursive: true }
  assert.equal(pathScopeCovers(granted, { kind: 'path', path: '/home/ana/docs', recursive: false }), true)
  assert.equal(pathScopeCovers(granted, { kind: 'path', path: '/home/ana/docs/a/b.csv', recursive: false }), true)
  // Whole segments: a sibling whose name starts the same way is not inside.
  assert.equal(pathScopeCovers(granted, { kind: 'path', path: '/home/ana/documents-private', recursive: false }), false)
  assert.equal(pathScopeCovers(granted, { kind: 'path', path: '/home/ana', recursive: false }), false)
  assert.equal(pathScopeCovers(granted, { kind: 'path', path: '/etc/passwd', recursive: false }), false)
})

test('a non-recursive path grant covers only itself', () => {
  const granted = { kind: 'path' as const, path: '/home/ana/one.csv', recursive: false }
  assert.equal(pathScopeCovers(granted, { kind: 'path', path: '/home/ana/one.csv', recursive: false }), true)
  assert.equal(pathScopeCovers(granted, { kind: 'path', path: '/home/ana/one.csv/x', recursive: false }), false)
})

test('an unresolved path is never authorised', () => {
  // A relative part means the string was never resolved, and authorising one string while fetching another is the bug.
  const granted = { kind: 'path' as const, path: '/home/ana/docs', recursive: true }
  assert.equal(pathScopeCovers(granted, { kind: 'path', path: '/home/ana/docs/../../etc', recursive: false }), false)
  assert.equal(pathScopeCovers({ kind: 'path', path: '/home/../etc', recursive: true }, { kind: 'path', path: '/etc', recursive: false }), false)
})

test('scopes of different kinds never match', () => {
  const asOrigin: Scope = origin('https://example.com')
  const asPath: Scope = { kind: 'path', path: '/tmp', recursive: true }
  assert.equal(scopeCovers(asOrigin, asPath), false)
  assert.equal(scopeCovers(asPath, asOrigin), false)
  assert.equal(scopeCovers(NO_SCOPE, NO_SCOPE), true)
})

test('a page scope matches one Page and not another', () => {
  assert.equal(scopeCovers({ kind: 'page', pageId: 'page_a' }, { kind: 'page', pageId: 'page_a' }), true)
  assert.equal(scopeCovers({ kind: 'page', pageId: 'page_a' }, { kind: 'page', pageId: 'page_b' }), false)
})

test('a scope describes itself for a prompt', () => {
  assert.equal(describeScope(origin('https://api.example.com')), 'api.example.com')
  assert.equal(describeScope(origin('https://*.example.com')), '*.example.com')
  assert.equal(describeScope(origin('https://example.com:8443')), 'example.com:8443')
  assert.equal(describeScope({ kind: 'path', path: '/tmp/x', recursive: true }), '/tmp/x and everything in it')
  assert.equal(describeScope(NO_SCOPE), '')
})

// ---------------------------------------------------------------- trust

test('a Page from outside Orbis cannot reach far, however it is declared', () => {
  for (const trust of ['imported', 'generated', 'unknown'] as const) {
    const decision = ask('browser.read-page', { trust })
    assert.equal(decision.outcome, 'deny', trust)
    assert.equal(decision.reason, 'trust-too-low', trust)
  }
})

test('trust changes the default, never the ceiling', () => {
  // A system Page still cannot have something forbidden.
  assert.equal(ask('system.secrets', { declared: ['system.secrets'], trust: 'system' }).reason, 'forbidden-capability')
  // And an imported Page can still do arithmetic.
  assert.equal(ask('computation.arithmetic', { trust: 'imported' }).outcome, 'allow')
})

test('a user-made Page may be asked about a high-risk capability', () => {
  assert.equal(ask('browser.read-page', { trust: 'user' }).outcome, 'prompt')
})

// ---------------------------------------------------------------- handles

test('a handle is only issued for an allowed decision', () => {
  const allowed = ask('computation.arithmetic')
  const input: DecideInput = {
    capabilityId: 'computation.arithmetic',
    pageId: PAGE,
    pageVersion: VERSION,
    trust: 'user',
    declared: ['computation.arithmetic'],
    grants: [],
    now: NOW
  }
  assert.notEqual(issueHandle(allowed, input, 'a'.repeat(32)), null)
  assert.equal(issueHandle({ ...allowed, outcome: 'deny' }, input, 'a'.repeat(32)), null)
  // A guessable nonce is not a nonce.
  assert.equal(issueHandle(allowed, input, 'short'), null)
})

test('a handle stops working when the permission behind it is withdrawn', () => {
  const base = {
    pageId: PAGE,
    pageVersion: VERSION,
    trust: 'user' as const,
    declared: ['clipboard.write'],
    grants: [grant('clipboard.write')],
    now: NOW
  }
  const allowed = decide({ ...base, capabilityId: 'clipboard.write', scope: NO_SCOPE })
  const handle = issueHandle(allowed, { ...base, capabilityId: 'clipboard.write' }, 'n'.repeat(32))
  assert.notEqual(handle, null)
  assert.equal(handleIsValid(handle!, base), true)
  // Revoking the grant invalidates the handle without having to find it, which is the point of re-checking.
  assert.equal(handleIsValid(handle!, { ...base, grants: [grant('clipboard.write', { state: 'revoked' })] }), false)
})

test('a handle expires', () => {
  const base = {
    pageId: PAGE,
    pageVersion: VERSION,
    trust: 'user' as const,
    declared: ['clipboard.write'],
    grants: [grant('clipboard.write')],
    now: NOW
  }
  const handle = issueHandle(decide({ ...base, capabilityId: 'clipboard.write' }), { ...base, capabilityId: 'clipboard.write' }, 'n'.repeat(32))!
  assert.equal(handleIsValid(handle, { ...base, now: NOW + HANDLE_LIFETIME_MS + 1 }), false)
})

test('a handle belongs to one Page and one version of it', () => {
  const base = {
    pageId: PAGE,
    pageVersion: VERSION,
    trust: 'user' as const,
    declared: ['clipboard.write'],
    grants: [grant('clipboard.write')],
    now: NOW
  }
  const handle = issueHandle(decide({ ...base, capabilityId: 'clipboard.write' }), { ...base, capabilityId: 'clipboard.write' }, 'n'.repeat(32))!
  assert.equal(handleIsValid(handle, { ...base, pageId: 'page_someoneelse00' }), false)
  assert.equal(handleIsValid(handle, { ...base, pageVersion: '2.0.0' }), false)
})

// ---------------------------------------------------------------- declarations

test('a declaration naming something unknown is refused rather than ignored', () => {
  const problems = checkDeclarations(['computation.arithmetic', 'made.up'])
  assert.equal(problems.length, 1)
  assert.equal(problems[0].error, 'unknown')
})

test('a declaration naming something forbidden is refused', () => {
  assert.equal(checkDeclarations(['system.secrets'])[0].error, 'forbidden')
})

test('a declaration repeated is refused, because two entries could differ', () => {
  assert.equal(checkDeclarations(['storage.page', 'storage.page'])[0].error, 'duplicate')
})

test('a capability that has to justify itself cannot be declared without a reason', () => {
  const without = checkDeclarations(['network.fetch'])
  assert.equal(without[0].error, 'missing-reason')
  const withReason = checkDeclarations(['network.fetch'], { 'network.fetch': 'Fetches live exchange rates.' })
  assert.deepEqual(withReason, [])
  // A reason that says nothing is not a reason.
  assert.equal(checkDeclarations(['network.fetch'], { 'network.fetch': 'stuff' })[0].error, 'missing-reason')
})

test('a dependency must be declared too, so the review shows everything', () => {
  const problems = checkDeclarations(['browser.control'], { 'browser.control': 'Fills in the form for you.' })
  assert.ok(problems.some((one) => one.error === 'missing-dependency'))
  const complete = checkDeclarations(['browser.control', 'browser.read-page'], {
    'browser.control': 'Fills in the form for you.',
    'browser.read-page': 'Reads the form before filling it.'
  })
  assert.deepEqual(complete, [])
})

test('a clean declaration has no problems', () => {
  assert.deepEqual(checkDeclarations(['computation.arithmetic', 'computation.units', 'storage.page']), [])
})

// ---------------------------------------------------------------- the permission list

test('the permission list shows what is true, not what was asked for', () => {
  const summary = permissionSummary({
    pageId: PAGE,
    pageVersion: VERSION,
    trust: 'user',
    declared: ['computation.arithmetic', 'clipboard.write', 'network.fetch'],
    grants: [grant('clipboard.write')],
    now: NOW
  })
  const byId = new Map(summary.map((one) => [one.capabilityId, one]))
  assert.equal(byId.get('computation.arithmetic')?.outcome, 'allow')
  assert.equal(byId.get('clipboard.write')?.outcome, 'allow')
  // Declared but never granted, so it is not allowed -- which a list built from the manifest would get wrong.
  assert.notEqual(byId.get('network.fetch')?.outcome, 'allow')
})

test('the permission list puts the riskiest first', () => {
  const summary = permissionSummary({
    pageId: PAGE,
    pageVersion: VERSION,
    trust: 'user',
    declared: ['computation.arithmetic', 'device.camera', 'clipboard.write'],
    grants: [],
    now: NOW
  })
  assert.equal(summary[0].capabilityId, 'device.camera')
  assert.equal(summary[summary.length - 1].capabilityId, 'computation.arithmetic')
})

test('a capability name that Object.prototype answers for is not a capability', () => {
  // Plain indexing would return the Object constructor here and answer "yes, that exists".
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(capabilityById(name), null, name)
    assert.equal(isGrantableCapability(name), false, name)
    const decision = ask(name, { declared: [name] })
    assert.equal(decision.outcome, 'deny', name)
    assert.equal(decision.reason, 'unknown-capability', name)
  }
})

test('a reason inherited from Object.prototype is not a reason', () => {
  // `reasons['constructor']` on a plain object is a function, and a function is not somebody explaining why they need
  // the network.
  const problems = checkDeclarations(['network.fetch'], {} as Record<string, string>)
  assert.equal(problems[0]?.error, 'missing-reason')
})
