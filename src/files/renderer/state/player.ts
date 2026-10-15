import { createStore } from './store';
import { call } from '../api';
import { confirm, openDialog, toast, toastError } from './app';
import {
  appendItems, clearQueue, EMPTY_PLAYER, FOLDER_ADD_LIMIT, insertNext, isPlaylistPath, itemTitle, makeItems, moveItem as moveQ, nextId, nextRepeat, playOrder, prevId,
  removeItems as removeQ, replaceQueue, roomLeft, setShuffle, updateItem, type PlayerState, type QueueItem, type RepeatMode,
} from '../../shared/player';

/**
 * The music player. One HTMLAudioElement, owned here and outside React, plays
 * files through the read-only orbis-media:// protocol (the same one the
 * previews use; nothing new is opened up). The queue, position and settings
 * are stored per profile in the main process (player:save) and restored at
 * start; the window never starts playing by itself after a restart.
 * Media keys and the desktop's media controls work through navigator.mediaSession.
 */

export interface PlayerUi {
  loaded: boolean;
  state: PlayerState;
  playing: boolean;
  /** Seconds into the current item and its length as the audio element reports them. */
  time: number;
  duration: number;
  /** The queue list is open under the bar. */
  queueOpen: boolean;
  /** The bar was closed by the user (it comes back when something is played). */
  hidden: boolean;
  /** Embedded cover of the current item (data: URL), null when it has none. */
  cover: string | null;
  /** Polite announcement for screen readers (track changes, skips). */
  announce: string;
}

export const player = createStore<PlayerUi>({ loaded: false, state: EMPTY_PLAYER, playing: false, time: 0, duration: 0, queueOpen: false, hidden: false, cover: null, announce: '' });

const mediaUrl = (p: string) => `orbis-media://f/${encodeURIComponent(p)}`;
let audio: HTMLAudioElement | undefined;
/** Id of the item whose file is loaded in the audio element. */
let loadedId: string | undefined;
/** Position to seek to once the restored item's metadata has loaded. */
let pendingSeek: number | undefined;

export const currentItem = (s: PlayerState = player.get().state): QueueItem | undefined => s.items.find((i) => i.id === s.currentId);
const unplayable = (it: QueueItem) => !!it.missing || !!it.error;

/* ------------------------------------------------------------------ persistence */

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastPositionSave = 0;

function persistNow(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const st = { ...player.get().state, positionSec: Math.max(0, Math.round((audio && loadedId === player.get().state.currentId ? audio.currentTime : player.get().state.positionSec) * 1000) / 1000) };
  void call('player:save', { state: st }).catch(() => undefined);
}

function persistSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 400);
}

function setState(next: PlayerState, opts: { persist?: boolean } = {}): void {
  player.set({ state: next });
  if (opts.persist !== false) persistSoon();
}

const HIDDEN_KEY = 'orbis.player.hidden';
function rememberHidden(v: boolean): void {
  try {
    localStorage.setItem(HIDDEN_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable: the bar simply shows again next time */
  }
}

/* ------------------------------------------------------------------ the audio element */

function el(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'auto';
  audio = a;
  a.addEventListener('timeupdate', () => {
    player.set({ time: a.currentTime });
    if (a.currentTime > 0 && Date.now() - lastPositionSave > 5000) {
      lastPositionSave = Date.now();
      setState({ ...player.get().state, positionSec: a.currentTime });
    }
    updatePositionState();
  });
  a.addEventListener('durationchange', () => {
    const d = Number.isFinite(a.duration) ? a.duration : 0;
    player.set({ duration: d });
    const it = currentItem();
    if (it && d > 0 && !it.durationSec) setState(updateItem(player.get().state, it.id, { durationSec: d }));
  });
  a.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== undefined) {
      const t = Math.min(pendingSeek, Math.max(0, (a.duration || 0) - 0.5));
      pendingSeek = undefined;
      if (t > 0) a.currentTime = t;
    }
  });
  a.addEventListener('play', () => {
    player.set({ playing: true });
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
  });
  a.addEventListener('pause', () => {
    player.set({ playing: false });
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
    persistNow();
  });
  a.addEventListener('ended', () => void advance(true));
  a.addEventListener('error', () => void onMediaError());
  return a;
}

