import { z } from 'zod';

/**
 * Schedules for work that runs while Orbis Files is open (backup jobs, saved
 * sync pairs). Times are local wall-clock times. The scheduler itself lives in
 * src/main/schedule; this module holds the validated shape and the pure
 * "when is the next run" arithmetic shared with the window.
 */

export const SCHEDULE_KINDS = ['manual', 'interval', 'daily', 'weekly', 'startup'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** "HH:MM", 24-hour clock. */
export const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 09:30.');

export const ScheduleSchema = z
  .object({
    kind: z.enum(SCHEDULE_KINDS).default('manual'),
    /** interval: hours between runs. */
    hours: z.number().int().min(1).max(24 * 31).optional(),
    /** daily / weekly: local time of day. */
    time: TimeOfDaySchema.optional(),
    /** weekly: 0 = Sunday … 6 = Saturday. */
    day: z.number().int().min(0).max(6).optional(),
    /** When a run was missed while Orbis Files was closed (or schedules were paused), run once as soon as possible. */
    catchUp: z.boolean().default(true),
  })
  .superRefine((s, ctx) => {
    if (s.kind === 'interval' && s.hours === undefined) ctx.addIssue({ code: 'custom', path: ['hours'], message: 'Choose how many hours between runs.' });
    if ((s.kind === 'daily' || s.kind === 'weekly') && !s.time) ctx.addIssue({ code: 'custom', path: ['time'], message: 'Choose a time of day.' });
    if (s.kind === 'weekly' && s.day === undefined) ctx.addIssue({ code: 'custom', path: ['day'], message: 'Choose a day of the week.' });
  });
export type Schedule = z.infer<typeof ScheduleSchema>;
export type ScheduleInput = z.input<typeof ScheduleSchema>;
export const MANUAL_SCHEDULE: Schedule = { kind: 'manual', catchUp: true };

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function parseTime(t: string | undefined): { h: number; m: number } {
  const [h, m] = (t ?? '00:00').split(':').map(Number);
  return { h: h ?? 0, m: m ?? 0 };
}

/**
 * The first time the schedule fires strictly after `afterMs` (local time), or
 * undefined for schedules without clock times (manual, on start).
 * Interval schedules count from `afterMs` (the last run, or when the schedule was set).
 */
export function nextOccurrence(s: Schedule, afterMs: number): number | undefined {
  switch (s.kind) {
    case 'interval':
      return afterMs + (s.hours ?? 24) * 3_600_000;
    case 'daily':
    case 'weekly': {
      const { h, m } = parseTime(s.time);
      const d = new Date(afterMs);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
      // Walk forward day by day (handles daylight-saving changes through the Date constructor).
      for (let i = 0; i < 8; i++) {
        const c = new Date(at.getFullYear(), at.getMonth(), at.getDate() + i, h, m, 0, 0);
        if (c.getTime() <= afterMs) continue;
        if (s.kind === 'weekly' && c.getDay() !== s.day) continue;
        return c.getTime();
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Plain-language summary: "Every 6 hours", "Daily at 09:30", "Mondays at 18:00", "When Orbis Files starts".
 * `timeLabel` formats "HH:MM" for display (the window passes the user's locale format).
 */
export function describeSchedule(s: Schedule, timeLabel: (hhmm: string) => string = (t) => t): string {
  switch (s.kind) {
    case 'interval':
      return s.hours === 1 ? 'Every hour' : `Every ${s.hours} hours`;
    case 'daily':
      return `Daily at ${timeLabel(s.time ?? '00:00')}`;
    case 'weekly':
      return `${WEEKDAYS[s.day ?? 0]}s at ${timeLabel(s.time ?? '00:00')}`;
    case 'startup':
      return 'When Orbis Files starts';
    default:
      return 'Only when you run it';
  }
}

/** One scheduled task as reported to the window. */
export interface ScheduledTaskStatus {
  id: string;
  /** 'backup' or 'sync', and the job or pair id. */
  kind: 'backup' | 'sync';
  targetId: string;
  label: string;
  schedule: Schedule;
  nextRunMs?: number;
  lastRunMs?: number;
  running: boolean;
}

export interface ScheduleStatus {
  paused: boolean;
  tasks: ScheduledTaskStatus[];
}
