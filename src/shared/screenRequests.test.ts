import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StepRecord } from './browserControl.ts'
import type { SurfaceControl, SurfaceDescriptor, SurfaceTree } from './surfaces.ts'
import { answerAboutControl, checkWishes, chooseValue, nudgeValue, planForScreens, relevantScreens, reportScreenRun, requestShape } from './screenRequests.ts'

/**
 * The deciding, with no model and no window.
 *
 * Everything in `screenRequests.ts` that a wrong answer would make Orbis do the wrong thing: whether a sentence is a
 * question, what "a little more" is on a real range, which option "the second" is, and what a run's records really
 * say happened. Pure, so each of these is a fact rather than a behaviour that held on one run.
 */

const control = (over: Partial<SurfaceControl> & Pick<SurfaceControl, 'id' | 'name' | 'spec'>): SurfaceControl => ({
  value: null,
  readable: true,
  writable: true,
  ...over
})

const surface = (over: Partial<SurfaceDescriptor> & Pick<SurfaceDescriptor, 'id' | 'path' | 'name'>): SurfaceDescriptor => ({
  parent: null,
  kind: 'panel',
  controls: [],
  actions: [],
  state: { present: true, activity: 'idle' },
  children: [],
  ...over
})

const depth = control({ id: 'depth', name: 'Search depth', spec: { type: 'integer', description: 'How far ahead.', min: 1, max: 40 }, value: 18 })
const seconds = control({ id: 'seconds', name: 'Time per move', spec: { type: 'number', description: 'How long.', min: 0.2, max: 2 }, value: 0.8 })
const style = control({ id: 'style', name: 'Playing style', spec: { type: 'string', description: 'How it chooses.', enum: ['solid', 'sharp', 'wild'] }, value: 'solid' })

const tree: SurfaceTree = [
  surface({
    id: 'study',
    path: 'study',
    name: 'Study',
    kind: 'module',
    keywords: ['chess'],
    children: ['study/engine'],
    possibleChildren: [{ id: 'library', name: 'Opening library', reach: { kind: 'action', action: 'openLibrary' } }]
  }),
  surface({
    id: 'engine',
    path: 'study/engine',
    name: 'Engine panel',
    parent: 'study',
    keywords: ['analysis'],
    controls: [depth, seconds, style],
    actions: [{ id: 'stop', name: 'Stop thinking' }]
  }),
  surface({ id: 'timer', path: 'timer', name: 'Timer', kind: 'tool', controls: [control({ id: 'minutes', name: 'Minutes', spec: { type: 'integer', description: 'How long.', min: 1, max: 60 }, value: 5 })] })
]

// ---------------------------------------------------------------- a question or an instruction

test('politeness round an instruction is still an instruction, and a question mark decides nothing', () => {
  assert.equal(requestShape('how do I change the search depth?'), 'question')
  assert.equal(requestShape('what is the depth set to'), 'question')
  assert.equal(requestShape('where is the engine panel'), 'question')
  assert.equal(requestShape('can I change the depth?'), 'question')
  assert.equal(requestShape('tell me what the style is'), 'question')

  assert.equal(requestShape('change the search depth'), 'instruction')
  assert.equal(requestShape('can you turn the depth up'), 'instruction')
  assert.equal(requestShape('could you set it to 20'), 'instruction')
  assert.equal(requestShape('please stop the engine'), 'instruction')
  assert.equal(requestShape('turn it off?'), 'instruction')
  assert.equal(requestShape('set the style to sharp, please'), 'instruction')
})

// ---------------------------------------------------------------- what "a little" is

test('“a little” is a share of the control’s own range, so the same words move two controls differently', () => {
  const up = nudgeValue(depth, 'up', 'little')
  assert.deepEqual(up, { ok: true, value: 22, note: 'up a little from 18 to 22 (its range is 1 to 40)' })
  // A tenth of 0.2-to-2 is 0.18, which is not four. Nothing about this comes from the request.
  assert.deepEqual(nudgeValue(seconds, 'up', 'little'), { ok: true, value: 0.98, note: 'up a little from 0.8 to 0.98 (its range is 0.2 to 2)' })
  const quarter = nudgeValue(depth, 'up', 'some')
  assert.equal(quarter.ok && quarter.value, 28)
  const half = nudgeValue(depth, 'down', 'lot')
  assert.equal(half.ok && half.value, 1, 'twenty below 18 is past the bottom, so it lands on it')
  assert.deepEqual(nudgeValue(depth, 'up', 'all'), { ok: true, value: 40, note: 'all the way up from 18 to 40 (its range is 1 to 40)' })
})

