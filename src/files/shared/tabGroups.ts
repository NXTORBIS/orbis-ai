/**
 * Tab group session types shared across the process boundary.
 */

export interface TabGroupSession {
  id: string;
  name: string;
  createdMs: number;
  groups: SavedTabGroup[];
}

export interface SavedTabGroup {
  name: string;
  color: string;
  collapsed: boolean;
  tabs: SavedTabEntry[];
}

export interface SavedTabEntry {
  /** Serialised Location (JSON). */
  location: string;
  pinned?: boolean;
}

export const TAB_GROUP_COLORS = [
  '#5caae8', '#4cc28f', '#e2b450', '#c79bf0', '#f0909f', '#7fd3b0',
  '#e07850', '#6bc5e8', '#b0b060', '#d87070',
] as const;

export const MAX_TAB_GROUP_SESSIONS = 50;
