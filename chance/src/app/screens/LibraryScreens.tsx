/**
 * Saved investigations, templates, examples and settings.
 */
import { SAVED_WHERE, STORAGE_DESCRIPTION } from '../../host/where';
import { useMemo, useRef, useState } from 'react';
import { TOOLS, getTool } from '../tools';
import { resolveEntryConfig } from '../tools/lazy';
import { BUILT_IN_TEMPLATES, EXAMPLES, EXAMPLE_CATEGORIES, TEMPLATE_CATEGORIES } from '../../examples/library';
import { Button, Card, Dialog, EmptyState, Notice, NumberField, SelectField, Segmented, TextField, useToast } from '../../ui/primitives';
import { Icon } from '../../ui/icons';
import { useApp } from '../store';
import { DeleteConfirm } from '../shared/ToolShell';
import { downloadSavedInvestigationReport } from '../shared/reportExport';
import type { Investigation, ToolId } from '../../persistence/schema';
import { aiStatus } from '../../ai/registry';
import { AI_CAPABILITIES, AI_CAPABILITY_INFO, AI_CONTRACT_VERSION } from '../../ai/contract';
import { getSimulationClient } from '../../workers/client';

/* --------------------------------------------------------- Saved screen */

type SortKey = 'updated' | 'created' | 'name' | 'tool';

