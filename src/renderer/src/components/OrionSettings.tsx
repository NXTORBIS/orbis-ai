import { Fragment, useEffect, useState } from 'react'
import { Settings, AlertTriangle, CheckCircle, RotateCcw } from 'lucide-react'
import type { OrionState } from '../../../main/orion/types'

interface OrionStatus {
  state: OrionState
  uptime: number
  pid?: number
}

interface Props {
  onRestartOrion(): Promise<void>
  onViewLogs(): void
}

export default function OrionSettings({ onRestartOrion, onViewLogs }: Props) {
  const [status, setStatus] = useState<OrionStatus | null>(null)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    const interval = setInterval(async () => {
      const status = await (window as any).electronAPI?.orion?.getStatus?.()
      if (status) setStatus(status)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await onRestartOrion()
    } finally {
      setRestarting(false)
    }
  }

  const stateColor = {
    ready: '#22c55e',
    starting: '#3b82f6',
    loading: '#3b82f6',
    stopped: '#6b7280',
    crashed: '#ef4444',
    failed: '#ef4444',
    error: '#f97316',
    stopping: '#6b7280',
    busy: '#3b82f6',
  }

  return (
    <Fragment>
      <div className="orion-settings">
        <h3>
          <Settings size={18} /> Orion Status
        </h3>

        {status && (
          <Fragment>
            <div className="status-indicator">
              <div
                className="status-dot"
                style={{
                  backgroundColor: stateColor[status.state] || '#6b7280',
                  animation: status.state === 'ready' ? 'pulse 2s infinite' : 'none',
                }}
              />
              <div>
                <div className="status-text">{status.state}</div>
                <div className="status-subtext">Uptime: {Math.floor(status.uptime / 1000)}s</div>
              </div>
            </div>

            <div className="settings-actions">
              <button
                onClick={handleRestart}
                disabled={restarting || status.state === 'starting' || status.state === 'loading'}
                className="settings-btn"
              >
                {restarting ? (
                  <Fragment>
                    <RotateCcw size={14} className="animate-spin" /> Restarting...
                  </Fragment>
                ) : (
                  <Fragment>
                    <RotateCcw size={14} /> Restart Orion
                  </Fragment>
                )}
              </button>

              <button onClick={onViewLogs} className="settings-btn">
                View Logs
              </button>
            </div>

            {status.state === 'crashed' && (
              <div className="alert alert-error">
                <AlertTriangle size={16} /> Orion has crashed. Click Restart Orion to recover.
              </div>
            )}

            {status.state === 'failed' && (
              <div className="alert alert-error">
                <AlertTriangle size={16} /> Orion failed to start. Check logs and try restarting.
              </div>
            )}

            {status.state === 'ready' && (
              <div className="alert alert-success">
                <CheckCircle size={16} /> Orion is ready. You can start chatting.
              </div>
            )}
          </Fragment>
        )}
      </div>

      <style>{`
        .orion-settings {
          padding: 16px;
          border-radius: 8px;
          background: var(--surface);
          border: 1px solid var(--border);
        }
        .orion-settings h3 {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0 0 12px 0;
          font-size: 14px;
          font-weight: 600;
        }
        .status-indicator {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        .status-text {
          font-weight: 500;
          font-size: 13px;
        }
        .status-subtext {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 2px;
        }
        .settings-actions {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .settings-btn {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface);
          color: var(--text);
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.2s;
        }
        .settings-btn:hover:not(:disabled) {
          background: var(--surface-hover);
        }
        .settings-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .alert {
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .alert-success {
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
          border: 1px solid rgba(34, 197, 94, 0.3);
        }
        .alert-error {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
      `}</style>
    </Fragment>
  )
}
