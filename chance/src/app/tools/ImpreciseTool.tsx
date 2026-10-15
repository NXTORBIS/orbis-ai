/**
 * Imprecise probability: uncertainty beyond a single number.
 *
 * A single probability is a commitment to knowing the chance exactly. This
 * screen is the "possibility" half of the product: five formalisms that can
 * say "I do not know" without inventing a number, and a closing card on which
 * of them answers which question — they are routinely conflated.
 *
 * Every numeric result here comes from `src/engine/imprecise/`, carries the
 * engine's own `Provenance` (formalism, exactness, commitments) and is labelled
 * a BOUND wherever it is one. Nothing is renormalised or repaired in this
 * file: where the engine refuses an input, the refusal is rendered as the
 * result, because the refusal is the information.
 *
 * Performance: the whole screen must paint well inside the e2e budget, so the
 * two genuinely expensive computations — the n! vertex enumeration of the
 * credal set dominated by π, and the four-dependence p-box convolution over
 * the bucket grid — sit behind explicit buttons and default to off. Each mode's
 * memo also returns null unless that mode is selected, so switching sections
 * never pays for the others.
 */
import { useMemo } from 'react';
import {
  alphaCutOf,
  alphaCuts,
  bayesianMass,
  belief,
  beliefInterval,
  credalFromIntervals,
  DEPENDENCE_MEANING,
  dempsterCombine,
  disjunctiveCombine,
  dominatedProbabilityVertices,
  extensionPrinciple,
  FORMALISM_COMMITMENT,
  FORMALISM_QUESTION,
  fuzzyAdd,
  HIGH_CONFLICT,
  impreciseDirichlet,
  ivSub,
  makeMass,
  makePossibility,
  MAX_VERTEX_FRAME,
  naiveIntervalFunction,
  necessityOf,
  pboxAdd,
  pboxFromData,
  pboxFromIntervalParams,
  pboxFromMoments,
  quantileBound,
  plausibility,
  possibilityOf,
  probabilityBound,
  robustPosterior,
  subsetName,
  trapezoidalFuzzy,
  triangularFuzzy,
  uncertaintyMeasures,
  vacuousMass,
  yagerCombine,
  type Bound,
  type CombinationResult,
  type Dependence,
  type Formalism,
  type FuzzyNumber,
  type Labelled,
  type PBox,
  type Provenance,
} from '../../engine/imprecise';
import { EngineError, EXACTNESS_LABEL, type Explanation } from '../../engine/core/result';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  RawNumberInput,
  Segmented,
  SelectField,
  TextField,
} from '../../ui/primitives';
import { BarChart, LineChart } from '../../ui/charts/charts';
import { StepChart } from '../../ui/charts/advanced';
import { formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';
import type { ReportSection, ToolReportContent } from '../../persistence/report';

type Mode = 'possibility' | 'belief' | 'pbox' | 'credal' | 'fuzzy' | 'formalisms';

/** A focal set as entered: element labels plus the mass put on that set. */
interface FocalEntry {
  /** Element labels, comma separated, so the config stays flat and serialisable. */
  set: string;
  mass: number;
}

export interface ImpreciseConfig {
  mode: Mode;

  /* possibility theory */
  possOutcomes: string;
  possPi: number[];
  /** Bitmask of the event A whose Π and N are reported. */
  possEventMask: number;
  /** n! permutation enumeration of the dominated credal set: gated, see above. */
  runVertices: boolean;

  /* Dempster–Shafer */
  beliefOutcomes: string;
  source1: FocalEntry[];
  source2: FocalEntry[];
  beliefEventMask: number;

  /* probability boxes */
  pboxSource: 'interval-params' | 'moments' | 'data';
  muLo: number;
  muHi: number;
  sigmaLo: number;
  sigmaHi: number;
  mu2Lo: number;
  mu2Hi: number;
  sigma2Lo: number;
  sigma2Hi: number;
  momentMean: number;
  momentSd: number;
  dataText: string;
  ksLevel: number;
  pboxSteps: number;
  /** Four-dependence convolution over the bucket grid: gated, see above. */
  runDependence: boolean;

  /* credal sets and robust Bayes */
  credalOutcomes: string;
  credalLower: number[];
  credalUpper: number[];
  credalEventMask: number;
  likelihood: number[];
  idmCounts: number[];
  idmS: number;

  /* fuzzy numbers */
  fuzzyKind: 'triangular' | 'trapezoidal';
  fx: number[];
  fy: number[];
}

/**
 * Defaults chosen so that each section says something immediately: the
 * possibility distribution is a genuine ranking with a non-trivial Π/N gap,
 * the two belief sources ARE Zadeh's counterexample, and the credal section is
 * the "0 successes out of 10" question a single probability cannot answer.
 */
export const IMPRECISE_DEFAULT: ImpreciseConfig = {
  mode: 'possibility',

  possOutcomes: 'Low, Moderate, High, Severe',
  possPi: [0.3, 1, 0.7, 0.2],
  possEventMask: 0b1100,
  runVertices: false,

  beliefOutcomes: 'Meningitis, Concussion, Tumour',
  source1: [
    { set: 'Meningitis', mass: 0.99 },
    { set: 'Tumour', mass: 0.01 },
  ],
  source2: [
    { set: 'Concussion', mass: 0.99 },
    { set: 'Tumour', mass: 0.01 },
  ],
  beliefEventMask: 0b100,

  pboxSource: 'interval-params',
  muLo: 9,
  muHi: 11,
  sigmaLo: 1.5,
  sigmaHi: 2.5,
  mu2Lo: 4,
  mu2Hi: 6,
  sigma2Lo: 0.8,
  sigma2Hi: 1.4,
  momentMean: 10,
  momentSd: 2,
  dataText: '8.1, 9.4, 9.9, 10.2, 10.4, 11.1, 11.6, 12.3, 7.8, 10.8, 9.1, 12.9',
  ksLevel: 0.95,
  pboxSteps: 100,
  runDependence: false,

  credalOutcomes: 'Defective, Sound',
  credalLower: [0.1, 0.5],
  credalUpper: [0.5, 0.9],
  credalEventMask: 0b01,
  likelihood: [0.8, 0.2],
  idmCounts: [0, 10],
  idmS: 1,

  fuzzyKind: 'triangular',
  fx: [2, 5, 9, 11],
  fy: [1, 3, 4, 5],
};

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'possibility', label: 'Possibility' },
  { value: 'belief', label: 'Belief functions' },
  { value: 'pbox', label: 'Probability boxes' },
  { value: 'credal', label: 'Credal sets' },
  { value: 'fuzzy', label: 'Fuzzy numbers' },
  { value: 'formalisms', label: 'Which formalism?' },
];

const DEPENDENCES: Dependence[] = ['independent', 'comonotonic', 'countermonotonic', 'unknown'];

