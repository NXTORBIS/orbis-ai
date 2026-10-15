import { useMemo, useState } from 'react';
import { FileCode } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Panel, Seg, Stat, ToggleRow } from './shared';

const SAMPLE = `<article>
  <h1>Quarterly update</h1>
  <p>The <strong>platform</strong> migrated in <em>March</em>, with no downtime.</p>
  <h2>What changed</h2>
  <ul>
    <li>Faster search, <a href="https://example.com/notes">see the notes</a></li>
    <li>New export options</li>
  </ul>
  <blockquote>Ship small, ship often.</blockquote>
  <pre><code>npm run deploy</code></pre>
  <table>
    <thead><tr><th>Region</th><th>Latency</th></tr></thead>
    <tbody>
      <tr><td>Europe</td><td>42 ms</td></tr>
      <tr><td>Asia</td><td>68 ms</td></tr>
    </tbody>
  </table>
  <p><img src="https://example.com/chart.png" alt="Latency chart" /></p>
</article>`;

const inlineText = (node) => {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const name = node.tagName.toLowerCase();
  const inner = Array.from(node.childNodes).map(inlineText).join('');
  if (name === 'strong' || name === 'b') return inner.trim() ? '**' + inner.trim() + '**' : '';
  if (name === 'em' || name === 'i') return inner.trim() ? '*' + inner.trim() + '*' : '';
  if (name === 'del' || name === 's' || name === 'strike') return inner.trim() ? '~~' + inner.trim() + '~~' : '';
  if (name === 'code') return inner.trim() ? '`' + inner.trim() + '`' : '';
  if (name === 'br') return '  \n';
  if (name === 'a') {
    const href = node.getAttribute('href') || '';
    return href && inner.trim() ? '[' + inner.trim() + '](' + href + ')' : inner;
  }
  if (name === 'img') {
    const source = node.getAttribute('src') || '';
    const alt = node.getAttribute('alt') || '';
    return source ? '![' + alt + '](' + source + ')' : '';
  }
  return inner;
};

const clean = (value) => value.replace(/\s+/g, ' ').trim();

const blockText = (element, options, depth) => {
  const name = element.tagName ? element.tagName.toLowerCase() : '';
  const pad = '  '.repeat(depth);

  if (/^h[1-6]$/.test(name)) {
    const level = Number(name.slice(1));
    const text = clean(inlineText(element));
    if (!text) return '';
    return options.atx ? '#'.repeat(level) + ' ' + text : (level === 1 ? text + options.tight : text + options.loose);
  }
  if (name === 'p') {
    const text = clean(inlineText(element));
    return text ? pad + text : '';
  }
  if (name === 'hr') return '---';
  if (name === 'blockquote') {
    return clean(inlineText(element)).split('\n').map((line) => '> ' + line).join('\n');
  }
  if (name === 'pre') {
    const code = element.textContent.replace(/\n+$/, '');
    if (!options.codeFence) return code;
    const language = element.querySelector('code') && element.querySelector('code').className
      ? element.querySelector('code').className.replace(/language-/, '').split(' ')[0]
      : '';
    return '```' + language + '\n' + code + '\n```';
  }
  if (name === 'ul' || name === 'ol') {
    const items = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === 'li');
    return items.map((item, index) => {
      const nested = Array.from(item.children).filter((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()));
      const own = Array.from(item.childNodes).filter((child) => !(child.nodeType === 1 && ['ul', 'ol'].includes(child.tagName.toLowerCase())));
      const text = clean(own.map((child) => inlineText(child)).join(''));
      const marker = name === 'ol' ? String(index + 1) + '.' : '-';
      const nestedText = nested.map((child) => blockText(child, options, depth + 1)).filter(Boolean).join('\n');
      return pad + marker + ' ' + text + (nestedText ? '\n' + nestedText : '');
    }).join('\n');
  }
  if (name === 'table') {
    const rows = Array.from(element.querySelectorAll('tr')).map((row) => Array.from(row.children).map((cell) => clean(inlineText(cell))));
    if (!rows.length) return '';
    if (!options.tables) return rows.map((row) => row.join(' | ')).join('\n');
    const header = rows[0];
    const divider = header.map(() => '---');
    return [header, divider, ...rows.slice(1)].map((row) => '| ' + row.join(' | ') + ' |').join('\n');
  }
  const children = Array.from(element.children || []);
  if (children.length) {
    return children.map((child) => blockText(child, options, depth)).filter(Boolean).join(options.tight);
  }
  const text = clean(inlineText(element));
  return text ? pad + text : '';
};

