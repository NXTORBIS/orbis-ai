import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FiltersEngine } from '@ghostery/adblocker'
import { AdBlockCore, ENGINE_CONFIG, activeCategories, extractPopupHosts, normalizeSettings } from './blocker.ts'
import { FilterStore, countRules, sha256, validateList } from './store.ts'
import type { Catalog } from './store.ts'

const ADS = [
  '||ads.example^',
  '||adserver.example^',
  '/banner-ad.js',
  '||popads.example^$popup',
  '@@||ads.example/allowed.js',
  '##.ad-banner',
  'news.example##.sponsored-box'
].join('\n')

function core(level: 'standard' | 'strict' = 'standard'): AdBlockCore {
  const c = new AdBlockCore(normalizeSettings({ level }))
  c.setEngines(
    {
      ads: FiltersEngine.parse(ADS, ENGINE_CONFIG),
      trackers: FiltersEngine.parse('||tracker.example^', { ...ENGINE_CONFIG, loadCosmeticFilters: false }),
      annoyances: FiltersEngine.parse('##.cookie-wall\n##.adblock-overlay', ENGINE_CONFIG)
    },
    extractPopupHosts(ADS)
  )
  c.startPage(1, 'https://news.example/article')
  return c
}

test('blocks ad and tracker requests before they load, and counts them per page', () => {
  const c = core()
  assert.deepEqual(c.onRequest({ url: 'https://ads.example/x.js', resourceType: 'script', webContentsId: 1 }), { action: 'block', category: 'ads', rule: '||ads.example^' })
  assert.equal(c.onRequest({ url: 'https://tracker.example/pixel.gif', resourceType: 'image', webContentsId: 1 }).action, 'block')
  assert.equal(c.onRequest({ url: 'https://cdn.news.example/app.js', resourceType: 'script', webContentsId: 1 }).action, 'allow')
  const report = c.report(1)!
  assert.equal(report.counts.ads, 1)
  assert.equal(report.counts.trackers, 1)
  assert.equal(report.recent[0].category, 'trackers')
  assert.equal(report.recent[1].rule, '||ads.example^')
})

test('the lists’ own exceptions, and documents the user opens, are never blocked', () => {
  const c = core()
  assert.equal(c.onRequest({ url: 'https://ads.example/allowed.js', resourceType: 'script', webContentsId: 1 }).action, 'allow')
  assert.equal(c.onRequest({ url: 'https://ads.example/', resourceType: 'mainFrame', webContentsId: 1 }).action, 'allow')
})

test("a generic rule on a site's own script is uncertain: allowed in Standard, blocked in Strict", () => {
  const standard = core('standard')
  assert.equal(standard.onRequest({ url: 'https://news.example/banner-ad.js', resourceType: 'script', webContentsId: 1 }).action, 'allow')
  assert.equal(standard.report(1)!.recent[0].action, 'uncertain')
  assert.equal(standard.report(1)!.counts.ads, 0, 'uncertain matches are not counted as blocked')
  assert.equal(standard.onRequest({ url: 'https://cdn.other.example/banner-ad.js', resourceType: 'script', webContentsId: 1 }).action, 'block', 'third-party is not uncertain')
  assert.equal(core('strict').onRequest({ url: 'https://news.example/banner-ad.js', resourceType: 'script', webContentsId: 1 }).action, 'block')
})

test('site and resource exceptions allow only what they name', () => {
  const c = core()
  c.allowResource('https://ads.example/x.js?v=2')
  assert.equal(c.onRequest({ url: 'https://ads.example/x.js?v=3', resourceType: 'script', webContentsId: 1 }).action, 'allow')
  assert.equal(c.report(1)!.recent[0].action, 'allowed-by-exception')
  assert.equal(c.onRequest({ url: 'https://ads.example/y.js', resourceType: 'script', webContentsId: 1 }).action, 'block', 'the rest of that ad server stays blocked')
  c.setSite('https://www.news.example/other', true)
  assert.deepEqual(c.settings.siteExceptions, ['news.example'])
  assert.equal(c.onRequest({ url: 'https://ads.example/y.js', resourceType: 'script', webContentsId: 1 }).action, 'allow')
  assert.equal(c.report(1)!.siteAllowed, true)
  c.removeException('site', 'news.example')
  assert.equal(c.onRequest({ url: 'https://ads.example/y.js', resourceType: 'script', webContentsId: 1 }).action, 'block')
})

