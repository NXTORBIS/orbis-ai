import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AppDatabase } from './store/Database';
import { SettingsStore } from './store/SettingsStore';
import { CustomizationService } from './customization/CustomizationService';
import { Catalog } from './store/Catalog';
import { ChecksumStore } from './store/Checksums';
import { OperationManager, type OperationStore, type PlatformOps } from './ops/OperationManager';
import { Indexer } from './search/Indexer';
import { RulesEngine } from './tools/rules';
import { SnapshotStore } from './tools/snapshots';
import { makeCompressRunner, makeExtractRunner, scratchRoot } from './tools/archives';
import { RemoteService } from './remote/RemoteService';
import { S3Service } from './remote/S3Service';
import { TerminalService, type TerminalServiceOptions } from './terminal/TerminalService';
import { makeRemoteRunners } from './remote/transfers';
import type { SecretBox } from './remote/secrets';
import { makeChecksumCreateRunner } from './tools/checksumFiles';
import { makeDecryptRunner, makeEncryptRunner, validateCryptoRequest } from './tools/fileCrypto';
import { makeShareReceiveRunner, qrDataUrl, ShareService } from './share/ShareService';
import { ProviderRegistry, editBytes, type ProposalExecutor } from './ai/ProviderRegistry';
import { Logger } from './log';
import { ContentRegistry } from './library/ContentRegistry';
import { MetadataService } from './media/MetadataService';
import { makeMetadataEditRunner } from './media/editMetadata';
import { makeConvertRunner, type ImageEncoder } from './media/convert';
import { makeTrashRunners } from './ops/trashRunners';
import { SyncService } from './sync/SyncService';
import { SyncStore } from './sync/SyncStore';
import { makeDedupeRunner } from './tools/dedupeActions';
import { makePdfToolsRunner, validatePdfRequest } from './tools/pdfTools';
import { makeFindReplaceRunner, validateReplaceRequest } from './tools/findReplace';
import { makeTextFixRunner, validateTextFixRequest } from './tools/textFixes';
import { makeSnapshotRestoreRunner } from './tools/docFiles';
import type { TrashStore } from './fs/trash';
import type { SmallImageDecoder } from './media/similar';
import type { OperationRecord } from '../shared/operations';
import type { StartupNotice } from '../shared/model';
import type { ProposedOperation } from '../shared/integration/ai-contract';
import { makeError, toOrbisError } from '../shared/errors';
import { exists } from './fs/FileSystemService';
import { validateName } from './fs/paths';
import { ShelfStore } from './shelf';
import { CustomActionStore, makeCustomActionRunner } from './actions/customActions';
import { GitService } from './git/GitService';
import { RuleAutomation, type AutomationOptions } from './tools/automation';
import { ImagePresetStore, makeImageBatchRunner, type ImageCodec } from './media/imageTools';
import { summarize } from '../shared/media';
import { Scheduler } from './schedule/Scheduler';
import { BackupService } from './backup/BackupService';
import { SyncSchedules } from './sync/SyncSchedules';
import { makeOrganizeRunner, OrganizePresetStore, validateOrganizeRequest } from './media/organize';
import { registerPowerToolRunners } from './tools/powerRunners';
import { makeVideoToolsRunner, validateVideoToolRequest } from './media/videoTools';
import { createOcrServices, type OcrServiceOptions, type OcrServices } from './ocr/OcrServices';
import { ScreenshotService } from './screenshot/ScreenshotService';
import { DownloadService } from './download/DownloadService';

/**
 * Builds every main-process service for one local profile. Profile data lives
 * entirely under `profileDir`, so profiles never share catalogues, indexes,
 * settings or history.
 */
