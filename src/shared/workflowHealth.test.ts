import test from 'node:test'
import assert from 'node:assert/strict'
import { findings, health, repairs } from './workflowHealth.ts'
import type { WorkflowRunSummary } from './workflows.ts'
import type { StepRecord } from './browserControl.ts'

const step = (label: string, over: Partial<StepRecord> = {}): StepRecord => ({
  runId: 'r',
  path: label,
  label,
  kind: 'action',
  status: 'success',
  startedAt: 0,
  durationMs: 100,
  ...over
})

let clock = Date.now() - 2 * 86_400_000
const run = (status: WorkflowRunSummary['status'], steps: StepRecord[] = [step('Go')], over: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary =>
  ({
    runId: `run${(clock += 1000)}`,
    workflowId: 'w1',
    workflowName: 'W',
    version: 1,
    source: 'user',
    trigger: 'manual',
    status,
    startedAt: clock,
    finishedAt: clock,
    durationMs: steps.reduce((s, x) => s + x.durationMs, 0) || 100,
    stepsRun: steps.length,
    steps,
    ...over
  }) as WorkflowRunSummary

// ---------------------------------------------------------------- the verdict

test('a workflow that has never run says so, rather than looking healthy', () => {
  const report = health([])
  assert.equal(report.health, 'unproven')
  assert.equal(report.successRate, null)
  assert.match(report.summary, /never been run/)
})

test('too few runs is too few to judge, and a rate is withheld rather than invented', () => {
  const report = health([run('completed'), run('completed')])
  assert.equal(report.health, 'unproven')
  assert.equal(report.successRate, null, 'two runs is not a success rate')
  assert.match(report.summary, /too few/)
})

test('a workflow failing its recent runs in a row is broken, whatever its lifetime average', () => {
  // Five successes long ago do not make a workflow that has failed four times running healthy. The average is a fact
  // about the past; the streak is a fact about now.
  const history = [run('completed'), run('completed'), run('completed'), run('completed'), run('completed')]
  const lately = [1, 2, 3, 4].map(() => run('failed', [step('Click Sign in', { status: 'failed', error: { code: 'not-found', message: 'No match', recoverable: true } })]))
  const report = health([...history, ...lately])
  assert.equal(report.health, 'broken')
  assert.equal(report.failingStreak, 4)
  assert.match(report.summary, /Click Sign in/)
})

test('two failures after a working history is failing, not yet broken', () => {
  const report = health([run('completed'), run('completed'), run('completed'), run('failed'), run('failed')])
  assert.equal(report.health, 'failing')
  assert.equal(report.failingStreak, 2)
})

test('a workflow that mostly works but not always is flaky, with a rate that means something', () => {
  const runs = [run('completed'), run('completed'), run('failed'), run('failed'), run('completed'), run('failed')]
  const report = health(runs)
  assert.equal(report.health, 'flaky')
  assert.equal(report.successRate, 0.5)
})

test('a workflow nobody has run for months is stale rather than healthy', () => {
  const old = [run('completed'), run('completed'), run('completed')].map((r) => ({ ...r, finishedAt: 1000 }))
  const report = health(old, 1000 + 120 * 86_400_000)
  assert.equal(report.health, 'stale')
  assert.match(report.summary, /has not run in \d+ days/i)
})

test('a run that was stopped is not counted as a failure', () => {
  const report = health([run('completed'), run('completed'), run('completed'), run('stopped')])
  assert.equal(report.health, 'healthy')
  assert.equal(report.failingStreak, 0)
})

// ---------------------------------------------------------------- what the runs show

test('nothing is claimed about a workflow with no runs', () => {
  assert.deepEqual(findings([]), [])
})

test('a step that eats most of the run is pointed out, with the measurement', () => {
  const runs = [
    run('completed', [step('Fetch', { durationMs: 9000 }), step('Save', { durationMs: 200 })]),
    run('completed', [step('Fetch', { durationMs: 8500 }), step('Save', { durationMs: 200 })])
  ]
  const slow = findings(runs).find((f) => f.kind === 'slow-step')
  assert.equal(slow?.step, 'Fetch')
  assert.match(slow!.detail, /\d+% of the time/)
})

test('a step that has never once worked first time is pointed out as acting too early', () => {
  const runs = [1, 2, 3].map(() => run('completed', [step('Click', { attempts: 3 })]))
  const always = findings(runs).find((f) => f.kind === 'always-retries')
  assert.match(always!.detail, /every time it ran \(3 of 3\)/)
  assert.match(always!.suggestion, /before the page is ready/)
})

test('a step that succeeds without the browser ever confirming it is flagged', () => {
  const runs = [1, 2, 3].map(() => run('completed', [step('Type', { kind: 'action', status: 'success' })]))
  const unverified = findings(runs).find((f) => f.kind === 'unverified')
  assert.match(unverified!.detail, /without the browser confirming/)
})

test('a step that does confirm itself is not flagged', () => {
  const runs = [1, 2, 3].map(() => run('completed', [step('Type', { verification: { verified: true, detail: 'typed' } })]))
  assert.equal(findings(runs).find((f) => f.kind === 'unverified'), undefined)
})

// ---------------------------------------------------------------- repairs, proposed not applied

test('a healthy workflow needs no repairs', () => {
  assert.deepEqual(repairs([run('completed'), run('completed'), run('completed')]), [])
})

test('the repair proposed matches the error the browser actually gave', () => {
  const failing = (code: string, message: string): WorkflowRunSummary =>
    run('failed', [step('Click Buy', { status: 'failed', error: { code: code as never, message, recoverable: true } })])

  const notFound = repairs([failing('not-found', 'No match'), failing('not-found', 'No match')])
  assert.match(notFound[0].proposal, /by what it says or does/)

  const stale = repairs([failing('stale-element', 'Gone'), failing('stale-element', 'Gone')])
  assert.match(stale[0].proposal, /wait for the page to settle/i)

  const blocked = repairs([failing('blocked', 'Permission refused'), failing('blocked', 'Permission refused')])
  assert.match(blocked[0].proposal, /needs a person/i)

  const gone = repairs([failing('unknown-capability', 'No such thing'), failing('unknown-capability', 'No such thing')])
  assert.match(gone[0].proposal, /no longer has/)
})

test('no repair is ever marked safe to apply on its own', () => {
  // A workflow that quietly rewrote itself after a failure is one nobody could predict from reading it -- and the
  // first time it repaired itself into doing something consequential, it would do that too.
  const failing = [1, 2].map(() => run('failed', [step('Send', { status: 'failed', error: { code: 'not-found', message: 'x', recoverable: true } })]))
  assert.ok(repairs(failing).length > 0)
  assert.ok(repairs(failing).every((r) => r.safe === false))
})

test('a repair says what actually went wrong, in the browser’s words', () => {
  const failing = [1, 2].map(() => run('failed', [step('Click', { status: 'failed', error: { code: 'timeout', message: 'Timed out after 30s', recoverable: true } })]))
  assert.equal(repairs(failing)[0].because, 'Timed out after 30s')
})
