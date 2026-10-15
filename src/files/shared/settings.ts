import { z } from 'zod';

/**
 * Settings schema. Only settings with a real effect are defined here.
 * Each key validates independently so one bad value never resets the rest.
 */
export const SETTINGS_SCHEMA_VERSION = 1;

/**
 * General (non-presentation) preferences. Appearance, layout, file-view
 * defaults, navigation and accessibility live in the customization engine
 * (shared/customization), which migrated the old keys on first start.
 */
export const SettingsSchema = z.object({
  showHidden: z.boolean().default(false),
  confirmTrash: z.boolean().default(false),
  restoreSession: z.boolean().default(true),
  maxConcurrentOperations: z.number().int().min(1).max(8).default(2),
  previewMaxTextBytes: z.number().int().min(16 * 1024).max(16 * 1024 * 1024).default(2 * 1024 * 1024),
  indexContents: z.boolean().default(false),
  rememberRecents: z.boolean().default(true),
  notifyWhenUnfocused: z.boolean().default(true),
  /** Folder that "Import a copy" copies into; empty means Documents/Orbis Library (or ~/Orbis Library). */
  importFolder: z.string().max(4096).default(''),
  /** Folder whose files are offered under New → (templates); empty means the desktop's templates folder (Linux: XDG, ~/Templates) when it exists. */
  templatesFolder: z.string().max(4096).default(''),
  archiveMaxTotalGB: z.number().int().min(1).max(4096).default(64),
  archiveMaxRatio: z.number().int().min(10).max(100000).default(1000),
  archiveMaxEntries: z.number().int().min(100).max(10_000_000).default(500_000),
  nestedArchiveDepth: z.number().int().min(1).max(8).default(3),
  nestedArchiveMaxMB: z.number().int().min(16).max(16384).default(2048),
  diagnosticsVerbose: z.boolean().default(false),
  /** Version-control status (branch, badges, the Git column) for folders inside a work tree, when the git program is installed. */
  gitIntegration: z.boolean().default(true),
  /**
   * Built-in terminal shell: "auto" ($SHELL on Linux/macOS; PowerShell 7, Windows PowerShell or cmd on Windows),
   * an absolute path from the detected list, or "custom" (terminalCustomPath + terminalCustomArgs).
   */
  terminalShell: z.string().min(1).max(4096).default('auto'),
  terminalCustomPath: z.string().max(4096).default(''),
  /** Arguments for the custom shell, written like a command line ("-l", "--login -i"). */
  terminalCustomArgs: z.string().max(1024).default(''),
  /** Terminal text size in pixels; 0 follows the app's text size. The font is always the app's monospace font. */
  terminalFontSize: z.number().int().min(0).max(32).refine((n) => n === 0 || n >= 8, 'Use 0 (follow the app) or 8–32.').default(0),
  terminalScrollback: z.number().int().min(100).max(100_000).default(5000),
  /**
   * Ask before pasting text with more than one line into a terminal: "auto" asks only when the program has not
   * turned on bracketed paste (so each line would run as soon as it arrives), "always" asks every time, "never" never.
   */
  terminalMultilinePaste: z.enum(['auto', 'always', 'never']).default('auto'),
  /** `collections` was added later; stored values without it keep the others and show Collections. */
  homeSections: z
    .object({ quickAccess: z.boolean(), recent: z.boolean(), drives: z.boolean(), operations: z.boolean(), collections: z.boolean().default(true) })
    .default({ quickAccess: true, recent: true, drives: true, operations: true, collections: true }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/**
 * Validate a raw stored record key-by-key. Invalid or unknown keys fall back to
 * defaults individually and are reported, so a single corrupt value does not
 * silently reset the user's other preferences.
 */
export function validateSettings(raw: Record<string, unknown>): { settings: Settings; invalid: string[]; unknown: string[] } {
  const shape = SettingsSchema.shape;
  const out: Record<string, unknown> = {};
  const invalid: string[] = [];
  const unknown: string[] = [];
  for (const key of Object.keys(shape) as SettingKey[]) {
    if (!(key in raw)) {
      out[key] = DEFAULT_SETTINGS[key];
      continue;
    }
    const parsed = shape[key].safeParse(raw[key]);
    if (parsed.success) out[key] = parsed.data;
    else {
      invalid.push(key);
      out[key] = DEFAULT_SETTINGS[key];
    }
  }
  for (const key of Object.keys(raw)) if (!(key in shape)) unknown.push(key);
  return { settings: out as Settings, invalid, unknown };
}

export function validateSettingValue<K extends SettingKey>(key: K, value: unknown): Settings[K] {
  const schema = SettingsSchema.shape[key];
  if (!schema) throw new Error(`Unknown setting "${String(key)}"`);
  return schema.parse(value) as Settings[K];
}
