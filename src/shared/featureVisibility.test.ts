import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { CAPABILITIES, type AppFeature } from './commandCenter.ts'
import {
  blurbFor,
  chooseVisible,
  describeVisibility,
  ESSENTIAL_IDS,
  everythingChoice,
  FEATURE_FACTS,
  factsFor,
  featureState,
  hiddenSurfaces,
  isEssential,
  isVisible,
  newChoice,
  OPTIONAL_IDS,
  readVisibility,
  setVisible,
  SHARED_SERVICES,
  STARTING_IDS,
  visibleFeatures,
  visibleSurfaces,
  VISIBILITY_VERSION,
  type VisibilityChoice
} from './featureVisibility.ts'

/**
 * The foundation everything else in this wave stands on, held to its own rules.
 *
 * Four of these tests are the rules in rule form, and they are the ones worth keeping forever: nobody can hide the
 * way back to the switch; a file that could not be read never resets anybody's choices; an existing user is never
 * dropped into onboarding; and a feature that is off is never reported as on.
 */

const choiceWith = (shown: string[], patch: Partial<VisibilityChoice> = {}): VisibilityChoice => ({
  version: VISIBILITY_VERSION,
  shown: shown as AppFeature[],
  unknown: [],
  chosen: true,
  chosenAt: 1,
  fromNewer: false,
  ...patch
})

// ---------------------------------------------------------------- the table matches the real app

describe('the classification covers the real features and nothing invented', () => {
  test('every screen the window can open is classified exactly once', () => {
    const screens = [...new Set(CAPABILITIES.filter((one) => one.app).map((one) => one.app as AppFeature))]
    assert.equal(screens.length, 20, `the registry claims ${screens.length} window screens; this table was written against 20`)

    const classified = FEATURE_FACTS.map((one) => one.id as string)
    const missing = screens.filter((id) => !classified.includes(id))
    assert.deepEqual(missing, [], 'these screens exist and are in no class, so nothing can decide whether to show them')

    const seen = new Set<string>()
    for (const one of FEATURE_FACTS) {
      assert.equal(seen.has(one.id), false, `${one.id} is classified twice`)
      seen.add(one.id)
    }
  })

  test('nothing is classified that the app does not have', () => {
    // A core surface has no capability by design; everything else must be a real `app` in the registry.
    const core = new Set(['chat', 'browser', 'files', 'settings', 'palette', 'chance'])
    const apps = new Set(CAPABILITIES.filter((one) => one.app).map((one) => String(one.app)))
    const invented = FEATURE_FACTS.filter((one) => !core.has(one.id) && !apps.has(one.id)).map((one) => one.id)
    assert.deepEqual(invented, [], 'these are classified and are not screens Orbis has')
  })

  test('every entry can be shown to somebody', () => {
    for (const one of FEATURE_FACTS) {
      assert.ok(one.label.length > 0, `${one.id} has no name`)
      assert.ok(blurbFor(one.id).length > 10, `${one.id} has no sentence to show, so a switch for it would be a bare word`)
      assert.ok(one.standing === 'essential' || one.standing === 'optional', one.id)
    }
  })

  test('a dependency is always something that is itself classified', () => {
    for (const one of FEATURE_FACTS) {
      for (const need of [...one.needs, ...one.needsAnyOf]) {
        assert.ok(factsFor(need), `${one.id} needs ${need}, which is in no class, so it could never be satisfied`)
        assert.notEqual(need, one.id, `${one.id} depends on itself`)
      }
    }
  })

  test('the shared services are not switches, and are not pretending to be features', () => {
    assert.ok(SHARED_SERVICES.length >= 10, 'the shared services were written down; this is checking there are still some')
    for (const service of SHARED_SERVICES) {
      assert.equal(factsFor(service.id), undefined, `${service.id} is a shared service and also a feature with a switch, which is the thing this list exists to prevent`)
      assert.ok(service.blurb.length > 10, service.id)
      assert.ok(service.usedBy.length > 0, `${service.id} is listed as shared and nothing uses it`)
      for (const user of service.usedBy) {
        assert.ok(factsFor(user), `${service.id} says ${user} uses it, and ${user} is not a surface`)
      }
    }
  })
})

// ---------------------------------------------------------------- nobody can lock themselves out

