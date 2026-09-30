/**
 * Multi-Page applications: identity, routes, navigation, shared state and contracts.
 *
 * The cases here check behaviour that has a consequence — a route that resolves to the wrong Page, a second writer
 * on a shared value, a version mismatch passed through unconverted. None of them assert merely that a value came
 * back.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  APPLICATION_ASSUMPTIONS,
  APPLICATION_LIMITS,
  APPS_ROOT,
  addAdapter,
  addContract,
  addFlow,
  addGroup,
  addPage,
  addSharedValue,
  allRoutes,
  applicationAddress,
  applicationErrors,
  applicationToJson,
  applicationIsPublishable,
  bindState,
  canonicalApplicationAddress,
  checkApplication,
  describeApplication,
  emptyApplication,
  flowOrder,
  isApplicationAddress,
  isApplicationError,
  isApplicationId,
  makeApplicationId,
  movePage,
  navigationTree,
  needsMigration,
  parseApplicationAddress,
  parseRoute,
  removePage,
  readApplication,
  reorderPages,
  resolveRoute,
  routeToText,
  setDefaultRoute,
  staleAfter,
  type PageApplication
} from './application.ts'
import { makePageId } from './identity.ts'

const ok = <T>(value: T, label: string): Exclude<T, { error: unknown }> => {
  if (typeof value === 'object' && value !== null && 'error' in value) {
    assert.fail(`${label} was refused: ${String((value as { message?: unknown }).message)}`)
  }
  return value as Exclude<T, { error: unknown }>
}

const PAGE_A = makePageId('aaaaaaaaaaaa')
const PAGE_B = makePageId('bbbbbbbbbbbb')
const PAGE_C = makePageId('cccccccccccc')
const PAGE_D = makePageId('dddddddddddd')

const base = (): PageApplication =>
  ok(
    emptyApplication({
      applicationId: makeApplicationId('abcdefabcdef'),
      slug: 'research',
      title: 'Research',
      ownerProfile: 'profile-1'
    }),
    'emptyApplication'
  )

/** An application with four Pages, a contract, a shared value and a chain of flows. */
const built = (): PageApplication => {
  let app = base()
  app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'home')
  app = ok(addPage(app, { pageId: PAGE_B, route: '/data', label: 'Data' }), 'data')
  app = ok(addPage(app, { pageId: PAGE_C, route: '/analysis', label: 'Analysis' }), 'analysis')
  app = ok(addPage(app, { pageId: PAGE_D, route: '/report', label: 'Report' }), 'report')
  app = ok(
    addContract(app, {
      id: 'dataset',
      version: 1,
      fields: { rows: 'list', columns: 'list' },
      optional: [],
      description: 'A table of rows and named columns.'
    }),
    'contract'
  )
  app = ok(
    addSharedValue(app, {
      name: 'selectedDataset',
      contract: 'dataset',
      owner: PAGE_B,
      readableByAll: true,
      description: 'Whichever dataset the person is working on.'
    }),
    'shared value'
  )
  app = ok(bindState(app, { pageId: PAGE_C, value: 'selectedDataset', direction: 'reads' }), 'bind read')
  app = ok(
    addFlow(app, { from: PAGE_B, to: PAGE_C, contract: 'dataset', producesVersion: 1, expectsVersion: 1 }),
    'flow b-c'
  )
  app = ok(
    addFlow(app, { from: PAGE_C, to: PAGE_D, contract: 'dataset', producesVersion: 1, expectsVersion: 1 }),
    'flow c-d'
  )
  return app
}

// ---------------------------------------------------------------- identity

describe('application identity', () => {
  it('makes an id that is recognisable as one', () => {
    const id = makeApplicationId('0123456789abcdef')
    assert.ok(isApplicationId(id))
    assert.match(id, /^app_/)
  })

  it('refuses a Page id as an application id', () => {
    assert.equal(isApplicationId(makePageId('aaaaaaaaaaaa')), false)
  })

  it('refuses too little randomness rather than making a guessable id', () => {
    assert.throws(() => makeApplicationId('abc'), /at least 12/)
  })

  it('refuses a reserved name', () => {
    const result = emptyApplication({
      applicationId: makeApplicationId('abcdefabcdef'),
      slug: 'settings',
      title: 'Settings',
      ownerProfile: 'p'
    })
    assert.ok(isApplicationError(result))
    assert.match(result.message, /reserved/)
  })

  it('refuses an application with no owning profile', () => {
    const result = emptyApplication({
      applicationId: makeApplicationId('abcdefabcdef'),
      slug: 'research',
      title: 'Research',
      ownerProfile: ''
    })
    assert.ok(isApplicationError(result))
  })

  it('starts with no pages and no default route', () => {
    const app = base()
    assert.equal(app.pages.length, 0)
    assert.deepEqual(app.defaultRoute, [])
  })
})

