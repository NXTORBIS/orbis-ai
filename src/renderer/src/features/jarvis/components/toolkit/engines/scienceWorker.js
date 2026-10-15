import { analyzeQtaim, verifyQtaim } from '@jarvis/components/toolkit/engines/qtaimCore';
import { bands, brillouinZone, densityOfStates, diracCone, effectiveMass, specialPoints, verifyBrillouin, emptyBandEnergies, HBAR2_ME } from '@jarvis/components/toolkit/engines/brillouinCore';
import { RD_PRESETS, createGrid, dispersion, fieldStats, measureModeGrowth, seedMode, stableStep, stepGrid, turingThreshold } from '@jarvis/components/toolkit/engines/reactionDiffusionCore';
import { classifyPattern, powerSpectrum } from '@jarvis/components/toolkit/engines/rdSpectrum';
import { verifyReactionDiffusion } from '@jarvis/components/toolkit/engines/reactionDiffusionVerify';
let liveGrid = null, liveParams = null, liveAnalysis = null, history = [];
function snapshot() {
  const stats = fieldStats(liveGrid), spectrum = powerSpectrum(liveGrid);
  history.push({ x: liveGrid.t, y: stats.mean, rms: stats.rms }); history = history.slice(-300);
  return { u: liveGrid.u, v: liveGrid.v, n: liveGrid.n, t: liveGrid.t, stats, spectrum, history, analysis: liveAnalysis, dt: stableStep(liveGrid.model, liveParams), classification: classifyPattern(stats, spectrum) };
}
self.onmessage = event => {
  try {
    const p = event.data; let result;
    if (p.action === 'verify') {
      result = p.kind === 'qtaim' ? { checks: verifyQtaim().checks } : p.kind === 'brillouin' ? verifyBrillouin() : verifyReactionDiffusion();
      if (p.kind === 'brillouin') { const energy = emptyBandEnergies('sc', [0.1, 0, 0], { a: 3, count: 1 })[0], exact = HBAR2_ME / 2 * (0.1 * 2 * Math.PI / 3) ** 2; result.checks.push({ label: 'Free-electron branches use Å-to-eV units correctly', ok: Math.abs(energy - exact) < 1e-12, detail: `${energy.toFixed(6)} eV` }); }
    } else if (p.kind === 'qtaim') result = analyzeQtaim(p.molecule, { grid: p.grid });
    else if (p.kind === 'brillouin') {
      const { lattice, model, t, a } = p;
      if (![t, a].every(Number.isFinite) || t <= 0 || a <= 0) throw new Error('Use positive finite hopping and lattice spacing.');
      result = { zone: brillouinZone(lattice), points: specialPoints(lattice), band: bands(lattice, { model, t, a, bands: 4, per: 40 }), dos: densityOfStates(lattice, { model, t, a, n: model === 'empty-lattice' ? 12 : 24 }), mass: model === 'tight-binding' ? effectiveMass(lattice, { t, a }) : null, cone: model === 'graphene' ? diracCone({ t, a }) : null };
    } else if (p.action === 'rd-init') {
      const preset = RD_PRESETS[p.preset]; liveParams = p.params; liveGrid = createGrid(p.n, preset.model, liveParams, { kind: preset.kind, seed: p.seed });
      liveAnalysis = dispersion(preset.model, liveParams, { n: p.n }); history = [];
      if (p.initial === 'mode') seedMode(liveGrid, liveParams, liveAnalysis.peak.nx || 1, liveAnalysis.peak.ny, 1e-4);
      result = snapshot();
    } else if (p.action === 'rd-advance') { if (!liveGrid) throw new Error('Initialize the simulation first.'); stepGrid(liveGrid, liveParams, undefined, p.steps); result = snapshot(); }
    else if (p.action === 'rd-stimulate') {
      if (!liveGrid) throw new Error('Initialize the simulation first.');
      for (let y = 0; y < liveGrid.n; y++) for (let x = 0; x < liveGrid.n; x++) if (Math.hypot(x - p.x, y - p.y) < 4) { const c = y * liveGrid.n + x; liveGrid.u[c] = liveGrid.model === 'gray-scott' ? 0.5 : liveGrid.model === 'fitzhugh-nagumo' ? 1 : liveGrid.u[c] + 0.3; liveGrid.v[c] = liveGrid.model === 'gray-scott' ? 0.25 : liveGrid.v[c]; }
      result = snapshot();
    } else if (p.action === 'rd-growth') { const model = RD_PRESETS[p.preset].model, d = dispersion(model, p.params, { n: 32 }); if (d.homogeneous.im > 0 && d.peak.nx + d.peak.ny === 0) throw new Error('This equilibrium has oscillatory growth; use a Turing preset for a single real eigenmode comparison.'); result = { ...measureModeGrowth(model, p.params, { n: 32, mx: d.peak.nx || 1, my: d.peak.ny }), mode: [d.peak.nx || 1, d.peak.ny], threshold: turingThreshold(model, p.params, { n: 32 }) }; }
    else throw new Error('Unknown calculation.');
    self.postMessage({ result });
  } catch (issue) { self.postMessage({ error: issue.message }); }
};