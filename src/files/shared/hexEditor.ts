/** Types for the hex editor tool view. */

export interface HexViewData {
  /** Byte offset within the file. */
  offset: number;
  /** Chunk of bytes encoded as base64. */
  bytes: string;
  /** Total file size in bytes. */
  totalSize: number;
}

export interface HexEditOp {
  /** Byte offset to overwrite at. */
  offset: number;
  /** New bytes as base64. */
  bytes: string;
}

export interface HexSearchMatch {
  offset: number;
}

export interface HexSearchResult {
  matches: HexSearchMatch[];
  /** Whether the search was truncated. */
  truncated: boolean;
}
