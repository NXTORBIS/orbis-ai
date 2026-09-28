import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePageId } from './identity.ts'
import { MANIFEST_SCHEMA_VERSION } from './manifest.ts'
import {
  approveUpdate,
  archivePage,
  canOpen,
  categoryContains,
  categoryTree,
  deletePage,
  emptyRegistry,
  listPages,
  markCompatibility,
  pageById,
  pageBySlug,
  pruneAliases,
  recentPages,
  recordOpen,
  registerPage,
  registryHealth,
  relatedPages,
  resolve,
  restorePage,
  searchPages,
  setFavourite,
  suggestPages,
  tagCounts,
  updatePage,
  visibleTo,
  type PageRegistry,
  type RegisteredPage,
  type Registered,
  type Updated
} from './registry.ts'

const NOW = 1_700_000_000_000

let counter = 0
/** A distinct id per call, deterministic so a failure is reproducible. */
const nextId = (): string => makePageId(`aaaaaaaa${String(counter++).padStart(10, '0')}`)

const manifest = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  pageId: nextId(),
  slug: 'projectile-motion',
  title: 'Projectile Motion Laboratory',
  description: 'Work out the path of a projectile from its launch speed, angle and the gravity acting on it.',
  version: '1.0.0',
  kind: 'laboratory',
  categories: ['science.physics.mechanics'],
  tags: ['physics', 'kinematics', 'simulation'],
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

/** Registers a Page and fails the test if it could not be. */
const add = (
  state: PageRegistry,
  patch: Record<string, unknown> = {},
  options: Partial<Parameters<typeof registerPage>[2]> = {}
): Registered => {
  const result = registerPage(state, manifest(patch), { trust: 'system', profileId: null, now: NOW, ...options })
  assert.ok(!('error' in result), `could not register: ${JSON.stringify(result)}`)
  return result as Registered
}

// ---------------------------------------------------------------- registering

test('an empty register has nothing in it and is healthy', () => {
  const state = emptyRegistry()
  assert.equal(state.pages.length, 0)
  assert.equal(registryHealth(state).healthy, true)
})

test('a Page can be registered and found by id and by address', () => {
  const { state, page } = add(emptyRegistry())
  assert.equal(state.pages.length, 1)
  assert.equal(pageById(state, page.identity.pageId)?.manifest.title, 'Projectile Motion Laboratory')
  assert.equal(pageBySlug(state, 'projectile-motion')?.identity.pageId, page.identity.pageId)
  assert.equal(page.status, 'available')
  assert.equal(page.identity.canonicalUrl, 'orbis://pages/projectile-motion')
})

test('a manifest that does not validate is refused rather than stored broken', () => {
  // A broken entry is worse than a missing Page: it appears in lists, gets indexed, and fails when opened.
  const result = registerPage(emptyRegistry(), manifest({ title: '' }), { trust: 'system', profileId: null, now: NOW })
  assert.ok('error' in result)
  assert.equal((result as { error: string }).error, 'invalid-manifest')
  assert.ok((result as { problems: unknown[] }).problems.length > 0)
})

test('an id already in the register is refused', () => {
  const first = add(emptyRegistry())
  const again = registerPage(first.state, { ...manifest(), pageId: first.page.identity.pageId, slug: 'other-page' }, {
    trust: 'system',
    profileId: null,
    now: NOW
  })
  assert.equal((again as { error: string }).error, 'id-taken')
})

test('a taken address is refused by default, with the next free one offered', () => {
  // Silently renaming means the author wrote one address and got another, and found out when a link failed.
  const first = add(emptyRegistry())
  const again = registerPage(first.state, manifest(), { trust: 'system', profileId: null, now: NOW })
  assert.equal((again as { error: string }).error, 'slug-taken')
  assert.equal((again as { suggestion: string }).suggestion, 'projectile-motion-2')
})

test('the importer may take the next free address rather than failing', () => {
  const first = add(emptyRegistry())
  const second = add(first.state, {}, { renameOnCollision: true })
  assert.equal(second.page.identity.slug, 'projectile-motion-2')
})

