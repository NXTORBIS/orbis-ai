import { useMemo, useState } from 'react';
import { Braces } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const SAMPLE = `{
  "id": "usr_9f2",
  "name": "Priya Sharma",
  "email": "priya@example.com",
  "active": true,
  "age": 31,
  "score": 92.5,
  "tags": ["beta", "design"],
  "address": {
    "city": "Mumbai",
    "postcode": "400001"
  },
  "orders": [
    { "sku": "A-1", "qty": 2, "price": 19.99 },
    { "sku": "B-7", "qty": 1, "price": 4.5 }
  ],
  "last_seen": "2026-02-14T09:31:00Z",
  "deleted_at": null
}`;

const detectFormat = (key, value) => {
  if (typeof value !== 'string') return null;
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value)) return 'email';
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'date-time';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (/^https?:\/\//.test(value)) return 'uri';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return 'uuid';
  return null;
};

const infer = (value, key, options) => {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: value.length ? infer(value[0], key, options) : {},
    };
  }
  if (typeof value === 'object') {
    const properties = {};
    const required = [];
    Object.entries(value).forEach(([childKey, childValue]) => {
      properties[childKey] = infer(childValue, childKey, options);
      if (childValue !== null && childValue !== undefined) required.push(childKey);
    });
    return {
      type: 'object',
      properties,
      ...(options.required ? { required } : {}),
      ...(options.additional === false ? { additionalProperties: false } : {}),
    };
  }
  const schema = { type: typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value };
  if (typeof value === 'string' && options.formats) {
    const format = detectFormat(key, value);
    if (format) schema.format = format;
  }
  if (options.examples) schema.examples = [value];
  return schema;
};

export default function JsonSchemaGenerator() {
  const [raw, setRaw] = useState(SAMPLE);
  const [title, setTitle] = useState('User');
  const [examples, setExamples] = useState(true);
  const [formats, setFormats] = useState(true);
  const [required, setRequired] = useState(true);
  const [strict, setStrict] = useState(false);
  const [useSample, setUseSample] = useState(false);

  const parsed = useMemo(() => {
    try {
      return { value: JSON.parse(raw), error: '' };
    } catch (err) {
      return { value: null, error: String(err.message || err) };
    }
  }, [raw]);

  const schema = useMemo(() => {
    if (parsed.error) return '';
    const body = infer(parsed.value, 'root', { examples, formats, required, additional: strict ? false : undefined });
    const output = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...(title ? { title } : {}),
      ...body,
    };
    return JSON.stringify(output, null, 2);
  }, [parsed, examples, formats, required, strict, title]);

  const stats = useMemo(() => {
    let objects = 0;
    let arrays = 0;
    let fields = 0;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        arrays += 1;
        walk(node[0]);
        return;
      }
      objects += 1;
      Object.values(node).forEach((value) => {
        fields += 1;
        walk(value);
      });
    };
    walk(parsed.value);
    return { objects, arrays, fields };
  }, [parsed]);

  const zodNote = `// Zod equivalent (handy if your API layer validates):
const schema = z.object({ /* fields inferred above */ });`;

  return (
    <ToolShell
      toolId="json-schema"
      icon={Braces}
      title="JSON → Schema Generator"
      desc="Paste a real API response and get a JSON Schema that describes it — types, nesting, arrays, formats and required fields included."
      state={{ raw, title, examples, formats, required, strict }}
      onRestore={(restored) => {
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (typeof restored.title === 'string') setTitle(restored.title);
        if (typeof restored.examples === 'boolean') setExamples(restored.examples);
        if (typeof restored.formats === 'boolean') setFormats(restored.formats);
        if (typeof restored.required === 'boolean') setRequired(restored.required);
        if (typeof restored.strict === 'boolean') setStrict(restored.strict);
      }}
      exportText={schema}
      exportName="schema.json"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={schema} label="Copy schema" />
        <button
          type="button"
          onClick={() => setUseSample((v) => !v)}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          {useSample ? 'Using the built-in sample' : 'Load the sample payload'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
        <Area
          label="Your JSON"
          value={raw}
          onChange={setRaw}
          rows={14}
          mono
          placeholder='{ "id": 1, "name": "Ada" }'
        />
        <div className="space-y-2">
          <Field label="Schema title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
          </Field>
          <ToggleRow label="Detect formats (email, date, uri, uuid)" checked={formats} onChange={setFormats} />
          <ToggleRow label="List required fields" checked={required} onChange={setRequired} />
          <ToggleRow label="Include sample values" checked={examples} onChange={setExamples} />
          <ToggleRow label="Disallow extra properties" checked={strict} onChange={setStrict} hint="additionalProperties: false" />
          {parsed.error ? (
            <Panel className="border-amber-500/40 text-[11px] text-amber-500">That is not valid JSON: {parsed.error}</Panel>
          ) : (
            <Panel className="!p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Detected</div>
              <p className="mt-1 text-[11px]">{stats.objects} objects · {stats.arrays} arrays · {stats.fields} fields</p>
            </Panel>
          )}
        </div>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Generated schema</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">2020-12</span>
        </div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{schema || 'Paste valid JSON to generate a schema.'}</pre>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Objects" value={String(stats.objects)} mono />
        <Stat label="Arrays" value={String(stats.arrays)} mono />
        <Stat label="Schema size" value={`${schema.length} chars`} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">A note if you validate in TypeScript</span>
          <CopyBtn value={zodNote} label="Copy" />
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono-j text-[10px] text-cyan-j">{zodNote}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A schema inferred from one response is a starting point, not a contract: a field that happened to be null becomes “null”, and an array with
          one item only describes that item's shape. Paste the largest, most varied response you have, then hand-edit the optional fields — that is
          usually faster than writing the schema from scratch.
        </p>
      </Panel>
    </ToolShell>
  );
}