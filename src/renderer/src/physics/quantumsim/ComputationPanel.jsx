import React from 'react';
import { Atom, CheckCircle2, XCircle, Cpu, Clock } from 'lucide-react';
import Section from './Section';
import { hamiltonianEquation } from '../quantum/spinEngine.js';

const STATUS_LABELS = {
  idle: 'Idle', building: 'Building Hamiltonian…', validating: 'Validating…',
  solving: 'Solving eigenvalue problem…', observables: 'Calculating observables…',
  complete: 'Complete', failed: 'Failed', cancelled: 'Cancelled',
};

export default function ComputationPanel({ params, validation, status, buildTime, result }) {
  const eq = hamiltonianEquation(params);
  const val = validation;
  const solver = result?.solverInfo;

  return (
    <Section title="Hamiltonian" icon={Atom} right={<StatusBadge status={status} />}>
      <div className="rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Generated equation</div>
        <div className="mt-1 font-mono text-sm text-foreground break-words">{eq}</div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Validation</div>
          {!val ? (
            <p className="text-xs text-muted-foreground">Build the Hamiltonian to validate.</p>
          ) : (
            <div className="space-y-1 text-xs">
              <Row k="Dimension" v={`${val.dimension} × ${val.dimension}`} />
              <Row k="Hermitian" v={val.hermitian ? '✓' : '✗'} warn={!val.hermitian} ok={val.hermitian} />
              <Row k="Max hermiticity error" v={val.maxErr.toExponential(2)} />
              <Row k="Non-zero elements" v={val.nnz.toLocaleString()} />
              <Row k="Sparsity" v={`${(val.sparsity * 100).toFixed(2)}%`} />
              {buildTime != null && <Row k="Construction time" v={`${buildTime.toFixed(1)} ms`} />}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Solver</div>
          {!solver ? (
            <p className="text-xs text-muted-foreground">Run the simulation for solver details.</p>
          ) : (
            <div className="space-y-1 text-xs">
              <Row k="Method" v={solver.method} />
              <Row k="Hilbert dimension" v={solver.D.toLocaleString()} />
              <Row k="Iterations" v={solver.iters} />
              <Row k="Runtime" v={`${solver.runtime.toFixed(1)} ms`} />
              <Row k="Ground-state residual" v={solver.residual.toExponential(2)} ok={solver.residual < 1e-6} />
              <Row k="Converged" v={solver.converged ? '✓ Yes' : '✗ No'} ok={solver.converged} />
              {solver.fullSpectrum && <Row k="Spectrum" v="Full (all eigenvalues)" />}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function Row({ k, v, warn, ok }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-mono ${warn ? 'text-amber-500' : ok ? 'text-emerald-500' : 'text-foreground'}`}>{v}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status;
  const color = status === 'complete' ? 'text-emerald-500' : status === 'failed' ? 'text-red-500' : status === 'idle' ? 'text-muted-foreground' : 'text-cyan-j';
  const Icon = status === 'complete' ? CheckCircle2 : status === 'failed' ? XCircle : status === 'idle' ? Cpu : Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${color}`}>
      {['building', 'validating', 'solving', 'observables'].includes(status) && <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-j/30 border-t-cyan-j" />}
      {status !== 'building' && status !== 'validating' && status !== 'solving' && status !== 'observables' && <Icon className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}