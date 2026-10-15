import { useMemo, useState } from 'react';
import { FileCode } from 'lucide-react';
import { ToolHeader, Area, Field, Out, CopyBtn, Stat , ToggleRow } from './shared';
import ToolShell from './kit/ToolShell';

const SAMPLE = JSON.stringify({
  id: 42,
  name: 'Ada Lovelace',
  verified: true,
  deleted_at: null,
  tags: ['maths', 'engines'],
  profile: { avatar: 'https://example.com/a.png', score: 9.5 },
  orders: [{ id: 'A-1', total: 19.99, items: [{ sku: 'X', qty: 2 }] }],
}, null, 2);

const pascal = (value) => String(value)
  .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
  .replace(/^[a-z]/, (c) => c.toUpperCase()) || 'Item';

const singular = (value) => {
  if (/ies$/i.test(value)) return value.slice(0, -3) + 'y';
  if (/ss$/i.test(value)) return value;
  if (/s$/i.test(value)) return value.slice(0, -1);
  return value;
};

const keyName = (key) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key));

export default function JsonToTypes() {
  const [json, setJson] = useState(SAMPLE);
  const [rootName, setRootName] = useState('Root');
  const [readonlyProps, setReadonlyProps] = useState(false);
  const [optionalNulls, setOptionalNulls] = useState(false);

  const result = useMemo(() => {
    let data;
    try { data = JSON.parse(json); } catch (e) { return { error: e.message }; }

    const interfaces = new Map();
    const order = [];

    const setInterface = (name, body) => {
      if (!interfaces.has(name)) { interfaces.set(name, body); order.push(name); return name; }
      if (interfaces.get(name) === body) return name;
      let n = 2;
      while (interfaces.has(`${name}${n}`) && interfaces.get(`${name}${n}`) !== body) n += 1;
      const unique = `${name}${n}`;
      if (!interfaces.has(unique)) { interfaces.set(unique, body); order.push(unique); }
      return unique;
    };

    const typeOf = (value, hint) => {
      if (Array.isArray(value)) {
        if (!value.length) return 'unknown[]';
        const types = [];
        value.forEach((item) => {
          const t = typeOf(item, singular(hint));
          if (!types.includes(t)) types.push(t);
        });
        return types.length === 1 ? `${types[0]}[]` : `Array<${types.join(' | ')}>`;
      }
      if (value === null) return 'null';
      if (typeof value === 'object') return buildInterface(value, pascal(hint));
      if (typeof value === 'number') return 'number';
      if (typeof value === 'boolean') return 'boolean';
      return 'string';
    };

    const buildInterface = (object, name) => {
      const lines = Object.entries(object).map(([key, value]) => {
        const inferred = typeOf(value, key);
        const nullable = inferred === 'null' || inferred.includes('null');
        const type = nullable && optionalNulls ? inferred.replace(/\s*\|\s*null/g, '') || 'null' : inferred;
        const question = nullable && optionalNulls ? '?' : '';
        return `  ${readonlyProps ? 'readonly ' : ''}${keyName(key)}${question}: ${type};`;
      });
      const body = lines.length ? lines.join('\n') : '  [key: string]: unknown;';
      return setInterface(name, body);
    };

    const rootType = typeOf(data, rootName);
    const blocks = order.map((name) => `export interface ${name} {\n${interfaces.get(name)}\n}`);
    if (rootType.startsWith(`${rootName}[]`) || /^Array</.test(rootType)) blocks.push(`export type ${rootName}List = ${rootType};`);

    return { code: blocks.join('\n\n'), count: order.length, rootType };
  }, [json, rootName, readonlyProps, optionalNulls]);

  return (
    <ToolShell
      toolId="json-to-types"
      icon={FileCode}
      title="JSON → TypeScript Types"
      desc="Paste an API response and get ready-to-use interfaces for it."
      state={{ json, rootName, readonlyProps, optionalNulls }}
      onRestore={(saved) => {
        setJson(saved.json); setRootName(saved.rootName);
        setReadonlyProps(!!saved.readonlyProps); setOptionalNulls(!!saved.optionalNulls);
      }}
      exportText={result.code}
      exportName="types.ts"
    >
      <Area value={json} onChange={setJson} rows={10} mono placeholder='{ "id": 1, "name": "Ada" }' />
      <Field label="Name of the root type">
        <input value={rootName} onChange={(e) => setRootName(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Readonly properties" checked={readonlyProps} onChange={setReadonlyProps} />
        <ToggleRow label="Nullable fields optional" checked={optionalNulls} onChange={setOptionalNulls} hint="drops | null" />
      </div>
      {result.error
        ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Invalid JSON: {result.error}</div>
        : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Interfaces" value={String(result.count)} />
              <Stat label="Root type" value={result.rootType} mono />
              <Stat label="Lines" value={String(result.code.split('\n').length)} />
            </div>
            <Out label="TypeScript" value={result.code}>
              <pre className="max-h-96 overflow-auto whitespace-pre font-mono-j text-[11px] text-cyan-j scrollbar-thin">{result.code}</pre>
            </Out>
            <div className="flex flex-wrap gap-2">
              <CopyBtn value={result.code} label="Copy types" />
              <CopyBtn value={result.rootType} label="Copy root type" />
            </div>
            <p className="text-[11px] text-muted-foreground">Arrays with mixed contents become a union, nested objects become their own interface, and null fields are typed as <span className="font-mono-j">null</span> so strict mode stays honest.</p>
          </>
        )}
    </ToolShell>
  );
}