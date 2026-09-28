import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  assessArtifacts,
  checkConnection,
  checkProject,
  diffProjects,
  importBundle,
  isProjectError,
  lineageOf,
  planRestore,
  PROJECT_ASSUMPTIONS,
  requirementsOf,
  resolveVariable,
  runOrder,
  shadowedVariables,
  type Artifact,
  type Checkpoint,
  type Connection,
  type Conversion,
  type PageInstance,
  type Port,
  type Project,
  type Variable
} from './projectGraph.ts'

const port = (name: string, type: Port['type'], over: Partial<Port> = {}): Port => ({
  name,
  type,
  unit: '',
  required: true,
  describe: '',
  ...over
})

const page = (id: string, over: Partial<PageInstance> = {}): PageInstance => ({
  id,
  pageType: 'generic',
  title: id,
  inputs: [],
  outputs: [],
  settings: {},
  ...over
})

const connection = (id: string, fromPage: string, fromPort: string, toPage: string, toPort: string, conversionName: string | null = null): Connection => ({
  id,
  fromPage,
  fromPort,
  toPage,
  toPort,
  conversionName
})

const projectOf = (pages: PageInstance[], connections: Connection[] = [], conversions: Conversion[] = []): Project => ({
  id: 'p',
  title: 'A project',
  pages,
  connections,
  conversions
})

// ------------------------------------------------------------ compatibility

test('matching type and unit goes straight through', () => {
  const project = projectOf([
    page('a', { outputs: [port('out', 'number', { unit: 'kg' })] }),
    page('b', { inputs: [port('in', 'number', { unit: 'kg' })] })
  ])
  const result = checkConnection(project, connection('c', 'a', 'out', 'b', 'in'))
  assert.equal(result.ok, true)
  assert.equal(result.reason, 'exact')
})

test('a type mismatch is refused rather than coerced', () => {
  const project = projectOf([page('a', { outputs: [port('out', 'text')] }), page('b', { inputs: [port('in', 'number')] })])
  const result = checkConnection(project, connection('c', 'a', 'out', 'b', 'in'))
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'type-mismatch')
  assert.match(result.describe, /would run and mean nothing/)
})

test('a unit mismatch with matching types is still refused', () => {
  const project = projectOf([
    page('a', { outputs: [port('out', 'number', { unit: 'metres' })] }),
    page('b', { inputs: [port('in', 'number', { unit: 'feet' })] })
  ])
  const result = checkConnection(project, connection('c', 'a', 'out', 'b', 'in'))
  assert.equal(result.reason, 'unit-mismatch')
  assert.match(result.describe, /computes perfectly and gives a wrong answer/)
})

test('a named conversion makes the connection work and says so', () => {
  const project = projectOf(
    [page('a', { outputs: [port('out', 'number', { unit: 'metres' })] }), page('b', { inputs: [port('in', 'number', { unit: 'feet' })] })],
    [],
    [{ name: 'm-to-ft', from: 'number', to: 'number', fromUnit: 'metres', toUnit: 'feet', lossy: false, describe: '' }]
  )
  const result = checkConnection(project, connection('c', 'a', 'out', 'b', 'in', 'm-to-ft'))
  assert.equal(result.ok, true)
  assert.equal(result.reason, 'converted')
})

test('a lossy conversion says so at the point of use', () => {
  const project = projectOf(
    [page('a', { outputs: [port('out', 'series')] }), page('b', { inputs: [port('in', 'number')] })],
    [],
    [{ name: 'mean', from: 'series', to: 'number', fromUnit: '', toUnit: '', lossy: true, describe: 'only the average survives' }]
  )
  const result = checkConnection(project, connection('c', 'a', 'out', 'b', 'in', 'mean'))
  assert.equal(result.lossy, true)
  assert.match(result.describe, /only the average survives/)
})

test('a conversion that does not fit the ports it is used on is refused', () => {
  const project = projectOf(
    [page('a', { outputs: [port('out', 'text')] }), page('b', { inputs: [port('in', 'number')] })],
    [],
    [{ name: 'm-to-ft', from: 'number', to: 'number', fromUnit: 'metres', toUnit: 'feet', lossy: false, describe: '' }]
  )
  assert.equal(checkConnection(project, connection('c', 'a', 'out', 'b', 'in', 'm-to-ft')).reason, 'wrong-conversion')
})

test('naming a conversion that is not defined is refused', () => {
  const project = projectOf([page('a', { outputs: [port('out', 'text')] }), page('b', { inputs: [port('in', 'number')] })])
  assert.equal(checkConnection(project, connection('c', 'a', 'out', 'b', 'in', 'ghost')).reason, 'no-such-conversion')
})

