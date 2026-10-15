/**
 * Keyboard shortcut grammar, reserved combinations and conflict detection
 * for Files-specific commands.
 *
 * Canonical form: modifiers in the order Mod, Ctrl, Alt, Shift, then one key,
 * joined by "+". "Mod" is Ctrl on Linux/Windows and Cmd on macOS.
 */

const MODS = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const;
const NAMED = new Set([
  'Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ContextMenu',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
]);
const PUNCT = new Set(['\\', '[', ']', ',', '.', '/', ';', "'", '`', '-', '=']);
const ALIASES: Record<string, string> = { cmd: 'Mod', command: 'Mod', meta: 'Mod', control: 'Ctrl', ctrl: 'Ctrl', option: 'Alt', opt: 'Alt', alt: 'Alt', shift: 'Shift', mod: 'Mod', esc: 'Escape', del: 'Delete', return: 'Enter', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', plus: '=', minus: '-', comma: ',' };

export type ShortcutCheck = { ok: true; value: string } | { ok: false; reason: string };

export function normalizeShortcut(input: string): ShortcutCheck {
  if (typeof input !== 'string' || !input.trim() || input.length > 40) return { ok: false, reason: 'Empty or too long.' };
  const raw = input.trim().replace(/\s+/g, '');
  // "+" alone is the key "="-with-shift on most layouts; we bind physical keys, so it is spelled "Shift+=".
  const parts = raw.split('+').filter(Boolean);
  if (raw.endsWith('++')) parts.push('=');
  const mods = new Set<string>();
  let key: string | undefined;
  for (const p of parts) {
    const alias = ALIASES[p.toLowerCase()];
    const name = alias ?? p;
    if ((MODS as readonly string[]).includes(name)) {
      if (mods.has(name)) return { ok: false, reason: `"${name}" is repeated.` };
      mods.add(name);
      continue;
    }
    if (key) return { ok: false, reason: 'A shortcut has exactly one key besides the modifiers.' };
    if (name.length === 1 && /[a-z0-9]/i.test(name)) key = name.toUpperCase();
    else if (PUNCT.has(name)) key = name;
    else {
      const named = [...NAMED].find((n) => n.toLowerCase() === name.toLowerCase());
      if (!named) return { ok: false, reason: `"${p}" is not a supported key.` };
      key = named;
    }
  }
  if (!key) return { ok: false, reason: 'A shortcut needs a key, not only modifiers.' };
  const value = [...MODS.filter((m) => mods.has(m)), key].join('+');
  return { ok: true, value };
}

/** Keys that type text: binding them without Mod/Ctrl/Alt would steal typing (type-ahead, renames). */
export function typesText(shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1]!;
  const hasCommandMod = parts.includes('Mod') || parts.includes('Ctrl') || parts.includes('Alt');
  if (hasCommandMod) return false;
  return key.length === 1 || key === 'Space' || key === 'Backspace';
}

/** Combinations used for editing text; never fire commands while a text field has focus. */
export const TEXT_EDITING = new Set(['Mod+A', 'Mod+C', 'Mod+V', 'Mod+X', 'Mod+Z', 'Mod+Y', 'Mod+Shift+Z', 'Mod+Backspace', 'Mod+Delete', 'Mod+ArrowLeft', 'Mod+ArrowRight', 'Mod+Shift+ArrowLeft', 'Mod+Shift+ArrowRight', 'Home', 'End', 'Shift+Home', 'Shift+End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', 'Enter', 'Tab', 'Shift+Tab']);

/** Combinations the operating system or window manager keeps for itself. */
export function osReserved(platform: string): Map<string, string> {
  const common: Array<[string, string]> = [['Alt+Tab', 'Switches applications'], ['Alt+Shift+Tab', 'Switches applications'], ['Alt+F4', 'Closes windows'], ['Mod+Alt+Delete', 'System security screen']];
  const mac: Array<[string, string]> = [['Mod+Q', 'Quits the application'], ['Mod+H', 'Hides the application'], ['Mod+M', 'Minimises the window'], ['Mod+Tab', 'Switches applications'], ['Mod+Space', 'Spotlight'], ['Mod+Shift+3', 'Screenshot'], ['Mod+Shift+4', 'Screenshot'], ['Mod+Shift+5', 'Screenshot'], ['Mod+Alt+Escape', 'Force quit']];
  const linux: Array<[string, string]> = [['Mod+Alt+T', 'Opens a terminal on many desktops'], ['Mod+Alt+ArrowLeft', 'Switches workspaces'], ['Mod+Alt+ArrowRight', 'Switches workspaces'], ['Mod+Alt+ArrowUp', 'Switches workspaces'], ['Mod+Alt+ArrowDown', 'Switches workspaces'], ['Mod+Alt+L', 'Locks the screen on many desktops']];
  const win: Array<[string, string]> = [['Mod+Shift+Escape', 'Task Manager'], ['Mod+Escape', 'Start menu'], ['Alt+Space', 'Window menu']];
  return new Map([...common, ...(platform === 'darwin' ? mac : platform === 'win32' ? win : linux)]);
}

