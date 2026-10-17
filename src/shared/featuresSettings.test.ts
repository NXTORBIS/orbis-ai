import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { FEATURE_FACTS, capabilityFor } from './featureVisibility.ts'
import { findSections, sectionById, SETTINGS_SECTIONS } from './settingsSections.ts'

/**
 * The Features screen in Settings: that it is reachable, and that it cannot lie about a core part of Orbis.
 *
 * The screen itself is drawn by `src/renderer/src/components/FeaturesSettings.tsx` from `SURFACE_GROUPS` in
 * `src/renderer/src/lib/features.ts`, which pulls in React and lucide and so cannot be imported here -- the runner
 * takes pure modules only. So the two things that can silently break it are read as text, exactly as
 * `featureLauncher.test.ts` reads the launcher's icon map.
 */

const root = resolve(import.meta.dirname, '..', '..')
const FEATURES = join(root, 'src', 'renderer', 'src', 'lib', 'features.ts')
const ROWS = join(root, 'src', 'renderer', 'src', 'lib', 'featureRows.ts')
const MODAL = join(root, 'src', 'renderer', 'src', 'components', 'SettingsModal.tsx')
const SIDEBAR = join(root, 'src', 'renderer', 'src', 'components', 'Sidebar.tsx')

test('Features is a section of Settings, findable by the words somebody would type', () => {
  const section = sectionById('features')
  assert.ok(section, 'Settings has no Features section, so there is nowhere to change which screens you see')
  assert.equal(section.settings.length, 0, 'the choice is one file per profile, not a key of Settings — see src/main/features/store.ts')
  assert.ok(section.blurb.toLowerCase().includes('deleted'), 'the section’s own line is where the "nothing is deleted" promise starts')

  // The words people actually use. Somebody tidying up types "hide" or "turn off", not "feature visibility".
  for (const typed of ['features', 'hide', 'turn off', 'menu', 'declutter']) {
    const found = findSections(typed)
    assert.equal(found[0]?.id, 'features', `typing "${typed}" in Settings does not land on Features`)
  }

  const ids = SETTINGS_SECTIONS.map((one) => one.id)
  assert.equal(ids.indexOf('features'), 1, 'Features sits straight after Account: every other section is downstream of it')
})

test('Settings really draws the Features screen, with an icon for it', async () => {
  const modal = await readFile(MODAL, 'utf8')
  assert.match(modal, /active === 'features' &&/, 'the section is in the registry and the dialog never draws it, so it would open empty')
  assert.match(modal, /<FeaturesSettings visibility=/, 'nothing mounts the Features screen, or it reads the choice a second time instead of being handed the window’s own')
  const section = sectionById('features')!
  // The registry names an icon; the dialog is what knows which drawing that is. A name it has never heard of falls
  // back to the information icon, which would make Features look like About.
  assert.match(modal, new RegExp(`\\n\\s*${section.icon}:`), `SettingsModal has no icon called ${section.icon}`)
})

test('the menu this shortens is also the way to change it', async () => {
  /*
   * The second door, and the reason it is not optional.
   *
   * Hiding screens only helps if putting one back feels easy, and the moment somebody wonders where a screen went
   * is the moment they are staring at the shortened menu. Being told to go and look through Settings for the right
   * section is an instruction rather than an answer, so the way to change the list sits at the foot of the list --
   * in the menu on the Orbis wordmark, which is the thing the choice changes.
   *
   * Read as text because `Sidebar.tsx` is React and lucide, exactly as the launcher's icon map is read above.
   */
  const sidebar = await readFile(SIDEBAR, 'utf8')
  assert.match(sidebar, /onSettings\('features'\)/, 'the wordmark menu has no way into the Features screen, so a shortened menu has no visible way back')
  assert.match(sidebar, /Choose your features/, 'the row exists with no words a person would recognise on it')
})

test('every part of Orbis with no capability has an icon, so no row claims there is no screen for the chat', async () => {
  /*
   * The failure this exists for.
   *
   * A row's `missing` sentence -- "this version of Orbis has no screen to open for it" -- is worked out from whether
   * there is an icon, because for the six core parts an icon is the only sign the window draws them at all. So a new
   * core surface added to `FEATURE_FACTS` and forgotten in `CORE_ICONS` would not be a blank square: it would be the
   * Features screen telling somebody that Orbis has no browser. That is the "never claim a thing is on when it is
   * off" rule broken in the other direction, and it is worth a test.
   */
  const source = (await readFile(ROWS, 'utf8')) + (await readFile(FEATURES, 'utf8'))
  const maps = [...source.matchAll(/const (?:CORE_ICONS|CHOICE_ICONS|ICONS)[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/g)]
  assert.ok(maps.length >= 2, 'the icon maps could not be found, so this test is checking nothing')
  const named = new Set(maps.flatMap((block) => [...block[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((one) => one[1])))

  const coreless = FEATURE_FACTS.filter((one) => capabilityFor(one.id) === undefined).map((one) => one.id)
  assert.ok(coreless.length >= 5, `only ${coreless.length} core surfaces were found, so the classification has changed shape`)
  assert.deepEqual(
    coreless.filter((id) => !named.has(id)),
    [],
    'a part of Orbis with no capability has no icon, so the Features screen would report it as a screen Orbis does not have'
  )
})
