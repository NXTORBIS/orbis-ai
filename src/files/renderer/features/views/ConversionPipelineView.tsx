import React, { useCallback, useMemo, useRef, useState } from 'react';
import { call, runJob, type JobHandle } from '../../api';
import { prompt as promptDialog, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane, selectedEntries, ws } from '../../state/workspace';
import { EmptyState, ProgressBar } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import type {
  ConversionStep, ConversionStepKind, PipelinePreset, PipelineProgress, PipelineResult,
} from '../../../shared/conversionPipeline';
import { IMAGE_FORMATS, ARCHIVE_FORMATS, stepLabel } from '../../../shared/conversionPipeline';

/* ────────────────────── helpers ────────────────────── */

let stepCounter = 0;
function uid(): string { return `step-${Date.now().toString(36)}-${++stepCounter}`; }

const STEP_KINDS: Array<{ kind: ConversionStepKind; label: string; icon: string }> = [
  { kind: 'image-format', label: 'Image format', icon: 'image' },
  { kind: 'archive-compress', label: 'Compress', icon: 'archive' },
  { kind: 'archive-decompress', label: 'Decompress', icon: 'extract' },
];

function defaultFormat(kind: ConversionStepKind): string {
  switch (kind) {
    case 'image-format': return 'png';
    case 'document-format': return 'txt';
    case 'archive-compress': return 'zip';
    case 'archive-decompress': return '';
  }
}

function formatsFor(kind: ConversionStepKind): readonly string[] {
  switch (kind) {
    case 'image-format': return IMAGE_FORMATS;
    case 'archive-compress': return ARCHIVE_FORMATS;
    default: return [];
  }
}

/* ────────────────────── step card ────────────────────── */

