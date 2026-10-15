/**
 * IPC handlers for the e-book, comic and 3D model viewers.
 * Imported and spread into the main handler map by ipcHandlers.ts.
 */
import type { z } from 'zod';
import type { InvokeSchemas } from '../shared/ipc';
import { requireAbsolute } from './fs/paths';
import * as Ebook from './viewers/EbookService';
import * as Comic from './viewers/ComicService';
import * as Model from './viewers/ModelService';
import type { Services } from './services';

type ViewerChannel =
  | 'ebook:open' | 'ebook:chapter' | 'ebook:position' | 'ebook:savePosition'
  | 'comic:open' | 'comic:page' | 'comic:position' | 'comic:savePosition'
  | 'model3d:info' | 'model3d:load';

export function viewerHandlers(s: Services): { [C in ViewerChannel]: (p: z.infer<(typeof InvokeSchemas)[C]>) => unknown } {
  const archiveLimits = () => ({ maxTotalBytes: s.settings.get('archiveMaxTotalGB') * 1024 ** 3, maxRatio: s.settings.get('archiveMaxRatio'), maxEntries: s.settings.get('archiveMaxEntries') });

  return {
    'ebook:open': (p) => Ebook.openEbook(requireAbsolute(p.path, 'ebook.open')),
    'ebook:chapter': (p) => Ebook.readChapter(requireAbsolute(p.path, 'ebook.chapter'), p.spineIndex),
    'ebook:position': (p) => Ebook.getPosition(requireAbsolute(p.path, 'ebook.position')),
    'ebook:savePosition': (p) => Ebook.savePosition(requireAbsolute(p.path, 'ebook.savePosition'), p.index, p.scrollOffset),
    'comic:open': (p) => Comic.openComic(requireAbsolute(p.path, 'comic.open'), archiveLimits()),
    'comic:page': async (p) => {
      const localPath = await Comic.extractPage(requireAbsolute(p.path, 'comic.page'), p.entry, archiveLimits());
      return { path: localPath, url: `orbis-media://f/${encodeURIComponent(localPath)}` };
    },
    'comic:position': (p) => Comic.getPosition(requireAbsolute(p.path, 'comic.position')),
    'comic:savePosition': (p) => Comic.savePosition(requireAbsolute(p.path, 'comic.savePosition'), p.index),
    'model3d:info': (p) => Model.modelInfo(requireAbsolute(p.path, 'model3d.info')),
    'model3d:load': (p) => Model.loadModel(requireAbsolute(p.path, 'model3d.load')),
  };
}
