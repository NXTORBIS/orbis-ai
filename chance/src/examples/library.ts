/**
 * Worked examples and reusable templates.
 *
 * Every entry is a real, runnable configuration for an implemented tool — not
 * a screenshot or a description. Opening one creates a working investigation
 * with editable parameters.
 *
 * All data in these examples is either mathematically defined (dice, cards,
 * coins) or clearly labelled as illustrative figures chosen to demonstrate a
 * method. None of it is presented as a measurement of a real-world situation.
 */
import type { ToolId } from '../persistence/schema';

export interface Example {
  id: string;
  title: string;
  /** The question the example answers. */
  question: string;
  /** What the user will see and learn. */
  description: string;
  toolId: ToolId;
  /**
   * Fields that differ from the tool's own default configuration. The full
   * configuration is `{ ...default, ...configOverride }`, resolved when the
   * example is opened — storing the whole thing here would mean importing all
   * 25 tool modules, which pulls every screen into the first chunk and defeats
   * the code splitting.
   */
  configOverride: Record<string, unknown>;
  /** Assumptions recorded with the investigation. */
  assumptions: string[];
  category: string;
  /** Marked when the numbers are illustrative rather than measured. */
  synthetic: boolean;
  /** Difficulty, used to order the list. */
  level: 'introductory' | 'intermediate' | 'advanced';
}

/**
 * Default configurations used to live here as a static map, which imported
 * from all 25 tool modules and so pulled every screen into the first chunk.
 * They are loaded on demand instead — see `loadDefaultConfig` in
 * `src/app/tools/lazy.ts`.
 */

/* ------------------------------------------------------------------ *
 * Data for the worked examples below. Every one of these is generated
 * from a rule stated in the example that uses it, so the result can be
 * read against the truth that produced it. None of it is a measurement.
 * ------------------------------------------------------------------ */

/** Thirty rows generated from y = 3 + 1.8·x1 − 0.9·x2 + N(0, 1.5²), so the fit can be read against the rule that produced it. */
const REGRESSION_LINEAR_DATA = `x1,x2,y
3.91,0.91,8.88
5.82,2.19,11.03
1.52,3.04,4.56
1.63,0.54,5.82
4.82,4.96,7.97
6.65,5.69,10.6
6.19,2.38,12.46
8.73,1.74,17.08
2.3,0.71,5.51
2.63,3.49,7.17
6.75,2.23,12.63
1.54,1.24,4.5
7.12,2.57,12.72
5.08,1.8,12.36
8.15,4.19,13.97
5.73,5.25,10.55
7.57,1.73,15.82
4.76,4.54,7.39
2.37,2.93,6.79
7.88,3.44,14.63
8.88,1.88,16.61
6.22,2.74,9.83
8.56,5.67,11.12
1.55,4.21,2.36
6.82,5.96,10.45
4.47,4.01,6.33
1.2,2.77,3.04
1.53,4.61,2.26
2.16,1.49,3.19
1.73,2.7,5.61`;

/** Nineteen rows generated from y = 20 + 0.5·x + N(0, 1.2²) over x ∈ [2, 12], plus one point at x = 40 far outside that range. */
const REGRESSION_LEVERAGE_DATA = `x,y
7.49,25.4
10.64,23.84
4.78,21.42
10.84,25.99
11.58,26.23
4.32,22.77
4.33,20.57
4.63,22.47
2.04,20.01
7.66,24.39
11.53,25.24
8.18,22.75
8.76,26.81
9.8,25.76
10.75,25.73
5.99,21.85
3.04,21.23
2.67,21.01
4.09,22.62
40.0,68.0`;

/** Forty-five values drawn from a log-normal distribution with meanlog 3.2 and sdlog 0.6 — a family a Weibull fit will track closely in the body of the data. */
const FIT_SKEWED_SAMPLE = `8.4
10.1
10.5
11.1
11.1
11.3
11.8
11.8
12.4
15.3
15.4
18.0
19.9
20.6
20.6
20.8
22.1
23.1
23.2
23.6
23.6
23.8
24.6
26.0
26.1
26.8
27.8
27.9
28.9
30.6
30.8
32.6
32.7
36.5
37.2
37.4
37.5
40.7
44.2
44.6
47.4
47.4
61.6
114.7
177.7`;

/** Four groups of twelve, every value drawn from the same Normal(500, 20²): there is no difference between the lines to find. */
const NO_EFFECT_GROUPS = `543.4, Line A
477.8, Line A
506.5, Line A
494.8, Line A
482.4, Line A
488.5, Line A
489.6, Line A
498.0, Line A
507.7, Line A
520.3, Line A
504.0, Line A
521.7, Line A
508.4, Line B
501.3, Line B
494.8, Line B
479.7, Line B
467.5, Line B
497.4, Line B
495.6, Line B
505.3, Line B
505.5, Line B
473.9, Line B
484.8, Line B
476.7, Line B
518.7, Line C
496.5, Line C
501.2, Line C
480.9, Line C
473.6, Line C
487.1, Line C
496.7, Line C
507.8, Line C
468.6, Line C
505.2, Line C
481.7, Line C
488.3, Line C
492.1, Line D
490.1, Line D
507.7, Line D
515.9, Line D
505.3, Line D
487.9, Line D
506.9, Line D
506.0, Line D
515.6, Line D
503.9, Line D
466.7, Line D
483.6, Line D`;

/** Sixty monthly observations generated from level 100, trend +0.8 per month, a sine seasonal of amplitude 12 at period 12, and N(0, 3²) noise. */
const SEASONAL_SERIES = `101.46
106.91
108.43
117.24
114.54
111.12
105.38
104.62
98.97
99.14
96.76
101.42
106.41
115.67
113.02
129.25
123.7
119.94
117.23
108.07
106.46
107.35
102.27
118.01
119.72
128.03
127.94
131.68
138.28
127.56
122.75
120.4
119.86
106.69
121.61
122.93
131.75
132.4
141.85
148.45
142.14
136.85
132.26
126.77
127.43
124.7
124.88
134.2
134.95
140.65
158.36
150.82
157.29
148.18
142.55
139.75
131.72
130.96
135.4
140.02`;

/** An AR(1) series, 120 points, x_t = 0.5·(1 − 0.85) + 0.85·x_{t−1} + N(0, 1): strongly autocorrelated, with a true mean of 0.5. */
const AR1_SERIES = `-0.273
0.483
2.451
2.572
2.638
1.731
1.305
-0.421
0.77
1.782
3.165
4.317
2.696
-0.227
0.708
0.965
-0.103
-0.949
0.134
2.093
2.337
1.365
2.139
3.071
1.453
2.123
0.878
0.864
1.343
1.289
-0.388
0.162
-1.262
-0.254
-2.138
-2.252
-2.334
-2.638
-1.93
-1.283
0.915
1.343
2.393
0.927
1.999
2.706
3.833
4.841
3.258
1.465
0.514
-0.147
1.431
-0.79
-0.541
0.686
0.501
-1.0
-1.701
-0.788
0.192
0.076
0.504
1.981
1.399
3.368
1.896
3.708
1.712
2.956
2.599
0.661
0.77
1.314
1.811
1.737
1.369
0.922
0.963
2.183
2.432
2.882
2.728
3.881
5.922
7.456
5.127
3.514
1.952
1.354
3.307
2.498
2.306
1.814
-0.4
-1.537
-2.006
-2.546
-2.457
-2.518
-2.309
-3.621
-1.928
-1.043
-1.582
-1.794
-2.39
-4.01
-2.62
-2.629
-1.024
0.804
-0.676
-1.717
-0.834
-1.228
-1.694
-1.808
-1.011
-2.25`;

/** A hundred and twenty rows in which an unrecorded frailty raises both the chance of treatment and the outcome. The true treatment effect is +5; the unadjusted difference is about +15, and the frailty is not a column in the table. */
const CONFOUNDED_CROSS_SECTION = `age,treated,outcome
69,1,59.0
60,1,64.7
31,1,54.0
52,0,47.7
40,1,60.8
38,1,63.4
50,0,40.7
51,0,50.7
56,0,35.9
39,0,46.2
44,0,57.6
39,1,69.5
33,0,44.6
46,1,58.4
41,0,56.1
42,0,39.0
41,1,42.3
57,1,64.9
55,1,60.1
49,0,56.5
60,0,44.7
65,1,53.4
58,1,54.5
30,0,52.2
64,1,55.1
46,0,38.9
51,0,44.7
52,1,68.4
31,0,45.1
60,1,67.9
43,0,40.7
56,0,48.5
50,0,57.3
66,1,43.2
32,0,36.4
32,0,40.1
53,0,40.9
30,1,61.2
64,1,60.9
33,1,48.5
64,1,53.3
60,1,60.0
54,0,50.7
59,0,45.7
57,1,61.9
41,0,40.0
61,1,58.9
34,0,45.5
55,1,58.2
33,1,70.9
57,0,49.9
37,0,59.2
54,0,45.1
49,0,49.3
36,1,62.0
70,1,57.5
46,0,40.3
55,0,30.5
58,1,48.2
53,0,46.4
45,0,56.4
50,1,59.1
39,0,43.4
55,1,66.4
45,0,50.9
54,1,64.0
43,0,30.9
51,1,63.1
53,1,62.9
69,1,77.0
53,0,30.8
46,0,33.0
61,0,52.6
46,0,51.7
40,0,41.2
41,0,57.7
40,0,53.4
56,0,34.4
44,0,45.4
65,1,75.4
64,1,71.8
52,0,45.9
38,0,27.4
67,0,51.9
49,1,65.2
57,0,47.5
43,0,34.1
68,1,74.2
38,1,67.3
36,0,38.6
31,0,47.9
36,0,31.8
44,1,62.8
60,0,40.0
39,1,58.3
36,1,52.5
33,1,41.4
38,0,59.9
37,1,63.0
65,1,58.3
44,0,46.4
61,1,46.8
51,0,40.2
52,1,54.2
40,0,52.6
32,1,52.8
50,1,47.3
52,1,63.2
63,0,43.7
61,1,63.5
55,0,37.8
49,0,49.0
58,1,59.4
67,1,63.0
62,1,83.5
51,1,56.7
42,0,45.0
40,0,57.5
60,0,45.6
43,0,24.9`;

/**
 * 256 samples of the exact signal y = sin(2π·90t), taken every 0.01 s.
 *
 * Generated here from a closed-form rule rather than measured, so the truth is
 * known: there is one component, at 90 Hz, and nothing else. Sampling at
 * 100 Hz puts it above the 50 Hz Nyquist limit, so the periodogram of these
 * samples shows a single clean peak at 100 − 90 = 10 Hz — a frequency the
 * signal does not contain. Used by the `aliasing-artefact` example, which is
 * about exactly that.
 */
const ALIASED_SIGNAL_TEXT = Array.from({ length: 256 }, (_, i) => (Math.round(Math.sin(2 * Math.PI * 90 * i * 0.01) * 1e6) / 1e6).toFixed(6)).join('\n');

/**
 * 30 points from the fixed rule y = 3 + 1.4x + e, e ~ Normal(0, 2.5²).
 *
 * The noise comes from a fixed linear congruential sequence through the
 * Box–Muller transform, so every machine sees the same numbers. The truth is
 * the straight line: any curvature the higher polynomials appear to find in
 * this data is noise, which is what the
 * `elpd-difference-within-its-own-error` example exists to show.
 */
const LINEAR_TRUTH_TEXT = (() => {
  let state = 20260413;
  const uniform = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return (state + 0.5) / 2147483648;
  };
  const lines: string[] = [];
  for (let i = 0; i < 30; i++) {
    const x = 0.2 * (i + 1);
    const noise = 2.5 * Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    lines.push(`${x.toFixed(4)} ${(3 + 1.4 * x + noise).toFixed(4)}`);
  }
  return lines.join('\n');
})();

