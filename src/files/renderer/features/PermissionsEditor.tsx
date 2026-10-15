import { useEffect, useState } from 'react';
import { call } from '../api';
import { closeDialog, toast, toastError } from '../state/app';
import type { PermissionInfo } from '../../main/tools/permissionsEditor';
import { permissionString } from '../../shared/permissions';
import type { FileEntry } from '../../shared/model';

interface Props {
  entry: FileEntry;
  onDone?: () => void;
}

const WHO = ['Owner', 'Group', 'Others'] as const;
const BITS = ['Read', 'Write', 'Execute'] as const;
const SHIFTS = [6, 3, 0];
const BIT_VALS = [4, 2, 1];

export function PermissionsEditorDialog({ entry, onDone }: Props) {
  const [info, setInfo] = useState<PermissionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState(0);
  const [octalInput, setOctalInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recursive, setRecursive] = useState(false);

  useEffect(() => {
    void call<PermissionInfo>('perm:get', { path: entry.path }).then((p) => {
      setInfo(p);
      setMode(p.mode);
      setOctalInput(p.mode.toString(8).padStart(4, '0'));
    }, (e: Error) => setError(e.message));
  }, [entry.path]);

  const toggleBit = (shift: number, bit: number) => {
    const mask = bit << shift;
    const newMode = mode & mask ? mode & ~mask : mode | mask;
    setMode(newMode);
    setOctalInput(newMode.toString(8).padStart(4, '0'));
  };

  const toggleSpecial = (bit: number) => {
    const newMode = mode & bit ? mode & ~bit : mode | bit;
    setMode(newMode);
    setOctalInput(newMode.toString(8).padStart(4, '0'));
  };

  const handleOctalChange = (val: string) => {
    setOctalInput(val);
    const parsed = parseInt(val, 8);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 0o7777 && /^[0-7]{1,4}$/.test(val)) {
      setMode(parsed);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      if (recursive && entry.kind === 'directory') {
        await call('perm:setRecursive', { path: entry.path, mode });
        toast({ level: 'success', title: `Permissions set recursively to ${mode.toString(8).padStart(3, '0')}` });
      } else {
        await call('perm:set', { path: entry.path, mode });
        toast({ level: 'success', title: `Permissions changed to ${permissionString(mode, entry.kind)}` });
      }
      onDone?.();
      closeDialog();
    } catch (e) {
      toastError(e as Error);
    }
    setBusy(false);
  };

  const isDir = entry.kind === 'directory';
  const changed = info !== null && mode !== info.mode;
  const typeLabel = isDir ? 'directory' : entry.kind === 'symlink' ? 'symlink' : 'file';

  return (
    <div className="permissions-editor">
      <div className="perm-editor-header">
        <h2>Permissions — {entry.name}</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={closeDialog} aria-label="Close">&times;</button>
      </div>

      {error ? <p className="error-text">{error}</p> : !info ? <p className="muted">Loading…</p> : (
        <>
          {/* Owner/Group info */}
          <div className="perm-owner-info">
            <dl className="props">
              <dt>Owner</dt><dd>{info.owner} ({info.uid})</dd>
              <dt>Group</dt><dd>{info.group} ({info.gid})</dd>
              <dt>Type</dt><dd>{typeLabel}</dd>
              <dt>Inode</dt><dd className="tabular">{info.inode}</dd>
              <dt>Links</dt><dd className="tabular">{info.links}</dd>
            </dl>
          </div>

          {/* Permission grid */}
          <table className="perm-grid perm-grid-enhanced">
            <thead>
              <tr>
                <th />
                {BITS.map((b) => <th key={b}>{b}{isDir && b === 'Execute' ? ' (open)' : ''}</th>)}
              </tr>
            </thead>
            <tbody>
              {WHO.map((who, wi) => (
                <tr key={who}>
                  <th scope="row">{who}</th>
                  {BIT_VALS.map((bit, bi) => {
                    const mask = bit << SHIFTS[wi]!;
                    return (
                      <td key={bi}>
                        <input
                          type="checkbox"
                          aria-label={`${who} ${BITS[bi]}`}
                          checked={(mode & mask) !== 0}
                          onChange={() => toggleBit(SHIFTS[wi]!, bit)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Special bits */}
          <div className="perm-special-bits">
            <h4>Special bits</h4>
            <div className="perm-special-row">
              <label className="check">
                <input type="checkbox" checked={(mode & 0o4000) !== 0} onChange={() => toggleSpecial(0o4000)} />
                Set UID (setuid)
              </label>
              <label className="check">
                <input type="checkbox" checked={(mode & 0o2000) !== 0} onChange={() => toggleSpecial(0o2000)} />
                Set GID (setgid)
              </label>
              <label className="check">
                <input type="checkbox" checked={(mode & 0o1000) !== 0} onChange={() => toggleSpecial(0o1000)} />
                Sticky bit
              </label>
            </div>
          </div>

          {/* Octal + symbolic display */}
          <div className="perm-displays">
            <div className="perm-octal">
              <label>Octal</label>
              <input
                type="text"
                className="input input-sm mono"
                value={octalInput}
                onChange={(e) => handleOctalChange(e.target.value)}
                maxLength={4}
                size={6}
              />
            </div>
            <div className="perm-symbolic">
              <label>Symbolic</label>
              <span className="mono">{permissionString(mode, entry.kind)}</span>
            </div>
          </div>

          {/* Recursive option */}
          {isDir && (
            <label className="check perm-recursive">
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
              Apply recursively to all contents
            </label>
          )}

          <div className="perm-editor-footer">
            <button type="button" className="btn btn-default" onClick={closeDialog}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={() => void apply()}>
              {recursive ? 'Apply recursively' : 'Apply'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
