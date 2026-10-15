import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError } from '../shared/errors';
import type { Services } from './services';
import type { SavedPlaylist } from '../shared/playlist';

/**
 * IPC handlers for saved playlists (named collections of paths stored in the
 * app database). Playlists are stored in the KV store of the catalogue, keyed
 * as "playlists.v1".
 */

type Channels = 'playlist:save' | 'playlist:list' | 'playlist:load' | 'playlist:delete';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>) => unknown };

const PLAYLISTS_KEY = 'playlists.v1';

interface StoredPlaylists {
  items: SavedPlaylist[];
}

function loadAll(s: Services): SavedPlaylist[] {
  const raw = s.catalog.getKv<StoredPlaylists | null>(PLAYLISTS_KEY, null);
  return raw?.items ?? [];
}

function saveAll(s: Services, items: SavedPlaylist[]): void {
  s.catalog.setKv(PLAYLISTS_KEY, { items } satisfies StoredPlaylists);
}

let idCounter = 0;
function newId(): string {
  idCounter++;
  return `pl-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function playlistHandlers(s: Services): Handlers {
  return {
    'playlist:save': (p) => {
      const all = loadAll(s);
      const now = Date.now();
      const existing = all.find((pl) => pl.name === p.name);
      if (existing) {
        existing.paths = p.paths;
        existing.updatedMs = now;
      } else {
        all.push({ id: newId(), name: p.name, paths: p.paths, createdMs: now, updatedMs: now });
      }
      saveAll(s, all);
      return { ok: true };
    },

    'playlist:list': () => {
      const all = loadAll(s);
      return all.map((pl) => ({ name: pl.name, count: pl.paths.length, createdMs: pl.createdMs, updatedMs: pl.updatedMs }));
    },

    'playlist:load': (p) => {
      const all = loadAll(s);
      const pl = all.find((x) => x.name === p.name);
      if (!pl) throw makeError('not_found', 'playlist.load', { message: `Playlist "${p.name}" was not found.` });
      return { name: pl.name, paths: pl.paths };
    },

    'playlist:delete': (p) => {
      const all = loadAll(s);
      const idx = all.findIndex((x) => x.name === p.name);
      if (idx < 0) throw makeError('not_found', 'playlist.delete', { message: `Playlist "${p.name}" was not found.` });
      all.splice(idx, 1);
      saveAll(s, all);
      return { ok: true };
    },
  };
}
