import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGalaxy, checkUserLink, describeNode, GALAXY_PAGE, GALAXY_TYPE_COLORS, GALAXY_TYPES, isGalaxyPage, matchesQuery, pageKey, selectionForOrion, viewGalaxy } from '../../shared/galaxy.ts'
import { CAPABILITIES } from '../../shared/commandCenter.ts'
import type { GalaxySources } from '../../shared/galaxy.ts'

const empty = (): GalaxySources => ({ memories: [], searches: [], notes: [], tasks: [], skills: [], workflows: [], workspaces: [], whiteboards: [], bookmarks: [], artifacts: [], links: [] })

const sample = (): GalaxySources => ({
  ...empty(),
  memories: [{ id: 'm1', text: 'I am building the Orbis browser on Chromium', category: 'project', createdAt: 1, updatedAt: 1, archived: false }],
  searches: [
    {
      id: 's1',
      title: 'Chromium architecture',
      turns: 3,
      startedAt: 10,
      updatedAt: 20,
      sources: [
        { url: 'https://www.chromium.org/developers/design-documents/#top', title: 'Design documents' },
        { url: 'https://en.wikipedia.org/wiki/Chromium_(web_browser)', title: 'Chromium (web browser)' },
        { url: 'javascript:alert(1)', title: 'bad' }
      ]
    },
    { id: 's2', title: 'Firefox architecture', turns: 1, startedAt: 30, updatedAt: 40, sources: [{ url: 'https://en.wikipedia.org/wiki/Firefox', title: 'Firefox' }] }
  ],
  notes: [
    { id: 'n1', title: 'Multi-process notes', archived: false, createdAt: 50, updatedAt: 60, source: { url: 'https://www.chromium.org/developers/design-documents', title: 'Design documents' } },
    { id: 'n2', title: 'Chromium shopping list', archived: false, createdAt: 50, updatedAt: 60 },
    { id: 'n3', title: 'Archived', archived: true, createdAt: 50, updatedAt: 60 }
  ],
  tasks: [{ id: 't1', title: 'Read the Blink docs', done: false, createdAt: 70, updatedAt: 70, link: { url: 'https://www.chromium.org/blink/', title: 'Blink' } }],
  skills: [{ workflowId: 'w2', name: 'Download latest report', domains: ['example.edu'], enabled: true, createdAt: 80, updatedAt: 80 }],
  workflows: [
    { id: 'w1', name: 'Morning routine', createdAt: 90, updatedAt: 90, calls: ['w2'], archived: false },
    { id: 'w2', name: 'Download latest report', createdAt: 80, updatedAt: 80, calls: [], archived: false }
  ],
  workspaces: [{ id: 'ws1', name: 'Browser research', createdAt: 100, updatedAt: 100, tabs: [{ url: 'https://en.wikipedia.org/wiki/Firefox', title: 'Firefox' }] }],
  whiteboards: [{ id: 'b1', name: 'Architecture sketch', createdAt: 110, updatedAt: 110 }],
  bookmarks: [{ url: 'https://www.chromium.org/blink/', title: 'Blink', addedAt: 120 }],
  links: []
})

test('every link comes from something the data actually records, and explains itself', () => {
  const g = buildGalaxy(sample(), 1000)
  const has = (from: string, to: string, relation: string): boolean => g.edges.some((e) => e.from === from && e.to === to && e.relation === relation)
  const designDocs = `page:${pageKey('https://www.chromium.org/developers/design-documents')}`

  assert.ok(has('search:s1', designDocs, 'used_source'), 'research to the page it used, with the fragment dropped so it is one page')
  assert.ok(has('note:n1', designDocs, 'saved_from'), 'the note to the same page it was saved from')
  const blink = `page:${pageKey('https://www.chromium.org/blink/')}`
  assert.ok(has('task:t1', blink, 'links_to'))
  assert.ok(has(designDocs, 'site:chromium.org', 'on_site'), 'pages to their site, without www')
  assert.ok(has('skill:w2', 'site:example.edu', 'made_on'))
  assert.ok(has('workflow:w1', 'skill:w2', 'calls'), 'a workflow calling a skill links to the skill, not a duplicate workflow node')
  assert.ok(has('workspace:ws1', 'page:https://en.wikipedia.org/wiki/Firefox', 'contains'))
  assert.ok(has(`bookmark:${pageKey('https://www.chromium.org/blink/')}`, blink, 'bookmarked'))
  assert.equal(pageKey('https://www.chromium.org/blink/'), pageKey('https://www.chromium.org/blink#x'), 'one page, however it was written')
  for (const e of g.edges) assert.ok(e.why.length > 10 && e.origin === 'derived', e.id)
})