test('a Page Orbis ships belongs to no profile; anything else belongs to one', () => {
  const shipped = add(emptyRegistry(), { owner: 'system' }, { profileId: 'p1' })
  assert.equal(shipped.page.identity.profileId, null)
  const mine = add(shipped.state, { owner: 'user', slug: 'my-page' }, { profileId: 'p1', trust: 'user' })
  assert.equal(mine.page.identity.profileId, 'p1')
})

// ---------------------------------------------------------------- profile isolation

test('a Page in another profile is not visible', () => {
  const a = add(emptyRegistry(), { owner: 'user', slug: 'mine' }, { profileId: 'p1', trust: 'user' })
  const page = a.page
  assert.equal(visibleTo(page, 'p1'), true)
  assert.equal(visibleTo(page, 'p2'), false)
  assert.equal(listPages(a.state, { profileId: 'p2' }).length, 0)
  assert.equal(listPages(a.state, { profileId: 'p1' }).length, 1)
})

test('another profile\'s Page resolves as not found, in the same words as one that never existed', () => {
  // A different message would say what is in another profile, which is what profile isolation is for.
  const { state } = add(emptyRegistry(), { owner: 'user', slug: 'mine' }, { profileId: 'p1', trust: 'user' })
  const theirs = resolve(state, 'orbis://pages/mine', 'p2')
  const nothing = resolve(state, 'orbis://pages/never-existed', 'p2')
  assert.equal(theirs.found, false)
  assert.equal((theirs as { reason: string }).reason, 'not-found')
  assert.equal((theirs as { message: string }).message.replace('mine', 'X'), (nothing as { message: string }).message.replace('never-existed', 'X'))
})

// ---------------------------------------------------------------- resolving

test('an address resolves to its Page, with the canonical address to settle on', () => {
  const { state } = add(emptyRegistry())
  const resolved = resolve(state, 'orbis://pages/projectile-motion/experiment?mode=compare#top', null)
  assert.equal(resolved.found, true)
  assert.deepEqual((resolved as { address: { route: string[] } }).address.route, ['experiment'])
  assert.equal((resolved as { canonicalUrl: string }).canonicalUrl, 'orbis://pages/projectile-motion')
  assert.equal((resolved as { redirectedFrom: string | null }).redirectedFrom, null)
})

test('a malformed address never reaches the register', () => {
  const { state } = add(emptyRegistry())
  for (const bad of ['orbis://pages/../etc', 'https://example.com', 'orbis://pages/', 'orbis://pages/Bad']) {
    const resolved = resolve(state, bad, null)
    assert.equal(resolved.found, false, bad)
    assert.equal((resolved as { reason: string }).reason, 'bad-address', bad)
  }
})

test('an archived Page reports why rather than pretending to be missing', () => {
  const { state, page } = add(emptyRegistry())
  const archived = archivePage(state, page.identity.pageId, 'Replaced by the new one.')
  const resolved = resolve(archived, 'orbis://pages/projectile-motion', null)
  assert.equal(resolved.found, false)
  assert.equal((resolved as { reason: string }).reason, 'unavailable')
  assert.match((resolved as { message: string }).message, /Replaced by the new one/)
  // Restoring brings it back.
  assert.equal(resolve(restorePage(archived, page.identity.pageId), 'orbis://pages/projectile-motion', null).found, true)
})

test('an incompatible Page cannot be opened, and says what it needs', () => {
  const { state, page } = add(emptyRegistry(), {
    dependencies: [{ id: 'orbis.graphing', atLeast: '2.0.0' }]
  })
  const resolved = canOpen(state, 'orbis://pages/projectile-motion', null, {})
  assert.equal(resolved.found, false)
  assert.match((resolved as { message: string }).message, /orbis.graphing/)
  // And with the engine present it opens.
  assert.equal(canOpen(state, 'orbis://pages/projectile-motion', null, { 'orbis.graphing': { major: 2, minor: 1, patch: 0 } }).found, true)
  // The status can be written down so a list shows it too.
  const marked = markCompatibility(state, page.identity.pageId, { state: 'dependency-missing', canOpen: false, missing: ['orbis.graphing'], degraded: [], message: 'needs it' })
  assert.equal(pageById(marked, page.identity.pageId)?.status, 'incompatible')
})

