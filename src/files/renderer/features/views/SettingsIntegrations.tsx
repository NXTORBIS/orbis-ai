// @ts-nocheck -- vendored Orbis Files code; its duplicated Orbis options were removed
import { useEffect, useState, type ReactNode } from 'react';
import { call, on } from '../../api';
import { app, confirm, opsActive, prompt, resetSetting, setSetting, toast, toastError } from '../../state/app';
import { DEFAULT_SETTINGS, type SettingKey } from '../../../shared/settings';
import { useStore } from '../../state/store';
import { Button, EmptyState, Pill, Segmented, TextField, Toggle } from '../../ui/components';
import { formatBytes, formatDate } from '../../ui/format';
import { FolderPicker } from './common';
import { aiState, shortcutConflicts, COMMANDS, keyLabel, shortcutFor as shortcutLabel } from '../../commands';
import { activePane, navigate } from '../../state/workspace';
import type { Location } from '../../../shared/model';
import { useCustom } from '../../state/custom';
import { openStudio } from '../studio/studioState';
import { refreshTemplates, templates } from '../../state/templates';
import { HOME_SECTION_LABELS } from './homeSections';
import { CustomActionsSection } from '../CustomActions';
import { refreshTerminalInfo, terminal } from '../../state/terminal';
import { Icon } from '../../ui/Icon';
import { OcrSettings } from '../ocr/OcrSettings';

/* ---------------------------------------------------------------- settings */

/**
 * Entry point to the Customization Studio from Settings. Appearance, layout,
 * workspaces, views, toolbars, menus, shortcuts and accessibility are managed
 * there (one implementation); Settings keeps behaviour and safety options.
 */
function CustomizationEntry() {
  const r = useCustom((x) => ({ preset: x.preset?.name, workspace: x.workspace.name, mode: x.appearance.mode, scale: x.accessibility.interfaceScale }));
  const links: Array<[string, string, string]> = [['appearance', 'Appearance', 'palette'], ['colors', 'Colours', 'contrast'], ['layout', 'Layout', 'layout'], ['workspaces', 'Workspaces', 'workspace'], ['views', 'File views', 'viewDetails'], ['shortcuts', 'Keyboard shortcuts', 'keyboard'], ['accessibility', 'Accessibility', 'accessibility'], ['portability', 'Import & export', 'importFile']];
  return (
    <section className="settings-group">
      <h2>Appearance and customization</h2>
      <p className="muted">Theme <strong>{r.preset ?? 'custom'}</strong> ({r.mode === 'system' ? 'following the system' : r.mode}) · workspace <strong>{r.workspace}</strong> · interface size {Math.round(r.scale * 100)}%.</p>
      <div className="setting-actions">
        <Button variant="primary" icon="palette" onClick={() => openStudio('overview')}>Open Customization Studio</Button>
        {links.map(([id, label, icon]) => <Button key={id} size="sm" variant="ghost" icon={icon} onClick={() => openStudio(id)}>{label}</Button>)}
      </div>
    </section>
  );
}

function OrbisOnlySetting() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    void call<{ orbisOnly: boolean }>('orbis:scope').then((r) => setOn(r.orbisOnly), () => setOn(false));
  }, []);
  return (
    <section className="settings-group">
      <h2>Orbis only</h2>
      <Toggle
        id="set-orbis-only"
        label="Keep Files inside Orbis's own folder"
        description="When on, Files shows only what Orbis downloaded, what Orion made and what you add. Drives, Desktop, Documents and the terminal are hidden and refused. The screen reloads when you change this."
        checked={!!on}
        disabled={on === null}
        onChange={(v: boolean) => void call('orbis:scope', { orbisOnly: v }).then(() => window.location.reload())}
      />
    </section>
  );
}

function ImportFolderSetting() {
  const configured = useStore(app, (x) => x.settings.importFolder);
  const [effective, setEffective] = useState<string>('');
  useEffect(() => {
    void call<string>('lib:importFolder').then(setEffective, () => undefined);
  }, [configured]);
  return (
    <SettingLine label="“Import a copy” saves into">
      <span className="mono break">{effective || '…'}</span>
      <Button size="sm" variant="ghost" aria-label="Change the folder for imported copies" onClick={async () => {
        const dir = await call<string | null>('fs:pickDirectory', { title: 'Folder for imported copies' });
        if (dir) await setSetting('importFolder', dir);
      }}>Change…</Button>
      <ResetSetting k="importFolder" label="Folder for imported copies" />
    </SettingLine>
  );
}

/** Folder whose files are offered under New → (file templates). */
function TemplatesFolderSetting() {
  const configured = useStore(app, (x) => x.settings.templatesFolder);
  const listing = useStore(templates, (x) => x.listing);
  useEffect(() => {
    void refreshTemplates();
  }, [configured]);
  return (
    <SettingLine label="File templates (New → …) come from" hint={listing ? (listing.folder ? `${listing.templates.length} template${listing.templates.length === 1 ? '' : 's'}${listing.source === 'xdg' ? ' · the desktop’s templates folder' : ''}` : listing.note) : undefined}>
      <span className={listing?.folder ? 'mono break' : 'muted'}>{listing?.folder ?? 'No folder'}</span>
      <Button size="sm" variant="ghost" aria-label="Change the templates folder" onClick={async () => {
        const dir = await call<string | null>('fs:pickDirectory', { title: 'Folder with file templates' });
        if (dir) await setSetting('templatesFolder', dir);
      }}>Change…</Button>
      <ResetSetting k="templatesFolder" label="Templates folder" />
    </SettingLine>
  );
}

