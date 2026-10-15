import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import { Play, Square, MapPin, Target, Eraser, Trash2, Shuffle, Grid3x3 } from 'lucide-react';

const key = (r, c) => `${r},${c}`;

// Interactive board editor for grid pathfinding algorithms.
// The user paints walls / sets start / sets end, then runs the algorithm.
export default function PathGridEditor({ grid, setGrid, onRun, algo }) {
  const [mode, setMode] = useState('wall');
  const [dragging, setDragging] = useState(false);
  const dragModeRef = useRef('add');

  const { rows, cols, start, end, walls } = grid;
  const wallSet = new Set(walls);

  const applyCell = useCallback((r, c) => {
    if (mode === 'start') { setGrid({ ...grid, start: { r, c }, walls: walls.filter((w) => w !== key(r, c)) }); return; }
    if (mode === 'end') { setGrid({ ...grid, end: { r, c }, walls: walls.filter((w) => w !== key(r, c)) }); return; }
    const k = key(r, c);
    if (r === start.r && c === start.c) return;
    if (r === end.r && c === end.c) return;
    if (mode === 'erase') { setGrid({ ...grid, walls: walls.filter((w) => w !== k) }); return; }
    // wall mode — toggle on first click, then drag continues same action
    if (dragModeRef.current === 'add') setGrid({ ...grid, walls: walls.includes(k) ? walls : [...walls, k] });
    else setGrid({ ...grid, walls: walls.filter((w) => w !== k) });
  }, [mode, grid, setGrid, start, end, walls]);

  const onCellDown = (r, c) => {
    if (mode === 'wall') {
      const k = key(r, c);
      dragModeRef.current = wallSet.has(k) ? 'remove' : 'add';
    }
    setDragging(true);
    applyCell(r, c);
  };
  const onCellEnter = (r, c) => { if (dragging && mode !== 'start' && mode !== 'end') applyCell(r, c); };

  const clearWalls = () => setGrid({ ...grid, walls: [] });
  const randomWalls = () => {
    const w = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (r === start.r && c === start.c) continue;
      if (r === end.r && c === end.c) continue;
      if (Math.random() < 0.28) w.push(key(r, c));
    }
    setGrid({ ...grid, walls: w });
  };
  const resetGrid = () => setGrid({ ...grid, walls: [], start: { r: 1, c: 1 }, end: { r: rows - 2, c: cols - 2 } });
  const resize = (field, val) => {
    const v = Math.max(5, Math.min(40, parseInt(val) || 10));
    const next = { ...grid, [field]: v };
    // keep start/end in bounds, drop out-of-bounds walls
    next.start = { r: Math.min(start.r, v - 1), c: Math.min(start.c, (field === 'cols' ? v : cols) - 1) };
    next.end = { r: Math.min(end.r, (field === 'rows' ? v : rows) - 1), c: Math.min(end.c, v - 1) };
    next.walls = next.walls.filter((w) => { const [r, c] = w.split(',').map(Number); return r < next.rows && c < next.cols; });
    setGrid(next);
  };

  const modeBtn = (m, icon, label) => (
    <Button size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setMode(m)} className="gap-1.5">{icon}{label}</Button>
  );

  const cellColor = (r, c) => {
    if (r === start.r && c === start.c) return 'bg-green-500 text-white';
    if (r === end.r && c === end.c) return 'bg-rose-500 text-white';
    if (wallSet.has(key(r, c))) return 'bg-zinc-700';
    return 'bg-secondary/50 hover:bg-secondary';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {modeBtn('wall', <Square className="h-4 w-4" />, 'Wall')}
        {modeBtn('start', <MapPin className="h-4 w-4" />, 'Start')}
        {modeBtn('end', <Target className="h-4 w-4" />, 'End')}
        {modeBtn('erase', <Eraser className="h-4 w-4" />, 'Erase')}
        <div className="w-px h-6 bg-border mx-1" />
        <Button size="sm" variant="outline" onClick={randomWalls} className="gap-1.5"><Shuffle className="h-4 w-4" /> Random</Button>
        <Button size="sm" variant="outline" onClick={clearWalls} className="gap-1.5"><Trash2 className="h-4 w-4" /> Clear</Button>
        <Button size="sm" variant="ghost" onClick={resetGrid} className="gap-1.5"><Grid3x3 className="h-4 w-4" /> Reset</Button>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">Rows</label>
          <Input type="number" value={rows} onChange={(e) => resize('rows', e.target.value)} className="w-16 h-8" />
          <label className="text-xs text-muted-foreground">Cols</label>
          <Input type="number" value={cols} onChange={(e) => resize('cols', e.target.value)} className="w-16 h-8" />
        </div>
        <Button size="sm" onClick={onRun} className="gap-1.5 ml-auto"><Play className="h-4 w-4" /> Run {algo?.name?.split(' ')[0]}</Button>
      </div>
      <div className="text-xs text-muted-foreground">
        {mode === 'wall' ? 'Click & drag to draw walls.' : mode === 'start' ? 'Click a cell to place the start.' : mode === 'end' ? 'Click a cell to place the end.' : 'Click & drag to erase walls.'}
      </div>
      <div
        className="rounded-xl border border-border/70 bg-card/40 p-3 overflow-auto select-none"
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        <div className="grid gap-px mx-auto" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: `${cols * 26}px` }}>
          {Array.from({ length: rows * cols }, (_, idx) => {
            const r = Math.floor(idx / cols), c = idx % cols;
            return (
              <div
                key={idx}
                onPointerDown={(e) => { e.preventDefault(); onCellDown(r, c); }}
                onPointerEnter={() => onCellEnter(r, c)}
                className={`aspect-square rounded-[3px] transition-colors ${cellColor(r, c)}`}
                style={{ touchAction: 'none' }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}