test('a connection to a port that does not exist names what is missing', () => {
  const project = projectOf([page('a', { outputs: [port('out', 'number')] }), page('b', { inputs: [] })])
  const result = checkConnection(project, connection('c', 'a', 'out', 'b', 'in'))
  assert.equal(result.reason, 'missing-port')
  assert.match(result.describe, /input "in"/)
})

// ------------------------------------------------------------ the project

const pipeline = (): Project =>
  projectOf(
    [
      page('source', { outputs: [port('data', 'table')] }),
      page('analyse', { inputs: [port('data', 'table')], outputs: [port('summary', 'text')] }),
      page('report', { inputs: [port('body', 'text')] })
    ],
    [connection('c1', 'source', 'data', 'analyse', 'data'), connection('c2', 'analyse', 'summary', 'report', 'body')]
  )

test('a well-formed pipeline holds together', () => {
  const check = checkProject(pipeline())
  assert.equal(check.ok, true)
  assert.deepEqual(check.problems, [])
})

test('a required input nothing feeds stops the project', () => {
  const project = pipeline()
  project.connections = project.connections.filter((one) => one.id !== 'c1')
  const check = checkProject(project)
  assert.equal(check.ok, false)
  assert.deepEqual(check.unfed, [{ pageId: 'analyse', port: 'data' }])
})

test('an optional input nothing feeds is fine', () => {
  const project = projectOf([page('a', { inputs: [port('extra', 'number', { required: false })] })])
  assert.equal(checkProject(project).ok, true)
})

test('an unused output is reported without blocking', () => {
  const check = checkProject(pipeline())
  assert.deepEqual(check.unused, [])
  const project = pipeline()
  project.pages[1] = { ...(project.pages[1] as PageInstance), outputs: [port('summary', 'text'), port('spare', 'number')] }
  const again = checkProject(project)
  assert.deepEqual(again.unused, [{ pageId: 'analyse', port: 'spare' }])
  assert.equal(again.ok, true)
})

test('pages feeding each other in a circle are refused', () => {
  const project = projectOf(
    [
      page('a', { inputs: [port('in', 'number')], outputs: [port('out', 'number')] }),
      page('b', { inputs: [port('in', 'number')], outputs: [port('out', 'number')] })
    ],
    [connection('c1', 'a', 'out', 'b', 'in'), connection('c2', 'b', 'out', 'a', 'in')]
  )
  const check = checkProject(project)
  assert.equal(check.ok, false)
  assert.ok(check.problems.some((one) => one.kind === 'cycle'))
  assert.ok(isProjectError(runOrder(project)))
})

test('lossy connections are listed once for the project', () => {
  const project = projectOf(
    [page('a', { outputs: [port('out', 'series')] }), page('b', { inputs: [port('in', 'number')] })],
    [connection('c', 'a', 'out', 'b', 'in', 'mean')],
    [{ name: 'mean', from: 'series', to: 'number', fromUnit: '', toUnit: '', lossy: true, describe: 'x' }]
  )
  assert.deepEqual(checkProject(project).lossy, ['c'])
})

test('the run order groups pages that can run at the same time', () => {
  const project = projectOf(
    [
      page('a', { outputs: [port('out', 'number')] }),
      page('b', { outputs: [port('out', 'number')] }),
      page('c', { inputs: [port('x', 'number'), port('y', 'number')] })
    ],
    [connection('c1', 'a', 'out', 'c', 'x'), connection('c2', 'b', 'out', 'c', 'y')]
  )
  const result = runOrder(project)
  assert.ok(!isProjectError(result))
  assert.deepEqual(result.levels, [['a', 'b'], ['c']])
})

// ------------------------------------------------------------ variables

const variables = (): Variable[] => [
  { name: 'rate', scope: 'project', ownerId: null, type: 'number', unit: '%', value: 4 },
  { name: 'rate', scope: 'page', ownerId: 'analyse', type: 'number', unit: '%', value: 6 },
  { name: 'label', scope: 'project', ownerId: null, type: 'text', unit: '', value: 'Q3' }
]

test('a page variable shadows a project one and the shadowing is reported', () => {
  const result = resolveVariable(variables(), 'analyse', 'rate')
  assert.ok(!isProjectError(result))
  assert.equal(result.value, 6)
  assert.equal(result.from, 'page')
  assert.deepEqual(result.shadows, { name: 'rate', value: 4 })
})

test('a page with no override sees the project value', () => {
  const result = resolveVariable(variables(), 'report', 'rate')
  assert.ok(!isProjectError(result))
  assert.equal(result.value, 4)
  assert.equal(result.from, 'project')
  assert.equal(result.shadows, null)
})

test('a variable nothing defines is refused rather than defaulted', () => {
  assert.ok(isProjectError(resolveVariable(variables(), 'report', 'ghost')))
})

