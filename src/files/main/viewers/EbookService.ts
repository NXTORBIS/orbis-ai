// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
/**
 * EPUB parsing service. EPUBs are ZIP archives containing XHTML content,
 * CSS stylesheets, images and an OPF manifest that describes the reading
 * order. This service extracts the archive, parses the manifest and TOC,
 * and serves sanitized chapter HTML to the renderer.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import yauzl from 'yauzl';
import { makeError } from '../../shared/errors';
import type { EbookManifest, EbookChapter, EbookTocEntry, EbookMetadata, ReadingPosition } from '../../shared/viewers';

/** Maximum EPUB file size (500 MB). */
const MAX_EPUB_BYTES = 500 * 1024 * 1024;
/** Maximum single file size inside an EPUB (50 MB). */
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

interface ParsedOpf {
  metadata: EbookMetadata;
  manifest: Map<string, ManifestItem>;
  spine: string[];
  coverMeta?: string;
}

/** Cache of extracted EPUBs. */
const extractionCache = new Map<string, { dir: string; opf: ParsedOpf; opfDir: string; mtime: number }>();

/** Reading positions stored in memory (will persist across calls within the session). */
const positions = new Map<string, ReadingPosition>();

export async function openEbook(epubPath: string): Promise<EbookManifest> {
  const st = await fsp.stat(epubPath).catch(() => {
    throw makeError('not_found', 'ebook.open', { target: epubPath });
  });
  if (st.size > MAX_EPUB_BYTES) throw makeError('unsupported', 'ebook.open', { message: 'This EPUB is too large (over 500 MB).' });

  const cached = extractionCache.get(epubPath);
  if (cached && cached.mtime === st.mtimeMs) {
    return buildManifest(cached.opf, cached.dir, cached.opfDir);
  }

  // Extract to a temp directory
  const extractDir = path.join(os.tmpdir(), `orbis-epub-${crypto.randomUUID()}`);
  await fsp.mkdir(extractDir, { recursive: true, mode: 0o700 });

  try {
    await extractZip(epubPath, extractDir);
  } catch (err) {
    await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    throw makeError('unsupported', 'ebook.open', { message: `Failed to extract EPUB: ${(err as Error).message}` });
  }

  // Find and parse the OPF file
  const containerXml = await fsp.readFile(path.join(extractDir, 'META-INF', 'container.xml'), 'utf8').catch(() => {
    throw makeError('unsupported', 'ebook.open', { message: 'This EPUB is missing the META-INF/container.xml file.' });
  });

  const opfPath = parseContainerXml(containerXml);
  if (!opfPath) throw makeError('unsupported', 'ebook.open', { message: 'Could not find the OPF file path in container.xml.' });

  const opfFullPath = path.join(extractDir, opfPath);
  const opfDir = path.dirname(opfFullPath);
  const opfXml = await fsp.readFile(opfFullPath, 'utf8').catch(() => {
    throw makeError('unsupported', 'ebook.open', { message: `OPF file not found: ${opfPath}` });
  });

  const opf = parseOpf(opfXml);

  extractionCache.set(epubPath, { dir: extractDir, opf, opfDir, mtime: st.mtimeMs });

  return buildManifest(opf, extractDir, opfDir);
}

export async function readChapter(epubPath: string, spineIndex: number): Promise<EbookChapter> {
  const cached = extractionCache.get(epubPath);
  if (!cached) {
    // Re-open to populate cache
    await openEbook(epubPath);
    const c = extractionCache.get(epubPath);
    if (!c) throw makeError('not_found', 'ebook.chapter', { message: 'EPUB could not be opened.' });
    return readChapterFromCache(c.opf, c.dir, c.opfDir, spineIndex);
  }
  return readChapterFromCache(cached.opf, cached.dir, cached.opfDir, spineIndex);
}