describe('application addresses', () => {
  it('recognises its own root', () => {
    assert.ok(isApplicationAddress(APPS_ROOT))
    assert.ok(isApplicationAddress(`${APPS_ROOT}/research/data`))
    assert.equal(isApplicationAddress('orbis://pages/research'), false)
    assert.equal(isApplicationAddress('https://example.com'), false)
  })

  it('reads a slug and a route', () => {
    const parsed = ok(parseApplicationAddress(`${APPS_ROOT}/research/data`), 'parse')
    assert.equal(parsed.slug, 'research')
    assert.deepEqual(parsed.route, ['data'])
  })

  it('reads a pinned version', () => {
    const parsed = ok(parseApplicationAddress(`${APPS_ROOT}/research@2.1.0/data`), 'pinned')
    assert.deepEqual(parsed.version, { major: 2, minor: 1, patch: 0 })
  })

  it('refuses a version that is not one', () => {
    const result = parseApplicationAddress(`${APPS_ROOT}/research@latest`)
    assert.ok('error' in result)
    assert.match(result.message, /looks like "1.2.3"/)
  })

  it('reads query parameters', () => {
    const parsed = ok(parseApplicationAddress(`${APPS_ROOT}/research/data?view=table&sort=name`), 'params')
    assert.equal(parsed.params.view, 'table')
    assert.equal(parsed.params.sort, 'name')
  })

  it('says the root is the library rather than an application', () => {
    const result = parseApplicationAddress(APPS_ROOT)
    assert.ok('error' in result)
    assert.match(result.message, /library/)
  })

  it('round-trips every address it accepts', () => {
    const cases: [string, NonNullable<Parameters<typeof applicationAddress>[1]>][] = [
      ['research', {}],
      ['research', { route: ['data'] }],
      ['research', { route: ['projects', 'alpha'] }],
      ['research', { version: { major: 2, minor: 0, patch: 1 } }],
      ['research', { route: ['data'], params: { view: 'table' } }]
    ]
    for (const [slug, options] of cases) {
      const url = applicationAddress(slug, options)
      const parsed = ok(parseApplicationAddress(url), url)
      assert.equal(parsed.slug, slug, url)
      assert.deepEqual(parsed.route, options.route ?? [], url)
      assert.deepEqual(parsed.version, options.version ?? null, url)
      assert.deepEqual({ ...parsed.params }, options.params ?? {}, url)
    }
  })

  it('gives a canonical address with no route or version', () => {
    assert.equal(canonicalApplicationAddress('research'), `${APPS_ROOT}/research`)
  })

  it('does not collide with the Pages address space', () => {
    assert.notEqual(APPS_ROOT, 'orbis://pages')
    assert.equal(isApplicationAddress('orbis://pages/research'), false)
  })
})

// ---------------------------------------------------------------- routes

describe('routes', () => {
  it('treats an empty route and a slash as the root', () => {
    assert.deepEqual(parseRoute(''), [])
    assert.deepEqual(parseRoute('/'), [])
  })

  it('normalises leading and trailing slashes', () => {
    assert.deepEqual(parseRoute('/data/'), ['data'])
  })

  it('accepts a dynamic segment', () => {
    assert.deepEqual(parseRoute('/projects/:projectId'), ['projects', ':projectId'])
  })

  it('refuses a path walk rather than resolving it', () => {
    const result = parseRoute('/data/../secrets')
    assert.ok('error' in result)
    assert.match(result.message, /not a path walk/)
  })

  it('refuses an uppercase segment, so one route cannot have two spellings', () => {
    const result = parseRoute('/Data')
    assert.ok('error' in result)
  })

  it('refuses a route deeper than the limit', () => {
    const result = parseRoute('/a/b/c/d/e')
    assert.ok('error' in result)
    assert.match(result.message, /segments/)
  })

  it('writes the root as a single slash', () => {
    assert.equal(routeToText([]), '/')
    assert.equal(routeToText(['data']), '/data')
  })
})