export const EXAMPLES: Example[] = [
  {
    id: 'probability-basics-never-happened',
    title: 'It never happened in twenty tries. Is it impossible?',
    question: 'I watched twenty attempts and the event did not occur once. What can I honestly say its probability is?',
    description:
      'Reads twenty observations with zero successes. The observed proportion is exactly 0%, and the tool does not report that as the probability: the 95% Wilson interval runs up to about 16% and the exact Clopper-Pearson interval up to about 17%. Both are consistent with an event that happens roughly one time in six. Zero out of twenty is weak evidence of rarity and no evidence at all of impossibility, which is why the estimate is labelled as an estimate and carries an interval that does not collapse to a point.',
    toolId: 'probability-basics',
    configOverride: { mode: 'frequency', successes: 0, trials: 20 },
    assumptions: [
      'The twenty observations are of the same process, with the probability unchanged throughout.',
      'They are independent of one another; twenty readings taken from one run of a correlated process carry less information than twenty independent ones.',
      'The event was observable whenever it occurred. An event that happened but went unrecorded is indistinguishable here from one that did not happen.',
    ],
    category: 'Probability fundamentals',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'probability-basics-proportion-is-not-a-probability',
    title: 'Three out of ten is not a 30% probability',
    question: 'If three of ten attempts succeeded, how confident can I be that the probability is near 30%?',
    description:
      'Three successes in ten observations give an observed proportion of 30%, and the interval around it runs from about 11% to about 60% on the Wilson method, or 7% to 65% on the exact one. The point estimate is the least informative number on the screen. The two intervals are shown side by side because they answer slightly different questions: Wilson is accurate for most counts, while Clopper-Pearson guarantees at least 95% coverage and is wider for it, so the choice is a real one rather than a detail.',
    toolId: 'probability-basics',
    configOverride: { mode: 'frequency', successes: 3, trials: 10 },
    assumptions: [
      'The ten observations are of the same process, with the probability unchanged throughout, and independent of one another.',
      'The interval is a statement about the probability being estimated, not a range within which 95% of future attempts will fall. Those are different claims and the tool labels them separately.',
    ],
    category: 'Probability fundamentals',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'coin-flip',
    title: 'Coin flips: theory against observation',
    question: 'If I flip ten fair coins, how many heads should I expect — and how close will a real run get?',
    description:
      'Simulates ten coin flips many times and compares the observed frequency of each number of heads with the exact binomial probabilities. Shows how observed frequencies approach the theory as repetitions increase, without ever matching it exactly.',
    toolId: 'experiment',
    configOverride: { source: { kind: 'coin', count: 10, headsProbability: 0.5 }, trials: 20000, seed: 'coins-10' },
    assumptions: ['Each coin is fair, with probability exactly 0.5 of landing heads.', 'Flips are independent of one another.'],
    category: 'Probability fundamentals',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'dice-sum',
    title: 'Why 7 is the most common total on two dice',
    question: 'What is the distribution of the total when two dice are rolled, and why is it not flat?',
    description:
      'Rolls two dice repeatedly and shows the exact distribution of the total alongside the observed one. The triangular shape comes from the number of ways each total can be made: there are six ways to make 7 but only one to make 12.',
    toolId: 'experiment',
    configOverride: { source: { kind: 'dice', count: 2, faces: 6 }, successCondition: 'total >= 10', trials: 30000, seed: 'two-dice' },
    assumptions: ['Both dice are fair, with each face equally likely.', 'The two rolls are independent.'],
    category: 'Probability fundamentals',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'cards-no-replacement',
    title: 'Drawing aces without replacement',
    question: 'What is the chance of at least one ace in a five-card hand?',
    description:
      'Deals five cards from a standard deck without replacement. Because each card removed changes what remains, the trials are dependent and the hypergeometric distribution applies — using the binomial distribution here would understate the variability.',
    toolId: 'experiment',
    configOverride: {
      source: { kind: 'deck', decks: 1, draws: 5, withReplacement: false, successRanks: ['A'], successSuits: [] },
      successCondition: 'successes >= 1',
      trials: 40000,
      seed: 'aces',
    },
    assumptions: ['The deck is well shuffled, so every card is equally likely to be drawn next.', 'Cards are not returned to the deck between draws.'],
    category: 'Probability fundamentals',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'conditional-probability',
    title: 'Conditional probability and association',
    question: 'How do I combine two events when I know how often they occur together?',
    description:
      'Two events with the overlap supplied directly. Shows the union, the intersection, both conditional probabilities and the four mutually exclusive regions, and reports whether the numbers imply independence or an association.',
    toolId: 'event-relationships',
    configOverride: { labelA: 'Rain today', labelB: 'Train delayed', pA: 0.3, pB: 0.2, relationship: 'given-intersection', pAnd: 0.12 },
    assumptions: ['The illustrative probabilities 0.3, 0.2 and 0.12 are chosen to demonstrate the arithmetic; they are not measurements.'],
    category: 'Conditional probability',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'bayes-test',
    title: 'A 99% accurate test for a rare condition',
    question: 'If a test is 99% accurate and I test positive, how likely is it that I actually have the condition?',
    description:
      'The classic base-rate problem. With a 1% prevalence and 99% sensitivity and specificity, a positive result leaves the probability at only 50% — because false positives among the many healthy people roughly equal the true positives among the few affected.',
    toolId: 'bayes',
    configOverride: { mode: 'diagnostic', prevalence: 0.01, sensitivity: 0.99, specificity: 0.99 },
    assumptions: ['The prevalence, sensitivity and specificity are round illustrative figures, not those of any real test.', 'The test result is the only evidence considered.'],
    category: 'Conditional probability',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'repeated-success',
    title: 'How many attempts for a 95% chance of success?',
    question: 'If each attempt succeeds one time in six, how many attempts do I need to be reasonably confident of at least one success?',
    description:
      'Solves 1 − (1 − p)ⁿ ≥ 0.95 for n and plots the whole curve, showing how each extra attempt adds less than the one before — and that no finite number of attempts reaches certainty.',
    toolId: 'repeated-trials',
    configOverride: { question: 'trials-for-probability', p: 1 / 6, targetProbability: 0.95 },
    assumptions: ['Each attempt is independent and has the same success probability.'],
    category: 'Repeated trials',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'run-of-heads',
    title: 'The chance of a long run',
    question: 'In 100 coin flips, how likely is a run of six heads in a row?',
    description:
      'Runs have no simple closed form, so this uses an exact recursion over the trailing run length. The answer is often higher than people expect: long runs in long sequences are normal, not evidence of a pattern.',
    toolId: 'repeated-trials',
    configOverride: { question: 'run-of-length', trials: 100, p: 0.5, runLength: 6 },
    assumptions: ['The coin is fair and the flips are independent.'],
    category: 'Repeated trials',
    synthetic: false,
    level: 'intermediate',
  },
  {
    id: 'normal-distribution',
    title: 'Exploring the normal distribution',
    question: 'What share of values falls within two standard deviations of the mean?',
    description:
      'The standard normal distribution with an interval probability. Shows that density is not probability: the height of the curve at a point is not the chance of that point, which is zero — probability is the shaded area.',
    toolId: 'distribution-explorer',
    configOverride: { distributionId: 'normal', params: { mu: 0, sigma: 1 }, intervalKind: 'between', a: -2, b: 2 },
    assumptions: ['The quantity is modelled as exactly normally distributed, which is an idealisation of any real measurement.'],
    category: 'Distribution analysis',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'poisson-counts',
    title: 'Counting rare events with the Poisson distribution',
    question: 'If events average four per interval, how often will there be eight or more?',
    description:
      'The Poisson distribution for event counts, with the probability of an unusually busy interval. Demonstrates that the variance equals the mean, so counts are inherently more variable than people often assume.',
    toolId: 'distribution-explorer',
    configOverride: { distributionId: 'poisson', params: { lambda: 4 }, intervalKind: 'ge', a: 8, showCdf: false },
    assumptions: ['Events occur independently at a constant average rate — the defining assumption of a Poisson process.'],
    category: 'Distribution analysis',
    synthetic: false,
    level: 'intermediate',
  },
  {
    id: 'compare-distributions',
    title: "Normal against Student's t: why tails matter",
    question: 'How much heavier are the tails of a t distribution with five degrees of freedom?',
    description:
      'Two distributions on the same axes. The t distribution looks similar near the centre but assigns noticeably more probability to extreme values, which is why it is used when the variance has been estimated from a small sample.',
    toolId: 'distribution-explorer',
    configOverride: {
      distributionId: 'normal',
      params: { mu: 0, sigma: 1 },
      compareEnabled: true,
      compareDistributionId: 'studentT',
      compareParams: { nu: 5, mu: 0, sigma: 1 },
      intervalKind: 'gt',
      a: 3,
    },
    assumptions: [],
    category: 'Distribution analysis',
    synthetic: false,
    level: 'intermediate',
  },
  {
    id: 'monte-carlo-pi',
    title: 'Estimating π by throwing darts',
    question: 'How quickly does a Monte Carlo estimate converge?',
    description:
      'Points dropped at random into a square estimate π from the share landing inside a quarter circle. Because the exact answer is known, this makes Monte Carlo error visible: the convergence plot shows the interval narrowing as 1/√n.',
    toolId: 'simulation',
    configOverride: { modelId: 'pi-estimation', trials: 200000, seed: 'pi-example' },
    assumptions: ['Points are drawn from a uniform distribution over the square using a seeded pseudorandom generator.'],
    category: 'Monte Carlo simulation',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'sampling-variation',
    title: 'Why sample means are more reliable than single values',
    question: 'How much does a sample mean vary from sample to sample?',
    description:
      'Draws samples of 25 values from a skewed exponential distribution and records each sample mean. The means are far less variable and far more symmetric than the individual values — the central limit theorem at work.',
    toolId: 'simulation',
    configOverride: { modelId: 'sampling-distribution', sampling: { distributionId: 'exponential', params: { lambda: 1 }, sampleSize: 25, statistic: 'mean' }, trials: 100000, seed: 'clt-example' },
    assumptions: ['Every sample is drawn independently from the same distribution.'],
    category: 'Monte Carlo simulation',
    synthetic: false,
    level: 'intermediate',
  },
  {
    id: 'project-deadline',
    title: 'Will the project meet its deadline?',
    question: 'With four tasks of uncertain duration, what is the chance of finishing within 25 days?',
    description:
      'Each task has a three-point estimate, and the finish date is the longest path through the dependency network. Shows why the sum of the most likely durations is usually optimistic: delays accumulate along the critical path while early finishes do not help.',
    toolId: 'simulation',
    configOverride: { modelId: 'project-schedule', trials: 60000, seed: 'project-example' },
    assumptions: [
      'Task durations are illustrative three-point estimates, not measurements from a real project.',
      'Durations are drawn independently; shared causes of delay would make the finish date more variable than shown.',
    ],
    category: 'Monte Carlo simulation',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'queue-wait',
    title: 'How long will customers wait?',
    question: 'With arrivals at 80% of service capacity, what is the average wait?',
    description:
      'A single-server queue simulated by discrete events, compared with the exact M/M/1 steady-state formula. Shows how sharply waiting times rise as utilisation approaches capacity — at 80% utilisation the average wait is already four service times.',
    toolId: 'simulation',
    configOverride: { modelId: 'queue', queue: { arrivalRate: 0.8, serviceRate: 1, customers: 3000 }, trials: 500, seed: 'queue-example' },
    assumptions: ['Arrivals follow a Poisson process and service times are exponential, both memoryless.', 'One server, unlimited waiting room, first-come first-served.'],
    category: 'Monte Carlo simulation',
    synthetic: false,
    level: 'advanced',
  },
  {
    id: 'profit-scenario',
    title: 'Profit under uncertain volume and price',
    question: 'What is the chance this product makes a loss?',
    description:
      'A scenario with uncertain sales volume and price, linked by a negative rank correlation so that higher prices come with lower volumes. Records both the profit distribution and the probability of a loss.',
    toolId: 'scenario',
    configOverride: { trials: 60000, seed: 'profit-example' },
    assumptions: [
      'The volume and price ranges are illustrative figures chosen to demonstrate the method.',
      'Costs are treated as known exactly; in practice they would carry their own uncertainty.',
    ],
    category: 'Scenario comparison',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'threshold-exceedance',
    title: 'The chance of exceeding a threshold',
    question: 'How likely is the total to exceed a critical level?',
    description:
      'A scenario whose output is an indicator: it is 1 when the total exceeds the threshold and 0 otherwise. The estimated probability comes with a Wilson interval, which stays valid even when the event is rare.',
    toolId: 'scenario',
    configOverride: {
      variables: [
        { id: 'v1', name: 'demand', label: 'Peak demand', kind: 'distribution', distributionId: 'lognormal', params: { mu: 4.3, sigma: 0.35 }, track: true },
        { id: 'v2', name: 'capacity', label: 'Capacity', kind: 'fixed', value: 120 },
      ],
      correlationGroups: [],
      outputs: [
        { id: 'o1', key: 'exceeds', label: 'Demand exceeds capacity', expression: 'demand > capacity', kind: 'indicator' },
        { id: 'o2', key: 'shortfall', label: 'Shortfall when exceeded', expression: 'max(0, demand - capacity)', kind: 'continuous', unit: 'units' },
      ],
      assumptions: ['Peak demand is modelled as log-normal, a common choice for a positive quantity with a long right tail.'],
      trials: 200000,
      seed: 'threshold-example',
    },
    assumptions: ['The demand distribution parameters are illustrative, chosen so that exceedance is uncommon but not negligible.'],
    category: 'Scenario comparison',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'sensitivity-drivers',
    title: 'Which assumption matters most?',
    question: 'Of the inputs to this model, which one drives the result?',
    description:
      'A tornado comparison across the cost assumptions of the profit model. Each parameter is set to a low and a high value in turn, and the bars are sorted by how far the result moved.',
    toolId: 'sensitivity',
    configOverride: { method: 'tornado', seed: 'tornado-example' },
    assumptions: ['The low and high values are illustrative. The ranking depends on them: a parameter given a wider range will always look more influential.'],
    category: 'Sensitivity analysis',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'sobol-interactions',
    title: 'Finding interactions between inputs',
    question: 'How much of the variation comes from inputs acting together rather than alone?',
    description:
      'A Sobol variance decomposition. The first-order index is the share of variance from each input by itself; the total index adds its part in interactions. A large gap between them means the inputs matter mainly in combination.',
    toolId: 'sensitivity',
    // `sobol` is given in full rather than spread over the tool's default,
    // because an override is merged one level deep and importing the default
    // here would pull the whole sensitivity screen into the first chunk. These
    // two parameters mirror SENSITIVITY_DEFAULT.sobol in SensitivityTool.tsx.
    configOverride: {
      method: 'sobol',
      sobol: {
        parameters: [
          { path: 'variables.2.value', label: 'Cost per unit', low: 9, high: 13 },
          { path: 'variables.3.value', label: 'Fixed costs', low: 7000, high: 11000 },
        ],
        samples: 512,
        trialsPerEvaluation: 300,
      },
      seed: 'sobol-example',
    },
    assumptions: ['The inputs are varied independently and uniformly over the stated ranges, which is what the Sobol method requires.'],
    category: 'Sensitivity analysis',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'aggregate-risk',
    title: 'Total losses over a year',
    question: 'How bad could the worst year in twenty look?',
    description:
      'A compound model: the number of loss events is Poisson, each loss is log-normal, and the total is their sum. Produces a loss distribution with Value at Risk and Expected Shortfall, and shows why a normal approximation understates tail risk.',
    toolId: 'risk',
    configOverride: { mode: 'aggregate', trials: 200000, seed: 'risk-example' },
    assumptions: [
      'The frequency and severity distributions are illustrative modelling choices, not fitted to any real loss history.',
      'Events are independent of one another and of the size of each loss.',
    ],
    category: 'Risk exploration',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'risk-register',
    title: 'Comparing risks and mitigations',
    question: 'Which of these risks deserves attention first, and is mitigation worth its cost?',
    description:
      'A register of individual risks with probabilities and impacts, ranked by expected loss, with the net benefit of each mitigation. Shows why expected loss alone does not settle the decision: a rare catastrophe and a routine cost can have identical expected values.',
    toolId: 'risk',
    configOverride: { mode: 'register' },
    assumptions: ['All probabilities are judgements, marked as estimates in the results rather than presented as measurements.'],
    category: 'Risk exploration',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'bayesian-rate',
    title: 'Learning a success rate from few observations',
    question: 'After 7 successes in 10 attempts, what do I know about the true rate?',
    description:
      'A Beta–Binomial update showing the prior and posterior together. With only ten observations the interval is wide and the prior still matters — change the prior and watch the posterior move.',
    toolId: 'bayesian-updating',
    configOverride: { family: 'beta-binomial', beta: { priorAlpha: 1, priorBeta: 1, successes: 7, failures: 3 } },
    assumptions: ['Attempts are independent with the same unknown success probability.', 'The uniform prior Beta(1,1) is a choice, not a neutral starting point.'],
    category: 'Conditional probability',
    synthetic: false,
    level: 'intermediate',
  },
  {
    id: 'bootstrap-uncertainty',
    title: 'Bootstrap intervals from a small sample',
    question: 'How uncertain is a median computed from a handful of observations?',
    description:
      'Resamples your own data with replacement to estimate how much a statistic would vary across samples. Load a CSV file in the Data Lab, choose a column and a statistic, and the bootstrap distribution appears with a percentile interval.',
    toolId: 'data-lab',
    configOverride: { tab: 'bootstrap', bootstrapStatistic: 'median', bootstrapTrials: 20000, seed: 'bootstrap-example' },
    assumptions: ['The bootstrap treats your sample as representative of the population; it cannot correct a biased sample.'],
    category: 'Statistical data analysis',
    synthetic: false,
    level: 'intermediate',
  },
  {
    id: 'dataset-analysis',
    title: 'Describing and testing your own data',
    question: 'What does this dataset show, and is the difference between these groups real?',
    description:
      'Load a CSV or JSON file to get descriptive statistics, histograms, correlations and hypothesis tests. Everything is computed in your browser; the file is never uploaded. Every dropped or unreadable value is reported.',
    toolId: 'data-lab',
    configOverride: { tab: 'overview' },
    assumptions: [],
    category: 'Statistical data analysis',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'markov-reliability',
    title: 'A system that degrades and fails',
    question: 'How long until this system fails, and where does it spend its time?',
    description:
      'A three-state chain: healthy, degraded and failed, with failure absorbing. Gives the exact distribution after any number of steps, the expected time to failure from each state, and the probability of failing within a horizon.',
    toolId: 'markov',
    configOverride: { steps: 30 },
    assumptions: [
      'The transition probabilities are illustrative figures chosen to show the method.',
      'The Markov property: how long a system has been degraded does not affect what happens next — a strong assumption for real equipment.',
    ],
    category: 'Scenario comparison',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'gambler-ruin',
    title: "The gambler's ruin",
    question: 'Starting with 3 units against an opponent with 2, what is my chance of winning everything?',
    description:
      'A random walk with absorbing barriers at 0 and 5. On fair bets the probability of reaching the top is exactly your starting share of the total stake, and the expected duration is the product of the two stakes — both computed exactly here.',
    toolId: 'markov',
    configOverride: {
      states: ['0 units', '1 unit', '2 units', '3 units', '4 units', '5 units'],
      matrix: [
        [1, 0, 0, 0, 0, 0],
        [0.5, 0, 0.5, 0, 0, 0],
        [0, 0.5, 0, 0.5, 0, 0],
        [0, 0, 0.5, 0, 0.5, 0],
        [0, 0, 0, 0.5, 0, 0.5],
        [0, 0, 0, 0, 0, 1],
      ],
      initialState: 3,
      steps: 50,
      targetState: 5,
      trials: 20000,
      seed: 'ruin',
    },
    assumptions: ['Each bet is fair, independent, and for one unit.', 'Play continues until one side has everything.'],
    category: 'Probability fundamentals',
    synthetic: false,
    level: 'advanced',
  },
  {
    id: 'lottery-odds',
    title: 'Lottery odds, counted exactly',
    question: 'How many ways are there to choose 6 numbers from 49?',
    description:
      'An exact combinatorial count, with the four counting problems compared side by side so the role of order and repetition is clear. Also shows the probability of a single ticket matching, assuming every combination is equally likely.',
    toolId: 'combinatorics',
    configOverride: { mode: 'unordered-no-repeat', n: 49, k: 6 },
    assumptions: ['Every combination is equally likely, which is the design intent of a fair draw.'],
    category: 'Probability fundamentals',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'birthday-problem',
    title: 'The birthday problem',
    question: 'In a group of 23 people, how likely is a shared birthday?',
    description:
      'A custom experiment drawing 23 birthdays from 365 equally likely days with replacement, recording whether any two coincide. The answer — just over half — surprises most people, because the number of pairs grows much faster than the group.',
    toolId: 'experiment',
    configOverride: {
      source: {
        kind: 'custom',
        faces: Array.from({ length: 365 }, (_, i) => ({ label: `Day ${i + 1}`, value: i + 1, weight: 1 })),
        draws: 23,
        withReplacement: true,
      },
      successCondition: 'distinct < draws',
      trackFirstDraw: false,
      trials: 40000,
      seed: 'birthday',
    },
    assumptions: ['All 365 days are treated as equally likely and leap years are ignored — real birth dates are slightly uneven.', 'The 23 people are unrelated, so no twins.'],
    category: 'Probability fundamentals',
    synthetic: false,
    level: 'intermediate',
  },
  {
    id: 'processes-poisson-arrivals',
    title: 'Arrivals that are completely at random',
    question: 'If alerts arrive at three an hour on average, how many will there be in an eight-hour shift, and when is the thirtieth likely to land?',
    description:
      'A homogeneous Poisson process with its exact laws alongside simulated paths: the count in the window is Poisson(λt), the gaps between arrivals are exponential, and the counting path is a staircase. Shows that "at a constant average rate" does not mean evenly spaced — the simulated paths cluster and leave quiet stretches, and the band around them is wide.',
    toolId: 'processes',
    configOverride: {
      processId: 'poisson-process',
      params: { rate: 3 },
      horizon: 8,
      gridPoints: 80,
      paths: 200,
      bandLevel: 0.9,
      passageLevel: 30,
      passageDirection: 'above',
      seed: 'poisson-shift',
    },
    assumptions: [
      'A rate of three per hour is an illustrative figure chosen to demonstrate the method, not a measurement.',
      'The rate is constant: no trend, no time-of-day effect. If the real arrivals have a busy hour, this understates the peak queue.',
      'Arrivals in disjoint intervals are independent, and the waiting time to the next one is memoryless — how long you have already waited tells you nothing.',
    ],
    category: 'Time',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'processes-gbm-median-versus-mean',
    title: 'Geometric Brownian motion: the mean grows, the median does not',
    question: 'If a quantity has an expected growth rate of 12% a year and 45% volatility, where will it be in five years?',
    description:
      'Geometric Brownian motion over five years, with the exact log-normal law at the horizon and the exact first-passage probability, both computed on open; the path ensemble is behind its own button. The trap: the drift parameter is not the growth rate of a typical path. The median path grows at μ − σ²/2 — here about 2% a year rather than 12% — because the expected value is pulled up by a thin tail of very large outcomes. The mean sits well above the median and above most individual paths. This Itô correction is the whole reason this screen reports both and labels which convention each parameter follows.',
    toolId: 'processes',
    configOverride: {
      processId: 'gbm',
      params: { s0: 100, drift: 0.12, volatility: 0.45 },
      horizon: 5,
      gridPoints: 80,
      paths: 400,
      bandLevel: 0.9,
      passageLevel: 200,
      passageDirection: 'above',
      seed: 'gbm-ito',
    },
    assumptions: [
      'The starting value, drift and volatility are illustrative figures chosen so the gap between the mean and the median is large enough to see.',
      'Log-returns are independent and normally distributed with constant volatility. Real series have fat tails and volatility clustering, so the extreme quantiles here are optimistic.',
      'The drift and volatility are treated as known exactly. Estimating a drift from five years of a series this volatile is close to hopeless, and nothing here accounts for that.',
    ],
    category: 'Time',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'portfolio-two-books-value-at-risk',
    title: 'Adding up the risk of two books',
    question: 'If each of two books has a 99% Value at Risk, what is the 99% Value at Risk of holding both?',
    description:
      'Two independent loss exposures, combined by exact numerical convolution rather than by simulation, with Value at Risk and Expected Shortfall at 95% and 99%. The answer is not the sum of the two figures, and it is not obvious in which direction it moves: Expected Shortfall is subadditive, so it can never exceed the sum, while Value at Risk is not, and the screen constructs an explicit counterexample where it does. Independence is set here deliberately, as the best case.',
    toolId: 'portfolio',
    configOverride: {
      exposures: [
        { id: 'x1', label: 'Trading book', distributionId: 'lognormal', params: { mu: 3, sigma: 0.9 }, scale: 1 },
        { id: 'x2', label: 'Credit book', distributionId: 'gamma', params: { k: 2, theta: 12 }, scale: 1 },
      ],
      correlation: 0,
      levels: [0.95, 0.99],
      latticeResolution: 40,
      copulaTrials: 20000,
      measureId: 'es',
      seed: 'portfolio-two-books',
    },
    assumptions: [
      'The two marginal loss distributions are illustrative modelling choices, not fitted to any loss history.',
      'The two books are assumed independent. That is an assumption, not a finding: it is the most favourable relationship available and the one least likely to hold in a crisis.',
      'The convolution is numerical, computed on a lattice; the discretisation error is reported rather than hidden.',
    ],
    category: 'Decisions',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'portfolio-correlation-shock',
    title: 'The diversification that disappears when you need it',
    question: 'How much of this portfolio’s diversification benefit survives a crisis in which everything moves together?',
    description:
      'Three exposures joined by a Gaussian copula at a mild correlation of 0.3, then re-run with the correlation forced to 0.95 and volatilities multiplied. The trap is that the benign figure is the one people budget against: most of the apparent diversification is an artefact of the correlation assumption, and the stressed Expected Shortfall is far larger than scaling the benign one would suggest. The risk contributions also change rank under stress, so the exposure to cut is not the same one. The heavier panels — scenario aggregation, Shapley contributions, the risk frontier and the estimation-error study — are present and switched off; turn one on when you want it.',
    toolId: 'portfolio',
    configOverride: {
      correlation: 0.3,
      stressCorrelation: 0.95,
      stressVolatilityMultiplier: 1.5,
      levels: [0.95, 0.99],
      copulaTrials: 20000,
      scenarioCount: 1500,
      targetLoss: 600,
      measureId: 'es',
      seed: 'portfolio-shock',
    },
    assumptions: [
      'The three exposures and their marginal distributions are illustrative figures chosen to demonstrate the method.',
      'A Gaussian copula has no tail dependence: even at a high correlation it understates the chance of simultaneous extremes. The stressed case patches over this by raising the correlation, which is a crude substitute for a copula that admits joint tails.',
      'A single equicorrelation number stands in for the whole dependence structure. The real relationship between these books is unknown, and neither the 0.3 nor the 0.95 is a measurement — they bracket a range rather than estimate a value.',
    ],
    category: 'Decisions',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'des-service-desk-batch-means',
    title: 'Why the obvious confidence interval on a queue is too narrow',
    question: 'A service desk running at 94% of capacity: what is the average wait, and how sure can a simulation of it be?',
    description:
      'An M/M/2 desk simulated event by event, with the exact steady-state answer beside it so the simulation can be checked rather than believed. Press the run button and the point to watch is the interval. Consecutive customers’ waits are strongly autocorrelated — a customer who waited a long time was behind someone who also waited — so treating them as independent observations gives an interval several times narrower than the truth. The run therefore reports batch means with a test on the lag-one autocorrelation of the batches, and discards a warm-up period, because a queue started empty is not yet in steady state.',
    toolId: 'des',
    configOverride: {
      modelId: 'mmc-service-desk',
      params: { arrivalRate: 9.4, serviceRate: 5, servers: 2 },
      run: { until: 1500, warmupTime: 200, replications: 5, batchCount: 25, chunkEvents: 5000, level: 0.95 },
      focusMetric: 'Wq',
      alternative: { arrivalRate: 9.4, serviceRate: 5, servers: 3 },
      comparison: { replications: 6, until: 600 },
      seed: 'des-batch-means',
    },
    assumptions: [
      'The arrival and service rates are illustrative figures chosen to put the desk close enough to capacity that the queue, and the autocorrelation, are clearly visible.',
      'Arrivals are Poisson and service times exponential, which is what makes the exact comparison available. Real service times are rarely this variable in this particular way.',
      'Nobody balks, abandons or jumps the queue, and there is no limit on the waiting room.',
      'The warm-up length of 200 time units is a judgement. Too short and the estimates are biased low; the batch diagnostics are the check on whether it was long enough.',
    ],
    category: 'Simulation',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'des-line-blocking',
    title: 'Why a production line is slower than its slowest machine',
    question: 'Two machines, each able to finish one part a minute, with no room to put anything between them. How many parts an hour does the line make?',
    description:
      'The naive answer is sixty: both machines keep up with each other, so neither is the bottleneck. The exact answer, shown on screen before anything is simulated, is forty \u2014 two thirds of the nominal rate. With no buffer, a machine that finishes early must hold its part until the next one is free, and that blocking costs a third of the capacity of a perfectly balanced line. Press run and the event-by-event simulation reproduces the closed form, which is the point of having both: the simulation is checkable here, so it can be trusted when the buffer is raised and the closed form disappears. The comparison panel re-runs the line with five buffer places, using common random numbers so the gain is estimated with much less noise than two separate runs.',
    toolId: 'des',
    configOverride: {
      modelId: 'production-line',
      params: { meanProcessing: [1, 1], bufferCapacity: 0, saturated: true },
      run: { until: 2000, warmupTime: 200, replications: 5, batchCount: 20, chunkEvents: 5000, level: 0.95 },
      focusMetric: 'throughput',
      alternative: { meanProcessing: [1, 1], bufferCapacity: 5, saturated: true },
      comparison: { replications: 6, until: 800 },
      seed: 'des-blocking',
    },
    assumptions: [
      'Equal one-minute mean processing times are chosen to make the blocking loss exactly a third; the numbers are illustrative, not a measurement of any line.',
      'Processing times are exponential and independent. That variability is what causes the blocking: with perfectly constant times and equal rates there would be none at all, so this is the load-bearing assumption and it is the one to question first about a real line.',
      'Raw material is always available, so the first station never starves. A real line fed by uncertain supply is slower than this.',
      'No failures and no repairs. Switching either on removes the closed form \u2014 which is exactly why the simulation is validated against it first.',
      'Two stations only. Longer lines interact in ways that do not follow from the two-station result.',
    ],
    category: 'Simulation',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'information-entropy-of-a-forecast',
    title: 'How many bits is tomorrow’s weather worth?',
    question: 'Four possible outcomes, but one of them happens most of the time — how much uncertainty is there really?',
    description:
      'Entropy for a four-outcome distribution that is far from uniform. The maximum possible is log₂2 4 = 2 bits, reached only when all four are equally likely; here it is well under that, and the gap is exactly the redundancy an efficient code could exploit. The Rényi entropy at α = 2 is shown alongside, which weights the likely outcomes more heavily and so is smaller still.',
    toolId: 'information',
    configOverride: {
      mode: 'entropy',
      base: 'bits',
      outcomeNames: ['Clear', 'Cloud', 'Rain', 'Snow'],
      outcomeProbs: [0.6, 0.25, 0.12, 0.03],
      renyiAlpha: 2,
    },
    assumptions: [
      'The four probabilities are illustrative figures chosen to demonstrate the method, not a climatology.',
      'Entropy measures the uncertainty of this stated distribution. It says nothing about whether the distribution is right: a confident, wrong forecast has low entropy.',
      'The four outcomes are treated as a genuine partition — exactly one occurs.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'information-improper-scoring-rule',
    title: 'The scoring rule that pays you to lie',
    question: 'If my forecasts are graded on how close they are to what happened, should I report what I actually believe?',
    description:
      'Your honest belief is 0.7. The screen plots the expected penalty, under that belief, for every probability you could report instead, under three rules. Under the Brier and logarithmic rules the penalty is smallest at exactly 0.7: they are proper, and honesty is optimal. Under the absolute-error rule it is not — the expected penalty keeps falling all the way to a report of 1, so a forecaster graded that way is paid to claim certainty they do not have. The screen checks each rule by computation and labels the failing one improper rather than asserting it.',
    toolId: 'information',
    configOverride: {
      mode: 'propriety',
      base: 'bits',
      trueProbability: 0.7,
    },
    assumptions: [
      'The honest belief of 0.7 is a stipulation for the demonstration, not a measurement.',
      'The forecaster is assumed to maximise the expected score under their own belief, and to face no other incentive — no reputation, no penalty for being caught.',
      'Propriety is a property of the rule, provable in general; the particular number 0.7 only makes the effect visible. It does not depend on it.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'elicitation-partition-that-does-not-sum',
    title: 'Stated probabilities that add up to more than one',
    question: 'An expert gives a probability for each of four mutually exclusive outcomes and they total 1.17. What now?',
    description:
      'A coherence check over a partition. The totals are reported as they were stated and the violation is shown explicitly — the numbers are not quietly divided by 1.17 and presented as if the expert had said them. That matters, because normalising destroys the evidence that the judgements were incoherent, and the direction of the error is itself informative: overconfidence in each case considered separately is the usual cause. An adjustment panel is there to be switched on, offering least-squares and other reconciliation rules, each of which is a choice about whose number to move.',
    toolId: 'elicitation',
    configOverride: {
      mode: 'coherence',
      coherenceCheck: 'partition',
      partitionText: 'Shipped this quarter: 0.5\nShipped next quarter: 0.35\nShipped later: 0.22\nCancelled: 0.1',
      showAdjustment: false,
    },
    assumptions: [
      'The four stated probabilities are illustrative figures chosen to demonstrate the check, not a real expert’s judgements.',
      'The four outcomes are assumed to be genuinely exclusive and exhaustive. If they are not, the failure to sum to one is not an error at all, and no amount of arithmetic can tell the two cases apart — only asking the expert can.',
      'Coherence is necessary, not sufficient. A perfectly coherent set of judgements can still be badly wrong, and nothing here tests accuracy.',
    ],
    category: 'Uncertainty',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'elicitation-bounds-instead-of-a-number',
    title: 'Saying only what you are willing to say',
    question: 'I can tell you a probability is somewhere between 0.5 and 0.7, but not what it is. Can anything be computed from that?',
    description:
      'Three outcomes, each given a lower and an upper probability rather than a point value, because that is genuinely all the judge will commit to. The screen checks whether the stated intervals can be satisfied at all \u2014 whether some coherent distribution lies inside them \u2014 and then reports bounds on the quantities you ask for instead of a single number. It also reports which of the stated bounds were not reachable — some are narrower than they look once the others are accounted for — and reports the implied bounds instead of the stated ones. The interval is the answer, not a failure to produce one: narrowing it further would mean inventing information the judge did not give. Compare this with picking the midpoints, which looks tidier and quietly asserts a precision nobody claimed.',
    toolId: 'elicitation',
    configOverride: {
      mode: 'know',
      knowForm: 'imprecise-probabilities',
      impreciseProbText: 'Delivered on time: 0.5, 0.7\nDelivered late: 0.15, 0.4\nCancelled: 0.02, 0.12',
      support: 'bounded',
      supportLower: 0,
      supportUpper: 600,
    },
    assumptions: [
      'The stated bounds are illustrative figures chosen to demonstrate the method, not an elicitation from any real expert.',
      'The three outcomes are assumed exclusive and exhaustive.',
      'The bounds themselves are judgements. Imprecision is honest about not knowing the probability; it is not a defence against the bounds being in the wrong place.',
      'Nothing here says where in each interval the truth lies, and no result below should be read as implying a midpoint.',
    ],
    category: 'Uncertainty',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'sequential-run-or-service-the-machine',
    title: 'When to service a machine that is still working',
    question: 'A machine degrades as it runs and servicing costs output. What is the best policy, and how much better is it than mine?',
    description:
      'A three-state Markov decision process — good, worn, broken — with two actions, solved exactly by value iteration and by finite-horizon backward induction. The optimal policy is compared against a policy of your own, so the cost of a plausible rule of thumb is a number rather than an opinion. The point to notice is that the best action in the worn state is not the one with the best immediate reward: servicing pays less now and more later, and the discount factor decides where the crossover falls.',
    toolId: 'sequential',
    configOverride: {
      mode: 'mdp',
      discount: 0.95,
      horizon: 8,
      userPolicy: [0, 0, 1],
      scanLo: 0,
      scanHi: 0.99,
      scanPoints: 41,
    },
    assumptions: [
      'The transition probabilities and rewards are illustrative figures chosen to demonstrate the method, not measurements from any equipment.',
      'The Markov property: how long the machine has been worn does not affect what happens next. Real wear has memory, and this is the assumption the model cannot test.',
      'The transition matrix is treated as known exactly. A policy that is optimal for the stated numbers may not be optimal for the true ones, and nothing here reports that sensitivity — the discount scan next door shows the analogous effect for the discount factor.',
    ],
    category: 'Decisions',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'sequential-listen-before-you-act',
    title: 'The best move is the one that teaches you most',
    question: 'A costly hazard is behind one of two doors and I am evenly split. Should I open one, or pay to learn first?',
    description:
      'A partially observable problem solved exactly over a short horizon. The immediate payoff of listening is negative — it costs and it opens nothing — yet it is the optimal first action, because at a 50/50 belief either door risks the penalty and the information is worth more than the fee. This is the trap the screen exists to show: ranking actions by immediate expected reward gets the first move wrong whenever what you learn changes what you can do next. Watch the value as the belief moves away from 0.5: once you are confident enough, listening stops being worth it, and the policy switches.',
    toolId: 'sequential',
    configOverride: {
      mode: 'pomdp',
      pomdpAccuracy: 0.75,
      pomdpListenCost: 1,
      pomdpPenalty: 100,
      pomdpReward: 10,
      pomdpBelief: 0.5,
      pomdpHorizon: 3,
      pomdpDiscount: 0.95,
      pomdpObservation: 0,
    },
    assumptions: [
      'The accuracy, cost, reward and penalty are illustrative figures chosen so that listening is worth it at an even belief and not worth it when confident.',
      'The observation accuracy of 0.75 is assumed known. In practice the reliability of your own information source is itself uncertain, and over-trusting it is the standard way this analysis goes wrong.',
      'Observations are conditionally independent given the hidden state, so listening twice gives two genuinely separate pieces of evidence. A sensor with a consistent bias would violate this and the second listen would be worth much less than the model says.',
      'The hazard does not move between steps.',
    ],
    category: 'Decisions',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'gaussian-process-gap-in-the-data',
    title: 'A prediction that widens where there is no data',
    question: 'What does an honest model say about the region where I have no observations at all?',
    description:
      'A Gaussian process regression on data with a deliberate gap in the middle and extrapolation past both ends. The posterior mean passes smoothly through the gap, which looks reassuring and is not the point: the interval balloons there and keeps widening outside the data, returning towards the prior. Sampled functions from the posterior show why — they agree closely where there are observations and fan out where there are none. Compare this with a fitted curve, which gives the same mean and no warning.',
    toolId: 'gaussian-process',
    configOverride: {
      kernelId: 'matern52',
      composition: 'single',
      kernelParams: { 'k.variance': 0.9, 'k.lengthScale[0]': 1.0 },
      noiseVariance: 0.01,
      meanKind: 'zero',
      level: 0.95,
      gridPoints: 160,
      extrapolation: 0.4,
      sampleCount: 4,
      sampleSeed: 'gp-gap',
      runFit: false,
    },
    assumptions: [
      'The observations are synthetic, generated for this demonstration with known noise; they are not a measurement of anything.',
      'The noise variance and the kernel parameters are fixed by hand rather than fitted. Hyperparameter fitting is a separate, heavier step behind its own button, and the width of the interval depends on these numbers.',
      'The interval is the posterior interval for the function value, given the kernel. It is not a prediction interval for a new noisy observation, and the screen labels them separately.',
      'A zero prior mean is an assumption that shows up precisely in the gap and beyond the data, which is where the posterior has little else to go on.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'gaussian-process-kernel-is-the-assumption',
    title: 'The kernel is the assumption the data cannot check',
    question: 'My data looks periodic. Does adding a periodic kernel make the forecast beyond the data trustworthy?',
    description:
      'The same observations as the previous example, modelled with a sum of a Matérn 5/2 kernel and a periodic one, and extrapolated well past the end of the data. The fit inside the data improves and the extrapolation becomes confident — the periodic component happily continues the oscillation into territory where nothing was observed. That confidence is entirely an assertion of the kernel, not a finding from the data: a smooth non-periodic kernel fits the same points nearly as well and says something quite different further out. The point of the example is to switch the composition back to a single kernel and watch the forecast change while the fit barely does. Hyperparameter fitting and the sparse approximations are present and off.',
    toolId: 'gaussian-process',
    configOverride: {
      kernelId: 'matern52',
      composition: 'sum',
      secondKernelId: 'periodic',
      kernelParams: {},
      noiseVariance: 0.01,
      meanKind: 'constant-unknown',
      level: 0.9,
      gridPoints: 160,
      extrapolation: 0.8,
      sampleCount: 4,
      sampleSeed: 'gp-kernel',
      runFit: false,
    },
    assumptions: [
      'The observations are synthetic, generated for this demonstration; the apparent periodicity was put there on purpose.',
      'Kernel parameters are left at the kernels’ own defaults rather than fitted, so neither the period nor the length scale has been estimated from the data.',
      'Extrapolation beyond the observed range is driven by the kernel, and the data in hand cannot distinguish between kernels that agree on it and disagree outside it. The interval here is honest about noise and about the posterior given the kernel; it carries no allowance at all for the kernel being the wrong choice.',
      'Comparing two kernels by eye is not a model comparison. The marginal likelihood reported on screen is the quantity to compare, and even it rewards fit inside the data, which is not where the disagreement is.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'regression-two-predictors',
    title: 'Fitting a line when you know the answer',
    question: 'If two quantities both drive a third, can least squares recover how much each contributes?',
    description:
      'Thirty rows generated from y = 3 + 1.8·x1 − 0.9·x2 with Normal noise of standard deviation 1.5. The fitted coefficients are reported with confidence intervals, so you can check that the intervals cover the values that actually generated the data — which is what a 95% interval promises, and nothing more.',
    toolId: 'regression',
    configOverride: {
      data: REGRESSION_LINEAR_DATA,
      response: 'y',
      predictors: ['x1', 'x2'],
      basisColumn: 'x1',
      model: 'ols',
      seType: 'classical',
    },
    assumptions: [
      'The data are generated from a known linear rule, stated in the description, so the fit can be read against the truth.',
      'Least squares inference assumes errors with constant variance that are independent across rows. Both hold here by construction; neither can be verified from a real dataset, only checked for gross violation in the residual plots.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'regression-influential-point',
    title: 'A good fit driven by one point',
    question: 'My regression has an R² of 0.94 — can I trust the slope?',
    description:
      'Nineteen points generated from y = 20 + 0.5·x over a narrow range of x, plus one observation at x = 40, far outside it. The fit reports R² ≈ 0.94 and a highly significant slope of about 1.23 — more than twice the slope that generated the data. Delete the last row and the slope falls to about 0.58 with R² ≈ 0.76. Read the leverage and Cook’s distance diagnostics: one row carries the fit, and R² is no defence against that.',
    toolId: 'regression',
    configOverride: {
      data: REGRESSION_LEVERAGE_DATA,
      response: 'y',
      predictors: ['x'],
      basisColumn: 'x',
      model: 'ols',
      seType: 'HC3',
    },
    assumptions: [
      'The data are generated from a known rule, y = 20 + 0.5·x with Normal noise, with one point placed deliberately outside the range of x to create leverage.',
      'Nothing in the fit statistics can tell you whether the distant point is a mistake or the most informative observation you have. That judgement comes from knowing where the number came from, not from the regression.',
      'Heteroskedasticity-consistent (HC3) standard errors are used here. They correct for unequal error variance; they do not correct for a single influential point.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'fit-exponential-waiting',
    title: 'Which distribution describes these waiting times?',
    question: 'I have forty-five positive, right-skewed measurements. Which family fits, and how well?',
    description:
      'Forty-five values drawn from a log-normal distribution with meanlog 3.2 and sdlog 0.6. A single named family is fitted by maximum likelihood, with parameter intervals, a Q–Q plot, a Kolmogorov–Smirnov and an Anderson–Darling statistic. Because the generating distribution is stated, you can see how close forty-five observations get to it — the parameter intervals are wider than most people expect.',
    toolId: 'distribution-fitting',
    configOverride: {
      dataText: FIT_SKEWED_SAMPLE,
      chosenFamily: 'lognormal',
      runComparison: false,
      bootstrapReplicates: 300,
    },
    assumptions: [
      'The data are drawn from a known log-normal distribution, stated in the description, so the fit can be read against the truth.',
      'Maximum likelihood assumes the observations are independent and identically distributed. A real sample collected over time often is not.',
      'A goodness-of-fit test that does not reject is not evidence that the family is right: with n = 45 it has little power to reject a wrong family.',
    ],
    category: 'Data',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'fit-families-agree-then-diverge',
    title: 'Four families that fit equally well and disagree about the tail',
    question: 'Several distributions fit my data about as well as each other. Does the choice matter?',
    description:
      'The same forty-five log-normal values, with every compatible family fitted and ranked \u2014 twenty-one fitted, twenty-one skipped with reasons. The comparison takes a few seconds. Four families sit within 3.5 AIC points of one another, and the Akaike weights (0.57, 0.19, 0.14, 0.10) say plainly that the data cannot choose between them. AIC ranks the beta prime first; the log-normal that actually generated the data comes third, 2.8 points behind, which is no evidence at all. The detailed panel below shows the log-normal fit \u2014 press Choose on the beta prime or the Fr\u00e9chet and watch the upper quantiles move, because a power-law tail and a log-normal tail make very different statements beyond the largest observation. Goodness of fit in the body of the data does not transfer to the tail.',
    toolId: 'distribution-fitting',
    configOverride: {
      dataText: FIT_SKEWED_SAMPLE,
      chosenFamily: 'lognormal',
      runComparison: true,
      level: 0.95,
      bootstrapReplicates: 200,
      envelopeReplicates: 150,
    },
    assumptions: [
      'The data are drawn from a known log-normal distribution; the point of the example is that forty-five observations cannot demonstrate that, and that AIC does not in fact rank it first here.',
      'AIC compares the families on the data you have. It says nothing about the region beyond the largest observation, where the extrapolated quantiles live.',
      'Akaike weights are relative to the candidate set. Adding or removing a family changes every one of them, and none of them is the probability that a family is true.',
      'Every interval in the detailed panel conditions on the chosen family being correct. The spread between families is a further uncertainty that no single fit reports.',
    ],
    category: 'Data',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'test-two-groups-welch',
    title: 'Do these two groups really differ?',
    question: 'Two production lines gave different average measurements. Is the difference more than noise?',
    description:
      'Four groups of twelve measurements, every value drawn from the same Normal(500, 20²) distribution — there is no real difference to find. Welch’s t test compares the two groups whose sample means happen to be furthest apart, and reports the difference with a confidence interval that comfortably includes zero. Shows what an honest null result looks like, and that the interval, not the p-value, says how large a difference the data could still be hiding.',
    toolId: 'hypothesis-tests',
    configOverride: {
      data: NO_EFFECT_GROUPS,
      test: 'welch-t',
      groupA: 'Line A',
      groupB: 'Line C',
      alternative: 'two-sided',
      level: 0.95,
    },
    assumptions: [
      'All four groups are drawn from the same Normal(500, 20²) distribution, so the true difference is exactly zero.',
      'Welch’s test does not assume equal variances, but it does assume the observations are independent within and between groups.',
      'Failing to reject is not evidence of equivalence. The confidence interval states which differences remain compatible with the data.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'test-multiplicity-false-positive',
    title: 'Twenty comparisons and a significant result that is not one',
    question: 'I ran twenty tests and one came out at p = 0.013. Have I found something?',
    description:
      'A one-way ANOVA over four groups that were all drawn from the same distribution, alongside a set of twenty p-values of the kind twenty such comparisons produce when nothing is going on. Two fall below 0.05. The multiplicity panel applies Bonferroni, Holm and Benjamini–Hochberg: none of the twenty survives any of them. With twenty independent tests at α = 0.05 the chance of at least one false positive is 1 − 0.95²⁰ ≈ 64%, so a lone p = 0.013 out of twenty is the expected result of looking, not a finding.',
    toolId: 'hypothesis-tests',
    configOverride: {
      data: NO_EFFECT_GROUPS,
      test: 'one-way-anova',
      groupA: 'Line A',
      groupB: 'Line B',
      multiplicityInput: '0.013, 0.029, 0.113, 0.217, 0.247, 0.279, 0.466, 0.469, 0.544, 0.574, 0.623, 0.649, 0.74, 0.742, 0.795, 0.901, 0.916, 0.922, 0.942, 0.943',
      multiplicityMethod: 'holm',
      showAllAdjustments: true,
      level: 0.95,
    },
    assumptions: [
      'The group data are drawn from a single Normal(500, 20²) distribution: there is no effect anywhere in them.',
      'The twenty p-values are illustrative draws of the kind the null hypothesis produces — uniform on (0, 1) — not results of twenty real experiments.',
      'Bonferroni and Holm control the chance of any false positive; Benjamini–Hochberg controls the expected share of false positives among those declared. They answer different questions and the panel labels which.',
      'No correction can repair a p-value chosen after seeing which comparison looked best. The count of tests has to be the number you ran, not the number you report.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'time-series-seasonal-structure',
    title: 'Trend, season and noise in one series',
    question: 'My monthly numbers go up and wobble every year. How much of each is there?',
    description:
      'Sixty monthly observations generated from a level of 100, a trend of +0.8 per month, a sine seasonal of amplitude 12 at period 12, and Normal noise of standard deviation 3. STL separates the three, the ACF shows spikes at the seasonal lags, and an ARIMA forecast is extended eighteen months with intervals. Because the generating rule is stated, the decomposition can be read against it.',
    toolId: 'time-series',
    configOverride: {
      seriesText: SEASONAL_SERIES,
      useBuiltIn: false,
      period: 12,
      maxLag: 24,
      d: 1,
      p: 1,
      q: 1,
      horizon: 18,
      decomposition: 'stl',
    },
    assumptions: [
      'The series is generated from a known rule, stated in the description, with additive trend, season and noise.',
      'The seasonal period is supplied, not discovered. A wrong period makes every panel on the screen wrong rather than merely imprecise.',
      'Forecast intervals assume the fitted model is the true one and that the future behaves like the past. They widen with the horizon but do not account for the model being the wrong shape.',
    ],
    category: 'Time',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'time-series-autocorrelation-interval',
    title: 'The confidence interval that autocorrelation makes a lie',
    question: 'The average of my series is 0.69 with a standard error of 0.19. Is the mean really above zero?',
    description:
      'An AR(1) series of 120 points with coefficient 0.85 and a true mean of 0.5. Treated as 120 independent observations the mean of 0.69 carries a standard error of about 0.19, giving t ≈ 3.6 and an apparently decisive rejection of zero. But the observations are not independent: with φ = 0.85 the effective sample size is a fraction of 120, and the autocorrelation-corrected interval on this screen is several times wider — wide enough to include zero. The naive interval is not slightly optimistic, it is wrong by a factor, and the ACF panel shows why.',
    toolId: 'time-series',
    configOverride: {
      seriesText: AR1_SERIES,
      useBuiltIn: false,
      period: 12,
      maxLag: 30,
      meanNull: 0,
      d: 0,
      p: 1,
      q: 0,
      includeMean: true,
      adfSpecification: 'constant',
      horizon: 12,
    },
    assumptions: [
      'The series is generated from a known AR(1) rule with φ = 0.85 and a true mean of 0.5, so both the naive and the corrected interval can be judged against the truth.',
      'The correction assumes the series is stationary and that the autocorrelation structure is estimated well enough from 120 points — itself uncertain at this length.',
      'Autocorrelation inflates the variance of a mean; it does not bias it. The estimate is fine, the stated precision is not.',
    ],
    category: 'Time',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'imprecise-zero-failures',
    title: 'No failures in fifty trials — what can you claim?',
    question: 'Fifty units were tested and none failed. What is the failure rate?',
    description:
      'The imprecise Dirichlet model applied to 0 failures in 50 trials. A maximum-likelihood estimate says the rate is 0, which is a statement no engineer should sign. The model returns an interval instead: a lower probability of 0 \u2014 nothing observed rules a failure in \u2014 and an upper probability of s/(n + s), which is 0.0196 here. Those same bounds are entered as the credal set above, so the lower and upper probability of {Failure} on the screen is [0, 0.0196]. The width is the honest content of "we saw nothing happen", and unlike Laplace\u2019s or Jeffreys\u2019s rule it does not turn on the choice of a prior.',
    toolId: 'imprecise',
    configOverride: {
      mode: 'credal',
      credalOutcomes: 'Failure, No failure',
      credalLower: [0, 0.980392],
      credalUpper: [0.019608, 1],
      credalEventMask: 0b01,
      likelihood: [0.5, 0.5],
      idmCounts: [0, 50],
      idmS: 1,
    },
    assumptions: [
      'The counts are illustrative: fifty trials with no failure, chosen to show what the model does with an empty cell.',
      'The fifty trials are independent and identically distributed — the assumption that does the real work, and the one a test programme most often violates.',
      'The learning parameter s is a choice. s = 1 and s = 2 give different upper bounds, and the result is reported as bounds precisely because no single prior is forced on you.',
    ],
    category: 'Uncertainty',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'imprecise-dempster-conflict',
    title: "Dempster's rule reaching a conclusion neither source holds",
    question: 'Two diagnostics disagree almost completely. What should I believe after combining them?',
    description:
      'Two highly confident sources on the cause of a fault: one puts mass 0.99 on the pump and 0.01 on the sensor, the other 0.99 on the valve and 0.01 on the sensor. Dempster’s rule normalises away the conflict between the two near-certainties and returns belief 1.0 in the sensor — the one cause that neither source thought likely. The conflict measure on the screen is almost 1, which is the warning that the rule is being applied where its independence assumption cannot hold. Compare the alternative combination rules in the same panel: they do not all agree, and that disagreement is the real answer.',
    toolId: 'imprecise',
    configOverride: {
      mode: 'belief',
      beliefOutcomes: 'Pump, Valve, Sensor',
      source1: [
        { set: 'Pump', mass: 0.99 },
        { set: 'Sensor', mass: 0.01 },
      ],
      source2: [
        { set: 'Valve', mass: 0.99 },
        { set: 'Sensor', mass: 0.01 },
      ],
      beliefEventMask: 0b100,
    },
    assumptions: [
      'The masses are illustrative figures chosen to make the conflict extreme and the arithmetic visible, not the outputs of two real diagnostics.',
      "Dempster's rule assumes the two sources are independent and that both are reliable. Under near-total conflict at least one of those is false, and the rule has no way to say which.",
      'The combined belief of 1.0 in the sensor is arithmetically correct and epistemically absurd. Treat it as a demonstration of the rule’s failure mode, not as a conclusion.',
    ],
    category: 'Uncertainty',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'causal-adjusted-effect',
    title: 'Adjusting for what you measured',
    question: 'Treated patients did better. How much of that is the treatment?',
    description:
      'A cross-section with treatment, outcome and three recorded covariates. Inverse-probability weighting, g-computation, doubly robust AIPW and nearest-neighbour matching are estimated side by side, with the propensity overlap and covariate balance shown before any effect is read. Four methods on the same data and the same assumption; where they disagree, the overlap diagnostics usually say why.',
    toolId: 'causal',
    configOverride: {
      treatmentColumn: 'treated',
      outcomeColumn: 'outcome',
      covariateColumns: ['age', 'severity', 'income'],
      focusMethod: 'aipw',
      level: 0.95,
      trimCommonSupport: true,
      ipwStabilised: true,
    },
    assumptions: [
      'The built-in cross-section is illustrative data chosen to demonstrate the methods, not a record of any real programme.',
      'Every estimate on this screen assumes no unmeasured confounding: that age, severity and income are enough to explain who was treated. No diagnostic on the screen can test that assumption — balance on the measured covariates is not evidence about the unmeasured ones.',
      'Positivity: every kind of patient must have some chance of either treatment. The overlap plot can refute this, and trimming to the common support changes which population the estimate is about.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'causal-not-identified',
    title: 'When the data cannot answer the question',
    question: 'Can I estimate the treatment effect from this table at all?',
    description:
      'A hundred and twenty rows in which an unrecorded frailty raises both the chance of being treated and the outcome. The true effect is +5, and the frailty is not a column in the table. Adjusting for age — all there is to adjust for — returns a confident estimate of roughly +15 with a tight interval that excludes the truth: the estimate is precise and wrong, and nothing in its diagnostics says so. The Manski bounds panel is the honest answer. Assuming nothing about who was treated, it reports an interval so wide that it includes zero and both signs. That refusal to give a number is the correct output: this dataset does not identify the effect, and no estimator can repair a missing variable.',
    toolId: 'causal',
    configOverride: {
      dataText: CONFOUNDED_CROSS_SECTION,
      treatmentColumn: 'treated',
      outcomeColumn: 'outcome',
      covariateColumns: ['age'],
      focusMethod: 'ipw',
      outcomeLow: 20,
      outcomeHigh: 90,
      level: 0.95,
    },
    assumptions: [
      'The data are generated from a known rule: a treatment effect of exactly +5, plus an unrecorded frailty that raises both treatment and outcome. The unadjusted difference is about +15.',
      'Adjustment assumes the recorded covariates explain treatment assignment. Here that assumption is false by construction, which is the point — it is also exactly the situation you cannot detect from a real table.',
      'The Manski bounds assume only the stated logical limits of the outcome, 20 to 90. They are wide because that is all the data can support without an assumption about assignment; narrowing them requires an assumption, and the assumption is then what carries the conclusion.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'network-random-graph-structure',
    title: 'When does a random network hold together?',
    question: 'With an average of four connections each, is everyone reachable?',
    description:
      'An Erdős–Rényi graph on sixty nodes with mean degree 4. Shows the component structure, the degree distribution, the clustering coefficient and the centrality rankings. Mean degree 1 is the threshold: below it the graph is a dust of small fragments, above it a giant component appears. Here it holds 98% of the nodes, with one node isolated — so the diameter is reported as undefined rather than quietly computed over the largest component. At the same transmission rate used in the heavy-tailed example, this graph\u2019s network R\u2080 is well below 1.',
    toolId: 'networks',
    configOverride: {
      generator: 'erdos-renyi',
      nodes: 60,
      meanDegree: 4,
      seed: 'orbis-er-example',
      beta: 0.12,
      gamma: 1,
    },
    assumptions: [
      'The graph is generated at random from the stated model with a fixed seed; it is not a map of any real network.',
      'Erdős–Rényi connects every pair independently with the same probability. Real networks rarely do: they have hubs, triangles and communities, all of which change the answers below.',
    ],
    category: 'Systems',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'network-heavy-tail-threshold',
    title: 'Hubs and the epidemic threshold that vanishes',
    question: 'The transmission rate is low. Does that make an outbreak unlikely?',
    description:
      'A configuration-model network with a power-law degree sequence of exponent 2.2 on three hundred nodes: most nodes have a couple of connections and a few hubs have dozens. The epidemic threshold on a network is not set by the mean degree but by ⟨k²⟩/⟨k⟩, and with an exponent below 3 the second moment grows without bound — so the threshold falls towards zero and a low transmission rate is no protection. Here the mean degree is only 4.6, but one hub has 116 connections and the second moment is 138, so at a transmission rate of β = 0.12 the network R\u2080 is about 3 — against well under 1 on the Erdős–Rényi example, which has a similar mean degree and no tail. An SIR simulation at that same β is run on the graph, together with the random-failure against targeted-attack comparison. The structure drives the outcome, not the rate.',
    toolId: 'networks',
    configOverride: {
      generator: 'configuration',
      nodes: 300,
      plExponent: 2.2,
      plMinDegree: 1,
      seed: 'orbis-powerlaw-example',
      runSpreading: true,
      spreadModel: 'SIR',
      beta: 0.12,
      gamma: 1,
      spreadRuns: 80,
      runRobustness: true,
      robustnessReplicates: 8,
    },
    assumptions: [
      'The degree sequence is drawn from a power law with the stated exponent and a fixed seed. It is illustrative, not a measured contact network.',
      'The configuration model wires the stubs at random given the degrees, so it reproduces the degree distribution and nothing else: no clustering, no communities, no assortativity.',
      'The ⟨k²⟩/⟨k⟩ threshold is a result for the infinite network. On three hundred nodes the second moment is finite and sample-dependent, so the simulated outbreak sizes vary noticeably between seeds.',
      'The SIR model assumes an infected node transmits independently along each of its edges at the same rate — the assumption that makes degree, rather than who the neighbours are, the thing that matters.',
    ],
    category: 'Systems',
    synthetic: true,
    level: 'advanced',
  },
  // ---------------------------------------------------------------------
  // Decisions, Bayesian networks, reliability, queues, time-to-event,
  // sampling-based inference and extreme values. Each entry asks a question
  // someone would actually bring to the tool, and most are chosen so the
  // naive answer is wrong and the screen shows why.
  {
    id: 'decision-without-probabilities',
    title: 'Choosing when you cannot put numbers on the states',
    question: 'I have payoffs for each outcome but no probabilities at all. What should I choose?',
    description:
      'The payoff matrix judged by the criteria that need no probabilities: maximin, maximax, minimax regret, Hurwicz with a pessimism weight of 0.3, and Laplace. They do not agree, and the screen shows which action each one picks. The lesson is that in the absence of probabilities there is no neutral choice — only an explicit statement of how pessimistic you are willing to be.',
    toolId: 'decision',
    configOverride: { mode: 'criteria', hurwiczAlpha: 0.3 },
    assumptions: [
      'The payoffs are the engine’s illustrative drilling figures, chosen to make the criteria disagree; they are not estimates for any real venture.',
      'No probability is assumed for any state. The Laplace criterion silently supplies one — equal probabilities — which is a positive assumption, not an absence of one.',
      'The payoffs are treated as exact and as fully describing what matters, so nothing outside the matrix is weighed.',
    ],
    category: 'Decisions',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'decision-value-of-imperfect-information',
    title: 'What is a test worth before you buy it?',
    question: 'A survey would tell me something about the outcome but not everything. How much should I be willing to pay for it?',
    description:
      'The value of information on the payoff matrix: the expected value of perfect information as a ceiling, and the expected value of this imperfect survey — 85% sensitive, 75% specific — strictly below it. Shows the trap in buying information: a test that sounds accurate is worth nothing at all if it never changes the action you would have taken, and its price has to be compared with the EVSI rather than with the size of the decision.',
    toolId: 'decision',
    configOverride: {
      mode: 'information',
      test: { sensitivity: 0.85, specificity: 0.75, positiveStateIndex: 0, cost: 12 },
    },
    assumptions: [
      'Sensitivity 0.85, specificity 0.75 and a cost of 12 are illustrative figures chosen to put the EVSI strictly between zero and the EVPI.',
      'The prior probabilities over the states are taken as given. EVPI and EVSI are both computed against them, so a wrong prior misprices the information as well as the decision.',
      'The decision maker is assumed risk-neutral in these units, so expected value is the right thing to maximise. The risk panel shows how much that assumption is doing.',
      'The survey result is assumed to be the only new evidence, and its error rates are assumed known exactly rather than estimated.',
    ],
    category: 'Decisions',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'bayes-network-explaining-away',
    title: 'Explaining away: how one cause lowers the odds of another',
    question: 'The grass is wet. Does learning that the sprinkler was on change what I believe about the rain?',
    description:
      'Rain and the sprinkler are independent causes of wet grass. With wet grass observed, the network is queried for the rain. Conditioning on their common effect — a collider — makes the two causes dependent, so finding one explains the wet grass away and lowers the probability of the other. The d-separation panel is set to exactly this question, and reports the pair as dependent given wet grass although they are independent without it.',
    toolId: 'bayes-network',
    configOverride: {
      exampleId: 'sprinkler',
      customNodes: [],
      evidence: { wet: 'yes' },
      queryNode: 'rain',
      editNode: 'wet',
      xSet: ['rain'],
      ySet: ['sprinkler'],
      zSet: ['wet'],
      treatment: 'sprinkler',
      treatmentState: 'yes',
      outcome: 'wet',
    },
    assumptions: [
      'The network parameters are the published sprinkler figures used as a teaching example, not measurements of any garden.',
      'The graph is assumed to be the right one: rain and the sprinkler have no common cause, which is what makes them independent before the grass is observed.',
      'Every conditional probability table is taken as exact. No uncertainty in the numbers themselves is propagated.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'bayes-network-backdoor-adjustment',
    title: 'Seeing a treatment work when it does not',
    question: 'Recovery is more common among the treated. Does that mean the treatment causes recovery?',
    description:
      'A network in which baseline health affects both who gets treated and who recovers. The observational conditional P(recovery | treated) and the interventional P(recovery | do(treated)) are computed side by side and genuinely differ: the first is inflated because healthier patients were more likely to be treated in the first place. The d-separation panel is set to ask whether adjusting for baseline health blocks that back-door path, which is the justification for the adjusted number.',
    toolId: 'bayes-network',
    configOverride: {
      exampleId: 'confounded-treatment',
      customNodes: [],
      evidence: {},
      queryNode: 'recovery',
      editNode: 'treatment',
      xSet: ['treatment'],
      ySet: ['recovery'],
      zSet: ['health'],
      treatment: 'treatment',
      treatmentState: 'treated',
      outcome: 'recovery',
    },
    assumptions: [
      'The conditional probability tables are illustrative figures chosen so that the observational and interventional answers differ visibly.',
      'The causal claim rests entirely on the graph being correct, which no amount of data in this network can check. If a further common cause of treatment and recovery exists and is missing from the graph, the adjusted number is wrong too.',
      'Baseline health is assumed measured without error; adjusting for a noisy proxy does not fully close a back-door path.',
      'Conditioning on follow-up attendance would be worse than useless here: it is a common effect of treatment and recovery, so conditioning on it creates a dependence that is not there.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'reliability-series-multiplies',
    title: 'Five reliable parts, one unreliable system',
    question: 'If every one of five components works 99% of the time, how often does the system work?',
    description:
      'Five components in series, each at 0.99, giving a system reliability of 0.99⁵ ≈ 0.951 — a one-in-twenty failure rate built out of parts that each fail one time in a hundred. The importance measures show that with identical components no single part is the weak link: the length of the chain is.',
    toolId: 'reliability',
    configOverride: {
      mode: 'structure',
      structure: { preset: 'series', k: 3, reliabilities: { c1: 0.99, c2: 0.99, c3: 0.99, c4: 0.99, c5: 0.99 } },
    },
    assumptions: [
      'The 0.99 per component is a round illustrative figure, not a measured reliability.',
      'The components are assumed to fail independently. Multiplying the reliabilities is only valid under that assumption, and it is the assumption the structure calculation cannot test.',
      'Each component is either working or failed at the mission time, with no partial or degraded states.',
    ],
    category: 'Systems',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'reliability-common-cause-floor',
    title: 'Why triple redundancy is not a thousand times safer',
    question: 'I have three redundant units. Does that really make failure a thousand times less likely?',
    description:
      'Three parallel units compared two ways: assuming independent failures, and with a common-cause fraction of β = 0.15, meaning 15% of the failure rate hits every unit at once. The independent calculation makes redundancy look almost arbitrarily good, because it multiplies small numbers; the common-cause figure is dominated by the shared term and is worse by orders of magnitude. The standby panel adds the switch, which is itself a single point of failure.',
    toolId: 'reliability',
    configOverride: {
      mode: 'structure',
      structure: { preset: 'parallel', k: 3, reliabilities: { c1: 0.9, c2: 0.9, c3: 0.9, c4: 0.9, c5: 0.9 } },
      redundancy: { units: 3, failureRate: 0.0005, time: 1000, beta: 0.15, switchSuccessProbability: 0.95 },
    },
    assumptions: [
      'The failure rate, the mission time, β = 0.15 and the switch reliability are illustrative figures chosen to show the size of the effect.',
      'The common-cause fraction β is a judgement, not an estimate. Shared failures are rare by definition, so operating history almost never contains enough of them to fit β — the honest reading of the two numbers is as bounds on where the truth lies, with the independent figure as the optimistic end.',
      'The parallel structure assumes any one surviving unit is enough, and that the units are interchangeable.',
      'The independent column assumes a constant failure rate, so an exponential lifetime with no wear-out and no infant mortality.',
    ],
    category: 'Systems',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'queue-utilisation-blow-up',
    title: 'The last 10% of capacity is the expensive part',
    question: 'My single server is busy 90% of the time. How long do people wait, and what happens if demand rises slightly?',
    description:
      'An M/M/1 queue at 90% utilisation: arrivals of 9 per hour against a service rate of 10. The average number waiting is nine, not one, and the utilisation curve shows why — waiting time grows like ρ/(1−ρ), so it is already steep here and vertical just beyond. Raising demand from 9 to 9.5 roughly doubles the wait while capacity has not changed at all.',
    toolId: 'queueing',
    configOverride: { modelId: 'mm1', arrivalRate: 9, serviceRate: 10, servers: 1, waitThreshold: 0.5 },
    assumptions: [
      'The rates are illustrative round figures chosen to sit in the steep part of the curve.',
      'Arrivals follow a Poisson process and service times are exponential — both memoryless, which no real arrival pattern is. A rush hour makes things worse than this, not better.',
      'These are steady-state results. They describe a system that has been running under this load long enough to settle, which a system opening at nine and closing at five never does.',
      'The waiting room is unlimited and nobody gives up and leaves, so the model has no way to represent the thing that actually relieves an overloaded queue.',
    ],
    category: 'Systems',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'queue-service-variability',
    title: 'Same utilisation, four times the wait',
    question: 'Two teams handle the same workload at the same average speed. Why does one have a much longer queue?',
    description:
      'An M/G/1 queue at 80% utilisation with a service-time variability four times that of the exponential case. The mean service time is identical, and so is the utilisation, but the Pollaczek–Khinchine formula makes the wait scale with (1 + c²)/2, so the queue is far longer. Shows that the average service time is not enough information to predict a wait: reducing variability is often cheaper than adding capacity.',
    toolId: 'queueing',
    configOverride: { modelId: 'mg1', arrivalRate: 8, serviceRate: 10, serviceScv: 4, waitThreshold: 1 },
    assumptions: [
      'The squared coefficient of variation of 4 is an illustrative figure, chosen to show the size of the effect rather than taken from a measured service-time distribution.',
      'Only the mean and the variance of the service time enter the formula. Two very different service-time distributions with the same two moments give the same mean wait here, so this says nothing about the tail of the wait.',
      'Arrivals are still assumed Poisson; arrival variability above that would compound the effect.',
      'Steady state, a single server, one unlimited first-come first-served queue, and no abandonment.',
    ],
    category: 'Systems',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'survival-censoring-not-missing',
    title: 'Most of my units have not failed yet',
    question: 'Half my test units were still running when the study stopped. How do I estimate survival without throwing them away?',
    description:
      'Two batches followed to a fixed end date, with more than half of each still unfailed. The Kaplan–Meier curve uses every unit for as long as it was observed, and the risk table underneath shows the number still at risk falling as censoring removes them. Compare the estimate with the average of the observed failure times alone: dropping the censored units treats an unfailed unit as if it had never existed and understates survival badly, while treating censoring times as failures understates it too.',
    toolId: 'survival',
    configOverride: {
      data: [
        '# time, status, group   (status 1 = failure, 0 = still running when the study ended)',
        '2, 1, Batch A',
        '4, 1, Batch A',
        '5, 0, Batch A',
        '7, 1, Batch A',
        '9, 0, Batch A',
        '10, 1, Batch A',
        '13, 0, Batch A',
        '15, 1, Batch A',
        '18, 0, Batch A',
        '20, 0, Batch A',
        '3, 1, Batch B',
        '6, 0, Batch B',
        '8, 1, Batch B',
        '11, 0, Batch B',
        '14, 1, Batch B',
        '16, 0, Batch B',
        '19, 0, Batch B',
        '21, 1, Batch B',
        '23, 0, Batch B',
        '25, 0, Batch B',
      ].join('\n'),
      rmstHorizon: 18,
      showBand: true,
    },
    assumptions: [
      'The twenty observations are illustrative figures chosen to show what heavy censoring does, not a real test record.',
      'Censoring is assumed independent of the failure process: a unit withdrawn at time t is assumed no more and no less likely to fail soon than one still under test. Nothing in the data can check this, and it is the assumption the whole estimate rests on.',
      'With nine failures in twenty units the intervals are wide, and the comparison between batches is far too small to settle anything — the restricted mean is reported to a horizon of 18 because beyond that there is almost nobody left at risk.',
      'Both batches are assumed to be drawn from a single population each, with no further covariates at work.',
    ],
    category: 'Time',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'survival-competing-risks',
    title: 'When another failure mode gets there first',
    question: 'What fraction of units will fail by this cause within 20 periods, when a different cause is removing them as well?',
    description:
      'Time-to-event data with two failure modes, the competing one about half as common again as the one of interest. The cumulative incidence function is reported for the cause of interest, and 1 − Kaplan–Meier is refused rather than shown: treating a unit lost to the competing cause as merely censored pretends it is still eligible to fail the first way, which it is not, and overstates the incidence — the more so the longer the horizon.',
    toolId: 'survival',
    configOverride: {
      competingData: [
        '# time, cause   (1 = the failure mode of interest, 2 = a competing failure mode, 0 = still running)',
        '1, 2',
        '2, 2',
        '3, 1',
        '4, 2',
        '5, 2',
        '6, 1',
        '7, 2',
        '8, 2',
        '9, 1',
        '10, 2',
        '11, 0',
        '12, 1',
        '13, 2',
        '14, 2',
        '15, 1',
        '16, 2',
        '17, 0',
        '18, 1',
        '20, 2',
        '22, 1',
        '24, 0',
        '26, 2',
        '28, 1',
        '30, 0',
      ].join('\n'),
      competingCause: 1,
      rmstHorizon: 20,
    },
    assumptions: [
      'The twenty-four observations are illustrative figures chosen so that the competing cause is common enough for the gap to be obvious.',
      'The two causes are recorded without error, and each unit fails from at most one of them.',
      'The cumulative incidence function makes no assumption that the causes are independent of one another, which is why it is the quantity reported. The cause-specific hazards it is built from are each still estimated under independent censoring of the units that were simply still running.',
      'No causal statement follows: removing the competing cause would not leave the incidence of the first cause unchanged, and this data cannot say what it would become.',
    ],
    category: 'Time',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'mcmc-non-conjugate-rate',
    title: 'A rate with the prior you actually hold',
    question: 'I want a log-normal prior on an event rate rather than the conjugate Gamma. Can I still get a posterior?',
    description:
      'A Poisson rate with a log-normal prior, which has no closed-form posterior, sampled with a slice sampler over four chains. The posterior median and a 90% credible interval come with the diagnostics that make them trustworthy — R-hat, effective sample size and the Monte Carlo standard error — so the sampling error in the answer is reported next to the answer itself rather than hidden.',
    toolId: 'bayesian-inference',
    configOverride: {
      problemId: 'poisson-lognormal',
      sampler: 'slice',
      chains: 4,
      warmup: 500,
      iterations: 2000,
      level: 0.9,
      focusParameter: 0,
      seed: 'poisson-lognormal-slice',
    },
    assumptions: [
      'The ten counts and the prior parameters are illustrative figures chosen to demonstrate the method.',
      'The counts are assumed Poisson with a single constant rate — no overdispersion, no trend, no clustering in time.',
      'The log-normal prior is a genuine assumption and with only ten observations it still moves the answer. It was chosen because beliefs about rates are easier to state on the log scale, not because it is uninformative.',
      'Every posterior number here is empirical, from a finite run. The interval reported is a credible interval for the rate, which is a different statement from the spread of counts the rate would produce.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'mcmc-change-point',
    title: 'When did the rate change?',
    question: 'A count series looks like it slowed down part way through. When exactly, and how sure can I be?',
    description:
      'A Poisson series whose rate changes at an unknown time, with the change point treated as a parameter and given a posterior of its own. The trap is false precision: eyeballing the series picks one period and stops, while the posterior spreads over several and is correlated with the two rates. A slice sampler over four chains, with the convergence verdict, the effective sample size and the Monte Carlo error reported beside every number.',
    toolId: 'bayesian-inference',
    configOverride: {
      problemId: 'change-point-poisson',
      sampler: 'slice',
      chains: 4,
      warmup: 800,
      iterations: 2500,
      level: 0.95,
      focusParameter: 2,
      seed: 'change-point-slice',
    },
    assumptions: [
      'The thirty-two counts and the prior parameters are illustrative figures chosen to demonstrate the method.',
      'The model assumes exactly one change, and that it is a step rather than a drift. A series that drifts gradually will still be fitted a change point, and the posterior will not say that the model is wrong.',
      'Counts are assumed independent Poisson draws within each segment, with a constant rate in each.',
      'The change point is given a uniform prior over the record, which puts the same weight on a change in the first period as in the middle.',
      'Every number here is empirical, from a finite run. Diagnostics can show a chain has failed but cannot prove one has converged, so passing them is necessary and not sufficient.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'extremes-block-maxima-return-level',
    title: 'The worst level in fifty, from twenty years of maxima',
    question: 'What level is exceeded about once every fifty blocks, when the worst I have ever recorded is well below it?',
    description:
      'Block maxima of a weekly series, twenty observations to a block, fitted with a generalised extreme value distribution and used to read off the 50-block return level. Monte Carlo percentiles cannot answer this question at all, because they cannot reach past the largest value sampled; the GEV can, at the price of trusting a limit theorem. The fitted shape parameter is the whole story, and its confidence interval is reported with it.',
    toolId: 'extremes',
    configOverride: {
      method: 'block-maxima',
      blockSize: 20,
      returnPeriodBlocks: 50,
      queryLevel: 110,
      confidenceLevel: 0.95,
    },
    assumptions: [
      'The 400 observations are a simulated illustrative series, not a measured record of anything.',
      'The extremal types theorem is assumed to have taken hold at a block of twenty, which is a judgement about this block size rather than a result — only twenty blocks remain to fit three parameters.',
      'Blocks are assumed independent and identically distributed: no trend, no cycle and no change in the process over the record. A real series with a trend breaks this and the fit cannot detect it.',
      'The return level is a property of the fitted distribution, so its interval reflects parameter uncertainty only and not the possibility that the GEV is the wrong family.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'extremes-threshold-sensitivity',
    title: 'The threshold you pick decides the answer',
    question: 'What is the 100-year level from peaks over a threshold — and how much does it depend on where I put the threshold?',
    description:
      'The same series fitted by peaks over threshold with the threshold pinned at 65 rather than left to the automatic suggestion, with runs declustering so a single multi-week storm counts once. The mean residual life and parameter stability plots are the point: lower the threshold and the fit is biased because the limit has not taken hold, raise it and the interval widens as the exceedances run out. Move the threshold and watch the return level move with it — there is no setting at which the choice stops mattering.',
    toolId: 'extremes',
    configOverride: {
      method: 'peaks-over-threshold',
      thresholdOverride: 65,
      runLength: 3,
      tailK: 25,
      returnPeriodYears: 100,
      observationsPerYear: 52,
      queryLevel: 100,
      confidenceLevel: 0.95,
    },
    assumptions: [
      'The series is simulated and illustrative; the threshold of 65 was chosen to leave enough exceedances to fit while being high enough to argue for.',
      'The threshold is a judgement, not an estimate, and the reported interval does not include the uncertainty in having chosen it. The honest reading of the return level is as a range across defensible thresholds, which is wider than any one fit’s interval.',
      'Declustering with a run length of three assumes that three quiet observations separate independent events. Too short a run length counts one storm several times and makes the tail look busier than it is.',
      'Exceedances are assumed independent after declustering and the underlying process is assumed stationary over the whole record.',
      'The 100-year framing depends on the stated 52 observations per year; it is a statement about the fitted model, not a forecast for any particular year.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'advanced',
  },
  /*
   * The entries below cover seven tools that had a template but no worked
   * example: an opening at the defaults is not a demonstration of a question.
   * Several are deliberately traps — a plan that fails half the time, a peak
   * that is an artefact of the sampling rate, a decoding that contradicts
   * itself, a copula with no tail dependence at all — because the example
   * worth having is the one where the obvious answer is wrong. Every heavy
   * route (EM and particle filtering, FFT inversion, scenario approximation,
   * annealing, cross-validation, evidence estimation, discrepancy, lattice
   * search, Baum-Welch, family comparison, the copula sampler) is left off, so
   * each opens immediately; the descriptions say which panel to switch on.
   */
  {
    id: 'kalman-gap-in-the-data',
    title: 'A gap in the measurements',
    question: 'A sensor dropped out for twelve steps. What should the estimate do while it is blind, and how wide should the interval get?',
    description:
      'A local-level model: a level that wanders by a random walk, measured with noise three times larger than its own step. Twelve observations in the middle are missing, and the filter is given nothing rather than a substituted value — so the band widens through the gap and snaps back at the first real measurement. The smoothed line, which uses the whole series, bridges the gap far better than the filter could in real time. Whiteness, NEES and coverage are computed against the simulated truth; EM and direct likelihood fitting are the two panels to switch on afterwards.',
    toolId: 'state-filtering',
    configOverride: {
      modelKind: 'local-level',
      steps: 90,
      seed: 'level-gap-1',
      levelNoise: 0.6,
      measurementNoise: 3,
      missingFrom: 36,
      missingCount: 12,
      level: 0.9,
      focusState: 0,
    },
    assumptions: [
      'The series is simulated here from the stated model, which is the only reason a true state exists to check the filter against; with real data there is nothing to compare to and the diagnostics are all you have.',
      'The noise standard deviations 0.6 and 3 are illustrative figures chosen to make the gap visible, not estimates of any instrument.',
      'The measurements go missing for reasons unrelated to the value they would have had. If a sensor drops out precisely when the quantity is extreme, this filter is wrong and cannot tell.',
      'Both noise sources are Gaussian and uncorrelated with each other — the assumption the Kalman filter is optimal under, and one the innovation whiteness test can challenge but never confirm.',
    ],
    category: 'Time',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'ekf-overconfident-pendulum',
    title: 'A filter that is precise and wrong',
    question: 'My extended Kalman filter reports tight intervals on a swinging pendulum. Are they honest?',
    description:
      'A pendulum driven hard enough to swing right over the top, where sin θ is nowhere near θ, measured through a non-linear sensor. The EKF linearises about its own estimate, and on this series it comes apart: the mean NEES, computable only because the truth is simulated, is six orders of magnitude above the state dimension of 2. Nothing in the filter’s own output says so. Its covariance stays small and smooth, and its innovation whiteness p-value — the diagnostic that needs no truth — sits around 0.09 and does not reject at the 5% level. The UKF on exactly the same data, with the same model, stays consistent. That contrast is the example.',
    toolId: 'state-filtering',
    configOverride: {
      nonlinearModel: 'noisy-pendulum',
      pendulumMeasure: 'sine',
      nonlinearFilter: 'ekf',
      nonlinearSteps: 200,
      nonlinearSeed: 'swing-2',
      nonlinearProcessNoise: 1.5,
      nonlinearMeasurementNoise: 0.2,
      pendulumInitialAngle: 3,
      nonlinearFocusState: 0,
      missingFrom: 0,
      missingCount: 0,
      level: 0.95,
    },
    assumptions: [
      'The pendulum, its disturbance and its sensor are a simulated illustrative system, not a measured one; the amplitude and the disturbance are chosen large on purpose so the linearisation fails visibly.',
      'Both filters are given the exact model that generated the data, with analytic Jacobians. The failure is not a wrong model and not a numerical derivative — it is the linearisation itself, which is why no amount of parameter fitting would repair it.',
      'NEES needs the true state. On real data it is unavailable, and only innovation whiteness and interval coverage remain — weaker tests, and this run is a case where the whiteness test passes while the filter is badly wrong.',
      'A single simulated path is one draw. How far the EKF diverges depends on the seed; that it is capable of diverging while reporting a small covariance does not.',
    ],
    category: 'Time',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'characteristic-function-gamma',
    title: 'What a characteristic function is for',
    question: 'Why would I ever want the transform of a distribution instead of the distribution?',
    description:
      'A gamma distribution shown next to its characteristic function, its first six cumulants, and the density recovered from φ(t) alone by the Fang–Oosterlee cosine expansion. The point is the correspondence: φ determines the distribution completely, cumulants add under independent summation where moments do not, and a density can be rebuilt from the transform to several decimal places with a few hundred cosine terms. The FFT inversion and the n-fold convolution are the two panels to switch on next — both are left off because each evaluates φ thousands of times.',
    toolId: 'transforms',
    configOverride: { cfMaxT: 6, cfPoints: 241, cumulantOrder: 6, cosTerms: 256, cosGridPoints: 301 },
    assumptions: [
      'The gamma parameters are the tool’s own defaults, chosen to show the method; nothing here is a measurement.',
      'The cosine expansion is a numerical inversion on a truncated interval, so the recovered density is approximate and labelled as such — the truncation multiplier L is what controls how much of the tail is inside the window.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'aliasing-artefact',
    title: 'A 10 Hz peak that does not exist',
    question: 'My spectrum has a clean peak at 10 Hz. Is that periodicity real, or did my sampling rate invent it?',
    description:
      'Two hundred and fifty-six samples of a pure 90 Hz sinusoid, recorded every 0.01 seconds. The periodogram puts its largest bin at 10.16 cycles per second — the bin nearest 10 Hz — with the neighbouring bins carrying the leakage. There is no 10 Hz component in the signal at all: 90 Hz is above the 50 Hz Nyquist limit, so it folds back to 100 − 90 = 10 Hz, and the sampled points are indistinguishable from those of a genuine 10 Hz wave. No amount of analysis of this series can tell the two apart; only sampling faster, or filtering before sampling, can. Change the sampling interval to 0.002 s and the peak moves to where it belongs.',
    toolId: 'transforms',
    configOverride: {
      useBuiltInSignal: false,
      signalText: ALIASED_SIGNAL_TEXT,
      samplingInterval: 0.01,
      timeUnit: 'second',
      removeMean: true,
      spectrumScale: 'amplitude',
    },
    assumptions: [
      'The signal is generated here by the exact rule y = sin(2π·90t), so the truth is known: one component at 90 Hz and nothing else. The 10 Hz peak is entirely an artefact of the 100 Hz sampling rate.',
      'The frequency axis means nothing without the sampling interval, which is why it is an explicit input rather than an assumption buried in the chart.',
      'The record is finite, so every peak is spread across bins. 10 Hz falls between two bin centres at this resolution of 0.39 cycles per second, so the alias also leaks into its neighbours — the reported amplitude is below the true 1.0 for that reason, not because the component is weak.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'plan-on-the-mean-fails-half-the-time',
    title: 'A plan that fails half the time',
    question: 'I planned against the average machine capacity. How often will the plan actually fit?',
    description:
      'A two-product plan with one uncertain constraint, required to hold with probability 0.5 — which is exactly what planning against mean capacity means. The reformulation adds no safety margin at all, the optimum sits precisely on the constraint, and the measured probability that the plan fits comes out around a half: a coin flip every period. The tail-sensitivity table then prices the fix, showing what the objective gives up at 90%, 95% and 99% reliability. Scenario approximation and simulated annealing are the heavy panels, both off.',
    toolId: 'stochastic-optimisation',
    configOverride: {
      route: 'individual',
      variableNames: ['Line A', 'Line B'],
      sense: 'max',
      objective: [14, 10],
      upperBounds: [80, 80],
      rows: [{ name: 'Labour hours', coef: [2, 1], sense: '<=', rhs: 120 }],
      chanceRows: [{ name: 'Machine hours', meanCoef: [1.5, 1], sd: [0.3, 0.2], correlation: 0, rhs: 90, reliability: 0.5 }],
      lossScenarios: [
        { name: 'Machine time as planned', probability: 0.5, coef: [1.4, 0.9], rhs: 90 },
        { name: 'Mild overrun', probability: 0.3, coef: [1.6, 1.1], rhs: 90 },
        { name: 'Serious overrun', probability: 0.2, coef: [2, 1.4], rhs: 90 },
      ],
      jointReliability: 0.5,
      tailLevels: [0.5, 0.9, 0.95, 0.99],
      measureDraws: 4000,
      measureSeed: 'mean-plan-1',
    },
    assumptions: [
      'Every coefficient, margin and capacity here is an illustrative figure chosen to make the point; none is a measurement of a real operation.',
      'The uncertain coefficients are Gaussian, which is what makes the chance constraint a closed-form reformulation. A heavier left tail would make the realised reliability worse than stated, and this route cannot detect that.',
      'The correlation between the two uncertain coefficients is set to zero as an explicit input, not as a default: it is stated because it was assumed, and raising it changes the required margin.',
      'Reliability is per period and per constraint. A plan that fits with probability 0.5 each period fits in every one of twelve periods with probability about 0.02.',
    ],
    category: 'Decisions',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'joint-chance-bonferroni-cost',
    title: 'Three constraints that must all hold',
    question: 'I need all three uncertain constraints to hold together with 95% probability. What does the guarantee cost me?',
    description:
      'The same plan with three uncertain rows and a joint reliability requirement. Bonferroni splits the 5% allowance across the rows, so each is enforced at 98.3% — a sufficient condition, not an exact one, and therefore conservative. The screen reports the guaranteed bound, the probability measured by sampling the decision (which is higher than the guarantee, showing how much conservatism was bought), and the objective value handed over for it. The correlation between the rows is the lever: it is stated as an input because it is not knowable from the formulation.',
    toolId: 'stochastic-optimisation',
    configOverride: {
      route: 'joint',
      variableNames: ['Line A', 'Line B', 'Line C'],
      sense: 'max',
      objective: [14, 10, 8],
      upperBounds: [70, 70, 70],
      rows: [{ name: 'Labour hours', coef: [2, 1, 1.5], sense: '<=', rhs: 200 }],
      chanceRows: [
        { name: 'Machine hours', meanCoef: [1.5, 1, 1.2], sd: [0.3, 0.2, 0.25], correlation: 0.4, rhs: 150, reliability: 0.95 },
        { name: 'Scarce alloy', meanCoef: [0.9, 1.4, 0.6], sd: [0.2, 0.3, 0.1], correlation: 0.4, rhs: 110, reliability: 0.95 },
        { name: 'Skilled shifts', meanCoef: [0.5, 0.4, 0.7], sd: [0.1, 0.08, 0.15], correlation: 0.4, rhs: 60, reliability: 0.95 },
      ],
      jointReliability: 0.95,
      tailLevels: [0.9, 0.95, 0.99, 0.999],
      measureDraws: 6000,
      measureSeed: 'joint-cost-1',
    },
    assumptions: [
      'All coefficients, standard deviations and capacities are illustrative figures chosen to demonstrate the method.',
      'Bonferroni requires no assumption about how the rows depend on one another, which is exactly why it is conservative: it is a bound that holds for any dependence, including the worst.',
      'The measured joint probability is computed under one stated correlation of 0.4 between coefficients within a row. That number is an input; if the real dependence is unknown, the guarantee is the honest answer and the measured figure is not.',
      'The uncertain coefficients are Gaussian. The guarantee survives a different shape only as a bound, not as the stated probability.',
    ],
    category: 'Decisions',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'polynomial-fit-always-improves',
    title: 'The fit always improves. The model does not.',
    question: 'Each extra polynomial term fits my data better. How do I know when to stop?',
    description:
      'Six nested polynomials fitted to forty points generated from a cubic. The residual sum of squares falls monotonically with every term added — it has to, because each model contains the one before it — so in-sample fit cannot choose. BIC, which penalises parameters by log n rather than 2, is the criterion here; switching to AIC and watching the ranking change is the exercise, because when two criteria disagree the honest reading is that the data does not settle it. Cross-validation and evidence estimation are the two heavy panels, both off until asked for.',
    toolId: 'model-comparison',
    configOverride: { degrees: [1, 2, 3, 4, 5, 6], criterion: 'bic', differencePair: [3, 5], bayesFactorPair: [3, 5] },
    assumptions: [
      'The built-in data is synthetic: forty points from the fixed rule y = 1 + 2x − 0.5x² + 0.3x³ with Normal(0, 1.2²) noise. The truth is the cubic, so the correct answer is known and the criteria can be read against it.',
      'All six models assume independent, equal-variance Gaussian errors. A criterion compares models within that assumption and says nothing about whether the assumption holds.',
      'Information criteria are asymptotic approximations. At n = 40 with six candidates the differences between the middle models are small enough that their ordering should not be trusted on its own.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'elpd-difference-within-its-own-error',
    title: 'A difference smaller than its own standard error',
    question: 'The quadratic beats the straight line on every criterion. Is that evidence of curvature?',
    description:
      'Thirty points generated from a straight line with large noise, fitted by polynomials up to degree six. The higher models all score slightly better in sample, and a reader who ranks them will conclude there is curvature. There is none. The Akaike-style weights on arrival already show how little separates the candidates; switch on cross-validation — the one expensive panel, off until asked for — and the paired elpd difference between the straight line and the cubic appears with its own standard error. The difference is smaller than that error, which is not weak evidence for the cubic but no evidence at all.',
    toolId: 'model-comparison',
    configOverride: {
      dataText: LINEAR_TRUTH_TEXT,
      degrees: [1, 2, 3, 4, 5, 6],
      criterion: 'aicc',
      differencePair: [1, 3],
      bayesFactorPair: [1, 3],
      evidenceSigma: 2.5,
    },
    assumptions: [
      'The data is generated here by the fixed rule y = 3 + 1.4x with Normal(0, 2.5²) noise, from a fixed linear congruential sequence so every machine sees the same numbers. The truth is the straight line: every curve the higher polynomials appear to find is noise.',
      'The errors really are independent and equal-variance here because they were generated that way. On real data that is an assumption, and autocorrelated errors make every one of these standard errors too small.',
      'A standard error on a difference in predictive performance is itself estimated from thirty points, so it is noisy too. The conclusion to draw is that the comparison is undecided, not that a precise small difference has been measured.',
      'The known error scale supplied to the evidence model is the true 2.5 here. On real data it would have to be estimated, and the Bayes factor is sensitive to it as well as to the prior scale.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'qmc-has-no-error-bar',
    title: 'A faster estimate with no error bar',
    question: 'Quasi-Monte Carlo converges faster than random sampling. So why can I not put a confidence interval on it?',
    description:
      'A two-dimensional integral with a known exact value of 0.25, estimated from 4096 Halton points, with the point set itself plotted alongside. The signed error comes out around 4 × 10⁻⁴ — better than random sampling would typically manage at this count — and the projection shows why: the points cover the square evenly instead of clumping. Then the catch, stated rather than hidden — the construction is deterministic, so there is no sampling distribution and no confidence interval exists. What is available is the Koksma–Hlawka bound, which is deterministic, true, and almost always far too loose to use. Switching on randomisation is what buys a real error bar; discrepancy, the lattice search and the convergence ladder — which is where the rate is compared against plain Monte Carlo — are the other panels, all off.',
    toolId: 'quasi-monte-carlo',
    configOverride: {
      sequence: 'halton',
      dimension: 2,
      pointCount: 1024,
      projectionX: 1,
      projectionY: 2,
      integrand: 'product',
      samples: 4096,
      useRandomisation: false,
      haltonScramble: false,
    },
    assumptions: [
      'The integrand is a built-in test function with a known exact value, which is the only reason the true error can be shown. In a real application it is unknown, and that is precisely when the missing error bar matters.',
      'A quasi-Monte Carlo error bound depends on the variation of the integrand, not just its variance. For an integrand that is not smooth, or has a kink along a diagonal, the advantage over random sampling can vanish entirely.',
      'One deterministic point set gives one number. Repeating it changes nothing, so the spread that a confidence interval would describe does not exist here.',
    ],
    category: 'Simulation',
    synthetic: false,
    level: 'introductory',
  },
  {
    id: 'qmc-high-dimensional-randomised',
    title: 'Halton in thirty dimensions, scrambled and randomised',
    question: 'Does a low-discrepancy sequence still help in thirty dimensions, and how do I get an honest error estimate there?',
    description:
      'The same construction at dimension 30, where the high coordinates use large prime bases and a plain Halton sequence degenerates: the later projections line up along visible stripes and cover the square badly. Scrambling the digits fixes the projections, and sixteen independent digit-permutation randomisations turn the estimate into one with a genuine standard error — reported in its own panel, because the single unrandomised estimate above it still has none. Switch the scramble off and look at the projection of coordinates 29 and 30 to see what is being fixed.',
    toolId: 'quasi-monte-carlo',
    configOverride: {
      sequence: 'halton',
      dimension: 30,
      pointCount: 512,
      projectionX: 29,
      projectionY: 30,
      haltonScramble: true,
      haltonSkip: 64,
      integrand: 'genz-product-peak',
      samples: 4096,
      useRandomisation: true,
      replications: 16,
      seed: 'qmc-highdim-1',
    },
    assumptions: [
      'The integrand is a built-in test function with a known value, so the reported error is a real error rather than an estimate.',
      'The error bar comes from sixteen independent randomisations, so it is itself estimated from sixteen numbers and should be read as approximate.',
      'The effective dimension matters more than the nominal one. This integrand concentrates its variance in the first few coordinates, which is why quasi-Monte Carlo still helps at thirty; an integrand that used all thirty equally would show much less advantage.',
    ],
    category: 'Simulation',
    synthetic: false,
    level: 'intermediate',
  },
  {
    id: 'hmm-regime-from-counts',
    title: 'Inferring a regime you cannot see',
    question: 'I only see how busy the line looks. Can I tell which regime it was in, and what is coming next?',
    description:
      'A two-state chain — quiet and busy — observed only through a three-level reading. Forward–backward gives the probability of each hidden state at every step with its entropy, so the steps where the inference was genuinely decided by the data are distinguishable from those where it was close to a coin flip. Viterbi gives the single most likely history, and the forecast extends six steps past the last observation, decaying towards the stationary distribution. Baum-Welch fitting and order selection are the opt-in panels.',
    toolId: 'hidden-markov',
    configOverride: {
      stateNames: ['Quiet', 'Busy'],
      initial: [0.6, 0.4],
      transition: [
        [0.85, 0.15],
        [0.25, 0.75],
      ],
      symbols: ['Few', 'Some', 'Many'],
      emissionMatrix: [
        [0.6, 0.3, 0.1],
        [0.1, 0.35, 0.55],
      ],
      observationText:
        'Few Few Some Few Some Many Some Many Many Some Few Few Some Few Few Some Many Many Some Few Few Some Few Few',
      horizon: 6,
      hittingTargets: [1],
      fitStates: 2,
      maxOrder: 2,
    },
    assumptions: [
      'The transition and emission probabilities are illustrative figures chosen to demonstrate the method; they are not estimated from anything.',
      'The parameters are treated as known. In practice they would be fitted, and the decoded path would inherit that uncertainty, which this screen does not propagate.',
      'The hidden chain is first-order Markov and the readings are independent given the state. Both are strong assumptions; the Markov property test and order selection exist to challenge the first.',
      'Two states is a choice, not a finding. Baum-Welch cannot learn the number of states, so it has to be selected and justified separately.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'introductory',
  },
  {
    id: 'viterbi-against-pointwise',
    title: 'A decoding that cannot have happened',
    question: 'Why does the most likely sequence of states disagree with the most likely state at each step?',
    description:
      'A three-state chain in which Nominal and Faulted cannot be adjacent: every switch must pass through a brief Transition state. Decoded step by step, the most likely state at each time gives a path that steps straight from Nominal to Faulted — each state individually most likely, the sequence as a whole of probability exactly zero. Viterbi, which maximises the probability of the whole path, inserts the Transition step and so disagrees with the pointwise answer at that time. The two are answers to different questions, and this is the case where treating them as interchangeable produces a history the model says cannot occur.',
    toolId: 'hidden-markov',
    configOverride: {
      stateNames: ['Nominal', 'Transition', 'Faulted'],
      initial: [0.8, 0.1, 0.1],
      transition: [
        [0.98, 0.02, 0],
        [0.4, 0.2, 0.4],
        [0, 0.02, 0.98],
      ],
      symbols: ['Low', 'Mid', 'High'],
      emissionMatrix: [
        [0.85, 0.12, 0.03],
        [0.45, 0.1, 0.45],
        [0.03, 0.12, 0.85],
      ],
      observationText: 'Low Mid Low High High Low Mid Low Mid Low Mid Mid High High High Mid',
      horizon: 6,
      hittingTargets: [2],
      maxOrder: 2,
      fitStates: 3,
    },
    assumptions: [
      'The model is constructed to make the point: the two structural zeros in the transition matrix are what make the pointwise path impossible, and they are an assumption about the system, not a measurement.',
      'The Transition state emits either extreme almost equally, which is why it is hard to see and why the pointwise decoding skips it.',
      'The probabilities are illustrative figures. The disagreement is a property of this structure; with a different sequence the two decodings may well agree, which the screen reports either way.',
      'Structural zeros are strong claims. If the forbidden jump is merely rare rather than impossible, the Viterbi path changes and the contrast softens.',
    ],
    category: 'Inference',
    synthetic: true,
    level: 'advanced',
  },
  {
    id: 'gaussian-copula-misses-joint-extremes',
    title: 'A copula with no tail dependence at any correlation',
    question: 'I fitted a Gaussian copula to calm data. How badly does it understate the chance that both things go wrong at once?',
    description:
      'Paired data with clear upper-tail clustering, fitted with a Gaussian copula whose correlation is inverted from the sample Kendall tau. The fit matches the overall rank correlation well, and on the bulk of the data the difference heatmap looks unremarkable. The tail does not: the Gaussian copula has upper tail dependence exactly zero for every correlation short of one, so as the quantile is pushed out its implied chance of a joint extreme falls away while the data keeps clustering. The Fréchet–Hoeffding bounds at the probe point show how much room any copula has at all. Family comparison and the sampler are the opt-in panels.',
    toolId: 'copula',
    configOverride: {
      dataSource: 'built-in',
      builtInId: 'gumbel-upper',
      familyId: 'gaussian',
      paramMode: 'from-sample-tau',
      gridSize: 15,
      probeU: 0.95,
      probeV: 0.95,
      tailQuantile: 0.05,
    },
    assumptions: [
      'The built-in dataset is generated from a known Gumbel copula, so the truth is known: there is genuine upper-tail dependence, and the Gaussian fit is wrong about it by construction rather than by bad luck.',
      'Matching Kendall tau does not match the tail. Two families agreeing on every rank correlation can differ by a factor of several in the probability that both variables are extreme together.',
      'Tail dependence is a limit as the quantile goes to the extreme, and it is being judged from a finite sample where the furthest tail holds a handful of points. The empirical tail figure is noisy; the Gaussian copula’s zero is exact and analytic.',
      'The copula says nothing about the margins, and the margins say nothing about the copula. This separation is the method’s strength and the reason a good marginal fit is no evidence for the dependence structure.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'intermediate',
  },
  {
    id: 'clayton-lower-tail-losses',
    title: 'Lower-tail dependence, set by hand',
    question: 'My two positions both fell together in the worst weeks. Which dependence structure represents that, and what does it imply?',
    description:
      'Data with clustered joint lows, fitted with a Clayton copula whose parameter is set by hand rather than inverted from tau, so the effect of the parameter on the lower tail can be moved and watched directly. Clayton has lower-tail dependence λ_L = 2^(−1/θ) and upper-tail dependence zero — an asymmetry the Gaussian family cannot express at all. The empirical copula difference heatmap shows where the fit is and is not supported, and the probe at (0.05, 0.05) is read against the Fréchet–Hoeffding bounds, which are the widest any joint distribution with these margins could be.',
    toolId: 'copula',
    configOverride: {
      dataSource: 'built-in',
      builtInId: 'clayton-lower',
      familyId: 'clayton',
      paramMode: 'manual',
      params: { theta: 2 },
      gridSize: 15,
      probeU: 0.05,
      probeV: 0.05,
      tailQuantile: 0.05,
    },
    assumptions: [
      'The built-in dataset is generated from a known Clayton copula, so the fit can be read against the truth; it is illustrative data, not a record of any market.',
      'θ = 2 is set by hand to demonstrate the parameter, not estimated. Inverting it from the sample tau instead is one click away, and the two values will differ.',
      'Clayton can only represent positive association, and only lower-tail clustering. Choosing it is a claim about the direction of the asymmetry that the data on its own may not support.',
      'Where the true relationship is unknown, the Fréchet–Hoeffding bounds are the honest answer: they hold for every possible dependence structure, and any single fitted copula is narrower than the evidence warrants.',
    ],
    category: 'Analysis',
    synthetic: true,
    level: 'advanced',
  },
];

export const EXAMPLE_CATEGORIES = [...new Set(EXAMPLES.map((e) => e.category))];

/** Built-in templates: a tool plus a starting configuration, by category. */
export interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  toolId: ToolId;
  /** As on `Example`: the difference from the tool's default configuration. */
  configOverride: Record<string, unknown>;
  category: string;
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  { id: 't-basics', name: 'Probability conversion', description: 'Enter a probability in any form and read it in every other form, with its complement and odds.', toolId: 'probability-basics', configOverride: {}, category: 'Probability fundamentals' },
  { id: 't-two-events', name: 'Two events', description: 'Combine two events once you have stated how they relate, or obtain bounds when the relationship is unknown.', toolId: 'event-relationships', configOverride: {}, category: 'Conditional probability' },
  { id: 't-counting', name: 'Counting selections', description: 'Exact permutation and combination counts, with the four counting problems compared.', toolId: 'combinatorics', configOverride: {}, category: 'Probability fundamentals' },
  { id: 't-repeated', name: 'Repeated attempts', description: 'At least one, exactly k, runs, waiting times and attempts needed for a target probability.', toolId: 'repeated-trials', configOverride: {}, category: 'Repeated trials' },
  { id: 't-bayes', name: 'Updating on evidence', description: "Bayes' theorem for several hypotheses, or the diagnostic-test view.", toolId: 'bayes', configOverride: {}, category: 'Conditional probability' },
  { id: 't-conjugate', name: 'Learning a rate from data', description: 'Conjugate Bayesian updating with credible intervals and a predictive statement.', toolId: 'bayesian-updating', configOverride: {}, category: 'Conditional probability' },
  { id: 't-distribution', name: 'Distribution analysis', description: 'Parameters, graph, statistics, quantiles and interval probabilities for any supported distribution.', toolId: 'distribution-explorer', configOverride: {}, category: 'Distribution analysis' },
  { id: 't-experiment', name: 'Random experiment', description: 'Coins, dice, cards, urns or custom outcomes, with exact theoretical comparison.', toolId: 'experiment', configOverride: {}, category: 'Random experiments' },
  { id: 't-monte-carlo', name: 'Monte Carlo simulation', description: 'A built-in model with convergence analysis and comparison against the exact value.', toolId: 'simulation', configOverride: {}, category: 'Monte Carlo simulation' },
  { id: 't-scenario', name: 'Scenario model', description: 'Your own variables, dependencies and output metrics.', toolId: 'scenario', configOverride: {}, category: 'Scenario comparison' },
  { id: 't-sensitivity', name: 'Sensitivity analysis', description: 'Sweeps, tornado charts, rank correlation or Sobol variance decomposition.', toolId: 'sensitivity', configOverride: {}, category: 'Sensitivity analysis' },
  { id: 't-risk', name: 'Risk exploration', description: 'A loss distribution with Value at Risk and Expected Shortfall, or a risk register.', toolId: 'risk', configOverride: {}, category: 'Risk exploration' },
  { id: 't-data', name: 'Dataset analysis', description: 'Import a file and analyse it locally: statistics, relationships, tests and bootstrap intervals.', toolId: 'data-lab', configOverride: {}, category: 'Statistical data analysis' },
  { id: 't-markov', name: 'Markov chain', description: 'States and transitions, with long-run behaviour and absorption analysis.', toolId: 'markov', configOverride: {}, category: 'Scenario comparison' },
  // The templates above cover the tools the application shipped with. These
  // cover the rest: every tool now has at least one starting point, because a
  // tool with no entry in the library is one nobody finds a way into. Each
  // opens its tool at its own defaults, which are chosen per screen to show a
  // real, correct result immediately rather than an empty form.
  { id: 't-decision', name: 'Decision analysis', description: 'Turn probabilities into a decision, and price the risk you are taking.', toolId: 'decision', configOverride: {}, category: 'Decisions' },
  { id: 't-bayes-network', name: 'Bayesian networks', description: 'State how everything depends on everything else, then ask any question of it.', toolId: 'bayes-network', configOverride: {}, category: 'Inference' },
  { id: 't-reliability', name: 'Reliability and failure', description: 'Work out whether a system holds, from what you know about its parts.', toolId: 'reliability', configOverride: {}, category: 'Systems' },
  { id: 't-queueing', name: 'Queues and waiting', description: 'How long the queue gets, and how many servers it takes to fix it.', toolId: 'queueing', configOverride: {}, category: 'Systems' },
  { id: 't-survival', name: 'Time to event', description: 'How long until it happens, when some cases have not happened yet.', toolId: 'survival', configOverride: {}, category: 'Time' },
  { id: 't-bayesian-inference', name: 'Bayesian inference', description: 'Update any prior with any likelihood, not just the conjugate ones.', toolId: 'bayesian-inference', configOverride: {}, category: 'Inference' },
  { id: 't-extremes', name: 'Extreme values', description: 'How bad the worst case can get, beyond anything you have observed.', toolId: 'extremes', configOverride: {}, category: 'Analysis' },
  { id: 't-regression', name: 'Regression modelling', description: 'How one quantity depends on others, with the uncertainty stated honestly.', toolId: 'regression', configOverride: {}, category: 'Analysis' },
  { id: 't-distribution-fitting', name: 'Distribution fitting', description: 'Which distribution describes your data, and how well it really fits.', toolId: 'distribution-fitting', configOverride: {}, category: 'Data' },
  { id: 't-hypothesis-tests', name: 'Hypothesis tests', description: 'Compare groups, with or without a normality assumption, and know what a null result means.', toolId: 'hypothesis-tests', configOverride: {}, category: 'Analysis' },
  { id: 't-time-series', name: 'Time series', description: 'Data where the order matters: structure, forecasts, and what autocorrelation does to your errors.', toolId: 'time-series', configOverride: {}, category: 'Time' },
  { id: 't-causal', name: 'Causal inference', description: 'Whether this dataset can answer a causal question at all, and what it takes to believe the answer.', toolId: 'causal', configOverride: {}, category: 'Analysis' },
  { id: 't-networks', name: 'Networks and epidemics', description: 'Spread, reachability and failure across a network, where the structure drives the outcome more than the rate does.', toolId: 'networks', configOverride: {}, category: 'Systems' },
  { id: 't-processes', name: 'Stochastic processes', description: 'Processes that evolve in continuous time: exact laws where they exist, simulated paths where they do not.', toolId: 'processes', configOverride: {}, category: 'Time' },
  { id: 't-portfolio', name: 'Portfolio risk', description: 'Risk across holdings that move together, where the correlations do most of the damage.', toolId: 'portfolio', configOverride: {}, category: 'Decisions' },
  { id: 't-des', name: 'Discrete-event simulation', description: 'Systems where entities queue, seize resources and wait — simulated event by event rather than solved in closed form.', toolId: 'des', configOverride: {}, category: 'Simulation' },
  { id: 't-information', name: 'Information theory', description: 'How much a message, a measurement or a forecast actually tells you — in bits.', toolId: 'information', configOverride: {}, category: 'Analysis' },
  { id: 't-elicitation', name: 'Expert judgement', description: 'Turning an opinion into a distribution, without pretending the result is a measurement.', toolId: 'elicitation', configOverride: {}, category: 'Uncertainty' },
  { id: 't-sequential', name: 'Sequential decisions', description: 'Decisions taken one after another, where what you do now changes what you learn next.', toolId: 'sequential', configOverride: {}, category: 'Decisions' },
  { id: 't-gaussian-process', name: 'Gaussian processes', description: 'A distribution over functions: predictions that widen honestly where you have no data.', toolId: 'gaussian-process', configOverride: {}, category: 'Inference' },
  { id: 't-state-filtering', name: 'State estimation', description: 'Recovering a hidden state from noisy measurements, and checking whether the filter is honest.', toolId: 'state-filtering', configOverride: {}, category: 'Time' },
  { id: 't-transforms', name: 'Transforms and spectra', description: 'Moving between the time and frequency pictures of a signal, and between distributions and their transforms.', toolId: 'transforms', configOverride: {}, category: 'Analysis' },
  { id: 't-stochastic-optimisation', name: 'Optimisation under uncertainty', description: 'Choosing a plan when the constraints themselves are random, with the reliability you asked for.', toolId: 'stochastic-optimisation', configOverride: {}, category: 'Decisions' },
  { id: 't-model-comparison', name: 'Model comparison', description: 'Which of several models to believe, and whether the data can tell them apart at all.', toolId: 'model-comparison', configOverride: {}, category: 'Inference' },
  { id: 't-quasi-monte-carlo', name: 'Quasi-Monte Carlo', description: 'Deliberately even point sets that converge faster than random ones — and the discrepancy that says why.', toolId: 'quasi-monte-carlo', configOverride: {}, category: 'Simulation' },
  { id: 't-hidden-markov', name: 'Hidden Markov models', description: 'A chain you cannot see directly, inferred from what it emits — plus deep diagnostics for chains you can.', toolId: 'hidden-markov', configOverride: {}, category: 'Inference' },
  { id: 't-copula', name: 'Dependence and copulas', description: 'Separating what each variable does from how they move together — especially in the tail.', toolId: 'copula', configOverride: {}, category: 'Analysis' },
  { id: 't-imprecise', name: 'Imprecise probability', description: 'For when you genuinely do not know the probability: bounds instead of a number you cannot justify.', toolId: 'imprecise', configOverride: {}, category: 'Uncertainty' },
];

export const TEMPLATE_CATEGORIES = [...new Set(BUILT_IN_TEMPLATES.map((t) => t.category))];
