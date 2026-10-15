import { z } from 'zod';

/**
 * Color tags: assign colour labels to files and folders for visual organisation.
 */

export const COLOR_TAG_PRESETS = [
  { id: 'red', label: 'Red', hex: '#e53935' },
  { id: 'orange', label: 'Orange', hex: '#fb8c00' },
  { id: 'yellow', label: 'Yellow', hex: '#fdd835' },
  { id: 'green', label: 'Green', hex: '#43a047' },
  { id: 'blue', label: 'Blue', hex: '#1e88e5' },
  { id: 'purple', label: 'Purple', hex: '#8e24aa' },
  { id: 'gray', label: 'Gray', hex: '#757575' },
] as const;

export type PresetColorId = (typeof COLOR_TAG_PRESETS)[number]['id'];

export interface ColorTag {
  id: string;
  label: string;
  hex: string;
  createdMs: number;
}

export interface FileColorTag {
  path: string;
  tagId: string;
}

export const ColorTagCreateSchema = z.object({
  label: z.string().min(1).max(64),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type ColorTagCreate = z.infer<typeof ColorTagCreateSchema>;

export const ColorTagUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(64).optional(),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type ColorTagUpdate = z.infer<typeof ColorTagUpdateSchema>;