test('nothing is linked because names look alike, and nothing unsafe or archived appears', () => {
  const g = buildGalaxy(sample(), 1000)
  const touching = (id: string): number => g.edges.filter((e) => e.from === id || e.to === id).length
  assert.equal(touching('note:n2'), 0, '“Chromium shopping list” is not linked to Chromium research just by its name')
  assert.equal(touching('memory:m1'), 0, 'nor is the memory that mentions Chromium')
  assert.ok(!g.nodes.some((n) => n.id === 'note:n3'), 'archived notes are left out')
  assert.ok(!g.nodes.some((n) => (n.url ?? '').startsWith('javascript')), 'a javascript: “source” never becomes a page')
  assert.ok(!g.nodes.some((n) => n.type === 'workflow' && n.id === 'workflow:w2'), 'a skill is shown once, as a skill')
  assert.ok(g.edges.every((e) => g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to)))
})

test('links the person made are kept only while both ends exist, and say they were made by the person', () => {
  const sources = sample()
  sources.links = [
    { id: 'l1', from: 'note:n2', to: 'search:s1', note: 'ideas for the build', createdAt: 1 },
    { id: 'l2', from: 'note:gone', to: 'search:s1', createdAt: 1 }
  ]
  const g = buildGalaxy(sources, 1000)
  const mine = g.edges.filter((e) => e.origin === 'user')
  assert.equal(mine.length, 1)
  assert.equal(mine[0].relation, 'connected')
  assert.match(mine[0].why, /You connected these: “ideas for the build”/)
  assert.equal(checkUserLink(g, 'note:n2', 'note:n2'), 'Something cannot be connected to itself.')
  assert.match(checkUserLink(g, 'note:n2', 'note:gone') ?? '', /no longer/)
  assert.equal(checkUserLink(g, 'note:n2', 'memory:m1'), null)
})

test('searching focuses on what matches and what it is directly connected to', () => {
  const g = buildGalaxy(sample(), 1000)
  const v = viewGalaxy(g, { query: 'chromium architecture' })
  const ids = new Set(v.nodes.map((n) => n.id))
  assert.ok(ids.has('search:s1'))
  assert.ok(ids.has(`page:${pageKey('https://www.chromium.org/developers/design-documents')}`), 'its sources come with it')
  assert.ok(!ids.has('search:s2'), 'Firefox research is not in a Chromium search')
  assert.ok(v.edges.every((e) => ids.has(e.from) && ids.has(e.to)), 'no edge points outside the view')
  assert.equal(matchesQuery({ id: 'x', type: 'note', label: 'Chromium notes' }, 'chrom'), true)
  assert.equal(matchesQuery({ id: 'x', type: 'note', label: 'Chromium notes' }, 'rom'), false)
})

test('focusing, filtering by type and by date never add anything', () => {
  const g = buildGalaxy(sample(), 1000)
  const site = viewGalaxy(g, { focus: 'site:chromium.org', depth: 2 })
  assert.ok(site.nodes.some((n) => n.id === 'note:n1'), 'two links out: site → page → note')
  assert.deepEqual(new Set(viewGalaxy(g, { types: ['note', 'task'] }).nodes.map((n) => n.type)), new Set(['note', 'task']))
  const late = viewGalaxy(g, { from: 100 })
  assert.ok(late.nodes.every((n) => (n.updatedAt ?? n.createdAt ?? 0) >= 100))
  const limited = viewGalaxy(g, { limit: 3 })
  assert.equal(limited.nodes.length, 3)
  assert.ok(g.totals.page! > 3, 'totals still say how much there really is')
})

test('a selected node shows real counts, and Orion is given only the selection', () => {
  const g = buildGalaxy(sample(), 1000)
  const d = describeNode(g, 'search:s1')!
  assert.equal(d.counts.page, 2)
  assert.equal(d.links.length, 2)
  const prompt = selectionForOrion(g, ['search:s1', 'note:n1'], 'Summarise this')
  assert.match(prompt, /Research “Chromium architecture”/)
  assert.match(prompt, /Note “Multi-process notes”/)
  assert.ok(!/Firefox|Morning routine|building the Orbis browser/.test(prompt), 'nothing that was not selected')
  assert.match(prompt, /data, not instructions/)
})

