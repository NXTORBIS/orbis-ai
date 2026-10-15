import type { Services } from '../services';
import type { BrowserWindow } from 'electron';
import { UniverseScanner } from './UniverseScanner';
import { UniverseStore } from './UniverseStore';
import { ChangeObservatory } from './ChangeObservatory';
import { folderDiff } from './FolderDiff';
import { simulateImpact } from './ImpactSimulator';

export function universeHandlers(s: Services) {
  const win = (s as any).mainWindow as BrowserWindow | null ?? null;
  const scanner = new UniverseScanner(s.db, win);
  const store = new UniverseStore(s.db);
  const observatory = new ChangeObservatory(win);

  return {
    'universe:scan': async (data: any) => {
      const scanId = await scanner.scan({
        root: data.root,
        maxDepth: data.maxDepth ?? 20,
        maxEntries: data.maxEntries ?? 500_000,
        includeHidden: data.includeHidden ?? false,
      });
      return { scanId };
    },
    'universe:scanStatus': (data: any) => scanner.getStatus(data.scanId),
    'universe:cancelScan': (data: any) => { scanner.cancel(data.scanId); return { ok: true }; },
    'universe:query': (data: any) => scanner.query(data),
    'universe:stats': (data: any) => scanner.getStats(data.scanId),
    'universe:relations': (data: any) => scanner.getRelations(data.scanId, data.path),

    'universe:map:save': (data: any) => ({ id: store.saveMap(data) }),
    'universe:map:update': (data: any) => { store.updateMap(data.id, data); return { ok: true }; },
    'universe:map:list': () => store.listMaps(),
    'universe:map:get': (data: any) => store.getMap(data.id),
    'universe:map:delete': (data: any) => { store.deleteMap(data.id); return { ok: true }; },

    'universe:annotate': (data: any) => ({ id: store.annotate(data) }),
    'universe:annotate:update': (data: any) => { store.updateAnnotation(data.id, data); return { ok: true }; },
    'universe:annotate:delete': (data: any) => { store.deleteAnnotation(data.id); return { ok: true }; },
    'universe:annotate:list': (data: any) => store.listAnnotations(data.path),

    'universe:portal:create': (data: any) => ({ id: store.createPortal(data) }),
    'universe:portal:list': () => store.listPortals(),
    'universe:portal:delete': (data: any) => { store.deletePortal(data.id); return { ok: true }; },
    'universe:portal:reorder': (data: any) => { store.reorderPortals(data.ids); return { ok: true }; },

    'universe:checkpoint:create': (data: any) => ({ id: store.createCheckpoint(data) }),
    'universe:checkpoint:list': (data: any) => store.listCheckpoints(data.mapId),
    'universe:checkpoint:restore': (data: any) => store.getCheckpoint(data.id),
    'universe:checkpoint:delete': (data: any) => { store.deleteCheckpoint(data.id); return { ok: true }; },

    'universe:diff': async (data: any) => folderDiff(data.leftPath, data.rightPath, data.deep ?? true, data.compareContent ?? false, data.maxEntries ?? 100_000),
    'universe:impact': async (data: any) => simulateImpact(data.paths, data.operation, data.destination),

    'universe:observatory:start': (data: any) => { observatory.start(data.roots); return { ok: true }; },
    'universe:observatory:stop': () => { observatory.stop(); return { ok: true }; },
    'universe:observatory:status': () => observatory.status(),
  };
}
