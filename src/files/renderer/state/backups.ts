import { call, on } from '../api';
import { createStore } from './store';
import { toast, toastError } from './app';
import { activePane, navigate } from './workspace';
import type { ScheduleStatus } from '../../shared/schedule';

/**
 * Renderer view of the scheduler (backup jobs and scheduled sync pairs):
 * whether schedules are paused, each task's next run, and a toast for the
 * outcome of every scheduled run. `seq` changes whenever backup jobs or their
 * versions change, so open views reload.
 */

interface BackupRunEvent {
  jobId: string;
  jobName: string;
  operationId: string;
  state: string;
  scheduled: boolean;
  level: 'success' | 'warning' | 'error' | 'info';
  message: string;
}

interface SyncScheduleEvent {
  pairId: string;
  pairName: string;
  level: 'success' | 'info' | 'warning' | 'error';
  outcome: string;
  message: string;
}

export const schedules = createStore<{ status: ScheduleStatus | null; seq: number }>({ status: null, seq: 0 });

let started = false;

export function followSchedules(): void {
  if (started) return;
  started = true;
  void call<ScheduleStatus>('schedule:status').then((status) => schedules.set({ status }), () => undefined);
  on<ScheduleStatus>('schedule:changed', (status) => schedules.set((s) => ({ status, seq: s.seq + 1 })));
  on('backup:changed', () => schedules.set((s) => ({ seq: s.seq + 1 })));
  on<BackupRunEvent>('backup:activity', (ev) => {
    schedules.set((s) => ({ seq: s.seq + 1 }));
    // Runs started with "Run now" are reported by the operation itself; scheduled ones get their own toast.
    if (!ev.scheduled) return;
    toast({
      level: ev.level, title: `Scheduled backup “${ev.jobName}” ${ev.state === 'completed' ? 'finished' : ev.state === 'cancelled' ? 'stopped' : ev.state === 'failed' ? 'failed' : 'finished with problems'}`,
      detail: ev.message, actions: [{ label: 'Show backups', run: () => void navigate(activePane().id, { kind: 'tool', tool: 'backups' }) }],
    });
  });
  on<SyncScheduleEvent>('schedule:activity', (ev) => {
    schedules.set((s) => ({ seq: s.seq + 1 }));
    if (ev.outcome === 'nothing') return;
    toast({
      level: ev.level, title: ev.outcome === 'synced' ? `Scheduled sync “${ev.pairName}” finished` : ev.outcome === 'failed' ? `Scheduled sync “${ev.pairName}” failed` : `Scheduled sync “${ev.pairName}” did not run`,
      detail: ev.message, sticky: ev.outcome !== 'synced',
      actions: [{ label: 'Open Synchronize', run: () => void navigate(activePane().id, { kind: 'tool', tool: 'sync' }) }],
    });
  });
}

export async function setSchedulesPaused(paused: boolean): Promise<void> {
  try {
    const status = await call<ScheduleStatus>('schedule:setPaused', { paused });
    schedules.set({ status });
    toast({ level: 'info', title: paused ? 'Schedules paused' : 'Schedules resumed', detail: paused ? 'Scheduled backups and synchronizations do not start until you resume. Running ones continue.' : 'Runs that were missed while paused start once now when their schedule allows catching up.' });
  } catch (err) {
    toastError(err);
  }
}
