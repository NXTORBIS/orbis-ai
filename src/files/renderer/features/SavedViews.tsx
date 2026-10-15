import { prompt, toast } from '../state/app';
import { updatePane, findPane, type Pane } from '../state/workspace';
import { applyCustom, custom, resolvedNow } from '../state/custom';

/**
 * Saved views: a named combination of view mode, columns (order, widths,
 * visibility, pins), sorting (with further keys), grouping, thumbnail and
 * icon size, density, preview visibility and the quick filter. Applying one
 * changes only how the pane presents the folder it already shows.
 */

export async function saveCurrentView(pane: Pane): Promise<void> {
  const name = await prompt({ title: 'Save view', label: 'Name', initial: viewName(pane), confirmLabel: 'Save view' });
  if (!name) return;
  const r = resolvedNow();
  const ok = await applyCustom({
    op: 'saveView',
    view: {
      name,
      view: pane.view,
      columns: r.view.columns,
      sort: pane.sort,
      thenBy: pane.thenBy,
      groupBy: pane.groupBy,
      iconSize: r.appearance.iconSize,
      thumbnailSize: r.appearance.thumbnailSize,
      density: r.appearance.density,
      previewVisible: r.layout.details.visible,
      filter: pane.filter.slice(0, 200),
    },
  });
  if (ok) toast({ level: 'success', title: `Saved view “${name}”`, detail: 'Find it under the toolbar’s Saved views menu or in Customization → File views.' });
}

export async function applySavedView(pane: Pane, id: string): Promise<void> {
  const v = custom.get().server.config.savedViews.find((x) => x.id === id);
  if (!v) return;
  // Configuration parts (columns, sizes, density, preview) as one undoable change; the pane's own view state directly.
  if (!(await applyCustom({ op: 'applyView', id }, { quiet: true }))) return;
  if (findPane(pane.id)) updatePane(pane.id, { view: v.view, sort: { ...v.sort }, thenBy: v.thenBy.map((t) => ({ ...t })), groupBy: v.groupBy, filter: v.filter });
}

function viewName(p: Pane): string {
  const mode = { details: 'Details', list: 'List', compact: 'Compact', grid: 'Icons', thumbnails: 'Thumbnails', gallery: 'Gallery', columns: 'Columns', tree: 'Tree' }[p.view];
  return `${mode} by ${p.sort.key}`;
}