test('settings: off allows everything, levels and custom categories decide what is active', () => {
  const c = core()
  c.updateSettings({ enabled: false })
  assert.equal(c.onRequest({ url: 'https://ads.example/x.js', resourceType: 'script', webContentsId: 1 }).action, 'allow')
  assert.deepEqual(activeCategories(c.settings), { ads: false, trackers: false, annoyances: false, popups: false, redirects: false })
  c.updateSettings({ enabled: true, level: 'custom', custom: { ads: true, trackers: false, annoyances: false, popups: true, redirects: true } })
  assert.equal(c.onRequest({ url: 'https://tracker.example/p.gif', resourceType: 'image', webContentsId: 1 }).action, 'allow')
  assert.equal(c.onRequest({ url: 'https://ads.example/x.js', resourceType: 'script', webContentsId: 1 }).action, 'block')
  assert.equal(activeCategories(normalizeSettings({})).annoyances, false, 'Standard leaves overlays alone for compatibility')
  assert.equal(activeCategories(normalizeSettings({ level: 'strict' })).annoyances, true)
  assert.deepEqual(normalizeSettings({ level: 'bogus', siteExceptions: ['A.com', 'a.com', 3] }).siteExceptions, ['a.com'])
})

test('a document request starts tracking its page, even before the tab reports the navigation', () => {
  const c = core()
  c.onRequest({ url: 'https://shop.example/item', resourceType: 'mainFrame', webContentsId: 7 })
  assert.equal(c.onRequest({ url: 'https://ads.example/x.js', resourceType: 'script', webContentsId: 7 }).action, 'block')
  assert.equal(c.report(7)?.pageUrl, 'https://shop.example/item')
  assert.equal(c.report(7)?.counts.ads, 1)
  assert.equal(c.navigation({ url: 'https://adserver.example/click', webContentsId: 7, redirect: false }).block, true)
})

test('an ad-click navigation is stopped even when its document request arrives before the navigation event', () => {
  const c = core()
  c.onRequest({ url: 'https://tracker.example/p.gif', resourceType: 'image', webContentsId: 1 })
  // Electron order: the destination's document request first...
  c.onRequest({ url: 'https://adserver.example/click?id=9', resourceType: 'mainFrame', webContentsId: 1 })
  assert.equal(c.report(1)?.pageUrl, 'https://adserver.example/click?id=9')
  // ...then the navigation event, which must still judge it against the article page.
  const verdict = c.navigation({ url: 'https://adserver.example/click?id=9', webContentsId: 1, redirect: false })
  assert.equal(verdict.block, true)
  const report = c.report(1)!
  assert.equal(report.pageUrl, 'https://news.example/article', 'the tab stays on the article, with its record')
  assert.equal(report.counts.trackers, 1)
  assert.equal(report.counts.redirects, 1)
  // An ordinary link in the same order is allowed and becomes the page.
  c.onRequest({ url: 'https://wikipedia.org/wiki/News', resourceType: 'mainFrame', webContentsId: 1 })
  assert.equal(c.navigation({ url: 'https://wikipedia.org/wiki/News', webContentsId: 1, redirect: false }).block, false)
  assert.equal(c.report(1)?.pageUrl, 'https://wikipedia.org/wiki/News')
})

test('generic element hiding also works on pages without a registrable domain (IP addresses, localhost)', () => {
  const c = core()
  assert.match(c.cosmetics('http://127.0.0.1:8080/page', { classes: ['ad-banner'] }).styles.join('\n'), /\.ad-banner/)
  assert.match(c.cosmetics('http://localhost:3000/', { classes: ['ad-banner'] }).styles.join('\n'), /\.ad-banner/)
})

test('a new page in the tab starts its results from zero', () => {
  const c = core()
  c.onRequest({ url: 'https://ads.example/x.js', resourceType: 'script', webContentsId: 1 })
  c.startPage(1, 'https://news.example/next')
  assert.equal(c.report(1)!.counts.ads, 0)
  assert.equal(c.reportForUrl('https://news.example/next#top')?.webContentsId, 1)
})

test('cosmetic filtering hides ad elements (site rules on load, generic rules as matching elements appear), overlays only when enabled', () => {
  const c = core()
  // On load: the site's own rules. Generic rules come once the in-page observer reports the classes present.
  const onLoad = c.cosmetics('https://news.example/article', undefined, 1)
  assert.match(onLoad.styles.join('\n'), /\.sponsored-box/)
  const onElements = c.cosmetics('https://news.example/article', { classes: ['ad-banner', 'cookie-wall', 'story'] }, 1)
  assert.match(onElements.styles.join('\n'), /\.ad-banner/)
  assert.doesNotMatch(onElements.styles.join('\n'), /cookie-wall/, 'Standard skips annoyances')
  assert.ok(c.report(1)!.hidingRules >= 2)
  assert.doesNotMatch(c.cosmetics('https://blog.other/post', undefined).styles.join('\n'), /sponsored-box/)
  const strict = core('strict')
  assert.match(strict.cosmetics('https://news.example/article', { classes: ['adblock-overlay'] }, 1).styles.join('\n'), /adblock-overlay/)
  c.setSite('news.example', true)
  assert.deepEqual(c.cosmetics('https://news.example/article', undefined, 1), { styles: [], scripts: [] })
})

