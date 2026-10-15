import { z } from 'zod';
import { ProfileIdSchema } from './integration/host-contract';
import { ConflictChoiceSchema, SyncModeSchema, SyncOptionsSchema } from './sync';
import { RenameSpecSchema } from './rename';
import { FindRequestSchema, FindQuerySchema, REPLACE_TEXT_MAX, ReplaceFileSchema } from './findReplace';
import { TextFixSpecSchema } from './docTools';
import { ShareStartSchema } from './share';
import { ImageToolSpecSchema } from './imageTools';
import { BackupJobInputSchema, RestoreRequestSchema, VERSION_NAME_RE } from './backup';
import { ScheduleSchema } from './schedule';
import { EditorDiffSchema, EditorEncodingSchema, EditorSaveAsSchema, EditorSaveCopySchema, EditorSaveSchema } from './editor';
import { OrganizePatternSchema, OrganizeSpecSchema } from './organize';
import { FINGERPRINT_RE, isCleanRemotePath, parseRemoteRef, RemoteConnectionInputSchema, RemoteIdSchema, remoteSecret, REMOTE_PATH_MAX } from './remote';
import { TermAckSchema, TermCreateSchema, TermIdSchema, TermLinkSchema, TermResizeSchema, TermWriteSchema } from './terminal';
import { PowerToolsSchemas } from './powerTools';
import { PlayerStateSchema, QUEUE_LIMIT } from './player';
import { JOIN_MAX } from './videoTools';
import { OCR_EVENT_CHANNELS, OCR_INVOKE_SCHEMAS } from './ocr';
import { CaptureRequestSchema, ListSourcesRequestSchema, SaveRequestSchema } from './screenshot';
import { CONVERT_FORMATS } from './archiveEdit';
import { DownloadOptionsSchema, DownloadSettingsSchema } from './downloads';
import { S3ConnectionInputSchema } from './s3';
import { RenamePatternSchema } from './batchRename';
import { DiffComputeSchema } from './diff';
import { StructuredParseSchema } from './structured';
import { MarkdownRenderSchema } from './markdown';
import { PlaylistNameSchema, PLAYLIST_ITEMS_MAX } from './playlist';
import { ImageCropRotateSpecSchema } from './imageCropRotate';
import { VideoTimelineRequestSchema } from './videoTimeline';
import { SnippetCreateSchema, SnippetUpdateSchema } from './snippets';
import { ColorTagCreateSchema, ColorTagUpdateSchema } from './colorTags';
import { BookmarkCreateSchema } from './bookmarks';
import { RecycleBinSettingsSchema } from './recycleBin';
import { GitStageSchema, GitUnstageSchema, GitCommitSchema, GitDiffSummarySchema } from './gitStatus';
import { HashCompareRequestSchema } from './hashCompare';
import { SpaceCreateSchema, SpaceUpdateSchema } from './spaces';
import { CloudProfileInputSchema } from './cloudMount';
import { ArchiveBrowseSchema, ArchiveCreateSchema, ArchiveExtractFileSchema } from './archiveManager';
import { MacroCreateSchema, MacroUpdateSchema, MacroPlaybackSchema } from './macros';
import { FolderWatchCreateSchema, FolderWatchUpdateSchema } from './folderWatch';
import { FileVersionCreateSchema, FileVersionDiffSchema, FileVersionRestoreSchema } from './fileVersions';
import {
  UniverseScanSchema, UniverseQuerySchema, UniverseMapSaveSchema, UniverseMapUpdateSchema,
  UniverseAnnotateSchema, UniverseAnnotateUpdateSchema, UniversePortalSchema, UniverseCheckpointSchema,
  FolderDiffSchema, ChangeObservatorySchema, ImpactSimulateSchema,
} from './universe';

/**
 * IPC contract. The preload bridge only forwards channels listed here, and the
 * main process validates every payload against these schemas before acting.
 */

const pathStr = z.string().min(1).max(32767);
const nameStr = z.string().min(1).max(1024);
const idStr = z.string().min(1).max(128);
/** Include/exclude filter patterns (see shared/glob.ts). */
const globStr = z.string().min(1).max(512);
/** Longest archive password accepted (characters). */
export const ARCHIVE_PASSWORD_MAX = 1024;
/** Archive passwords: only ever held in memory; never logged, stored or echoed back. */
export const archivePassword = z.string().min(1).max(ARCHIVE_PASSWORD_MAX).refine((s) => !s.includes('\0'), 'Passwords cannot contain a null character.');

/** An absolute POSIX path on a server (no "..", no NUL). */
const remotePath = z.string().min(1).max(REMOTE_PATH_MAX).refine(isCleanRemotePath, 'Not a valid remote path.');
/** A remote item reference (orbis-remote://<connection><path>). */
const remoteRefStr = z.string().min(1).max(REMOTE_PATH_MAX + 64).refine((s) => !!parseRemoteRef(s), 'Not a valid remote location.');

