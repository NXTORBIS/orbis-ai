import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExperienceConfig } from '../shared/experience.ts'
import {
  addSnapshot,
  appearanceVariables,
  checkImport,
  defaultConfig,
  describeConfig,
  diffConfig,
  EXPERIENCE_SCHEMA_VERSION,
  exportConfig,
  isDefaultConfig,
  MAX_SNAPSHOTS,
  migrateConfig,
  normalizeConfig,
  resolveLayered,
  wantsReducedMotion
} from '../shared/experience.ts'

test('the default configuration is the Orbis everyone already has, and changes nothing', () => {
  const config = defaultConfig()
  assert.equal(isDefaultConfig(config), true)
  // Nothing is applied: every CSS variable is left to Orbis itself.
  assert.deepEqual(appearanceVariables(config, false), {})
  assert.equal(wantsReducedMotion(config, false), false)
  assert.equal(wantsReducedMotion(config, true), true, 'the system asking for less movement is respected')
  assert.deepEqual(describeConfig(config), ['The Orbis experience, unchanged'])
  assert.equal(config.newTab.mode, 'current')
  assert.equal(config.widgets.length, 0)
})

test('only what was personalised is applied, and nothing else is touched', () => {
  const config = normalizeConfig({ appearance: { accent: '#ff4d6d', density: 'compact', fontScale: 1.2 }, accessibility: { highContrast: true } })
  const variables = appearanceVariables(config, false)
  assert.equal(variables['--cyan'], '#ff4d6d')
  assert.equal(variables['--density-scale'], '0.82')
  assert.equal(variables['--font-scale'], '1.2')
  assert.equal(variables['--text'], '#ffffff', 'high contrast is applied')
  assert.equal(variables['--blur-scale'], undefined, 'blur was never changed, so Orbis keeps its own')
  assert.equal(variables['--glass'], undefined)
})

test('a stored configuration is read safely: nonsense falls back to Orbis’s own values', () => {
  const config = normalizeConfig({
    appearance: { accent: 'rebeccapurple', density: 'spacious', fontScale: 99, transparency: -4, reducedMotion: 'sometimes' },
    newTab: { mode: 'chaos', wallpaperId: 'missing' },
    wallpapers: [
      { id: 'w1', name: 'Mine', source: 'data:image/png;base64,AAA', kind: 'image', addedAt: 5 },
      { id: 'w2', name: 'Remote', source: 'https://example.com/a.png', kind: 'image' }
    ],
    themes: [{ id: 't1', name: 'Mine', base: 'neon', tokens: { accent: '#fff', 'bad key!': 'x' } }],
    themeId: 'nope',
    privacy: { keepUsageDays: 10_000 },
    notifications: { quietHours: { enabled: true, from: '25:00', to: '07:30' } }
  })
  assert.equal(config.appearance.accent, '', 'a colour Orbis cannot use is ignored')
  assert.equal(config.appearance.density, 'comfortable')
  assert.equal(config.appearance.fontScale, 1.4, 'clamped to what Orbis supports')
  assert.equal(config.appearance.transparency, 0.5)
  assert.equal(config.appearance.reducedMotion, 'system')
  assert.equal(config.newTab.mode, 'current')
  assert.equal(config.newTab.wallpaperId, null, 'a wallpaper that is not there is not chosen')
  assert.deepEqual(config.wallpapers.map((w) => w.id), ['w1'], 'a wallpaper fetched from the internet is refused')
  assert.equal(config.themes[0].base, 'dark')
  assert.deepEqual(Object.keys(config.themes[0].tokens), ['accent'])
  assert.equal(config.themeId, null)
  assert.equal(config.privacy.keepUsageDays, 365)
  assert.equal(config.notifications.quietHours.from, '22:00')
  assert.equal(config.notifications.quietHours.to, '07:30')
})

