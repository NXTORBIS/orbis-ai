/**
 * PDF Tools advanced types for the PDF tool view.
 */

export interface PdfMergeSpec {
  paths: string[];
  outputPath: string;
}

export interface PdfSplitSpec {
  path: string;
  /** Page ranges like "1-3,5,7-10". */
  ranges: string;
  outputDir: string;
}

export interface PdfRotateSpec {
  path: string;
  pages: 'all' | number[];
  degrees: 90 | 180 | 270;
}

export interface PdfExtractSpec {
  path: string;
  pages: number[];
  outputPath: string;
}

export interface PdfPageInfo {
  index: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PdfFileInfo {
  path: string;
  size: number;
  encrypted: boolean;
  pageCount: number;
  pages: PdfPageInfo[];
  title?: string;
}