// ---------------------------------------------------------------- updating

test('an update to a newer version replaces the Page', () => {
  const { state, page } = add(emptyRegistry())
  const result = updatePage(state, page.identity.pageId, manifest({ pageId: page.identity.pageId, version: '1.1.0', title: 'Projectile Motion Lab' }), NOW + 1000)
  assert.ok(!('error' in result))
  const updated = result as Updated
  assert.equal(updated.page.manifest.title, 'Projectile Motion Lab')
  assert.equal(updated.page.status, 'available')
  assert.equal(updated.reindex, true, 'the title changed, so search has to be told')
})

test('a manifest with a different id is not an update', () => {
  // Accepting it would let an update swap one Page for another while keeping its permissions and address.
  const { state, page } = add(emptyRegistry())
  const result = updatePage(state, page.identity.pageId, manifest({ version: '2.0.0' }), NOW + 1)
  assert.equal((result as { error: string }).error, 'different-page')
})

test('an update has to be newer', () => {
  const { state, page } = add(emptyRegistry())
  for (const version of ['1.0.0', '0.9.0']) {
    const result = updatePage(state, page.identity.pageId, manifest({ pageId: page.identity.pageId, version }), NOW + 1)
    assert.equal((result as { error: string }).error, 'not-newer', version)
  }
})

test('an update that asks for more waits to be checked instead of becoming available', () => {
  // The most likely route to acquiring permissions quietly, so it is the one closed hardest.
  const { state, page } = add(emptyRegistry())
  const result = updatePage(
    state,
    page.identity.pageId,
    manifest({
      pageId: page.identity.pageId,
      version: '2.0.0',
      capabilities: ['computation.arithmetic', 'computation.units', 'storage.page', 'files.export'],
      capabilityReasons: { 'files.export': 'Saves the trajectory as a CSV file.' }
    }),
    NOW + 1
  ) as Updated
  assert.equal(result.page.status, 'needs-review')
  assert.deepEqual(result.changes.added, ['files.export'])
  assert.equal(result.changes.needsReview, true)
  // And it cannot be opened until somebody has looked.
  const blocked = resolve(result.state, 'orbis://pages/projectile-motion', null)
  assert.equal(blocked.found, false)
  assert.match((blocked as { message: string }).message, /Save a file|asks for/)
  // Approving it makes it available.
  assert.equal(resolve(approveUpdate(result.state, page.identity.pageId), 'orbis://pages/projectile-motion', null).found, true)
})

test('an update that gives a permission up needs no review', () => {
  const { state, page } = add(emptyRegistry())
  const result = updatePage(
    state,
    page.identity.pageId,
    manifest({ pageId: page.identity.pageId, version: '1.1.0', capabilities: ['computation.arithmetic', 'storage.page'] }),
    NOW + 1
  ) as Updated
  assert.equal(result.page.status, 'available')
  assert.deepEqual(result.changes.removed, ['computation.units'])
})

test('renaming a Page keeps the old address working', () => {
  const { state, page } = add(emptyRegistry())
  const result = updatePage(state, page.identity.pageId, manifest({ pageId: page.identity.pageId, version: '2.0.0', slug: 'projectile-lab' }), NOW + 1) as Updated
  // The whole reason the id and the address are separate.
  const viaNew = resolve(result.state, 'orbis://pages/projectile-lab', null)
  assert.equal(viaNew.found, true)
  const viaOld = resolve(result.state, 'orbis://pages/projectile-motion', null)
  assert.equal(viaOld.found, true)
  assert.equal((viaOld as { redirectedFrom: string | null }).redirectedFrom, 'orbis://pages/projectile-motion')
  assert.equal((viaOld as { canonicalUrl: string }).canonicalUrl, 'orbis://pages/projectile-lab')
})