function StepCard({
  step, index, total, onRemove, onUpdate, onMoveUp, onMoveDown,
}: {
  step: ConversionStep;
  index: number;
  total: number;
  onRemove: () => void;
  onUpdate: (s: ConversionStep) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const formats = formatsFor(step.kind);
  const meta = STEP_KINDS.find((k) => k.kind === step.kind);
  return (
    <div className="pipeline-step" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}>
      <div className="pipeline-step-header">
        <span className="pipeline-step-num">{index + 1}</span>
        <Icon name={meta?.icon ?? 'convert'} size={16} />
        <span className="pipeline-step-label">{stepLabel(step)}</span>
        <span className="spacer" />
        <button type="button" className="btn-icon" onClick={onMoveUp} disabled={index === 0} title="Move up"><Icon name="up" size={14} /></button>
        <button type="button" className="btn-icon" onClick={onMoveDown} disabled={index === total - 1} title="Move down"><Icon name="down" size={14} /></button>
        <button type="button" className="btn-icon" onClick={onRemove} title="Remove step"><Icon name="close" size={14} /></button>
      </div>
      {formats.length > 0 && (
        <div className="pipeline-step-body">
          <label className="pipeline-field">
            <span>Format</span>
            <select value={step.targetFormat} onChange={(e) => onUpdate({ ...step, targetFormat: e.target.value })}>
              {formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

/* ────────────────────── main view ────────────────────── */

export function ConversionPipelineView() {
  const pane = useStore(ws, activePane);
  const sel = selectedEntries(pane.id);
  const paths = useMemo(() => sel.filter((e) => e.kind === 'file').map((e) => e.path), [sel]);

  const [steps, setSteps] = useState<ConversionStep[]>([]);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [running, setRunning] = useState(false);
  const [presets, setPresets] = useState<PipelinePreset[]>([]);
  const [outputDir, setOutputDir] = useState('');
  const jobRef = useRef<JobHandle<PipelineResult> | null>(null);

  // Load presets
  const loadPresets = useCallback(async () => {
    try {
      const p = await call<PipelinePreset[]>('pipeline:presets');
      setPresets(p);
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => { void loadPresets(); }, [loadPresets]);

  const addStep = useCallback((kind: ConversionStepKind) => {
    setSteps((prev) => [...prev, { id: uid(), kind, targetFormat: defaultFormat(kind) }]);
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateStep = useCallback((index: number, step: ConversionStep) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? step : s)));
  }, []);

  const moveStep = useCallback((from: number, to: number) => {
    setSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(from) && from !== targetIndex) moveStep(from, targetIndex);
  }, [moveStep]);

  const pickOutputDir = useCallback(async () => {
    const dir = await call<string | null>('fs:pickDirectory', { title: 'Output folder' });
    if (dir) setOutputDir(dir);
  }, []);

  const execute = useCallback(async () => {
    if (!paths.length || !steps.length || !outputDir) return;
    setRunning(true);
    setResult(null);
    setProgress(null);

    const job = runJob<PipelineResult>(
      (jobId) => call('pipeline:run', { sourcePaths: paths, steps, outputDir, jobId }),
      (p) => setProgress(p as PipelineProgress),
      'Conversion pipeline',
    );
    jobRef.current = job;

    try {
      const r = await job.promise;
      if (r.value) {
        setResult(r.value);
        toast({ level: r.value.errors.length ? 'warning' : 'success', title: r.value.errors.length ? `Pipeline completed with ${r.value.errors.length} error(s)` : `Pipeline completed: ${r.value.outputPaths.length} file(s)` });
      }
    } catch (err) {
      toastError(err, 'Pipeline failed');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [paths, steps, outputDir]);

  const saveAsPreset = useCallback(async () => {
    if (!steps.length) return;
    const name = await promptDialog({ title: 'Save pipeline preset', label: 'Preset name', initial: 'My pipeline', confirmLabel: 'Save' });
    if (name) {
      await call('pipeline:savePreset', { name, steps });
      void loadPresets();
      toast({ level: 'success', title: `Preset "${name}" saved` });
    }
  }, [steps, loadPresets]);

  const loadPreset = useCallback((preset: PipelinePreset) => {
    setSteps(preset.steps.map((s) => ({ ...s, id: uid() })));
  }, []);

  return (
    <div className="tool-view scroll-y pipeline-view">
      <header className="view-header">
        <h1><Icon name="convert" size={20} /> Conversion Pipeline</h1>
      </header>

      <section className="pipeline-section">
        <h2>Input files</h2>
        {paths.length ? (
          <p className="pipeline-info">{paths.length} file{paths.length !== 1 ? 's' : ''} selected</p>
        ) : (
          <EmptyState icon="file" title="Select files in the file list to convert" />
        )}
      </section>

      <section className="pipeline-section">
        <h2>Pipeline steps</h2>
        <div className="pipeline-add-buttons">
          {STEP_KINDS.map((k) => (
            <button key={k.kind} type="button" className="btn btn-default btn-sm" onClick={() => addStep(k.kind)}>
              <Icon name={k.icon} size={14} /> <span>{k.label}</span>
            </button>
          ))}
        </div>
        {steps.length === 0 ? (
          <p className="pipeline-info">Add steps to build your conversion pipeline.</p>
        ) : (
          <div className="pipeline-steps-list">
            {steps.map((step, i) => (
              <div key={step.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, i)}>
                <StepCard
                  step={step} index={i} total={steps.length}
                  onRemove={() => removeStep(i)}
                  onUpdate={(s) => updateStep(i, s)}
                  onMoveUp={() => moveStep(i, i - 1)}
                  onMoveDown={() => moveStep(i, i + 1)}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="pipeline-section">
        <h2>Output</h2>
        <div className="pipeline-output-row">
          <button type="button" className="btn btn-default btn-sm" onClick={pickOutputDir}>
            <Icon name="folder" size={14} /> <span>{outputDir || 'Choose output folder'}</span>
          </button>
        </div>
      </section>

      {progress && (
        <section className="pipeline-section">
          <h2>Progress</h2>
          <p className="pipeline-info">Step {progress.stepIndex + 1}/{progress.totalSteps}: {progress.stepLabel}{progress.currentFile ? ` — ${progress.currentFile}` : ''}</p>
          <ProgressBar value={progress.overallProgress * 100} label={`${Math.round(progress.overallProgress * 100)}%`} />
        </section>
      )}

      {result && (
        <section className="pipeline-section">
          <h2>Result</h2>
          <p className="pipeline-info">
            {result.outputPaths.length} output file{result.outputPaths.length !== 1 ? 's' : ''} in {(result.durationMs / 1000).toFixed(1)}s
            {result.errors.length > 0 && <span className="error-text"> ({result.errors.length} error{result.errors.length !== 1 ? 's' : ''})</span>}
          </p>
          {result.errors.map((err, i) => (
            <p key={i} className="error-text pipeline-error">Step {err.stepIndex + 1}: {err.message}</p>
          ))}
        </section>
      )}

      <section className="pipeline-section pipeline-actions">
        <button type="button" className="btn btn-accent" disabled={running || !paths.length || !steps.length || !outputDir} onClick={execute}>
          <Icon name="play" size={16} /> <span>{running ? 'Running…' : 'Run pipeline'}</span>
        </button>
        {running && (
          <button type="button" className="btn btn-default" onClick={() => jobRef.current?.cancel()}>
            <Icon name="close" size={16} /> <span>Cancel</span>
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn-default btn-sm" disabled={!steps.length} onClick={saveAsPreset}>
          <Icon name="save" size={14} /> <span>Save preset</span>
        </button>
      </section>

      {presets.length > 0 && (
        <section className="pipeline-section">
          <h2>Saved presets</h2>
          <div className="pipeline-presets">
            {presets.map((p) => (
              <button key={p.id} type="button" className="pipeline-preset" onClick={() => loadPreset(p)}>
                <span className="pipeline-preset-name">{p.name}</span>
                <span className="pipeline-preset-desc">{p.steps.length} step{p.steps.length !== 1 ? 's' : ''}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
