import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  AI_CONTRACT_VERSION,
  HandshakeSchema,
  MAX_LISTING_ENTRIES,
  ProgressEventSchema,
  ProposedOperationSchema,
  TaskKindSchema,
  TaskRequestSchema,
  TaskResultSchema,
  isCompatibleVersion,
  permissionFor,
  type AiProviderAdapter,
  type Capability,
  type ContextItem,
  type Handshake,
  type PermissionClass,
  type ProposedOperation,
  type ProviderStatus,
  type TaskKind,
  type TaskResult,
} from '../../shared/integration/ai-contract';
import { makeError, OrbisError, toOrbisError, type OrbisErrorShape } from '../../shared/errors';
import { looksBinary, readHead } from '../fs/FileSystemService';
import { sniffFile } from '../fs/sniff';
import { validateName } from '../fs/paths';
import { diffStrings, type TextDiff } from '../tools/analysis';
import { HttpAdapter } from './HttpAdapter';
import { OpenAiCompatAdapter } from './OpenAiCompatAdapter';

/**
 * Owns the connection to the (optional) Orbis AI provider.
 *
 * Guarantees:
 *  - Status is derived from real handshakes and pings, never from a setting alone.
 *  - Only capabilities the provider declares are enabled.
 *  - Context is limited to items the user explicitly selected; content is read
 *    only for items marked share='content'.
 *  - Results and proposals are schema-validated; anything malformed is rejected.
 *  - Proposals are never executed here. `applyProposals` hands approved items
 *    to the injected executor, which uses the normal operation engine.
 */

/** Which adapter speaks to the configured provider. */
export type ProviderKind = 'orbis' | 'openai-compatible';

export interface ProviderConfig {
  kind: ProviderKind;
  endpoint: string;
  /** Bearer token / API key; held in memory only (persisted encrypted by the caller). */
  token?: string;
  /** Model id (OpenAI-compatible servers). */
  model?: string;
  /** The user states the model accepts images (OpenAI-compatible servers). */
  vision?: boolean;
}

/**
 * Construct the adapter for a provider configuration. Invalid configurations
 * (insecure URL, missing model) are reported as validation errors.
 */
export function createProviderAdapter(cfg: ProviderConfig, fetchImpl: typeof fetch = fetch): AiProviderAdapter {
  try {
    if (cfg.kind === 'openai-compatible') {
      if (!cfg.model?.trim()) throw new Error('Choose a model for the OpenAI-compatible server.');
      return new OpenAiCompatAdapter({ baseUrl: cfg.endpoint, model: cfg.model.trim(), apiKey: cfg.token, vision: cfg.vision }, fetchImpl);
    }
    return new HttpAdapter(cfg.endpoint, cfg.token, fetchImpl);
  } catch (err) {
    if (err instanceof OrbisError) throw err;
    throw makeError('validation', 'ai.configure', { message: (err as Error).message });
  }
}

export interface AiStatusSnapshot {
  status: ProviderStatus;
  configured: boolean;
  endpoint?: string;
  /** Adapter in use; absent when not configured. */
  providerKind?: ProviderKind;
  model?: string;
  vision?: boolean;
  provider?: Pick<Handshake, 'providerId' | 'providerName' | 'providerVersion' | 'contractVersion' | 'processing' | 'limits' | 'models'>;
  capabilities: Capability[];
  lastError?: string;
  lastCheckedMs?: number;
  reconnectAttempt?: number;
  contractVersion: string;
}

export interface TaskSnapshot {
  taskId: string;
  kind: TaskKind;
  state: 'preparing' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  createdMs: number;
  progress?: { fraction?: number; message?: string };
  /** `reason` on an included item explains a reduced share (e.g. content not sent). `listed` counts folder entries sent. */
  context: Array<{ ref: string; name: string; share: 'metadata' | 'content'; included: boolean; reason?: string; truncated?: boolean; listed?: number }>;
  result?: TaskResult;
  proposals?: Array<{ index: number; op: ProposedOperation; permission: PermissionClass; validation?: string }>;
  error?: OrbisErrorShape;
}

export interface AuditSink {
  record(e: { taskId: string; event: string; kind?: string; refs?: string[]; detail?: unknown }): void;
}