test('a rename onto an address somebody else has is refused', () => {
  const first = add(emptyRegistry())
  const second = add(first.state, { slug: 'other-lab' })
  const result = updatePage(second.state, second.page.identity.pageId, manifest({ pageId: second.page.identity.pageId, version: '2.0.0', slug: 'projectile-motion' }), NOW + 1)
  assert.equal((result as { error: string }).error, 'slug-taken')
})

test('the most recent rename wins when an address has been used twice', () => {
  const first = add(emptyRegistry())
  const renamedOnce = updatePage(first.state, first.page.identity.pageId, manifest({ pageId: first.page.identity.pageId, version: '2.0.0', slug: 'lab-one' }), NOW + 100) as Updated
  // The old address is now free, so a second Page takes it and then renames away too.
  const second = add(renamedOnce.state, { slug: 'projectile-motion' })
  const renamedTwice = updatePage(second.state, second.page.identity.pageId, manifest({ pageId: second.page.identity.pageId, version: '2.0.0', slug: 'lab-two' }), NOW + 200) as Updated
  const resolved = resolve(renamedTwice.state, 'orbis://pages/projectile-motion', null)
  assert.equal(resolved.found, true)
  assert.equal((resolved as { page: RegisteredPage }).page.identity.slug, 'lab-two')
})

// ---------------------------------------------------------------- deleting

test('deleting a Page removes it and the addresses that pointed at it', () => {
  const { state, page } = add(emptyRegistry(), { owner: 'user' }, { trust: 'user', profileId: 'p1' })
  const renamed = updatePage(state, page.identity.pageId, manifest({ pageId: page.identity.pageId, owner: 'user', version: '2.0.0', slug: 'renamed' }), NOW + 1) as Updated
  assert.equal(renamed.state.aliases.length, 1)
  const result = deletePage(renamed.state, page.identity.pageId)
  assert.equal(result.deleted, true)
  assert.equal(result.state.pages.length, 0)
  assert.equal(result.state.aliases.length, 0)
  // And the message says the saved work is untouched, because it is a separate store and a separate decision.
  assert.match(result.message, /still there/)
})

test('a Page that is part of Orbis cannot be deleted', () => {
  const { state, page } = add(emptyRegistry(), { owner: 'system' })
  const result = deletePage(state, page.identity.pageId)
  assert.equal(result.deleted, false)
  assert.equal(result.state.pages.length, 1)
})

test('deleting something that is not there says so rather than pretending', () => {
  assert.equal(deletePage(emptyRegistry(), 'page_nothinghere00').deleted, false)
})

// ---------------------------------------------------------------- listing and discovery

const library = (): PageRegistry => {
  let state = emptyRegistry()
  state = add(state, {
    slug: 'projectile-motion',
    title: 'Projectile Motion Laboratory',
    categories: ['science.physics.mechanics'],
    tags: ['physics', 'kinematics', 'simulation'],
    kind: 'laboratory'
  }).state
  state = add(state, {
    slug: 'unit-converter',
    title: 'Unit Converter',
    description: 'Convert between units of length, mass, time, temperature and many more.',
    categories: ['utilities'],
    tags: ['units', 'conversion'],
    kind: 'converter',
    search: { summary: 'Convert any quantity into another unit of the same kind.', keywords: ['convert', 'units', 'metric'], intents: ['convert'], aliases: ['Units'] }
  }).state
  state = add(state, {
    slug: 'equation-solver',
    title: 'Equation Solver',
    description: 'Solve an equation for one unknown and see every step of the working.',
    categories: ['science.mathematics.algebra'],
    tags: ['algebra', 'equations'],
    kind: 'solver',
    search: { summary: 'Solve linear, quadratic and polynomial equations with verified answers.', keywords: ['solve', 'equation', 'algebra', 'quadratic'], intents: ['solve', 'calculate'], aliases: [] }
  }).state
  state = add(state, {
    slug: 'sorting-visualiser',
    title: 'Sorting Algorithm Visualiser',
    description: 'Step through selection sort and watch the comparisons and swaps as they happen.',
    categories: ['computer-science.algorithms.sorting'],
    tags: ['algorithms', 'simulation', 'education'],
    kind: 'visualizer',
    search: { summary: 'Watch sorting algorithms run one comparison at a time.', keywords: ['sorting', 'selection', 'algorithm'], intents: ['visualise', 'learn'], aliases: ['Sort Lab'] }
  }).state
  return state
}

