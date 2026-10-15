import { useEffect, useRef, useState } from 'react';
import { Plug, PlugZap, Send, Trash2 } from 'lucide-react';
import { Hero } from '../kit/premium';
import { Field, Panel, Stat } from '../shared';

export default function WebSocketPanel({ onReport }) {
  const [url, setUrl] = useState('wss://echo.websocket.org');
  const [message, setMessage] = useState('hello');
  const [status, setStatus] = useState('closed');
  const [connectMs, setConnectMs] = useState(null);
  const [log, setLog] = useState([]);
  const [closeInfo, setCloseInfo] = useState(null);
  const socketRef = useRef(null);
  const openedRef = useRef(0);

  const push = (entry) => setLog((current) => [...current.slice(-199), entry]);

  const close = () => {
    socketRef.current?.close(1000, 'closed by user');
    socketRef.current = null;
    setStatus('closed');
  };

  const connect = () => {
    if (!/^wss?:\/\//i.test(url.trim())) {
      push({ dir: 'sys', text: 'A WebSocket URL starts with ws:// or wss:// — a page on HTTPS can only open wss://.', at: new Date().toLocaleTimeString() });
      return;
    }
    close();
    push({ dir: 'sys', text: `Connecting to ${url.trim()}`, at: new Date().toLocaleTimeString() });
    setStatus('connecting');
    setConnectMs(null);
    setCloseInfo(null);
    openedRef.current = performance.now();
    let socket;
    try {
      socket = new WebSocket(url.trim());
    } catch (err) {
      setStatus('failed');
      push({ dir: 'sys', text: err.message, at: new Date().toLocaleTimeString() });
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus('open');
      setConnectMs(Math.round(performance.now() - openedRef.current));
      push({ dir: 'sys', text: 'Handshake complete', at: new Date().toLocaleTimeString() });
    };
    socket.onmessage = (event) => {
      const size = typeof event.data === 'string' ? event.data.length : event.data?.byteLength || 0;
      push({ dir: 'in', text: typeof event.data === 'string' ? event.data.slice(0, 600) : `[binary frame, ${size} bytes]`, size, at: new Date().toLocaleTimeString() });
    };
    socket.onerror = () => push({ dir: 'sys', text: 'The socket reported an error. Most often the URL is wrong, the server refused the origin, or the certificate is bad.', at: new Date().toLocaleTimeString() });
    socket.onclose = (event) => {
      setStatus('closed');
      setCloseInfo({ code: event.code, reason: event.reason || '', clean: event.wasClean });
      push({ dir: 'sys', text: `Closed — code ${event.code}${event.reason ? ` · ${event.reason}` : ''}${event.wasClean ? '' : ' · not a clean close'}`, at: new Date().toLocaleTimeString() });
      if (socketRef.current === socket) socketRef.current = null;
    };
  };

  const send = () => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(message);
    push({ dir: 'out', text: message, size: message.length, at: new Date().toLocaleTimeString() });
  };

  useEffect(() => () => socketRef.current?.close(), []);

  const sent = log.filter((l) => l.dir === 'out').length;
  const received = log.filter((l) => l.dir === 'in').length;
  const bytes = log.reduce((n, l) => n + (l.size || 0), 0);

  const report = () => onReport?.([
    `WebSocket ${url}`,
    `State ${status}${connectMs ? ` · handshake ${connectMs} ms` : ''}`,
    `Frames sent ${sent} · received ${received} · ${bytes} bytes`,
    closeInfo ? `Close code ${closeInfo.code}${closeInfo.clean ? ' (clean)' : ' (not clean)'}` : '',
  ].filter(Boolean).join('\n'));

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Socket URL">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            className="h-9 w-72 rounded-md border border-input bg-transparent px-3 font-mono-j text-xs"
          />
        </Field>
        <button
          type="button"
          onClick={connect}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <PlugZap className="h-3.5 w-3.5" /> {status === 'open' ? 'Reconnect' : 'Connect'}
        </button>
        {status === 'open' && (
          <button type="button" onClick={close} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-4 text-xs text-muted-foreground transition hover:border-rose-500/50 hover:text-rose-400">
            <Plug className="h-3.5 w-3.5" /> Close
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="State" value={status} />
        <Stat label="Handshake" value={connectMs ? `${connectMs} ms` : '—'} mono />
        <Stat label="Frames" value={`${sent} out · ${received} in`} mono />
        <Stat label="Close code" value={closeInfo ? String(closeInfo.code) : '—'} sub={closeInfo ? (closeInfo.clean ? 'clean close' : 'not clean') : ''} mono />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Message to send">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            spellCheck={false}
            className="h-9 w-72 rounded-md border border-input bg-transparent px-3 font-mono-j text-xs"
          />
        </Field>
        <button
          type="button"
          onClick={send}
          disabled={status !== 'open'}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" /> Send frame
        </button>
        <button type="button" onClick={() => setLog([])} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-4 text-xs text-muted-foreground transition hover:text-foreground">
          <Trash2 className="h-3.5 w-3.5" /> Clear log
        </button>
      </div>

      {!!log.length && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Frame log — newest last</div>
          <div className="max-h-80 space-y-1 overflow-auto">
            {log.map((entry, index) => (
              <div
                key={`${entry.at}-${index}`}
                className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"
              >
                <span className={`shrink-0 font-mono-j text-[10px] ${entry.dir === 'in' ? 'text-emerald-400' : entry.dir === 'out' ? 'text-cyan-j' : 'text-amber-400'}`}>
                  {entry.dir === 'in' ? '← recv' : entry.dir === 'out' ? '→ sent' : '· system'}
                </span>
                <span className="min-w-0 flex-1 break-all font-mono-j text-[10px]">{entry.text}</span>
                <span className="shrink-0 font-mono-j text-[10px] text-muted-foreground">{entry.at}</span>
              </div>
            ))}
          </div>
          <button type="button" onClick={report} className="mt-2 text-[11px] text-cyan-j">Save this session to the export</button>
        </Panel>
      )}

      {status === 'open' && (
        <Hero tone="emerald" label="Connected" value={connectMs ?? '—'} unit="ms" sub={`handshake to ${url}`} />
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The handshake time is the real cost of opening a socket — the number that shows up as delay before a chat, ticker or collaborative
          screen starts responding. If the socket never opens, watch the log: a refusal is usually a server that does not accept browser
          origins, an expired certificate or a URL that expects a different path.
        </p>
      </Panel>
    </>
  );
}