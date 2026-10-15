import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppDatabase } from '../store/Database';
import { matches, parseQuery, type EvalContext } from '../search/query';
import { runSearch } from '../search/SearchEngine';
import type { FileEntry } from '../../shared/model';
import { makeError } from '../../shared/errors';
import { isWithin } from '../fs/paths';
import { exists } from '../fs/FileSystemService';
import type { OperationManager } from '../ops/OperationManager';
import type { Catalog } from '../store/Catalog';

/**
 * Organising rules. A rule = scope + condition (query language) + optional
 * exclusion + one action. By default rules never run silently: `dryRun` lists
 * every proposed change, and only the items the user approves are executed
 * through the operation engine or catalogue (`applyRule`).
 *
 * A rule can opt in to running automatically on new files in chosen folders
 * (tools/automation.ts). That is allowed only for non-destructive actions and
 * only after the user has applied this exact rule definition by hand at least
 * once (`isApproved`); editing what the rule matches or does turns automation
 * off until it is applied by hand again.
 */

export const RuleSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(128),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(100),
  scope: z.string().min(1).max(4096),
  recursive: z.boolean().default(false),
  condition: z.string().min(1).max(2000),
  exclusion: z.string().max(2000).default(''),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('move'), toDir: z.string().min(1).max(4096) }),
    z.object({ type: z.literal('copy'), toDir: z.string().min(1).max(4096) }),
    z.object({ type: z.literal('tag'), tag: z.string().min(1).max(64) }),
    z.object({ type: z.literal('collect'), collectionId: z.string().min(1).max(128) }),
  ]),
  /** Opt-in automation: run on new files that appear in these folders while Orbis Files is open. */
  automatic: z
    .object({ enabled: z.boolean().default(false), folders: z.array(z.string().min(1).max(4096)).max(16).default([]) })
    .default({ enabled: false, folders: [] }),
});
export type Rule = z.infer<typeof RuleSchema> & { id: string };
export type RuleAction = Rule['action'];

/**
 * Actions a rule may perform automatically. All of them keep every file
 * (move, copy) or only add catalogue data (tag, collection); anything that
 * deletes or replaces is never automatic.
 */
export const AUTOMATIC_ACTIONS: ReadonlySet<string> = new Set(['move', 'copy', 'tag', 'collect']);

/** Identity of what a rule matches and does (not its name, priority or automation settings). */
export function definitionHash(rule: Pick<Rule, 'scope' | 'recursive' | 'condition' | 'exclusion' | 'action'>): string {
  const { scope, recursive, condition, exclusion, action } = rule;
  return crypto.createHash('sha256').update(JSON.stringify({ scope, recursive, condition, exclusion, action })).digest('hex');
}

export interface RuleRunResult {
  applied: number;
  failed: string[];
  operationId?: string;
  paths?: string[];
  action?: RuleAction;
  /** Hash of the rule definition this run applied (see definitionHash). */
  definitionHash?: string;
  /** Run started by automation (not approved item by item). */
  automatic?: boolean;
  /** Automatic runs: final outcome once the operation finished. */
  outcome?: { state: string; done: number; skipped: number; failed: number; finishedMs: number };
  rolledBackMs?: number;
  rollback?: unknown;
}

export interface DryRunItem {
  path: string;
  name: string;
  action: Rule['action'];
  destination?: string;
  status: 'ready' | 'conflict' | 'already-there' | 'excluded';
  reason?: string;
}

export interface DryRunResult { ruleId: string; items: DryRunItem[]; complete: boolean; notes: string[] }

export class RulesEngine {
  constructor(private readonly db: AppDatabase) {}

  list(): Rule[] {
    return this.db
      .all<{ id: string; definition: string }>('SELECT id, definition FROM rules')
      .map((r) => {
        const parsed = RuleSchema.safeParse(JSON.parse(r.definition));
        return parsed.success ? ({ ...parsed.data, id: r.id } as Rule) : undefined;
      })
      .filter((r): r is Rule => !!r)
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }

  get(id: string): Rule {
    const r = this.list().find((x) => x.id === id);
    if (!r) throw makeError('not_found', 'rules.get', { message: 'Rule not found.' });
    return r;
  }

