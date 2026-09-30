import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  cleanSectionId,
  DEFAULT_SETTINGS_SECTION,
  findSections,
  NOT_IN_SETTINGS,
  sectionById,
  sectionForSetting,
  SETTINGS_SECTIONS
} from './settingsSections.ts'

/**
 * The shape of Settings.
 *
 * The point of these is that the grouping stays a grouping. A settings screen decays one addition at a time — each new
 * thing is appended wherever there is room, nobody notices, and two years later Theme is nine items from Visual
 * effects. So the rules are written down: every setting lives in exactly one section, every section is reachable, and
 * a setting that exists but has no home fails the build rather than quietly ending up at the bottom of a scroll.
 */

const here = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------- the grouping holds

test('every section is complete and unique', () => {
  const ids = new Set<string>()
  for (const section of SETTINGS_SECTIONS) {
    assert.ok(section.id, 'a section with no id')
    assert.equal(ids.has(section.id), false, `two sections called ${section.id}`)
    ids.add(section.id)
    assert.ok(section.label.length > 0, section.id)
    assert.ok(section.blurb.length > 0, `${section.id} has no blurb, so its heading says nothing`)
    assert.ok(section.icon.length > 0, section.id)
    assert.ok(section.keywords.length >= 3, `${section.id} is hard to search for`)
  }
})

test('a setting lives in exactly one section', () => {
  // In two places it disagrees with itself; in none, nobody can find it.
  const seen = new Map<string, string>()
  for (const section of SETTINGS_SECTIONS) {
    for (const key of section.settings) {
      const already = seen.get(key)
      assert.equal(already, undefined, `${key} is in both ${already} and ${section.id}`)
      seen.set(key, section.id)
    }
  }
})

test('every editable setting has a home, or a written reason it has none', async () => {
  /**
   * The guard that stops the decay.
   *
   * A new setting added to the type is a new setting somebody has to be able to find. This reads the real interface
   * rather than a copy of it, so the two cannot drift: either the key is claimed by a section, or it is listed as
   * deliberately not offered, with the reason.
   */
  const types = await readFile(join(here, 'types.ts'), 'utf8')
  const block = /export interface Settings \{([\s\S]*?)\n\}/.exec(types)
  assert.ok(block, 'the Settings interface could not be found')

  const keys = [...block[1].matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1])
  assert.ok(keys.length > 5, `only found ${keys.length} settings, so this test is not reading what it thinks`)

  const homeless: string[] = []
  for (const key of keys) {
    if (sectionForSetting(key)) continue
    if (Object.hasOwn(NOT_IN_SETTINGS, key)) continue
    homeless.push(key)
  }
  assert.deepEqual(
    homeless,
    [],
    `these settings are in no section and have no stated reason: ${homeless.join(', ')}. Put each in a section, or add it to NOT_IN_SETTINGS with why.`
  )
})

test('nothing is excused that does not exist', async () => {
  // An excuse outliving its setting is how a list of exceptions becomes fiction.
  const types = await readFile(join(here, 'types.ts'), 'utf8')
  const block = /export interface Settings \{([\s\S]*?)\n\}/.exec(types)
  const keys = new Set([...block![1].matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1]))
  for (const excused of Object.keys(NOT_IN_SETTINGS)) {
    assert.equal(keys.has(excused), true, `${excused} is excused from Settings but is not a setting any more`)
  }
})

test('the security settings are one section, not four scattered panels', () => {
  /**
   * The specific fault this restructure exists to fix. Four passwords -- the account, the profile lock, a tab lock and
   * a transfer package -- were four separate panels with unrelated settings between them, which made layers that nest
   * look like features that do not relate.
   */
  const security = sectionById('security')
  assert.ok(security)
  for (const word of ['password', 'lock', 'transfer']) {
    assert.ok(security.keywords.includes(word), `somebody looking for "${word}" should land on Security`)
  }
})

test('theme and visual effects are in the same place', () => {
  // They were nine items apart, which is the clearest single example of the old ordering having no rule.
  assert.equal(sectionForSetting('theme')?.id, 'appearance')
  assert.equal(sectionForSetting('effects')?.id, 'appearance')
})

test('everything about Orion is in one place', () => {
  for (const key of ['defaultModel', 'systemPrompt']) {
    assert.equal(sectionForSetting(key)?.id, 'orion', key)
  }
})

// ---------------------------------------------------------------- finding something

test('an empty search offers everything, in order', () => {
  assert.deepEqual(findSections('').map((s) => s.id), SETTINGS_SECTIONS.map((s) => s.id))
  assert.deepEqual(findSections('   ').map((s) => s.id), SETTINGS_SECTIONS.map((s) => s.id))
})

test('searching for what people actually type finds the right section first', () => {
  /**
   * The words on the left are what somebody types; the sections on the right are what they meant. None of these is the
   * section's own name, which is the whole point -- nobody looking to change their password types "security".
   */
  for (const [typed, expected] of [
    ['password', 'security'],
    ['dark', 'appearance'],
    ['dark mode', 'appearance'],
    ['microphone', 'voice'],
    ['model', 'orion'],
    ['remember', 'orion'],
    ['default browser', 'browsing'],
    ['ticker', 'browsing'],
    ['licences', 'about'],
    ['tab lock', 'security'],
    ['address me as', 'account']
  ] as const) {
    const found = findSections(typed)
    assert.ok(found.length > 0, `"${typed}" found nothing`)
    assert.equal(found[0].id, expected, `"${typed}" offered ${found[0].id} first`)
  }
})

test('a section’s own name beats something that merely mentions it', () => {
  // Typing "vo" should offer Voice before anything whose keywords happen to contain those letters.
  assert.equal(findSections('vo')[0].id, 'voice')
  assert.equal(findSections('account')[0].id, 'account')
})

test('a search matching nothing returns nothing rather than everything', () => {
  // Offering the whole list for a word that matches none of it reads as "here is everything", which is a lie.
  assert.deepEqual(findSections('quantum chromodynamics'), [])
})

test('the order never shuffles between keystrokes', () => {
  // Equal scores fall back to the declared order, so the list under somebody's cursor does not rearrange itself.
  const once = findSections('o').map((s) => s.id)
  const twice = findSections('o').map((s) => s.id)
  assert.deepEqual(once, twice)
})

test('searching is not case sensitive', () => {
  assert.equal(findSections('PASSWORD')[0].id, 'security')
  assert.equal(findSections('  Dark  ')[0].id, 'appearance')
})

// ---------------------------------------------------------------- opening at a section

test('a section id from anywhere untrusted is made safe', () => {
  assert.equal(cleanSectionId('security'), 'security')
  assert.equal(cleanSectionId('nonsense'), DEFAULT_SETTINGS_SECTION)
  assert.equal(cleanSectionId(undefined), DEFAULT_SETTINGS_SECTION)
  assert.equal(cleanSectionId(null), DEFAULT_SETTINGS_SECTION)
  assert.equal(cleanSectionId(42), DEFAULT_SETTINGS_SECTION)
  assert.equal(cleanSectionId({ id: 'security' }), DEFAULT_SETTINGS_SECTION)
})

test('the section Settings opens at by default is a real one', () => {
  assert.ok(sectionById(DEFAULT_SETTINGS_SECTION))
})

test('a setting nobody has heard of has no section, rather than the first one', () => {
  assert.equal(sectionForSetting('somethingInvented'), undefined)
})