export type ProposalExecutor = (taskId: string, approved: Array<{ index: number; op: ProposedOperation }>) => Promise<Array<{ index: number; ok: boolean; message: string; operationId?: string; snapshotId?: string }>>;

const MAX_RECONNECT = 5;

export class ProviderRegistry extends EventEmitter {
  private adapter: AiProviderAdapter | undefined;
  private snapshot: AiStatusSnapshot = { status: 'not_configured', configured: false, capabilities: [], contractVersion: AI_CONTRACT_VERSION };
  private handshake: Handshake | undefined;
  private pingTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private connectAbort: AbortController | undefined;
  private tasks = new Map<string, { snap: TaskSnapshot; abort: AbortController }>();
  pingIntervalMs = 30000;

  constructor(private readonly audit: AuditSink, private readonly executor: ProposalExecutor) {
    super();
  }

  status(): AiStatusSnapshot {
    return structuredClone(this.snapshot);
  }

  private update(patch: Partial<AiStatusSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit('status', this.status());
  }

  /** Install an adapter (or remove with undefined). Does not connect by itself. */
  configure(adapter: AiProviderAdapter | undefined, endpoint?: string, info?: { kind: ProviderKind; model?: string; vision?: boolean }): void {
    void this.teardown();
    this.adapter = adapter;
    this.handshake = undefined;
    this.update({
      status: adapter ? 'disconnected' : 'not_configured',
      configured: !!adapter,
      endpoint,
      providerKind: adapter ? (info?.kind ?? 'orbis') : undefined,
      model: adapter ? info?.model : undefined,
      vision: adapter ? info?.vision : undefined,
      provider: undefined,
      capabilities: [],
      lastError: undefined,
      reconnectAttempt: undefined,
    });
  }

  private async teardown(): Promise<void> {
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    this.connectAbort?.abort();
    for (const t of this.tasks.values()) if (['preparing', 'running'].includes(t.snap.state)) t.abort.abort();
    await this.adapter?.disconnect().catch(() => undefined);
  }