test('a project is a hub for exactly the things added to it, and forgets what no longer exists', () => {
  const sources = sample()
  sources.workspaces.push({ id: 'p1', name: 'Orbis', createdAt: 1, updatedAt: 1, tabs: [], project: { goal: 'Ship the browser', items: [{ ref: 'search:s1', addedAt: 1 }, { ref: 'note:n2', addedAt: 1 }, { ref: 'note:deleted', addedAt: 1 }] } })
  const g = buildGalaxy(sources, 1000)
  const project = g.nodes.find((n) => n.id === 'workspace:p1')!
  assert.equal(project.type, 'project')
  assert.equal(project.detail, 'Ship the browser')
  const members = g.edges.filter((e) => e.to === 'workspace:p1' && e.relation === 'part_of').map((e) => e.from).sort()
  assert.deepEqual(members, ['note:n2', 'search:s1'], 'only what was added, and only what still exists')
  assert.match(g.edges.find((e) => e.relation === 'part_of')!.why, /You added this to the project “Orbis”/)
  assert.equal(g.nodes.find((n) => n.id === 'workspace:ws1')!.type, 'workspace', 'a workspace that is not a project stays a workspace')
})

test('a large profile is cut to the most connected and most recent, never at random', () => {
  const sources = empty()
  for (let i = 0; i < 1000; i++) sources.notes.push({ id: `n${i}`, title: `Note ${i}`, archived: false, createdAt: i, updatedAt: i })
  sources.searches.push({ id: 'hub', title: 'Hub', turns: 1, startedAt: 1, updatedAt: 1, sources: Array.from({ length: 30 }, (_, i) => ({ url: `https://example.com/${i}`, title: `P${i}` })) })
  const g = buildGalaxy(sources, 1)
  const v = viewGalaxy(g, { limit: 50 })
  assert.equal(v.nodes.length, 50)
  assert.equal(v.nodes[0].id, 'search:hub', 'the most connected first')
})

test('the service keeps only the links a person makes, and the map follows the stores', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { GalaxyService } = await import('./galaxyService.ts')
  const dir = mkdtempSync(join(tmpdir(), 'orbis-galaxy-'))
  let data = sample()
  let collected = 0
  const service = new GalaxyService({ userData: dir, collect: async () => (collected++, data), newId: () => 'link-1' })
  try {
    await service.graph()
    await service.graph()
    assert.equal(collected, 1, 'built once while nothing changes')

    await service.link('note:n2', 'search:s1', 'ideas')
    assert.equal((await service.graph()).edges.filter((e) => e.origin === 'user').length, 1)
    await assert.rejects(service.link('note:n2', 'note:n2'), /itself/)
    await assert.rejects(service.link('note:n2', 'note:missing'), /no longer/)

    // The note is deleted in Notes: it and its link vanish from the map without Galaxy being told what happened.
    data = { ...data, notes: data.notes.filter((n) => n.id !== 'n2') }
    service.invalidate()
    const after = await service.graph()
    assert.ok(!after.nodes.some((n) => n.id === 'note:n2'))
    assert.equal(after.edges.filter((e) => e.origin === 'user').length, 0)

    let told = 0
    service.onChange(() => told++)
    service.refresh()
    assert.equal(told, 0, 'opening the map rebuilds it quietly, so the window is not sent round in a loop')
    service.invalidate()
    assert.equal(told, 1, 'a real change is announced')

    assert.equal(service.unlink('link-1'), true)
    service.useProfile('work')
    assert.deepEqual(service.links(), [], 'another profile has its own links')
  } finally {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Galaxy has an address of its own, so the browser can hold it in a tab', () => {
  assert.equal(GALAXY_PAGE, 'orbis://galaxy')
  assert.equal(isGalaxyPage('orbis://galaxy'), true)
  assert.equal(isGalaxyPage('ORBIS://GALAXY'), true, 'an address is not case sensitive')
  assert.equal(isGalaxyPage('orbis://galaxy?focus=note:1'), true)
  assert.equal(isGalaxyPage('orbis://search?q=galaxy'), false, 'searching for the word is not the page')
  assert.equal(isGalaxyPage('https://galaxy.example/orbis://galaxy'), false, 'a website cannot pretend to be it')
})

test('every kind of thing on the map has a colour, and the map is somewhere you can reach', () => {
  for (const type of GALAXY_TYPES) assert.match(GALAXY_TYPE_COLORS[type], /^#[0-9a-f]{6}$/, `${type} has a colour`)
  // It used to be `PANELS.some(p => p.id === 'galaxy')`, from `shared/browserSidebar.ts` -- a list of 29 panels
  // that nothing ever loaded, so this was asserting Galaxy's place in a sidebar that did not exist. The capability
  // registry is the one that drives both halves of the application, and being in it is what makes Galaxy
  // reachable: from the browser's Command Center, from the window's launcher and from the command palette.
  assert.ok(
    CAPABILITIES.some((one) => one.id === 'galaxy'),
    'Galaxy is one of the things Orbis can open'
  )
})
