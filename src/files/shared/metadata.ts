/** Types for the metadata editor panel. */

export interface MetadataEntry {
  key: string;
  value: string;
  editable: boolean;
  group: MetadataGroup;
}

export type MetadataGroup = 'camera' | 'location' | 'image' | 'file' | 'audio' | 'document';

export interface MetadataResult {
  entries: MetadataEntry[];
  format: string;
  canWrite: boolean;
}
