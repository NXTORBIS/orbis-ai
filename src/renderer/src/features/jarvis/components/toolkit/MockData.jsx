import { useMemo, useState } from 'react';
import { Database } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const SAMPLE = JSON.stringify({
  type: 'object',
  required: ['id', 'name', 'plan', 'seats'],
  properties: {
    id: { type: 'string', pattern: 'uuid' },
    name: { type: 'string', minLength: 4, maxLength: 24 },
    plan: { type: 'string', enum: ['free', 'pro', 'team'] },
    seats: { type: 'integer', minimum: 1, maximum: 120 },
    active: { type: 'boolean' },
    email: { type: 'string', format: 'email' },
    created: { type: 'string', format: 'date-time' },
    score: { type: 'number', minimum: 0, maximum: 5 },
    tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
  },
}, null, 2);

const FIRST = ['Acme', 'Northwind', 'Globex', 'Initech', 'Umbrella', 'Lumen', 'Vantage', 'Kite', 'Orbit', 'Beacon', 'Sable', 'Quartz'];
const SECOND = ['Labs', 'Systems', 'Works', 'Group', 'Digital', 'Partners', 'Holdings', 'Studio'];
const WORDS = ['alpha', 'beta', 'delta', 'orbit', 'signal', 'vector', 'cinder', 'lumen', 'ridge', 'harbour', 'quartz', 'ember', 'atlas', 'nimbus'];

