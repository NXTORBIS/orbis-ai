import { z } from 'zod';

/**
 * Custom actions (user commands): a program the user defines once and runs on
 * selected items from the context menu, the command palette or the toolbar.
 *
 * Safety model (docs/SECURITY.md):
 *  - The command line is split into arguments here, once, by a small
 *    POSIX-like parser; placeholders are substituted inside each argument
 *    after splitting, so a file name can never add, split or quote arguments.
 *    The program is started with child_process.spawn and NO shell.
 *  - "Run through the shell" is an explicit opt-in per action. Then values are
 *    inserted already quoted for the shell (and placeholders inside quotes are
 *    refused, because they would be quoted twice).
 *  - Actions are stored per profile and created or changed only from the
 *    Settings UI; the main process re-reads the stored action before running,
 *    so a run request only names an action id.
 */

export const CUSTOM_ACTIONS_FORMAT = 'orbis-files-actions';
export const CUSTOM_ACTIONS_FORMAT_VERSION = 1;
export const MAX_CUSTOM_ACTIONS = 100;
/** Largest amount of standard output and standard error kept per run (each). */
export const ACTION_OUTPUT_LIMIT = 256 * 1024;

export const PLACEHOLDERS = ['path', 'paths', 'name', 'stem', 'ext', 'dir', 'cwd'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export const PLACEHOLDER_HELP: Record<Placeholder, string> = {
  path: 'full path of the item',
  paths: 'every item’s full path, each as its own argument',
  name: 'file or folder name',
  stem: 'name without the extension',
  ext: 'extension without the dot',
  dir: 'folder that contains the item',
  cwd: 'folder shown in the pane',
};
const ITEM_PLACEHOLDERS = new Set<Placeholder>(['path', 'name', 'stem', 'ext', 'dir']);

const ext = z.string().trim().toLowerCase().transform((s) => s.replace(/^\./, '')).pipe(z.string().regex(/^[a-z0-9_+~-]{1,16}$/, 'Extensions use letters, digits, "_", "+", "~" or "-" (up to 16).'));

export const CustomActionShape = z.object({
  id: z.string().regex(/^[a-z0-9]{6,32}$/, 'Not an action identifier.'),
  name: z.string().trim().min(1, 'Give the action a name.').max(60, 'Names are limited to 60 characters.'),
  command: z.string().trim().min(1, 'Enter the command to run.').max(4096, 'The command is limited to 4,096 characters.').refine((s) => !s.includes('\0'), 'The command cannot contain a null character.'),
  /** once: one run with every selected item; per-item: one run for each item. */
  runMode: z.enum(['once', 'per-item']),
  /** folder: the folder shown in the pane; item: the folder containing the (first) item; custom: customDir. */
  workingDir: z.enum(['folder', 'item', 'custom']),
  customDir: z.string().max(4096),
  /** Open the output (standard output, standard error, exit code) when the action finishes. It is always kept in Operations. */
  showOutput: z.boolean(),
  /** Ask before running, showing exactly what will run. */
  confirm: z.boolean(),
  /** Run the command line through the system shell (/bin/sh -c, or cmd.exe on Windows). Off by default. */
  shell: z.boolean(),
  timeoutSec: z.number().int().min(1).max(86400),
  appliesTo: z.object({
    files: z.boolean(),
    folders: z.boolean(),
    /** Only files with these extensions (empty: any file). */
    extensions: z.array(ext).max(50),
    /** Also offered with nothing selected; the item is then the folder shown. */
    noSelection: z.boolean(),
  }).strict(),
  createdMs: z.number().int().nonnegative(),
  updatedMs: z.number().int().nonnegative(),
}).strict();

export type CustomAction = z.infer<typeof CustomActionShape>;
export type CustomActionInput = z.input<typeof CustomActionShape>;

export const ACTION_DEFAULTS: Omit<CustomAction, 'id' | 'name' | 'command'> = {
  runMode: 'per-item',
  workingDir: 'item',
  customDir: '',
  showOutput: true,
  confirm: true,
  shell: false,
  timeoutSec: 60,
  appliesTo: { files: true, folders: false, extensions: [], noSelection: false },
  createdMs: 0,
  updatedMs: 0,
};

/** The platform the schema validates command lines for (main: Node's process; renderer: the preload bridge). */
const HOST_PLATFORM: string = (globalThis as { process?: { platform?: string }; orbis?: { platform?: string } }).process?.platform ?? (globalThis as { orbis?: { platform?: string } }).orbis?.platform ?? 'linux';

const isAbs = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

export const CustomActionSchema = z.preprocess((v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  const at = o.appliesTo && typeof o.appliesTo === 'object' && !Array.isArray(o.appliesTo) ? o.appliesTo : {};
  return { ...ACTION_DEFAULTS, ...o, appliesTo: { ...ACTION_DEFAULTS.appliesTo, ...(at as object) } };
}, CustomActionShape.superRefine((a, ctx) => {
  if (!a.appliesTo.files && !a.appliesTo.folders && !a.appliesTo.noSelection) ctx.addIssue({ code: 'custom', path: ['appliesTo'], message: 'Choose what the action applies to (files, folders, or the folder shown).' });
  if (a.workingDir === 'custom' && !isAbs(a.customDir)) ctx.addIssue({ code: 'custom', path: ['customDir'], message: 'The working folder must be an absolute path.' });
  const problem = commandProblem(a.command, a.shell, HOST_PLATFORM);
  if (problem) ctx.addIssue({ code: 'custom', path: ['command'], message: problem });
})) as unknown as z.ZodType<CustomAction, z.ZodTypeDef, unknown>;

export const CustomActionsFileSchema = z.object({
  format: z.literal(CUSTOM_ACTIONS_FORMAT),
  version: z.number().int().min(1),
  actions: z.array(z.unknown()).max(MAX_CUSTOM_ACTIONS),
}).passthrough();

// ------------------------------------------------------------------ command-line parsing

export class CommandLineError extends Error {}

/**
 * Split a command line into arguments, like a POSIX shell does for quoting
 * only: whitespace separates arguments; '…' is literal; "…" keeps spaces and
 * understands \" and \\; outside quotes a backslash escapes the next
 * character (on Windows a backslash is literal, so C:\Tools\app.exe works).
 * Nothing is expanded: no variables, globs, pipes, redirections or `;`.
 */
export function parseCommandLine(line: string, platform: string = 'linux'): string[] {
  const win = platform === 'win32';
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new CommandLineError('A single quote (\') is not closed.');
      cur += line.slice(i + 1, end);
      inWord = true;
      i = end + 1;
    } else if (c === '"') {
      i++;
      let closed = false;
      while (i < line.length) {
        const d = line[i]!;
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
          cur += line[i + 1];
          i += 2;
          continue;
        }
        cur += d;
        i++;
      }
      if (!closed) throw new CommandLineError('A double quote (") is not closed.');
      inWord = true;
    } else if (c === '\\' && !win) {
      if (i + 1 >= line.length) throw new CommandLineError('The command ends with a backslash.');
      cur += line[i + 1];
      inWord = true;
      i += 2;
    } else if (/\s/.test(c)) {
      if (inWord) out.push(cur);
      cur = '';
      inWord = false;
      i++;
    } else {
      cur += c;
      inWord = true;
      i++;
    }
  }
  if (inWord) out.push(cur);
  if (!out.length) throw new CommandLineError('Enter the program to run.');
  return out;
}

