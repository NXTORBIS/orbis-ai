import { z } from 'zod';

/**
 * The music player's queue model, shared by the window (which plays) and the
 * main process (which stores it per profile). Pure functions only: every
 * change returns a new state, so they are easy to test and to persist.
 */

/** Extensions the built-in player (Chromium, through orbis-media://) can play. */
export const PLAYABLE_AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac']);
/** Other audio files: collected into the queue but shown with an honest "not supported" error and skipped. */
export const OTHER_AUDIO = new Set(['aif', 'aiff', 'wma', 'ape', 'mka', 'ac3', 'wv', 'dsf', 'alac', 'amr']);
export const PLAYLIST_EXTS = new Set(['m3u', 'm3u8', 'pls']);

/** Most items in the queue. */
export const QUEUE_LIMIT = 5000;
/** Most files added from folders in one go (the rest is left out with a notice). */
export const FOLDER_ADD_LIMIT = 2000;
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const extOf = (p: string): string => {
  const name = p.split(/[\\/]/).pop() ?? '';
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};
export const isAudioPath = (p: string): boolean => PLAYABLE_AUDIO.has(extOf(p)) || OTHER_AUDIO.has(extOf(p));
export const isPlaylistPath = (p: string): boolean => PLAYLIST_EXTS.has(extOf(p));

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueItem {
  id: string;
  path: string;
  /** From the playlist (#EXTINF) or the file's tags; the file name is shown when absent. */
  title?: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  /** The file is not there (deleted, moved, or listed by a playlist but absent). */
  missing?: boolean;
  /** Why this item cannot be played (unsupported format or codec, unreadable…). Set when it failed. */
  error?: string;
}

export interface PlayerState {
  items: QueueItem[];
  currentId?: string;
  shuffle: boolean;
  /** Play order of item ids while shuffle is on (a permutation of the items). */
  order: string[];
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  rate: number;
  /** Position in the current item, seconds (restored after a restart). */
  positionSec: number;
}

export const EMPTY_PLAYER: PlayerState = { items: [], shuffle: false, order: [], repeat: 'off', volume: 0.8, muted: false, rate: 1, positionSec: 0 };

const pathStr = z.string().min(1).max(32767).refine((s) => !s.includes('\0'));
const text = z.string().max(1000).optional();

export const QueueItemSchema = z.object({
  id: z.string().min(1).max(64),
  path: pathStr,
  title: text,
  artist: text,
  album: text,
  durationSec: z.number().finite().nonnegative().max(1e7).optional(),
  missing: z.boolean().optional(),
  error: z.string().max(500).optional(),
});

/** What is stored per profile (and accepted over IPC): bounded, every field checked. */
export const PlayerStateSchema = z.object({
  items: z.array(QueueItemSchema).max(QUEUE_LIMIT),
  currentId: z.string().max(64).optional(),
  shuffle: z.boolean(),
  order: z.array(z.string().max(64)).max(QUEUE_LIMIT),
  repeat: z.enum(['off', 'all', 'one']),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  rate: z.number().min(0.25).max(4),
  positionSec: z.number().finite().nonnegative().max(1e7),
});