const MEDIA_ERR: Record<number, string> = {
  1: 'Playback was stopped.',
  2: 'The file could not be read.',
  3: 'The audio could not be decoded (the file may be damaged).',
  4: 'This format or codec is not supported by the built-in player.',
};

/** The load whose failure was already handled (the element can report one failure more than once). */
let failedLoad: string | undefined;

async function onMediaError(): Promise<void> {
  const a = el();
  const it = currentItem();
  if (!it || !a.getAttribute('src') || loadedId !== it.id || failedLoad === loadToken) return;
  failedLoad = loadToken;
  const code = a.error?.code ?? 4;
  // Tell a deleted or moved file from one that cannot be decoded.
  type Check = { missing: boolean; error?: string };
  const [chk] = await call<Check[]>('player:check', { paths: [it.path] }).catch((): Check[] => [{ missing: false }]);
  const reason = chk?.missing ? undefined : chk?.error ?? MEDIA_ERR[code] ?? 'The file could not be played.';
  setState(updateItem(player.get().state, it.id, chk?.missing ? { missing: true, error: undefined } : { error: reason }));
  const title = itemTitle(it);
  toast({ level: 'warning', title: chk?.missing ? `“${title}” is missing` : `Cannot play “${title}”`, detail: chk?.missing ? 'The file was deleted or moved. It stays in the queue, marked as missing.' : `${reason} Skipping to the next item.` });
  player.set({ announce: chk?.missing ? `${title} is missing, skipped.` : `${title} cannot be played, skipped.` });
  await advance(true, { afterError: true });
}

/** Changes with every load, so a late failure of an earlier load is never applied to a newer one. */
let loadToken = '';

function load(it: QueueItem, startAt = 0): void {
  const a = el();
  loadedId = it.id;
  loadToken = `${it.id}:${Date.now()}:${Math.random()}`;
  pendingSeek = startAt > 0 ? startAt : undefined;
  a.src = mediaUrl(it.path);
  a.playbackRate = player.get().state.rate;
  a.volume = player.get().state.volume;
  a.muted = player.get().state.muted;
  player.set({ time: startAt, duration: it.durationSec ?? 0, cover: null });
  void loadDetails(it);
}

function unload(): void {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  loadedId = undefined;
  player.set({ playing: false, time: 0, duration: 0, cover: null });
  if (navigator.mediaSession) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }
}

/* ------------------------------------------------------------------ tags, cover, media session */

const coverCache = new Map<string, string | null>();

async function loadDetails(it: QueueItem): Promise<void> {
  void fillTags([it]);
  let cover = coverCache.get(it.path);
  if (cover === undefined) {
    cover = await call<string | null>('player:cover', { path: it.path }).catch(() => null);
    coverCache.set(it.path, cover);
    if (coverCache.size > 30) coverCache.delete(coverCache.keys().next().value!);
  }
  if (player.get().state.currentId === it.id) {
    player.set({ cover });
    updateMediaSession();
  }
}

function updateMediaSession(): void {
  const ms = navigator.mediaSession;
  const it = currentItem();
  if (!ms || !it || typeof MediaMetadata === 'undefined') return;
  const cover = player.get().cover;
  ms.metadata = new MediaMetadata({ title: itemTitle(it), artist: it.artist ?? '', album: it.album ?? '', artwork: cover ? [{ src: cover, sizes: '512x512' }] : [] });
}

function updatePositionState(): void {
  const ms = navigator.mediaSession;
  const a = audio;
  if (!ms?.setPositionState || !a || !Number.isFinite(a.duration) || a.duration <= 0) return;
  try {
    ms.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate || 1 });
  } catch {
    /* inconsistent values while seeking */
  }
}

