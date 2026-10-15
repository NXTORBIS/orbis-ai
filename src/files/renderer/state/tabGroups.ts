/**
 * Tab group session management: save and restore tab group arrangements.
 */
import { call } from '../api';
import { ws, createGroup } from './workspace';
import type { TabGroupSession, SavedTabGroup } from '../../shared/tabGroups';
import { MAX_TAB_GROUP_SESSIONS, TAB_GROUP_COLORS } from '../../shared/tabGroups';
import { createStore } from './store';

export interface TabGroupSessionsState {
  sessions: TabGroupSession[];
  loaded: boolean;
}

export const tabGroupSessions = createStore<TabGroupSessionsState>({ sessions: [], loaded: false });

/** Load saved tab group sessions from the catalogue KV store. */
export async function loadTabGroupSessions(): Promise<void> {
  try {
    await call<TabGroupSession[] | null>('cat:session');
    // Sessions are stored locally in renderer state for now
    tabGroupSessions.set({ sessions: tabGroupSessions.get().sessions, loaded: true });
  } catch {
    tabGroupSessions.set({ sessions: [], loaded: true });
  }
}

/** Save the current tab groups as a named session. */
export function saveTabGroupSession(name: string): TabGroupSession {
  const s = ws.get();
  const groups: SavedTabGroup[] = s.groups.map((g) => ({
    name: g.name,
    color: g.color,
    collapsed: g.collapsed,
    tabs: s.tabs
      .filter((t) => t.groupId === g.id)
      .map((t) => ({
        location: JSON.stringify(t.panes[0]?.history[t.panes[0]?.index ?? 0]),
        pinned: t.pinned,
      })),
  }));

  const session: TabGroupSession = {
    id: `tgs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdMs: Date.now(),
    groups,
  };

  tabGroupSessions.set((prev) => {
    const next = [session, ...prev.sessions].slice(0, MAX_TAB_GROUP_SESSIONS);
    return { ...prev, sessions: next };
  });

  return session;
}

/** Delete a saved tab group session. */
export function deleteTabGroupSession(id: string): void {
  tabGroupSessions.set((prev) => ({
    ...prev,
    sessions: prev.sessions.filter((s) => s.id !== id),
  }));
}

/** Restore a saved tab group session by creating groups and populating tabs. */
export function restoreTabGroupSession(session: TabGroupSession): void {
  for (const group of session.groups) {
    const tabIds: string[] = [];
    const s = ws.get();
    // Find ungrouped tabs to assign, or the first available tabs
    for (const _entry of group.tabs) {
      const freeTab = s.tabs.find((t) => !t.groupId && !tabIds.includes(t.id));
      if (freeTab) tabIds.push(freeTab.id);
    }
    if (tabIds.length > 0) {
      createGroup(tabIds, group.name);
      // Apply the saved color
      const latest = ws.get();
      const created = latest.groups[latest.groups.length - 1];
      if (created) {
        ws.set((st) => ({
          groups: st.groups.map((g) =>
            g.id === created.id ? { ...g, color: group.color, collapsed: group.collapsed } : g,
          ),
        }));
      }
    }
  }
}

/** Set the color of a tab group. */
export function setGroupColor(groupId: string, color: string): void {
  ws.set((s) => ({
    groups: s.groups.map((g) => (g.id === groupId ? { ...g, color } : g)),
  }));
}

export { TAB_GROUP_COLORS };
