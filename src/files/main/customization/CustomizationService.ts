import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppDatabase } from '../store/Database';
import type { StartupNotice } from '../../shared/model';
import { defaultConfig, type CustomizationConfig } from '../../shared/customization/schema';
import { applyOp, CustomizationError, validateConfig, type CustomOp } from '../../shared/customization/ops';
import { fromLegacySettings, LEGACY_PRESENTATION_KEYS, migrateConfig, UnsupportedVersionError } from '../../shared/customization/migrations';
import { checkTokenEdit, resolveCustomization, type HostTokens } from '../../shared/customization/resolve';
import { canonicalFor, checkAssignment, effectiveBindings, osReserved, type Binding } from '../../shared/customization/shortcuts';
import { exportCustomization, previewImport, suggestedFileName, type ExportKind, type ImportPreview } from '../../shared/customization/portable';
import { validateHostTokens, validateReservedShortcuts, type CommandDescriptor } from '../../shared/integration/host-adapters';

/**
 * Owns the customization configuration of one profile.
 *
 * Storage (table customization_state):
 *   active        the configuration in use
 *   last_good     the previous valid configuration (one step back)
 *   backup:<ms>   copies taken before major changes (presets, imports, resets, deletions); newest 10 kept
 *   quarantine:<ms> a stored configuration that failed to load, kept for inspection
 *   host_tokens   design tokens supplied by a future Orbis host (validated)
 *   history:undo:<seq>, history:redo:<seq>   one row per undo/redo step
 *
 * Every change is validated as a whole before it is stored; an invalid
 * change leaves the active configuration untouched. Undo/redo history is
 * bounded (continuous edits coalesced) and persisted one step per row, so a
 * change writes only the step it adds. At start every stored step is validated
 * again; a step that fails (and every older step behind it) is dropped, and a
 * history that cannot be read at all is discarded — it never blocks startup.
 * A full reset ("Reset everything") clears the earlier history; the reset
 * itself stays undoable.
 */

export interface HistoryEntry { before: CustomizationConfig; after: CustomizationConfig; label: string; key?: string; ms: number }

/** In memory, each step remembers the row that stores it. */
type StoredEntry = HistoryEntry & { slot?: string };

const StoredStepSchema = z.object({ before: z.unknown(), after: z.unknown(), label: z.string().max(500), key: z.string().max(200).optional(), ms: z.number().finite() });

export interface CustomizationState {
  config: CustomizationConfig;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  hostTokens: HostTokens | null;
  hostReserved: Array<{ key: string; reason: string }>;
  osReserved: Array<{ key: string; reason: string }>;
  backups: Array<{ slot: string; savedMs: number; label: string }>;
  lastGoodMs?: number;
}

const MAX_BACKUPS = 10;
const isMandatory = new Set(['app.palette', 'app.customize']);

export class CustomizationService extends EventEmitter {
  private config: CustomizationConfig;
  private undoStack: StoredEntry[] = [];
  private redoStack: StoredEntry[] = [];
  /** Last sequence number used for a history row. */
  private seq = 0;
  /** False when the active configuration had to be recovered or migrated: stored history would not lead to it. */
  private historyMatchesConfig = true;
  private registry: CommandDescriptor[] = [];
  private hostTokens: HostTokens | null = null;
  private hostReserved = new Map<string, string>();
  readonly notices: StartupNotice[] = [];

  constructor(
    private readonly db: AppDatabase,
    private readonly opts: { platform?: string; historyLimit?: number; coalesceMs?: number; now?: () => number; generator?: string } = {},
  ) {
    super();
    this.config = this.load();
    // Host tokens belong to a running host connection; tokens left by an earlier session are not reused.
    this.db.run("DELETE FROM customization_state WHERE slot = 'host_tokens'");
    this.loadHistory();
  }

