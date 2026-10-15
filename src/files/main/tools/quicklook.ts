/**
 * Quick Look: produces preview data for a file based on its type.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { QuickLookData, QuickLookType } from '../../shared/quicklook';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'ogv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus']);
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'rs', 'go', 'java', 'kt', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'dart',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'proto', 'tf', 'hcl',
  'makefile', 'dockerfile', 'gitignore', 'env', 'editorconfig',
  'r', 'lua', 'pl', 'pm', 'php', 'vue', 'svelte', 'astro',
]);
const FONT_EXTS = new Set(['ttf', 'otf', 'woff', 'woff2']);
const PDF_EXT = 'pdf';

const LANG_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', swift: 'swift',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', md: 'markdown', markdown: 'markdown', xml: 'xml',
  php: 'php', lua: 'lua', r: 'r', dart: 'dart',
};

const MAX_TEXT_BYTES = 64 * 1024; // 64 KB
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

function detectType(ext: string): QuickLookType {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  if (AUDIO_EXTS.has(e)) return 'audio';
  if (TEXT_EXTS.has(e)) return 'text';
  if (FONT_EXTS.has(e)) return 'font';
  if (e === PDF_EXT) return 'pdf';
  return 'unsupported';
}

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
    ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
    pdf: 'application/pdf',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

export async function getQuickLookData(filePath: string): Promise<QuickLookData> {
  const stat = await fsp.stat(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const type = detectType(ext);
  const base: QuickLookData = {
    type,
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    modifiedMs: stat.mtimeMs,
    mime: mimeForExt(ext),
  };

  switch (type) {
    case 'image': {
      if (stat.size <= MAX_IMAGE_BYTES) {
        const buf = await fsp.readFile(filePath);
        base.dataUrl = `data:${base.mime};base64,${buf.toString('base64')}`;
      }
      return base;
    }
    case 'text': {
      const buf = await fsp.readFile(filePath, { flag: 'r' }).then(
        (b) => b.subarray(0, MAX_TEXT_BYTES),
        () => Buffer.alloc(0),
      );
      const text = buf.toString('utf-8');
      const lines = text.split('\n');
      base.textContent = lines.slice(0, 100).join('\n');
      base.language = LANG_MAP[ext] ?? ext;
      return base;
    }
    case 'video':
    case 'audio': {
      // The renderer will use the file path directly via file:// protocol
      return base;
    }
    case 'font': {
      base.fontFamily = path.basename(filePath, path.extname(filePath));
      if (stat.size <= 5 * 1024 * 1024) {
        const buf = await fsp.readFile(filePath);
        base.dataUrl = `data:${base.mime};base64,${buf.toString('base64')}`;
      }
      return base;
    }
    case 'pdf': {
      return base;
    }
    default:
      return base;
  }
}
