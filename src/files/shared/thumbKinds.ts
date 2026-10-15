/**
 * Which kind of thumbnail a file gets, decided by its extension — shared by
 * the orbis-thumb protocol and thumbnail cache (main) and the file views
 * (renderer), so both agree on cache keys and on who draws what.
 *
 *  image  decoded in the main process (platform codec), else by the window
 *  video  poster frame drawn by the window
 *  pdf    first page drawn by PDF.js in the window
 *  svg    drawn by the window as an <img> from orbis-media:// (no scripts) and rasterized
 *  font   "Aa" drawn by the window with the font loaded through FontFace
 *  text   first lines of a text/code file drawn by the window (large thumbnails and gallery only)
 *
 * Everything but `image` is made by the window and stored with `thumb:store`.
 */

export type ThumbKind = 'image' | 'video' | 'pdf' | 'svg' | 'font' | 'text';

export const IMAGE_THUMB_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico']);
export const VIDEO_THUMB_EXT_LIST = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv'];
export const FONT_THUMB_EXTS = new Set(['ttf', 'otf', 'woff', 'woff2']);
export const TEXT_THUMB_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'csv', 'tsv', 'rst', 'html', 'htm', 'css', 'scss',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'swift', 'php', 'sh', 'bash', 'zsh',
  'sql', 'lua', 'r', 'dart', 'vue', 'svelte', 'srt', 'vtt', 'tex', 'bib', 'properties', 'gradle',
]);

export function thumbKindForExt(ext: string): ThumbKind | undefined {
  const e = ext.toLowerCase();
  if (IMAGE_THUMB_EXTS.has(e)) return 'image';
  if (VIDEO_THUMB_EXT_LIST.includes(e)) return 'video';
  if (e === 'pdf') return 'pdf';
  if (e === 'svg') return 'svg';
  if (FONT_THUMB_EXTS.has(e)) return 'font';
  if (TEXT_THUMB_EXTS.has(e)) return 'text';
  return undefined;
}

/**
 * Rendering version per kind, mixed into cache keys of the kinds added later
 * (image and video keys are unchanged, so existing caches stay valid). Bump a
 * version when that kind's drawing changes, so old thumbnails are not reused.
 */
export const THUMB_RENDER_VERSION: Partial<Record<ThumbKind, string>> = { pdf: 'pdf1', svg: 'svg1', font: 'font1', text: 'text1' };

/** Size limits for thumbnails the window draws (bytes of the source file). */
export const THUMB_SOURCE_LIMITS: Partial<Record<ThumbKind, number>> = { pdf: 50 * 1024 * 1024, svg: 10 * 1024 * 1024, font: 30 * 1024 * 1024 };
