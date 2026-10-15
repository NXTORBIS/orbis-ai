import path from 'node:path';
import { readHead, looksBinary } from './FileSystemService';

/**
 * Content identification from magic bytes. Used for preview selection and to
 * flag extension/content mismatches. A mismatch is a diagnostic hint, not a
 * verdict about safety.
 */

export interface Sniff {
  detected: string | undefined;
  mime: string | undefined;
  family: 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'executable' | 'text' | 'document' | 'binary' | 'empty' | 'unknown';
  extension: string;
  mismatch?: string;
}

const SIGS: Array<{ test: (b: Buffer) => boolean; type: string; mime: string; family: Sniff['family']; exts: string[] }> = [
  { test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), type: 'PNG image', mime: 'image/png', family: 'image', exts: ['png'] },
  { test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, type: 'JPEG image', mime: 'image/jpeg', family: 'image', exts: ['jpg', 'jpeg', 'jfif', 'jpe'] },
  { test: (b) => b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a', type: 'GIF image', mime: 'image/gif', family: 'image', exts: ['gif'] },
  { test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP', type: 'WebP image', mime: 'image/webp', family: 'image', exts: ['webp'] },
  { test: (b) => b.subarray(0, 2).toString('latin1') === 'BM', type: 'BMP image', mime: 'image/bmp', family: 'image', exts: ['bmp'] },
  { test: (b) => b.subarray(4, 12).toString('latin1') === 'ftypavif', type: 'AVIF image', mime: 'image/avif', family: 'image', exts: ['avif'] },
  { test: (b) => /^ftyp(heic|heix|mif1)/.test(b.subarray(4, 12).toString('latin1')), type: 'HEIF image', mime: 'image/heic', family: 'image', exts: ['heic', 'heif'] },
  { test: (b) => b.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])), type: 'Icon', mime: 'image/x-icon', family: 'image', exts: ['ico'] },
  { test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-', type: 'PDF document', mime: 'application/pdf', family: 'pdf', exts: ['pdf'] },
  { test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(isom|mp4|M4V|avc1|iso2|mmp4|dash)/.test(b.subarray(8, 12).toString('latin1')), type: 'MP4 video', mime: 'video/mp4', family: 'video', exts: ['mp4', 'm4v'] },
  { test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && b.subarray(8, 10).toString('latin1') === 'qt', type: 'QuickTime video', mime: 'video/quicktime', family: 'video', exts: ['mov'] },
  { test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && b.subarray(8, 11).toString('latin1') === 'M4A', type: 'M4A audio', mime: 'audio/mp4', family: 'audio', exts: ['m4a'] },
  { test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), type: 'Matroska/WebM video', mime: 'video/webm', family: 'video', exts: ['mkv', 'webm', 'mka'] },
  { test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE', type: 'WAV audio', mime: 'audio/wav', family: 'audio', exts: ['wav'] },
  { test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'AVI ', type: 'AVI video', mime: 'video/x-msvideo', family: 'video', exts: ['avi'] },
  { test: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0), type: 'MP3 audio', mime: 'audio/mpeg', family: 'audio', exts: ['mp3'] },
  { test: (b) => b.subarray(0, 4).toString('latin1') === 'fLaC', type: 'FLAC audio', mime: 'audio/flac', family: 'audio', exts: ['flac'] },
  { test: (b) => b.subarray(0, 4).toString('latin1') === 'OggS', type: 'Ogg media', mime: 'audio/ogg', family: 'audio', exts: ['ogg', 'oga', 'ogv', 'opus'] },
  { test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4, type: 'ZIP container', mime: 'application/zip', family: 'archive', exts: ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'jar', 'apk', 'epub', 'cbz', 'whl', 'nupkg', 'vsix', 'xpi', 'ipa'] },
  { test: (b) => b[0] === 0x1f && b[1] === 0x8b, type: 'Gzip data', mime: 'application/gzip', family: 'archive', exts: ['gz', 'tgz'] },
  { test: (b) => b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])), type: '7-Zip archive', mime: 'application/x-7z-compressed', family: 'archive', exts: ['7z'] },
  { test: (b) => b.subarray(0, 4).toString('latin1') === 'Rar!', type: 'RAR archive', mime: 'application/vnd.rar', family: 'archive', exts: ['rar'] },
  { test: (b) => b[0] === 0x7f && b.subarray(1, 4).toString('latin1') === 'ELF', type: 'Linux program (ELF)', mime: 'application/x-executable', family: 'executable', exts: ['', 'so', 'bin', 'o', 'appimage'] },
  { test: (b) => b[0] === 0x4d && b[1] === 0x5a, type: 'Windows program', mime: 'application/vnd.microsoft.portable-executable', family: 'executable', exts: ['exe', 'dll', 'sys', 'scr', 'msi', 'com', 'cpl', 'ocx', 'efi'] },
  { test: (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), type: 'Office 97-2003 document', mime: 'application/x-ole-storage', family: 'document', exts: ['doc', 'xls', 'ppt', 'msi', 'msg'] },
  { test: (b) => b.subarray(0, 5).toString('latin1') === '{\\rtf', type: 'Rich Text', mime: 'application/rtf', family: 'document', exts: ['rtf'] },
];

export async function sniffFile(p: string): Promise<Sniff> {
  const ext = path.extname(p).slice(1).toLowerCase();
  const head = await readHead(p, 4096);
  if (head.length === 0) return { detected: 'Empty file', mime: undefined, family: 'empty', extension: ext };
  for (const s of SIGS) {
    if (s.test(head)) {
      const mismatch = s.exts.includes(ext) ? undefined : `The name ends in ".${ext || '(none)'}" but the content looks like ${s.type}.`;
      return { detected: s.type, mime: s.mime, family: s.family, extension: ext, mismatch: s.family === 'executable' || ext ? mismatch : undefined };
    }
  }
  const text = head.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return { detected: 'SVG image', mime: 'image/svg+xml', family: 'image', extension: ext };
  if (!looksBinary(head)) return { detected: 'Text', mime: 'text/plain', family: 'text', extension: ext };
  return { detected: undefined, mime: undefined, family: 'binary', extension: ext };
}

export const PREVIEWABLE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  pdf: 'application/pdf',
};