export const InvokeSchemas = {
  // app / window
  'app:info': z.object({}),
  'app:startupNotices': z.object({}),
  'app:thumbCache': z.object({}),
  'app:clearThumbCache': z.object({}),
  'win:minimize': z.object({}),
  'win:toggleMaximize': z.object({}),
  'win:close': z.object({}),
  'win:state': z.object({}),
  'win:new': z.object({ path: pathStr.optional() }),
  /** Window full screen (the media viewer's slideshow); the new state is also sent as 'win:state'. */
  'win:setFullScreen': z.object({ on: z.boolean() }),

  // filesystem
  'fs:capabilities': z.object({}),
  'fs:knownLocations': z.object({}),
  'fs:volumes': z.object({}),
  'fs:resolve': z.object({ input: z.string().max(32767), base: pathStr.optional() }),
  'fs:stat': z.object({ path: pathStr }),
  /** listingId is chosen by the caller so it can subscribe to batches before the request is sent. */
  'fs:listStart': z.object({ path: pathStr, showHidden: z.boolean(), listingId: idStr.optional() }),
  'fs:listCancel': z.object({ listingId: idStr }),
  'fs:mkdir': z.object({ parent: pathStr, name: nameStr }),
  'fs:createFile': z.object({ parent: pathStr, name: nameStr, template: z.enum(['empty', 'text', 'markdown', 'json']) }),
  'fs:rename': z.object({ path: pathStr, newName: nameStr }),
  'fs:validateName': z.object({ parent: pathStr, name: z.string().max(1024) }),
  'fs:open': z.object({ path: pathStr, allowExecutable: z.boolean().optional() }),
  'fs:createSymlink': z.object({ target: pathStr, parent: pathStr, name: nameStr }),
  'fs:copyText': z.object({ text: z.string().max(10_000_000) }),
  'fs:startDrag': z.object({ paths: z.array(pathStr).min(1).max(10000) }),
  'fs:reveal': z.object({ path: pathStr }),
  'fs:readText': z.object({ path: pathStr, maxBytes: z.number().int().positive().max(64 * 1024 * 1024).optional(), offset: z.number().int().nonnegative().optional() }),
  'fs:readHead': z.object({ path: pathStr, bytes: z.number().int().positive().max(1024 * 1024) }),
  'fs:hash': z.object({ path: pathStr, algorithm: z.enum(['sha256', 'sha1', 'md5', 'sha512']), jobId: idStr }),
  'fs:folderSize': z.object({ path: pathStr, jobId: idStr }),
  /** Sizes of a folder's child folders, for the Size column (a pausable background job). */
  'fs:childFolderSizes': z.object({ path: pathStr, jobId: idStr, skipHidden: z.boolean().optional() }),
  /** Copy a small UTF-8 text file's contents to the clipboard (≤ 1 MB). */
  'fs:copyFileText': z.object({ path: pathStr }),
  /** File templates for "New → …" (configured folder, or the XDG templates folder on Linux). */
  'fs:templates': z.object({}),
  'fs:createFromTemplate': z.object({ parent: pathStr, name: nameStr, template: pathStr }),
  /** The terminal "Open terminal here" would start (null when none was found). */
  'fs:terminalInfo': z.object({}),
  'fs:openTerminal': z.object({ path: pathStr }),
  'fs:jobCancel': z.object({ jobId: idStr }),
  /** Pause or resume a background job between items (jobs started with fs:hash, fs:folderSize, tool:* and proj:find). */
  'fs:jobPause': z.object({ jobId: idStr }),
  'fs:jobResume': z.object({ jobId: idStr }),
  'fs:resolveShortcut': z.object({ path: pathStr }),
  'fs:sniff': z.object({ path: pathStr }),
  'fs:watch': z.object({ path: pathStr }),
  'fs:unwatch': z.object({ path: pathStr }),
  'fs:pickDirectory': z.object({ title: z.string().max(200).optional() }),
  'fs:owners': z.object({ uids: z.array(z.number().int().nonnegative()).max(10000), gids: z.array(z.number().int().nonnegative()).max(10000) }),
  'fs:openWithApps': z.object({ path: pathStr }),
  'fs:openWith': z.object({ path: pathStr, appId: z.string().min(1).max(1024) }),
  'fs:chmod': z.object({ path: pathStr, mode: z.number().int().min(0).max(0o7777) }),

  // audio waveform
  'audio:waveform': z.object({ path: pathStr }),

  // metadata editor
  'metadata:read': z.object({ path: pathStr }),
  'metadata:write': z.object({ path: pathStr, edits: z.record(z.string()) }),
  'metadata:strip': z.object({ path: pathStr }),

  // permissions editor
  'perm:get': z.object({ path: pathStr }),
  'perm:set': z.object({ path: pathStr, mode: z.number().int().min(0).max(0o7777) }),
  'perm:setRecursive': z.object({ path: pathStr, mode: z.number().int().min(0).max(0o7777) }),
  'perm:chown': z.object({ path: pathStr, uid: z.number().int().min(0), gid: z.number().int().min(0) }),

  // embedded file metadata
  'meta:read': z.object({ path: pathStr, includeLocation: z.boolean().optional() }),
  'thumb:store': z.object({ path: pathStr, size: z.number().int().min(32).max(512), jpegBase64: z.string().max(3 * 1024 * 1024) }),
  'tool:similarImages': z.object({ roots: z.array(pathStr).min(1).max(64), threshold: z.number().int().min(0).max(20), jobId: idStr }),
  'convert:capabilities': z.object({}),
  'proj:list': z.object({}),
  'proj:detect': z.object({ path: pathStr }),
  'proj:create': z.object({ root: pathStr, name: z.string().min(1).max(200), kind: z.string().max(64).optional() }),
  'proj:rename': z.object({ id: idStr, name: z.string().min(1).max(200) }),
  'proj:delete': z.object({ id: idStr }),
  'proj:associate': z.object({ id: idStr, paths: z.array(pathStr).min(1).max(100000) }),
  'proj:items': z.object({ id: idStr }),
  'proj:removeItems': z.object({ id: idStr, itemIds: z.array(idStr).max(100000) }),
  'proj:find': z.object({ path: pathStr, jobId: idStr }),
  'storage:history': z.object({ root: pathStr }),
  'storage:clearHistory': z.object({ root: pathStr.optional() }),
  'lib:import': z.object({ paths: z.array(pathStr).min(1).max(100000) }),
  'lib:importFolder': z.object({}),
  'rules:rollback': z.object({ ruleId: idStr, runId: idStr }),
  'preview:office': z.object({ path: pathStr }),
  'meta:summaries': z.object({ paths: z.array(pathStr).max(5000) }),

  // system Trash (Linux: listing; restore and delete are operations 'trash-restore' / 'trash-delete')
  'trash:list': z.object({}),
  'trash:openSystem': z.object({}),

  // operations
  'ops:start': z.object({
    type: z.enum(['copy', 'move', 'trash', 'delete', 'rename-batch', 'extract', 'compress', 'duplicate', 'edit-metadata', 'convert', 'trash-restore', 'trash-delete', 'dedupe', 'checksum-create', 'pdf-tools', 'find-replace', 'text-fix', 'custom-action', 'encrypt', 'decrypt', 'image-batch', 'organize-date', 'remote-transfer', 'remote-delete', 'remote-save', 'video-tool', 'ocr-extract', 'ocr-save', 'archive-edit']),
    sources: z.array(pathStr).max(1_000_000),
    destination: pathStr.optional(),
    conflictPolicy: z.enum(['ask', 'skip', 'replace', 'keep-both', 'merge']).optional(),
    renames: z.array(z.object({ from: pathStr, to: pathStr })).max(1_000_000).optional(),
    origin: z.string().max(128).optional(),
    params: z.record(z.unknown()).optional(),
  }),
  'ops:list': z.object({}),
  'ops:cancel': z.object({ id: idStr }),
  'ops:pause': z.object({ id: idStr }),
  'ops:resume': z.object({ id: idStr }),
  'ops:retry': z.object({ id: idStr }),
  'ops:dismiss': z.object({ id: idStr }),
  'ops:prioritize': z.object({ id: idStr, to: z.enum(['first', 'last']) }),
  'ops:resolveConflict': z.object({
    id: idStr,
    decision: z.object({ action: z.enum(['skip', 'replace', 'keep-both', 'merge', 'cancel']), applyToAll: z.boolean() }),
  }),
  'ops:undo': z.object({ id: idStr }),
  // power tools and clipboard (pt:*, clip:*; see shared/powerTools.ts)
  ...PowerToolsSchemas,

  // settings
  'settings:getAll': z.object({}),
  'settings:set': z.object({ key: z.string().max(64), value: z.unknown() }),
  'settings:reset': z.object({ key: z.string().max(64) }),

  // catalogue / library
  'cat:pins': z.object({}),
  'cat:pin': z.object({ path: pathStr, label: z.string().max(256).optional() }),
  'cat:unpin': z.object({ path: pathStr }),
  'cat:reorderPins': z.object({ paths: z.array(pathStr).max(10000) }),
  'cat:recents': z.object({ limit: z.number().int().min(1).max(5000).optional() }),
  'cat:recordRecent': z.object({ path: pathStr, kind: z.enum(['file', 'directory']) }),
  'cat:clearRecents': z.object({}),
  'cat:tags': z.object({}),
  'cat:createTag': z.object({ name: z.string().min(1).max(64), color: z.string().max(32).optional() }),
  'cat:renameTag': z.object({ id: idStr, name: z.string().min(1).max(64) }),
  'cat:deleteTag': z.object({ id: idStr }),
  'cat:tagItems': z.object({ tagId: idStr, paths: z.array(pathStr).max(100000) }),
  'cat:untagItems': z.object({ tagId: idStr, paths: z.array(pathStr).max(100000) }),
  'cat:tagsFor': z.object({ paths: z.array(pathStr).max(100000) }),
  'cat:itemsWithTag': z.object({ tagId: idStr }),
  'cat:collections': z.object({}),
  'cat:createCollection': z.object({ name: z.string().min(1).max(128) }),
  'cat:renameCollection': z.object({ id: idStr, name: z.string().min(1).max(128) }),
  'cat:deleteCollection': z.object({ id: idStr }),
  'cat:addToCollection': z.object({ id: idStr, paths: z.array(pathStr).max(100000) }),
  'cat:removeFromCollection': z.object({ id: idStr, itemIds: z.array(idStr).max(100000) }),
  'cat:collectionItems': z.object({ id: idStr }),
  'cat:itemMeta': z.object({ path: pathStr }),
  'cat:setItemMeta': z.object({ path: pathStr, description: z.string().max(10000).nullable().optional(), rating: z.number().int().min(0).max(5).nullable().optional() }),
  'cat:savedSearches': z.object({}),
  'cat:saveSearch': z.object({ name: z.string().min(1).max(128), query: z.string().max(4000), scope: z.array(pathStr).max(64) }),
  'cat:deleteSavedSearch': z.object({ id: idStr }),
  'cat:sidebar': z.object({}),
  'cat:setSidebar': z.object({ collapsed: z.record(z.boolean()), hidden: z.record(z.boolean()) }),
  'cat:session': z.object({}),
  'cat:saveSession': z.object({ session: z.unknown() }),
  'cat:workspaces': z.object({}),
  'cat:saveWorkspace': z.object({ name: z.string().min(1).max(128), state: z.unknown() }),
  'cat:deleteWorkspace': z.object({ id: idStr }),
  'cat:downloads': z.object({}),
  'cat:removeDownloadEntry': z.object({ id: idStr }),
  'cat:generated': z.object({}),
  'cat:removeGeneratedEntry': z.object({ id: idStr }),
  'cat:backup': z.object({ destination: pathStr }),
  'cat:restore': z.object({ source: pathStr }),

  // search / index
  'search:start': z.object({ query: z.string().max(4000), scope: z.array(pathStr).min(1).max(64), searchId: idStr, useIndex: z.boolean(), showHidden: z.boolean() }),
  'search:cancel': z.object({ searchId: idStr }),
  'search:parse': z.object({ query: z.string().max(4000) }),
  /** Quick switcher: indexed paths whose names match (bounded; a newer request with the same channel supersedes it). */
  'index:quickFind': z.object({ query: z.string().max(200), requestId: idStr, limit: z.number().int().min(1).max(100).optional() }),
  'index:status': z.object({}),
  'index:addRoot': z.object({ path: pathStr }),
  'index:removeRoot': z.object({ path: pathStr }),
  'index:rebuild': z.object({}),
  'index:pause': z.object({}),
  'index:resume': z.object({}),
  'index:setExclusions': z.object({ patterns: z.array(z.string().max(512)).max(1000) }),

  // tools
  'tool:storageScan': z.object({ path: pathStr, jobId: idStr, oldMonths: z.number().int().min(1).max(600).optional(), maxEntries: z.number().int().min(1000).max(50_000_000).optional() }),
  'tool:duplicates': z.object({
    roots: z.array(pathStr).min(1).max(64),
    jobId: idStr,
    minSize: z.number().int().nonnegative(),
    maxSize: z.number().int().positive().optional(),
    include: z.array(globStr).max(100).optional(),
    exclude: z.array(globStr).max(100).optional(),
    skipHidden: z.boolean().optional(),
    mode: z.enum(['content', 'name-size']).optional(),
  }),
  /** Save a CSV report (built by the renderer, e.g. from a duplicate search) where the user chooses. */
  'tool:saveCsv': z.object({ suggestedName: z.string().min(1).max(200), csv: z.string().max(64 * 1024 * 1024) }),
  'tool:compareDirs': z.object({ left: pathStr, right: pathStr, jobId: idStr, verifyContent: z.boolean() }),
  /** Verify a checksum file (GNU or BSD format) against the files next to it (a pausable background job). */
  'tool:verifyChecksums': z.object({ path: pathStr, jobId: idStr }),
  'tool:diffText': z.object({ left: pathStr, right: pathStr }),
  'tool:diffStructured': z.object({ left: pathStr, right: pathStr }),
  'tool:archiveList': z.object({ path: pathStr, password: archivePassword.optional() }),
  'tool:archiveTest': z.object({ path: pathStr, jobId: idStr, password: archivePassword.optional() }),
  'tool:archiveNested': z.object({ archivePath: pathStr, entry: z.string().min(1).max(32767), depth: z.number().int().min(0).max(16), password: archivePassword.optional() }),
  /** Copy one file entry out of an archive into private scratch space (to open or preview it). */
  'tool:archiveEntry': z.object({ archivePath: pathStr, entry: z.string().min(1).max(32767), password: archivePassword.optional() }),
  // archive editing (extract-to-scratch, modify, repack in place)
  /** Add files from the filesystem into an archive. */
  'archive:addEntries': z.object({ archivePath: pathStr, filePaths: z.array(pathStr).min(1).max(10000), innerDir: z.string().max(32767).optional(), password: archivePassword.optional() }),
  /** Delete entries from an archive. */
  'archive:deleteEntries': z.object({ archivePath: pathStr, entries: z.array(z.string().min(1).max(32767)).min(1).max(100000), password: archivePassword.optional() }),
  /** Rename a single entry inside an archive. */
  'archive:renameEntry': z.object({ archivePath: pathStr, oldName: z.string().min(1).max(32767), newName: z.string().min(1).max(1024), password: archivePassword.optional() }),
  /** Create a new empty folder inside an archive. */
  'archive:mkdir': z.object({ archivePath: pathStr, parentDir: z.string().max(32767).optional(), folderName: z.string().min(1).max(1024), password: archivePassword.optional() }),
  /** Move entries within an archive (rename paths). */
  'archive:moveEntries': z.object({ archivePath: pathStr, moves: z.array(z.object({ from: z.string().min(1).max(32767), to: z.string().min(1).max(32767) })).min(1).max(100000), password: archivePassword.optional() }),
  /** Convert an archive to a different format. */
  'archive:convert': z.object({ archivePath: pathStr, targetFormat: z.enum(CONVERT_FORMATS.map((f) => f.id) as [string, ...string[]]), destination: pathStr.optional(), password: archivePassword.optional() }),
  'tool:bulkRenamePreview': z.object({
    paths: z.array(pathStr).min(1).max(100000),
    spec: RenameSpecSchema,
  }),
  /** Saved bulk-rename rule sets (per profile). */
  'rename:presets': z.object({}),
  'rename:savePreset': z.object({ name: z.string().trim().min(1).max(80), spec: RenameSpecSchema }),
  'rename:deletePreset': z.object({ id: idStr }),
  'rules:list': z.object({}),
  'rules:save': z.object({ rule: z.unknown() }),
  'rules:delete': z.object({ id: idStr }),
  'rules:dryRun': z.object({ id: idStr }),
  'rules:run': z.object({ id: idStr, paths: z.array(pathStr).max(100000) }),
  'rules:runs': z.object({ id: idStr }),
  /** Opt a rule in to (or out of) running on new files in folders; refused unless the rule was applied by hand and its action keeps files. */
  'rules:setAutomatic': z.object({ id: idStr, enabled: z.boolean(), folders: z.array(pathStr).max(16).optional() }),
  'automation:status': z.object({}),
  'automation:setPaused': z.object({ paused: z.boolean() }),
  /** Automatic rule runs (newest first). */
  'automation:activity': z.object({ limit: z.number().int().min(1).max(1000).optional() }),
  // Recent changes timeline (a pausable background job; watching reports changes while the view is open)
  'timeline:query': z.object({
    jobId: idStr,
    folders: z.array(pathStr).min(1).max(64),
    sinceMs: z.number().int().nonnegative(),
    useIndex: z.boolean(),
    maxDepth: z.number().int().min(0).max(64).optional(),
    maxEntries: z.number().int().min(100).max(10_000_000).optional(),
    limit: z.number().int().min(1).max(100_000).optional(),
    showHidden: z.boolean().optional(),
  }),
  'timeline:watch': z.object({ folders: z.array(pathStr).min(1).max(64), sinceMs: z.number().int().nonnegative() }),
  'timeline:unwatch': z.object({}),
  // Batch image tools (the work itself is the 'image-batch' operation)
  'images:plan': z.object({ paths: z.array(pathStr).min(1).max(10000), spec: ImageToolSpecSchema }),
  'images:presets': z.object({}),
  'images:savePreset': z.object({ name: z.string().trim().min(1).max(80), spec: ImageToolSpecSchema }),
  'images:deletePreset': z.object({ id: idStr }),
  // Organize by date (the work itself is the 'organize-date' operation)
  /** Preview: each file's destination folder, date source and conflicts (a pausable background job; nothing is written). */
  'organize:plan': z.object({ paths: z.array(pathStr).min(1).max(10000), destination: pathStr, spec: OrganizeSpecSchema, jobId: idStr }),
  'organize:presets': z.object({}),
  'organize:savePreset': z.object({ name: z.string().trim().min(1).max(80), pattern: OrganizePatternSchema }),
  'organize:deletePreset': z.object({ id: idStr }),
  /** Names (name table), format and glyph count of a font file for the preview (≤ 30 MB). */
  'font:info': z.object({ path: pathStr }),
  // folder synchronization (changes run as 'sync' operations started by sync:run)
  'sync:pairs': z.object({}),
  'sync:savePair': z.object({ id: idStr.optional(), name: z.string().trim().min(1).max(128), left: pathStr, right: pathStr, mode: SyncModeSchema, options: SyncOptionsSchema }),
  'sync:deletePair': z.object({ id: idStr }),
  'sync:forgetBaseline': z.object({ left: pathStr, right: pathStr }),
  'sync:preview': z.object({ left: pathStr, right: pathStr, mode: SyncModeSchema, options: SyncOptionsSchema, pairId: idStr.optional(), jobId: idStr }),
  /** `approveSchedule`: the user approves this exact pair (folders, mode, options) for scheduled runs. */
  'sync:run': z.object({ planId: idStr, decisions: z.array(z.object({ id: z.number().int().nonnegative(), choice: ConflictChoiceSchema })).max(1_000_000), pairId: idStr.optional(), approveSchedule: z.boolean().optional() }),
  /** Schedules of saved sync pairs (run while the app is open; previewed and safety-checked first). */
  'sync:schedules': z.object({}),
  /** Approve a previewed saved pair for scheduled runs without running it now. */
  'sync:approveSchedule': z.object({ planId: idStr, pairId: idStr }),
  'sync:setSchedule': z.object({ pairId: idStr, schedule: ScheduleSchema, maxDeletes: z.number().int().min(0).max(1_000_000) }),
  // backups with versions (runs are 'backup' operations, restores 'backup-restore' operations; verify is a background job)
  'backup:jobs': z.object({}),
  'backup:saveJob': BackupJobInputSchema,
  'backup:deleteJob': z.object({ id: idStr }),
  'backup:run': z.object({ id: idStr }),
  'backup:versions': z.object({ id: idStr }),
  'backup:browse': z.object({ id: idStr, version: z.string().regex(VERSION_NAME_RE), dir: z.string().max(32767) }),
  'backup:search': z.object({ id: idStr, query: z.string().max(200) }),
  'backup:fileVersions': z.object({ id: idStr, rel: z.string().min(1).max(32767) }),
  'backup:restore': RestoreRequestSchema,
  'backup:verify': z.object({ id: idStr, version: z.string().regex(VERSION_NAME_RE), jobId: idStr }),
  'backup:activity': z.object({ id: idStr.optional(), limit: z.number().int().min(1).max(2000).optional() }),
  // shared scheduler: backup jobs and saved sync pairs
  'schedule:status': z.object({}),
  'schedule:setPaused': z.object({ paused: z.boolean() }),
  // document tools (changes run as 'pdf-tools', 'find-replace' and 'text-fix' operations)
  /** Page count, sizes, rotation and encryption of a PDF. */
  'pdf:info': z.object({ path: pathStr }),
  /** The bytes of a PDF (≤ 100 MB) for drawing page thumbnails in the renderer. */
  'pdf:bytes': z.object({ path: pathStr }),
  /** Search text in a folder's files (a pausable background job). */
  'find:search': FindRequestSchema.extend({ jobId: idStr }),
  /** Line diffs of a replacement for up to 50 files, checked against the hashes from the search. */
  'find:preview': z.object({ query: FindQuerySchema, replacement: z.string().max(REPLACE_TEXT_MAX), files: z.array(ReplaceFileSchema).min(1).max(50) }),
  /** What the text fixes would change in each file (nothing is written). */
  'textfix:preview': z.object({ paths: z.array(pathStr).min(1).max(2000), spec: TextFixSpecSchema }),
  /** Check a password against an .orbisenc file's key check (no decryption); wrong → wrongPassword error. */
  'crypto:checkPassword': z.object({ path: pathStr, password: archivePassword }),
  // share on local network (temporary HTTP server in the main process; see main/share)
  'share:interfaces': z.object({}),
  'share:start': ShareStartSchema,
  'share:list': z.object({}),
  'share:stop': z.object({ id: idStr }),
  'share:dismiss': z.object({ id: idStr }),
  // built-in text editor (see shared/editor.ts and main/tools/textEditor.ts)
  /** Read a text file for editing (≤ 5 MB; binary and larger files are refused with a reason). */
  'editor:open': z.object({ path: pathStr, encoding: EditorEncodingSchema.optional() }),
  /** Size, modification time and SHA-256 of the file now (null when it is gone). */
  'editor:stat': z.object({ path: pathStr }),
  /** Save over the loaded file: conflict when it changed on disk, snapshot first, atomic replace in its encoding and line endings. */
  'editor:save': EditorSaveSchema,
  /** Save as a new file; an existing file is only replaced with the stamp the user agreed to replace. */
  'editor:saveAs': EditorSaveAsSchema,
  /** Keep the editor's text beside the file as "name (copy).ext". */
  'editor:saveCopy': EditorSaveCopySchema,
  /** Line diff of the file on disk against the editor's text. */
  'editor:diff': EditorDiffSchema,
  'snap:list': z.object({ path: pathStr.optional() }),
  'snap:create': z.object({ path: pathStr }),
  'snap:restore': z.object({ id: idStr, destination: pathStr }),
  'snap:delete': z.object({ id: idStr }),
  'snap:diff': z.object({ id: idStr }),

  // integrations
  'ai:status': z.object({}),
  /** `kind` defaults to 'orbis' (the Orbis AI contract over HTTP); 'openai-compatible' needs `model`. */
  'ai:configure': z.object({
    endpoint: z.string().url().max(2048).nullable(),
    token: z.string().max(4096).nullable().optional(),
    kind: z.enum(['orbis', 'openai-compatible']).optional(),
    model: z.string().trim().min(1).max(256).optional(),
    vision: z.boolean().optional(),
  }),
  /** Models offered by an OpenAI-compatible server (GET {url}/models). */
  'ai:listModels': z.object({ url: z.string().url().max(2048), key: z.string().max(4096).optional() }),
  'ai:connect': z.object({}),
  'ai:disconnect': z.object({}),
  'ai:runTask': z.object({ kind: z.string().max(64), prompt: z.string().max(20000).optional(), refs: z.array(z.object({ path: pathStr, share: z.enum(['metadata', 'content']) })).max(1000) }),
  'ai:cancelTask': z.object({ taskId: idStr }),
  'ai:audit': z.object({ limit: z.number().int().min(1).max(10000).optional() }),
  'ai:applyProposals': z.object({ taskId: idStr, approvedIndexes: z.array(z.number().int().nonnegative()).max(100000) }),
  'ai:proposalPreview': z.object({ taskId: idStr, index: z.number().int().nonnegative() }),
  'ai:saveAnswer': z.object({ taskId: idStr, parent: pathStr, name: nameStr }),
  'host:status': z.object({}),
  'lib:providers': z.object({}),
  'lib:list': z.object({ providerId: idStr, limit: z.number().int().min(1).max(10000).optional() }),
  'lib:openItem': z.object({ providerId: idStr, itemId: z.string().min(1).max(256) }),
  'host:pendingPicks': z.object({}),
  'host:pickReply': z.object({ token: idStr, paths: z.array(pathStr).max(10000).nullable() }),
  'fs:pickFile': z.object({ title: z.string().max(200).optional() }),
  'orbis:addFiles': z.object({}),
  'orbis:scope': z.object({ orbisOnly: z.boolean().optional() }),
  'diag:recent': z.object({ limit: z.number().int().min(1).max(5000).optional() }),
  'diag:export': z.object({ destination: pathStr }),
  'diag:openLogFolder': z.object({}),
  // profiles (ids are folder names; validated again by main/profiles.ts)
  'profile:list': z.object({}),
  'profile:create': z.object({ id: ProfileIdSchema }),
  'profile:switch': z.object({ id: ProfileIdSchema }),
  'profile:delete': z.object({ id: ProfileIdSchema, confirm: z.string().max(64) }),
  // stored checksums (SHA-256 recorded by fs:hash; only values for unchanged files are returned)
  'checksum:get': z.object({ paths: z.array(pathStr).max(5000) }),
  // customization (validated again in full by the customization service)
  'custom:get': z.object({}),
  'custom:apply': z.object({ op: z.unknown(), systemDark: z.boolean() }),
  'custom:undo': z.object({}),
  'custom:redo': z.object({}),
  'custom:revert': z.object({}),
  'custom:restoreBackup': z.object({ slot: z.string().min(1).max(80) }),
  'custom:export': z.object({ kind: z.enum(['complete', 'appearance', 'theme', 'layout', 'workspace', 'view', 'shortcuts', 'toolbar', 'contextMenu', 'navigation']), id: z.string().max(64).optional(), systemDark: z.boolean() }),
  'custom:pickImport': z.object({}),
  'custom:previewImport': z.object({ path: pathStr }),
  'custom:applyImport': z.object({ path: pathStr }),
  'custom:registry': z.object({ commands: z.array(z.unknown()).max(1000) }),
  'custom:pickBackground': z.object({}),
  'custom:checkBackground': z.object({ path: z.string().max(4096) }),
  // shelf (drop stack): references to items, stored per profile
  'shelf:list': z.object({}),
  'shelf:add': z.object({ paths: z.array(pathStr).min(1).max(500) }),
  'shelf:remove': z.object({ paths: z.array(pathStr).min(1).max(500) }),
  'shelf:clear': z.object({}),
  // custom actions (defined in Settings; runs are 'custom-action' operations that name an action id)
  'actions:list': z.object({}),
  'actions:save': z.object({ action: z.record(z.unknown()) }),
  'actions:delete': z.object({ id: z.string().regex(/^[a-z0-9]{6,32}$/) }),
  /** What a run would execute (for the confirmation), planned in the main process from the stored action. */
  'actions:plan': z.object({ id: z.string().regex(/^[a-z0-9]{6,32}$/), paths: z.array(pathStr).min(1).max(10000), folder: pathStr }),
  'actions:export': z.object({}),
  'actions:import': z.object({}),
  // version control (read-only status for folders inside a work tree)
  'git:info': z.object({ recheck: z.boolean().optional() }),
  'git:status': z.object({ path: pathStr, refresh: z.boolean().optional() }),
  'git:remoteUrl': z.object({ path: pathStr }),
  'fs:checkPaths': z.object({ paths: z.array(pathStr).max(500) }),
  // remote locations (SFTP / WebDAV). Secrets are write-only: sent to be stored or used, never returned.
  'remote:list': z.object({}),
  'remote:save': RemoteConnectionInputSchema,
  'remote:remove': z.object({ id: RemoteIdSchema }),
  /** Connect; a password/passphrase typed now is passed as `secret`. Interaction needed comes back as a status. */
  'remote:connect': z.object({ id: RemoteIdSchema, secret: remoteSecret.optional() }),
  /** Trust the host key the server presented in the last attempt (the fingerprint must match it). */
  'remote:trustHostKey': z.object({ id: RemoteIdSchema, fingerprint: z.string().regex(FINGERPRINT_RE) }),
  'remote:forgetHostKey': z.object({ id: RemoteIdSchema }),
  'remote:disconnect': z.object({ id: RemoteIdSchema, forgetPassword: z.boolean().optional() }),
  'remote:listDir': z.object({ id: RemoteIdSchema, path: remotePath, showHidden: z.boolean() }),
  'remote:stat': z.object({ ref: remoteRefStr }),
  'remote:mkdir': z.object({ id: RemoteIdSchema, parent: remotePath, name: nameStr }),
  'remote:rename': z.object({ ref: remoteRefStr, newName: nameStr }),
  /** Download a file to a private copy and open it with its default app (a background job). */
  'remote:open': z.object({ ref: remoteRefStr, jobId: idStr }),
  /** A size-limited private copy of a file for the preview (a background job; resolves with its local entry). */
  'remote:preview': z.object({ ref: remoteRefStr, jobId: idStr }),
  'remote:opened': z.object({}),
  'remote:discardCopy': z.object({ localPath: pathStr }),
  // built-in terminal (see shared/terminal.ts and main/terminal/*). Sessions are scoped to the window that created them.
  'term:info': z.object({}),
  'term:create': TermCreateSchema,
  'term:write': TermWriteSchema,
  'term:resize': TermResizeSchema,
  /** Output characters the window has parsed (flow control). */
  'term:ack': TermAckSchema,
  'term:kill': z.object({ id: TermIdSchema }),
  'term:list': z.object({}),
  'term:status': z.object({ id: TermIdSchema }),
  /** This window's sessions with a program running (for closing the panel or the window). */
  'term:running': z.object({}),
  'term:cwd': z.object({ id: TermIdSchema }),
  /** Open a web link from terminal output (after the window asked the user). */
  'term:openLink': TermLinkSchema,
  /** The user agreed to close the window (or quit) although programs run in its terminals. */
  'term:allowClose': z.object({ quit: z.boolean().optional() }),
  /** Clipboard text for pasting into a terminal (asked for by a paste the user made). */
  'term:clipboard': z.object({}),
  // music player and video tools (see shared/player.ts, shared/videoTools.ts, main/media/player.ts, main/media/videoTools.ts)
  /** The stored queue, position and settings of the music player. */
  'player:load': z.object({}),
  'player:save': z.object({ state: PlayerStateSchema }),
  /** Audio files in files and folders (natural order, links not followed, capped). */
  'player:collect': z.object({ paths: z.array(pathStr).min(1).max(10000), limit: z.number().int().min(1).max(QUEUE_LIMIT).optional() }),
  /** Which queued files still exist and can be played. */
  'player:check': z.object({ paths: z.array(pathStr).max(QUEUE_LIMIT) }),
  /** Tags and durations (from the metadata reader) for queue items. */
  'player:tags': z.object({ paths: z.array(pathStr).min(1).max(500) }),
  'player:cover': z.object({ path: pathStr }),
  'player:openPlaylist': z.object({ path: pathStr }),
  'player:savePlaylist': z.object({
    dir: pathStr,
    name: nameStr,
    entries: z.array(z.object({ path: pathStr, title: z.string().max(1000).optional(), artist: z.string().max(1000).optional(), durationSec: z.number().finite().nonnegative().max(1e7).optional() })).max(QUEUE_LIMIT),
    replace: z.boolean().optional(),
  }),
  // Saved playlists (named, stored in the app database)
  'playlist:save': z.object({ name: PlaylistNameSchema, paths: z.array(pathStr).min(1).max(PLAYLIST_ITEMS_MAX) }),
  'playlist:list': z.object({}),
  'playlist:load': z.object({ name: PlaylistNameSchema }),
  'playlist:delete': z.object({ name: PlaylistNameSchema }),
  // File encryption / decryption (AES-256-GCM; runs as operations, started by ops:start with type 'encrypt'/'decrypt')
  'crypto:encrypt': z.object({ path: pathStr, password: archivePassword }),
  'crypto:decrypt': z.object({ path: pathStr, password: archivePassword }),
  /** What the installed FFmpeg allows the video tools to do (each tool says why when it cannot). */
  'video:caps': z.object({}),
  /** Streams, size, frame rate and duration of a video for the tool dialogs. */
  'video:probe': z.object({ path: pathStr }),
  /** Whether videos can be joined without re-encoding (and why not). */
  'video:joinCheck': z.object({ paths: z.array(pathStr).min(2).max(JOIN_MAX) }),
  'diag:rendererError': z.object({ where: z.string().max(100), message: z.string().max(2000), stack: z.string().max(8000).optional() }),

  // download manager
  'download:start': z.object({ url: z.string().url().max(8192), destination: pathStr, options: DownloadOptionsSchema.optional() }),
  'download:pause': z.object({ id: idStr }),
  'download:resume': z.object({ id: idStr }),
  'download:cancel': z.object({ id: idStr }),
  'download:retry': z.object({ id: idStr }),
  'download:remove': z.object({ id: idStr }),
  'download:list': z.object({ filter: z.enum(['all', 'active', 'completed', 'failed']).optional() }),
  'download:clearHistory': z.object({}),
  'download:settings': z.object({ update: DownloadSettingsSchema.optional() }),

  // Text recognition (OCR): see shared/ocr.ts.
  ...OCR_INVOKE_SCHEMAS,
  // Screenshot capture and annotation (see shared/screenshot.ts).
  'screenshot:capture': CaptureRequestSchema,
  'screenshot:sources': ListSourcesRequestSchema,
  'screenshot:save': SaveRequestSchema,

  // viewers: e-book, comic, 3D model
  'ebook:open': z.object({ path: pathStr }),
  'ebook:chapter': z.object({ path: pathStr, spineIndex: z.number().int().nonnegative().max(100000) }),
  'ebook:position': z.object({ path: pathStr }),
  'ebook:savePosition': z.object({ path: pathStr, index: z.number().int().nonnegative(), scrollOffset: z.number().min(0).max(1).optional() }),
  'comic:open': z.object({ path: pathStr }),
  'comic:page': z.object({ path: pathStr, entry: z.string().min(1).max(32767) }),
  'comic:position': z.object({ path: pathStr }),
  'comic:savePosition': z.object({ path: pathStr, index: z.number().int().nonnegative() }),
  'model3d:info': z.object({ path: pathStr }),
  'model3d:load': z.object({ path: pathStr }),

  // S3-compatible object storage (see shared/s3.ts and main/remote/s3.ts). Secrets are write-only.
  's3:list': z.object({}),
  's3:save': S3ConnectionInputSchema,
  's3:remove': z.object({ id: idStr }),
  's3:connect': z.object({ id: idStr, secret: z.string().min(1).max(1024).optional() }),
  's3:disconnect': z.object({ id: idStr }),
  's3:listBuckets': z.object({ id: idStr }),
  's3:listObjects': z.object({
    id: idStr,
    bucket: z.string().min(1).max(256),
    prefix: z.string().max(1024).default(''),
    continuationToken: z.string().max(4096).optional(),
  }),
  's3:mkdir': z.object({ id: idStr, bucket: z.string().min(1).max(256), prefix: z.string().min(1).max(1024) }),
  's3:delete': z.object({ id: idStr, bucket: z.string().min(1).max(256), key: z.string().min(1).max(1024) }),
  's3:rename': z.object({ id: idStr, bucket: z.string().min(1).max(256), oldKey: z.string().min(1).max(1024), newKey: z.string().min(1).max(1024) }),
  's3:presign': z.object({ id: idStr, bucket: z.string().min(1).max(256), key: z.string().min(1).max(1024), expiresIn: z.number().int().min(60).max(604800).default(3600) }),
  /** Download an S3 object to a local temp file (a background job). */
  's3:download': z.object({ id: idStr, bucket: z.string().min(1).max(256), key: z.string().min(1).max(1024), jobId: idStr }),
  /** Upload a local file to S3 (a background job with progress). */
  's3:upload': z.object({ id: idStr, bucket: z.string().min(1).max(256), key: z.string().min(1).max(1024), localPath: pathStr, jobId: idStr }),
  's3:head': z.object({ id: idStr, bucket: z.string().min(1).max(256), key: z.string().min(1).max(1024) }),

  // batch rename tool view
  'rename:preview': z.object({ paths: z.array(pathStr).min(1).max(100000), pattern: RenamePatternSchema }),
  'rename:execute': z.object({ renames: z.array(z.object({ from: pathStr, to: pathStr })).min(1).max(100000) }),

  // checksum / hash tool
  'hash:compute': z.object({ paths: z.array(pathStr).min(1).max(10000), algorithm: z.enum(['md5', 'sha1', 'sha256', 'sha512']), jobId: idStr }),

  // font glyph table
  'font:glyphs': z.object({ path: pathStr, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(1000).default(200) }),

  // disk usage analyzer
  'disk:scan': z.object({ path: pathStr, jobId: idStr, maxDepth: z.number().int().min(1).max(64).optional() }),

  // quick look preview
  'quicklook:data': z.object({ path: pathStr }),

  // startup dashboard
  'dashboard:data': z.object({}),

  // enhanced diff / compare
  'diff:compute': DiffComputeSchema,
  // structured data tree viewer
  'structured:parse': StructuredParseSchema,
  // markdown live preview
  'markdown:render': MarkdownRenderSchema,

  // workspace saves
  'cat:loadWorkspace': z.object({ id: idStr }),

  // smart folders
  'cat:smartFolders': z.object({}),
  'cat:createSmartFolder': z.object({ name: z.string().min(1).max(128), query: z.record(z.unknown()), icon: z.string().max(32).optional(), color: z.string().max(32).optional() }),
  'cat:updateSmartFolder': z.object({ id: idStr, name: z.string().min(1).max(128).optional(), query: z.record(z.unknown()).optional(), icon: z.string().max(32).optional(), color: z.string().max(32).optional() }),
  'cat:deleteSmartFolder': z.object({ id: idStr }),
  'cat:querySmartFolder': z.object({ query: z.record(z.unknown()) }),

  // SQLite database viewer
  'sqlite:open': z.object({ path: pathStr }),
  'sqlite:tables': z.object({ path: pathStr }),
  'sqlite:query': z.object({ path: pathStr, sql: z.string().min(1).max(100_000), params: z.array(z.unknown()).max(1000).optional() }),
  'sqlite:schema': z.object({ path: pathStr, table: z.string().min(1).max(1024) }),

  // Color palette extraction
  'color:extract': z.object({ path: pathStr, count: z.number().int().min(2).max(20).default(8) }),

  // Hex editor
  'hex:read': z.object({ path: pathStr, offset: z.number().int().nonnegative(), length: z.number().int().min(1).max(65536) }),
  'hex:write': z.object({ path: pathStr, edits: z.array(z.object({ offset: z.number().int().nonnegative(), bytes: z.string().max(200000) })).min(1).max(10000) }),
  'hex:search': z.object({ path: pathStr, pattern: z.string().min(1).max(1024), mode: z.enum(['hex', 'text']), fromOffset: z.number().int().nonnegative().default(0) }),

  // File annotations / notes
  'note:get': z.object({ path: pathStr }),
  'note:set': z.object({ path: pathStr, note: z.string().max(100000), color: z.string().max(32).optional() }),
  'note:delete': z.object({ path: pathStr }),
  'note:list': z.object({ query: z.string().max(1000).optional() }),
  'note:search': z.object({ text: z.string().min(1).max(1000) }),

  // Regex content search
  'content:search': z.object({ dir: pathStr, pattern: z.string().min(1).max(4000), isRegex: z.boolean(), caseSensitive: z.boolean(), fileFilter: z.string().max(512).default(''), maxResults: z.number().int().min(1).max(50000).default(5000), jobId: idStr }),

  // Symlink manager
  'symlink:scan': z.object({ path: pathStr, recursive: z.boolean().optional() }),
  'symlink:create': z.object({ path: pathStr, target: pathStr, relative: z.boolean().optional() }),
  'symlink:retarget': z.object({ path: pathStr, newTarget: pathStr }),
  'symlink:delete': z.object({ path: pathStr }),
  'symlink:fixBroken': z.object({ path: pathStr, newTarget: pathStr }),
  'symlink:convert': z.object({ path: pathStr, toRelative: z.boolean() }),

  // Batch date modifier
  'date:preview': z.object({
    paths: z.array(pathStr).min(1).max(100000),
    spec: z.object({
      mode: z.enum(['set', 'shift', 'fromName', 'fromExif']),
      date: z.string().max(64).optional(),
      shiftMs: z.number().optional(),
      fields: z.array(z.enum(['modified', 'accessed', 'created'])).min(1).max(3),
    }),
  }),
  'date:modify': z.object({
    paths: z.array(pathStr).min(1).max(100000),
    spec: z.object({
      mode: z.enum(['set', 'shift', 'fromName', 'fromExif']),
      date: z.string().max(64).optional(),
      shiftMs: z.number().optional(),
      fields: z.array(z.enum(['modified', 'accessed', 'created'])).min(1).max(3),
    }),
  }),

  // File templates (custom template catalog)
  'template:list': z.object({}),
  'template:create': z.object({ dir: pathStr, templateId: idStr, fileName: nameStr }),
  'template:save': z.object({ template: z.object({
    id: idStr,
    name: z.string().min(1).max(128),
    ext: z.string().max(32),
    category: z.enum(['code', 'document', 'config', 'web', 'data', 'other']),
    content: z.string().max(1_000_000),
    description: z.string().max(1000),
    icon: z.string().max(32).optional(),
  }) }),
  'template:delete': z.object({ id: idStr }),

  // Image crop & rotate
  'imageCrop:info': z.object({ path: pathStr }),
  'imageCrop:apply': ImageCropRotateSpecSchema,

  // Video thumbnail timeline
  'videoTimeline:extract': VideoTimelineRequestSchema,

  // Snippet library
  'snippet:list': z.object({}),
  'snippet:create': SnippetCreateSchema,
  'snippet:update': SnippetUpdateSchema,
  'snippet:delete': z.object({ id: idStr }),
  'snippet:export': z.object({}),
  'snippet:import': z.object({ data: z.unknown() }),

  // Conversion pipeline
  'pipeline:presets': z.object({}),
  'pipeline:savePreset': z.object({ name: z.string().min(1).max(128), steps: z.array(z.object({ id: z.string().max(64), kind: z.enum(['image-format', 'document-format', 'archive-compress', 'archive-decompress']), targetFormat: z.string().max(32), options: z.record(z.unknown()).optional() })).min(1).max(20) }),
  'pipeline:deletePreset': z.object({ id: idStr }),
  'pipeline:run': z.object({ sourcePaths: z.array(pathStr).min(1).max(10000), steps: z.array(z.object({ id: z.string().max(64), kind: z.enum(['image-format', 'document-format', 'archive-compress', 'archive-decompress']), targetFormat: z.string().max(32), options: z.record(z.unknown()).optional() })).min(1).max(20), outputDir: pathStr, jobId: idStr }),

  // Mounted volumes monitor
  'volumes:snapshot': z.object({}),
  'volumes:eject': z.object({ mountPath: pathStr }),

  // Color tags
  'colorTag:list': z.object({}),
  'colorTag:create': ColorTagCreateSchema,
  'colorTag:update': ColorTagUpdateSchema,
  'colorTag:delete': z.object({ id: idStr }),
  'colorTag:assign': z.object({ tagId: idStr, paths: z.array(pathStr).min(1).max(100000) }),
  'colorTag:unassign': z.object({ tagId: idStr, paths: z.array(pathStr).min(1).max(100000) }),
  'colorTag:forPaths': z.object({ paths: z.array(pathStr).min(1).max(100000) }),
  'colorTag:pathsWithTag': z.object({ tagId: idStr }),

  // Bookmarks / favorites bar
  'bookmark:list': z.object({}),
  'bookmark:add': BookmarkCreateSchema,
  'bookmark:remove': z.object({ id: idStr }),
  'bookmark:reorder': z.object({ ids: z.array(idStr).min(1).max(10000) }),
  'bookmark:rename': z.object({ id: idStr, label: z.string().min(1).max(256) }),

  // Advanced Recycle Bin
  'recycleBin:list': z.object({}),
  'recycleBin:restore': z.object({ ids: z.array(idStr).min(1).max(100000) }),
  'recycleBin:permanentDelete': z.object({ ids: z.array(idStr).min(1).max(100000) }),
  'recycleBin:empty': z.object({}),
  'recycleBin:getSettings': z.object({}),
  'recycleBin:setSettings': RecycleBinSettingsSchema,
  'recycleBin:purgeOld': z.object({}),

  // Git integration (write operations: stage, unstage, commit)
  'git:stage': GitStageSchema,
  'git:unstage': GitUnstageSchema,
  'git:commit': GitCommitSchema,
  'git:diffSummary': GitDiffSummarySchema,

  // File hash comparator
  'hashCompare:compare': HashCompareRequestSchema,

  // Virtual workspaces / spaces
  'space:list': z.object({}),
  'space:get': z.object({ id: idStr }),
  'space:create': SpaceCreateSchema,
  'space:update': SpaceUpdateSchema,
  'space:delete': z.object({ id: idStr }),

  // Recent files panel
  'recent:list': z.object({ limit: z.number().int().min(1).max(5000).optional() }),
  'recent:record': z.object({ path: pathStr }),
  'recent:pin': z.object({ id: idStr }),
  'recent:unpin': z.object({ id: idStr }),
  'recent:remove': z.object({ id: idStr }),
  'recent:clear': z.object({}),

  // File links (aliases)
  'link:create': z.object({ name: nameStr, targetPath: pathStr, parentPath: pathStr }),
  'link:delete': z.object({ id: idStr }),
  'link:list': z.object({ parentPath: pathStr }),
  'link:resolve': z.object({ id: idStr }),
  'link:update': z.object({ id: idStr, name: nameStr.optional(), targetPath: pathStr.optional() }),
  'link:all': z.object({}),

  // Breadcrumb siblings
  'breadcrumb:siblings': z.object({ path: pathStr }),

  // Drag-drop preview
  'dragdrop:preview': z.object({ paths: z.array(pathStr).min(1).max(10000) }),

  // Cloud storage mount (FTP/SFTP/WebDAV)
  'cloud:profiles': z.object({}),
  'cloud:saveProfile': CloudProfileInputSchema,
  'cloud:deleteProfile': z.object({ id: idStr }),
  'cloud:connect': z.object({ id: idStr, password: z.string().max(4096).optional() }),
  'cloud:disconnect': z.object({ id: idStr }),
  'cloud:listDir': z.object({ id: idStr, path: z.string().max(4096), showHidden: z.boolean().optional() }),
  'cloud:download': z.object({ id: idStr, remotePath: z.string().max(4096) }),
  'cloud:upload': z.object({ id: idStr, localPath: pathStr, remotePath: z.string().max(4096) }),

  // Clipboard history
  'clipHistory:list': z.object({}),
  'clipHistory:capture': z.object({}),
  'clipHistory:recopy': z.object({ id: idStr }),
  'clipHistory:pin': z.object({ id: idStr }),
  'clipHistory:unpin': z.object({ id: idStr }),
  'clipHistory:remove': z.object({ id: idStr }),
  'clipHistory:clear': z.object({}),

  // Archive manager
  'archiveMgr:browse': ArchiveBrowseSchema,
  'archiveMgr:info': z.object({ archivePath: pathStr, password: z.string().max(1024).optional() }),
  'archiveMgr:extractFiles': ArchiveExtractFileSchema,
  'archiveMgr:create': ArchiveCreateSchema,

  // Macro recorder
  'macro:list': z.object({}),
  'macro:create': MacroCreateSchema,
  'macro:update': MacroUpdateSchema,
  'macro:delete': z.object({ id: idStr }),
  'macro:get': z.object({ id: idStr }),
  'macro:playback': MacroPlaybackSchema,

  // Folder watcher
  'watch:list': z.object({}),
  'watch:create': FolderWatchCreateSchema,
  'watch:update': FolderWatchUpdateSchema,
  'watch:delete': z.object({ id: idStr }),
  'watch:start': z.object({ id: idStr }),
  'watch:stop': z.object({ id: idStr }),
  'watch:log': z.object({ id: idStr }),

  // File version history
  'version:list': z.object({ filePath: pathStr }),
  'version:create': FileVersionCreateSchema,
  'version:delete': z.object({ versionId: idStr }),
  'version:restore': FileVersionRestoreSchema,
  'version:diff': FileVersionDiffSchema,
  'version:setMax': z.object({ max: z.number().int().min(1).max(500) }),

  // Universe
  'universe:scan': UniverseScanSchema,
  'universe:scanStatus': z.object({ scanId: idStr }),
  'universe:cancelScan': z.object({ scanId: idStr }),
  'universe:query': UniverseQuerySchema,
  'universe:stats': z.object({ scanId: idStr }),
  'universe:relations': z.object({ scanId: idStr, path: pathStr.optional() }),
  'universe:map:save': UniverseMapSaveSchema,
  'universe:map:update': UniverseMapUpdateSchema,
  'universe:map:list': z.object({}),
  'universe:map:delete': z.object({ id: idStr }),
  'universe:map:get': z.object({ id: idStr }),
  'universe:annotate': UniverseAnnotateSchema,
  'universe:annotate:update': UniverseAnnotateUpdateSchema,
  'universe:annotate:delete': z.object({ id: idStr }),
  'universe:annotate:list': z.object({ path: pathStr.optional() }),
  'universe:portal:create': UniversePortalSchema,
  'universe:portal:list': z.object({}),
  'universe:portal:delete': z.object({ id: idStr }),
  'universe:portal:reorder': z.object({ ids: z.array(idStr) }),
  'universe:checkpoint:create': UniverseCheckpointSchema,
  'universe:checkpoint:list': z.object({ mapId: idStr }),
  'universe:checkpoint:restore': z.object({ id: idStr }),
  'universe:checkpoint:delete': z.object({ id: idStr }),
  'universe:diff': FolderDiffSchema,
  'universe:impact': ImpactSimulateSchema,
  'universe:observatory:start': ChangeObservatorySchema,
  'universe:observatory:stop': z.object({}),
  'universe:observatory:status': z.object({}),
} as const;

