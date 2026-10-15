import { createHash } from 'node:crypto';

/**
 * The pages a share serves to the other device: self-contained HTML with
 * inline styles, no scripts and no external resources (the response's CSP
 * forbids them anyway). Every name is HTML-escaped; links are relative to the
 * share's own address.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f4f6f8;--card:#fff;--text:#16191d;--muted:#56616d;--line:#d8dde3;--accent:#1c6cb2;--accent-text:#fff;--warn-bg:#fff4dc;--warn:#6b4700;--ok:#1d7a3e}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d10;--card:#151a20;--text:#e8ecf1;--muted:#a3adb9;--line:#2a323c;--accent:#5caae8;--accent-text:#0b0d10;--warn-bg:#3a2c0c;--warn:#f3d38a;--ok:#6fd496}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:720px;margin:0 auto;padding:16px}
h1{font-size:1.25rem;margin:8px 0 4px}
h2{font-size:1rem;margin:24px 0 8px}
p{margin:4px 0}
.muted{color:var(--muted);font-size:.875rem}
.note{background:var(--warn-bg);color:var(--warn);border-radius:10px;padding:10px 12px;font-size:.875rem;margin:12px 0}
ul{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
li{display:flex;align-items:center;gap:12px;padding:12px 14px;border-top:1px solid var(--line);min-height:56px}
li:first-child{border-top:0}
.name{flex:1;min-width:0;overflow-wrap:anywhere}
.name small{display:block;color:var(--muted);font-size:.8125rem}
a{color:var(--accent)}
a.btn,button{display:inline-block;flex:none;background:var(--accent);color:var(--accent-text);border:0;border-radius:8px;padding:9px 14px;font:inherit;font-size:.875rem;font-weight:600;text-decoration:none;cursor:pointer;min-height:40px}
a.btn.secondary{background:transparent;color:var(--accent);border:1px solid var(--line)}
.crumbs{font-size:.875rem;margin:4px 0 12px;overflow-wrap:anywhere}
form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;display:grid;gap:10px}
input[type=file]{font:inherit;max-width:100%}
.ok{color:var(--ok)}
.empty{padding:16px;color:var(--muted)}
.back{margin-top:16px}
`;

/** CSP source for the one inline style block (no 'unsafe-inline'). */
export const STYLE_CSP_SOURCE = `'sha256-${createHash('sha256').update(STYLE).digest('base64')}'`;

export function pageHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><link rel="icon" href="data:,"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;
}

export const PLAIN_HTTP_NOTE = 'Shared from Orbis Files over plain HTTP on your local network. The connection is not encrypted: others on the same network could see what is transferred.';

export interface ListedItem {
  name: string;
  kind: 'file' | 'directory';
  size?: number;
  /** Relative link to open (folders) or download (files). */
  href: string;
  /** Relative link to download a folder as a ZIP. */
  zipHref?: string;
}

export function listingHtml(opts: { title: string; crumbs?: Array<{ name: string; href?: string }>; items: ListedItem[]; note?: string; uploadAction?: string; uploadInfo?: string; truncated?: number }): string {
  const rows = opts.items.length
    ? opts.items.map((it) => {
      const sub = it.kind === 'directory' ? 'Folder' : it.size !== undefined ? formatSize(it.size) : '';
      const actions = it.kind === 'directory'
        ? `<a class="btn secondary" href="${escapeHtml(it.href)}">Open</a>${it.zipHref ? `<a class="btn" href="${escapeHtml(it.zipHref)}">ZIP</a>` : ''}`
        : `<a class="btn" href="${escapeHtml(it.href)}" download>Download</a>`;
      return `<li><span class="name">${escapeHtml(it.name)}<small>${escapeHtml(sub)}</small></span>${actions}</li>`;
    }).join('')
    : '<li class="empty">Nothing to show here.</li>';
  const crumbs = opts.crumbs?.length
    ? `<p class="crumbs">${opts.crumbs.map((c) => (c.href ? `<a href="${escapeHtml(c.href)}">${escapeHtml(c.name)}</a>` : escapeHtml(c.name))).join(' / ')}</p>`
    : '';
  const more = opts.truncated ? `<p class="muted">${opts.truncated.toLocaleString('en')} more items are not listed. Download the folder as a ZIP to get everything.</p>` : '';
  const upload = opts.uploadAction
    ? `<h2>Send files to this computer</h2><form method="post" action="${escapeHtml(opts.uploadAction)}" enctype="multipart/form-data"><input type="file" name="file" multiple required aria-label="Files to send"><button type="submit">Send</button>${opts.uploadInfo ? `<p class="muted">${escapeHtml(opts.uploadInfo)}</p>` : ''}</form>`
    : '';
  return pageHtml(opts.title, `<h1>${escapeHtml(opts.title)}</h1>${crumbs}<p class="note">${escapeHtml(opts.note ?? PLAIN_HTTP_NOTE)}</p><ul>${rows}</ul>${more}${upload}`);
}

export function messageHtml(title: string, message: string, back?: string, lines: string[] = []): string {
  return pageHtml(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${lines.length ? `<ul>${lines.map((l) => `<li><span class="name">${escapeHtml(l)}</span></li>`).join('')}</ul>` : ''}${back ? `<p class="back"><a class="btn secondary" href="${escapeHtml(back)}">Back</a></p>` : ''}`);
}