function installMediaSession(): void {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* action not supported here */
    }
  };
  set('play', () => void play());
  set('pause', () => pause());
  set('stop', () => pause());
  set('nexttrack', () => void next());
  set('previoustrack', () => void previous());
  set('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime));
  set('seekbackward', (d) => seek(player.get().time - (d.seekOffset ?? 10)));
  set('seekforward', (d) => seek(player.get().time + (d.seekOffset ?? 10)));
}

/** Tags and durations from the metadata reader for items that do not have them yet. */
async function fillTags(items: QueueItem[]): Promise<void> {
  const want = items.filter((i) => !i.missing && (!i.artist || !i.durationSec));
  for (let i = 0; i < want.length; i += 200) {
    const batch = want.slice(i, i + 200);
    const tags = await call<Record<string, { title?: string; artist?: string; album?: string; durationSec?: number }>>('player:tags', { paths: batch.map((b) => b.path) }).catch(() => ({}) as Record<string, never>);
    let s = player.get().state;
    for (const it of batch) {
      const t = tags[it.path];
      if (!t) continue;
      s = updateItem(s, it.id, { title: t.title ?? it.title, artist: t.artist ?? it.artist, album: t.album ?? it.album, durationSec: it.durationSec ?? t.durationSec });
    }
    setState(s);
    if (batch.some((b) => b.id === player.get().state.currentId)) updateMediaSession();
  }
}

/* ------------------------------------------------------------------ boot */

export async function startPlayer(): Promise<void> {
  installMediaSession();
  let hidden = false;
  try {
    hidden = localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    /* default: shown */
  }
  const state = await call<PlayerState>('player:load').catch(() => EMPTY_PLAYER);
  player.set({ state, loaded: true, hidden });
  window.addEventListener('beforeunload', () => persistNow());
  if (!state.items.length) return;
  await recheck();
  const it = currentItem();
  if (it && !unplayable(it)) load(it, state.positionSec);
}

/** Mark items whose files are gone (or came back). */
export async function recheck(): Promise<void> {
  const s = player.get().state;
  if (!s.items.length) return;
  const res = await call<Array<{ path: string; missing: boolean; error?: string }>>('player:check', { paths: s.items.map((i) => i.path) }).catch(() => undefined);
  if (!res) return;
  let next = player.get().state;
  res.forEach((r, i) => {
    const it = s.items[i];
    if (!it) return;
    if (r.missing && !it.missing) next = updateItem(next, it.id, { missing: true });
    else if (!r.missing && it.missing) next = updateItem(next, it.id, { missing: undefined, error: r.error });
    else if (!r.missing && r.error && !it.error) next = updateItem(next, it.id, { error: r.error });
  });
  if (next !== player.get().state) setState(next);
}

/* ------------------------------------------------------------------ adding */

export type AddMode = 'play' | 'next' | 'queue';

/**
 * Files, folders (recursively, natural order, capped) and playlists into the
 * queue. Playlists keep their missing entries (shown as missing).
 */
