import { z } from 'zod';

/**
 * Screenshot capture and annotation: types, schemas and helpers shared by the
 * main process (capture, region overlay, save) and the renderer (annotator
 * canvas, toolbar, undo/redo). Capture uses Electron's desktopCapturer and
 * nativeImage; annotation runs entirely in the renderer with Canvas 2D.
 */

/** Capture modes for the screenshot service. */
export type CaptureMode = 'fullscreen' | 'window' | 'region';

export const CaptureModeSchema = z.enum(['fullscreen', 'window', 'region']);

export const CaptureRequestSchema = z.object({
  mode: CaptureModeSchema,
  /** For 'window' mode: the desktopCapturer source id. */
  sourceId: z.string().max(256).optional(),
  /** For 'region' mode: pixel coordinates of the selected region. */
  region: z
    .object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      width: z.number().int().min(1).max(30000),
      height: z.number().int().min(1).max(30000),
    })
    .optional(),
});
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export const SaveRequestSchema = z.object({
  /** Base64-encoded PNG or JPEG data. */
  dataUrl: z.string().min(1).max(200_000_000),
  /** Where to save the file (absolute path). */
  destination: z.string().min(1).max(32767),
  /** Output format. */
  format: z.enum(['png', 'jpeg']).default('png'),
  /** JPEG quality (1-100). */
  quality: z.number().int().min(1).max(100).default(92),
});
export type SaveRequest = z.infer<typeof SaveRequestSchema>;

export const ListSourcesRequestSchema = z.object({
  types: z.array(z.enum(['screen', 'window'])).min(1).max(2),
});

/** Result of a capture operation. */
export interface CaptureResult {
  /** Base64-encoded PNG data URL of the captured image. */
  dataUrl: string;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/** A desktop capturer source for window/screen selection. */
export interface CaptureSource {
  id: string;
  name: string;
  /** Base64-encoded thumbnail data URL. */
  thumbnail: string;
}

// ---- Annotation types (renderer-only, but defined here for consistency) ----

export type AnnotationTool =
  | 'select'
  | 'arrow'
  | 'text'
  | 'rectangle'
  | 'circle'
  | 'freehand'
  | 'highlighter'
  | 'redact'
  | 'crop';

export interface Point {
  x: number;
  y: number;
}

export interface AnnotationBase {
  id: string;
  tool: AnnotationTool;
  color: string;
  lineWidth: number;
}

export interface ArrowAnnotation extends AnnotationBase {
  tool: 'arrow';
  start: Point;
  end: Point;
}

export interface TextAnnotation extends AnnotationBase {
  tool: 'text';
  position: Point;
  text: string;
  fontSize: number;
}

export interface RectAnnotation extends AnnotationBase {
  tool: 'rectangle';
  start: Point;
  end: Point;
  filled: boolean;
}

export interface CircleAnnotation extends AnnotationBase {
  tool: 'circle';
  center: Point;
  radiusX: number;
  radiusY: number;
  filled: boolean;
}

export interface FreehandAnnotation extends AnnotationBase {
  tool: 'freehand';
  points: Point[];
}

export interface HighlighterAnnotation extends AnnotationBase {
  tool: 'highlighter';
  points: Point[];
}

export interface RedactAnnotation extends AnnotationBase {
  tool: 'redact';
  start: Point;
  end: Point;
}

export interface CropAnnotation extends AnnotationBase {
  tool: 'crop';
  start: Point;
  end: Point;
}

export type Annotation =
  | ArrowAnnotation
  | TextAnnotation
  | RectAnnotation
  | CircleAnnotation
  | FreehandAnnotation
  | HighlighterAnnotation
  | RedactAnnotation
  | CropAnnotation;

/** Default annotation colours available in the toolbar. */
export const ANNOTATION_COLORS = [
  '#FF3B30', // Red
  '#FF9500', // Orange
  '#FFCC00', // Yellow
  '#34C759', // Green
  '#007AFF', // Blue
  '#AF52DE', // Purple
  '#FFFFFF', // White
  '#000000', // Black
] as const;

export const DEFAULT_LINE_WIDTH = 3;
export const DEFAULT_FONT_SIZE = 18;
export const DEFAULT_COLOR = '#FF3B30';