test('popups: ad popups and popup spam are blocked, a normal new window is allowed', () => {
  const c = core()
  assert.equal(c.popup({ url: 'https://popads.example/go', webContentsId: 1 }).block, true)
  assert.equal(c.report(1)!.counts.popups, 1)
  assert.equal(c.popup({ url: 'https://docs.example/help', webContentsId: 1, now: 1000 }).block, false)
  assert.equal(c.popup({ url: 'https://docs.example/help2', webContentsId: 1, now: 2000 }).block, false)
  const spam = c.popup({ url: 'https://docs.example/help3', webContentsId: 1, now: 3000 })
  assert.equal(spam.block, true)
  assert.match(spam.block ? spam.reason : '', /kept opening/)
  const clicks = core()
  for (let i = 0; i < 5; i++) assert.equal(clicks.popup({ url: `https://docs.example/link${i}`, webContentsId: 1, now: 1000 + i * 100, userOpened: true }).block, false, 'links the user opens one after another')
  assert.equal(clicks.popup({ url: 'https://popads.example/go', webContentsId: 1, userOpened: true }).block, true, 'an ad server stays blocked even when clicked')
  const strict = core('strict')
  assert.equal(strict.popup({ url: 'https://shop.example/', webContentsId: 1, openerUrl: 'https://thirdparty-frame.example/ad' }).block, true)
  assert.equal(core().popup({ url: 'https://sub.popads.example/x', webContentsId: 1 }).block, true, 'subdomains of a popup ad server too')
  assert.equal(core().popup({ url: 'https://adserver.example/landing', webContentsId: 1 }).block, true, 'a popup to a blocked ad server')
  assert.deepEqual(extractPopupHosts('||a.example^$popup\n||b.example^$popup,third-party\n||c.example^$popup,domain=x.com\n||d.example^\n@@||e.example^$popup'), ['a.example', 'b.example'])
})

test('redirects: navigations to ad servers are stopped, ordinary cross-site and same-site navigations are not', () => {
  const c = core()
  const toAd = c.navigation({ url: 'https://adserver.example/click?id=1', webContentsId: 1, redirect: true })
  assert.equal(toAd.block, true)
  assert.equal(c.report(1)!.counts.redirects, 1)
  assert.equal(c.navigation({ url: 'https://wikipedia.org/wiki/News', webContentsId: 1, redirect: false }).block, false)
  assert.equal(c.navigation({ url: 'https://news.example/other', webContentsId: 1, redirect: false }).block, false)
  c.updateSettings({ level: 'custom', custom: { ads: true, trackers: true, annoyances: true, popups: true, redirects: false } })
  assert.equal(c.navigation({ url: 'https://adserver.example/click', webContentsId: 1, redirect: true }).block, false)
})

// ---------- Filter list store ----------

const listText = (prefix: string, n: number): string => `! Title: ${prefix}\n${Array.from({ length: n }, (_, i) => `||${prefix}${i}.example^`).join('\n')}\n`
const RESOURCES = JSON.stringify({ scriptlets: [{ name: 'noop.js', body: '' }] })

