/**
 * Types for the Startup Dashboard feature.
 */

export interface DashboardDrive {
  name: string;
  mountpoint: string;
  totalBytes: number;
  freeBytes: number;
  fsType?: string;
}

export interface DashboardRecent {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  lastMs: number;
  exists: boolean;
}

export interface DashboardPin {
  path: string;
  label: string | null;
}

export interface DashboardData {
  recents: DashboardRecent[];
  pinned: DashboardPin[];
  drives: DashboardDrive[];
}