  async connect(attempt = 0): Promise<AiStatusSnapshot> {
    if (!this.adapter) return this.status();
    clearTimeout(this.reconnectTimer);
    this.update({ status: attempt ? 'reconnecting' : 'connecting', reconnectAttempt: attempt || undefined });
    const ac = new AbortController();
    this.connectAbort = ac;
    const timeout = setTimeout(() => ac.abort(), 10000);
    try {
      const raw = await this.adapter.connect(ac.signal);
      const parsed = HandshakeSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`Invalid handshake: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
      if (!isCompatibleVersion(parsed.data.contractVersion)) {
        this.handshake = undefined;
        this.update({
          status: 'incompatible',
          capabilities: [],
          lastError: `Provider speaks contract ${parsed.data.contractVersion}; Orbis Files supports ${AI_CONTRACT_VERSION}.`,
          lastCheckedMs: Date.now(),
        });
        return this.status();
      }
      if (!(await this.adapter.ping(ac.signal).catch(() => false))) {
        throw new Error('The provider answered the handshake but failed its health check.');
      }
      this.handshake = parsed.data;
      this.update({
        status: 'available',
        provider: {
          providerId: parsed.data.providerId,
          providerName: parsed.data.providerName,
          providerVersion: parsed.data.providerVersion,
          contractVersion: parsed.data.contractVersion,
          processing: parsed.data.processing,
          limits: parsed.data.limits,
          models: parsed.data.models,
        },
        capabilities: [...new Set(parsed.data.capabilities)],
        lastError: undefined,
        lastCheckedMs: Date.now(),
        reconnectAttempt: undefined,
      });
      this.startPing();
    } catch (err) {
      const message = ac.signal.aborted ? 'The provider did not respond within 10 seconds.' : (err as Error).message;
      this.handshake = undefined;
      if (attempt < MAX_RECONNECT) {
        const delay = Math.min(60000, 1000 * 2 ** attempt);
        this.update({ status: 'reconnecting', capabilities: [], lastError: message, lastCheckedMs: Date.now(), reconnectAttempt: attempt + 1 });
        this.reconnectTimer = setTimeout(() => void this.connect(attempt + 1), delay);
      } else {
        this.update({ status: 'unavailable', capabilities: [], lastError: message, lastCheckedMs: Date.now(), reconnectAttempt: undefined });
      }
    } finally {
      clearTimeout(timeout);
    }
    return this.status();
  }

  async disconnect(): Promise<AiStatusSnapshot> {
    await this.teardown();
    this.handshake = undefined;
    this.update({ status: this.adapter ? 'disconnected' : 'not_configured', capabilities: [], provider: undefined, reconnectAttempt: undefined });
    return this.status();
  }

  private startPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(async () => {
      if (!this.adapter) return;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      const ok = await this.adapter.ping(ac.signal).catch(() => false);
      clearTimeout(t);
      if (ok) {
        if (this.snapshot.status === 'degraded') this.update({ status: 'available', lastCheckedMs: Date.now() });
        else this.snapshot.lastCheckedMs = Date.now();
      } else if (this.snapshot.status === 'available') {
        this.update({ status: 'degraded', lastError: 'The provider did not answer a health check.', lastCheckedMs: Date.now() });
      } else if (this.snapshot.status === 'degraded') {
        clearInterval(this.pingTimer);
        void this.connect(1);
      }
    }, this.pingIntervalMs);
  }

  /** Construct the adapter for `cfg` and install it. Does not connect by itself. */
  configureProvider(cfg: ProviderConfig, fetchImpl?: typeof fetch): void {
    const adapter = createProviderAdapter(cfg, fetchImpl);
    this.configure(adapter, cfg.endpoint, { kind: cfg.kind, model: cfg.kind === 'openai-compatible' ? cfg.model?.trim() : undefined, vision: cfg.kind === 'openai-compatible' ? !!cfg.vision : undefined });
  }

  has(cap: Capability): boolean {
    return (this.snapshot.status === 'available' || this.snapshot.status === 'degraded') && this.snapshot.capabilities.includes(cap);
  }

  /**
   * Build the context the user explicitly selected. Reports what was and wasn't included.
   *
   * - Folders carry a listing of their first entries by name (names, kinds and
   *   file sizes; dot-files left out unless `showHidden`).
   * - Image and PDF contents are sent only to providers that declare
   *   `image_understanding` / `pdf_understanding`; otherwise the item is sent by
   *   name and size and the report says why.
   */
  async buildContext(refs: Array<{ path: string; share: 'metadata' | 'content' }>, opts: { showHidden?: boolean } = {}): Promise<{ items: ContextItem[]; report: TaskSnapshot['context'] }> {
    const limits = this.handshake?.limits ?? {};
    const maxFiles = limits.maxFiles ?? 200;
    const maxFileBytes = Math.min(limits.maxFileBytes ?? 2 * 1024 * 1024, 16 * 1024 * 1024);
    const maxTotal = limits.maxContextBytes ?? 8 * 1024 * 1024;
    const items: ContextItem[] = [];
    const report: TaskSnapshot['context'] = [];
    let total = 0;
    for (const r of refs) {
      const name = path.basename(r.path);
      if (items.length >= maxFiles) {
        report.push({ ref: r.path, name, share: r.share, included: false, reason: `The provider accepts at most ${maxFiles} items.` });
        continue;
      }
      let st: import('node:fs').Stats;
      try {
        st = await fsp.stat(r.path);
      } catch (err) {
        report.push({ ref: r.path, name, share: r.share, included: false, reason: toOrbisError(err, 'ai.context', r.path).message });
        continue;
      }
      const kind = st.isDirectory() ? 'directory' : 'file';
      const item: ContextItem = { ref: r.path, kind, name, size: st.isFile() ? st.size : undefined, share: r.share };
      const entry: TaskSnapshot['context'][number] = { ref: r.path, name, share: r.share, included: true };
      if (kind === 'directory') {
        try {
          item.listing = await listForContext(r.path, !!opts.showHidden);
          entry.listed = item.listing.entries.length;
          total += item.listing.entries.reduce((n, e) => n + e.name.length + 24, 0);
        } catch (err) {
          entry.reason = `The folder's contents could not be listed (${toOrbisError(err, 'ai.context', r.path).message}); only its name was sent.`;
        }
      } else if (r.share === 'content' && (await this.contentGate(r.path, item, entry))) {
        // Sent by name and size only (reason recorded by contentGate).
      } else if (r.share === 'content') {
        if (st.size > maxFileBytes) {
          report.push({ ref: r.path, name, share: r.share, included: false, reason: `The file is larger than the provider's ${Math.round(maxFileBytes / 1024)} KB limit. Its content was not sent.` });
          continue;
        }
        if (total + st.size > maxTotal) {
          report.push({ ref: r.path, name, share: r.share, included: false, reason: 'Including this file would exceed the provider context limit.' });
          continue;
        }
        const buf = await fsp.readFile(r.path);
        const binary = looksBinary(buf);
        item.content = { encoding: binary ? 'base64' : 'utf8', data: binary ? buf.toString('base64') : buf.toString('utf8'), truncated: false, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
        total += st.size;
      }
      items.push(item);
      report.push(entry);
    }
    return { items, report };
  }

  /**
   * Image and PDF contents go only to providers that declare they understand
   * them. Returns true (and downgrades the item to name and size) when the
   * provider does not. Also records the detected MIME type.
   */
  private async contentGate(file: string, item: ContextItem, entry: TaskSnapshot['context'][number]): Promise<boolean> {
    const sniff = await sniffFile(file).catch(() => undefined);
    if (!sniff) return false;
    if (sniff.mime) item.mime = sniff.mime;
    const binaryImage = sniff.family === 'image' && looksBinary(await readHead(file, 8192).catch(() => Buffer.alloc(0)));
    const gate = binaryImage && !this.has('image_understanding') ? 'images' : sniff.family === 'pdf' && !this.has('pdf_understanding') ? 'PDF documents' : undefined;
    if (!gate) return false;
    item.share = 'metadata';
    entry.share = 'metadata';
    entry.reason = `Sent by name and size only: the provider does not declare that it understands ${gate}.`;
    return true;
  }

  tasksList(): TaskSnapshot[] {
    return [...this.tasks.values()].map((t) => structuredClone(t.snap)).sort((a, b) => b.createdMs - a.createdMs);
  }

  task(id: string): TaskSnapshot | undefined {
    const t = this.tasks.get(id);
    return t ? structuredClone(t.snap) : undefined;
  }

  private emitTask(snap: TaskSnapshot): void {
    this.emit('task', structuredClone(snap));
  }

  async runTask(kindRaw: string, prompt: string | undefined, refs: Array<{ path: string; share: 'metadata' | 'content' }>, opts: { showHidden?: boolean } = {}): Promise<TaskSnapshot> {
    const kindParsed = TaskKindSchema.safeParse(kindRaw);
    if (!kindParsed.success) throw makeError('validation', 'ai.runTask', { message: 'Unknown AI task type.' });
    const kind = kindParsed.data;
    if (!this.adapter || !this.handshake) throw makeError('unavailable', 'ai.runTask', { message: 'No AI provider is connected.' });
    if (!this.has(kind as Capability)) throw makeError('unsupported', 'ai.runTask', { message: `The connected provider does not offer "${kind}".` });

    const taskId = crypto.randomUUID();
    const abort = new AbortController();
    const snap: TaskSnapshot = { taskId, kind, state: 'preparing', createdMs: Date.now(), context: [] };
    this.tasks.set(taskId, { snap, abort });
    this.emitTask(snap);

    const { items, report } = await this.buildContext(refs, opts);
    snap.context = report;
    this.audit.record({ taskId, event: 'task_started', kind, refs: report.filter((r) => r.included).map((r) => r.ref), detail: { shared: report.map((r) => ({ name: r.name, share: r.share, included: r.included })) } });
    const request = TaskRequestSchema.parse({ taskId, kind, prompt, context: items, timeoutMs: 5 * 60 * 1000 });
    snap.state = 'running';
    this.emitTask(snap);
    const timeout = setTimeout(() => abort.abort(), request.timeoutMs);
    try {
      const raw = await this.adapter.run(
        request,
        (e) => {
          const p = ProgressEventSchema.safeParse(e);
          if (p.success && p.data.taskId === taskId) {
            snap.progress = { fraction: p.data.fraction, message: p.data.message };
            this.emitTask(snap);
          }
        },
        abort.signal,
      );
      const parsed = TaskResultSchema.safeParse(raw);
      if (!parsed.success) throw makeError('validation', 'ai.result', { message: 'The provider returned a malformed result. It was discarded.', cause: parsed.error.issues[0]?.message });
      if (parsed.data.taskId !== taskId) throw makeError('validation', 'ai.result', { message: 'The provider returned a result for a different task.' });
      snap.result = parsed.data;
      snap.state = parsed.data.status === 'completed' ? 'completed' : parsed.data.status === 'partial' ? 'partial' : parsed.data.status === 'cancelled' ? 'cancelled' : 'failed';
      if (parsed.data.error) snap.error = { category: 'unavailable', operation: 'ai.task', message: parsed.data.error.message, dataChanged: 'no', retryable: true, cause: parsed.data.error.code };
      snap.proposals = await Promise.all((parsed.data.proposals ?? []).map(async (op, index) => ({ index, op, permission: permissionFor(op), validation: validateProposal(op) ?? (op.op === 'edit_file' ? await checkEditBase(op, report) : undefined) })));
      this.audit.record({ taskId, event: 'task_finished', kind, detail: { status: snap.state, proposals: snap.proposals.length } });
    } catch (err) {
      snap.state = abort.signal.aborted ? 'cancelled' : 'failed';
      snap.error = abort.signal.aborted ? { category: 'cancelled', operation: 'ai.task', message: 'The AI task was cancelled. No file changes were made.', dataChanged: 'no', retryable: true } : toOrbisError(err, 'ai.task');
      this.audit.record({ taskId, event: snap.state === 'cancelled' ? 'task_cancelled' : 'task_failed', kind, detail: { message: snap.error.message } });
    } finally {
      clearTimeout(timeout);
    }
    this.emitTask(snap);
    return structuredClone(snap);
  }

  /**
   * What an edit_file proposal would change: a line diff for text, sizes and
   * hashes for binary content. Read fresh from disk, so a file that changed
   * since the task ran is reported as such.
   */
  async proposalPreview(taskId: string, index: number): Promise<EditPreview> {
    const p = this.tasks.get(taskId)?.snap.proposals?.find((x) => x.index === index);
    if (!p) throw makeError('not_found', 'ai.proposalPreview', { message: 'This proposal is no longer available.' });
    if (p.op.op !== 'edit_file') throw makeError('unsupported', 'ai.proposalPreview', { message: 'Only file edits have a content preview.' });
    return previewEdit(p.op);
  }

  cancelTask(taskId: string): void {
    const t = this.tasks.get(taskId);
    if (!t) throw makeError('not_found', 'ai.cancelTask', { message: 'Task not found.' });
    t.abort.abort();
  }

  /**
   * Execute proposals the user approved. Approval is the user's act, recorded
   * in the audit trail; the provider's output is never treated as consent.
   */
  async applyProposals(taskId: string, approvedIndexes: number[]): Promise<Array<{ index: number; ok: boolean; message: string; operationId?: string; snapshotId?: string }>> {
    const t = this.tasks.get(taskId);
    if (!t?.snap.proposals) throw makeError('not_found', 'ai.applyProposals', { message: 'No proposals for this task.' });
    if (t.snap.state === 'cancelled') throw makeError('cancelled', 'ai.applyProposals', { message: 'This task was cancelled; its proposals can no longer be applied.' });
    const chosen = [...new Set(approvedIndexes)].map((i) => t.snap.proposals!.find((p) => p.index === i)).filter((p): p is NonNullable<typeof p> => !!p);
    const valid = chosen.filter((p) => !p.validation && ProposedOperationSchema.safeParse(p.op).success);
    this.audit.record({ taskId, event: 'proposals_approved', detail: { approved: valid.map((v) => ({ index: v.index, op: v.op.op, permission: v.permission })), rejectedInvalid: chosen.length - valid.length } });
    const results = await this.executor(taskId, valid.map((v) => ({ index: v.index, op: v.op })));
    this.audit.record({ taskId, event: 'proposals_executed', detail: { results: results.map((r) => ({ index: r.index, ok: r.ok, message: r.message })) } });
    return results;
  }
}

