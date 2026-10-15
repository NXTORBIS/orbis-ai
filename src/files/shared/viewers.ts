/**
 * Shared types for the e-book, comic and 3D model viewers.
 */

/* ---------------------------------------------------------------- E-book (EPUB) */

export interface EbookTocEntry {
  /** Display label of the TOC item. */
  label: string;
  /** Index in the spine array. */
  spineIndex: number;
  /** Fragment inside the chapter (e.g. "#section-2"). */
  fragment?: string;
  /** Nesting depth (0 = top-level). */
  depth: number;
}

export interface EbookMetadata {
  title?: string;
  author?: string;
  language?: string;
  publisher?: string;
  description?: string;
  coverPath?: string;
}

export interface EbookManifest {
  metadata: EbookMetadata;
  toc: EbookTocEntry[];
  /** Ordered list of content document IDs that form the reading order. */
  spine: string[];
  /** Total number of chapters/sections in the spine. */
  spineCount: number;
}

export interface EbookChapter {
  /** Sanitized HTML safe for rendering. */
  html: string;
  /** CSS content combined from all stylesheets referenced by this chapter. */
  css: string;
  /** Map of original image href to orbis-media:// URLs. */
  images: Record<string, string>;
}

/* ---------------------------------------------------------------- Comic (CBZ/CBR/CB7/CBT) */

export interface ComicPage {
  /** Entry name inside the archive. */
  entry: string;
  /** Image width if known from archive metadata. */
  width?: number;
  /** Image height if known from archive metadata. */
  height?: number;
}

export interface ComicManifest {
  /** Archive format. */
  format: string;
  /** Ordered list of image pages. */
  pages: ComicPage[];
  /** Total number of pages. */
  pageCount: number;
}

/* ---------------------------------------------------------------- 3D Model */

export type Model3DFormat = 'stl' | 'obj' | 'ply' | 'gltf' | 'glb';

export interface Model3DInfo {
  format: Model3DFormat;
  /** File size in bytes. */
  fileSize: number;
  /** Whether it's a binary format. */
  binary: boolean;
}

/* ---------------------------------------------------------------- Reading position */

export interface ReadingPosition {
  /** File path. */
  path: string;
  /** Chapter/page index. */
  index: number;
  /** Scroll offset within the chapter/page (0-1 normalized). */
  scrollOffset?: number;
  /** Last accessed timestamp. */
  lastReadMs: number;
}
