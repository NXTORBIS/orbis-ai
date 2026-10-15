import { useMemo, useState } from 'react';
import { Code } from 'lucide-react';
import { ToolHeader, Area, Out, CopyBtn, Seg, Field, Stat, Panel } from './shared';
import ToolShell from './kit/ToolShell';

const SAMPLE = '<library><book id="1" category="fiction"><title>The Left Hand of Darkness</title><author>Ursula K. Le Guin</author><year>1969</year></book><book id="2" category="reference"><title>Structure and Interpretation of Computer Programs</title><author>Abelson &amp; Sussman</author><!-- classic --><year>1985</year></book></library>';

const pad = (depth, size) => ' '.repeat(depth * size);

function serializeNode(node, depth, size, lines) {
  if (node.nodeType === 1) {
    const attrs = Array.from(node.attributes).map((a) => ` ${a.name}="${a.value}"`).join('');
    const children = Array.from(node.childNodes);
    const meaningful = children.filter((c) => !(c.nodeType === 3 && !c.textContent.trim()));
    if (!meaningful.length) { lines.push(`${pad(depth, size)}<${node.nodeName}${attrs} />`); return; }
    if (meaningful.length === 1 && meaningful[0].nodeType === 3) {
      lines.push(`${pad(depth, size)}<${node.nodeName}${attrs}>${meaningful[0].textContent.trim()}</${node.nodeName}>`);
      return;
    }
    lines.push(`${pad(depth, size)}<${node.nodeName}${attrs}>`);
    meaningful.forEach((child) => serializeNode(child, depth + 1, size, lines));
    lines.push(`${pad(depth, size)}</${node.nodeName}>`);
  } else if (node.nodeType === 3) {
    const text = node.textContent.trim();
    if (text) lines.push(pad(depth, size) + text);
  } else if (node.nodeType === 8) {
    lines.push(`${pad(depth, size)}<!-- ${node.textContent.trim()} -->`);
  } else if (node.nodeType === 4) {
    lines.push(`${pad(depth, size)}<![CDATA[${node.textContent}]]>`);
  }
}

export default function XmlFormatter() {
  const [xml, setXml] = useState(SAMPLE);
  const [mode, setMode] = useState('pretty');
  const [indent, setIndent] = useState(2);

  const result = useMemo(() => {
    if (!xml.trim()) return { ok: true, output: '', counts: { elements: 0, attributes: 0, depth: 0 } };
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const errorNode = doc.querySelector('parsererror');
    if (errorNode) {
      const message = errorNode.textContent.split('\n').map((s) => s.trim()).filter(Boolean)[0] || 'Invalid XML.';
      return { ok: false, error: message.replace(/^This page contains the following errors:\s*/, '') };
    }
    const elements = doc.getElementsByTagName('*');
    let attributes = 0;
    let maxDepth = 0;
    const walk = (node, depth) => {
      maxDepth = Math.max(maxDepth, depth);
      Array.from(node.children).forEach((child) => walk(child, depth + 1));
    };
    walk(doc.documentElement, 1);
    Array.from(elements).forEach((el) => { attributes += el.attributes.length; });

    if (mode === 'minify') {
      const minified = new XMLSerializer().serializeToString(doc).replace(/>\s+</g, '><').trim();
      return { ok: true, output: minified, counts: { elements: elements.length, attributes, depth: maxDepth } };
    }
    const lines = [];
    if (/^\s*<\?xml/.test(xml)) lines.push(`<?xml version="${doc.xmlVersion || '1.0'}"${doc.xmlEncoding ? ` encoding="${doc.xmlEncoding}"` : ''}?>`);
    serializeNode(doc.documentElement, 0, indent, lines);
    return { ok: true, output: lines.join('\n'), counts: { elements: elements.length, attributes, depth: maxDepth } };
  }, [xml, mode, indent]);

  return (
    <ToolShell
      toolId="xml-formatter"
      icon={Code}
      title="XML Formatter"
      desc="Validate, pretty-print or minify XML — attributes, comments and CDATA preserved."
      state={{ xml, mode, indent }}
      onRestore={(saved) => { setXml(saved.xml); setMode(saved.mode || 'pretty'); setIndent(saved.indent ?? 2); }}
      exportText={result.output || ''}
      exportName={mode === 'minify' ? 'document.min.xml' : 'document.xml'}
      exportMime="application/xml"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'pretty', label: 'Pretty print' }, { value: 'minify', label: 'Minify' }]} />
      <Area value={xml} onChange={setXml} rows={7} placeholder="Paste XML…" />
      {mode === 'pretty' && (
        <Field label={`Indent · ${indent} spaces`}>
          <input type="range" min={2} max={8} value={indent} onChange={(e) => setIndent(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      )}
      {result.ok ? (
        <>
          <Out label="Output" value={result.output}>
            <pre className="max-h-80 overflow-auto whitespace-pre font-mono-j text-[11px] scrollbar-thin">{result.output || '—'}</pre>
          </Out>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Elements" value={String(result.counts.elements)} />
            <Stat label="Attributes" value={String(result.counts.attributes)} />
            <Stat label="Nesting depth" value={String(result.counts.depth)} />
          </div>
        </>
      ) : (
        <>
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">{result.error}</div>
          <Panel><p className="text-xs text-muted-foreground">Common causes: an unclosed tag, a stray &amp; that should be &amp;amp;, or a missing root element.</p></Panel>
        </>
      )}
      <CopyBtn value={result.ok ? result.output : ''} label="Copy output" />
    </ToolShell>
  );
}