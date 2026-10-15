import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeError } from '../shared/errors';
import { HOST_CONTRACT_VERSION, type HostEvent, type HostRequest, type PickFileReply } from '../shared/integration/host-contract';
import { AI_CONTRACT_VERSION } from '../shared/integration/ai-contract';
import { CONTENT_CONTRACT_VERSION } from '../shared/integration/content-providers';
import { FeedProvider, type FeedRegistration } from './library/feeds';
import type { Services } from './services';

/**
 * State and file I/O behind host contract 1.1: pick-file replies,
 * report-status and content feeds. Replies are only ever written as NEW .json
 * files inside the system temporary folder, atomically (written beside the
 * target, then hard-linked into place so an existing file is never replaced).
 */

export type PickRequest = Extract<HostRequest, { type: 'pick-file' }>;
export interface PendingPick {
  token: string;
  requestId?: string;
  title?: string;
  multiple: boolean;
  kinds: 'files' | 'folders' | 'both';
  replyFile: string;
  receivedMs: number;
}

const pending = new Map<string, PendingPick>();
const FEEDS_KEY = 'host.feeds';

function tempRoots(): string[] {
  const roots = new Set<string>();
  for (const r of [os.tmpdir(), process.env.TMPDIR, '/tmp']) {
    if (!r) continue;
    roots.add(path.resolve(r));
    try {
      roots.add(fs.realpathSync(r));
    } catch {
      /* missing root */
    }
  }
  return [...roots];
}

/** Validate a reply target: absolute, .json, inside the temp folder, parent exists, file does not. */
export async function checkReplyTarget(replyFile: string, ext: RegExp = /\.json$/i): Promise<string> {
  if (!path.isAbsolute(replyFile)) throw makeError('validation', 'host.reply', { message: 'The reply file must be an absolute path.' });
  const resolved = path.resolve(replyFile);
  if (!ext.test(resolved)) throw makeError('validation', 'host.reply', { message: 'Reply files must end in .json (event sinks in .ndjson or .jsonl).' });
  const parent = await fsp.realpath(path.dirname(resolved)).catch(() => undefined);
  if (!parent) throw makeError('not_found', 'host.reply', { message: 'The folder for the reply file does not exist.' });
  const inside = tempRoots().some((r) => parent === r || parent.startsWith(r + path.sep));
  if (!inside) throw makeError('permission_denied', 'host.reply', { message: 'Reply files can only be written inside the system temporary folder.' });
  const target = path.join(parent, path.basename(resolved));
  if (await fsp.lstat(target).then(() => true, () => false)) throw makeError('already_exists', 'host.reply', { message: 'The reply file already exists; Orbis Files never overwrites it.' });
  return target;
}

/** Write JSON to a new file atomically: temp file in the same folder, then an exclusive hard link. */
export async function writeReplyFile(replyFile: string, data: unknown): Promise<string> {
  const target = await checkReplyTarget(replyFile);
  const tmp = path.join(path.dirname(target), `.orbis-part-${randomUUID()}.json`);
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    await fsp.link(tmp, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw makeError('already_exists', 'host.reply', { message: 'The reply file appeared while it was being written; it was left untouched.' });
    // Filesystems without hard links: fall back to a no-replace rename check.
    if (await fsp.lstat(target).then(() => true, () => false)) throw makeError('already_exists', 'host.reply');
    await fsp.rename(tmp, target);
    return target;
  } finally {
    await fsp.unlink(tmp).catch(() => undefined);
  }
  return target;
}

export async function addPendingPick(req: PickRequest): Promise<PendingPick> {
  const replyFile = await checkReplyTarget(req.replyFile);
  for (const p of pending.values()) if (p.replyFile === replyFile) throw makeError('already_exists', 'host.pick', { message: 'A pick request for this reply file is already open.' });
  const pick: PendingPick = { token: randomUUID(), requestId: req.requestId, title: req.title, multiple: req.multiple, kinds: req.kinds, replyFile, receivedMs: Date.now() };
  pending.set(pick.token, pick);
  return pick;
}

export function pendingPicks(): PendingPick[] {
  return [...pending.values()].sort((a, b) => a.receivedMs - b.receivedMs);
}

