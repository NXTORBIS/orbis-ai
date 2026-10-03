import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CapabilityDescriptor } from '../shared/browserControl.ts'
import { beginStep, finish, newSession, proposeStep, recordExecution, recordVerification } from '../shared/stepPlan.ts'
import type { StepDraft, StepSession } from '../shared/stepPlan.ts'
import type { ActiveWorkflowRun, WorkflowRunSummary } from '../shared/workflows.ts'
import { SkillManager } from './skillManager.ts'
import { WorkflowStore } from './workflows/store.ts'

const cap = (id: string, params: CapabilityDescriptor['params'] = {}): CapabilityDescriptor => ({
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
  available: true
})
const CAPS = [
  cap('navigation.go', { url: { type: 'string', description: '', required: true } }),
  cap('page.click', { locator: { type: 'object', description: '', required: true } }),
  cap('page.fill', { locator: { type: 'object', description: '', required: true }, text: { type: 'string', description: '', required: true } })
]

function ran(goal: string, steps: StepDraft[]): StepSession {
  let s = newSession({ id: `run-${Math.random()}`, profileId: 'default', goal })
  steps.forEach((draft, i) => {
    const id = `s${i}`
    s = proposeStep(s, draft, id)
    s = beginStep(s, id)
    s = recordExecution(s, id, { ok: true })
    s = recordVerification(s, id, { verified: true, detail: 'seen on the page' })
  })
  return finish(s, 'Done.')
}

const PDF_RUN = (): StepSession =>
  ran('Download the latest PDF from the reports page', [
    { intent: 'Open the reports page', capability: 'navigation.go', params: { url: 'https://www.example.edu/reports' } },
    { intent: 'Search reports', capability: 'page.fill', params: { locator: { role: 'searchbox' }, text: 'annual report' } },
    { intent: 'Click the newest PDF', capability: 'page.click', params: { locator: { role: 'link', name: 'PDF' } } }
  ])

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-skills-'))
  const store = new WorkflowStore(dir)
  const started: { id: string; inputs?: Record<string, unknown> }[] = []
  const skills = new SkillManager({
    userData: dir,
    capabilities: () => CAPS,
    workflows: {
      get: (id) => store.get(id),
      save: (w, note) => store.save(w, note),
      remove: (id) => store.remove(id),
      history: (id) => store.runs(id),
      versions: (id) => store.versions(id),
      restoreVersion: (id, v) => store.restoreVersion(id, v),
      run: async (id, options) => {
        started.push({ id, inputs: options.inputs })
        return { runId: 'r', workflowId: id } as ActiveWorkflowRun
      }
    },
    announce: () => undefined
  })
  const useProfile = (id: string): void => {
    store.useProfile(id)
    skills.useProfile(id)
  }
  return { dir, store, skills, started, useProfile, done: () => rmSync(dir, { recursive: true, force: true }) }
}

const summary = (workflowId: string, version: number, status: WorkflowRunSummary['status'], startedAt: number): WorkflowRunSummary => ({
  runId: `r${startedAt}`,
  workflowId,
  workflowName: 'x',
  version,
  source: 'automation',
  trigger: 'orion',
  status,
  startedAt,
  finishedAt: startedAt + 1,
  durationMs: 1,
  stepsRun: 3,
  steps: []
})

test('learning is off until turned on, and saving a run makes a workflow and a skill with nothing faked', async () => {
  const t = setup()
  try {
    assert.equal((await t.skills.settings()).learnFromRuns, false)
    await t.skills.setSettings({ learnFromRuns: true })
    assert.equal((await t.skills.settings()).learnFromRuns, true)

    const skill = await t.skills.saveFromRun(PDF_RUN(), { name: 'Latest report PDF' })
    assert.equal(skill.workflow.name, 'Latest report PDF')
    assert.equal(skill.workflow.version, 1, 'saved once, with no empty version before it')
    assert.equal(skill.workflow.steps, 3)
    assert.deepEqual(skill.meta.domains, ['example.edu'])
    assert.equal(skill.stats.runs, 0, 'never run, so no statistics')
    assert.equal(skill.health, 'verified')

    const workflow = await t.store.get(skill.workflow.id)
    assert.equal(workflow?.titleSource, 'user', 'Orion will not rename a skill the person named')
    assert.deepEqual((await t.store.versions(skill.workflow.id)).length, 0)
  } finally {
    t.done()
  }
})

test('skills belong to the profile that made them', async () => {
  const t = setup()
  try {
    await t.skills.saveFromRun(PDF_RUN())
    t.useProfile('work')
    assert.deepEqual(await t.skills.list(), [])
    assert.deepEqual((await t.skills.match('download the newest pdf report')).matches, [])
    t.useProfile('default')
    assert.equal((await t.skills.list()).length, 1)
  } finally {
    t.done()
  }
})

test('a matching request finds the skill, and running it remembers how it was asked for', async () => {
  const t = setup()
  try {
    const skill = await t.skills.saveFromRun(PDF_RUN())
    const { matches } = await t.skills.match('grab the newest report pdf', 'https://example.edu/reports')
    assert.equal(matches[0]?.workflow.id, skill.workflow.id)

    await t.skills.run(skill.workflow.id, { search: 'budget' }, 'grab the newest report pdf')
    assert.deepEqual(t.started, [{ id: skill.workflow.id, inputs: { search: 'budget' } }])
    assert.deepEqual((await t.skills.get(skill.workflow.id))?.meta.examples, ['grab the newest report pdf'])

    await t.skills.setSettings({ reuse: 'never' })
    assert.deepEqual((await t.skills.match('grab the newest report pdf')).matches, [], 'switched to never, nothing is offered')
  } finally {
    t.done()
  }
})

