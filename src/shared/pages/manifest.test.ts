import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePageId, versionToText } from './identity.ts'
import {
  blankManifest,
  checkCategory,
  checkTag,
  compatibility,
  describeRequests,
  LIMITS,
  MANIFEST_SCHEMA_VERSION,
  manifestErrors,
  manifestIsValid,
  manifestToJson,
  PAGE_RUNTIME_VERSION,
  readManifest,
  searchMetadataChanged,
  validateManifest,
  type PageManifest
} from './manifest.ts'

const ID = makePageId('abcdef1234567890ab')

/** A manifest that validates, so a test can break exactly one thing. */
const good = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  pageId: ID,
  slug: 'projectile-motion',
  title: 'Projectile Motion Laboratory',
  description: 'Work out the path of a projectile from its launch speed, angle and the gravity acting on it.',
  version: '1.0.0',
  kind: 'laboratory',
  categories: ['science.physics.mechanics'],
  tags: ['physics', 'kinematics'],
  icon: 'flask',
  owner: 'system',
  runtimeAtLeast: '1.0.0',
  capabilities: ['computation.arithmetic', 'computation.units', 'storage.page'],
  capabilityReasons: {},
  dependencies: [],
  search: {
    summary: 'Interactive laboratory for projectile motion, trajectory, range and maximum height.',
    keywords: ['projectile', 'trajectory', 'kinematics'],
    intents: ['calculate', 'simulate'],
    aliases: ['Projectile Lab']
  },
  offline: true,
  limitations: ['Assumes constant gravity and no air resistance.'],
  languages: ['en'],
  ...patch
})

const codes = (raw: unknown): string[] => validateManifest(raw).map((one) => one.code)
const errorCodes = (raw: unknown): string[] => manifestErrors(validateManifest(raw)).map((one) => one.code)

const read = (raw: unknown): PageManifest => {
  const result = readManifest(raw)
  assert.ok('manifest' in result, `should have validated: ${JSON.stringify((result as { problems: unknown }).problems)}`)
  return (result as { manifest: PageManifest }).manifest
}

// ---------------------------------------------------------------- the happy case

test('a complete manifest validates', () => {
  assert.deepEqual(validateManifest(good()), [])
  assert.equal(manifestIsValid(good()), true)
})

test('reading a manifest normalises it without changing what it means', () => {
  const manifest = read(
    good({
      title: '  Projectile Motion Laboratory  ',
      tags: ['Kinematics', 'physics', 'physics-x'],
      categories: ['z.later', 'a.earlier'],
      capabilities: ['storage.page', 'computation.arithmetic', 'computation.units']
    })
  )
  assert.equal(manifest.title, 'Projectile Motion Laboratory')
  // Lower-cased and sorted, so the same tags in a different order are the same manifest.
  assert.deepEqual(manifest.tags, ['kinematics', 'physics', 'physics-x'])
  assert.deepEqual(manifest.categories, ['a.earlier', 'z.later'])
  assert.deepEqual(manifest.capabilities, ['computation.arithmetic', 'computation.units', 'storage.page'])
})

test('a manifest survives the round trip to JSON and back', () => {
  const first = read(good())
  const again = read(manifestToJson(first))
  assert.deepEqual(again, first)
})

test('a blank manifest is valid as it stands', () => {
  const manifest = blankManifest({ pageId: ID, slug: 'my-page', title: 'My Page' })
  // Warnings are expected -- a brand-new Page has no categories and no summary yet. Nothing stops it running.
  assert.deepEqual(manifestErrors(validateManifest(manifestToJson(manifest))), [])
  assert.ok(validateManifest(manifestToJson(manifest)).every((one) => one.severity === 'warning'))
  // And asks for nothing but what a Page cannot work without.
  assert.deepEqual(manifest.capabilities, ['computation.arithmetic', 'storage.page'])
  assert.equal(manifest.offline, true)
})

// ---------------------------------------------------------------- it is untrusted input

test('something that is not an object is not a manifest', () => {
  for (const bad of [null, undefined, 42, 'manifest', [], true]) {
    assert.deepEqual(codes(bad), ['not-an-object'], JSON.stringify(bad))
  }
})

