import path from 'node:path';
import type { OperationManager, PlatformOps } from '../ops/OperationManager';
import type { TrashStore } from '../fs/trash';
import type { Catalog } from '../store/Catalog';
import type { ShelfStore } from '../shelf';
import type { Indexer } from '../search/Indexer';
import type { MetadataService } from '../media/MetadataService';
import { makeJoinRunner, makeSplitRunner, validateJoinRequest, validateSplitRequest } from './splitJoin';
import { makeShredRunner, validateShredRequest } from './shred';
import { makeFlattenRestoreRunner, makeFlattenRunner, validateFlattenRequest, validateFlattenRestoreRequest, type FlattenDeps } from './flatten';
import { makeSetDatesRunner, validateDatesRequest } from './setDates';
import { makeLinkRunner, validateLinkRequest } from './links';
import { makeClipSaveRunner, validateClipSaveRequest } from './clipSave';

/** Registers the power-tool operation runners for one profile (called from services.ts). */
export function registerPowerToolRunners(d: { ops: OperationManager; platform: PlatformOps; trash?: TrashStore; scratchRoot: string; catalog: Catalog; shelf: ShelfStore; indexer: Indexer; metadata: MetadataService }): void {
  const { ops } = d;
  const markRunning = (r: Parameters<OperationManager['markRunning']>[0]) => ops.markRunning(r);
  const touched = (p: string) => d.indexer.touch([p]);
  const onMoved = (from: string, to: string) => {
    d.catalog.onMoved(from, to);
    d.shelf.onMoved(from, to);
    d.indexer.touch([from, to]);
  };
  ops.registerRunner('split-file', makeSplitRunner({ markRunning, onCreated: touched }), validateSplitRequest);
  ops.registerRunner('join-files', makeJoinRunner({ markRunning, onCreated: touched }), validateJoinRequest);
  ops.registerRunner('shred', makeShredRunner({
    markRunning,
    extraRoots: [d.scratchRoot],
    onRemoved: (p) => {
      d.catalog.onRemoved(p);
      d.indexer.touch([p]);
    },
  }), validateShredRequest([d.scratchRoot]));
  const flatten: FlattenDeps = {
    platform: d.platform,
    markRunning,
    onMoved,
    restoreTrashed: d.trash ? async (t) => {
      const item = await d.trash!.resolve(path.join(t.trashDir, 'files', t.name));
      await d.trash!.restore(item, t.original);
    } : undefined,
  };
  ops.registerRunner('flatten', makeFlattenRunner(flatten), validateFlattenRequest);
  ops.registerRunner('flatten-restore', makeFlattenRestoreRunner(flatten), validateFlattenRestoreRequest);
  ops.registerRunner('set-dates', makeSetDatesRunner({ markRunning, read: (p) => d.metadata.read(p), onChanged: (p) => {
    d.metadata.invalidate(p);
    d.indexer.touch([p]);
  } }), validateDatesRequest);
  ops.registerRunner('link-create', makeLinkRunner({ markRunning, onCreated: touched }), validateLinkRequest);
  ops.registerRunner('clip-save', makeClipSaveRunner({ markRunning, onCreated: touched }), validateClipSaveRequest);
}
