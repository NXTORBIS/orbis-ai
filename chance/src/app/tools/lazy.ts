/**
 * Lazily loaded tool screens.
 *
 * Every tool screen is code-split. That is not a micro-optimisation: the 25
 * screens pull in most of the engine between them, and importing them all
 * eagerly put 836 kB of engine code and 743 kB of application code — about
 * 490 kB gzipped — in front of someone who has opened one tool.
 *
 * Splitting only works if NOTHING imports a tool module statically. A single
 * static import of all 25 default configurations is enough to pull all 25
 * screens back into the first chunk, which is exactly what used to happen:
 * `DEFAULT_CONFIGS` in the examples library imported from every tool file.
 * So the default configuration is loaded through the same dynamic import as
 * the component. Both live in one module, so the bundler puts them in one
 * chunk and a tool costs one request.
 *
 * The type-only imports below are erased at compile time and cost nothing at
 * runtime, which is what lets this file name every configuration type while
 * still importing no tool module.
 */
import { lazy, type ComponentType } from 'react';
import type { ToolId } from '../../persistence/schema';
import type { ProbabilityBasicsConfig } from './ProbabilityBasicsTool';
import type { EventRelationshipsConfig } from './EventRelationshipsTool';
import type { CombinatoricsConfig } from './CombinatoricsTool';
import type { RepeatedTrialsConfig } from './RepeatedTrialsTool';
import type { BayesConfig } from './BayesTool';
import type { BayesianUpdatingConfig } from './BayesianUpdatingTool';
import type { DistributionConfig } from './DistributionExplorerTool';
import type { ExperimentToolConfig } from './ExperimentTool';
import type { SimulationToolConfig } from './SimulationTool';
import type { ScenarioToolConfig } from './ScenarioTool';
import type { SensitivityToolConfig } from './SensitivityTool';
import type { RiskToolConfig } from './RiskTool';
import type { DataLabConfig } from './DataLabTool';
import type { MarkovToolConfig } from './MarkovTool';
import type { DecisionConfig } from './DecisionTool';
import type { BayesNetworkConfig } from './BayesNetworkTool';
import type { ReliabilityConfig } from './ReliabilityTool';
import type { QueueingConfig } from './QueueingTool';
import type { SurvivalConfig } from './SurvivalTool';
import type { BayesianInferenceConfig } from './BayesianInferenceTool';
import type { ExtremesConfig } from './ExtremesTool';
import type { RegressionConfig } from './RegressionTool';
import type { DistributionFittingConfig } from './DistributionFittingTool';
import type { HypothesisTestsConfig } from './HypothesisTestsTool';
import type { TimeSeriesConfig } from './TimeSeriesTool';
import type { ImpreciseConfig } from './ImpreciseTool';
import type { CausalConfig } from './CausalTool';
import type { NetworksConfig } from './NetworksTool';
import type { ProcessesConfig } from './ProcessesTool';
import type { PortfolioConfig } from './PortfolioTool';
import type { DesConfig } from './DesTool';
import type { InformationConfig } from './InformationTool';
import type { ElicitationConfig } from './ElicitationTool';
import type { SequentialConfig } from './SequentialTool';
import type { GaussianProcessConfig } from './GaussianProcessTool';
import type { StateFilteringConfig } from './StateFilteringTool';
import type { TransformsConfig } from './TransformsTool';
import type { StochasticOptimisationConfig } from './StochasticOptimisationTool';
import type { ModelComparisonConfig } from './ModelComparisonTool';
import type { QuasiMonteCarloConfig } from './QuasiMonteCarloTool';
import type { HiddenMarkovConfig } from './HiddenMarkovTool';
import type { CopulaConfig } from './CopulaTool';

/**
 * Loads a tool's default configuration, on its own so that creating a new
 * investigation does not have to wait for the screen component.
 */
