import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONCEPT_ASSUMPTIONS,
  RELATIONS,
  analyse,
  checkGraph,
  concept,
  emptyGraph,
  findCycle,
  fromOutline,
  fromStatements,
  isConceptError,
  layout,
  neighbourhood,
  pathsBetween,
  type ConceptGraph,
  type Relation,
  type RelationKind
} from './concepts.ts'

const relation = (id: string, from: string, to: string, kind: RelationKind): Relation => ({
  id,
  from,
  to,
  kind,
  label: '',
  strength: null,
  conditions: '',
  provenance: 'authored',
  status: 'proposed',
  evidence: []
})

const computer = (): ConceptGraph => ({
  id: 'g',
  title: 'Computer',
  concepts: [
    concept('computer', 'Computer'),
    concept('cpu', 'CPU', { parent: 'computer' }),
    concept('alu', 'ALU', { parent: 'cpu' }),
    concept('memory', 'Memory', { parent: 'computer' })
  ],
  relations: [
    relation('r1', 'computer', 'cpu', 'contains'),
    relation('r2', 'cpu', 'alu', 'contains'),
    relation('r3', 'computer', 'memory', 'contains')
  ]
})

describe('relationship types', () => {
  test('every type says whether it is symmetric, cyclic and transitive', () => {
    for (const [kind, rules] of Object.entries(RELATIONS)) {
      assert.equal(typeof rules.symmetric, 'boolean', kind)
      assert.equal(typeof rules.allowsCycles, 'boolean', kind)
      assert.equal(typeof rules.transitive, 'boolean', kind)
      assert.ok(rules.describe.length > 20, `${kind} has no real description`)
    }
  })

  test('containment forbids cycles and causation allows them', () => {
    assert.equal(RELATIONS.contains.allowsCycles, false)
    assert.equal(RELATIONS.causes.allowsCycles, true)
    assert.match(RELATIONS.causes.describe, /usually the interesting part/)
  })

  test('similarity is symmetric and deliberately not transitive', () => {
    assert.equal(RELATIONS['similar-to'].symmetric, true)
    assert.equal(RELATIONS['similar-to'].transitive, false)
    assert.match(RELATIONS['similar-to'].describe, /chains together into nonsense/)
  })
})

describe('validation', () => {
  test('a well-formed graph passes', () => {
    const result = checkGraph(computer())
    assert.equal(result.ok, true)
    assert.deepEqual(result.problems, [])
  })

  test('a containment loop is a blocker, and the loop is named', () => {
    const graph = computer()
    graph.relations.push(relation('r4', 'alu', 'computer', 'contains'))
    const result = checkGraph(graph)
    assert.equal(result.ok, false)
    const cycle = result.problems.find((one) => one.kind === 'cycle')
    assert.ok(cycle)
    assert.match(cycle.describe, /Computer/)
  })

  test('a causal loop is allowed, because a feedback loop is a real thing to model', () => {
    const graph: ConceptGraph = {
      ...emptyGraph('g', 'Feedback'),
      concepts: [concept('a', 'Demand'), concept('b', 'Price')],
      relations: [relation('r1', 'a', 'b', 'causes'), relation('r2', 'b', 'a', 'causes')]
    }
    assert.equal(checkGraph(graph).ok, true)
  })

  test('a relationship to a concept that is not there is refused', () => {
    const graph = computer()
    graph.relations.push(relation('r4', 'cpu', 'nope', 'contains'))
    assert.ok(checkGraph(graph).problems.some((one) => one.kind === 'missing-node'))
  })

  test('a concept containing itself is refused for containment and allowed for influence', () => {
    const containing: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: [concept('a', 'A')],
      relations: [relation('r', 'a', 'a', 'contains')]
    }
    assert.ok(checkGraph(containing).problems.some((one) => one.kind === 'self-reference'))

    const influencing: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: [concept('a', 'A')],
      relations: [relation('r', 'a', 'a', 'influences')]
    }
    assert.equal(checkGraph(influencing).ok, true)
  })

  test('a symmetric relationship stored both ways is reported as stored twice', () => {
    const graph: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: [concept('a', 'A'), concept('b', 'B')],
      relations: [relation('r1', 'a', 'b', 'similar-to'), relation('r2', 'b', 'a', 'similar-to')]
    }
    const result = checkGraph(graph)
    const duplicate = result.problems.find((one) => one.kind === 'duplicate-relation')
    assert.ok(duplicate)
    assert.match(duplicate.describe, /storing it both ways is storing it twice/)
    // A warning, not a blocker: the model still works.
    assert.equal(duplicate.blocking, false)
    assert.equal(result.ok, true)
  })

  test('an unconnected concept is kept and reported rather than removed', () => {
    const graph = computer()
    graph.concepts.push(concept('floating', 'An idea'))
    const result = checkGraph(graph)
    assert.deepEqual(result.orphans, ['floating'])
    assert.equal(result.ok, true)
    assert.ok(result.notes.some((one) => /has not been placed yet/.test(one)))
  })

  test('a group parent that is not in the graph is a blocker', () => {
    const graph = computer()
    graph.concepts.push(concept('x', 'X', { parent: 'nope' }))
    assert.ok(checkGraph(graph).problems.some((one) => one.kind === 'bad-parent'))
  })

  test('a duplicate id is refused', () => {
    const graph = computer()
    graph.concepts.push(concept('cpu', 'Another CPU'))
    assert.ok(checkGraph(graph).problems.some((one) => one.kind === 'duplicate'))
  })

  test('the cycle finder returns the cycle itself, not only that there is one', () => {
    const graph: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: [concept('a', 'A'), concept('b', 'B'), concept('c', 'C')],
      relations: [relation('r1', 'a', 'b', 'contains'), relation('r2', 'b', 'c', 'contains'), relation('r3', 'c', 'a', 'contains')]
    }
    const cycle = findCycle(graph, 'contains')
    assert.ok(cycle)
    assert.ok(cycle.length >= 3)
    assert.equal(cycle[0], cycle[cycle.length - 1])
  })
})

