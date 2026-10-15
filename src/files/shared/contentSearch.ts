/** Types for regex content search (search inside files). */

export interface ContentSearchQuery {
  /** Search pattern (literal text or regex). */
  pattern: string;
  /** Treat pattern as a regular expression. */
  isRegex: boolean;
  /** Case-sensitive matching. */
  caseSensitive: boolean;
  /** Glob filter for filenames (e.g. "*.ts"). */
  fileFilter: string;
  /** Maximum number of results to return. */
  maxResults: number;
}

export interface ContentSearchMatch {
  path: string;
  /** 1-based line number. */
  line: number;
  /** 0-based column within the line. */
  column: number;
  /** Full text of the matching line. */
  lineText: string;
  /** The matched text itself. */
  matchText: string;
}

export interface ContentSearchProgress {
  /** Number of files scanned so far. */
  filesSearched: number;
  /** Current file being scanned. */
  currentFile: string;
  /** Total matches found so far. */
  matchCount: number;
  /** Matches found in this progress batch. */
  matches: ContentSearchMatch[];
}
