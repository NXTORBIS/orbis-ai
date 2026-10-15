import { plainHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'
import type { EngineStatus, MachineFacts } from '../../shared/neurova/engines.ts'
import { interpret, type SongRequest } from '../../shared/neurova/intent.ts'
import { diagnose, parseLyrics } from '../../shared/neurova/lyrics.ts'
import type { Op } from '../../shared/neurova/process.ts'
import type { NeurovaStore } from './store.ts'
import type { NeurovaEngine } from './engine.ts'

export interface NeurovaIpcOptions {
  store: NeurovaStore
  engine: NeurovaEngine
  getWindow(): BrowserWindow | null
  send(channel: string, ...args: unknown[]): void
  /** Opens the system file dialog. Resolves to the chosen path, or null if the person cancelled. */
  pick(kind: 'audio' | 'folder'): Promise<string | null>
  /** Honest facts about this machine (Python, GPU, disk). */
  machineFacts(): Promise<MachineFacts>
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '')

export function registerNeurovaIpc(o: NeurovaIpcOptions): void {
  const handle = plainHandle(o)
  o.store.onChange(() => o.send('neurova:changed'))

  handle('neurova:list', () => o.store.list())
  handle('neurova:create', (_e, title, brief, lyrics) => o.store.create(str(title, 120), str(brief, 20000), str(lyrics, 50000)))
  handle('neurova:update', (_e, id, patch) => o.store.update(str(id, 80), (patch ?? {}) as Record<string, string>))
  handle('neurova:remove', (_e, id) => o.store.remove(str(id, 80)))
  handle('neurova:import-audio', async (_e, id, name, note) => {
    const path = await o.pick('audio')
    return path ? o.store.importAudio(str(id, 80), path, str(name, 120) || undefined, str(note, 2000) || undefined) : null
  })
  handle('neurova:analyse', (_e, id, artifactId) => o.store.analyse(str(id, 80), str(artifactId, 80)))
  handle('neurova:select-version', (_e, id, versionId) => o.store.select(str(id, 80), str(versionId, 80)))
  handle('neurova:restore-version', (_e, id, versionId) => o.store.restore(str(id, 80), str(versionId, 80)))
  handle('neurova:remove-version', (_e, id, versionId) => o.store.removeVersion(str(id, 80), str(versionId, 80)))
  handle('neurova:export-version', async (_e, id, versionId) => {
    const folder = await o.pick('folder')
    return folder ? o.store.exportVersion(str(id, 80), str(versionId, 80), folder) : null
  })
  handle('neurova:export-package', async (_e, id) => {
    const folder = await o.pick('folder')
    return folder ? o.store.exportPackage(str(id, 80), folder) : null
  })
  handle('neurova:import-package', async () => {
    const folder = await o.pick('folder')
    return folder ? o.store.importPackage(folder) : null
  })
  handle('neurova:process', (_e, id, versionId, op) => o.store.process(str(id, 80), str(versionId, 80), (op ?? {}) as Op))
  handle('neurova:tempo', (_e, id, artifactId) => o.store.tempo(str(id, 80), str(artifactId, 80)))
  handle('neurova:waveform', (_e, id, artifactId) => o.store.waveform(str(id, 80), str(artifactId, 80)))
  handle('neurova:lyrics', (_e, text) => {
    const doc = parseLyrics(str(text, 50000))
    return { sections: doc.sections.map((s) => ({ id: s.id, label: s.label, type: s.type, lines: s.lines.length })), warnings: doc.warnings, notices: diagnose(doc) }
  })
  handle('neurova:interpret', (_e, req) => interpret((req ?? {}) as SongRequest))
  handle('neurova:engines', (): Promise<EngineStatus[]> => o.engine.status())
  handle('neurova:install-status', () => o.engine.installStatus())
  handle('neurova:install-runtime', (_e, engine) => { void o.engine.installRuntime(engine === 'heartmula' ? 'heartmula' : 'ace-step'); return true })
  handle('neurova:install-models', (_e, engine) => { void o.engine.installModels(engine === 'heartmula' ? 'heartmula' : 'ace-step'); return true })
  handle('neurova:install-cancel', () => { o.engine.cancelInstall(); return true })
  handle('neurova:generate', (_e, id, input) => o.engine.generate(str(id, 80), (input ?? {}) as { prompt: string; lyrics?: string; instrumental?: boolean; durationSec?: number; seed?: number; engine?: 'ace-step' | 'heartmula'; tags?: string[] }))
  handle('neurova:jobs', () => o.engine.listJobs())
  handle('neurova:cancel-job', (_e, id) => o.engine.cancel(str(id, 80)))
}
