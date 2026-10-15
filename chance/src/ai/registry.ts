/**
 * AI adapter registry.
 *
 * Standalone Orbis Chance has no adapter. A future Orbis host registers one at
 * start-up:
 *
 *     import { registerAiAdapter } from 'orbis-chance/ai';
 *     registerAiAdapter(myOrbisAdapter);
 *
 * Until then, every capability reports as unavailable and the application shows
 * the honest unavailable state with a manual alternative. This module performs
 * no network access and holds no credentials.
 */
import {
  AI_CAPABILITIES,
  AI_CONTRACT_VERSION,
  isContractCompatible,
  type AiAdapter,
  type AiCapability,
  type AiRequest,
  type AiResult,
} from './contract';

let adapter: AiAdapter | null = null;
const listeners = new Set<() => void>();

export interface RegistrationOutcome {
  ok: boolean;
  message: string;
}

export function registerAiAdapter(next: AiAdapter | null): RegistrationOutcome {
  if (next === null) {
    adapter = null;
    notify();
    return { ok: true, message: 'AI adapter removed. Orbis Chance is running in standalone mode.' };
  }
  if (typeof next.request !== 'function' || typeof next.capabilities !== 'function') {
    return { ok: false, message: 'The supplied adapter does not implement the required methods.' };
  }
  if (!isContractCompatible(next.contractVersion)) {
    return {
      ok: false,
      message: `The adapter implements AI contract version ${next.contractVersion}, which is not compatible with this build's version ${AI_CONTRACT_VERSION}.`,
    };
  }
  const unknown = next.capabilities().filter((c) => !AI_CAPABILITIES.includes(c));
  if (unknown.length) {
    return { ok: false, message: `The adapter declares unknown capabilities: ${unknown.join(', ')}.` };
  }
  adapter = next;
  notify();
  return { ok: true, message: `AI assistance is now provided by ${next.hostName}.` };
}

export function getAiAdapter(): AiAdapter | null {
  return adapter;
}

export interface AiStatus {
  available: boolean;
  hostName: string | null;
  contractVersion: string;
  capabilities: readonly AiCapability[];
}

export function aiStatus(): AiStatus {
  return {
    available: adapter !== null,
    hostName: adapter?.hostName ?? null,
    contractVersion: AI_CONTRACT_VERSION,
    capabilities: adapter?.capabilities() ?? [],
  };
}

export function isCapabilityAvailable(capability: AiCapability): boolean {
  return adapter !== null && adapter.capabilities().includes(capability);
}

export function subscribeToAiStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

/**
 * Send a request through the adapter. Returns a typed failure rather than
 * throwing when no adapter is registered, so callers always have something
 * honest to display.
 */
export async function requestAi<C extends AiCapability>(
  request: Extract<AiRequest, { capability: C }>,
  signal?: AbortSignal,
): Promise<AiResult<C>> {
  const current = adapter;
  if (!current) {
    return {
      ok: false,
      capability: request.capability as C,
      requestId: request.requestId,
      error: {
        code: 'unavailable',
        message:
          'AI assistance is not available in standalone Orbis Chance. It becomes available after Orbis Chance is integrated with the Orbis application and an AI adapter is supplied by that host.',
      },
    };
  }
  if (!current.capabilities().includes(request.capability)) {
    return {
      ok: false,
      capability: request.capability as C,
      requestId: request.requestId,
      error: {
        code: 'unsupported-capability',
        message: `${current.hostName} does not provide the "${request.capability}" capability.`,
      },
    };
  }
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    return await current.request(request, controller.signal);
  } catch (e) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        capability: request.capability as C,
        requestId: request.requestId,
        error: { code: 'cancelled', message: 'The request was cancelled.' },
      };
    }
    return {
      ok: false,
      capability: request.capability as C,
      requestId: request.requestId,
      error: {
        code: 'host-error',
        message: `The host could not complete the request: ${e instanceof Error ? e.message : String(e)}`,
        retryable: true,
      },
    };
  }
}

/** Request id generator; not security-sensitive. */
export function newRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
