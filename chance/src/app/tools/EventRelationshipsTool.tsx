/**
 * Event relationships: combine two events once the relationship between them
 * has been stated. When it is unknown, bounds are shown rather than a single
 * invented value.
 */
import { useMemo } from 'react';
import {
  EVENT_RELATIONSHIPS,
  analyseTwoEvents,
  validateTwoEvents,
  type EventRelationship,
} from '../../engine/probability/basic';
import { Card, DataTable, Notice, ProbabilityField, SelectField, TextField } from '../../ui/primitives';
import { formatPercent, formatValue, seriesColor } from '../../ui/charts/scale';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

export interface EventRelationshipsConfig {
  labelA: string;
  labelB: string;
  pA: number;
  pB: number;
  relationship: EventRelationship;
  pAnd: number;
  pBGivenA: number;
}

export const EVENT_RELATIONSHIPS_DEFAULT: EventRelationshipsConfig = {
  labelA: 'Event A',
  labelB: 'Event B',
  pA: 0.5,
  pB: 0.4,
  relationship: 'independent',
  pAnd: 0.2,
  pBGivenA: 0.4,
};

export function EventRelationshipsTool({ config }: { config: EventRelationshipsConfig }) {
  const app = useApp();
  const set = (patch: Partial<EventRelationshipsConfig>) => app.updateConfig({ ...config, ...patch });

  const issues = useMemo(() => validateTwoEvents(config), [config]);
  const result = useMemo(() => {
    if (issues.length) return null;
    try {
      return analyseTwoEvents(config);
    } catch {
      return null;
    }
  }, [config, issues]);

  const relationshipInfo = EVENT_RELATIONSHIPS.find((r) => r.id === config.relationship)!;
  const A = config.labelA || 'A';
  const B = config.labelB || 'B';

  return (
    <>
      <ToolHeader toolId="event-relationships" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="The two events">
            <TextField label="Name of the first event" value={config.labelA} onChange={(labelA) => set({ labelA })} maxLength={80} />
            <ProbabilityField label={`Probability of ${A}`} symbol="P(A)" value={config.pA} onChange={(pA) => set({ pA })} />
            <hr className="oc-divider" />
            <TextField label="Name of the second event" value={config.labelB} onChange={(labelB) => set({ labelB })} maxLength={80} />
            <ProbabilityField label={`Probability of ${B}`} symbol="P(B)" value={config.pB} onChange={(pB) => set({ pB })} />
          </Card>

          <Card title="How the events relate" hint="This cannot be deduced from the two probabilities alone; it has to be stated.">
            <SelectField
              label="Relationship"
              value={config.relationship}
              onChange={(relationship) => set({ relationship })}
              options={EVENT_RELATIONSHIPS.map((r) => ({ value: r.id, label: r.label }))}
              hint={relationshipInfo.description}
            />
            {config.relationship === 'given-intersection' && (
              <ProbabilityField
                label={`Probability that both ${A} and ${B} occur`}
                symbol="P(A ∩ B)"
                value={config.pAnd}
                onChange={(pAnd) => set({ pAnd })}
                hint={`Must be between ${Math.max(0, config.pA + config.pB - 1).toPrecision(4)} and ${Math.min(config.pA, config.pB).toPrecision(4)} for these marginal probabilities.`}
              />
            )}
            {config.relationship === 'given-conditional' && (
              <ProbabilityField
                label={`Probability of ${B} given that ${A} occurred`}
                symbol="P(B | A)"
                value={config.pBGivenA}
                onChange={(pBGivenA) => set({ pBGivenA })}
                hint={`Equal to P(B) = ${config.pB} would mean the events are independent.`}
              />
            )}
            <Notice tone="info" title="Why the relationship matters">
              <p>
                Two events described separately are not automatically independent. Independence is a strong claim: it says that learning whether one happened
                tells you nothing about the other. Assuming it when it is false is one of the most common errors in probability.
              </p>
            </Notice>
          </Card>

          <AiAssistPanel capability="suggestMethod" context="The relationship list above describes when each rule applies, and the explanation panel names the formula used." />
        </div>

        <div className="oc-stack">
          {issues.length > 0 && <Notice tone="error" title="These values are not consistent" items={issues.map((i) => i.message)} />}

          {result && (
            <>
              {result.warnings.length > 0 && <Notice tone="warning" items={result.warnings} />}

              {result.intersection && result.union ? (
                <>
                  <Card title="Combined probabilities">
                    <div className="oc-figure-grid">
                      <Fig label={`Both ${A} and ${B}`} value={formatPercent(result.intersection.p)} sub={`P(A ∩ B) = ${formatValue(result.intersection.p, 6)}${result.intersection.fraction ? ` = ${result.intersection.fraction}` : ''}`} />
                      <Fig label={`${A} or ${B} (or both)`} value={formatPercent(result.union.p)} sub={`P(A ∪ B) = ${formatValue(result.union.p, 6)}`} />
                      <Fig label={`Neither event`} value={formatPercent(result.neither!.p)} sub="1 − P(A ∪ B)" />
                      <Fig label={`${A} only`} value={formatPercent(result.onlyA!.p)} sub="P(A) − P(A ∩ B)" />
                      <Fig label={`${B} only`} value={formatPercent(result.onlyB!.p)} sub="P(B) − P(A ∩ B)" />
                      {result.bGivenA && <Fig label={`${B} given ${A}`} value={formatPercent(result.bGivenA.p)} sub="P(A ∩ B) ÷ P(A)" />}
                      {result.aGivenB && <Fig label={`${A} given ${B}`} value={formatPercent(result.aGivenB.p)} sub="P(A ∩ B) ÷ P(B)" />}
                    </div>
                  </Card>

                  <Card title="How the probability is divided">
                    <PartitionBar
                      segments={[
                        { label: `${A} only`, value: result.onlyA!.p, color: seriesColor(0) },
                        { label: 'Both', value: result.intersection.p, color: seriesColor(2) },
                        { label: `${B} only`, value: result.onlyB!.p, color: seriesColor(1) },
                        { label: 'Neither', value: result.neither!.p, color: 'var(--surface-3)' },
                      ]}
                    />
                    <p className="oc-chart-note">
                      The four regions are mutually exclusive and sum to 1. This is the complete picture of what can happen with two events.
                    </p>
                  </Card>

                  {result.independenceCheck?.applicable && (
                    <Card title="Independence check" variant="inset">
                      <DataTable
                        caption="Independence check"
                        columns={[
                          { key: 'k', header: 'Quantity', render: (r) => (r as KV).k },
                          { key: 'v', header: 'Value', numeric: true, render: (r) => (r as KV).v },
                        ]}
                        rows={[
                          { k: 'P(A ∩ B) as supplied', v: formatValue(result.intersection.p, 6) },
                          { k: 'P(A) × P(B)', v: formatValue(result.independenceCheck.productOfMarginals, 6) },
                          { k: 'Difference', v: formatValue(result.intersection.p - result.independenceCheck.productOfMarginals, 4) },
                        ] as KV[]}
                      />
                      <p className="oc-chart-note">
                        Events are independent exactly when P(A ∩ B) = P(A) × P(B). The two values above{' '}
                        {result.independenceCheck.independent ? 'agree, so these events are independent.' : 'differ, so these events are not independent.'}
                      </p>
                    </Card>
                  )}
                </>
              ) : (
                <Card title="Only bounds can be given">
                  <Notice tone="warning" title="The relationship is unknown">
                    <p>
                      With only P({A}) and P({B}) supplied, no single value for the combined probabilities follows. Every value in the ranges below is
                      consistent with what you have entered.
                    </p>
                  </Notice>
                  <div className="oc-figure-grid">
                    <Fig
                      label={`Both ${A} and ${B}`}
                      value={`${formatPercent(result.intersectionBounds.low)} – ${formatPercent(result.intersectionBounds.high)}`}
                      sub="max(0, P(A)+P(B)−1) to min(P(A), P(B))"
                    />
                    <Fig
                      label={`${A} or ${B}`}
                      value={`${formatPercent(result.unionBounds.low)} – ${formatPercent(result.unionBounds.high)}`}
                      sub="max(P(A), P(B)) to min(1, P(A)+P(B))"
                    />
                  </div>
                  <p className="oc-chart-note">
                    These are the tightest possible bounds from the marginal probabilities (the Fréchet–Hoeffding bounds). To get a single answer, choose a
                    relationship above or supply P(A ∩ B) or P(B | A).
                  </p>
                </Card>
              )}

              <ExplanationPanel explanation={result.explanation} defaultOpen />
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface KV {
  k: string;
  v: string;
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="oc-figure">
      <span className="oc-figure__label">{label}</span>
      <div className="oc-figure__value">{value}</div>
      {sub && <div className="oc-figure__sub">{sub}</div>}
    </div>
  );
}

/** Stacked bar with a 2px surface gap between segments and direct labels where they fit. */
function PartitionBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const visible = segments.filter((s) => s.value > 0.0005);
  return (
    <>
      <div style={{ display: 'flex', height: 40, borderRadius: 'var(--radius-sm)', overflow: 'hidden', gap: 2, background: 'var(--surface-1)' }}>
        {visible.map((s, i) => (
          <div
            key={i}
            style={{
              width: `${s.value * 100}%`,
              background: s.color,
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: s.color === 'var(--surface-3)' ? 'var(--text-secondary)' : '#0a1418',
              overflow: 'hidden',
              borderRadius: i === 0 ? '4px 0 0 4px' : i === visible.length - 1 ? '0 4px 4px 0' : 0,
            }}
            title={`${s.label}: ${formatPercent(s.value)}`}
          >
            {/* Only label a segment wide enough to hold the text. */}
            {s.value > 0.1 ? formatPercent(s.value) : ''}
          </div>
        ))}
      </div>
      <div className="oc-legend">
        {segments.map((s, i) => (
          <span key={i} className="oc-legend__item">
            <span className="oc-legend__swatch" style={{ background: s.color }} />
            {s.label}: {formatPercent(s.value)}
          </span>
        ))}
      </div>
    </>
  );
}
