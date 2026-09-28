import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPreset,
  builtInPreset,
  BUILT_IN_PRESETS,
  cleanPreset,
  cleanPresets,
  copyOfPreset,
  MAX_PRESETS,
  presetBackdrop,
  presetFromConfig,
  presetVariables,
  PRESET_SCHEMA_VERSION
} from './presets.ts'
import { defaultConfig } from './experience.ts'
import { builtInTheme } from './themes.ts'

const AT = Date.UTC(2026, 8, 27, 5, 0, 0)

test('Orbis ships presets and none of them are secretly the same', () => {
  assert.ok(BUILT_IN_PRESETS.length >= 12, 'a collection, not a token gesture')
  const ids = new Set(BUILT_IN_PRESETS.map((p) => p.id))
  assert.equal(ids.size, BUILT_IN_PRESETS.length, 'ids must be unique')
  // What a preset actually *is*: if two presets agree on all of this, one of them is a duplicate wearing a new name.
  const identities = BUILT_IN_PRESETS.map((p) =>
    JSON.stringify([p.themeId, p.appearance, p.motion, p.background])
  )
  assert.equal(new Set(identities).size, identities.length, 'two presets differ only by name')
})

test('every preset names a palette Orbis actually has', () => {
  for (const p of BUILT_IN_PRESETS) {
    if (p.themeId !== null) {
      assert.ok(builtInTheme(p.themeId), `${p.name} names a theme that does not exist: ${p.themeId}`)
    }
  }
})

test('every preset can explain itself', () => {
  for (const p of BUILT_IN_PRESETS) {
    assert.ok(p.name.trim().length > 0, 'a preset needs a name')
    assert.ok(p.description.trim().length > 0, `${p.name} has no description`)
    assert.equal(p.builtIn, true, `${p.name} should be read-only`)
    assert.equal(p.schemaVersion, PRESET_SCHEMA_VERSION)
  }
})

test('the default preset is Orbis exactly as it comes', () => {
  const orbis = builtInPreset('orbis-default')
  assert.ok(orbis)
  assert.equal(orbis.themeId, null, 'the default must not repaint Orbis')
  assert.equal(orbis.background.kind, 'orbis')
  assert.deepEqual(orbis.appearance, defaultConfig().appearance)
})

test('applying a preset changes how Orbis looks and nothing else', () => {
  const before = defaultConfig()
  const glass = builtInPreset('orbis-glass')
  assert.ok(glass)
  const after = applyPreset(before, glass, AT)

  assert.equal(after.themeId, glass.themeId)
  assert.deepEqual(after.appearance, glass.appearance)
  // The promise: a preset is appearance. It cannot reach anything a person would be alarmed to see change.
  assert.deepEqual(after.privacy, before.privacy)
  assert.deepEqual(after.notifications, before.notifications)
  assert.deepEqual(after.widgets, before.widgets)
  assert.deepEqual(after.newTab, before.newTab)
  assert.deepEqual(after.voice, before.voice)
  assert.deepEqual(after.accessibility, before.accessibility)
  assert.deepEqual(after.themes, before.themes)
})

test('a preset cannot ask for something that would break drawing', () => {
  const wild = cleanPreset(
    {
      id: 'hostile',
      name: 'Hostile',
      appearance: { blur: 9999, transparency: -50, cornerRadius: 1e9, fontScale: 100, accent: 'javascript:alert(1)' },
      motion: { intensity: 1e6, speed: -1e6 }
    },
    AT
  )
  assert.ok(wild)
  assert.ok(wild.appearance.blur <= 2, 'blur is bounded')
  assert.ok(wild.appearance.transparency >= 0.3 && wild.appearance.transparency <= 1)
  assert.ok(wild.appearance.cornerRadius <= 2.5)
  assert.ok(wild.appearance.fontScale <= 1.6)
  assert.equal(wild.appearance.accent, '', 'an accent that is not a colour is not an accent')
  assert.ok(wild.motion.intensity <= 1.6)
  assert.ok(wild.motion.speed >= 0.4)
})

test('an imported preset cannot claim to be one of Orbis own', () => {
  const impostor = cleanPreset({ id: 'orbis-glass', name: 'Not Glass', builtIn: true }, AT)
  assert.ok(impostor)
  assert.equal(impostor.builtIn, false, 'saying so does not make it read-only')
  // And it cannot take the id either, so the original is still reachable.
  const list = cleanPresets([{ id: 'orbis-glass', name: 'Not Glass' }], AT)
  assert.equal(list.length, 0, 'Orbis own ids are not available to take')
})

test('rubbish is refused rather than half-read', () => {
  assert.equal(cleanPreset(null, AT), null)
  assert.equal(cleanPreset(42, AT), null)
  assert.equal(cleanPreset({}, AT), null, 'a preset with no id or name is not a preset')
  assert.equal(cleanPreset({ id: 'x' }, AT), null, 'a preset needs a name')
  assert.deepEqual(cleanPresets('not a list', AT), [])
})

test('a preset naming a palette this Orbis does not have still works', () => {
  const p = cleanPreset({ id: 'from-elsewhere', name: 'Elsewhere', themeId: 'a-theme-from-the-future' }, AT)
  assert.ok(p)
  assert.equal(p.themeId, null, 'it falls back to Orbis own colours rather than none at all')
})

test('a background is drawn by Orbis, never fetched', () => {
  const p = cleanPreset(
    { id: 'x', name: 'X', background: { kind: 'image', value: 'https://example.com/tracker.png' } },
    AT
  )
  assert.ok(p)
  assert.equal(p.background.kind, 'orbis', 'only gradients Orbis draws itself are accepted')
  assert.equal(p.background.value, undefined)
})

