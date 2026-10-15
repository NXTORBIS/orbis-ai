// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
/**
 * Archive editing: add, delete, rename and move entries inside an archive,
 * and convert archives between formats. The approach is extract-to-scratch,
 * apply changes, re-compress, then atomically replace the original. The
 * original is never modified until the new archive is successfully written.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import yauzl from 'yauzl';
import yazl from 'yazl';
import * as tar from 'tar';
import { pipeline } from 'node:stream/promises';
import { makeError } from '../../shared/errors';
import { isWithin, validateName } from '../fs/paths';
import { exists } from '../fs/FileSystemService';
import { scratchRoot, detectFormat, entryPathProblem, type ArchiveFormat } from './archives';
import { extract7z, create7z, sevenZipAvailable } from './sevenZip';
import type { ArchiveEditResult, ArchiveConvertResult, ConvertFormat, EditableFormat } from '../../shared/archiveEdit';
import { isEditableFormat } from '../../shared/archiveEdit';

/** Create a private scratch directory for editing operations. */
async function editScratch(prefix: string): Promise<string> {
  await fsp.mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  const dir = path.join(scratchRoot, `${prefix}-${crypto.randomUUID()}`);
  await fsp.mkdir(dir, { mode: 0o700 });
  return dir;
}

/** Extract all entries from a ZIP archive into a directory, preserving structure. */
async function extractZipToDir(archivePath: string, outDir: string): Promise<void> {
  const zf: yauzl.ZipFile = await new Promise((resolve, reject) =>
    yauzl.open(archivePath, { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, z) => (err || !z ? reject(err) : resolve(z))),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      zf.on('entry', (e: yauzl.Entry) => {
        const name = e.fileName;
        const target = path.resolve(outDir, ...name.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.'));
        if (!isWithin(outDir, target)) {
          zf.readEntry();
          return;
        }
        if (name.endsWith('/')) {
          fsp.mkdir(target, { recursive: true }).then(() => zf.readEntry(), reject);
          return;
        }
        fsp.mkdir(path.dirname(target), { recursive: true })
          .then(() => new Promise<void>((res, rej) => {
            zf.openReadStream(e, (err2, stream) => {
              if (err2 || !stream) return rej(err2 ?? new Error('No stream'));
              const ws = fs.createWriteStream(target);
              pipeline(stream, ws).then(
                () => {
                  const mtime = e.getLastModDate();
                  fsp.utimes(target, mtime, mtime).then(() => res(), () => res());
                },
                rej,
              );
            });
          }))
          .then(() => zf.readEntry())
          .catch(reject);
      });
      zf.on('end', resolve);
      zf.on('error', reject);
      zf.readEntry();
    });
  } finally {
    zf.close();
  }
}

/** Re-compress a directory into a ZIP archive. */
async function repackZip(srcDir: string, outFile: string): Promise<void> {
  const zip = new yazl.ZipFile();
  const out = fs.createWriteStream(outFile, { flags: 'wx' });
  const done = pipeline(zip.outputStream, out);
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const children = await fsp.readdir(full);
        if (children.length === 0) zip.addEmptyDirectory(rel + '/');
        else await walk(full, rel);
      } else if (e.isFile()) {
        const st = await fsp.stat(full);
        zip.addReadStream(fs.createReadStream(full), rel, { mtime: st.mtime, size: st.size });
      }
    }
  };
  await walk(srcDir, '');
  zip.end();
  await done;
}

/** Re-compress a directory into a TAR or TAR.GZ archive. */
async function repackTar(srcDir: string, outFile: string, gzip: boolean): Promise<void> {
  const entries = await fsp.readdir(srcDir);
  await tar.c(
    {
      file: outFile,
      cwd: srcDir,
      gzip: gzip ? { level: 6 } : undefined,
      portable: true,
      follow: false,
    } as unknown as tar.TarOptionsWithAliasesFile,
    entries,
  );
}

/** Re-compress a directory into a 7z archive. */
async function repack7z(srcDir: string, outFile: string, password?: string): Promise<void> {
  if (!sevenZipAvailable()) throw makeError('unavailable', 'archive.edit', { message: 'The 7-Zip component is not available.' });
  const files: Array<{ abs: string; rel: string; dir: boolean; empty?: boolean }> = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const children = await fsp.readdir(full);
        files.push({ abs: full, rel, dir: true, empty: children.length === 0 });
        await walk(full, rel);
      } else if (e.isFile()) {
        files.push({ abs: full, rel, dir: false });
      }
    }
  };
  await walk(srcDir, '');
  const rels = files.filter((f) => !f.dir || f.empty).map((f) => f.rel);
  if (rels.length === 0) {
    // Create an empty archive
    await fsp.writeFile(outFile, Buffer.alloc(0));
    return;
  }
  await create7z(outFile, srcDir, rels, 5, { password });
}

