import fsp from 'node:fs/promises';
import _fs from 'node:fs';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { requireAbsolute } from '../fs/paths';
import { makeError } from '../../shared/errors';
import type { HexViewData, HexSearchResult } from '../../shared/hexEditor';

const MAX_CHUNK = 64 * 1024; // 64 KB per read
const MAX_SEARCH_MATCHES = 1000;
const MAX_SEARCH_FILE = 256 * 1024 * 1024; // 256 MB

type Channels = 'hex:read' | 'hex:write' | 'hex:search';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export function hexEditorHandlers(): Handlers {
  return {
    'hex:read': async (p): Promise<HexViewData> => {
      const abs = requireAbsolute(p.path, 'hex:read');
      const stat = await fsp.stat(abs);
      if (!stat.isFile()) throw makeError('validation', 'hex:read', { message: 'Not a regular file.' });
      const length = Math.min(p.length, MAX_CHUNK);
      const offset = Math.max(0, Math.min(p.offset, stat.size));
      const buf = Buffer.alloc(Math.min(length, Math.max(0, stat.size - offset)));
      if (buf.length > 0) {
        const fh = await fsp.open(abs, 'r');
        try {
          await fh.read(buf, 0, buf.length, offset);
        } finally {
          await fh.close();
        }
      }
      return { offset, bytes: buf.toString('base64'), totalSize: stat.size };
    },

    'hex:write': async (p): Promise<{ ok: true }> => {
      const abs = requireAbsolute(p.path, 'hex:write');
      const stat = await fsp.stat(abs);
      if (!stat.isFile()) throw makeError('validation', 'hex:write', { message: 'Not a regular file.' });
      const fh = await fsp.open(abs, 'r+');
      try {
        for (const edit of p.edits) {
          const buf = Buffer.from(edit.bytes, 'base64');
          await fh.write(buf, 0, buf.length, edit.offset);
        }
      } finally {
        await fh.close();
      }
      return { ok: true };
    },

    'hex:search': async (p): Promise<HexSearchResult> => {
      const abs = requireAbsolute(p.path, 'hex:search');
      const stat = await fsp.stat(abs);
      if (!stat.isFile()) throw makeError('validation', 'hex:search', { message: 'Not a regular file.' });
      if (stat.size > MAX_SEARCH_FILE) throw makeError('validation', 'hex:search', { message: 'File too large to search (max 256 MB).' });

      let needle: Buffer;
      if (p.mode === 'hex') {
        // hex string like "FF 00 AB"
        const hex = p.pattern.replace(/\s+/g, '');
        if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
          throw makeError('validation', 'hex:search', { message: 'Invalid hex pattern.' });
        }
        needle = Buffer.from(hex, 'hex');
      } else {
        needle = Buffer.from(p.pattern, 'utf-8');
      }

      if (needle.length === 0) throw makeError('validation', 'hex:search', { message: 'Empty search pattern.' });

      const matches: Array<{ offset: number }> = [];
      const CHUNK_SIZE = 256 * 1024;
      const overlap = needle.length - 1;
      const fh = await fsp.open(abs, 'r');
      try {
        let fileOffset = p.fromOffset;
        let carry = Buffer.alloc(0);
        while (fileOffset < stat.size && matches.length < MAX_SEARCH_MATCHES) {
          const readLen = Math.min(CHUNK_SIZE, stat.size - fileOffset);
          const buf = Buffer.alloc(readLen);
          const { bytesRead } = await fh.read(buf, 0, readLen, fileOffset);
          const combined = carry.length > 0 ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
          let searchFrom = 0;
          while (searchFrom <= combined.length - needle.length && matches.length < MAX_SEARCH_MATCHES) {
            const idx = combined.indexOf(needle, searchFrom);
            if (idx === -1) break;
            const absoluteOffset = fileOffset - carry.length + idx;
            matches.push({ offset: absoluteOffset });
            searchFrom = idx + 1;
          }
          carry = overlap > 0 && bytesRead >= needle.length ? combined.subarray(combined.length - overlap) : Buffer.alloc(0);
          fileOffset += bytesRead;
        }
      } finally {
        await fh.close();
      }

      return { matches, truncated: matches.length >= MAX_SEARCH_MATCHES };
    },
  };
}
