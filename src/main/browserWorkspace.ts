import { nearestGroupColor } from './chromium/chromiumCapabilities2.ts'

export interface WorkspaceTabWanted {
  url: string
  title?: string
  pinned?: boolean
  group?: string
  active?: boolean
}
export interface WorkspaceGroupWanted {
  name?: string
  color?: string
  collapsed?: boolean
}

/**
 * Opens a saved workspace in the Orbis browser (Chromium), through its extension: each page is opened (a page that is already open is
 * kept as it is, so switching back does not reload everything), pinned and grouped as saved, the pages that are not part of it are closed
 * when `replace` is set (private windows are never touched), and the workspace's active page is brought to the front.
 */
export function openWorkspaceScript(tabs: WorkspaceTabWanted[], groups: WorkspaceGroupWanted[], replace: boolean): string {
  const wanted = tabs.map((t) => ({ url: t.url, pinned: t.pinned === true, group: typeof t.group === 'string' && t.group ? t.group : null, active: t.active === true }))
  const details = groups.map((g) => ({ name: g.name ?? '', color: nearestGroupColor(String(g.color ?? '')), collapsed: g.collapsed === true }))
  return `(async (wanted, details, replace) => {
    const before = await chrome.tabs.query({});
    const last = await chrome.windows.getLastFocused().catch(() => null);
    const windowId = last && !last.incognito ? last.id : (before.find((t) => !t.incognito) || {}).windowId;
    const open = new Map();
    for (const t of before) if (!t.incognito && !open.has(t.url)) open.set(t.url, t);
    const used = [];
    const made = new Map();
    for (const want of wanted) {
      let tab = open.get(want.url);
      if (!tab || used.includes(tab.id)) tab = await chrome.tabs.create({ url: want.url, active: false, pinned: want.pinned, windowId });
      else if (want.pinned && !tab.pinned) await chrome.tabs.update(tab.id, { pinned: true });
      used.push(tab.id);
      if (want.group) {
        let gid = made.get(want.group);
        if (gid === undefined) {
          const d = details.find((g) => g.name === want.group) || {};
          gid = await chrome.tabs.group({ tabIds: [tab.id] });
          await chrome.tabGroups.update(gid, { title: want.group, color: d.color || 'blue' });
          made.set(want.group, gid);
        } else await chrome.tabs.group({ tabIds: [tab.id], groupId: gid });
      }
    }
    const front = wanted.findIndex((w) => w.active);
    const focus = used[front >= 0 ? front : 0];
    if (replace) {
      const extra = before.filter((t) => !t.incognito && !used.includes(t.id)).map((t) => t.id);
      if (extra.length) await chrome.tabs.remove(extra);
    }
    await chrome.tabs.update(focus, { active: true });
    for (const [name, gid] of made) {
      const d = details.find((g) => g.name === name);
      const holdsFocus = (await chrome.tabs.get(focus)).groupId === gid;
      if (d && d.collapsed && !holdsFocus) await chrome.tabGroups.update(gid, { collapsed: true });
    }
    return { tabIds: used.map(String), groups: [...made.keys()] };
  })(${JSON.stringify(wanted)}, ${JSON.stringify(details)}, ${replace ? 'true' : 'false'})`
}
