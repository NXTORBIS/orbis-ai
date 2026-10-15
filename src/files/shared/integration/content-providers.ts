/**
 * Content provider contract — version 1.
 *
 * A content provider exposes a family of items to the unified library without
 * Orbis Files needing to know how they are stored. Filesystem-backed sources
 * ship built in. Orbis-native content (notes, flowcharts, mind maps,
 * whiteboards, projects, simulations…) is provided by the Orbis desktop app
 * through this contract; until it registers, those categories report
 * `not_connected` and are never shown as available.
 */

export const CONTENT_CONTRACT_VERSION = '1.0.0';

export type ContentAvailability = 'available' | 'not_connected' | 'unavailable' | 'error';

export type ContentAction = 'open' | 'reveal' | 'edit_in_source' | 'export' | 'remove_reference' | 'delete_source' | 'tag' | 'collect';

export interface ContentProviderInfo {
  id: string;
  label: string;
  /** Item types this provider serves, e.g. "file", "download", "flowchart". */
  types: string[];
  availability: ContentAvailability;
  /** Where items live, shown to the user. */
  storage: 'filesystem' | 'application' | 'remote' | 'none';
  actions: ContentAction[];
  /** How removal works for this provider's items, in plain language. */
  removalSemantics: string;
  note?: string;
  builtIn: boolean;
}

export interface ContentItem {
  /** Stable identifier. Never assumed to be a filesystem path. */
  id: string;
  providerId: string;
  type: string;
  title: string;
  /** Present only when the item is (or is backed by) a real file. */
  path?: string;
  modifiedMs?: number;
  size?: number;
  source?: string;
  /** False when the referenced object can no longer be found. */
  present: boolean;
  /** For native content: whether it can be edited in its source application. */
  editable?: boolean;
  /** For native content: the orbis: link the Orbis app opens it with. */
  openUri?: string;
  description?: string;
}

/** Native Orbis content families the desktop app is expected to provide. */
export const ORBIS_NATIVE_TYPES = ['note', 'document', 'flowchart', 'diagram', 'mindmap', 'whiteboard', 'research_collection', 'saved_reference', 'task_plan', 'simulation', 'recording', 'template', 'bookmark', 'saved_page'] as const;