async function readChapterFromCache(opf: ParsedOpf, extractDir: string, opfDir: string, spineIndex: number): Promise<EbookChapter> {
  if (spineIndex < 0 || spineIndex >= opf.spine.length) {
    throw makeError('validation', 'ebook.chapter', { message: `Chapter index ${spineIndex} is out of range (0-${opf.spine.length - 1}).` });
  }

  const itemId = opf.spine[spineIndex]!;
  const item = opf.manifest.get(itemId);
  if (!item) throw makeError('not_found', 'ebook.chapter', { message: `Spine item "${itemId}" not found in manifest.` });

  const chapterPath = path.resolve(opfDir, item.href);
  const rawHtml = await fsp.readFile(chapterPath, 'utf8').catch(() => {
    throw makeError('not_found', 'ebook.chapter', { message: `Chapter file not found: ${item.href}` });
  });

  // Collect CSS references from the chapter
  const cssRefs = extractCssRefs(rawHtml);
  const chapterDir = path.dirname(chapterPath);
  let combinedCss = '';

  for (const ref of cssRefs) {
    const cssPath = path.resolve(chapterDir, ref);
    const cssContent = await fsp.readFile(cssPath, 'utf8').catch(() => '');
    combinedCss += cssContent + '\n';
  }

  // Also collect CSS from manifest items linked by the chapter
  for (const [, mItem] of opf.manifest) {
    if (mItem.mediaType === 'text/css') {
      const cssPath = path.resolve(opfDir, mItem.href);
      const cssContent = await fsp.readFile(cssPath, 'utf8').catch(() => '');
      if (!combinedCss.includes(cssContent.trim()) && cssContent.trim()) {
        combinedCss += cssContent + '\n';
      }
    }
  }

  // Build image map: original relative href -> orbis-media:// URL
  const images: Record<string, string> = {};
  for (const [, mItem] of opf.manifest) {
    if (mItem.mediaType.startsWith('image/') || IMAGE_EXTS.has(extOf(mItem.href))) {
      const absPath = path.resolve(opfDir, mItem.href);
      images[mItem.href] = `orbis-media://f/${encodeURIComponent(absPath)}`;
      // Also add relative from chapter dir
      const relFromChapter = path.relative(chapterDir, absPath);
      images[relFromChapter] = `orbis-media://f/${encodeURIComponent(absPath)}`;
    }
  }

  // Sanitize the HTML
  const html = sanitizeEpubHtml(rawHtml, images, chapterDir, opfDir);

  // Sanitize CSS (remove imports to external resources, JS expressions)
  combinedCss = sanitizeCss(combinedCss);

  return { html, css: combinedCss, images };
}

export function getPosition(filePath: string): ReadingPosition | null {
  return positions.get(filePath) ?? null;
}

export function savePosition(filePath: string, index: number, scrollOffset?: number): void {
  positions.set(filePath, { path: filePath, index, scrollOffset, lastReadMs: Date.now() });
}

/* ---------------------------------------------------------------- ZIP extraction */

function extractZip(zipPath: string, dest: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Failed to open ZIP'));
      let pending = 0;
      let ended = false;

      const finish = () => {
        if (ended && pending === 0) resolve();
      };

      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        const entryName: string = entry.fileName;
        // Security: reject absolute paths and traversal
        if (entryName.startsWith('/') || entryName.includes('..')) {
          zipfile.readEntry();
          return;
        }
        const fullPath = path.join(dest, entryName);

        if (/\/$/.test(entryName)) {
          // Directory
          void fsp.mkdir(fullPath, { recursive: true }).then(() => zipfile.readEntry(), reject);
          return;
        }

        if ((entry.uncompressedSize ?? 0) > MAX_ENTRY_BYTES) {
          zipfile.readEntry();
          return;
        }

        pending++;
        void fsp.mkdir(path.dirname(fullPath), { recursive: true }).then(() => {
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr || !readStream) {
              pending--;
              finish();
              zipfile.readEntry();
              return;
            }
            const chunks: Buffer[] = [];
            readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
            readStream.on('end', () => {
              void fsp.writeFile(fullPath, Buffer.concat(chunks)).then(() => {
                pending--;
                finish();
              }, () => {
                pending--;
                finish();
              });
            });
            readStream.on('error', () => {
              pending--;
              finish();
            });
            zipfile.readEntry();
          });
        }, reject);
      });

      zipfile.on('end', () => {
        ended = true;
        finish();
      });
      zipfile.on('error', reject);
    });
  });
}

/* ---------------------------------------------------------------- XML parsing (simple, no deps) */

function parseContainerXml(xml: string): string | undefined {
  // Look for <rootfile full-path="...">
  const match = xml.match(/full-path\s*=\s*["']([^"']+)["']/);
  return match?.[1];
}

function parseOpf(xml: string): ParsedOpf {
  const metadata = parseMetadata(xml);
  const manifest = parseManifestItems(xml);
  const spine = parseSpine(xml);
  const coverMeta = parseCoverMeta(xml);

  return { metadata, manifest, spine, coverMeta };
}

function parseMetadata(xml: string): EbookMetadata {
  const meta: EbookMetadata = {};
  const titleMatch = xml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  if (titleMatch) meta.title = decodeEntities(titleMatch[1]!);

  const authorMatch = xml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
  if (authorMatch) meta.author = decodeEntities(authorMatch[1]!);

  const langMatch = xml.match(/<dc:language[^>]*>([^<]+)<\/dc:language>/i);
  if (langMatch) meta.language = decodeEntities(langMatch[1]!);

  const publisherMatch = xml.match(/<dc:publisher[^>]*>([^<]+)<\/dc:publisher>/i);
  if (publisherMatch) meta.publisher = decodeEntities(publisherMatch[1]!);

  const descMatch = xml.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);
  if (descMatch) meta.description = decodeEntities(descMatch[1]!.replace(/<[^>]+>/g, '').trim());

  return meta;
}