/** Complete a pick. `paths === null` means the user cancelled. Paths are verified against the request. */
export async function answerPick(token: string, paths: string[] | null): Promise<PickFileReply> {
  const pick = pending.get(token);
  if (!pick) throw makeError('not_found', 'host.pick', { message: 'This pick request is no longer open.' });
  let reply: PickFileReply;
  if (paths === null) {
    reply = { contract: HOST_CONTRACT_VERSION, requestId: pick.requestId, status: 'cancelled', paths: [] };
  } else {
    if (paths.length === 0) throw makeError('validation', 'host.pick', { message: 'Select at least one item.' });
    if (!pick.multiple && paths.length > 1) throw makeError('validation', 'host.pick', { message: 'Only one item can be chosen for this request.' });
    for (const p of paths) {
      if (!path.isAbsolute(p)) throw makeError('validation', 'host.pick', { message: 'Only items on disk can be chosen.' });
      const st = await fsp.stat(p).catch(() => undefined);
      if (!st) throw makeError('not_found', 'host.pick', { target: p });
      if (pick.kinds === 'files' && !st.isFile()) throw makeError('validation', 'host.pick', { target: p, message: 'This request asks for files, not folders.' });
      if (pick.kinds === 'folders' && !st.isDirectory()) throw makeError('validation', 'host.pick', { target: p, message: 'This request asks for folders, not files.' });
    }
    reply = { contract: HOST_CONTRACT_VERSION, requestId: pick.requestId, status: 'selected', paths: [...paths] };
  }
  await writeReplyFile(pick.replyFile, reply);
  pending.delete(token);
  emitHostEvent({ type: 'pick-answered', requestId: pick.requestId, status: reply.status, count: reply.paths.length });
  return reply;
}

/**
 * On quit: answer every open pick as cancelled so the host is never left
 * waiting. Synchronous because it runs in the app's final quit handler.
 */
