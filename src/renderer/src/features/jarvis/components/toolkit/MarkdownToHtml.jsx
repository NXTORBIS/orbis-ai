import { useMemo, useState } from 'react';
import { FileCode } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, downloadBlob } from './shared';

const SAMPLE = `# Release notes

**Version 2.4** ships the offline queue and a much faster search.

## What changed

- Notes sync without a connection and flush on reconnect
- Search now indexes attachments
- Fixed a crash when renaming a notebook mid-sync

## Upgrade

1. Back up your data
2. Run \`npm run migrate\`
3. Restart the worker

> Downgrading after the migration is not supported.

See the [full changelog](https://example.com/changelog) for details.`;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text, styles) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => styles
    ? `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f3f4f6;padding:2px 5px;border-radius:4px;">${code}</code>`
    : `<code>${code}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}" style="max-width:100%;height:auto;" />`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => styles
    ? `<a href="${href}" style="color:#0e7490;text-decoration:underline;">${label}</a>`
    : `<a href="${href}">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out;
}

function parse(markdown, styles) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let index = 0;

  const closeList = (stack) => {
    while (stack.length) {
      const type = stack.pop();
      html.push(type === 'ul' ? '</ul>' : '</ol>');
    }
  };

  const listStack = [];

  while (index < lines.length) {
    const line = lines[index];

    if (/^```/.test(line.trim())) {
      const language = line.trim().slice(3).trim();
      const body = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      closeList(listStack);
      const code = escapeHtml(body.join('\n'));
      html.push(styles
        ? `<pre style="background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;overflow-x:auto;font-family:ui-monospace,Menlo,monospace;font-size:13px;line-height:1.5;"><code>${code}</code></pre>`
        : `<pre><code class="language-${language}">${code}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      closeList(listStack);
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList(listStack);
      const level = heading[1].length;
      const sizes = ['28px', '23px', '19px', '16px', '15px', '14px'];
      const text = inline(heading[2], styles);
      html.push(styles
        ? `<h${level} style="font-size:${sizes[level - 1]};font-weight:600;margin:22px 0 10px;color:#111827;line-height:1.3;">${text}</h${level}>`
        : `<h${level}>${text}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeList(listStack);
      html.push(styles ? '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />' : '<hr />');
      index += 1;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList(listStack);
      const body = [quote[1]];
      index += 1;
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        body.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      closeList(listStack);
      html.push(styles
        ? `<blockquote style="margin:18px 0;padding:2px 18px;border-left:3px solid #22d3ee;color:#4b5563;">${body.map((row) => inline(row, styles)).join('<br />')}</blockquote>`
        : `<blockquote>${body.map((row) => inline(row, styles)).join('<br />')}</blockquote>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (listStack[listStack.length - 1] !== type) {
        closeList(listStack);
        listStack.push(type);
        html.push(styles
          ? `<${type} style="margin:12px 0;padding-left:22px;color:#374151;">`
          : `<${type}>`);
      }
      const text = inline((bullet || numbered)[1], styles);
      html.push(styles ? `<li style="margin:6px 0;line-height:1.6;">${text}</li>` : `<li>${text}</li>`);
      index += 1;
      continue;
    }

    closeList(listStack);
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+[.)]\s|```)/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    const text = paragraph.map((row) => inline(row, styles)).join('<br />');
    html.push(styles
      ? `<p style="margin:12px 0;line-height:1.65;color:#374151;">${text}</p>`
      : `<p>${text}</p>`);
  }

  closeList(listStack);
  return html.join('\n');
}

function toPlainText(markdown) {
  return String(markdown)
    .replace(/\r\n/g, '\n')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .trim();
}