test('a manifest has to say which schema it is, and a newer one is refused', () => {
  assert.ok(errorCodes(good({ schemaVersion: undefined })).includes('bad-schema-version'))
  assert.ok(errorCodes(good({ schemaVersion: 'one' })).includes('bad-schema-version'))
  assert.ok(errorCodes(good({ schemaVersion: MANIFEST_SCHEMA_VERSION + 1 })).includes('schema-too-new'))
  // An older schema is a migration, not a validation failure, and is named differently so the caller can route it.
  assert.ok(errorCodes(good({ schemaVersion: 0 })).includes('schema-needs-migration'))
})

test('an id a Page made up for itself is refused', () => {
  assert.ok(errorCodes(good({ pageId: 'projectile-motion' })).includes('bad-page-id'))
  assert.ok(errorCodes(good({ pageId: '' })).includes('bad-page-id'))
  assert.ok(errorCodes(good({ pageId: undefined })).includes('bad-page-id'))
})

test('an unusable address is refused rather than repaired', () => {
  for (const slug of ['Projectile', 'a b', '../x', 'settings', '']) {
    assert.ok(errorCodes(good({ slug })).includes('bad-slug'), `"${slug}" should be refused`)
  }
})

test('a Page without a name or a description does not validate', () => {
  assert.ok(errorCodes(good({ title: '' })).includes('no-title'))
  assert.ok(errorCodes(good({ title: '   ' })).includes('no-title'))
  assert.ok(errorCodes(good({ description: 'short' })).includes('no-description'))
  // Not a warning: a Page with no description cannot be told apart from another in a list.
  assert.ok(errorCodes(good({ description: undefined })).includes('no-description'))
})

test('every text field is capped, so a generated manifest cannot become a wall of text', () => {
  assert.ok(errorCodes(good({ title: 'a'.repeat(LIMITS.title + 1) })).includes('title-too-long'))
  assert.ok(errorCodes(good({ description: 'a'.repeat(LIMITS.description + 1) })).includes('description-too-long'))
  assert.ok(errorCodes(good({ tags: Array.from({ length: LIMITS.tags + 1 }, (_, i) => `tag-${i}`) })).includes('too-many-tags'))
  assert.ok(
    errorCodes(good({ categories: Array.from({ length: LIMITS.categories + 1 }, (_, i) => `c${i}.x`) })).includes('too-many-categories')
  )
})

// ---------------------------------------------------------------- versions

test('a Page version has to be three numbers', () => {
  for (const version of ['1', '1.2', 'v1.0.0', '', undefined]) {
    assert.ok(errorCodes(good({ version })).includes('bad-version'), `${version} should be refused`)
  }
})

test('a Page written for a newer runtime is refused rather than attempted', () => {
  const newer = `${PAGE_RUNTIME_VERSION.major + 1}.0.0`
  assert.ok(errorCodes(good({ runtimeAtLeast: newer })).includes('runtime-too-old'))
  assert.ok(errorCodes(good({ runtimeAtLeast: undefined })).includes('bad-runtime-version'))
})

// ---------------------------------------------------------------- categories and tags

test('a category is a lower-case dotted path, so two spellings cannot become two categories', () => {
  assert.equal(checkCategory('science.physics.mechanics'), null)
  assert.equal(checkCategory('computer-science.algorithms'), null)
  for (const bad of ['', 'Science', 'science..physics', '.science', 'science.', 'science physics', 'a'.repeat(200)]) {
    assert.notEqual(checkCategory(bad), null, `"${bad}" should be refused`)
  }
  // No fixed depth: a subject needing four levels should not require a change here.
  assert.equal(checkCategory('a.b.c.d.e'), null)
})

test('a tag is lower-case words joined by single dashes', () => {
  assert.equal(checkTag('data-analysis'), null)
  for (const bad of ['', 'a b', 'a--b', '-a', 'a-', 'a_b', 'a.b']) assert.notEqual(checkTag(bad), null, `"${bad}"`)
  // Capitals are accepted and lower-cased on the way in, unlike a category -- see the note on checkTag.
  assert.equal(checkTag('Kinematics'), null)
  assert.notEqual(checkCategory('Science'), null)
})

