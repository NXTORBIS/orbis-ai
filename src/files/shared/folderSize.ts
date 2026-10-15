/**
 * Folder size calculation types for the folder-size tool.
 */

export interface FolderSizeResult {
  path: string;
  totalSize: number;
  fileCount: number;
  dirCount: number;
  errors: string[];
}
