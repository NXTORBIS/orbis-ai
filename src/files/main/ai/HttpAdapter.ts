import { AI_CONTRACT_VERSION, type AiProviderAdapter, type TaskRequest } from '../../shared/integration/ai-contract';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** True when the URL's host is this computer (localhost, 127.0.0.1 or [::1]). */
export function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.includes(url.hostname);
}

/**
 * Provider endpoints must use HTTPS; plain HTTP is accepted only for loopback
 * addresses, where traffic never leaves this computer. Shared by every HTTP
 * provider adapter.
 */
export function assertSecureEndpoint(baseUrl: string, what: string): URL {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(`${what} is not a valid URL.`);
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackUrl(u))) {
    throw new Error(`${what} must use HTTPS, or HTTP on localhost only.`);
  }
  if (u.username || u.password) throw new Error(`${what} must not contain a user name or password; enter the key separately.`);
  return u;
}

/**
 * HTTP transport for the Orbis AI provider contract (docs/INTEGRATION.md).
 *
 * The Orbis AI service implements these routes relative to the configured base URL:
 *   POST /v1/handshake           → Handshake JSON
 *   GET  /v1/ping                → 200 when healthy
 *   POST /v1/tasks               → NDJSON stream: {"type":"progress",...} lines, then one {"type":"result",...}
 *   POST /v1/tasks/<id>/cancel   → 202
 *
 * Nothing here assumes the service exists. Every response is validated by the
 * ProviderRegistry against the contract schemas before use.
 */
export class HttpAdapter implements AiProviderAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    assertSecureEndpoint(baseUrl, 'The Orbis AI endpoint');
  }

  private url(p: string): string {
    return new URL(p.replace(/^\//, ''), this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).toString();
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', 'x-orbis-files-contract': '1' };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  async connect(signal: AbortSignal): Promise<unknown> {
    const res = await this.fetchImpl(this.url('/v1/handshake'), { method: 'POST', headers: this.headers(), body: JSON.stringify({ client: 'orbis-files', contract: AI_CONTRACT_VERSION }), signal });
    if (!res.ok) throw new Error(`Handshake failed with HTTP ${res.status}`);
    return res.json();
  }

  async ping(signal: AbortSignal): Promise<boolean> {
    try {
      const res = await this.fetchImpl(this.url('/v1/ping'), { headers: this.headers(), signal });
      return res.ok;
    } catch {
      return false;
    }
  }

  async run(request: TaskRequest, onProgress: (e: unknown) => void, signal: AbortSignal): Promise<unknown> {
    const onAbort = () => {
      void this.fetchImpl(this.url(`/v1/tasks/${request.taskId}/cancel`), { method: 'POST', headers: this.headers() }).catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.fetchImpl(this.url('/v1/tasks'), { method: 'POST', headers: this.headers(), body: JSON.stringify(request), signal });
      if (!res.ok || !res.body) throw new Error(`Task request failed with HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let result: unknown;
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 64 * 1024 * 1024) throw new Error('Provider response exceeded 64 MB.');
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as { type?: string };
          if (msg.type === 'progress') onProgress(msg);
          else if (msg.type === 'result') result = msg;
        }
      }
      if (buf.trim()) {
        const msg = JSON.parse(buf) as { type?: string };
        if (msg.type === 'result') result = msg;
      }
      if (result === undefined) throw new Error('The provider closed the stream without a result.');
      return result;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async disconnect(): Promise<void> {
    /* stateless HTTP */
  }
}
