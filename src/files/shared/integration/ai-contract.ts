import { z } from 'zod';

/**
 * Orbis AI provider contract — version 1 (1.1 adds edit_file proposals and
 * content hashes in context items; 1.2 adds folder listings to directory
 * context items).
 *
 * Orbis Files never talks to a model directly from the UI. A provider adapter
 * registers with the ProviderRegistry and speaks this contract: the HTTP
 * adapter for the separately developed Orbis AI, or the OpenAI-compatible
 * adapter, which maps each task to a chat-completions request and builds a
 * contract result from the model's reply. Every message crossing the boundary is validated with
 * these schemas; unknown or malformed responses are rejected, never treated as
 * success.
 *
 * No model ships with Orbis Files. Until a provider is configured the
 * registry reports `not_configured` and all AI actions are disabled.
 */

export const AI_CONTRACT_VERSION = '1.2.0';
export const AI_CONTRACT_MAJOR = 1;

export const ProviderStatusSchema = z.enum([
  'not_configured',
  'disconnected',
  'connecting',
  'available',
  'degraded',
  'unavailable',
  'reconnecting',
  'error',
  'incompatible',
]);
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

/** Capabilities a provider may declare. Only declared capabilities are enabled. */
export const CapabilitySchema = z.enum([
  'explain_file',
  'summarize_document',
  'extract_structured',
  'compare_interpret',
  'folder_analysis',
  'nl_search_plan',
  'organize_suggestions',
  'generate_file',
  'edit_file',
  'image_understanding',
  'pdf_understanding',
  'streaming',
  'cancellation',
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const HandshakeSchema = z.object({
  providerId: z.string().min(1).max(128),
  providerName: z.string().min(1).max(128),
  providerVersion: z.string().max(64),
  contractVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  capabilities: z.array(CapabilitySchema).max(64),
  /** Where processing happens. Declared by the provider and shown to the user; not assumed. */
  processing: z.enum(['local', 'remote', 'mixed', 'unknown']),
  limits: z
    .object({
      maxContextBytes: z.number().int().positive().optional(),
      maxFiles: z.number().int().positive().optional(),
      maxFileBytes: z.number().int().positive().optional(),
      supportedMime: z.array(z.string().max(128)).max(256).optional(),
    })
    .default({}),
  models: z.array(z.object({ id: z.string().max(128), label: z.string().max(128) })).max(32).optional(),
});
export type Handshake = z.infer<typeof HandshakeSchema>;

/** Most folder entries sent in a directory context item's listing. */
export const MAX_LISTING_ENTRIES = 500;

/** Context the user explicitly selected. Content is attached only with permission. */
export const ContextItemSchema = z.object({
  ref: z.string().min(1).max(4096),
  kind: z.enum(['file', 'directory', 'native']),
  name: z.string().max(1024),
  mime: z.string().max(128).optional(),
  size: z.number().int().nonnegative().optional(),
  share: z.enum(['metadata', 'content']),
  /** Present only when share === 'content' and the user approved it. */
  content: z
    .object({
      encoding: z.enum(['utf8', 'base64']),
      data: z.string(),
      truncated: z.boolean(),
      /** SHA-256 of the exact bytes shared (1.1). An edit_file proposal must name it as its base. */
      sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    })
    .optional(),
  /**
   * Directories only (1.2): the folder's first entries by name — names, kinds
   * and file sizes, never contents. Hidden (dot) entries are left out unless
   * the user shows hidden files.
   */
  listing: z
    .object({
      entries: z.array(z.object({ name: z.string().max(1024), kind: z.enum(['file', 'directory', 'symlink', 'other']), size: z.number().int().nonnegative().optional() })).max(MAX_LISTING_ENTRIES),
      /** Entries in the folder after hidden ones were left out. */
      total: z.number().int().nonnegative(),
      truncated: z.boolean(),
      hiddenOmitted: z.boolean(),
    })
    .optional(),
});
export type ContextItem = z.infer<typeof ContextItemSchema>;

export const TaskKindSchema = z.enum([
  'explain_file',
  'summarize_document',
  'extract_structured',
  'compare_interpret',
  'folder_analysis',
  'nl_search_plan',
  'organize_suggestions',
  'generate_file',
  'edit_file',
]);
export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TaskRequestSchema = z.object({
  taskId: z.string().uuid(),
  kind: TaskKindSchema,
  prompt: z.string().max(20000).optional(),
  context: z.array(ContextItemSchema).max(1000),
  timeoutMs: z.number().int().min(1000).max(30 * 60 * 1000),
});
export type TaskRequest = z.infer<typeof TaskRequestSchema>;

/** A file operation proposed by the model. Proposals are never executed directly. */
export const ProposedOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), from: z.string().max(4096), toName: z.string().min(1).max(255), reason: z.string().max(2000).optional() }),
  z.object({ op: z.literal('move'), from: z.string().max(4096), toDir: z.string().max(4096), reason: z.string().max(2000).optional() }),
  z.object({ op: z.literal('copy'), from: z.string().max(4096), toDir: z.string().max(4096), reason: z.string().max(2000).optional() }),
  z.object({ op: z.literal('mkdir'), path: z.string().max(4096), reason: z.string().max(2000).optional() }),
  z.object({ op: z.literal('trash'), path: z.string().max(4096), reason: z.string().max(2000).optional() }),
  z.object({ op: z.literal('tag'), path: z.string().max(4096), tags: z.array(z.string().min(1).max(64)).max(32) }),
  z.object({ op: z.literal('collect'), path: z.string().max(4096), collection: z.string().min(1).max(128) }),
  z.object({
    op: z.literal('write_new'),
    toDir: z.string().max(4096),
    name: z.string().min(1).max(255),
    encoding: z.enum(['utf8', 'base64']),
    data: z.string().max(32 * 1024 * 1024),
  }),
  /**
   * Replace the contents of an existing file (1.1). `baseSha256` is the hash of
   * the content the provider was given; if the file changed since, the
   * proposal is refused. Applied only after the user reviews the diff, with a
   * snapshot taken first.
   */
  z.object({
    op: z.literal('edit_file'),
    path: z.string().max(4096),
    baseSha256: z.string().regex(/^[a-f0-9]{64}$/),
    encoding: z.enum(['utf8', 'base64']),
    data: z.string().max(32 * 1024 * 1024),
    reason: z.string().max(2000).optional(),
  }),
]);
export type ProposedOperation = z.infer<typeof ProposedOperationSchema>;