export type InvokeChannel = keyof typeof InvokeSchemas;
export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof InvokeSchemas)[C]>;

export const EVENT_CHANNELS = [
  'fs:listBatch',
  'fs:changed',
  'fs:volumesChanged',
  'trash:changed',
  'ops:update',
  'ops:conflict',
  'job:progress',
  'job:done',
  'search:results',
  'search:done',
  'index:status',
  'ai:status',
  'ai:taskUpdate',
  'win:state',
  'host:request',
  'host:pick',
  'settings:changed',
  'cat:changed',
  'custom:changed',
  'shelf:changed',
  'actions:changed',
  'share:changed',
  'share:upload',
  'automation:changed',
  'automation:activity',
  'timeline:changed',
  'backup:changed',
  'backup:activity',
  'schedule:changed',
  'schedule:activity',
  'remote:changed',
  'remote:opened',
  's3:changed',
  'term:data',
  'term:exit',
  'term:closeRequest',
  ...OCR_EVENT_CHANNELS,
  'download:progress',
  'download:state',
  'watch:event',
  'universe:scan:progress',
  'universe:observatory:event',
] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

export function isInvokeChannel(c: unknown): c is InvokeChannel {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(InvokeSchemas, c);
}

export function isEventChannel(c: unknown): c is EventChannel {
  return typeof c === 'string' && (EVENT_CHANNELS as readonly string[]).includes(c);
}