function parseManifestItems(xml: string): Map<string, ManifestItem> {
  const items = new Map<string, ManifestItem>();
  const re = /<item\s+([^>]+)\/?\s*>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1]!;
    const id = attrVal(attrs, 'id');
    const href = attrVal(attrs, 'href');
    const mediaType = attrVal(attrs, 'media-type');
    if (id && href && mediaType) {
      items.set(id, { id, href: decodeURIComponent(href), mediaType });
    }
  }
  return items;
}

function parseSpine(xml: string): string[] {
  const spine: string[] = [];
  const re = /<itemref\s+([^>]+)\/?\s*>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const idref = attrVal(m[1]!, 'idref');
    if (idref) spine.push(idref);
  }
  return spine;
}

function parseCoverMeta(xml: string): string | undefined {
  const match = xml.match(/<meta\s+[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i)
    ?? xml.match(/<meta\s+[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']cover["']/i);
  return match?.[1];
}

function attrVal(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*?)["']`, 'i');
  const m = re.exec(attrs);
  return m?.[1];
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

function extOf(href: string): string {
  const dot = href.lastIndexOf('.');
  return dot >= 0 ? href.slice(dot + 1).toLowerCase() : '';
}

/* ---------------------------------------------------------------- TOC parsing */

function buildManifest(opf: ParsedOpf, extractDir: string, opfDir: string): EbookManifest {
  const toc = buildToc(opf, extractDir, opfDir);

  // Find cover image
  let coverPath: string | undefined;
  if (opf.coverMeta) {
    const coverItem = opf.manifest.get(opf.coverMeta);
    if (coverItem) {
      coverPath = path.resolve(opfDir, coverItem.href);
    }
  }

  return {
    metadata: { ...opf.metadata, coverPath },
    toc,
    spine: opf.spine,
    spineCount: opf.spine.length,
  };
}

function buildToc(opf: ParsedOpf, _extractDir: string, opfDir: string): EbookTocEntry[] {
  // Build TOC from spine (each chapter gets an entry)
  const toc: EbookTocEntry[] = [];
  const hrefToSpineIndex = new Map<string, number>();

  for (let i = 0; i < opf.spine.length; i++) {
    const itemId = opf.spine[i]!;
    const item = opf.manifest.get(itemId);
    if (item) {
      hrefToSpineIndex.set(item.href, i);
      // Try to find a TOC entry from NCX or nav document
      const label = item.id || `Chapter ${i + 1}`;
      toc.push({ label, spineIndex: i, depth: 0 });
    }
  }

  // Try to parse NCX TOC for better labels
  const ncxItem = Array.from(opf.manifest.values()).find((item) => item.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem) {
    const ncxPath = path.resolve(opfDir, ncxItem.href);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ncxXml = require('node:fs').readFileSync(ncxPath, 'utf8') as string;
      const ncxToc = parseNcx(ncxXml, hrefToSpineIndex, opfDir);
      if (ncxToc.length > 0) return ncxToc;
    } catch {
      // Fall through to simple TOC
    }
  }

  // Try nav document (EPUB 3)
  const navItem = Array.from(opf.manifest.values()).find((item) =>
    item.mediaType === 'application/xhtml+xml' && item.id?.toLowerCase().includes('nav'),
  );
  if (navItem) {
    const navPath = path.resolve(opfDir, navItem.href);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const navHtml = require('node:fs').readFileSync(navPath, 'utf8') as string;
      const navToc = parseNavDoc(navHtml, hrefToSpineIndex, opfDir, navItem.href);
      if (navToc.length > 0) return navToc;
    } catch {
      // Fall through
    }
  }

  return toc;
}

function parseNcx(xml: string, hrefToSpineIndex: Map<string, number>, _opfDir: string): EbookTocEntry[] {
  const entries: EbookTocEntry[] = [];
  const re = /<navPoint[^>]*>([\s\S]*?)<\/navPoint>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1]!;
    const labelMatch = block.match(/<text>([^<]+)<\/text>/i);
    const srcMatch = block.match(/<content\s+[^>]*src\s*=\s*["']([^"']+)["']/i);
    if (labelMatch && srcMatch) {
      const label = decodeEntities(labelMatch[1]!.trim());
      const src = decodeURIComponent(srcMatch[1]!);
      const [hrefPart, fragment] = src.split('#');
      // Find spine index for this href
      let spineIndex = hrefToSpineIndex.get(hrefPart!) ?? -1;
      if (spineIndex < 0) {
        // Try resolving relative paths
        for (const [href, idx] of hrefToSpineIndex) {
          if (href.endsWith(hrefPart!) || hrefPart!.endsWith(href)) {
            spineIndex = idx;
            break;
          }
        }
      }
      if (spineIndex >= 0) {
        entries.push({ label, spineIndex, fragment, depth: 0 });
      }
    }
  }
  return entries;
}

