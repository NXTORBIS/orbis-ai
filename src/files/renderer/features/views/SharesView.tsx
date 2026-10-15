import { useEffect, useState } from 'react';
import { call } from '../../api';
import { toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { shares } from '../../state/shares';
import { activePane, navigate } from '../../state/workspace';
import { Button, EmptyState, Pill, Select } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatCount, formatDate } from '../../ui/format';
import type { ShareActivity, ShareSnapshot } from '../../../shared/share';

/**
 * Network shares: each running share's link and QR code, what it shares,
 * whether uploads are allowed, and what other devices did (downloads,
 * uploads, refused requests), with Stop. Stopped shares stay listed until
 * removed. Works in a narrow pane: everything stacks.
 */

const ACTIVITY_SHOWN = 60;

function remaining(ms: number): string {
  const min = Math.max(0, Math.ceil(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** Upload limits are whole MB or GB. */
function limitText(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${Number((mb / 1024).toFixed(1))} GB` : `${Math.round(mb)} MB`;
}

function stopText(s: ShareSnapshot): string {
  const when = s.stoppedMs ? ` ${formatDate(s.stoppedMs)}` : '';
  switch (s.stopReason) {
    case 'expired': return `Expired${when}`;
    case 'quit': return `Stopped when Orbis Files quit${when}`;
    case 'error': return `Stopped after an error${when}`;
    default: return `Stopped${when}`;
  }
}

function activityText(a: ShareActivity): string {
  switch (a.kind) {
    case 'page': return 'Opened the share page';
    case 'download': return `${a.status === 'ok' ? 'Downloaded' : 'Download not finished:'} ${a.name}${a.range ? ' (part)' : ''}`;
    case 'zip': return `${a.status === 'ok' ? 'Downloaded' : 'Download not finished:'} ${a.name}${a.detail ? ` · ${a.detail}` : ''}`;
    case 'upload': return a.status === 'ok' ? `Sent ${a.name} to this computer` : `Upload refused: ${a.detail ?? a.name}`;
    case 'denied': return 'Tried a wrong link (refused)';
    case 'blocked': return 'Blocked for a while after too many wrong links';
  }
}

export function SharesView() {
  const st = useStore(shares, (s) => s);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);
  const running = st.list.filter((s) => s.state === 'running');
  const stopped = st.list.filter((s) => s.state !== 'running');
  return (
    <div className="tool-view scroll-y shares-view">
      <header className="view-header">
        <h1>Network shares</h1>
        <p className="muted">Let a phone or another computer on the same network download files from this computer through a temporary link. To share, select files or folders and choose <strong>Share on local network…</strong> from the item menu or the command palette.</p>
      </header>
      {!st.loaded ? <p className="muted small">Loading…</p> : !st.list.length ? (
        <EmptyState icon="share" title="Nothing is shared" body="Shares stop by themselves when they expire, when you press Stop, and when Orbis Files quits." />
      ) : (
        <>
          {running.map((s) => <ShareCard key={s.id} share={s} />)}
          {stopped.length > 0 && (
            <section className="home-section" aria-labelledby="shares-stopped-h">
              <div className="section-head"><h2 id="shares-stopped-h">Stopped</h2></div>
              {stopped.map((s) => <ShareCard key={s.id} share={s} />)}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ShareCard({ share: s }: { share: ShareSnapshot }) {
  const [which, setWhich] = useState(s.urls[0]?.url ?? '');
  const [stopping, setStopping] = useState(false);
  const live = s.state === 'running';
  const url = s.urls.find((u) => u.url === which) ?? s.urls[0];
  const title = s.items.length === 1 ? s.items[0]!.name : formatCount(s.items.length, 'item');
  const hid = `share-${s.id}-h`;
  const copy = async () => {
    if (!url) return;
    await call('fs:copyText', { text: url.url }).then(() => toast({ level: 'success', title: 'Link copied', detail: 'Send it only to devices on this network that you trust.' }), toastError);
  };
  const stop = async () => {
    setStopping(true);
    await call('share:stop', { id: s.id }).catch(toastError);
    setStopping(false);
  };
  const activity = s.activity.slice(0, ACTIVITY_SHOWN);
  return (
    <section className={`share-card ${live ? 'is-live' : 'is-stopped'}`} aria-labelledby={hid}>
      <div className="share-card-head">
        <Icon name="share" size={18} />
        <h2 id={hid} className="ellipsis" title={s.items.map((i) => i.name).join(', ')}>{title}</h2>
        {live ? <Pill tone="success">Sharing</Pill> : <Pill>{s.stopReason === 'expired' ? 'Expired' : 'Stopped'}</Pill>}
        <span className="spacer" />
        {live
          ? <Button variant="danger" icon="stop" size="sm" disabled={stopping} onClick={() => void stop()}>{stopping ? 'Stopping…' : 'Stop sharing'}</Button>
          : <Button variant="ghost" size="sm" onClick={() => void call('share:dismiss', { id: s.id }).catch(toastError)}>Remove</Button>}
      </div>
      {live && url && (
        <>
          <div className="callout warning share-http-note" role="note">
            <Icon name="warning" size={16} />
            <span>Plain HTTP on your local network: transfers are <strong>not encrypted</strong>. Anyone who has this link can {s.upload ? 'download these items and send files' : 'download these items'} until the share stops.</span>
          </div>
          <div className="share-link-area">
            <img className="share-qr" src={url.qr} width={168} height={168} alt={`QR code for the link ${url.url}`} />
            <div className="share-link-text">
              {s.urls.length > 1 && <Select<string> id={`share-${s.id}-net`} label="Network" value={url.url} options={s.urls.map((u) => ({ value: u.url, label: `${u.interfaceName} · ${u.address}` }))} onChange={setWhich} />}
              <span className="field-label">Link{s.urls.length === 1 ? ` · ${url.interfaceName === 'lo' ? 'this computer only' : url.interfaceName}` : ''}</span>
              <code className="share-url" data-share-url={url.url}>{url.url}</code>
              <div className="share-link-actions">
                <Button size="sm" icon="copy" onClick={() => void copy()}>Copy link</Button>
              </div>
              <p className="muted small">Scan the code with the phone’s camera, or type the link into a browser on the other device. {s.expiresMs ? `Stops in ${remaining(s.expiresMs - Date.now())}.` : 'Runs until you stop it or quit Orbis Files.'}</p>
            </div>
          </div>
        </>
      )}
      {!live && <p className="muted small">{stopText(s)}. The link no longer works.</p>}
      <dl className="share-facts">
        <div><dt>Shared</dt><dd>{s.items.map((i, n) => <span key={n} className="share-item"><Icon name={i.kind === 'directory' ? 'folder' : 'file'} size={13} /> {i.name}{i.size !== undefined ? ` · ${formatBytes(i.size)}` : ''}</span>)}</dd></div>
        <div><dt>Other devices can</dt><dd>{s.upload ? <>download, and send files into <button type="button" className="link-btn mono" onClick={() => void navigate(activePane().id, { kind: 'fs', path: s.upload!.folder })}>{s.upload.folder}</button> (up to {limitText(s.upload.maxBytes)} at a time; nothing is replaced)</> : 'only download (read-only)'}{s.includeHidden ? '; hidden items are included' : ''}</dd></div>
        <div><dt>So far</dt><dd className="tabular">{formatCount(s.stats.downloads, 'download')} · {formatBytes(s.stats.bytesSent)} sent{s.upload ? ` · ${formatCount(s.stats.uploads, 'file')} received` : ''}{s.stats.denied ? ` · ${formatCount(s.stats.denied, 'wrong link')} refused` : ''}</dd></div>
      </dl>
      <h3 className="share-activity-h">Activity</h3>
      {!activity.length ? <p className="muted small">No device has connected yet.</p> : (
        <ul className="share-activity" aria-label="Activity">
          {activity.map((a, i) => (
            <li key={`${a.ms}-${i}`} className={`share-act is-${a.status}`}>
              <Icon name={a.kind === 'upload' ? 'upload' : a.kind === 'denied' || a.kind === 'blocked' ? 'shield' : a.kind === 'page' ? 'globe' : 'download'} size={14} />
              <span className="share-act-text">{activityText(a)}</span>
              <span className="share-act-meta muted small tabular">{a.from} · {new Date(a.ms).toLocaleTimeString()}{a.bytes !== undefined && a.kind !== 'page' ? ` · ${formatBytes(a.bytes)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
