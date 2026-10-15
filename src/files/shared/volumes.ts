/**
 * Mounted volumes monitor types shared across the process boundary.
 */

export interface VolumeInfo {
  id: string;
  label: string;
  mountPath: string;
  fsType?: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  removable: boolean;
  usedPercent: number;
  source: string;
}

export interface VolumesSnapshot {
  volumes: VolumeInfo[];
  timestampMs: number;
}

export function usedPercent(total: number, free: number): number {
  if (total <= 0) return 0;
  return Math.round(((total - free) / total) * 1000) / 10;
}