test('a whole-number control never moves by nothing, however small a tenth of its range is', () => {
  const small = control({ id: 'lanes', name: 'Lanes', spec: { type: 'integer', description: 'How many.', min: 1, max: 5 }, value: 2 })
  // A tenth of four is 0.4, which rounds to zero: a request that would have reported success and changed nothing.
  assert.deepEqual(nudgeValue(small, 'up', 'little'), { ok: true, value: 3, note: 'up a little from 2 to 3 (its range is 1 to 5)' })
})

test('a control at the end of its range says so rather than being set to what it already is', () => {
  const full = { ...depth, value: 40 }
  const got = nudgeValue(full, 'up', 'little')
  assert.equal(got.ok, false)
  assert.equal(got.ok === false && got.why, 'Search depth is already at its highest, 40. Its range is 1 to 40.')
})

test('a move past the end lands on the end and says that is what happened', () => {
  const got = nudgeValue({ ...depth, value: 38 }, 'up', 'little')
  assert.deepEqual(got, { ok: true, value: 40, note: 'up a little from 38 would be 42, which is past the end, so 40 — as far as it goes (its range is 1 to 40)' })
})

test('“a little” on a control that declares no range is refused, never invented', () => {
  const loose = control({ id: 'weight', name: 'Weight', spec: { type: 'number', description: 'How heavy.' }, value: 3 })
  const got = nudgeValue(loose, 'up', 'little')
  assert.equal(got.ok, false)
  assert.match(got.ok === false ? got.why : '', /does not say how far it goes, so Orbis cannot work out what “a little” means\. Say a number\./)
})

test('“a little” on a switch, and on a control that could not be read, each say what to do instead', () => {
  const flag = control({ id: 'quiet', name: 'Quiet hours', spec: { type: 'boolean', description: 'Whether.' }, value: true })
  const switched = nudgeValue(flag, 'up', 'little')
  assert.match(switched.ok === false ? switched.why : '', /holds a yes or a no/)
  const unread = nudgeValue({ ...depth, readable: false, value: null }, 'up', 'little')
  assert.match(unread.ok === false ? unread.why : '', /could not be read, so there is nothing to move it from/)
})

// ---------------------------------------------------------------- which option

test('an option is counted from the control’s own list, by number and by position', () => {
  assert.deepEqual(chooseValue(style, 2), { ok: true, value: 'sharp', note: 'option 2 of 3: sharp' })
  assert.deepEqual(chooseValue(style, 'last'), { ok: true, value: 'wild', note: 'the last of 3: wild' })
  assert.deepEqual(chooseValue(style, 'next'), { ok: true, value: 'sharp', note: 'the next option after solid: sharp' })
  assert.deepEqual(chooseValue({ ...style, value: 'wild' }, 'previous'), { ok: true, value: 'sharp', note: 'the previous option after wild: sharp' })
})

test('counting past the end of the list says so, with the list, rather than wrapping round', () => {
  const past = chooseValue(style, 12)
  assert.equal(past.ok, false)
  assert.equal(past.ok === false && past.why, 'Playing style has 3 options, so there is no number 12. They are: solid, sharp, wild.')
  assert.match(chooseValue({ ...style, value: 'wild' }, 'next').ok === false ? (chooseValue({ ...style, value: 'wild' }, 'next') as { why: string }).why : '', /already the last option, wild/)
})

test('a control holding something that is not one of its options has no next one, and says that', () => {
  const odd = chooseValue({ ...style, value: 'berserk' }, 'next')
  assert.equal(odd.ok, false)
  assert.match(odd.ok === false ? odd.why : '', /set to “berserk”, which is not one of its options, so there is no next one/)
})

// ---------------------------------------------------------------- which screens to show