test('every shadowed variable can be listed for the whole project', () => {
  assert.deepEqual(shadowedVariables(variables()), [{ name: 'rate', pageId: 'analyse', projectValue: 4, pageValue: 6 }])
})

// ------------------------------------------------------------ lineage

const artifacts = (): Artifact[] => [
  { id: 'raw', producedBy: 'source', port: 'data', fingerprint: 'f-raw', fromArtifacts: [] },
  { id: 'summary', producedBy: 'analyse', port: 'summary', fingerprint: 'f-summary', fromArtifacts: ['raw'] },
  { id: 'report', producedBy: 'report', port: 'body', fingerprint: 'f-report', fromArtifacts: ['summary'] }
]

test('lineage runs all the way back and names the pages in order', () => {
  const result = lineageOf(artifacts(), 'report')
  assert.ok(!isProjectError(result))
  assert.deepEqual(result.upstream, ['summary', 'raw'])
  assert.deepEqual(result.pages, ['source', 'analyse', 'report'])
})

test('an artifact from nothing else is named as an input rather than a result', () => {
  const result = lineageOf(artifacts(), 'raw')
  assert.ok(!isProjectError(result))
  assert.match(result.describe, /an input rather than a result/)
})

test('asking about an artifact that is not there is refused', () => {
  assert.ok(isProjectError(lineageOf(artifacts(), 'ghost')))
})

// ------------------------------------------------------------ staleness

const printOf = (artifact: Artifact, upstream: readonly string[]): string => `${artifact.producedBy}:${upstream.join(',')}`

test('an artifact matching what produced it is current', () => {
  const list: Artifact[] = [
    { id: 'raw', producedBy: 'source', port: 'd', fingerprint: printOf({ id: 'raw', producedBy: 'source', port: 'd', fingerprint: '', fromArtifacts: [] }, []), fromArtifacts: [] }
  ]
  const report = assessArtifacts(list, printOf)
  assert.deepEqual(report.current, ['raw'])
  assert.deepEqual(report.stale, [])
})

test('a change upstream makes the downstream artifact stale and names the cause', () => {
  const raw: Artifact = { id: 'raw', producedBy: 'source', port: 'd', fingerprint: 'old', fromArtifacts: [] }
  const summary: Artifact = { id: 'summary', producedBy: 'analyse', port: 's', fingerprint: 'also-old', fromArtifacts: ['raw'] }
  const report = assessArtifacts([raw, summary], printOf)
  assert.deepEqual(report.stale, ['raw', 'summary'])
  assert.match(report.because.find((one) => one.artifactId === 'summary')?.reason ?? '', /raw changed/)
})

test('an artifact whose upstream is gone is unknown, not current', () => {
  const orphan: Artifact = { id: 'x', producedBy: 'p', port: 'o', fingerprint: 'anything', fromArtifacts: ['gone'] }
  const report = assessArtifacts([orphan], printOf)
  assert.deepEqual(report.unknown, ['x'])
  assert.equal(report.current.includes('x'), false)
  assert.equal(report.stale.includes('x'), false)
  assert.match(report.because[0]?.reason ?? '', /cannot be checked/)
})

test('unknown spreads downstream', () => {
  const orphan: Artifact = { id: 'x', producedBy: 'p', port: 'o', fingerprint: 'a', fromArtifacts: ['gone'] }
  const after: Artifact = { id: 'y', producedBy: 'q', port: 'o', fingerprint: 'b', fromArtifacts: ['x'] }
  const report = assessArtifacts([orphan, after], printOf)
  assert.deepEqual(report.unknown.sort(), ['x', 'y'])
})

test('a page changing with unchanged inputs is reported as the page having changed', () => {
  const raw: Artifact = { id: 'raw', producedBy: 'source', port: 'd', fingerprint: printOf({ id: 'raw', producedBy: 'source', port: 'd', fingerprint: '', fromArtifacts: [] }, []), fromArtifacts: [] }
  const summary: Artifact = { id: 'summary', producedBy: 'analyse', port: 's', fingerprint: 'stale', fromArtifacts: ['raw'] }
  const report = assessArtifacts([raw, summary], printOf)
  assert.match(report.because.find((one) => one.artifactId === 'summary')?.reason ?? '', /page that produced/)
})

// ------------------------------------------------------------ checkpoints

const checkpointOf = (project: Project): Checkpoint => ({
  id: 'k',
  label: 'Before the rewrite',
  takenAt: '2026-03-01',
  project,
  variables: [],
  artifacts: []
})

test('restoring an unchanged project would do nothing', () => {
  const plan = planRestore(pipeline(), checkpointOf(pipeline()))
  assert.match(plan.describe, /would do nothing/)
})