export interface Services {
  profileId: string;
  profileDir: string;
  db: AppDatabase;
  settings: SettingsStore;
  customization: CustomizationService;
  catalog: Catalog;
  ops: OperationManager;
  indexer: Indexer;
  rules: RulesEngine;
  /** Opt-in rule automation on new files (watchers start with `automation.refresh()`). */
  automation: RuleAutomation;
  imagePresets: ImagePresetStore;
  /** Saved folder patterns for "Organize by date". */
  organizePresets: OrganizePresetStore;
  snapshots: SnapshotStore;
  ai: ProviderRegistry;
  content: ContentRegistry;
  metadata: MetadataService;
  /** The system Trash, where Orbis Files can read it (Linux). */
  trash?: TrashStore;
  checksums: ChecksumStore;
  /** Folder synchronization: saved pairs, previews and the 'sync' operation runner. */
  sync: SyncService;
  /** The shelf (drop stack): references to items collected by the user. */
  shelf: ShelfStore;
  /** Custom actions defined in Settings (runs are 'custom-action' operations). */
  actions: CustomActionStore;
  /** Read-only Git status for folders inside a work tree. */
  git: GitService;
  /** "Share on local network": temporary HTTP servers (stopped at quit). */
  shares: ShareService;
  /** Runs scheduled backups and sync pairs while the app is open (started by main.ts after the window opens). */
  scheduler: Scheduler;
  /** Backup jobs, versions, restore and verify ('backup' / 'backup-restore' operations). */
  backups: BackupService;
  /** "Run on schedule" for saved sync pairs (approval and safety checks). */
  syncSchedules: SyncSchedules;
  /** Remote locations (SFTP, WebDAV): connections, secrets, host keys, open connections and opened copies. */
  remote: RemoteService;
  /** S3-compatible object storage: connections, secrets and authenticated S3Client pool. */
  s3: S3Service;
  /** Built-in terminal sessions (node-pty, loaded on first use; sessions end at quit). */
  terminals: TerminalService;
  /** Text recognition (OCR): engine threads, languages, recognized-text store and the background job. */
  ocr: OcrServices;
  /** Screenshot capture (full screen, window, region) and save. */
  screenshot: ScreenshotService;
  /** Download manager: URL downloads with queue, pause/resume, checksums and history. */
  dl: DownloadService;
  decodeSmallImage?: SmallImageDecoder;
  archiveLimits: () => { maxTotalBytes: number; maxRatio: number; maxEntries: number };
  log: Logger;
  notices: StartupNotice[];
  interrupted: OperationRecord[];
}

