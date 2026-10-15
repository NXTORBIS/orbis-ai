import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';

/**
 * Draws the rolling samples a lab has recorded since the run started, so each graph is
 * built from the simulated motion itself rather than from a formula.
 */
export default function HistoryPlot({ history, defs, xLabel = 'Time (s)', yLabel, height = 200 }) {
  const series = defs
    .map((def) => ({
      label: def.label,
      points: history.xs.map((x, i) => ({ x, y: history.data[def.key]?.[i] })).filter((p) => Number.isFinite(p.y)),
    }))
    .filter((line) => line.points.length > 1);

  if (!series.length) {
    return <div className="grid h-32 place-items-center text-xs text-muted-foreground">Run the experiment to record a trace.</div>;
  }
  return <ScientificPlot series={series} xLabel={xLabel} yLabel={yLabel} height={height} />;
}