describe('the essentials cannot be switched off', () => {
  test('the way back is essential, every one of it', () => {
    // If any of these became optional, somebody could switch off the only route to the switch.
    for (const id of ['chat', 'browser', 'files', 'settings', 'palette']) {
      assert.equal(isEssential(id), true, `${id} must never be something somebody can hide`)
    }
  })

  test('an essential is visible with no saved choice at all', () => {
    for (const id of ESSENTIAL_IDS) assert.equal(isVisible(id, null), true, id)
  })

  test('an essential is visible even when a saved choice leaves it out entirely', () => {
    const choice = choiceWith([])
    for (const id of ESSENTIAL_IDS) assert.equal(isVisible(id, choice), true, id)
  })

  test('switching an essential off is refused, in words, rather than ignored', () => {
    const result = setVisible(choiceWith([]), 'chat', false)
    assert.ok(result.refused, 'switching the chat off reported success')
    assert.match(result.refused, /cannot be switched off/)
    assert.equal(isVisible('chat', result.value), true)
  })

  test('asking for a set that leaves every essential out still leaves them on', () => {
    const chosen = chooseVisible(choiceWith([]), ['chess'])
    assert.equal(chosen.refused, null)
    for (const id of ESSENTIAL_IDS) assert.equal(isVisible(id, chosen.value), true, id)
    // And they are not stored, because they are visible by what they are rather than by what was saved.
    for (const id of ESSENTIAL_IDS) assert.equal(chosen.value.shown.includes(id), false, `${id} was stored as a choice`)
  })
})

// ---------------------------------------------------------------- a new profile, and an existing person

describe('what somebody starts with', () => {
  test('a new profile gets a short menu rather than everything or nothing', () => {
    const choice = newChoice(100)
    assert.equal(choice.chosen, false, 'a new profile has not been asked yet, so nothing may claim it chose this')
    const visible = visibleSurfaces(choice)
    assert.ok(visible.length > ESSENTIAL_IDS.length, 'a new profile opens onto an empty menu, which reads as broken')
    assert.ok(visible.length < FEATURE_FACTS.length, 'a new profile gets everything, which is the clutter this exists to fix')
    // The written-down starting set, so changing it is a deliberate edit rather than a drift.
    assert.deepEqual([...choice.shown], ['chance', 'create', 'toolkit'])
    assert.deepEqual([...visible], [...STARTING_IDS])
  })

  test('a specialist workspace is off for a new profile', () => {
    const choice = newChoice()
    for (const id of ['chess', 'markets', 'cosmos', 'eye', 'neurova', 'student', 'courses', 'labs', 'football', 'f1', 'arena', 'whiteboard']) {
      assert.equal(isVisible(id, choice), false, `${id} is on by default, which is the clutter`)
    }
  })

  test('somebody already using Orbis keeps every screen they had', () => {
    // The hard rule. No file exists for them, because the choice did not exist when they started -- and absence of
    // a choice is not a choice. `settled` is what the installation's own setup flag says.
    const read = readVisibility(null, { settled: true })
    assert.deepEqual(read.notes, [], 'an existing user was told something went wrong, and nothing did')
    // Orbis Pages is withheld, so it is the one screen that is not shown whatever was saved.
    for (const one of FEATURE_FACTS) if (one.id !== 'pages') assert.equal(isVisible(one.id, read.value), true, `${one.id} vanished for somebody who already uses it`)
    assert.equal(read.value.chosen, false, 'an existing user must not be recorded as having chosen a set they never saw')
  })

  test('a first run with no file gets the short menu, not everything', () => {
    const read = readVisibility(null, { settled: false })
    assert.deepEqual([...read.value.shown], [...newChoice().shown])
    assert.deepEqual(read.notes, [])
  })

  test('everythingChoice really is everything optional', () => {
    assert.deepEqual([...everythingChoice().shown], [...OPTIONAL_IDS])
    // Everything optional is on except the one screen that is withheld, which is always hidden.
    assert.deepEqual([...hiddenSurfaces(everythingChoice())], ['pages'])
  })
})

// ---------------------------------------------------------------- reading a file that went wrong