describe('paths', () => {
  test('a path of one transitive relationship means something end to end', () => {
    const paths = pathsBetween(computer(), 'computer', 'alu')
    assert.ok(!isConceptError(paths))
    assert.equal(paths.length, 1)
    assert.equal(paths[0].meaningful, true)
    assert.match(paths[0].describe, /really does hold from end to end/)
  })

  test('a path of a non-transitive relationship is reported as not composing', () => {
    const graph: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: [concept('a', 'A'), concept('b', 'B'), concept('c', 'C')],
      relations: [relation('r1', 'a', 'b', 'similar-to'), relation('r2', 'b', 'c', 'similar-to')]
    }
    const paths = pathsBetween(graph, 'a', 'c')
    assert.ok(!isConceptError(paths))
    assert.equal(paths[0].meaningful, false)
    assert.match(paths[0].describe, /does not make the end-to-end relationship hold/)
  })

  test('a mixed path is a connection rather than a claim', () => {
    const graph: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: [concept('a', 'A'), concept('b', 'B'), concept('c', 'C')],
      relations: [relation('r1', 'a', 'b', 'contains'), relation('r2', 'b', 'c', 'causes')]
    }
    const paths = pathsBetween(graph, 'a', 'c')
    assert.ok(!isConceptError(paths))
    assert.match(paths[0].describe, /shows a connection and not a claim/)
  })

  test('a symmetric relationship is traversable both ways', () => {
    const graph: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: [concept('a', 'A'), concept('b', 'B')],
      relations: [relation('r1', 'a', 'b', 'similar-to')]
    }
    const forward = pathsBetween(graph, 'a', 'b')
    const backward = pathsBetween(graph, 'b', 'a')
    assert.ok(!isConceptError(forward) && !isConceptError(backward))
    assert.equal(forward.length, 1)
    assert.equal(backward.length, 1)
  })

  test('a concept that is not there is refused', () => {
    assert.ok(isConceptError(pathsBetween(computer(), 'nope', 'alu')))
  })

  test('the neighbourhood is grouped by distance', () => {
    const result = neighbourhood(computer(), 'computer', 2)
    assert.ok(!isConceptError(result))
    assert.deepEqual(result.byDistance[0].ids.sort(), ['cpu', 'memory'])
    assert.deepEqual(result.byDistance[1].ids, ['alu'])
    assert.equal(result.total, 3)
  })
})

describe('import', () => {
  test('an outline becomes a containment tree', () => {
    const result = fromOutline('Physics\n  Mechanics\n    Motion\n  Energy')
    assert.ok(!isConceptError(result))
    assert.equal(result.graph.concepts.length, 4)
    assert.equal(result.graph.relations.length, 3)
    const motion = result.graph.concepts.find((one) => one.title === 'Motion')
    const mechanics = result.graph.concepts.find((one) => one.title === 'Mechanics')
    assert.equal(motion?.parent, mechanics?.id)
  })

  test('tabs and spaces are both read as indentation', () => {
    const result = fromOutline('Top\n\tChild\n\t\tGrandchild')
    assert.ok(!isConceptError(result))
    assert.equal(result.graph.relations.length, 2)
  })

  test('list markers are stripped from the titles', () => {
    const result = fromOutline('- Top\n  - Child')
    assert.ok(!isConceptError(result))
    assert.equal(result.graph.concepts[0].title, 'Top')
  })

  test('an imported relationship is marked proposed, because an outline is not a check', () => {
    const result = fromOutline('A\n  B')
    assert.ok(!isConceptError(result))
    assert.equal(result.graph.relations[0].status, 'proposed')
    assert.equal(result.graph.concepts[0].provenance, 'imported')
    assert.ok(result.notes[0].includes('proposed'))
  })

  test('statements become typed relationships without a model', () => {
    const result = fromStatements('A contains B\nB depends on C\nC causes D')
    assert.ok(!isConceptError(result))
    assert.equal(result.graph.relations.length, 3)
    assert.deepEqual(result.graph.relations.map((one) => one.kind), ['contains', 'depends-on', 'causes'])
    assert.equal(result.graph.concepts.length, 4)
  })

  test('the same concept named twice becomes one concept', () => {
    const result = fromStatements('A contains B\nA contains C')
    assert.ok(!isConceptError(result))
    assert.equal(result.graph.concepts.length, 3)
  })

  test('a line with no recognised verb is reported rather than dropped', () => {
    const result = fromStatements('A contains B\nsomething about nothing')
    assert.ok(!isConceptError(result))
    assert.equal(result.unread.length, 1)
    assert.equal(result.unread[0].line, 2)
    assert.match(result.unread[0].why, /No relationship word was recognised/)
    assert.ok(result.notes.some((one) => /listed rather than dropped/.test(one)))
  })

  test('a trailing full stop does not become part of a concept name', () => {
    const result = fromStatements('Heat causes expansion.')
    assert.ok(!isConceptError(result))
    assert.ok(result.graph.concepts.some((one) => one.title === 'expansion'))
  })
})

