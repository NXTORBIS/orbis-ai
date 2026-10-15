/**
 * Types for the Disk Usage Analyzer tool.
 */

export interface DiskNode {
  name: string;
  path: string;
  size: number;
  fileCount: number;
  children?: DiskNode[];
}

export interface DiskScanResult {
  root: string;
  tree: DiskNode;
  totalSize: number;
  totalFiles: number;
  totalDirs: number;
  largestFiles: Array<{ path: string; size: number }>;
  scannedMs: number;
}

export interface DiskScanProgress {
  files: number;
  dirs: number;
  bytes: number;
  current: string;
}
