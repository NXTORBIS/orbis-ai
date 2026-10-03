import assert from 'node:assert/strict'
import test from 'node:test'
import { fold, rankFindables, scoreFindable, singular, type Findable } from './settingsSearch.ts'
import { findSections } from './settingsSections.ts'

/**
 * Searching Settings.
 *
 * These exist because a search is the one part of a settings screen that fails silently. A broken list of sections is
 * obvious the moment anybody looks at it; a search that ranks the right answer fourth still returns a list, still
 * looks like it worked, and simply makes the thing harder to find than scrolling would have been. So the ladder is
 * asserted rather than described, with made-up entries where the point is the ranking itself and with the real
 * sections where the point is that somebody typing an ordinary English word lands on the right one.
 */

/** A short name, so the made-up entries below read as a list rather than as scaffolding. */
const it = (label: string, keywords: string[] = [], blurb = 'nothing to see'): Findable => ({ label, blurb, keywords })

// ---------------------------------------------------------------- the ladder

test('the obvious answer comes first', () => {
  /**
   * In order: the name typed in full, the name that begins with it, the name that merely contains it, a word the
   * thing is also known by, a word that begins with it, and finally a mention in prose. Every one of these matches,
   * so a filter would return all six in whatever order they happened to be declared; the ranking is the whole of
   * what makes the list useful.
   */
  const items = [
    it('Kappa', [], 'an alpha somewhere in prose'),
    it('Omega', ['alphas gone']),
    it('Zeta', ['alpha']),
    it('The Alpha One'),
    it('Alphabet'),
    it('Alpha')
  ]
  assert.deepEqual(
    rankFindables(items, 'alpha').map((one) => one.label),
    ['Alpha', 'Alphabet', 'The Alpha One', 'Zeta', 'Omega', 'Kappa']
  )
})

test('a name beats a keyword, and a keyword beats a blurb', () => {
  // The three sources, each scored on its own, so the weights cannot quietly collapse into one another.
  assert.ok(scoreFindable(it('Voice'), 'voice') > scoreFindable(it('Zeta', ['voice']), 'voice'))
  assert.ok(scoreFindable(it('Zeta', ['voice']), 'voice') > scoreFindable(it('Zeta', [], 'about your voice'), 'voice'))
})

test('a longer phrase still finds what one of its words finds', () => {
  // Nothing is literally called "dark mode", and matching only the whole phrase found nothing at all for it.
  assert.ok(scoreFindable(it('Appearance', ['dark']), 'dark mode') > 0)
  // But it is worth less than typing the word on its own, so a precise search is never overtaken by a vague one.
  assert.ok(scoreFindable(it('Appearance', ['dark']), 'dark mode') < scoreFindable(it('Appearance', ['dark']), 'dark'))
})

test('a stray single letter does not drag everything in', () => {
  // Each word of a phrase is matched separately, and a one-letter word matches almost everything, which would fill
  // the list with entries that have nothing to do with the question.
  assert.equal(scoreFindable(it('Zeta', ['a']), 'dark a'), 0)
  // Typing one letter on its own still narrows the list, because then that letter is the search rather than a word of one.
  assert.ok(scoreFindable(it('Account'), 'a') > 0)
})

test('searching ignores case and surrounding space', () => {
  assert.equal(scoreFindable(it('Voice'), '  VOICE  '), scoreFindable(it('Voice'), 'voice'))
})

// ---------------------------------------------------------------- plurals

test('a trailing s is taken off, and only a trailing s', () => {
  assert.equal(singular('games'), 'game')
  assert.equal(singular('updates'), 'update')
  // A double s, or the word would read as a misspelling of itself.
  assert.equal(singular('address'), 'address')
  assert.equal(singular('ss'), 'ss')
  // Too short to be left meaning anything: "as" must not become "a", which matches everything.
  assert.equal(singular('as'), 'as')
  assert.equal(singular('ads'), 'ads')
  assert.equal(singular('lock'), 'lock')
})