const TOKEN = /\{(path|paths|name|stem|ext|dir|cwd)\}/g;

/** Placeholders used in a command line. */
export function placeholdersIn(command: string): Placeholder[] {
  return [...new Set([...command.matchAll(TOKEN)].map((m) => m[1] as Placeholder))];
}

/** Whether the command refers to the item ({path}, {name}, …) rather than only the folder. */
export function usesItemPlaceholders(command: string): boolean {
  return placeholdersIn(command).some((p) => ITEM_PLACEHOLDERS.has(p) || p === 'paths');
}

/** Quoted (in shell mode) placeholders would be quoted twice: find one inside quotes. */
function placeholderInsideQuotes(line: string): string | undefined {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === q) q = null;
      else if (c === '{') {
        const m = /^\{(path|paths|name|stem|ext|dir|cwd)\}/.exec(line.slice(i));
        if (m) return m[0];
      }
    } else if (c === "'" || c === '"') q = c;
  }
  return undefined;
}

/** Why a command line cannot be used, or undefined when it can. */
export function commandProblem(command: string, shell: boolean, platform: string): string | undefined {
  if (shell) {
    const inside = placeholderInsideQuotes(command);
    if (inside) return `In shell mode ${inside} is inserted already quoted; remove the quotes around it.`;
    return undefined;
  }
  let argv: string[];
  try {
    argv = parseCommandLine(command, platform);
  } catch (err) {
    return (err as Error).message;
  }
  for (const a of argv) if (a.includes('{paths}') && a !== '{paths}') return '{paths} must be an argument of its own (it becomes one argument per item).';
  if (argv[0] === '{paths}') return 'The program cannot be {paths}.';
  return undefined;
}

