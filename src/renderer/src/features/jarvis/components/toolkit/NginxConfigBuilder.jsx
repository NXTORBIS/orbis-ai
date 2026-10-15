import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const MODES = [
  { id: 'static', label: 'Static site' },
  { id: 'proxy', label: 'Reverse proxy to an app' },
  { id: 'spa', label: 'SPA with an API behind it' },
];

export default function NginxConfigBuilder() {
  const [mode, setMode] = useState('spa');
  const [domain, setDomain] = useState('example.com');
  const [upstream, setUpstream] = useState('127.0.0.1:3000');
  const [root, setRoot] = useState('/var/www/site');
  const [apiPath, setApiPath] = useState('/api');
  const [bodySize, setBodySize] = useState('10');
  const [certPath, setCertPath] = useState('/etc/letsencrypt/live/example.com');
  const [options, setOptions] = useState({
    redirect: true, gzip: true, cache: true, headers: true, hsts: true, websocket: true, rateLimit: false, www: true,
  });

  const toggle = (key) => setOptions((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const site = String(domain).trim() || 'example.com';
    const clean = site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const wwwHost = 'www.' + clean;
    const chosen = MODES.find((entry) => entry.id === mode) || MODES[2];
    const target = String(upstream).trim() || '127.0.0.1:3000';
    const siteRoot = String(root).trim() || '/var/www/site';
    const api = String(apiPath).trim() || '/api';
    const cert = String(certPath).trim() || '/etc/letsencrypt/live/' + clean;

    const lines = [];
    const push = (value) => lines.push(value);

    push('# ' + chosen.label + ' served for ' + clean);
    push('# Generated config. Run nginx -t before reloading.');
    push('');

    if (options.gzip) {
      push('gzip on;');
      push('gzip_comp_level 5;');
      push('gzip_min_length 256;');
      push('gzip_proxied any;');
      push('gzip_vary on;');
      push('gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;');
      push('');
    }

    if (options.rateLimit) {
      push('# 10 requests a second per address, with a burst allowance of 20');
      push('limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;');
      push('');
    }

    if (options.redirect) {
      push('server {');
      push('    listen 80;');
      push('    listen [::]:80;');
      push('    server_name ' + clean + (options.www ? ' ' + wwwHost : '') + ';');
      push('    location /.well-known/acme-challenge/ { root ' + siteRoot + '; }');
      push('    location / { return 301 https://$host$request_uri; }');
      push('}');
      push('');
    }

    if (options.www) {
      push('server {');
      push('    listen 443 ssl;');
      push('    listen [::]:443 ssl;');
      push('    server_name ' + wwwHost + ';');
      push('    ssl_certificate ' + cert + '/fullchain.pem;');
      push('    ssl_certificate_key ' + cert + '/privkey.pem;');
      push('    return 301 https://' + clean + '$request_uri;');
      push('}');
      push('');
    }

    push('server {');
    push('    listen 443 ssl;');
    push('    listen [::]:443 ssl;');
    push('    http2 on;');
    push('    server_name ' + clean + ';');
    push('');
    push('    ssl_certificate ' + cert + '/fullchain.pem;');
    push('    ssl_certificate_key ' + cert + '/privkey.pem;');
    push('    ssl_protocols TLSv1.2 TLSv1.3;');
    push('    ssl_prefer_server_ciphers off;');
    push('    ssl_session_cache shared:SSL:10m;');
    push('    ssl_session_timeout 1d;');
    push('');
    push('    root ' + siteRoot + ';');
    push('    index index.html;');
    push('    client_max_body_size ' + (Number(bodySize) || 10) + 'm;');
    push('');

    if (options.headers) {
      push('    add_header X-Content-Type-Options nosniff always;');
      push('    add_header X-Frame-Options SAMEORIGIN always;');
      push('    add_header Referrer-Policy strict-origin-when-cross-origin always;');
      push('    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;');
      if (options.hsts) {
        push('    # Only enable HSTS once you are certain every subdomain is on HTTPS');
        push('    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;');
      }
      push('');
    }

    if (options.rateLimit) {
      push('    limit_req zone=general burst=20 nodelay;');
      push('');
    }

    if (mode === 'spa') {
      push('    location ' + api + '/ {');
      push('        proxy_pass http://' + target + ';');
      push('        proxy_http_version 1.1;');
      push('        proxy_set_header Host $host;');
      push('        proxy_set_header X-Real-IP $remote_addr;');
      push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
      push('        proxy_set_header X-Forwarded-Proto $scheme;');
      push('        proxy_read_timeout 60s;');
      push('    }');
      push('');
    }

    if (mode === 'proxy') {
      push('    location / {');
      push('        proxy_pass http://' + target + ';');
      push('        proxy_http_version 1.1;');
      push('        proxy_set_header Host $host;');
      push('        proxy_set_header X-Real-IP $remote_addr;');
      push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
      push('        proxy_set_header X-Forwarded-Proto $scheme;');
      if (options.websocket) {
        push('        proxy_set_header Upgrade $http_upgrade;');
        push('        proxy_set_header Connection "upgrade";');
        push('        proxy_read_timeout 3600s;');
      }
      push('    }');
      push('');
    }

    if (mode !== 'proxy') {
      if (options.cache) {
        push('    # Fingerprinted build assets can be cached hard');
        push('    location ~* \\.(js|css|woff2?|png|jpe?g|gif|svg|webp|avif|ico)$ {');
        push('        expires 1y;');
        push('        add_header Cache-Control "public, immutable";');
        push('        access_log off;');
        push('    }');
        push('');
      }
      push('    location = /index.html {');
      push('        add_header Cache-Control "no-cache, must-revalidate";');
      push('    }');
      push('');
      if (mode === 'spa') {
        push('    # Every unknown path returns the app shell, which is what routers expect');
        push('    location / {');
        push('        try_files $uri $uri/ /index.html;');
        push('    }');
        push('');
      }
      if (options.websocket && mode === 'spa') {
        push('    location /ws/ {');
        push('        proxy_pass http://' + target + ';');
        push('        proxy_http_version 1.1;');
        push('        proxy_set_header Upgrade $http_upgrade;');
        push('        proxy_set_header Connection "upgrade";');
        push('        proxy_read_timeout 3600s;');
        push('    }');
        push('');
      }
    }

    push('    location = /healthz { access_log off; return 200 "ok"; }');
    push('}');

    const config = lines.join('\n');
    const testCommands = [
      'nginx -t                      # validate before reloading',
      'systemctl reload nginx        # reload keeps existing connections',
      'curl -I https://' + clean + '/',
      'curl -I https://' + wwwHost + '/   # should redirect to the bare domain',
      'curl -s https://' + clean + '/healthz',
      mode !== 'static' ? 'curl -s https://' + clean + api + '/health | head' : 'curl -sI https://' + clean + '/app.js | grep -i cache',
    ].join('\n');

    const warnings = [];
    if (options.hsts) warnings.push('Strict-Transport-Security is a one-way door in browsers. Only keep it once every subdomain genuinely works over HTTPS.');
    if (options.cache && mode !== 'proxy') warnings.push('The one-year immutable cache is only safe for fingerprinted filenames. Remove it for assets whose names never change.');
    if (mode === 'spa') warnings.push('try_files sends every unknown path to index.html. Real 404 pages then need handling inside the application, not by nginx.');
    if (options.websocket) warnings.push('The Connection upgrade header must be set per location. Adding it globally breaks ordinary requests.');
    if (options.redirect) warnings.push('The port 80 block keeps the ACME challenge path so certificate renewal can still complete.');

    return {
      config, testCommands, warnings, clean, wwwHost, chosen, target, siteRoot, api, cert, lines: lines.length,
      directives: lines.filter((line) => line.trim().endsWith(';')).length,
      serverBlocks: (config.match(/^server \{/gm) || []).length,
    };
  }, [mode, domain, upstream, root, apiPath, bodySize, certPath, options]);

  const download = () => {
    const blob = new Blob([result.config], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (result.clean || 'site') + '.conf';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <ToolShell
      toolId="nginx-config"
      icon={Globe}
      title="Nginx Site Config Builder"
      desc="A static site, a reverse proxy or a single page app with an API: build the server blocks with TLS, caching, security headers, websockets and rate limiting, and get the test commands."
      state={{ mode, domain, upstream, root, apiPath, bodySize, certPath, options }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (typeof restored.domain === 'string') setDomain(restored.domain);
        if (typeof restored.upstream === 'string') setUpstream(restored.upstream);
        if (typeof restored.root === 'string') setRoot(restored.root);
        if (typeof restored.apiPath === 'string') setApiPath(restored.apiPath);
        if (restored.bodySize !== undefined) setBodySize(String(restored.bodySize));
        if (typeof restored.certPath === 'string') setCertPath(restored.certPath);
        if (restored.options) setOptions((current) => ({ ...current, ...restored.options }));
      }}
      exportText={result.config + '\n\n# Verification\n' + result.testCommands}
      exportName="nginx-site.conf"
    >
      <Seg value={mode} onChange={setMode} options={MODES.map((entry) => ({ value: entry.id, label: entry.label }))} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Domain"><input value={domain} onChange={(e) => setDomain(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Upstream host:port"><input value={upstream} onChange={(e) => setUpstream(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Web root"><input value={root} onChange={(e) => setRoot(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="API path prefix"><input value={apiPath} onChange={(e) => setApiPath(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Max upload, MB"><input value={bodySize} onChange={(e) => setBodySize(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Certificate directory"><input value={certPath} onChange={(e) => setCertPath(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <ToggleRow label="Redirect HTTP to HTTPS" checked={options.redirect} onChange={() => toggle('redirect')} />
        <ToggleRow label="Canonical host redirect" checked={options.www} onChange={() => toggle('www')} />
        <ToggleRow label="Gzip compression" checked={options.gzip} onChange={() => toggle('gzip')} />
        <ToggleRow label="Cache static assets" checked={options.cache} onChange={() => toggle('cache')} />
        <ToggleRow label="Security headers" checked={options.headers} onChange={() => toggle('headers')} />
        <ToggleRow label="HSTS" checked={options.hsts} onChange={() => toggle('hsts')} />
        <ToggleRow label="Websocket upgrade" checked={options.websocket} onChange={() => toggle('websocket')} />
        <ToggleRow label="Rate limiting" checked={options.rateLimit} onChange={() => toggle('rateLimit')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Config for ' + result.clean}
          value={String(result.serverBlocks)}
          unit="server blocks"
          sub={result.directives + ' directives across ' + result.lines + ' lines, set up as ' + result.chosen.label.toLowerCase() + '. ' + (mode === 'proxy' ? 'All traffic is proxied to ' + result.target + ' with the forwarding headers a framework needs.' : mode === 'spa' ? 'Unknown paths return the app shell and ' + result.api + ' goes to ' + result.target + '.' : 'Files are served from ' + result.siteRoot + ' with a one-year cache on hashed assets.')}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Before you reload</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Generated configuration</span>
          <div className="flex gap-2">
            <CopyBtn value={result.config} label="Copy" />
            <button type="button" onClick={download} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              Download .conf
            </button>
          </div>
        </div>
        <pre className="max-h-96 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.config}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Verify the deployment</span>
            <CopyBtn value={result.testCommands} label="Copy" />
          </div>
          <pre className="overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px]">{result.testCommands}</pre>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Always validate with the config test before reloading. A syntax error caught by the test is an inconvenience; the same error caught by a restart is an outage.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The directives that matter most</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· proxy_set_header Host and X-Forwarded-Proto are what let the application behind nginx generate correct absolute URLs instead of http links.</p>
            <p>· try_files $uri $uri/ /index.html is the single line that makes client-side routing work. Without it a refresh on any deep link returns 404.</p>
            <p>· The immutable cache header belongs only on fingerprinted filenames. Applied to index.html it serves a stale app forever.</p>
            <p>· Location blocks are matched by longest prefix, so a specific path always beats a general one — but regex locations are checked in order and can surprise you.</p>
            <p>· A trailing slash on proxy_pass changes the path rewriting. It is the most common cause of API calls arriving at the wrong endpoint.</p>
            <p>· Reload rather than restart. A reload keeps existing connections alive and only swaps the worker processes.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Mode', value: result.chosen.label.split(' ')[0] },
                { label: 'Domain', value: result.clean },
                { label: 'Upstream', value: result.target },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Server blocks" value={String(result.serverBlocks)} mono sub="port 80, 443 and redirects" />
        <Stat label="Directives" value={String(result.directives)} mono sub={result.lines + ' lines'} />
        <Stat label="Upload cap" value={(Number(bodySize) || 10) + ' MB'} mono sub="larger uploads return 413" />
        <Stat label="Upstream" value={result.target} mono sub={result.chosen.label} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Deploying it safely</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Put the file in sites-available and symlink it into sites-enabled, so removing it later is a single unlink rather than an edit.</p>
          <p>· Issue certificates before enabling the HTTPS block, or nginx will refuse to start with a missing certificate file.</p>
          <p>· Keep the ACME challenge location on port 80. Removing it breaks automatic renewal ninety days later, when nobody is watching.</p>
          <p>· Test the redirect chain from outside the network. Internal DNS and a local hosts entry hide exactly the mistakes you are trying to find.</p>
          <p>· Check response headers with curl rather than trusting the browser, which caches both the response and the redirect.</p>
          <p>· Keep a copy of the previous working config. Rolling back a configuration change should take seconds, not an incident call.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The generated file assumes a standard Debian-style layout and a certificate already issued for the domain. Paths, user names and the service manager differ between
          distributions, so adjust those three things before dropping it in.
        </p>
      </Panel>
    </ToolShell>
  );
}