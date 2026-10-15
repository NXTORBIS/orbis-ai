import { useMemo, useState } from 'react';
import { Tags } from 'lucide-react';
import { ToolHeader, Field, Seg, Out, CopyBtn, Panel, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const TYPES = [['website', 'Website'], ['article', 'Article'], ['product', 'Product'], ['profile', 'Profile'], ['video.other', 'Video']];

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function MetaTagsGenerator() {
  const [title, setTitle] = useState('Mark32 — your personal operating system');
  const [description, setDescription] = useState('Notes, tasks, files and knowledge in one intelligent workspace, searchable in an instant.');
  const [url, setUrl] = useState('https://mark37.base44.app');
  const [image, setImage] = useState('https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&h=630&fit=crop');
  const [siteName, setSiteName] = useState('Mark32');
  const [twitter, setTwitter] = useState('');
  const [type, setType] = useState('website');
  const [themeColor, setThemeColor] = useState('#22d3ee');
  const [robots, setRobots] = useState('index, follow');

  const html = useMemo(() => {
    const lines = [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(description)}" />`,
      `<link rel="canonical" href="${esc(url)}" />`,
      `<meta name="robots" content="${esc(robots)}" />`,
      `<meta name="theme-color" content="${esc(themeColor)}" />`,
      '',
      '<!-- Open Graph -->',
      `<meta property="og:type" content="${esc(type)}" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`,
      `<meta property="og:url" content="${esc(url)}" />`,
      `<meta property="og:image" content="${esc(image)}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:site_name" content="${esc(siteName)}" />`,
      '',
      '<!-- Twitter / X -->',
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${esc(title)}" />`,
      `<meta name="twitter:description" content="${esc(description)}" />`,
      `<meta name="twitter:image" content="${esc(image)}" />`,
    ];
    if (twitter.trim()) lines.push(`<meta name="twitter:site" content="${esc(twitter.trim())}" />`);
    return lines.join('\n');
  }, [title, description, url, image, siteName, twitter, type, themeColor, robots]);

  const domain = useMemo(() => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || 'example.com'; }
  }, [url]);

  const titleTone = title.length > 60 ? 'text-amber-500' : 'text-muted-foreground';
  const descTone = description.length > 160 ? 'text-amber-500' : 'text-muted-foreground';

  return (
    <ToolShell
      toolId="meta-tags"
      icon={Tags}
      title="Meta Tag & Social Preview"
      desc="Fill in the details, see how the link will look, and copy the tags for your head section."
      state={{ title, description, url, image, siteName, twitter, type, themeColor, robots }}
      onRestore={(saved) => {
        setTitle(saved.title); setDescription(saved.description); setUrl(saved.url); setImage(saved.image);
        setSiteName(saved.siteName); setTwitter(saved.twitter); setType(saved.type);
        setThemeColor(saved.themeColor); setRobots(saved.robots);
      }}
      exportText={JSON.stringify({ title, description, url, image, siteName, twitter, type, themeColor, robots }, null, 2)}
      exportName="meta-tags.json"
      exportMime="application/json"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Page title · ${title.length} chars`} hint="Search engines show about 60 characters">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label={`Description · ${description.length} chars`} hint="Aim for 150–160 characters">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label="URL"><input value={url} onChange={(e) => setUrl(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" /></Field>
        <Field label="Social image URL" hint="1200 × 630 works best"><input value={image} onChange={(e) => setImage(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" /></Field>
        <Field label="Site name"><input value={siteName} onChange={(e) => setSiteName(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Twitter / X handle" hint="Optional, e.g. @mark32"><input value={twitter} onChange={(e) => setTwitter(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Robots"><input value={robots} onChange={(e) => setRobots(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" /></Field>
        <Field label="Theme colour">
          <div className="flex gap-2">
            <input type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="h-9 w-12 rounded-md border border-input bg-transparent" />
            <input value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
          </div>
        </Field>
      </div>
      <Seg value={type} onChange={setType} options={TYPES.map(([value, label]) => ({ value, label }))} />
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">How it looks on Google</div>
        <div className="rounded-xl border border-border/70 bg-background/60 p-3">
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400">{domain}</div>
          <div className="mt-0.5 text-base text-blue-600 hover:underline dark:text-blue-400">{title || 'Page title'}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description || 'Page description'}</div>
        </div>
      </Panel>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">How it looks when shared</div>
        <div className="overflow-hidden rounded-xl border border-border/70">
          {image ? <img src={image} alt="" className="h-40 w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
          <div className="bg-secondary/40 p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{domain}</div>
            <div className="mt-1 text-sm font-semibold">{title || 'Page title'}</div>
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description || 'Page description'}</div>
          </div>
        </div>
      </Panel>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Title length" value={`${title.length} chars`} />
        <Stat label="Description length" value={`${description.length} chars`} />
        <Stat label="Tags generated" value={String(html.split('\n').filter((l) => l.trim().startsWith('<')).length)} />
      </div>
      <Out label="HTML for your head" value={html}>
        <pre className="max-h-72 overflow-auto whitespace-pre font-mono-j text-[11px] scrollbar-thin">{html}</pre>
      </Out>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={html} label="Copy meta tags" />
        <CopyBtn value={title} label="Copy title" />
        <CopyBtn value={description} label="Copy description" />
      </div>
      <p className={`text-[11px] ${titleTone}`}>Titles are truncated around 60 characters and descriptions around 160. {descTone === 'text-amber-500' ? 'Your description will be cut off in search results — trim it a little.' : 'Both lengths look good for search results.'}</p>
    </ToolShell>
  );
}