import { z } from 'zod';

/**
 * Bulk rename: an ordered pipeline of rules, each of which can be switched off.
 * The main process computes the preview (and validates the spec again); the
 * renderer edits it and stores presets of it.
 */

const enabled = z.boolean().default(true);
const position = z.enum(['start', 'end', 'index']);
const index = z.number().int().min(0).max(1024).default(0);

export const RenameRuleSchema = z.discriminatedUnion('type', [
  /** Find & replace: plain text or a regular expression ($1, $2… insert captured groups). */
  z.object({ type: z.literal('replace'), enabled, find: z.string().max(1024), replace: z.string().max(1024).default(''), regex: z.boolean().default(false), caseSensitive: z.boolean().default(false) }),
  /** Insert text (tokens allowed) at the start, the end or a character position. */
  z.object({ type: z.literal('insert'), enabled, text: z.string().max(512), at: position.default('start'), index }),
  /** Remove characters: `count` characters from position `from`, or from the start / end. */
  z.object({ type: z.literal('remove'), enabled, mode: z.enum(['range', 'start', 'end']).default('range'), from: index, count: z.number().int().min(0).max(1024).default(1) }),
  z.object({ type: z.literal('case'), enabled, mode: z.enum(['lower', 'upper', 'title', 'sentence', 'camel', 'kebab', 'snake']) }),
  /** Sequence numbers. With `perFolder` the count restarts in every folder. */
  z.object({
    type: z.literal('number'), enabled,
    start: z.number().int().min(-1_000_000_000).max(1_000_000_000).default(1),
    step: z.number().int().min(-1_000_000).max(1_000_000).default(1),
    pad: z.number().int().min(0).max(10).default(0),
    at: position.default('end'), index,
    separator: z.string().max(8).default(' '),
    perFolder: z.boolean().default(false),
  }),
  /** A date from the file's modified or created time, or the photo's EXIF DateTimeOriginal. */
  z.object({
    type: z.literal('date'), enabled,
    source: z.enum(['modified', 'created', 'exif']).default('modified'),
    format: z.string().min(1).max(64).default('YYYY-MM-DD'),
    at: z.enum(['start', 'end']).default('start'),
    separator: z.string().max(8).default(' '),
    /** When a photo has no EXIF date: use the modified time, or leave the item unrenamed. */
    fallback: z.enum(['modified', 'skip']).default('skip'),
  }),
  z.object({ type: z.literal('extension'), enabled, mode: z.enum(['lower', 'upper', 'set', 'remove']), value: z.string().max(64).default('') }),
  z.object({ type: z.literal('spaces'), enabled, trim: z.boolean().default(true), collapse: z.boolean().default(true), underscores: z.enum(['keep', 'to-spaces', 'from-spaces']).default('keep') }),
  z.object({ type: z.literal('diacritics'), enabled }),
  /** Replace the whole name with a pattern of tokens, e.g. "{parent} {n:3}". */
  z.object({ type: z.literal('template'), enabled, pattern: z.string().min(1).max(512) }),
]);

export const RenameSpecSchema = z.object({
  rules: z.array(RenameRuleSchema).max(40),
  /** Apply text rules to the whole name including the extension (folders always use the whole name). */
  includeExtension: z.boolean().default(false),
  /** 'block': clashes must be resolved before renaming. 'suffix': add " (2)", " (3)"… until the name is free. */
  onConflict: z.enum(['block', 'suffix']).default('block'),
  /** Order used for numbering: as selected, by name (natural) or by modification time. */
  order: z.enum(['given', 'name', 'modified']).default('given'),
});

export type RenameRule = z.infer<typeof RenameRuleSchema>;
export type RenameRuleInput = z.input<typeof RenameRuleSchema>;
export type RenameSpec = z.infer<typeof RenameSpecSchema>;
export type RenameSpecInput = z.input<typeof RenameSpecSchema>;
export type RenameRuleType = RenameRule['type'];

export const RENAME_RULE_LABELS: Record<RenameRuleType, string> = {
  replace: 'Find and replace',
  insert: 'Insert text',
  remove: 'Remove characters',
  case: 'Change case',
  number: 'Numbering',
  date: 'Date',
  extension: 'Extension',
  spaces: 'Spaces',
  diacritics: 'Remove accents',
  template: 'Rename with a pattern',
};

/** A rule with its defaults filled in. */
export function defaultRule(type: RenameRuleType): RenameRule {
  const base: Record<RenameRuleType, RenameRuleInput> = {
    replace: { type: 'replace', find: '' },
    insert: { type: 'insert', text: '' },
    remove: { type: 'remove' },
    case: { type: 'case', mode: 'lower' },
    number: { type: 'number' },
    date: { type: 'date' },
    extension: { type: 'extension', mode: 'lower' },
    spaces: { type: 'spaces' },
    diacritics: { type: 'diacritics' },
    template: { type: 'template', pattern: '{name}' },
  };
  return RenameRuleSchema.parse(base[type]);
}

export const RENAME_TOKENS: Array<{ token: string; meaning: string }> = [
  { token: '{name}', meaning: 'original name without extension' },
  { token: '{ext}', meaning: 'original extension (without the dot)' },
  { token: '{n}', meaning: 'position in the list (1, 2, 3…); {n:3} pads to 001' },
  { token: '{parent}', meaning: 'name of the folder the item is in' },
  { token: '{date}', meaning: 'modified date; {date:YYYYMMDD} picks the format' },
  { token: '{created}', meaning: 'created date (same formats)' },
  { token: '{taken}', meaning: 'photo date from EXIF DateTimeOriginal (same formats)' },
  { token: '{width}', meaning: 'image or video width in pixels' },
  { token: '{height}', meaning: 'image or video height in pixels' },
];

export const DATE_FORMAT_HELP = 'YYYY year, YY two-digit year, MM month, DD day, hh hour, mm minute, ss second';

export type RenameStatus = 'renamed' | 'unchanged' | 'conflict' | 'duplicate' | 'invalid';

export interface RenamePreviewItem {
  from: string;
  to: string;
  oldName: string;
  newName: string;
  status: RenameStatus;
  reason?: string;
  /** Set when the name was changed to avoid a clash ("add (2) on conflict"). */
  suffixed?: boolean;
}

export interface RenamePreview {
  items: RenamePreviewItem[];
  /** A problem with the rules themselves (bad regular expression, unknown token…). Nothing can be applied. */
  error?: string;
  counts: Record<RenameStatus, number>;
}

export const RenamePresetSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  spec: RenameSpecSchema,
  savedMs: z.number().int().nonnegative(),
});
export type RenamePreset = z.infer<typeof RenamePresetSchema>;
