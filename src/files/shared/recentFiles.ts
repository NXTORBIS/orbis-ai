import { z } from 'zod';

/**
 * Recent Files Panel: track recently opened/modified files with pinning and grouping.
 */

export const RecentFileSchema = z.object({
  id: z.string().min(1).max(128),
  path: z.string().min(1).max(32767),
  name: z.string().min(1).max(1024),
  ext: z.string().max(32),
  pinned: z.boolean(),
  lastAccessMs: z.number().int().nonnegative(),
  accessCount: z.number().int().nonnegative(),
});
export type RecentFile = z.infer<typeof RecentFileSchema>;

export type RecentGroup = 'today' | 'yesterday' | 'thisWeek' | 'older';

export function groupRecentFiles(files: RecentFile[]): Map<RecentGroup, RecentFile[]> {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);

  const groups = new Map<RecentGroup, RecentFile[]>([
    ['today', []], ['yesterday', []], ['thisWeek', []], ['older', []],
  ]);
  for (const f of files) {
    const t = f.lastAccessMs;
    if (t >= todayStart.getTime()) groups.get('today')!.push(f);
    else if (t >= yesterdayStart.getTime()) groups.get('yesterday')!.push(f);
    else if (t >= weekStart.getTime()) groups.get('thisWeek')!.push(f);
    else groups.get('older')!.push(f);
  }
  return groups;
}

export const GROUP_LABELS: Record<RecentGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This week',
  older: 'Older',
};
