import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError } from '../shared/errors';
import type { Snippet, SnippetExport } from '../shared/snippets';
import type { Services } from './services';

type Channels = 'snippet:list' | 'snippet:create' | 'snippet:update' | 'snippet:delete' | 'snippet:export' | 'snippet:import';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToSnippet(row: Record<string, unknown>): Snippet {
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    language: (row.language as string) || '',
    tags: row.tags ? JSON.parse(row.tags as string) as string[] : [],
    createdMs: row.created_ms as number,
    updatedMs: row.updated_ms as number,
  };
}

export function snippetHandlers(s: Services): Handlers {
  return {
    'snippet:list': () => {
      const rows = s.db.all<Record<string, unknown>>('SELECT * FROM snippets ORDER BY updated_ms DESC', []);
      return rows.map(rowToSnippet);
    },

    'snippet:create': (p) => {
      const id = randomUUID().replace(/-/g, '').slice(0, 16);
      const now = Date.now();
      s.db.run(
        'INSERT INTO snippets (id, title, content, language, tags, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, p.title, p.content, p.language ?? '', JSON.stringify(p.tags ?? []), now, now],
      );
      return rowToSnippet({ id, title: p.title, content: p.content, language: p.language ?? '', tags: JSON.stringify(p.tags ?? []), created_ms: now, updated_ms: now });
    },

    'snippet:update': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT * FROM snippets WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'snippet.update', { message: 'Snippet not found.' });
      const now = Date.now();
      const title = p.title ?? existing.title as string;
      const content = p.content ?? existing.content as string;
      const language = p.language ?? existing.language as string;
      const tags = p.tags ? JSON.stringify(p.tags) : (existing.tags as string);
      s.db.run(
        'UPDATE snippets SET title = ?, content = ?, language = ?, tags = ?, updated_ms = ? WHERE id = ?',
        [title, content, language, tags, now, p.id],
      );
      return rowToSnippet({ ...existing, title, content, language, tags, updated_ms: now });
    },

    'snippet:delete': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT id FROM snippets WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'snippet.delete', { message: 'Snippet not found.' });
      s.db.run('DELETE FROM snippets WHERE id = ?', [p.id]);
      return { deleted: true };
    },

    'snippet:export': () => {
      const rows = s.db.all<Record<string, unknown>>('SELECT * FROM snippets ORDER BY created_ms ASC', []);
      const result: SnippetExport = {
        version: 1,
        exportedMs: Date.now(),
        snippets: rows.map(rowToSnippet),
      };
      return result;
    },

    'snippet:import': (p) => {
      const data = p.data as SnippetExport;
      if (!data || data.version !== 1 || !Array.isArray(data.snippets)) {
        throw makeError('validation', 'snippet.import', { message: 'Invalid snippet export file.' });
      }
      let imported = 0;
      for (const snippet of data.snippets) {
        const existing = s.db.get<Record<string, unknown>>('SELECT id FROM snippets WHERE id = ?', [snippet.id]);
        if (existing) continue; // skip duplicates
        s.db.run(
          'INSERT INTO snippets (id, title, content, language, tags, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [snippet.id, snippet.title, snippet.content, snippet.language ?? '', JSON.stringify(snippet.tags ?? []), snippet.createdMs, snippet.updatedMs],
        );
        imported++;
      }
      return { imported, total: data.snippets.length };
    },
  };
}
