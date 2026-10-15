import { useEffect, useMemo, useState } from 'react';
import { ToolHeader } from '../shared';
import ToolActions from './ToolActions';
import { readShareState, useStoredState, useToolHistory } from './hooks';

/**
 * Wraps a tool with the shared visuals (animated aurora, entrance motion, glass depth)
 * and gives it presets, result history, export and share links without any per-tool wiring
 * beyond the state it wants remembered.
 */
export default function ToolShell({
  toolId,
  icon,
  title,
  desc,
  state,
  onRestore,
  onReset,
  exportText,
  exportName,
  exportMime,
  children,
}) {
  const presets = useStoredState(`tk:${toolId}:presets`, []);
  const history = useToolHistory(`tk:${toolId}`);
  const [restored, setRestored] = useState(false);
  const [nonce, setNonce] = useState(0);

  // A shared link carries the whole setup, so restore it once on mount.
  useEffect(() => {
    const shared = readShareState();
    if (shared && onRestore) {
      onRestore(shared);
      setRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signature = useMemo(() => JSON.stringify(state ?? null), [state]);

  // Every settled change becomes a history entry you can jump back to.
  useEffect(() => {
    if (!state) return undefined;
    const id = setTimeout(() => {
      history.push({ state, preview: String(exportText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) });
    }, 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const actions = (
    <ToolActions
      toolId={toolId}
      onReload={() => { onReset?.(); setNonce((n) => n + 1); }}
      state={state}
      onRestore={onRestore}
      exportText={exportText}
      exportName={exportName}
      exportMime={exportMime}
      history={history}
      presets={presets[0]}
      setPresets={presets[1]}
    />
  );

  return (
    <div className="tk-frame tk-shell space-y-4 overflow-hidden rounded-2xl p-4 sm:p-6">
      <div aria-hidden className="tk-aurora" />
      <div aria-hidden className="tk-grain" />
      <div className="tk-rise space-y-4">
        <ToolHeader icon={icon} title={title} desc={desc} actions={actions} />
        {restored && (
          <div className="rounded-lg border border-cyan-j/40 bg-cyan-j/10 px-3 py-2 text-[11px] text-cyan-j">
            Loaded the setup that came with this link.
          </div>
        )}
        <div key={nonce} className="space-y-4">{children}</div>
      </div>
    </div>
  );
}