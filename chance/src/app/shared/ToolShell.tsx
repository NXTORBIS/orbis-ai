/**
 * Shared scaffolding for every tool page: the investigation header (name,
 * description, save/duplicate/export), the AI-unavailable panel, and the
 * simulation-results display that several tools reuse.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AiAssistant, publishToolScope } from './AiAssistant';
import { useApp } from '../store';
import { getTool } from '../tools';
import type { ToolId } from '../../persistence/schema';
import { Badge, Button, Card, ConfirmDialog, Dialog, Notice, TextField, useToast } from '../../ui/primitives';
import { Icon } from '../../ui/icons';
import { AI_CAPABILITY_INFO, type AiCapability } from '../../ai/contract';
import { isCapabilityAvailable } from '../../ai/registry';
import type { ResultSummary } from '../../persistence/schema';
import { downloadInvestigationReport, type ToolReportSource } from './reportExport';

/**
 * The investigation header, and with it the two exports every tool gets: the
 * JSON export of the configuration, and the Markdown report of the analysis.
 *
 * A screen opts into the report by passing `report`, a function returning its
 * sections. It is called when the action is used rather than on every render,
 * so a screen can hand over whole chart tables without paying for them until
 * someone asks for a report. A screen that passes nothing still exports its
 * configuration, and the report states plainly that no results were supplied.
 */
