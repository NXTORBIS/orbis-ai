/**
 * Types for the Quick Look (spacebar preview) feature.
 */

export type QuickLookType = 'image' | 'video' | 'audio' | 'text' | 'pdf' | 'font' | 'unsupported';

export interface QuickLookData {
  type: QuickLookType;
  path: string;
  name: string;
  size: number;
  modifiedMs: number;
  /** Base64-encoded data URL for images, video poster, font sample, or PDF first page. */
  dataUrl?: string;
  /** Text content (first ~100 lines) for text/code files. */
  textContent?: string;
  /** Detected language for syntax highlighting. */
  language?: string;
  /** MIME type. */
  mime?: string;
  /** Font family name for font preview. */
  fontFamily?: string;
  /** Number of PDF pages. */
  pdfPages?: number;
}