// ------------------------------------------------------------------ substitution and planning

export interface ActionItem { path: string; kind: 'file' | 'directory' | 'other' }

const sepOf = (p: string) => (/^[A-Za-z]:\\|^\\\\/.test(p) || (p.includes('\\') && !p.includes('/')) ? '\\' : '/');
export function baseName(p: string): string {
  const trimmed = p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}
export function dirName(p: string): string {
  const s = sepOf(p);
  const trimmed = p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (i < 0) return trimmed;
  if (i === 0) return s;
  if (/^[A-Za-z]:$/.test(trimmed.slice(0, i))) return `${trimmed.slice(0, i)}\\`;
  return trimmed.slice(0, i);
}
/** Name and extension: "report.tar.gz" → stem "report.tar", ext "gz"; ".bashrc" has no extension; folders have none. */
export function stemExt(name: string, kind: ActionItem['kind']): { stem: string; ext: string } {
  if (kind === 'directory') return { stem: name, ext: '' };
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return { stem: name, ext: '' };
  return { stem: name.slice(0, i), ext: name.slice(i + 1) };
}

function valuesFor(item: ActionItem, cwd: string): Record<Exclude<Placeholder, 'paths'>, string> {
  const name = baseName(item.path);
  const { stem, ext: e } = stemExt(name, item.kind);
  return { path: item.path, name, stem, ext: e, dir: dirName(item.path), cwd };
}

function substitute(text: string, values: Record<string, string>, quote: (s: string) => string, paths: string[]): string {
  return text.replace(TOKEN, (_m, k: string) => (k === 'paths' ? paths.map(quote).join(' ') : quote(values[k] ?? '')));
}

