import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { CHOICE_GROUPS, UNGROUPED_IDS, choiceEntry } from './featureChoiceGroups.ts'
import { ESSENTIAL_IDS, OPTIONAL_IDS, STARTING_IDS, isEssential } from './featureVisibility.ts'

/**
 * The first-run picker offers every optional screen, exactly once, and offers nothing else.
 *
 * The two ways this silently goes wrong are both invisible on screen: a new optional screen that no heading claims
 * is a feature nobody can ever turn on, and an essential that found its way into a group is a switch that pretends
 * to control something it cannot. Neither throws, and neither looks like anything.
 */

const root = resolve(import.meta.dirname, '..', '..')
const FEATURES = join(root, 'src', 'renderer', 'src', 'lib', 'features.ts')
const WELCOME = join(root, 'src', 'renderer', 'src', 'components', 'WelcomeExperience.tsx')

describe('the first-run feature picker', () => {
  test('every optional screen sits under exactly one heading', () => {
    assert.deepEqual([...UNGROUPED_IDS], [], 'an optional screen is under no heading, so the first run never offers it')

    const seen = CHOICE_GROUPS.flatMap((group) => [...group.ids])
    const twice = seen.filter((id, at) => seen.indexOf(id) !== at)
    assert.deepEqual(twice, [], 'a screen is offered under two headings, so one switch would appear twice')
    assert.equal(seen.length, OPTIONAL_IDS.length)
  })

  test('no essential is offered as a choice', () => {
    const wrong = CHOICE_GROUPS.flatMap((group) => group.ids.filter((id) => isEssential(id)))
    assert.deepEqual(wrong, [], 'an essential has a switch in the picker, which could not turn it off and must not claim to')
    // The chat above all: a picker that can touch it is a picker somebody can lock themselves out of Orbis with.
    assert.ok(ESSENTIAL_IDS.includes('chat'))
  })

  test('every heading says what it is for, and every screen says what it is', () => {
    assert.ok(CHOICE_GROUPS.length >= 3, 'the headings collapsed to a flat list again')
    for (const group of CHOICE_GROUPS) {
      assert.ok(group.label.length > 2 && group.label.length < 40, `the heading "${group.label}" is not a short phrase`)
      assert.ok(group.blurb.endsWith('.'), `the line under "${group.label}" is not a sentence`)
      for (const id of group.ids) {
        const entry = choiceEntry(id)
        assert.ok(entry.label.length > 0, `${id} has no name to show`)
        assert.ok(entry.blurb.length > 10, `${id} has no line saying what it is, so it would be offered as a bare word`)
      }
    }
  })

  test('the sensible default the skip takes is a real subset of what is offered', () => {
    const offered = new Set(CHOICE_GROUPS.flatMap((group) => [...group.ids]) as string[])
    const optionalStarters = STARTING_IDS.filter((id) => !isEssential(id))
    assert.ok(optionalStarters.length > 0, 'skipping would leave the menu with no optional screen at all')
    for (const id of optionalStarters) {
      assert.ok(offered.has(id), `${id} is on by default and is not in the picker, so nobody could ever turn it off here`)
    }
  })

  /*
   * Read as text, not imported, for the reason `featureLauncher.test.ts` gives: these two files pull in React and
   * lucide-react, and this runner runs pure modules only.
   */
  test('every screen the picker offers has an icon in the launcher', async () => {
    const source = await readFile(FEATURES, 'utf8')
    const block = /const CHOICE_ICONS[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(source)
    assert.ok(block, 'the CHOICE_ICONS map in features.ts could not be found, so this test is checking nothing')
    const names = (body: string): string[] => [...body.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1])
    const named = new Set(names(block[1]))
    // The map spreads the launcher's own icons rather than repeating nineteen lines, so those count as named too.
    if (block[1].includes('...ICONS')) {
      const launcher = /const ICONS[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(source)
      assert.ok(launcher, 'CHOICE_ICONS spreads ICONS and ICONS could not be found')
      for (const one of names(launcher[1])) named.add(one)
    }
    assert.ok(named.size > 10, `only ${named.size} icons were read out of the map, so the pattern has stopped matching`)
    const missing = CHOICE_GROUPS.flatMap((group) => group.ids.filter((id) => !named.has(id)))
    assert.deepEqual(missing, [], 'the picker offers a screen with no icon, so it would be drawn as an empty square')
  })

  test('the first run still asks for a name and a password before it asks about features', async () => {
    const source = await readFile(WELCOME, 'utf8')
    assert.match(source, /'who'/, 'the name step has gone')
    assert.match(source, /'secret'/, 'the password step has gone')
    assert.match(source, /'features'/, 'the feature step is not in the welcome screen')
    // The order is the order of the union, and the union is read in the order the steps happen.
    const at = (step: string): number => source.indexOf(`'${step}'`)
    assert.ok(at('who') < at('secret') && at('secret') < at('features'), 'the steps are declared out of order, so the third step is not third')
  })
})
