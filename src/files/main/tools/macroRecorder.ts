import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fsp from 'node:fs/promises';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import type { Macro } from '../../shared/macros';
import type { Services } from '../services';

type Channels = 'macro:list' | 'macro:create' | 'macro:update' | 'macro:delete' | 'macro:get' | 'macro:playback';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToMacro(row: Record<string, unknown>): Macro {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || '',
    steps: JSON.parse(row.steps as string) as Macro['steps'],
    createdMs: row.created_ms as number,
    updatedMs: row.updated_ms as number,
  };
}

export function macroHandlers(s: Services): Handlers {
  return {
    'macro:list': () => {
      const rows = s.db.all<Record<string, unknown>>('SELECT * FROM macros ORDER BY updated_ms DESC', []);
      return rows.map(rowToMacro);
    },

    'macro:create': (p) => {
      const id = randomUUID().replace(/-/g, '').slice(0, 16);
      const now = Date.now();
      s.db.run(
        'INSERT INTO macros (id, name, description, steps, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?)',
        [id, p.name, p.description ?? '', JSON.stringify(p.steps), now, now],
      );
      return rowToMacro({ id, name: p.name, description: p.description ?? '', steps: JSON.stringify(p.steps), created_ms: now, updated_ms: now });
    },

    'macro:update': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT * FROM macros WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'macro.update', { message: 'Macro not found.' });
      const now = Date.now();
      const name = p.name ?? existing.name as string;
      const description = p.description ?? existing.description as string;
      const steps = p.steps ? JSON.stringify(p.steps) : existing.steps as string;
      s.db.run(
        'UPDATE macros SET name = ?, description = ?, steps = ?, updated_ms = ? WHERE id = ?',
        [name, description, steps, now, p.id],
      );
      return rowToMacro({ ...existing, name, description, steps, updated_ms: now });
    },

    'macro:delete': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT id FROM macros WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'macro.delete', { message: 'Macro not found.' });
      s.db.run('DELETE FROM macros WHERE id = ?', [p.id]);
      return { deleted: true };
    },

    'macro:get': (p) => {
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM macros WHERE id = ?', [p.id]);
      if (!row) throw makeError('not_found', 'macro.get', { message: 'Macro not found.' });
      return rowToMacro(row);
    },

    'macro:playback': async (p) => {
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM macros WHERE id = ?', [p.id]);
      if (!row) throw makeError('not_found', 'macro.playback', { message: 'Macro not found.' });
      const macro = rowToMacro(row);
      const targetDir = p.targetDir;
      const results: Array<{ step: number; status: 'ok' | 'error'; detail?: string }> = [];

      for (let i = 0; i < macro.steps.length; i++) {
        const step = macro.steps[i]!;
        try {
          switch (step.type) {
            case 'copy': {
              const src = path.join(targetDir, step.sourceName);
              const dest = path.join(targetDir, step.destName ?? step.sourceName);
              const destDir = path.dirname(dest);
              await fsp.mkdir(destDir, { recursive: true });
              await fsp.copyFile(src, dest);
              break;
            }
            case 'move': {
              const src = path.join(targetDir, step.sourceName);
              const dest = path.join(targetDir, step.destName ?? step.sourceName);
              const destDir = path.dirname(dest);
              await fsp.mkdir(destDir, { recursive: true });
              await fsp.rename(src, dest);
              break;
            }
            case 'rename': {
              const src = path.join(targetDir, step.sourceName);
              const dest = path.join(path.dirname(src), step.destName ?? step.sourceName);
              await fsp.rename(src, dest);
              break;
            }
            case 'create': {
              const dest = path.join(targetDir, step.sourceName);
              const destDir = path.dirname(dest);
              await fsp.mkdir(destDir, { recursive: true });
              const content = step.template === 'json' ? '{}' : step.template === 'markdown' ? '# New Document\n' : '';
              await fsp.writeFile(dest, content, 'utf-8');
              break;
            }
          }
          results.push({ step: i, status: 'ok' });
        } catch (err) {
          results.push({ step: i, status: 'error', detail: err instanceof Error ? err.message : String(err) });
        }
      }
      return { results };
    },
  };
}
