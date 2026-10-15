import { z } from 'zod';

const pathStr = z.string().min(1).max(32767);
const idStr = z.string().min(1).max(128);

// Universe scan
export const UniverseScanSchema = z.object({
  root: pathStr,
  maxDepth: z.number().int().min(1).max(100).default(20),
  maxEntries: z.number().int().min(100).max(5_000_000).default(500_000),
  includeHidden: z.boolean().default(false),
});

export const UniverseQuerySchema = z.object({
  scanId: idStr,
  parent: pathStr.optional(),
  category: z.string().optional(),
  minSize: z.number().optional(),
  maxSize: z.number().optional(),
  ext: z.string().optional(),
  limit: z.number().int().min(1).max(10000).default(1000),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(['size', 'name', 'mtime_ms', 'depth']).default('size'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

// Map state
export const UniverseMapSaveSchema = z.object({
  name: z.string().min(1).max(200),
  scanId: idStr.optional(),
  root: pathStr,
  layout: z.string(),
  lens: z.string().default('structure'),
  viewport: z.string().default('{}'),
});

export const UniverseMapUpdateSchema = z.object({
  id: idStr,
  name: z.string().min(1).max(200).optional(),
  layout: z.string().optional(),
  lens: z.string().optional(),
  viewport: z.string().optional(),
});

// Annotations
export const UniverseAnnotateSchema = z.object({
  path: pathStr,
  note: z.string().min(1).max(10000),
  color: z.string().optional(),
  icon: z.string().optional(),
});

export const UniverseAnnotateUpdateSchema = z.object({
  id: idStr,
  note: z.string().min(1).max(10000).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
});

// Portals
export const UniversePortalSchema = z.object({
  name: z.string().min(1).max(200),
  location: z.string(),
  icon: z.string().optional(),
});

// Checkpoints
export const UniverseCheckpointSchema = z.object({
  mapId: idStr,
  name: z.string().min(1).max(200),
  state: z.string(),
});

// Folder diff
export const FolderDiffSchema = z.object({
  leftPath: pathStr,
  rightPath: pathStr,
  deep: z.boolean().default(true),
  compareContent: z.boolean().default(false),
  maxEntries: z.number().int().min(100).max(500_000).default(100_000),
});

// Change observatory
export const ChangeObservatorySchema = z.object({
  roots: z.array(pathStr).min(1).max(20),
  intervalMs: z.number().int().min(1000).max(3600000).default(5000),
});

// Impact simulator
export const ImpactSimulateSchema = z.object({
  paths: z.array(pathStr).min(1).max(1000),
  operation: z.enum(['delete', 'move', 'rename']),
  destination: pathStr.optional(),
});

// Lens types
export type UniverseLens = 'structure' | 'space' | 'type' | 'time' | 'connection' | 'change';
export const UNIVERSE_LENSES: UniverseLens[] = ['structure', 'space', 'type', 'time', 'connection', 'change'];