describe('resolving a route', () => {
  it('finds the Page at an exact route', () => {
    const resolved = ok(resolveRoute(built(), '/analysis'), 'exact')
    assert.equal(resolved.pageId, PAGE_C)
    assert.equal(resolved.exact, true)
  })

  it('falls back to the default route when given none', () => {
    const resolved = ok(resolveRoute(built(), '/'), 'default')
    assert.equal(resolved.pageId, PAGE_A)
  })

  it('fills a dynamic segment', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/projects/:projectId', label: 'Project' }), 'dynamic')
    const resolved = ok(resolveRoute(app, '/projects/alpha'), 'params')
    assert.equal(resolved.params.projectId, 'alpha')
    assert.equal(resolved.exact, false)
  })

  it('prefers an exact route over a dynamic one that also matches', () => {
    let app = base()
    // Added in the order that would break if the first match won.
    app = ok(addPage(app, { pageId: PAGE_A, route: '/projects/:projectId', label: 'Project' }), 'dynamic')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/projects/archive', label: 'Archive' }), 'exact')
    const resolved = ok(resolveRoute(app, '/projects/archive'), 'exact wins')
    assert.equal(resolved.pageId, PAGE_B)
    assert.equal(resolved.exact, true)
  })

  it('prefers the dynamic route with more literal segments', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/:kind/:id', label: 'Anything' }), 'loose')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/projects/:id', label: 'Project' }), 'tight')
    const resolved = ok(resolveRoute(app, '/projects/alpha'), 'specific wins')
    assert.equal(resolved.pageId, PAGE_B)
  })

  it('says what the application does answer when a route misses', () => {
    const result = resolveRoute(built(), '/nowhere')
    assert.ok(isApplicationError(result))
    assert.match(result.message, /Research/)
  })

  it('still resolves a hidden Page, because hiding is not unpublishing', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'home')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/secret', label: 'Notes', visibility: 'hidden' }), 'hidden')
    const resolved = ok(resolveRoute(app, '/secret'), 'hidden resolves')
    assert.equal(resolved.pageId, PAGE_B)
    // And it is absent from the navigation.
    assert.equal(
      navigationTree(app).some((one) => one.id === PAGE_B),
      false
    )
  })

  it('lists every route', () => {
    assert.deepEqual(allRoutes(built()), ['/', '/analysis', '/data', '/report'])
  })
})

// ---------------------------------------------------------------- building

describe('adding Pages', () => {
  it('makes the first Page the default route', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/home', label: 'Home' }), 'first')
    assert.deepEqual(app.defaultRoute, ['home'])
  })

  it('does not move the default route when a second Page is added', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/home', label: 'Home' }), 'first')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/data', label: 'Data' }), 'second')
    assert.deepEqual(app.defaultRoute, ['home'])
  })

  it('refuses two Pages on one route', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/data', label: 'Data' }), 'first')
    const result = addPage(app, { pageId: PAGE_B, route: '/data', label: 'Also data' })
    assert.ok(isApplicationError(result))
    assert.match(result.message, /arbitrarily/)
  })

  it('refuses the same Page twice', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/one', label: 'One' }), 'first')
    const result = addPage(app, { pageId: PAGE_A, route: '/two', label: 'Two' })
    assert.ok(isApplicationError(result))
    assert.match(result.message, /ambiguous/)
  })

  it('refuses a value that is not a Page id', () => {
    const result = addPage(base(), { pageId: 'not-a-page', route: '/x', label: 'X' })
    assert.ok(isApplicationError(result))
  })

  it('refuses configuration that could carry behaviour', () => {
    const result = addPage(base(), {
      pageId: PAGE_A,
      route: '/x',
      label: 'X',
      configuration: { run: (() => 1) as unknown as string }
    })
    assert.ok(isApplicationError(result))
    assert.match(result.message, /plain data/)
  })

  it('refuses a group that does not exist', () => {
    const result = addPage(base(), { pageId: PAGE_A, route: '/x', label: 'X', group: 'nope' })
    assert.ok(isApplicationError(result))
  })

  it('refuses a Page with no label', () => {
    const result = addPage(base(), { pageId: PAGE_A, route: '/x', label: '  ' })
    assert.ok(isApplicationError(result))
  })
})

describe('removing a Page', () => {
  it('leaves the Page itself alone and reports what else went', () => {
    const removed = ok(removePage(built(), PAGE_B), 'remove')
    assert.equal(removed.application.pages.length, 3)
    // PAGE_B owned the shared value and was in a flow.
    assert.ok(removed.alsoRemoved.some((one) => /selectedDataset/.test(one)))
    assert.ok(removed.alsoRemoved.some((one) => /data flow/.test(one)))
  })

  it('takes the bindings that pointed at an orphaned value', () => {
    const removed = ok(removePage(built(), PAGE_B), 'remove')
    assert.equal(
      removed.application.bindings.some((one) => one.value === 'selectedDataset'),
      false
    )
  })

  it('leaves no flow naming a Page that has gone', () => {
    const removed = ok(removePage(built(), PAGE_C), 'remove middle')
    const ids = new Set(removed.application.pages.map((one) => one.pageId))
    for (const flow of removed.application.flows) {
      assert.ok(ids.has(flow.from) && ids.has(flow.to), 'a flow outlived its Page')
    }
  })

  it('moves the default route when the default Page is removed', () => {
    const removed = ok(removePage(built(), PAGE_A), 'remove home')
    assert.notEqual(routeToText(removed.application.defaultRoute), '/')
    assert.ok(
      removed.application.pages.some(
        (one) => routeToText(one.route) === routeToText(removed.application.defaultRoute)
      )
    )
  })

  it('refuses to remove a Page that is not there', () => {
    const result = removePage(built(), makePageId('zzzzzzzzzzzz'))
    assert.ok(isApplicationError(result))
  })

  it('leaves a valid application behind', () => {
    const removed = ok(removePage(built(), PAGE_B), 'remove')
    assert.equal(applicationErrors(checkApplication(removed.application)).length, 0)
  })
})