test('a repeated category or tag is refused', () => {
  assert.ok(errorCodes(good({ tags: ['physics', 'physics'] })).includes('duplicate-tag'))
  // And case-insensitively, so one is never dropped in silence.
  assert.ok(errorCodes(good({ tags: ['Physics', 'physics'] })).includes('duplicate-tag'))
  assert.ok(errorCodes(good({ categories: ['a.b', 'a.b'] })).includes('duplicate-category'))
})

test('a Page with no category is a warning, not a refusal', () => {
  const problems = validateManifest(good({ categories: [] }))
  assert.equal(manifestErrors(problems).length, 0)
  assert.ok(problems.some((one) => one.code === 'no-categories' && one.severity === 'warning'))
})

// ---------------------------------------------------------------- capabilities

test('a capability the registry does not know is refused', () => {
  assert.ok(errorCodes(good({ capabilities: ['computation.arithmetic', 'made.up'] })).includes('capability-unknown'))
})

test('a capability Pages never get is refused however it is declared', () => {
  assert.ok(errorCodes(good({ capabilities: ['system.secrets'] })).includes('capability-forbidden'))
})

test('a capability that has to justify itself needs a reason in the manifest', () => {
  const without = errorCodes(good({ capabilities: ['computation.arithmetic', 'network.fetch'], offline: false }))
  assert.ok(without.includes('capability-missing-reason'))
  const withReason = validateManifest(
    good({
      capabilities: ['computation.arithmetic', 'network.fetch'],
      capabilityReasons: { 'network.fetch': 'Fetches live exchange rates from the provider.' },
      offline: false
    })
  )
  assert.deepEqual(manifestErrors(withReason), [])
})

test('a reason for something undeclared is a warning that the two lists have drifted', () => {
  const problems = validateManifest(good({ capabilityReasons: { 'network.fetch': 'Something it does not declare.' } }))
  assert.equal(manifestErrors(problems).length, 0)
  assert.ok(problems.some((one) => one.code === 'orphan-reason'))
})

test('a dependency between capabilities has to be declared too', () => {
  const problems = errorCodes(
    good({
      capabilities: ['browser.control'],
      capabilityReasons: { 'browser.control': 'Fills in the form on your behalf.' },
      offline: false
    })
  )
  assert.ok(problems.includes('capability-missing-dependency'))
})

test('a manifest that says it works offline and asks for the network does not validate', () => {
  // Two statements that cannot both be true, and the combination misleads exactly the person on a train.
  const problems = errorCodes(
    good({
      offline: true,
      capabilities: ['computation.arithmetic', 'network.fetch'],
      capabilityReasons: { 'network.fetch': 'Fetches live data from the provider.' }
    })
  )
  assert.ok(problems.includes('offline-contradiction'))
})

// ---------------------------------------------------------------- search metadata

test('keyword stuffing is refused rather than quietly ranked down', () => {
  // Ranking it down would be invisible to whoever wrote it, so it would keep happening.
  assert.ok(errorCodes(good({ search: { ...(good().search as object), keywords: ['physics', 'physics'] } })).includes('duplicate-keywords'))
  assert.ok(
    errorCodes(
      good({ search: { ...(good().search as object), keywords: Array.from({ length: LIMITS.keywords + 1 }, (_, i) => `k${i}`) } })
    ).includes('too-many-keywords')
  )
})

test('a missing summary is a warning, because the Page still works', () => {
  const problems = validateManifest(good({ search: { summary: '', keywords: [], intents: [], aliases: [] } }))
  assert.equal(manifestErrors(problems).length, 0)
  assert.ok(problems.some((one) => one.code === 'no-summary'))
})

test('search metadata has to be there in some form', () => {
  assert.ok(errorCodes(good({ search: undefined })).includes('bad-search'))
  assert.ok(errorCodes(good({ search: { summary: 'x'.repeat(20), keywords: 'not-a-list', intents: [], aliases: [] } })).includes('bad-keywords'))
})

// ---------------------------------------------------------------- dependencies

test('a dependency needs an id and a version', () => {
  assert.ok(errorCodes(good({ dependencies: [{ id: 'orbis.graphing' }] })).includes('bad-dependency-version'))
  assert.ok(errorCodes(good({ dependencies: [{ atLeast: '1.0.0' }] })).includes('bad-dependency-id'))
  assert.ok(errorCodes(good({ dependencies: ['orbis.graphing'] })).includes('bad-dependency'))
  assert.deepEqual(manifestErrors(validateManifest(good({ dependencies: [{ id: 'orbis.graphing', atLeast: '2.0.0' }] }))), [])
})