/** Full extract of an archive to a scratch directory. */
export async function fullExtract(archivePath: string, outDir: string, format: ArchiveFormat, password?: string): Promise<void> {
  if (format === 'zip') {
    await extractZipToDir(archivePath, outDir);
  } else if (format === 'tar' || format === 'tar.gz') {
    await tar.x({ file: archivePath, cwd: outDir } as tar.TarOptionsWithAliasesFile);
  } else if (format === '7z') {
    if (!sevenZipAvailable()) throw makeError('unavailable', 'archive.edit', { message: 'The 7-Zip component is not available.' });
    const r = await extract7z(archivePath, outDir, { password });
    if (r.code !== 0 && r.code !== 1) {
      throw makeError('io', 'archive.edit', { message: `Could not extract the archive: ${r.errors[0] ?? 'unknown error'}` });
    }
  } else {
    throw makeError('unsupported', 'archive.edit', { message: `Editing ${format.toUpperCase()} archives is not supported.` });
  }
}

/** Repack a scratch directory into an archive, matching the format. */
async function repack(srcDir: string, outFile: string, format: EditableFormat, password?: string): Promise<void> {
  if (format === 'zip') await repackZip(srcDir, outFile);
  else if (format === 'tar') await repackTar(srcDir, outFile, false);
  else if (format === 'tar.gz') await repackTar(srcDir, outFile, true);
  else if (format === '7z') await repack7z(srcDir, outFile, password);
}

/** Atomically replace the archive with the new version. */
async function atomicReplace(tmpFile: string, target: string): Promise<void> {
  // Keep a backup in case the rename fails
  const backup = `${target}.orbis-backup-${crypto.randomUUID()}`;
  try {
    await fsp.rename(target, backup);
  } catch {
    // Original may not exist (unlikely)
  }
  try {
    await fsp.rename(tmpFile, target);
    await fsp.unlink(backup).catch(() => undefined);
  } catch (err) {
    // Restore the backup
    await fsp.rename(backup, target).catch(() => undefined);
    throw err;
  }
}

/**
 * Copy a file tree, omitting specific entries. An "entry" is a path relative
 * to the root, using forward slashes (matching archive entry names).
 */
async function copyTreeExcluding(src: string, dst: string, exclude: Set<string>, prefix = ''): Promise<number> {
  let removed = 0;
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    const srcPath = path.join(src, e.name);
    const dstPath = path.join(dst, e.name);
    // Check if this entry or any of its prefixes should be excluded
    if (exclude.has(rel) || exclude.has(rel + '/')) {
      removed++;
      continue;
    }
    if (e.isDirectory()) {
      await fsp.mkdir(dstPath, { recursive: true });
      removed += await copyTreeExcluding(srcPath, dstPath, exclude, rel);
    } else if (e.isFile()) {
      await fsp.copyFile(srcPath, dstPath);
      const st = await fsp.stat(srcPath);
      await fsp.utimes(dstPath, st.atime, st.mtime).catch(() => undefined);
    }
  }
  return removed;
}

/**
 * Copy a file tree, applying renames. Returns the number of entries renamed.
 */
async function _copyTreeRenaming(src: string, dst: string, renameMap: Map<string, string>, prefix = ''): Promise<number> {
  let renamed = 0;
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    const srcPath = path.join(src, e.name);
    // Check if this entry should be renamed
    const newRel = renameMap.get(rel) ?? renameMap.get(rel + '/');
    const targetRel = newRel ?? rel;
    if (newRel !== undefined) renamed++;
    const dstPath = path.join(dst, ...targetRel.replace(/\/$/, '').split('/'));
    if (e.isDirectory()) {
      await fsp.mkdir(dstPath, { recursive: true });
      // Also need to rename children whose paths start with the old prefix
      renamed += await _copyTreeRenaming(srcPath, dstPath, renameMap, rel);
    } else if (e.isFile()) {
      await fsp.mkdir(path.dirname(dstPath), { recursive: true });
      await fsp.copyFile(srcPath, dstPath);
      const st = await fsp.stat(srcPath);
      await fsp.utimes(dstPath, st.atime, st.mtime).catch(() => undefined);
    }
  }
  return renamed;
}

// ----- Public API -----