describe('navigation', () => {
  it('groups Pages under a group', () => {
    let app = base()
    app = ok(addGroup(app, { id: 'sources', label: 'Sources' }), 'group')
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'home')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/papers', label: 'Papers', group: 'sources' }), 'in group')
    const tree = navigationTree(app)
    const group = tree.find((one) => one.kind === 'group')
    assert.ok(group !== undefined)
    assert.equal(group?.children.length, 1)
    assert.equal(group?.children[0].id, PAGE_B)
  })

  it('nests one level', () => {
    let app = base()
    app = ok(addGroup(app, { id: 'research', label: 'Research' }), 'outer')
    app = ok(addGroup(app, { id: 'sources', label: 'Sources', parent: 'research' }), 'inner')
    app = ok(addPage(app, { pageId: PAGE_A, route: '/papers', label: 'Papers', group: 'sources' }), 'page')
    const tree = navigationTree(app)
    assert.equal(tree[0].children[0].id, 'sources')
    assert.equal(tree[0].children[0].children[0].id, PAGE_A)
  })

  it('refuses a third level, which stops being navigable', () => {
    let app = base()
    app = ok(addGroup(app, { id: 'a', label: 'A' }), 'a')
    app = ok(addGroup(app, { id: 'b', label: 'B', parent: 'a' }), 'b')
    const result = addGroup(app, { id: 'c', label: 'C', parent: 'b' })
    assert.ok(isApplicationError(result))
    assert.match(result.message, /levels/)
  })

  it('refuses a duplicate group', () => {
    let app = base()
    app = ok(addGroup(app, { id: 'sources', label: 'Sources' }), 'first')
    assert.ok(isApplicationError(addGroup(app, { id: 'sources', label: 'Again' })))
  })

  it('orders by the order field, not by insertion', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/a', label: 'A', order: 2 }), 'a')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/b', label: 'B', order: 1 }), 'b')
    assert.deepEqual(
      navigationTree(app).map((one) => one.label),
      ['B', 'A']
    )
  })

  it('reorders without changing what a route resolves to', () => {
    const before = built()
    const after = ok(reorderPages(before, [PAGE_D, PAGE_C, PAGE_B, PAGE_A]), 'reorder')
    assert.deepEqual(
      navigationTree(after).map((one) => one.label),
      ['Report', 'Analysis', 'Data', 'Home']
    )
    assert.equal(ok(resolveRoute(after, '/analysis'), 'still resolves').pageId, PAGE_C)
  })

  it('refuses to reorder a Page that is not there', () => {
    assert.ok(isApplicationError(reorderPages(built(), [makePageId('zzzzzzzzzzzz')])))
  })
})

describe('moving a Page', () => {
  it('changes its route', () => {
    const app = ok(movePage(built(), PAGE_C, '/analyse'), 'move')
    assert.equal(ok(resolveRoute(app, '/analyse'), 'new route').pageId, PAGE_C)
    assert.ok(isApplicationError(resolveRoute(app, '/analysis')))
  })

  it('carries the default route with it', () => {
    const app = ok(movePage(built(), PAGE_A, '/start'), 'move home')
    assert.deepEqual(app.defaultRoute, ['start'])
  })

  it('refuses a move onto an occupied route', () => {
    const result = movePage(built(), PAGE_C, '/data')
    assert.ok(isApplicationError(result))
  })

  it('sets a default route only to one a Page answers', () => {
    assert.ok(isApplicationError(setDefaultRoute(built(), '/nowhere')))
    const app = ok(setDefaultRoute(built(), '/data'), 'set default')
    assert.equal(ok(resolveRoute(app, '/'), 'opens at data').pageId, PAGE_B)
  })
})

// ---------------------------------------------------------------- shared state

