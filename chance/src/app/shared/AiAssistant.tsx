/**
 * The assistant panel for a tool, used when the host supplies an AI adapter.
 *
 * What it sends is limited to what is on the screen: the question the user types, and the figures the engine already
 * produced (as formatted strings). It never sends imported rows. What comes back is shown as a suggestion, labelled
 * as one: nothing here is a computed result, and a suggested tool or configuration is checked by the application
 * before it is used.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from '../store';
import { TOOLS, getTool } from '../tools';
import { DISTRIBUTIONS } from '../../engine/distributions/registry';
import type { ResultSummary, ToolId } from '../../persistence/schema';
import { Button, Card, Notice } from '../../ui/primitives';
import {
  AI_CAPABILITY_INFO,
  AI_CONTRACT_VERSION,
  type AiCapability,
  type AiError,
  type AiRequest,
  type AiResponseMap,
} from '../../ai/contract';
import { aiStatus, newRequestId, requestAi } from '../../ai/registry';

// ---------------------------------------------------------------------------------------------------------------
// What the open tool is showing, published by the tool header and read here.

interface ToolScope {
  toolId: ToolId | null;
  summary: ResultSummary | undefined;
}

let scope: ToolScope = { toolId: null, summary: undefined };
const listeners = new Set<() => void>();

export function publishToolScope(next: ToolScope): void {
  if (scope.toolId === next.toolId && scope.summary === next.summary) return;
  scope = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = (): ToolScope => scope;

// ---------------------------------------------------------------------------------------------------------------

/** Capabilities that start from a sentence the user writes. */
const FROM_TEXT: AiCapability[] = ['interpretQuestion', 'suggestMethod', 'identifyMissingInputs', 'draftAssumptions', 'buildScenario'];

const PLACEHOLDER: Partial<Record<AiCapability, string>> = {
  interpretQuestion: 'For example: a 12% chance each day, what is the probability it happens at least once in 30 days?',
  suggestMethod: 'Describe what you are trying to find out and what you know.',
  identifyMissingInputs: 'Write the question as you have it so far.',
  draftAssumptions: 'Describe the situation the model is meant to represent.',
  buildScenario: 'For example: monthly demand is uncertain, unit cost varies a little, and I want to know the chance profit is negative.',
};

type Outcome =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'error'; error: AiError }
  | { kind: 'done'; capability: AiCapability; value: AiResponseMap[AiCapability]; model?: string };

