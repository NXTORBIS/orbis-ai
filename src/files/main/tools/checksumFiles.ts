import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { OperationRecord } from '../../shared/operations';
import {
  algorithmFromFileName, checkEntryPath, formatChecksumLine, parseChecksumFile, summarizeVerify,
  type ChecksumAlgorithm, type ChecksumLineProblem, type VerifyItem, type VerifySummary,
} from '../../shared/checksumFile';
import type { ExternalRunner, RunContext } from '../ops/OperationManager';
import { exists, hashFile } from '../fs/FileSystemService';
import { isWithin, uniqueName, validateName } from '../fs/paths';
import type { JobGate } from '../jobs/PauseGate';

/**
 * Checksum files: "Create checksum file…" (an operation: it writes a new
 * file) and "Verify checksum file" (a read-only background job).
 */

/** Most files listed in one checksum file. */
export const MAX_CHECKSUM_ENTRIES = 100_000;
/** Largest checksum file read for verification. */
export const MAX_CHECKSUM_FILE_BYTES = 16 * 1024 * 1024;

const PART_PREFIX = '.orbis-part-';

/** The operation's pause control as a job gate, so a large file being hashed pauses between chunks. */
function gateOf(ctx: RunContext): JobGate {
  return {
    get isPaused() {
      return ctx.paused;
    },
    wait: () => ctx.gate().catch(() => undefined),
  };
}

/**
 * Operation runner 'checksum-create'. `destination` is the folder the
 * checksum file is written to; every source must be inside it, and paths in
 * the file are relative to it (GNU coreutils format, "/" separators, sorted).
 * Folders are read recursively; links are not followed (and not listed).
 * The file is written to a temporary sibling and committed without ever
 * replacing an existing file (an existing name asks Keep both or Skip).
 */
export function makeChecksumCreateRunner(markRunning: (rec: OperationRecord) => void): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = (req.params ?? {}) as { name?: unknown };
    const dest = rec.destination!;
    const name = typeof params.name === 'string' && params.name ? params.name : 'SHA256SUMS';
    const v = validateName(name);
    if (!v.valid) throw makeError('invalid_name', 'checksum.create', { message: v.reason, target: name });
    if (algorithmFromFileName(name) && algorithmFromFileName(name) !== 'sha256') {
      throw makeError('validation', 'checksum.create', { message: `"${name}" names a different algorithm; SHA-256 checksum files end in .sha256 or are called SHA256SUMS.` });
    }
    for (const s of rec.sources) {
      if (!isWithin(dest, s)) {
        throw makeError('validation', 'checksum.create', { message: 'Every item must be inside the folder the checksum file is saved in.', target: s });
      }
    }
    let target = path.join(dest, name);
    if (await exists(target)) {
      const action = await helpers.ask({ source: name, destination: target, sourceKind: 'file', destinationKind: 'file', suggestedName: await uniqueName(dest, name, exists), remaining: 0, allowed: ['keep-both', 'skip'] });
      if (action !== 'keep-both') {
        rec.results.push({ source: rec.sources[0]!, destination: target, status: 'skipped' });
        return;
      }
      target = path.join(dest, await uniqueName(dest, name, exists));
    }

    // Collect files (links are never followed).
    const files: Array<{ abs: string; rel: string; size: number }> = [];
    for (const src of rec.sources) {
      const stack = [src];
      while (stack.length) {
        await ctx.gate();
        const p = stack.pop()!;
        let st: fs.Stats;
        try {
          st = await fsp.lstat(p);
        } catch (err) {
          rec.results.push({ source: p, status: 'failed', error: toOrbisError(err, 'checksum.create', p, 'no') });
          continue;
        }
        if (st.isSymbolicLink()) {
          rec.results.push({ source: p, status: 'skipped', error: { category: 'unsupported', operation: 'checksum.create', message: 'Links are not followed or listed.', dataChanged: 'no', retryable: false, target: p } });
        } else if (st.isDirectory()) {
          const children = await fsp.readdir(p).catch((err) => {
            rec.results.push({ source: p, status: 'failed', error: toOrbisError(err, 'checksum.create', p, 'no') });
            return [] as string[];
          });
          for (const c of children) if (!c.startsWith(PART_PREFIX)) stack.push(path.join(p, c));
        } else if (st.isFile()) {
          if (path.resolve(p) === path.resolve(target)) continue;
          files.push({ abs: p, rel: path.relative(dest, p).split(path.sep).join('/'), size: st.size });
          if (files.length > MAX_CHECKSUM_ENTRIES) throw makeError('validation', 'checksum.create', { message: `More than ${MAX_CHECKSUM_ENTRIES.toLocaleString()} files were selected. Create checksum files for smaller groups.` });
        }
      }
    }
    if (!files.length) throw makeError('validation', 'checksum.create', { message: 'There are no files to list (links and empty folders are not listed).' });
    files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    rec.progress = { totalItems: files.length, totalBytes: files.reduce((a, f) => a + f.size, 0), completedItems: 0, completedBytes: 0 };
    markRunning(rec);

    const lines: string[] = [];
    const gate = gateOf(ctx);
    for (const f of files) {
      await ctx.gate();
      try {
        let last = 0;
        const r = await hashFile(f.abs, 'sha256', (done) => {
          helpers.tick(done - last, 0, f.rel);
          last = done;
        }, ctx.signal, gate);
        lines.push(formatChecksumLine(r.digest, f.rel));
        helpers.tick(0, 1, f.rel);
        rec.results.push({ source: f.abs, destination: target, status: 'done' });
      } catch (err) {
        if (ctx.signal.aborted) throw makeError('cancelled', 'checksum.create');
        helpers.tick(0, 1, f.rel);
        rec.results.push({ source: f.abs, status: 'failed', error: toOrbisError(err, 'checksum.create', f.abs, 'no') });
      }
    }
    if (!lines.length) throw makeError('io', 'checksum.create', { message: 'None of the files could be read, so no checksum file was written.' });
    await ctx.gate();
    const tmp = path.join(dest, `${PART_PREFIX}${crypto.randomUUID()}`);
    helpers.temp(tmp);
    try {
      const fh = await fsp.open(tmp, 'wx', 0o644);
      try {
        await fh.writeFile(lines.join('\n') + '\n', 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await fsp.link(tmp, target);
      await fsp.unlink(tmp);
    } catch (err) {
      if ((err as { code?: string }).code === 'EEXIST') throw makeError('already_exists', 'checksum.create', { message: `"${path.basename(target)}" appeared while the checksums were calculated and was not overwritten.`, target });
      throw new OrbisError(toOrbisError(err, 'checksum.create', target, 'no'));
    }
    helpers.committed(tmp);
    const failed = rec.results.filter((r) => r.status === 'failed').length;
    rec.notes = [`${path.basename(target)} lists ${lines.length.toLocaleString()} file${lines.length === 1 ? '' : 's'} (SHA-256).${failed ? ` ${failed} could not be read and ${failed === 1 ? 'is' : 'are'} not listed.` : ''}`];
  };
}

