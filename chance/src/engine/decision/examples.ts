/**
 * A library of worked decisions.
 *
 * Each example is a complete, self-contained problem with the numbers written
 * out, so the interface has something to show and the machinery has something
 * honest to be checked against. The numbers are illustrative figures in the
 * style of the standard textbook treatments of each problem; they are not
 * claims about any real well, patient, product or insurer. Every one of them is
 * an assumption, which is exactly what the `assumedInputs` of a result says.
 */
import type { DecisionProblem, DecisionTree } from './types';
import type { TestInformation } from './information';
import type { NewsvendorInput } from './portfolio';
import type { UtilitySpec } from './utility';
import type { Lottery } from './types';

export interface WorkedExample {
  id: string;
  name: string;
  /** What the decision is. */
  summary: string;
  /** What the example is here to demonstrate. */
  teaches: string;
  /** The questions the example is built to answer. */
  questions: string[];
  tree?: DecisionTree;
  problem?: DecisionProblem;
  test?: TestInformation;
  newsvendor?: NewsvendorInput;
  /** For the insurance example: the lottery faced and the premium quoted. */
  insurance?: {
    uninsured: Lottery;
    premium: number;
    /** A risk attitude under which the recommendation flips. */
    riskAverseUtility: UtilitySpec;
  };
  unit: string;
}

/* ------------------------------------------------- 1. wildcat drilling + test */

const P_WET = 0.4;
const DRILL_WET = 200;
const DRILL_DRY = -70;
const SEISMIC_COST = 10;
const SENSITIVITY = 0.9; // P(favourable seismic | wet)
const SPECIFICITY = 0.8; // P(unfavourable seismic | dry)

const jointWetPos = P_WET * SENSITIVITY;
const jointDryPos = (1 - P_WET) * (1 - SPECIFICITY);
const pPositive = jointWetPos + jointDryPos;
const pWetGivenPositive = jointWetPos / pPositive;
const pWetGivenNegative = (P_WET * (1 - SENSITIVITY)) / (1 - pPositive);

const wildcatTree: DecisionTree = {
  id: 'wildcat',
  name: 'Wildcat drilling with a seismic test',
  unit: '$000',
  root: {
    kind: 'decision',
    id: 'test-or-not',
    label: 'Commission a seismic survey?',
    alternatives: [
      {
        label: 'Run the seismic survey',
        payoff: -SEISMIC_COST,
        child: {
          kind: 'chance',
          id: 'seismic-result',
          label: 'Seismic result',
          branches: [
            {
              label: 'Favourable structure',
              probability: pPositive,
              child: {
                kind: 'decision',
                id: 'drill-after-favourable',
                label: 'Drill after a favourable survey?',
                alternatives: [
                  {
                    label: 'Drill',
                    child: {
                      kind: 'chance',
                      id: 'well-after-favourable',
                      label: 'Well outcome',
                      branches: [
                        { label: 'Wet (oil)', probability: pWetGivenPositive, child: { kind: 'terminal', id: 't1', payoff: DRILL_WET } },
                        { label: 'Dry hole', probability: 1 - pWetGivenPositive, child: { kind: 'terminal', id: 't2', payoff: DRILL_DRY } },
                      ],
                    },
                  },
                  { label: 'Walk away', child: { kind: 'terminal', id: 't3', payoff: 0 } },
                ],
              },
            },
            {
              label: 'Unfavourable structure',
              probability: 1 - pPositive,
              child: {
                kind: 'decision',
                id: 'drill-after-unfavourable',
                label: 'Drill after an unfavourable survey?',
                alternatives: [
                  {
                    label: 'Drill',
                    child: {
                      kind: 'chance',
                      id: 'well-after-unfavourable',
                      label: 'Well outcome',
                      branches: [
                        { label: 'Wet (oil)', probability: pWetGivenNegative, child: { kind: 'terminal', id: 't4', payoff: DRILL_WET } },
                        { label: 'Dry hole', probability: 1 - pWetGivenNegative, child: { kind: 'terminal', id: 't5', payoff: DRILL_DRY } },
                      ],
                    },
                  },
                  { label: 'Walk away', child: { kind: 'terminal', id: 't6', payoff: 0 } },
                ],
              },
            },
          ],
        },
      },
      {
        label: 'Drill without a survey',
        child: {
          kind: 'chance',
          id: 'well-no-survey',
          label: 'Well outcome',
          branches: [
            { label: 'Wet (oil)', probability: P_WET, child: { kind: 'terminal', id: 't7', payoff: DRILL_WET } },
            { label: 'Dry hole', probability: 1 - P_WET, child: { kind: 'terminal', id: 't8', payoff: DRILL_DRY } },
          ],
        },
      },
      { label: 'Abandon the prospect', child: { kind: 'terminal', id: 't9', payoff: 0 } },
    ],
  },
};

