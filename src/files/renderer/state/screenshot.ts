import { createStore } from './store';
import type { Annotation, AnnotationTool, CaptureResult, CaptureSource } from '../../shared/screenshot';
import { DEFAULT_COLOR, DEFAULT_FONT_SIZE, DEFAULT_LINE_WIDTH } from '../../shared/screenshot';

/**
 * Screenshot annotator state. Manages the captured image, annotations,
 * undo/redo history, active tool, and tool settings. The annotator UI is
 * a full canvas overlay that renders when `captured` is set.
 */

export interface ScreenshotState {
  /** Whether the annotator is open. */
  open: boolean;
  /** The captured image data. */
  captured: CaptureResult | null;
  /** All annotations on the canvas (in order of creation). */
  annotations: Annotation[];
  /** Redo stack (cleared when a new annotation is added). */
  redoStack: Annotation[][];
  /** Undo stack (snapshots of the annotations array). */
  undoStack: Annotation[][];
  /** Currently active tool. */
  activeTool: AnnotationTool;
  /** Current drawing colour. */
  color: string;
  /** Current line width. */
  lineWidth: number;
  /** Current font size for text annotations. */
  fontSize: number;
  /** Whether shapes are filled. */
  filled: boolean;
  /** Canvas zoom level (1.0 = 100%). */
  zoom: number;
  /** Canvas pan offset. */
  panOffset: { x: number; y: number };
  /** Whether we are selecting a source (window picker). */
  showSourcePicker: boolean;
  /** Available capture sources. */
  sources: CaptureSource[];
  /** Active crop region (applied before export). */
  cropRegion: { x: number; y: number; width: number; height: number } | null;
}

const INITIAL: ScreenshotState = {
  open: false,
  captured: null,
  annotations: [],
  redoStack: [],
  undoStack: [],
  activeTool: 'arrow',
  color: DEFAULT_COLOR,
  lineWidth: DEFAULT_LINE_WIDTH,
  fontSize: DEFAULT_FONT_SIZE,
  filled: false,
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  showSourcePicker: false,
  sources: [],
  cropRegion: null,
};

export const screenshot = createStore<ScreenshotState>({ ...INITIAL });

/** Open the annotator with a captured image. */
export function openAnnotator(captured: CaptureResult): void {
  screenshot.set({
    open: true,
    captured,
    annotations: [],
    redoStack: [],
    undoStack: [],
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    cropRegion: null,
  });
}

/** Close the annotator and reset state. */
export function closeAnnotator(): void {
  screenshot.replace({ ...INITIAL });
}

/** Add an annotation and push the previous state to the undo stack. */
export function addAnnotation(annotation: Annotation): void {
  const s = screenshot.get();
  screenshot.set({
    annotations: [...s.annotations, annotation],
    undoStack: [...s.undoStack, s.annotations],
    redoStack: [],
  });
}

/** Remove the last annotation (undo). */
export function undo(): void {
  const s = screenshot.get();
  if (!s.undoStack.length) return;
  const prev = s.undoStack[s.undoStack.length - 1]!;
  screenshot.set({
    redoStack: [...s.redoStack, s.annotations],
    annotations: prev,
    undoStack: s.undoStack.slice(0, -1),
  });
}

/** Re-apply the last undone annotation (redo). */
export function redo(): void {
  const s = screenshot.get();
  if (!s.redoStack.length) return;
  const next = s.redoStack[s.redoStack.length - 1]!;
  screenshot.set({
    undoStack: [...s.undoStack, s.annotations],
    annotations: next,
    redoStack: s.redoStack.slice(0, -1),
  });
}

/** Set the active annotation tool. */
export function setTool(tool: AnnotationTool): void {
  screenshot.set({ activeTool: tool });
}

/** Set the drawing colour. */
export function setColor(color: string): void {
  screenshot.set({ color });
}

/** Set the line width. */
export function setLineWidth(width: number): void {
  screenshot.set({ lineWidth: width });
}

/** Set zoom level (clamped between 0.1 and 5). */
export function setZoom(zoom: number): void {
  screenshot.set({ zoom: Math.max(0.1, Math.min(5, zoom)) });
}

/** Update pan offset. */
export function setPan(x: number, y: number): void {
  screenshot.set({ panOffset: { x, y } });
}

/** Set the crop region. */
export function setCropRegion(region: { x: number; y: number; width: number; height: number } | null): void {
  screenshot.set({ cropRegion: region });
}
