import { createStore } from './store';
import { call, on } from '../api';
import { app, confirm, openDialog, toastError } from './app';
import { parentPath } from './workspace';
import { startOperation } from '../actions';
import { actionItems, type CustomAction, type EntryLike } from '../../shared/customActions';

/**
 * Custom actions in the renderer: the list (from the main process, which
 * stores them per profile) and running one. A run is a 'custom-action'
 * operation that only names the action; what runs is read from the stored
 * definition in the main process.
 */

export const customActions = createStore<{ list: CustomAction[]; loaded: boolean }>({ list: [], loaded: false });

let subscribed = false;
export async function loadCustomActions(): Promise<void> {
  if (!subscribed) {
    subscribed = true;
    on<{ actions: CustomAction[] }>('actions:changed', (e) => customActions.set({ list: e.actions, loaded: true }));
  }
  try {
    customActions.set({ list: await call<CustomAction[]>('actions:list'), loaded: true });
  } catch (err) {
    toastError(err, 'Custom actions could not be read');
  }
}

interface PlanReply { action: CustomAction; runs: Array<{ label: string; command: string; cwd: string; items: number }>; total: number }

/** Run an action on a selection (or on the folder shown when nothing is selected). */
export async function runCustomAction(action: CustomAction, selection: EntryLike[], dir: string | undefined): Promise<void> {
  const items = actionItems(selection, dir);
  const folder = dir ?? parentPath(items[0]?.path ?? '') ?? items[0]?.path;
  if (!items.length || !folder) return;
  const paths = items.map((i) => i.path);
  if (action.confirm) {
    let plan: PlanReply;
    try {
      plan = await call<PlanReply>('actions:plan', { id: action.id, paths, folder });
    } catch (err) {
      toastError(err, `“${action.name}” cannot run`);
      return;
    }
    const cwds = [...new Set(plan.runs.map((r) => r.cwd))];
    const ok = await confirm({
      title: `Run “${action.name}”?`,
      body: `${plan.total === 1 ? 'This runs once' : `This runs ${plan.total} times, one after another`}${action.shell ? ', through the system shell' : ', without a shell'}, in ${cwds.length === 1 ? cwds[0] : `${cwds.length} folders`}. It may change files; it stops after ${action.timeoutSec} s. The output is kept in Operations.`,
      detail: [...plan.runs.slice(0, 12).map((r) => r.command), ...(plan.total > 12 ? [`…and ${plan.total - 12} more`] : [])],
      confirmLabel: 'Run',
    });
    if (!ok) return;
  }
  const rec = await startOperation({ type: 'custom-action', sources: paths, params: { actionId: action.id, folder }, origin: 'action' });
  if (rec && action.showOutput) showOutputWhenDone(rec.id);
}

/** Open the output once the run finishes (unless another dialog is open by then). */
function showOutputWhenDone(id: string): void {
  const unsub = app.subscribe(() => {
    const rec = app.get().ops[id];
    if (!rec || !['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'].includes(rec.state)) return;
    unsub();
    if (!app.get().dialog && rec.output) openDialog('actionOutput', { opId: id });
  });
}