const wildcatProblem: DecisionProblem = {
  id: 'wildcat-matrix',
  name: 'Drill or walk away',
  actions: ['Drill', 'Walk away'],
  states: ['Wet (oil)', 'Dry hole'],
  payoffs: [
    [DRILL_WET, DRILL_DRY],
    [0, 0],
  ],
  priors: [P_WET, 1 - P_WET],
  unit: '$000',
};

const seismicTest: TestInformation = {
  label: `Seismic survey (sensitivity ${SENSITIVITY}, specificity ${SPECIFICITY}), cost ${SEISMIC_COST}`,
  signals: ['Favourable structure', 'Unfavourable structure'],
  likelihood: [
    [SENSITIVITY, 1 - SENSITIVITY],
    [1 - SPECIFICITY, SPECIFICITY],
  ],
};

/* ------------------------------------------------- 2. medical test and treat */

const medicalProblem: DecisionProblem = {
  id: 'test-and-treat',
  name: 'Treat, or not, a condition with a 10% prior',
  actions: ['Treat', 'Do not treat'],
  states: ['Condition present', 'Condition absent'],
  // Utilities in quality-adjusted life-day equivalents, relative to untreated health.
  payoffs: [
    [-2, -8],
    [-40, 0],
  ],
  priors: [0.1, 0.9],
  unit: 'QALY-days (negative = loss)',
};

const diagnosticTest: TestInformation = {
  label: 'Diagnostic test (sensitivity 0.95, specificity 0.85)',
  signals: ['Positive', 'Negative'],
  likelihood: [
    [0.95, 0.05],
    [0.15, 0.85],
  ],
};

/* ----------------------------------------------------- 3. product launch tree */

const productLaunchTree: DecisionTree = {
  id: 'product-launch',
  name: 'Product launch, with the option of a test market first',
  unit: '$m',
  root: {
    kind: 'decision',
    id: 'launch-strategy',
    label: 'How to go to market',
    alternatives: [
      {
        label: 'Full national launch now',
        child: {
          kind: 'chance',
          id: 'national-demand',
          label: 'Demand',
          branches: [
            { label: 'High', probability: 0.25, child: { kind: 'terminal', id: 'n-high', payoff: 100 } },
            { label: 'Medium', probability: 0.45, child: { kind: 'terminal', id: 'n-med', payoff: 20 } },
            { label: 'Low', probability: 0.3, child: { kind: 'terminal', id: 'n-low', payoff: -120 } },
          ],
        },
      },
      {
        label: 'Test market first',
        payoff: -8,
        child: {
          kind: 'chance',
          id: 'test-market',
          label: 'Test market result',
          branches: [
            {
              label: 'Favourable',
              probability: 0.5,
              child: {
                kind: 'decision',
                id: 'after-favourable',
                label: 'Launch after a favourable test?',
                alternatives: [
                  {
                    label: 'Launch nationally',
                    child: {
                      kind: 'chance',
                      id: 'demand-after-favourable',
                      label: 'Demand',
                      branches: [
                        { label: 'High', probability: 0.45, child: { kind: 'terminal', id: 'f-high', payoff: 100 } },
                        { label: 'Medium', probability: 0.5, child: { kind: 'terminal', id: 'f-med', payoff: 20 } },
                        { label: 'Low', probability: 0.05, child: { kind: 'terminal', id: 'f-low', payoff: -120 } },
                      ],
                    },
                  },
                  { label: 'Shelve the product', child: { kind: 'terminal', id: 'f-stop', payoff: 0 } },
                ],
              },
            },
            {
              label: 'Unfavourable',
              probability: 0.5,
              child: {
                kind: 'decision',
                id: 'after-unfavourable',
                label: 'Launch after an unfavourable test?',
                alternatives: [
                  {
                    label: 'Launch nationally',
                    child: {
                      kind: 'chance',
                      id: 'demand-after-unfavourable',
                      label: 'Demand',
                      branches: [
                        { label: 'High', probability: 0.05, child: { kind: 'terminal', id: 'u-high', payoff: 100 } },
                        { label: 'Medium', probability: 0.4, child: { kind: 'terminal', id: 'u-med', payoff: 20 } },
                        { label: 'Low', probability: 0.55, child: { kind: 'terminal', id: 'u-low', payoff: -120 } },
                      ],
                    },
                  },
                  { label: 'Shelve the product', child: { kind: 'terminal', id: 'u-stop', payoff: 0 } },
                ],
              },
            },
          ],
        },
      },
      { label: 'Do not launch', child: { kind: 'terminal', id: 'no-launch', payoff: 0 } },
    ],
  },
};

