import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import { LinkParamsSchema } from '../../shared/powerTools';
import type { ExternalRunner } from '../ops/OperationManager';
import { exists } from '../fs/FileSystemService';
import { childPath, uniqueName } from '../fs/paths';

/**
 * "Create hard link…" (any platform; same drive only) and, on Windows,
 * "Create junction…" for folders (fs.symlink type 'junction'; untested,
 * as no Windows machine was available). Symbolic links stay the instant
 * "Create link" command. Nothing is replaced: a taken name asks Keep both
 * or Skip. Undo moves the new links to the Trash (the original files stay).
 */

/** A plain-language reason for a failed link(). */
export function hardLinkError(err: unknown, target: string, link: string): OrbisError {
  const code = (err as NodeJS.ErrnoException).code ?? '';
  const base = toOrbisError(err, 'link.hard', link, 'no');
  const msg: Record<string, string> = {
    EXDEV: `Hard links only work within one drive (file system): “${path.basename(target)}” is on a different one than ${path.dirname(link)}. Use a symbolic link (Create link) instead.`,
    EPERM: 'This drive or file system does not allow hard links here (FAT32 and exFAT have none; some network shares and protected files refuse them).',
    ENOTSUP: 'This drive’s file system does not support hard links.',
    ENOSYS: 'This drive’s file system does not support hard links.',
    EMLINK: `“${path.basename(target)}” already has the most hard links its file system allows.`,
    EEXIST: `“${path.basename(link)}” already exists and was not replaced.`,
    EACCES: 'You do not have permission to create a link in this folder.',
  };
  return new OrbisError({ ...base, message: msg[code] ?? base.message });
}

export function validateLinkRequest(req: OperationRequest): void {
  const p = LinkParamsSchema.safeParse(req.params);
  if (!p.success) throw makeError('validation', 'link.run', { message: p.error.issues[0]?.message ?? 'The links to create are not valid.' });
  if (!req.destination) throw makeError('validation', 'link.run', { message: 'Choose a folder for the links.' });
  if (p.data.kind === 'junction' && process.platform !== 'win32') throw makeError('unsupported', 'link.run', { message: 'Junctions exist only on Windows. Use a symbolic link (Create link) instead.' });
  for (const it of p.data.items) if (!path.isAbsolute(it.target)) throw makeError('invalid_path', 'link.run', { message: 'Expected absolute paths.' });
}

/** Operation runner 'link-create'. */
export function makeLinkRunner(deps: { markRunning: (rec: OperationRecord) => void; onCreated?: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const { kind, items } = LinkParamsSchema.parse(req.params);
    const dest = rec.destination!;
    const dst = await fsp.stat(dest).catch(() => undefined);
    if (!dst?.isDirectory()) throw makeError('not_a_directory', 'link.run', { target: dest, message: 'The folder for the links does not exist.' });
    rec.progress = { totalItems: items.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const made: Array<{ source: string; destination: string }> = [];
    try {
      for (const it of items) {
        await ctx.gate();
        let link = childPath(dest, it.name, 'link.run');
        try {
          const st = await fsp.lstat(it.target);
          if (kind === 'hard' && !st.isFile()) throw makeError('unsupported', 'link.hard', { target: it.target, dataChanged: 'no', message: st.isDirectory() ? 'Folders cannot have hard links. Use a symbolic link (Create link) or, on Windows, a junction.' : st.isSymbolicLink() ? 'This is a symbolic link; make the hard link to the file it points to.' : 'Only regular files can have hard links.' });
          if (kind === 'junction' && !st.isDirectory()) throw makeError('unsupported', 'link.junction', { target: it.target, dataChanged: 'no', message: 'Junctions point to folders only.' });
          if (await exists(link)) {
            const action = await helpers.ask({ source: it.target, destination: link, sourceKind: kind === 'hard' ? 'file' : 'directory', destinationKind: 'file', suggestedName: await uniqueName(dest, it.name, exists), remaining: items.length - made.length, allowed: ['keep-both', 'skip'] });
            if (action !== 'keep-both') {
              rec.results.push({ source: it.target, destination: link, status: 'skipped' });
              helpers.tick(0, 1, it.name);
              continue;
            }
            link = path.join(dest, await uniqueName(dest, it.name, exists));
          }
          if (kind === 'hard') await fsp.link(it.target, link).catch((err) => {
            throw hardLinkError(err, it.target, link);
          });
          else await fsp.symlink(it.target, link, 'junction').catch((err) => {
            throw new OrbisError(toOrbisError(err, 'link.junction', link, 'no'));
          });
          made.push({ source: it.target, destination: link });
          deps.onCreated?.(link);
          rec.results.push({ source: it.target, destination: link, status: 'done' });
        } catch (err) {
          const shape = toOrbisError(err, 'link.run', it.target, 'no');
          if (shape.category === 'cancelled') throw err;
          rec.results.push({ source: it.target, destination: link, status: 'failed', error: shape });
        }
        helpers.tick(0, 1, it.name);
      }
    } finally {
      rec.undo = made.length ? { kind: 'transfer', mode: 'copy', items: made } : { kind: 'none', reason: 'No link was created.' };
    }
  };
}
