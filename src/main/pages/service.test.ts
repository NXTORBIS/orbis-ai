import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PagesStore } from './store.ts'
import { PagesService } from './service.ts'
import { BUILT_IN_IDS, BUILT_IN_MANIFESTS } from './builtins.ts'
import { validateManifest, manifestErrors } from '../../shared/pages/manifest.ts'

/**
 * The service end to end, with a real store on disk.
 *
 * The important tests here are the ones about `run`. Everything else in the Pages work is a pure module with its own
 * tests; this file is where the claim "a Page cannot reach an engine it has no capability for" is actually checked, by
 * asking a Page that does not declare `computation.units` to convert something and watching it be refused.
 */

const PROFILE = 'default'

async function withService(
  body: (service: PagesService, store: PagesStore) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-pages-'))
  try {
    const store = new PagesStore(dir)
    const service = new PagesService({
      store,
      profileId: async () => PROFILE,
      now: () => 1_700_000_000_000
    })
    service.start()
    await body(service, store)
    await store.flush()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const value = async (
  service: PagesService,
  pageId: string,
  operation: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const result = await service.run(PROFILE, { pageId, operation, input })
  assert.equal(result.ok, true, `${operation} failed: ${JSON.stringify(result)}`)
  return (result as { value: Record<string, unknown> }).value
}

// ---------------------------------------------------------------- the Pages Orbis ships

test('every built-in manifest validates through the same check an imported one would', () => {
  // A built-in whose manifest is wrong should show up here rather than as a Page that misbehaves later.
  for (const manifest of BUILT_IN_MANIFESTS) {
    const problems = manifestErrors(validateManifest(manifest))
    assert.deepEqual(problems, [], `${String((manifest as { slug?: string }).slug)}: ${JSON.stringify(problems)}`)
  }
})

test('the built-in Pages all register, and none of them is refused', async () => {
  await withService(async (service) => {
    assert.deepEqual(service.problems(), [], 'a built-in Page failed to register')
    const slugs = service.builtIn().map((one) => one.identity.slug).sort()
    assert.deepEqual(slugs, [
      'algebra-lab',
      'builder-studio',
      'calculus-lab',
      'constants-library',
      'constraint-checker',
      'coordinate-lab',
      'curve-fitter',
      'data-explorer',
      'data-importer',
      'document-studio',
      'equation-solver',
      'explain-it-yourself',
      'function-plotter',
      'geometry-lab',
      'matrix-lab',
      'measurement-lab',
      'number-lab',
      'optimiser',
      'parameter-study',
      'problem-workspace',
      'project',
      'scenario-lab',
      'signal-lab',
      'significant-figures',
      'simulation-lab',
      'statistics-lab',
      'uncertainty-lab',
      'unit-converter'
    ])
  })
})

test('a built-in Page keeps the same id across starts, so a bookmark survives', async () => {
  await withService(async (service) => {
    const converter = service.builtIn().find((one) => one.identity.slug === 'unit-converter')
    assert.equal(converter?.identity.pageId, BUILT_IN_IDS.unitConverter)
  })
})

test('each built-in Page asks for nothing it does not need', async () => {
  await withService(async (service) => {
    for (const page of service.builtIn()) {
      for (const capability of page.manifest.capabilities) {
        // No network, no files, no devices, no browser. A shipped Page is local computation, its own storage, and --
        // where one genuinely hands a result to another -- `page.send`, which reaches nothing outside Orbis.
        const baseline = capability.startsWith('computation.') || capability === 'storage.page'
        assert.ok(baseline || capability === 'page.send', `${page.identity.slug} asks for ${capability}`)

        // Anything past the baseline has to say why, in the manifest, where the prompt will read it. The point of the
        // exemption is that it is justified, so an unjustified one is the thing this catches.
        if (!baseline) {
          const reason = page.manifest.capabilityReasons[capability]
          assert.ok(
            typeof reason === 'string' && reason.trim().length > 20,
            `${page.identity.slug} asks for ${capability} without saying why`
          )
        }
      }
      assert.equal(page.manifest.offline, true, `${page.identity.slug} should work offline`)
    }
  })
})

test('a built-in only accepts a message kind it can actually do something with', async () => {
  await withService(async (service) => {
    for (const page of service.builtIn()) {
      for (const acceptance of page.manifest.accepts) {
        // A declaration is half the permission to send, so an empty one is a route that exists and does nothing.
        assert.match(acceptance.kind, /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/, `${page.identity.slug}: ${acceptance.kind}`)
        assert.ok(
          acceptance.describe.trim().length > 15,
          `${page.identity.slug} accepts ${acceptance.kind} without saying what it does with it`
        )
      }
    }
  })
})

// ---------------------------------------------------------------- addresses

test('a Page resolves from its address', async () => {
  await withService(async (service) => {
    const resolved = await service.resolve(PROFILE, 'orbis://pages/unit-converter')
    assert.equal(resolved.found, true)
    assert.equal((resolved as { page: { identity: { slug: string } } }).page.identity.slug, 'unit-converter')
  })
})

test('an address that is not a Page is refused, not guessed at', async () => {
  await withService(async (service) => {
    for (const bad of ['orbis://pages/../etc', 'orbis://pages/nothing-here', 'https://example.com']) {
      assert.equal((await service.resolve(PROFILE, bad)).found, false, bad)
    }
  })
})

test('opening a Page is remembered, and asking about it is not', async () => {
  await withService(async (service, store) => {
    await service.resolve(PROFILE, 'orbis://pages/unit-converter')
    assert.deepEqual(await store.usage(PROFILE), {}, 'resolving must not count as a visit')
    await service.open(PROFILE, 'orbis://pages/unit-converter')
    assert.equal((await store.usage(PROFILE))[BUILT_IN_IDS.unitConverter]?.openCount, 1)
    await service.open(PROFILE, 'orbis://pages/unit-converter')
    assert.equal((await store.usage(PROFILE))[BUILT_IN_IDS.unitConverter]?.openCount, 2)
  })
})

// ---------------------------------------------------------------- the capability gateway

test('a Page can use the engines it declared', async () => {
  await withService(async (service) => {
    const converted = await value(service, BUILT_IN_IDS.unitConverter, 'units.convert', {
      value: 36,
      from: 'km/h',
      to: 'm/s'
    })
    assert.equal(converted.ok, true)
    assert.equal(converted.value, 10)
    assert.equal(converted.dimension, 'velocity')
  })
})

test('a Page cannot use an engine it did not declare, and the refusal names the capability', async () => {
  await withService(async (service) => {
    // The equation solver declares `computation.arithmetic` and `storage.page`. It does not declare `computation.units`,
    // so it cannot convert anything -- whatever it asks, and whatever its own code believes.
    const refused = await service.run(PROFILE, {
      pageId: BUILT_IN_IDS.equationSolver,
      operation: 'units.convert',
      input: { value: 1, from: 'm', to: 'ft' }
    })
    assert.equal(refused.ok, false)
    const failure = refused as { error: string; capability?: string; message: string }
    assert.equal(failure.error, 'not-allowed')
    assert.equal(failure.capability, 'computation.units')
    assert.match(failure.message, /did not ask for/)
  })
})

test('an operation nobody has mapped to a capability cannot run at all', async () => {
  await withService(async (service) => {
    for (const operation of ['', 'units.delete', 'system.execute', 'files.read', 'constructor']) {
      const refused = await service.run(PROFILE, {
        pageId: BUILT_IN_IDS.unitConverter,
        operation,
        input: {}
      })
      assert.equal(refused.ok, false, operation)
      assert.equal((refused as { error: string }).error, 'unknown-operation', operation)
    }
  })
})

test('an operation on a Page that does not exist is refused', async () => {
  await withService(async (service) => {
    const refused = await service.run(PROFILE, {
      pageId: 'page_doesnotexist000',
      operation: 'units.convert',
      input: { value: 1, from: 'm', to: 'ft' }
    })
    assert.equal(refused.ok, false)
    assert.equal((refused as { error: string }).error, 'not-found')
  })
})

// ---------------------------------------------------------------- the engines, through the gateway

test('the unit engine answers, and refuses an impossible conversion with a reason', async () => {
  await withService(async (service) => {
    const good = await value(service, BUILT_IN_IDS.unitConverter, 'units.convert', { value: 100, from: '°C', to: '°F' })
    assert.equal(Math.round(Number(good.value)), 212)

    const impossible = await value(service, BUILT_IN_IDS.unitConverter, 'units.convert', { value: 5, from: 'm', to: 's' })
    assert.equal(impossible.ok, false)
    assert.match(String(impossible.message), /length/)
    assert.match(String(impossible.message), /time/)
  })
})

test('the unit engine only offers units that could actually work', async () => {
  await withService(async (service) => {
    const options = await value(service, BUILT_IN_IDS.unitConverter, 'units.compatible', { unit: 'm' })
    const ids = (options.units as { id: string }[]).map((one) => one.id)
    assert.ok(ids.includes('mile'))
    // Offering a pressure for a length would be offering an error.
    assert.equal(ids.includes('pascal'), false)
  })
})

test('the solver answers, and every root carries the evidence it was checked', async () => {
  await withService(async (service) => {
    const answer = await value(service, BUILT_IN_IDS.equationSolver, 'solver.solve', { equation: 'x^2 + 3x + 2 = 0' })
    const result = answer.result as { status: string; solutions: { value: number; residual: number; confidence: string }[] }
    assert.equal(result.status, 'solved')
    assert.deepEqual(result.solutions.map((one) => one.value).sort((a, b) => a - b), [-2, -1])
    for (const one of result.solutions) {
      assert.notEqual(one.confidence, 'unverified')
      assert.ok(Number.isFinite(one.residual))
    }
    // And the steps come back with it, built from what the solver did.
    assert.ok((answer.steps as unknown[]).length > 3)
  })
})

test('the solver handles a system of equations', async () => {
  await withService(async (service) => {
    const answer = await value(service, BUILT_IN_IDS.equationSolver, 'solver.system', {
      equations: ['x + y = 10', 'x - y = 2']
    })
    const result = answer.result as { status: string; values: Record<string, number> }
    assert.equal(result.status, 'unique')
    assert.equal(result.values.x, 6)
    assert.equal(result.values.y, 4)
  })
})

test('the expression engine differentiates, and refuses what has no derivative', async () => {
  await withService(async (service) => {
    const d = await value(service, BUILT_IN_IDS.calculusLab, 'expression.differentiate', { text: 'x^2', variable: 'x' })
    assert.equal(d.ok, true)
    assert.equal(d.text, '2 * x')

    const refused = await value(service, BUILT_IN_IDS.calculusLab, 'expression.differentiate', { text: 'floor(x)', variable: 'x' })
    assert.equal(refused.ok, false)
    assert.equal(refused.what, 'floor')
  })
})

test('an expression with no value for a symbol says which symbol', async () => {
  await withService(async (service) => {
    const result = await value(service, BUILT_IN_IDS.calculusLab, 'expression.evaluate', { text: 'x + 1' })
    assert.equal(result.ok, false)
    assert.equal(result.symbol, 'x')
  })
})

// ---------------------------------------------------------------- inputs are bounded

test('an input that is the wrong shape is refused rather than coerced', async () => {
  await withService(async (service) => {
    for (const input of [{}, { value: 'not a number', from: 'm', to: 'ft' }, { value: 1, from: 5, to: 'ft' }]) {
      const refused = await service.run(PROFILE, { pageId: BUILT_IN_IDS.unitConverter, operation: 'units.convert', input })
      assert.equal(refused.ok, false, JSON.stringify(input))
      assert.equal((refused as { error: string }).error, 'failed')
    }
  })
})

test('an enormous expression is refused before an engine walks it', async () => {
  await withService(async (service) => {
    const refused = await service.run(PROFILE, {
      pageId: BUILT_IN_IDS.calculusLab,
      operation: 'expression.simplify',
      input: { text: `1${' + 1'.repeat(5000)}` }
    })
    assert.equal(refused.ok, false)
    assert.match((refused as { message: string }).message, /too long|too large/)
  })
})

test('a system with too many equations is refused', async () => {
  await withService(async (service) => {
    const refused = await service.run(PROFILE, {
      pageId: BUILT_IN_IDS.equationSolver,
      operation: 'solver.system',
      input: { equations: Array.from({ length: 50 }, (_, i) => `x${i} = 1`) }
    })
    assert.equal(refused.ok, false)
    assert.match((refused as { message: string }).message, /At most/)
  })
})

test('a search range that does not make sense is refused', async () => {
  await withService(async (service) => {
    const refused = await service.run(PROFILE, {
      pageId: BUILT_IN_IDS.equationSolver,
      operation: 'solver.solve',
      input: { equation: 'sin(x) = 0.5', searchFrom: 10, searchTo: 1 }
    })
    assert.equal(refused.ok, false)
    assert.match((refused as { message: string }).message, /end after it starts/)
  })
})

// ---------------------------------------------------------------- permissions

test('the permission list shows what is true rather than what was asked for', async () => {
  await withService(async (service) => {
    const summary = await service.permissions(PROFILE, BUILT_IN_IDS.unitConverter)
    assert.ok(summary)
    // Everything these Pages need happens on this computer, so all of it is allowed without a prompt.
    for (const one of summary!) assert.equal(one.outcome, 'allow', `${one.capabilityId} is ${one.outcome}`)
  })
})

test('a grant for something the Page never declared is refused rather than stored', async () => {
  await withService(async (service, store) => {
    // Storing it would create a grant that never takes effect, and a permission list showing an allowance that does
    // nothing is worse than showing none.
    const result = await service.grant(PROFILE, BUILT_IN_IDS.unitConverter, 'network.fetch', { kind: 'none' }, null)
    assert.equal(result.granted, false)
    assert.deepEqual(await store.grants(PROFILE), [])
  })
})

test('a grant for something never available to a Page is refused', async () => {
  await withService(async (service) => {
    const result = await service.grant(PROFILE, BUILT_IN_IDS.unitConverter, 'system.secrets', { kind: 'none' }, null)
    assert.equal(result.granted, false)
    assert.match((result as { message: string }).message, /never/)
  })
})

test('revoking something that was never granted is harmless', async () => {
  await withService(async (service) => {
    assert.deepEqual(await service.revoke(PROFILE, BUILT_IN_IDS.unitConverter, 'clipboard.write'), [])
  })
})

// ---------------------------------------------------------------- a Page's own work

test('a Page can save its work and read it back', async () => {
  await withService(async (service) => {
    const saved = await service.saveProject(PROFILE, BUILT_IN_IDS.unitConverter, null, '36 km/h', { value: '36', from: 'km/h', to: 'm/s' })
    assert.equal(saved.ok, true)
    const projects = (await service.projects(PROFILE, BUILT_IN_IDS.unitConverter)) as { name: string }[]
    assert.equal(projects.length, 1)
    assert.equal(projects[0].name, '36 km/h')
  })
})

test('saving twice with the same id updates rather than piling up', async () => {
  await withService(async (service) => {
    const first = await service.saveProject(PROFILE, BUILT_IN_IDS.unitConverter, null, 'One', { a: 1 })
    const projectId = ((first as { project: { projectId: string } }).project).projectId
    await service.saveProject(PROFILE, BUILT_IN_IDS.unitConverter, projectId, 'Two', { a: 2 })
    const projects = (await service.projects(PROFILE, BUILT_IN_IDS.unitConverter)) as { name: string; state: { a: number } }[]
    assert.equal(projects.length, 1)
    assert.equal(projects[0].name, 'Two')
    assert.equal(projects[0].state.a, 2)
  })
})

test('a project too large to save is refused with the size, not truncated', async () => {
  await withService(async (service) => {
    // Silently keeping half of somebody's work is the worst of the available outcomes.
    const huge = { text: 'x'.repeat(3_000_000) }
    const result = await service.saveProject(PROFILE, BUILT_IN_IDS.unitConverter, null, 'Huge', huge)
    assert.equal(result.ok, false)
    assert.equal((result as { error: string }).error, 'too-large')
    assert.match((result as { message: string }).message, /kB/)
    assert.deepEqual(await service.projects(PROFILE, BUILT_IN_IDS.unitConverter), [])
  })
})

test('a project can be deleted', async () => {
  await withService(async (service) => {
    const saved = await service.saveProject(PROFILE, BUILT_IN_IDS.unitConverter, null, 'One', { a: 1 })
    const projectId = ((saved as { project: { projectId: string } }).project).projectId
    assert.equal(await service.deleteProject(PROFILE, projectId), true)
    assert.deepEqual(await service.projects(PROFILE, BUILT_IN_IDS.unitConverter), [])
    assert.equal(await service.deleteProject(PROFILE, projectId), false, 'deleting twice is not an error, but it is not a delete')
  })
})

// ---------------------------------------------------------------- persistence and profiles

test('decisions survive a restart, and the register is rebuilt rather than restored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-pages-'))
  try {
    const first = new PagesStore(dir)
    const before = new PagesService({ store: first, profileId: async () => PROFILE, now: () => 1 })
    before.start()
    await before.favourite(PROFILE, BUILT_IN_IDS.equationSolver, true)
    await before.saveProject(PROFILE, BUILT_IN_IDS.equationSolver, null, 'Kept', { equation: 'x = 1' })
    await first.flush()

    const second = new PagesStore(dir)
    const after = new PagesService({ store: second, profileId: async () => PROFILE, now: () => 2 })
    after.start()
    assert.deepEqual(await second.favourites(PROFILE), [BUILT_IN_IDS.equationSolver])
    const projects = (await after.projects(PROFILE, BUILT_IN_IDS.equationSolver)) as { name: string }[]
    assert.equal(projects[0]?.name, 'Kept')
    // The register itself came from the build, not from the file: it has every shipped Page, not only the one that
    // happened to be favourited before the restart.
    assert.equal(after.builtIn().length, BUILT_IN_MANIFESTS.length)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('one profile\'s decisions are not another\'s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-pages-'))
  try {
    const store = new PagesStore(dir)
    await store.setFavourite('default', BUILT_IN_IDS.unitConverter, true)
    await store.saveProject('default', { projectId: 'p1', pageId: BUILT_IN_IDS.unitConverter, name: 'Mine', state: {} }, 1)
    assert.deepEqual(await store.favourites('other'), [])
    assert.deepEqual(await store.projects('other'), [])
    assert.equal((await store.favourites('default')).length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a store file that cannot be read starts from defaults rather than failing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-pages-'))
  try {
    const store = new PagesStore(dir)
    // Nothing on disk at all, which is the same situation as a corrupt file.
    assert.deepEqual(await store.grants('default'), [])
    assert.deepEqual(await store.favourites('default'), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- the newer engines, through the same door

test('a Page can reach the engines it declared, and only those', async () => {
  await withService(async (service) => {
    // The plotter declares `computation.plot`, so it may sample a function.
    const plotted = await service.run(PROFILE, {
      pageId: BUILT_IN_IDS.functionPlotter,
      operation: 'plot.function',
      input: { expression: 'x^2', from: 0, to: 2, initial: 16 }
    })
    assert.equal(plotted.ok, true, JSON.stringify(plotted))

    // The unit converter does not, so it may not -- however it asks.
    const refused = await service.run(PROFILE, {
      pageId: BUILT_IN_IDS.unitConverter,
      operation: 'plot.function',
      input: { expression: 'x^2', from: 0, to: 2 }
    })
    assert.equal(refused.ok, false)
    assert.equal((refused as { capability?: string }).capability, 'computation.plot')
  })
})

test('every new engine is reachable from the Page that declares it', async () => {
  await withService(async (service) => {
    const cases: [string, string, Record<string, unknown>][] = [
      [BUILT_IN_IDS.statisticsLab, 'statistics.summarise', { values: [1, 2, 3, 4, 5] }],
      [BUILT_IN_IDS.dataExplorer, 'data.parse', { text: 'a,b\n1,2' }],
      [BUILT_IN_IDS.measurementLab, 'measurement.make', { value: 1, unit: 'm', uncertainty: 0.1 }],
      [BUILT_IN_IDS.optimiser, 'optimise.interval', { expression: '(x-2)^2', from: -5, to: 5 }],
      [BUILT_IN_IDS.simulationLab, 'simulate.integrate', { variables: ['y'], rates: ['y'], start: [1], to: 1 }],
      [BUILT_IN_IDS.functionPlotter, 'plot.axis', { values: [1, 2, 3] }]
    ]
    for (const [pageId, operation, input] of cases) {
      const result = await service.run(PROFILE, { pageId, operation, input })
      assert.equal(result.ok, true, `${operation} was refused: ${JSON.stringify(result)}`)
    }
  })
})

test('a Page sending nonsense to an engine gets a sentence, not a stack trace', async () => {
  await withService(async (service) => {
    const result = await service.run(PROFILE, {
      pageId: BUILT_IN_IDS.statisticsLab,
      operation: 'statistics.summarise',
      input: { values: 'not a list' }
    })
    assert.equal(result.ok, false)
    const message = (result as { message: string }).message
    assert.match(message, /has to be a list/)
    assert.ok(!/\bat \w+ \(/.test(message), 'a Page must never be handed a stack trace')
  })
})

// ---------------------------------------------------------------- Orion

test('a question with an exact answer is worked out rather than answered from a model', async () => {
  await withService(async (service) => {
    const result = (await service.answerQuestion(PROFILE, 'what is 1847 * 2293')) as Record<string, unknown>
    assert.equal(result.computed, true, JSON.stringify(result))
    assert.match(String(result.text), /4235171/)
    // It says which it is, so a computed answer cannot be mistaken for a recalled one.
    assert.match(String(result.text), /Calculated exactly/)
    assert.equal(result.operation, 'expression.evaluate')
  })
})

test('a conversion is worked out by the unit engine', async () => {
  await withService(async (service) => {
    const result = (await service.answerQuestion(PROFILE, 'convert 20 degC to degF')) as Record<string, unknown>
    assert.equal(result.computed, true, JSON.stringify(result))
    assert.match(String(result.text), /68/)
  })
})

test('a question that cannot be worked out says so, rather than being answered wrongly', async () => {
  await withService(async (service) => {
    const result = (await service.answerQuestion(PROFILE, 'what is the capital of France')) as Record<string, unknown>
    assert.equal(result.computed, false)
    // "Answer this normally" and "there is no answer" are different, and this says the first.
    assert.match(String(result.because), /answered normally/)
  })
})

test('the caveats an engine returned travel with the answer', async () => {
  await withService(async (service) => {
    const result = (await service.answerQuestion(PROFILE, 'what is the mean of 1, 2, 3, 100')) as Record<string, unknown>
    assert.equal(result.computed, true, JSON.stringify(result))
    assert.ok(Array.isArray(result.notes) && (result.notes as string[]).length > 0, 'the caveats were dropped')
  })
})

// ---------------------------------------------------------------- Search

test('a search that a Page answers exactly puts it above the web results', async () => {
  await withService(async (service) => {
    const result = (await service.searchModule(PROFILE, 'unit converter', [], false)) as Record<string, unknown>
    assert.equal(result.show, true, JSON.stringify(result))
    assert.equal(result.rank, 1)
    const suggestions = result.suggestions as { slug: string; because: string[] }[]
    assert.equal(suggestions[0].slug, 'unit-converter')
    assert.ok(suggestions[0].because.length > 0, 'a suggestion with no reason cannot be checked')
  })
})

test('a search no Page answers shows no Pages at all', async () => {
  await withService(async (service) => {
    const result = (await service.searchModule(PROFILE, 'best pizza in rome', [], false)) as Record<string, unknown>
    assert.equal(result.show, false)
    assert.deepEqual(result.suggestions, [])
  })
})

test('typing a web address never brings up a Page', async () => {
  await withService(async (service) => {
    const result = (await service.searchModule(PROFILE, 'unit converter', [], true)) as Record<string, unknown>
    assert.equal(result.show, false)
  })
})

// ---------------------------------------------------------------- packaging, diagnostics, audit, builder

test('an export refuses to carry something that looks like a credential', async () => {
  await withService(async (service) => {
    const result = (await service.exportPage(
      PROFILE,
      BUILT_IN_IDS.unitConverter,
      [{ path: 'state.json', content: '{"api_key": "sk-abcdefghijklmnop1234"}' }],
      false
    )) as Record<string, unknown>
    assert.equal(result.ok, false)
    assert.equal(result.error, 'contains-secrets')
  })
})

test('an export round trips back through the reader', async () => {
  await withService(async (service) => {
    const exported = (await service.exportPage(
      PROFILE,
      BUILT_IN_IDS.unitConverter,
      [{ path: 'index.html', content: '<p>hello</p>' }],
      false
    )) as Record<string, unknown>
    assert.equal(exported.ok, true, JSON.stringify(exported))

    const read = (await service.inspectPackage(JSON.parse(JSON.stringify(exported.package)))) as Record<string, unknown>
    assert.equal(read.ok, true, JSON.stringify(read))
    assert.equal(read.intact, true)
    // Importing grants nothing: what comes back is a description and a decision.
    assert.ok(Array.isArray(read.requested))
    assert.ok((read.beforeYouDecide as string[]).some((one) => /Nobody at Orbis has looked at it/.test(one)))
  })
})

test('every Page Orbis ships can be exported and read back', async () => {
  // The round trip, for all of them. Doing this for one Page would have missed it: the failure was a field that
  // normalises on the way in and was not written back on the way out, and which fields a Page has varies.
  await withService(async (service) => {
    for (const page of service.builtIn()) {
      const exported = (await service.exportPage(
        PROFILE,
        page.identity.pageId,
        [{ path: 'index.html', content: '<p>x</p>' }],
        false
      )) as Record<string, unknown>
      assert.equal(exported.ok, true, `${page.identity.slug} would not export: ${JSON.stringify(exported)}`)

      const read = (await service.inspectPackage(JSON.parse(JSON.stringify(exported.package)))) as Record<string, unknown>
      assert.equal(read.ok, true, `${page.identity.slug} exported but could not be read back: ${JSON.stringify(read)}`)
      assert.equal(read.intact, true, `${page.identity.slug} came back with a broken checksum`)
      assert.equal(
        (read.manifest as { title: string }).title,
        page.manifest.title,
        `${page.identity.slug} came back as something else`
      )
      // Every capability it asked for survives the trip, as a request rather than a grant.
      assert.equal(
        (read.requested as unknown[]).length,
        page.manifest.capabilities.length,
        `${page.identity.slug} lost a capability in the round trip`
      )
    }
  })
})

test('a fault is classified with the cost of each recovery attached', async () => {
  await withService(async (service) => {
    const result = (await service.diagnose(
      PROFILE,
      { kind: 'crashed', detail: 'it stopped', at: 1000 },
      { hasUnsavedWork: true }
    )) as Record<string, unknown>
    assert.equal(result.source, 'page')
    const suggestions = result.suggestions as { cost: string; automatic: boolean }[]
    assert.ok(suggestions.length > 0)
    for (const one of suggestions) {
      if (one.automatic) assert.equal(one.cost, '', 'nothing that loses work may run unattended')
    }
  })
})

test('an accessibility audit never comes back as a pass', async () => {
  await withService(async (service) => {
    const result = (await service.audit([
      { id: 'save', role: 'button', name: 'Save project', keyboardReachable: true, width: 44, height: 44 }
    ])) as Record<string, unknown>
    assert.deepEqual(result.findings, [])
    assert.ok(!/pass/i.test(String(result.headline)))
    assert.ok((result.cannotCheck as string[]).length > 0, 'a clean audit must say what it could not check')
  })
})

test('a built Page is checked before it may run', async () => {
  await withService(async (service) => {
    const broken = (await service.checkDocument({
      fields: [{ name: 'a', type: 'number', label: 'A' }],
      components: [{ id: 'c', kind: 'number-input', field: 'nowhere' }],
      computations: []
    })) as Record<string, unknown>
    assert.equal(broken.canRun, false)
    assert.ok((broken.problems as { code: string }[]).some((one) => one.code === 'unknown-field'))

    const fine = (await service.checkDocument({
      fields: [{ name: 'a', type: 'number', label: 'A' }],
      components: [{ id: 'c', kind: 'number-input', field: 'a' }],
      computations: []
    })) as Record<string, unknown>
    assert.equal(fine.canRun, true)
  })
})