export async function createServices(opts: { profileId: string; profileDir: string; wasmDir: string; platform: PlatformOps; log: Logger; appVersion?: string; media?: { encodeImage?: ImageEncoder; decodeSmallImage?: SmallImageDecoder; imageCodec?: ImageCodec }; trash?: TrashStore; automation?: Partial<AutomationOptions>; secrets?: SecretBox; remote?: { connectTimeoutMs?: number; webdavCa?: string | Buffer; ftpsCa?: string | Buffer }; terminal?: TerminalServiceOptions; ocr?: OcrServiceOptions }): Promise<Services> {
  const { profileDir, log } = opts;
  await fsp.mkdir(profileDir, { recursive: true });
  const db = await AppDatabase.open(path.join(profileDir, 'orbis-files.db'), opts.wasmDir);
  // Customization first: on the first start after it was introduced it carries the
  // presentation preferences over from the settings table, which SettingsStore then prunes.
  const customization = new CustomizationService(db, { platform: process.platform, generator: `Orbis Files ${opts.appVersion ?? ''}`.trim() });
  const settings = new SettingsStore(db);
  const catalog = new Catalog(db);
  const checksums = new ChecksumStore(db);
  checksums.prune();

  const opStore: OperationStore = {
    save: (rec) => db.run('INSERT INTO operations(id, type, state, record, updated_ms) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, record = excluded.record, updated_ms = excluded.updated_ms', [rec.id, rec.type, rec.state, JSON.stringify(rec), Date.now()]),
    loadAll: () => db.all<{ record: string }>('SELECT record FROM operations ORDER BY updated_ms DESC LIMIT 500').flatMap((r) => {
      try {
        return [JSON.parse(r.record) as OperationRecord];
      } catch {
        return [];
      }
    }),
    remove: (id) => db.run('DELETE FROM operations WHERE id = ?', [id]),
  };

  const indexer = new Indexer(db, { get: (k, f) => catalog.getKv(k, f), set: (k, v) => catalog.setKv(k, v) });
  indexer.contentEnabled = settings.get('indexContents');

  const shelf = new ShelfStore(catalog);
  const git = new GitService();
  const ops = new OperationManager(opts.platform, opStore, {
    onMoved: (from, to) => {
      catalog.onMoved(from, to);
      shelf.onMoved(from, to);
      indexer.touch([from, to]);
    },
    onRemoved: (p) => {
      catalog.onRemoved(p);
      indexer.touch([p]);
    },
  });
  ops.maxConcurrent = settings.get('maxConcurrentOperations');
  const archiveLimits = () => ({ maxTotalBytes: settings.get('archiveMaxTotalGB') * 1024 ** 3, maxRatio: settings.get('archiveMaxRatio'), maxEntries: settings.get('archiveMaxEntries') });
  ops.registerRunner('extract', makeExtractRunner((r) => ops.markRunning(r), archiveLimits));
  ops.registerRunner('compress', makeCompressRunner((r) => ops.markRunning(r)));
  ops.registerRunner('checksum-create', makeChecksumCreateRunner((r) => ops.markRunning(r)));
  // File encryption (.orbisenc); passwords travel only in the in-memory request parameters.
  const touched = (p: string) => indexer.touch([p]);
  ops.registerRunner('encrypt', makeEncryptRunner({ platform: opts.platform, markRunning: (r) => ops.markRunning(r), onChanged: touched }), validateCryptoRequest);
  ops.registerRunner('decrypt', makeDecryptRunner({ markRunning: (r) => ops.markRunning(r), onChanged: touched }), validateCryptoRequest);
  // Files received by a local-network share are committed like any other change (never overwriting).
  const receive = makeShareReceiveRunner((r) => ops.markRunning(r));
  ops.registerRunner('share-receive', receive.run, receive.validate);
  const shares = new ShareService({ ops, qr: qrDataUrl, log });
  ops.registerRunner('convert', makeConvertRunner({ encodeImage: opts.media?.encodeImage, markRunning: (r) => ops.markRunning(r) }));
  // Restoring from and deleting in the system Trash run as operations like any other change.
  if (opts.trash) {
    const t = makeTrashRunners(opts.trash, (r) => ops.markRunning(r));
    ops.registerRunner('trash-restore', t.restore);
    ops.registerRunner('trash-delete', t.remove);
  }
  // Folder synchronization runs as 'sync' operations; deletions and replaced versions go to the Trash.
  const sync = new SyncService(new SyncStore(db), ops, opts.platform);
  // Schedules (backups, sync pairs) run while the app is open; "pause all" is stored per profile.
  const scheduler = new Scheduler({
    timers: true,
    paused: catalog.getKv<boolean>('schedule.paused', false),
    onPausedChange: (p) => catalog.setKv('schedule.paused', p),
    onError: (t, err) => log.warn('schedule.run_failed', { task: t.id, message: (err as Error)?.message }),
  });
  const backups = new BackupService({
    db, ops, platform: opts.platform, scheduler,
    log: (event, fields) => log.info(event, fields),
    onChanged: (paths) => indexer.touch(paths),
  });
  backups.registerSchedules();
  const syncSchedules = new SyncSchedules({ db, sync, ops, scheduler });
  syncSchedules.registerAll();
  // Acting on marked duplicates: each copy is checked against a kept copy right before it is touched.
  const dedupe = makeDedupeRunner({
    platform: opts.platform,
    markRunning: (r) => ops.markRunning(r),
    onMoved: (from, to) => {
      catalog.onMoved(from, to);
      shelf.onMoved(from, to);
      indexer.touch([from, to]);
    },
    onRemoved: (p) => {
      catalog.onRemoved(p);
      indexer.touch([p]);
    },
    onChanged: (p) => indexer.touch([p]),
  });
  ops.registerRunner('dedupe', dedupe.run, dedupe.validate);
  // Custom actions: the stored definition is read by the runner; a request only names its id.
  const actions = new CustomActionStore(catalog);
  const actionRunner = makeCustomActionRunner({ store: actions, markRunning: (r) => ops.markRunning(r), onChanged: (paths) => indexer.touch(paths.filter((x) => path.isAbsolute(x))) });
  ops.registerRunner('custom-action', actionRunner.run, actionRunner.validate);
  // Metadata edits keep a restorable snapshot of the original first.
  const snapshots = new SnapshotStore(db, path.join(profileDir, 'snapshots'));
  const metadata = new MetadataService();
  ops.registerRunner('edit-metadata', makeMetadataEditRunner({
    snapshot: (p) => snapshots.create(p),
    markRunning: (r) => ops.markRunning(r),
    onChanged: (p) => {
      metadata.invalidate(p);
      indexer.touch([p]);
    },
  }));
  // Document tools: PDFs are only read (new files are made); text edits snapshot first and are undone from the snapshots.
  ops.registerRunner('pdf-tools', makePdfToolsRunner({ markRunning: (r) => ops.markRunning(r) }), validatePdfRequest);
  const textChanged = (p: string) => {
    metadata.invalidate(p);
    indexer.touch([p]);
  };
  ops.registerRunner('find-replace', makeFindReplaceRunner({ snapshot: (p) => snapshots.create(p), markRunning: (r) => ops.markRunning(r), onChanged: textChanged }), validateReplaceRequest);
  ops.registerRunner('text-fix', makeTextFixRunner({ snapshot: (p) => snapshots.create(p), markRunning: (r) => ops.markRunning(r), onChanged: textChanged }), validateTextFixRequest);
  ops.registerRunner('snapshot-restore', makeSnapshotRestoreRunner({ snapshots, markRunning: (r) => ops.markRunning(r), onChanged: textChanged }));
  // Keep the index fresh for everything Orbis Files itself changes.
  ops.on('update', (rec: OperationRecord) => {
    // Imported copies are recorded as library items with source "import".
    if (rec.origin === 'import' && ['completed', 'completed_with_errors'].includes(rec.state)) {
      for (const r of rec.results) if (r.status === 'done' && r.destination) void catalog.ensureItem(r.destination, 'import').catch(() => undefined);
    }
    if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(rec.state)) git.invalidate([...rec.sources, ...(rec.destination ? [rec.destination] : [])]);
    if (['completed', 'completed_with_errors'].includes(rec.state)) {
      indexer.touch(rec.results.flatMap((r) => [r.source, r.destination].filter((x): x is string => !!x && path.isAbsolute(x))));
    }
  });

  // Remote locations: transfers, permanent deletion on a server and "Upload changes" are operations too.
  const remote = new RemoteService({ kv: catalog, secrets: opts.secrets, log, copiesDir: path.join(profileDir, 'remote-copies'), scratchDir: scratchRoot, ...opts.remote });
  const remoteRunners = makeRemoteRunners(remote, (r) => ops.markRunning(r));
  ops.registerRunner('remote-transfer', remoteRunners.transfer, remoteRunners.validateTransfer);
  ops.registerRunner('remote-delete', remoteRunners.remove, remoteRunners.validateRemove);
  ops.registerRunner('remote-save', remoteRunners.save, remoteRunners.validateSave);

  // S3-compatible object storage.
  const s3 = new S3Service({ kv: catalog, secrets: opts.secrets, log });

  // Video tools with the installed FFmpeg: new files only (never replacing), undo moves them to the Trash.
  ops.registerRunner('video-tool', makeVideoToolsRunner({ markRunning: (r) => ops.markRunning(r), onCreated: (p) => indexer.touch([p]) }), validateVideoToolRequest);
  ops.registerRunner('image-batch', makeImageBatchRunner({ codec: opts.media?.imageCodec, markRunning: (r) => ops.markRunning(r), onCreated: (p) => indexer.touch([p]) }));
  const imagePresets = new ImagePresetStore(catalog);
  // Organize by date: dates are read through the metadata cache; moved files are followed by the catalogue.
  ops.registerRunner('organize-date', makeOrganizeRunner({
    read: (p) => metadata.read(p),
    markRunning: (r) => ops.markRunning(r),
    onMoved: (from, to) => {
      catalog.onMoved(from, to);
      shelf.onMoved(from, to);
      indexer.touch([from, to]);
    },
    onCreated: (p) => indexer.touch([p]),
  }), validateOrganizeRequest);
  const organizePresets = new OrganizePresetStore(catalog);
  // Power tools: split/join, secure delete, flatten, set dates, hard links, paste as file.
  registerPowerToolRunners({ ops, platform: opts.platform, trash: opts.trash, scratchRoot, catalog, shelf, indexer, metadata });

  const rules = new RulesEngine(db);
  const automation = new RuleAutomation(
    {
      rules,
      ops,
      catalog,
      kv: catalog,
      ctx: () => ({ tagLookup: (n: string) => catalog.pathsWithTagName(n), catalog: catalog.searchLookups(), metaLookup: async (file: string) => summarize(await metadata.read(file)) }),
    },
    opts.automation,
  );

  const executor: ProposalExecutor = (taskId, approved) => executeProposals(taskId, approved, { ops, catalog, snapshots });
  const ai = new ProviderRegistry(
    {
      record: (e) =>
        db.run('INSERT INTO ai_audit(id, task_id, ms, event, kind, refs, detail) VALUES(?, ?, ?, ?, ?, ?, ?)', [
          crypto.randomUUID(), e.taskId, Date.now(), e.event, e.kind ?? null, e.refs ? JSON.stringify(e.refs.slice(0, 1000)) : null, e.detail ? JSON.stringify(e.detail).slice(0, 100000) : null,
        ]),
    },
    executor,
  );

  const interrupted = await ops.recoverInterrupted();
  const notices: StartupNotice[] = [...db.notices, ...customization.notices, ...settings.notices];
  if (interrupted.length) {
    notices.push({ level: 'warning', message: `${interrupted.length} file operation(s) were interrupted when Orbis Files last closed. Review them in Operations.` });
  }
  log.info('services.ready', { profile: opts.profileId, schema: db.schemaVersion, interrupted: interrupted.length, ephemeral: db.ephemeral });
  const content = new ContentRegistry(catalog);
  const leftovers = await remote.leftoverCopies();
  if (leftovers.kept) notices.push({ level: 'info', message: `${leftovers.kept} copied remote file(s) you opened earlier are kept because they may contain changes that were not uploaded.`, detail: leftovers.dir });
  const terminals = new TerminalService({ appVersion: opts.appVersion, ...opts.terminal });
  // Text recognition: engine threads start on first use; the background job starts with the app (main.ts).
  const ocr = createOcrServices({ db, ops, catalog, profileDir, distDir: path.join(opts.wasmDir, '..'), log, onCreated: (p) => indexer.touch([p]), ...opts.ocr });
  const screenshot = new ScreenshotService();
  // Download manager: callbacks are wired to IPC broadcasts in registerIpc.
  const dl = new DownloadService({ db, defaultDir: path.join(profileDir, 'library', 'Downloads'), onProgress: () => {}, onStateChange: () => {} });
  return { profileId: opts.profileId, profileDir, db, settings, customization, catalog, ops, indexer, rules, automation, imagePresets, organizePresets, snapshots, ai, content, metadata, trash: opts.trash, checksums, sync, shelf, actions, git, shares, scheduler, backups, syncSchedules, remote, s3, terminals, ocr, screenshot, dl, archiveLimits, decodeSmallImage: opts.media?.decodeSmallImage, log, notices, interrupted };
}