test('a request reaches a control by what it is called on screen, and brings its parent with it', () => {
  const shown = relevantScreens(tree, 'turn the search depth up a little')
  assert.deepEqual(shown.surfaces.map((one) => one.path), ['study', 'study/engine'])
  assert.equal(shown.matched[0].path, 'study/engine/depth')
  assert.equal(shown.names, true)
  // Timer has a number on it too, and nothing in the request is about a timer.
  assert.match(shown.text, /control depth “Search depth” integer range 1 to 40 = 18/)
  assert.doesNotMatch(shown.text, /control minutes/)
  // The parent is named even though nothing matched it, so the path reads whole.
  assert.match(shown.text, /^study — Study \(module\)$/m)
})

test('a screen that is not open is named as somewhere to look rather than left out', () => {
  const shown = relevantScreens(tree, 'open the opening library')
  assert.deepEqual(shown.canOpen, ['study/library — Opening library'])
  // Nothing open answers to it -- a screen that is not open has not said what is on it -- and the screen that says
  // it can open it is shown anyway, because that is the one thing there is to do about it.
  assert.deepEqual(shown.matched, [])
  assert.deepEqual(shown.surfaces.map((one) => one.path), ['study'])
})

test('a request that names nothing in particular is shown what is in front of the person', () => {
  const shown = relevantScreens(tree, 'what can I change here?')
  assert.equal(shown.names, false, 'so an empty match is not read as the feature not existing')
  assert.match(shown.text, /control depth/)
  assert.match(shown.text, /control minutes/)
})

test('a request about nothing on screen matches nothing, which is a different answer from matching badly', () => {
  const shown = relevantScreens(tree, 'calibrate the thermostat')
  assert.deepEqual(shown.matched, [])
  assert.equal(shown.names, true)
  assert.deepEqual(shown.openScreens, ['study — Study', 'study/engine — Engine panel', 'timer — Timer'])
})

test('an unreadable control is written out as unreadable, with the reason', () => {
  const blind: SurfaceTree = [surface({ id: 'engine', path: 'engine', name: 'Engine panel', controls: [{ ...depth, readable: false, value: null, unreadableReason: 'This page has not finished loading.' }] })]
  assert.match(relevantScreens(blind, 'search depth').text, /= \(could not be read: This page has not finished loading\.\)/)
})

// ---------------------------------------------------------------- checking a wish

test('a value outside the control’s range is refused with the range, and nothing is planned', () => {
  const got = checkWishes(tree, [{ op: 'set', path: 'study/engine/depth', value: 400 }])
  assert.equal(got.ok, false)
  assert.match(got.ok === false ? got.why : '', /at most 40/)
})

test('a path that stops somewhere becomes one question carrying what was really there', () => {
  const got = checkWishes(tree, [{ op: 'set', path: 'study/engine/aggression', value: 5 }])
  assert.equal(got.ok, false)
  assert.equal('question' in got, true)
  assert.deepEqual('choices' in got ? got.choices : [], ['depth', 'seconds', 'style', 'stop'])
})

test('a route no screen says it can take is refused with what that screen can open', () => {
  const got = checkWishes(tree, [{ op: 'open', path: 'study/thermostat' }])
  assert.equal(got.ok, false)
  assert.match(got.ok === false ? got.why : '', /Study cannot open anything called “thermostat”\. It can open: engine, library\./)
})

test('a write onto a screen a step earlier in the same plan opens is taken on trust, and only that', () => {
  const fine = checkWishes(tree, [
    { op: 'open', path: 'study/library' },
    { op: 'set', path: 'study/library/variation', value: 'Najdorf' }
  ])
  assert.equal(fine.ok, true)
  assert.deepEqual(fine.ok ? fine.steps.map((one) => one.capability) : [], ['screen.goTo', 'screen.write'])

  // A relative move is not taken on trust: there is nothing to read on a screen that is not open yet.
  const blind = checkWishes(tree, [
    { op: 'open', path: 'study/library' },
    { op: 'nudge', path: 'study/library/depth', direction: 'up', size: 'little' }
  ])
  assert.equal(blind.ok, false)
  assert.match(blind.ok === false ? blind.why : '', /is not on screen yet, so Orbis cannot see what it is set to in order to move it/)
})

