import { call, on } from '../api';
import { createStore } from './store';
import { toast, toastError } from './app';
import { activePane, navigate } from './workspace';

/**
 * Renderer view of rule automation (main: tools/automation.ts): whether it is
 * paused, which rules run automatically, and a toast per automatic batch.
 */

export interface AutomationStatus {
  paused: boolean;
  rules: Array<{ id: string; name: string; folders: string[]; active: boolean; problem?: string; unavailable: string[] }>;
  watching: string[];
  pending: number;
  limits: { stableMs: number; maxActionsPerMinute: number };
  actionsLastMinute: number;
  throttled: boolean;
  waiting: number;
}

interface ActivityEvent {
  ruleId: string;
  ruleName: string;
  runId?: string;
  action: 'move' | 'copy' | 'tag' | 'collect';
  files: string[];
  operationId?: string;
  state: 'started' | 'finished' | 'failed';
  done?: number;
  skipped?: number;
  failed?: number;
  message?: string;
  notice?: { level: 'info' | 'warning'; message: string };
}

export const automation = createStore<{ status: AutomationStatus | null; activitySeq: number }>({ status: null, activitySeq: 0 });

let started = false;

/** Load the status and follow changes (once per window). */
export function followAutomation(): void {
  if (started) return;
  started = true;
  const load = () => void call<AutomationStatus>('automation:status').then((status) => automation.set({ status }), () => undefined);
  load();
  on<AutomationStatus>('automation:changed', (status) => automation.set({ status }));
  on<ActivityEvent>('automation:activity', (a) => {
    automation.set((s) => ({ activitySeq: s.activitySeq + 1 }));
    if (a.notice) {
      toast({ level: a.notice.level, title: 'Automation', detail: a.notice.message });
      return;
    }
    if (a.state === 'started') return;
    const verb = { move: 'Moved', copy: 'Copied', tag: 'Tagged', collect: 'Added to a collection:' }[a.action];
    const n = a.done ?? 0;
    if (a.state === 'failed') toast({ level: 'error', title: `Rule “${a.ruleName}” could not run automatically`, detail: a.message });
    else if (n || a.skipped || a.failed) {
      toast({
        level: a.failed ? 'warning' : 'success',
        title: `${verb} ${n} new file${n === 1 ? '' : 's'} automatically`,
        detail: `Rule “${a.ruleName}”${a.skipped ? ` · ${a.skipped} skipped (name already taken)` : ''}${a.failed ? ` · ${a.failed} failed` : ''}`,
        actions: [{ label: 'Show activity', run: () => void navigate(activePane().id, { kind: 'tool', tool: 'rules' }) }],
      });
    }
  });
}

export async function setAutomationPaused(paused: boolean): Promise<void> {
  try {
    const status = await call<AutomationStatus>('automation:setPaused', { paused });
    automation.set({ status });
    toast({ level: 'info', title: paused ? 'Automation paused' : 'Automation resumed', detail: paused ? 'Rules will not run on new files until you resume. Files that arrive meanwhile are not processed later.' : 'Rules run on new files again.' });
  } catch (err) {
    toastError(err);
  }
}
