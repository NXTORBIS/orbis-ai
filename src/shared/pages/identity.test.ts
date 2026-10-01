import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalPageAddress,
  checkSlug,
  compareVersions,
  isAddressProblem,
  isPageAddress,
  isPageId,
  isUsableSlug,
  makePageId,
  MAX_SLUG_LENGTH,
  normalisePageAddress,
  PAGES_ROOT,
  pageAddress,
  pageIdentity,
  parsePageAddress,
  parseVersion,
  RESERVED_SLUGS,
  sameIdentity,
  samePage,
  sameVersion,
  slugify,
  uniqueSlug,
  versionToText,
  type PageAddress
} from './identity.ts'

const address = (url: string): PageAddress => {
  const parsed = parsePageAddress(url)
  assert.equal(isAddressProblem(parsed), false, `could not read "${url}": ${JSON.stringify(parsed)}`)
  return parsed as PageAddress
}

const refused = (url: string, why?: string): string => {
  const parsed = parsePageAddress(url)
  assert.equal(isAddressProblem(parsed), true, `"${url}" should have been refused`)
  const error = (parsed as { error: string }).error
  if (why) assert.equal(error, why, `"${url}" was refused as ${error}, expected ${why}`)
  return error
}

// ---------------------------------------------------------------- ids

test('a Page id is opaque, and nothing can be read out of it', () => {
  const id = makePageId('a1b2c3d4e5f6a7b8')
  assert.ok(isPageId(id))
  assert.ok(id.startsWith('page_'))
  // Deliberately not derived from anything: two Pages with the same title must not get the same id.
  assert.notEqual(makePageId('0123456789abcdef'), id)
})

test('an id needs enough characters to be worth calling unique', () => {
  // This cannot tell randomness from a word -- only the caller knows where the string came from, which is why the
  // generator is passed in. What it can do is refuse something too short to be unique at all.
  assert.throws(() => makePageId('short'), /12 usable characters/)
  assert.throws(() => makePageId('a-b-c'), /12 usable characters/)
  // And an id is capped, so a caller handing over a very long string does not produce an unbounded identifier.
  assert.ok(makePageId('f'.repeat(200)).length <= 'page_'.length + 32)
})

test('anything that is not an id is rejected as one', () => {
  for (const bad of ['', 'page_', 'page_short', 'projectile-motion', 'PAGE_abcdefghijkl', 'page_abcdefghijk!', null, 42]) {
    assert.equal(isPageId(bad as string), false, `${JSON.stringify(bad)} should not be an id`)
  }
})

// ---------------------------------------------------------------- slugs

test('a title becomes a predictable address', () => {
  assert.equal(slugify('Projectile Motion Laboratory'), 'projectile-motion-laboratory')
  assert.equal(slugify('  Spaced   Out  '), 'spaced-out')
  assert.equal(slugify("Newton's Second Law"), 'newtons-second-law')
  assert.equal(slugify('CSV → Analysis'), 'csv-analysis')
  assert.equal(slugify('C++ Compiler Lab'), 'c-compiler-lab')
  // Deterministic: the same title always gives the same address, so a collision is visible rather than random.
  assert.equal(slugify('Physics Lab'), slugify('Physics Lab'))
})

test('accents decompose rather than disappearing', () => {
  assert.equal(slugify('Ångström Explorer'), 'angstrom-explorer')
  assert.equal(slugify('Café Data'), 'cafe-data')
})

test('a title with nothing usable in it produces an empty slug, not a broken one', () => {
  assert.equal(slugify('日本語'), '')
  assert.equal(slugify('!!!'), '')
  // And the caller is expected to fall back, which `uniqueSlug` does.
  assert.equal(uniqueSlug('日本語', []), 'page')
})

test('a slug is checked strictly, because it is part of an address and sometimes a path', () => {
  assert.equal(checkSlug('projectile-motion'), null)
  assert.equal(checkSlug('lab2'), null)
  for (const bad of ['', 'Projectile', 'a b', 'a--b', '-a', 'a-', 'a/b', 'a.b', 'a_b', '../x', 'a%2fb', 'a\\b']) {
    assert.notEqual(checkSlug(bad), null, `"${bad}" should not be a usable address`)
  }
  assert.equal(checkSlug('a'.repeat(MAX_SLUG_LENGTH + 1))?.error, 'too-long')
})

test('Orbis keeps its own addresses under the Pages root', () => {
  for (const reserved of RESERVED_SLUGS) {
    assert.equal(checkSlug(reserved)?.error, 'reserved', `"${reserved}" should be reserved`)
  }
  // And a Page may still use one as part of a longer address.
  assert.equal(isUsableSlug('search-lab'), true)
})

test('a colliding address gets a readable number rather than random characters', () => {
  assert.equal(uniqueSlug('Physics Lab', []), 'physics-lab')
  assert.equal(uniqueSlug('Physics Lab', ['physics-lab']), 'physics-lab-2')
  assert.equal(uniqueSlug('Physics Lab', ['physics-lab', 'physics-lab-2']), 'physics-lab-3')
})

