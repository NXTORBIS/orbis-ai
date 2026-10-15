/**
 * Background worker for the structure engines: one dispatch table for their calculations and
 * one for their verification suites, so nothing heavy runs on the interface thread.
 */

import { FUNCTIONS, locatedBranchPoints, monodromy, surfaceMesh, verifyRiemann } from '@jarvis/components/toolkit/engines/riemannCore';
import { PROGRAMS, criticalPath, sequential, simulate, verifyOoo } from '@jarvis/components/toolkit/engines/oooCore';
import { POLYNOMIALS, basinPath, basins, convergenceOrder, verifyBasin } from '@jarvis/components/toolkit/engines/basinCore';
import { FAMILIES, sampleField, singularities, verifyTensor } from '@jarvis/components/toolkit/engines/tensorCore';
import { SYSTEMS, backward, enumerateCorners, hull, polygonArea, reachable, sampleEndpoints, verifyReachability } from '@jarvis/components/toolkit/engines/reachabilityCore';
import { SCENARIOS, trace, verifyCausality } from '@jarvis/components/toolkit/engines/causalityCore';
import { ctAnalyze, verifyCt } from '@jarvis/components/toolkit/engines/ctCore';
import { tensorNetAnalyze, verifyTensorNet } from '@jarvis/components/toolkit/engines/tensorNetCore';
import { cncAnalyze, verifyCnc } from '@jarvis/components/toolkit/engines/cncCore';
import { traceAnalyze, verifyTrace } from '@jarvis/components/toolkit/engines/traceCore';

const numeric = (value, fallback, low, high) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, number));
};

