/**
 * Orbis Chance's AI adapter for the Orbis desktop application.
 *
 * It sends each request through the same chat pipeline the Orbis conversation uses (`window.api.sendChat`), so model
 * choice, credentials, rate limits and fallbacks are exactly what they already are. This file holds no key, names no
 * provider and opens no connection of its own.
 *
 * The contract's rule applies here too: a reply is treated as a suggestion about what to compute. Structured replies
 * are parsed as JSON and checked against the shape the request asked for; anything that does not fit is reported as
 * a failure, never repaired into something that looks like a result.
 */
import {
  AI_CAPABILITIES,
  AI_CONTRACT_VERSION,
  type AiAdapter,
  type AiCapability,
  type AiRequest,
  type AiResult,
} from '../ai/contract';
import { TOOLS } from '../app/tools';

export interface ChatApi {
  getSettings(): Promise<{ defaultModel?: string }>;
  sendChat(request: unknown): Promise<unknown>;
  abortChat(requestId: string): Promise<unknown>;
  onChatEvent(requestId: string, listener: (event: { type: string; content?: string; message?: string }) => void): () => void;
}

const SYSTEM = [
  'You are the assistant inside Orbis Chance, a probability and uncertainty tool.',
  'You never state a computed probability, expected value or any other result as if you had calculated it.',
  'The application computes every number itself; you only interpret, suggest what to compute, or explain figures it gives you.',
  'Use only the figures supplied in the request when you mention numbers. Be concise and plain.',
].join(' ');