test('a very long title still produces a legal address when it has to be numbered', () => {
  const long = 'a'.repeat(MAX_SLUG_LENGTH)
  const second = uniqueSlug(long, [long])
  assert.ok(second.length <= MAX_SLUG_LENGTH)
  assert.equal(isUsableSlug(second), true)
  assert.notEqual(second, long)
})

// ---------------------------------------------------------------- versions

test('a version reads and writes as three numbers', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 })
  assert.equal(versionToText({ major: 2, minor: 0, patch: 1 }), '2.0.1')
  for (const bad of ['1', '1.2', 'v1.2.3', '1.2.3.4', '1.2.-3', 'a.b.c', '']) {
    assert.equal(parseVersion(bad), null, `"${bad}" should not be a version`)
  }
})

test('versions order the way they should', () => {
  const v = (text: string) => parseVersion(text)!
  assert.ok(compareVersions(v('1.0.0'), v('2.0.0')) < 0)
  assert.ok(compareVersions(v('1.10.0'), v('1.9.0')) > 0, 'ten is after nine, not before it')
  assert.ok(compareVersions(v('1.0.10'), v('1.0.9')) > 0)
  assert.equal(compareVersions(v('1.2.3'), v('1.2.3')), 0)
  assert.equal(sameVersion(v('1.2.3'), v('1.2.3')), true)
})

// ---------------------------------------------------------------- addresses

test('a Page address is recognised, and something merely containing one is not', () => {
  assert.equal(isPageAddress('orbis://pages/lab'), true)
  assert.equal(isPageAddress('orbis://pages'), true)
  assert.equal(isPageAddress('orbis://search?q=pages'), false)
  // A website cannot claim to be a Page address by putting one in its path.
  assert.equal(isPageAddress('https://evil.example/orbis://pages/lab'), false)
})

test('an address separates the Page from the Page\'s own navigation', () => {
  const simple = address('orbis://pages/physics-lab')
  assert.equal(simple.slug, 'physics-lab')
  assert.deepEqual(simple.route, [])
  assert.equal(simple.version, null)

  const deep = address('orbis://pages/physics-lab/experiment/projectile')
  assert.equal(deep.slug, 'physics-lab', 'a route does not make it a different Page')
  assert.deepEqual(deep.route, ['experiment', 'projectile'])
})

test('query parameters are navigation state and never identity', () => {
  const parsed = address('orbis://pages/solver?mode=compare&x=2')
  assert.equal(parsed.slug, 'solver')
  assert.deepEqual(parsed.params, { mode: 'compare', x: '2' })
  // Two addresses differing only in parameters are the same Page.
  assert.equal(samePage('orbis://pages/solver?mode=a', 'orbis://pages/solver?mode=b'), true)
})

test('a repeated parameter keeps the first value, so a second cannot be smuggled past a check on the first', () => {
  assert.deepEqual(address('orbis://pages/lab?mode=safe&mode=unsafe').params, { mode: 'safe' })
})

test('a fragment belongs entirely to the Page', () => {
  assert.equal(address('orbis://pages/lab#results').fragment, 'results')
  assert.equal(address('orbis://pages/lab').fragment, '')
  assert.equal(samePage('orbis://pages/lab#a', 'orbis://pages/lab#b'), true)
})

test('a version can be pinned in the address', () => {
  const pinned = address('orbis://pages/lab@1.4.0')
  assert.equal(pinned.slug, 'lab')
  assert.deepEqual(pinned.version, { major: 1, minor: 4, patch: 0 })
  refused('orbis://pages/lab@notaversion', 'bad-version')
  refused('orbis://pages/lab@1.2', 'bad-version')
})

// ---------------------------------------------------------------- the refusals that are security decisions

test('a relative path in an address is refused rather than resolved', () => {
  // Resolving it would mean authorising one string and fetching another, which is the shape of every traversal bug.
  refused('orbis://pages/../secrets', 'traversal')
  refused('orbis://pages/lab/../../etc', 'traversal')
  refused('orbis://pages/lab/./x', 'traversal')
  refused('orbis://pages/lab/..', 'traversal')
})

test('an encoded separator is refused, because decoding after the check makes the check pointless', () => {
  refused('orbis://pages/lab/%2e%2e/secrets', 'traversal')
  refused('orbis://pages/lab/%2E%2E', 'traversal')
  refused('orbis://pages/lab/a%2fb', 'traversal')
  refused('orbis://pages/lab/a%5cb', 'traversal')
  refused('orbis://pages/lab/a\\b', 'traversal')
})

test('a host is refused, so a website cannot present itself as a Page', () => {
  refused('orbis://evil.example/pages/lab', 'not-a-page-address')
  refused('https://orbis.example/pages/lab', 'not-a-page-address')
  refused('orbis://Pages.evil/lab', 'not-a-page-address')
})

