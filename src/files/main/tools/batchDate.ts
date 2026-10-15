import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DateModifySpec, DateModifyResult } from '../../shared/batchDate';

/** Date patterns in filenames. */
const DATE_PATTERNS = [
  // YYYY-MM-DD or YYYY_MM_DD
  /(\d{4})[-_](\d{2})[-_](\d{2})/,
  // YYYYMMDD
  /(\d{4})(\d{2})(\d{2})/,
  // IMG_YYYYMMDD
  /IMG_(\d{4})(\d{2})(\d{2})/,
];

function parseDateFromName(name: string): { ms: number; match: string } | undefined {
  for (const re of DATE_PATTERNS) {
    const m = name.match(re);
    if (m) {
      const year = parseInt(m[1]!, 10);
      const month = parseInt(m[2]!, 10);
      const day = parseInt(m[3]!, 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1970 && year <= 2099) {
        const d = new Date(year, month - 1, day, 12, 0, 0);
        return { ms: d.getTime(), match: m[0]! };
      }
    }
  }
  return undefined;
}

/** Try to read EXIF DateTimeOriginal from a file using its metadata. */
async function readExifDate(filePath: string): Promise<{ ms: number; source: string } | undefined> {
  try {
    // Try to read the EXIF data by looking at the file bytes directly.
    // We look for the DateTimeOriginal tag in the EXIF block.
    const fd = await fsp.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fd.read(buf, 0, 65536, 0);
      const slice = buf.subarray(0, bytesRead);
      const text = slice.toString('binary');
      // EXIF DateTimeOriginal is stored as ASCII: "YYYY:MM:DD HH:MM:SS"
      const exifRe = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/g;
      let match: RegExpExecArray | null;
      // The first occurrence after "DateTimeOriginal" or the second occurrence of the pattern (first is usually ModifyDate)
      const dtoIdx = text.indexOf('DateTimeOriginal');
      if (dtoIdx >= 0) {
        const sub = text.slice(dtoIdx);
        match = exifRe.exec(sub);
      } else {
        // fallback: take first date pattern in EXIF-like data
        match = exifRe.exec(text);
      }
      if (match) {
        const d = new Date(
          parseInt(match[1]!, 10),
          parseInt(match[2]!, 10) - 1,
          parseInt(match[3]!, 10),
          parseInt(match[4]!, 10),
          parseInt(match[5]!, 10),
          parseInt(match[6]!, 10),
        );
        if (!isNaN(d.getTime())) {
          return { ms: d.getTime(), source: `EXIF ${match[0]}` };
        }
      }
    } finally {
      await fd.close();
    }
  } catch {
    // file unreadable
  }
  return undefined;
}

/** Modify timestamps on a batch of files. */
export async function batchModifyDates(
  paths: string[],
  spec: DateModifySpec,
): Promise<DateModifyResult[]> {
  const results: DateModifyResult[] = [];

  for (const p of paths) {
    const name = path.basename(p);
    let st;
    try {
      st = await fsp.lstat(p);
    } catch (err) {
      results.push({ path: p, name, oldModifiedMs: 0, oldAccessedMs: 0, error: (err as Error).message });
      continue;
    }
    if (st.isSymbolicLink()) {
      results.push({ path: p, name, oldModifiedMs: st.mtimeMs, oldAccessedMs: st.atimeMs, error: 'Symbolic links are skipped.' });
      continue;
    }

    const result: DateModifyResult = {
      path: p,
      name,
      oldModifiedMs: st.mtimeMs,
      oldAccessedMs: st.atimeMs,
      oldCreatedMs: st.birthtimeMs,
    };

    let targetMs: number | undefined;

    switch (spec.mode) {
      case 'set': {
        if (!spec.date) {
          result.error = 'No date specified.';
          break;
        }
        const d = new Date(spec.date);
        if (isNaN(d.getTime())) {
          result.error = 'Invalid date.';
          break;
        }
        targetMs = d.getTime();
        break;
      }
      case 'shift': {
        if (spec.shiftMs === undefined) {
          result.error = 'No shift amount specified.';
          break;
        }
        // Shift is relative to the current mtime
        targetMs = st.mtimeMs + spec.shiftMs;
        result.source = `shifted ${spec.shiftMs > 0 ? '+' : ''}${spec.shiftMs}ms`;
        break;
      }
      case 'fromName': {
        const parsed = parseDateFromName(name);
        if (!parsed) {
          result.error = 'No date pattern found in filename.';
          break;
        }
        targetMs = parsed.ms;
        result.source = `filename: ${parsed.match}`;
        break;
      }
      case 'fromExif': {
        const exif = await readExifDate(p);
        if (!exif) {
          result.error = 'No EXIF date found.';
          break;
        }
        targetMs = exif.ms;
        result.source = exif.source;
        break;
      }
    }

    if (targetMs !== undefined && !result.error) {
      const newMtime = spec.fields.includes('modified') ? targetMs : st.mtimeMs;
      const newAtime = spec.fields.includes('accessed') ? targetMs : st.atimeMs;
      try {
        await fsp.utimes(p, newAtime / 1000, newMtime / 1000);
        result.newModifiedMs = newMtime;
        result.newAccessedMs = newAtime;
      } catch (err) {
        result.error = (err as Error).message;
      }
    }

    results.push(result);
  }

  return results;
}

/** Preview what dates would be set without actually changing them. */
export async function previewBatchDates(
  paths: string[],
  spec: DateModifySpec,
): Promise<DateModifyResult[]> {
  const results: DateModifyResult[] = [];

  for (const p of paths) {
    const name = path.basename(p);
    let st;
    try {
      st = await fsp.lstat(p);
    } catch (err) {
      results.push({ path: p, name, oldModifiedMs: 0, oldAccessedMs: 0, error: (err as Error).message });
      continue;
    }
    if (st.isSymbolicLink()) {
      results.push({ path: p, name, oldModifiedMs: st.mtimeMs, oldAccessedMs: st.atimeMs, error: 'Symbolic links are skipped.' });
      continue;
    }

    const result: DateModifyResult = {
      path: p,
      name,
      oldModifiedMs: st.mtimeMs,
      oldAccessedMs: st.atimeMs,
      oldCreatedMs: st.birthtimeMs,
    };

    let targetMs: number | undefined;

    switch (spec.mode) {
      case 'set': {
        if (!spec.date) break;
        const d = new Date(spec.date);
        if (isNaN(d.getTime())) break;
        targetMs = d.getTime();
        break;
      }
      case 'shift': {
        if (spec.shiftMs === undefined) break;
        targetMs = st.mtimeMs + spec.shiftMs;
        result.source = `shifted ${spec.shiftMs > 0 ? '+' : ''}${spec.shiftMs}ms`;
        break;
      }
      case 'fromName': {
        const parsed = parseDateFromName(name);
        if (!parsed) {
          result.error = 'No date pattern found in filename.';
          break;
        }
        targetMs = parsed.ms;
        result.source = `filename: ${parsed.match}`;
        break;
      }
      case 'fromExif': {
        const exif = await readExifDate(p);
        if (!exif) {
          result.error = 'No EXIF date found.';
          break;
        }
        targetMs = exif.ms;
        result.source = exif.source;
        break;
      }
    }

    if (targetMs !== undefined && !result.error) {
      result.newModifiedMs = spec.fields.includes('modified') ? targetMs : st.mtimeMs;
      result.newAccessedMs = spec.fields.includes('accessed') ? targetMs : st.atimeMs;
    }

    results.push(result);
  }

  return results;
}