/**
 * Add files to an existing archive. The files are copied into the archive at
 * the specified inner directory.
 */
export async function archiveAddEntries(
  archivePath: string,
  filePaths: string[],
  innerDir: string,
  password?: string,
): Promise<ArchiveEditResult> {
  const format = await detectFormat(archivePath);
  if (!isEditableFormat(format)) {
    throw makeError('unsupported', 'archive.addEntries', { message: `Cannot edit ${format.toUpperCase()} archives. Convert to ZIP, TAR.GZ or 7z first.` });
  }
  const warnings: string[] = [];
  const scratch = await editScratch('add');
  const extractDir = path.join(scratch, 'content');
  const tmpArchive = path.join(scratch, `out${path.extname(archivePath)}`);
  await fsp.mkdir(extractDir, { mode: 0o700 });
  try {
    await fullExtract(archivePath, extractDir, format, password);
    // Copy the new files into the appropriate inner directory
    const targetDir = innerDir ? path.join(extractDir, ...innerDir.split('/').filter(Boolean)) : extractDir;
    await fsp.mkdir(targetDir, { recursive: true });
    let added = 0;
    for (const fp of filePaths) {
      const name = path.basename(fp);
      const v = validateName(name);
      if (!v.valid) {
        warnings.push(`Skipped "${name}": ${v.reason}`);
        continue;
      }
      const dest = path.join(targetDir, name);
      const st = await fsp.stat(fp);
      if (st.isDirectory()) {
        await copyDirRecursive(fp, dest);
      } else {
        await fsp.copyFile(fp, dest);
        await fsp.utimes(dest, st.atime, st.mtime).catch(() => undefined);
      }
      added++;
    }
    if (added === 0) return { modified: false, affected: 0, warnings };
    await repack(extractDir, tmpArchive, format, password);
    await atomicReplace(tmpArchive, archivePath);
    return { modified: true, affected: added, warnings };
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await fsp.mkdir(dst, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDirRecursive(s, d);
    else if (e.isFile()) {
      await fsp.copyFile(s, d);
      const st = await fsp.stat(s);
      await fsp.utimes(d, st.atime, st.mtime).catch(() => undefined);
    }
  }
}

/**
 * Delete entries from an existing archive.
 */
export async function archiveDeleteEntries(
  archivePath: string,
  entries: string[],
  password?: string,
): Promise<ArchiveEditResult> {
  const format = await detectFormat(archivePath);
  if (!isEditableFormat(format)) {
    throw makeError('unsupported', 'archive.deleteEntries', { message: `Cannot edit ${format.toUpperCase()} archives.` });
  }
  if (!entries.length) return { modified: false, affected: 0, warnings: [] };
  const scratch = await editScratch('del');
  const extractDir = path.join(scratch, 'content');
  const filteredDir = path.join(scratch, 'filtered');
  const tmpArchive = path.join(scratch, `out${path.extname(archivePath)}`);
  await fsp.mkdir(extractDir, { mode: 0o700 });
  await fsp.mkdir(filteredDir, { mode: 0o700 });
  try {
    await fullExtract(archivePath, extractDir, format, password);
    const exclude = new Set<string>();
    for (const e of entries) {
      exclude.add(e);
      exclude.add(e.replace(/\/$/, '')); // handle both with and without trailing slash
    }
    const removed = await copyTreeExcluding(extractDir, filteredDir, exclude);
    if (removed === 0) return { modified: false, affected: 0, warnings: ['No matching entries found.'] };
    // Check if we have anything left
    const remaining = await fsp.readdir(filteredDir);
    if (remaining.length === 0) {
      throw makeError('validation', 'archive.deleteEntries', { message: 'Cannot delete all entries from the archive.' });
    }
    await repack(filteredDir, tmpArchive, format, password);
    await atomicReplace(tmpArchive, archivePath);
    return { modified: true, affected: removed, warnings: [] };
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Rename one entry inside an archive. For directories, all children are
 * moved along.
 */
export async function archiveRenameEntry(
  archivePath: string,
  oldName: string,
  newName: string,
  password?: string,
): Promise<ArchiveEditResult> {
  const format = await detectFormat(archivePath);
  if (!isEditableFormat(format)) {
    throw makeError('unsupported', 'archive.renameEntry', { message: `Cannot edit ${format.toUpperCase()} archives.` });
  }
  // Validate the new name
  const segments = newName.split('/').filter(Boolean);
  for (const seg of segments) {
    const v = validateName(seg);
    if (!v.valid) throw makeError('invalid_name', 'archive.renameEntry', { message: v.reason });
  }
  const problem = entryPathProblem(newName);
  if (problem) throw makeError('validation', 'archive.renameEntry', { message: problem });

  const scratch = await editScratch('ren');
  const extractDir = path.join(scratch, 'content');
  const tmpArchive = path.join(scratch, `out${path.extname(archivePath)}`);
  await fsp.mkdir(extractDir, { mode: 0o700 });
  try {
    await fullExtract(archivePath, extractDir, format, password);
    // Resolve the old name to a path in the extracted tree
    const oldParts = oldName.replace(/\/$/, '').split('/').filter(Boolean);
    const newParts = newName.replace(/\/$/, '').split('/').filter(Boolean);
    const oldPath = path.join(extractDir, ...oldParts);
    const newPath = path.join(extractDir, ...newParts);
    if (!await exists(oldPath)) {
      return { modified: false, affected: 0, warnings: [`Entry "${oldName}" not found in the archive.`] };
    }
    if (await exists(newPath)) {
      throw makeError('already_exists', 'archive.renameEntry', { message: `An entry named "${newName}" already exists in the archive.` });
    }
    await fsp.mkdir(path.dirname(newPath), { recursive: true });
    await fsp.rename(oldPath, newPath);
    // Clean up empty parent directories
    let parent = path.dirname(oldPath);
    while (parent !== extractDir && isWithin(extractDir, parent)) {
      const children = await fsp.readdir(parent);
      if (children.length === 0) {
        await fsp.rmdir(parent);
        parent = path.dirname(parent);
      } else break;
    }
    await repack(extractDir, tmpArchive, format, password);
    await atomicReplace(tmpArchive, archivePath);
    return { modified: true, affected: 1, warnings: [] };
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Create a new empty folder inside an archive.
 */
export async function archiveMkdir(
  archivePath: string,
  parentDir: string,
  folderName: string,
  password?: string,
): Promise<ArchiveEditResult> {
  const format = await detectFormat(archivePath);
  if (!isEditableFormat(format)) {
    throw makeError('unsupported', 'archive.mkdir', { message: `Cannot edit ${format.toUpperCase()} archives.` });
  }
  const v = validateName(folderName);
  if (!v.valid) throw makeError('invalid_name', 'archive.mkdir', { message: v.reason });

  const scratch = await editScratch('mkdir');
  const extractDir = path.join(scratch, 'content');
  const tmpArchive = path.join(scratch, `out${path.extname(archivePath)}`);
  await fsp.mkdir(extractDir, { mode: 0o700 });
  try {
    await fullExtract(archivePath, extractDir, format, password);
    const targetParent = parentDir ? path.join(extractDir, ...parentDir.split('/').filter(Boolean)) : extractDir;
    const target = path.join(targetParent, folderName);
    if (!isWithin(extractDir, target)) {
      throw makeError('validation', 'archive.mkdir', { message: 'The folder name would place the entry outside the archive.' });
    }
    if (await exists(target)) {
      throw makeError('already_exists', 'archive.mkdir', { message: `A folder or file named "${folderName}" already exists here.` });
    }
    await fsp.mkdir(target, { recursive: true });
    // Both tar and zip natively preserve empty directories, so no placeholder needed.
    await repack(extractDir, tmpArchive, format, password);
    await atomicReplace(tmpArchive, archivePath);
    return { modified: true, affected: 1, warnings: [] };
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Move (restructure) entries within an archive by applying a set of renames
 * from old paths to new paths.
 */
export async function archiveMoveEntries(
  archivePath: string,
  moves: Array<{ from: string; to: string }>,
  password?: string,
): Promise<ArchiveEditResult> {
  const format = await detectFormat(archivePath);
  if (!isEditableFormat(format)) {
    throw makeError('unsupported', 'archive.moveEntries', { message: `Cannot edit ${format.toUpperCase()} archives.` });
  }
  if (!moves.length) return { modified: false, affected: 0, warnings: [] };

  const scratch = await editScratch('move');
  const extractDir = path.join(scratch, 'content');
  const tmpArchive = path.join(scratch, `out${path.extname(archivePath)}`);
  await fsp.mkdir(extractDir, { mode: 0o700 });
  try {
    await fullExtract(archivePath, extractDir, format, password);
    let moved = 0;
    for (const m of moves) {
      const fromParts = m.from.replace(/\/$/, '').split('/').filter(Boolean);
      const toParts = m.to.replace(/\/$/, '').split('/').filter(Boolean);
      const fromPath = path.join(extractDir, ...fromParts);
      const toPath = path.join(extractDir, ...toParts);
      if (!isWithin(extractDir, fromPath) || !isWithin(extractDir, toPath)) continue;
      if (!await exists(fromPath)) continue;
      if (await exists(toPath)) continue;
      await fsp.mkdir(path.dirname(toPath), { recursive: true });
      await fsp.rename(fromPath, toPath);
      moved++;
    }
    if (moved === 0) return { modified: false, affected: 0, warnings: ['No entries were moved.'] };
    await repack(extractDir, tmpArchive, format, password);
    await atomicReplace(tmpArchive, archivePath);
    return { modified: true, affected: moved, warnings: [] };
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Extension for a convert target format. */
function convertExt(format: ConvertFormat): string {
  switch (format) {
    case 'zip': return '.zip';
    case '7z': return '.7z';
    case 'tar.gz': return '.tar.gz';
    case 'tar.bz2': return '.tar.bz2';
    case 'tar.xz': return '.tar.xz';
  }
}

/** Strip all archive-like extensions from a filename. */
function stripArchiveExt(name: string): string {
  return name.replace(/\.(tar\.(gz|xz|bz2|zst)|zip|tar|tgz|txz|tbz2?|tzst|gz|7z|rar|xz|bz2|zst)$/i, '') || name;
}

/**
 * Convert an archive from one format to another. The archive is extracted to
 * a scratch directory and repacked in the target format. The original is not
 * modified; the new archive is created next to it (or in `destination`).
 */
export async function archiveConvert(
  archivePath: string,
  targetFormat: ConvertFormat,
  destination?: string,
  password?: string,
): Promise<ArchiveConvertResult> {
  const srcFormat = await detectFormat(archivePath);
  if (srcFormat === 'unknown') {
    throw makeError('unsupported', 'archive.convert', { message: 'This file is not a recognised archive.' });
  }

  // For bzip2 and xz targets, we need 7-Zip
  if ((targetFormat === 'tar.bz2' || targetFormat === 'tar.xz') && !sevenZipAvailable()) {
    throw makeError('unavailable', 'archive.convert', { message: `Converting to ${targetFormat.toUpperCase()} requires the 7-Zip component, which is not available.` });
  }

  const scratch = await editScratch('convert');
  const extractDir = path.join(scratch, 'content');
  await fsp.mkdir(extractDir, { mode: 0o700 });
  try {
    // Extract
    await fullExtract(archivePath, extractDir, srcFormat, password);

    // Build output filename
    const baseName = stripArchiveExt(path.basename(archivePath));
    const ext = convertExt(targetFormat);
    const outName = `${baseName}${ext}`;
    const outDir = destination ?? path.dirname(archivePath);
    let outPath = path.join(outDir, outName);

    // Avoid overwriting the original or an existing file
    if (await exists(outPath)) {
      const suffix = `-${Date.now().toString(36)}`;
      outPath = path.join(outDir, `${baseName}${suffix}${ext}`);
    }

    // Repack in target format
    const tmpOut = path.join(scratch, `out${ext}`);
    if (targetFormat === 'zip') {
      await repackZip(extractDir, tmpOut);
    } else if (targetFormat === '7z') {
      await repack7z(extractDir, tmpOut);
    } else if (targetFormat === 'tar.gz') {
      await repackTar(extractDir, tmpOut, true);
    } else if (targetFormat === 'tar.bz2' || targetFormat === 'tar.xz') {
      // Create a tar first, then compress with 7-Zip
      const tmpTar = path.join(scratch, 'archive.tar');
      await repackTar(extractDir, tmpTar, false);
      // Create .tar.bz2 or .tar.xz by using 7z to compress the .tar file
      const compType = targetFormat === 'tar.bz2' ? 'bzip2' : 'xz';
      const compExt = targetFormat === 'tar.bz2' ? '.bz2' : '.xz';
      const compressedTar = tmpTar + compExt;
      await create7z(compressedTar, path.dirname(tmpTar), [path.basename(tmpTar)], 5, { type: compType });
      await fsp.rename(compressedTar, tmpOut).catch(() => undefined);
      if (!await exists(tmpOut)) {
        // Fallback: just copy the tar
        await fsp.copyFile(tmpTar, tmpOut);
      }
    }

    await fsp.mkdir(outDir, { recursive: true });
    await fsp.copyFile(tmpOut, outPath);
    const st = await fsp.stat(outPath);
    return { path: outPath, format: targetFormat, size: st.size };
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}