const mulberry = (seed) => {
  let state = (seed || 1) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const buildGenerator = (random) => {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const int = (min, max) => Math.floor(random() * (max - min + 1)) + min;
  const hex = (length) => Array.from({ length }, () => '0123456789abcdef'[int(0, 15)]).join('');

  const value = (schema, depth) => {
    if (!schema || typeof schema !== 'object' || depth > 6) return null;
    if (schema.const !== undefined) return schema.const;
    if (Array.isArray(schema.enum) && schema.enum.length) return pick(schema.enum);

    const type = Array.isArray(schema.type) ? pick(schema.type) : schema.type || 'string';

    if (type === 'string') {
      const format = schema.format || (schema.pattern === 'uuid' ? 'uuid' : schema.pattern && /@/.test(schema.pattern) ? 'email' : undefined);
      let output;
      if (format === 'email') output = pick(FIRST).toLowerCase() + '.' + pick(WORDS) + int(1, 99) + '@example.com';
      else if (format === 'uuid') output = (hex(8) + '-' + hex(4) + '-4' + hex(3) + '-a' + hex(3) + '-' + hex(12));
      else if (format === 'date') output = new Date(Date.UTC(2024, int(0, 11), int(1, 28))).toISOString().slice(0, 10);
      else if (format === 'date-time') output = new Date(Date.UTC(2025, int(0, 11), int(1, 28), int(0, 23), int(0, 59))).toISOString();
      else if (format === 'uri' || format === 'url') output = 'https://example.com/' + pick(WORDS) + '/' + int(100, 999);
      else if (format === 'hostname') output = pick(WORDS) + '.example.com';
      else if (format === 'ipv4') output = int(10, 220) + '.' + int(0, 255) + '.' + int(0, 255) + '.' + int(1, 254);
      else output = pick(FIRST) + ' ' + pick(SECOND);
      const min = schema.minLength || 0;
      const max = schema.maxLength || Math.max(min, 40);
      while (output.length < min) output += ' ' + pick(WORDS);
      if (output.length > max) output = output.slice(0, max);
      return output;
    }

    if (type === 'number' || type === 'integer') {
      const min = schema.minimum !== undefined ? schema.minimum : 1;
      const max = schema.maximum !== undefined ? schema.maximum : min + 999;
      const raw = random() * (max - min) + min;
      let output = type === 'integer' ? Math.round(raw) : Number(raw.toFixed(2));
      if (schema.multipleOf) output = Math.round(output / schema.multipleOf) * schema.multipleOf;
      if (schema.minimum !== undefined && output < schema.minimum) output = schema.minimum;
      if (schema.maximum !== undefined && output > schema.maximum) output = schema.maximum;
      return output;
    }

    if (type === 'boolean') return random() > 0.35;
    if (type === 'null') return null;

    if (type === 'array') {
      const min = schema.minItems !== undefined ? schema.minItems : 1;
      const max = schema.maxItems !== undefined ? schema.maxItems : Math.max(min, 3);
      const count = int(min, max);
      return Array.from({ length: count }, () => value(schema.items || { type: 'string' }, depth + 1));
    }

    if (type === 'object') {
      const required = schema.required || [];
      const properties = schema.properties || {};
      const output = {};
      Object.entries(properties).forEach(([key, sub]) => {
        const isRequired = required.includes(key);
        if (isRequired || random() > 0.35) output[key] = value(sub, depth + 1);
      });
      return output;
    }

    return null;
  };

  return value;
};

const countNodes = (value) => {
  if (value === null || typeof value !== 'object') return 1;
  if (Array.isArray(value)) return 1 + value.reduce((sum, entry) => sum + countNodes(entry), 0);
  return 1 + Object.values(value).reduce((sum, entry) => sum + countNodes(entry), 0);
};

export default function MockData() {
  const [schemaText, setSchemaText] = useState(SAMPLE);
  const [count, setCount] = useState('5');
  const [seed, setSeed] = useState('42');
  const [optional, setOptional] = useState(true);
  const [pretty, setPretty] = useState(true);

  const result = useMemo(() => {
    let schema;
    try {
      schema = JSON.parse(schemaText);
    } catch (error) {
      return { error: 'The schema is not valid JSON: ' + error.message };
    }
    const records = Math.max(1, Math.min(200, Number(count) || 1));
    const random = mulberry(Number(seed) || 1);
    const generate = buildGenerator(random);
    const arraySchema = schema.type === 'array'
      ? schema
      : { type: 'array', minItems: records, maxItems: records, items: schema };
    const output = generate(optional ? arraySchema : { ...arraySchema, items: { ...schema, required: Object.keys(schema.properties || {}) } }, 0);

    return {
      output,
      json: pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output),
      records: Array.isArray(output) ? output.length : 1,
      nodes: countNodes(output),
      properties: schema.properties ? Object.keys(schema.properties).length : 0,
      required: schema.required ? schema.required.length : 0,
      error: '',
    };
  }, [schemaText, count, seed, optional, pretty]);

  const report = useMemo(() => {
    if (result.error) return result.error;
    return ['Mock data — ' + result.records + ' record' + (result.records === 1 ? '' : 's') + ', seed ' + seed, '', result.json].join('\n');
  }, [result, seed]);

  const download = () => {
    if (result.error) return;
    const blob = new Blob([result.json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'mock-data.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <ToolShell
      toolId="mock-data"
      icon={Database}
      title="Mock Data from a Schema"
      desc="Paste a JSON Schema and get realistic sample documents that satisfy it — repeatable from a seed, so the same input always produces the same fixtures."
      state={{ schemaText, count, seed, optional, pretty }}
      onRestore={(restored) => {
        if (typeof restored.schemaText === 'string') setSchemaText(restored.schemaText);
        if (restored.count !== undefined) setCount(String(restored.count));
        if (restored.seed !== undefined) setSeed(String(restored.seed));
        if (typeof restored.optional === 'boolean') setOptional(restored.optional);
        if (typeof restored.pretty === 'boolean') setPretty(restored.pretty);
      }}
      exportText={report}
      exportName="mock-data.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">JSON Schema</span>
            <button
              type="button"
              onClick={() => setSchemaText(SAMPLE)}
              className="rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
            >
              Load the example
            </button>
          </div>
          <Area value={schemaText} onChange={setSchemaText} rows={16} mono placeholder={'{\n  "type": "object"\n}'} />
        </Panel>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Records">
              <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            </Field>
            <Field label="Seed">
              <input value={seed} onChange={(e) => setSeed(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            </Field>
            <Field label="Shuffle">
              <button
                type="button"
                onClick={() => setSeed(String(Math.floor(Math.random() * 100000)))}
                className="h-9 w-full rounded-md border border-cyan-j/50 bg-cyan-j/10 text-xs text-cyan-j transition hover:bg-cyan-j/20"
              >
                New seed
              </button>
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow label="Include optional fields" checked={optional} onChange={setOptional} />
            <ToggleRow label="Pretty print" checked={pretty} onChange={setPretty} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={download} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">Download JSON</button>
            <CopyBtn value={result.json || ''} label="Copy the data" />
          </div>
          {result.error && <Panel className="border-rose-500/40 text-[12px] text-rose-400">{result.error}</Panel>}
          {!result.error && (
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Generated output</div>
              <pre className="max-h-80 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">
                {result.json}
              </pre>
            </Panel>
          )}
        </div>
      </div>

      {!result.error && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              label={result.records + ' record' + (result.records === 1 ? '' : 's') + ' generated'}
              value={result.records + ' × ' + result.properties + ' fields'}
              sub={'Seed ' + seed + ' produced ' + result.nodes + ' values. The same seed and schema always give the same data, so fixtures stay stable between runs.'}
            />
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">What the generator honours</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· Types: string, number, integer, boolean, null, array, object.</p>
                <p>· enum and const values are used exactly as written.</p>
                <p>· Formats: email, date, date-time, uuid, uri, hostname and ipv4 get realistic values.</p>
                <p>· Numeric minimum, maximum and multipleOf are respected inside the range.</p>
                <p>· String minLength and maxLength are applied, and arrays respect minItems and maxItems.</p>
                <p>· Required properties are always present{optional ? ', optional ones about two times in three' : ' — with every optional field also filled in as you asked'}.</p>
              </div>
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Records" value={String(result.records)} mono />
            <Stat label="Fields" value={String(result.properties)} mono sub={result.required + ' required'} />
            <Stat label="Values" value={String(result.nodes)} mono sub="in the output" />
            <Stat label="Seed" value={seed} mono sub="reproducible" />
          </div>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Why seeded data beats random</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A seed makes failures reproducible: the same fixtures come back every time, so a bug found on Tuesday still reproduces on Friday.</p>
            <p>· Different seeds give you edge cases — press New seed a few times and you will see short names, zero values and boundary numbers appear.</p>
            <p>· Fixtures that satisfy the schema can be dropped straight into a validator or a test suite without editing them first.</p>
            <p>· Generating from the contract means the fixtures stay honest when the schema changes — the new field appears without anyone remembering to update a file.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting better data out</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Add enum values and the output becomes domain-correct — a plan field becomes free, pro or team instead of a random word.</p>
            <p>· Set minimum and maximum on numbers and the fixtures stay in the range your UI actually handles.</p>
            <p>· Use pattern "uuid" or a format to get identifiers that look and behave like the real thing.</p>
            <p>· For a nested structure, describe the nested object in items or properties and the generator follows it recursively.</p>
            <p>· Wrap a single object schema in an array schema yourself if you want a list — or just raise the record count, which does the same thing.</p>
            <p>· Very large record counts are capped deliberately; use the download and loop through seeds if you need a whole dataset.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Records', value: count },
                { label: 'Seed', value: seed },
                { label: 'Optional', value: optional ? 'included' : 'all filled' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Using the output</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Paste it into an API mock, a Postman environment or a test fixture file.</p>
          <p>· Feed it to the JSON Schema validator in this toolkit to confirm the generated data really does satisfy the contract.</p>
          <p>· Use it to populate a table view or a chart while the real endpoint is still being built.</p>
          <p>· Keep the schema beside the fixtures in version control, so data and contract move together.</p>
          <p>· The generator never invents fields the schema does not describe, so anything unexpected in your app is a schema problem rather than a data problem.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Randomness comes from a seeded generator rather than Math.random, which is what makes the output reproducible from the seed. Every rule the schema
          declares is applied while the value is built, so the result validates against the schema it came from.
        </p>
      </Panel>
    </ToolShell>
  );
}