export const DEFAULT_CONFIG_LOADERS: Record<ToolId, () => Promise<unknown>> = {
  'probability-basics': () => import('./ProbabilityBasicsTool').then((m) => m.PROBABILITY_BASICS_DEFAULT),
  'event-relationships': () => import('./EventRelationshipsTool').then((m) => m.EVENT_RELATIONSHIPS_DEFAULT),
  'combinatorics': () => import('./CombinatoricsTool').then((m) => m.COMBINATORICS_DEFAULT),
  'repeated-trials': () => import('./RepeatedTrialsTool').then((m) => m.REPEATED_TRIALS_DEFAULT),
  'bayes': () => import('./BayesTool').then((m) => m.BAYES_DEFAULT),
  'bayesian-updating': () => import('./BayesianUpdatingTool').then((m) => m.BAYESIAN_UPDATING_DEFAULT),
  'distribution-explorer': () => import('./DistributionExplorerTool').then((m) => m.DISTRIBUTION_DEFAULT),
  'experiment': () => import('./ExperimentTool').then((m) => m.EXPERIMENT_DEFAULT),
  'simulation': () => import('./SimulationTool').then((m) => m.SIMULATION_DEFAULT),
  'scenario': () => import('./ScenarioTool').then((m) => m.SCENARIO_DEFAULT),
  'sensitivity': () => import('./SensitivityTool').then((m) => m.SENSITIVITY_DEFAULT),
  'risk': () => import('./RiskTool').then((m) => m.RISK_DEFAULT),
  'data-lab': () => import('./DataLabTool').then((m) => m.DATA_LAB_DEFAULT),
  'markov': () => import('./MarkovTool').then((m) => m.MARKOV_DEFAULT),
  'decision': () => import('./DecisionTool').then((m) => m.DECISION_DEFAULT),
  'bayes-network': () => import('./BayesNetworkTool').then((m) => m.BAYES_NETWORK_DEFAULT),
  'reliability': () => import('./ReliabilityTool').then((m) => m.RELIABILITY_DEFAULT),
  'queueing': () => import('./QueueingTool').then((m) => m.QUEUEING_DEFAULT),
  'survival': () => import('./SurvivalTool').then((m) => m.SURVIVAL_DEFAULT),
  'bayesian-inference': () => import('./BayesianInferenceTool').then((m) => m.BAYESIAN_INFERENCE_DEFAULT),
  'extremes': () => import('./ExtremesTool').then((m) => m.EXTREMES_DEFAULT),
  'regression': () => import('./RegressionTool').then((m) => m.REGRESSION_DEFAULT),
  'distribution-fitting': () => import('./DistributionFittingTool').then((m) => m.DISTRIBUTION_FITTING_DEFAULT),
  'hypothesis-tests': () => import('./HypothesisTestsTool').then((m) => m.HYPOTHESIS_TESTS_DEFAULT),
  'time-series': () => import('./TimeSeriesTool').then((m) => m.TIME_SERIES_DEFAULT),
  'imprecise': () => import('./ImpreciseTool').then((m) => m.IMPRECISE_DEFAULT),
  'causal': () => import('./CausalTool').then((m) => m.CAUSAL_DEFAULT),
  'networks': () => import('./NetworksTool').then((m) => m.NETWORKS_DEFAULT),
  'processes': () => import('./ProcessesTool').then((m) => m.PROCESSES_DEFAULT),
  'portfolio': () => import('./PortfolioTool').then((m) => m.PORTFOLIO_DEFAULT),
  'des': () => import('./DesTool').then((m) => m.DES_DEFAULT),
  'information': () => import('./InformationTool').then((m) => m.INFORMATION_DEFAULT),
  'elicitation': () => import('./ElicitationTool').then((m) => m.ELICITATION_DEFAULT),
  'sequential': () => import('./SequentialTool').then((m) => m.SEQUENTIAL_DEFAULT),
  'gaussian-process': () => import('./GaussianProcessTool').then((m) => m.GAUSSIAN_PROCESS_DEFAULT),
  'state-filtering': () => import('./StateFilteringTool').then((m) => m.STATE_FILTERING_DEFAULT),
  'transforms': () => import('./TransformsTool').then((m) => m.TRANSFORMS_DEFAULT),
  'stochastic-optimisation': () => import('./StochasticOptimisationTool').then((m) => m.STOCHASTIC_OPTIMISATION_DEFAULT),
  'model-comparison': () => import('./ModelComparisonTool').then((m) => m.MODEL_COMPARISON_DEFAULT),
  'quasi-monte-carlo': () => import('./QuasiMonteCarloTool').then((m) => m.QUASI_MONTE_CARLO_DEFAULT),
  'hidden-markov': () => import('./HiddenMarkovTool').then((m) => m.HIDDEN_MARKOV_DEFAULT),
  'copula': () => import('./CopulaTool').then((m) => m.COPULA_DEFAULT),
};

