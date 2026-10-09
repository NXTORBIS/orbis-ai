import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FACES } from './orbiCharacter.ts'
import {
  TOUR,
  canShow,
  explainScreen,
  indexOfStep,
  marksNeeded,
  newTourState,
  nextShowable,
  nextStep,
  previousStep,
  screensVisited,
  stepAt,
  stepById,
  tourProgress
} from './tour.ts'

const SCREENS = join(process.cwd(), 'src', 'renderer', 'src', 'components', 'student')

/** Everything in the Student screens, read once. The guards below search it rather than trusting a list. */
const files = readdirSync(SCREENS)
  .filter((one) => one.endsWith('.tsx') || one.endsWith('.ts'))
  .map((one) => readFileSync(join(SCREENS, one), 'utf8'))

describe('the tour Orbi gives', () => {
  it('visits real screens, every one of them in the nav', () => {
    /*
     * The guard that keeps the tour honest.
     *
     * A tour step naming a screen that no longer exists would navigate nowhere and leave Orbi talking about a
     * page that is not there — and nothing else in the build would notice.
     */
    const view = readFileSync(join(SCREENS, 'StudentView.tsx'), 'utf8')
    for (const screen of screensVisited()) {
      assert.ok(view.includes(`id: '${screen}'`), `the tour visits "${screen}", which is not in the nav`)
    }
  })

  it('points only at elements that exist in the renderer', () => {
    /*
     * Matched two ways, because some marks are decided rather than written.
     *
     * A row in a list gets its mark from which row it is, so the attribute is `data-tour={...}` and there is no
     * literal to find. The check that matters is the same either way: the name must appear in a file that marks
     * elements at all, so a mark nothing uses still fails — which is the failure this guard exists for.
     */
    const marking = files.filter((one) => one.includes('data-tour'))
    assert.ok(marking.length > 0, 'nothing in the renderer marks anything for the tour')
    for (const mark of marksNeeded()) {
      const found = marking.some((one) => one.includes(`data-tour="${mark}"`) || one.includes(`'${mark}'`))
      assert.ok(found, `the tour points at "${mark}", which nothing is marked with`)
    }
  })

  it('every step says something short, in one or two sentences', () => {
    for (const step of TOUR) {
      assert.ok(step.says.length > 20, `${step.id} says almost nothing`)
      assert.ok(step.says.length < 200, `${step.id} is a wall of text — the animation should be doing the work`)
      const sentences = step.says.split(/[.!?]/).filter((one) => one.trim().length > 0)
      assert.ok(sentences.length <= 2, `${step.id} has ${sentences.length} sentences`)
    }
  })

  it('every step has a pose and a real expression', () => {
    for (const step of TOUR) {
      assert.ok(step.pose, step.id)
      assert.ok(FACES[step.expression], `${step.id} wants an expression that does not exist`)
    }
  })

  it('no two steps share an id', () => {
    const ids = TOUR.map((one) => one.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('opens on Home and ends on Home', () => {
    assert.equal(TOUR[0].screen, 'home')
    assert.equal(TOUR[TOUR.length - 1].screen, 'home')
  })

  it('the first thing Orbi does is introduce itself', () => {
    assert.match(TOUR[0].says, /I'm Orbi/i)
    assert.equal(TOUR[0].pose, 'wave')
  })

  it('the five steps somebody who leaves early still sees are the ones that matter', () => {
    /* Whoever reorders this should have to think about it: these are what a thirty-second visit teaches. */
    const first = TOUR.slice(0, 5).map((one) => one.id)
    assert.deepEqual(first, ['hello', 'next-action', 'focus', 'focus-lock', 'shield'])
  })

  it('the shield is demonstrated by Orbi actually guarding something real', () => {
    const shield = stepById('shield')
    assert.equal(shield?.how, 'guard')
    assert.equal(shield?.pose, 'shield')
    // Not explained from a bubble: it must have something on screen to stand in front of.
    assert.ok(shield?.mark, 'the shield step has nothing to guard')
  })

  it('it ends by offering the first session rather than another Next', () => {
    const last = TOUR[TOUR.length - 1]
    assert.match(last.next ?? '', /first session/i)
    assert.match(last.says, /here when you need me/i)
  })

  it('it never promises Orbi will do the teaching', () => {
    /* The division the whole product rests on: Orbi decides what, Orion does the explaining. */
    const orion = stepById('orion')
    assert.match(orion?.says ?? '', /Orion/)
    assert.match(orion?.says ?? '', /it does the teaching/i)
  })

  it('a fresh state has never been started', () => {
    const state = newTourState()
    assert.equal(state.at, null)
    assert.equal(state.done, false)
    assert.deepEqual([...state.seen], [])
  })

  it('moving on walks the list and stops at the end', () => {
    let id: string | null = null
    let count = 0
    while (count < 100) {
      const next = nextStep(id)
      if (!next) break
      id = next.id
      count += 1
    }
    assert.equal(count, TOUR.length - 1)
    assert.equal(nextStep(TOUR[TOUR.length - 1].id), null)
  })

  it('going back stops at the beginning rather than wrapping', () => {
    assert.equal(previousStep(TOUR[0].id), null)
    assert.equal(previousStep(TOUR[1].id)?.id, TOUR[0].id)
    assert.equal(previousStep(null), null)
  })

  it('an unknown step is treated as the beginning rather than throwing', () => {
    assert.equal(indexOfStep('nonsense'), 0)
    assert.equal(stepById('nonsense'), null)
    assert.equal(stepAt(9999), null)
  })

  it('progress is counted, and starts at one of many', () => {
    assert.deepEqual(tourProgress(null), { step: 1, total: TOUR.length, says: `1 of ${TOUR.length}` })
    assert.equal(tourProgress(TOUR[TOUR.length - 1].id).step, TOUR.length)
  })

  it('a step whose element is missing is skipped rather than shown pointing at nothing', () => {
    const needs = TOUR.find((one) => one.mark !== null)
    assert.ok(needs)
    assert.equal(canShow(needs, []), false)
    assert.equal(canShow(needs, [needs.mark as string]), true)
    // And a step about a whole screen always shows, because it points at nothing in particular.
    assert.equal(canShow(TOUR[0], []), true)
  })

  it('with nothing on this screen it skips past the ones that needed it', () => {
    /* Asked strictly, with no screen at all, every step needing an element is passed over. */
    const next = nextShowable('hello', [])
    assert.ok(next)
    assert.equal(next?.mark, null)
  })

  it('a step on another screen is never skipped for being absent from this one', () => {
    /*
     * The bug this guards against skipped almost every pointing step.
     *
     * Standing on Home, "can you show the Focus step?" must not be answered from Home's elements — the answer is
     * only knowable once Focus is open.
     */
    const focus = stepById('focus')
    assert.ok(focus?.mark)
    assert.equal(canShow(focus, [], 'home'), true, 'asked from the wrong screen, it must defer')
    assert.equal(canShow(focus, [], 'focus'), false, 'asked from its own screen with nothing there, it skips')
    assert.equal(canShow(focus, [focus.mark as string], 'focus'), true)
    // With no screen given at all it falls back to the strict answer, which is what a plain check wants.
    assert.equal(canShow(focus, []), false)
  })

  it('from Home it offers the Focus step rather than jumping past it', () => {
    assert.equal(nextShowable('next-action', ['next-best'], 'home')?.id, 'focus')
  })

  it('with everything on screen it simply goes to the next step', () => {
    assert.equal(nextShowable('hello', marksNeeded())?.id, 'next-action')
  })

  it('one screen can be explained on its own, without the other twenty', () => {
    assert.equal(explainScreen('cards')?.screen, 'cards')
    assert.equal(explainScreen('focus')?.id, 'focus')
  })

  it('every screen it visits can be explained on its own', () => {
    for (const screen of screensVisited()) assert.ok(explainScreen(screen), screen)
  })
})
