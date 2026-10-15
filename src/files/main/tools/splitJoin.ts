import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import {
  DESCRIPTOR_SUFFIX, findSequence, parsePartName, partName, planSplit, SplitDescriptorSchema, SplitParamsSchema,
  type JoinPlan, type SplitDescriptor,
} from '../../shared/powerTools';
import type { ExternalRunner, RunContext, RunnerHelpers } from '../ops/OperationManager';
import { exists } from '../fs/FileSystemService';
import { splitExt, uniqueName, validateName } from '../fs/paths';

/**
 * Split a file into numbered parts (name.ext.001, .002 …) and join such parts
 * again. Everything is streamed (one chunk in memory at a time). Parts and the
 * joined file are written to `.orbis-part-*` temporary files, fsynced and
 * committed with link(), so nothing is ever overwritten; stopping removes all
 * output of the operation, including parts already committed. The optional
 * descriptor `name.ext.orbis-split.json` records the original name, size and
 * the SHA-256 of every part and of the whole file; a join checks against it.
 */

const PART_PREFIX = '.orbis-part-';
const MAX_DESCRIPTOR_BYTES = 4 * 1024 * 1024;

const sha = () => crypto.createHash('sha256');

/** Copy a byte range of an open file into a new file, through the pause gate, updating the given hashes. */
async function streamRange(
  fd: number | null,
  srcPath: string,
  start: number,
  end: number,
  out: string,
  mode: number,
  ctx: RunContext,
  helpers: RunnerHelpers,
  hashes: crypto.Hash[],
  label: string,
  append = false,
): Promise<number> {
  let written = 0;
  const gate = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      ctx.gate().then(() => {
        for (const h of hashes) h.update(chunk);
        written += chunk.length;
        helpers.tick(chunk.length, 0, label);
        cb(null, chunk);
      }, (err) => cb(err));
    },
  });
  const input = fd !== null
    ? fs.createReadStream(srcPath, { fd, start, end, autoClose: false, highWaterMark: 1024 * 1024 })
    : fs.createReadStream(srcPath, { start, end: end >= start ? end : undefined, highWaterMark: 1024 * 1024 });
  try {
    await pipeline(input, gate, fs.createWriteStream(out, { flags: append ? 'a' : 'wx', mode }), { signal: ctx.signal });
  } catch (err) {
    if (ctx.signal.aborted) throw makeError('cancelled', 'split.stream');
    throw err;
  }
  return written;
}

