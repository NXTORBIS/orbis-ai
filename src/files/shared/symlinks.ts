/** Symlink manager types. */

export interface SymlinkInfo {
  /** Absolute path to the symlink itself. */
  path: string;
  /** What the symlink points to (as stored, may be relative). */
  target: string;
  /** Whether the target exists on disk. */
  exists: boolean;
  /** Whether the stored target is a relative path. */
  isRelative: boolean;
  /** Kind of the resolved target, or 'broken'. */
  kind: 'file' | 'dir' | 'broken';
}