describe('layout', () => {
  test('a layout is deterministic', () => {
    const first = layout(computer(), 'hierarchical')
    const again = layout(computer(), 'hierarchical')
    assert.ok(!isConceptError(first) && !isConceptError(again))
    assert.deepEqual(first.positions, again.positions)
  })

  test('a hierarchical layout puts deeper concepts lower', () => {
    const result = layout(computer(), 'hierarchical')
    assert.ok(!isConceptError(result))
    assert.ok(result.positions.alu.y > result.positions.cpu.y)
    assert.ok(result.positions.cpu.y > result.positions.computer.y)
  })

  test('a manual layout leaves the positions alone and says why', () => {
    const graph = computer()
    graph.concepts[0].position = { x: 42, y: 99 }
    const result = layout(graph, 'manual')
    assert.ok(!isConceptError(result))
    assert.deepEqual(result.positions.computer, { x: 42, y: 99 })
    assert.match(result.describe, /not to the model/)
  })

  test('a grid places everything without overlapping', () => {
    const result = layout(computer(), 'grid')
    assert.ok(!isConceptError(result))
    const seen = new Set(Object.values(result.positions).map((one) => `${one.x},${one.y}`))
    assert.equal(seen.size, 4)
  })

  test('a radial layout puts each level on its own ring', () => {
    const result = layout(computer(), 'radial')
    assert.ok(!isConceptError(result))
    const cpuRadius = Math.hypot(result.positions.cpu.x, result.positions.cpu.y)
    const aluRadius = Math.hypot(result.positions.alu.x, result.positions.alu.y)
    assert.ok(aluRadius > cpuRadius)
  })
})

describe('analysis', () => {
  test('concepts are counted by kind, status and provenance', () => {
    const graph = computer()
    graph.concepts.push(concept('guess', 'A guess', { provenance: 'model-suggested' }))
    const result = analyse(graph)
    assert.equal(result.concepts, 5)
    assert.equal(result.byKind.concept, 5)
    assert.equal(result.byProvenance['model-suggested'], 1)
  })

  test('a model-suggested concept is called out as not yet accepted', () => {
    const graph = computer()
    graph.concepts.push(concept('guess', 'A guess', { provenance: 'model-suggested' }))
    assert.ok(analyse(graph).notes.some((one) => /came from a model and have not been accepted/.test(one)))
  })

  test('the most connected concepts are found', () => {
    const result = analyse(computer())
    assert.equal(result.central[0].id, 'computer')
    assert.equal(result.central[0].degree, 2)
  })

  test('a claim with nothing supporting it is a gap rather than an error', () => {
    const graph: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: [concept('c1', 'A claim', { kind: 'claim' })],
      relations: []
    }
    const result = analyse(graph)
    assert.deepEqual(result.unsupportedClaims, ['c1'])
    assert.ok(result.notes.some((one) => /gap in the model, not an error/.test(one)))
  })

  test('contradictions are reported and both sides kept', () => {
    const graph: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: [concept('a', 'A'), concept('b', 'B')],
      relations: [relation('r', 'a', 'b', 'contradicts')]
    }
    const result = analyse(graph)
    assert.deepEqual(result.contradictions, [{ a: 'a', b: 'b' }])
    assert.ok(result.notes.some((one) => /nothing here decides between them/.test(one)))
  })

  test('a graph made mostly of the weakest relationship is called out', () => {
    const graph: ConceptGraph = {
      ...emptyGraph('g', ''),
      concepts: Array.from({ length: 6 }, (_, i) => concept(`c${i}`, `C${i}`)),
      relations: Array.from({ length: 5 }, (_, i) => relation(`r${i}`, `c${i}`, `c${i + 1}`, 'associated-with'))
    }
    assert.ok(analyse(graph).notes.some((one) => /makes the paths through the model mean something/.test(one)))
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the Page is built on', () => {
    assert.ok(CONCEPT_ASSUMPTIONS.length >= 8)
    assert.ok(CONCEPT_ASSUMPTIONS.some((one) => /Cycles are checked per relationship type/.test(one)))
    assert.ok(CONCEPT_ASSUMPTIONS.some((one) => /marked as a suggestion/.test(one)))
    assert.ok(CONCEPT_ASSUMPTIONS.some((one) => /never a claim about the world/.test(one)))
  })
})