test('a plural and its singular fold to the same word', () => {
  /**
   * The property the rule exists for, and the reason it stops at one letter. Taking "es" off as well sounds more
   * thorough: it would fold "licences" to "licenc" while "licence" stayed whole, so the two would no longer match
   * each other and a search that used to work would quietly stop working.
   */
  for (const [plural, one] of [['licences', 'licence'], ['notices', 'notice'], ['prices', 'price'], ['profiles', 'profile']] as const) {
    assert.equal(singular(plural), singular(one), `${plural} and ${one} must fold together`)
  }
})

test('punctuation goes before the plurals do', () => {
  // A blurb's first word ends in a comma, not an s. Folding the words without clearing the punctuation first does
  // nothing at all, which is how a plural search can look implemented and match nothing.
  assert.equal(fold('Passwords, locks, and moving a profile between computers.'), 'password lock and moving a profile between computer')
})

test('a plural finds the singular, and never beats it', () => {
  const items = [it('Zeta', ['update']), it('Updates')]
  // Zeta is found at all only because "updates" folds to "update" -- but the thing actually called Updates still wins.
  assert.deepEqual(rankFindables(items, 'updates').map((one) => one.label), ['Updates', 'Zeta'])
  assert.ok(scoreFindable(it('Zeta', ['update']), 'updates') > 0)
  assert.ok(scoreFindable(it('Zeta', ['update']), 'updates') < scoreFindable(it('Zeta', ['update']), 'update'))
})

// ---------------------------------------------------------------- nothing found

test('a search matching nothing returns nothing, not everything', () => {
  // Offering the whole list for a word that matches none of it reads as "here is everything you asked for", and
  // hides the one thing worth knowing: that it is not in here under that name.
  assert.deepEqual(rankFindables([it('Voice'), it('Games')], 'quantum chromodynamics'), [])
  assert.deepEqual(rankFindables([it('Voice'), it('Games')], 'zz'), [])
})

test('an empty search offers everything, in the order it was declared', () => {
  const items = [it('Voice'), it('Games'), it('About')]
  for (const nothing of ['', '   ', '\t']) {
    assert.deepEqual(rankFindables(items, nothing).map((one) => one.label), ['Voice', 'Games', 'About'], JSON.stringify(nothing))
  }
})

test('the order never shuffles between keystrokes', () => {
  // Equal scores fall back to the declared order, so the list under somebody's cursor holds still while they type.
  const twins = [it('First', [], 'alpha'), it('Second', [], 'alpha')]
  assert.deepEqual(rankFindables(twins, 'alpha').map((one) => one.label), ['First', 'Second'])
  assert.deepEqual(rankFindables(twins, 'alpha'), rankFindables(twins, 'alpha'))
})

test('the list handed in is never rearranged in place', () => {
  // It is `SETTINGS_SECTIONS` that gets passed in, which is frozen and shared, and sorting it would reorder Settings
  // itself for the rest of the session.
  const items = [it('Kappa', [], 'alpha'), it('Alpha')]
  rankFindables(items, 'alpha')
  assert.deepEqual(items.map((one) => one.label), ['Kappa', 'Alpha'])
})

// ---------------------------------------------------------------- the real sections

test('the plurals people actually type find the right section', () => {
  /**
   * The words on the left are plurals of words no section lists. Before the folding, "updates" and "profiles" found
   * nothing whatever -- and a settings search that answers "nothing matches" to the word on the button somebody is
   * looking for is worse than no search, because it reads as a straight answer.
   */
  for (const [typed, expected] of [
    ['passwords', 'security'],
    ['profiles', 'account'],
    ['updates', 'about'],
    ['animations', 'appearance'],
    ['models', 'orion'],
    ['colours', 'appearance']
  ] as const) {
    const found = findSections(typed)
    assert.ok(found.length > 0, `"${typed}" found nothing`)
    assert.equal(found[0].id, expected, `"${typed}" offered ${found[0].id} first`)
  }
})

test('folding a plural does not disturb what already worked', () => {
  // The singular of each of the above, which matched before the folding existed and must still rank first.
  for (const [typed, expected] of [
    ['password', 'security'],
    ['profile', 'account'],
    ['update', 'about'],
    ['animation', 'appearance'],
    ['model', 'orion'],
    ['colour', 'appearance']
  ] as const) {
    assert.equal(findSections(typed)[0]?.id, expected, typed)
  }
})