export function ToolHeader({ toolId, resultSummary, extraActions, report }: { toolId: ToolId; resultSummary?: ResultSummary; extraActions?: ReactNode; report?: ToolReportSource }) {
  const app = useApp();
  const tool = getTool(toolId);
  const toast = useToast();
  const [showDetails, setShowDetails] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const current = app.current;

  useEffect(() => {
    publishToolScope({ toolId, summary: resultSummary });
    return () => publishToolScope({ toolId: null, summary: undefined });
  }, [toolId, resultSummary]);

  return (
    <>
      <div className="oc-page-header">
        <div className="oc-page-header__text">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
            <h1>{current?.name ?? tool.name}</h1>
            {app.dirty && <Badge>Unsaved changes</Badge>}
            {current?.origin?.kind === 'example' && <Badge>Educational example</Badge>}
          </div>
          <p className="oc-page-subtitle">{current?.description || tool.description}</p>
        </div>
        <div className="oc-btn-row">
          {extraActions}
          <Button icon="edit" onClick={() => setShowDetails(true)}>
            Details
          </Button>
          <Button icon="save" variant="primary" onClick={() => void app.saveCurrent()} disabled={!current}>
            Save
          </Button>
          {current && (
            <>
              <Button icon="copy" title="Duplicate this investigation" onClick={() => void app.duplicateInvestigation(current.id)} />
              <Button icon="download" title="Export this investigation as a file" onClick={() => app.exportOne(current.id)} />
              <Button
                icon="book"
                title="Export a readable report of this investigation and its results"
                onClick={() => {
                  try {
                    const filename = downloadInvestigationReport(current, tool, {
                      config: current.config,
                      content: report?.(),
                      noResultsReason: report
                        ? undefined
                        : 'This screen does not yet supply its results to the report, so only the configuration above is included. Nothing has been inferred from it.',
                    });
                    toast.push('success', `Report saved as ${filename}. It was built in this browser; nothing was uploaded.`);
                  } catch (e) {
                    toast.push('error', `The report could not be built: ${(e as Error).message}`);
                  }
                }}
              >
                Export report
              </Button>
              <Button icon="template" title="Save the current settings as a reusable template" onClick={() => { setTemplateName(`${current.name} template`); setShowTemplate(true); }} />
            </>
          )}
        </div>
      </div>

      {resultSummary?.headline && (
        <p className="sr-only" role="status">
          Current result: {resultSummary.label ?? 'value'} {resultSummary.headline}
        </p>
      )}

      {showDetails && current && (
        <Dialog
          title="Investigation details"
          onClose={() => setShowDetails(false)}
          footer={<Button variant="primary" onClick={() => setShowDetails(false)}>Done</Button>}
        >
          <TextField label="Name" value={current.name} maxLength={200} onChange={(name) => app.updateCurrent({ name })} />
          <TextField
            label="Description"
            value={current.description}
            multiline
            rows={3}
            maxLength={4000}
            onChange={(description) => app.updateCurrent({ description })}
            hint="What question is this investigation answering?"
          />
          <AssumptionsEditor />
          <p className="oc-muted" style={{ fontSize: 12 }}>
            Created {new Date(current.createdAt).toLocaleString()} · last changed {new Date(current.updatedAt).toLocaleString()}
          </p>
        </Dialog>
      )}

      {showTemplate && (
        <Dialog
          title="Save as a template"
          onClose={() => setShowTemplate(false)}
          footer={
            <>
              <Button onClick={() => setShowTemplate(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!templateName.trim()}
                onClick={() => {
                  void app.saveAsTemplate(templateName.trim(), tool.category);
                  setShowTemplate(false);
                }}
              >
                Save template
              </Button>
            </>
          }
        >
          <p>A template stores this tool and its current settings so you can start a new investigation from them.</p>
          <TextField label="Template name" value={templateName} onChange={setTemplateName} maxLength={200} />
        </Dialog>
      )}
    </>
  );
}

function AssumptionsEditor() {
  const app = useApp();
  const current = app.current;
  const [draft, setDraft] = useState('');
  if (!current) return null;
  return (
    <div className="oc-field">
      <span className="oc-field__label">Your assumptions</span>
      <p className="oc-field__hint" style={{ marginTop: 0, marginBottom: 'var(--s2)' }}>
        Notes recorded with this investigation, separate from the assumptions the engine lists with each result.
      </p>
      {current.assumptions.length > 0 && (
        <ul style={{ margin: '0 0 var(--s3)', paddingLeft: 'var(--s4)', fontSize: 12.5 }}>
          {current.assumptions.map((a, i) => (
            <li key={i} style={{ marginBottom: 'var(--s1)' }}>
              {a}{' '}
              <button
                type="button"
                className="oc-btn oc-btn--ghost oc-btn--sm"
                style={{ padding: '0 4px' }}
                aria-label={`Remove assumption: ${a}`}
                onClick={() => app.updateCurrent({ assumptions: current.assumptions.filter((_, j) => j !== i) })}
              >
                <Icon name="x" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 'var(--s2)' }}>
        <input
          className="oc-input"
          value={draft}
          placeholder="For example: the failure rate is assumed constant over the period"
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              app.updateCurrent({ assumptions: [...current.assumptions, draft.trim()].slice(0, 50) });
              setDraft('');
            }
          }}
        />
        <Button
          icon="plus"
          title="Add assumption"
          disabled={!draft.trim() || current.assumptions.length >= 50}
          onClick={() => {
            app.updateCurrent({ assumptions: [...current.assumptions, draft.trim()] });
            setDraft('');
          }}
        />
      </div>
    </div>
  );
}

/**
 * Honest unavailable state for an AI-dependent feature. Always offers the
 * manual route to the same outcome.
 */
export function AiAssistPanel({ capability, context }: { capability: AiCapability; context?: string }) {
  const info = AI_CAPABILITY_INFO[capability];
  const available = isCapabilityAvailable(capability);
  // A host adapter is registered: the working assistant, which sends the request and shows the reply as a suggestion.
  if (available) return <AiAssistant capability={capability} context={context} />;
  return (
    <Card title={info.label} hint="Available after integration with Orbis">
      <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--text-muted)', marginTop: 2 }}>
          <Icon name="lock" size={16} />
        </span>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 12.5, marginBottom: 'var(--s2)' }}>{info.description}</p>
          <p style={{ fontSize: 12.5, marginBottom: 'var(--s3)' }} className="oc-muted">
            This feature needs an AI service. Orbis Chance is built as an independent application and contains no AI client of its own, so the feature becomes
            available once Orbis Chance is integrated with the Orbis application and that host supplies its AI adapter. Nothing is sent anywhere in the
            meantime.
          </p>
          <Notice tone="info" title="What you can do instead">
            <p>{info.manualAlternative}</p>
            {context && <p>{context}</p>}
          </Notice>
        </div>
      </div>
    </Card>
  );
}

export function DeleteConfirm({ name, onConfirm, onCancel }: { name: string; onConfirm(): void; onCancel(): void }) {
  return (
    <ConfirmDialog
      title="Delete this investigation?"
      destructive
      confirmLabel="Delete permanently"
      message={
        <>
          <p>
            <strong>{name}</strong> will be removed from local storage. This cannot be undone.
          </p>
          <p className="oc-muted" style={{ fontSize: 12.5, margin: 0 }}>
            If you might want it later, export it as a file first.
          </p>
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/** Format a result summary for storing with an investigation. */
export function useResultSummary(label: string, headline: string | undefined, figures: { label: string; value: string }[], fromSimulation: boolean): ResultSummary | undefined {
  return useMemo(() => {
    if (headline === undefined) return undefined;
    return { label, headline, figures: figures.slice(0, 40), computedAt: new Date().toISOString(), fromSimulation };
  }, [label, headline, figures, fromSimulation]);
}
