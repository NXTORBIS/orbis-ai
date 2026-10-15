import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Seg, Panel } from './shared';
import ToolShell from './kit/ToolShell';

const CODES = [
  [100, 'Continue', 'The server received the request headers; the client should send the body.', 1],
  [101, 'Switching Protocols', 'The server is changing protocols as the client asked.', 1],
  [102, 'Processing', 'The server is working on the request but has no response yet (WebDAV).', 1],
  [103, 'Early Hints', 'Lets the browser preload resources before the final response.', 1],
  [200, 'OK', 'Standard success — the request worked.', 2],
  [201, 'Created', 'A new resource was created, usually after POST.', 2],
  [202, 'Accepted', 'Queued for processing; the result is not ready yet.', 2],
  [203, 'Non-Authoritative Information', 'Metadata came from a copy, not the origin server.', 2],
  [204, 'No Content', 'Success with an empty body — common for DELETE.', 2],
  [205, 'Reset Content', 'Success; the client should reset the form or view.', 2],
  [206, 'Partial Content', 'Only part of the resource was sent, as requested by a Range header.', 2],
  [207, 'Multi-Status', 'Multiple independent statuses in one response (WebDAV).', 2],
  [208, 'Already Reported', 'These members were already listed; avoids repeats.', 2],
  [226, 'IM Used', 'The response is the result of instance manipulations.', 2],
  [300, 'Multiple Choices', 'Several representations exist; the client picks one.', 3],
  [301, 'Moved Permanently', 'The resource now lives elsewhere — update your links.', 3],
  [302, 'Found', 'Temporary redirect; keep using the original URL.', 3],
  [303, 'See Other', 'Fetch the result with a GET from another URL (after POST).', 3],
  [304, 'Not Modified', 'Your cached copy is still fresh — nothing to download.', 3],
  [305, 'Use Proxy', 'Deprecated: the resource must be reached through a proxy.', 3],
  [307, 'Temporary Redirect', 'Redirect that preserves the original method and body.', 3],
  [308, 'Permanent Redirect', 'Permanent version of 307 with the method preserved.', 3],
  [400, 'Bad Request', 'Malformed request — bad syntax, missing field or bad JSON.', 4],
  [401, 'Unauthorized', 'Authentication is required or the credentials failed.', 4],
  [402, 'Payment Required', 'Reserved for payment-gated APIs.', 4],
  [403, 'Forbidden', 'Authenticated but not allowed to do this.', 4],
  [404, 'Not Found', 'No resource at this URL.', 4],
  [405, 'Method Not Allowed', 'This URL exists but not for that HTTP method.', 4],
  [406, 'Not Acceptable', 'Cannot produce a representation matching your Accept header.', 4],
  [407, 'Proxy Authentication Required', 'Authenticate with the proxy first.', 4],
  [408, 'Request Timeout', 'The client was too slow; the server closed the connection.', 4],
  [409, 'Conflict', 'The request clashes with the current state (duplicate, version clash).', 4],
  [410, 'Gone', 'The resource is permanently removed — stronger than 404.', 4],
  [411, 'Length Required', 'Content-Length header is missing.', 4],
  [412, 'Precondition Failed', 'A conditional header such as If-Match did not hold.', 4],
  [413, 'Content Too Large', 'The request body exceeds the server limit.', 4],
  [414, 'URI Too Long', 'The requested URL is longer than the server accepts.', 4],
  [415, 'Unsupported Media Type', 'The body format is not supported (send the right Content-Type).', 4],
  [416, 'Range Not Satisfiable', 'The requested byte range cannot be served.', 4],
  [417, 'Expectation Failed', 'The Expect header cannot be met.', 4],
  [418, "I'm a Teapot", 'An April Fools joke that became a real, if playful, status.', 4],
  [421, 'Misdirected Request', 'The request reached a server that cannot answer for that host.', 4],
  [422, 'Unprocessable Content', 'Syntax is fine but the values failed validation.', 4],
  [423, 'Locked', 'The resource is locked (WebDAV).', 4],
  [424, 'Failed Dependency', 'It failed because a dependent request failed.', 4],
  [425, 'Too Early', 'The server refuses to risk a replay attack.', 4],
  [426, 'Upgrade Required', 'Retry using a newer protocol such as TLS or HTTP/2.', 4],
  [428, 'Precondition Required', 'The server requires a conditional request to avoid lost updates.', 4],
  [429, 'Too Many Requests', 'Rate limited — slow down and respect Retry-After.', 4],
  [431, 'Request Header Fields Too Large', 'Headers exceed the server limit.', 4],
  [451, 'Unavailable For Legal Reasons', 'Blocked for legal or copyright reasons.', 4],
  [500, 'Internal Server Error', 'The catch-all: something broke on the server.', 5],
  [501, 'Not Implemented', 'The server does not support this method or feature.', 5],
  [502, 'Bad Gateway', 'A proxy or gateway got an invalid reply upstream.', 5],
  [503, 'Service Unavailable', 'Temporarily down or overloaded — try again later.', 5],
  [504, 'Gateway Timeout', 'An upstream server did not answer in time.', 5],
  [505, 'HTTP Version Not Supported', 'The HTTP version is not supported.', 5],
  [506, 'Variant Also Negotiates', 'Content negotiation configuration error.', 5],
  [507, 'Insufficient Storage', 'The server is out of space (WebDAV).', 5],
  [508, 'Loop Detected', 'An infinite loop was found while processing (WebDAV).', 5],
  [510, 'Not Extended', 'Further extensions are required.', 5],
  [511, 'Network Authentication Required', 'Sign in to the network (captive portal).', 5],
];