export function cancelAllPicksSync(): number {
  let n = 0;
  for (const pick of pending.values()) {
    const reply: PickFileReply = { contract: HOST_CONTRACT_VERSION, requestId: pick.requestId, status: 'cancelled', paths: [] };
    const tmp = path.join(path.dirname(pick.replyFile), `.orbis-part-${randomUUID()}.json`);
    try {
      if (fs.existsSync(pick.replyFile)) continue;
      fs.writeFileSync(tmp, JSON.stringify(reply, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.linkSync(tmp, pick.replyFile);
      n++;
    } catch {
      /* the host will see no reply; nothing else can be done while quitting */
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* already gone */
      }
    }
  }
  pending.clear();
  return n;
}

/** What the customization adapters currently use (no configuration contents). */
function customizationStatus(s: Services): { designTokens: 'host' | 'standalone'; reservedShortcuts: number; commandsReported: number } | undefined {
  if (!s.customization) return undefined;
  const st = s.customization.state();
  return { designTokens: st.hostTokens ? 'host' : 'standalone', reservedShortcuts: st.hostReserved.length, commandsReported: s.customization.commands().length };
}

export async function writeStatus(s: Services, replyFile: string, requestId: string | undefined, appVersion: string, host: { lastRequestMs?: number }): Promise<string> {
  const ai = s.ai.status() as { status?: string; capabilities?: string[] };
  const status = {
    contract: HOST_CONTRACT_VERSION,
    requestId,
    app: { name: 'Orbis Files', version: appVersion, platform: process.platform },
    contracts: { host: HOST_CONTRACT_VERSION, ai: AI_CONTRACT_VERSION, content: CONTENT_CONTRACT_VERSION },
    profileId: s.profileId,
    supportedRequests: ['open-location', 'reveal-file', 'register-download', 'register-generated', 'pick-file', 'report-status', 'register-content-feed', 'unregister-content-feed', 'register-event-sink', 'unregister-event-sink', 'set-design-tokens', 'clear-design-tokens', 'set-reserved-shortcuts', 'report-commands', 'open-settings', 'offer-ai-provider', 'set-profile'],
    customization: customizationStatus(s),
    eventSinks: sinks.size,
    ai: { status: ai.status ?? 'unknown', capabilities: ai.capabilities ?? [] },
    contentProviders: s.content.infos().map((p) => ({ id: p.id, label: p.label, availability: p.availability, types: p.types, builtIn: p.builtIn })),
    pendingPicks: pending.size,
    lastRequestMs: host.lastRequestMs,
    writtenMs: Date.now(),
  };
  return writeReplyFile(replyFile, status);
}

// ---------------------------------------------------------------- content feeds

function savedFeeds(s: Services): FeedRegistration[] {
  const v = s.catalog.getKv<FeedRegistration[] | null>(FEEDS_KEY, null);
  return Array.isArray(v) ? v : [];
}

const RESERVED = new Set(['downloads', 'generated', 'imported', 'projects', 'orbis-native']);

export function registerFeed(s: Services, reg: FeedRegistration): void {
  if (RESERVED.has(reg.providerId)) throw makeError('validation', 'host.feed', { message: `“${reg.providerId}” is a built-in provider and cannot be replaced.` });
  if (!path.isAbsolute(reg.feedFile)) throw makeError('validation', 'host.feed', { message: 'The feed file must be an absolute path.' });
  s.content.register(new FeedProvider(reg));
  const rest = savedFeeds(s).filter((f) => f.providerId !== reg.providerId);
  s.catalog.setKv(FEEDS_KEY, [...rest, reg]);
}

export function unregisterFeed(s: Services, providerId: string): boolean {
  const saved = savedFeeds(s);
  if (!saved.some((f) => f.providerId === providerId)) return false;
  s.content.unregister(providerId);
  s.catalog.setKv(FEEDS_KEY, saved.filter((f) => f.providerId !== providerId));
  return true;
}

export function restoreFeeds(s: Services): number {
  let n = 0;
  for (const reg of savedFeeds(s)) {
    if (RESERVED.has(reg.providerId) || !path.isAbsolute(reg.feedFile)) continue;
    s.content.register(new FeedProvider(reg));
    n++;
  }
  return n;
}

export function feedRegistrations(s: Services): FeedRegistration[] {
  return savedFeeds(s);
}

// ---------------------------------------------------------------- event sinks (1.2)

const MAX_SINK_BYTES = 10 * 1024 * 1024;
const sinks = new Map<string, { bytes: number }>();

/**
 * Register a NEW file in the temp folder that receives events as JSON lines.
 * The file is created here (exclusively, mode 600), so an existing file can
 * never be appended to. A sink is dropped when it disappears or reaches 10 MB.
 */
export async function registerEventSink(sinkFile: string): Promise<string> {
  if (sinks.size >= 8) throw makeError('validation', 'host.events', { message: 'Too many event sinks are registered.' });
  const target = await checkReplyTarget(sinkFile, /\.(ndjson|jsonl)$/i);
  const first = JSON.stringify({ contract: HOST_CONTRACT_VERSION, ts: Date.now(), type: 'sink-registered' }) + '\n';
  await fsp.writeFile(target, first, { flag: 'wx', mode: 0o600 });
  sinks.set(target, { bytes: Buffer.byteLength(first) });
  return target;
}

export function unregisterEventSink(sinkFile: string): boolean {
  for (const k of sinks.keys()) {
    if (k === sinkFile || k === path.resolve(sinkFile)) {
      sinks.delete(k);
      return true;
    }
  }
  return false;
}

export function eventSinks(): string[] {
  return [...sinks.keys()];
}

type EventBody = HostEvent extends infer E ? (E extends { type: infer _T } ? Omit<E, 'contract' | 'ts'> : never) : never;

/** Append one event to every sink. Never throws; failing sinks are dropped. */
export function emitHostEvent(body: EventBody): void {
  if (!sinks.size) return;
  const line = JSON.stringify({ contract: HOST_CONTRACT_VERSION, ts: Date.now(), ...body }) + '\n';
  const n = Buffer.byteLength(line);
  for (const [file, st] of sinks) {
    if (st.bytes + n > MAX_SINK_BYTES) {
      sinks.delete(file);
      continue;
    }
    st.bytes += n;
    // O_APPEND without O_CREAT semantics: if the host removed the file, stop writing to it.
    fsp.lstat(file).then((s) => {
      if (!s.isFile()) throw new Error('not a file');
      return fsp.appendFile(file, line, { flag: 'a' });
    }).catch(() => sinks.delete(file));
  }
}
