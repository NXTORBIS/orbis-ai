import { useState } from 'react';
import { app, toastError } from '../state/app';
import { useStore } from '../state/store';
import { activePane, findPane, selectedEntries, ws } from '../state/workspace';
import { call } from '../api';
import { Icon } from '../ui/Icon';

/**
 * Banner shown while the Orbis app is waiting for the user to choose files or
 * folders (host contract 1.1 pick-file). The user browses normally, selects,
 * and presses Choose; the answer is written to the reply file the Orbis app
 * named. Cancel answers "cancelled". Nothing is chosen automatically.
 */
export function HostPickBanner() {
  const picks = useStore(app, (s) => s.hostPicks);
  // Re-render when the active pane or its selection changes.
  const sel = useStore(ws, () => {
    const p = activePane();
    return `${p.id}|${p.selection.join('\n')}`;
  });
  const [busy, setBusy] = useState(false);
  const pick = picks[0];
  if (!pick) return null;
  void sel;
  const pane = activePane();
  const chosen = findPane(pane.id) ? selectedEntries(pane.id) : [];
  const fits = chosen.filter((e) => pick.kinds === 'both' || (pick.kinds === 'folders' ? e.kind === 'directory' : e.kind === 'file'));
  const wrongKind = chosen.length - fits.length;
  const tooMany = !pick.multiple && fits.length > 1;
  const what = pick.kinds === 'folders' ? (pick.multiple ? 'folders' : 'a folder') : pick.kinds === 'both' ? (pick.multiple ? 'files or folders' : 'a file or folder') : pick.multiple ? 'files' : 'a file';
  const answer = async (paths: string[] | null) => {
    setBusy(true);
    try {
      await call('host:pickReply', { token: pick.token, paths });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const hint = tooMany
    ? 'Only one item can be chosen.'
    : wrongKind > 0
      ? `${wrongKind} selected item${wrongKind === 1 ? ' is' : 's are'} not ${pick.kinds === 'folders' ? 'a folder' : 'a file'} and will be ignored.`
      : fits.length
        ? fits.map((e) => e.name).join(', ')
        : `Select ${what} in the file view, then choose Choose.`;
  return (
    <div className="pick-bar" role="region" aria-label="Request from the Orbis app">
      <Icon name="ask" size={16} />
      <div className="pick-text">
        <strong>{pick.title || `The Orbis app asks you to choose ${what}`}</strong>
        <span className="muted" title={hint}>{hint}</span>
      </div>
      {picks.length > 1 && <span className="pill">{picks.length - 1} more waiting</span>}
      <button type="button" className="btn btn-default btn-sm" disabled={busy} onClick={() => void answer(null)}>Cancel</button>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy || !fits.length || tooMany} onClick={() => void answer(fits.map((e) => e.path))}>
        Choose{fits.length > 1 ? ` ${fits.length}` : ''}
      </button>
    </div>
  );
}