export function loadDefaultConfig(toolId: ToolId): Promise<unknown> {
  return DEFAULT_CONFIG_LOADERS[toolId]();
}

/**
 * The screen components, each wrapped so React can suspend on it. The cast to
 * a component taking an unknown configuration is contained here: the switch in
 * App.tsx recovers the concrete type per tool, and the configuration itself is
 * validated against the stored schema before it reaches a screen.
 */
type ToolComponent = ComponentType<{ config: never }>;

function screen<T>(load: () => Promise<{ default: ComponentType<{ config: T }> }>): ToolComponent {
  return lazy(load) as unknown as ToolComponent;
}

export const TOOL_SCREENS: Record<ToolId, ToolComponent> = {
  'probability-basics': screen<ProbabilityBasicsConfig>(() => import('./ProbabilityBasicsTool').then((m) => ({ default: m.ProbabilityBasicsTool }))),
  'event-relationships': screen<EventRelationshipsConfig>(() => import('./EventRelationshipsTool').then((m) => ({ default: m.EventRelationshipsTool }))),
  'combinatorics': screen<CombinatoricsConfig>(() => import('./CombinatoricsTool').then((m) => ({ default: m.CombinatoricsTool }))),
  'repeated-trials': screen<RepeatedTrialsConfig>(() => import('./RepeatedTrialsTool').then((m) => ({ default: m.RepeatedTrialsTool }))),
  'bayes': screen<BayesConfig>(() => import('./BayesTool').then((m) => ({ default: m.BayesTool }))),
  'bayesian-updating': screen<BayesianUpdatingConfig>(() => import('./BayesianUpdatingTool').then((m) => ({ default: m.BayesianUpdatingTool }))),
  'distribution-explorer': screen<DistributionConfig>(() => import('./DistributionExplorerTool').then((m) => ({ default: m.DistributionExplorerTool }))),
  'experiment': screen<ExperimentToolConfig>(() => import('./ExperimentTool').then((m) => ({ default: m.ExperimentTool }))),
  'simulation': screen<SimulationToolConfig>(() => import('./SimulationTool').then((m) => ({ default: m.SimulationTool }))),
  'scenario': screen<ScenarioToolConfig>(() => import('./ScenarioTool').then((m) => ({ default: m.ScenarioTool }))),
  'sensitivity': screen<SensitivityToolConfig>(() => import('./SensitivityTool').then((m) => ({ default: m.SensitivityTool }))),
  'risk': screen<RiskToolConfig>(() => import('./RiskTool').then((m) => ({ default: m.RiskTool }))),
  'data-lab': screen<DataLabConfig>(() => import('./DataLabTool').then((m) => ({ default: m.DataLabTool }))),
  'markov': screen<MarkovToolConfig>(() => import('./MarkovTool').then((m) => ({ default: m.MarkovTool }))),
  'decision': screen<DecisionConfig>(() => import('./DecisionTool').then((m) => ({ default: m.DecisionTool }))),
  'bayes-network': screen<BayesNetworkConfig>(() => import('./BayesNetworkTool').then((m) => ({ default: m.BayesNetworkTool }))),
  'reliability': screen<ReliabilityConfig>(() => import('./ReliabilityTool').then((m) => ({ default: m.ReliabilityTool }))),
  'queueing': screen<QueueingConfig>(() => import('./QueueingTool').then((m) => ({ default: m.QueueingTool }))),
  'survival': screen<SurvivalConfig>(() => import('./SurvivalTool').then((m) => ({ default: m.SurvivalTool }))),
  'bayesian-inference': screen<BayesianInferenceConfig>(() => import('./BayesianInferenceTool').then((m) => ({ default: m.BayesianInferenceTool }))),
  'extremes': screen<ExtremesConfig>(() => import('./ExtremesTool').then((m) => ({ default: m.ExtremesTool }))),
  'regression': screen<RegressionConfig>(() => import('./RegressionTool').then((m) => ({ default: m.RegressionTool }))),
  'distribution-fitting': screen<DistributionFittingConfig>(() => import('./DistributionFittingTool').then((m) => ({ default: m.DistributionFittingTool }))),
  'hypothesis-tests': screen<HypothesisTestsConfig>(() => import('./HypothesisTestsTool').then((m) => ({ default: m.HypothesisTestsTool }))),
  'time-series': screen<TimeSeriesConfig>(() => import('./TimeSeriesTool').then((m) => ({ default: m.TimeSeriesTool }))),
  'imprecise': screen<ImpreciseConfig>(() => import('./ImpreciseTool').then((m) => ({ default: m.ImpreciseTool }))),
  'causal': screen<CausalConfig>(() => import('./CausalTool').then((m) => ({ default: m.CausalTool }))),
  'networks': screen<NetworksConfig>(() => import('./NetworksTool').then((m) => ({ default: m.NetworksTool }))),
  'processes': screen<ProcessesConfig>(() => import('./ProcessesTool').then((m) => ({ default: m.ProcessesTool }))),
  'portfolio': screen<PortfolioConfig>(() => import('./PortfolioTool').then((m) => ({ default: m.PortfolioTool }))),
  'des': screen<DesConfig>(() => import('./DesTool').then((m) => ({ default: m.DesTool }))),
  'information': screen<InformationConfig>(() => import('./InformationTool').then((m) => ({ default: m.InformationTool }))),
  'elicitation': screen<ElicitationConfig>(() => import('./ElicitationTool').then((m) => ({ default: m.ElicitationTool }))),
  'sequential': screen<SequentialConfig>(() => import('./SequentialTool').then((m) => ({ default: m.SequentialTool }))),
  'gaussian-process': screen<GaussianProcessConfig>(() => import('./GaussianProcessTool').then((m) => ({ default: m.GaussianProcessTool }))),
  'state-filtering': screen<StateFilteringConfig>(() => import('./StateFilteringTool').then((m) => ({ default: m.StateFilteringTool }))),
  'transforms': screen<TransformsConfig>(() => import('./TransformsTool').then((m) => ({ default: m.TransformsTool }))),
  'stochastic-optimisation': screen<StochasticOptimisationConfig>(() => import('./StochasticOptimisationTool').then((m) => ({ default: m.StochasticOptimisationTool }))),
  'model-comparison': screen<ModelComparisonConfig>(() => import('./ModelComparisonTool').then((m) => ({ default: m.ModelComparisonTool }))),
  'quasi-monte-carlo': screen<QuasiMonteCarloConfig>(() => import('./QuasiMonteCarloTool').then((m) => ({ default: m.QuasiMonteCarloTool }))),
  'hidden-markov': screen<HiddenMarkovConfig>(() => import('./HiddenMarkovTool').then((m) => ({ default: m.HiddenMarkovTool }))),
  'copula': screen<CopulaConfig>(() => import('./CopulaTool').then((m) => ({ default: m.CopulaTool }))),
};

/**
 * The full configuration for an example or template: the tool's own default
 * with the entry's overrides applied on top.
 *
 * The default has to be fetched because tool screens are code-split and each
 * default ships in its screen's chunk. The merge is one level deep, which is
 * the same depth `reconcileConfig` uses when it fills in missing fields, so an
 * entry that wants to change part of a nested object states that object in
 * full.
 */
export async function resolveEntryConfig(toolId: ToolId, override: Record<string, unknown>): Promise<Record<string, unknown>> {
  const base = (await loadDefaultConfig(toolId)) as Record<string, unknown>;
  return { ...structuredClone(base), ...structuredClone(override) };
}
