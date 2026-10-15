import { useMemo, useState } from 'react';
import { call, errorShape } from '../../api';
import { app } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane } from '../../state/workspace';
import { Button, Dialog, Select, TextField, Toggle } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { FolderPicker } from './common';
import { formatTimeOfDay } from '../../ui/format';
import {
  DEFAULT_BACKUP_OPTIONS,
  DEFAULT_RETENTION,
  describeRetention,
  type BackupJob,
  type BackupOptions,
  type Retention,
} from '../../../shared/backup';
import { describeSchedule, ScheduleSchema, WEEKDAYS, type Schedule, type ScheduleKind } from '../../../shared/schedule';

/**
 * Dialogs of the Backups view: the job editor (folders, patterns, options,
 * retention, schedule) and the restore choice (original locations or another
 * folder). The schedule editor is shared with "Run on schedule" for sync pairs.
 */

const splitPatterns = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

const KINDS: Array<{ value: ScheduleKind; label: string }> = [
  { value: 'manual', label: 'Only when I choose Run now' },
  { value: 'interval', label: 'Every few hours' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'startup', label: 'When Orbis Files starts' },
];

/** Schedule fields. `onChange` receives the edited (possibly incomplete) schedule; validity is checked by the caller. */
export function ScheduleFields({ value, onChange, idPrefix, manualLabel }: { value: Schedule; onChange: (s: Schedule) => void; idPrefix: string; manualLabel?: string }) {
  const set = (patch: Partial<Schedule>) => onChange({ ...value, ...patch });
  const kinds = manualLabel ? KINDS.map((k) => (k.value === 'manual' ? { ...k, label: manualLabel } : k)) : KINDS;
  const check = ScheduleSchema.safeParse(value);
  return (
    <div className="schedule-fields">
      <div className="schedule-row">
        <Select<ScheduleKind> id={`${idPrefix}-kind`} label="Run" value={value.kind} options={kinds} onChange={(kind) => set({ kind, hours: kind === 'interval' ? value.hours ?? 6 : value.hours, time: kind === 'daily' || kind === 'weekly' ? value.time ?? '18:00' : value.time, day: kind === 'weekly' ? value.day ?? 1 : value.day })} />
        {value.kind === 'interval' && (
          <TextField id={`${idPrefix}-hours`} label="Hours between runs" type="number" min={1} max={744} value={String(value.hours ?? '')} onChange={(e) => set({ hours: e.target.value === '' ? undefined : Math.round(Number(e.target.value)) })} />
        )}
        {value.kind === 'weekly' && (
          <Select<string> id={`${idPrefix}-day`} label="Day" value={String(value.day ?? 1)} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} onChange={(d) => set({ day: Number(d) })} />
        )}
        {(value.kind === 'daily' || value.kind === 'weekly') && (
          <TextField id={`${idPrefix}-time`} label="Time" type="time" value={value.time ?? ''} onChange={(e) => set({ time: e.target.value || undefined })} />
        )}
      </div>
      {value.kind !== 'manual' && value.kind !== 'startup' && (
        <Toggle id={`${idPrefix}-catchup`} label="Catch up missed runs" description="When a run was missed because Orbis Files was closed or schedules were paused, run once as soon as possible (only once, however many were missed)." checked={value.catchUp} onChange={(catchUp) => set({ catchUp })} />
      )}
      <p className="muted small schedule-summary" aria-live="polite">
        {check.success ? `${describeSchedule(check.data, formatTimeOfDay)}.` : check.error.issues[0]?.message}
        {value.kind !== 'manual' && ' Schedules run only while Orbis Files is open.'}
      </p>
    </div>
  );
}

function NumberField({ id, label, value, onChange, hint }: { id: string; label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return <TextField id={id} label={label} type="number" min={0} max={10000} value={String(value)} hint={hint} onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))} />;
}

