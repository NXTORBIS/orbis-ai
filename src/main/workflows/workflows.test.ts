import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CapabilityDescriptor } from '../../shared/browserControl.ts'
import { applyTransforms, callsItself, exportWorkflow, importWorkflow, newWorkflow, nextScheduledRun, validateWorkflow } from '../../shared/workflows.ts'
import type { Workflow } from '../../shared/workflows.ts'

const cap = (id: string, params: CapabilityDescriptor['params'] = {}, extra: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor => ({
  id,
  domain: id.split('.')[0] as CapabilityDescriptor['domain'],
  name: id,
  description: id,
  params,
  mutates: true,
  effects: ['read'],
  confirmation: 'none',
  requires: [],
  provider: 'main',
  available: true,
  ...extra
})
const CAPS = [
  cap('navigation.go', { url: { type: 'string', description: 'address', required: true } }),
  cap('page.extract', { selector: { type: 'string', description: 'css' } }),
  cap('page.type', { locator: { type: 'object', description: 'which', required: true }, text: { type: 'string', description: 'text', required: true } }),
  cap('history.clear', {}, { confirmation: 'always' })
]
let n = 0
const id = (): string => `id${++n}`

test('transforms work without any AI: text, numbers, regex, lists, JSON, dates, base64', () => {
  assert.equal(applyTransforms('  Order #A-1234 total $1,299.50 ', [{ op: 'trim' }, { op: 'regex', pattern: '#([A-Z]-\\d+)' }]), 'A-1234')
  assert.equal(applyTransforms('$1,299.50', [{ op: 'number' }, { op: 'formatNumber', decimals: 1 }]), '1299.5')
  assert.deepEqual(applyTransforms('a, b ,c', [{ op: 'split', separator: ',' }, { op: 'map', path: '' }]), ['a', ' b ', 'c'])
  assert.deepEqual(applyTransforms([{ p: 3, n: 'x' }, { p: 1, n: 'y' }, { p: 2, n: 'z' }], [{ op: 'filter', path: 'p', operator: '>=', value: 2 }, { op: 'sort', path: 'p', descending: true }, { op: 'map', path: 'n' }]), ['x', 'z'])
  assert.deepEqual(applyTransforms('{"a":{"b":[5,6]}}', [{ op: 'parseJson' }, { op: 'get', path: 'a.b.1' }]), 6)
  assert.equal(applyTransforms('hello world', [{ op: 'base64Encode' }, { op: 'base64Decode' }, { op: 'uppercase' }, { op: 'urlEncode' }]), 'HELLO%20WORLD')
  assert.equal(applyTransforms('2026-09-16T08:30:00Z', [{ op: 'date', format: 'date' }]), '2026-09-16')
  assert.throws(() => applyTransforms('abc', [{ op: 'number' }]), /Transform 1 \(number\): "abc" is not a number/)
})

test('validation catches unknown capabilities, missing params, variables used too early and bad loops', () => {
  const w: Workflow = newWorkflow('Test', id())
  w.steps = [
    { id: 's1', type: 'action', name: 'Go', capability: 'navigation.go', params: { url: '{{site}}' } },
    { id: 's2', type: 'action', name: 'Type key', capability: 'page.type', params: { locator: { selector: '#k' }, text: '{{apiKey}}' } },
    { id: 's3', type: 'action', name: 'Extract', capability: 'page.extract', params: { selector: '.key' }, saveAs: 'apiKey' },
    { id: 's4', type: 'action', name: 'Teleport', capability: 'tabs.teleport', params: {} },
    { id: 's5', type: 'repeat', name: 'Loop', steps: [] },
    { id: 's6', type: 'if', name: 'Check', condition: { check: 'nonsense' } as never, then: [] }
  ]
  const issues = validateWorkflow(w, { capabilities: CAPS })
  const messages = issues.filter((i) => i.level === 'error').map((i) => i.message)
  assert.ok(messages.some((m) => m.includes('{{site}} before it is created')))
  assert.ok(messages.some((m) => m.includes('{{apiKey}} before it is created')))
  assert.ok(messages.some((m) => m.includes('"tabs.teleport"')))
  assert.ok(messages.some((m) => m.includes('needs a count')))
  assert.ok(messages.some((m) => m.includes('Unknown condition')))
  w.inputs = [{ name: 'site', label: 'Site', type: 'url', required: true }]
  w.steps = w.steps.slice(0, 1)
  assert.deepEqual(validateWorkflow(w, { capabilities: CAPS, inputs: { site: 'https://example.com' } }), [])
  assert.ok(validateWorkflow(w, { capabilities: CAPS, inputs: {} }).some((i) => i.message.includes('"Site" is required')))
})

test('loop variables exist only where they are defined, and extracted values are available afterwards', () => {
  const w = newWorkflow('Loop', id())
  w.steps = [
    { id: 'a', type: 'action', name: 'List', capability: 'page.extract', params: { selector: 'li' }, saveAs: 'items' },
    { id: 'b', type: 'repeat', name: 'Each', forEach: '{{items.values}}', as: 'entry', steps: [{ id: 'c', type: 'action', name: 'Open', capability: 'navigation.go', params: { url: '{{entry}}' } }] },
    { id: 'd', type: 'transform', name: 'Count', input: '{{items.values}}', operations: [{ op: 'length' }], saveAs: 'count' },
    { id: 'e', type: 'set', name: 'Summary', values: { summary: 'Opened {{count}} pages' } }
  ]
  assert.deepEqual(validateWorkflow(w, { capabilities: CAPS }).filter((i) => i.level === 'error'), [])
})

test('permissions limit which capability domains a workflow may use', () => {
  const w = newWorkflow('Limited', id())
  w.settings.permissions = ['navigation']
  w.steps = [{ id: 'x', type: 'action', name: 'Clear', capability: 'history.clear', params: {} }]
  const issues = validateWorkflow(w, { capabilities: CAPS })
  assert.ok(issues.some((i) => i.level === 'error' && i.message.includes('"history" permission')))
  assert.ok(issues.some((i) => i.level === 'warning' && i.message.includes('always asks you to approve')))
})

test('calls to other workflows are checked for existence, inputs and loops of calls', () => {
  const a = newWorkflow('A', 'wa')
  const b = newWorkflow('B', 'wb')
  b.inputs = [{ name: 'email', label: 'Email', type: 'string', required: true }]
  a.steps = [{ id: 'call', type: 'call', name: 'Call B', workflowId: 'wb', inputs: {} }]
  b.steps = [{ id: 'back', type: 'call', name: 'Call A', workflowId: 'wa', inputs: {} }]
  const issues = validateWorkflow(a, { capabilities: CAPS, workflows: [a, b] })
  assert.ok(issues.some((i) => i.message.includes('needs its input “Email”')))
  assert.ok(issues.some((i) => i.message.includes('loop of calls')))
  assert.equal(callsItself(b, 'wa', [a, b]), true)
  const missing = newWorkflow('C', 'wc')
  missing.steps = [{ id: 'm', type: 'call', name: 'Call ghost', workflowId: 'ghost', inputs: {} }]
  assert.ok(validateWorkflow(missing, { capabilities: CAPS, workflows: [missing] }).some((i) => i.message.includes("doesn't exist")))
})

test('export strips secrets; import validates and gives new ids', () => {
  const w = newWorkflow('Keys', 'orig')
  w.inputs = [{ name: 'password', label: 'Password', type: 'secret', default: 'hunter2' }, { name: 'site', label: 'Site', type: 'url', default: 'https://example.com' }]
  w.variables = { apiKey: 'sk-live-123', note: 'keep' }
  w.steps = [{ id: 's', type: 'set', name: 'Token', values: { token: 'abc' }, sensitive: true }, { id: 't', type: 'action', name: 'Go', capability: 'navigation.go', params: { url: '{{site}}' } }]
  const exported = exportWorkflow(w)
  const text = JSON.stringify(exported)
  assert.ok(!text.includes('hunter2') && !text.includes('sk-live-123') && !text.includes('"abc"'))
  assert.ok(text.includes('keep') && text.includes('https://example.com'))
  const imported = importWorkflow(text, id)
  assert.notEqual(imported.id, 'orig')
  assert.notEqual(imported.steps[0].id, 's')
  assert.equal(imported.createdBy, 'import')
  assert.equal(imported.steps.length, 2)
  assert.throws(() => importWorkflow({ format: 1, workflow: { name: 'x', steps: [{ type: 'explode', name: 'y' }] } }, id), /Unknown step type/)
  assert.throws(() => importWorkflow('{"hello":1}', id), /not an Orbis workflow/)
})

test('schedules compute their next run', () => {
  const at = new Date(2026, 8, 16, 8, 0).getTime()
  assert.equal(nextScheduledRun({ enabled: true, kind: 'once', at }, at - 1000), at)
  assert.equal(nextScheduledRun({ enabled: true, kind: 'once', at }, at + 1000), null)
  assert.equal(nextScheduledRun({ enabled: true, kind: 'daily', at }, at + 60_000), new Date(2026, 8, 17, 8, 0).getTime())
  assert.equal(nextScheduledRun({ enabled: true, kind: 'weekly', at }, at + 1), new Date(2026, 8, 23, 8, 0).getTime())
  assert.equal(nextScheduledRun({ enabled: true, kind: 'monthly', at }, at + 1), new Date(2026, 9, 16, 8, 0).getTime())
  assert.equal(nextScheduledRun({ enabled: false, kind: 'daily', at }, at), null)
})
