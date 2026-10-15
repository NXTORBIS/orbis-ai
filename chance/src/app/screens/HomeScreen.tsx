/**
 * Home: start an investigation, reopen a recent one, or browse tools,
 * templates and worked examples.
 */
import { SAVED_WHERE } from '../../host/where';
import { useMemo, useState } from 'react';
import { resolveEntryConfig } from '../tools/lazy';
import { TOOLS, TOOL_CATEGORIES, type ToolCategory } from '../tools';
import { EXAMPLES } from '../../examples/library';
import { Button, Card, EmptyState, Notice, Segmented } from '../../ui/primitives';
import { matchTools } from '../search';
import { Icon } from '../../ui/icons';
import { useApp } from '../store';
import { aiStatus } from '../../ai/registry';

export function HomeScreen() {
  const app = useApp();
  const [category, setCategory] = useState<ToolCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const ai = aiStatus();

  const recent = useMemo(
    () => app.recentIds.map((id) => app.investigations.find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => Boolean(i)).slice(0, 4),
    [app.recentIds, app.investigations],
  );

  // The same matcher the command palette uses, so a method name typed here
  // finds the same tool, in the same order. With no query the grid keeps its
  // catalogue order; with one it is ranked by the match.
  const shownTools = useMemo(() => {
    const byCategory = category === 'all' ? TOOLS : TOOLS.filter((t) => t.category === category);
    if (!query.trim()) return byCategory.map((tool) => ({ tool, reason: null as string | null }));
    const allowed = new Set(byCategory.map((t) => t.id));
    return matchTools(query)
      .filter((m) => allowed.has(m.tool.id))
      .map((m) => ({ tool: m.tool, reason: m.reason }));
  }, [category, query]);
  const featuredExamples = EXAMPLES.filter((e) => e.level === 'introductory').slice(0, 4);

  // Navigate and let the tool screen create the investigation. It already
  // does exactly that when none is open for the tool, and it owns loading the
  // default configuration now that defaults arrive with the screen's chunk.
  // Creating one here too would duplicate that logic and race with it — and
  // going through the screen also means an unsaved draft for this tool is
  // resumed rather than discarded, which is what happens from every other
  // route into a tool.
  const startTool = (toolId: (typeof TOOLS)[number]['id']) => {
    app.navigate({ kind: 'tool', toolId });
  };

  return (
    <div className="oc-page">
      <div className="oc-page-header">
        <div className="oc-page-header__text">
          <h1>Orbis Chance</h1>
          <p className="oc-page-subtitle">
            Work out how likely something is, how uncertain an estimate is, and what happens when an assumption changes. Every result comes with the method,
            the formula, the assumptions it depends on and the limits of what it can tell you.
          </p>
        </div>
      </div>

      {app.storageWarning && <Notice tone="warning" title="Saving is limited in this browsing mode">{app.storageWarning}</Notice>}

      {app.investigations.length === 0 && (
        <Card variant="raised">
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--s4)', alignItems: 'start' }}>
            <span style={{ color: 'var(--accent)', background: 'var(--accent-dim)', padding: 'var(--s3)', borderRadius: 'var(--radius)', display: 'grid', placeItems: 'center' }}>
              <Icon name="sparkles" size={22} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ marginBottom: 'var(--s2)' }}>Starting from scratch</h2>
              <p style={{ fontSize: 13, marginBottom: 'var(--s3)' }}>
                Nothing here needs an account, a connection or a key. All fourteen tools work offline once the page has loaded, and your investigations are saved
                {SAVED_WHERE} on your own computer.
              </p>
              <p style={{ fontSize: 13, marginBottom: 'var(--s3)' }}>
                A good place to begin is a worked example: each one is a real, running calculation whose parameters you can change.
              </p>
              <div className="oc-btn-row">
                <Button variant="primary" icon="book" onClick={() => app.navigate({ kind: 'examples' })}>
                  Browse worked examples
                </Button>
                <Button icon="template" onClick={() => app.navigate({ kind: 'templates' })}>
                  Start from a template
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {recent.length > 0 && (
        <Card title="Continue where you left off" actions={<Button size="sm" variant="ghost" onClick={() => app.navigate({ kind: 'saved' })}>All saved</Button>}>
          <div className="oc-grid oc-grid--3">
            {recent.map((inv) => {
              const tool = TOOLS.find((t) => t.id === inv.toolId);
              return (
                <button key={inv.id} type="button" className="oc-tool-card" onClick={() => void app.openInvestigation(inv.id)}>
                  <span className="oc-tool-card__icon">
                    <Icon name={tool?.icon ?? 'saved'} size={16} />
                  </span>
                  <span className="oc-tool-card__name">{inv.name}</span>
                  <p className="oc-tool-card__desc">{inv.description || tool?.summary}</p>
                  <span className="oc-tool-card__tag">
                    {tool?.name} · changed {new Date(inv.updatedAt).toLocaleDateString()}
                    {inv.resultSummary?.headline ? ` · last result ${inv.resultSummary.headline}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <Card
        title="Tools"
        hint="Each one implements a specific set of methods and states what it assumes."
        actions={
          <Segmented
            label="Filter tools by category"
            value={category}
            onChange={(c) => setCategory(c as ToolCategory | 'all')}
            options={[{ value: 'all', label: 'All' }, ...TOOL_CATEGORIES.map((c) => ({ value: c, label: c }))]}
          />
        }
      >
        <div className="oc-toolbar">
          <div className="oc-search">
            <Icon name="search" size={14} />
            <input
              className="oc-input"
              placeholder="Search by name, method or question — try “expected shortfall”"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search tools by name, method or question"
            />
          </div>
          {query.trim() && (
            <Button size="sm" variant="ghost" icon="x" onClick={() => setQuery('')}>
              Clear
            </Button>
          )}
          <span className="oc-muted" style={{ fontSize: 11.5 }} aria-live="polite">
            {query.trim() ? `${shownTools.length} of ${TOOLS.length} tools match` : `${shownTools.length} tools`}
          </span>
        </div>
        <div className="oc-grid oc-grid--tools">
          {shownTools.map(({ tool, reason }) => (
            <button key={tool.id} type="button" className="oc-tool-card" onClick={() => startTool(tool.id)}>
              <span className="oc-tool-card__icon">
                <Icon name={tool.icon} size={16} />
              </span>
              <span className="oc-tool-card__name">{tool.name}</span>
              <p className="oc-tool-card__desc">{reason ?? tool.summary}</p>
              <span className="oc-tool-card__tag">
                {tool.category}
                {tool.usesSimulation ? ' · runs simulations' : ' · exact calculation'}
              </span>
            </button>
          ))}
        </div>
        {shownTools.length === 0 && (
          <EmptyState title={query.trim() ? `No tool matches “${query.trim()}”` : 'No tools in this category'}>
            {query.trim() ? <p style={{ fontSize: 12.5 }}>Try a method name, or press Ctrl+K to search investigations and examples as well.</p> : undefined}
          </EmptyState>
        )}
      </Card>

      <Card title="Worked examples" hint="Real calculations you can open and change." actions={<Button size="sm" variant="ghost" onClick={() => app.navigate({ kind: 'examples' })}>See all {EXAMPLES.length}</Button>}>
        <div className="oc-grid oc-grid--2">
          {featuredExamples.map((ex) => (
            <button
              key={ex.id}
              type="button"
              className="oc-tool-card"
              onClick={() => {
                void resolveEntryConfig(ex.toolId, ex.configOverride).then((config) => {
                  app.startInvestigation(ex.toolId, config, { name: ex.title, assumptions: ex.assumptions, origin: { kind: 'example', ref: ex.id } });
                  app.updateCurrent({ description: ex.question });
                  app.navigate({ kind: 'tool', toolId: ex.toolId });
                });
              }}
            >
              <span className="oc-tool-card__name">{ex.title}</span>
              <p className="oc-tool-card__desc">{ex.question}</p>
              <span className="oc-tool-card__tag">
                {ex.category} · {ex.level}
                {ex.synthetic ? ' · illustrative figures' : ''}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <div className="oc-grid oc-grid--2">
        <Card title="What works without a connection">
          <ul className="oc-assumption-list" style={{ fontSize: 12.5 }}>
            <li>
              <strong>Everything the tools compute.</strong> All probability, distribution, simulation, statistical and Markov calculations run in your browser.
            </li>
            <li>
              <strong>Saving and reopening investigations.</strong> Stored locally {SAVED_WHERE}, not on a server.
            </li>
            <li>
              <strong>Importing and exporting files.</strong> Datasets and investigation files are read and written on your own computer.
            </li>
            <li>
              <strong>Worked examples and templates.</strong> Included in the application.
            </li>
          </ul>
        </Card>
        <Card title="What is not here yet">
          <p style={{ fontSize: 12.5 }}>
            {ai.available
              ? `AI assistance is being provided by ${ai.hostName}. It can suggest a method or help interpret a result, but it never supplies a number: every figure you see is computed by the mathematical engine.`
              : 'AI assistance — describing a question in plain language, suggesting a method, or explaining a result conversationally. Orbis Chance contains no AI client and no API keys, so these features become available only after it is integrated with the Orbis application and that host supplies its AI adapter.'}
          </p>
          <p style={{ fontSize: 12.5, margin: 0 }} className="oc-muted">
            Nothing is sent anywhere in the meantime, and every tool works fully without it. Where an AI feature would appear, the manual route to the same
            outcome is given instead.
          </p>
        </Card>
      </div>
    </div>
  );
}
