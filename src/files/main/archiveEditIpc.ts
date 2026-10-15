import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError } from '../shared/errors';
import { requireAbsolute } from './fs/paths';
import { detectFormat } from './tools/archives';
import { isEditableFormat } from '../shared/archiveEdit';
import {
  archiveAddEntries,
  archiveDeleteEntries,
  archiveRenameEntry,
  archiveMkdir,
  archiveMoveEntries,
  archiveConvert,
} from './tools/archiveEdit';
import type { ConvertFormat } from '../shared/archiveEdit';
import type { Services } from './services';

/**
 * IPC handlers for archive editing: add, delete, rename, move entries,
 * create folders and convert formats. Payloads are validated by the shared
 * zod schemas before these run (ipcHandlers.ts).
 *
 * Passwords travel in memory only, are never logged and leave no trace on disk.
 */

type Channels =
  | 'archive:addEntries'
  | 'archive:deleteEntries'
  | 'archive:renameEntry'
  | 'archive:mkdir'
  | 'archive:moveEntries'
  | 'archive:convert';

type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

/** Verify the archive exists and its format is editable; throw if not. */
async function requireEditable(archivePath: string): Promise<void> {
  const abs = requireAbsolute(archivePath, 'archive-edit');
  const fmt = await detectFormat(abs);
  if (!isEditableFormat(fmt)) {
    throw makeError('unsupported', 'archive-edit', {
      message: `Archives in "${fmt}" format cannot be edited in place. Supported formats: ZIP, TAR, TAR.GZ, 7z.`,
    });
  }
}

export function archiveEditHandlers(s: Services): Handlers {
  return {
    'archive:addEntries': async (p) => {
      const archivePath = requireAbsolute(p.archivePath, 'archive:addEntries');
      await requireEditable(archivePath);
      const filePaths = p.filePaths.map((f) => requireAbsolute(f, 'archive:addEntries'));
      s.log.info('archive.addEntries', { archive: archivePath, count: filePaths.length, innerDir: p.innerDir });
      return archiveAddEntries(archivePath, filePaths, p.innerDir ?? '', p.password);
    },

    'archive:deleteEntries': async (p) => {
      const archivePath = requireAbsolute(p.archivePath, 'archive:deleteEntries');
      await requireEditable(archivePath);
      s.log.info('archive.deleteEntries', { archive: archivePath, count: p.entries.length });
      return archiveDeleteEntries(archivePath, p.entries, p.password);
    },

    'archive:renameEntry': async (p) => {
      const archivePath = requireAbsolute(p.archivePath, 'archive:renameEntry');
      await requireEditable(archivePath);
      s.log.info('archive.renameEntry', { archive: archivePath, from: p.oldName, to: p.newName });
      return archiveRenameEntry(archivePath, p.oldName, p.newName, p.password);
    },

    'archive:mkdir': async (p) => {
      const archivePath = requireAbsolute(p.archivePath, 'archive:mkdir');
      await requireEditable(archivePath);
      s.log.info('archive.mkdir', { archive: archivePath, parent: p.parentDir, name: p.folderName });
      return archiveMkdir(archivePath, p.parentDir ?? '', p.folderName, p.password);
    },

    'archive:moveEntries': async (p) => {
      const archivePath = requireAbsolute(p.archivePath, 'archive:moveEntries');
      await requireEditable(archivePath);
      s.log.info('archive.moveEntries', { archive: archivePath, count: p.moves.length });
      return archiveMoveEntries(archivePath, p.moves, p.password);
    },

    'archive:convert': async (p) => {
      const archivePath = requireAbsolute(p.archivePath, 'archive:convert');
      const destination = p.destination ? requireAbsolute(p.destination, 'archive:convert') : undefined;
      s.log.info('archive.convert', { archive: archivePath, target: p.targetFormat, destination });
      return archiveConvert(archivePath, p.targetFormat as ConvertFormat, destination, p.password);
    },
  };
}
