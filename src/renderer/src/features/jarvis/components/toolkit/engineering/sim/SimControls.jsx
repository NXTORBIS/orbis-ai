import { ChevronLeft, ChevronRight, Pause, Play, Repeat, RotateCcw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { cn } from '@jarvis/lib/utils';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export default function SimControls({ api, unit = 's', digits = 2 }) {
  return (
    <div className="tk-glass-panel flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
      <Button size="sm" variant={api.running ? 'secondary' : 'default'} onClick={api.toggle} className="gap-1.5">
        {api.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {api.running ? 'Pause' : 'Run'}
      </Button>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="outline" aria-label="Step backwards" onClick={() => api.step(-1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="outline" aria-label="Step forwards" onClick={() => api.step(1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
      </div>
      <Button size="sm" variant={api.direction < 0 ? 'secondary' : 'outline'} onClick={() => api.setDirection(api.direction < 0 ? 1 : -1)} className="gap-1.5">
        <Repeat className={cn('h-3.5 w-3.5', api.direction < 0 && 'text-cyan-j')} />
        {api.direction < 0 ? 'Reverse' : 'Forward'}
      </Button>
      <Button size="sm" variant="outline" onClick={api.reset} className="gap-1.5"><RotateCcw className="h-3.5 w-3.5" />Reset</Button>
      <label className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
        Speed
        <select aria-label="Simulation speed" className="rounded-lg border border-border bg-card/60 px-2 py-1 text-xs" value={api.speed} onChange={(e) => api.setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
      <span className="font-mono-j text-xs text-cyan-j">{api.clock.toFixed(digits)} {unit}</span>
    </div>
  );
}