function describe(request: AiRequest): { instruction: string; json: boolean } {
  const payload = JSON.stringify(request, null, 1);
  switch (request.capability) {
    case 'interpretQuestion':
      return {
        json: true,
        instruction:
          'Turn the question into a structured problem. Reply with JSON only, shaped as {"suggestedToolId": string, "suggestedConfig"?: object, "extractedQuantities"?: [{"label": string, "value": number|string, "unit"?: string, "sourceText"?: string}], "missingQuantities"?: [{"label": string, "why": string}], "objective"?: string, "confidence"?: number between 0 and 1, "alternatives"?: [{"objective": string, "suggestedToolId": string}]}. Quantities must be values the user actually stated; never compute an answer. suggestedToolId must be exactly one of these ids: ' +
          TOOLS.map((t) => `${t.id} (${t.name})`).join(', ') +
          '.\n' +
          payload,
      };
    case 'suggestMethod':
      return {
        json: true,
        instruction:
          'Choose the best method from availableMethods. Reply with JSON only, shaped as {"methodId": string (one of the supplied ids), "reasoning": string, "requiredAssumptions": string[], "alternatives"?: [{"methodId": string, "whenPreferable": string}]}.\n' +
          payload,
      };
    case 'identifyMissingInputs':
      return {
        json: true,
        instruction:
          'Say which quantities are still needed. Reply with JSON only, shaped as {"missing": [{"label": string, "why": string}], "sufficient": boolean}.\n' +
          payload,
      };
    case 'draftAssumptions':
      return {
        json: true,
        instruction:
          'Draft additional assumptions the model depends on, without repeating engineAssumptions. Reply with JSON only, shaped as {"assumptions": [{"text": string, "whyItMatters": string}]}.\n' +
          payload,
      };
    case 'buildScenario':
      return {
        json: true,
        instruction:
          'Propose variables and outputs for a scenario, using only the distributions listed in availableDistributions. Reply with JSON only, shaped as {"variables": [{"name": string, "label": string, "kind": string, "distributionId"?: string, "params"?: object of numbers, "expression"?: string, "value"?: number}], "outputs": [{"key": string, "label": string, "expression": string, "kind": string}], "relationships"?: [{"description": string, "kind": "correlation"|"conditional"|"derived", "detail"?: string}], "assumptions": string[], "notes"?: string[]}. Mark parameter values as the user stated them or as clearly labelled placeholders to be checked.\n' +
          payload,
      };
    case 'suggestFollowUps':
      return {
        json: true,
        instruction:
          'Suggest follow-up investigations. Reply with JSON only, shaped as {"items": [{"question": string, "why": string, "suggestedToolId"?: string}]} with at most five items.\n' +
          payload,
      };
    case 'explainResult':
      return {
        json: false,
        instruction:
          'Explain in plain language what these figures mean for the situation described, using only the figures and assumptions below. Mention the main limitation. Do not recompute anything.\n' +
          payload,
      };
    case 'explainUncertainty':
      return {
        json: false,
        instruction:
          'Explain how much confidence these figures support and what could make them wrong, using only what is given. Do not introduce new numbers.\n' +
          payload,
      };
    case 'interpretStatistics':
      return {
        json: false,
        instruction:
          'Explain what this test result does and does not tell the user. State what a p-value is not. Use only the numbers given.\n' + payload,
      };
  }
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The reply did not contain a structured answer.');
  return JSON.parse(body.slice(start, end + 1));
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Checks a structured reply against the contract; returns null when it does not fit. */
function shape(capability: AiCapability, raw: unknown): unknown {
  if (!isObject(raw)) return null;
  switch (capability) {
    case 'interpretQuestion':
      return typeof raw.suggestedToolId === 'string' && raw.suggestedToolId ? raw : null;
    case 'suggestMethod':
      return typeof raw.methodId === 'string' && typeof raw.reasoning === 'string'
        ? { ...raw, requiredAssumptions: strings(raw.requiredAssumptions) }
        : null;
    case 'identifyMissingInputs':
      return Array.isArray(raw.missing) && typeof raw.sufficient === 'boolean' ? raw : null;
    case 'draftAssumptions':
      return Array.isArray(raw.assumptions) ? raw : null;
    case 'buildScenario':
      return Array.isArray(raw.variables) && Array.isArray(raw.outputs) ? { ...raw, assumptions: strings(raw.assumptions) } : null;
    case 'suggestFollowUps':
      return Array.isArray(raw.items) ? raw : null;
    default:
      return null;
  }
}

export function createOrbisAiAdapter(api: ChatApi): AiAdapter {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    hostName: 'Orion',
    capabilities: () => AI_CAPABILITIES,
    async request<C extends AiCapability>(request: Extract<AiRequest, { capability: C }>, signal: AbortSignal): Promise<AiResult<C>> {
      const fail = (code: 'cancelled' | 'timeout' | 'host-error' | 'invalid-request', message: string, retryable = false): AiResult<C> => ({
        ok: false,
        capability: request.capability as C,
        requestId: request.requestId,
        error: { code, message, retryable },
      });
      if (signal.aborted) return fail('cancelled', 'The request was cancelled.');
      const { instruction, json } = describe(request);
      let model = '';
      try {
        // The person's chosen default; Orion's own routing picks the model when it is automatic or unset.
        model = (await api.getSettings()).defaultModel || 'orion/auto';
      } catch {
        return fail('host-error', 'Orbis could not be reached for the model setting.', true);
      }
      const chatId = `chance-${request.requestId}`;
      let text = '';
      const outcome = await new Promise<string>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const off = api.onChatEvent(chatId, (event) => {
          if (event.type === 'delta' && event.content) text += event.content;
          else if (event.type === 'done') finish('done');
          else if (event.type === 'aborted') finish('aborted');
          else if (event.type === 'error') finish(event.message ?? 'The assistant could not answer.');
        });
        const finish = (result: string): void => {
          if (timer) clearTimeout(timer);
          off();
          resolve(result);
        };
        timer = setTimeout(() => {
          void api.abortChat(chatId);
          finish('timeout');
        }, 90_000);
        signal.addEventListener(
          'abort',
          () => {
            void api.abortChat(chatId);
            finish('aborted');
          },
          { once: true },
        );
        void api
          .sendChat({
            requestId: chatId,
            model,
            images: false,
            ask: true,
            messages: [
              { id: 'chance-system', role: 'system', content: SYSTEM, createdAt: Date.now() },
              { id: 'chance-user', role: 'user', content: instruction, createdAt: Date.now() },
            ],
          })
          .catch((e: unknown) => finish(e instanceof Error ? e.message : 'The request could not be sent.'));
      });
      if (outcome === 'aborted') return fail('cancelled', 'The request was cancelled.');
      if (outcome === 'timeout') return fail('timeout', 'The assistant took too long to answer.', true);
      if (outcome !== 'done') return fail('host-error', outcome, true);
      if (!text.trim()) return fail('host-error', 'The assistant returned nothing.', true);
      const provenance = { model, host: 'Orion' };
      if (!json) return { ok: true, capability: request.capability as C, requestId: request.requestId, value: { text: text.trim() } as never, provenance };
      try {
        const value = shape(request.capability, extractJson(text));
        if (value === null) return fail('host-error', 'The assistant answered in a form Orbis Chance could not use.', true);
        return { ok: true, capability: request.capability as C, requestId: request.requestId, value: value as never, provenance };
      } catch {
        return fail('host-error', 'The assistant answered in a form Orbis Chance could not use.', true);
      }
    },
  };
}