/** A folder's first entries by name, for a directory context item. Never follows links. */
export async function listForContext(dir: string, showHidden: boolean): Promise<NonNullable<ContextItem['listing']>> {
  const all = await fsp.readdir(dir, { withFileTypes: true });
  const visible = showHidden ? all : all.filter((d) => !d.name.startsWith('.'));
  visible.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const first = visible.slice(0, MAX_LISTING_ENTRIES);
  const entries: NonNullable<ContextItem['listing']>['entries'] = new Array(first.length);
  // Sizes for files, read with bounded concurrency.
  let next = 0;
  const worker = async () => {
    while (next < first.length) {
      const i = next++;
      const d = first[i]!;
      const kind = d.isDirectory() ? 'directory' : d.isSymbolicLink() ? 'symlink' : d.isFile() ? 'file' : 'other';
      let size: number | undefined;
      if (kind === 'file') size = await fsp.lstat(path.join(dir, d.name)).then((st) => st.size, () => undefined);
      entries[i] = size === undefined ? { name: d.name.slice(0, 1024), kind } : { name: d.name.slice(0, 1024), kind, size };
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, first.length) }, worker));
  return { entries, total: visible.length, truncated: visible.length > first.length, hiddenOmitted: !showHidden && visible.length < all.length };
}

export interface EditPreview {
  path: string;
  baseMatches: boolean;
  currentSha256?: string;
  beforeBytes?: number;
  afterBytes: number;
  binary: boolean;
  diff?: TextDiff;
  note?: string;
}