export function SavedScreen() {
  const app = useApp();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [toolFilter, setToolFilter] = useState<ToolId | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [renaming, setRenaming] = useState<Investigation | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<Investigation | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = app.investigations;
    if (toolFilter !== 'all') list = list.filter((i) => i.toolId === toolFilter);
    if (q) list = list.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || getTool(i.toolId).name.toLowerCase().includes(q));
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return b.createdAt.localeCompare(a.createdAt);
        case 'tool':
          return getTool(a.toolId).name.localeCompare(getTool(b.toolId).name) || a.name.localeCompare(b.name);
        default:
          return b.updatedAt.localeCompare(a.updatedAt);
      }
    });
    return sorted;
  }, [app.investigations, query, toolFilter, sort]);

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const outcome = await app.importFile(text);
      setImportWarnings([
        `${outcome.added} investigation(s) imported.`,
        ...(outcome.renamed > 0 ? [`${outcome.renamed} had an identifier that already existed, so they were added as new copies rather than overwriting anything.`] : []),
        ...outcome.warnings,
      ]);
      toast.push('success', `Imported ${outcome.added} investigation(s).`);
    } catch (e) {
      toast.push('error', (e as Error).message);
    }
  };

  const usedTools = [...new Set(app.investigations.map((i) => i.toolId))];

  return (
    <div className="oc-page">
      <div className="oc-page-header">
        <div className="oc-page-header__text">
          <h1>Saved investigations</h1>
          <p className="oc-page-subtitle">
            {app.investigations.length === 0
              ? `Nothing saved yet. Investigations are stored ${SAVED_WHERE} on your own computer.`
              : `${app.investigations.length} investigation(s) stored locally ${SAVED_WHERE}.`}
          </p>
        </div>
        <div className="oc-btn-row">
          <input ref={fileRef} type="file" accept=".json" aria-label="Choose an Orbis Chance export file to import" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ''; }} />
          <Button icon="upload" onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <Button icon="download" onClick={app.exportAll} disabled={app.investigations.length === 0}>
            Export all
          </Button>
        </div>
      </div>

      {importWarnings && <Notice tone="info" title="Import complete" items={importWarnings} />}

      {app.investigations.length > 0 && (
        <div className="oc-toolbar">
          <div className="oc-search">
            <Icon name="search" size={14} />
            <input className="oc-input" placeholder="Search by name, description or tool" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search saved investigations" />
          </div>
          <select className="oc-select" style={{ width: 'auto' }} value={toolFilter} onChange={(e) => setToolFilter(e.target.value as ToolId | 'all')} aria-label="Filter by tool">
            <option value="all">All tools</option>
            {usedTools.map((t) => (
              <option key={t} value={t}>
                {getTool(t).name}
              </option>
            ))}
          </select>
          <select className="oc-select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort investigations">
            <option value="updated">Most recently changed</option>
            <option value="created">Most recently created</option>
            <option value="name">Name</option>
            <option value="tool">Tool</option>
          </select>
        </div>
      )}

      {app.investigations.length === 0 ? (
        <Card>
          <EmptyState icon="saved" title="No saved investigations" action={<Button variant="primary" onClick={() => app.navigate({ kind: 'home' })}>Choose a tool</Button>}>
            Open a tool, set it up and press Save. Everything stays on this computer — there is no account and no server.
          </EmptyState>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState icon="search" title="Nothing matches that search" action={<Button onClick={() => { setQuery(''); setToolFilter('all'); }}>Clear filters</Button>} />
        </Card>
      ) : (
        <Card>
          {filtered.map((inv) => {
            const tool = getTool(inv.toolId);
            return (
              <div key={inv.id} className="oc-list-item">
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                  <Icon name={tool.icon} size={16} />
                </span>
                <button type="button" className="oc-list-item__main" onClick={() => void app.openInvestigation(inv.id)}>
                  <div className="oc-list-item__title">{inv.name}</div>
                  <div className="oc-list-item__meta">
                    {tool.name} · changed {new Date(inv.updatedAt).toLocaleString()}
                    {inv.simulation ? ` · ${inv.simulation.trials.toLocaleString('en-US')} trials, seed ${inv.simulation.seed}` : ''}
                    {inv.resultSummary?.headline ? ` · ${inv.resultSummary.label ?? 'result'} ${inv.resultSummary.headline}` : ''}
                  </div>
                </button>
                <div className="oc-list-item__actions">
                  <Button icon="edit" size="sm" variant="ghost" title={`Rename ${inv.name}`} onClick={() => { setRenaming(inv); setRenameValue(inv.name); }} />
                  <Button icon="copy" size="sm" variant="ghost" title={`Duplicate ${inv.name}`} onClick={() => void app.duplicateInvestigation(inv.id)} />
                  <Button icon="download" size="sm" variant="ghost" title={`Export ${inv.name} as a file`} onClick={() => app.exportOne(inv.id)} />
                  <Button
                    icon="book"
                    size="sm"
                    variant="ghost"
                    title={`Export a report for ${inv.name}`}
                    onClick={() => {
                      try {
                        const filename = downloadSavedInvestigationReport(inv);
                        toast.push(
                          'success',
                          `Report saved as ${filename}. A report exported from here covers the configuration only: open the investigation to include its results.`,
                        );
                      } catch (e) {
                        toast.push('error', `The report could not be built: ${(e as Error).message}`);
                      }
                    }}
                  />
                  <Button icon="trash" size="sm" variant="ghost" title={`Delete ${inv.name}`} onClick={() => setDeleting(inv)} />
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {renaming && (
        <Dialog
          title="Rename investigation"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <Button onClick={() => setRenaming(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!renameValue.trim()}
                onClick={() => {
                  void app.renameInvestigation(renaming.id, renameValue.trim());
                  setRenaming(null);
                }}
              >
                Rename
              </Button>
            </>
          }
        >
          <TextField label="Name" value={renameValue} onChange={setRenameValue} maxLength={200} />
        </Dialog>
      )}

      {deleting && (
        <DeleteConfirm
          name={deleting.name}
          onConfirm={() => {
            void app.deleteInvestigation(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------- Templates screen */

export function TemplatesScreen() {
  const app = useApp();
  const [category, setCategory] = useState<string>('all');
  const [deleting, setDeleting] = useState<string | null>(null);

  const shown = category === 'all' ? BUILT_IN_TEMPLATES : BUILT_IN_TEMPLATES.filter((t) => t.category === category);

  return (
    <div className="oc-page">
      <div className="oc-page-header">
        <div className="oc-page-header__text">
          <h1>Templates</h1>
          <p className="oc-page-subtitle">
            A template opens the right tool with a sensible starting configuration. Each one uses the interaction model suited to its method rather than forcing
            everything through one generic form.
          </p>
        </div>
      </div>

      <div className="oc-toolbar">
        <Segmented label="Filter templates" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All' }, ...TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: c }))]} />
      </div>

      <Card title="Built-in templates">
        <div className="oc-grid oc-grid--tools">
          {shown.map((t) => {
            const tool = getTool(t.toolId);
            return (
              <button
                key={t.id}
                type="button"
                className="oc-tool-card"
                onClick={() => {
                  void resolveEntryConfig(t.toolId, t.configOverride).then((config) => {
                    app.startInvestigation(t.toolId, config, { name: t.name, origin: { kind: 'template', ref: t.id } });
                    app.navigate({ kind: 'tool', toolId: t.toolId });
                  });
                }}
              >
                <span className="oc-tool-card__icon">
                  <Icon name={tool.icon} size={16} />
                </span>
                <span className="oc-tool-card__name">{t.name}</span>
                <p className="oc-tool-card__desc">{t.description}</p>
                <span className="oc-tool-card__tag">
                  {tool.name} · {t.category}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Your templates" hint="Saved from a tool with the template button in its header.">
        {app.templates.length === 0 ? (
          <EmptyState icon="template" title="No templates of your own yet">
            Set a tool up the way you like, then use the template button in the tool header to save that configuration for reuse.
          </EmptyState>
        ) : (
          app.templates.map((t) => {
            const tool = getTool(t.toolId);
            return (
              <div key={t.id} className="oc-list-item">
                <span style={{ color: 'var(--text-muted)' }}>
                  <Icon name={tool.icon} size={16} />
                </span>
                <button
                  type="button"
                  className="oc-list-item__main"
                  onClick={() => {
                    app.startInvestigation(t.toolId, structuredClone(t.config), { name: t.name, simulation: t.simulation, origin: { kind: 'template', ref: t.id } });
                    app.navigate({ kind: 'tool', toolId: t.toolId });
                  }}
                >
                  <div className="oc-list-item__title">{t.name}</div>
                  <div className="oc-list-item__meta">
                    {tool.name} · {t.category} · saved {new Date(t.createdAt).toLocaleDateString()}
                  </div>
                </button>
                <div className="oc-list-item__actions">
                  <Button icon="trash" size="sm" variant="ghost" title={`Delete template ${t.name}`} onClick={() => setDeleting(t.id)} />
                </div>
              </div>
            );
          })
        )}
      </Card>

      {deleting && (
        <Dialog
          title="Delete this template?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  void app.deleteTemplate(deleting);
                  setDeleting(null);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>Investigations already created from this template are not affected.</p>
        </Dialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------ Examples screen */

export function ExamplesScreen() {
  const app = useApp();
  const [category, setCategory] = useState<string>('all');
  const [level, setLevel] = useState<string>('all');

  const shown = EXAMPLES.filter((e) => (category === 'all' || e.category === category) && (level === 'all' || e.level === level));

  return (
    <div className="oc-page">
      <div className="oc-page-header">
        <div className="oc-page-header__text">
          <h1>Worked examples</h1>
          <p className="oc-page-subtitle">
            Each example is a working investigation, not a description of one. Open it and the calculation runs with editable parameters, a results explanation
            and the assumptions it depends on.
          </p>
        </div>
      </div>

      <Notice tone="info" title="About the figures in these examples">
        <p>
          Examples built on dice, coins, cards or defined mathematics use exact values. Those involving a business or engineering situation use illustrative
          figures chosen to demonstrate a method — they are marked as such and are not measurements of any real situation.
        </p>
      </Notice>

      <div className="oc-toolbar">
        <Segmented label="Filter by topic" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All topics' }, ...EXAMPLE_CATEGORIES.map((c) => ({ value: c, label: c }))]} />
        <Segmented
          label="Filter by level"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: 'Any level' },
            { value: 'introductory', label: 'Introductory' },
            { value: 'intermediate', label: 'Intermediate' },
            { value: 'advanced', label: 'Advanced' },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon="search" title="No examples match those filters" action={<Button onClick={() => { setCategory('all'); setLevel('all'); }}>Clear filters</Button>} />
        </Card>
      ) : (
        <div className="oc-grid oc-grid--2">
          {shown.map((ex) => {
            const tool = getTool(ex.toolId);
            return (
              <Card key={ex.id}>
                <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'flex-start' }}>
                  <span className="oc-tool-card__icon" style={{ flexShrink: 0, marginBottom: 0 }}>
                    <Icon name={tool.icon} size={16} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    {/* h2: these cards carry no Card title, so they sit directly under the page h1. */}
                    <h2 style={{ marginBottom: 'var(--s1)', fontSize: 15 }}>{ex.title}</h2>
                    <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: 'var(--s2)' }}>{ex.question}</p>
                    <p style={{ fontSize: 12.5, marginBottom: 'var(--s3)' }}>{ex.description}</p>
                    {ex.assumptions.length > 0 && (
                      <ul className="oc-assumption-list" style={{ fontSize: 12, marginBottom: 'var(--s3)' }}>
                        {ex.assumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    )}
                    <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Button
                        size="sm"
                        variant="primary"
                        icon="play"
                        onClick={() => {
                          void resolveEntryConfig(ex.toolId, ex.configOverride).then((config) => {
                            app.startInvestigation(ex.toolId, config, { name: ex.title, assumptions: ex.assumptions, origin: { kind: 'example', ref: ex.id } });
                            app.updateCurrent({ description: ex.question });
                            app.navigate({ kind: 'tool', toolId: ex.toolId });
                          });
                        }}
                      >
                        Open this example
                      </Button>
                      <span className="oc-badge">{ex.level}</span>
                      {ex.synthetic && <span className="oc-badge oc-badge--assumed">illustrative figures</span>}
                      <span className="oc-muted" style={{ fontSize: 11.5 }}>{tool.name}</span>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------ Settings screen */

export function SettingsScreen() {
  const app = useApp();
  const toast = useToast();
  const [confirmClear, setConfirmClear] = useState(false);
  const ai = aiStatus();
  const client = getSimulationClient();

  return (
    <div className="oc-page">
      <div className="oc-page-header">
        <div className="oc-page-header__text">
          <h1>Settings</h1>
          <p className="oc-page-subtitle">Preferences are stored locally alongside your investigations.</p>
        </div>
      </div>

      <div className="oc-grid oc-grid--2">
        <Card title="Appearance">
          <SelectField
            label="Theme"
            value={app.preferences.theme}
            onChange={(theme) => app.setPreferences({ theme })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'Match the system setting' },
            ]}
          />
          <label className="oc-check">
            <input type="checkbox" checked={app.preferences.reducedMotion} onChange={(e) => app.setPreferences({ reducedMotion: e.target.checked })} />
            <span className="oc-check__text">
              <strong>Reduce motion</strong>
              <span>Removes transitions and animated loading effects. The system setting is also honoured automatically.</span>
            </span>
          </label>
          <label className="oc-check">
            <input type="checkbox" checked={app.preferences.chartTextures} onChange={(e) => app.setPreferences({ chartTextures: e.target.checked })} />
            <span className="oc-check__text">
              <strong>Add patterns to chart fills</strong>
              <span>Distinguishes chart series by texture as well as colour. Useful for colour-vision differences and for printing in black and white.</span>
            </span>
          </label>
        </Card>

        <Card title="Defaults">
          <NumberField
            label="Default number of trials"
            value={app.preferences.defaultTrials}
            onChange={(defaultTrials) => app.setPreferences({ defaultTrials })}
            min={1}
            max={2000000}
            integer
            hint="Used when a new simulation investigation is created."
          />
          <NumberField
            label="Significant digits in results"
            value={app.preferences.significantDigits}
            onChange={(significantDigits) => app.setPreferences({ significantDigits })}
            min={2}
            max={12}
            integer
            hint="Affects how numbers are displayed, not how they are computed — all calculations use full double precision."
          />
        </Card>
      </div>

      <Card title="Your data">
        <dl className="oc-kv">
          <dt>Storage</dt>
          <dd>
            {app.store?.kind === 'indexeddb'
              ? STORAGE_DESCRIPTION
              : 'In memory only — local storage is unavailable in this browsing mode, so work is lost when the tab closes. Use Export to keep a copy.'}
          </dd>
          <dt>Investigations</dt>
          <dd>{app.investigations.length}</dd>
          <dt>Your templates</dt>
          <dd>{app.templates.length}</dd>
          <dt>Simulation</dt>
          <dd>{client.usesWorker ? 'Runs in a background thread, so the interface stays responsive and runs can be cancelled.' : client.fallbackReason}</dd>
        </dl>
        <div className="oc-btn-row" style={{ marginTop: 'var(--s4)' }}>
          <Button icon="download" onClick={app.exportAll} disabled={app.investigations.length === 0}>
            Export everything
          </Button>
          <Button icon="trash" variant="danger" onClick={() => setConfirmClear(true)} disabled={app.investigations.length === 0 && app.templates.length === 0}>
            Delete all local data
          </Button>
        </div>
      </Card>

      <Card title="AI assistance">
        <dl className="oc-kv">
          <dt>Status</dt>
          <dd>{ai.available ? `Provided by ${ai.hostName}.` : 'Not available. Orbis Chance is running independently, with no AI client and no API keys.'}</dd>
          <dt>Contract version</dt>
          <dd>
            <code>{AI_CONTRACT_VERSION}</code>
          </dd>
          <dt>Capabilities defined</dt>
          <dd>{AI_CAPABILITIES.length}</dd>
          <dt>Capabilities available</dt>
          <dd>{ai.capabilities.length}</dd>
        </dl>
        <Notice tone="info" title="How integration will work">
          <p>
            A future version of the Orbis application can supply an adapter implementing the documented contract. Orbis Chance then routes AI requests to it
            without knowing which provider is behind it, and never holds a credential of its own.
          </p>
          <p>
            Even with an adapter attached, AI output is treated as a suggestion about what to compute. Every number shown as a result is produced by the
            mathematical engine, and a suggested model is validated before it is used.
          </p>
        </Notice>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--text-secondary)' }}>The nine capabilities and their manual alternatives</summary>
          <ul className="oc-assumption-list" style={{ marginTop: 'var(--s3)' }}>
            {AI_CAPABILITIES.map((c) => (
              <li key={c}>
                <strong>{AI_CAPABILITY_INFO[c].label}</strong> — {AI_CAPABILITY_INFO[c].description}
                <br />
                <span className="oc-muted">Without AI: {AI_CAPABILITY_INFO[c].manualAlternative}</span>
              </li>
            ))}
          </ul>
        </details>
      </Card>

      <Card title="About">
        <dl className="oc-kv">
          <dt>Application</dt>
          <dd>Orbis Chance 1.0.0 — an independent probability, simulation and uncertainty exploration platform.</dd>
          <dt>Tools implemented</dt>
          <dd>{TOOLS.length}</dd>
          <dt>Distributions</dt>
          <dd>20, each validated against independently computed reference values.</dd>
          <dt>Worked examples</dt>
          <dd>{EXAMPLES.length}</dd>
          <dt>Default configurations</dt>
          <dd>{TOOLS.length} — one per tool.</dd>
        </dl>
      </Card>

      {confirmClear && (
        <Dialog
          title="Delete all local data?"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  void (async () => {
                    await app.store?.clearAll();
                    await app.refresh();
                    toast.push('success', 'All local investigations and templates have been deleted.');
                  })();
                  setConfirmClear(false);
                }}
              >
                Delete everything
              </Button>
            </>
          }
        >
          <p>
            This removes all {app.investigations.length} saved investigation(s) and {app.templates.length} template(s) from this browser. It cannot be undone.
          </p>
          <p className="oc-muted" style={{ fontSize: 12.5 }}>
            Export first if you might want any of them later.
          </p>
        </Dialog>
      )}
    </div>
  );
}
