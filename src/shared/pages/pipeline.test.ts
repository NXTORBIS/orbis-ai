import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ALL_ENGINES,
  ENGINES,
  engineFor,
  INITIAL_FIELDS,
  isPlanProblem,
  needsFor,
  planRun,
  selectEngines,
  SIMPLE,
  type BuildField,
  type EngineContract,
  type EngineId
} from './pipeline.ts'

const plan = (selected: readonly EngineId[]): ReturnType<typeof planRun> => planRun(selected)

describe('the contracts', () => {
  it('names every engine after the key it is stored under', () => {
    for (const id of ALL_ENGINES) assert.equal(ENGINES[id].id, id)
  })

  it('gives every engine a version, a sentence and a budget', () => {
    for (const id of ALL_ENGINES) {
      const engine = ENGINES[id]
      assert.ok(engine.version >= 1, id)
      assert.ok(engine.does.length > 10, id)
      assert.ok(engine.budgetMs > 0, id)
    }
  })

  it('has nothing writing a field another engine also writes', () => {
    const writer = new Map<BuildField, EngineId>()
    for (const id of ALL_ENGINES) {
      for (const field of ENGINES[id].writes) {
        assert.equal(writer.get(field), undefined, `${field} is written by ${writer.get(field)} and ${id}`)
        writer.set(field, id)
      }
    }
  })

  it('has nothing reading a field nothing produces', () => {
    const produced = new Set<BuildField>([...INITIAL_FIELDS])
    for (const id of ALL_ENGINES) for (const field of ENGINES[id].writes) produced.add(field)
    for (const id of ALL_ENGINES) {
      for (const field of ENGINES[id].reads) {
        assert.ok(produced.has(field), `${id} reads "${field}" and nothing writes it`)
      }
    }
  })

  it('gives an engine that is not always run a reason it would be', () => {
    for (const id of ALL_ENGINES) {
      const engine = ENGINES[id]
      if (engine.always) continue
      assert.equal(typeof engine.needed, 'function', `${id} is optional and nothing says when it is needed`)
    }
  })

  it('does not cache anything that reads the world', () => {
    // What Pages exist changes between one request and the next; so does what an engine returns when run for real.
    for (const id of ['discovery', 'planner', 'runtime', 'visual', 'validation'] as EngineId[]) {
      assert.equal(ENGINES[id].cacheable, false, id)
    }
  })
})

describe('selecting engines', () => {
  it('always takes the ones without which a Page cannot exist', () => {
    const chosen = new Set(selectEngines(SIMPLE))
    for (const id of ['intent', 'discovery', 'planner', 'ir', 'compiler', 'runtime', 'validation'] as EngineId[]) {
      assert.ok(chosen.has(id), id)
    }
  })

  it('leaves out what a simple Page does not need', () => {
    const chosen = new Set(selectEngines({ ...SIMPLE, computes: false }))
    assert.equal(chosen.has('domain'), false)
    assert.equal(chosen.has('visualisation'), false)
    assert.equal(chosen.has('data'), false)
    assert.equal(chosen.has('visual'), false)
    assert.equal(chosen.has('computation'), false)
  })

  it('takes the domain engine only when there is one subject', () => {
    assert.ok(selectEngines({ ...SIMPLE, domain: 'physics' }).includes('domain'))
    assert.equal(selectEngines(SIMPLE).includes('domain'), false)
  })

  it('takes the visual engine only when there is enough on screen for where things sit to matter', () => {
    assert.equal(selectEngines(SIMPLE).includes('visual'), false)
    assert.ok(selectEngines({ ...SIMPLE, substantial: true }).includes('visual'))
  })

  it('takes fewer engines for a simple Page than for a complicated one', () => {
    const simple = selectEngines(SIMPLE).length
    const complex = selectEngines({
      computes: true,
      domain: 'physics',
      visualises: true,
      persists: true,
      substantial: true,
      fromTemplate: false
    }).length
    assert.ok(complex > simple, `${complex} is not more than ${simple}`)
    assert.equal(complex, ALL_ENGINES.length)
  })
})

