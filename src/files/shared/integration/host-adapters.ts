import { z } from 'zod';
import { COLOR_TOKEN_IDS, HOST_OVERRIDABLE_TOKENS, type ColorTokenId } from '../customization/tokens';
import { parseColor } from '../customization/color';
import { normalizeShortcut } from '../customization/shortcuts';

/**
 * Integration adapters for a FUTURE Orbis host (version 1.0.0).
 *
 * Orbis Files runs on its own today. These are the explicit, versioned seams
 * through which the existing Orbis desktop app could later supply design
 * tokens, a profile identity, a settings entry point, reserved shortcuts and
 * an AI provider. Each has a standalone fallback that is always used when no
 * host is connected, and every host input is validated before use.
 * Nothing here assumes an Orbis API exists; see docs/CUSTOMIZATION.md §Integration.
 */

export const HOST_ADAPTERS_VERSION = '1.0.0';

const isV1 = (v: string) => /^1\.\d+\.\d+$/.test(v);

// ------------------------------------------------------------------ design-system adapter

export const HostDesignTokensSchema = z.object({
  contract: z.string().max(20),
  /** Values for supported token ids, per mode. Unknown or protected tokens are rejected individually. */
  dark: z.record(z.string().max(40), z.string().max(64)).optional(),
  light: z.record(z.string().max(40), z.string().max(64)).optional(),
});

export interface HostTokenResult {
  tokens: { contract: string; dark?: Partial<Record<ColorTokenId, string>>; light?: Partial<Record<ColorTokenId, string>> } | null;
  accepted: string[];
  rejected: Array<{ token: string; reason: string }>;
  error?: string;
}

/** Validate tokens supplied by a host. Invalid input never replaces the standalone theme. */
export function validateHostTokens(raw: unknown): HostTokenResult {
  const p = HostDesignTokensSchema.safeParse(raw);
  if (!p.success) return { tokens: null, accepted: [], rejected: [], error: 'The design tokens are not in the expected shape.' };
  if (!isV1(p.data.contract)) return { tokens: null, accepted: [], rejected: [], error: `Unsupported design-token contract ${p.data.contract}; this version accepts 1.x.` };
  const accepted: string[] = [];
  const rejected: Array<{ token: string; reason: string }> = [];
  const out: HostTokenResult['tokens'] = { contract: p.data.contract };
  for (const mode of ['dark', 'light'] as const) {
    const src = p.data[mode];
    if (!src) continue;
    const m: Partial<Record<ColorTokenId, string>> = {};
    for (const [k, v] of Object.entries(src)) {
      if (!(COLOR_TOKEN_IDS as readonly string[]).includes(k)) rejected.push({ token: `${mode}.${k}`, reason: 'Unknown token.' });
      else if (!HOST_OVERRIDABLE_TOKENS.has(k as ColorTokenId)) rejected.push({ token: `${mode}.${k}`, reason: 'Status, focus and file-type colours stay under Orbis Files’ control.' });
      else {
        const c = parseColor(v);
        if (!c) rejected.push({ token: `${mode}.${k}`, reason: 'Not a colour.' });
        else {
          m[k as ColorTokenId] = c;
          accepted.push(`${mode}.${k}`);
        }
      }
    }
    out[mode] = m;
  }
  return { tokens: accepted.length ? out : null, accepted, rejected, error: accepted.length ? undefined : 'No supported tokens were supplied.' };
}

// ------------------------------------------------------------------ profile adapter

/** Who scopes Orbis Files' local data. Standalone: the local profile chosen at launch (`--orbis-profile`). */
export interface ProfileProvider {
  readonly source: 'local' | 'host';
  /** Opaque id; Orbis Files stores everything under profiles/<id>/ and never reads other profiles. */
  profileId(): string;
}

export class LocalProfileProvider implements ProfileProvider {
  readonly source = 'local' as const;
  constructor(private readonly id: string) {}
  profileId(): string {
    return this.id;
  }
}

// ------------------------------------------------------------------ settings adapter

/** Places a host could link to; standalone, Orbis Files shows them in its own Settings and Customization Studio. */
export const FILES_SETTINGS_ENTRY_POINTS = [
  { id: 'files.settings', title: 'Orbis Files settings', location: { kind: 'tool', tool: 'settings' } },
  { id: 'files.customization', title: 'Customization Studio', location: { kind: 'tool', tool: 'customize' } },
  { id: 'files.customization.appearance', title: 'Appearance', location: { kind: 'tool', tool: 'customize' }, category: 'appearance' },
  { id: 'files.customization.layout', title: 'Layout', location: { kind: 'tool', tool: 'customize' }, category: 'layout' },
  { id: 'files.customization.workspaces', title: 'Workspaces', location: { kind: 'tool', tool: 'customize' }, category: 'workspaces' },
  { id: 'files.customization.shortcuts', title: 'Keyboard shortcuts', location: { kind: 'tool', tool: 'customize' }, category: 'shortcuts' },
  { id: 'files.integrations', title: 'Integrations & diagnostics', location: { kind: 'tool', tool: 'integrations' } },
] as const;
export type SettingsEntryId = (typeof FILES_SETTINGS_ENTRY_POINTS)[number]['id'];

// ------------------------------------------------------------------ command & shortcut adapter

export const COMMAND_CONTEXTS = ['global', 'files', 'selection', 'folder'] as const;
export const COMMAND_PERMISSIONS = ['read', 'navigate', 'settings', 'modify', 'destructive'] as const;

export const CommandDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z][A-Za-z0-9.:-]{1,63}$/),
  title: z.string().min(1).max(120),
  category: z.string().min(1).max(40),
  description: z.string().max(300),
  /** Where the command applies. */
  contexts: z.array(z.enum(COMMAND_CONTEXTS)).min(1).max(4),
  /** What running it may do; a host must not run "modify" or "destructive" commands without the user. */
  permission: z.enum(COMMAND_PERMISSIONS),
  defaultKeys: z.array(z.string().max(40)).max(4),
  keys: z.array(z.string().max(40)).max(4),
}).strict();
export type CommandDescriptor = z.infer<typeof CommandDescriptorSchema>;

export const ReservedShortcutsSchema = z.object({
  shortcuts: z.array(z.string().max(40)).max(200),
  /** Shown to the user: “Reserved by <source>”. */
  source: z.string().max(60).default('the Orbis app'),
});

export function validateReservedShortcuts(raw: unknown): { reserved: Map<string, string>; rejected: string[] } {
  const p = ReservedShortcutsSchema.safeParse(raw);
  const reserved = new Map<string, string>();
  const rejected: string[] = [];
  if (!p.success) return { reserved, rejected: ['(invalid request)'] };
  for (const s of p.data.shortcuts) {
    const n = normalizeShortcut(s);
    if (n.ok) reserved.set(n.value, `used by ${p.data.source}`);
    else rejected.push(s);
  }
  return { reserved, rejected };
}

// ------------------------------------------------------------------ AI adapter

/**
 * A host may OFFER an AI provider endpoint. Orbis Files never switches on its
 * own: the user is asked, and the endpoint must pass the same rules as one the
 * user types (HTTPS, or HTTP on loopback only). The provider contract itself is
 * shared/integration/ai-contract.ts; no simulated provider exists.
 */
export const AiProviderOfferSchema = z.object({
  endpoint: z.string().url().max(2048),
  providerName: z.string().min(1).max(80),
});
