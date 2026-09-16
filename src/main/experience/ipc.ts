import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { AppearanceConfig, ExperienceConfig } from '../../shared/experience'
import { describeConfig, isDefaultConfig } from '../../shared/experience'
import type { BrowserControl } from '../browserControl/registry'
import { fail } from '../browserControl/registry'
import type { ExperienceStore } from './store'

export interface ExperienceIpcOptions {
  store: ExperienceStore
  control: BrowserControl
  getWindow(): BrowserWindow | null
  send(channel: string, ...args: unknown[]): void
}

/**
 * The Orbis window's access to the Experience Runtime, and the parts of it Orion may touch. Everything here changes only
 * the customisation layer: tabs, bookmarks, notes, tasks, workflows and settings are never affected.
 */
export function registerExperienceIpc(o: ExperienceIpcOptions): void {
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== o.getWindow()?.webContents) throw new Error('Not allowed.')
      return handler(event, ...args)
    })
  }

  o.store.onChange((config) => o.send('experience:changed', config))

  handle('experience:get', () => o.store.current())
  handle('experience:save', (_e, config, reason) => o.store.save(config as ExperienceConfig, typeof reason === 'string' ? reason.slice(0, 80) : 'Change'))
  handle('experience:health', () => o.store.checkHealth())
  handle('experience:snapshots', () => o.store.listSnapshots())
  handle('experience:restore-snapshot', (_e, id) => o.store.restoreSnapshot(String(id)))
  handle('experience:remove-snapshot', (_e, id) => o.store.removeSnapshot(String(id)))
  handle('experience:reset-section', (_e, section) => o.store.resetSection(String(section) as keyof ExperienceConfig))
  handle('experience:restore-original', () => o.store.restoreOriginal())
  handle('experience:export', () => o.store.export())
  handle('experience:check-import', (_e, raw) => o.store.check(raw))
  handle('experience:import', (_e, raw, how) => o.store.import(raw, how === 'merge' ? 'merge' : 'replace'))

  // ---------------------------------------------------------------- capabilities

  o.control.register({
    id: 'experience.describe',
    domain: 'experience',
    name: 'Describe the personalisation',
    description: 'What the user has personalised about Orbis, in plain words, and whether it is still the untouched Orbis experience.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => {
      const config = o.store.current()
      return { untouched: isDefaultConfig(config), summary: describeConfig(config), appearance: config.appearance, newTab: config.newTab.mode }
    }
  })

  o.control.register({
    id: 'experience.appearance',
    domain: 'experience',
    name: 'Change how Orbis looks',
    description: 'Changes the accent colour, spacing, text size, corner rounding, see-through panels, blur or movement. Only what is given changes; everything else stays as it is.',
    params: {
      accent: { type: 'string', description: 'A colour such as #3fd8ff, or "" for the Orbis accent.' },
      density: { type: 'string', description: 'How tightly things sit together.', enum: ['comfortable', 'cosy', 'compact'] },
      fontScale: { type: 'number', description: 'Text size, 0.85 to 1.4 (1 is normal).' },
      cornerRadius: { type: 'integer', description: 'Corner rounding in pixels, 0 for the Orbis look.' },
      transparency: { type: 'number', description: 'How see-through panels are, 0.5 to 1.5 (1 is normal).' },
      blur: { type: 'number', description: 'Background blur, 0 to 2 (1 is normal).' },
      reducedMotion: { type: 'string', description: 'Less movement.', enum: ['system', 'on', 'off'] }
    },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Change how Orbis looks (${Object.keys(p).join(', ') || 'nothing'})`,
    assess: (p, ctx) => (ctx.source === 'user' || Object.keys(p).length ? { decision: ctx.source === 'user' ? 'run' : 'confirm', reason: 'This changes how Orbis looks for the user.' } : { decision: 'run', reason: '' }),
    run: async (p) => {
      const current = o.store.current()
      const appearance: AppearanceConfig = { ...current.appearance }
      if (typeof p.accent === 'string') appearance.accent = p.accent
      if (typeof p.density === 'string') appearance.density = p.density as AppearanceConfig['density']
      if (typeof p.fontScale === 'number') appearance.fontScale = p.fontScale
      if (typeof p.cornerRadius === 'number') appearance.cornerRadius = p.cornerRadius
      if (typeof p.transparency === 'number') appearance.transparency = p.transparency
      if (typeof p.blur === 'number') appearance.blur = p.blur
      if (typeof p.reducedMotion === 'string') appearance.reducedMotion = p.reducedMotion as AppearanceConfig['reducedMotion']
      const { config, changes } = await o.store.save({ ...current, appearance }, 'Orion changed how Orbis looks')
      if (!changes.length) return fail('failed', 'Nothing was different, so nothing changed.', false)
      return { changed: changes.map((c) => c.path), appearance: config.appearance }
    },
    verify: (data) => {
      const { appearance } = data as { appearance: AppearanceConfig }
      const now = o.store.current().appearance
      const same = JSON.stringify(now) === JSON.stringify(appearance)
      return { verified: same, detail: same ? 'Orbis looks as asked.' : 'The look did not change.' }
    }
  })

  o.control.register({
    id: 'experience.restoreOriginal',
    domain: 'experience',
    name: 'Restore the original Orbis experience',
    description: 'Puts everything personalised back to how Orbis comes. Tabs, bookmarks, history, notes, tasks, workflows and settings are untouched.',
    params: {},
    mutates: true,
    confirmation: 'always',
    describe: () => 'Put all personalisation back to the original Orbis experience',
    run: async () => {
      const { wasDefault } = await o.store.restoreOriginal()
      return { wasAlreadyOriginal: wasDefault }
    },
    verify: () => {
      const untouched = isDefaultConfig(o.store.current())
      return { verified: untouched, detail: untouched ? 'Orbis is back to how it comes.' : 'Some personalisation is still there.' }
    }
  })

  o.control.register({
    id: 'experience.snapshots',
    domain: 'experience',
    name: 'Personalisation history',
    description: 'The snapshots Orbis keeps before each change, so any change can be undone.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => o.store.listSnapshots().map((s) => ({ id: s.id, reason: s.reason, takenAt: s.takenAt }))
  })

  o.control.register({
    id: 'experience.undo',
    domain: 'experience',
    name: 'Undo a personalisation change',
    description: 'Goes back to how things were before a change (experience.snapshots lists them). The most recent one is used when none is named.',
    params: { snapshot: { type: 'string', description: 'Which snapshot; the latest when left out.' } },
    mutates: true,
    confirmation: 'when-consequential',
    run: async (p) => {
      const snapshots = o.store.listSnapshots()
      const snapshot = typeof p.snapshot === 'string' ? snapshots.find((s) => s.id === p.snapshot) : snapshots[0]
      if (!snapshot) return fail('not-found', 'There is nothing to undo.', true)
      await o.store.restoreSnapshot(snapshot.id)
      return { undone: snapshot.reason }
    }
  })

  o.control.registerState('experience', () => {
    const config = o.store.current()
    const health = o.store.checkHealth()
    return { untouched: isDefaultConfig(config), summary: describeConfig(config), health: { ok: health.ok, problems: health.problems }, snapshots: health.snapshots }
  })
}