test('a category contains its descendants and nothing that merely starts the same way', () => {
  assert.equal(categoryContains('science', 'science.physics'), true)
  assert.equal(categoryContains('science', 'science'), true)
  assert.equal(categoryContains('science', 'sciencefiction'), false)
  assert.equal(categoryContains('science.physics', 'science'), false)
})

test('listing filters by what is asked for', () => {
  const state = library()
  assert.equal(listPages(state, { profileId: null }).length, 4)
  assert.equal(listPages(state, { profileId: null, category: 'science' }).length, 2)
  assert.equal(listPages(state, { profileId: null, category: 'science.physics' }).length, 1)
  assert.equal(listPages(state, { profileId: null, tag: 'simulation' }).length, 2)
  assert.equal(listPages(state, { profileId: null, kind: 'solver' }).length, 1)
  assert.equal(listPages(state, { profileId: null, offline: true }).length, 4)
})

test('the category tree is built from what is actually filed, so no shelf is empty', () => {
  const tree = categoryTree(library(), null)
  const paths = tree.map((one) => one.path).sort()
  assert.deepEqual(paths, ['computer-science', 'science', 'utilities'])
  const science = tree.find((one) => one.path === 'science')!
  assert.equal(science.total, 2)
  assert.equal(science.count, 0, 'nothing is filed directly at "science"')
  assert.deepEqual(science.children.map((one) => one.path).sort(), ['science.mathematics', 'science.physics'])
  // Every node in the tree has at least one Page somewhere beneath it.
  const walk = (nodes: typeof tree): void => {
    for (const node of nodes) {
      assert.ok(node.total > 0, `${node.path} is an empty category`)
      walk(node.children)
    }
  }
  walk(tree)
})

test('tag counts are real counts, commonest first', () => {
  const counts = tagCounts(library(), null)
  assert.equal(counts[0].tag, 'simulation')
  assert.equal(counts[0].count, 2)
  // The total counts every tag on every Page, derived rather than written down so the sum cannot drift from the library.
  const expected = listPages(library(), { profileId: null }).reduce((total, page) => total + page.manifest.tags.length, 0)
  assert.equal(counts.reduce((total, one) => total + one.count, 0), expected)
})

test('recents only contains Pages that were actually opened, newest first', () => {
  let state = library()
  assert.deepEqual(recentPages(state, null), [])
  const solver = pageBySlug(state, 'equation-solver')!
  const units = pageBySlug(state, 'unit-converter')!
  state = recordOpen(state, solver.identity.pageId, NOW + 100)
  state = recordOpen(state, units.identity.pageId, NOW + 200)
  const recent = recentPages(state, null)
  assert.deepEqual(recent.map((one) => one.identity.slug), ['unit-converter', 'equation-solver'])
  assert.equal(pageById(state, solver.identity.pageId)?.openCount, 1)
})

// ---------------------------------------------------------------- search

test('searching finds the Page that is the thing asked for', () => {
  const state = library()
  const results = searchPages(state, 'equation solver', { profileId: null })
  assert.equal(results[0].page.identity.slug, 'equation-solver')
  assert.ok(results[0].matched.length > 0, 'a ranking nobody can explain is one nobody can fix')
})

test('an exact name beats a keyword, and a keyword beats a description', () => {
  const state = library()
  // "sorting" is this Page's subject and another's description word.
  const sorting = searchPages(state, 'sorting', { profileId: null })
  assert.equal(sorting[0].page.identity.slug, 'sorting-visualiser')
  const exact = searchPages(state, 'unit converter', { profileId: null })
  assert.equal(exact[0].page.identity.slug, 'unit-converter')
  assert.ok(exact[0].score > 300)
})