  save(input: unknown): Rule {
    const parsed = RuleSchema.parse(input);
    parseQuery(parsed.condition); // throws QueryError with a position if invalid
    if (parsed.exclusion) parseQuery(parsed.exclusion);
    if (!path.isAbsolute(parsed.scope)) throw makeError('invalid_path', 'rules.save', { message: 'The rule folder must be an absolute path.' });
    if ((parsed.action.type === 'move' || parsed.action.type === 'copy') && !path.isAbsolute(parsed.action.toDir)) {
      throw makeError('invalid_path', 'rules.save', { message: 'The destination must be an absolute path.' });
    }
    if (parsed.automatic.folders.some((f) => !path.isAbsolute(f))) throw makeError('invalid_path', 'rules.save', { message: 'Folders watched for new files must be absolute paths.' });
    const id = parsed.id ?? crypto.randomUUID();
    const rule = { ...parsed, id, automatic: { enabled: parsed.automatic.enabled, folders: [...new Set(parsed.automatic.folders.map((f) => path.resolve(f)))] } } as Rule;
    if (rule.automatic.enabled) {
      const before = parsed.id ? this.list().find((x) => x.id === parsed.id) : undefined;
      const problem = this.automationProblem(rule);
      if (problem) {
        // Editing what an automatic rule matches or does switches automation off until it is applied by hand again.
        if (before?.automatic.enabled) rule.automatic = { ...rule.automatic, enabled: false };
        else throw makeError('validation', 'rules.save', { message: problem });
      }
    }
    this.db.run('INSERT INTO rules(id, definition, updated_ms) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET definition = excluded.definition, updated_ms = excluded.updated_ms', [id, JSON.stringify(rule), Date.now()]);
    return rule;
  }

  delete(id: string): void {
    this.db.run('DELETE FROM rules WHERE id = ?', [id]);
  }

  /** Whether this exact rule definition was applied by hand at least once. */
  isApproved(rule: Rule): boolean {
    const hash = definitionHash(rule);
    return this.runs(rule.id, 500).some((r) => {
      const res = r.result as RuleRunResult;
      return !res.automatic && res.definitionHash === hash && res.applied > 0;
    });
  }

  /** Why this rule cannot run automatically (undefined when it can). */
  automationProblem(rule: Rule): string | undefined {
    if (!AUTOMATIC_ACTIONS.has(rule.action.type)) return 'Only rules that move, copy, tag or add to a collection can run automatically.';
    if (!rule.enabled) return 'Enable the rule first.';
    if (!rule.automatic.folders.length) return 'Choose at least one folder to watch for new files.';
    if (!this.isApproved(rule)) return 'Preview and apply this rule by hand at least once (and again after any change to what it matches or does) before it can run automatically.';
    return undefined;
  }

  /** Turn automation on or off for one rule (checked like save). */
  setAutomatic(id: string, enabled: boolean, folders?: string[]): Rule {
    const rule = this.get(id);
    return this.save({ ...rule, automatic: { enabled, folders: folders ?? rule.automatic.folders } });
  }

  async dryRun(id: string, ctx: EvalContext, signal: AbortSignal): Promise<DryRunResult> {
    const rule = this.get(id);
    const cond = parseQuery(rule.condition);
    const excl = rule.exclusion ? parseQuery(rule.exclusion) : undefined;
    const notes: string[] = [];
    const found: FileEntry[] = [];
    const scopeSt = await fsp.stat(rule.scope).catch(() => undefined);
    if (!scopeSt?.isDirectory()) throw makeError('unavailable', 'rules.dryRun', { message: 'The rule folder is not available.', target: rule.scope });
    const report = await runSearch(cond, [rule.scope], { showHidden: false, signal, onBatch: (b) => found.push(...b), ctx, useIndex: false });
    notes.push(...report.notes);
    const items: DryRunItem[] = [];
    for (const e of found) {
      if (!rule.recursive && path.dirname(e.path) !== path.resolve(rule.scope)) continue;
      if (e.kind === 'directory' && (rule.action.type === 'move' || rule.action.type === 'copy')) continue;
      if ((rule.action.type === 'move' || rule.action.type === 'copy') && isWithin(rule.action.toDir, e.path)) continue;
      const item: DryRunItem = { path: e.path, name: e.name, action: rule.action, status: 'ready' };
      if (excl) {
        if (matches(excl, { path: e.path, name: e.name, ext: e.ext, kind: e.kind, size: e.size, modifiedMs: e.modifiedMs, createdMs: e.createdMs }, ctx)) {
          item.status = 'excluded';
          item.reason = 'Matches the exclusion.';
        }
      }
      if (item.status === 'ready' && (rule.action.type === 'move' || rule.action.type === 'copy')) {
        item.destination = path.join(rule.action.toDir, e.name);
        if (await fsp.lstat(item.destination).then(() => true, () => false)) {
          item.status = 'conflict';
          item.reason = 'An item with this name already exists at the destination. It will be skipped unless you resolve it.';
        }
      }
      items.push(item);
    }
    return { ruleId: id, items, complete: report.complete, notes };
  }

