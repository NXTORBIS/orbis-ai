// @ts-nocheck -- ported unchanged from the Jarvis project's backend function of the same name; only the import line differs.
import { createClientFromRequest } from './local'

/**
 * Server-side half of the Connection Doctor.
 *
 * A browser cannot read another site's response headers, follow its redirects, ask a
 * registry who owns a domain or read certificate-transparency logs — none of those
 * servers allow browser origins. This relay does exactly those four read-only lookups.
 *
 * Safety: the target is validated to be a public http/https host (no loopback, no
 * private ranges, no .local), only a fixed set of actions is allowed, every call is
 * time-limited, and only headers, status codes and metadata are returned — never a
 * page body. Nothing is logged.
 */

const BLOCKED_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|\[::1\])/i;
const BLOCKED_SUFFIX = /\.(local|internal|localdomain|home|lan|test|invalid)$/i;

const safeUrl = (raw) => {
  try {
    const url = new URL(String(raw || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (BLOCKED_HOST.test(url.hostname) || BLOCKED_SUFFIX.test(url.hostname)) return null;
    if (!url.hostname.includes('.')) return null;
    return url;
  } catch {
    return null;
  }
};

const safeDomain = (raw) => {
  const value = String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return null;
  return value;
};

const headerMap = (response) => {
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => { out[key] = value; });
  return out;
};

const UA = { 'user-agent': 'mark37-connection-doctor' };

async function readHeaders(url) {
  const started = Date.now();
  const response = await fetch(url.toString(), { redirect: 'follow', headers: UA, signal: AbortSignal.timeout(12000) });
  return { status: response.status, finalUrl: response.url, ms: Date.now() - started, headers: headerMap(response) };
}

async function readRedirects(url) {
  const hops = [];
  let current = url.toString();
  for (let i = 0; i < 8; i += 1) {
    const started = Date.now();
    const response = await fetch(current, { redirect: 'manual', headers: UA, signal: AbortSignal.timeout(12000) });
    const location = response.headers.get('location');
    const next = location ? new URL(location, current).toString() : '';
    hops.push({ url: current, status: response.status, location: next, ms: Date.now() - started });
    if (!next || (!response.headers.get('location') && response.status < 300)) break;
    if (!location || response.status < 300) break;
    if (hops.some((hop) => hop.url === next)) break;
    current = next;
  }
  return { hops };
}

async function readRegistration(domain) {
  const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
    headers: { accept: 'application/rdap+json, application/json', ...UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return { error: `The registry service answered ${response.status}.` };
  const data = await response.json();
  const eventDate = (action) => (data.events || []).find((event) => event.eventAction === action)?.eventDate || '';
  const registrar = (data.entities || []).find((entity) => (entity.roles || []).includes('registrar'));
  const name = registrar?.vcardArray?.[1]?.find((field) => field[0] === 'fn')?.[3];
  return {
    domain: data.ldhName || domain,
    registrar: name || registrar?.handle || '',
    created: eventDate('registration'),
    expires: eventDate('expiration'),
    updated: eventDate('last changed'),
    status: data.status || [],
    nameservers: (data.nameservers || []).map((server) => server.ldhName).filter(Boolean),
  };
}

async function readCertificates(domain) {
  const response = await fetch(
    `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=false&expand=issuer`,
    { headers: { accept: 'application/json', ...UA }, signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) return { error: `The certificate-transparency service answered ${response.status}.` };
  const data = await response.json();
  const list = (Array.isArray(data) ? data : [])
    .map((entry) => ({
      issuer: typeof entry.issuer === 'string' ? entry.issuer : entry.issuer?.friendly_name || entry.issuer?.name || '',
      notBefore: entry.not_before || '',
      notAfter: entry.not_after || '',
      names: (entry.dns_names || []).length,
    }))
    .sort((a, b) => String(b.notBefore).localeCompare(String(a.notBefore)));
  return { count: list.length, certificates: list.slice(0, 8) };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const action = String(payload?.action || '');

    if (action === 'headers' || action === 'redirects') {
      const url = safeUrl(payload?.url);
      if (!url) return Response.json({ error: 'That address cannot be checked — use a public http or https host.' }, { status: 400 });
      const data = action === 'headers' ? await readHeaders(url) : await readRedirects(url);
      return Response.json(data);
    }

    if (action === 'rdap' || action === 'cert') {
      const domain = safeDomain(payload?.domain);
      if (!domain) return Response.json({ error: 'That does not look like a domain name.' }, { status: 400 });
      const data = action === 'rdap' ? await readRegistration(domain) : await readCertificates(domain);
      return Response.json(data);
    }

    return Response.json({ error: 'Unknown action.', actions: ['headers', 'redirects', 'rdap', 'cert'] }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}