const TONE = {
  1: 'border-sky-500/40 text-sky-500',
  2: 'border-emerald-500/40 text-emerald-500',
  3: 'border-amber-500/40 text-amber-500',
  4: 'border-orange-500/40 text-orange-500',
  5: 'border-red-500/40 text-red-500',
};

const GROUP_LABEL = { 1: 'Informational', 2: 'Success', 3: 'Redirection', 4: 'Client error', 5: 'Server error' };

export default function HttpStatusCodes() {
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CODES.filter(([code, name, desc, cls]) => (group === 'all' || cls === Number(group)) && (!q || String(code).includes(q) || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)));
  }, [group, query]);

  return (
    <ToolShell
      toolId="http-status"
      icon={Globe}
      title="HTTP Status Codes"
      desc="Every status that matters, with what it really means in practice."
      state={{ group, query }}
      onRestore={(saved) => { setGroup(saved.group || 'all'); setQuery(saved.query || ''); }}
    >
      <Seg value={group} onChange={setGroup} options={[{ value: 'all', label: 'All' }, { value: '1', label: '1xx' }, { value: '2', label: '2xx' }, { value: '3', label: '3xx' }, { value: '4', label: '4xx' }, { value: '5', label: '5xx' }]} />
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a code, name or meaning…" />
      <div className="text-xs text-muted-foreground">{filtered.length} of {CODES.length} codes{group !== 'all' ? ` · ${GROUP_LABEL[Number(group)]}` : ''}</div>
      <div className="space-y-2">
        {filtered.map(([code, name, desc, cls]) => (
          <div key={code} className="rounded-xl border border-border/70 bg-card/40 p-3">
            <div className="flex items-center gap-3">
              <span className={`rounded-lg border bg-background/60 px-2.5 py-1 font-display text-sm font-bold ${TONE[cls]}`}>{code}</span>
              <span className="text-sm font-medium">{name}</span>
              <span className="ml-auto hidden text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:block">{GROUP_LABEL[cls]}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
          </div>
        ))}
        {!filtered.length && <Panel><p className="text-sm text-muted-foreground">No status codes match “{query}”.</p></Panel>}
      </div>
    </ToolShell>
  );
}