/** Git status on/off, with what was actually found on this system. */
function GitSetting() {
  const on = useStore(app, (x) => x.settings.gitIntegration);
  const [info, setInfo] = useState<{ available: boolean; version?: string; reason?: string; off?: boolean } | null>(null);
  useEffect(() => {
    void call<typeof info>('git:info', { recheck: true }).then(setInfo, () => setInfo(null));
  }, [on]);
  const found = !info ? 'Checking for git…' : info.off ? 'Switched off.' : info.available ? `Using git ${info.version} from PATH.` : `Git not found: ${info.reason ?? 'the git program is not installed or not on PATH.'}`;
  return (
    <Toggle id="set-git" label="Show Git status" description={`Branch in the status bar, badges next to changed, new and ignored items, and the Git column (Customization → File views) for folders inside a Git repository. Read-only: Orbis Files never changes a repository. ${found}`} checked={on} onChange={(v) => void setSetting('gitIntegration', v)} action={<ResetSetting k="gitIntegration" label="Show Git status" />} />
  );
}

/** What the built-in default of a setting is, in words, for the reset button's label. */
function describeDefault(k: SettingKey): string {
  const v = DEFAULT_SETTINGS[k];
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (k === 'previewMaxTextBytes') return formatBytes(v as number);
  if (k === 'homeSections') return 'all sections shown';
  if (k === 'importFolder') return 'Documents/Orbis Library';
  if (k === 'templatesFolder') return 'the desktop’s Templates folder (Linux), if it exists';
  if (k === 'terminalShell') return 'automatic';
  if (k === 'terminalCustomPath' || k === 'terminalCustomArgs') return 'empty';
  if (k === 'terminalFontSize') return 'same as the app';
  if (k === 'terminalScrollback') return '5,000 lines';
  if (k === 'terminalMultilinePaste') return 'ask unless bracketed';
  return String(v);
}

/**
 * Small "Reset to default" button, shown only while the setting differs from its default.
 * Several keys can share one button (a row with two related values resets both).
 */
function ResetSetting({ k, label }: { k: SettingKey | SettingKey[]; label: string }) {
  const keys = Array.isArray(k) ? k : [k];
  const changed = useStore(app, (x) => keys.filter((key) => JSON.stringify(x.settings[key]) !== JSON.stringify(DEFAULT_SETTINGS[key])).join(','));
  if (!changed) return null;
  const def = keys.map(describeDefault).join(' and ');
  return (
    <Button size="sm" variant="ghost" icon="undo" title={`Default: ${def}`} aria-label={`Reset “${label}” to its default (${def})`} onClick={() => void Promise.all(changed.split(',').map((key) => resetSetting(key as SettingKey)))}>
      Reset to default
    </Button>
  );
}

/** A labelled settings line: the label in a fixed column, the control (and its reset) beside it, an optional hint below. */
function SettingLine({ label, hint, children, group }: { label: string; hint?: ReactNode; children: ReactNode; group?: boolean }) {
  return (
    <div className="setting-line" role={group ? 'group' : undefined} aria-label={group ? label : undefined}>
      <span className="setting-label">{label}</span>
      <div className="setting-control">{children}</div>
      {hint && <p className="setting-hint">{hint}</p>}
    </div>
  );
}


/* ---------------------------------------------------------------- built-in terminal */