const analyze = {
  ct: ctAnalyze,
  tensorNet: tensorNetAnalyze,
  cnc: cncAnalyze,
  distributedTrace: traceAnalyze,
  riemann: (p) => {
    const name = FUNCTIONS[p.function] ? p.function : 'sqrt';
    const radial = numeric(p.radial, 8, 4, 16);
    return {
      name,
      mesh: surfaceMesh(name, { radial, angular: 24, extent: 1.7, spread: 1.1 }),
      located: locatedBranchPoints(name),
      monodromy: FUNCTIONS[name].branchPoints.map((point) => ({ point, sheet: monodromy(name, point, 0.32) })),
      control: monodromy(name, FUNCTIONS[name].control, 0.3),
      sheets: FUNCTIONS[name].sheets,
      power: FUNCTIONS[name].power,
    };
  },
  ooo: (p) => {
    const name = PROGRAMS[p.program] ? p.program : 'chains';
    const program = PROGRAMS[name];
    const options = {
      issueWidth: numeric(p.issueWidth, 2, 1, 4),
      retireWidth: numeric(p.retireWidth, 2, 1, 4),
      rsSize: numeric(p.rsSize, 8, 1, 16),
      robSize: numeric(p.robSize, 12, 2, 32),
    };
    const timed = simulate(program, options);
    const narrow = simulate(program, { issueWidth: 1, retireWidth: 1, rsSize: 1, robSize: 4 });
    return {
      name,
      label: program.label,
      code: program.code,
      options,
      cycles: timed.cycles,
      ipc: timed.ipc,
      retired: timed.retired,
      regs: timed.regs,
      reference: sequential(program).regs,
      floor: criticalPath(program),
      narrowCycles: narrow.cycles,
      stalls: timed.stalls,
      peakRob: timed.peakRob,
      peakRs: timed.peakRs,
      lifecycle: timed.lifecycle,
      frames: timed.frames.map((frame) => ({ cycle: frame.cycle, robDepth: frame.robDepth, rsDepth: frame.rsDepth, commit: frame.commit.length, issue: frame.issue.length, stall: frame.stall })),
    };
  },
  basin: (p) => {
    const name = POLYNOMIALS[p.polynomial] ? p.polynomial : 'z3-1';
    const n = numeric(p.n, 256, 96, 512);
    const result = basins(name, { n });
    return {
      name,
      label: result.label,
      n: result.n,
      extent: result.extent,
      roots: result.roots,
      counts: result.counts,
      areas: result.areas,
      unresolved: result.unresolved,
      boundaryFraction: result.boundaryFraction,
      meanSteps: result.meanSteps,
      dimension: result.dimension.slope,
      scaleCounts: result.dimension.counts,
      index: Array.from(result.index),
      boundary: Array.from(result.boundary),
      order: convergenceOrder(name, 80).order,
    };
  },
  tensor: (p) => {
    const name = FAMILIES[p.family] ? p.family : 'node';
    const n = numeric(p.n, 40, 16, 72);
    const field = sampleField(name, { n, extent: 1 });
    return {
      name,
      label: field.label,
      note: field.note,
      n: field.n,
      extent: field.extent,
      cells: field.cells.map((cell) => ({ x: cell.x, y: cell.y, l1: cell.l1, l2: cell.l2, angle: cell.angle, magnitude: cell.magnitude, trace: cell.trace, det: cell.det, disc: cell.disc })),
      singularities: singularities(name, { n: Math.max(48, n), extent: 1 }),
    };
  },
  reachability: (p) => {
    const name = SYSTEMS[p.system] ? p.system : 'double-integrator';
    const system = SYSTEMS[name];
    const horizon = numeric(p.horizon, system.horizon, 2, 20);
    const forward = reachable(system, { steps: horizon });
    const backwardRegion = backward(system, { steps: horizon });
    const corners = enumerateCorners(system, Math.min(horizon, 14));
    return {
      name,
      system: { label: system.label, A: system.A, B: system.B, umax: system.umax, safe: system.safe, inputs: system.inputs },
      horizon,
      forward: { vertices: forward.vertices, area: polygonArea(forward.vertices), history: forward.history.map((step) => ({ step: step.step, area: step.area, vertices: step.vertices })) },
      backward: { vertices: backwardRegion.vertices, empty: backwardRegion.empty, history: backwardRegion.history.map((step) => ({ step: step.step, area: step.area, vertices: step.vertices })) },
      reference: { hull: hull(corners), points: corners.length, cloud: sampleEndpoints(system, horizon, 600) },
      offsets: forward.offsets,
    };
  },
  causality: (p) => {
    const name = SCENARIOS[p.scenario] ? p.scenario : 'late-delivery';
    const result = trace(name);
    return {
      name,
      label: result.scenario.label,
      procs: result.scenario.procs,
      events: result.events,
      pairs: result.pairs,
      concurrent: result.concurrent,
      layer: result.layer,
      inversions: result.inversions.length,
      totalOrder: result.totalOrder,
      closure: result.events.map((event) => [...result.reach[event.index]]),
    };
  },
};

const verify = {
  ct: verifyCt,
  tensorNet: verifyTensorNet,
  cnc: verifyCnc,
  distributedTrace: verifyTrace,
  riemann: () => verifyRiemann(),
  ooo: () => verifyOoo(),
  basin: () => verifyBasin(),
  tensor: () => verifyTensor(),
  reachability: () => verifyReachability(),
  causality: () => verifyCausality(),
};

self.onmessage = (event) => {
  try {
    const payload = event.data;
    if (payload.action === 'verify') {
      const runner = verify[payload.kind];
      if (!runner) throw new Error('Unknown verification suite.');
      const result = runner();
      self.postMessage({ result: { checks: result.checks } });
      return;
    }
    if (payload.action === 'probe') {
      if (payload.kind !== 'basin') throw new Error('Unknown probe.');
      const name = POLYNOMIALS[payload.polynomial] ? payload.polynomial : 'z3-1';
      if (![payload.x, payload.y].every(Number.isFinite)) throw new Error('That point is not on the map.');
      self.postMessage({ result: basinPath(name, [payload.x, payload.y]) });
      return;
    }
    const runner = analyze[payload.kind];
    if (!runner) throw new Error('Unknown calculation.');
    self.postMessage({ result: runner(payload) });
  } catch (issue) {
    self.postMessage({ error: issue.message });
  }
};