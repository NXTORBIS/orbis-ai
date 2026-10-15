/**
 * Orbis Chance AI integration contract, version 1.
 *
 * WHAT THIS IS
 * ------------
 * A typed boundary that a future host application (Orbis) can implement to
 * supply AI assistance to Orbis Chance. This file defines request and response
 * shapes only. It contains:
 *
 *   - no AI provider client of any kind,
 *   - no API keys, and no code that reads a key from anywhere,
 *   - no network calls,
 *   - no assumptions about which provider the host uses.
 *
 * In standalone mode no adapter is registered, every capability reports itself
 * as unavailable, and the application's deterministic functionality is
 * unaffected. See docs/AI_INTEGRATION.md.
 *
 * SAFETY RULE THAT THE APPLICATION ENFORCES
 * -----------------------------------------
 * AI output is treated as a *suggestion about what to compute*, never as a
 * computed result. A suggested model is validated by the engine and its
 * numbers are produced by the engine's own deterministic or statistical code.
 * No response field in this contract carries a probability, an expected value,
 * or any other quantity that the application will display as a result.
 */

export const AI_CONTRACT_VERSION = '1.0.0';

/** Capabilities a host may implement. A host may support any subset. */
export const AI_CAPABILITIES = [
  'interpretQuestion',
  'suggestMethod',
  'identifyMissingInputs',
  'draftAssumptions',
  'explainResult',
  'buildScenario',
  'suggestFollowUps',
  'explainUncertainty',
  'interpretStatistics',
] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const AI_CAPABILITY_INFO: Record<AiCapability, { label: string; description: string; manualAlternative: string }> = {
  interpretQuestion: {
    label: 'Interpret a question in plain language',
    description: 'Turn a question written in ordinary words into a structured problem: which tool applies, which quantities are involved, and what is being asked for.',
    manualAlternative: 'Choose a tool from the Probability Lab and enter the quantities directly. Each tool states what it needs.',
  },
  suggestMethod: {
    label: 'Suggest a suitable method',
    description: 'Recommend which mathematical method or distribution fits a described situation, with the reasoning behind the choice.',
    manualAlternative: 'The method guide in each tool lists when each method applies, with its assumptions.',
  },
  identifyMissingInputs: {
    label: 'Identify missing information',
    description: 'Point out which quantities are still needed before a question can be answered.',
    manualAlternative: 'Every tool validates its inputs and names exactly what is missing or inconsistent.',
  },
  draftAssumptions: {
    label: 'Help write down assumptions',
    description: 'Draft an explicit list of the assumptions a model depends on, for you to review and edit.',
    manualAlternative: 'Each result panel lists the assumptions the engine actually applied; you can add your own notes to an investigation.',
  },
  explainResult: {
    label: 'Explain a result in context',
    description: 'Describe what a computed result means for the situation you described, in ordinary language.',
    manualAlternative: 'The explanation panel shows the method, formula, substituted values, intermediate steps, assumptions and limitations for every result.',
  },
  buildScenario: {
    label: 'Help build a scenario',
    description: 'Propose variables, distributions and relationships for a described situation, as a starting point you then edit.',
    manualAlternative: 'The Scenario Builder provides variable types and templates; the template library has worked starting points.',
  },
  suggestFollowUps: {
    label: 'Suggest follow-up investigations',
    description: 'Propose further questions worth investigating given what you have found.',
    manualAlternative: 'Duplicate an investigation and change one assumption, or use the sensitivity tools to see which inputs matter most.',
  },
  explainUncertainty: {
    label: 'Explain uncertainty and limitations',
    description: 'Discuss how much confidence a result supports and what could make it wrong.',
    manualAlternative: 'Results show Monte Carlo intervals, sample sizes and an explicit limitations list.',
  },
  interpretStatistics: {
    label: 'Help interpret statistical output',
    description: 'Explain what a p-value, interval or effect size does and does not tell you in a specific analysis.',
    manualAlternative: 'Every test result states its hypotheses, effect size and the standard misinterpretations to avoid.',
  },
};