function parseNavDoc(html: string, hrefToSpineIndex: Map<string, number>, opfDir: string, navHref: string): EbookTocEntry[] {
  const entries: EbookTocEntry[] = [];
  // Find the <nav epub:type="toc"> section
  const navMatch = html.match(/<nav[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) return entries;

  const navContent = navMatch[1]!;
  const navDir = path.dirname(navHref);
  // Extract all <a> tags
  const re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = re.exec(navContent)) !== null) {
    const rawHref = decodeURIComponent(m[1]!);
    const label = decodeEntities(m[2]!.trim());
    const [hrefPart, fragment] = rawHref.split('#');
    // Resolve relative to nav document
    const resolvedHref = hrefPart ? path.posix.join(navDir, hrefPart) : '';
    let spineIndex = -1;
    for (const [href, idx] of hrefToSpineIndex) {
      if (href === resolvedHref || href === hrefPart || href.endsWith(hrefPart!) || resolvedHref.endsWith(href)) {
        spineIndex = idx;
        break;
      }
    }
    if (spineIndex >= 0) {
      entries.push({ label, spineIndex, fragment, depth: 0 });
    }
  }
  return entries;
}

/* ---------------------------------------------------------------- HTML sanitization */

function extractCssRefs(html: string): string[] {
  const refs: string[] = [];
  const re = /<link[^>]*href\s*=\s*["']([^"']+\.css)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    refs.push(m[1]!);
  }
  return refs;
}

function sanitizeEpubHtml(html: string, images: Record<string, string>, chapterDir: string, _opfDir: string): string {
  // Extract just the body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let content = bodyMatch?.[1] ?? html;

  // Remove script tags and their contents
  content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove link tags (external stylesheets / resources)
  content = content.replace(/<link[^>]*\/?>/gi, '');
  // Remove event handlers (onclick, onload, onerror, etc.)
  content = content.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  content = content.replace(/\s+on\w+\s*=\s*[^\s>"']+/gi, '');
  // Remove javascript: URLs in any attribute
  content = content.replace(/(href|src|action|data)\s*=\s*["']javascript:[^"']*["']/gi, '$1="#"');
  // Remove iframes, embeds, objects, forms
  content = content.replace(/<(iframe|embed|object|form|input|button|textarea|select)[\s\S]*?<\/\1>/gi, '');
  content = content.replace(/<(iframe|embed|object|form|input|button|textarea|select)[^>]*\/?\s*>/gi, '');
  // Remove style attributes with expressions
  content = content.replace(/style\s*=\s*["'][^"']*expression[^"']*["']/gi, '');

  // Rewrite image src attributes to use orbis-media:// protocol
  content = content.replace(/(<img[^>]*\s+src\s*=\s*["'])([^"']+)(["'])/gi, (match, before: string, src: string, after: string) => {
    // Try direct match
    if (images[src]) return `${before}${images[src]}${after}`;
    // Try resolving relative to chapter dir
    const absPath = path.resolve(chapterDir, src);
    const mediaUrl = `orbis-media://f/${encodeURIComponent(absPath)}`;
    return `${before}${mediaUrl}${after}`;
  });

  // Rewrite SVG image xlink:href too
  content = content.replace(/xlink:href\s*=\s*["']([^"']+)["']/gi, (match, href: string) => {
    if (images[href]) return `xlink:href="${images[href]}"`;
    const absPath = path.resolve(chapterDir, href);
    return `xlink:href="orbis-media://f/${encodeURIComponent(absPath)}"`;
  });

  return content;
}

function sanitizeCss(css: string): string {
  // Remove @import rules (external resources)
  css = css.replace(/@import\s+[^;]+;/g, '');
  // Remove url() references to external resources, but allow data: URLs
  css = css.replace(/url\s*\(\s*["']?((?!data:)[^)"']+)["']?\s*\)/gi, 'url(about:blank)');
  // Remove expression() (IE)
  css = css.replace(/expression\s*\([^)]*\)/gi, '');
  // Remove behavior property
  css = css.replace(/behavior\s*:[^;]+;?/gi, '');
  return css;
}