export interface Binding { command: string; keys: string[] }

export interface ShortcutConflict { key: string; commands: string[] }

/** Commands sharing a key. Deterministic: sorted by key, then command id. */
export function findConflicts(bindings: Binding[]): ShortcutConflict[] {
  const by = new Map<string, string[]>();
  for (const b of bindings) for (const k of b.keys) by.set(k, [...(by.get(k) ?? []), b.command]);
  return [...by.entries()].filter(([, cmds]) => cmds.length > 1).map(([key, commands]) => ({ key, commands: [...commands].sort() })).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Effective bindings: defaults, replaced per command by user bindings.
 * When a user binding takes a key another command has by default, the user's
 * choice wins and the other command loses that key (reported as `displaced`).
 * Two user bindings for one key are a conflict and are rejected at edit time.
 */
export function effectiveBindings(defaults: Binding[], overrides: Record<string, string[]>): { bindings: Binding[]; displaced: Array<{ key: string; from: string; to: string }> } {
  const userKeys = new Map<string, string>();
  for (const [cmd, keys] of Object.entries(overrides)) for (const k of keys) {
    const n = normalizeShortcut(k);
    if (n.ok) userKeys.set(n.value, cmd);
  }
  const displaced: Array<{ key: string; from: string; to: string }> = [];
  const out: Binding[] = [];
  const known = new Set(defaults.map((d) => d.command));
  for (const d of defaults) {
    if (d.command in overrides) {
      out.push({ command: d.command, keys: overrides[d.command]!.map((k) => normalizeShortcut(k)).filter((n): n is { ok: true; value: string } => n.ok).map((n) => n.value) });
      continue;
    }
    const keys = d.keys.filter((k) => {
      const owner = userKeys.get(k);
      if (owner && owner !== d.command) {
        displaced.push({ key: k, from: d.command, to: owner });
        return false;
      }
      return true;
    });
    out.push({ command: d.command, keys });
  }
  // Overrides for commands that no longer exist are ignored (and reported by validation elsewhere).
  void known;
  return { bindings: out, displaced };
}

export interface AssignCheck { ok: boolean; value?: string; reason?: string; conflictWith?: string[]; warning?: string }

/**
 * Check a proposed binding for a command before it is saved.
 * `reserved` contains OS bindings and bindings reserved by a host application.
 */
export function checkAssignment(command: string, key: string, current: Binding[], reserved: Map<string, string>, opts: { mandatory?: Set<string> } = {}): AssignCheck {
  const n = normalizeShortcut(key);
  if (!n.ok) return { ok: false, reason: n.reason };
  if (typesText(n.value)) return { ok: false, reason: `${n.value} types text. Use Ctrl, Alt or a function key so typing in lists and fields keeps working.` };
  const r = reserved.get(n.value);
  if (r) return { ok: false, reason: `${n.value} is reserved: ${r}.` };
  const others = current.filter((b) => b.command !== command && b.keys.includes(n.value)).map((b) => b.command);
  const mandatoryLoss = others.filter((o) => opts.mandatory?.has(o) && (current.find((b) => b.command === o)?.keys.length ?? 0) <= 1);
  if (mandatoryLoss.length) return { ok: false, reason: `${n.value} is the only shortcut of “${mandatoryLoss[0]}”, which must keep one.`, conflictWith: others };
  const warnings: string[] = [];
  if (others.length) warnings.push(`${n.value} is used by ${others.join(', ')}; assigning it will remove it from ${others.length === 1 ? 'that command' : 'those commands'}.`);
  if (TEXT_EDITING.has(n.value)) warnings.push(`${n.value} also edits text, so it will not run this command while a text field has focus.`);
  return { ok: true, value: n.value, conflictWith: others.length ? others : undefined, warning: warnings.join(' ') || undefined };
}

/**
 * On Linux and Windows "Mod" is the Ctrl key, so "Ctrl+K" and "Mod+K" are the
 * same keys. Bindings are compared (and user bindings stored) in the "Mod"
 * spelling there; on macOS Ctrl and Cmd are different keys and stay apart.
 */
export function canonicalFor(platform: string, key: string): string {
  if (platform === 'darwin') return key;
  const parts = key.split('+');
  if (parts.includes('Ctrl') && !parts.includes('Mod')) {
    const n = normalizeShortcut(parts.map((p) => (p === 'Ctrl' ? 'Mod' : p)).join('+'));
    return n.ok ? n.value : key;
  }
  return key;
}
