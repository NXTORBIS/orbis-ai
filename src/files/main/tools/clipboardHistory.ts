import { randomUUID } from 'node:crypto';
import { nativeImage } from 'electron';
import { clipFormats, clipImage, clipText, writeClipImage, writeClipText } from '../clip';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import type { ClipHistoryItem } from '../../shared/clipboardHistory';
import { CLIP_HISTORY_MAX } from '../../shared/clipboardHistory';
import type { Services } from '../services';

type Channels =
  | 'clipHistory:list'
  | 'clipHistory:capture'
  | 'clipHistory:recopy'
  | 'clipHistory:pin'
  | 'clipHistory:unpin'
  | 'clipHistory:remove'
  | 'clipHistory:clear';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

/** In-memory clipboard history. Pinned items also persist in the DB. */
const history: ClipHistoryItem[] = [];
let lastClipHash = '';

async function readClipboard(): Promise<{ text: string; img: Electron.NativeImage; formats: string[] }> {
  return { text: await clipText(), img: await clipImage(), formats: await clipFormats() };
}

function hashOf(text: string, hasImage: boolean): string {
  return `${text.length}:${hasImage}:${text.slice(0, 200)}`;
}

async function captureClipboard(): Promise<ClipHistoryItem | null> {
  const { text, img, formats } = await readClipboard();
  const hasImage = !img.isEmpty();
  const hash = hashOf(text, hasImage);
  if (hash === lastClipHash) return null;
  lastClipHash = hash;

  const hasFiles = formats.some((f) => f.includes('file') || f.includes('uri-list'));

  let item: ClipHistoryItem;
  const now = Date.now();
  const id = randomUUID().replace(/-/g, '').slice(0, 16);

  if (text && text.trim() && !hasFiles) {
    item = {
      id,
      kind: 'text',
      preview: text.slice(0, 200).split('\n')[0] || text.slice(0, 200),
      content: text,
      pinned: false,
      copiedMs: now,
    };
  } else if (hasImage && !text) {
    const jpeg = img.resize({ width: 128 }).toJPEG(60);
    item = {
      id,
      kind: 'image',
      preview: `Image ${img.getSize().width}x${img.getSize().height}`,
      thumbnail: jpeg.toString('base64'),
      pinned: false,
      copiedMs: now,
    };
  } else if (hasFiles || (text && text.trim() && (text.startsWith('/') || /^[A-Z]:\\/i.test(text)))) {
    const paths = text.split('\n').map((l) => l.trim()).filter(Boolean);
    item = {
      id,
      kind: 'files',
      preview: paths.length === 1 ? paths[0]! : `${paths.length} files`,
      paths,
      pinned: false,
      copiedMs: now,
    };
  } else if (text && text.trim()) {
    item = {
      id,
      kind: 'text',
      preview: text.slice(0, 200).split('\n')[0] || text.slice(0, 200),
      content: text,
      pinned: false,
      copiedMs: now,
    };
  } else {
    return null;
  }

  // Deduplicate: if the same content already exists, move it to the top
  const existingIdx = history.findIndex((h) =>
    h.kind === item.kind && h.preview === item.preview && h.content === item.content,
  );
  if (existingIdx >= 0) {
    const existing = history.splice(existingIdx, 1)[0]!;
    existing.copiedMs = now;
    history.unshift(existing);
    return existing;
  }

  history.unshift(item);
  // Trim non-pinned items
  const unpinned = history.filter((h) => !h.pinned);
  if (unpinned.length > CLIP_HISTORY_MAX) {
    const toRemove = unpinned.slice(CLIP_HISTORY_MAX);
    for (const r of toRemove) {
      const idx = history.indexOf(r);
      if (idx >= 0) history.splice(idx, 1);
    }
  }
  return item;
}

export function clipboardHistoryHandlers(s: Services): Handlers {
  // The clipboard is only watched once the user opens clipboard history, never at startup.
  let pollTimer: NodeJS.Timeout | undefined;
  const startWatching = (): void => {
    if (pollTimer) return;
    pollTimer = setInterval(() => void captureClipboard(), 2000);
    pollTimer.unref();
  };

  return {
    'clipHistory:list': () => {
      startWatching();
      return [...history];
    },

    'clipHistory:capture': async () => {
      startWatching();
      const item = await captureClipboard();
      return item ?? (history[0] || null);
    },

    'clipHistory:recopy': async (p) => {
      const item = history.find((h) => h.id === p.id);
      if (!item) throw makeError('not_found', 'clipHistory.recopy', { message: 'Item not found in history.' });
      if (item.kind === 'text' && item.content) {
        await writeClipText(item.content);
      } else if (item.kind === 'image' && item.thumbnail) {
        // Re-copy the thumbnail (the full image is gone from memory)
        const img = nativeImage.createFromBuffer(Buffer.from(item.thumbnail, 'base64'));
        await writeClipImage(img);
      } else if (item.kind === 'files' && item.paths) {
        await writeClipText(item.paths.join('\n'));
      }
      const now = await readClipboard();
      lastClipHash = hashOf(now.text, !now.img.isEmpty());
      return { ok: true };
    },

    'clipHistory:pin': (p) => {
      const item = history.find((h) => h.id === p.id);
      if (!item) throw makeError('not_found', 'clipHistory.pin', { message: 'Item not found.' });
      item.pinned = true;
      // Persist pin to DB
      s.db.run(
        'INSERT OR REPLACE INTO clip_history_pins (id, kind, preview, content, paths, thumbnail, copied_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [item.id, item.kind, item.preview, item.content ?? null, item.paths ? JSON.stringify(item.paths) : null, item.thumbnail ?? null, item.copiedMs],
      );
      return { ok: true };
    },

    'clipHistory:unpin': (p) => {
      const item = history.find((h) => h.id === p.id);
      if (!item) throw makeError('not_found', 'clipHistory.unpin', { message: 'Item not found.' });
      item.pinned = false;
      s.db.run('DELETE FROM clip_history_pins WHERE id = ?', [item.id]);
      return { ok: true };
    },

    'clipHistory:remove': (p) => {
      const idx = history.findIndex((h) => h.id === p.id);
      if (idx < 0) throw makeError('not_found', 'clipHistory.remove', { message: 'Item not found.' });
      const item = history[idx]!;
      history.splice(idx, 1);
      if (item.pinned) s.db.run('DELETE FROM clip_history_pins WHERE id = ?', [item.id]);
      return { ok: true };
    },

    'clipHistory:clear': () => {
      const pinned = history.filter((h) => h.pinned);
      history.length = 0;
      history.push(...pinned);
      return { ok: true, remaining: pinned.length };
    },
  };
}

/** Restore pinned items from DB on startup. */
export function restorePinnedClipItems(s: Services): void {
  try {
    const rows = s.db.all<Record<string, unknown>>('SELECT * FROM clip_history_pins ORDER BY copied_ms DESC', []);
    for (const row of rows) {
      history.push({
        id: row.id as string,
        kind: row.kind as ClipHistoryItem['kind'],
        preview: row.preview as string,
        content: (row.content as string) || undefined,
        paths: row.paths ? JSON.parse(row.paths as string) as string[] : undefined,
        thumbnail: (row.thumbnail as string) || undefined,
        pinned: true,
        copiedMs: row.copied_ms as number,
      });
    }
  } catch {
    // Table may not exist yet
  }
}