/** Execute approved AI proposals through the same services as manual actions. */
export async function executeProposals(
  taskId: string,
  approved: Array<{ index: number; op: ProposedOperation }>,
  deps: { ops: OperationManager; catalog: Catalog; snapshots?: SnapshotStore },
): Promise<Array<{ index: number; ok: boolean; message: string; operationId?: string; snapshotId?: string }>> {
  const out: Array<{ index: number; ok: boolean; message: string; operationId?: string; snapshotId?: string }> = [];
  const origin = `ai:${taskId}`;
  for (const { index, op } of approved) {
    try {
      switch (op.op) {
        case 'rename': {
          const to = path.join(path.dirname(op.from), op.toName);
          const rec = deps.ops.start({ type: 'rename-batch', sources: [op.from], renames: [{ from: op.from, to }], origin });
          out.push({ index, ok: true, message: `Queued rename to "${op.toName}".`, operationId: rec.id });
          break;
        }
        case 'move':
        case 'copy': {
          const rec = deps.ops.start({ type: op.op, sources: [op.from], destination: op.toDir, conflictPolicy: 'ask', origin });
          out.push({ index, ok: true, message: `Queued ${op.op}.`, operationId: rec.id });
          break;
        }
        case 'trash': {
          const rec = deps.ops.start({ type: 'trash', sources: [op.path], origin });
          out.push({ index, ok: true, message: 'Queued move to Trash.', operationId: rec.id });
          break;
        }
        case 'mkdir': {
          const v = validateName(path.basename(op.path));
          if (!v.valid) throw makeError('invalid_name', 'ai.mkdir', { message: v.reason });
          await fsp.mkdir(op.path);
          out.push({ index, ok: true, message: 'Folder created.' });
          break;
        }
        case 'tag': {
          for (const name of op.tags) {
            const tag = deps.catalog.tags().find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? deps.catalog.createTag(name);
            await deps.catalog.tagItems(tag.id, [op.path]);
          }
          out.push({ index, ok: true, message: `Tagged with ${op.tags.join(', ')}.` });
          break;
        }
        case 'collect': {
          const col = deps.catalog.collections().find((c) => c.name.toLowerCase() === op.collection.toLowerCase()) ?? deps.catalog.createCollection(op.collection);
          await deps.catalog.addToCollection(col.id, [op.path]);
          out.push({ index, ok: true, message: `Added to "${col.name}".` });
          break;
        }
        case 'write_new': {
          // New file only: written to a temporary sibling, verified, then committed exclusively.
          const target = path.join(op.toDir, op.name);
          if (await exists(target)) throw makeError('already_exists', 'ai.write_new', { message: `"${op.name}" already exists. The generated file was not saved over it.` });
          const data = op.encoding === 'base64' ? Buffer.from(op.data, 'base64') : Buffer.from(op.data, 'utf8');
          const tmp = path.join(op.toDir, `.orbis-part-${crypto.randomUUID()}`);
          await fsp.writeFile(tmp, data, { flag: 'wx' });
          try {
            const written = await fsp.readFile(tmp);
            if (!written.equals(data)) throw makeError('io', 'ai.write_new', { message: 'The written file did not verify.' });
            await fsp.link(tmp, target);
          } finally {
            await fsp.unlink(tmp).catch(() => undefined);
          }
          deps.catalog.registerGenerated({ path: target, generator: 'orbis-ai', chatId: taskId });
          out.push({ index, ok: true, message: `Saved "${op.name}".` });
          break;
        }
        case 'edit_file': {
          const r = await applyEdit(op, deps.snapshots);
          out.push({ index, ok: true, message: `Edited "${path.basename(op.path)}". The previous version is kept as a snapshot.`, snapshotId: r.snapshotId });
          break;
        }
      }
    } catch (err) {
      out.push({ index, ok: false, message: toOrbisError(err, `ai.${op.op}`).message });
    }
  }
  return out;
}