export default function MarkdownToHtml() {
  const [markdown, setMarkdown] = useState(SAMPLE);
  const [mode, setMode] = useState('email');

  const built = useMemo(() => {
    const styles = mode === 'email';
    const body = parse(markdown, styles);
    const document = styles
      ? `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#374151;max-width:640px;">\n${body}\n</div>`
      : body;
    return {
      body,
      document,
      plain: toPlainText(markdown),
      headings: (markdown.match(/^#{1,6}\s+/gm) || []).length,
      links: (markdown.match(/\[[^\]]+\]\([^)]+\)/g) || []).length,
      codeBlocks: (markdown.match(/```/g) || []).length / 2,
      words: toPlainText(markdown).split(/\s+/).filter(Boolean).length,
      kb: (new TextEncoder().encode(document).length / 1024).toFixed(1),
    };
  }, [markdown, mode]);

  const output = mode === 'plain' ? built.plain : built.document;
  const report = built.document;

  return (
    <ToolShell
      toolId="markdown-html"
      icon={FileCode}
      title="Markdown → HTML"
      desc="Paste Markdown and get clean HTML back — either semantic tags for a page, or email-safe markup with every style inlined, so it renders in Outlook as well as it does in your browser. A plain-text twin comes free, which is what every email actually needs."
      state={{ markdown, mode }}
      onRestore={(restored) => {
        if (typeof restored.markdown === 'string') setMarkdown(restored.markdown);
        if (typeof restored.mode === 'string') setMode(restored.mode);
      }}
      exportText={report}
      exportName={mode === 'email' ? 'email.html' : 'content.html'}
      exportMime="text/html"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: 'email', label: 'Email HTML (styles inlined)' },
            { value: 'semantic', label: 'Semantic HTML' },
            { value: 'plain', label: 'Plain text' },
          ]}
        />
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([output], { type: 'text/plain' }), mode === 'plain' ? 'content.txt' : 'content.html')}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          Download
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="!p-3">
          <Field label="Markdown">
            <Area value={markdown} onChange={setMarkdown} rows={22} mono placeholder="# Heading&#10;&#10;**Bold**, *italic*, [links](https://example.com)" />
          </Field>
        </Panel>
        <div className="space-y-3">
          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Output</span>
              <CopyBtn value={output} label="Copy the output" />
            </div>
            <pre className="scrollbar-thin max-h-[22rem] overflow-auto rounded-lg border border-border/70 bg-card/60 p-3 font-mono-j text-[11px] leading-relaxed">{output}</pre>
          </Panel>
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Preview</div>
            <div
              className="scrollbar-thin max-h-72 overflow-auto rounded-lg border border-border/70 bg-card/60 p-3 text-sm leading-relaxed [&_a]:text-cyan-j [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-j [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-border [&_li]:ml-4 [&_li]:list-disc [&_p]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-secondary [&_pre]:p-3 [&_pre]:text-xs"
              dangerouslySetInnerHTML={{ __html: built.body }}
            />
          </Panel>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Headings" value={String(built.headings)} mono sub="converted" />
        <Stat label="Links" value={String(built.links)} mono sub="rewritten" />
        <Stat label="Words" value={String(built.words)} mono sub="plain-text length" />
        <Stat label="Output size" value={built.kb + ' KB'} mono sub={mode === 'email' ? 'email-safe' : 'semantic'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Why email mode exists</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Web mail clients strip <span className="font-mono-j">&lt;style&gt;</span> blocks and external stylesheets. Inlining each style on the element is the only version that survives everywhere.</p>
            <p>· Tables, flexbox and grid are unreliable in email. This output uses paragraphs, headings and lists, which are the parts that render consistently.</p>
            <p>· Always send the plain-text version alongside the HTML. Clients that refuse HTML still need something readable, and a missing text part hurts deliverability.</p>
            <p>· Fonts fall back to the reader's system. The inline stack here is deliberate: it names families that exist nearly everywhere.</p>
            <p>· Keep the width near 600–640 px. Wider layouts get squeezed awkwardly in the Outlook preview pane.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What converts cleanly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Headings, paragraphs, bold, italic, links, images, blockquotes, horizontal rules and both list types all map to standard tags.</p>
            <p>· Fenced code blocks become <span className="font-mono-j">pre</span> with the content escaped, so angle brackets and ampersands in your code survive intact.</p>
            <p>· Raw HTML in the source is escaped rather than passed through. That is what makes the output safe to paste anywhere.</p>
            <p>· Tables are not converted. Email clients handle them inconsistently, and hand-built table markup belongs in the template, not a converter.</p>
            <p>· Nested lists flatten to a single level, because deeper nesting is where email rendering diverges most.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Mode', value: mode },
                { label: 'Inlined', value: mode === 'email' ? 'yes' : 'no' },
                { label: 'Escaped', value: 'yes' },
              ]}
            />
          </div>
        </Panel>
      </div>
    </ToolShell>
  );
}