/** Structured search plan from natural language; executed by the local search engine. */
export const SearchPlanSchema = z.object({
  query: z.string().max(2000),
  scope: z.array(z.string().max(4096)).max(64),
  explanation: z.string().max(4000),
});
export type SearchPlan = z.infer<typeof SearchPlanSchema>;

export const TaskResultSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(['completed', 'partial', 'failed', 'cancelled']),
  /** Text answer. Observed facts and model inference are separated by the provider. */
  answer: z.string().max(200000).optional(),
  observations: z.array(z.object({ ref: z.string().max(4096), text: z.string().max(20000) })).max(500).optional(),
  inferences: z.array(z.string().max(20000)).max(500).optional(),
  /** Items in context the provider could not process. */
  skipped: z.array(z.object({ ref: z.string().max(4096), reason: z.string().max(1000) })).max(1000).optional(),
  proposals: z.array(ProposedOperationSchema).max(5000).optional(),
  searchPlan: SearchPlanSchema.optional(),
  error: z.object({ code: z.string().max(64), message: z.string().max(2000) }).optional(),
});
export type TaskResult = z.infer<typeof TaskResultSchema>;

export const ProgressEventSchema = z.object({
  taskId: z.string().uuid(),
  fraction: z.number().min(0).max(1).optional(),
  message: z.string().max(500).optional(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

/**
 * Interface a provider adapter implements. Adapters may wrap HTTP, IPC, a
 * child process, or an in-process module — the transport is the adapter's
 * concern. Orbis Files only depends on this interface.
 */
export interface AiProviderAdapter {
  /** Establish the connection and return the provider's handshake. */
  connect(signal: AbortSignal): Promise<unknown>;
  /** Lightweight liveness check. Must resolve false (not throw) when unhealthy. */
  ping(signal: AbortSignal): Promise<boolean>;
  run(request: TaskRequest, onProgress: (e: unknown) => void, signal: AbortSignal): Promise<unknown>;
  disconnect(): Promise<void>;
}

/** Permission classes for AI-proposed actions, ordered by consequence. */
export type PermissionClass =
  | 'read_metadata'
  | 'read_content'
  | 'share_external'
  | 'catalog_change'
  | 'reversible_fs'
  | 'overwrite'
  | 'permanent_delete'
  | 'execute_code'
  | 'change_permissions';

export function permissionFor(op: ProposedOperation): PermissionClass {
  switch (op.op) {
    case 'tag':
    case 'collect':
      return 'catalog_change';
    case 'rename':
    case 'move':
    case 'copy':
    case 'mkdir':
    case 'trash':
    case 'write_new':
      return 'reversible_fs';
    case 'edit_file':
      return 'overwrite';
  }
}

export function isCompatibleVersion(version: string): boolean {
  const major = Number(version.split('.')[0]);
  return Number.isInteger(major) && major === AI_CONTRACT_MAJOR;
}