// ---------------------------------------------------------------- languages

test('a Page has to say which language its text is in', () => {
  assert.ok(errorCodes(good({ languages: [] })).includes('no-languages'))
  assert.ok(errorCodes(good({ languages: ['english'] })).includes('bad-language'))
  assert.deepEqual(manifestErrors(validateManifest(good({ languages: ['en', 'ta', 'pt-BR'] }))), [])
})

// ---------------------------------------------------------------- compatibility

test('a compatible Page can open', () => {
  const result = compatibility(read(good()), {})
  assert.equal(result.state, 'compatible')
  assert.equal(result.canOpen, true)
})

test('a Page needing a newer runtime cannot open, and says what it needs', () => {
  const manifest = { ...read(good()), runtimeAtLeast: { major: 9, minor: 0, patch: 0 } }
  const result = compatibility(manifest, {})
  assert.equal(result.state, 'runtime-too-old')
  assert.equal(result.canOpen, false)
  assert.match(result.message, /9\.0\.0/)
})

test('a missing required dependency stops the Page rather than half-running it', () => {
  const manifest = {
    ...read(good()),
    dependencies: [{ id: 'orbis.graphing', atLeast: { major: 2, minor: 0, patch: 0 }, optional: false }]
  }
  const result = compatibility(manifest, {})
  assert.equal(result.state, 'dependency-missing')
  assert.equal(result.canOpen, false)
  assert.deepEqual(result.missing, ['orbis.graphing'])
})

test('a dependency that is present but too old is still missing', () => {
  const manifest = {
    ...read(good()),
    dependencies: [{ id: 'orbis.graphing', atLeast: { major: 2, minor: 0, patch: 0 }, optional: false }]
  }
  const result = compatibility(manifest, { 'orbis.graphing': { major: 1, minor: 9, patch: 0 } })
  assert.equal(result.canOpen, false)
})

test('a missing optional dependency degrades the Page rather than stopping it', () => {
  const manifest = {
    ...read(good()),
    dependencies: [{ id: 'orbis.fancy', atLeast: { major: 1, minor: 0, patch: 0 }, optional: true }]
  }
  const result = compatibility(manifest, {})
  assert.equal(result.canOpen, true)
  assert.deepEqual(result.degraded, ['orbis.fancy'])
  assert.match(result.message, /without orbis.fancy/)
})

test('an older manifest schema needs migrating rather than opening', () => {
  const manifest = { ...read(good()), schemaVersion: 0 }
  assert.equal(compatibility(manifest, {}).state, 'needs-migration')
})

// ---------------------------------------------------------------- the review

test('what a Page asks for is described from the registry, riskiest first', () => {
  const manifest = read(
    good({
      capabilities: ['computation.arithmetic', 'clipboard.write', 'device.camera'],
      capabilityReasons: { 'device.camera': 'Measures the swing of a pendulum from your camera.' },
      offline: true
    })
  )
  const requests = describeRequests(manifest)
  assert.equal(requests[0].risk, 'high')
  assert.equal(requests[requests.length - 1].risk, 'low')
  // The Page's own words for the reason, but the registry's word for the risk -- so a Page cannot make it sound smaller.
  assert.match(requests[0].reason, /pendulum/)
  assert.equal(requests[0].name, 'Use the camera')
})

// ---------------------------------------------------------------- re-indexing

test('a change search cares about is detected, and one it does not is not', () => {
  const before = read(good())
  assert.equal(searchMetadataChanged(before, before), false)
  assert.equal(searchMetadataChanged(before, { ...before, title: 'Something Else' }), true)
  assert.equal(searchMetadataChanged(before, { ...before, tags: ['other'] }), true)
  // Bumping the version alone does not change how the Page is found.
  assert.equal(searchMetadataChanged(before, { ...before, version: { major: 2, minor: 0, patch: 0 } }), false)
  assert.equal(searchMetadataChanged(before, { ...before, limitations: ['Something new.'] }), false)
})

test('a version writes back the way it was read', () => {
  assert.equal(versionToText(read(good({ version: '2.10.3' })).version), '2.10.3')
})