test('another name for a Page finds it', () => {
  const results = searchPages(library(), 'sort lab', { profileId: null })
  assert.equal(results[0].page.identity.slug, 'sorting-visualiser')
  assert.ok(results[0].matched.includes('another name for it'))
})

test('a tool-seeking search finds a tool', () => {
  // `convert` is what somebody is trying to do, and the converter declares it as an intent.
  const results = searchPages(library(), 'convert', { profileId: null })
  assert.equal(results[0].page.identity.slug, 'unit-converter')
  assert.ok(results[0].matched.includes('what you want to do') || results[0].matched.includes('keyword'))
})

test('a subject word finds the Pages filed under it', () => {
  const results = searchPages(library(), 'physics', { profileId: null })
  assert.equal(results.length >= 1, true)
  assert.equal(results[0].page.identity.slug, 'projectile-motion')
})

test('a small typo still finds the Page, and a different word does not', () => {
  const close = searchPages(library(), 'projectil', { profileId: null })
  assert.ok(close.length >= 1)
  // Only for words long enough that one edit is more likely a slip than a different word.
  assert.deepEqual(searchPages(library(), 'cat', { profileId: null }), [])
})

test('a search matching nothing returns nothing rather than everything', () => {
  assert.deepEqual(searchPages(library(), 'zzzzqqqq', { profileId: null }), [])
  assert.deepEqual(searchPages(library(), '', { profileId: null }), [])
  assert.deepEqual(searchPages(library(), '   ', { profileId: null }), [])
})

test('search respects the profile it is asked about', () => {
  let state = library()
  state = add(state, { owner: 'user', slug: 'private-lab', title: 'Private Lab' }, { profileId: 'p1', trust: 'user' }).state
  const found = (profileId: string): boolean =>
    searchPages(state, 'private lab', { profileId }).some((one) => one.page.identity.slug === 'private-lab')
  assert.equal(found('p1'), true)
  assert.equal(found('p2'), false, 'another profile must not learn that this Page exists')
  // The Pages Orbis ships are still there for both, which is what makes the first assertion meaningful.
  assert.ok(searchPages(state, 'equation solver', { profileId: 'p2' }).length > 0)
})

test('a favourite is nudged up without deciding the answer', () => {
  let state = library()
  const units = pageBySlug(state, 'unit-converter')!
  const before = searchPages(state, 'convert', { profileId: null })
  state = setFavourite(state, units.identity.pageId, true)
  const after = searchPages(state, 'convert', { profileId: null })
  assert.ok(after[0].score > before[0].score)
  assert.ok(after[0].matched.includes('a favourite'))
  // A favourite does not outrank being the thing asked for.
  assert.equal(searchPages(state, 'equation solver', { profileId: null })[0].page.identity.slug, 'equation-solver')
})

test('an offline-only search excludes Pages that need the network', () => {
  const state = add(library(), {
    slug: 'live-rates',
    title: 'Live Rates',
    description: 'Show the current exchange rate between two currencies from a live provider.',
    offline: false,
    capabilities: ['computation.arithmetic', 'storage.page', 'network.fetch'],
    capabilityReasons: { 'network.fetch': 'Fetches the current exchange rate from the provider.' },
    search: { summary: 'Live currency rates from a provider.', keywords: ['rates', 'currency', 'convert'], intents: ['convert'], aliases: [] }
  }).state
  assert.ok(searchPages(state, 'convert', { profileId: null }).some((one) => one.page.identity.slug === 'live-rates'))
  assert.equal(searchPages(state, 'convert', { profileId: null, offlineOnly: true }).some((one) => one.page.identity.slug === 'live-rates'), false)
})

