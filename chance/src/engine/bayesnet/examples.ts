/**
 * Worked example networks.
 *
 * Parameters for the standard networks are the published ones (Lauritzen &
 * Spiegelhalter's chest-clinic "Asia" network, 1988; the sprinkler and the
 * burglary-alarm networks as given in Pearl 1988 and Russell & Norvig), so
 * results can be checked against the literature rather than against this
 * codebase's own output.
 */
import { EngineError } from '../core/result';
import { BayesNet, NetworkSpec } from './network';

const YN = ['yes', 'no'];

/** Lauritzen & Spiegelhalter's chest-clinic network. */
export const asiaSpec: NetworkSpec = {
  id: 'asia',
  name: 'Asia (chest clinic)',
  description:
    'The standard chest-clinic network: a visit to Asia and smoking raise the chance of tuberculosis, lung cancer ' +
    'and bronchitis, which show up as an abnormal X-ray and as dyspnoea. "either" is a deterministic OR of ' +
    'tuberculosis and lung cancer, so some observation combinations are logically impossible and have probability 0.',
  nodes: [
    { id: 'asia', description: 'Recent visit to Asia', states: YN, cpt: [[0.01, 0.99]] },
    { id: 'smoke', description: 'Smoker', states: YN, cpt: [[0.5, 0.5]] },
    {
      id: 'tub',
      description: 'Tuberculosis',
      states: YN,
      parents: ['asia'],
      cpt: [
        [0.05, 0.95],
        [0.01, 0.99],
      ],
    },
    {
      id: 'lung',
      description: 'Lung cancer',
      states: YN,
      parents: ['smoke'],
      cpt: [
        [0.1, 0.9],
        [0.01, 0.99],
      ],
    },
    {
      id: 'bronc',
      description: 'Bronchitis',
      states: YN,
      parents: ['smoke'],
      cpt: [
        [0.6, 0.4],
        [0.3, 0.7],
      ],
    },
    {
      id: 'either',
      description: 'Tuberculosis or lung cancer (deterministic OR)',
      states: YN,
      parents: ['tub', 'lung'],
      cpt: [
        [1, 0],
        [1, 0],
        [1, 0],
        [0, 1],
      ],
    },
    {
      id: 'xray',
      description: 'Abnormal chest X-ray',
      states: YN,
      parents: ['either'],
      cpt: [
        [0.98, 0.02],
        [0.05, 0.95],
      ],
    },
    {
      id: 'dysp',
      description: 'Dyspnoea (shortness of breath)',
      states: YN,
      parents: ['bronc', 'either'],
      cpt: [
        [0.9, 0.1],
        [0.8, 0.2],
        [0.7, 0.3],
        [0.1, 0.9],
      ],
    },
  ],
};

/** The sprinkler network: the canonical collider. */
export const sprinklerSpec: NetworkSpec = {
  id: 'sprinkler',
  name: 'Sprinkler, rain and wet grass',
  description:
    'Rain and the sprinkler are independent causes that both wet the grass. Conditioning on wet grass — their ' +
    'common effect, a collider — makes them dependent: finding the sprinkler was on explains the wet grass away ' +
    'and lowers the probability that it rained.',
  nodes: [
    { id: 'rain', description: 'It rained', states: YN, cpt: [[0.2, 0.8]] },
    { id: 'sprinkler', description: 'The sprinkler was on', states: YN, cpt: [[0.4, 0.6]] },
    {
      id: 'wet',
      description: 'The grass is wet',
      states: YN,
      parents: ['sprinkler', 'rain'],
      cpt: [
        [0.99, 0.01],
        [0.9, 0.1],
        [0.8, 0.2],
        [0.0, 1.0],
      ],
    },
  ],
};

/** The burglary-alarm network: the canonical explaining-away example. */
export const alarmSpec: NetworkSpec = {
  id: 'alarm',
  name: 'Burglary, earthquake and alarm',
  description:
    'A burglary or an earthquake can set off the alarm, and the alarm prompts calls from John and Mary. Hearing ' +
    'the alarm raises the probability of a burglary; learning that there was an earthquake lowers it again, ' +
    'because the earthquake already explains the alarm.',
  nodes: [
    { id: 'burglary', states: YN, cpt: [[0.001, 0.999]] },
    { id: 'earthquake', states: YN, cpt: [[0.002, 0.998]] },
    {
      id: 'alarm',
      states: YN,
      parents: ['burglary', 'earthquake'],
      cpt: [
        [0.95, 0.05],
        [0.94, 0.06],
        [0.29, 0.71],
        [0.001, 0.999],
      ],
    },
    {
      id: 'johnCalls',
      states: YN,
      parents: ['alarm'],
      cpt: [
        [0.9, 0.1],
        [0.05, 0.95],
      ],
    },
    {
      id: 'maryCalls',
      states: YN,
      parents: ['alarm'],
      cpt: [
        [0.7, 0.3],
        [0.01, 0.99],
      ],
    },
  ],
};

