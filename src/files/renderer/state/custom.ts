import { createStore, useStore } from './store';
import { call, on, UiError } from '../api';
import { toast, toastError } from './app';
import { defaultConfig, type CustomizationConfig } from '../../shared/customization/schema';
import { resolveCustomization, type HostTokens, type Resolved } from '../../shared/customization/resolve';
import { applyOp, validateConfig, type CustomizationError, type CustomOp } from '../../shared/customization/ops';

/**
 * Renderer side of the customization engine.
 *
 * The main process owns the configuration (validation, persistence, undo
 * history). The renderer resolves it locally with the system preferences it
 * can observe (colour scheme, contrast, reduced motion), applies the result to
 * the document as CSS variables and data attributes outside React, and hands
 * stable section objects to components so that, for example, a colour change
 * does not re-render the file list.
 */

export interface ServerState {
  config: CustomizationConfig;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  hostTokens: HostTokens | null;
  hostReserved: Array<{ key: string; reason: string }>;
  osReserved: Array<{ key: string; reason: string }>;
  backups: Array<{ slot: string; savedMs: number; label: string }>;
  lastGoodMs?: number;
}

export interface SystemPrefs { dark: boolean; highContrast: boolean; reducedMotion: boolean; reducedTransparency: boolean }

export interface CustomState {
  ready: boolean;
  server: ServerState;
  system: SystemPrefs;
  /** Uncommitted configuration shown while previewing in the Customization Studio (never stored). */
  preview: CustomizationConfig | null;
  previewLabel?: string;
  /** The change that "Apply" commits for the current preview. */
  previewOp?: CustomOp;
  resolved: Resolved;
}

const initialConfig = defaultConfig(0);
const initialSystem: SystemPrefs = { dark: true, highContrast: false, reducedMotion: false, reducedTransparency: false };
const initialServer: ServerState = { config: initialConfig, canUndo: false, canRedo: false, hostTokens: null, hostReserved: [], osReserved: [], backups: [] };

export const custom = createStore<CustomState>({
  ready: false,
  server: initialServer,
  system: initialSystem,
  preview: null,
  resolved: resolveCustomization(initialConfig, { systemDark: true }),
});

/** Keep unchanged sections identical (===) so subscribers to them do not re-render. */
function stabilize(prev: Resolved, next: Resolved): Resolved {
  const out = { ...next } as Record<string, unknown>;
  for (const k of ['appearance', 'layout', 'view', 'accessibility', 'navigation', 'toolbar', 'contextMenu', 'shortcuts', 'tokens', 'cssVars', 'sources', 'adjustments', 'preset', 'workspace'] as const) {
    if (JSON.stringify((prev as unknown as Record<string, unknown>)[k]) === JSON.stringify(out[k])) out[k] = (prev as unknown as Record<string, unknown>)[k];
  }
  return out as unknown as Resolved;
}

function recompute(patch: Partial<CustomState>): void {
  const s = { ...custom.get(), ...patch };
  const cfg = s.preview ?? s.server.config;
  const next = resolveCustomization(cfg, { systemDark: s.system.dark, systemHighContrast: s.system.highContrast, systemReducedMotion: s.system.reducedMotion, systemReducedTransparency: s.system.reducedTransparency, hostTokens: s.server.hostTokens });
  custom.set({ ...patch, resolved: stabilize(s.resolved, next) });
}

export function useCustom<S>(selector: (r: Resolved) => S): S {
  return useStore(custom, (s) => selector(s.resolved));
}

export function resolvedNow(): Resolved {
  return custom.get().resolved;
}

export function configNow(): CustomizationConfig {
  return custom.get().server.config;
}

// ------------------------------------------------------------------ document

let appliedVars: Record<string, string> = {};

/** Apply CSS variables and data attributes; only what changed is written. */
function applyToDocument(r: Resolved): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(r.cssVars)) if (appliedVars[k] !== v) root.style.setProperty(k, v);
  for (const k of Object.keys(appliedVars)) if (!(k in r.cssVars)) root.style.removeProperty(k);
  appliedVars = r.cssVars;
  const set = (name: string, value: string | undefined) => {
    if (value === undefined) delete root.dataset[name];
    else if (root.dataset[name] !== value) root.dataset[name] = value;
  };
  set('theme', r.mode);
  set('density', r.appearance.density);
  set('reduceMotion', r.reducedMotion ? 'true' : 'false');
  set('effects', r.appearance.reducedEffects ? 'reduced' : 'full');
  set('highContrast', r.highContrast ? 'true' : 'false');
  set('underlineLinks', r.accessibility.underlineLinks ? 'true' : 'false');
  set('folderIcons', r.navigation.folderIcons);
  set('focusRing', r.accessibility.focusRing);
  set('font', r.appearance.fontFamily);
  set('material', r.material);
  set('ambient', r.ambient);
  set('ambientMotion', r.ambientMotion ? 'on' : 'off');
  set('glow', r.cssVars['--glow'] === '0' ? 'off' : 'on');
  set('floating', r.layout && Number.parseInt(r.cssVars['--panel-gap'] ?? '0', 10) > 0 ? 'true' : 'false');
}

// ------------------------------------------------------------------ boot