export interface VerifyReport {
  file: string;
  folder: string;
  algorithm?: ChecksumAlgorithm;
  items: VerifyItem[];
  problems: ChecksumLineProblem[];
  summary: VerifySummary;
  complete: boolean;
}

/**
 * Verify a checksum file: every listed file is read and its digest compared.
 * Entries are resolved inside the checksum file's folder only; absolute paths,
 * ".." and links that lead outside the folder are refused and not read.
 */
export async function verifyChecksumFile(
  file: string,
  signal: AbortSignal,
  onProgress?: (p: { checked: number; total: number; current?: string; ok: number; failed: number }) => void,
  gate?: JobGate,
): Promise<VerifyReport> {
  const abs = path.resolve(file);
  const st = await fsp.stat(abs).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'checksum.verify', abs, 'no'));
  });
  if (!st.isFile()) throw makeError('is_a_directory', 'checksum.verify', { target: abs, message: 'Choose a checksum file, not a folder.' });
  if (st.size > MAX_CHECKSUM_FILE_BYTES) throw makeError('validation', 'checksum.verify', { target: abs, message: 'This file is too large to be a checksum file (over 16 MB).' });
  const buf = await fsp.readFile(abs);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw makeError('validation', 'checksum.verify', { target: abs, message: 'This is not a text checksum file (it is not valid UTF-8).' });
  }
  const algorithm = algorithmFromFileName(path.basename(abs));
  const parsed = parseChecksumFile(text, algorithm);
  if (!parsed.entries.length) {
    throw makeError('validation', 'checksum.verify', { target: abs, message: parsed.problems.length ? `No checksums could be read: ${parsed.problems[0]!.reason}` : 'This file lists no checksums.' });
  }
  if (parsed.entries.length > MAX_CHECKSUM_ENTRIES) throw makeError('validation', 'checksum.verify', { target: abs, message: `This file lists more than ${MAX_CHECKSUM_ENTRIES.toLocaleString()} files.` });
  const folder = path.dirname(abs);
  const realFolder = await fsp.realpath(folder);
  const items: VerifyItem[] = [];
  let ok = 0;
  let failed = 0;
  let checked = 0;
  for (const e of parsed.entries) {
    if (gate?.isPaused) await gate.wait();
    if (signal.aborted) break;
    onProgress?.({ checked, total: parsed.entries.length, current: e.path, ok, failed });
    const base = { line: e.line, path: e.path, algorithm: e.algorithm, expected: e.digest };
    const check = checkEntryPath(e.path);
    const push = (item: VerifyItem) => {
      items.push(item);
      if (item.status === 'ok') ok++;
      else failed++;
      checked++;
    };
    if (!check.ok) {
      push({ ...base, status: 'refused', reason: check.reason });
      continue;
    }
    const target = path.join(folder, ...check.segments);
    let real: string;
    try {
      real = await fsp.realpath(target);
    } catch (err) {
      const code = (err as { code?: string }).code;
      push({ ...base, status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable', reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'Not found.' : toOrbisError(err, 'checksum.verify', target).message });
      continue;
    }
    if (!isWithin(realFolder, real)) {
      push({ ...base, status: 'refused', reason: 'This entry leads outside the checksum file’s folder through a link, so it is not read.' });
      continue;
    }
    try {
      const r = await hashFile(real, e.algorithm, () => undefined, signal, gate);
      push({ ...base, status: r.digest === e.digest ? 'ok' : 'mismatch', actual: r.digest, reason: r.digest === e.digest ? undefined : 'The file’s contents differ from when the checksum was made.' });
    } catch (err) {
      if (signal.aborted) break;
      const shape = toOrbisError(err, 'checksum.verify', target);
      push({ ...base, status: 'unreadable', reason: shape.category === 'is_a_directory' ? 'This is a folder, not a file.' : shape.message });
    }
  }
  onProgress?.({ checked, total: parsed.entries.length, ok, failed });
  return { file: abs, folder, algorithm, items, problems: parsed.problems, summary: summarizeVerify(items, parsed.problems.length), complete: !signal.aborted && checked === parsed.entries.length };
}
