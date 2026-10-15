import { z } from 'zod';

/**
 * Image crop & rotate tool: shared types for the IPC boundary.
 */

export const CropRectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CropRect = z.infer<typeof CropRectSchema>;

export type FlipDirection = 'horizontal' | 'vertical';

export const ImageCropRotateSpecSchema = z.object({
  /** Source image path. */
  path: z.string().min(1).max(32767),
  /** Crop rectangle in source image coordinates (before rotation). */
  crop: CropRectSchema.optional(),
  /** Rotation in degrees (0, 90, 180, 270 for steps; or any value for free rotation). */
  rotateDeg: z.number().min(-360).max(360).default(0),
  /** Flip operations to apply after crop and rotation. */
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  /** Output format (inferred from source when omitted). */
  format: z.enum(['png', 'jpeg', 'webp']).optional(),
  /** JPEG/WebP quality (1-100). */
  quality: z.number().int().min(1).max(100).optional(),
});
export type ImageCropRotateSpec = z.infer<typeof ImageCropRotateSpecSchema>;

export interface ImageCropRotateResult {
  outputPath: string;
  width: number;
  height: number;
  bytes: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
  format: string;
}

export type AspectRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16' | '3:4' | '2:3';

export const ASPECT_RATIOS: Record<AspectRatio, number | null> = {
  'free': null,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
};