/* ------------------------------------------------------- 4. newsvendor order */

const newsvendorInstance: NewsvendorInput = {
  demandDistributionId: 'poisson',
  demandParams: { lambda: 40 },
  // A unit sells for 9 and costs 4: being short costs the 5 of lost margin,
  // a leftover costs the 4 already spent (no salvage value).
  underageCost: 5,
  overageCost: 4,
  unitRevenue: 9,
  unitCost: 4,
};

/* ------------------------------------------------------ 5. insurance purchase */

const INSURANCE_LOSS = 50_000;
const INSURANCE_PROBABILITY = 0.01;
const INSURANCE_PREMIUM = 800;

const insuranceLottery: Lottery = {
  label: 'Carry the risk yourself',
  outcomes: [
    { payoff: 0, probability: 1 - INSURANCE_PROBABILITY },
    { payoff: -INSURANCE_LOSS, probability: INSURANCE_PROBABILITY },
  ],
};

export const WORKED_EXAMPLES: WorkedExample[] = [
  {
    id: 'wildcat',
    name: 'Wildcat drilling with a seismic survey',
    summary:
      `A prospect has a ${P_WET * 100}% chance of being wet. Drilling pays ${DRILL_WET} if it is and costs ` +
      `${-DRILL_DRY} if it is not. A seismic survey costing ${SEISMIC_COST} detects a wet structure with probability ` +
      `${SENSITIVITY} and correctly clears a dry one with probability ${SPECIFICITY}. Survey first, drill blind, or walk away?`,
    teaches:
      'The canonical value-of-information problem. EVPI bounds what any survey could be worth; EVSI says what this imperfect survey is worth, and whether it is worth its price.',
    questions: [
      'Should the survey be commissioned, and what is its information worth?',
      'What is the most any survey, however good, could be worth here (EVPI)?',
      'Does the survey change what you do, or only how you feel about it?',
    ],
    tree: wildcatTree,
    problem: wildcatProblem,
    test: seismicTest,
    unit: '$000',
  },
  {
    id: 'test-and-treat',
    name: 'Medical test, then treat or not',
    summary:
      'A condition is present with probability 0.1. Treating a patient who has it is much better than not treating ' +
      'them; treating one who does not have it carries a small harm. A test with sensitivity 0.95 and specificity ' +
      '0.85 is available. Test, treat everyone, or treat nobody?',
    teaches:
      'That the treatment threshold is a probability, not an opinion: there is a prior probability above which treating without testing is correct, and the test only has value when the prior is near that threshold.',
    questions: [
      'At what prior probability does treating become better than not treating?',
      'What is the test worth, and does it change the decision at a 10% prior?',
      'How sensitive is the recommendation to the prior?',
    ],
    problem: medicalProblem,
    test: diagnosticTest,
    unit: 'QALY-days (negative = loss)',
  },
  {
    id: 'product-launch',
    name: 'Product launch with an optional test market',
    summary:
      'A national launch returns 100 on high demand (probability 0.25), 20 on medium (0.45) and −120 on low (0.3), ' +
      'an expected −2. A test market costing 8 returns a favourable or unfavourable signal — the conditional demand ' +
      'probabilities average back to those unconditional ones — after which the launch can still be shelved. ' +
      'Launch now, test first, or do nothing?',
    teaches:
      'Nested decisions: the test market is only worth buying because of the *option to shelve* that follows it. Rollback values that option automatically; a spreadsheet of expected values does not.',
    questions: [
      'What is the optimal strategy, including what to do after each test result?',
      'What is the risk profile of that strategy — how likely is the −60?',
      'Would a risk-averse decision maker choose differently?',
    ],
    tree: productLaunchTree,
    unit: '$m',
  },
  {
    id: 'newsvendor',
    name: 'How many to stock',
    summary:
      'Demand is Poisson with a mean of 40. A unit sells for 9 and costs 4, with no salvage value for leftovers. ' +
      'How many should be ordered?',
    teaches:
      'That the optimal service level is a ratio of costs, not a target chosen in advance: the critical fractile 5/(5+4) = 0.5556 is the answer, and it is not 50% and not 95%.',
    questions: [
      'What is the optimal order quantity?',
      'What does the expected cost look like one unit either side of it?',
      'How much does the answer move if the cost of a stockout is doubled?',
    ],
    newsvendor: newsvendorInstance,
    unit: 'units',
  },
  {
    id: 'insurance',
    name: 'Buying insurance against a rare large loss',
    summary:
      `A loss of ${INSURANCE_LOSS} occurs with probability ${INSURANCE_PROBABILITY}, an expected loss of ` +
      `${INSURANCE_LOSS * INSURANCE_PROBABILITY}. Cover is offered for a premium of ${INSURANCE_PREMIUM}. ` +
      'Expected value says decline; what does a risk-averse decision maker do?',
    teaches:
      'That expected value is not the whole decision. Every insurance policy ever sold has a negative expected value to the buyer — that is how the insurer stays solvent. The decision rests entirely on the risk premium, and this example is where the utility machinery visibly changes the recommendation.',
    questions: [
      'What does maximising expected value say, and what does a risk-averse utility say?',
      'At what risk tolerance does the recommendation flip?',
      'What is the risk premium, and is it bigger than the loading in the premium quoted?',
    ],
    insurance: {
      uninsured: insuranceLottery,
      premium: INSURANCE_PREMIUM,
      // At this risk tolerance the certainty equivalent of carrying the risk is
      // far worse than the premium, so cover is bought.
      riskAverseUtility: { kind: 'exponential', riskTolerance: 10_000 },
    },
    unit: '$',
  },
];

export function getWorkedExample(id: string): WorkedExample {
  const found = WORKED_EXAMPLES.find((e) => e.id === id);
  if (!found) {
    throw new Error(`Unknown worked decision example "${id}".`);
  }
  return found;
}

/** The derived quantities of the wildcat example, for tests and display. */
export const WILDCAT_FIGURES = {
  priorWet: P_WET,
  drillWet: DRILL_WET,
  drillDry: DRILL_DRY,
  seismicCost: SEISMIC_COST,
  sensitivity: SENSITIVITY,
  specificity: SPECIFICITY,
  probabilityFavourable: pPositive,
  posteriorWetGivenFavourable: pWetGivenPositive,
  posteriorWetGivenUnfavourable: pWetGivenNegative,
};

export const INSURANCE_FIGURES = {
  loss: INSURANCE_LOSS,
  probability: INSURANCE_PROBABILITY,
  premium: INSURANCE_PREMIUM,
};