  recordRun(ruleId: string, result: unknown): string {
    const id = crypto.randomUUID();
    this.db.run('INSERT INTO rule_runs(id, rule_id, ran_ms, result) VALUES(?, ?, ?, ?)', [id, ruleId, Date.now(), JSON.stringify(result)]);
    return id;
  }

  /** Merge fields into a recorded run's result (automatic runs add their outcome when the operation ends). */
  updateRun(runId: string, patch: Partial<RuleRunResult>): void {
    const row = this.db.get<{ result: string }>('SELECT result FROM rule_runs WHERE id = ?', [runId]);
    if (!row) return;
    this.db.run('UPDATE rule_runs SET result = ? WHERE id = ?', [JSON.stringify({ ...(JSON.parse(row.result) as object), ...patch }), runId]);
  }

  markRolledBack(runId: string, detail: unknown): void {
    const row = this.db.get<{ result: string }>('SELECT result FROM rule_runs WHERE id = ?', [runId]);
    if (!row) throw makeError('not_found', 'rules.rollback', { message: 'That run was not found.' });
    const result = JSON.parse(row.result) as Record<string, unknown>;
    this.db.run('UPDATE rule_runs SET result = ? WHERE id = ?', [JSON.stringify({ ...result, rolledBackMs: Date.now(), rollback: detail }), runId]);
  }

  runs(ruleId: string, limit = 50): Array<{ id: string; ranMs: number; result: unknown }> {
    return this.db
      .all<{ id: string; ran_ms: number; result: string }>('SELECT id, ran_ms, result FROM rule_runs WHERE rule_id = ? ORDER BY ran_ms DESC LIMIT ?', [ruleId, limit])
      .map((r) => ({ id: r.id, ranMs: r.ran_ms, result: JSON.parse(r.result) }));
  }

  /** Automatic runs of every rule, newest first (the automation activity log). */
  automaticRuns(limit = 200): Array<{ id: string; ruleId: string; ruleName: string; ranMs: number; result: RuleRunResult }> {
    const names = new Map(this.list().map((r) => [r.id, r.name]));
    const out: Array<{ id: string; ruleId: string; ruleName: string; ranMs: number; result: RuleRunResult }> = [];
    const rows = this.db.all<{ id: string; rule_id: string; ran_ms: number; result: string }>('SELECT id, rule_id, ran_ms, result FROM rule_runs ORDER BY ran_ms DESC LIMIT 5000');
    for (const r of rows) {
      let result: RuleRunResult;
      try {
        result = JSON.parse(r.result) as RuleRunResult;
      } catch {
        continue;
      }
      if (!result.automatic) continue;
      out.push({ id: r.id, ruleId: r.rule_id, ruleName: names.get(r.rule_id) ?? '(deleted rule)', ranMs: r.ran_ms, result });
      if (out.length >= limit) break;
    }
    return out;
  }
}

/**
 * Apply a rule to items (paths checked by a dry run and approved, or new files
 * found by automation). Moves and copies are one operation; tags and
 * collection entries are catalogue changes. Every application is recorded as
 * a run with the rule's definition hash, so it can be undone. Manual runs ask
 * about name conflicts; automatic runs skip them (nobody is there to answer,
 * and nothing is ever replaced).
 */