async function setup(): Promise<{ dir: string; bundled: string; catalog: Catalog; remote: Map<string, string>; store: FilterStore; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'orbis-adblock-'))
  const bundled = join(root, 'bundled')
  const dir = join(root, 'data')
  const catalog: Catalog = {
    version: 1,
    minFilters: 10,
    updateIntervalHours: 24,
    resources: { id: 'res', name: 'Resources', url: 'https://lists.test/res.json' },
    lists: [
      { id: 'ads', name: 'Ads', category: 'ads', url: 'https://lists.test/ads.txt' },
      { id: 'trk', name: 'Trackers', category: 'trackers', url: 'https://lists.test/trk.txt' },
      { id: 'compat', name: 'Compat', category: 'orbis', file: 'compat.txt' }
    ]
  }
  await mkdir(join(bundled, 'lists'), { recursive: true })
  const initial: Record<string, string> = { ads: listText('ad', 40), trk: listText('trk', 30), res: RESOURCES }
  const manifest = { version: '2026-09-01T00:00:00.000Z', lists: {} as Record<string, unknown> }
  for (const [id, text] of Object.entries(initial)) {
    await writeFile(join(bundled, 'lists', `${id}.txt`), text)
    manifest.lists[id] = { file: `${id}.txt`, checksum: sha256(text), bytes: text.length }
  }
  await writeFile(join(bundled, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(bundled, 'compat.txt'), 'youtube.com##ytd-ad-slot-renderer\n')
  const remote = new Map<string, string>(Object.entries({ 'https://lists.test/ads.txt': initial.ads, 'https://lists.test/trk.txt': initial.trk, 'https://lists.test/res.json': RESOURCES }))
  const fetchFn = async (url: string): Promise<Response> => (remote.has(url) ? new Response(remote.get(url)) : new Response('gone', { status: 404 }))
  const store = new FilterStore({ dir, bundledDir: bundled, catalog, fetchFn, now: () => Date.parse('2026-09-15T10:00:00Z') })
  return { dir, bundled, catalog, remote, store, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('first run installs the lists that ship with Orbis, including bundled-only rules', async () => {
  const s = await setup()
  try {
    const loaded = await s.store.load()
    assert.equal(loaded.recovered, undefined)
    assert.equal(loaded.manifest.version, '2026-09-01T00:00:00.000Z')
    assert.equal(loaded.manifest.lists.ads.source, 'bundled')
    assert.equal(loaded.manifest.lists.ads.rules, 40)
    assert.match(loaded.texts.get('compat') ?? '', /ytd-ad-slot-renderer/)
    assert.equal(loaded.canRollback, false)
  } finally {
    await s.cleanup()
  }
})

test('updates install only valid, changed lists, keep the old version for rollback, and roll back', async () => {
  const s = await setup()
  try {
    await s.store.load()
    s.remote.set('https://lists.test/ads.txt', listText('ad', 45))
    s.remote.set('https://lists.test/res.json', '<!doctype html><title>Error</title>')
    const result = await s.store.update()
    assert.deepEqual(result.updated, ['ads'])
    assert.deepEqual(result.unchanged, ['trk'], 'an identical download is recognised as a duplicate')
    assert.deepEqual(result.failed, [{ id: 'res', reason: 'got a web page instead of a filter list' }])
    const after = await s.store.load()
    assert.equal(after.manifest.lists.ads.rules, 45)
    assert.equal(after.manifest.lists.ads.source, 'downloaded')
    assert.equal(after.texts.get('res'), RESOURCES, 'a failed list keeps its current copy')
    assert.equal(after.canRollback, true)

    s.remote.set('https://lists.test/ads.txt', listText('ad', 12))
    const truncated = await s.store.update()
    assert.match(truncated.failed.find((f) => f.id === 'ads')?.reason ?? '', /less than half/)
    assert.deepEqual(truncated.updated, [])

    await s.store.rollback()
    assert.equal((await s.store.load()).manifest.lists.ads.rules, 40)
  } finally {
    await s.cleanup()
  }
})

test('damaged lists are recovered from the previous version, then from the bundled lists', async () => {
  const s = await setup()
  try {
    await s.store.load()
    s.remote.set('https://lists.test/ads.txt', listText('ad', 50))
    await s.store.update()
    await writeFile(join(s.dir, 'current', 'lists', 'ads.txt'), 'garbage')
    const fromPrevious = await s.store.load()
    assert.match(fromPrevious.recovered ?? '', /previous version/)
    assert.equal(fromPrevious.manifest.lists.ads.rules, 40)

    await writeFile(join(s.dir, 'current', 'manifest.json'), '{not json')
    const fromBundle = await s.store.load()
    assert.match(fromBundle.recovered ?? '', /lists that ship with it/)
    assert.equal(JSON.parse(await readFile(join(s.dir, 'current', 'manifest.json'), 'utf8')).version, '2026-09-01T00:00:00.000Z')
  } finally {
    await s.cleanup()
  }
})

test('compiled engines are cached and stale caches pruned', async () => {
  const s = await setup()
  try {
    const bytes = FiltersEngine.parse('||x.example^', ENGINE_CONFIG).serialize()
    await s.store.writeEngine('ads-old', bytes, ['ads-old'])
    await s.store.writeEngine('ads-new', bytes, ['ads-new'])
    assert.equal(await s.store.readEngine('ads-old'), null)
    const cached = await s.store.readEngine('ads-new')
    assert.ok(FiltersEngine.deserialize(cached!).match)
  } finally {
    await s.cleanup()
  }
})

test('list validation and rule counting', () => {
  assert.equal(countRules('! comment\n[Adblock Plus 2.0]\n# hosts comment\n||a.com^\n##.ad\n\n'), 2)
  assert.equal(validateList('', 'list', 1), 'the download was empty')
  assert.equal(validateList('||a^\n'.repeat(30), 'list', 10, 100), 'it has only 30 rules, less than half of the 100 before (probably cut off)')
  assert.equal(validateList('{}', 'resources', 1), 'the resources file has no entries')
  assert.equal(validateList('||a^\n'.repeat(30), 'list', 10, 40), null)
})