/** A diagnosis chain: exposure -> infection -> fever -> test result. */
export const diagnosisChainSpec: NetworkSpec = {
  id: 'diagnosis-chain',
  name: 'Medical diagnosis chain',
  description:
    'Exposure causes infection, infection causes fever, and fever is what the thermometer reads. Each variable ' +
    'screens off the ones before it: given infection, the test result tells you nothing more about exposure.',
  nodes: [
    { id: 'exposure', description: 'Exposed to the pathogen', states: YN, cpt: [[0.1, 0.9]] },
    {
      id: 'infection',
      description: 'Infected',
      states: YN,
      parents: ['exposure'],
      cpt: [
        [0.4, 0.6],
        [0.01, 0.99],
      ],
    },
    {
      id: 'fever',
      description: 'Running a fever',
      states: YN,
      parents: ['infection'],
      cpt: [
        [0.85, 0.15],
        [0.05, 0.95],
      ],
    },
    {
      id: 'test',
      description: 'Thermometer reads high',
      states: YN,
      parents: ['fever'],
      cpt: [
        [0.95, 0.05],
        [0.08, 0.92],
      ],
    },
  ],
};

/**
 * A confounded treatment-outcome network where P(Y | do(X)) and P(Y | X)
 * genuinely differ, with a collider and a non-mediating descendant of the
 * treatment included so that invalid adjustment sets can be demonstrated.
 */
export const confoundedTreatmentSpec: NetworkSpec = {
  id: 'confounded-treatment',
  name: 'Confounded treatment and outcome',
  description:
    'Baseline health affects both who gets treated and who recovers, so the recovery rate among the treated is ' +
    'not the recovery rate you would get by treating everyone. Adjusting for health identifies the effect; ' +
    'adjusting for the follow-up visit (a common effect of treatment and recovery) or for the side effect (a ' +
    'descendant of treatment) does not.',
  nodes: [
    { id: 'health', description: 'Baseline health', states: ['good', 'poor'], cpt: [[0.5, 0.5]] },
    {
      id: 'treatment',
      states: ['treated', 'untreated'],
      parents: ['health'],
      cpt: [
        [0.8, 0.2],
        [0.2, 0.8],
      ],
    },
    {
      id: 'recovery',
      states: ['recovered', 'not'],
      parents: ['treatment', 'health'],
      cpt: [
        [0.95, 0.05],
        [0.6, 0.4],
        [0.8, 0.2],
        [0.3, 0.7],
      ],
    },
    {
      id: 'sideEffect',
      description: 'Side effect of the treatment (a descendant of the treatment, not a mediator)',
      states: YN,
      parents: ['treatment'],
      cpt: [
        [0.3, 0.7],
        [0.02, 0.98],
      ],
    },
    {
      id: 'followUp',
      description: 'Attended the follow-up visit (a common effect of treatment and recovery: a collider)',
      states: YN,
      parents: ['treatment', 'recovery'],
      cpt: [
        [0.9, 0.1],
        [0.6, 0.4],
        [0.5, 0.5],
        [0.2, 0.8],
      ],
    },
  ],
};

/**
 * A network containing all three elementary structures at once: a fork (U), a
 * chain (X1 -> M -> Y1), a collider (C with parents X2 and W) and a descendant
 * of that collider (D). Used to exercise d-separation in every configuration.
 */
export const structuresSpec: NetworkSpec = {
  id: 'structures',
  name: 'Chain, fork and collider',
  description:
    'U is a common cause of X1 and X2 (a fork). X1 influences Y1 only through M (a chain). X2 and W are ' +
    'independent causes of C (a collider), and D is a consequence of C. Conditioning on C — or merely on D — ' +
    'makes X2 and W dependent.',
  nodes: [
    { id: 'U', states: YN, cpt: [[0.3, 0.7]] },
    { id: 'W', states: YN, cpt: [[0.4, 0.6]] },
    {
      id: 'X1',
      states: YN,
      parents: ['U'],
      cpt: [
        [0.8, 0.2],
        [0.25, 0.75],
      ],
    },
    {
      id: 'X2',
      states: YN,
      parents: ['U'],
      cpt: [
        [0.6, 0.4],
        [0.1, 0.9],
      ],
    },
    {
      id: 'M',
      states: YN,
      parents: ['X1'],
      cpt: [
        [0.9, 0.1],
        [0.2, 0.8],
      ],
    },
    {
      id: 'Y1',
      states: YN,
      parents: ['M'],
      cpt: [
        [0.7, 0.3],
        [0.15, 0.85],
      ],
    },
    {
      id: 'C',
      states: YN,
      parents: ['X2', 'W'],
      cpt: [
        [0.95, 0.05],
        [0.5, 0.5],
        [0.4, 0.6],
        [0.05, 0.95],
      ],
    },
    {
      id: 'D',
      states: YN,
      parents: ['C'],
      cpt: [
        [0.9, 0.1],
        [0.2, 0.8],
      ],
    },
  ],
};

export const EXAMPLE_NETWORK_SPECS: readonly NetworkSpec[] = [
  asiaSpec,
  sprinklerSpec,
  alarmSpec,
  diagnosisChainSpec,
  confoundedTreatmentSpec,
  structuresSpec,
];

/** Look up an example specification by id. */
export function exampleSpec(id: string): NetworkSpec {
  const found = EXAMPLE_NETWORK_SPECS.find((s) => s.id === id);
  if (!found) {
    throw new EngineError(
      `Unknown example network "${id}". Available: ${EXAMPLE_NETWORK_SPECS.map((s) => s.id).join(', ')}.`,
      'unknown',
    );
  }
  return found;
}

/** Build an example network by id (validated on every call). */
export function exampleNetwork(id: string): BayesNet {
  return BayesNet.from(exampleSpec(id));
}
