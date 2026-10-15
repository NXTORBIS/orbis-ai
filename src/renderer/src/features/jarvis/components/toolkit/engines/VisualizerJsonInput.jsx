import { Area } from '@jarvis/components/toolkit/shared';
import { Button } from '@jarvis/components/ui/button';

export default function VisualizerJsonInput({ value, onChange, description, example }) {
  return <details className="rounded-xl border border-border p-3">
    <summary className="cursor-pointer text-sm font-medium">Use your own numeric input</summary>
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted-foreground">{description} Paste JSON below, or leave it blank for the selected model. Calculation runs locally in your browser; presets and history are saved on this device.</p>
      <Area value={value} onChange={onChange} rows={6} mono placeholder={example || 'Paste supported JSON here'} />
      <div className="flex gap-2">
        {example && <Button type="button" variant="outline" size="sm" onClick={() => onChange(example)}>Load example</Button>}
        <Button type="button" variant="outline" size="sm" disabled={!value} onClick={() => onChange('')}>Use model instead</Button>
      </div>
    </div>
  </details>;
}