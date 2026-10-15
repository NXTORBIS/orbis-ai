import { useMemo, useState } from 'react';
import { Globe, Download } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Area, Field, Seg, Out, CopyBtn, Stat, downloadBlob } from './shared';
import ToolShell from './kit/ToolShell';

const escapeXml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export default function RobotsSitemap() {
  const [mode, setMode] = useState('robots');
  const [site, setSite] = useState('https://mark37.base44.app');
  const [agent, setAgent] = useState('*');
  const [allow, setAllow] = useState('/\n/tools');
  const [disallow, setDisallow] = useState('/admin\n/api/\n/settings');
  const [crawlDelay, setCrawlDelay] = useState('');
  const [urls, setUrls] = useState('/\n/tools\n/productivity\n/knowledge\n/pricing');
  const [changefreq, setChangefreq] = useState('weekly');
  const [priority, setPriority] = useState('0.8');
  const [lastmod, setLastmod] = useState(new Date().toISOString().slice(0, 10));

  const base = useMemo(() => {
    try { const u = new URL(site); return `${u.origin}${u.pathname.replace(/\/$/, '')}`; } catch { return site.replace(/\/$/, ''); }
  }, [site]);

  const robots = useMemo(() => {
    const lines = [`User-agent: ${agent || '*'}`];
    allow.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => lines.push(`Allow: ${l.startsWith('/') ? l : `/${l}`}`));
    disallow.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => lines.push(`Disallow: ${l.startsWith('/') ? l : `/${l}`}`));
    if (crawlDelay.trim()) lines.push(`Crawl-delay: ${crawlDelay.trim()}`);
    if (base) lines.push(`Sitemap: ${base}/sitemap.xml`);
    return lines.join('\n');
  }, [agent, allow, disallow, crawlDelay, base]);

  const sitemap = useMemo(() => {
    const entries = urls.split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const full = /^https?:/i.test(line) ? line : `${base}${line.startsWith('/') ? line : `/${line}`}`;
        const blocksForUrl = [
          `    <loc>${escapeXml(full)}</loc>`,
          lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
          changefreq !== 'none' ? `    <changefreq>${changefreq}</changefreq>` : null,
          priority ? `    <priority>${priority}</priority>` : null,
        ].filter(Boolean).join('\n');
        return `  <url>\n${blocksForUrl}\n  </url>`;
      });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`;
  }, [urls, base, changefreq, priority, lastmod]);

  const output = mode === 'robots' ? robots : sitemap;
  const filename = mode === 'robots' ? 'robots.txt' : 'sitemap.xml';

  return (
    <ToolShell
      toolId="robots-sitemap"
      icon={Globe}
      title="robots.txt & Sitemap Generator"
      desc="Generate the two files search engines look for, ready to drop into your site root."
      state={{ mode, site, agent, allow, disallow, crawlDelay, urls, changefreq, priority, lastmod }}
      onRestore={(saved) => {
        setMode(saved.mode); setSite(saved.site); setAgent(saved.agent); setAllow(saved.allow);
        setDisallow(saved.disallow); setCrawlDelay(saved.crawlDelay); setUrls(saved.urls);
        setChangefreq(saved.changefreq); setPriority(saved.priority); setLastmod(saved.lastmod);
      }}
      exportText={output}
      exportName={filename}
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'robots', label: 'robots.txt' }, { value: 'sitemap', label: 'sitemap.xml' }]} />
      <Field label="Site address"><input value={site} onChange={(e) => setSite(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      {mode === 'robots' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="User-agent"><input value={agent} onChange={(e) => setAgent(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Crawl-delay (seconds)" hint="Optional — leave empty to omit"><input value={crawlDelay} onChange={(e) => setCrawlDelay(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Allow (one path per line)"><Area value={allow} onChange={setAllow} rows={4} mono /></Field>
          <Field label="Disallow (one path per line)"><Area value={disallow} onChange={setDisallow} rows={4} mono /></Field>
        </div>
      ) : (
        <>
          <Field label="Paths or full URLs (one per line)"><Area value={urls} onChange={setUrls} rows={7} mono /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Change frequency">
              <Seg value={changefreq} onChange={setChangefreq} options={['always', 'hourly', 'daily', 'weekly', 'monthly', 'none'].map((v) => ({ value: v, label: v }))} />
            </Field>
            <Field label="Priority"><input value={priority} onChange={(e) => setPriority(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Last modified"><input type="date" value={lastmod} onChange={(e) => setLastmod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
        </>
      )}
      <Out label={filename} value={output}>
        <pre className="max-h-80 overflow-auto whitespace-pre font-mono-j text-[11px] text-cyan-j scrollbar-thin">{output}</pre>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Entries" value={String(mode === 'robots' ? allow.split('\n').filter((l) => l.trim()).length + disallow.split('\n').filter((l) => l.trim()).length : urls.split('\n').filter((l) => l.trim()).length)} />
        <Stat label="File size" value={`${output.length} bytes`} />
        <Stat label="Base URL" value={base.replace(/^https?:\/\//, '')} />
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={output} label={`Copy ${filename}`} />
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadBlob(new Blob([output], { type: mode === 'robots' ? 'text/plain' : 'application/xml' }), filename)}>
          <Download className="h-3.5 w-3.5" /> Download {filename}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {mode === 'robots'
          ? 'robots.txt lives at the site root and tells crawlers which paths to skip; the sitemap line points them at your URL list.'
          : 'A sitemap lists the URLs you want indexed. Keep it under 50,000 entries and 50 MB, and submit it once in your search console.'}
      </p>
    </ToolShell>
  );
}