  private get historyLimit(): number {
    return this.opts.historyLimit ?? 100;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  // ------------------------------------------------------------------ storage

  private slot(name: string): { json: string; saved_ms: number; label: string | null } | undefined {
    return this.db.get('SELECT json, saved_ms, label FROM customization_state WHERE slot = ?', [name]);
  }

  private write(name: string, value: unknown, label?: string): void {
    this.db.run('INSERT INTO customization_state(slot, json, saved_ms, label) VALUES(?, ?, ?, ?) ON CONFLICT(slot) DO UPDATE SET json = excluded.json, saved_ms = excluded.saved_ms, label = excluded.label', [name, JSON.stringify(value), this.now(), label ?? null]);
  }

  private parseStored(json: string): CustomizationConfig {
    return validateConfig(migrateConfig(JSON.parse(json)).doc);
  }

  private load(): CustomizationConfig {
    const active = this.slot('active');
    if (!active) return this.migrateLegacy();
    try {
      return this.parseStored(active.json);
    } catch (err) {
      this.historyMatchesConfig = false;
      const why = err instanceof CustomizationError ? `${err.message} ${err.details.slice(0, 3).join(' ')}` : (err as Error).message;
      this.write(`quarantine:${this.now()}`, { json: active.json, error: why }, 'Failed to load');
      const candidates = [this.slot('last_good'), ...this.backupRows().map((b) => this.slot(b.slot))];
      for (const c of candidates) {
        if (!c) continue;
        try {
          const cfg = this.parseStored(c.json);
          this.write('active', cfg);
          this.notices.push({ level: 'warning', message: 'Your customization could not be loaded, so the last working version was restored.', detail: why.slice(0, 300) });
          return cfg;
        } catch {
          /* try the next one */
        }
      }
      const fresh = defaultConfig(this.now());
      this.write('active', fresh);
      this.notices.push({ level: err instanceof UnsupportedVersionError ? 'warning' : 'error', message: 'Your customization could not be loaded and no earlier version was usable, so the defaults are in use. The unreadable copy was kept.', detail: why.slice(0, 300) });
      return fresh;
    }
  }

  /** First start after the customization engine was added: carry presentation settings over once. */
  private migrateLegacy(): CustomizationConfig {
    this.historyMatchesConfig = false;
    const legacy: Record<string, unknown> = {};
    for (const r of this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
      if (!(LEGACY_PRESENTATION_KEYS as readonly string[]).includes(r.key)) continue;
      try {
        legacy[r.key] = JSON.parse(r.value);
      } catch {
        /* unreadable legacy value: default */
      }
    }
    let hidden: Record<string, boolean> = {};
    try {
      const row = this.db.get<{ value: string }>("SELECT value FROM kv WHERE key = 'sidebar'");
      hidden = row ? ((JSON.parse(row.value) as { hidden?: Record<string, boolean> }).hidden ?? {}) : {};
    } catch {
      hidden = {};
    }
    const { config, carried } = fromLegacySettings(legacy, hidden, this.now());
    const valid = validateConfig(config);
    this.write('active', valid);
    this.write('last_good', valid);
    if (carried.length) this.notices.push({ level: 'info', message: 'Appearance and layout preferences now live in the Customization Studio.', detail: `Carried over: ${carried.join(', ')}.` });
    return valid;
  }

  private backupRows(): Array<{ slot: string; saved_ms: number; label: string | null }> {
    return this.db.all<{ slot: string; saved_ms: number; label: string | null }>("SELECT slot, saved_ms, label FROM customization_state WHERE slot LIKE 'backup:%' ORDER BY saved_ms DESC, slot DESC");
  }

  private backup(config: CustomizationConfig, label: string): void {
    const slot = `backup:${this.now()}:${Math.random().toString(36).slice(2, 6)}`;
    this.write(slot, config, label);
    for (const old of this.backupRows().slice(MAX_BACKUPS)) this.db.run('DELETE FROM customization_state WHERE slot = ?', [old.slot]);
  }

  // ------------------------------------------------------------------ history storage

  private historyRows(): Array<{ slot: string; json: string }> {
    return this.db.all<{ slot: string; json: string }>("SELECT slot, json FROM customization_state WHERE slot LIKE 'history:%' ORDER BY slot");
  }

  private deleteSlot(slot: string): void {
    this.db.run('DELETE FROM customization_state WHERE slot = ?', [slot]);
  }

  /** Writes one step under its stack; a step moving between stacks gets a new row. */
  private saveStep(e: StoredEntry, stack: 'undo' | 'redo'): void {
    if (e.slot && !e.slot.startsWith(`history:${stack}:`)) {
      this.deleteSlot(e.slot);
      e.slot = undefined;
    }
    e.slot ??= `history:${stack}:${String(++this.seq).padStart(12, '0')}`;
    this.write(e.slot, { before: e.before, after: e.after, label: e.label, key: e.key, ms: e.ms }, e.label);
  }

  private dropSteps(steps: StoredEntry[]): void {
    for (const e of steps) if (e.slot) this.deleteSlot(e.slot);
  }

  private sameConfig(a: CustomizationConfig, b: CustomizationConfig): boolean {
    return JSON.stringify({ ...a, meta: null }) === JSON.stringify({ ...b, meta: null });
  }

  /**
   * Restores the undo/redo history saved by an earlier session. Each step is
   * validated again (and migrated like a stored configuration); from the most
   * recent step backwards, the first invalid one ends the usable history. A
   * history that does not lead to the configuration in use is discarded.
   */
  private loadHistory(): void {
    try {
      const rows = this.historyRows();
      for (const r of rows) {
        const n = Number(r.slot.split(':')[2]);
        if (Number.isSafeInteger(n)) this.seq = Math.max(this.seq, n);
      }
      if (!this.historyMatchesConfig) {
        for (const r of rows) this.deleteSlot(r.slot);
        return;
      }
      const usable = (list: Array<{ slot: string; json: string }>): StoredEntry[] => {
        const out: StoredEntry[] = [];
        for (let i = list.length - 1; i >= 0; i--) {
          try {
            const raw = StoredStepSchema.parse(JSON.parse(list[i]!.json));
            out.unshift({ before: this.parseValue(raw.before), after: this.parseValue(raw.after), label: raw.label, key: raw.key, ms: raw.ms, slot: list[i]!.slot });
          } catch {
            break; // this step and everything older is dropped
          }
        }
        return out;
      };
      let undo = usable(rows.filter((r) => r.slot.startsWith('history:undo:')));
      let redo = usable(rows.filter((r) => r.slot.startsWith('history:redo:')));
      if (undo.length && !this.sameConfig(undo.at(-1)!.after, this.config)) undo = [];
      if (redo.length && !this.sameConfig(redo.at(-1)!.before, this.config)) redo = [];
      undo = undo.slice(-this.historyLimit);
      redo = redo.slice(-this.historyLimit);
      const kept = new Set([...undo, ...redo].map((e) => e.slot));
      for (const r of rows) if (!kept.has(r.slot)) this.deleteSlot(r.slot);
      this.undoStack = undo;
      this.redoStack = redo;
    } catch (err) {
      // Never let a damaged history block startup: start without one.
      this.undoStack = [];
      this.redoStack = [];
      try {
        this.db.run("DELETE FROM customization_state WHERE slot LIKE 'history:%'");
      } catch {
        /* the next change rewrites what it needs */
      }
      this.notices.push({ level: 'info', message: 'The customization undo history could not be read and was cleared. Your customization itself is unaffected.', detail: (err as Error).message.slice(0, 300) });
    }
  }

  private parseValue(v: unknown): CustomizationConfig {
    return validateConfig(migrateConfig(v).doc);
  }

  // ------------------------------------------------------------------ state

  state(): CustomizationState {
    const lg = this.slot('last_good');
    return {
      config: structuredClone(this.config),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label,
      redoLabel: this.redoStack.at(-1)?.label,
      hostTokens: this.hostTokens,
      hostReserved: [...this.hostReserved].map(([key, reason]) => ({ key, reason })),
      osReserved: [...osReserved(this.opts.platform ?? process.platform)].map(([key, reason]) => ({ key, reason })),
      backups: this.backupRows().map((b) => ({ slot: b.slot, savedMs: b.saved_ms, label: b.label ?? 'Backup' })),
      lastGoodMs: lg?.saved_ms,
    };
  }

  get current(): CustomizationConfig {
    return structuredClone(this.config);
  }

  /**
   * Stores a new configuration. `persistHistory` (undo/redo moving a step) is
   * written in the same transaction, and also when the configuration itself
   * turns out unchanged.
   */
  private commit(next: CustomizationConfig, label: string, opts: { key?: string; major?: boolean; history?: boolean; persistHistory?: () => void } = {}): void {
    const valid = validateConfig({ ...next, meta: { ...next.meta, updatedMs: this.now() } });
    if (this.sameConfig(valid, this.config)) {
      if (opts.persistHistory) this.db.tx(opts.persistHistory);
      return;
    }
    const before = this.config;
    const writes: Array<() => void> = [];
    if (opts.persistHistory) writes.push(opts.persistHistory);
    if (opts.history !== false) {
      const top = this.undoStack.at(-1);
      const t = this.now();
      if (opts.key && top?.key === opts.key && t - top.ms < (this.opts.coalesceMs ?? 1500)) {
        top.after = valid;
        top.ms = t;
        writes.push(() => this.saveStep(top, 'undo'));
      } else {
        const entry: StoredEntry = { before, after: valid, label, key: opts.key, ms: t };
        this.undoStack.push(entry);
        const dropped = this.undoStack.length > this.historyLimit ? this.undoStack.splice(0, this.undoStack.length - this.historyLimit) : [];
        writes.push(() => {
          this.saveStep(entry, 'undo');
          this.dropSteps(dropped);
        });
      }
      const cleared = this.redoStack;
      this.redoStack = [];
      writes.push(() => this.dropSteps(cleared));
    }
    this.db.tx(() => {
      if (opts.major) this.backup(before, `Before: ${label}`);
      this.write('last_good', before, label);
      this.write('active', valid, label);
      for (const w of writes) w();
    });
    this.config = valid;
    this.emit('changed', this.state());
  }

  /** Forgets the undo/redo history, optionally keeping one step (the full reset itself). */
  private clearHistory(keep?: StoredEntry): void {
    const drop = [...this.undoStack, ...this.redoStack].filter((e) => e !== keep);
    this.undoStack = keep ? [keep] : [];
    this.redoStack = [];
    this.db.tx(() => this.dropSteps(drop));
  }

  // ------------------------------------------------------------------ edits

  /** Apply one declarative change. Throws CustomizationError (with details) when it would be invalid or unsafe. */
  apply(op: CustomOp, ctx: { systemDark: boolean }): CustomizationState & { notice?: string } {
    if (op.op === 'setColor') {
      const probe = { ...this.config, appearance: { ...this.config.appearance, mode: op.mode } };
      const tokens = resolveCustomization(probe, { systemDark: op.mode === 'dark', hostTokens: this.hostTokens }).tokens;
      const check = checkTokenEdit(tokens, op.token, op.value);
      if (!check.ok) throw new CustomizationError(check.reason ?? 'That colour cannot be used.', check.suggestion ? [`Suggested readable alternative: ${check.suggestion}`] : []);
    }
    let result = applyOp(this.config, op, { systemDark: ctx.systemDark, now: this.now() });
    if (op.op === 'setShortcut') result = { ...result, config: this.checkShortcut(op.command, op.keys, result.config) };
    this.checkLayoutReachable(result.config, ctx);
    const topBefore = this.undoStack.at(-1);
    this.commit(result.config, result.label, { key: result.coalesceKey, major: result.major });
    if (op.op === 'resetAll') {
      // A full reset starts a fresh history; only the reset itself can still be undone.
      const top = this.undoStack.at(-1);
      this.clearHistory(top !== topBefore ? top : undefined);
      this.emit('changed', this.state());
    }
    return { ...this.state(), notice: result.notice };
  }

  /** Refuse layout edits that would leave no way to navigate, explaining what to keep instead. */
  private checkLayoutReachable(next: CustomizationConfig, ctx: { systemDark: boolean }): void {
    const before = new Set(resolveCustomization(this.config, { systemDark: ctx.systemDark }).adjustments.map((a) => a.path));
    const after = resolveCustomization(next, { systemDark: ctx.systemDark }).adjustments.filter((a) => a.path.startsWith('layout.') && !before.has(a.path));
    if (after.length) throw new CustomizationError(after[0]!.reason, ['Keep the sidebar or the address bar visible.']);
  }

  private defaultBindings(): Binding[] {
    return this.registry.map((c) => ({ command: c.id, keys: c.defaultKeys }));
  }

  private checkShortcut(command: string, keys: string[], next: CustomizationConfig): CustomizationConfig {
    const platform = this.opts.platform ?? process.platform;
    const canon = (k: string) => canonicalFor(platform, k);
    // Store user bindings in the platform's canonical spelling (Ctrl+X is Mod+X outside macOS).
    const own = [...new Set(keys.map(canon))];
    const bindings: Record<string, string[]> = { ...next.shortcuts.bindings, [command]: own };
    if (!this.registry.length) return { ...next, shortcuts: { bindings } }; // registry not reported yet (tests): syntax was still validated
    if (!this.registry.some((c) => c.id === command)) throw new CustomizationError(`“${command}” is not a Files command.`);
    const reserved = new Map([...osReserved(platform), ...this.hostReserved].map(([k, v]) => [canon(k), v] as [string, string]));
    const current = effectiveBindings(this.defaultBindings().map((b) => ({ ...b, keys: b.keys.map(canon) })), this.config.shortcuts.bindings).bindings;
    if (isMandatory.has(command) && own.length === 0) throw new CustomizationError('This command must keep a shortcut so it can always be reached.');
    for (const k of own) {
      const check = checkAssignment(command, k, current, reserved, { mandatory: isMandatory });
      if (!check.ok) throw new CustomizationError(check.reason ?? 'That shortcut cannot be used.');
      // Deterministic conflict resolution: the newest assignment wins; other user bindings lose that key.
      for (const [other, ks] of Object.entries(bindings)) if (other !== command && ks.map(canon).includes(check.value!)) bindings[other] = ks.filter((x) => canon(x) !== check.value);
    }
    return { ...next, shortcuts: { bindings } };
  }

  undo(): CustomizationState {
    const e = this.undoStack.pop();
    if (!e) throw new CustomizationError('There is nothing to undo.');
    this.redoStack.push(e);
    this.commit(e.before, `Undo: ${e.label}`, { history: false, persistHistory: () => this.saveStep(e, 'redo') });
    return this.state();
  }

  redo(): CustomizationState {
    const e = this.redoStack.pop();
    if (!e) throw new CustomizationError('There is nothing to redo.');
    this.undoStack.push(e);
    this.commit(e.after, `Redo: ${e.label}`, { history: false, persistHistory: () => this.saveStep(e, 'undo') });
    return this.state();
  }

  /** Go back to the configuration in use before the last change. */
  revertToLastGood(): CustomizationState {
    const lg = this.slot('last_good');
    if (!lg) throw new CustomizationError('There is no earlier configuration to return to.');
    this.commit(this.parseStored(lg.json), 'Reverted to the previous configuration', { major: true });
    return this.state();
  }

  restoreBackup(slot: string): CustomizationState {
    if (!slot.startsWith('backup:')) throw new CustomizationError('Not a backup.');
    const row = this.slot(slot);
    if (!row) throw new CustomizationError('That backup no longer exists.');
    this.commit(this.parseStored(row.json), `Restored backup from ${new Date(row.saved_ms).toLocaleString()}`, { major: true });
    return this.state();
  }

  // ------------------------------------------------------------------ portability

  exportJson(kind: ExportKind, id: string | undefined, ctx: { systemDark: boolean }): { json: string; fileName: string } {
    const effectiveLayout = kind === 'layout' ? resolveCustomization(this.config, { systemDark: ctx.systemDark }).layout : undefined;
    const env = exportCustomization(this.config, kind, { id, generator: this.opts.generator ?? 'Orbis Files', now: this.now(), effectiveLayout });
    const label = kind === 'theme' ? this.config.presets.find((p) => p.id === id)?.name : kind === 'workspace' ? this.config.workspaces.find((w) => w.id === (id ?? this.config.activeWorkspaceId))?.name : kind === 'view' ? this.config.savedViews.find((v) => v.id === id)?.name : undefined;
    return { json: `${JSON.stringify(env, null, 2)}\n`, fileName: suggestedFileName(kind, label) };
  }

  async readImport(file: string): Promise<{ text: string; fileName: string }> {
    const st = await fsp.stat(file);
    if (!st.isFile()) throw new CustomizationError('Choose a file.');
    if (st.size > 2 * 1024 * 1024) throw new CustomizationError('The file is larger than 2 MB; customization files are much smaller.');
    return { text: await fsp.readFile(file, 'utf8'), fileName: path.basename(file) };
  }

  previewImport(text: string, fileName: string): ImportPreview {
    const known = this.registry.length ? new Set(this.registry.map((c) => c.id)) : undefined;
    const p = previewImport(text, this.config, { fileName, now: this.now(), knownCommands: known });
    return { ...p, result: undefined };
  }

  /** Apply an import after validating it again (the file is re-read by the caller, never trusted from the preview). */
  applyImport(text: string, fileName: string): ImportPreview & CustomizationState {
    const known = this.registry.length ? new Set(this.registry.map((c) => c.id)) : undefined;
    const p = previewImport(text, this.config, { fileName, now: this.now(), knownCommands: known });
    if (!p.ok || !p.result) throw new CustomizationError(p.summary, p.errors.map((e) => `${e.path}: ${e.message}`));
    this.commit(p.result, `Imported ${fileName}`, { major: true });
    return { ...p, result: undefined, ...this.state() };
  }

  // ------------------------------------------------------------------ adapters

  setRegistry(commands: CommandDescriptor[]): void {
    this.registry = commands.slice(0, 1000);
  }

  commands(): CommandDescriptor[] {
    return structuredClone(this.registry);
  }

  /**
   * Design tokens from a host, for this session only. Validated; never written
   * into presets or the user's configuration. Invalid input keeps whatever was
   * in use before (the standalone theme, or earlier valid host tokens).
   */
  setHostTokens(raw: unknown): { accepted: string[]; rejected: Array<{ token: string; reason: string }>; error?: string } {
    const v = validateHostTokens(raw);
    if (!v.tokens) return { accepted: [], rejected: v.rejected, error: v.error };
    this.hostTokens = v.tokens;
    this.emit('changed', this.state());
    return { accepted: v.accepted, rejected: v.rejected };
  }

  clearHostTokens(): void {
    this.hostTokens = null;
    this.emit('changed', this.state());
  }

  setReservedShortcuts(raw: unknown): { reserved: number; rejected: string[] } {
    const v = validateReservedShortcuts(raw);
    const platform = this.opts.platform ?? process.platform;
    this.hostReserved = new Map([...v.reserved].map(([k, r]) => [canonicalFor(platform, k), r] as [string, string]));
    this.emit('changed', this.state());
    return { reserved: v.reserved.size, rejected: v.rejected };
  }
}
