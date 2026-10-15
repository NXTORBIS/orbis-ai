import path from 'node:path';
import fsp from 'node:fs/promises';
import type { RenamePattern, RenamePreviewResult, RenamePreviewItem } from '../../shared/batchRename';
import type { MetadataService } from '../media/MetadataService';

/**
 * Applies a RenamePattern to a list of paths and returns a preview of what each
 * file would be renamed to. Nothing is written; the actual rename is done by
 * the operations system ('rename-batch').
 */

function changeCase(s: string, mode: RenamePattern['caseMode']): string {
  switch (mode) {
    case 'upper': return s.toUpperCase();
    case 'lower': return s.toLowerCase();
    case 'title': return s.replace(/\b\w/g, (c) => c.toUpperCase());
    default: return s;
  }
}

function formatDate(d: Date, fmt: string): string {
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  return fmt
    .replace(/YYYY/g, d.getFullYear().toString())
    .replace(/YY/g, pad(d.getFullYear() % 100))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()))
    .replace(/hh/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()));
}

function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

function expandTemplate(
  template: string,
  name: string,
  ext: string,
  index: number,
  parentName: string,
  stat: { mtimeMs?: number; birthtimeMs?: number },
  pattern: RenamePattern,
): string {
  return template.replace(/\{([^}]+)\}/g, (_m, token: string) => {
    // {n} or {n:3}
    if (/^n(:\d+)?$/.test(token)) {
      const padWidth = token.includes(':') ? parseInt(token.split(':')[1]!, 10) : pattern.padWidth;
      const num = pattern.startNumber + index;
      return padWidth > 0 ? num.toString().padStart(padWidth, '0') : num.toString();
    }
    if (token === 'name') return name;
    if (token === 'ext') return ext.replace(/^\./, '');
    if (token === 'parent') return parentName;
    // {date} or {date:FORMAT}
    if (/^date(:.+)?$/.test(token)) {
      const fmt = token.includes(':') ? token.slice(5) : 'YYYY-MM-DD';
      const d = stat.mtimeMs ? new Date(stat.mtimeMs) : new Date();
      return formatDate(d, fmt);
    }
    if (/^mtime(:.+)?$/.test(token)) {
      const fmt = token.includes(':') ? token.slice(6) : 'YYYY-MM-DD';
      const d = stat.mtimeMs ? new Date(stat.mtimeMs) : new Date();
      return formatDate(d, fmt);
    }
    if (/^created(:.+)?$/.test(token)) {
      const fmt = token.includes(':') ? token.slice(8) : 'YYYY-MM-DD';
      const d = stat.birthtimeMs ? new Date(stat.birthtimeMs) : new Date();
      return formatDate(d, fmt);
    }
    return `{${token}}`;
  });
}

export async function applyRenamePattern(
  paths: string[],
  pattern: RenamePattern,
  _metadata: MetadataService,
): Promise<RenamePreviewResult> {
  const items: RenamePreviewItem[] = [];
  const seenNewNames = new Map<string, number>();
  let conflicts = 0;
  let unchanged = 0;
  let renamed = 0;

  // Pre-stat all files
  const stats = await Promise.all(
    paths.map(async (p) => {
      try {
        const st = await fsp.stat(p);
        return { mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs };
      } catch {
        return { mtimeMs: undefined, birthtimeMs: undefined };
      }
    }),
  );

  for (let i = 0; i < paths.length; i++) {
    const filePath = paths[i]!;
    const dir = path.dirname(filePath);
    const originalName = path.basename(filePath);
    const [baseName, ext] = splitExt(originalName);
    const parentName = path.basename(dir);
    const stat = stats[i]!;

    let newBase: string;

    // If template is just {name} (default), work on the original name
    if (pattern.template === '{name}' || !pattern.template) {
      newBase = baseName;
    } else {
      newBase = expandTemplate(pattern.template, baseName, ext, i, parentName, stat, pattern);
    }

    // Apply find/replace
    if (pattern.find) {
      try {
        if (pattern.useRegex) {
          const flags = pattern.caseSensitive ? 'g' : 'gi';
          const re = new RegExp(pattern.find, flags);
          newBase = newBase.replace(re, pattern.replace);
        } else {
          const target = pattern.caseSensitive ? pattern.find : pattern.find.toLowerCase();
          let result = '';
          const searchIn = newBase;
          const searchLower = pattern.caseSensitive ? searchIn : searchIn.toLowerCase();
          let pos = 0;
          let idx = searchLower.indexOf(target, pos);
          while (idx !== -1) {
            result += searchIn.slice(pos, idx) + pattern.replace;
            pos = idx + target.length;
            idx = searchLower.indexOf(target, pos);
          }
          result += searchIn.slice(pos);
          newBase = result;
        }
      } catch {
        items.push({ path: filePath, oldName: originalName, newName: originalName, status: 'invalid', reason: 'Invalid regular expression' });
        continue;
      }
    }

    // Apply case conversion
    if (pattern.caseMode !== 'none') {
      if (pattern.includeExtension) {
        newBase = changeCase(newBase + ext, pattern.caseMode);
        // Re-split since we modified the whole thing
        const [nb, ne] = splitExt(newBase);
        const newName = nb + ne;
        const key = path.join(dir, newName).toLowerCase();
        const count = seenNewNames.get(key) ?? 0;
        seenNewNames.set(key, count + 1);
        if (newName === originalName) {
          items.push({ path: filePath, oldName: originalName, newName, status: 'unchanged' });
          unchanged++;
        } else if (count > 0) {
          items.push({ path: filePath, oldName: originalName, newName, status: 'conflict', reason: 'Duplicate name' });
          conflicts++;
        } else {
          items.push({ path: filePath, oldName: originalName, newName, status: 'renamed' });
          renamed++;
        }
        continue;
      } else {
        newBase = changeCase(newBase, pattern.caseMode);
      }
    }

    const newName = newBase + ext;

    // Validate
    if (!newName || /[\0/\\]/.test(newName) || newName.length > 255) {
      items.push({ path: filePath, oldName: originalName, newName, status: 'invalid', reason: 'Invalid file name' });
      continue;
    }

    const key = path.join(dir, newName).toLowerCase();
    const count = seenNewNames.get(key) ?? 0;
    seenNewNames.set(key, count + 1);

    if (newName === originalName) {
      items.push({ path: filePath, oldName: originalName, newName, status: 'unchanged' });
      unchanged++;
    } else if (count > 0) {
      items.push({ path: filePath, oldName: originalName, newName, status: 'conflict', reason: 'Duplicate name' });
      conflicts++;
    } else {
      items.push({ path: filePath, oldName: originalName, newName, status: 'renamed' });
      renamed++;
    }
  }

  return { items, conflicts, unchanged, renamed };
}
