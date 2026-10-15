import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError, OrbisError, toOrbisError } from '../shared/errors';
import { describeRun } from '../shared/customActions';
import { requireAbsolute } from './fs/paths';
import { planFromRequest } from './actions/customActions';
import type { Services } from './services';

/**
 * IPC handlers for the shelf, custom actions and Git status. Payloads are
 * validated by the shared zod schemas before these run (ipcHandlers.ts).
 */

type Channels = 'shelf:list' | 'shelf:add' | 'shelf:remove' | 'shelf:clear' | 'actions:list' | 'actions:save' | 'actions:delete' | 'actions:plan' | 'actions:export' | 'actions:import' | 'git:info' | 'git:status' | 'git:remoteUrl';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export function productivityHandlers(s: Services, broadcast: (channel: 'shelf:changed' | 'actions:changed', payload: unknown) => void): Handlers {
  s.shelf.on('changed', () => broadcast('shelf:changed', {}));
  const actionsChanged = () => broadcast('actions:changed', { actions: s.actions.list() });
  const gitOff = () => !s.settings.get('gitIntegration');

  return {
    // ------------------------------------------------------------------ shelf
    'shelf:list': () => s.shelf.list(),
    'shelf:add': (p) => s.shelf.add(p.paths),
    'shelf:remove': (p) => ({ removed: s.shelf.remove(p.paths.map((x) => requireAbsolute(x, 'shelf.remove'))) }),
    'shelf:clear': () => ({ removed: s.shelf.clear() }),

    // ------------------------------------------------------------------ custom actions
    'actions:list': () => s.actions.list(),
    'actions:save': (p) => {
      const a = s.actions.save(p.action);
      s.log.info('actions.saved', { id: a.id, shell: a.shell, runMode: a.runMode });
      actionsChanged();
      return a;
    },
    'actions:delete': (p) => {
      const ok = s.actions.delete(p.id);
      if (!ok) throw makeError('not_found', 'actions.delete', { message: 'This action no longer exists.' });
      actionsChanged();
      return { deleted: true };
    },
    'actions:plan': async (p) => {
      const { action, runs } = await planFromRequest(s.actions, { sources: p.paths.map((x) => requireAbsolute(x, 'actions.plan')), params: { actionId: p.id, folder: requireAbsolute(p.folder, 'actions.plan') } });
      return { action, runs: runs.slice(0, 200).map((r) => ({ label: r.label, command: describeRun(r), cwd: r.cwd, items: r.items.length })), total: runs.length };
    },
    'actions:export': async (_p, e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const opts = { title: 'Export custom actions', defaultPath: path.join(os.homedir(), 'orbis-files-actions.json'), filters: [{ name: 'Orbis Files actions', extensions: ['json'] }] };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      const target = r.filePath.toLowerCase().endsWith('.json') ? r.filePath : `${r.filePath}.json`;
      const json = s.actions.exportJson();
      const tmp = path.join(path.dirname(target), `.orbis-part-${randomUUID()}`);
      await fsp.writeFile(tmp, json, { flag: 'wx' });
      await fsp.rename(tmp, target).catch(async (err) => {
        await fsp.unlink(tmp).catch(() => undefined);
        throw new OrbisError(toOrbisError(err, 'actions.export', target, 'no'));
      });
      return { path: target, count: s.actions.list().length };
    },
    'actions:import': async (_p, e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const opts = { title: 'Import custom actions', properties: ['openFile' as const], filters: [{ name: 'Orbis Files actions', extensions: ['json'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      const file = r.canceled ? undefined : r.filePaths[0];
      if (!file) return null;
      const st = await fsp.stat(file);
      if (st.size > 1024 * 1024) throw makeError('validation', 'actions.import', { message: 'The file is larger than 1 MB; action files are much smaller.' });
      const result = s.actions.importJson(await fsp.readFile(file, 'utf8'));
      s.log.info('actions.imported', { added: result.added.length, replaced: result.replaced.length, errors: result.errors.length });
      if (result.added.length || result.replaced.length) actionsChanged();
      return result;
    },

    // ------------------------------------------------------------------ Git
    'git:info': async (p) => (gitOff() ? { available: false, off: true, reason: 'Git status is switched off in Settings.' } : s.git.detect(!!p.recheck)),
    'git:status': (p) => (gitOff() ? { state: 'off' } : s.git.folderStatus(requireAbsolute(p.path, 'git.status'), { refresh: p.refresh })),
    'git:remoteUrl': async (p) => {
      if (gitOff()) throw makeError('unavailable', 'git.remoteUrl', { message: 'Git status is switched off in Settings.' });
      const r = await s.git.remoteUrl(requireAbsolute(p.path, 'git.remoteUrl'));
      if (!r) throw makeError('not_found', 'git.remoteUrl', { message: 'This repository has no remote.' });
      return r;
    },
  };
}
