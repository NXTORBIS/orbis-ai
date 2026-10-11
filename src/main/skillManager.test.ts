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
  // One more manager over the same folder is how a restart is tested: nothing is read from the disk twice otherwise.
  const make = (): SkillManager =>
    new SkillManager({
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
  const skills = make()
  const useProfile = (id: string): void => {
    store.useProfile(id)
    skills.useProfile(id)
  }
  return { dir, store, skills, make, started, useProfile, done: () => rmSync(dir, { recursive: true, force: true }) }
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

/**
 * The settings, the count of repeated goals and each skill's own file were all read inside
 * `.then(JSON.parse).catch(() => defaults)`, which makes a damaged file indistinguishable from one that was never
 * written. A settings.json cut off halfway through a save read as "no settings", and the next flick of any switch
 * renamed the defaults over the rest, with no copy of the old file anywhere.
 */

test('settings that will not parse are moved aside with their words, not read as settings nobody chose', async () => {
  const t = setup()
  try {
    await t.skills.setSettings({ learnFromRuns: true, reuse: 'auto' })
    const path = join(t.dir, 'skills', 'settings.json')
    const whole = readFileSync(path, 'utf8')
    writeFileSync(path, whole.slice(0, -3))

    const fresh = t.make()
    assert.equal((await fresh.settings()).reuse, 'suggest', 'the file made no sense, so what is in front of the person is the defaults')
    await fresh.setSettings({ enabled: false })

    const aside = readdirSync(join(t.dir, 'skills')).filter((name) => name.includes('.unreadable-'))
    assert.equal(aside.length, 1, 'the damaged file was moved aside, never deleted')
    assert.ok(readFileSync(join(t.dir, 'skills', aside[0]), 'utf8').includes('"reuse": "auto'), 'what the person had chosen is still on the disk')
    assert.equal((await t.make().settings()).enabled, false, 'and the fresh one was saved in its place')
  } finally {
    t.done()
  }
})

test('settings that are there and cannot be read are never written over, and the person is told why', async () => {
  const t = setup()
  try {
    await t.skills.setSettings({ learnFromRuns: true, reuse: 'auto' })
    const path = join(t.dir, 'skills', 'settings.json')
    rmSync(path)
    // A folder where the file belongs: reading it fails with EISDIR, not ENOENT. It stands in for the real cases --
    // something holding the file open, a backup copying it -- which cannot be made to happen reliably in a test.
    mkdirSync(path)

    const fresh = t.make()
    assert.equal((await fresh.settings()).reuse, 'suggest')
    await assert.rejects(fresh.setSettings({ enabled: false }), /nothing has been written over it/)
    assert.equal(readdirSync(path).length, 0, 'nothing was written in its place')
    assert.equal(readdirSync(join(t.dir, 'skills')).some((name) => name.includes('.unreadable-')), false, 'and it was not moved either: it may be perfectly good')
  } finally {
    t.done()
  }
})

test('a damaged count of repeated goals is kept, and the next success does not start on top of nothing', async () => {
  const t = setup()
  try {
    for (const _ of [1, 2, 3]) await t.skills.countSuccess('download the latest report')
    assert.equal(await t.skills.timesDone('download the latest report'), 3)
    const path = join(t.dir, 'skills', 'repeats.json')
    const whole = readFileSync(path, 'utf8')
    writeFileSync(path, whole.slice(0, -2))

    assert.equal(await t.skills.timesDone('download the latest report'), 0, 'asked a question it cannot answer, Orbis does not invent a number')
    assert.equal(readdirSync(join(t.dir, 'skills')).some((name) => name.includes('.unreadable-')), false, 'and asking moved nothing')

    assert.equal(await t.skills.countSuccess('download the latest report'), 1, 'counting again starts over, because the old count could not be read')
    const aside = readdirSync(join(t.dir, 'skills')).filter((name) => name.includes('.unreadable-'))
    assert.equal(aside.length, 1)
    assert.ok(readFileSync(join(t.dir, 'skills', aside[0]), 'utf8').includes('3'), 'the three the person had done are still on the disk')
  } finally {
    t.done()
  }
})

test('a skill file from a newer Orbis is left exactly where it is, not moved and not written over', async () => {
  const t = setup()
  try {
    await t.skills.saveFromRun(PDF_RUN())
    const path = join(t.dir, 'skills', 'from-the-future.json')
    const future = JSON.stringify({ format: 99, workflowId: 'from-the-future', whenToUse: 'something this Orbis cannot do' })
    writeFileSync(path, future)

    const fresh = t.make()
    assert.equal((await fresh.list()).length, 1, 'it is left out of the library, like a damaged one')
    assert.equal(readFileSync(path, 'utf8'), future, 'and still there untouched, so it is a skill again after the next update')
    assert.equal(readdirSync(join(t.dir, 'skills')).some((name) => name.includes('.unreadable-')), false)
  } finally {
    t.done()
  }
})

test('listing the library does not stop a repeated goal from being counted', async () => {
  const t = setup()
  try {
    await t.skills.countSuccess('download the latest report')
    // The count of repeated goals lives in the skills folder, beside the skills, and is not one. Walking that folder
    // put it on the list of files nothing may be written over, after which every success was read, added to and
    // thrown away -- while the number handed back kept going up, so nothing anywhere looked wrong.
    await t.skills.list()
    assert.equal(await t.skills.countSuccess('download the latest report'), 2)
    assert.equal(await t.make().timesDone('download the latest report'), 2, 'and the second one is on the disk, not only in the answer')
    assert.equal(readdirSync(join(t.dir, 'skills')).some((name) => name.includes('.unreadable-')), false, 'and it was not mistaken for a damaged skill and moved aside')
  } finally {
    t.done()
  }
})

test('settings that could not be read are asked for again, not answered from the defaults for the rest of the session', async () => {
  const t = setup()
  try {
    await t.skills.setSettings({ learnFromRuns: true, reuse: 'auto' })
    const path = join(t.dir, 'skills', 'settings.json')
    const whole = readFileSync(path, 'utf8')
    rmSync(path)
    // A folder where the file belongs: reading it fails with EISDIR, not ENOENT. It stands in for the real cases --
    // something holding the file open, a backup copying it -- which cannot be made to happen reliably in a test.
    mkdirSync(path)

    const fresh = t.make()
    assert.equal((await fresh.settings()).reuse, 'suggest', 'nothing is invented while it cannot be read')
    await assert.rejects(fresh.setSettings({ enabled: false }), /nothing has been written over it/)

    // Whatever was holding the file lets go. The words shown promise "try again in a moment", and remembering the
    // defaults made that a lie: somebody with learning switched on got no suggestions and no offer to save a skill
    // for the rest of the session, with nothing on screen to say why and no way back but restarting Orbis.
    rmSync(path, { recursive: true })
    writeFileSync(path, whole)
    assert.equal((await fresh.settings()).reuse, 'auto', 'what the person chose is back without restarting Orbis')
    assert.equal((await fresh.settings()).learnFromRuns, true)
    assert.equal((await fresh.setSettings({ enabled: false })).enabled, false, 'and the switches in front of them work again')
  } finally {
    t.done()
  }
})

test('forgetting a skill never deletes a file Orbis could not make sense of', async () => {
  const t = setup()
  try {
    const keep = await t.skills.saveFromRun(PDF_RUN())
    const future = JSON.stringify({ format: 99, workflowId: 'from-the-future', whenToUse: 'something this Orbis cannot do' })
    const held = join(t.dir, 'skills', 'from-the-future.json')
    writeFileSync(held, future)
    const open = join(t.dir, 'skills', 'held-open.json')
    mkdirSync(open)

    const fresh = t.make()
    assert.deepEqual((await fresh.list()).map((one) => one.workflow.id), [keep.workflow.id], 'neither is in the library, and the rest of it still loads')

    // Forgetting a skill deletes its file, and it used to do that by name alone. These two are the files that must
    // not go: one is a skill a newer Orbis understands, the other may be perfectly good a second later. Deleting is
    // the only thing here that cannot be undone.
    await fresh.remove('from-the-future')
    assert.equal(readFileSync(held, 'utf8'), future, 'the skill from a newer Orbis is still there, untouched')
    await fresh.remove('held-open')
    assert.equal(readdirSync(open).length, 0, 'and so is the one that could not be read, with nothing written in its place')
    assert.equal(readdirSync(join(t.dir, 'skills')).some((name) => name.includes('.unreadable-')), false, 'neither was moved aside: both may be perfectly good')
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

test('the store\u2019s own files cannot be deleted by asking to forget a skill with their name', async () => {
  const t = setup()
  try {
    // Two real things to lose: what the person chose, and how many times they have done something.
    await t.skills.setSettings({ reuse: 'auto', learnFromRuns: true })
    await t.skills.countSuccess('download the latest report')
    await t.skills.countSuccess('download the latest report')
    assert.equal(await t.skills.timesDone('download the latest report'), 2)

    // `settings` and `repeats` pass the id test, and this folder holds `settings.json` and `repeats.json`. Orion
    // reaches this with an id straight from a sentence -- "forget the skill called settings" -- and before the
    // guard it deleted them, silently, with nothing moved aside.
    await t.skills.remove('settings')
    await t.skills.remove('repeats')

    const left = readdirSync(join(t.dir, 'skills')).sort()
    assert.deepEqual(left, ['repeats.json', 'settings.json'], 'both are still there')
    assert.equal(await t.skills.timesDone('download the latest report'), 2, 'and still counting')
    const after = t.make()
    assert.equal((await after.settings()).reuse, 'auto', 'and a restart still reads what the person chose')
  } finally {
    t.done()
  }
})

test('a skill file that appeared after the library was read is not deleted either', async () => {
  const t = setup()
  try {
    // The library is read once and cached for the life of the profile, so the list of files not to touch is a
    // snapshot. Anything arriving after it -- from a newer Orbis, or held open by something -- was not on the list.
    await t.skills.list()
    mkdirSync(join(t.dir, 'skills'), { recursive: true })
    writeFileSync(join(t.dir, 'skills', 'later-skill.json'), JSON.stringify({ format: 99, workflowId: 'later-skill' }))

    await t.skills.remove('later-skill')
    assert.ok(
      readdirSync(join(t.dir, 'skills')).includes('later-skill.json'),
      'the file is asked about now rather than taken from a list made before it existed'
    )
  } finally {
    t.done()
  }
})

test('nothing is offered while the settings file cannot be read, whatever the defaults say', async () => {
  const t = setup()
  try {
    await t.skills.setSettings({ enabled: false, reuse: 'never' })
    // A folder where the file belongs: there, and not readable. The defaults say learning is on and skills may be
    // suggested, which is right for somebody who never touched the switches and wrong for somebody who turned them
    // off -- and it is their file, the one that says not to, that cannot be read.
    const path = join(t.dir, 'skills', 'settings.json')
    rmSync(path)
    mkdirSync(path)

    const after = t.make()
    const offered = await after.match('download the latest report')
    assert.deepEqual(offered.matches, [], 'nothing is suggested')
    assert.equal(offered.reuse, 'never', 'and the answer is no, not the default')
  } finally {
    t.done()
  }
})