export async function bootCustomization(): Promise<void> {
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  const mqContrast = window.matchMedia('(prefers-contrast: more), (forced-colors: active)');
  const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mqTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)');
  const readSystem = (): SystemPrefs => ({ dark: mqDark.matches, highContrast: mqContrast.matches, reducedMotion: mqMotion.matches, reducedTransparency: mqTransparency.matches });
  const server = await call<ServerState>('custom:get');
  recompute({ server, system: readSystem(), ready: true });
  applyToDocument(custom.get().resolved);
  let last = custom.get().resolved;
  custom.subscribe(() => {
    const r = custom.get().resolved;
    if (r !== last) {
      last = r;
      applyToDocument(r);
    }
  });
  const onSystem = () => recompute({ system: readSystem() });
  for (const mq of [mqDark, mqContrast, mqMotion, mqTransparency]) mq.addEventListener('change', onSystem);
  on<ServerState>('custom:changed', (server) => recompute({ server }));
  // The ambient light rests while the window is in the background or hidden.
  const markActive = () => {
    document.documentElement.dataset.windowActive = document.hasFocus() && document.visibilityState === 'visible' ? 'true' : 'false';
  };
  window.addEventListener('focus', markActive);
  window.addEventListener('blur', markActive);
  document.addEventListener('visibilitychange', markActive);
  markActive();
}

// ------------------------------------------------------------------ edits

/** Report a refusal with its explanation (and suggested alternative, when there is one). */
function reportRefusal(err: unknown, title: string): void {
  if (err instanceof UiError && err.shape.category === 'validation') {
    toast({ level: 'warning', title: err.shape.message, detail: err.shape.cause });
    return;
  }
  toastError(err, title);
}

/**
 * Apply one change. Returns false (after explaining why) when the engine
 * refused it; the active configuration is then unchanged.
 */
export async function applyCustom(op: CustomOp, opts: { quiet?: boolean } = {}): Promise<boolean> {
  try {
    const r = await call<ServerState & { notice?: string }>('custom:apply', { op, systemDark: custom.get().system.dark });
    const { notice, ...server } = r;
    recompute({ server });
    if (notice && !opts.quiet) toast({ level: 'info', title: notice });
    return true;
  } catch (err) {
    reportRefusal(err, 'The change was not applied');
    return false;
  }
}

export async function undoCustom(): Promise<void> {
  try {
    recompute({ server: await call<ServerState>('custom:undo') });
  } catch (err) {
    reportRefusal(err, 'Nothing was undone');
  }
}

export async function redoCustom(): Promise<void> {
  try {
    recompute({ server: await call<ServerState>('custom:redo') });
  } catch (err) {
    reportRefusal(err, 'Nothing was redone');
  }
}

export async function revertCustom(): Promise<void> {
  try {
    recompute({ server: await call<ServerState>('custom:revert') });
    toast({ level: 'success', title: 'Returned to the previous configuration' });
  } catch (err) {
    reportRefusal(err, 'Could not return to the previous configuration');
  }
}

export async function restoreBackup(slot: string): Promise<void> {
  try {
    recompute({ server: await call<ServerState>('custom:restoreBackup', { slot }) });
    toast({ level: 'success', title: 'Backup restored' });
  } catch (err) {
    reportRefusal(err, 'The backup was not restored');
  }
}

/** End a preview without changing anything. */
export function cancelPreview(): void {
  if (custom.get().preview) recompute({ preview: null, previewLabel: undefined, previewOp: undefined });
}

/**
 * Preview a change on the real interface without storing it. The change is
 * computed and validated exactly as the main process would; Apply sends the
 * same change to be committed.
 */
export function previewChange(op: CustomOp, label: string): boolean {
  try {
    const next = validateConfig(applyOp(custom.get().server.config, op, { systemDark: custom.get().system.dark }).config);
    recompute({ preview: next, previewLabel: label, previewOp: op });
    return true;
  } catch (err) {
    const e = err as CustomizationError;
    toast({ level: 'warning', title: e.message, detail: e.details?.join('\n') });
    return false;
  }
}

/**
 * Live draft for continuous controls (sliders, colour pickers): the change is
 * shown immediately on the real interface and committed shortly after the
 * control stops moving, as one undoable step. No Apply bar is shown.
 */
let draftTimer: ReturnType<typeof setTimeout> | undefined;
export function liveDraft(op: CustomOp, commitAfterMs = 350): void {
  try {
    const next = validateConfig(applyOp(custom.get().server.config, op, { systemDark: custom.get().system.dark }).config);
    recompute({ preview: next, previewLabel: undefined, previewOp: undefined });
  } catch {
    /* invalid intermediate value: keep showing the last valid state */
  }
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    void applyCustom(op, { quiet: true }).finally(() => {
      if (!custom.get().previewLabel) recompute({ preview: null });
    });
  }, commitAfterMs);
}

export async function applyPreview(): Promise<boolean> {
  const op = custom.get().previewOp;
  if (!op) return false;
  const ok = await applyCustom(op);
  cancelPreview();
  return ok;
}

/** Push the Files command registry (with metadata) to the main process for the shortcut adapter and host reports. */
export function reportRegistry(commands: unknown[]): void {
  void call('custom:registry', { commands }).catch(() => undefined);
}

export function isPreviewing(): boolean {
  return custom.get().preview !== null;
}