export async function addPaths(paths: string[], mode: AddMode): Promise<void> {
  const lists = paths.filter(isPlaylistPath);
  const rest = paths.filter((p) => !isPlaylistPath(p));
  const entries: Array<{ path: string; title?: string; durationSec?: number; missing?: boolean; error?: string }> = [];
  const notes: string[] = [];
  try {
    if (rest.length) {
      const room = Math.max(1, Math.min(FOLDER_ADD_LIMIT, mode === 'play' ? FOLDER_ADD_LIMIT : roomLeft(player.get().state)));
      const r = await call<{ files: string[]; truncated: boolean; links: number; unreadable: number }>('player:collect', { paths: rest.slice(0, 10000), limit: room });
      entries.push(...r.files.map((p) => ({ path: p })));
      if (r.truncated) notes.push(`Only the first ${r.files.length.toLocaleString()} audio files were added (the limit is ${room.toLocaleString()} at a time).`);
      if (r.links) notes.push(`${r.links} linked item${r.links === 1 ? ' was' : 's were'} not followed.`);
      if (r.unreadable) notes.push(`${r.unreadable} folder${r.unreadable === 1 ? '' : 's'} could not be read.`);
    }
    for (const l of lists) {
      const r = await call<{ name: string; entries: typeof entries; truncated: boolean }>('player:openPlaylist', { path: l });
      entries.push(...r.entries);
      const missing = r.entries.filter((e) => e.missing).length;
      if (missing) notes.push(`${missing} of ${r.entries.length} entries in ${r.name} are missing; they are shown as missing.`);
      if (r.truncated) notes.push(`${r.name} has more entries than the queue can hold.`);
    }
  } catch (err) {
    toastError(err, 'Nothing was added to the queue');
    return;
  }
  if (!entries.length) {
    toast({ level: 'info', title: 'No audio files here', detail: 'Select audio files, folders that contain them, or a playlist (.m3u, .m3u8, .pls).' });
    return;
  }
  const items = makeItems(entries);
  let s = player.get().state;
  const before = s.items.length;
  if (mode === 'play') s = replaceQueue(s, items);
  else if (mode === 'next') s = insertNext(s, items);
  else s = appendItems(s, items);
  const added = mode === 'play' ? s.items.length : s.items.length - before;
  if (added < items.length) notes.push(`The queue is full (${s.items.length.toLocaleString()} items); ${(items.length - added).toLocaleString()} were not added.`);
  const wasEmpty = !player.get().state.currentId;
  if (!s.currentId && s.items.length) s = { ...s, currentId: s.items[0]!.id, positionSec: 0 };
  setState(s);
  player.set({ hidden: false });
  rememberHidden(false);
  void fillTags(items);
  if (mode === 'play') await playId(s.currentId!);
  else if (wasEmpty || (!player.get().playing && !loadedId)) await playId(s.currentId!, { start: false });
  if (mode !== 'play') toast({ level: 'success', title: mode === 'next' ? `Playing next: ${added === 1 ? itemTitle(items[0]!) : `${added} items`}` : `Added ${added === 1 ? `“${itemTitle(items[0]!)}”` : `${added.toLocaleString()} items`} to the queue`, detail: notes.join(' ') || undefined });
  else if (notes.length) toast({ level: 'info', title: `Playing ${added.toLocaleString()} item${added === 1 ? '' : 's'}`, detail: notes.join(' ') });
}

/* ------------------------------------------------------------------ transport */

/** Load an item and (unless `start` is false) play it. Unplayable items are passed over. */
export async function playId(id: string, opts: { start?: boolean; from?: number } = {}): Promise<void> {
  let s = player.get().state;
  let it = s.items.find((i) => i.id === id);
  if (!it) return;
  if (unplayable(it)) {
    // An item chosen explicitly is checked again (the file may be back).
    type Check = { missing: boolean; error?: string };
    const [chk] = await call<Check[]>('player:check', { paths: [it.path] }).catch((): Check[] => [{ missing: true }]);
    if (chk && !chk.missing && !chk.error) {
      setState(updateItem(s, it.id, { missing: undefined, error: undefined }));
      s = player.get().state;
      it = s.items.find((i) => i.id === id)!;
    } else {
      toast({ level: 'warning', title: `Cannot play “${itemTitle(it)}”`, detail: chk?.missing ? 'The file is missing (deleted or moved).' : chk?.error ?? it.error });
      return;
    }
  }
  setState({ ...s, currentId: id, positionSec: opts.from ?? 0 });
  load(it, opts.from ?? 0);
  updateMediaSession();
  player.set({ announce: `Now playing: ${itemTitle(it)}${it.artist ? ` by ${it.artist}` : ''}` });
  if (opts.start !== false) await play();
}

