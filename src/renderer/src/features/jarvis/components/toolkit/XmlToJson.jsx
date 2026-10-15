import { useMemo, useState } from 'react';
import { Code2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Out, Panel, Seg, Stat, ToggleRow } from './shared';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<catalog updated="2026-10-09">
  <product id="A-12" stock="14">
    <name>Desk lamp</name>
    <price currency="USD">89.50</price>
    <tags><tag>lighting</tag><tag>desk</tag></tags>
  </product>
  <product id="B-07" stock="3">
    <name>Walnut tray</name>
    <price currency="USD">42.00</price>
  </product>
</catalog>`;

const nodeToValue = (node, options) => {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType === 8) return undefined;
  const children = [...node.childNodes].filter((child) => child.nodeType !== 8 && !(child.nodeType === 3 && !child.nodeValue.trim()));
  const elementChildren = children.filter((child) => child.nodeType === 1);
  const textParts = children.filter((child) => child.nodeType === 3).map((child) => child.nodeValue.trim()).filter(Boolean);

  const result = {};
  if (options.keepAttributes && node.attributes?.length) {
    [...node.attributes].forEach((attr) => { result[`@${attr.name}`] = attr.value; });
  }
  if (!elementChildren.length) {
    const text = options.trim ? textParts.join(' ').trim() : textParts.join('');
    if (options.keepAttributes && Object.keys(result).length) {
      if (text) result['#text'] = text;
      return result;
    }
    return text;
  }

  elementChildren.forEach((child) => {
    const value = nodeToValue(child, options);
    if (value === undefined) return;
    if (result[child.nodeName] === undefined) result[child.nodeName] = value;
    else if (Array.isArray(result[child.nodeName])) result[child.nodeName].push(value);
    else result[child.nodeName] = [result[child.nodeName], value];
  });
  if (textParts.length) result['#text'] = textParts.join(' ').trim();
  return result;
};

export default function XmlToJson() {
  const [xml, setXml] = useState(SAMPLE);
  const [pretty, setPretty] = useState(true);
  const [keepAttributes, setKeepAttributes] = useState(true);
  const [alwaysArray, setAlwaysArray] = useState(false);
  const [trim, setTrim] = useState(true);
  const [error, setError] = useState('');

  const result = useMemo(() => {
    if (!xml.trim()) return { json: '', error: '' };
    try {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const parserError = doc.querySelector('parsererror');
      if (parserError) return { json: '', error: parserError.textContent?.split('\n')[0] || 'This XML is not well formed.' };
      const root = doc.documentElement;
      const value = nodeToValue(root, { keepAttributes, trim }) ?? {};
      const shaped = alwaysArray ? { [root.nodeName]: [value] } : { [root.nodeName]: value };
      return { json: JSON.stringify(shaped, null, pretty ? 2 : 0), error: '' };
    } catch (e) {
      return { json: '', error: e.message };
    }
  }, [xml, pretty, keepAttributes, alwaysArray, trim]);

  const stats = useMemo(() => {
    const elements = (xml.match(/<[A-Za-z_][^>]*>/g) || []).length;
    const attributes = (xml.match(/\s[A-Za-z_:][\w:.-]*\s*=\s*"/g) || []).length;
    return { elements, attributes, depth: (xml.match(/<[A-Za-z_][^>]*>[\s\S]*?<\//g) || []).length };
  }, [xml]);

  return (
    <ToolShell
      toolId="xml-json"
      icon={Code2}
      title="XML → JSON Converter"
      desc="Turn sitemaps, RSS feeds, SOAP payloads and config files into clean JSON — attributes, repeated elements and text all handled."
      state={{ xml, pretty, keepAttributes, alwaysArray, trim }}
      onRestore={(restored) => {
        if (typeof restored.xml === 'string') setXml(restored.xml);
        if (typeof restored.pretty === 'boolean') setPretty(restored.pretty);
        if (typeof restored.keepAttributes === 'boolean') setKeepAttributes(restored.keepAttributes);
        if (typeof restored.alwaysArray === 'boolean') setAlwaysArray(restored.alwaysArray);
        if (typeof restored.trim === 'boolean') setTrim(restored.trim);
      }}
      exportText={result.json}
      exportName="converted.json"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={pretty ? 'pretty' : 'min'} onChange={(v) => setPretty(v === 'pretty')} options={[{ value: 'pretty', label: 'Pretty' }, { value: 'min', label: 'Minified' }]} />
        <CopyBtn value={result.json} label="Copy JSON" />
      </div>

      <Field label="XML input">
        <Area value={xml} onChange={setXml} rows={9} mono placeholder="<root><item id=&quot;1&quot;>value</item></root>" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <ToggleRow label="Keep attributes" checked={keepAttributes} onChange={setKeepAttributes} hint="@name" />
        <ToggleRow label="Always wrap in arrays" checked={alwaysArray} onChange={setAlwaysArray} hint="safer for code" />
        <ToggleRow label="Trim whitespace" checked={trim} onChange={setTrim} />
      </div>

      {error ? (
        <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>
      ) : (
        <Out label="JSON" value={result.json}>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px]">{result.json || 'Paste XML to convert it.'}</pre>
        </Out>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Elements" value={String(stats.elements)} mono />
        <Stat label="Attributes" value={String(stats.attributes)} mono />
        <Stat label="Nested pairs" value={String(stats.depth)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Attribute names get an <span className="font-mono-j">@</span> prefix and text that sits alongside attributes lands under{' '}
          <span className="font-mono-j">#text</span>, so nothing is silently dropped. Repeated sibling elements become arrays automatically — switch
          on “always wrap in arrays” when the consumer expects a list even for a single item.
        </p>
      </Panel>
    </ToolShell>
  );
}