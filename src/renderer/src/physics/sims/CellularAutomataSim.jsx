// Cellular Automata — 1D elementary rules + 2D Game of Life
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CanvasStage, stageBg, TransportBar } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain } from '../research.jsx';
import { Button } from '../ui/button.jsx';

// 1D elementary CA: apply a rule number to a 3-cell neighborhood
function applyRule(cells, rule) {
  const n = cells.length;
  const next = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const left = cells[(i - 1 + n) % n];
    const center = cells[i];
    const right = cells[(i + 1) % n];
    const idx = (left << 2) | (center << 1) | right;
    next[i] = (rule >> idx) & 1;
  }
  return next;
}

const RULES = [30, 54, 90, 110, 150, 184, 60, 126];

// 2D Game of Life
function stepLife(grid, rows, cols) {
  const next = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = (r + dr + rows) % rows, cc = (c + dc + cols) % cols;
        n += grid[rr * cols + cc];
      }
      const idx = r * cols + c;
      if (grid[idx]) next[idx] = (n === 2 || n === 3) ? 1 : 0;
      else next[idx] = n === 3 ? 1 : 0;
    }
  }
  return next;
}

export default function CellularAutomataSim() {
  const [mode, setMode] = useState('1d');
  const [rule, setRule] = useState(30);
  const [running, setRunning] = useState(false);
  const canvasRef = useRef(null);
  const { explain, explaining, output } = useAIExplain();

  // 1D CA state
  const [ca1d, setCa1d] = useState(() => {
    const n = 200; const cells = new Array(n).fill(0); cells[Math.floor(n / 2)] = 1;
    return { cells, generations: [cells.slice()] };
  });

  // 2D Life state
  const [life, setLife] = useState(() => {
    const rows = 60, cols = 80;
    const grid = new Uint8Array(rows * cols);
    // random seed
    let r = 42; const rand = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
    for (let i = 0; i < rows * cols; i++) grid[i] = rand() < 0.3 ? 1 : 0;
    return { grid, rows, cols, gen: 0 };
  });

  // Animation loop for 1D
  useEffect(() => {
    if (mode !== '1d' || !running) return;
    const id = setInterval(() => {
      setCa1d((prev) => {
        const next = applyRule(prev.cells, rule);
        const gens = [...prev.generations, next];
        if (gens.length > 150) gens.shift();
        return { cells: next, generations: gens };
      });
    }, 80);
    return () => clearInterval(id);
  }, [mode, running, rule]);

  // Animation loop for 2D
  useEffect(() => {
    if (mode !== '2d' || !running) return;
    const id = setInterval(() => {
      setLife((prev) => ({ grid: stepLife(prev.grid, prev.rows, prev.cols), rows: prev.rows, cols: prev.cols, gen: prev.gen + 1 }));
    }, 100);
    return () => clearInterval(id);
  }, [mode, running]);

  // Draw
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    stageBg(ctx, w, h);
    if (mode === '1d') {
      const cellW = w / ca1d.cells.length;
      const rowH = h / 150;
      ca1d.generations.forEach((row, gi) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i]) { ctx.fillStyle = '#22d3ee'; ctx.fillRect(i * cellW, gi * rowH, cellW + 0.5, rowH + 0.5); }
        }
      });
    } else {
      const cellW = w / life.cols, cellH = h / life.rows;
      for (let r = 0; r < life.rows; r++) for (let c = 0; c < life.cols; c++) {
        if (life.grid[r * life.cols + c]) { ctx.fillStyle = '#22d3ee'; ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5); }
      }
    }
  }, [ca1d, life, mode]);

  const reset1d = () => { const n = 200; const cells = new Array(n).fill(0); cells[Math.floor(n / 2)] = 1; setCa1d({ cells, generations: [cells.slice()] }); };
  const reset2d = () => { const grid = new Uint8Array(life.rows * life.cols); let r = 42; const rand = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; }; for (let i = 0; i < grid.length; i++) grid[i] = rand() < 0.3 ? 1 : 0; setLife({ grid, rows: life.rows, cols: life.cols, gen: 0 }); };

  return (
    <div className="space-y-4">
      <ResearchHeader title="Cellular Automata — Elementary Rules & Game of Life"
        subtitle="1D elementary CA: 256 Wolfram rules from simple local updates. 2D Conway's Game of Life: emergent complexity from 4 rules. Both show how simple local rules produce global patterns."
        onExplain={() => explain(`${mode === '1d' ? `1D elementary CA rule ${rule}. Starting from a single live cell, rule ${rule} produces ${rule === 30 ? 'chaotic, aperiodic patterns (Wolfram class III)' : rule === 110 ? 'complex, Turing-complete behavior (class IV)' : 'structured patterns'}. Each row is one generation; time flows downward.` : `2D Game of Life, generation ${life.gen}. The 4 rules (underpopulation, survival, overpopulation, birth) produce gliders, oscillators, and still lifes from random initial conditions.`}`)}
        explaining={explaining} />
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setMode('1d')} className={`rounded-full px-3 py-1.5 text-xs ${mode === '1d' ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>1D Elementary CA</button>
        <button onClick={() => setMode('2d')} className={`rounded-full px-3 py-1.5 text-xs ${mode === '2d' ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>2D Game of Life</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Controls">
          {mode === '1d' ? (
            <label className="block text-sm"><span className="text-muted-foreground">Rule (0–255)</span>
              <select value={rule} onChange={(e) => { setRule(+e.target.value); reset1d(); }} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
                {RULES.map((r) => <option key={r} className="bg-background">Rule {r}</option>)}
              </select>
            </label>
          ) : (
            <div className="text-xs text-muted-foreground">Generation: {life.gen}<br />Grid: {life.rows}×{life.cols}<br />Rules: B3/S23</div>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant={running ? 'default' : 'outline'} onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Play'}</Button>
            <Button size="sm" variant="outline" onClick={mode === '1d' ? reset1d : reset2d}>Reset</Button>
          </div>
        </Card>
        <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 400 }}>
          <CanvasStage ref={canvasRef} />
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}