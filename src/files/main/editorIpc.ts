import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { requireAbsolute } from './fs/paths';
import { diffWithDisk, openForEditing, saveAsNew, saveCopy, saveEdited, stampOf, type EditorDeps } from './tools/textEditor';
import type { Services } from './services';

/**
 * IPC handlers for the built-in text editor. Payloads were validated by the
 * shared zod schemas before these run (ipcHandlers.ts); paths are checked to
 * be absolute here. Every write snapshots the version it replaces.
 */

type Channels = 'editor:open' | 'editor:stat' | 'editor:save' | 'editor:saveAs' | 'editor:saveCopy' | 'editor:diff';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export function editorHandlers(s: Services): Handlers {
  const deps: EditorDeps = {
    snapshot: (p) => s.snapshots.create(p),
    onChanged: (p) => {
      s.metadata.invalidate(p);
      s.indexer.touch([p]);
    },
  };
  return {
    'editor:open': (p) => openForEditing(requireAbsolute(p.path, 'editor.open'), { encoding: p.encoding }),
    'editor:stat': (p) => stampOf(requireAbsolute(p.path, 'editor.stat')),
    'editor:save': async (p) => {
      const r = await saveEdited({ ...p, path: requireAbsolute(p.path, 'editor.save') }, deps);
      s.log.info('editor.save', { status: r.status, encoding: p.encoding, eol: p.eol, snapshot: r.status === 'saved' ? !!r.snapshotId : undefined });
      return r;
    },
    'editor:saveAs': async (p) => {
      const r = await saveAsNew({ ...p, dir: requireAbsolute(p.dir, 'editor.saveAs') }, deps);
      s.log.info('editor.saveAs', { status: r.status, replaced: !!p.replace });
      return r;
    },
    'editor:saveCopy': (p) => saveCopy({ ...p, path: requireAbsolute(p.path, 'editor.saveCopy') }, deps),
    'editor:diff': (p) => diffWithDisk(requireAbsolute(p.path, 'editor.diff'), p.text),
  };
}