const PREVIEW_MAX = 5 * 1024 * 1024;

export function editBytes(op: Extract<ProposedOperation, { op: 'edit_file' }>): Buffer {
  return op.encoding === 'base64' ? Buffer.from(op.data, 'base64') : Buffer.from(op.data, 'utf8');
}

export async function previewEdit(op: Extract<ProposedOperation, { op: 'edit_file' }>): Promise<EditPreview> {
  const after = editBytes(op);
  const st = await fsp.lstat(op.path).catch(() => undefined);
  if (!st?.isFile()) return { path: op.path, baseMatches: false, afterBytes: after.length, binary: looksBinary(after), note: 'The file no longer exists, or is not a regular file.' };
  const before = await fsp.readFile(op.path);
  const currentSha256 = crypto.createHash('sha256').update(before).digest('hex');
  const binary = looksBinary(before) || looksBinary(after);
  const out: EditPreview = { path: op.path, baseMatches: currentSha256 === op.baseSha256, currentSha256, beforeBytes: before.length, afterBytes: after.length, binary };
  if (!binary && before.length <= PREVIEW_MAX && after.length <= PREVIEW_MAX) out.diff = diffStrings(before.toString('utf8'), after.toString('utf8'));
  else if (!binary) out.note = 'The file is too large for a line-by-line preview; sizes and checksums are shown instead.';
  else out.note = 'Binary content: compared by size and checksum.';
  return out;
}

