// @ts-nocheck -- ported unchanged from the Jarvis project's backend function of the same name; only the import line differs.
import { createClientFromRequest } from './local'

/**
 * Live API-key check.
 *
 * A browser cannot call these APIs directly — almost none of them allow browser
 * origins — so the request is relayed here. Two things matter for safety:
 *
 * 1. The endpoint is chosen from the fixed list below, never from the caller, so
 *    this can never be used as a general-purpose proxy.
 * 2. The key goes only to the provider that issued it, is never logged, is never
 *    returned, and is scrubbed out of any provider message we pass back.
 */

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    display: 'api.openai.com/v1/models',
    url: 'https://api.openai.com/v1/models',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    label: 'Anthropic',
    display: 'api.anthropic.com/v1/models',
    url: 'https://api.anthropic.com/v1/models',
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  openrouter: {
    label: 'OpenRouter',
    display: 'openrouter.ai/api/v1/key',
    url: 'https://openrouter.ai/api/v1/key',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  groq: {
    label: 'Groq',
    display: 'api.groq.com/openai/v1/models',
    url: 'https://api.groq.com/openai/v1/models',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  github: {
    label: 'GitHub',
    display: 'api.github.com/user',
    url: 'https://api.github.com/user',
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'User-Agent': 'mark37-key-checker', Accept: 'application/vnd.github+json' }),
  },
  gitlab: {
    label: 'GitLab',
    display: 'gitlab.com/api/v4/user',
    url: 'https://gitlab.com/api/v4/user',
    headers: (key) => ({ 'PRIVATE-TOKEN': key, 'User-Agent': 'mark37-key-checker' }),
  },
  stripe: {
    label: 'Stripe',
    display: 'api.stripe.com/v1/balance',
    url: 'https://api.stripe.com/v1/balance',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    // A restricted key is real but may not hold the balance permission.
    verdict: (status) => (status === 200 ? 'valid' : status === 401 ? 'invalid' : status === 403 ? 'restricted' : 'error'),
  },
  slack: {
    label: 'Slack',
    display: 'slack.com/api/auth.test',
    method: 'POST',
    url: 'https://slack.com/api/auth.test',
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }),
    verdict: (status, body) => {
      if (body?.ok) return 'valid';
      if (['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed'].includes(body?.error)) return 'invalid';
      if (['missing_scope', 'not_allowed_token_type'].includes(body?.error)) return 'restricted';
      return status === 200 ? 'error' : 'error';
    },
    detail: (body) => body?.error || '',
  },
  notion: {
    label: 'Notion',
    display: 'api.notion.com/v1/users/me',
    url: 'https://api.notion.com/v1/users/me',
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Notion-Version': '2022-06-28' }),
  },
  sendgrid: {
    label: 'SendGrid',
    display: 'api.sendgrid.com/v3/scopes',
    url: 'https://api.sendgrid.com/v3/scopes',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    verdict: (status) => (status === 200 ? 'valid' : status === 401 ? 'invalid' : status === 403 ? 'restricted' : 'error'),
  },
  npm: {
    label: 'npm',
    display: 'registry.npmjs.org/-/whoami',
    url: 'https://registry.npmjs.org/-/whoami',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  huggingface: {
    label: 'Hugging Face',
    display: 'huggingface.co/api/whoami-v2',
    url: 'https://huggingface.co/api/whoami-v2',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  google: {
    label: 'Google (Gemini)',
    display: 'generativelanguage.googleapis.com/v1beta/models',
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    headers: (key) => ({ 'x-goog-api-key': key }),
    verdict: (status, body) => {
      if (status === 200) return 'valid';
      if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(body?.error?.message || '')) return 'invalid';
      if (status === 403) return 'restricted';
      return 'error';
    },
  },
  telegram: {
    label: 'Telegram bot',
    display: 'api.telegram.org/bot…/getMe',
    url: (key) => `https://api.telegram.org/bot${key}/getMe`,
    headers: () => ({}),
    verdict: (status, body) => {
      if (body?.ok) return 'valid';
      if (status === 401 || status === 404) return 'invalid';
      return 'error';
    },
    detail: (body) => body?.description || '',
  },
};

const HINTS = {
  valid: 'The provider accepted this key and answered normally.',
  invalid: 'The provider rejected this key — it is wrong, revoked, expired, or was copied incompletely.',
  restricted: 'The key is real, but it is not allowed to use the endpoint used for this check. That is a permissions limit, not a bad key.',
  throttled: 'The provider is rate-limiting this key right now, which itself suggests the key exists and is being accepted.',
  error: 'The provider answered with something unexpected. Try again in a moment.',
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const providerId = String(payload?.provider || '');
    const key = String(payload?.key || '').trim();

    if (!key) return Response.json({ error: 'No key supplied.' }, { status: 400 });
    if (key.length > 400) return Response.json({ error: 'That is far longer than any API key.' }, { status: 400 });

    const provider = PROVIDERS[providerId];
    if (!provider) {
      return Response.json({ error: 'That provider cannot be checked live.', checkable: Object.keys(PROVIDERS) }, { status: 400 });
    }

    const started = Date.now();
    const url = typeof provider.url === 'function' ? provider.url(key) : provider.url;
    const response = await fetch(url, {
      method: provider.method || 'GET',
      headers: provider.headers(key),
      signal: AbortSignal.timeout(12000),
    });

    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }

    const verdict = provider.verdict
      ? provider.verdict(response.status, body)
      : response.ok
        ? 'valid'
        : response.status === 401 || response.status === 403
          ? 'invalid'
          : response.status === 429
            ? 'throttled'
            : 'error';

    // Whatever the provider said, the key itself never travels back to the browser.
    const scrub = (value) => String(value || '').split(key).join('••••');
    const detail = scrub(provider.detail ? provider.detail(body) : body?.error?.message || body?.message || '');

    return Response.json({
      provider: provider.label,
      endpoint: provider.display,
      verdict,
      status: response.status,
      ms: Date.now() - started,
      detail,
      hint: HINTS[verdict],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}