/** Quote for a POSIX shell: '…' with ' written as '\''. */
export function quotePosix(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
/** Quote for cmd.exe ("…" with " doubled). cmd.exe still expands %VAR%; documented as a limitation of shell mode. */
export function quoteCmd(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

export interface PlannedRun {
  /** What this run is about (item name, or "3 items"). */
  label: string;
  /** Items this run acts on (results are reported per item). */
  items: string[];
  cwd: string;
  /** No-shell mode: the program and its arguments. */
  argv?: string[];
  /** Shell mode: the shell, its arguments and the final command line. */
  shell?: { file: string; args: string[]; line: string };
}

export interface PlanContext {
  items: ActionItem[];
  /** Folder shown in the pane (for {cwd} and the "folder" working directory). */
  folder: string;
  platform: string;
  /** cmd.exe path on Windows (ComSpec). */
  comSpec?: string;
}

/** The runs an action makes for these items, with every placeholder substituted. Throws CommandLineError on bad input. */
export function planRuns(action: Pick<CustomAction, 'command' | 'runMode' | 'workingDir' | 'customDir' | 'shell'>, ctx: PlanContext): PlannedRun[] {
  if (!ctx.items.length) throw new CommandLineError('There is nothing to run the action on.');
  const problem = commandProblem(action.command, action.shell, ctx.platform);
  if (problem) throw new CommandLineError(problem);
  const groups: ActionItem[][] = action.runMode === 'per-item' ? ctx.items.map((i) => [i]) : [ctx.items];
  const argvTemplate = action.shell ? undefined : parseCommandLine(action.command, ctx.platform);
  const win = ctx.platform === 'win32';
  return groups.map((group) => {
    const first = group[0]!;
    const values = valuesFor(first, ctx.folder);
    const paths = group.map((g) => g.path);
    const cwd = action.workingDir === 'custom' ? action.customDir : action.workingDir === 'item' ? (first.kind === 'directory' && first.path === ctx.folder ? ctx.folder : dirName(first.path)) : ctx.folder;
    const label = group.length === 1 ? baseName(first.path) : `${group.length} items`;
    if (argvTemplate) {
      const argv: string[] = [];
      for (const a of argvTemplate) {
        if (a === '{paths}') argv.push(...paths);
        else argv.push(substitute(a, values, (s) => s, paths));
      }
      if (!argv[0]) throw new CommandLineError('The program name is empty after substitution.');
      return { label, items: paths, cwd, argv };
    }
    const line = substitute(action.command, values, win ? quoteCmd : quotePosix, paths);
    const shell = win ? { file: ctx.comSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], line } : { file: '/bin/sh', args: ['-c', line], line };
    return { label, items: paths, cwd, shell };
  });
}

/** How a run is shown to the user (arguments quoted where needed so the boundaries are visible). */
export function describeRun(run: PlannedRun): string {
  if (run.shell) return run.shell.line;
  return (run.argv ?? []).map((a) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a) ? a : quotePosix(a))).join(' ');
}

// ------------------------------------------------------------------ applies to

export interface EntryLike { path: string; name: string; kind: string; linkTargetKind?: string; ext?: string }

const entryIsDir = (e: EntryLike) => e.kind === 'directory' || (e.kind === 'symlink' && e.linkTargetKind === 'directory');

/** Whether the action can run on this selection (true) or why not. `folder` is the folder shown (undefined outside folders). */
export function appliesTo(action: Pick<CustomAction, 'appliesTo'>, selection: EntryLike[], folder: string | undefined): true | string {
  const a = action.appliesTo;
  if (!selection.length) {
    if (!a.noSelection) return a.folders && !a.files ? 'Select one or more folders.' : 'Select one or more items.';
    return folder ? true : 'Only available inside a folder.';
  }
  for (const e of selection) {
    if (entryIsDir(e)) {
      if (!a.folders) return 'This action applies to files only.';
      continue;
    }
    if (!a.files) return 'This action applies to folders only.';
    if (a.extensions.length) {
      const x = (e.ext ?? stemExt(e.name, 'file').ext).toLowerCase();
      if (!a.extensions.includes(x)) return `This action applies to ${a.extensions.map((y) => `.${y}`).join(', ')} files only.`;
    }
  }
  return true;
}

/** Items for a run: the selection, or the folder shown when nothing is selected. */
export function actionItems(selection: EntryLike[], folder: string | undefined): ActionItem[] {
  if (selection.length) return selection.map((e) => ({ path: e.path, kind: entryIsDir(e) ? 'directory' : e.kind === 'file' || e.kind === 'symlink' ? 'file' : 'other' }));
  return folder ? [{ path: folder, kind: 'directory' }] : [];
}

/** A command id for an action (fits the customization command-id rules). */
export const actionCommandId = (id: string): string => `action.${id}`;
export const isActionCommandId = (cmd: string): boolean => /^action\.[a-z0-9]{6,32}$/.test(cmd);
