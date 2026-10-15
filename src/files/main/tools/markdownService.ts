import type { MarkdownRenderResult } from '../../shared/markdown';

/**
 * Render markdown to HTML. This is a GFM-compatible inline renderer used by
 * the markdown live preview feature. The output is consumed by the renderer
 * process and displayed inside a sandboxed container.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text: string): string {
  let out = '';
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\))|(\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\))|(~~[^~]+~~)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) {
      out += `<code>${escapeHtml(t.slice(1, -1))}</code>`;
    } else if (m[2]) {
      out += `<strong>${renderInline(t.slice(2, -2))}</strong>`;
    } else if (m[3]) {
      out += `<em>${renderInline(t.slice(1, -1))}</em>`;
    } else if (m[4]) {
      // Image
      const alt = escapeHtml(m[5] ?? '');
      const src = escapeHtml(m[6] ?? '');
      const title = m[7] ? ` title="${escapeHtml(m[7])}"` : '';
      out += `<img src="${src}" alt="${alt}"${title} />`;
    } else if (m[8]) {
      // Link
      const linkText = renderInline(m[9] ?? '');
      const href = escapeHtml(m[10] ?? '');
      const title = m[11] ? ` title="${escapeHtml(m[11])}"` : '';
      out += `<a href="${href}"${title}>${linkText}</a>`;
    } else if (m[12]) {
      out += `<del>${renderInline(t.slice(2, -2))}</del>`;
    }
    last = re.lastIndex;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

export function renderMarkdown(content: string): MarkdownRenderResult {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const lang = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      i++;
      out.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      out.push(`<h${level}>${renderInline(h[2]!)}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^\s*>\s?/, ''));
        i++;
      }
      const inner = renderMarkdown(body.join('\n')).html;
      out.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    // List (ordered and unordered)
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
        const text = lines[i]!.replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
        if (task) {
          const checked = task[1] !== ' ' ? ' checked disabled' : ' disabled';
          items.push(`<li><input type="checkbox"${checked} /> ${renderInline(task[2]!)}</li>`);
        } else {
          items.push(`<li>${renderInline(text)}</li>`);
        }
        i++;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    // Table
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const alignRow = cells(lines[i + 1]!);
      const aligns = alignRow.map((c) => {
        if (c.startsWith(':') && c.endsWith(':')) return 'center';
        if (c.endsWith(':')) return 'right';
        return 'left';
      });
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) body.push(cells(lines[i++]!));
      const headHtml = head.map((c, j) => `<th style="text-align:${aligns[j] ?? 'left'}">${renderInline(c)}</th>`).join('');
      const bodyHtml = body.map((r) =>
        '<tr>' + r.map((c, j) => `<td style="text-align:${aligns[j] ?? 'left'}">${renderInline(c)}</td>`).join('') + '</tr>',
      ).join('');
      out.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    // Math block ($$...$$)
    if (line.trim() === '$$') {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== '$$') body.push(lines[i++]!);
      i++;
      out.push(`<div class="math-block">${escapeHtml(body.join('\n'))}</div>`);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+|\|.*\|\s*$)/.test(lines[i]!)) {
      para.push(lines[i++]!);
    }
    out.push(`<p>${renderInline(para.join(' '))}</p>`);
  }

  return { html: out.join('\n') };
}