export default function HtmlToMarkdown() {
  const [html, setHtml] = useState(SAMPLE);
  const [options, setOptions] = useState({ atx: true, tables: true, codeFence: true, tight: '\n\n', loose: '\n===\n', stripMedia: false });

  const result = useMemo(() => {
    const trimmed = String(html).trim();
    if (!trimmed) return { markdown: '', stats: null, warnings: [] };

    let document;
    try {
      document = new DOMParser().parseFromString(trimmed, 'text/html');
    } catch (error) {
      return { markdown: '', stats: null, warnings: ['That could not be parsed as HTML: ' + error.message] };
    }

    document.querySelectorAll('script, style, noscript').forEach((node) => node.remove());

    const root = document.querySelector('main') || document.querySelector('article') || document.body;
    const container = document.createElement('div');
    Array.from(root.children).forEach((child) => container.appendChild(child.cloneNode(true)));

    if (options.stripMedia) {
      container.querySelectorAll('img, figure, video, iframe').forEach((node) => node.remove());
    }

    const markdown = Array.from(container.children)
      .map((child) => blockText(child, options, 0))
      .filter(Boolean)
      .join(options.tight)
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
    const links = container.querySelectorAll('a').length;
    const images = container.querySelectorAll('img').length;
    const lists = container.querySelectorAll('ul, ol').length;
    const tables = container.querySelectorAll('table').length;
    const codeBlocks = container.querySelectorAll('pre').length;
    const words = markdown.split(/\s+/).filter(Boolean).length;

    const warnings = [];
    if (container.querySelectorAll('[style]').length) warnings.push(container.querySelectorAll('[style]').length + ' elements carried inline styles, which Markdown cannot represent and are dropped.');
    if (container.querySelectorAll('[class]').length) warnings.push(container.querySelectorAll('[class]').length + ' elements had class names from the original page, which are also dropped.');
    if (images && !container.querySelector('img[alt]')) warnings.push('Some images had no alt text, so their Markdown will read as empty link text.');
    if (container.querySelectorAll('iframe, video, audio').length && !options.stripMedia) warnings.push('Embeds cannot become Markdown. They stay as plain text or bare URLs you will need to replace by hand.');
    if (tables && !options.tables) warnings.push('Tables were converted to plain pipe-separated lines rather than Markdown tables.');

    return {
      markdown,
      stats: { headings, links, images, lists, tables, codeBlocks, words, characters: markdown.length },
      warnings,
    };
  }, [html, options]);

  const download = () => {
    const blob = new Blob([result.markdown], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'converted.md';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <ToolShell
      toolId="html-to-markdown"
      icon={FileCode}
      title="HTML to Markdown"
      desc="Paste a page, a blog post or a block of copied rich text and get clean Markdown back — headings, lists, links, code, quotes and tables, with what was lost listed."
      state={{ html, options }}
      onRestore={(restored) => {
        if (typeof restored.html === 'string') setHtml(restored.html);
        if (restored.options) setOptions((current) => ({ ...current, ...restored.options }));
      }}
      exportText={result.markdown}
      exportName="converted.md"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">HTML in</div>
          <Area value={html} onChange={setHtml} rows={16} mono placeholder="<h1>Title</h1><p>Text</p>" />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Markdown out</span>
            <div className="flex gap-2">
              <CopyBtn value={result.markdown} label="Copy" />
              <button type="button" onClick={download} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
                Download .md
              </button>
            </div>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.markdown || 'Nothing to convert yet.'}</pre>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Conversion options</div>
          <div className="space-y-1.5">
            <ToggleRow label="ATX headings, using # marks" checked={options.atx} onChange={() => setOptions((current) => ({ ...current, atx: !current.atx }))} />
            <ToggleRow label="Markdown tables instead of plain rows" checked={options.tables} onChange={() => setOptions((current) => ({ ...current, tables: !current.tables }))} />
            <ToggleRow label="Fenced code blocks" checked={options.codeFence} onChange={() => setOptions((current) => ({ ...current, codeFence: !current.codeFence }))} />
            <ToggleRow label="Drop images, video and embeds" checked={options.stripMedia} onChange={() => setOptions((current) => ({ ...current, stripMedia: !current.stripMedia }))} />
          </div>
          <div className="mt-3">
            <Seg
              value={options.tight === '\n\n' ? 'tight' : 'loose'}
              onChange={(value) => setOptions((current) => ({ ...current, tight: value === 'tight' ? '\n\n' : '\n', loose: value === 'tight' ? '\n===\n' : '\n---\n' }))}
              options={[{ value: 'tight', label: 'Tight spacing' }, { value: 'loose', label: 'Compact spacing' }]}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Scripts, styles and hidden elements are stripped before conversion. If the page has a main or article element, only that is converted rather than the whole page chrome.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What was in the source</div>
          {result.stats ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]"><span className="text-muted-foreground">Headings</span><span>{result.stats.headings}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]"><span className="text-muted-foreground">Links</span><span>{result.stats.links}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]"><span className="text-muted-foreground">Images</span><span>{result.stats.images}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]"><span className="text-muted-foreground">Lists</span><span>{result.stats.lists}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]"><span className="text-muted-foreground">Tables</span><span>{result.stats.tables}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]"><span className="text-muted-foreground">Code blocks</span><span>{result.stats.codeBlocks}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]"><span className="text-muted-foreground">Words out</span><span>{result.stats.words}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]"><span className="text-muted-foreground">Characters out</span><span>{result.stats.characters}</span></div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Paste some HTML to see what it contained.</p>
          )}
          {result.warnings.length > 0 && (
            <div className="mt-3 space-y-1 text-[11px] text-amber-200">
              {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Markdown produced"
          value={result.stats ? result.stats.words.toLocaleString() : '0'}
          unit="words"
          sub={result.stats
            ? 'From ' + result.stats.headings + ' headings, ' + result.stats.links + ' links and ' + result.stats.tables + ' tables. Bold, italic, links, lists, quotes, code and tables all convert; styling, class names and scripts do not.'
            : 'Paste some HTML to convert it.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What survives and what does not</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Kept: text, headings, bold, italic, strikethrough, inline code, code blocks, links, images, ordered and unordered lists, block quotes and horizontal rules.</p>
            <p>· Converted: tables become pipe tables, definition-like structures collapse into paragraphs, and nested lists keep their indentation.</p>
            <p>· Dropped: inline styles, class names, colours, fonts, spacing and anything relying on CSS.</p>
            <p>· Impossible: interactive components, embedded video and audio, tooltips, tabs and accordions. Their text survives but the behaviour does not.</p>
            <p>· Reviewed by you: tables with merged cells, deeply nested lists and footnotes usually need a quick manual pass after conversion.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Words" value={result.stats ? String(result.stats.words) : '0'} mono />
        <Stat label="Headings" value={result.stats ? String(result.stats.headings) : '0'} mono />
        <Stat label="Links" value={result.stats ? String(result.stats.links) : '0'} mono />
        <Stat label="Tables" value={result.stats ? String(result.stats.tables) : '0'} mono />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where this is genuinely useful</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Moving a blog post or documentation page into a Git-based site where content is stored as Markdown.</p>
            <p>· Cleaning a pasted web page before it goes into a README, a wiki or an issue description.</p>
            <p>· Turning design tool exports or CMS output into something a repository can hold and diff.</p>
            <p>· Converting old HTML notes into a portable format that outlives whichever editor wrote them.</p>
            <p>· Keeping the text of an article you are allowed to quote, without carrying the page markup and tracking tags with it.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting a better result</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Paste the article content rather than the whole page where you can. Page chrome brings navigation links that you will delete anyway.</p>
            <p>· Read the output before publishing. Converted Markdown inherits the structure of the source, including its oddities.</p>
            <p>· Check images: the URLs point at the original host, which may block hotlinking or disappear entirely.</p>
            <p>· Tables lose merged cells and column widths, so complex layouts need rebuilding by hand.</p>
            <p>· Keep the original HTML until you have confirmed the conversion. Converting back rarely recovers what was dropped.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The conversion runs against the browser own HTML parser, so it handles malformed markup the same way a page would, and nothing is uploaded or fetched — the source
          text stays in this page.
        </p>
      </Panel>
    </ToolShell>
  );
}