export async function play(): Promise<void> {
  const it = currentItem();
  if (!it) {
    const first = playOrder(player.get().state).find((id) => !unplayable(player.get().state.items.find((i) => i.id === id)!));
    if (first) await playId(first);
    return;
  }
  if (loadedId !== it.id) load(it, player.get().state.positionSec);
  try {
    await el().play();
  } catch {
    // AbortError comes from a newer load replacing this one; real failures arrive as the element's 'error' event.
  }
}

export function pause(): void {
  audio?.pause();
}

export function togglePlay(): void {
  if (player.get().playing) pause();
  else void play();
}

async function advance(auto: boolean, opts: { afterError?: boolean } = {}): Promise<void> {
  const s = player.get().state;
  const id = nextId(s, { auto: auto && !opts.afterError, skip: unplayable });
  if (!id) {
    // End of the queue: stop at the start of the last item, ready to play again.
    pause();
    if (audio && !opts.afterError) audio.currentTime = 0;
    player.set({ announce: 'End of the queue.' });
    return;
  }
  if (id === s.currentId && audio) {
    audio.currentTime = 0;
    await play();
    return;
  }
  await playId(id, { start: true });
}

export async function next(): Promise<void> {
  await advance(false);
}

/** Previous: back to the start when more than 3 s have played, else the item before. */
export async function previous(): Promise<void> {
  if (player.get().time > 3 && audio) {
    seek(0);
    return;
  }
  const id = prevId(player.get().state, { skip: unplayable });
  if (id) await playId(id);
  else seek(0);
}

export function seek(t: number): void {
  const a = el();
  const d = Number.isFinite(a.duration) ? a.duration : player.get().duration;
  const to = Math.max(0, Math.min(d || 0, t));
  if (!loadedId) {
    const it = currentItem();
    if (it) load(it, to);
    return;
  }
  a.currentTime = to;
  player.set({ time: to });
  updatePositionState();
}

export function setVolume(v: number): void {
  const vol = Math.max(0, Math.min(1, v));
  if (audio) {
    audio.volume = vol;
    if (vol > 0 && audio.muted) audio.muted = false;
  }
  setState({ ...player.get().state, volume: vol, muted: vol > 0 ? false : player.get().state.muted });
}

export function toggleMute(): void {
  const m = !player.get().state.muted;
  if (audio) audio.muted = m;
  setState({ ...player.get().state, muted: m });
}

export function setRate(r: number): void {
  if (audio) audio.playbackRate = r;
  setState({ ...player.get().state, rate: r });
  updatePositionState();
}

export function toggleShuffle(): void {
  const s = setShuffle(player.get().state, !player.get().state.shuffle);
  setState(s);
  player.set({ announce: s.shuffle ? 'Shuffle on' : 'Shuffle off' });
}

export function cycleRepeat(): void {
  const r: RepeatMode = nextRepeat(player.get().state.repeat);
  setState({ ...player.get().state, repeat: r });
  player.set({ announce: r === 'off' ? 'Repeat off' : r === 'all' ? 'Repeat all' : 'Repeat one' });
}

/* ------------------------------------------------------------------ queue editing */

export function moveItem(id: string, toIndex: number): void {
  setState(moveQ(player.get().state, id, toIndex));
}

export function removeItems(ids: string[]): void {
  const before = player.get().state;
  const after = removeQ(before, ids);
  setState(after);
  if (before.currentId && before.currentId !== after.currentId) {
    const wasPlaying = player.get().playing;
    unload();
    const it = currentItem(after);
    if (it && !unplayable(it)) void playId(it.id, { start: wasPlaying });
  }
  if (!after.items.length) unload();
}

export async function clear(): Promise<void> {
  const n = player.get().state.items.length;
  if (n > 20 && !(await confirm({ title: 'Clear the queue?', body: `All ${n.toLocaleString()} items are removed from the queue. No files are changed.`, confirmLabel: 'Clear queue', destructive: true }))) return;
  unload();
  setState(clearQueue(player.get().state));
  player.set({ queueOpen: false });
}

