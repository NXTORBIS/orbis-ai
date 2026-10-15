import { useEffect } from 'react';
import { useStore } from '../../state/store';
import {
  transferQueue, wireTransferQueue, pauseTransfer, resumeTransfer,
  cancelTransfer, reorderTransfer, clearCompleted, pauseAll, resumeAll,
} from '../../state/transferQueue';
import { Icon } from '../../ui/Icon';
import { Button, EmptyState, ProgressBar } from '../../ui/components';
import { formatBytes } from '../../ui/format';

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(remaining: number, speed: number): string {
  if (speed <= 0 || remaining <= 0) return '';
  const sec = Math.ceil(remaining / speed);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.ceil(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.ceil((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function TransferQueueView() {
  useEffect(() => { wireTransferQueue(); }, []);
  const state = useStore(transferQueue, (s) => s);
  const { items, activeCount, totalBytes, doneBytes, speed } = state;
  const hasActive = items.some((i) => i.status === 'active' || i.status === 'queued');
  const hasPaused = items.some((i) => i.status === 'paused');
  const hasCompleted = items.some((i) => i.status === 'done' || i.status === 'error');

  const overallFraction = totalBytes > 0 ? Math.min(doneBytes / totalBytes, 1) : 0;
  const remaining = totalBytes - doneBytes;

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Transfer Queue</h1>
        <span className="spacer" />
        <div className="view-header-actions">
          {hasActive && <Button size="sm" variant="default" onClick={pauseAll}><Icon name="pause" size={14} /> Pause all</Button>}
          {hasPaused && <Button size="sm" variant="default" onClick={resumeAll}><Icon name="play" size={14} /> Resume all</Button>}
          {hasCompleted && <Button size="sm" variant="default" onClick={clearCompleted}><Icon name="close" size={14} /> Clear completed</Button>}
        </div>
      </header>

      {items.length > 0 && (
        <div className="tq-summary">
          <ProgressBar value={overallFraction} label="Overall progress" />
          <div className="tq-summary-stats">
            <span>{formatBytes(doneBytes)} / {formatBytes(totalBytes)}</span>
            {speed > 0 && <span className="tq-speed">{formatSpeed(speed)}</span>}
            {speed > 0 && remaining > 0 && <span className="tq-eta">ETA: {formatEta(remaining, speed)}</span>}
            <span>{activeCount} active</span>
          </div>
        </div>
      )}

      {items.length === 0 && <EmptyState icon="activity" title="No transfers" body="Copy or move operations will appear here with progress, priority and pause controls." />}

      <div className="tq-list">
        {items.map((item) => (
          <TransferRow key={item.id} item={item} speed={speed} />
        ))}
      </div>
    </div>
  );
}

function TransferRow({ item, speed }: { item: import('../../../shared/transferQueue').TransferItem; speed: number }) {
  const fraction = item.size && item.size > 0 ? Math.min(item.progress / item.size, 1) : 0;
  const remaining = (item.size ?? 0) - item.progress;
  const isActive = item.status === 'active';
  const isDone = item.status === 'done';
  const isError = item.status === 'error';
  const isPaused = item.status === 'paused';
  const isQueued = item.status === 'queued';

  const statusIcon = isDone ? 'check' : isError ? 'warning' : isPaused ? 'pause' : isQueued ? 'clock' : 'activity';
  const statusClass = isDone ? 'done' : isError ? 'error' : isPaused ? 'paused' : isQueued ? 'queued' : 'active';

  return (
    <div className={`tq-item tq-item-${statusClass}`}>
      <div className="tq-item-header">
        <Icon name={item.type === 'copy' ? 'copy' : 'move'} size={16} />
        <div className="tq-item-info">
          <span className="tq-item-name" title={item.source}>{baseName(item.source)}</span>
          {item.itemCount && item.itemCount > 1 && (
            <span className="tq-item-count">{item.completedItems ?? 0} / {item.itemCount} items</span>
          )}
        </div>
        <Icon name={statusIcon} size={14} className={`tq-status-icon tq-status-${statusClass}`} />
        <div className="tq-item-actions">
          {(isActive || isQueued) && <button type="button" className="btn-icon-sm" title="Pause" onClick={() => pauseTransfer(item.id)}><Icon name="pause" size={14} /></button>}
          {isPaused && <button type="button" className="btn-icon-sm" title="Resume" onClick={() => resumeTransfer(item.id)}><Icon name="play" size={14} /></button>}
          {!isDone && <button type="button" className="btn-icon-sm" title="Cancel" onClick={() => cancelTransfer(item.id)}><Icon name="close" size={14} /></button>}
          {isQueued && (
            <>
              <button type="button" className="btn-icon-sm" title="Move to top" onClick={() => reorderTransfer(item.id, 'first')}><Icon name="arrowUp" size={14} /></button>
              <button type="button" className="btn-icon-sm" title="Move to bottom" onClick={() => reorderTransfer(item.id, 'last')}><Icon name="arrowDown" size={14} /></button>
            </>
          )}
        </div>
      </div>
      <div className="tq-item-dest" title={item.dest}>
        <Icon name="arrowRight" size={12} /> {baseName(item.dest || '?')}
      </div>
      {(isActive || isPaused) && (
        <div className="tq-item-progress">
          <ProgressBar value={fraction} label={baseName(item.source)} />
          <div className="tq-item-progress-stats">
            <span>{formatBytes(item.progress)}{item.size ? ` / ${formatBytes(item.size)}` : ''}</span>
            {isActive && speed > 0 && remaining > 0 && <span>ETA: {formatEta(remaining, speed)}</span>}
          </div>
        </div>
      )}
      {isError && item.error && <div className="tq-item-error">{item.error}</div>}
    </div>
  );
}
