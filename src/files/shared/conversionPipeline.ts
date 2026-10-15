/**
 * Conversion pipeline types shared across the process boundary.
 */

export type ConversionStepKind = 'image-format' | 'document-format' | 'archive-compress' | 'archive-decompress';

export interface ConversionStep {
  id: string;
  kind: ConversionStepKind;
  /** e.g. 'png', 'jpeg', 'webp', 'zip', 'tar.gz' */
  targetFormat: string;
  options?: Record<string, unknown>;
}

export interface ConversionPipeline {
  id: string;
  name: string;
  steps: ConversionStep[];
}

export interface PipelinePreset {
  id: string;
  name: string;
  steps: ConversionStep[];
  createdMs: number;
}

export interface PipelineProgress {
  pipelineId: string;
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  stepProgress: number;
  overallProgress: number;
  currentFile?: string;
}

export interface PipelineResult {
  pipelineId: string;
  outputPaths: string[];
  errors: Array<{ stepIndex: number; message: string }>;
  durationMs: number;
}

export const IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const;
export const ARCHIVE_FORMATS = ['zip', 'tar.gz', 'tar.bz2'] as const;

export function stepLabel(step: ConversionStep): string {
  switch (step.kind) {
    case 'image-format': return `Convert to ${step.targetFormat.toUpperCase()}`;
    case 'document-format': return `Convert to ${step.targetFormat.toUpperCase()}`;
    case 'archive-compress': return `Compress to ${step.targetFormat}`;
    case 'archive-decompress': return 'Decompress archive';
  }
}
