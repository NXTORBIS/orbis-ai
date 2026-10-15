import { createStore } from '../../state/store';
import { activePane, findPane, navigate } from '../../state/workspace';

/** Which Customization Studio category is shown, and which setting to bring into view. */
export type EditTarget = 'auto' | 'baseline' | 'preset' | 'workspace';

export const studio = createStore<{ category: string; focusSetting?: string; query: string; target: EditTarget }>({ category: 'overview', query: '', target: 'auto' });

/**
 * Open the Customization Studio through the normal navigation (it is a tool
 * location in the pane, like Settings), optionally at a category and setting.
 */
export function openStudio(category?: string, setting?: string, paneId?: string): void {
  if (category) studio.set({ category, focusSetting: setting, query: '' });
  const pane = (paneId && findPane(paneId)?.pane) || activePane();
  void navigate(pane.id, { kind: 'tool', tool: 'customize' });
}
