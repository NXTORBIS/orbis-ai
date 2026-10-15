/**
 * Tests for the AI integration boundary.
 *
 * These exercise the contract the way a future Orbis host would, using a stub
 * adapter. They also assert the properties the documentation claims: no
 * credentials, no network, and no path by which AI output becomes a displayed
 * numeric result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_CAPABILITIES,
  AI_CAPABILITY_INFO,
  AI_CONTRACT_VERSION,
  isContractCompatible,
  type AiAdapter,
  type AiCapability,
  type SuggestMethodRequest,
} from './contract';
import { aiStatus, getAiAdapter, isCapabilityAvailable, newRequestId, registerAiAdapter, requestAi, subscribeToAiStatus } from './registry';

function stubAdapter(over: Partial<AiAdapter> = {}): AiAdapter {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    hostName: 'Test host',
    capabilities: () => ['suggestMethod', 'explainResult'],
    async request(req) {
      if (req.capability === 'suggestMethod') {
        // The host must choose from the methods the application offered.
        const methods = (req as SuggestMethodRequest).availableMethods;
        return {
          ok: true,
          capability: 'suggestMethod',
          requestId: req.requestId,
          value: { methodId: methods[0]?.id ?? 'unknown', reasoning: 'stub', requiredAssumptions: [] },
        } as never;
      }
      return { ok: true, capability: req.capability, requestId: req.requestId, value: { text: 'stub explanation' } } as never;
    },
    ...over,
  };
}

afterEach(() => {
  registerAiAdapter(null);
});

describe('standalone mode', () => {
  it('reports unavailable with no adapter registered', () => {
    const status = aiStatus();
    expect(status.available).toBe(false);
    expect(status.hostName).toBeNull();
    expect(status.capabilities).toEqual([]);
    expect(getAiAdapter()).toBeNull();
    for (const c of AI_CAPABILITIES) expect(isCapabilityAvailable(c)).toBe(false);
  });

  it('returns a typed failure rather than throwing', async () => {
    const result = await requestAi({ capability: 'explainResult', contractVersion: AI_CONTRACT_VERSION, requestId: newRequestId(), engineExplanation: { method: 'm', steps: [], assumptions: [], limitations: [], exactness: 'exact' }, figures: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unavailable');
      expect(result.error.message).toMatch(/after Orbis Chance is integrated/);
    }
  });

  it('every capability declares a manual alternative', () => {
    for (const c of AI_CAPABILITIES) {
      const info = AI_CAPABILITY_INFO[c];
      expect(info.label.length).toBeGreaterThan(3);
      expect(info.description.length).toBeGreaterThan(20);
      expect(info.manualAlternative.length).toBeGreaterThan(20);
    }
  });
});

describe('registration', () => {
  it('accepts a compatible adapter and reports its capabilities', () => {
    const outcome = registerAiAdapter(stubAdapter());
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Test host/);
    const status = aiStatus();
    expect(status.available).toBe(true);
    expect(status.hostName).toBe('Test host');
    expect(isCapabilityAvailable('suggestMethod')).toBe(true);
    expect(isCapabilityAvailable('buildScenario')).toBe(false);
  });

  it('refuses an adapter built for an incompatible contract version', () => {
    expect(registerAiAdapter(stubAdapter({ contractVersion: '2.0.0' })).ok).toBe(false);
    expect(registerAiAdapter(stubAdapter({ contractVersion: '0.9.0' })).ok).toBe(false);
    expect(registerAiAdapter(stubAdapter({ contractVersion: 'nonsense' })).ok).toBe(false);
    expect(aiStatus().available).toBe(false);
  });

  it('refuses an adapter declaring an unknown capability', () => {
    const outcome = registerAiAdapter(stubAdapter({ capabilities: () => ['teleport' as AiCapability] }));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/unknown capabilities/);
  });

  it('refuses a malformed adapter', () => {
    expect(registerAiAdapter({ contractVersion: AI_CONTRACT_VERSION, hostName: 'x' } as unknown as AiAdapter).ok).toBe(false);
  });

  it('version compatibility follows the documented rule', () => {
    expect(isContractCompatible('1.0.0')).toBe(true);
    expect(isContractCompatible('1.0.5')).toBe(true);
    expect(isContractCompatible('1.1.0')).toBe(false); // adapter minor above ours
    expect(isContractCompatible('2.0.0')).toBe(false);
    expect(isContractCompatible('0.9.9')).toBe(false);
  });

  it('notifies subscribers when the adapter changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAiStatus(listener);
    registerAiAdapter(stubAdapter());
    expect(listener).toHaveBeenCalledTimes(1);
    registerAiAdapter(null);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    registerAiAdapter(stubAdapter());
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('dispatch', () => {
  it('routes a supported request to the adapter', async () => {
    registerAiAdapter(stubAdapter());
    const result = await requestAi({
      capability: 'suggestMethod',
      contractVersion: AI_CONTRACT_VERSION,
      requestId: 'r1',
      situation: 'Counting aces',
      availableMethods: [{ id: 'hypergeometric', name: 'Hypergeometric', summary: 'Without replacement' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.methodId).toBe('hypergeometric');
  });

  it('reports an unsupported capability instead of hanging', async () => {
    registerAiAdapter(stubAdapter());
    const result = await requestAi({
      capability: 'buildScenario',
      contractVersion: AI_CONTRACT_VERSION,
      requestId: 'r2',
      description: 'anything',
      availableDistributions: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported-capability');
  });

  it('converts a thrown error into a typed host error', async () => {
    registerAiAdapter(stubAdapter({ request: async () => { throw new Error('host exploded'); } }));
    const result = await requestAi({ capability: 'explainResult', contractVersion: AI_CONTRACT_VERSION, requestId: 'r3', engineExplanation: { method: 'm', steps: [], assumptions: [], limitations: [], exactness: 'exact' }, figures: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('host-error');
      expect(result.error.message).toMatch(/host exploded/);
      expect(result.error.retryable).toBe(true);
    }
  });

  it('reports cancellation when the caller aborts', async () => {
    registerAiAdapter(
      stubAdapter({
        request: (_req, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      }),
    );
    const controller = new AbortController();
    const promise = requestAi(
      { capability: 'explainResult', contractVersion: AI_CONTRACT_VERSION, requestId: 'r4', engineExplanation: { method: 'm', steps: [], assumptions: [], limitations: [], exactness: 'exact' }, figures: [] },
      controller.signal,
    );
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cancelled');
  });

  it('passes an already-aborted signal straight through', async () => {
    registerAiAdapter(
      stubAdapter({
        request: (_req, signal) => (signal.aborted ? Promise.reject(new Error('already aborted')) : Promise.resolve({ ok: true } as never)),
      }),
    );
    const controller = new AbortController();
    controller.abort();
    const result = await requestAi({ capability: 'explainResult', contractVersion: AI_CONTRACT_VERSION, requestId: 'r5', engineExplanation: { method: 'm', steps: [], assumptions: [], limitations: [], exactness: 'exact' }, figures: [] }, controller.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cancelled');
  });
});

describe('the contract cannot carry a computed result', () => {
  it('no response type exposes a probability, expectation or test statistic', async () => {
    // A structural assertion: the response for each capability is text, a
    // suggested model, or a list of missing inputs — never a numeric answer.
    const { default: source } = await import('./contract.ts?raw');
    const responseBlock = source.slice(source.indexOf('export interface AiResponseMap'), source.indexOf('export type AiErrorCode'));
    for (const forbidden of ['probability:', 'expectedValue', 'pValue:', 'quantile', 'mean:', 'variance:']) {
      expect(responseBlock, `AiResponseMap must not expose "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('the AI modules contain no provider client, credential or network call', async () => {
    const files = ['./contract.ts?raw', './registry.ts?raw'];
    const forbidden = [/api[_-]?key/i, /\bgroq\b/i, /\bmistral\b/i, /\bopenai\b/i, /authorization/i, /\bbearer\b/i, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /navigator\.sendBeacon/];
    for (const file of files) {
      const { default: source } = (await import(/* @vite-ignore */ file)) as { default: string };
      // Strip comments: the documentation in them legitimately names these terms.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const pattern of forbidden) {
        expect(code, `${file} must not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('the mathematical engine does not import the AI layer', async () => {
    const modules = import.meta.glob('../engine/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const offenders = Object.entries(modules).filter(([, source]) => /from\s+['"][^'"]*\/ai\//.test(source));
    expect(offenders.map(([path]) => path)).toEqual([]);
    expect(Object.keys(modules).length).toBeGreaterThan(10);
  });
});
