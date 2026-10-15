import React, { useState } from 'react';
import { useStore } from '../state/store';
import { ws, toggleGroup } from '../state/workspace';
import { prompt } from '../state/app';
import { Icon } from '../ui/Icon';
import {
  tabGroupSessions, saveTabGroupSession, deleteTabGroupSession, restoreTabGroupSession,
  setGroupColor, TAB_GROUP_COLORS,
} from '../state/tabGroups';

/**
 * Color picker for tab groups — a small popover of swatches.
 */
export function GroupColorPicker({ groupId, currentColor, onClose }: { groupId: string; currentColor: string; onClose: () => void }) {
  return (
    <div className="tab-group-color-picker" onClick={(e) => e.stopPropagation()}>
      {TAB_GROUP_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`tab-group-color-swatch ${c === currentColor ? 'active' : ''}`}
          style={{ background: c }}
          aria-label={`Color ${c}`}
          onClick={() => { setGroupColor(groupId, c); onClose(); }}
        />
      ))}
    </div>
  );
}

/**
 * Tab group session manager panel — save and restore tab group sessions.
 */
export function TabGroupSessionManager({ onClose }: { onClose: () => void }) {
  const sessions = useStore(tabGroupSessions, (s) => s.sessions);
  const groups = useStore(ws, (s) => s.groups);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!groups.length) return;
    const name = await prompt({ title: 'Save tab group session', label: 'Session name', initial: `Session ${sessions.length + 1}`, confirmLabel: 'Save' });
    if (name) {
      saveTabGroupSession(name);
      setSaving(true);
      setTimeout(() => setSaving(false), 1500);
    }
  };

  return (
    <div className="tab-group-sessions">
      <div className="tab-group-sessions-header">
        <h3>Tab Group Sessions</h3>
        <button type="button" className="btn btn-default btn-sm" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="tab-group-sessions-actions">
        <button type="button" className="btn btn-accent btn-sm" onClick={handleSave} disabled={!groups.length}>
          <Icon name="save" size={14} /> <span>{saving ? 'Saved!' : 'Save current'}</span>
        </button>
      </div>
      {sessions.length === 0 ? (
        <p className="tab-group-sessions-empty">No saved sessions. Group some tabs and save a session to restore later.</p>
      ) : (
        <ul className="tab-group-sessions-list">
          {sessions.map((sess) => (
            <li key={sess.id} className="tab-group-session-item">
              <div className="tab-group-session-info">
                <span className="tab-group-session-name">{sess.name}</span>
                <span className="tab-group-session-meta">
                  {sess.groups.length} group{sess.groups.length !== 1 ? 's' : ''} &middot; {new Date(sess.createdMs).toLocaleDateString()}
                </span>
              </div>
              <div className="tab-group-session-actions">
                <button type="button" className="btn btn-default btn-sm" onClick={() => restoreTabGroupSession(sess)} title="Restore session">
                  <Icon name="restore" size={14} />
                </button>
                <button type="button" className="btn btn-default btn-sm" onClick={() => deleteTabGroupSession(sess.id)} title="Delete session">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Enhanced tab group chip that shows in the tab bar, with drag support
 * and color-coding.
 */
export function TabGroupChip({
  group,
  onContextMenu,
}: {
  group: { id: string; name: string; color: string; collapsed: boolean };
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);

  return (
    <div className="tab-group-chip-wrapper" style={{ position: 'relative' }}>
      <button
        type="button"
        className={`tab-group-chip no-drag ${group.collapsed ? 'collapsed' : ''}`}
        style={{ '--group': group.color } as React.CSSProperties}
        onClick={() => toggleGroup(group.id)}
        onContextMenu={onContextMenu}
        onDoubleClick={(e) => { e.preventDefault(); setShowColorPicker((v) => !v); }}
        title={`${group.name} — click to ${group.collapsed ? 'expand' : 'collapse'}, double-click to change color`}
      >
        <span className="tab-group-chip-label">{group.name}</span>
        <span className="tab-group-chip-dot" style={{ background: group.color }} />
      </button>
      {showColorPicker && (
        <GroupColorPicker
          groupId={group.id}
          currentColor={group.color}
          onClose={() => setShowColorPicker(false)}
        />
      )}
    </div>
  );
}