describe('shared state', () => {
  it('records the owner as a writer without being asked', () => {
    const app = built()
    assert.ok(
      app.bindings.some(
        (one) => one.pageId === PAGE_B && one.value === 'selectedDataset' && one.direction === 'writes'
      )
    )
  })

  it('refuses a second writer', () => {
    const result = bindState(built(), { pageId: PAGE_C, value: 'selectedDataset', direction: 'writes' })
    assert.ok(isApplicationError(result))
    assert.equal(result.error, 'not-permitted')
    assert.match(result.message, /Two Pages writing one value/)
  })

  it('allows any Page to read a readable value', () => {
    const app = ok(bindState(built(), { pageId: PAGE_D, value: 'selectedDataset', direction: 'reads' }), 'read')
    assert.ok(app.bindings.some((one) => one.pageId === PAGE_D && one.direction === 'reads'))
  })

  it('refuses a read of a private value', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'a')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/b', label: 'B' }), 'b')
    app = ok(
      addContract(app, { id: 'note', version: 1, fields: { text: 'text' }, optional: [], description: '' }),
      'contract'
    )
    app = ok(
      addSharedValue(app, {
        name: 'draft',
        contract: 'note',
        owner: PAGE_A,
        readableByAll: false,
        description: ''
      }),
      'private value'
    )
    const result = bindState(app, { pageId: PAGE_B, value: 'draft', direction: 'reads' })
    assert.ok(isApplicationError(result))
    assert.match(result.message, /private/)
  })

  it('refuses a value owned by a Page outside the application', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'a')
    app = ok(
      addContract(app, { id: 'note', version: 1, fields: { text: 'text' }, optional: [], description: '' }),
      'contract'
    )
    const result = addSharedValue(app, {
      name: 'x',
      contract: 'note',
      owner: makePageId('zzzzzzzzzzzz'),
      readableByAll: true,
      description: ''
    })
    assert.ok(isApplicationError(result))
    assert.match(result.message, /ambient-global/)
  })

  it('refuses a value with no contract to describe its shape', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'a')
    const result = addSharedValue(app, {
      name: 'x',
      contract: 'nothing',
      owner: PAGE_A,
      readableByAll: true,
      description: ''
    })
    assert.ok(isApplicationError(result))
  })

  it('refuses a duplicate value name', () => {
    const result = addSharedValue(built(), {
      name: 'selectedDataset',
      contract: 'dataset',
      owner: PAGE_C,
      readableByAll: true,
      description: ''
    })
    assert.ok(isApplicationError(result))
  })

  it('treats a repeated identical binding as already done rather than an error', () => {
    const app = built()
    const again = ok(bindState(app, { pageId: PAGE_C, value: 'selectedDataset', direction: 'reads' }), 'again')
    assert.equal(again.bindings.length, app.bindings.length)
  })
})

// ---------------------------------------------------------------- contracts

describe('contracts', () => {
  it('refuses a contract with no fields', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'a')
    const result = addContract(app, { id: 'empty', version: 1, fields: {}, optional: [], description: '' })
    assert.ok(isApplicationError(result))
    assert.match(result.message, /accepts anything/)
  })

  it('refuses an optional field it does not declare', () => {
    const result = addContract(base(), {
      id: 'x',
      version: 1,
      fields: { a: 'number' },
      optional: ['b'],
      description: ''
    })
    assert.ok(isApplicationError(result))
  })

  it('allows two versions of one contract', () => {
    let app = built()
    app = ok(
      addContract(app, {
        id: 'dataset',
        version: 2,
        fields: { rows: 'list', columns: 'list', units: 'list' },
        optional: ['units'],
        description: 'Now carries units.'
      }),
      'v2'
    )
    assert.equal(app.contracts.filter((one) => one.id === 'dataset').length, 2)
  })

  it('refuses the same version twice', () => {
    const result = addContract(built(), {
      id: 'dataset',
      version: 1,
      fields: { rows: 'list' },
      optional: [],
      description: ''
    })
    assert.ok(isApplicationError(result))
  })

  it('refuses an adapter between versions that are not declared', () => {
    const result = addAdapter(built(), {
      contract: 'dataset',
      fromVersion: 1,
      toVersion: 2,
      description: '',
      loses: []
    })
    assert.ok(isApplicationError(result))
  })

  it('refuses an adapter from a version to itself', () => {
    const result = addAdapter(built(), {
      contract: 'dataset',
      fromVersion: 1,
      toVersion: 1,
      description: '',
      loses: []
    })
    assert.ok(isApplicationError(result))
  })
})

describe('flows', () => {
  it('refuses a Page feeding itself', () => {
    const result = addFlow(built(), {
      from: PAGE_B,
      to: PAGE_B,
      contract: 'dataset',
      producesVersion: 1,
      expectsVersion: 1
    })
    assert.ok(isApplicationError(result))
  })

  it('refuses a flow naming a Page outside the application', () => {
    const result = addFlow(built(), {
      from: PAGE_B,
      to: makePageId('zzzzzzzzzzzz'),
      contract: 'dataset',
      producesVersion: 1,
      expectsVersion: 1
    })
    assert.ok(isApplicationError(result))
  })

  it('gives a run order that puts producers before consumers', () => {
    const order = ok(flowOrder(built()), 'order')
    assert.ok(order.indexOf(PAGE_B) < order.indexOf(PAGE_C))
    assert.ok(order.indexOf(PAGE_C) < order.indexOf(PAGE_D))
  })

  it('gives the same order every time', () => {
    assert.deepEqual(ok(flowOrder(built()), 'once'), ok(flowOrder(built()), 'twice'))
  })

  it('reports a loop instead of an order that omits the looping Pages', () => {
    let app = built()
    app = ok(
      addFlow(app, { from: PAGE_D, to: PAGE_B, contract: 'dataset', producesVersion: 1, expectsVersion: 1 }),
      'loop'
    )
    const result = flowOrder(app)
    assert.ok(isApplicationError(result))
    assert.equal(result.error, 'cycle')
    assert.match(result.message, /caught in it/)
  })

  it('marks everything downstream of a change stale, and nothing else', () => {
    const stale = ok(staleAfter(built(), PAGE_B), 'stale')
    assert.deepEqual(stale, [PAGE_C, PAGE_D].sort())
    assert.equal(stale.includes(PAGE_A), false)
  })

  it('marks nothing stale after a leaf changes', () => {
    assert.deepEqual(ok(staleAfter(built(), PAGE_D), 'leaf'), [])
  })

  it('refuses staleness for a Page outside the application', () => {
    assert.ok(isApplicationError(staleAfter(built(), makePageId('zzzzzzzzzzzz'))))
  })
})

