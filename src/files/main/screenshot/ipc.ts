import { type IpcMainInvokeEvent } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import { requireAbsolute } from '../fs/paths';
import type { ScreenshotService } from './ScreenshotService';

/**
 * IPC handlers for screenshot capture and save. Payloads were validated by the
 * shared zod schemas (ipcHandlers.ts); paths are checked to be absolute here.
 * Annotation happens entirely in the renderer; only the final export is saved
 * through these handlers.
 */

type Channels = 'screenshot:capture' | 'screenshot:sources' | 'screenshot:save';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export function screenshotHandlers(service: ScreenshotService): Handlers {
  return {
    'screenshot:capture': async (p) => {
      return service.capture(p);
    },

    'screenshot:sources': async (p) => {
      return service.listSources(p.types);
    },

    'screenshot:save': async (p) => {
      const dest = requireAbsolute(p.destination, 'screenshot.save');

      // Ensure the parent directory exists.
      const dir = path.dirname(dest);
      await fsp.mkdir(dir, { recursive: true });

      // Parse the data URL or raw base64.
      let base64Data = p.dataUrl;
      const match = base64Data.match(/^data:image\/\w+;base64,(.+)$/);
      if (match) base64Data = match[1]!;

      const buffer = Buffer.from(base64Data, 'base64');

      if (!buffer.length) {
        throw makeError('validation', 'screenshot.save', { message: 'Image data is empty.' });
      }

      await fsp.writeFile(dest, buffer);

      return { path: dest, size: buffer.length };
    },
  };
}