export function AiAssistant({ capability, context }: { capability: AiCapability; context?: string }) {
  const info = AI_CAPABILITY_INFO[capability];
  const status = aiStatus();
  const app = useApp();
  const seen = useSyncExternalStore(subscribe, snapshot);
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const fromText = FROM_TEXT.includes(capability);
  const summary = seen.summary;
  const figures = summary?.figures ?? [];
  const toolId = seen.toolId ?? undefined;
  const tool = toolId ? getTool(toolId) : undefined;
  const ready = fromText ? text.trim().length > 2 : !!summary?.headline;

  const build = (): AiRequest | null => {
    const base = {
      contractVersion: AI_CONTRACT_VERSION,
      requestId: newRequestId(),
      context: { toolId, locale: typeof navigator !== 'undefined' ? navigator.language : undefined },
    };
    const shown = summary?.headline
      ? [{ label: summary.label ?? 'Result', value: summary.headline }, ...figures.map((f) => ({ label: f.label, value: String(f.value) }))]
      : [];
    switch (capability) {
      case 'interpretQuestion':
        return { ...base, capability, question: text.trim() };
      case 'suggestMethod':
        return {
          ...base,
          capability,
          situation: text.trim(),
          availableMethods: TOOLS.map((t) => ({ id: t.id, name: t.name, summary: t.summary })),
        };
      case 'identifyMissingInputs':
        return { ...base, capability, question: text.trim(), providedInputs: [] };
      case 'draftAssumptions':
        return { ...base, capability, description: text.trim(), engineAssumptions: [] };
      case 'buildScenario':
        return {
          ...base,
          capability,
          description: text.trim(),
          availableDistributions: DISTRIBUTIONS.map((d) => ({ id: d.id, name: d.name, params: d.params.map((p) => p.key) })),
        };
      case 'explainResult':
        return {
          ...base,
          capability,
          question: tool?.name,
          engineExplanation: {
            method: tool?.methods.slice(0, 3).join('; ') ?? 'Not stated',
            steps: [],
            assumptions: [],
            limitations: [],
            exactness: summary?.fromSimulation ? 'Monte Carlo estimate' : 'As labelled on the screen',
          },
          figures: shown,
        };
      case 'explainUncertainty':
        return { ...base, capability, figures: shown, limitations: summary?.fromSimulation ? ['The figures come from a simulation and carry sampling error.'] : [] };
      case 'interpretStatistics':
        return null;
      case 'suggestFollowUps':
        return { ...base, capability, summary: tool?.name ?? 'This investigation', figures: shown };
    }
  };

  const ask = async (): Promise<void> => {
    const request = build();
    if (!request) {
      setOutcome({
        kind: 'error',
        error: { code: 'invalid-request', message: 'The screen does not give the assistant the figures this needs. Use the result panel on the screen.' },
      });
      return;
    }
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    setOutcome({ kind: 'working' });
    const result = await requestAi(request as never, mine.signal);
    if (mine.signal.aborted && !result.ok && result.error.code === 'cancelled') {
      setOutcome({ kind: 'idle' });
      return;
    }
    setOutcome(
      result.ok
        ? { kind: 'done', capability, value: result.value as AiResponseMap[AiCapability], model: result.provenance?.model }
        : { kind: 'error', error: result.error },
    );
  };

  return (
    <Card title={info.label} hint={`Suggestions from ${status.hostName ?? 'the assistant'}`}>
      <Notice tone="info" title="A suggestion, not a result">
        <p>
          What comes back is checked by the calculation engine before it is used. Every number in the results is computed by Orbis Chance, never by the
          assistant. Your question and the figures shown on this screen are sent through Orion, the same assistant as in Orbis chat.
        </p>
      </Notice>
      <p className="oc-secondary" style={{ fontSize: 12.5, margin: 'var(--s2) 0' }}>{info.description}</p>

      {fromText && (
        <textarea
          className="oc-input"
          style={{ width: '100%', minHeight: 72, resize: 'vertical' }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER[capability]}
          aria-label={info.label}
          maxLength={4000}
        />
      )}
      {!fromText && !summary?.headline && (
        <p className="oc-muted" style={{ fontSize: 12.5 }}>
          Run the calculation first; this works from the result shown on the screen. {context}
        </p>
      )}
      {!fromText && summary?.headline && (
        <p className="oc-muted" style={{ fontSize: 12.5 }}>
          Will use: {summary.label ?? 'Result'} {summary.headline}
          {figures.length > 0 ? ` and ${figures.length} more figure${figures.length === 1 ? '' : 's'}` : ''}.
        </p>
      )}

      <div className="oc-btn-row" style={{ marginTop: 'var(--s2)' }}>
        <Button variant="primary" onClick={() => void ask()} disabled={!ready || outcome.kind === 'working'}>
          {outcome.kind === 'working' ? 'Asking…' : 'Ask'}
        </Button>
        {outcome.kind === 'working' && <Button onClick={() => controller.current?.abort()}>Cancel</Button>}
      </div>

      {outcome.kind === 'error' && (
        <Notice tone="warning" title="The assistant could not help with this">
          <p>{outcome.error.message}</p>
          <p>{info.manualAlternative}</p>
        </Notice>
      )}
      {outcome.kind === 'done' && <Answer outcome={outcome} onOpenTool={(id) => app.navigate({ kind: 'tool', toolId: id })} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const isToolId = (id: unknown): id is ToolId => typeof id === 'string' && TOOLS.some((t) => t.id === id);

function Answer({ outcome, onOpenTool }: { outcome: Extract<Outcome, { kind: 'done' }>; onOpenTool(id: ToolId): void }) {
  const v = outcome.value as never as Record<string, unknown> & AiResponseMap[AiCapability];
  const list = (items: unknown, render: (item: Record<string, unknown>, i: number) => React.ReactNode) =>
    Array.isArray(items) ? <ul style={{ margin: 0, paddingLeft: 18 }}>{items.slice(0, 20).map((x, i) => <li key={i}>{render(x as Record<string, unknown>, i)}</li>)}</ul> : null;

  let body: React.ReactNode = null;
  switch (outcome.capability) {
    case 'interpretQuestion': {
      const a = v as AiResponseMap['interpretQuestion'];
      body = (
        <>
          {a.objective && <p><strong>What is being asked:</strong> {a.objective}</p>}
          {isToolId(a.suggestedToolId) ? (
            <p>
              <strong>Suggested tool:</strong> {getTool(a.suggestedToolId).name}{' '}
              <Button onClick={() => onOpenTool(a.suggestedToolId as ToolId)}>Open it</Button>
            </p>
          ) : (
            <p className="oc-muted">The suggested tool is not one Orbis Chance has, so it is not offered.</p>
          )}
          {a.extractedQuantities && a.extractedQuantities.length > 0 && (
            <>
              <p style={{ margin: 0 }}><strong>Quantities read from your question</strong> (check each one):</p>
              {list(a.extractedQuantities, (q) => <>{String(q.label)}: {String(q.value)}{q.unit ? ` ${String(q.unit)}` : ''}</>)}
            </>
          )}
          {a.missingQuantities && a.missingQuantities.length > 0 && (
            <>
              <p style={{ margin: 0 }}><strong>Still needed:</strong></p>
              {list(a.missingQuantities, (q) => <>{String(q.label)} — {String(q.why)}</>)}
            </>
          )}
        </>
      );
      break;
    }
    case 'suggestMethod': {
      const a = v as AiResponseMap['suggestMethod'];
      body = (
        <>
          <p>
            <strong>Suggested:</strong> {isToolId(a.methodId) ? getTool(a.methodId).name : a.methodId}{' '}
            {isToolId(a.methodId) && <Button onClick={() => onOpenTool(a.methodId as ToolId)}>Open it</Button>}
          </p>
          <p>{a.reasoning}</p>
          {a.requiredAssumptions.length > 0 && (
            <>
              <p style={{ margin: 0 }}><strong>It assumes:</strong></p>
              {list(a.requiredAssumptions.map((t) => ({ t })), (x) => <>{String(x.t)}</>)}
            </>
          )}
        </>
      );
      break;
    }
    case 'identifyMissingInputs': {
      const a = v as AiResponseMap['identifyMissingInputs'];
      body = a.sufficient && a.missing.length === 0 ? <p>The question appears to have what it needs.</p> : <>{list(a.missing, (m) => <>{String(m.label)} — {String(m.why)}</>)}</>;
      break;
    }
    case 'draftAssumptions': {
      const a = v as AiResponseMap['draftAssumptions'];
      body = <>{list(a.assumptions, (x) => <><strong>{String(x.text)}</strong> — {String(x.whyItMatters)}</>)}</>;
      break;
    }
    case 'buildScenario': {
      const a = v as AiResponseMap['buildScenario'];
      body = (
        <>
          <p style={{ margin: 0 }}><strong>Variables to consider</strong> (placeholders until you set the values):</p>
          {list(a.variables, (x) => <>{String(x.label ?? x.name)}{x.distributionId ? ` — ${String(x.distributionId)}` : ''}{x.expression ? ` = ${String(x.expression)}` : ''}</>)}
          <p style={{ margin: 'var(--s2) 0 0' }}><strong>Outputs:</strong></p>
          {list(a.outputs, (x) => <>{String(x.label)}: {String(x.expression)}</>)}
          {a.assumptions.length > 0 && (
            <>
              <p style={{ margin: 'var(--s2) 0 0' }}><strong>Assumptions to confirm:</strong></p>
              {list(a.assumptions.map((t) => ({ t })), (x) => <>{String(x.t)}</>)}
            </>
          )}
          <p className="oc-muted" style={{ fontSize: 12.5 }}>Enter these in the Scenario builder yourself; the engine validates what you enter.</p>
        </>
      );
      break;
    }
    case 'suggestFollowUps': {
      const a = v as AiResponseMap['suggestFollowUps'];
      body = (
        <>
          {list(a.items, (x) => (
            <>
              {String(x.question)} — <span className="oc-muted">{String(x.why)}</span>{' '}
              {isToolId(x.suggestedToolId) && <Button onClick={() => onOpenTool(x.suggestedToolId as ToolId)}>{getTool(x.suggestedToolId).name}</Button>}
            </>
          ))}
        </>
      );
      break;
    }
    default: {
      const a = v as AiResponseMap['explainResult'];
      body = <p style={{ whiteSpace: 'pre-wrap' }}>{a.text}</p>;
    }
  }

  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      {body}
      <p className="oc-muted" style={{ fontSize: 12, marginTop: 'var(--s2)' }}>
        Suggestion from Orion{outcome.model ? ` (${outcome.model})` : ''}. It can be wrong; check it against the calculation.
      </p>
    </div>
  );
}