// ---------------------------------------------------------------- validation

describe('validation', () => {
  it('passes a well-formed application', () => {
    assert.equal(applicationErrors(checkApplication(built())).length, 0)
    assert.equal(applicationIsPublishable(built()), true)
  })

  it('reports an application with no Pages', () => {
    const problems = checkApplication(base())
    assert.equal(problems.length, 1)
    assert.equal(problems[0].kind, 'no-pages')
  })

  it('reports a default route nothing answers', () => {
    const app = { ...built(), defaultRoute: ['nowhere'] }
    const errors = applicationErrors(checkApplication(app))
    assert.ok(errors.some((one) => one.kind === 'default-route-missing'))
    assert.equal(applicationIsPublishable(app), false)
  })

  it('reports two Pages on one route even when constructed around the guard', () => {
    const app = built()
    const clashing = { ...app, pages: [...app.pages, { ...app.pages[1], pageId: PAGE_A }] }
    assert.ok(applicationErrors(checkApplication(clashing)).some((one) => one.kind === 'duplicate-route'))
  })

  it('reports a version gap with no adapter as an error', () => {
    let app = built()
    app = ok(
      addContract(app, {
        id: 'dataset',
        version: 2,
        fields: { rows: 'list', columns: 'list' },
        optional: [],
        description: ''
      }),
      'v2'
    )
    app = ok(
      addFlow(app, { from: PAGE_A, to: PAGE_D, contract: 'dataset', producesVersion: 1, expectsVersion: 2 }),
      'gap'
    )
    const errors = applicationErrors(checkApplication(app))
    const gap = errors.find((one) => one.kind === 'contract-version-gap')
    assert.ok(gap !== undefined)
    assert.match(gap?.message as string, /reinterpret/)
  })

  it('clears the version gap once an adapter is declared', () => {
    let app = built()
    app = ok(
      addContract(app, {
        id: 'dataset',
        version: 2,
        fields: { rows: 'list', columns: 'list' },
        optional: [],
        description: ''
      }),
      'v2'
    )
    app = ok(
      addFlow(app, { from: PAGE_A, to: PAGE_D, contract: 'dataset', producesVersion: 1, expectsVersion: 2 }),
      'gap'
    )
    app = ok(
      addAdapter(app, { contract: 'dataset', fromVersion: 1, toVersion: 2, description: 'Adds empty units.', loses: [] }),
      'adapter'
    )
    assert.equal(
      applicationErrors(checkApplication(app)).some((one) => one.kind === 'contract-version-gap'),
      false
    )
  })

  it('warns that a lossy adapter drops fields', () => {
    let app = built()
    app = ok(
      addContract(app, {
        id: 'dataset',
        version: 2,
        fields: { rows: 'list', columns: 'list', units: 'list' },
        optional: [],
        description: ''
      }),
      'v2'
    )
    app = ok(
      addFlow(app, { from: PAGE_A, to: PAGE_D, contract: 'dataset', producesVersion: 2, expectsVersion: 1 }),
      'downgrade'
    )
    app = ok(
      addAdapter(app, {
        contract: 'dataset',
        fromVersion: 2,
        toVersion: 1,
        description: 'Drops units.',
        loses: ['units']
      }),
      'lossy'
    )
    const problems = checkApplication(app)
    const lossy = problems.find((one) => one.kind === 'lossy-adapter')
    assert.ok(lossy !== undefined)
    assert.equal(lossy?.severity, 'warning')
    assert.match(lossy?.message as string, /units/)
  })

  it('reports a flow cycle as an error', () => {
    let app = built()
    app = ok(
      addFlow(app, { from: PAGE_D, to: PAGE_B, contract: 'dataset', producesVersion: 1, expectsVersion: 1 }),
      'loop'
    )
    const errors = applicationErrors(checkApplication(app))
    assert.ok(errors.some((one) => one.kind === 'flow-cycle'))
  })

  it('warns about a Page nothing can reach', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'home')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/orphan', label: 'Orphan', visibility: 'hidden' }), 'orphan')
    const problems = checkApplication(app)
    const orphan = problems.find((one) => one.kind === 'unreachable-page')
    assert.ok(orphan !== undefined)
    assert.equal(orphan?.severity, 'warning')
  })

  it('does not call a hidden Page unreachable when something feeds it', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'home')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/fed', label: 'Fed', visibility: 'hidden' }), 'fed')
    app = ok(
      addContract(app, { id: 'note', version: 1, fields: { text: 'text' }, optional: [], description: '' }),
      'contract'
    )
    app = ok(
      addFlow(app, { from: PAGE_A, to: PAGE_B, contract: 'note', producesVersion: 1, expectsVersion: 1 }),
      'flow'
    )
    assert.equal(
      checkApplication(app).some((one) => one.kind === 'unreachable-page'),
      false
    )
  })

  it('warns about an empty navigation group', () => {
    let app = built()
    app = ok(addGroup(app, { id: 'unused', label: 'Unused' }), 'group')
    assert.ok(checkApplication(app).some((one) => one.kind === 'group-empty'))
  })

  it('warns about a shared value nobody reads', () => {
    let app = built()
    app = ok(
      addSharedValue(app, {
        name: 'unread',
        contract: 'dataset',
        owner: PAGE_A,
        readableByAll: true,
        description: ''
      }),
      'unread'
    )
    const problems = checkApplication(app)
    const unread = problems.find((one) => one.kind === 'unread-value' && one.subject === 'unread')
    assert.ok(unread !== undefined)
    assert.equal(unread?.severity, 'warning')
  })

  it('warns about a contract nothing uses', () => {
    let app = built()
    app = ok(
      addContract(app, { id: 'spare', version: 1, fields: { a: 'number' }, optional: [], description: '' }),
      'spare'
    )
    assert.ok(checkApplication(app).some((one) => one.kind === 'contract-unused'))
  })

  it('warns when a dynamic route overlaps an exact one', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/projects/:id', label: 'Project' }), 'dynamic')
    app = ok(addPage(app, { pageId: PAGE_B, route: '/projects/archive', label: 'Archive' }), 'exact')
    const problems = checkApplication(app)
    const shadow = problems.find((one) => one.kind === 'route-shadowed')
    assert.ok(shadow !== undefined)
    assert.equal(shadow?.severity, 'warning')
  })

  it('keeps warnings from blocking publication', () => {
    let app = built()
    app = ok(addGroup(app, { id: 'unused', label: 'Unused' }), 'group')
    assert.ok(checkApplication(app).some((one) => one.severity === 'warning'))
    assert.equal(applicationIsPublishable(app), true)
  })

  it('reports a binding pointing at a value that is not declared', () => {
    const app = built()
    const broken = { ...app, bindings: [...app.bindings, { pageId: PAGE_A, value: 'ghost', direction: 'reads' as const }] }
    assert.ok(applicationErrors(checkApplication(broken)).some((one) => one.kind === 'undeclared-binding'))
  })
})