async function fsyncFile(p: string): Promise<void> {
  const fh = await fsp.open(p, 'r+');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Commit a finished temporary file under its final name without replacing anything. */
async function commitNew(tmp: string, target: string, op: string): Promise<void> {
  try {
    await fsp.link(tmp, target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new OrbisError({ category: 'already_exists', operation: op, message: `“${path.basename(target)}” appeared meanwhile and was not replaced.`, target, dataChanged: 'no', retryable: true });
    // No hard links on this drive (FAT, exFAT, some network shares): rename after a last check.
    if (await exists(target)) throw makeError('already_exists', op, { target });
    await fsp.rename(tmp, target);
    return;
  }
  await fsp.unlink(tmp);
}

export function validateSplitRequest(req: OperationRequest): void {
  if (req.sources.length !== 1) throw makeError('validation', 'split.run', { message: 'Split one file at a time.' });
  if (!req.destination) throw makeError('validation', 'split.run', { message: 'Choose a folder for the parts.' });
  const p = SplitParamsSchema.safeParse(req.params);
  if (!p.success) throw makeError('validation', 'split.run', { message: p.error.issues[0]?.message ?? 'The split settings are not valid.' });
}

/** Operation runner 'split-file'. */
export function makeSplitRunner(deps: { markRunning: (rec: OperationRecord) => void; onCreated?: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = SplitParamsSchema.parse(req.params);
    const src = rec.sources[0]!;
    const dest = rec.destination!;
    const st = await fsp.lstat(src).catch((err) => {
      throw new OrbisError(toOrbisError(err, 'split.run', src, 'no'));
    });
    if (st.isSymbolicLink()) throw makeError('unsupported', 'split.run', { target: src, message: 'This is a link. Split the file it points to.' });
    if (!st.isFile()) throw makeError('unsupported', 'split.run', { target: src, message: 'Only files can be split.' });
    const plan = planSplit(st.size, params);
    if ('error' in plan) throw makeError('validation', 'split.run', { target: src, message: plan.error });
    const dst = await fsp.stat(dest).catch(() => undefined);
    if (!dst?.isDirectory()) throw makeError('not_a_directory', 'split.run', { target: dest, message: 'The folder for the parts does not exist.' });

    const original = path.basename(src);
    const outputs = (b: string) => [...Array.from({ length: plan.parts }, (_, i) => partName(b, i + 1, plan.parts)), ...(params.descriptor ? [b + DESCRIPTOR_SUFFIX] : [])];
    let base = original;
    const takenOf = async (b: string) => {
      for (const n of outputs(b)) if (await exists(path.join(dest, n))) return n;
      return undefined;
    };
    const taken = await takenOf(base);
    if (taken) {
      const { stem, ext } = splitExt(original);
      let alt = '';
      for (let n = 2; n < 10000 && !alt; n++) if (!(await takenOf(`${stem} (${n})${ext}`))) alt = `${stem} (${n})${ext}`;
      const action = await helpers.ask({ source: src, destination: path.join(dest, taken), sourceKind: 'file', destinationKind: 'file', suggestedName: `${alt}.001`, remaining: 0, allowed: ['keep-both', 'skip'] });
      if (action !== 'keep-both' || !alt) {
        rec.results.push({ source: src, destination: path.join(dest, taken), status: 'skipped' });
        return;
      }
      base = alt;
    }

    rec.progress = { totalItems: plan.parts, totalBytes: st.size, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const whole = sha();
    const created: string[] = [];
    const parts: SplitDescriptor['parts'] = [];
    const mode = st.mode & 0o666;
    const fh = await fsp.open(src, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await fh.stat();
      if (opened.ino !== st.ino || opened.dev !== st.dev) throw makeError('busy', 'split.run', { target: src, message: 'The file was replaced while it was opened. Nothing was written.' });
      for (let i = 1; i <= plan.parts; i++) {
        await ctx.gate();
        const name = partName(base, i, plan.parts);
        const start = (i - 1) * plan.partBytes;
        const end = Math.min(st.size, start + plan.partBytes) - 1;
        const tmp = path.join(dest, `${PART_PREFIX}${crypto.randomUUID()}`);
        helpers.temp(tmp);
        const h = sha();
        const n = await streamRange(fh.fd, src, start, end, tmp, mode, ctx, helpers, [h, whole], name);
        await fsyncFile(tmp);
        const size = (await fsp.stat(tmp)).size;
        if (n !== end - start + 1 || size !== n) throw makeError('io', 'split.run', { target: src, message: `Part ${i} came out ${size} bytes instead of ${end - start + 1}; the file may have changed while it was read.` });
        const target = path.join(dest, name);
        await commitNew(tmp, target, 'split.run');
        helpers.committed(tmp);
        // Until the whole split is done, a stop removes the parts already made.
        helpers.temp(target);
        created.push(target);
        parts.push({ name, size, sha256: h.digest('hex') });
        helpers.tick(0, 1, name);
      }
    } finally {
      await fh.close();
    }
    const after = await fsp.lstat(src);
    if (after.size !== st.size || after.mtimeMs !== st.mtimeMs) throw makeError('busy', 'split.run', { target: src, message: 'The file changed while it was split. The parts were removed; try again when it is not being written.' });
    const digest = whole.digest('hex');
    if (params.descriptor) {
      await ctx.gate();
      const descriptor: SplitDescriptor = { format: 'orbis-split', version: 1, name: original, size: st.size, sha256: digest, partBytes: plan.partBytes, parts, createdMs: Date.now() };
      const target = path.join(dest, base + DESCRIPTOR_SUFFIX);
      const tmp = path.join(dest, `${PART_PREFIX}${crypto.randomUUID()}`);
      helpers.temp(tmp);
      await fsp.writeFile(tmp, `${JSON.stringify(descriptor, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
      await fsyncFile(tmp);
      await commitNew(tmp, target, 'split.run');
      helpers.committed(tmp);
      helpers.temp(target);
      created.push(target);
    }
    for (const c of created) {
      helpers.committed(c);
      deps.onCreated?.(c);
    }
    rec.results.push({ source: src, destination: created[0], status: 'done' });
    rec.undo = { kind: 'transfer', mode: 'copy', items: created.map((d) => ({ source: src, destination: d })) };
    rec.notes = [`${plan.parts} parts named ${partName(base, 1, plan.parts)} … ${partName(base, plan.parts, plan.parts)}.${params.descriptor ? ` SHA-256 of every part and of the whole file: ${base}${DESCRIPTOR_SUFFIX}.` : ''}`];
  };
}

// ------------------------------------------------------------------ join

/** Read and check a split descriptor (size-limited; any problem is returned as text). */
export async function readDescriptor(p: string): Promise<{ descriptor?: SplitDescriptor; problem?: string }> {
  const st = await fsp.lstat(p).catch(() => undefined);
  if (!st) return {};
  if (!st.isFile()) return { problem: `${path.basename(p)} is not a regular file, so it was not used.` };
  if (st.size > MAX_DESCRIPTOR_BYTES) return { problem: `${path.basename(p)} is too large to be a split descriptor, so it was not used.` };
  try {
    const parsed = SplitDescriptorSchema.safeParse(JSON.parse(await fsp.readFile(p, 'utf8')));
    if (!parsed.success) return { problem: `${path.basename(p)} is not a valid split descriptor (${parsed.error.issues[0]?.message ?? 'unknown format'}), so the join cannot be verified.` };
    if (!validateName(parsed.data.name).valid) return { problem: `${path.basename(p)} names an output that is not a valid file name, so it was not used.` };
    return { descriptor: parsed.data };
  } catch {
    return { problem: `${path.basename(p)} could not be read as JSON, so the join cannot be verified.` };
  }
}

/** The parts of the sequence `picked` belongs to (a part, or its descriptor), what is missing and where the result goes. */
export async function planJoin(picked: string, destination?: string): Promise<JoinPlan> {
  const folder = path.dirname(picked);
  const pickedName = path.basename(picked);
  const names = await fsp.readdir(folder);
  let partPick = pickedName;
  if (pickedName.endsWith(DESCRIPTOR_SUFFIX)) {
    const b = pickedName.slice(0, -DESCRIPTOR_SUFFIX.length);
    partPick = names.filter((n) => parsePartName(n)?.base === b).sort()[0] ?? `${b}.001`;
  }
  const parsed = parsePartName(partPick);
  if (!parsed) throw makeError('validation', 'join.plan', { target: picked, message: 'Choose a numbered part such as “name.ext.001”.' });
  const { descriptor, problem } = await readDescriptor(path.join(folder, parsed.base + DESCRIPTOR_SUFFIX));
  const seq = findSequence(names.includes(partPick) ? names : [...names, partPick], partPick, descriptor?.parts.length)!;
  const present = seq.present.filter((x) => names.includes(x.name));
  const missing = [...seq.missing.map((i) => `${parsed.base}.${String(i).padStart(seq.width, '0')}`), ...(names.includes(partPick) ? [] : [partPick])];
  const parts: JoinPlan['parts'] = [];
  const sizeProblems: string[] = [];
  let totalBytes = 0;
  for (const x of present) {
    const p = path.join(folder, x.name);
    const st = await fsp.lstat(p);
    if (!st.isFile()) throw makeError('unsupported', 'join.plan', { target: p, message: `${x.name} is ${st.isSymbolicLink() ? 'a link' : 'not a regular file'}; parts must be regular files.` });
    const pos = x.index - seq.first;
    const exp = descriptor?.parts[pos];
    if (exp && exp.size !== st.size) sizeProblems.push(`${x.name} has ${st.size.toLocaleString('en')} bytes; the descriptor says ${exp.size.toLocaleString('en')}.`);
    parts.push({ name: x.name, path: p, size: st.size, expectedSize: exp?.size, expectedSha256: exp?.sha256 });
    totalBytes += st.size;
  }
  let descriptorProblem = problem;
  if (descriptor && present.length > descriptor.parts.length) descriptorProblem = `There are ${present.length} parts but the descriptor lists ${descriptor.parts.length}.`;
  if (descriptor && !descriptorProblem && totalBytes !== descriptor.size && !missing.length) sizeProblems.push(`The parts add up to ${totalBytes.toLocaleString('en')} bytes; the original had ${descriptor.size.toLocaleString('en')}.`);
  const outDir = destination ?? folder;
  const wanted = descriptor && !descriptorProblem ? descriptor.name : parsed.base;
  const outputTaken = await exists(path.join(outDir, wanted));
  const output = outputTaken ? await uniqueName(outDir, wanted, exists) : wanted;
  return {
    folder, base: parsed.base, parts, missing, totalBytes, output, outputTaken,
    descriptor: descriptor && !descriptorProblem ? { name: parsed.base + DESCRIPTOR_SUFFIX, originalName: descriptor.name, size: descriptor.size, sha256: descriptor.sha256, parts: descriptor.parts.length } : undefined,
    descriptorProblem, sizeProblems,
  };
}

export const JoinParamsSchema = z.object({
  output: z.string().min(1).max(1024),
  keepOnMismatch: z.boolean(),
  expected: z.object({
    descriptor: z.string().min(1).max(1024),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    parts: z.array(z.object({ size: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
  }).optional(),
});

export function validateJoinRequest(req: OperationRequest): void {
  if (req.sources.length < 1) throw makeError('validation', 'join.run', { message: 'There are no parts to join.' });
  if (!req.destination) throw makeError('validation', 'join.run', { message: 'Choose a folder for the joined file.' });
  const p = JoinParamsSchema.safeParse(req.params);
  if (!p.success) throw makeError('validation', 'join.run', { message: p.error.issues[0]?.message ?? 'The join settings are not valid.' });
  if (!validateName(p.data.output).valid) throw makeError('invalid_name', 'join.run', { message: validateName(p.data.output).reason });
  if (p.data.expected && p.data.expected.parts.length !== req.sources.length) throw makeError('validation', 'join.run', { message: 'The descriptor lists a different number of parts.' });
}

/** The 'join-files' request for a plan (checked again by the runner). */
export function joinRequest(plan: JoinPlan, destination: string, keepOnMismatch: boolean): OperationRequest {
  if (plan.missing.length) throw makeError('not_found', 'join.start', { message: `Missing part${plan.missing.length === 1 ? '' : 's'}: ${plan.missing.slice(0, 10).join(', ')}${plan.missing.length > 10 ? ` and ${plan.missing.length - 10} more` : ''}. Nothing was joined.` });
  if (!plan.parts.length) throw makeError('not_found', 'join.start', { message: 'No parts were found.' });
  const expected = plan.descriptor && plan.parts.every((p) => p.expectedSha256 !== undefined)
    ? { descriptor: plan.descriptor.name, size: plan.descriptor.size, sha256: plan.descriptor.sha256, parts: plan.parts.map((p) => ({ size: p.expectedSize!, sha256: p.expectedSha256! })) }
    : undefined;
  return { type: 'join-files', sources: plan.parts.map((p) => p.path), destination, conflictPolicy: 'ask', origin: 'join-files', params: { output: plan.output, keepOnMismatch, expected } };
}

/** Operation runner 'join-files': sources are the parts in order. */
export function makeJoinRunner(deps: { markRunning: (rec: OperationRecord) => void; onCreated?: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = JoinParamsSchema.parse(req.params);
    const dest = rec.destination!;
    const sizes: number[] = [];
    let mode = 0o644;
    for (const p of rec.sources) {
      const st = await fsp.lstat(p).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'join.run', p, 'no'));
      });
      if (!st.isFile()) throw makeError('unsupported', 'join.run', { target: p, message: `${path.basename(p)} is not a regular file.` });
      sizes.push(st.size);
      if (p === rec.sources[0]) mode = st.mode & 0o666;
    }
    let target = path.join(dest, params.output);
    if (await exists(target)) {
      const ds = await fsp.lstat(target);
      const action = await helpers.ask({ source: rec.sources[0]!, destination: target, sourceKind: 'file', destinationKind: ds.isDirectory() ? 'directory' : 'file', destinationSize: ds.size, destinationModifiedMs: ds.mtimeMs, suggestedName: await uniqueName(dest, params.output, exists), remaining: 0, allowed: ['keep-both', 'skip'] });
      if (action !== 'keep-both') {
        rec.results.push({ source: rec.sources[0]!, destination: target, status: 'skipped' });
        return;
      }
      target = path.join(dest, await uniqueName(dest, params.output, exists));
    }
    const total = sizes.reduce((a, b) => a + b, 0);
    rec.progress = { totalItems: rec.sources.length, totalBytes: total, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const tmp = path.join(dest, `${PART_PREFIX}${crypto.randomUUID()}`);
    helpers.temp(tmp);
    await fsp.writeFile(tmp, '', { flag: 'wx', mode });
    const whole = sha();
    const partProblems: string[] = [];
    for (let i = 0; i < rec.sources.length; i++) {
      await ctx.gate();
      const p = rec.sources[i]!;
      const h = sha();
      const st = await fsp.lstat(p);
      if (!st.isFile() || st.size !== sizes[i]) throw makeError('busy', 'join.run', { target: p, message: `${path.basename(p)} changed while the parts were joined. Nothing was kept.` });
      const n = await streamRange(null, p, 0, st.size - 1, tmp, mode, ctx, helpers, [h, whole], path.basename(p), true);
      if (n !== st.size) throw makeError('io', 'join.run', { target: p, message: `${path.basename(p)} could not be read completely.` });
      const exp = params.expected?.parts[i];
      if (exp && (exp.size !== st.size || exp.sha256 !== h.digest('hex'))) partProblems.push(path.basename(p));
      helpers.tick(0, 1, path.basename(p));
    }
    await fsyncFile(tmp);
    const written = (await fsp.stat(tmp)).size;
    if (written !== total) throw makeError('io', 'join.run', { message: `The joined file has ${written} bytes instead of ${total}. Nothing was kept.` });
    const digest = whole.digest('hex');
    let mismatch: string | undefined;
    if (params.expected && (digest !== params.expected.sha256 || written !== params.expected.size || partProblems.length)) {
      mismatch = `The joined file does not match ${params.expected.descriptor}: ${partProblems.length ? `part${partProblems.length === 1 ? '' : 's'} ${partProblems.slice(0, 5).join(', ')}${partProblems.length > 5 ? '…' : ''} differ` : 'SHA-256 differs'} (expected ${params.expected.sha256.slice(0, 16)}…, got ${digest.slice(0, 16)}…).`;
      if (!params.keepOnMismatch) throw makeError('io', 'join.run', { target: rec.sources[0], dataChanged: 'no', message: `${mismatch} The joined file was removed. To keep it anyway, join again with “Keep the joined file even if the check fails”.` });
    }
    await commitNew(tmp, target, 'join.run');
    helpers.committed(tmp);
    deps.onCreated?.(target);
    rec.results.push({ source: rec.sources[0]!, destination: target, status: 'done' });
    if (mismatch) {
      rec.results.push({ source: path.join(path.dirname(rec.sources[0]!), params.expected!.descriptor), destination: target, status: 'failed', error: { category: 'io', operation: 'join.verify', message: `${mismatch} The joined file was kept because you asked for it.`, target, dataChanged: 'yes', retryable: false } });
    }
    rec.notes = [mismatch ? `Verification FAILED; ${path.basename(target)} was kept as requested.` : params.expected ? `Verified: the SHA-256 of ${path.basename(target)} matches ${params.expected.descriptor}.` : `Not verified: there is no ${DESCRIPTOR_SUFFIX} descriptor with checksums for these parts.`];
    rec.undo = { kind: 'transfer', mode: 'copy', items: [{ source: rec.sources[0]!, destination: target }] };
  };
}