test('a search can be narrowed to a subject', () => {
  const state = library()
  const all = searchPages(state, 'simulation', { profileId: null })
  const physicsOnly = searchPages(state, 'simulation', { profileId: null, category: 'science.physics' })
  assert.ok(all.length > physicsOnly.length)
  assert.ok(physicsOnly.every((one) => one.page.manifest.categories.some((c) => c.startsWith('science.physics'))))
})

test('a limit is respected', () => {
  assert.equal(searchPages(library(), 'simulation', { profileId: null, limit: 1 }).length, 1)
})

// ---------------------------------------------------------------- related and suggestions

test('related Pages come from something real, or there are none', () => {
  const state = library()
  const sorting = pageBySlug(state, 'sorting-visualiser')!
  const related = relatedPages(state, sorting.identity.pageId, null)
  // Shares the `simulation` tag with the projectile lab, and nothing else is close.
  assert.equal(related[0].page.identity.slug, 'projectile-motion')
  assert.ok(related[0].matched.includes('shared tags'))
  // A Page with nothing in common returns nothing rather than filling a slot.
  const lonely = add(state, { slug: 'lonely', title: 'Lonely Page', categories: ['nowhere'], tags: ['unique-tag'], kind: 'reference' })
  assert.deepEqual(relatedPages(lonely.state, lonely.page.identity.pageId, null), [])
})

test('a Page is never related to itself', () => {
  const state = library()
  const page = pageBySlug(state, 'projectile-motion')!
  assert.equal(relatedPages(state, page.identity.pageId, null).some((one) => one.page.identity.pageId === page.identity.pageId), false)
})

test('suggestions only fire on something that actually begins with what was typed', () => {
  const state = library()
  assert.deepEqual(suggestPages(state, 'equ', null).map((one) => one.identity.slug), ['equation-solver'])
  assert.deepEqual(suggestPages(state, 'sol', null).map((one) => one.identity.slug), ['equation-solver'], 'a word inside the name counts')
  assert.deepEqual(suggestPages(state, 'zzz', null), [])
  // Too short to be worth guessing at.
  assert.deepEqual(suggestPages(state, 'e', null), [])
})

// ---------------------------------------------------------------- health

test('the register checks itself, and says so when it is fine', () => {
  const health = registryHealth(library())
  assert.equal(health.pages, 4)
  assert.equal(health.available, 4)
  assert.equal(health.healthy, true)
  assert.deepEqual(health.duplicateSlugs, [])
  assert.deepEqual(health.duplicateIds, [])
})

test('statuses are counted', () => {
  const state = library()
  const page = pageBySlug(state, 'projectile-motion')!
  const health = registryHealth(archivePage(state, page.identity.pageId))
  assert.equal(health.archived, 1)
  assert.equal(health.available, 3)
})

test('an alias pointing at nothing is found and can be cleared without touching a Page', () => {
  const { state, page } = add(emptyRegistry(), { owner: 'user' }, { trust: 'user', profileId: 'p1' })
  const renamed = (updatePage(state, page.identity.pageId, manifest({ pageId: page.identity.pageId, owner: 'user', version: '2.0.0', slug: 'renamed' }), NOW + 1) as Updated).state
  // Forcing the inconsistency the health check exists to notice.
  const broken = { pages: renamed.pages.filter(() => false), aliases: renamed.aliases }
  assert.deepEqual(registryHealth(broken).danglingAliases, ['projectile-motion'])
  assert.equal(pruneAliases(broken).aliases.length, 0)
  // And pruning a healthy register changes nothing.
  assert.equal(pruneAliases(renamed).aliases.length, 1)
})

// ---------------------------------------------------------------- immutability

test('every change returns a new register rather than editing the old one', () => {
  const first = add(emptyRegistry())
  const archived = archivePage(first.state, first.page.identity.pageId)
  assert.equal(pageById(first.state, first.page.identity.pageId)?.status, 'available', 'the original is untouched')
  assert.equal(pageById(archived, first.page.identity.pageId)?.status, 'archived')
  assert.throws(() => {
    ;(first.state as { pages: unknown }).pages = []
  })
})