test('a switched-off skill is not offered or run until switched back on', async () => {
  const t = setup()
  try {
    const skill = await t.skills.saveFromRun(PDF_RUN())
    await t.skills.setEnabled(skill.workflow.id, false)
    assert.equal((await t.skills.match('download the latest pdf report', 'https://example.edu')).matches.length, 0)
    await assert.rejects(t.skills.run(skill.workflow.id), /switched off/)
    await t.skills.setEnabled(skill.workflow.id, true)
    await t.skills.run(skill.workflow.id)
    assert.equal(t.started.length, 1)
  } finally {
    t.done()
  }
})

test('health and statistics come from the real run history, and a failing version can be rolled back', async () => {
  const t = setup()
  try {
    const skill = await t.skills.saveFromRun(PDF_RUN())
    const id = skill.workflow.id
    await t.store.recordRun(summary(id, 1, 'completed', 10))
    // The skill is edited into version 2, which then keeps failing.
    const w = (await t.store.get(id))!
    await t.store.save({ ...w, steps: w.steps.slice(0, 2) }, 'edited')
    for (const at of [20, 30, 40]) await t.store.recordRun(summary(id, 2, 'failed', at))

    const view = (await t.skills.get(id))!
    assert.equal(view.workflow.version, 2)
    assert.equal(view.stats.runs, 4)
    assert.equal(view.stats.succeeded, 1)
    assert.equal(view.health, 'unstable')
    assert.equal(view.knownGoodVersion, 1)

    const back = await t.skills.rollBack(id)
    assert.equal(back.workflow.steps, 3, 'the steps of the version that worked are back')
    assert.ok((await t.store.versions(id)).some((v) => v.version === 2), 'the failing version is kept, so going back can be undone')
  } finally {
    t.done()
  }
})

test('deleting skills keeps their workflows unless asked, and a damaged skill file does not hide the rest', async () => {
  const t = setup()
  try {
    const a = await t.skills.saveFromRun(PDF_RUN())
    const b = await t.skills.saveFromRun(PDF_RUN())
    writeFileSync(join(t.dir, 'skills', 'broken.json'), '{ not json')
    const fresh = new SkillManager({ userData: t.dir, capabilities: () => CAPS, workflows: { get: (id) => t.store.get(id), save: (w) => t.store.save(w), remove: (id) => t.store.remove(id), history: (id) => t.store.runs(id), versions: (id) => t.store.versions(id), restoreVersion: (id, v) => t.store.restoreVersion(id, v), run: async () => ({}) as ActiveWorkflowRun }, announce: () => undefined })
    assert.equal((await fresh.list()).length, 2)

    await t.skills.remove(a.workflow.id)
    assert.ok(await t.store.get(a.workflow.id), 'its workflow is kept')
    await t.skills.remove(b.workflow.id, true)
    assert.equal(await t.store.get(b.workflow.id), null, 'removed too, because that was asked for')
    assert.deepEqual(await t.skills.list(), [])
  } finally {
    t.done()
  }
})

test('an exported skill imports switched off and untrusted, and cannot run until switched on', async () => {
  const t = setup()
  try {
    const skill = await t.skills.saveFromRun(PDF_RUN())
    const json = await t.skills.exportSkill(skill.workflow.id)
    assert.ok(!json.includes('"workflowId"'), 'this computer’s ids are not shared')

    const { skill: imported, warnings } = await t.skills.importSkill(json)
    assert.notEqual(imported.workflow.id, skill.workflow.id)
    assert.equal(imported.meta.enabled, false)
    assert.equal(imported.meta.trust, 'untrusted')
    assert.ok(warnings.length > 0)
    await assert.rejects(t.skills.run(imported.workflow.id), /switched off/)

    const on = await t.skills.setEnabled(imported.workflow.id, true)
    assert.equal(on.meta.trust, 'approved', 'switching it on is the person saying they have looked')

    await assert.rejects(t.skills.importSkill('{"kind":"orbis-skill","format":1}'), /incomplete/)
    await assert.rejects(t.skills.importSkill('not json'), /not an Orbis skill/)
  } finally {
    t.done()
  }
})

test('nothing typed into a sensitive field reaches the disk', async () => {
  const t = setup()
  try {
    await t.skills.saveFromRun(
      ran('Sign in and open orders', [
        { intent: 'Open sign in', capability: 'navigation.go', params: { url: 'https://shop.example.com/login' } },
        { intent: 'Enter the password', capability: 'page.fill', params: { locator: { label: 'Password' }, text: 'correct-horse-battery' } },
        { intent: 'Open orders', capability: 'page.click', params: { locator: { name: 'Orders' } } }
      ])
    )
    const everything = (folder: string): string =>
      readdirSync(folder, { withFileTypes: true })
        .map((entry) => (entry.isDirectory() ? everything(join(folder, entry.name)) : readFileSync(join(folder, entry.name), 'utf8')))
        .join('\n')
    mkdirSync(join(t.dir, 'workflows'), { recursive: true })
    assert.ok(!everything(t.dir).includes('correct-horse-battery'))
  } finally {
    t.done()
  }
})