describe('planning a run', () => {
  it('puts every engine in a group, once', () => {
    const chosen = selectEngines(SIMPLE)
    const answer = plan(chosen)
    assert.ok(!isPlanProblem(answer), isPlanProblem(answer) ? answer.message : '')
    const flat = answer.stages.flat()
    assert.deepEqual([...flat].sort(), [...chosen].sort())
    assert.equal(new Set(flat).size, flat.length, 'something is in two groups')
  })

  it('never puts an engine before something it reads', () => {
    const answer = plan(selectEngines({ ...SIMPLE, domain: 'physics', visualises: true, persists: true, substantial: true }))
    assert.ok(!isPlanProblem(answer))
    const written = new Set<BuildField>([...INITIAL_FIELDS])
    for (const group of answer.stages) {
      // Everything in a group reads only what earlier groups wrote, which is what makes running them together safe.
      for (const id of group) {
        for (const field of ENGINES[id].reads) assert.ok(written.has(field), `${id} reads "${field}" too early`)
      }
      for (const id of group) for (const field of ENGINES[id].writes) written.add(field)
    }
  })

  it('puts things that do not depend on each other in the same group', () => {
    const answer = plan(selectEngines({ ...SIMPLE, persists: true }))
    assert.ok(!isPlanProblem(answer))
    // `component` and `data` both read only `ir`, so nothing makes one wait for the other.
    const group = answer.stages.find((one) => one.includes('component'))
    assert.ok(group !== undefined)
    assert.ok(group.includes('data'), `component ran with ${group.join(', ')}`)
  })

  it('counts a group as its slowest member, not the sum of it', () => {
    const answer = plan(['intent', 'discovery'])
    assert.ok(!isPlanProblem(answer))
    // They are sequential -- discovery reads intent -- so this one is the sum.
    assert.equal(answer.budgetMs, ENGINES.intent.budgetMs + ENGINES.discovery.budgetMs)
  })

  it('records the version of everything that ran', () => {
    const answer = plan(selectEngines(SIMPLE))
    assert.ok(!isPlanProblem(answer))
    assert.equal(Object.keys(answer.versions).length, selectEngines(SIMPLE).length)
    assert.equal(answer.versions.compiler, ENGINES.compiler.version)
  })

  it('refuses a pipeline missing something an engine needs, and names the field', () => {
    // The compiler without the security engine: nothing produces `permissions`.
    const answer = plan(['intent', 'discovery', 'planner', 'ir', 'component', 'layout', 'compiler'])
    assert.ok(isPlanProblem(answer))
    assert.equal(answer.error, 'missing-input')
    assert.equal(answer.at, 'permissions')
    assert.ok(answer.message.includes('compiler'))
  })

  it('refuses an engine that is not one', () => {
    const answer = plan(['intent', 'nonsense' as EngineId])
    assert.ok(isPlanProblem(answer))
    assert.equal(answer.error, 'unknown-engine')
  })

  it('does not find an engine on Object.prototype', () => {
    for (const sneaky of ['constructor', 'toString', '__proto__'] as unknown as EngineId[]) {
      const answer = plan([sneaky])
      assert.ok(isPlanProblem(answer), sneaky)
      assert.equal(answer.error, 'unknown-engine', sneaky)
    }
  })

  it('plans an empty pipeline as nothing rather than as a failure', () => {
    const answer = plan([])
    assert.ok(!isPlanProblem(answer))
    assert.deepEqual(answer.stages, [])
    assert.equal(answer.budgetMs, 0)
  })

  it('refuses two engines writing the same field, and names it', () => {
    // Not reachable through `ENGINES` -- a test above proves that -- so the guard is exercised against a forged
    // registry. A refusal nothing can reach is one nobody knows still works.
    const rogue: EngineContract = {
      id: 'rogue' as EngineId,
      version: 1,
      does: 'writes what the compiler writes',
      reads: ['ir'],
      writes: ['page'],
      always: true,
      budgetMs: 1,
      cacheable: true
    }
    const answer = planRun(['compiler', 'rogue' as EngineId], { ...ENGINES, rogue })
    assert.ok(isPlanProblem(answer))
    assert.equal(answer.error, 'written-twice')
    assert.equal(answer.at, 'page')
    assert.ok(answer.message.includes('compiler') && answer.message.includes('rogue'))
  })

  it('refuses two engines each waiting for the other', () => {
    const here: EngineContract = { id: 'a' as EngineId, version: 1, does: 'reads what b writes', reads: ['layout'], writes: ['components'], always: true, budgetMs: 1, cacheable: true }
    const there: EngineContract = { id: 'b' as EngineId, version: 1, does: 'reads what a writes', reads: ['components'], writes: ['layout'], always: true, budgetMs: 1, cacheable: true }
    const answer = planRun(['a' as EngineId, 'b' as EngineId], { a: here, b: there })
    assert.ok(isPlanProblem(answer))
    assert.equal(answer.error, 'circular')
    assert.ok(answer.message.includes('each wait for the other'))
  })})

describe('attributing a field to an engine', () => {
  it('names the engine that produces it', () => {
    assert.equal(engineFor('layout'), 'layout')
    assert.equal(engineFor('page'), 'compiler')
    assert.equal(engineFor('permissions'), 'security')
    assert.equal(engineFor('verdict'), 'validation')
  })

  it('says nothing produces a field that is a starting point', () => {
    assert.equal(engineFor('request'), null)
  })
})

describe('working out what a Page needs', () => {
  it('sees one subject and takes it', () => {
    const needs = needsFor({ operations: ['motion.projectile', 'wave.standing'], outputs: [], inputs: [], allowStorage: false })
    assert.equal(needs.domain, 'physics')
  })

  it('sees two subjects as none, because there is no single set of rules to apply', () => {
    const needs = needsFor({ operations: ['motion.projectile', 'statistics.summarise'], outputs: [], inputs: [], allowStorage: false })
    assert.equal(needs.domain, null)
  })

  it('ignores a family that belongs to no subject rather than calling it one', () => {
    const needs = needsFor({ operations: ['motion.projectile', 'plot.points'], outputs: [], inputs: [], allowStorage: false })
    assert.equal(needs.domain, 'physics')
  })

  it('notices something is drawn', () => {
    assert.equal(needsFor({ operations: [], outputs: [{ display: 'statistic' }], inputs: [], allowStorage: false }).visualises, false)
    assert.ok(needsFor({ operations: [], outputs: [{ display: 'plot' }], inputs: [], allowStorage: false }).visualises)
    assert.ok(needsFor({ operations: [], outputs: [{ display: 'table' }], inputs: [], allowStorage: false }).visualises)
  })

  it('calls a Page substantial only once where things sit stops being obvious', () => {
    const small = needsFor({ operations: [], outputs: [{ display: 'value' }], inputs: [1, 2], allowStorage: false })
    assert.equal(small.substantial, false)
    const large = needsFor({
      operations: [],
      outputs: new Array(4).fill({ display: 'value' }),
      inputs: [1, 2, 3, 4],
      allowStorage: false
    })
    assert.ok(large.substantial)
  })

  it('takes persistence from what Orbis decided, not from what the Page says', () => {
    assert.equal(needsFor({ operations: [], outputs: [], inputs: [], allowStorage: false }).persists, false)
    assert.ok(needsFor({ operations: [], outputs: [], inputs: [], allowStorage: true }).persists)
  })
})
