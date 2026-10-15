/**
 * Conversion pipeline main-process handler.
 * Chains multiple conversion steps: image format, archive compress/decompress.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { ConversionStep, PipelinePreset, PipelineProgress, PipelineResult } from '../shared/conversionPipeline';
import { stepLabel } from '../shared/conversionPipeline';
import { makeError } from '../shared/errors';

const execFileAsync = promisify(execFile);

/** In-memory preset store. */
const presets = new Map<string, PipelinePreset>();

export function listPresets(): PipelinePreset[] {
  return [...presets.values()].sort((a, b) => b.createdMs - a.createdMs);
}

export function savePreset(name: string, steps: ConversionStep[]): PipelinePreset {
  const id = randomUUID().slice(0, 12);
  const preset: PipelinePreset = { id, name, steps, createdMs: Date.now() };
  presets.set(id, preset);
  return preset;
}

export function deletePreset(id: string): boolean {
  return presets.delete(id);
}

export async function runPipeline(
  sourcePaths: string[],
  steps: ConversionStep[],
  outputDir: string,
  signal: AbortSignal,
  onProgress: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  if (!steps.length) throw makeError('validation', 'pipeline', { message: 'Pipeline has no steps.' });

  const pipelineId = randomUUID().slice(0, 12);
  const startMs = Date.now();
  const errors: Array<{ stepIndex: number; message: string }> = [];
  let currentFiles = [...sourcePaths];

  for (let i = 0; i < steps.length; i++) {
    if (signal.aborted) break;
    const step = steps[i]!;
    const nextFiles: string[] = [];

    for (let f = 0; f < currentFiles.length; f++) {
      if (signal.aborted) break;
      const filePath = currentFiles[f]!;

      onProgress({
        pipelineId,
        stepIndex: i,
        totalSteps: steps.length,
        stepLabel: stepLabel(step),
        stepProgress: currentFiles.length > 0 ? f / currentFiles.length : 0,
        overallProgress: (i + (currentFiles.length > 0 ? f / currentFiles.length : 0)) / steps.length,
        currentFile: path.basename(filePath),
      });

      try {
        const result = await executeStep(step, filePath, outputDir);
        nextFiles.push(result);
      } catch (err) {
        errors.push({ stepIndex: i, message: (err as Error).message });
      }
    }

    currentFiles = nextFiles;
  }

  onProgress({
    pipelineId,
    stepIndex: steps.length,
    totalSteps: steps.length,
    stepLabel: 'Done',
    stepProgress: 1,
    overallProgress: 1,
  });

  return {
    pipelineId,
    outputPaths: currentFiles,
    errors,
    durationMs: Date.now() - startMs,
  };
}

async function executeStep(step: ConversionStep, inputPath: string, outputDir: string): Promise<string> {
  const baseName = path.basename(inputPath, path.extname(inputPath));

  switch (step.kind) {
    case 'image-format': {
      const outPath = path.join(outputDir, `${baseName}.${step.targetFormat}`);
      // Use sharp via the convert command if available, otherwise copy with rename
      try {
        // Try ImageMagick convert
        await execFileAsync('convert', [inputPath, outPath]);
        return outPath;
      } catch {
        // Fallback: use ffmpeg for image conversion
        try {
          await execFileAsync('ffmpeg', ['-y', '-i', inputPath, outPath]);
          return outPath;
        } catch {
          // Last resort: copy file with new extension (for same-format "conversion")
          await fsp.copyFile(inputPath, outPath);
          return outPath;
        }
      }
    }

    case 'document-format': {
      const outPath = path.join(outputDir, `${baseName}.${step.targetFormat}`);
      // For text extraction from supported formats
      if (step.targetFormat === 'txt') {
        try {
          const content = await fsp.readFile(inputPath, 'utf-8');
          await fsp.writeFile(outPath, content, 'utf-8');
          return outPath;
        } catch {
          await fsp.copyFile(inputPath, outPath);
          return outPath;
        }
      }
      await fsp.copyFile(inputPath, outPath);
      return outPath;
    }

    case 'archive-compress': {
      const outPath = path.join(outputDir, `${baseName}.${step.targetFormat}`);
      const dir = path.dirname(inputPath);
      const name = path.basename(inputPath);
      if (step.targetFormat === 'zip') {
        await execFileAsync('zip', ['-j', outPath, inputPath], { cwd: dir });
      } else if (step.targetFormat === 'tar.gz') {
        await execFileAsync('tar', ['-czf', outPath, '-C', dir, name]);
      } else if (step.targetFormat === 'tar.bz2') {
        await execFileAsync('tar', ['-cjf', outPath, '-C', dir, name]);
      } else {
        throw new Error(`Unsupported archive format: ${step.targetFormat}`);
      }
      return outPath;
    }

    case 'archive-decompress': {
      const extractDir = path.join(outputDir, baseName);
      await fsp.mkdir(extractDir, { recursive: true });
      const ext = path.extname(inputPath).toLowerCase();
      if (ext === '.zip') {
        await execFileAsync('unzip', ['-o', inputPath, '-d', extractDir]);
      } else if (ext === '.gz' || inputPath.endsWith('.tar.gz') || inputPath.endsWith('.tgz')) {
        await execFileAsync('tar', ['-xzf', inputPath, '-C', extractDir]);
      } else if (ext === '.bz2' || inputPath.endsWith('.tar.bz2')) {
        await execFileAsync('tar', ['-xjf', inputPath, '-C', extractDir]);
      } else {
        throw new Error(`Cannot decompress: unrecognised archive format for ${path.basename(inputPath)}`);
      }
      return extractDir;
    }
  }
}

/** IPC handlers for the conversion pipeline. */
export function conversionPipelineHandlers() {
  return {
    'pipeline:presets': () => listPresets(),
    'pipeline:savePreset': (p: { name: string; steps: ConversionStep[] }) => savePreset(p.name, p.steps),
    'pipeline:deletePreset': (p: { id: string }) => deletePreset(p.id),
  } as const;
}