/** Context the application may pass with a request. Never includes raw datasets. */
export interface AiContext {
  /** The tool the user is working in, e.g. "scenario". */
  toolId?: string;
  /** Sanitised configuration of the current investigation (no imported row data). */
  configSummary?: Record<string, unknown>;
  /** Names and types of available quantities, without their values. */
  availableVariables?: { name: string; kind: string; unit?: string }[];
  /** Locale hint for language and number formatting. */
  locale?: string;
}

export interface AiRequestBase {
  capability: AiCapability;
  contractVersion: string;
  /** Stable id so a host can correlate logs; generated by the application. */
  requestId: string;
  context?: AiContext;
}

export interface InterpretQuestionRequest extends AiRequestBase {
  capability: 'interpretQuestion';
  question: string;
}

/**
 * A structured problem. Note that it carries no numeric *answer* — only the
 * inputs the user supplied or that the host read back from the question, which
 * the engine then validates and computes with.
 */
export interface StructuredProblem {
  /** Suggested tool id from the application's tool list. */
  suggestedToolId: string;
  /** Suggested configuration fragment for that tool, to be validated by the engine. */
  suggestedConfig?: Record<string, unknown>;
  /** Quantities read from the question, as literal values the user stated. */
  extractedQuantities?: { label: string; value: number | string; unit?: string; sourceText?: string }[];
  /** Quantities still needed. */
  missingQuantities?: { label: string; why: string }[];
  /** What the user appears to be asking for. */
  objective?: string;
  /** Host's confidence that the interpretation is right, 0–1. */
  confidence?: number;
  /** Alternative readings of an ambiguous question. */
  alternatives?: { objective: string; suggestedToolId: string }[];
}

export interface SuggestMethodRequest extends AiRequestBase {
  capability: 'suggestMethod';
  situation: string;
  /** Methods the application can offer, so the host chooses from real options. */
  availableMethods: { id: string; name: string; summary: string }[];
}

export interface MethodSuggestion {
  /** Must be one of the ids supplied in the request. */
  methodId: string;
  reasoning: string;
  /** Conditions that must hold for the method to be appropriate. */
  requiredAssumptions: string[];
  alternatives?: { methodId: string; whenPreferable: string }[];
}

export interface IdentifyMissingInputsRequest extends AiRequestBase {
  capability: 'identifyMissingInputs';
  question: string;
  providedInputs: { label: string; value: number | string }[];
}

export interface ExplainResultRequest extends AiRequestBase {
  capability: 'explainResult';
  /** The question the user asked, if available. */
  question?: string;
  /** The deterministic explanation the engine already produced. */
  engineExplanation: {
    method: string;
    formula?: string;
    steps: { label: string; expression?: string; value?: string }[];
    assumptions: string[];
    limitations: string[];
    exactness: string;
  };
  /** Result figures, as already-formatted strings produced by the engine. */
  figures: { label: string; value: string }[];
}

export interface TextResponse {
  /** Plain text or lightly structured markdown-like text. Rendered as text, never as HTML. */
  text: string;
  /** Points the host is unsure about. */
  caveats?: string[];
}

export interface BuildScenarioRequest extends AiRequestBase {
  capability: 'buildScenario';
  description: string;
  /** Distribution ids the application supports, so suggestions are usable. */
  availableDistributions: { id: string; name: string; params: string[] }[];
}

export interface ScenarioSuggestion {
  /** A configuration fragment for the Scenario Builder, validated before use. */
  variables: { name: string; label: string; kind: string; distributionId?: string; params?: Record<string, number>; expression?: string; value?: number }[];
  outputs: { key: string; label: string; expression: string; kind: string }[];
  /** Suggested relationships, as explicit statements for the user to confirm. */
  relationships?: { description: string; kind: 'correlation' | 'conditional' | 'derived'; detail?: string }[];
  assumptions: string[];
  notes?: string[];
}