// ---------------------------------------------------------------- describing

describe('describing an application', () => {
  it('describes what it actually contains', () => {
    const lines = describeApplication(built())
    assert.ok(lines.some((one) => /4 Pages/.test(one)))
    assert.ok(lines.some((one) => /selectedDataset/.test(one)))
    assert.ok(lines.some((one) => /run in the order/.test(one)))
  })

  it('says so when nothing connects the Pages', () => {
    let app = base()
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home' }), 'home')
    assert.ok(describeApplication(app).some((one) => /stands alone/.test(one)))
  })

  it('names what would stop it working', () => {
    const app = { ...built(), defaultRoute: ['nowhere'] }
    assert.ok(describeApplication(app).some((one) => /would stop it working/.test(one)))
  })

  it('reports a loop rather than an order when the flows cycle', () => {
    let app = built()
    app = ok(
      addFlow(app, { from: PAGE_D, to: PAGE_B, contract: 'dataset', producesVersion: 1, expectsVersion: 1 }),
      'loop'
    )
    assert.ok(describeApplication(app).some((one) => /loop/.test(one)))
  })
})

describe('limits and provenance', () => {
  it('caps Pages, groups and nesting at a stated figure', () => {
    assert.ok(APPLICATION_LIMITS.pages > 0)
    assert.equal(APPLICATION_LIMITS.depth, 3)
  })

  it('states its assumptions', () => {
    assert.ok(APPLICATION_ASSUMPTIONS.length >= 10)
    assert.ok(APPLICATION_ASSUMPTIONS.some((one) => /never copies them/.test(one)))
    assert.ok(APPLICATION_ASSUMPTIONS.some((one) => /exactly one Page allowed to write/.test(one)))
  })

  it('says an older stored version needs migrating', () => {
    assert.equal(needsMigration({ major: 1, minor: 0, patch: 0 }, { major: 2, minor: 0, patch: 0 }), true)
    assert.equal(needsMigration({ major: 2, minor: 0, patch: 0 }, { major: 2, minor: 0, patch: 0 }), false)
  })
})