/** Shell, text size, scrollback and multi-line paste for the built-in terminal (main process re-checks the shell). */
function TerminalSettings() {
  const s = useStore(app, (x) => ({ shell: x.settings.terminalShell, path: x.settings.terminalCustomPath, args: x.settings.terminalCustomArgs, size: x.settings.terminalFontSize, scrollback: x.settings.terminalScrollback, paste: x.settings.terminalMultilinePaste }));
  const info = useStore(terminal, (x) => x.info);
  const [path, setPath] = useState(s.path);
  const [args, setArgs] = useState(s.args);
  const [scroll, setScroll] = useState(String(s.scrollback));
  useEffect(() => setPath(s.path), [s.path]);
  useEffect(() => setArgs(s.args), [s.args]);
  useEffect(() => setScroll(String(s.scrollback)), [s.scrollback]);
  useEffect(() => {
    void refreshTerminalInfo().catch(() => undefined);
  }, [s.shell, s.path, s.args]);
  const appSize = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs-md')) || 13);
  const shells = info?.shells ?? [];
  const known = s.shell === 'auto' || s.shell === 'custom' || shells.some((x) => x.path === s.shell);
  const toggleKey = shortcutLabel('terminal.toggle');
  const scrollNum = Number(scroll);
  const scrollBad = !Number.isInteger(scrollNum) || scrollNum < 100 || scrollNum > 100000;
  return (
    <section className="settings-group" id="settings-terminal" aria-labelledby="settings-terminal-heading">
      <h2 id="settings-terminal-heading">Built-in terminal</h2>
      <p className="muted">A terminal panel under the panes{toggleKey ? ` (${toggleKey})` : ''}. It starts in the active pane’s folder; terminals are not reopened when Orbis Files starts again. “Open terminal here” still starts the system’s own terminal application.</p>
      {info && !info.available && <p className="warning-text" role="alert"><Icon name="warning" size={14} /> {info.reason}</p>}
      <SettingLine label="Shell" hint={info?.problem ? <span className="warning-text">{info.problem}</span> : info?.current ? <>Starts <span className="mono">{info.current.path}</span>{s.shell === 'auto' ? ` (found through ${info.current.source})` : ''}.</> : 'Looking for shells…'}>
        <select className="input term-shell-select" id="set-term-shell" aria-label="Shell" value={known ? s.shell : 'custom'} onChange={(e) => void setSetting('terminalShell', e.target.value)}>
          <option value="auto">Automatic{shells[0] ? ` (${shells[0].label})` : ''}</option>
          {shells.map((x) => <option key={x.path} value={x.path}>{x.label} — {x.path}</option>)}
          <option value="custom">Custom program…</option>
        </select>
        <ResetSetting k="terminalShell" label="Shell" />
      </SettingLine>
      {s.shell === 'custom' && (
        <>
          <SettingLine label="Custom shell program" hint="A full path to the program. It is checked each time a terminal starts.">
            <input className="input mono grow" aria-label="Custom shell program (full path)" value={path} placeholder={info?.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/usr/bin/zsh'} onChange={(e) => setPath(e.target.value)} onBlur={() => path !== s.path && void setSetting('terminalCustomPath', path.trim())} onKeyDown={(e) => e.key === 'Enter' && path !== s.path && void setSetting('terminalCustomPath', path.trim())} />
            <Button size="sm" variant="ghost" aria-label="Choose the custom shell program" onClick={async () => {
              const f = await call<string | null>('fs:pickFile', { title: 'Shell program' });
              if (f) await setSetting('terminalCustomPath', f);
            }}>Choose…</Button>
          </SettingLine>
          <SettingLine label="Arguments" hint="Written like a command line; quotes keep spaces together. Nothing is expanded.">
            <input className="input mono grow" aria-label="Custom shell arguments" value={args} placeholder="-l" onChange={(e) => setArgs(e.target.value)} onBlur={() => args !== s.args && void setSetting('terminalCustomArgs', args)} onKeyDown={(e) => e.key === 'Enter' && args !== s.args && void setSetting('terminalCustomArgs', args)} />
            <ResetSetting k={['terminalCustomPath', 'terminalCustomArgs']} label="Custom shell" />
          </SettingLine>
        </>
      )}
      <SettingLine label="Text size" hint="The font is always the app’s monospace font (IBM Plex Mono).">
        <select className="input" aria-label="Terminal text size" value={s.size} onChange={(e) => void setSetting('terminalFontSize', Number(e.target.value))}>
          <option value={0}>Same as the app ({appSize} px)</option>
          {[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((n) => <option key={n} value={n}>{n} px</option>)}
        </select>
        <ResetSetting k="terminalFontSize" label="Terminal text size" />
      </SettingLine>
      <SettingLine label="Scrollback" hint={scrollBad ? <span className="warning-text">Enter a number from 100 to 100,000.</span> : 'Lines kept above the screen for scrolling and Find.'}>
        <input type="number" className="input num" min={100} max={100000} step={100} aria-label="Scrollback lines" aria-invalid={scrollBad} value={scroll} onChange={(e) => {
          setScroll(e.target.value);
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= 100 && n <= 100000) void setSetting('terminalScrollback', n);
        }} />
        <span className="muted small">lines</span>
        <ResetSetting k="terminalScrollback" label="Scrollback" />
      </SettingLine>
      <SettingLine label="Pasting several lines" group>
        <Segmented label="Ask before pasting several lines" value={s.paste} onChange={(v) => void setSetting('terminalMultilinePaste', v)} options={[
          { value: 'auto', label: 'Ask unless bracketed' },
          { value: 'always', label: 'Always ask' },
          { value: 'never', label: 'Never ask' },
        ]} />
        <ResetSetting k="terminalMultilinePaste" label="Pasting several lines" />
      </SettingLine>
      <p className="muted small">“Ask unless bracketed” asks only when the program in the terminal has not turned on bracketed paste, so that each pasted line would run as soon as it arrives. Shells started here get your environment without Orbis Files’ and Electron’s own variables.</p>
    </section>
  );
}

/* ---------------------------------------------------------------- profiles */

interface ProfileInfo { id: string; current: boolean; lastUsedMs?: number; sizeBytes: number; sizeComplete: boolean }

const PROFILE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Local profiles: separate folders with their own database (settings, tags,
 * history, index, customization). Switching restarts Orbis Files on the chosen
 * profile and is refused while file operations run.
 */
function ProfilesSection() {
  const [list, setList] = useState<ProfileInfo[] | null>(null);
  const active = useStore(app, (s) => opsActive(s).length);
  useEffect(() => {
    void call<ProfileInfo[]>('profile:list').then(setList, (err) => {
      setList([]);
      toastError(err, 'Profiles could not be listed');
    });
  }, []);
  const busyText = active ? `${active} file operation${active === 1 ? ' is' : 's are'} running; switching restarts Orbis Files, so it waits until they finish.` : undefined;

  const switchTo = async (id: string) => {
    if (active) {
      toast({ level: 'warning', title: 'Profiles cannot be switched while operations run', detail: busyText });
      return;
    }
    const ok = await confirm({ title: `Switch to profile “${id}”?`, body: 'Orbis Files closes and starts again on that profile, with its own tabs, settings, tags, history, index and customization. This profile stays as it is.', confirmLabel: 'Switch and restart' });
    if (!ok) return;
    await call('profile:switch', { id }).then(() => toast({ level: 'info', title: `Restarting on profile “${id}”…`, sticky: true }), toastError);
  };

  const create = async () => {
    const taken = new Set((list ?? []).map((p) => p.id.toLowerCase()));
    const id = await prompt({
      title: 'New profile',
      label: 'Profile name (letters, digits, “-” and “_”)',
      initial: '',
      confirmLabel: 'Create profile',
      validate: (v) => (!PROFILE_ID.test(v.trim()) ? 'Use 1–64 letters, digits, “-” or “_”.' : taken.has(v.trim().toLowerCase()) ? 'A profile with this name already exists.' : undefined),
    });
    if (!id) return;
    try {
      setList(await call<ProfileInfo[]>('profile:create', { id: id.trim() }));
    } catch (err) {
      toastError(err, 'The profile could not be created');
      return;
    }
    toast({ level: 'success', title: `Profile “${id.trim()}” created`, detail: 'It starts empty, with default settings. Use Switch to open Orbis Files on it.' });
  };

  const remove = async (p: ProfileInfo) => {
    const ok = await confirm({
      title: `Delete profile “${p.id}”?`,
      body: `Its settings, tags, collections, history, search index, snapshots and customization (${formatBytes(p.sizeBytes)}${p.sizeComplete ? '' : ' or more'}) are moved to the Trash. Your own files are not affected.`,
      confirmLabel: 'Continue…',
      destructive: true,
    });
    if (!ok) return;
    const typed = await prompt({ title: 'Confirm deleting the profile', label: `Type ${p.id} to confirm`, initial: '', confirmLabel: 'Move to Trash', validate: (v) => (v === p.id ? undefined : `Type “${p.id}” exactly.`) });
    if (typed !== p.id) return;
    await call<ProfileInfo[]>('profile:delete', { id: p.id, confirm: typed }).then((next) => {
      setList(next);
      toast({ level: 'success', title: `Profile “${p.id}” moved to the Trash`, detail: 'Restore its folder from the Trash to bring it back.' });
    }, toastError);
  };

  return (
    <section className="settings-group" aria-labelledby="profiles-heading">
      <div className="section-head"><h2 id="profiles-heading">Profiles</h2><span className="spacer" /><Button size="sm" icon="plus" onClick={() => void create()}>New profile…</Button></div>
      <p className="muted">Each profile keeps its own Orbis Files data on this computer: settings, tags, collections, recent items, search index, snapshots and customization. Files on disk are shared by all profiles.</p>
      {!list ? <p className="muted">Reading profiles…</p> : (
        <table className="table compact middle stack-table" role="table">
          <thead role="rowgroup"><tr role="row"><th role="columnheader">Profile</th><th role="columnheader">Last used</th><th role="columnheader">Data</th><th role="columnheader"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody role="rowgroup">
            {list.map((p) => (
              <tr key={p.id} role="row">
                <td role="cell" className="st-main"><span className="mono">{p.id}</span> {p.current && <Pill tone="accent">In use</Pill>}</td>
                <td role="cell" className="tabular" data-label="Last used">{p.lastUsedMs ? formatDate(p.lastUsedMs) : <span className="muted">Not started yet</span>}</td>
                <td role="cell" className="tabular" data-label="Data">{formatBytes(p.sizeBytes)}{p.sizeComplete ? '' : '+'}</td>
                <td role="cell" className="row-actions st-side">
                  {!p.current && <Button size="sm" variant="ghost" disabled={!!active} title={busyText} aria-label={`Switch to profile ${p.id}`} onClick={() => void switchTo(p.id)}>Switch…</Button>}
                  {!p.current && <Button size="sm" variant="ghost" icon="trash" aria-label={`Delete profile ${p.id}`} onClick={() => void remove(p)}>Delete…</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {busyText && list && list.length > 1 && <p className="muted small" role="status">{busyText}</p>}
    </section>
  );
}

interface IndexStatus { state: string; roots: Array<{ path: string; entries: number; lastFullScanMs: number | null; lastError: string | null; available: boolean }>; currentRoot?: string; scanned: number; contentEnabled: boolean; exclusions: string[]; watchMode: string; watchedFolders?: number; watchCapped?: boolean }

export function SettingsView() {
  const s = useStore(app, (x) => x.settings);
  const info = useStore(app, (x) => x.info);
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [exclusions, setExclusions] = useState('');
  const [thumbs, setThumbs] = useState<{ files: number; bytes: number } | null>(null);
  const refreshThumbs = () => void call<{ files: number; bytes: number }>('app:thumbCache').then(setThumbs, () => setThumbs(null));
  useEffect(refreshThumbs, []);
  useEffect(() => {
    void call<IndexStatus>('index:status').then((st) => {
      setIndex(st);
      setExclusions(st.exclusions.join('\n'));
    });
    return on<IndexStatus>('index:status', setIndex);
  }, []);

  return (
    <div className="tool-view scroll-y settings">
      <header className="view-header">
        <h1>Settings</h1>
        <p className="muted">Stored locally for this profile{info ? ` (${info.userDataPath})` : ''}. Every option here takes effect immediately.</p>
      </header>


      <OrbisOnlySetting />

      <section className="settings-group">
        <h2>Browsing</h2>
        <Toggle id="set-hidden" label="Show hidden files" description="Names starting with a dot." checked={s.showHidden} onChange={(v) => void setSetting('showHidden', v)} action={<ResetSetting k="showHidden" label="Show hidden files" />} />
        <Toggle id="set-restore" label="Restore tabs when Orbis Files starts" description="Saved locations are checked again before they are reopened." checked={s.restoreSession} onChange={(v) => void setSetting('restoreSession', v)} action={<ResetSetting k="restoreSession" label="Restore tabs when Orbis Files starts" />} />
        <GitSetting />
        <p className="muted small">The start folder, default view, columns and sidebar sections are set in <button type="button" className="link-btn" onClick={() => openStudio('navigation')}>Customization → Navigation</button> and <button type="button" className="link-btn" onClick={() => openStudio('views')}>File views</button>.</p>
        <SettingLine label="Home sections" group>
          {(Object.keys(HOME_SECTION_LABELS) as Array<keyof typeof HOME_SECTION_LABELS>).map((k) => (
            <label key={k} className="check"><input type="checkbox" checked={s.homeSections[k]} onChange={(e) => void setSetting('homeSections', { ...s.homeSections, [k]: e.target.checked })} /> {HOME_SECTION_LABELS[k]}</label>
          ))}
          <ResetSetting k="homeSections" label="Home sections" />
        </SettingLine>
      </section>

      <section className="settings-group">
        <h2>Files and operations</h2>
        <Toggle id="set-ctrash" label="Confirm before moving to Trash" description="Permanent deletion is always confirmed." checked={s.confirmTrash} onChange={(v) => void setSetting('confirmTrash', v)} action={<ResetSetting k="confirmTrash" label="Confirm before moving to Trash" />} />
        <Toggle id="set-notify" label="Notify when long operations finish" description="Shows a system notification when Orbis Files is in the background and an operation that took more than a few seconds ends." checked={s.notifyWhenUnfocused} onChange={(v) => void setSetting('notifyWhenUnfocused', v)} action={<ResetSetting k="notifyWhenUnfocused" label="Notify when long operations finish" />} />
        <SettingLine label="Operations that run at the same time" hint="Operations on overlapping folders always wait for each other.">
          <input type="number" className="input num" min={1} max={8} value={s.maxConcurrentOperations} aria-label="Operations that run at the same time" onChange={(e) => void setSetting('maxConcurrentOperations', Math.max(1, Math.min(8, Number(e.target.value) || 1)))} />
          <ResetSetting k="maxConcurrentOperations" label="Operations that run at the same time" />
        </SettingLine>
        <SettingLine label="Largest text shown in previews" hint="Larger files are shown in parts with “Load more”.">
          <select className="input num" value={s.previewMaxTextBytes} aria-label="Largest text shown in previews" onChange={(e) => void setSetting('previewMaxTextBytes', Number(e.target.value))}>
            {[256 * 1024, 1024 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024, 16 * 1024 * 1024].map((n) => <option key={n} value={n}>{formatBytes(n)}</option>)}
          </select>
          <ResetSetting k="previewMaxTextBytes" label="Largest text shown in previews" />
        </SettingLine>
      </section>

      <CustomActionsSection />

      <TerminalSettings />

      <section className="settings-group">
        <h2>Archives</h2>
        <p className="muted">Safety limits applied to every extraction. Extraction stops and its partial output is removed when a limit is reached.</p>
        <SettingLine label="Largest total size to extract">
          <input type="number" className="input num" min={1} max={4096} value={s.archiveMaxTotalGB} aria-label="Largest total size to extract in GB" onChange={(e) => void setSetting('archiveMaxTotalGB', Math.max(1, Math.min(4096, Number(e.target.value) || 1)))} />
          <span className="muted small">GB</span>
          <ResetSetting k="archiveMaxTotalGB" label="Largest total size to extract" />
        </SettingLine>
        <SettingLine label="Largest expansion ratio" hint="× the archive size — higher ratios indicate a decompression bomb.">
          <input type="number" className="input num" min={10} max={100000} value={s.archiveMaxRatio} aria-label="Largest expansion ratio" onChange={(e) => void setSetting('archiveMaxRatio', Math.max(10, Math.min(100000, Number(e.target.value) || 10)))} />
          <span className="muted small">×</span>
          <ResetSetting k="archiveMaxRatio" label="Largest expansion ratio" />
        </SettingLine>
        <SettingLine label="Most entries per archive">
          <input type="number" className="input num" min={100} max={10000000} value={s.archiveMaxEntries} aria-label="Most entries per archive" onChange={(e) => void setSetting('archiveMaxEntries', Math.max(100, Math.min(10000000, Number(e.target.value) || 100)))} />
          <ResetSetting k="archiveMaxEntries" label="Most entries per archive" />
        </SettingLine>
        <SettingLine label="Archives inside archives" hint="The size limit is also the largest file opened or previewed straight from an archive.">
          <input type="number" className="input num" min={1} max={8} value={s.nestedArchiveDepth} aria-label="Nested archive depth" onChange={(e) => void setSetting('nestedArchiveDepth', Math.max(1, Math.min(8, Number(e.target.value) || 1)))} />
          <span className="muted small">levels deep, each up to</span>
          <input type="number" className="input num" min={16} max={16384} value={s.nestedArchiveMaxMB} aria-label="Largest nested archive or file opened from an archive, in MB" onChange={(e) => void setSetting('nestedArchiveMaxMB', Math.max(16, Math.min(16384, Number(e.target.value) || 16)))} />
          <span className="muted small">MB</span>
          <ResetSetting k={['nestedArchiveDepth', 'nestedArchiveMaxMB']} label="Archives inside archives" />
        </SettingLine>
        <p className="muted small">Formats: ZIP, TAR, TAR.GZ, GZIP (built in); 7Z, RAR, XZ, BZIP2 and ZSTD via the bundled 7-Zip engine. Password-protected ZIP (ZipCrypto and AES), 7Z and RAR archives ask for their password, which is kept in memory only while the archive is open and is never saved or logged.</p>
      </section>

      <section className="settings-group">
        <h2>Search index</h2>
        <p className="muted">The index lives only on this computer. Folders that are not indexed are still searched directly, just more slowly. {index?.watchMode === 'per-folder' && index.watchedFolders !== undefined ? `Changes are watched in ${index.watchedFolders.toLocaleString()} folder${index.watchedFolders === 1 ? '' : 's'}${index.watchCapped ? ' (the watch limit was reached; the rest are re-checked every 15 minutes)' : ''}.` : ''} Every result is also re-checked on disk before it is shown.</p>
        <Toggle id="set-content" label="Index file contents" description="Reads text and code files up to 1 MB so content: searches work in indexed folders. Off by default." checked={s.indexContents} onChange={(v) => void setSetting('indexContents', v)} action={<ResetSetting k="indexContents" label="Index file contents" />} />
        <div className="index-roots">
          {!index ? null : !index.roots.length ? <p className="muted">No folders are indexed.</p> : index.roots.map((r) => (
            <div key={r.path} className="list-row">
              <span className="mono">{r.path}</span>
              <span className="muted tabular">{r.entries.toLocaleString()} items · {r.lastFullScanMs ? `checked ${formatDate(r.lastFullScanMs)}` : 'not scanned yet'}</span>
              {!r.available && <Pill tone="warning">unavailable</Pill>}
              {r.lastError && <Pill tone="error">{r.lastError}</Pill>}
              {index.currentRoot === r.path && <Pill tone="accent">{index.state === 'paused' ? 'paused' : `scanning · ${index.scanned.toLocaleString()}`}</Pill>}
              <span className="spacer" />
              <Button size="sm" variant="ghost" onClick={() => void call('index:removeRoot', { path: r.path }).catch(toastError)}>Remove</Button>
            </div>
          ))}
        </div>
        <div className="tool-controls">
          <Button icon="plus" onClick={async () => {
            const p = await call<string | null>('fs:pickDirectory', { title: 'Folder to index' });
            if (p) await call('index:addRoot', { path: p }).catch(toastError);
          }}>Add folder</Button>
          <Button onClick={() => void call('index:rebuild')}>Re-check now</Button>
          {index?.state === 'scanning' && <Button onClick={() => void call('index:pause')}>Pause</Button>}
          {index?.state === 'paused' && <Button onClick={() => void call('index:resume')}>Resume</Button>}
        </div>
        <label className="field">
          <span className="field-label">Never index (one name pattern per line, * and ? allowed)</span>
          <textarea className="input mono" rows={4} value={exclusions} onChange={(e) => setExclusions(e.target.value)} />
        </label>
        <div><Button size="sm" onClick={() => void call('index:setExclusions', { patterns: exclusions.split('\n').map((x) => x.trim()).filter(Boolean) }).then(() => toast({ level: 'success', title: 'Exclusions saved; re-checking indexed folders.' }), toastError)}>Save exclusions</Button></div>
      </section>

      <OcrSettings />


      <section className="settings-group">
        <h2>Your data</h2>
        <Toggle id="set-recents" label="Remember recently opened items" description="Turning this off stops recording; existing history stays until you clear it." checked={s.rememberRecents} onChange={(v) => void setSetting('rememberRecents', v)} action={<ResetSetting k="rememberRecents" label="Remember recently opened items" />} />
        <div className="tool-controls">
          <Button onClick={async () => {
            if (await confirm({ title: 'Clear recent items?', body: 'Only this history is cleared. No files are affected.', confirmLabel: 'Clear' })) await call('cat:clearRecents').then(() => toast({ level: 'success', title: 'Recent items cleared' }), toastError);
          }}>Clear recent items</Button>
          <Button onClick={async () => {
            await call<{ removed: number }>('app:clearThumbCache').then((r) => toast({ level: 'success', title: `Removed ${r.removed.toLocaleString()} cached thumbnail${r.removed === 1 ? '' : 's'}` }), toastError);
            refreshThumbs();
          }}>Clear thumbnail cache</Button>
          <span className="muted tabular">{thumbs ? `Thumbnail cache: ${formatBytes(thumbs.bytes)} in ${thumbs.files.toLocaleString()} file${thumbs.files === 1 ? '' : 's'} (limit 256 MB)` : ''}</span>
        </div>
        <ImportFolderSetting />
        <TemplatesFolderSetting />
        <p className="muted">A backup contains Orbis Files' own data — settings, tags, collections, rules, history and the index. It does not contain your files.</p>
        <div className="tool-controls">
          <Button onClick={async () => {
            const dir = await call<string | null>('fs:pickDirectory', { title: 'Save backup in…' });
            if (!dir) return;
            const name = await prompt({ title: 'Back up Orbis Files data', label: 'File name', initial: `orbis-files-backup-${new Date().toISOString().slice(0, 10)}.db`, confirmLabel: 'Save backup' });
            if (!name) return;
            const sep = dir.includes('\\') ? '\\' : '/';
            await call<{ path: string; bytes: number }>('cat:backup', { destination: `${dir}${dir.endsWith(sep) ? '' : sep}${name}` }).then((r) => toast({ level: 'success', title: `Backup saved (${formatBytes(r.bytes)})`, detail: r.path }), toastError);
          }}>Back up…</Button>
          <Button onClick={async () => {
            const path = await call<string | null>('fs:pickFile', { title: 'Choose an Orbis Files backup' });
            if (!path) return;
            if (!(await confirm({ title: 'Replace Orbis Files data with this backup?', body: 'Your current data is kept as a separate file, and Orbis Files restarts. Your files are not affected.', confirmLabel: 'Restore and restart', destructive: true }))) return;
            await call<{ previousSavedAs: string }>('cat:restore', { source: path }).then((r) => toast({ level: 'info', title: 'Restarting with the backup…', detail: `Previous data saved as ${r.previousSavedAs}`, sticky: true }), toastError);
          }}>Restore…</Button>
        </div>
      </section>

    </div>
  );
}

/* ---------------------------------------------------------------- integrations */

interface ProviderInfo { id: string; label: string; types: string[]; availability: string; storage: string; removalSemantics: string; note?: string; builtIn: boolean }

/** Where a content source's items can be browsed, when they can be. */
function browseTarget(p: ProviderInfo): Location | undefined {
  if (p.availability === 'not_connected') return undefined;
  switch (p.id) {
    case 'downloads': return { kind: 'tool', tool: 'downloads' };
    case 'generated': return { kind: 'library', category: 'generated' };
    case 'projects': return { kind: 'tool', tool: 'projects' };
    case 'imported': return undefined;
    default: return p.builtIn ? undefined : { kind: 'library', category: `provider:${p.id}` };
  }
}

function ContentProviders() {
  const [list, setList] = useState<ProviderInfo[] | null>(null);
  useEffect(() => void call<ProviderInfo[]>('lib:providers').then(setList, () => setList([])), []);
  return (
    <section className="settings-group">
      <h2>Library content sources</h2>
      <p className="muted">Sources that feed the unified library. Each one states where its items live and what removing an item does.</p>
      <table className="table compact stack-table" role="table">
        <thead role="rowgroup"><tr role="row"><th role="columnheader">Source</th><th role="columnheader">Status</th><th role="columnheader">Item types</th><th role="columnheader">Removing an item</th><th role="columnheader"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody role="rowgroup">
          {(list ?? []).map((p) => (
            <tr key={p.id} role="row">
              <td role="cell" className="st-main">{p.label}{p.note && <div className="muted small">{p.note}</div>}</td>
              <td role="cell" className="st-side"><Pill tone={p.availability === 'available' ? 'success' : p.availability === 'not_connected' ? 'neutral' : 'error'}>{p.availability === 'not_connected' ? 'Not connected' : p.availability}</Pill></td>
              <td role="cell" className="small" data-label="Item types">{p.types.join(', ').replace(/_/g, ' ')}</td>
              <td role="cell" className="small muted" data-label="Removing an item">{p.removalSemantics}</td>
              <td role="cell" className="row-actions">{browseTarget(p) && <button type="button" className="btn btn-ghost btn-sm" aria-label={`Browse ${p.label}`} onClick={() => void navigate(activePane().id, browseTarget(p)!)}>Browse</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

type AiKind = 'orbis' | 'openai-compatible';
interface AiStatus { status: string; configured: boolean; endpoint?: string; providerKind?: AiKind; model?: string; vision?: boolean; provider?: { providerName: string; providerVersion: string; contractVersion: string; processing: string; limits: Record<string, unknown>; models?: Array<{ id: string; label: string }> }; capabilities: string[]; lastError?: string; lastCheckedMs?: number; reconnectAttempt?: number; contractVersion: string }
interface HostStatus { status: string; profileId: string; contractVersion: string; aiContractVersion: string; lastRequestMs?: number; lastRequestType?: string }

const STATUS_TEXT: Record<string, [string, 'neutral' | 'accent' | 'success' | 'warning' | 'error']> = {
  not_configured: ['Not configured', 'neutral'], disconnected: ['Disconnected', 'neutral'], connecting: ['Connecting…', 'accent'], available: ['Connected', 'success'],
  degraded: ['Degraded', 'warning'], unavailable: ['Unavailable', 'error'], reconnecting: ['Reconnecting…', 'warning'], error: ['Error', 'error'], incompatible: ['Incompatible version', 'error'],
};

/** Quick-fill addresses for common local OpenAI-compatible servers. They only fill the form. */
const AI_PRESETS: Array<{ id: string; label: string; url: string }> = [
  { id: 'ollama', label: 'Ollama', url: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio', url: 'http://localhost:1234/v1' },
];

const PROCESSING_TEXT: Record<AiKind, Record<string, string>> = {
  orbis: { local: 'On this computer (declared by the provider)', remote: 'On a remote service (declared by the provider)', mixed: 'Partly remote (declared by the provider)', unknown: 'Not declared' },
  'openai-compatible': {
    local: 'The server is on this computer (from its address). Orbis Files cannot see whether that server forwards requests elsewhere.',
    remote: 'On a remote service: the server address is not on this computer.',
    mixed: 'Partly remote',
    unknown: 'Unknown',
  },
};

export function IntegrationsView() {
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [host, setHost] = useState<HostStatus | null>(null);
  const [kind, setKind] = useState<AiKind>('orbis');
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [model, setModel] = useState('');
  const [vision, setVision] = useState(false);
  const [models, setModels] = useState<{ url: string; list: string[] } | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [audit, setAudit] = useState<Array<{ id: string; taskId: string; ms: number; event: string; kind: string | null; refs: string[]; detail: unknown }>>([]);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const caps = useStore(app, (s) => s.capabilities);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call<AiStatus>('ai:status').then((s) => {
      setAi(s);
      setEndpoint(s.endpoint ?? '');
      setKind(s.providerKind ?? 'orbis');
      setModel(s.model ?? '');
      setVision(!!s.vision);
    });
    void call<HostStatus>('host:status').then(setHost);
    void call<typeof audit>('ai:audit', { limit: 50 }).then(setAudit);
    void call<typeof logs>('diag:recent', { limit: 80 }).then(setLogs);
    return on<AiStatus>('ai:status', setAi);
  }, []);

  const [label, tone] = STATUS_TEXT[ai?.status ?? 'not_configured'] ?? ['Unknown', 'neutral'];
  const openai = kind === 'openai-compatible';
  const activeKind: AiKind = ai?.providerKind ?? 'orbis';

  const loadModels = async () => {
    setModelsBusy(true);
    setModelsError(null);
    try {
      const list = await call<string[]>('ai:listModels', { url: endpoint.trim(), key: token || undefined });
      setModels({ url: endpoint.trim(), list });
      if (!list.length) setModelsError('The server listed no models. Load or download a model in the server first.');
      else if (!model || !list.includes(model)) setModel(list[0]!);
    } catch (err) {
      setModels(null);
      setModelsError((err as Error).message);
    } finally {
      setModelsBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const r = await call<AiStatus & { tokenNote?: string }>('ai:configure', openai ? { endpoint: endpoint.trim(), token: token || undefined, kind, model: model.trim(), vision } : { endpoint: endpoint.trim(), token: token || undefined, kind });
      setAi(r);
      setToken('');
      if (r.tokenNote) toast({ level: 'warning', title: r.tokenNote });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Integrations & diagnostics</h1>
        <p className="muted">Orbis Files works fully on its own. Integrations add features when a real service is connected; their status below comes from live checks, not from settings.</p>
      </header>

      <section className="settings-group">
        <div className="section-head"><h2>AI</h2><Pill tone="success">Orion</Pill></div>
        <p className="muted">Explain, summarise, analyse a folder and plan a search use Orion, the same assistant as in Orbis chat. Nothing to connect, and no key to enter.</p>
      </section>

      <ContentProviders />

      <section className="settings-group">
        <h2>System capabilities</h2>
        {caps && (
          <dl className="props">
            <dt>Platform</dt><dd>{caps.platform}</dd>
            <dt>Trash</dt><dd>{caps.trash ? 'Available' : 'Not available'}</dd>
            <dt>Folder change notifications</dt><dd>{caps.watch === 'recursive' ? 'Recursive' : caps.watch === 'shallow' ? 'Open folder only' : 'Not available'}</dd>
            <dt>Symbolic links</dt><dd>{caps.symlinkCreate ? 'Create and inspect' : 'Inspect only'}</dd>
            <dt>Case-sensitive names</dt><dd>{caps.caseSensitivePaths ? 'Yes' : 'No'}</dd>
            <dt>POSIX permissions</dt><dd>{caps.posixPermissions ? 'Yes' : 'No'}</dd>
          </dl>
        )}
        {caps?.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
      </section>

      <section className="settings-group">
        <div className="section-head"><h2>Recent diagnostic events</h2><span className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => void call('diag:openLogFolder').catch(toastError)}>Open log folder</Button>
          <Button size="sm" variant="ghost" onClick={async () => {
            const dir = await call<string | null>('fs:pickDirectory', { title: 'Export diagnostics to…' });
            if (!dir) return;
            const sep = dir.includes('\\') ? '\\' : '/';
            await call<{ path: string }>('diag:export', { destination: `${dir}${sep}orbis-files-diagnostics-${Date.now()}.jsonl` }).then((r) => toast({ level: 'success', title: 'Diagnostics exported', detail: r.path }), toastError);
          }}>Export…</Button>
        </div>
        <p className="muted small">Paths in your home folder are shortened to “~”. File contents, prompts and tokens are never recorded.</p>
        {!logs.length ? <EmptyState icon="info" title="No events recorded yet" /> : (
          <pre className="log-view">{logs.slice().reverse().map((l) => `${String(l.ts).slice(11, 19)} ${String(l.level).padEnd(5)} ${l.event}${l.errorId ? ` [${l.errorId}]` : ''} ${JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k]) => !['ts', 'level', 'event', 'errorId'].includes(k))))}`).join('\n')}</pre>
        )}
      </section>
      <span hidden>{aiState.status}</span>
    </div>
  );
}

export { FolderPicker };