test('an address with no Page in it is refused rather than becoming the library', () => {
  refused('orbis://pages/', 'no-slug')
  refused('orbis://pages', 'no-slug')
  refused('orbis://pages///', 'no-slug')
})

test('an address with an illegal slug is refused, not repaired', () => {
  refused('orbis://pages/Physics', 'bad-slug')
  refused('orbis://pages/a_b', 'bad-slug')
  refused('orbis://pages/settings', 'bad-slug')
})

test('an absurdly long address is refused before it is parsed', () => {
  refused(`orbis://pages/lab/${'a'.repeat(4000)}`, 'too-long')
})

test('a broken escape sequence is refused rather than passed through', () => {
  refused('orbis://pages/lab/%ZZ', 'traversal')
})

// ---------------------------------------------------------------- writing and normalising

test('an address written and read again is the same address', () => {
  const cases: { slug: string; route?: string[]; version?: ReturnType<typeof parseVersion>; params?: Record<string, string>; fragment?: string }[] = [
    { slug: 'lab' },
    { slug: 'lab', route: ['experiment'] },
    { slug: 'lab', route: ['a', 'b', 'c'] },
    { slug: 'lab', version: parseVersion('1.2.3') },
    { slug: 'lab', params: { mode: 'compare' } },
    { slug: 'lab', fragment: 'results' },
    { slug: 'lab', route: ['x'], version: parseVersion('2.0.0'), params: { a: '1', b: 'two words' }, fragment: 'end' }
  ]
  for (const one of cases) {
    const written = pageAddress(one.slug, one)
    const read = address(written)
    assert.equal(read.slug, one.slug, written)
    assert.deepEqual(read.route, one.route ?? [], written)
    assert.deepEqual(read.version, one.version ?? null, written)
    assert.deepEqual(read.params, one.params ?? {}, written)
    assert.equal(read.fragment, one.fragment ?? '', written)
  }
})

test('an address with a route segment needing escaping survives the round trip', () => {
  const written = pageAddress('lab', { route: ['a b', 'c#d', 'e?f'] })
  assert.deepEqual(address(written).route, ['a b', 'c#d', 'e?f'])
})

test('two spellings of one address normalise to the same string', () => {
  const canonical = normalisePageAddress('orbis://pages/lab')
  assert.equal(normalisePageAddress('orbis://pages/lab/'), canonical)
  assert.equal(normalisePageAddress('orbis://pages/lab//'), canonical)
  // Parameter order is not part of the address.
  assert.equal(normalisePageAddress('orbis://pages/lab?b=2&a=1'), normalisePageAddress('orbis://pages/lab?a=1&b=2'))
})

test('the canonical address is the one a bookmark should store', () => {
  assert.equal(canonicalPageAddress('lab'), `${PAGES_ROOT}/lab`)
  // No route, no parameters, no version -- so one Page is never indexed twice under two spellings.
  assert.equal(canonicalPageAddress('lab').includes('?'), false)
  assert.equal(canonicalPageAddress('lab').includes('@'), false)
})

// ---------------------------------------------------------------- identity as an object

test('an identity carries what other subsystems should store', () => {
  const identity = pageIdentity({
    pageId: makePageId('abcdef123456abcdef'),
    slug: 'physics-lab',
    version: parseVersion('1.0.0')!,
    owner: 'system'
  })
  assert.equal(identity.canonicalUrl, 'orbis://pages/physics-lab')
  assert.equal(identity.profileId, null, 'a Page shipped with Orbis belongs to no profile')
  /*
   * Frozen, because an identity that can be edited in place is not an identity.
   *
   * Asserted as frozen-and-unchanged, with the write allowed to throw or not. It used to assume the write would be
   * silently dropped, on the grounds that these files ran as CommonJS in sloppy mode; they now run as modules, where
   * the same write throws -- so the test failed on an object that was correctly frozen.
   */
  assert.ok(Object.isFrozen(identity))
  try {
    ;(identity as { slug: string }).slug = 'something-else'
  } catch {
    // Strict mode refuses the write outright, which is the invariant holding more loudly.
  }
  assert.equal(identity.slug, 'physics-lab', 'the slug was editable in place')
})

test('sameness is a question about the id, not the address', () => {
  const id = makePageId('abcdef123456abcdef')
  const before = pageIdentity({ pageId: id, slug: 'old-name', version: parseVersion('1.0.0')!, owner: 'user', profileId: 'p1' })
  const after = pageIdentity({ pageId: id, slug: 'new-name', version: parseVersion('1.1.0')!, owner: 'user', profileId: 'p1' })
  // The whole reason the id and the slug are separate: renaming must not break every reference.
  assert.equal(sameIdentity(before, after), true)
  assert.notEqual(before.canonicalUrl, after.canonicalUrl)
})