// ---------------------------------------------------------------- storing

describe('storing and reading back', () => {
  it('round-trips a full application', () => {
    const before = built()
    const after = ok(readApplication(applicationToJson(before)), 'round trip')
    assert.equal(after.applicationId, before.applicationId)
    assert.equal(after.slug, before.slug)
    assert.deepEqual(allRoutes(after), allRoutes(before))
    assert.deepEqual(after.defaultRoute, before.defaultRoute)
    assert.equal(after.sharedValues.length, before.sharedValues.length)
    assert.equal(after.flows.length, before.flows.length)
    assert.equal(after.contracts.length, before.contracts.length)
    assert.deepEqual([...after.bindings].sort((a, b) => a.value.localeCompare(b.value)).length, before.bindings.length)
  })

  it('round-trips groups, order and hidden Pages', () => {
    let app = base()
    app = ok(addGroup(app, { id: 'sources', label: 'Sources' }), 'group')
    app = ok(addPage(app, { pageId: PAGE_A, route: '/', label: 'Home', order: 5 }), 'home')
    app = ok(
      addPage(app, { pageId: PAGE_B, route: '/papers', label: 'Papers', group: 'sources', visibility: 'hidden' }),
      'hidden in group'
    )
    const after = ok(readApplication(applicationToJson(app)), 'round trip')
    assert.equal(after.groups.length, 1)
    assert.equal(after.pages.find((one) => one.pageId === PAGE_B)?.visibility, 'hidden')
    assert.equal(after.pages.find((one) => one.pageId === PAGE_A)?.order, 5)
  })

  it('keeps configuration intact', () => {
    let app = base()
    app = ok(
      addPage(app, { pageId: PAGE_A, route: '/', label: 'Home', configuration: { view: 'table', rows: 20 } }),
      'configured'
    )
    const after = ok(readApplication(applicationToJson(app)), 'round trip')
    assert.deepEqual({ ...after.pages[0].configuration }, { view: 'table', rows: 20 })
  })

  it('refuses a file whose shared value has an owner outside the application', () => {
    const json = applicationToJson(built()) as Record<string, unknown>
    const values = json.sharedValues as Record<string, unknown>[]
    values[0].owner = makePageId('zzzzzzzzzzzz')
    const result = readApplication(json)
    assert.ok(isApplicationError(result))
  })

  it('refuses a file with a second writer on a shared value', () => {
    const json = applicationToJson(built()) as Record<string, unknown>
    const bindings = json.bindings as Record<string, unknown>[]
    bindings.push({ pageId: PAGE_C, value: 'selectedDataset', direction: 'writes' })
    const result = readApplication(json)
    assert.ok(isApplicationError(result))
    assert.equal(result.error, 'not-permitted')
  })

  it('refuses a file with a path walk in a route', () => {
    const json = applicationToJson(built()) as Record<string, unknown>
    const pages = json.pages as Record<string, unknown>[]
    pages[1].route = '/data/../secrets'
    assert.ok(isApplicationError(readApplication(json)))
  })

  it('refuses a file with two Pages on one route', () => {
    const json = applicationToJson(built()) as Record<string, unknown>
    const pages = json.pages as Record<string, unknown>[]
    pages[1].route = pages[0].route
    assert.ok(isApplicationError(readApplication(json)))
  })

  it('refuses a file whose flow names a Page that is not there', () => {
    const json = applicationToJson(built()) as Record<string, unknown>
    const flows = json.flows as Record<string, unknown>[]
    flows[0].to = makePageId('zzzzzzzzzzzz')
    assert.ok(isApplicationError(readApplication(json)))
  })

  it('refuses a file with no application id', () => {
    const json = applicationToJson(built()) as Record<string, unknown>
    delete json.applicationId
    assert.ok(isApplicationError(readApplication(json)))
  })

  it('refuses something that is not an object at all', () => {
    for (const bad of [null, 42, 'application', []]) {
      assert.ok(isApplicationError(readApplication(bad)), String(bad))
    }
  })

  it('drops an unrecognised entry rather than repairing it', () => {
    const json = applicationToJson(built()) as Record<string, unknown>
    ;(json.pages as unknown[]).push('not a page')
    const after = ok(readApplication(json), 'dropped')
    assert.equal(after.pages.length, 4)
  })

  it('reads an older file that has no applications field at all', () => {
    const json = applicationToJson(base()) as Record<string, unknown>
    delete json.pages
    delete json.flows
    const after = ok(readApplication(json), 'sparse')
    assert.equal(after.pages.length, 0)
  })
})