test('restoring says which pages it would lose', () => {
  const now = pipeline()
  now.pages.push(page('extra', { title: 'Extra' }))
  const plan = planRestore(now, checkpointOf(pipeline()))
  assert.match(plan.wouldLose.join(' '), /Extra/)
})

test('restoring says which removed pages come back', () => {
  const then = pipeline()
  const now = pipeline()
  now.pages = now.pages.filter((one) => one.id !== 'report')
  const plan = planRestore(now, checkpointOf(then))
  assert.match(plan.wouldRestore.join(' '), /report/)
})

test('changed settings are named as something the restore would lose', () => {
  const then = pipeline()
  const now = pipeline()
  now.pages[0] = { ...(now.pages[0] as PageInstance), settings: { window: 90 } }
  const plan = planRestore(now, checkpointOf(then))
  assert.match(plan.wouldLose.join(' '), /window/)
})

test('connections made since are named as something the restore would lose', () => {
  const then = pipeline()
  const now = pipeline()
  now.pages.push(page('side', { inputs: [port('in', 'table')] }))
  now.connections.push(connection('c3', 'source', 'data', 'side', 'in'))
  const plan = planRestore(now, checkpointOf(then))
  assert.match(plan.wouldLose.join(' '), /1 connection made since/)
})

// ------------------------------------------------------------ diff

test('a diff names added, removed and reconfigured pages', () => {
  const before = pipeline()
  const after = pipeline()
  after.pages = after.pages.filter((one) => one.id !== 'report')
  after.pages.push(page('publish'))
  after.pages[0] = { ...(after.pages[0] as PageInstance), settings: { window: 30 } }
  const diff = diffProjects(before, after)
  assert.deepEqual(diff.pagesAdded, ['publish'])
  assert.deepEqual(diff.pagesRemoved, ['report'])
  assert.deepEqual(diff.pagesChanged, [{ pageId: 'source', settings: ['window'] }])
})

test('two copies of the same project diff to nothing', () => {
  assert.match(diffProjects(pipeline(), pipeline()).describe, /the same project/)
})

test('a diff names connections made and removed', () => {
  const before = pipeline()
  const after = pipeline()
  after.connections = after.connections.filter((one) => one.id !== 'c2')
  const diff = diffProjects(before, after)
  assert.equal(diff.connectionsRemoved.length, 1)
  assert.equal(diff.connectionsAdded.length, 0)
})

// ------------------------------------------------------------ import

test('requirements are worked out from the project rather than declared', () => {
  const project = projectOf([page('a', { pageType: 'markets' }), page('b', { pageType: 'analyzer' }), page('c', { pageType: 'markets' })])
  assert.deepEqual(requirementsOf(project), [{ pageType: 'analyzer' }, { pageType: 'markets' }])
})

test('an import needing a page type this copy lacks is refused rather than left with holes', () => {
  const report = importBundle({ project: pipeline(), variables: [], requires: [{ pageType: 'markets' }] }, ['analyzer'], [])
  assert.equal(report.ok, false)
  assert.deepEqual(report.missing, ['markets'])
  assert.match(report.describe, /holes in it/)
})

test('colliding ids are renamed rather than overwriting, and every rename is listed', () => {
  const report = importBundle({ project: pipeline(), variables: [], requires: [{ pageType: 'generic' }] }, ['generic'], ['source'])
  assert.equal(report.ok, true)
  assert.deepEqual(report.renamed, [{ from: 'source', to: 'source-2' }])
  assert.match(report.describe, /rather than overwriting/)
})

test('renaming carries through the connections', () => {
  const report = importBundle({ project: pipeline(), variables: [], requires: [{ pageType: 'generic' }] }, ['generic'], ['source'])
  assert.equal(report.bundle?.project.connections[0]?.fromPage, 'source-2')
})

test('renaming carries through page-scoped variables', () => {
  const report = importBundle(
    {
      project: pipeline(),
      variables: [{ name: 'rate', scope: 'page', ownerId: 'source', type: 'number', unit: '', value: 1 }],
      requires: [{ pageType: 'generic' }]
    },
    ['generic'],
    ['source']
  )
  assert.equal(report.bundle?.variables[0]?.ownerId, 'source-2')
})

test('an import with no collisions renames nothing', () => {
  const report = importBundle({ project: pipeline(), variables: [], requires: [{ pageType: 'generic' }] }, ['generic'], [])
  assert.deepEqual(report.renamed, [])
})

test('the stated assumptions are frozen and name the unit rule', () => {
  assert.equal(Object.isFrozen(PROJECT_ASSUMPTIONS), true)
  assert.ok(PROJECT_ASSUMPTIONS.some((one) => /units differ/.test(one)))
})