/** Stop and hide the bar; the queue is kept and comes back with “Show music player” or when something is played. */
export function closePlayer(): void {
  pause();
  persistNow();
  player.set({ hidden: true, queueOpen: false });
  rememberHidden(true);
}

export function showPlayer(): void {
  player.set({ hidden: false });
  rememberHidden(false);
}

export function toggleQueue(open = !player.get().queueOpen): void {
  player.set({ queueOpen: open, hidden: false });
  if (open) void recheck();
}

export function savePlaylistDialog(defaultDir?: string): void {
  openDialog('playerSavePlaylist', { dir: defaultDir });
}

/* ------------------------------------------------------------------ saved playlists (DB-backed) */

/** Prompt for a name and save the current queue as a named playlist. */
export async function saveNamedPlaylistDialog(): Promise<void> {
  const s = player.get().state;
  if (!s.items.length) { toast({ level: 'info', title: 'The queue is empty.' }); return; }
  const name = await import('./app').then((m) => m.prompt({
    title: 'Save playlist',
    label: 'Playlist name',
    initial: '',
    confirmLabel: 'Save',
    validate: async (v) => (v.trim().length > 0 && v.trim().length <= 128 ? undefined : 'Enter a name (1–128 characters).'),
  }));
  if (!name) return;
  try {
    await call('playlist:save', { name: name.trim(), paths: s.items.map((i) => i.path) });
    toast({ level: 'success', title: `Playlist "${name.trim()}" saved (${s.items.length} items).` });
  } catch (err) {
    toastError(err, 'Could not save the playlist');
  }
}

/** Prompt the user to pick a saved playlist and load it into the queue. */
export async function loadPlaylistDialog(): Promise<void> {
  try {
    const list = await call<Array<{ name: string; count: number }>>('playlist:list');
    if (!list.length) { toast({ level: 'info', title: 'No saved playlists.' }); return; }
    const names = list.map((p) => p.name);
    const pick = await import('./app').then((m) => m.prompt({
      title: 'Load playlist',
      label: `Choose a playlist: ${names.join(', ')}`,
      initial: names[0] ?? '',
      confirmLabel: 'Load',
      validate: async (v) => (names.includes(v.trim()) ? undefined : 'Enter one of the playlist names listed above.'),
    }));
    if (!pick) return;
    const data = await call<{ name: string; paths: string[] }>('playlist:load', { name: pick.trim() });
    await addPaths(data.paths, 'play');
    toast({ level: 'success', title: `Loaded "${data.name}" (${data.paths.length} items).` });
  } catch (err) {
    toastError(err, 'Could not load the playlist');
  }
}

/** Prompt for a playlist name and delete it. */
export async function deletePlaylistDialog(): Promise<void> {
  try {
    const list = await call<Array<{ name: string; count: number }>>('playlist:list');
    if (!list.length) { toast({ level: 'info', title: 'No saved playlists.' }); return; }
    const names = list.map((p) => p.name);
    const pick = await import('./app').then((m) => m.prompt({
      title: 'Delete playlist',
      label: `Delete which playlist? ${names.join(', ')}`,
      initial: '',
      confirmLabel: 'Delete',
      validate: async (v) => (names.includes(v.trim()) ? undefined : 'Enter one of the playlist names listed above.'),
    }));
    if (!pick) return;
    const yes = await confirm({ title: `Delete "${pick.trim()}"?`, body: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true });
    if (!yes) return;
    await call('playlist:delete', { name: pick.trim() });
    toast({ level: 'success', title: `Playlist "${pick.trim()}" deleted.` });
  } catch (err) {
    toastError(err, 'Could not delete the playlist');
  }
}

/** The live audio element (the e2e run reads currentTime from it). */
export function audioElement(): HTMLAudioElement | undefined {
  return audio;
}