let counter = 0;
export function newItemId(): string {
  counter = (counter + 1) % 1e6;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Items for paths (titles etc. optional). */
export function makeItems(entries: Array<{ path: string; title?: string; durationSec?: number; missing?: boolean; error?: string }>): QueueItem[] {
  return entries.map((e) => ({ id: newItemId(), path: e.path, ...(e.title ? { title: e.title } : {}), ...(e.durationSec !== undefined ? { durationSec: e.durationSec } : {}), ...(e.missing ? { missing: true } : {}), ...(e.error ? { error: e.error } : {}) }));
}

/** Ids in the order they play. */
export function playOrder(s: PlayerState): string[] {
  if (!s.shuffle) return s.items.map((i) => i.id);
  const ids = new Set(s.items.map((i) => i.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of s.order) if (ids.has(id) && !seen.has(id)) {
    out.push(id);
    seen.add(id);
  }
  for (const i of s.items) if (!seen.has(i.id)) out.push(i.id);
  return out;
}

/** Fisher–Yates shuffle with the current item first (so turning shuffle on never interrupts the song). */
export function shuffledOrder(ids: string[], firstId: string | undefined, rand: () => number = Math.random): string[] {
  const rest = ids.filter((id) => id !== firstId);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return firstId && ids.includes(firstId) ? [firstId, ...rest] : rest;
}

export function setShuffle(s: PlayerState, on: boolean, rand: () => number = Math.random): PlayerState {
  return { ...s, shuffle: on, order: on ? shuffledOrder(s.items.map((i) => i.id), s.currentId, rand) : [] };
}

export const nextRepeat = (r: RepeatMode): RepeatMode => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off');

/**
 * The item after the current one. `auto` means the current one ended by
 * itself (repeat one plays it again); Next pressed by the user always moves on.
 * Items `skip` rejects (missing, failed) are passed over. Repeat all wraps.
 */
export function nextId(s: PlayerState, opts: { auto?: boolean; skip?: (it: QueueItem) => boolean } = {}): string | undefined {
  const order = playOrder(s);
  if (!order.length) return undefined;
  const byId = new Map(s.items.map((i) => [i.id, i]));
  const ok = (id: string) => !opts.skip?.(byId.get(id)!);
  if (opts.auto && s.repeat === 'one' && s.currentId && byId.has(s.currentId) && ok(s.currentId)) return s.currentId;
  const at = s.currentId ? order.indexOf(s.currentId) : -1;
  for (let k = 1; k <= order.length; k++) {
    const i = at + k;
    // Past the end: only repeat all starts over (the current item itself comes last, when it is the only playable one).
    if (i >= order.length && s.repeat !== 'all') return undefined;
    const id = order[i % order.length]!;
    if (ok(id)) return id;
  }
  return undefined;
}

/** The item before the current one (wraps only with repeat all). */
export function prevId(s: PlayerState, opts: { skip?: (it: QueueItem) => boolean } = {}): string | undefined {
  const order = playOrder(s);
  if (!order.length) return undefined;
  const byId = new Map(s.items.map((i) => [i.id, i]));
  const at = s.currentId ? order.indexOf(s.currentId) : 0;
  for (let k = 1; k < order.length; k++) {
    const i = at - k;
    if (i < 0 && s.repeat !== 'all') return undefined;
    const id = order[(i + order.length) % order.length]!;
    if (!opts.skip?.(byId.get(id)!)) return id;
  }
  return undefined;
}

/** Room left in the queue. */
export const roomLeft = (s: PlayerState): number => Math.max(0, QUEUE_LIMIT - s.items.length);

/** Add items at the end (in shuffle mode they are spread randomly over what is still to come). */
export function appendItems(s: PlayerState, items: QueueItem[], rand: () => number = Math.random): PlayerState {
  const add = items.slice(0, roomLeft(s));
  const next: PlayerState = { ...s, items: [...s.items, ...add] };
  if (s.shuffle) {
    const order = playOrder(s);
    const from = s.currentId ? order.indexOf(s.currentId) + 1 : 0;
    for (const it of add) {
      const at = from + Math.floor(rand() * (order.length - from + 1));
      order.splice(at, 0, it.id);
    }
    next.order = order;
  }
  return next;
}

/** Insert items right after the current one, in queue order and in shuffle order ("Play next"). */
export function insertNext(s: PlayerState, items: QueueItem[]): PlayerState {
  const add = items.slice(0, roomLeft(s));
  const at = s.currentId ? s.items.findIndex((i) => i.id === s.currentId) + 1 : 0;
  const list = [...s.items];
  list.splice(at, 0, ...add);
  const next: PlayerState = { ...s, items: list };
  if (s.shuffle) {
    const order = playOrder(s);
    const o = s.currentId ? order.indexOf(s.currentId) + 1 : 0;
    order.splice(o, 0, ...add.map((i) => i.id));
    next.order = order;
  }
  return next;
}

/** Replace the queue ("Play"): the first item becomes current. */
export function replaceQueue(s: PlayerState, items: QueueItem[], rand: () => number = Math.random): PlayerState {
  const list = items.slice(0, QUEUE_LIMIT);
  const first = list[0]?.id;
  const next: PlayerState = { ...s, items: list, currentId: first, positionSec: 0, order: [] };
  return s.shuffle ? { ...next, order: shuffledOrder(list.map((i) => i.id), first, rand) } : next;
}

/** Move one item to a new index in the queue (drag and drop, Alt+Up/Down). */
export function moveItem(s: PlayerState, id: string, toIndex: number): PlayerState {
  const from = s.items.findIndex((i) => i.id === id);
  if (from < 0) return s;
  const list = [...s.items];
  const [it] = list.splice(from, 1);
  const to = Math.max(0, Math.min(list.length, toIndex));
  list.splice(to, 0, it!);
  return { ...s, items: list };
}

/** Remove items. When the current one goes, the next one in play order becomes current (not playing by itself). */
export function removeItems(s: PlayerState, ids: string[]): PlayerState {
  const gone = new Set(ids);
  let currentId = s.currentId;
  let positionSec = s.positionSec;
  if (currentId && gone.has(currentId)) {
    const order = playOrder(s);
    const at = order.indexOf(currentId);
    currentId = order.slice(at + 1).find((id) => !gone.has(id)) ?? order.slice(0, at).reverse().find((id) => !gone.has(id));
    positionSec = 0;
  }
  return { ...s, items: s.items.filter((i) => !gone.has(i.id)), order: s.order.filter((id) => !gone.has(id)), currentId, positionSec };
}

export function clearQueue(s: PlayerState): PlayerState {
  return { ...s, items: [], order: [], currentId: undefined, positionSec: 0 };
}

export function updateItem(s: PlayerState, id: string, patch: Partial<Omit<QueueItem, 'id'>>): PlayerState {
  let changed = false;
  const items = s.items.map((i) => {
    if (i.id !== id) return i;
    changed = true;
    const n = { ...i, ...patch };
    for (const k of Object.keys(n) as Array<keyof QueueItem>) if (n[k] === undefined) delete n[k];
    return n;
  });
  return changed ? { ...s, items } : s;
}

/** Display title: tags or playlist title, else the file name without its extension. */
export function itemTitle(it: Pick<QueueItem, 'title' | 'path'>): string {
  if (it.title?.trim()) return it.title.trim();
  const name = it.path.split(/[\\/]/).pop() ?? it.path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** "3:07" / "1:02:03" for a duration in seconds. */
export function formatClock(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec) || sec < 0) return '–:––';
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Natural, case-insensitive name order ("Track 2" before "Track 10"), used for folders added to the queue. */
export const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
