import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { requireAbsolute } from '../fs/paths';
import type { ContentSearchMatch, ContentSearchProgress } from '../../shared/contentSearch';
import { makeError } from '../../shared/errors';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LINE_LENGTH = 10_000;

/** Extensions that are almost certainly binary. */
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'tiff', 'tif',
  'mp3', 'mp4', 'avi', 'mkv', 'mov', 'wav', 'flac', 'ogg', 'aac', 'wma',
  'zip', 'gz', 'tar', 'bz2', 'xz', '7z', 'rar', 'zst',
  'exe', 'dll', 'so', 'dylib', 'bin', 'obj', 'o', 'a',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'sqlite', 'db', 'sqlite3',
]);

/** Quick check for gitignore patterns. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.DS_Store',
  'dist', 'build', '.next', '.nuxt', 'coverage', '.cache',
]);

function matchGlob(name: string, pattern: string): boolean {
  if (!pattern) return true;
  // Simple glob: *.ext or **/pattern
  const p = pattern.trim();
  if (p === '*') return true;
  if (p.startsWith('*.')) {
    const ext = p.slice(2).toLowerCase();
    return name.toLowerCase().endsWith('.' + ext);
  }
  // Plain substring match
  return name.toLowerCase().includes(p.toLowerCase());
}

async function* walkFiles(dir: string, fileFilter: string, signal: AbortSignal): AsyncGenerator<string> {
  if (signal.aborted) return;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (signal.aborted) return;
    if (entry.name.startsWith('.') && IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      yield* walkFiles(full, fileFilter, signal);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (BINARY_EXTS.has(ext)) continue;
      if (!matchGlob(entry.name, fileFilter)) continue;
      yield full;
    }
  }
}

type Channels = 'content:search';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export function contentSearchHandlers(): Handlers {
  return {
    'content:search': (_p, _e) => {
      // This is handled as a job by the caller (runJob), so it receives signal and progress
      // But since we use the standard job pattern, we return a function for runJob to call.
      // Actually, looking at the pattern, this is handled inline. Let's just do it directly.
      throw makeError('internal', 'content:search', { message: 'Use content:search through the job system.' });
    },
  };
}

/**
 * The actual search function, meant to be called from runJob.
 */
export async function searchFileContents(
  dir: string,
  pattern: string,
  isRegex: boolean,
  caseSensitive: boolean,
  fileFilter: string,
  maxResults: number,
  signal: AbortSignal,
  progress: (p: ContentSearchProgress) => void,
): Promise<ContentSearchMatch[]> {
  const absDir = requireAbsolute(dir, 'content:search');

  let regex: RegExp;
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    regex = isRegex ? new RegExp(pattern, flags) : new RegExp(escapeRegex(pattern), flags);
  } catch (err) {
    throw makeError('validation', 'content:search', { message: `Invalid regex: ${(err as Error).message}` });
  }

  const allMatches: ContentSearchMatch[] = [];
  let filesSearched = 0;
  let lastReport = 0;
  const batchMatches: ContentSearchMatch[] = [];

  for await (const filePath of walkFiles(absDir, fileFilter, signal)) {
    if (signal.aborted) break;
    if (allMatches.length >= maxResults) break;

    try {
      const stat = await fsp.stat(filePath);
      if (stat.size > MAX_FILE_SIZE || stat.size === 0) continue;
    } catch {
      continue;
    }

    filesSearched++;

    try {
      const stream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let lineNum = 0;

      for await (const rawLine of rl) {
        if (signal.aborted) break;
        if (allMatches.length >= maxResults) break;
        lineNum++;
        const line = rawLine.length > MAX_LINE_LENGTH ? rawLine.slice(0, MAX_LINE_LENGTH) : rawLine;
        regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(line)) !== null && allMatches.length < maxResults) {
          const match: ContentSearchMatch = {
            path: filePath,
            line: lineNum,
            column: m.index,
            lineText: line,
            matchText: m[0],
          };
          allMatches.push(match);
          batchMatches.push(match);
          if (!regex.global) break;
          if (m[0].length === 0) { regex.lastIndex++; }
        }
      }

      rl.close();
      stream.destroy();
    } catch {
      // Skip files that can't be read as text
    }

    const now = Date.now();
    if (now - lastReport > 200 || allMatches.length >= maxResults) {
      lastReport = now;
      progress({
        filesSearched,
        currentFile: filePath,
        matchCount: allMatches.length,
        matches: batchMatches.splice(0),
      });
    }
  }

  // Final flush
  if (batchMatches.length > 0) {
    progress({
      filesSearched,
      currentFile: '',
      matchCount: allMatches.length,
      matches: batchMatches.splice(0),
    });
  }

  return allMatches;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