export interface SuggestFollowUpsRequest extends AiRequestBase {
  capability: 'suggestFollowUps';
  summary: string;
  figures: { label: string; value: string }[];
}

export interface FollowUpSuggestions {
  items: { question: string; why: string; suggestedToolId?: string }[];
}

export interface DraftAssumptionsRequest extends AiRequestBase {
  capability: 'draftAssumptions';
  description: string;
  /** Assumptions the engine has already identified, so the host adds rather than repeats. */
  engineAssumptions: string[];
}

export interface AssumptionDraft {
  assumptions: { text: string; whyItMatters: string }[];
}

export interface ExplainUncertaintyRequest extends AiRequestBase {
  capability: 'explainUncertainty';
  figures: { label: string; value: string }[];
  /** Interval and sample-size information the engine computed. */
  precision?: { trials?: number; intervalLow?: number; intervalHigh?: number; intervalLevel?: number };
  limitations: string[];
}

export interface InterpretStatisticsRequest extends AiRequestBase {
  capability: 'interpretStatistics';
  testName: string;
  nullHypothesis: string;
  statistic: number;
  pValue: number;
  effectSize?: { name: string; value: number };
  sampleSizes: number[];
}

export type AiRequest =
  | InterpretQuestionRequest
  | SuggestMethodRequest
  | IdentifyMissingInputsRequest
  | ExplainResultRequest
  | BuildScenarioRequest
  | SuggestFollowUpsRequest
  | DraftAssumptionsRequest
  | ExplainUncertaintyRequest
  | InterpretStatisticsRequest;

/** Response payload, keyed by capability. */
export interface AiResponseMap {
  interpretQuestion: StructuredProblem;
  suggestMethod: MethodSuggestion;
  identifyMissingInputs: { missing: { label: string; why: string }[]; sufficient: boolean };
  draftAssumptions: AssumptionDraft;
  explainResult: TextResponse;
  buildScenario: ScenarioSuggestion;
  suggestFollowUps: FollowUpSuggestions;
  explainUncertainty: TextResponse;
  interpretStatistics: TextResponse;
}

export type AiErrorCode =
  | 'unavailable'
  | 'unsupported-capability'
  | 'unsupported-contract-version'
  | 'cancelled'
  | 'timeout'
  | 'rate-limited'
  | 'invalid-request'
  | 'host-error';

export interface AiError {
  code: AiErrorCode;
  /** Message suitable for display to the user. */
  message: string;
  /** Set when the host believes a retry may succeed. */
  retryable?: boolean;
}

export type AiResult<C extends AiCapability> =
  | { ok: true; capability: C; requestId: string; value: AiResponseMap[C]; /** Host-reported provenance, for display. */ provenance?: { model?: string; host?: string } }
  | { ok: false; capability: C; requestId: string; error: AiError };

/**
 * The interface the Orbis host implements and injects. Orbis Chance calls it
 * and never constructs one itself.
 */
export interface AiAdapter {
  /** Contract version the adapter implements; must be compatible with AI_CONTRACT_VERSION. */
  readonly contractVersion: string;
  /** Human-readable identification of the host, shown in the interface. */
  readonly hostName: string;
  /** Capabilities this adapter actually implements. */
  capabilities(): readonly AiCapability[];
  /**
   * Perform a request. The signal is aborted when the user cancels; the
   * adapter must stop work and reject or resolve with code 'cancelled'.
   */
  request<C extends AiCapability>(request: Extract<AiRequest, { capability: C }>, signal: AbortSignal): Promise<AiResult<C>>;
}

/** Semantic-version compatibility: same major version, adapter minor ≤ ours. */
export function isContractCompatible(adapterVersion: string): boolean {
  const parse = (v: string) => v.split('.').map((x) => Number.parseInt(x, 10));
  const [aMajor, aMinor] = parse(adapterVersion);
  const [oMajor, oMinor] = parse(AI_CONTRACT_VERSION);
  if (!Number.isInteger(aMajor) || !Number.isInteger(aMinor)) return false;
  return aMajor === oMajor && aMinor <= oMinor;
}
