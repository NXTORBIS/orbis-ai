import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../state/store';
import { custom, redoCustom, undoCustom, useCustom } from '../../state/custom';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/components';
import { searchSettings, STUDIO_CATEGORIES, type StudioCategory } from '../../../shared/customization/settingsIndex';
import { studio, type EditTarget } from './studioState';
import { PanelBoundary } from '../../ui/PanelBoundary';
import { OverviewSection } from './OverviewSection';
import { AppearanceSection, TypographySection, AccessibilitySection } from './AppearanceSections';
import { ColorsSection } from './ColorsSection';
import { LayoutSection } from './LayoutSection';
import { WorkspacesSection } from './WorkspacesSection';
import { ColumnsSection, ViewsSection } from './ViewSections';
import { NavigationSection } from './NavigationSection';
import { MenusSection, ToolbarSection } from './CommandSections';
import { ShortcutsSection } from './ShortcutsSection';
import { ImportHost, PortabilitySection, PresetsSection, RecoverySection } from './LibrarySections';

/**
 * Customization Studio — a Files tool location (reached from Settings, the
 * sidebar, the title bar, the command palette and Ctrl+Shift+,). Categories
 * are listed on the left with a search that filters the real settings and
 * jumps to them. Edits apply to the actual interface immediately (low-risk)
 * or through preview-and-apply (layouts, presets), and every change can be
 * undone.
 */
export function Studio() {
  const st = useStore(studio, (s) => s);
  const hist = useStore(custom, (s) => ({ canUndo: s.server.canUndo, canRedo: s.server.canRedo, undo: s.server.undoLabel, redo: s.server.redoLabel }));
  const scope = useCustom((r) => ({ preset: r.preset, workspace: r.workspace }));
  const results = useMemo(() => searchSettings(st.query), [st.query]);
  const category = (STUDIO_CATEGORIES.some((c) => c.id === st.category) ? st.category : 'overview') as StudioCategory;
  const cat = STUDIO_CATEGORIES.find((c) => c.id === category)!;
  const visibleCats = st.query.trim() ? STUDIO_CATEGORIES.filter((c) => results.some((r) => r.category === c.id) || c.label.toLowerCase().includes(st.query.trim().toLowerCase())) : STUDIO_CATEGORIES;

  const go = (c: string, setting?: string) => studio.set({ category: c, focusSetting: setting });
  // In a narrow pane the categories are a horizontal strip: keep the current one in view.
  const catsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = catsRef.current;
    const el = strip?.querySelector<HTMLElement>('.studio-cat.is-active');
    if (!strip || !el || strip.scrollWidth <= strip.clientWidth) return;
    const left = el.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 16);
  }, [category]);

  return (
    <div className="studio" data-studio-category={category}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => {
        // A customization file dropped on the Studio opens the import preview (never applied directly).
        const f = e.dataTransfer.files[0];
        const p = f ? window.orbis.getPathForFile?.(f) : undefined;
        if (p && /\.json$/i.test(p)) {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('orbis:import-customization', { detail: { path: p } }));
        }
      }}>
      <div className="studio-nav">
        <div className="studio-search">
          <Icon name="search" size={14} />
          <input type="search" value={st.query} placeholder="Search settings" aria-label="Search customization settings" onChange={(e) => studio.set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) go(results[0].category, results[0].id);
              if (e.key === 'Escape') studio.set({ query: '' });
            }} />
        </div>
        {st.query.trim() && (
          <div className="studio-results" role="list" aria-label="Matching settings">
            {results.slice(0, 12).map((r) => (
              <button key={r.id} type="button" role="listitem" className="studio-result" onClick={() => go(r.category, r.id)}>
                <span>{r.label}</span>
                <span className="muted small">{STUDIO_CATEGORIES.find((c) => c.id === r.category)!.label}</span>
              </button>
            ))}
            {!results.length && <p className="muted small pad">No setting matches “{st.query}”.</p>}
          </div>
        )}
        <nav className="studio-cats" aria-label="Customization categories" ref={catsRef}>
          {visibleCats.map((c) => (
            <button key={c.id} type="button" className={`studio-cat ${c.id === category ? 'is-active' : ''}`} aria-current={c.id === category ? 'page' : undefined} onClick={() => go(c.id)}>
              <Icon name={c.icon} size={15} />
              <span>{c.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <section className="studio-main" aria-labelledby="studio-title">
        <header className="studio-head">
          <div className="min0">
            <h1 id="studio-title">{cat.label}</h1>
            <p className="muted small">{cat.description}</p>
          </div>
          <div className="studio-head-actions">
            <label className="studio-target" title="Where your changes are saved. Automatic writes to the most specific place that already sets the value (a built-in preset is never changed: its values are overridden in the workspace).">
              <span className="muted small">Save changes to</span>
              <select className="input" value={st.target} onChange={(e) => studio.set({ target: e.target.value as EditTarget })} aria-label="Save changes to">
                <option value="auto">Automatic</option>
                <option value="baseline">Your general settings</option>
                <option value="workspace">Workspace “{scope.workspace.name}”</option>
                <option value="preset" disabled={!scope.preset || scope.preset.builtIn}>{scope.preset && !scope.preset.builtIn ? `Preset “${scope.preset.name}”` : 'Preset (built-in presets are read-only)'}</option>
              </select>
            </label>
            <Button size="sm" icon="undo" disabled={!hist.canUndo} title={hist.undo ? `Undo: ${hist.undo}` : 'Nothing to undo'} onClick={() => void undoCustom()}>Undo</Button>
            <Button size="sm" icon="redo" disabled={!hist.canRedo} title={hist.redo ? `Redo: ${hist.redo}` : 'Nothing to redo'} onClick={() => void redoCustom()}>Redo</Button>
          </div>
        </header>
        <div className="studio-body scroll-y">
          <PanelBoundary label={`${cat.label} settings`} resetKey={category}>
            <CategoryBody category={category} />
          </PanelBoundary>
        </div>
      </section>
      <ImportHost />
    </div>
  );
}

function CategoryBody({ category }: { category: StudioCategory }) {
  switch (category) {
    case 'overview': return <OverviewSection />;
    case 'appearance': return <AppearanceSection />;
    case 'colors': return <ColorsSection />;
    case 'typography': return <TypographySection />;
    case 'layout': return <LayoutSection />;
    case 'workspaces': return <WorkspacesSection />;
    case 'views': return <ViewsSection />;
    case 'columns': return <ColumnsSection />;
    case 'navigation': return <NavigationSection />;
    case 'toolbars': return <ToolbarSection />;
    case 'menus': return <MenusSection />;
    case 'shortcuts': return <ShortcutsSection />;
    case 'accessibility': return <AccessibilitySection />;
    case 'presets': return <PresetsSection />;
    case 'portability': return <PortabilitySection />;
    case 'recovery': return <RecoverySection />;
  }
}
