import type { Readable } from 'node:stream';

/**
 * A small streaming multipart/form-data reader for uploads to a share.
 * File parts are handed to a sink chunk by chunk (never held in memory as a
 * whole); the total body size is limited while it streams. Only what the
 * share's upload form sends is understood: file parts named by
 * Content-Disposition, other fields are read and ignored (size-limited).
 */

export class MultipartError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface FileSink {
  write(chunk: Buffer): Promise<void>;
  end(): Promise<void>;
}

export interface MultipartOptions {
  maxBytes: number;
  maxFiles?: number;
  /** Called at the start of each file part; returns where its bytes go. */
  onFile: (info: { field: string; filename: string; contentType?: string }) => Promise<FileSink>;
}

export function boundaryOf(contentType: string | undefined): string | undefined {
  if (!contentType || !/^multipart\/form-data\b/i.test(contentType)) return undefined;
  const m = /;\s*boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(contentType);
  return m?.[1] ?? m?.[2];
}

/** Content-Disposition of a part → field name and file name (filename* (RFC 5987) preferred). */
export function parseDisposition(header: string): { field?: string; filename?: string } {
  const field = /\bname="((?:[^"\\]|\\.)*)"/i.exec(header)?.[1] ?? /\bname=([^;\s]+)/i.exec(header)?.[1];
  let filename: string | undefined;
  const star = /\bfilename\*\s*=\s*(?:UTF-8|utf-8)''([^;\s]+)/.exec(header)?.[1];
  if (star) {
    try {
      filename = decodeURIComponent(star);
    } catch {
      filename = undefined;
    }
  }
  if (filename === undefined) {
    const q = /\bfilename="((?:[^"\\]|\\.)*)"/i.exec(header)?.[1];
    if (q !== undefined) filename = q.replace(/\\(.)/g, '$1').replace(/%22/g, '"').replace(/%0D/gi, '\r').replace(/%0A/gi, '\n');
    else filename = /\bfilename=([^;\s]+)/i.exec(header)?.[1];
  }
  return { field: field?.replace(/\\(.)/g, '$1'), filename };
}

const MAX_HEADER_BYTES = 16 * 1024;
const MAX_FIELD_BYTES = 64 * 1024;

/** Read a multipart body. Resolves with the number of file parts; rejects with MultipartError on bad input or limits. */
export async function readMultipart(body: AsyncIterable<Buffer> | Readable, boundary: string, opts: MultipartOptions): Promise<{ files: number; bytes: number }> {
  const delim = Buffer.from(`--${boundary}`);
  const bodyDelim = Buffer.from(`\r\n--${boundary}`);
  let buf = Buffer.alloc(0);
  type State = 'preamble' | 'after' | 'headers' | 'body' | 'done';
  let state = 'preamble' as State;
  const current = (): State => state;
  let total = 0;
  let files = 0;
  let sink: FileSink | undefined;
  let fieldBytes = 0;

  const process = async (final: boolean): Promise<void> => {
    for (;;) {
      if (state === 'preamble') {
        const i = buf.indexOf(delim);
        if (i < 0) {
          if (buf.length > MAX_HEADER_BYTES) throw new MultipartError(400, 'The upload is not valid form data.');
          return;
        }
        buf = buf.subarray(i + delim.length);
        state = 'after';
      }
      if (state === 'after') {
        if (buf.length < 2) return;
        const two = buf.subarray(0, 2).toString('latin1');
        if (two === '--') {
          state = 'done';
          return;
        }
        if (two !== '\r\n') throw new MultipartError(400, 'The upload is not valid form data.');
        buf = buf.subarray(2);
        state = 'headers';
      }
      if (state === 'headers') {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) {
          if (buf.length > MAX_HEADER_BYTES) throw new MultipartError(400, 'A form part has too many headers.');
          return;
        }
        const head = buf.subarray(0, end).toString('utf8');
        buf = buf.subarray(end + 4);
        const disposition = /^content-disposition:(.*)$/im.exec(head)?.[1] ?? '';
        const type = /^content-type:\s*(.*)$/im.exec(head)?.[1]?.trim();
        const { field, filename } = parseDisposition(disposition);
        sink = undefined;
        fieldBytes = 0;
        if (filename !== undefined && filename !== '') {
          if (opts.maxFiles !== undefined && files >= opts.maxFiles) throw new MultipartError(413, `At most ${opts.maxFiles} files can be sent at once.`);
          files++;
          sink = await opts.onFile({ field: field ?? '', filename, contentType: type });
        }
        state = 'body';
      }
      if (state === 'body') {
        const i = buf.indexOf(bodyDelim);
        if (i >= 0) {
          await emit(buf.subarray(0, i));
          if (sink) await sink.end();
          sink = undefined;
          buf = buf.subarray(i + bodyDelim.length);
          state = 'after';
          continue;
        }
        // Keep a tail that could be the start of the delimiter.
        const safe = buf.length - (bodyDelim.length - 1);
        if (safe > 0) {
          await emit(buf.subarray(0, safe));
          buf = buf.subarray(safe);
        }
        if (final) throw new MultipartError(400, 'The upload ended before it was complete.');
        return;
      }
      if (state === 'done') return;
    }
  };

  const emit = async (chunk: Buffer): Promise<void> => {
    if (!chunk.length) return;
    if (sink) await sink.write(Buffer.from(chunk));
    else if ((fieldBytes += chunk.length) > MAX_FIELD_BYTES) throw new MultipartError(413, 'A form field is too large.');
  };

  for await (const raw of body as AsyncIterable<Buffer>) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    total += chunk.length;
    if (total > opts.maxBytes) throw new MultipartError(413, 'The upload is larger than this share allows.');
    if (current() === 'done') continue; // epilogue is ignored
    buf = (buf.length ? Buffer.concat([buf, chunk]) : chunk) as Buffer<ArrayBuffer>;
    await process(false);
  }
  if (current() !== 'done') {
    await process(true);
    if (current() !== 'done') throw new MultipartError(400, 'The upload ended before it was complete.');
  }
  return { files, bytes: total };
}