test('a control is found by what is written on screen, and a relative move reports how it became a number', () => {
  // The words from the screen rather than the ids in the code, and a level left out: `study/engine/depth` is the
  // real path. A path still has to start at a screen that is not inside anything, which is why `study` is here.
  const got = checkWishes(tree, [{ op: 'nudge', path: 'study/search depth', direction: 'up', size: 'little' }])
  assert.equal(got.ok, true, got.ok === false ? got.why : '')
  assert.deepEqual(got.ok ? got.steps : [], [
    { capability: 'screen.write', params: { path: 'study/engine/depth', value: 22 }, what: 'Set Search depth to 22', note: 'up a little from 18 to 22 (its range is 1 to 40)' }
  ])
})

test('putting something back needs a recorded reading, and says so when there is none', () => {
  const none = checkWishes(tree, [{ op: 'revert', path: 'study/engine/depth' }])
  assert.equal(none.ok, false)
  assert.match(none.ok === false ? none.why : '', /no record of what Search depth was before/)

  const some = checkWishes(tree, [{ op: 'revert', path: 'study/engine/depth' }], { previousValue: () => 12 })
  assert.equal(some.ok, true)
  assert.equal(some.ok ? some.steps[0].params.value : null, 12)
})

test('an action is refused when it says it cannot be done, and when it is given what it does not take', () => {
  const closed: SurfaceTree = [surface({ id: 'engine', path: 'engine', name: 'Engine panel', actions: [{ id: 'stop', name: 'Stop thinking', unavailableReason: 'It is not thinking.' }] })]
  const got = checkWishes(closed, [{ op: 'do', path: 'engine/stop' }])
  assert.equal(got.ok, false)
  assert.match(got.ok === false ? got.why : '', /Stop thinking cannot be done right now\. It is not thinking\./)

  const needs: SurfaceTree = [surface({ id: 'engine', path: 'engine', name: 'Engine panel', actions: [{ id: 'jump', name: 'Jump to move', params: { move: { type: 'integer', description: 'Which move.', required: true } } }] })]
  assert.match(checkWishes(needs, [{ op: 'do', path: 'engine/jump' }]).ok === false ? (checkWishes(needs, [{ op: 'do', path: 'engine/jump' }]) as { why: string }).why : '', /it needs move \(Which move\.\)/)
})

// ---------------------------------------------------------------- the plan

test('a guarded step becomes a reading and a branch, and the reading is marked as Orbis’s own bookkeeping', () => {
  const got = checkWishes(tree, [{ op: 'set', path: 'study/engine/depth', value: 30, onlyIf: { path: 'study/engine/style', is: 'solid' } }])
  assert.equal(got.ok, true)
  const plan = planForScreens('what you asked for', got.ok ? got.steps : [])
  assert.deepEqual(plan.steps, [
    { id: 'check1', do: 'screen.read', params: { path: 'study/engine/style' }, label: 'Check study/engine/style', saveAs: 'check1' },
    {
      if: { check: 'compare', left: '{{check1.value}}', op: '==', right: 'solid' },
      then: [{ id: 'act1', do: 'screen.write', params: { path: 'study/engine/depth', value: 30 }, label: 'Set Search depth to 30', saveAs: 'step1' }],
      label: 'Only if study/engine/style is “solid”'
    }
  ])
  assert.equal(plan.onFailure, 'stop')
})

// ---------------------------------------------------------------- what really happened

const record = (over: Partial<StepRecord>): StepRecord => ({ runId: 'r', path: '1', kind: 'action', status: 'success', startedAt: 0, durationMs: 1, ...over })

test('“confirmed” only ever comes from a verification, never from a step having run', () => {
  const report = reportScreenRun([
    record({ action: 'screen.write', label: 'Turn quiet hours on', verification: { verified: true, detail: 'Quiet hours is now on.' } }),
    record({ action: 'screen.do', label: 'Send a test', verification: { verified: false, detail: 'The screen does not report whether it worked.' } }),
    record({ action: 'screen.write', label: 'Set the hour', status: 'failed', error: { code: 'invalid-params', message: 'Quiet hours are off. Turn quietHours on first.', recoverable: false } })
  ])
  assert.deepEqual(report.outcomes.map((one) => one.status), ['confirmed', 'unconfirmed', 'refused'])
  assert.equal(report.allConfirmed, false)
  assert.match(report.text, /^Quiet hours is now on\./)
  assert.match(report.text, /Send a test: It was carried out and nothing could confirm it\./)
  assert.match(report.text, /Set the hour did not happen: Quiet hours are off\./)
})