describe('an unreadable or odd file never resets anybody', () => {
  test('a saved choice is read back exactly', () => {
    const read = readVisibility({ version: 1, shown: ['chess', 'markets'], chosen: true, chosenAt: 42 }, { settled: true })
    assert.deepEqual([...read.value.shown], ['chess', 'markets'])
    assert.equal(read.value.chosen, true)
    assert.equal(read.value.chosenAt, 42)
    assert.deepEqual(read.notes, [])
    assert.equal(isVisible('chess', read.value), true)
    assert.equal(isVisible('cosmos', read.value), false)
  })

  test('an empty list is a real answer and is kept as one', () => {
    // "I turned everything off" is allowed, and must not be mistaken for a damaged field.
    const read = readVisibility({ version: 1, shown: [], chosen: true, chosenAt: 9 }, { settled: true })
    assert.deepEqual([...read.value.shown], [])
    assert.deepEqual(read.notes, [])
    assert.deepEqual([...visibleSurfaces(read.value)], [...ESSENTIAL_IDS])
  })

  test('a missing list is reported and does not read as "everything off"', () => {
    const read = readVisibility({ version: 1, chosen: true, chosenAt: 9 }, { settled: true })
    assert.equal(read.notes.length, 1)
    assert.match(read.notes[0], /could not be read/)
    assert.match(read.notes[0], /Nothing has been turned off/)
    assert.equal(isVisible('chess', read.value), true, 'a damaged field silently turned somebody’s features off')
  })

  test('something that is not an object at all is said out loud rather than swallowed', () => {
    for (const raw of ['nonsense', 7, [1, 2, 3], true]) {
      const read = readVisibility(raw, { settled: true })
      assert.equal(read.notes.length, 1, JSON.stringify(raw))
      assert.match(read.notes[0], /not in a shape Orbis understands/)
      assert.equal(isVisible('chess', read.value), true, 'a damaged file cost somebody their features')
    }
  })

  test('a file from an older shape is read, not thrown away', () => {
    // Version 1 with no version field at all: the shape before versioning, which is what a hand-edited file is too.
    const read = readVisibility({ shown: ['chess'], chosen: true }, { settled: true })
    assert.deepEqual([...read.value.shown], ['chess'])
    assert.equal(read.notes.length, 1)
    assert.match(read.notes[0], /did not say which version/)
  })

  test('a file from a newer Orbis is used and refused for writing, so nothing is lost', () => {
    const read = readVisibility({ version: VISIBILITY_VERSION + 3, shown: ['chess', 'somethingNew'], chosen: true, chosenAt: 5 }, { settled: true })
    assert.equal(read.value.fromNewer, true)
    assert.equal(isVisible('chess', read.value), true, 'what this version does understand must still work')
    assert.deepEqual([...read.value.unknown], ['somethingNew'], 'an id from the newer version was dropped instead of kept')
    assert.ok(read.notes.some((note) => /newer version of Orbis/.test(note)))

    const changed = setVisible(read.value, 'markets', true)
    assert.ok(changed.refused, 'this version wrote over a newer version’s file')
    assert.match(changed.refused, /newer version/)
    assert.deepEqual([...changed.value.shown], [...read.value.shown])

    const replaced = chooseVisible(read.value, ['markets'])
    assert.ok(replaced.refused)
  })

  test('a feature the registry no longer has is kept rather than deleted', () => {
    // Hiding is not deleting, and neither is a release that removes a screen for a while.
    const read = readVisibility({ version: 1, shown: ['chess', 'galaxy', 'secrets'], chosen: true }, { settled: true })
    assert.deepEqual([...read.value.shown], ['chess'])
    assert.deepEqual([...read.value.unknown], ['galaxy', 'secrets'])
    assert.equal(isVisible('galaxy', read.value), false)
    assert.equal(featureState('galaxy', read.value).available, false)
    assert.ok(read.notes.some((note) => /does not have/.test(note)))

    // And a change carries them, so turning something else on does not quietly throw them away.
    const changed = setVisible(read.value, 'markets', true)
    assert.equal(changed.refused, null)
    assert.deepEqual([...changed.value.unknown], ['galaxy', 'secrets'])
  })

  test('junk inside the list costs that entry and nothing else', () => {
    const read = readVisibility({ version: 1, shown: ['chess', null, 42, { a: 1 }, 'markets'], chosen: true }, { settled: true })
    assert.deepEqual([...read.value.shown], ['chess', 'markets'])
    assert.ok(read.notes.some((note) => /made no sense/.test(note)))
  })

  test('an essential listed in the file changes nothing and says nothing', () => {
    const read = readVisibility({ version: 1, shown: ['chat', 'settings', 'chess'], chosen: true }, { settled: true })
    assert.deepEqual([...read.value.shown], ['chess'])
    assert.deepEqual([...read.value.unknown], [])
    assert.deepEqual(read.notes, [])
  })

  test('a nonsense time is not kept as one', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 'yesterday', null]) {
      const read = readVisibility({ version: 1, shown: [], chosen: true, chosenAt: bad }, { settled: true })
      assert.equal(read.value.chosenAt, 0, JSON.stringify(bad))
    }
  })
})

// ---------------------------------------------------------------- dependencies

describe('a feature whose dependency is off', () => {
  test('Arena on its own is not shown, because there would be nothing on it', () => {
    const choice = choiceWith(['arena'])
    const state = featureState('arena', choice)
    assert.equal(state.visible, false)
    assert.equal(state.chosen, true, 'the person did switch it on, and that must not be reported as them not having')
    assert.ok(state.hiddenBecause)
    assert.match(state.hiddenBecause, /nothing on it/)
    assert.deepEqual([...state.blockedBy], ['football', 'f1'])
  })

  test('Arena with either sport on is shown', () => {
    assert.equal(isVisible('arena', choiceWith(['arena', 'football'])), true)
    assert.equal(isVisible('arena', choiceWith(['arena', 'f1'])), true)
  })

  test('a sport does not need the Arena, because the launcher opens it directly', () => {
    assert.equal(isVisible('football', choiceWith(['football'])), true)
    assert.equal(isVisible('f1', choiceWith(['f1'])), true)
  })
})