export function BackupJobEditor({ job, onClose, onSaved }: { job?: BackupJob; onClose: () => void; onSaved: (j: BackupJob) => void }) {
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'home')?.path ?? '/');
  const startDir = (() => {
    const l = activePane().history[activePane().index];
    return l?.kind === 'fs' ? l.path : home;
  })();
  const [name, setName] = useState(job?.name ?? '');
  const [sources, setSources] = useState<string[]>(job?.sources ?? [startDir]);
  const [addKey, setAddKey] = useState(0);
  const [destination, setDestination] = useState(job?.destination ?? '');
  const [opts, setOpts] = useState<BackupOptions>(job?.options ?? DEFAULT_BACKUP_OPTIONS);
  const [include, setInclude] = useState(job?.options.include.join(', ') ?? '');
  const [exclude, setExclude] = useState(job?.options.exclude.join(', ') ?? '');
  const [retention, setRetention] = useState<Retention>(job?.retention ?? DEFAULT_RETENTION);
  const [schedule, setSchedule] = useState<Schedule>(job?.schedule ?? { kind: 'manual', catchUp: true });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const effectiveName = name.trim() || (sources[0] ? baseName(sources[0]) : '');
  const scheduleOk = ScheduleSchema.safeParse(schedule).success;
  const problem = !sources.length ? 'Add at least one source folder.' : !destination ? 'Choose where the versions are kept.' : !scheduleOk ? 'Complete the schedule.' : !effectiveName ? 'Give the job a name.' : undefined;
  const retentionText = useMemo(() => describeRetention(retention), [retention]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await call<BackupJob>('backup:saveJob', {
        id: job?.id, name: effectiveName, sources, destination,
        options: { ...opts, include: splitPatterns(include), exclude: splitPatterns(exclude) }, retention, schedule,
      });
      onSaved(saved);
    } catch (err) {
      const e = errorShape(err);
      setError(e.cause && e.category === 'validation' && e.message === 'The request was not valid.' ? `${e.message} (${e.cause})` : e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title={job ? `Edit “${job.name}”` : 'New backup job'} onClose={onClose} width={680} className="backup-editor" footer={
      <>
        {problem && <span className="muted small grow">{problem}</span>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!!problem || saving} onClick={() => void save()}>{job ? 'Save changes' : 'Create job'}</Button>
      </>
    }>
      <div className="backup-form">
        <TextField id="bk-name" label="Name" value={name} placeholder={sources[0] ? baseName(sources[0]) : 'My documents'} onChange={(e) => setName(e.target.value)} />
        <fieldset className="backup-group">
          <legend>Folders</legend>
          <span className="field-label" id="bk-sources-label">Back up these folders</span>
          {sources.length ? (
            <ul className="backup-sources" aria-labelledby="bk-sources-label">
              {sources.map((s) => (
                <li key={s}>
                  <Icon name="folder" size={14} />
                  <span className="mono grow">{s}</span>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${s}`} onClick={() => setSources(sources.filter((x) => x !== s))}><Icon name="close" size={14} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">No folders yet.</p>}
          <FolderPicker key={addKey} id="bk-add-source" label="Add a folder" value="" onChange={(p) => {
            if (p && !sources.includes(p)) setSources([...sources, p]);
            setAddKey(addKey + 1); // an empty field for the next folder
          }} />
          <FolderPicker id="bk-destination" label="Keep the versions in (another drive or folder)" value={destination} onChange={setDestination} />
          <p className="muted small">The versions go into a folder named after the job inside this folder. It must not be inside a source folder, and no source may be inside it.</p>
        </fieldset>
        <fieldset className="backup-group">
          <legend>What to back up</legend>
          <div className="backup-grid">
            <TextField id="bk-include" label="Include only" mono placeholder="*.docx, photos/" value={include} onChange={(e) => setInclude(e.target.value)} hint="Patterns separated by commas. Empty: everything." />
            <TextField id="bk-exclude" label="Exclude" mono placeholder="*.tmp, node_modules/, .cache/" value={exclude} onChange={(e) => setExclude(e.target.value)} hint="Same patterns as Synchronize folders." />
          </div>
          <Toggle id="bk-hidden" label="Skip hidden items" description="Leaves out items whose name starts with a dot." checked={opts.skipHidden} onChange={(v) => setOpts({ ...opts, skipHidden: v })} />
          <Toggle id="bk-verify" label="Verify copies" description="Re-reads every new copy and compares its SHA-256 with the source. Slower." checked={opts.verify} onChange={(v) => setOpts({ ...opts, verify: v })} />
          <Toggle id="bk-compare" label="Compare contents" description="Also reads files whose size and modification time did not change, to catch changes that kept both. Reads every file on each run." checked={opts.compareContents} onChange={(v) => setOpts({ ...opts, compareContents: v })} />
        </fieldset>
        <fieldset className="backup-group">
          <legend>Versions to keep</legend>
          <div className="backup-grid three">
            <NumberField id="bk-keep-last" label="Last versions" value={retention.keepLast} onChange={(n) => setRetention({ ...retention, keepLast: n })} />
            <NumberField id="bk-keep-daily" label="One per day, days" value={retention.keepDailyDays} onChange={(n) => setRetention({ ...retention, keepDailyDays: n })} />
            <NumberField id="bk-keep-weekly" label="One per week, weeks" value={retention.keepWeeklyWeeks} onChange={(n) => setRetention({ ...retention, keepWeeklyWeeks: n })} />
          </div>
          <p className="small retention-summary" aria-live="polite"><strong>{retentionText}.</strong> <span className="muted">After each run, complete versions no rule keeps are removed from the backup store (each removal is logged). The newest version is always kept; all three at 0 keeps every version. Incomplete versions are never removed or counted.</span></p>
        </fieldset>
        <fieldset className="backup-group">
          <legend>Schedule</legend>
          <ScheduleFields idPrefix="bk-schedule" value={schedule} onChange={setSchedule} />
        </fieldset>
        {error && <p className="error-text small" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

export function RestoreDialog({ job, version, items, onClose, onRestore }: { job: BackupJob; version: string; items: string[]; onClose: () => void; onRestore: (target: { kind: 'original' } | { kind: 'folder'; path: string }) => void }) {
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'home')?.path ?? '/');
  const [kind, setKind] = useState<'original' | 'folder'>('original');
  const [folder, setFolder] = useState(home);
  const label = items.length === 1 ? `“${items[0]!.split('/').pop()}”` : `${items.length} items`;
  return (
    <Dialog title={`Restore ${label}`} onClose={onClose} width={560} className="backup-restore-dialog" footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="restore" disabled={kind === 'folder' && !folder} onClick={() => onRestore(kind === 'original' ? { kind } : { kind, path: folder })}>Restore</Button>
      </>
    }>
      <p className="muted small">From version <span className="mono">{version}</span> of “{job.name}”.</p>
      <div className="choice-list" role="radiogroup" aria-label="Restore to">
        <button type="button" role="radio" aria-checked={kind === 'original'} className={`choice ${kind === 'original' ? 'is-on' : ''}`} onClick={() => setKind('original')}>
          <strong>Original location</strong><span>Back into the folder each item was backed up from.</span>
        </button>
        <button type="button" role="radio" aria-checked={kind === 'folder'} className={`choice ${kind === 'folder' ? 'is-on' : ''}`} onClick={() => setKind('folder')}>
          <strong>Another folder</strong><span>Each selected item is put inside the folder you choose.</span>
        </button>
      </div>
      {kind === 'folder' && <FolderPicker id="bk-restore-to" label="Restore into" value={folder} onChange={setFolder} />}
      <p className="muted small">Nothing is overwritten silently: when an item is already there, you choose Keep both, Skip or Replace (the item there goes to the Trash first). Each restored file is checked against the backup’s SHA-256.</p>
      <ul className="backup-restore-items small">
        {items.slice(0, 6).map((i) => <li key={i} className="mono">{i}</li>)}
        {items.length > 6 && <li className="muted">…and {items.length - 6} more</li>}
      </ul>
    </Dialog>
  );
}