test('a step with nothing to do is its own answer, and counts as the screen being as asked', () => {
  const report = reportScreenRun([record({ action: 'screen.write', label: 'Set the style', summary: { unchanged: true }, verification: { verified: true, detail: 'Playing style is already “solid”.' } })])
  assert.deepEqual(report.outcomes.map((one) => one.status), ['nothing-to-do'])
  assert.equal(report.allConfirmed, true)
  assert.equal(report.text, 'Playing style is already “solid”.')
})

test('a reading is reported as a reading, and an unreadable one as unreadable', () => {
  const report = reportScreenRun([
    record({ action: 'screen.read', label: 'Read the style', summary: { name: 'Playing style', value: 'solid', readable: true } }),
    record({ action: 'screen.read', label: 'Read quiet hours', summary: { name: 'Quiet hours', value: null, readable: false, note: 'This page has not finished loading.' } })
  ])
  assert.deepEqual(report.outcomes.map((one) => [one.status, one.detail]), [
    ['confirmed', 'Playing style is “solid”.'],
    ['unconfirmed', 'Quiet hours could not be read. This page has not finished loading.']
  ])
})

test('the reading behind a branch is not reported as something that was asked for', () => {
  const report = reportScreenRun([
    record({ stepId: 'check1', action: 'screen.read', label: 'Check study/engine/style', summary: { name: 'Playing style', value: 'solid', readable: true } }),
    record({ kind: 'if', status: 'success', summary: { branch: 'then' } }),
    record({ stepId: 'act1', action: 'screen.write', label: 'Set Search depth to 30', verification: { verified: true, detail: 'Search depth is now 30.' } })
  ])
  assert.deepEqual(report.outcomes.map((one) => one.what), ['Set Search depth to 30'])
  assert.equal(report.text, 'Search depth is now 30.')
})

test('steps that never ran are counted rather than quietly left out of the answer', () => {
  const report = reportScreenRun([
    record({ action: 'screen.write', label: 'Set the depth', status: 'failed', error: { code: 'failed', message: 'The panel went away.', recoverable: true } }),
    record({ action: 'screen.write', label: 'Set the style', status: 'cancelled' })
  ])
  assert.deepEqual(report.outcomes.map((one) => one.status), ['failed', 'skipped'])
  assert.match(report.text, /1 later step were not tried\.|1 later step was not tried\./)
})

test('a run whose records are empty says nothing was done, not that it worked', () => {
  const report = reportScreenRun([])
  assert.equal(report.allConfirmed, false)
  assert.equal(report.text, 'Nothing was done.')
})

// ---------------------------------------------------------------- answering from the screen itself

test('a question about a control is answered from its own reading, range and whereabouts', () => {
  assert.equal(answerAboutControl(tree, 'study/engine/depth'), 'Search depth is 18. It goes from 1 to 40. It is on Engine panel (study/engine/depth).')
  assert.equal(answerAboutControl(tree, 'study/engine/style'), 'Playing style is “solid”. It can be solid, sharp, wild. It is on Engine panel (study/engine/style).')
  assert.match(String(answerAboutControl(tree, 'study/engine')), /^Engine panel is open\. You can change Search depth, Time per move, Playing style\. You can stop thinking\.$/)
  assert.equal(answerAboutControl(tree, 'nothing/at/all'), null)
})

test('a control that could not be read says so instead of answering with a value', () => {
  const blind: SurfaceTree = [surface({ id: 'engine', path: 'engine', name: 'Engine panel', controls: [{ ...depth, readable: false, value: null, unreadableReason: 'This page has not finished loading.' }] })]
  assert.match(String(answerAboutControl(blind, 'engine/depth')), /^Search depth could not be read: This page has not finished loading\./)
})
