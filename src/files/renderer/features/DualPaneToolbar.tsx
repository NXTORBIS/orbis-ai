import React from 'react';
import { useStore } from '../state/store';
import { dualPane, copyToOther, moveToOther, newFolderInActive, deleteSelected, toggleSyncNav, switchPane } from '../state/dualPane';
import { Icon } from '../ui/Icon';

/**
 * Toolbar strip shown between the two panes when dual-pane mode is active.
 * F5 Copy, F6 Move, F7 New folder, F8 Delete, plus a sync-navigation toggle.
 */
export function DualPaneToolbar(): React.ReactElement | null {
  const { active, syncNav } = useStore(dualPane, (s) => s);
  if (!active) return null;

  return (
    <div className="dp-toolbar" role="toolbar" aria-label="Dual-pane actions">
      <button className="dp-btn" onClick={copyToOther} title="Copy to other pane (F5)">
        <Icon name="copy" size={14} />
        <span className="dp-label">F5 Copy</span>
      </button>
      <button className="dp-btn" onClick={moveToOther} title="Move to other pane (F6)">
        <Icon name="move" size={14} />
        <span className="dp-label">F6 Move</span>
      </button>
      <button className="dp-btn" onClick={newFolderInActive} title="New folder (F7)">
        <Icon name="newFolder" size={14} />
        <span className="dp-label">F7 Folder</span>
      </button>
      <button className="dp-btn dp-btn-destructive" onClick={deleteSelected} title="Delete (F8)">
        <Icon name="trash" size={14} />
        <span className="dp-label">F8 Delete</span>
      </button>
      <div className="dp-spacer" />
      <button className="dp-btn" onClick={switchPane} title="Switch pane (Tab)">
        <Icon name="swap" size={14} />
        <span className="dp-label">Tab</span>
      </button>
      <button
        className={`dp-btn${syncNav ? ' dp-btn-active' : ''}`}
        onClick={toggleSyncNav}
        title={syncNav ? 'Sync navigation on' : 'Sync navigation off'}
        aria-pressed={syncNav}
      >
        <Icon name="link" size={14} />
        <span className="dp-label">Sync</span>
      </button>
    </div>
  );
}
