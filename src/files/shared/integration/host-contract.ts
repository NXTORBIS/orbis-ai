import { z } from 'zod';

/**
 * Orbis desktop host integration contract — version 1.
 *
 * Describes messages exchanged between Orbis Files and the main Orbis desktop
 * application (chat + browser). No internal Orbis API is assumed: the host
 * connects by launching Orbis Files with a command-line request, or later via a
 * transport the host provides (documented in docs/INTEGRATION.md).
 *
 * Orbis Files is fully usable when no host is present.
 */

export const HOST_CONTRACT_VERSION = '1.3.0';

/** Reply files are new JSON files the host asks for, written atomically; never overwrites. */
const replyFile = z.string().min(1).max(4096).regex(/\.json$/i, 'Reply files must end in .json');

/** A profile id is also its folder name under userData/profiles. */
export const ProfileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Profile names use letters, digits, “-” and “_” (up to 64 characters).');

/** Requests the host can make, e.g. passed as `--orbis-request=<base64 json>`. */
export const HostRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open-location'), path: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('reveal-file'), path: z.string().min(1).max(4096) }),
  z.object({
    type: z.literal('register-download'),
    download: z.object({
      path: z.string().min(1).max(4096),
      url: z.string().url().max(8192).optional(),
      referrer: z.string().max(8192).optional(),
      mime: z.string().max(256).optional(),
      startedMs: z.number().int().optional(),
      finishedMs: z.number().int().optional(),
      state: z.enum(['in_progress', 'completed', 'failed', 'cancelled', 'interrupted']),
      browser: z.string().max(64).default('orbis'),
    }),
  }),
  z.object({
    type: z.literal('register-generated'),
    item: z.object({
      path: z.string().min(1).max(4096),
      generator: z.string().max(128),
      chatId: z.string().max(256).optional(),
      prompt: z.string().max(4000).optional(),
      createdMs: z.number().int().optional(),
    }),
  }),
  /** Ask the user to choose files/folders in Orbis Files; the answer is written to `replyFile`. (1.1) */
  z.object({
    type: z.literal('pick-file'),
    requestId: z.string().max(128).optional(),
    title: z.string().max(200).optional(),
    multiple: z.boolean().default(false),
    kinds: z.enum(['files', 'folders', 'both']).default('files'),
    replyFile,
  }),
  /** Write Orbis Files' integration status (versions, capabilities, AI state) to `replyFile`. (1.1) */
  z.object({ type: z.literal('report-status'), requestId: z.string().max(128).optional(), replyFile }),
  /** Register (or update) a native content provider backed by a JSON feed file the host maintains. (1.1) */
  z.object({
    type: z.literal('register-content-feed'),
    feed: z.object({
      providerId: z.string().regex(/^[a-z0-9._-]{1,64}$/),
      label: z.string().min(1).max(100),
      types: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).min(1).max(20),
      feedFile: z.string().min(1).max(4096),
    }),
  }),
  z.object({ type: z.literal('unregister-content-feed'), providerId: z.string().regex(/^[a-z0-9._-]{1,64}$/) }),
  /** Receive events (operation results, pick answers) as JSON lines appended to a new file in the temp folder. (1.2) */
  z.object({ type: z.literal('register-event-sink'), sinkFile: z.string().min(1).max(4096).regex(/\.(ndjson|jsonl)$/i, 'Event sinks must end in .ndjson or .jsonl') }),
  z.object({ type: z.literal('unregister-event-sink'), sinkFile: z.string().min(1).max(4096) }),
  /** Supply design tokens (host-adapters.ts) used beneath the user's own customization. (1.3) */
  z.object({ type: z.literal('set-design-tokens'), tokens: z.unknown() }),
  z.object({ type: z.literal('clear-design-tokens') }),
  /** Shortcuts the host keeps for itself; Orbis Files will not let users assign them. (1.3) */
  z.object({ type: z.literal('set-reserved-shortcuts'), shortcuts: z.array(z.string().max(40)).max(200), source: z.string().max(60).optional() }),
  /** Write the Files command registry (ids, titles, permissions, bindings) to a reply file. (1.3) */
  z.object({ type: z.literal('report-commands'), requestId: z.string().max(128).optional(), replyFile }),
  /** Open Orbis Files' own settings at a given entry point. (1.3) */
  z.object({ type: z.literal('open-settings'), entry: z.string().max(64).default('files.customization') }),
  /** Offer an AI provider; the user decides. (1.3) */
  z.object({ type: z.literal('offer-ai-provider'), endpoint: z.string().url().max(2048), providerName: z.string().min(1).max(80) }),
  z.object({ type: z.literal('set-profile'), profileId: ProfileIdSchema }),
]);
export type HostRequest = z.infer<typeof HostRequestSchema>;

/** One line of an event sink (1.2). */
export type HostEvent =
  | { contract: string; ts: number; type: 'operation-finished'; operation: { id: string; type: string; state: string; origin?: string; destination?: string; summary?: { done: number; skipped: number; failed: number; cancelled: number } } }
  | { contract: string; ts: number; type: 'pick-answered'; requestId?: string; status: 'selected' | 'cancelled'; count: number }
  | { contract: string; ts: number; type: 'sink-registered' };

/** Reply written for pick-file. */
export interface PickFileReply {
  contract: string;
  requestId?: string;
  status: 'selected' | 'cancelled';
  paths: string[];
}

/** Content of a feed file registered with register-content-feed. */
export const ContentFeedSchema = z.object({
  contract: z.string().regex(/^1\.\d+\.\d+$/),
  items: z.array(z.object({
    id: z.string().min(1).max(256),
    type: z.string().regex(/^[a-z0-9_]{1,40}$/),
    title: z.string().min(1).max(500),
    description: z.string().max(2000).optional(),
    modifiedMs: z.number().int().optional(),
    size: z.number().int().nonnegative().optional(),
    /** Absolute path of the file that stores the item, when it is stored as a file. */
    path: z.string().max(4096).optional(),
    /** How the Orbis app opens the item, e.g. orbis://note/123. Only orbis: schemes are accepted. */
    openUri: z.string().max(2048).regex(/^orbis(-[a-z0-9]+)?:/i).optional(),
  })).max(10000),
});
export type ContentFeed = z.infer<typeof ContentFeedSchema>;

export type HostStatus = 'standalone' | 'connected' | 'error';

export function parseHostRequestArg(argv: readonly string[]): { request?: HostRequest; error?: string } {
  const arg = argv.find((a) => a.startsWith('--orbis-request='));
  if (!arg) return {};
  try {
    const json = Buffer.from(arg.slice('--orbis-request='.length), 'base64').toString('utf8');
    const parsed = HostRequestSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return { error: `Invalid Orbis host request: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}` };
    return { request: parsed.data };
  } catch {
    return { error: 'Orbis host request is not valid base64 JSON.' };
  }
}

export function parseProfileArg(argv: readonly string[]): string | undefined {
  const arg = argv.find((a) => a.startsWith('--orbis-profile='));
  if (!arg) return undefined;
  const id = arg.slice('--orbis-profile='.length);
  return ProfileIdSchema.safeParse(id).success ? id : undefined;
}