// ---------------------------------------------------------------- never claim a thing is on when it is off

describe('what Orion is told', () => {
  test('a hidden feature is described as off, with the way to turn it on', () => {
    const said = describeVisibility('chess', newChoice())
    assert.match(said, /switched off/)
    assert.match(said, /Settings/)
    assert.doesNotMatch(said, /opened|opening/)
  })

  test('a feature Orbis does not have is said to not exist, not to be off', () => {
    const said = describeVisibility('teleporter', newChoice())
    assert.match(said, /does not have/)
    assert.doesNotMatch(said, /switched off/)
  })

  test('a visible feature is described as on', () => {
    assert.match(describeVisibility('chess', choiceWith(['chess'])), /switched on/)
    assert.match(describeVisibility('chat', null), /switched on/)
  })

  test('nothing is visible by accident when there is no choice loaded yet', () => {
    // Null answers the essentials and nothing else. Answering "everything" here would report hidden features as on
    // for the whole of start-up.
    assert.deepEqual([...visibleSurfaces(null)], [...ESSENTIAL_IDS])
    for (const id of OPTIONAL_IDS) assert.equal(isVisible(id, null), false, id)
  })

  test('a visible feature is still not promised to work', () => {
    // `operational` is deliberately not answered here, and this is the reminder in test form: the state says nothing
    // about whether an engine is present, so a caller must compose it with the registry's readiness check.
    const state = featureState('chess', choiceWith(['chess']))
    assert.equal(state.visible, true)
    assert.equal('operational' in state, false, 'this file started claiming a feature works, which it cannot know')
  })
})

// ---------------------------------------------------------------- switching

describe('turning things on and off', () => {
  test('on, then off, then on again, with nothing else moving', () => {
    let choice = newChoice(1)
    const before = [...choice.shown]
    const on = setVisible(choice, 'chess', true, 2)
    assert.equal(on.refused, null)
    choice = on.value
    assert.equal(isVisible('chess', choice), true)
    assert.equal(choice.chosen, true)
    assert.equal(choice.chosenAt, 2)

    const off = setVisible(choice, 'chess', false, 3)
    assert.equal(off.refused, null)
    assert.equal(isVisible('chess', off.value), false)
    assert.deepEqual([...off.value.shown], before, 'switching one thing off moved something else')
  })

  test('switching something that is already how you asked for changes nothing and refuses nothing', () => {
    const choice = choiceWith(['chess'])
    const again = setVisible(choice, 'chess', true, 99)
    assert.equal(again.refused, null)
    assert.equal(again.value, choice, 'a no-op wrote a new choice, which would mark it as freshly chosen')
  })

  test('switching something Orbis does not have is refused', () => {
    const result = setVisible(newChoice(), 'teleporter', true)
    assert.ok(result.refused)
    assert.match(result.refused, /anything called "teleporter"/)
  })

  test('choosing a whole set keeps the table’s order, so the file reads the same every time', () => {
    const a = chooseVisible(newChoice(), ['markets', 'chess', 'cosmos'], 5)
    const b = chooseVisible(newChoice(), ['cosmos', 'chess', 'markets'], 5)
    assert.deepEqual([...a.value.shown], [...b.value.shown])
    assert.equal(a.value.chosen, true)
  })

  test('choosing a set with something unrecognised in it says so rather than dropping it silently', () => {
    const chosen = chooseVisible(newChoice(), ['chess', 'teleporter'], 5)
    assert.equal(chosen.refused, null)
    assert.deepEqual([...chosen.value.shown], ['chess'])
    assert.equal(chosen.notes.length, 1)
    assert.match(chosen.notes[0], /nothing called teleporter/)
  })

  test('the window’s twenty screens are what visibleFeatures answers about', () => {
    const all = visibleFeatures(everythingChoice())
    assert.equal(all.length, 19, `visibleFeatures answered about ${all.length} screens rather than 19 (Orbis Pages is withheld)`)
    assert.equal(all.includes('chance' as AppFeature), false, 'Chance is not one of the window’s twenty feature screens')
    const short = visibleFeatures(newChoice())
    assert.deepEqual([...short].sort(), ['clipboard', 'create', 'notes', 'schedules', 'toolkit', 'workspaces'])
  })
})
