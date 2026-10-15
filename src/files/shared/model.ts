/**
 * Core domain types shared across the process boundary.
 */

/** Kind of filesystem object, determined from lstat (never from the extension). */
export type EntryKind = 'file' | 'directory' | 'symlink' | 'other';

export interface FileEntry {
  /** Absolute, normalised path. A path is a location, not a permanent identity. */
  path: string;
  name: string;
  kind: EntryKind;
  /** For symlinks: kind of the resolved target, or 'broken' if unresolved. */
  linkTargetKind?: EntryKind | 'broken';
  linkTarget?: string;
  /** Bytes. Undefined when unavailable (distinct from 0). */
  size?: number;
  modifiedMs?: number;
  createdMs?: number;
  accessedMs?: number;
  /** Lower-case extension without the dot; '' when none. Display hint only. */
  ext: string;
  hidden: boolean;
  readOnly?: boolean;
  /** Device + inode where the platform provides them; used for best-effort identity. */
  dev?: number;
  ino?: number;
  mode?: number;
  /** POSIX owner/group ids (undefined on Windows). */
  uid?: number;
  gid?: number;
  /** Space actually allocated on disk (blocks × 512) where the platform reports it. */
  allocatedBytes?: number;
  /** Set when lstat failed for this entry; the entry is still listed. */
  statError?: string;
  /** Search results only: a content: search matched text recognized in this image (OCR), with an excerpt. */
  textMatch?: { source: 'image-text'; snippet?: string };
}

/**
 * Typed location model. Filesystem directories are distinct from virtual
 * locations so the UI never treats a catalogue id as a path.
 */
export type Location =
  | { kind: 'fs'; path: string }
  | { kind: 'home' }
  | { kind: 'collection'; id: string }
  | { kind: 'search'; query: string; scope: string[] }
  | { kind: 'savedSearch'; id: string }
  /** `via` lists the outer archives when browsing an archive inside an archive; `rootDir` is the folder of the outermost one. */
  | { kind: 'archive'; archivePath: string; inner: string; via?: string[]; rootDir?: string }
  | { kind: 'library'; category: string }
  | { kind: 'project'; id: string }
  | { kind: 'tool'; tool: ToolId }
  /** A text file open in the built-in editor (shown in a pane like any other location). */
  | { kind: 'editor'; path: string }
  /** A folder on a remote connection (SFTP or WebDAV); `path` is an absolute POSIX path on the server. */
  | { kind: 'remote'; connectionId: string; path: string };

export type ToolId = 'storage' | 'duplicates' | 'compare' | 'sync' | 'operations' | 'downloads' | 'media' | 'rules' | 'settings' | 'integrations' | 'projects' | 'customize' | 'trash' | 'findReplace' | 'shares' | 'timeline' | 'backups' | 's3' | 'batchRename' | 'checksum' | 'diskUsage' | 'imageTools' | 'hexEditor' | 'contentSearch' | 'symlinks' | 'batchDate' | 'transfers' | 'pdfTools' | 'snippets' | 'conversionPipeline' | 'volumes' | 'recycleBin' | 'git' | 'hashCompare' | 'recentFiles' | 'cloudMount' | 'archiveManager' | 'macros' | 'folderWatch' | 'fileVersions' | 'universeExplorer' | 'folderDiff' | 'changeObservatory' | 'impactSimulator' | 'universeObservatory' | 'shortcutReference' | 'quickNotes' | 'systemInfo' | 'spaceCleaner' | 'textDiff' | 'colorPicker' | 'qrGenerator' | 'workspaceSessions' | 'tagManager';

export function locationKey(l: Location): string {
  switch (l.kind) {
    case 'fs': return `fs:${l.path}`;
    case 'home': return 'home';
    case 'collection': return `collection:${l.id}`;
    case 'search': return `search:${l.scope.join('|')}:${l.query}`;
    case 'savedSearch': return `savedSearch:${l.id}`;
    case 'archive': return `archive:${l.archivePath}!${l.inner}`;
    case 'library': return `library:${l.category}`;
    case 'project': return `project:${l.id}`;
    case 'tool': return `tool:${l.tool}`;
    case 'editor': return `editor:${l.path}`;
    case 'remote': return `remote:${l.connectionId}:${l.path}`;
  }
}

export interface KnownLocation {
  id: 'home' | 'desktop' | 'documents' | 'downloads' | 'pictures' | 'videos' | 'music';
  label: string;
  path: string;
}

export interface Volume {
  id: string;
  label: string;
  mountPath: string;
  fsType?: string;
  totalBytes?: number;
  freeBytes?: number;
  removable?: boolean;
  /** How the information was obtained; reported to the UI. */
  source: string;
}

export interface PlatformCapabilities {
  platform: NodeJS.Platform;
  trash: boolean;
  revealInFileManager: boolean;
  openWithDefaultApp: boolean;
  symlinkCreate: boolean;
  symlinkInspect: boolean;
  volumeEnumeration: boolean;
  watch: 'recursive' | 'shallow' | 'none';
  caseSensitivePaths: boolean;
  atomicRename: boolean;
  posixPermissions: boolean;
  notes: string[];
}

export type ThemeSetting = 'dark' | 'light' | 'system';
export type Density = 'compact' | 'comfortable' | 'spacious';
/** 'thumbnails' is the large-thumbnail grid (Customization → Typography & density → Thumbnail size). */
export type ViewMode = 'details' | 'list' | 'compact' | 'grid' | 'thumbnails' | 'gallery' | 'columns' | 'tree';

export interface SortSpec {
  key: 'name' | 'size' | 'modified' | 'created' | 'accessed' | 'type' | 'ext' | 'tags' | 'dimensions' | 'duration' | 'taken';
  dir: 'asc' | 'desc';
  foldersFirst: boolean;
}

export type GroupKey = 'none' | 'type' | 'modified' | 'created' | 'size' | 'kind' | 'tags';

/** Sort keys whose values come from embedded metadata (read on demand). */
export const META_SORT_KEYS: ReadonlySet<SortSpec['key']> = new Set(['dimensions', 'duration', 'taken']);

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: NodeJS.Platform;
  userDataPath: string;
  dbPath: string;
  logPath: string;
}

export interface StartupNotice {
  level: 'info' | 'warning' | 'error';
  message: string;
  detail?: string;
}