/**
 * Replace a file's contents with an approved AI edit:
 * base hash re-checked → snapshot of the current version → new content
 * written to a temporary sibling and verified → original re-checked for
 * changes → atomic rename over it → final verification. Permissions are kept.
 */
export async function applyEdit(op: Extract<ProposedOperation, { op: 'edit_file' }>, snapshots: SnapshotStore | undefined): Promise<{ snapshotId: string }> {
  if (!snapshots) throw makeError('unavailable', 'ai.edit_file', { message: 'Snapshots are not available, so the edit was not applied.' });
  const st = await fsp.lstat(op.path);
  if (!st.isFile()) throw makeError('unsupported', 'ai.edit_file', { message: 'Only regular files can be edited (not links or folders).', target: op.path });
  const sha = async (p: string) => crypto.createHash('sha256').update(await fsp.readFile(p)).digest('hex');
  if ((await sha(op.path)) !== op.baseSha256) throw makeError('busy', 'ai.edit_file', { message: 'The file changed after Orbis AI read it. Nothing was changed.', target: op.path });
  let snapshotId: string;
  try {
    snapshotId = (await snapshots.create(op.path)).id;
  } catch (err) {
    throw makeError('unavailable', 'ai.edit_file', { message: `A safety snapshot could not be taken (${toOrbisError(err, 'snapshot').message}). Nothing was changed.`, target: op.path });
  }
  const data = editBytes(op);
  const tmp = path.join(path.dirname(op.path), `.orbis-part-${crypto.randomUUID()}${path.extname(op.path)}`);
  await fsp.writeFile(tmp, data, { flag: 'wx', mode: st.mode & 0o7777 });
  try {
    await fsp.chmod(tmp, st.mode & 0o7777).catch(() => undefined);
    if (!(await fsp.readFile(tmp)).equals(data)) throw makeError('io', 'ai.edit_file', { message: 'The new content did not verify. The original is unchanged.' });
    const again = await fsp.lstat(op.path);
    if (again.mtimeMs !== st.mtimeMs || again.size !== st.size || (await sha(op.path)) !== op.baseSha256) {
      throw makeError('busy', 'ai.edit_file', { message: 'The file changed while the edit was being prepared. Nothing was changed.', target: op.path });
    }
    await fsp.rename(tmp, op.path);
  } finally {
    await fsp.unlink(tmp).catch(() => undefined);
  }
  const final = crypto.createHash('sha256').update(data).digest('hex');
  if ((await sha(op.path)) !== final) throw makeError('io', 'ai.edit_file', { message: `The edited file did not verify. The previous version is in snapshot ${snapshotId}.`, target: op.path });
  return { snapshotId };
}