export function ImpreciseTool({ config }: { config: ImpreciseConfig }) {
  const app = useApp();
  const set = (patch: Partial<ImpreciseConfig>) => app.updateConfig({ ...config, ...patch });

  const possLabels = useMemo(() => parseLabels(config.possOutcomes), [config.possOutcomes]);
  const beliefLabels = useMemo(() => parseLabels(config.beliefOutcomes), [config.beliefOutcomes]);
  const credalLabels = useMemo(() => parseLabels(config.credalOutcomes), [config.credalOutcomes]);

  /* ------------------------------------------------ 1. possibility theory */

  const poss = useMemo(() => {
    if (config.mode !== 'possibility') return null;
    return attemptResult(() => {
      const dist = makePossibility(possLabels, config.possPi.slice(0, possLabels.length));
      const full = dist.frame.full;
      const mask = (config.possEventMask & full) || 1;
      const comp = full & ~mask;
      const pi = possibilityOf(dist, mask);
      const nec = necessityOf(dist, mask);
      // The duality is CHECKED here, not asserted: both sides are computed
      // from the engine independently and the residual is displayed.
      const dualityResidual = Math.abs(nec - (1 - possibilityOf(dist, comp)));
      // Maxitivity, shown on the two halves of the chosen event, so the user
      // can read Π(A∪B) = max(Π A, Π B) against the sum a probability would give.
      const bits: number[] = [];
      for (let i = 0; i < dist.frame.n; i++) if (mask & (1 << i)) bits.push(1 << i);
      const partA = bits.length > 1 ? bits[0] : mask;
      const partB = bits.length > 1 ? bits.slice(1).reduce((a, b) => a | b, 0) : comp || mask;
      const maxitive = {
        a: partA,
        b: partB,
        piA: possibilityOf(dist, partA),
        piB: possibilityOf(dist, partB),
        piUnion: possibilityOf(dist, partA | partB),
      };
      return {
        dist,
        mask,
        comp,
        interval: { lower: nec, upper: pi } as { lower: number; upper: number },
        dualityResidual,
        maxitive,
        cuts: alphaCuts(dist),
      };
    });
  }, [config.mode, config.possPi, config.possEventMask, possLabels]);

  const vertices = useMemo(() => {
    if (config.mode !== 'possibility' || !config.runVertices || !poss || !poss.ok) return null;
    return attemptResult(() => dominatedProbabilityVertices(poss.value.dist));
  }, [config.mode, config.runVertices, poss]);

  /* ------------------------------------------- 2. belief functions (Zadeh) */

  const bel = useMemo(() => {
    if (config.mode !== 'belief') return null;
    return attemptResult(() => {
      const m1 = makeMass(beliefLabels, config.source1.map((f) => ({ set: parseLabels(f.set), mass: f.mass })));
      const m2 = makeMass(beliefLabels, config.source2.map((f) => ({ set: parseLabels(f.set), mass: f.mass })));
      const mask = (config.beliefEventMask & m1.frame.full) || 1;
      const rules: { id: string; label: string; result: Labelled<CombinationResult> | null; error: string | null }[] = [
        { id: 'dempster', label: "Dempster's rule", ...tryRule(() => dempsterCombine(m1, m2, 'warn')) },
        { id: 'yager', label: "Yager's rule (conflict → Θ)", ...tryRule(() => yagerCombine(m1, m2)) },
        { id: 'disjunctive', label: 'Disjunctive rule (union)', ...tryRule(() => disjunctiveCombine(m1, m2)) },
      ];
      // The engine's own demonstration that "no evidence" and "conflicting
      // evidence" are different kinds of not-knowing with the same pignistic
      // probability: vacuous mass versus a uniform Bayesian mass.
      const ignorant = uncertaintyMeasures(vacuousMass(beliefLabels));
      const torn = uncertaintyMeasures(bayesianMass(beliefLabels, beliefLabels.map(() => 1 / beliefLabels.length)));
      return {
        m1,
        m2,
        mask,
        measures1: uncertaintyMeasures(m1),
        measures2: uncertaintyMeasures(m2),
        rules,
        ignorant,
        torn,
      };
    });
  }, [config.mode, config.source1, config.source2, config.beliefEventMask, beliefLabels]);

  /* --------------------------------------------------- 3. probability boxes */

  const data = useMemo(
    () =>
      config.dataText
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number),
    [config.dataText],
  );

  const boxes = useMemo(() => {
    if (config.mode !== 'pbox') return null;
    return attemptResult(() => {
      const steps = config.pboxSteps;
      // Normal tails are infinite; an explicit truncation is required for the
      // bounds to be drawable, and the engine reports it as a warning.
      const opts = { steps, tailTruncation: 0.005 };
      let primary: Labelled<PBox>;
      if (config.pboxSource === 'interval-params') {
        primary = pboxFromIntervalParams(
          'normal',
          { mu: { lo: config.muLo, hi: config.muHi }, sigma: { lo: config.sigmaLo, hi: config.sigmaHi } },
          opts,
        );
      } else if (config.pboxSource === 'moments') {
        primary = pboxFromMoments(config.momentMean, config.momentSd, opts);
      } else {
        if (data.some((x) => !Number.isFinite(x))) {
          throw new EngineError('The dataset contains a value that is not a number; every observation must be numeric.', 'finite');
        }
        primary = pboxFromData(data, config.ksLevel, { steps });
      }
      const second = pboxFromIntervalParams(
        'normal',
        { mu: { lo: config.mu2Lo, hi: config.mu2Hi }, sigma: { lo: config.sigma2Lo, hi: config.sigma2Hi } },
        opts,
      );
      return { primary, second };
    });
  }, [
    config.mode,
    config.pboxSource,
    config.muLo,
    config.muHi,
    config.sigmaLo,
    config.sigmaHi,
    config.mu2Lo,
    config.mu2Hi,
    config.sigma2Lo,
    config.sigma2Hi,
    config.momentMean,
    config.momentSd,
    config.ksLevel,
    config.pboxSteps,
    data,
  ]);

  const sums = useMemo(() => {
    if (config.mode !== 'pbox' || !config.runDependence || !boxes || !boxes.ok) return null;
    return attemptResult(() =>
      DEPENDENCES.map((d) => ({ dependence: d, sum: pboxAdd(boxes.value.primary.value, boxes.value.second.value, d) })),
    );
  }, [config.mode, config.runDependence, boxes]);

  /* ------------------------------------------- 4. credal sets, robust Bayes */

  const credal = useMemo(() => {
    if (config.mode !== 'credal') return null;
    return attemptResult(() => {
      const n = credalLabels.length;
      const lower = config.credalLower.slice(0, n);
      const upper = config.credalUpper.slice(0, n);
      const setL = credalFromIntervals(credalLabels, lower, upper);
      const mask = (config.credalEventMask & setL.value.frame.full) || 1;
      const prob = probabilityBound(setL.value, mask);
      const post = robustPosterior(setL.value, config.likelihood.slice(0, n), mask);
      const idm = impreciseDirichlet(credalLabels, config.idmCounts.slice(0, n).map((c) => Math.round(c)), config.idmS);
      return { setL, mask, prob, post, idm };
    });
  }, [config.mode, config.credalLower, config.credalUpper, config.credalEventMask, config.likelihood, config.idmCounts, config.idmS, credalLabels]);

  /* ------------------------------------------------------- 5. fuzzy numbers */

  const fuzzy = useMemo(() => {
    if (config.mode !== 'fuzzy') return null;
    return attemptResult(() => {
      const [a, b, c, d] = config.fx;
      const x = config.fuzzyKind === 'triangular' ? triangularFuzzy(a, b, c) : trapezoidalFuzzy(a, b, c, d);
      const [e, f, g, h] = config.fy;
      const y = config.fuzzyKind === 'triangular' ? triangularFuzzy(e, f, g) : trapezoidalFuzzy(e, f, g, h);
      const sum = fuzzyAdd(x, y);
      // The dependency problem, both routes, from the engine itself.
      const naive = naiveIntervalFunction(x, (occ) => ivSub(occ[0], occ[1]), 2);
      const correct = extensionPrinciple(x, (v) => v - v);
      return {
        x,
        y,
        sum,
        naive,
        correct,
        naiveCut: alphaCutOf(naive.value, 0),
        correctCut: alphaCutOf(correct.value, 0),
      };
    });
  }, [config.mode, config.fuzzyKind, config.fx, config.fy]);

  /**
   * The report contribution for this screen. Every result here is an interval
   * or a bound, so each one is handed over as a bound rather than as a
   * figure with an error bar: the report then says in words that no value
   * between the ends is a best guess. A formalism whose expensive part is
   * behind a button reports that it was not run, naming the button.
   */
  const buildReport = (): ToolReportContent => {
    const sections: ReportSection[] = [];
    const fromProvenance = (prov: Provenance) => ({
      exactness: prov.exactness,
      description: `Formalism: ${FORMALISM_LABEL[prov.formalism]}. The question this answers: ${prov.question}`,
      assumptions: prov.commitments,
      limitations: prov.notes,
    });

    if (config.mode === 'possibility') {
      if (!poss) sections.push({ title: 'Possibility theory', missing: 'The possibility section was not evaluated on this screen.' });
      else if (!poss.ok) sections.push({ title: 'Possibility theory', refusal: poss.error });
      else {
        const v = poss.value;
        const event = subsetName(v.dist.frame, v.mask);
        sections.push({
          title: `Possibility and necessity of ${event}`,
          ...fromProvenance(provenanceFor('possibility', 'exact')),
          intervals: [
            {
              label: `the probability of ${event}`,
              kind: 'bound',
              lower: v.interval.lower,
              upper: v.interval.upper,
              note: 'The lower end is the necessity N(A) and the upper end the possibility Π(A). The gap between them is ignorance, not variability.',
            },
          ],
          rows: [
            { label: 'Possibility Π(A)', value: v.interval.upper },
            { label: 'Necessity N(A)', value: v.interval.lower },
            { label: 'Gap Π(A) − N(A), what is not known', value: v.interval.upper - v.interval.lower },
            { label: 'Π(Aᶜ)', value: possibilityOf(v.dist, v.comp) },
            {
              label: 'Residual of the duality N(A) = 1 − Π(Aᶜ)',
              value: v.dualityResidual,
              note: 'both sides computed separately from π and compared, rather than assumed',
            },
            { label: 'Π(A ∪ B) by maxitivity', value: v.maxitive.piUnion, note: `max(Π A, Π B) = max(${formatValue(v.maxitive.piA, 6)}, ${formatValue(v.maxitive.piB, 6)})` },
          ],
          tables: [
            {
              caption: 'α-cuts of the possibility distribution',
              columns: ['α', 'Elements in the cut', 'Size of the cut'],
              rows: v.cuts.map((c) => [c.alpha, subsetName(v.dist.frame, c.mask), c.size]),
            },
          ],
        });
        if (!config.runVertices) {
          sections.push({
            title: 'Probability measures dominated by π',
            missing:
              'The vertex enumeration was not run: it sits behind the "Enumerate the vertices" button on the screen because it is a factorial enumeration. No vertices are reported.',
          });
        } else if (vertices && !vertices.ok) {
          sections.push({ title: 'Probability measures dominated by π', refusal: vertices.error });
        } else if (vertices?.ok) {
          sections.push({
            title: 'Probability measures dominated by π',
            ...fromProvenance(vertices.value.provenance),
            rows: [{ label: 'Extreme points enumerated', value: vertices.value.value.length }],
            tables: [
              {
                caption: 'Extreme points of the credal set dominated by π',
                columns: ['Vertex', ...poss.value.dist.frame.elements],
                rows: vertices.value.value.map((vx, i) => [i + 1, ...vx.map((x) => x)]),
              },
            ],
          });
        }
      }
    }

    if (config.mode === 'belief') {
      if (!bel) sections.push({ title: 'Belief functions', missing: 'The belief-function section was not evaluated on this screen.' });
      else if (!bel.ok) sections.push({ title: 'Belief functions', refusal: bel.error });
      else {
        const v = bel.value;
        const event = subsetName(v.m1.frame, v.mask);
        const iv = beliefInterval(v.m1, v.mask);
        sections.push({
          title: `Belief and plausibility of ${event}`,
          ...fromProvenance(iv.provenance),
          intervals: [
            {
              label: `the probability of ${event} on source 1's evidence`,
              kind: 'bound',
              lower: belief(v.m1, v.mask),
              upper: plausibility(v.m1, v.mask),
              note: 'The width Pl − Bel is ignorance about where inside the focal sets the truth lies. It is not an error bar around a best guess.',
            },
            {
              label: `the probability of ${event} on source 2's evidence`,
              kind: 'bound',
              lower: belief(v.m2, v.mask),
              upper: plausibility(v.m2, v.mask),
            },
          ],
          tables: [
            {
              caption: 'Belief, plausibility and the ignorance gap for each source',
              columns: ['Source', 'Bel(A)', 'Pl(A)', 'Pl − Bel'],
              rows: [
                ['Source 1', belief(v.m1, v.mask), plausibility(v.m1, v.mask), plausibility(v.m1, v.mask) - belief(v.m1, v.mask)],
                ['Source 2', belief(v.m2, v.mask), plausibility(v.m2, v.mask), plausibility(v.m2, v.mask) - belief(v.m2, v.mask)],
              ],
            },
            {
              caption: 'Non-specificity and discord (bits)',
              columns: ['Mass function', 'Non-specificity', 'Dissonance', 'Strife', 'Total'],
              rows: [
                ['Source 1', v.measures1.value.nonSpecificity, v.measures1.value.dissonance, v.measures1.value.strife, v.measures1.value.total],
                ['Source 2', v.measures2.value.nonSpecificity, v.measures2.value.dissonance, v.measures2.value.strife, v.measures2.value.total],
                ['Vacuous: no evidence at all', v.ignorant.value.nonSpecificity, v.ignorant.value.dissonance, v.ignorant.value.strife, v.ignorant.value.total],
                ['Uniform Bayesian: evidence split evenly', v.torn.value.nonSpecificity, v.torn.value.dissonance, v.torn.value.strife, v.torn.value.total],
              ],
              note: 'The last two rows have the same pignistic probability and are entirely different states of knowledge: one is pure non-specificity, the other pure discord.',
            },
          ],
          subsections: v.rules.map((r): ReportSection =>
            r.error || !r.result
              ? { title: `Combination: ${r.label}`, refusal: r.error ?? 'This rule produced no result.' }
              : {
                  title: `Combination: ${r.label}`,
                  ...fromProvenance(r.result.provenance),
                  rows: [
                    { label: 'Conflict mass K discarded or reassigned', value: r.result.value.conflict },
                    { label: `Bel(${event})`, value: belief(r.result.value.mass, v.mask) },
                    { label: `Pl(${event})`, value: plausibility(r.result.value.mass, v.mask) },
                    { label: 'Flagged pathological by the engine', value: r.result.value.pathological ? `yes — conflict at or above ${HIGH_CONFLICT}` : 'no' },
                  ],
                  tables: [
                    {
                      caption: `Focal sets after ${r.label}`,
                      columns: ['Focal set', 'Mass'],
                      rows: [...r.result.value.mass.focal].sort((a, b) => b.mass - a.mass).map((f) => [subsetName(v.m1.frame, f.mask), f.mass]),
                    },
                  ],
                  warnings: r.result.warnings,
                },
          ),
        });
      }
    }

    if (config.mode === 'pbox') {
      if (!boxes) sections.push({ title: 'Probability boxes', missing: 'The p-box section was not evaluated on this screen.' });
      else if (!boxes.ok) sections.push({ title: 'Probability boxes', refusal: boxes.error });
      else {
        const box = boxes.value.primary;
        sections.push({
          title: 'The bounding CDFs of this variable',
          ...fromProvenance(box.provenance),
          intervals: [0.1, 0.5, 0.9].map((q) => {
            const b = quantileBound(box.value, q);
            return {
              label: `the ${formatValue(q * 100, 3)}th percentile of this variable`,
              kind: 'bound' as const,
              lower: b.lower,
              upper: b.upper,
            };
          }),
          charts: [
            {
              title: 'Probability box',
              description: 'Two bounding CDFs. The true distribution function lies anywhere inside the band; no curve inside it is privileged.',
              table: {
                caption: 'Bucket bounds of the p-box',
                columns: ['Bucket', 'Lower quantile bound', 'Upper quantile bound', 'Cumulative probability at the top of the bucket'],
                rows: Array.from({ length: box.value.n }, (_, i) => [i + 1, box.value.lo[i], box.value.hi[i], (i + 1) / box.value.n]),
                note: 'An infinite endpoint means the bound is unbounded in that direction, which is why such buckets cannot be drawn on an axis.',
              },
            },
          ],
          warnings: box.warnings,
        });
        if (!config.runDependence) {
          sections.push({
            title: 'The sum X + Y under four dependence assumptions',
            missing:
              'The four dependence sums were not computed: they sit behind the "Compute the four sums" button on the screen because the unknown-dependence bounds are a convolution over the whole bucket grid. No sum bounds are reported, and none can be inferred from the two margins — that is precisely what the dependence assumption decides.',
          });
        } else if (sums && !sums.ok) {
          sections.push({ title: 'The sum X + Y under four dependence assumptions', refusal: sums.error });
        } else if (sums?.ok) {
          sections.push({
            title: 'The sum X + Y under four dependence assumptions',
            ...fromProvenance(sums.value[sums.value.length - 1].sum.provenance),
            tables: [
              {
                caption: 'Quantile bounds of each sum, and what each assumption claims',
                columns: ['Assumption', '10th percentile (bound)', 'Median (bound)', '90th percentile (bound)', 'Median width', 'What it claims'],
                rows: sums.value.map((r) => [
                  dependenceLabel(r.dependence),
                  boundText(quantileBound(r.sum.value, 0.1)),
                  boundText(quantileBound(r.sum.value, 0.5)),
                  boundText(quantileBound(r.sum.value, 0.9)),
                  quantileBound(r.sum.value, 0.5).width,
                  DEPENDENCE_MEANING[r.dependence],
                ]),
                note: 'The unknown-dependence box contains the other three, because it holds for every joint distribution with these margins. Independence is a substantive claim, never a neutral default.',
              },
            ],
            warnings: sums.value.flatMap((r) => r.sum.warnings.map((w) => `${dependenceLabel(r.dependence)}: ${w}`)),
          });
        }
      }
    }

    if (config.mode === 'credal') {
      if (!credal) sections.push({ title: 'Credal sets', missing: 'The credal-set section was not evaluated on this screen.' });
      else if (!credal.ok) sections.push({ title: 'Credal sets', refusal: credal.error });
      else {
        const v = credal.value;
        const event = subsetName(v.setL.value.frame, v.mask);
        sections.push({
          title: `Lower and upper probability of ${event}`,
          ...fromProvenance(v.prob.provenance),
          intervals: [
            {
              label: `the probability of ${event}`,
              kind: 'bound',
              lower: v.prob.lower,
              upper: v.prob.upper,
              note: `Taken over ${v.setL.value.vertices.length} extreme points of the credal set. Lower probability is super-additive and upper probability sub-additive: neither is itself a probability.`,
            },
          ],
          rows: [{ label: 'Width of the bound', value: v.prob.width }],
          warnings: v.setL.warnings,
        });
        sections.push({
          title: 'Robust Bayes: the posterior over a set of priors',
          ...fromProvenance(v.post.provenance),
          intervals: [
            {
              label: `the posterior probability of ${event}`,
              kind: 'bound',
              lower: v.post.value.posterior.lower,
              upper: v.post.value.posterior.upper,
              note: 'The width of this range is prior sensitivity: how much the conclusion rests on a choice of prior that cannot be justified exactly. Every single-prior posterior from a prior in the set falls inside it.',
            },
          ],
          tables: [
            {
              caption: 'The prior attaining each end of the posterior range',
              columns: ['Prior', ...v.setL.value.frame.elements],
              rows: [
                ['Attains the lower end', ...v.post.value.argmin.map((x) => x)],
                ['Attains the upper end', ...v.post.value.argmax.map((x) => x)],
              ],
            },
            {
              caption: 'Imprecise Dirichlet bounds per category',
              columns: ['Category', 'Lower bound', 'Upper bound', 'Width'],
              rows: v.idm.value.map((r) => [r.category, r.bound.lower, r.bound.upper, r.bound.width]),
              note: 'With a zero count the lower bound is exactly 0 and the upper bound is s/(N+s). Every rule that reports a single number instead picks a value inside this interval; the interval does not pick.',
            },
          ],
          warnings: v.post.warnings,
        });
      }
    }

    if (config.mode === 'fuzzy') {
      if (!fuzzy) sections.push({ title: 'Fuzzy numbers', missing: 'The fuzzy-number section was not evaluated on this screen.' });
      else if (!fuzzy.ok) sections.push({ title: 'Fuzzy numbers', refusal: fuzzy.error });
      else {
        const v = fuzzy.value;
        sections.push({
          title: 'Membership functions and the α-cut sum',
          ...fromProvenance(v.sum.provenance),
          tables: [
            {
              caption: 'α-cuts of X + Y',
              columns: ['α', 'Lower', 'Upper'],
              rows: [...v.sum.value.levels].reverse().map((l) => [l.alpha, l.lo, l.hi]),
              note: 'Each row is an interval at that membership level, not a distribution over it.',
            },
          ],
          charts: [
            {
              title: 'Membership of X, Y and X + Y',
              description: 'Membership degree against value.',
              table: {
                caption: 'Membership of X + Y',
                columns: ['Value', 'Membership α'],
                rows: membershipPoints(v.sum.value).map((pt) => [pt.x, pt.y]),
              },
            },
          ],
          warnings: v.sum.warnings,
        });
        sections.push({
          title: 'The dependency problem: X − X by two routes',
          ...fromProvenance(v.correct.provenance),
          tables: [
            {
              caption: 'X minus X at the support level α = 0',
              columns: ['Route', 'Interval at α = 0', 'Width', 'Correct?'],
              rows: [
                ['Naive interval arithmetic (each occurrence of X varies on its own)', boundText(v.naiveCut), v.naiveCut.width, 'Too wide — an outer bound, not the range'],
                ['α-cut extension principle (X treated as one quantity)', boundText(v.correctCut), v.correctCut.width, 'Exactly zero, as it must be'],
              ],
              note: 'A quantity minus itself is zero whatever its value. The first row is the classic symptom of the dependency problem, not a result to use.',
            },
          ],
          warnings: v.naive.warnings,
        });
      }
    }

    if (config.mode === 'formalisms') {
      sections.push({
        title: 'Which formalism answers which question',
        description: 'No figures are computed in this section of the screen: it records what each formalism claims. The engine supplies both columns.',
        explanation: OVERVIEW_EXPLANATION,
        tables: [
          {
            caption: 'The question each formalism answers, and what choosing it commits you to',
            columns: ['Formalism', 'The question it answers', 'What you commit to'],
            rows: ALL_FORMALISMS.map((f) => [FORMALISM_LABEL[f], FORMALISM_QUESTION[f], FORMALISM_COMMITMENT[f].join(' ')]),
          },
        ],
      });
    }

    return {
      sections,
      configNote:
        'Every interval on this screen is a bound. Where the bounds differ, no single number between them is more defensible than any other, and the width is the information: it is how much is not known.',
    };
  };

  return (
    <>
      <ToolHeader toolId="imprecise" report={buildReport} />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Uncertainty beyond a single probability">
            <p style={{ fontSize: 12.5, marginTop: 0 }}>
              A single probability is a commitment: it says the chance is <em>exactly</em> this. These five formalisms are the ones in which{' '}
              <strong>total ignorance is representable</strong> — something no single probability distribution can express. Each answers a slightly different
              question, so the last section records which.
            </p>
            <Segmented label="Formalism" value={config.mode} onChange={(mode) => set({ mode })} options={MODE_OPTIONS} />
          </Card>

          {config.mode === 'possibility' && (
            <Card title="Possibility distribution π">
              <TextField
                label="Outcomes"
                value={config.possOutcomes}
                onChange={(possOutcomes) => set({ possOutcomes })}
                hint="Comma-separated names. π is edited below, one degree per outcome."
              />
              <div style={{ overflowX: 'auto' }}>
                <table className="oc-table">
                  <caption className="sr-only">Possibility degree for each outcome</caption>
                  <thead>
                    <tr>
                      <th scope="col">Outcome</th>
                      <th scope="col" className="num">
                        π
                      </th>
                      <th scope="col">In the event A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {possLabels.map((label, i) => (
                      <tr key={label}>
                        <th scope="row">{label}</th>
                        <td className="num">
                          <RawNumberInput
                            value={config.possPi[i] ?? 0}
                            min={0}
                            max={1}
                            ariaLabel={`Possibility degree for ${label}`}
                            onChange={(v) => set({ possPi: replaceAt(config.possPi, i, v, possLabels.length) })}
                          />
                        </td>
                        <td>
                          <Checkbox
                            label={`Include ${label}`}
                            checked={(config.possEventMask & (1 << i)) !== 0}
                            onChange={(on) => set({ possEventMask: on ? config.possEventMask | (1 << i) : config.possEventMask & ~(1 << i) })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="oc-btn-row" style={{ flexWrap: 'wrap' }}>
                <Button onClick={() => set({ possPi: possLabels.map(() => 1) })}>Total ignorance (π ≡ 1)</Button>
                <Button onClick={() => set({ possPi: possLabels.map((_, i) => (i === 1 ? 1 : 0.9)) })}>Nearly uninformative</Button>
                <Button onClick={() => set({ possPi: possLabels.map((_, i) => (i === 1 ? 0.9 : 0.4)) })}>Unnormalised (sup π &lt; 1)</Button>
              </div>
              <Notice tone="info" title="Normalisation is not repaired for you">
                A possibility distribution must have sup π = 1. An unnormalised π encodes partial inconsistency — every outcome ruled out to some degree — so the
                engine refuses it and reports the actual supremum rather than rescaling and changing what you said.
              </Notice>
            </Card>
          )}

          {config.mode === 'belief' && (
            <Card title="Mass functions from two sources">
              <TextField
                label="Frame of discernment Θ"
                value={config.beliefOutcomes}
                onChange={(beliefOutcomes) => set({ beliefOutcomes })}
                hint="Comma-separated hypotheses. Mass is assigned to subsets of these."
              />
              <MassEditor
                title="Source 1"
                entries={config.source1}
                labels={beliefLabels}
                onChange={(source1) => set({ source1 })}
              />
              <MassEditor
                title="Source 2"
                entries={config.source2}
                labels={beliefLabels}
                onChange={(source2) => set({ source2 })}
              />
              <div className="oc-btn-row" style={{ flexWrap: 'wrap' }}>
                <Button
                  onClick={() =>
                    set({
                      beliefOutcomes: 'Meningitis, Concussion, Tumour',
                      source1: [
                        { set: 'Meningitis', mass: 0.99 },
                        { set: 'Tumour', mass: 0.01 },
                      ],
                      source2: [
                        { set: 'Concussion', mass: 0.99 },
                        { set: 'Tumour', mass: 0.01 },
                      ],
                      beliefEventMask: 0b100,
                    })
                  }
                >
                  Zadeh&apos;s counterexample
                </Button>
                <Button
                  onClick={() =>
                    set({
                      source1: [
                        { set: beliefLabels[0] ?? '', mass: 0.6 },
                        { set: beliefLabels.join(', '), mass: 0.4 },
                      ],
                      source2: [
                        { set: beliefLabels.slice(0, 2).join(', '), mass: 0.5 },
                        { set: beliefLabels.join(', '), mass: 0.5 },
                      ],
                    })
                  }
                >
                  Agreeing, partly uncommitted sources
                </Button>
              </div>
              <fieldset className="oc-field">
                <legend className="oc-field__label">Event A for Bel and Pl</legend>
                {beliefLabels.map((label, i) => (
                  <Checkbox
                    key={label}
                    label={label}
                    checked={(config.beliefEventMask & (1 << i)) !== 0}
                    onChange={(on) => set({ beliefEventMask: on ? config.beliefEventMask | (1 << i) : config.beliefEventMask & ~(1 << i) })}
                  />
                ))}
              </fieldset>
            </Card>
          )}

          {config.mode === 'pbox' && (
            <Card title="How the p-box is built">
              <SelectField
                label="Source of the bounds"
                value={config.pboxSource}
                onChange={(pboxSource) => set({ pboxSource })}
                options={[
                  { value: 'interval-params', label: 'Parametric family with interval parameters (normal)' },
                  { value: 'moments', label: 'Moment bounds only (distribution-free)' },
                  { value: 'data', label: 'Kolmogorov–Smirnov band around a dataset' },
                ]}
              />
              {config.pboxSource === 'interval-params' && (
                <>
                  <NumberField label="Mean μ, lower end of the interval" value={config.muLo} onChange={(muLo) => set({ muLo })} />
                  <NumberField label="Mean μ, upper end of the interval" value={config.muHi} onChange={(muHi) => set({ muHi })} />
                  <NumberField label="Standard deviation σ, lower end" value={config.sigmaLo} onChange={(sigmaLo) => set({ sigmaLo })} min={1e-9} />
                  <NumberField label="Standard deviation σ, upper end" value={config.sigmaHi} onChange={(sigmaHi) => set({ sigmaHi })} min={1e-9} />
                </>
              )}
              {config.pboxSource === 'moments' && (
                <>
                  <NumberField label="Mean" value={config.momentMean} onChange={(momentMean) => set({ momentMean })} />
                  <NumberField label="Standard deviation" value={config.momentSd} onChange={(momentSd) => set({ momentSd })} min={1e-9} />
                </>
              )}
              {config.pboxSource === 'data' && (
                <>
                  <TextField
                    label="Observations"
                    value={config.dataText}
                    onChange={(dataText) => set({ dataText })}
                    multiline
                    rows={4}
                    monospace
                    hint="Separated by commas or whitespace. The band is simultaneous over the whole CDF, not a per-quantile interval."
                  />
                  <NumberField label="Band confidence level" value={config.ksLevel} onChange={(ksLevel) => set({ ksLevel })} min={0.5} max={0.999} step={0.01} />
                </>
              )}
              <NumberField
                label="Probability buckets"
                value={config.pboxSteps}
                onChange={(pboxSteps) => set({ pboxSteps })}
                min={10}
                max={400}
                integer
                hint="Resolution of the quantile grid. The bounds are outer at any resolution."
              />
              <h3 style={{ fontSize: 13 }}>The second variable, for the sum</h3>
              <NumberField label="Second variable: μ lower" value={config.mu2Lo} onChange={(mu2Lo) => set({ mu2Lo })} />
              <NumberField label="Second variable: μ upper" value={config.mu2Hi} onChange={(mu2Hi) => set({ mu2Hi })} />
              <NumberField label="Second variable: σ lower" value={config.sigma2Lo} onChange={(sigma2Lo) => set({ sigma2Lo })} min={1e-9} />
              <NumberField label="Second variable: σ upper" value={config.sigma2Hi} onChange={(sigma2Hi) => set({ sigma2Hi })} min={1e-9} />
            </Card>
          )}

          {config.mode === 'credal' && (
            <Card title="Interval constraints on the distribution">
              <TextField
                label="Outcomes"
                value={config.credalOutcomes}
                onChange={(credalOutcomes) => set({ credalOutcomes })}
                hint="Comma-separated. Vertex enumeration is supported up to 7 outcomes."
              />
              <div style={{ overflowX: 'auto' }}>
                <table className="oc-table">
                  <caption className="sr-only">Interval probability table, likelihood and observed counts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Outcome</th>
                      <th scope="col" className="num">
                        P lower
                      </th>
                      <th scope="col" className="num">
                        P upper
                      </th>
                      <th scope="col" className="num">
                        P(data | ·)
                      </th>
                      <th scope="col" className="num">
                        Count
                      </th>
                      <th scope="col">In A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {credalLabels.map((label, i) => (
                      <tr key={label}>
                        <th scope="row">{label}</th>
                        <td className="num">
                          <RawNumberInput
                            value={config.credalLower[i] ?? 0}
                            min={0}
                            max={1}
                            ariaLabel={`Lower probability for ${label}`}
                            onChange={(v) => set({ credalLower: replaceAt(config.credalLower, i, v, credalLabels.length) })}
                          />
                        </td>
                        <td className="num">
                          <RawNumberInput
                            value={config.credalUpper[i] ?? 1}
                            min={0}
                            max={1}
                            ariaLabel={`Upper probability for ${label}`}
                            onChange={(v) => set({ credalUpper: replaceAt(config.credalUpper, i, v, credalLabels.length) })}
                          />
                        </td>
                        <td className="num">
                          <RawNumberInput
                            value={config.likelihood[i] ?? 1}
                            min={0}
                            ariaLabel={`Likelihood of the data given ${label}`}
                            onChange={(v) => set({ likelihood: replaceAt(config.likelihood, i, v, credalLabels.length) })}
                          />
                        </td>
                        <td className="num">
                          <RawNumberInput
                            value={config.idmCounts[i] ?? 0}
                            min={0}
                            ariaLabel={`Observed count for ${label}`}
                            onChange={(v) => set({ idmCounts: replaceAt(config.idmCounts, i, v, credalLabels.length) })}
                          />
                        </td>
                        <td>
                          <Checkbox
                            label={`Include ${label}`}
                            checked={(config.credalEventMask & (1 << i)) !== 0}
                            onChange={(on) => set({ credalEventMask: on ? config.credalEventMask | (1 << i) : config.credalEventMask & ~(1 << i) })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <NumberField
                label="IDM learning parameter"
                symbol="s"
                value={config.idmS}
                onChange={(idmS) => set({ idmS })}
                min={0.01}
                max={10}
                step={0.5}
                hint="s = 1 and s = 2 are the usual choices. It changes the width of the interval, never the lower bound at a zero count."
              />
            </Card>
          )}

          {config.mode === 'fuzzy' && (
            <Card title="Fuzzy quantities">
              <SelectField
                label="Shape"
                value={config.fuzzyKind}
                onChange={(fuzzyKind) => set({ fuzzyKind })}
                options={[
                  { value: 'triangular', label: 'Triangular (a ≤ b ≤ c)' },
                  { value: 'trapezoidal', label: 'Trapezoidal (a ≤ b ≤ c ≤ d)' },
                ]}
              />
              <VertexEditor
                name="X"
                values={config.fx}
                count={config.fuzzyKind === 'triangular' ? 3 : 4}
                onChange={(fx) => set({ fx })}
              />
              <VertexEditor
                name="Y"
                values={config.fy}
                count={config.fuzzyKind === 'triangular' ? 3 : 4}
                onChange={(fy) => set({ fy })}
              />
              <Notice tone="info" title="A membership degree is not a probability">
                μ(x) grades how compatible the value x is with a vague description. It does not integrate to 1 and it is not a frequency.
              </Notice>
            </Card>
          )}

          <AiAssistPanel
            capability="explainUncertainty"
            context="Imprecise probability: possibility and necessity, Dempster–Shafer belief and plausibility, p-boxes under different dependence assumptions, credal sets and fuzzy numbers. Every result here is a bound, not a point estimate."
          />
        </div>

        <div className="oc-stack">
          {/* 1. Possibility theory */}
          {config.mode === 'possibility' && poss && !poss.ok && (
            <Notice tone="error" title="The engine refused this possibility distribution">
              {poss.error}
            </Notice>
          )}
          {config.mode === 'possibility' && poss && poss.ok && (
            <>
              <Card title={`Possibility and necessity of ${subsetName(poss.value.dist.frame, poss.value.mask)}`}>
                <KeyValueList
                  items={[
                    { label: 'Possibility Π(A)', value: formatValue(poss.value.interval.upper, 6) },
                    { label: 'Necessity N(A)', value: formatValue(poss.value.interval.lower, 6) },
                    { label: 'Gap Π(A) − N(A) (what you do not know)', value: formatValue(poss.value.interval.upper - poss.value.interval.lower, 6) },
                    { label: 'Π(Aᶜ)', value: formatValue(possibilityOf(poss.value.dist, poss.value.comp), 6) },
                  ]}
                />
                <BoundNote />
                <Notice tone={poss.value.dualityResidual === 0 ? 'success' : 'warning'} title="The duality N(A) = 1 − Π(Aᶜ), checked">
                  N(A) and 1 − Π(Aᶜ) were computed separately from π and differ by {formatValue(poss.value.dualityResidual, 3)}. The two numbers are not
                  independent quantities: fixing one fixes the other.
                </Notice>
                {poss.value.interval.lower === 0 && poss.value.interval.upper === 1 && (
                  <Notice tone="info" title="This is total ignorance">
                    N(A) = 0 and Π(A) = 1 for every proper non-empty event. The distribution rules nothing out and supports nothing. No single probability
                    distribution can state this: assigning any numbers at all would claim knowledge you do not have.
                  </Notice>
                )}
                <ProvenanceBlock provenance={provenanceFor('possibility', 'exact')} />
              </Card>

              <Card title="Possibility is maxitive, not additive">
                <KeyValueList
                  items={[
                    { label: `Π(${subsetName(poss.value.dist.frame, poss.value.maxitive.a)})`, value: formatValue(poss.value.maxitive.piA, 6) },
                    { label: `Π(${subsetName(poss.value.dist.frame, poss.value.maxitive.b)})`, value: formatValue(poss.value.maxitive.piB, 6) },
                    { label: 'Π of the union, from the engine', value: formatValue(poss.value.maxitive.piUnion, 6) },
                    { label: 'max of the two', value: formatValue(Math.max(poss.value.maxitive.piA, poss.value.maxitive.piB), 6) },
                    { label: 'their sum, for contrast', value: formatValue(poss.value.maxitive.piA + poss.value.maxitive.piB, 6) },
                  ]}
                />
                <p className="oc-chart-note">
                  Π(A∪B) = max(Π A, Π B) even when A and B are disjoint. A probability would add. This single identity is what makes possibility theory a
                  different object rather than a rescaled probability, and it is why the numbers are ordinal: π = 0.6 is not &ldquo;60%&rdquo;.
                </p>
              </Card>

              <Card title="π and its α-cuts">
                <BarChart
                  title="Possibility degree of each outcome"
                  description="One bar per outcome; the height is π, the degree to which that outcome would be unsurprising."
                  data={poss.value.dist.pi.map((y, i) => ({ x: i, y, label: poss.value.dist.frame.elements[i] }))}
                  xLabel="Outcome"
                  yLabel="π"
                  seriesLabel="Possibility degree"
                />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Nested α-cuts of the possibility distribution"
                    columns={[
                      { key: 'a', header: 'α', numeric: true, render: (r) => formatValue(r.alpha, 4) },
                      { key: 's', header: 'Cut {ω : π(ω) ≥ α}', render: (r) => subsetName(poss.value.dist.frame, r.mask) },
                      { key: 'n', header: 'Size', numeric: true, render: (r) => String(r.size) },
                    ]}
                    rows={poss.value.cuts}
                  />
                </div>
                <p className="oc-chart-note">
                  The cuts are nested, which is exactly what makes a possibility distribution equivalent to a <em>consonant</em> belief function.
                </p>
              </Card>

              <Card title="The probabilities π dominates">
                {!config.runVertices && (
                  <>
                    <Notice tone="info" title="This one is expensive">
                      Enumerating the extreme points of the credal set {'{'}P : P(A) ≤ Π(A) for all A{'}'} needs all {possLabels.length}! permutations of the
                      frame ({factorialText(possLabels.length)} of them), so it is not run until you ask. The engine refuses above {MAX_VERTEX_FRAME} elements.
                    </Notice>
                    <Button onClick={() => set({ runVertices: true })}>Enumerate the vertices</Button>
                  </>
                )}
                {config.runVertices && (
                  <>
                    <Button onClick={() => set({ runVertices: false })}>Stop enumerating</Button>
                    {vertices && !vertices.ok && <Notice tone="error">{vertices.error}</Notice>}
                    {vertices && vertices.ok && (
                      <>
                        <p style={{ fontSize: 12.5 }}>
                          {vertices.value.value.length} extreme points. Lower and upper probabilities over this set coincide exactly with N and Π, which is the
                          precise sense in which π bounds a set of probabilities.
                        </p>
                        <div style={{ overflowX: 'auto' }}>
                          <DataTable
                            caption="Extreme points of the set of probability measures dominated by π"
                            columns={poss.value.dist.frame.elements.map((e, i) => ({
                              key: e,
                              header: e,
                              numeric: true,
                              render: (r: number[]) => formatValue(r[i], 4),
                            }))}
                            rows={vertices.value.value}
                            maxHeight={320}
                          />
                        </div>
                        <ProvenanceBlock provenance={vertices.value.provenance} />
                      </>
                    )}
                  </>
                )}
              </Card>
            </>
          )}

          {/* 2. Dempster–Shafer */}
          {config.mode === 'belief' && bel && !bel.ok && (
            <Notice tone="error" title="The engine refused these masses">
              {bel.error}
            </Notice>
          )}
          {config.mode === 'belief' && bel && bel.ok && (
            <>
              <Card title={`Belief and plausibility of ${subsetName(bel.value.m1.frame, bel.value.mask)}`}>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Belief, plausibility and the ignorance gap for each source"
                    columns={[
                      { key: 'src', header: 'Source', render: (r) => r.label },
                      { key: 'bel', header: 'Bel(A)', numeric: true, render: (r) => formatValue(belief(r.mass, bel.value.mask), 6) },
                      { key: 'pl', header: 'Pl(A)', numeric: true, render: (r) => formatValue(plausibility(r.mass, bel.value.mask), 6) },
                      {
                        key: 'gap',
                        header: 'Pl − Bel',
                        numeric: true,
                        render: (r) => formatValue(plausibility(r.mass, bel.value.mask) - belief(r.mass, bel.value.mask), 6),
                      },
                    ]}
                    rows={[
                      { label: 'Source 1', mass: bel.value.m1 },
                      { label: 'Source 2', mass: bel.value.m2 },
                    ]}
                  />
                </div>
                <BoundNote />
                <p className="oc-chart-note">
                  The width Pl − Bel is ignorance about where inside the focal sets the truth lies. It is not variability, and it is not an error bar around a
                  best guess: there is no best guess here.
                </p>
                <ProvenanceBlock provenance={beliefInterval(bel.value.m1, bel.value.mask).provenance} />
              </Card>

              <Card title="Conflicting evidence is not the same as no evidence">
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Non-specificity and discord for each mass function"
                    columns={[
                      { key: 'w', header: 'Mass function', render: (r) => r.label },
                      { key: 'ns', header: 'Non-specificity (bits)', numeric: true, render: (r) => formatValue(r.m.value.nonSpecificity, 4) },
                      { key: 'di', header: 'Dissonance (bits)', numeric: true, render: (r) => formatValue(r.m.value.dissonance, 4) },
                      { key: 'st', header: 'Strife (bits)', numeric: true, render: (r) => formatValue(r.m.value.strife, 4) },
                      { key: 'to', header: 'Total (bits)', numeric: true, render: (r) => formatValue(r.m.value.total, 4) },
                    ]}
                    rows={[
                      { label: 'Source 1', m: bel.value.measures1 },
                      { label: 'Source 2', m: bel.value.measures2 },
                      { label: 'Vacuous: no evidence at all', m: bel.value.ignorant },
                      { label: 'Uniform Bayesian: evidence split evenly', m: bel.value.torn },
                    ]}
                  />
                </div>
                <p className="oc-chart-note">
                  The last two rows have the same pignistic probability and are completely different states of knowledge: one is pure non-specificity (I know
                  nothing), the other pure discord (my evidence is torn). A single probability distribution cannot tell them apart; the pair of measures can.
                </p>
                <ProvenanceBlock provenance={bel.value.measures1.provenance} />
              </Card>

              <Card title="Combining the two sources: three rules, side by side">
                {bel.value.rules.map((r) => (
                  <section key={r.id} style={{ marginBottom: 'var(--s4)' }}>
                    <h3 style={{ fontSize: 13 }}>{r.label}</h3>
                    {r.error && <Notice tone="error">{r.error}</Notice>}
                    {r.result && (
                      <>
                        <KeyValueList
                          items={[
                            { label: 'Conflict mass K discarded or reassigned', value: formatValue(r.result.value.conflict, 6) },
                            { label: `Bel(${subsetName(bel.value.m1.frame, bel.value.mask)})`, value: formatValue(belief(r.result.value.mass, bel.value.mask), 6) },
                            { label: `Pl(${subsetName(bel.value.m1.frame, bel.value.mask)})`, value: formatValue(plausibility(r.result.value.mass, bel.value.mask), 6) },
                            {
                              label: 'Flagged pathological by the engine',
                              value: r.result.value.pathological ? `yes — K ≥ ${HIGH_CONFLICT}` : 'no',
                            },
                          ]}
                        />
                        <div style={{ overflowX: 'auto' }}>
                          <DataTable
                            caption={`Focal sets after ${r.label}`}
                            columns={[
                              { key: 's', header: 'Focal set', render: (f) => subsetName(bel.value.m1.frame, f.mask) },
                              { key: 'm', header: 'Mass', numeric: true, render: (f) => formatValue(f.mass, 6) },
                            ]}
                            rows={[...r.result.value.mass.focal].sort((a, b) => b.mass - a.mass)}
                          />
                        </div>
                        {r.result.value.pathological && (
                          <Notice tone="error" title="Zadeh's counterexample: this number is an artefact">
                            Two sources, each 99% confident in a different hypothesis, both treating a third as nearly impossible. Dempster&apos;s rule
                            renormalises by 1 − K = {formatValue(1 - r.result.value.conflict, 4)}, so that sliver of agreement — the hypothesis both sources
                            almost excluded — decides the entire answer, and comes out as near certainty. Compare the two rules below it before acting on
                            anything.
                          </Notice>
                        )}
                        {r.result.warnings.map((w, i) => (
                          <Notice key={i} tone="warning">
                            {w}
                          </Notice>
                        ))}
                        <ProvenanceBlock provenance={r.result.provenance} />
                      </>
                    )}
                  </section>
                ))}
                <p className="oc-chart-note">
                  Yager&apos;s rule moves the conflict to Θ (so strong disagreement produces an honest admission of ignorance rather than a sharp conclusion)
                  and the disjunctive rule takes unions (so it never excludes what either source allowed). Both buy that at a cost — Yager&apos;s rule is not
                  associative, the disjunctive rule is very uncommittal — and which you choose must be stated.
                </p>
              </Card>
            </>
          )}

          {/* 3. Probability boxes */}
          {config.mode === 'pbox' && boxes && !boxes.ok && (
            <Notice tone="error" title="The engine refused this p-box">
              {boxes.error}
            </Notice>
          )}
          {config.mode === 'pbox' && boxes && boxes.ok && (
            <>
              <Card title="The bounding CDFs">
                <StepChart
                  title="Probability box"
                  description="Two bounding CDFs. The true distribution function lies anywhere inside the shaded band; no curve inside it is privileged."
                  series={pboxSeries('This variable', boxes.value.primary.value)}
                  xLabel="Value"
                  yLabel="Cumulative probability"
                  note="The upper curve is F̄, the most probability that could lie at or below each value; the lower curve is F̲, the least."
                />
                {boxes.value.primary.warnings.map((w, i) => (
                  <Notice key={i} tone="warning">
                    {w}
                  </Notice>
                ))}
                <ProvenanceBlock provenance={boxes.value.primary.provenance} />
              </Card>

              <Card title="Arithmetic: the sum under four dependence assumptions">
                {!config.runDependence && (
                  <>
                    <Notice tone="info" title="This one is expensive">
                      The unknown-dependence bounds are a Williamson–Downs convolution over the whole bucket grid: four sums at {config.pboxSteps}² ≈{' '}
                      {(config.pboxSteps * config.pboxSteps).toLocaleString('en-US')} grid evaluations each, which is why it waits for a click rather than
                      freezing the page on open.
                    </Notice>
                    <Button onClick={() => set({ runDependence: true })}>Compute the four sums</Button>
                  </>
                )}
                {config.runDependence && (
                  <>
                    <Button onClick={() => set({ runDependence: false })}>Clear</Button>
                    {sums && !sums.ok && <Notice tone="error">{sums.error}</Notice>}
                    {sums && sums.ok && (
                      <>
                        <StepChart
                          title="X + Y under each dependence assumption"
                          description="Bounding CDFs of the sum. The unknown-dependence box contains all the others, because it assumes nothing about how the two variables move together."
                          series={sums.value.flatMap((s) => pboxSeries(dependenceLabel(s.dependence), s.sum.value, s.dependence !== 'unknown'))}
                          xLabel="Sum"
                          yLabel="Cumulative probability"
                          note="Toggle series in the legend. Dashed curves are the dependence-conditional results."
                        />
                        <div style={{ overflowX: 'auto' }}>
                          <DataTable
                            caption="Quantile bounds of each sum, and what each assumption claims"
                            columns={[
                              { key: 'd', header: 'Assumption', render: (r) => dependenceLabel(r.dependence) },
                              { key: 'q10', header: '10th percentile (bound)', render: (r) => boundText(quantileBound(r.sum.value, 0.1)) },
                              { key: 'q50', header: 'Median (bound)', render: (r) => boundText(quantileBound(r.sum.value, 0.5)) },
                              { key: 'q90', header: '90th percentile (bound)', render: (r) => boundText(quantileBound(r.sum.value, 0.9)) },
                              { key: 'w', header: 'Median width', numeric: true, render: (r) => formatValue(quantileBound(r.sum.value, 0.5).width, 5) },
                              { key: 'm', header: 'What it claims', render: (r) => DEPENDENCE_MEANING[r.dependence] },
                            ]}
                            rows={sums.value}
                          />
                        </div>
                        <Notice tone="info" title="The ordering the engine guarantees">
                          The unknown-dependence box is computed from the discrete Williamson–Downs / Fréchet bounds, which hold for <em>every</em> joint
                          distribution with these margins. It therefore contains the independent, comonotonic and countermonotonic results, and it is usually
                          far wider than any of them. That width is the honest answer when you do not know the dependence — it is necessity, not sloppiness.
                          Narrowing it needs evidence about the dependence, and independence is a substantive claim, never a neutral default.
                        </Notice>
                        {sums.value.flatMap((s) => s.sum.warnings.map((w) => `${dependenceLabel(s.dependence)}: ${w}`)).map((w, i) => (
                          <Notice key={i} tone="warning">
                            {w}
                          </Notice>
                        ))}
                        <ProvenanceBlock provenance={sums.value[sums.value.length - 1].sum.provenance} />
                      </>
                    )}
                  </>
                )}
              </Card>
            </>
          )}

          {/* 4. Credal sets */}
          {config.mode === 'credal' && credal && !credal.ok && (
            <Notice tone="error" title="The engine refused these assessments">
              {credal.error}
            </Notice>
          )}
          {config.mode === 'credal' && credal && credal.ok && (
            <>
              <Card title={`Lower and upper probability of ${subsetName(credal.value.setL.value.frame, credal.value.mask)}`}>
                <BoundView bound={credal.value.prob} />
                <p className="oc-chart-note">
                  Taken over {credal.value.setL.value.vertices.length} extreme points of the credal set. The set is convex, so every mixture of those vertices
                  is admissible too. Lower probability is super-additive and upper probability sub-additive: neither is itself a probability.
                </p>
                {credal.value.setL.warnings.map((w, i) => (
                  <Notice key={i} tone="warning">
                    {w}
                  </Notice>
                ))}
              </Card>

              <Card title="Robust Bayes: the posterior over a set of priors">
                <BoundView bound={credal.value.post.value.posterior} />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="The prior attaining each end of the posterior range"
                    columns={[
                      { key: 'w', header: 'Prior', render: (r) => r.label },
                      ...credal.value.setL.value.frame.elements.map((e, i) => ({
                        key: e,
                        header: e,
                        numeric: true,
                        render: (r: { label: string; p: readonly number[] }) => formatValue(r.p[i], 4),
                      })),
                    ]}
                    rows={[
                      { label: 'Attains the lower end', p: credal.value.post.value.argmin },
                      { label: 'Attains the upper end', p: credal.value.post.value.argmax },
                    ]}
                  />
                </div>
                <p className="oc-chart-note">
                  The width of that range is prior sensitivity: how much the conclusion rests on a choice of prior nobody can justify exactly. Every
                  single-prior Bayesian posterior from a prior inside this set falls inside this interval — and a tool that demands one exact prior reports one
                  number from it without showing that the others exist.
                </p>
                {credal.value.post.warnings.map((w, i) => (
                  <Notice key={i} tone="warning">
                    {w}
                  </Notice>
                ))}
                <ProvenanceBlock provenance={credal.value.post.provenance} />
              </Card>

              <Card title="The imprecise Dirichlet model: 0 out of n">
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Imprecise Dirichlet bounds per category"
                    columns={[
                      { key: 'c', header: 'Category', render: (r) => r.category },
                      { key: 'lo', header: 'Lower bound', numeric: true, render: (r) => formatValue(r.bound.lower, 6) },
                      { key: 'hi', header: 'Upper bound', numeric: true, render: (r) => formatValue(r.bound.upper, 6) },
                      { key: 'w', header: 'Width', numeric: true, render: (r) => formatValue(r.bound.width, 6) },
                    ]}
                    rows={credal.value.idm.value}
                  />
                </div>
                <BoundNote />
                <p className="oc-chart-note">
                  With a zero count the lower bound is <strong>exactly 0</strong> — nothing observed rules the event in — and the upper bound is s/(N+s), which
                  is strictly positive and shrinks as N grows. That is the principled answer to &ldquo;what is the probability when I have seen none?&rdquo;.
                  Laplace&apos;s, Jeffreys&apos;s and Haldane&apos;s rules each pick one number inside this interval as a consequence of an arbitrary prior;
                  the interval does not pick.
                </p>
                <ProvenanceBlock provenance={credal.value.idm.provenance} />
              </Card>
            </>
          )}

          {/* 5. Fuzzy numbers */}
          {config.mode === 'fuzzy' && fuzzy && !fuzzy.ok && (
            <Notice tone="error" title="The engine refused this fuzzy number">
              {fuzzy.error}
            </Notice>
          )}
          {config.mode === 'fuzzy' && fuzzy && fuzzy.ok && (
            <>
              <Card title="Membership functions and the α-cut sum">
                <LineChart
                  title="X, Y and X + Y"
                  description="Membership degree against value. The sum is computed interval-wise on matched α-cuts, which is exact for shaped fuzzy numbers under addition."
                  series={[
                    { label: 'X', points: membershipPoints(fuzzy.value.x) },
                    { label: 'Y', points: membershipPoints(fuzzy.value.y), dashed: true },
                    { label: 'X + Y', points: membershipPoints(fuzzy.value.sum.value) },
                  ]}
                  xLabel="Value"
                  yLabel="Membership α"
                  yDomain={[0, 1]}
                />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="α-cuts of X + Y"
                    columns={[
                      { key: 'a', header: 'α', numeric: true, render: (r) => formatValue(r.alpha, 4) },
                      { key: 'lo', header: 'Lower', numeric: true, render: (r) => formatValue(r.lo, 5) },
                      { key: 'hi', header: 'Upper', numeric: true, render: (r) => formatValue(r.hi, 5) },
                    ]}
                    rows={[...fuzzy.value.sum.value.levels].reverse()}
                    maxHeight={260}
                  />
                </div>
                <ProvenanceBlock provenance={fuzzy.value.sum.provenance} />
              </Card>

              <Card title="The dependency problem: X − X">
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="X minus X by two routes, at the support level α = 0"
                    columns={[
                      { key: 'r', header: 'Route', render: (r) => r.label },
                      { key: 'i', header: 'Interval at α = 0', render: (r) => `[${formatValue(r.b.lower, 5)}, ${formatValue(r.b.upper, 5)}]` },
                      { key: 'w', header: 'Width', numeric: true, render: (r) => formatValue(r.b.width, 5) },
                      { key: 'v', header: 'Correct?', render: (r) => r.verdict },
                    ]}
                    rows={[
                      {
                        label: 'Naive interval arithmetic (each occurrence of X varies on its own)',
                        b: fuzzy.value.naiveCut,
                        verdict: 'Too wide — an outer bound, not the range',
                      },
                      {
                        label: 'α-cut extension principle (X treated as one quantity)',
                        b: fuzzy.value.correctCut,
                        verdict: 'Exactly zero, as it must be',
                      },
                    ]}
                  />
                </div>
                <Notice tone="warning" title="Why the first row is wrong">
                  A quantity minus itself is zero whatever its value. Naive interval arithmetic lets the two occurrences of X move independently, so it reports
                  a non-degenerate interval — the classic symptom of the dependency problem. Propagating through the α-cuts of the single variable X gives
                  exactly {'{'}0{'}'}.
                </Notice>
                {fuzzy.value.naive.warnings.map((w, i) => (
                  <Notice key={i} tone="info">
                    {w}
                  </Notice>
                ))}
                <ProvenanceBlock provenance={fuzzy.value.correct.provenance} />
              </Card>
            </>
          )}

          {/* 6. Which formalism answers which question */}
          {config.mode === 'formalisms' && (
            <>
              <Card title="Which formalism answers which question">
                <p style={{ fontSize: 12.5, marginTop: 0 }}>
                  These are not five notations for the same thing. Each row is the question that formalism actually answers, taken from the engine&apos;s own{' '}
                  <code>Provenance</code>, which travels with every result on this screen.
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="The question each formalism answers"
                    columns={[
                      { key: 'f', header: 'Formalism', render: (r) => FORMALISM_LABEL[r] },
                      { key: 'q', header: 'The question it answers', render: (r) => FORMALISM_QUESTION[r] },
                    ]}
                    rows={ALL_FORMALISMS}
                  />
                </div>
              </Card>
              {ALL_FORMALISMS.map((f) => (
                <Card key={f} title={`What you commit to by choosing ${FORMALISM_LABEL[f]}`} variant="inset">
                  <Notice tone="info" items={FORMALISM_COMMITMENT[f]} />
                </Card>
              ))}
              <Card title="How the results on this screen are produced">
                <ExplanationPanel explanation={OVERVIEW_EXPLANATION} defaultOpen />
                <Notice tone="info" title="Every interval here is a bound">
                  There is deliberately no best guess inside any interval on this screen. If the bounds differ, no single number between them is more
                  defensible than any other, and the width is the information: it is how much you do not know.
                </Notice>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- helpers */

const ALL_FORMALISMS: Formalism[] = ['possibility', 'belief', 'pbox', 'credal', 'fuzzy'];

const FORMALISM_LABEL: Record<Formalism, string> = {
  possibility: 'possibility theory',
  belief: 'Dempster–Shafer belief functions',
  pbox: 'probability boxes',
  credal: 'credal sets and lower previsions',
  fuzzy: 'fuzzy numbers',
};

/**
 * The closing card's explanation. It describes the route every result on this
 * screen takes, which is a fact about this tool rather than about one
 * computation, so it is written here and not derived from a single engine call.
 */
const OVERVIEW_EXPLANATION: Explanation = {
  method: 'Imprecise probability: five formalisms, each evaluated exactly on its own terms',
  steps: [
    { label: 'Possibility and necessity', expression: 'Π(A) = sup_{ω∈A} π(ω),  N(A) = 1 − Π(Aᶜ)', value: 'computed from π, with the duality checked rather than assumed' },
    { label: 'Belief and plausibility', expression: 'Bel(A) = Σ_{B⊆A} m(B),  Pl(A) = Σ_{B∩A≠∅} m(B)', value: 'by zeta transform over the subset lattice' },
    { label: 'P-box arithmetic', expression: 'q̲_Z(p) = sup_{a≤p} (q_X(a) + q_Y(p−a))', value: 'discrete Williamson–Downs bounds for unknown dependence' },
    { label: 'Credal bounds', expression: 'min / max over the extreme points of the polytope', value: 'exact, because a linear functional attains its extrema at vertices' },
    { label: 'Fuzzy arithmetic', expression: 'f(A)_α = { f(x) : x ∈ A_α }', value: 'cut by cut, so a repeated variable does not inflate the result' },
  ],
  assumptions: [
    'Each frame of discernment is exhaustive: the truth is one of the listed elements.',
    'Nothing is assumed about dependence unless you select a dependence assumption, in which case the result is conditional on it.',
    'Inputs are taken as given. An unnormalised possibility distribution, a mass function that does not sum to 1 and an incoherent interval table are all refused rather than repaired.',
  ],
  limitations: [
    'The subset lattice is capped at a 20-element frame, vertex enumeration at 7 elements, and the permutation route at 7.',
    'A p-box constrains each point of the CDF separately and cannot express a joint constraint across several points.',
    'Possibility degrees are ordinal: only their ranking is claimed, so arithmetic on them has no probabilistic meaning.',
  ],
  exactness: 'exact',
};

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Engine calls throw `EngineError`; this turns a thrown refusal into a value to render. */
function attemptResult<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.message };
    return { ok: false, error: (e as Error).message };
  }
}

/** One combination rule may refuse (total conflict) while the others succeed. */
function tryRule(fn: () => Labelled<CombinationResult>): { result: Labelled<CombinationResult> | null; error: string | null } {
  try {
    return { result: fn(), error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

function parseLabels(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Keeps a numeric array the same length as the label list, with no holes. */
function replaceAt(arr: readonly number[], i: number, value: number, length: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < length; k++) out.push(k === i ? value : (arr[k] ?? 0));
  return out;
}

function factorialText(n: number): string {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f.toLocaleString('en-US');
}

function dependenceLabel(d: Dependence): string {
  switch (d) {
    case 'independent':
      return 'Independent';
    case 'comonotonic':
      return 'Comonotonic (perfect positive)';
    case 'countermonotonic':
      return 'Countermonotonic (perfect negative)';
    case 'unknown':
      return 'Unknown dependence (Fréchet bounds)';
  }
}

/** Provenance for a result the engine returns as a bare number pair. */
function provenanceFor(formalism: Formalism, exactness: Provenance['exactness']): Provenance {
  return {
    formalism,
    exactness,
    question: FORMALISM_QUESTION[formalism],
    commitments: FORMALISM_COMMITMENT[formalism],
    notes: [],
  };
}

/**
 * A p-box as two step curves. F̄ steps up at each lower quantile bound, F̲ at
 * each upper one; infinite buckets are dropped because an unbounded tail has
 * no position on the axis. The band between them is the box itself.
 */
function pboxSeries(label: string, box: PBox, dashed = false) {
  const upper: { x: number; y: number }[] = [];
  const lower: { x: number; y: number }[] = [];
  for (let i = 0; i < box.n; i++) {
    if (Number.isFinite(box.lo[i])) upper.push({ x: box.lo[i], y: (i + 1) / box.n });
    if (Number.isFinite(box.hi[i])) lower.push({ x: box.hi[i], y: i / box.n });
  }
  return [
    { label: `${label}: F̄ (upper CDF)`, points: upper, dashed },
    { label: `${label}: F̲ (lower CDF)`, points: lower, dashed: true },
  ];
}

/** Membership function as a polyline through the α-cut endpoints. */
function membershipPoints(fn: FuzzyNumber): { x: number; y: number }[] {
  const left = fn.levels.map((l) => ({ x: l.lo, y: l.alpha }));
  const right = [...fn.levels].reverse().map((l) => ({ x: l.hi, y: l.alpha }));
  return [...left, ...right];
}

/** A bound rendered as an interval, never as a single number. */
function boundText(b: Bound): string {
  return `[${formatValue(b.lower, 5)}, ${formatValue(b.upper, 5)}]`;
}

function BoundNote() {
  return (
    <p className="oc-chart-note">
      <strong>These are bounds, not a point estimate.</strong> No number between them is a best guess; there is no best guess.
    </p>
  );
}

function BoundView({ bound: b }: { bound: Bound }) {
  return (
    <>
      <div className="oc-result-hero">
        <span className="oc-result-hero__label">Bound (lower, upper)</span>
        <span className="oc-result-hero__value">
          [{formatValue(b.lower, 6)}, {formatValue(b.upper, 6)}]
        </span>
        <span className="oc-result-hero__detail">
          width {formatValue(b.width, 6)} · {EXACTNESS_LABEL[b.provenance.exactness]}
        </span>
      </div>
      <BoundNote />
      <ProvenanceBlock provenance={b.provenance} />
    </>
  );
}

/**
 * The engine's Provenance, shown in full: the formalism, its exactness label,
 * the question it answers and what accepting the result commits you to.
 */
function ProvenanceBlock({ provenance: p }: { provenance: Provenance }) {
  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--s2)' }}>
        <Badge variant={p.exactness}>{EXACTNESS_LABEL[p.exactness]}</Badge>
        <span style={{ fontSize: 12.5 }}>{FORMALISM_LABEL[p.formalism]}</span>
      </div>
      <p style={{ fontSize: 12.5, margin: 0 }}>
        <strong>The question this answers:</strong> {p.question}
      </p>
      {p.notes.length > 0 && <Notice tone="info" title="Notes on this computation" items={p.notes} />}
      <Notice tone="info" title="What you commit to by using this" items={p.commitments} />
    </div>
  );
}

/** Editor for one source's focal sets. Masses are never rescaled here. */
function MassEditor({
  title,
  entries,
  labels,
  onChange,
}: {
  title: string;
  entries: FocalEntry[];
  labels: string[];
  onChange(entries: FocalEntry[]): void;
}) {
  const total = entries.reduce((a, e) => a + e.mass, 0);
  return (
    <fieldset className="oc-field">
      <legend className="oc-field__label">{title}</legend>
      <div style={{ overflowX: 'auto' }}>
        <table className="oc-table">
          <caption className="sr-only">{`Focal sets and masses for ${title}`}</caption>
          <thead>
            <tr>
              <th scope="col">Focal set</th>
              <th scope="col" className="num">
                Mass
              </th>
              <th scope="col">Remove</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="oc-matrix-input"
                    value={e.set}
                    aria-label={`${title}: elements of focal set ${i + 1}`}
                    onChange={(ev) => onChange(entries.map((x, k) => (k === i ? { ...x, set: ev.target.value } : x)))}
                  />
                </td>
                <td className="num">
                  <RawNumberInput
                    value={e.mass}
                    min={0}
                    max={1}
                    ariaLabel={`${title}: mass on focal set ${i + 1}`}
                    onChange={(v) => onChange(entries.map((x, k) => (k === i ? { ...x, mass: v } : x)))}
                  />
                </td>
                <td>
                  <Button icon="trash" ariaLabel={`${title}: remove focal set ${i + 1}`} onClick={() => onChange(entries.filter((_, k) => k !== i))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="oc-btn-row" style={{ flexWrap: 'wrap' }}>
        <Button onClick={() => onChange([...entries, { set: labels[0] ?? '', mass: 0 }])}>Add a focal set</Button>
        <Button onClick={() => onChange([...entries, { set: labels.join(', '), mass: 0 }])}>Add mass on Θ (uncommitted)</Button>
      </div>
      <p className="oc-field__hint" style={{ marginBottom: 0 }}>
        Masses currently total {formatValue(total, 6)}. They must total exactly 1; the engine refuses anything else rather than rescaling, because putting the
        missing mass on Θ (&ldquo;the rest of my belief is uncommitted&rdquo;) is a different claim from rescaling what you gave.
      </p>
    </fieldset>
  );
}

/** Vertices of a triangular or trapezoidal fuzzy number. */
function VertexEditor({ name, values, count, onChange }: { name: string; values: number[]; count: number; onChange(v: number[]): void }) {
  const letters = ['a', 'b', 'c', 'd'];
  return (
    <fieldset className="oc-field">
      <legend className="oc-field__label">{`Fuzzy number ${name}`}</legend>
      <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
        {letters.slice(0, count).map((letter, i) => (
          <label key={letter} style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
            <span>{`${name}${letter}`}</span>
            <RawNumberInput
              value={values[i] ?? 0}
              ariaLabel={`Fuzzy number ${name}, vertex ${letter}`}
              onChange={(v) => onChange(replaceAt(values, i, v, 4))}
            />
          </label>
        ))}
      </div>
      <p className="oc-field__hint" style={{ marginBottom: 0 }}>
        The vertices must be non-decreasing; the engine refuses an out-of-order shape and says which pair is wrong.
      </p>
    </fieldset>
  );
}