test('the list of imported presets is bounded and deduplicated', () => {
  const many = Array.from({ length: MAX_PRESETS + 40 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))
  assert.ok(cleanPresets(many, AT).length <= MAX_PRESETS)
  const dupes = cleanPresets([{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }], AT)
  assert.equal(dupes.length, 1)
})

test('what Orbis is wearing can be kept as a preset', () => {
  const config = applyPreset(defaultConfig(), builtInPreset('orbis-study')!, AT)
  const saved = presetFromConfig(config, 'My study', AT)
  assert.equal(saved.builtIn, false)
  assert.equal(saved.themeId, config.themeId)
  assert.deepEqual(saved.appearance, config.appearance)
  // And putting it back on restores what it was taken from.
  assert.deepEqual(applyPreset(defaultConfig(), saved, AT).appearance, config.appearance)
})

test('copying one of Orbis own makes it editable without touching the original', () => {
  const glass = builtInPreset('orbis-glass')!
  const mine = copyOfPreset(glass, AT)
  assert.notEqual(mine.id, glass.id)
  assert.equal(mine.builtIn, false)
  assert.match(mine.name, /Glass/)
  assert.deepEqual(builtInPreset('orbis-glass'), glass, 'the original is unchanged')
})

test('movement is expressed as factors, and stillness means still', () => {
  const cyber = builtInPreset('orbis-cyber')!
  const moving = presetVariables(cyber, false)
  assert.ok(Number(moving['--motion-scale']) > 0)

  const still = presetVariables(cyber, true)
  assert.equal(Number(still['--motion-scale']), 0, 'reduced motion means no movement, not less of it')
  assert.ok(Number(still['--motion-speed']) > 0, 'transitions still complete; they just do not travel')
})

test('a gradient preset offers its background as a variable', () => {
  const aurora = builtInPreset('orbis-aurora')!
  assert.ok(presetVariables(aurora, false)['--preset-background'], 'Aurora is designed around its background')
  const orbis = builtInPreset('orbis-default')!
  assert.equal(presetVariables(orbis, false)['--preset-background'], undefined, 'the default keeps Orbis own')
})

// ---------------------------------------------------------------- backgrounds that move

test('a backdrop is one of Orbis own animations, or nothing', () => {
  const space = builtInPreset('orbis-space')!
  assert.equal(presetBackdrop(space, false), 'stars')

  const plain = builtInPreset('orbis-professional')!
  assert.equal(presetBackdrop(plain, false), null, 'a preset that asked for no movement gets none')
  assert.equal(presetBackdrop(null, false), null, 'no preset is no backdrop')
})

test('someone who asked not to be moved is not moved, whatever the preset wanted', () => {
  const aurora = builtInPreset('orbis-aurora')!
  assert.equal(presetBackdrop(aurora, false), 'aurora')
  assert.equal(presetBackdrop(aurora, true), null)
})

test('a preset turned all the way down stops its background too', () => {
  const aurora = builtInPreset('orbis-aurora')!
  const still = { ...aurora, motion: { intensity: 0, speed: 1 } }
  assert.equal(presetBackdrop(still, false), null, 'no movement anywhere means no movement anywhere')
})

test('a backdrop nobody has heard of is stillness, not an animation Orbis does not have', () => {
  const read = cleanPreset(
    {
      id: 'shared',
      name: 'Shared',
      background: { kind: 'gradient', value: 'linear-gradient(#000, #111)', backdrop: 'explode' }
    },
    AT
  )
  assert.ok(read)
  assert.equal(read.background.backdrop, 'none')
  assert.equal(presetBackdrop(read, false), null)
})

test('a preset written before backdrops existed still loads, and still does not move', () => {
  const read = cleanPreset({ id: 'old', name: 'Old', background: { kind: 'gradient', value: 'linear-gradient(#000, #111)' } }, AT)
  assert.ok(read)
  assert.equal(read.background.backdrop, 'none')
})

test('the backdrop takes longer when the preset asks to be slower', () => {
  const base = builtInPreset('orbis-aurora')!
  const quick = presetVariables({ ...base, motion: { intensity: 1, speed: 0.5 } }, false)['--backdrop-cycle']
  const slow = presetVariables({ ...base, motion: { intensity: 1, speed: 2 } }, false)['--backdrop-cycle']
  assert.ok(parseInt(slow, 10) > parseInt(quick, 10))
  assert.match(slow, /^\d+s$/)
})

test('every backdrop a built-in asks for is one Orbis can draw', () => {
  const drawn = new Set(['none', 'drift', 'aurora', 'stars', 'flow', 'waves', 'scan'])
  for (const preset of BUILT_IN_PRESETS) {
    assert.ok(drawn.has(preset.background.backdrop ?? 'none'), `${preset.name} asks for a backdrop that is not drawn`)
  }
})

test('the collection covers each way of working, and every name is its own', () => {
  const names = BUILT_IN_PRESETS.map((p) => p.name)
  assert.equal(new Set(names).size, names.length)
  assert.ok(BUILT_IN_PRESETS.length >= 25, 'a collection worth browsing')
  for (const category of ['Orbis', 'Calm', 'Dark', 'Light', 'Vivid', 'Work']) {
    assert.ok(
      BUILT_IN_PRESETS.some((p) => p.category === category),
      `nothing to choose in ${category}`
    )
  }
})