/** An edit is offered only when it was made against the exact bytes the user shared and the file still has them. */
async function checkEditBase(op: Extract<ProposedOperation, { op: 'edit_file' }>, report: TaskSnapshot['context']): Promise<string | undefined> {
  const shared = report.find((r) => r.ref === op.path && r.included && r.share === 'content');
  if (!shared) return 'Orbis AI was not given this file\'s contents, so it cannot propose an edit to it.';
  const buf = await fsp.readFile(op.path).catch(() => undefined);
  if (!buf) return 'The file can no longer be read.';
  const now = crypto.createHash('sha256').update(buf).digest('hex');
  return now === op.baseSha256 ? undefined : 'The file changed after Orbis AI read it (or the proposal names a different version). It was not offered.';
}

/** Static checks on a proposal before it is shown as approvable. */
export function validateProposal(op: ProposedOperation): string | undefined {
  const abs = (p: string) => path.isAbsolute(p) && !p.includes('\0');
  switch (op.op) {
    case 'rename': {
      if (!abs(op.from)) return 'Source path is not absolute.';
      const v = validateName(op.toName);
      return v.valid ? undefined : v.reason;
    }
    case 'move':
    case 'copy':
      if (!abs(op.from) || !abs(op.toDir)) return 'Paths must be absolute.';
      return undefined;
    case 'mkdir':
    case 'trash':
    case 'tag':
    case 'collect':
      return abs(op.path) ? undefined : 'Path is not absolute.';
    case 'write_new': {
      if (!abs(op.toDir)) return 'Destination is not absolute.';
      const v = validateName(op.name);
      return v.valid ? undefined : v.reason;
    }
    case 'edit_file':
      return abs(op.path) ? undefined : 'Path is not absolute.';
  }
}