test('configurations are brought forward, and an unreadable one starts from Orbis’s own', () => {
  const current = migrateConfig({ schemaVersion: EXPERIENCE_SCHEMA_VERSION, appearance: { accent: '#3ee58a' } })
  assert.equal(current.recovered, false)
  assert.equal(current.from, undefined)
  assert.equal(current.config.appearance.accent, '#3ee58a')

  const older = migrateConfig({ schemaVersion: 0, appearance: { density: 'compact' } })
  assert.equal(older.from, 0)
  assert.equal(older.config.appearance.density, 'compact', 'what it held is kept, not reset')

  const newer = migrateConfig({ schemaVersion: EXPERIENCE_SCHEMA_VERSION + 5, appearance: { accent: '#ffbe4d' }, somethingNew: true })
  assert.equal(newer.recovered, false)
  assert.equal(newer.config.appearance.accent, '#ffbe4d', 'a file from a newer Orbis still works as far as this one understands it')

  assert.equal(migrateConfig('nonsense').recovered, true)
  assert.equal(isDefaultConfig(migrateConfig(null).config), true)
})

test('a setting’s value follows a fixed order, and Orbis can explain where it came from', () => {
  const plain = resolveLayered('comfortable', {})
  assert.equal(plain.value, 'comfortable')
  assert.equal(plain.from, 'orbis')

  const layered = resolveLayered('comfortable', { profile: 'cosy', scene: 'compact' })
  assert.equal(layered.value, 'compact', 'the later layer wins')
  assert.equal(layered.from, 'scene')
  assert.deepEqual(layered.considered.map((c) => c.layer), ['orbis', 'profile', 'scene'])

  const overridden = resolveLayered('comfortable', { scene: 'compact', user: 'cosy' })
  assert.equal(overridden.value, 'cosy', 'what the user chose wins over everything')
  assert.equal(overridden.from, 'user')
})

test('changes are listed for undo and "recently changed"', () => {
  const before = defaultConfig()
  const after: ExperienceConfig = { ...before, appearance: { ...before.appearance, accent: '#a78bfa', density: 'cosy' }, updatedAt: 5 }
  const changes = diffConfig(before, after)
  assert.deepEqual(changes.map((c) => c.path).sort(), ['appearance.accent', 'appearance.density'])
  assert.deepEqual(changes.find((c) => c.path === 'appearance.accent'), { path: 'appearance.accent', before: '', after: '#a78bfa' })
  assert.equal(diffConfig(before, { ...before, updatedAt: 999 }).length, 0, 'the time it was saved is not a change')
})

test('snapshots keep the most recent, newest first', () => {
  let snapshots = [] as ReturnType<typeof addSnapshot>
  for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) snapshots = addSnapshot(snapshots, { id: `s${i}`, reason: `change ${i}`, takenAt: i, config: defaultConfig() })
  assert.equal(snapshots.length, MAX_SNAPSHOTS)
  assert.equal(snapshots[0].id, `s${MAX_SNAPSHOTS + 4}`)
})

test('export and import are checked, described and never applied blindly', () => {
  const config = normalizeConfig({ appearance: { accent: '#3fd8ff', density: 'compact' }, newTab: { mode: 'minimal' }, accessibility: { largerText: true } })
  const file = exportConfig(config)
  assert.equal(file.format, 'orbis-experience')

  const good = checkImport(file)
  assert.equal(good.ok, true)
  assert.equal(good.config?.appearance.density, 'compact')
  assert.ok(good.summary.includes('Compact spacing'))
  assert.ok(good.summary.includes('New tab: minimal'))
  assert.ok(good.summary.includes('Larger text'))

  assert.ok(checkImport({ format: 'something-else' }).problems.includes('This is not an Orbis personalisation file.'))
  assert.equal(checkImport({ format: 'orbis-experience' }).ok, false)
  assert.equal(checkImport({ format: 'orbis-experience', config: 'broken' }).ok, false)
})
