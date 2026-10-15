import { clipText } from '../clip';
import { shell, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import { safeWebLink } from '../../shared/terminal';
import type { Services } from '../services';
import { detectShells, resolveShell } from './shells';

/**
 * IPC handlers of the built-in terminal. Payloads are validated by the shared
 * zod schemas (sizes, ids, dimensions) before these run; every session call is
 * scoped to the window that sent it (`e.sender.id`), so a window can only reach
 * the sessions it created. The shell is chosen here from Settings, never by the
 * window.
 */

type Channels = 'term:info' | 'term:create' | 'term:write' | 'term:resize' | 'term:ack' | 'term:kill' | 'term:list' | 'term:status' | 'term:running' | 'term:cwd' | 'term:openLink' | 'term:allowClose' | 'term:clipboard';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export interface TerminalCloseHooks {
  /** The window approved closing (or quitting) with running programs; main.ts closes it or quits. */
  allowClose: (e: IpcMainInvokeEvent, quit: boolean) => void;
}

export function terminalHandlers(s: Services, hooks: TerminalCloseHooks): Handlers {
  const t = s.terminals;
  const settings = () => ({ terminalShell: s.settings.get('terminalShell'), terminalCustomPath: s.settings.get('terminalCustomPath'), terminalCustomArgs: s.settings.get('terminalCustomArgs') });
  return {
    'term:info': async () => {
      const shells = await detectShells({ platform: t.platform });
      let current: { label: string; path: string; source: string } | undefined;
      let problem: string | undefined;
      try {
        const sh = await resolveShell(settings(), { platform: t.platform });
        current = { label: sh.label, path: sh.path, source: sh.source };
      } catch (err) {
        problem = (err as Error).message;
      }
      const avail = t.availability();
      return {
        available: avail.available,
        reason: avail.reason,
        platform: t.platform,
        shells,
        current,
        problem,
        cwdSupported: t.platform === 'linux' || t.platform === 'darwin',
        foregroundSupported: t.platform === 'linux' || t.platform === 'darwin',
      };
    },
    'term:create': (p, e) => t.create(e.sender.id, p, settings()),
    'term:write': (p, e) => {
      t.write(e.sender.id, p.id, p.data);
      return null;
    },
    'term:resize': (p, e) => {
      t.resize(e.sender.id, p.id, p.cols, p.rows);
      return null;
    },
    'term:ack': (p, e) => t.ack(e.sender.id, p.id, p.chars),
    'term:kill': (p, e) => {
      t.kill(e.sender.id, p.id);
      return { killed: true };
    },
    'term:list': (_p, e) => t.list(e.sender.id),
    'term:status': (p, e) => t.status(e.sender.id, p.id),
    'term:running': (_p, e) => t.running(e.sender.id),
    'term:cwd': (p, e) => t.cwd(e.sender.id, p.id),
    'term:openLink': async (p) => {
      // The window asked the user first; the main process checks the address again.
      const url = safeWebLink(p.url);
      if (!url) throw makeError('validation', 'term.openLink', { message: 'Only http and https addresses (without a user name or password) are opened from the terminal.' });
      await shell.openExternal(url);
      s.log.info('term.link_opened', { host: new URL(url).host });
      return { opened: true };
    },
    'term:clipboard': async () => {
      const text = await clipText();
      if (text.length > 4 * 1024 * 1024) throw makeError('validation', 'term.clipboard', { message: 'The clipboard holds more than 4 MB of text, which is too much to paste into a terminal.' });
      return { text };
    },
    'term:allowClose': (p, e) => {
      hooks.allowClose(e, !!p.quit);
      return null;
    },
  };
}