export async function applyRule(
  deps: { rules: RulesEngine; ops: OperationManager; catalog: Catalog },
  rule: Rule,
  paths: string[],
  opts: { automatic?: boolean } = {},
): Promise<{ operationId?: string; applied: number; failed: string[]; runId?: string }> {
  const result: { operationId?: string; applied: number; failed: string[] } = { applied: 0, failed: [] };
  if (!paths.length) return result;
  if (opts.automatic && !AUTOMATIC_ACTIONS.has(rule.action.type)) throw makeError('permission_denied', 'rules.auto', { message: 'This action is never run automatically.' });
  const action = rule.action;
  if (action.type === 'move' || action.type === 'copy') {
    const rec = deps.ops.start({
      type: action.type,
      sources: paths,
      destination: action.toDir,
      conflictPolicy: opts.automatic ? 'skip' : 'ask',
      origin: `${opts.automatic ? 'rule-auto' : 'rule'}:${rule.id}`,
    });
    result.operationId = rec.id;
    result.applied = paths.length;
  } else if (action.type === 'tag') {
    const tag = deps.catalog.tags().find((t) => t.name.toLowerCase() === action.tag.toLowerCase()) ?? deps.catalog.createTag(action.tag);
    const r = await deps.catalog.tagItems(tag.id, paths);
    result.applied = r.tagged;
    result.failed = r.failed;
  } else {
    const r = await deps.catalog.addToCollection(action.collectionId, paths);
    result.applied = r.added;
    result.failed = r.failed;
  }
  const record: RuleRunResult = { ...result, action, paths, definitionHash: definitionHash(rule), automatic: !!opts.automatic };
  const runId = deps.rules.recordRun(rule.id, record);
  return { ...result, runId };
}

/**
 * Undo one rule run. Moves are moved back (per original folder, asking before
 * overwriting anything), copies are moved to the Trash, tags and collection
 * entries are removed. Items that changed or disappeared since are reported,
 * not forced. A run can be undone once.
 */
export async function rollbackRuleRun(deps: { rules: RulesEngine; ops: OperationManager; catalog: Catalog }, ruleId: string, runId: string): Promise<{ operations: string[]; undone: number; notes: string[] }> {
  const run = deps.rules.runs(ruleId, 5000).find((r) => r.id === runId);
  if (!run) throw makeError('not_found', 'rules.rollback', { message: 'That run was not found.' });
  const result = run.result as { operationId?: string; paths?: string[]; action?: Rule['action']; rolledBackMs?: number };
  if (result.rolledBackMs) throw makeError('validation', 'rules.rollback', { message: 'This run was already undone.' });
  const action = result.action ?? deps.rules.get(ruleId).action;
  const origin = `rule-undo:${ruleId}`;
  const out: { operations: string[]; undone: number; notes: string[] } = { operations: [], undone: 0, notes: [] };
  if (action.type === 'move' || action.type === 'copy') {
    const op = result.operationId ? deps.ops.get(result.operationId) : undefined;
    if (!op) throw makeError('unavailable', 'rules.rollback', { message: 'The operation record for this run is no longer available, so it cannot be undone automatically.' });
    if (!['completed', 'completed_with_errors', 'cancelled', 'failed', 'interrupted'].includes(op.state)) throw makeError('busy', 'rules.rollback', { message: 'The run is still in progress. Undo it when it has finished.' });
    const present: Array<{ source: string; destination: string }> = [];
    for (const r of op.results.filter((x) => x.status === 'done' && x.destination)) {
      if (await exists(r.destination!)) present.push({ source: r.source, destination: r.destination! });
      else out.notes.push(`${path.basename(r.destination!)} is no longer at ${path.dirname(r.destination!)}.`);
    }
    if (action.type === 'move') {
      const byDir = new Map<string, string[]>();
      for (const r of present) {
        byDir.set(path.dirname(r.source), [...(byDir.get(path.dirname(r.source)) ?? []), r.destination]);
        if (path.basename(r.source) !== path.basename(r.destination)) out.notes.push(`${path.basename(r.destination)} was renamed when it was moved and keeps that name.`);
      }
      for (const [dir, sources] of byDir) {
        if (!(await exists(dir))) {
          out.notes.push(`The original folder ${dir} no longer exists; ${sources.length} item(s) were left where they are.`);
          continue;
        }
        out.operations.push(deps.ops.start({ type: 'move', sources, destination: dir, conflictPolicy: 'ask', origin }).id);
        out.undone += sources.length;
      }
    } else if (present.length) {
      out.operations.push(deps.ops.start({ type: 'trash', sources: present.map((r) => r.destination), origin }).id);
      out.undone = present.length;
    }
  } else if (action.type === 'tag') {
    const tag = deps.catalog.tags().find((t) => t.name.toLowerCase() === action.tag.toLowerCase());
    if (tag) out.undone = deps.catalog.untagItems(tag.id, result.paths ?? []);
  } else {
    const ids = (result.paths ?? []).map((x) => deps.catalog.itemByPath(x)?.id).filter((x): x is string => !!x);
    out.undone = deps.catalog.removeFromCollection(action.collectionId, ids);
  }
  deps.rules.markRolledBack(runId, out);
  return out;
}
