import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Panel, Stat } from './shared';

const SAMPLE_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['id', 'name', 'plan'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string', minLength: 2 },
    plan: { type: 'string', enum: ['free', 'pro', 'team'] },
    seats: { type: 'integer', minimum: 1, maximum: 200 },
    email: { type: 'string', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
  },
  additionalProperties: false,
}, null, 2);

const SAMPLE_DATA = JSON.stringify({
  id: 'acct_1042',
  name: 'A',
  plan: 'enterprise',
  seats: 0,
  email: 'not-an-email',
  tags: ['beta', 'internal', 'eu', 'priority', 'billing', 'legacy'],
  extra: true,
}, null, 2);

const FIXED_DATA = JSON.stringify({
  id: 'acct_1042',
  name: 'Acme Ltd',
  plan: 'pro',
  seats: 12,
  email: 'ops@acme.example',
  tags: ['beta', 'eu'],
}, null, 2);

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

const validate = (schema, data, path, errors) => {
  if (!schema || typeof schema !== 'object') return;
  const actual = typeOf(data);

  if (schema.type) {
    const wanted = schema.type;
    const ok = wanted === actual
      || (wanted === 'number' && actual === 'integer')
      || (wanted === 'string' && actual === 'string');
    if (!ok) {
      errors.push({ path, message: 'expected ' + wanted + ', found ' + actual });
      return;
    }
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push({ path, message: 'the value "' + String(data) + '" is not one of ' + schema.enum.join(', ') });
  }
  if (schema.const !== undefined && data !== schema.const) {
    errors.push({ path, message: 'must equal ' + JSON.stringify(schema.const) });
  }

  if (actual === 'integer' || actual === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) errors.push({ path, message: data + ' is below the minimum of ' + schema.minimum });
    if (schema.maximum !== undefined && data > schema.maximum) errors.push({ path, message: data + ' is above the maximum of ' + schema.maximum });
    if (schema.multipleOf && data % schema.multipleOf !== 0) errors.push({ path, message: 'must be a multiple of ' + schema.multipleOf });
  }

  if (actual === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) errors.push({ path, message: 'shorter than the minimum of ' + schema.minLength + ' characters' });
    if (schema.maxLength !== undefined && data.length > schema.maxLength) errors.push({ path, message: 'longer than the maximum of ' + schema.maxLength + ' characters' });
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(data)) errors.push({ path, message: 'does not match the pattern ' + schema.pattern });
      } catch {
        errors.push({ path, message: 'the schema pattern is not a valid expression: ' + schema.pattern });
      }
    }
  }

  if (actual === 'array') {
    if (schema.minItems !== undefined && data.length < schema.minItems) errors.push({ path, message: 'needs at least ' + schema.minItems + ' items' });
    if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push({ path, message: 'has ' + data.length + ' items but the limit is ' + schema.maxItems });
    if (schema.uniqueItems) {
      const seen = new Set();
      data.forEach((entry, index) => {
        const key = JSON.stringify(entry);
        if (seen.has(key)) errors.push({ path: path + '[' + index + ']', message: 'duplicate item' });
        seen.add(key);
      });
    }
    if (schema.items) data.forEach((entry, index) => validate(schema.items, entry, path + '[' + index + ']', errors));
  }

  if (actual === 'object') {
    (schema.required || []).forEach((key) => {
      if (data[key] === undefined) errors.push({ path: path + '.' + key, message: 'required property is missing' });
    });
    Object.entries(schema.properties || {}).forEach(([key, subSchema]) => {
      if (data[key] !== undefined) validate(subSchema, data[key], path + '.' + key, errors);
    });
    if (schema.additionalProperties === false) {
      Object.keys(data).forEach((key) => {
        if (!(schema.properties || {})[key]) errors.push({ path: path + '.' + key, message: 'property is not allowed here' });
      });
    }
  }
};

const countNodes = (value) => {
  if (value === null || typeof value !== 'object') return 1;
  if (Array.isArray(value)) return 1 + value.reduce((sum, entry) => sum + countNodes(entry), 0);
  return 1 + Object.values(value).reduce((sum, entry) => sum + countNodes(entry), 0);
};

const depthOf = (value) => {
  if (value === null || typeof value !== 'object') return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  if (!children.length) return 1;
  return 1 + Math.max(...children.map(depthOf));
};

export default function SchemaCheck() {
  const [schemaText, setSchemaText] = useState(SAMPLE_SCHEMA);
  const [dataText, setDataText] = useState(SAMPLE_DATA);

  const result = useMemo(() => {
    let schema;
    let data;
    try {
      schema = JSON.parse(schemaText);
    } catch (error) {
      return { error: 'The schema is not valid JSON: ' + error.message };
    }
    try {
      data = JSON.parse(dataText);
    } catch (error) {
      return { error: 'The document is not valid JSON: ' + error.message };
    }
    const errors = [];
    validate(schema, data, '', errors);
    return {
      errors,
      valid: !errors.length,
      nodes: countNodes(data),
      depth: depthOf(data),
      properties: schema.properties ? Object.keys(schema.properties).length : 0,
      required: schema.required ? schema.required.length : 0,
      error: '',
    };
  }, [schemaText, dataText]);

  const report = useMemo(() => {
    if (result.error) return result.error;
    if (result.valid) return 'Valid: the document matches the schema. ' + result.nodes + ' nodes checked.';
    return [
      result.errors.length + ' problem' + (result.errors.length === 1 ? '' : 's') + ' found',
      '',
      ...result.errors.map((entry) => (entry.path || '(root)') + ' — ' + entry.message),
    ].join('\n');
  }, [result]);

  return (
    <ToolShell
      toolId="schema-check"
      icon={ShieldCheck}
      title="JSON Schema Validator"
      desc="Paste a schema and a document and see exactly which path breaks which rule — types, required fields, enums, ranges, patterns, array limits and unknown properties."
      state={{ schemaText, dataText }}
      onRestore={(restored) => {
        if (typeof restored.schemaText === 'string') setSchemaText(restored.schemaText);
        if (typeof restored.dataText === 'string') setDataText(restored.dataText);
      }}
      exportText={report}
      exportName="validation.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setSchemaText(SAMPLE_SCHEMA); setDataText(SAMPLE_DATA); }}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          Load a failing example
        </button>
        <button
          type="button"
          onClick={() => setDataText(FIXED_DATA)}
          className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          Show me a passing document
        </button>
        <CopyBtn value={report} label="Copy the report" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">JSON Schema</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{schemaText.split('\n').length} lines</span>
          </div>
          <Area value={schemaText} onChange={setSchemaText} rows={16} mono placeholder={'{\n  "type": "object"\n}'} />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Your document</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{dataText.split('\n').length} lines</span>
          </div>
          <Area value={dataText} onChange={setDataText} rows={16} mono placeholder='{"id": "acct_1"}' />
        </Panel>
      </div>

      {result.error && <Panel className="border-rose-500/40 text-[12px] text-rose-400">{result.error}</Panel>}

      {!result.error && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              tone={result.valid ? 'emerald' : 'rose'}
              label={result.valid ? 'Valid' : result.errors.length + ' rule' + (result.errors.length === 1 ? '' : 's') + ' broken'}
              value={result.valid ? 'OK' : String(result.errors.length)}
              sub={result.valid
                ? 'Every value matched the schema, including required fields and the unknown-property rule. ' + result.nodes + ' nodes checked.'
                : 'Each problem below names the exact path, so you can jump straight to it. The first one is usually the real cause.'}
            />
            <Pills
              items={[
                { label: 'Properties', value: String(result.properties) },
                { label: 'Required', value: String(result.required) },
                { label: 'Depth', value: String(result.depth) },
              ]}
            />
          </div>

          {!!result.errors.length && (
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Problems, in the order they were found</div>
              <div className="space-y-1.5">
                {result.errors.map((entry, index) => (
                  <div key={entry.path + index} className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-2.5 py-2">
                    <div className="font-mono-j text-[11px] text-rose-300">{entry.path || '(root)'}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{entry.message}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {result.valid && (
            <Panel className="border-emerald-500/40 !p-3 text-[11px] text-emerald-300">
              The document satisfies every rule in this schema. Validation covers types, required properties, enumerations, numeric ranges, string lengths and patterns,
              array limits and duplicate items, and unknown properties when additionalProperties is false.
            </Panel>
          )}
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the validator checks</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· <span className="font-mono-j text-cyan-j">type</span> — object, array, string, number, integer, boolean or null, with integer accepted wherever number is required.</p>
            <p>· <span className="font-mono-j text-cyan-j">required</span> — the properties that must be present, checked before anything inside them.</p>
            <p>· <span className="font-mono-j text-cyan-j">enum</span> and <span className="font-mono-j text-cyan-j">const</span> for allowed values, plus numeric minimum, maximum and multipleOf.</p>
            <p>· String minLength, maxLength and pattern, and array minItems, maxItems, uniqueItems and per-item rules.</p>
            <p>· <span className="font-mono-j text-cyan-j">additionalProperties: false</span> flags anything the schema does not describe, which is how a misspelled field name gets caught.</p>
            <p>· Each error reports its path in dot and bracket notation, so <span className="font-mono-j">.tags[5]</span> means the sixth tag.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Using this well</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Validate the response you actually receive, not the one you expect — paste real payloads, including the awkward ones.</p>
            <p>· Turn on required and additionalProperties in your API schemas; those two rules catch the majority of integration bugs.</p>
            <p>· Keep a fixed example beside the schema, so a change that breaks the contract fails here immediately.</p>
            <p>· A pattern that will not compile is reported as a schema problem rather than a data problem — worth knowing when nothing else makes sense.</p>
            <p>· This validates a practical subset of JSON Schema; anchors, conditionals and remote references are outside its scope.</p>
          </div>
          <div className="mt-3">
            <CopyBtn value={report} label="Copy problems" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Status" value={result.error ? 'error' : result.valid ? 'valid' : 'invalid'} mono />
        <Stat label="Problems" value={result.error ? '—' : String(result.errors.length)} mono />
        <Stat label="Nodes" value={result.error ? '—' : String(result.nodes)} mono sub="in the document" />
        <Stat label="Depth" value={result.error ? '—' : String(result.depth)} mono sub="levels" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Reading the failure list</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Fix the shallowest path first. A wrong type at the root makes every error beneath it noise.</p>
          <p>· A missing required property and an extra unknown property are often the same mistake — one field spelled differently.</p>
          <p>· Enum failures usually mean a value drifted away from the contract, which is worth fixing at the source rather than in the schema.</p>
          <p>· A pattern failure on something that looks correct usually means anchoring: without ^ and $ the pattern matches anywhere in the string.</p>
          <p>· Once it validates, keep the schema under version control. A contract nobody can see is not a contract.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The validator walks the document and the schema together, so it inspects only what the schema describes and reports paths in the document's own notation.
          It is a practical subset rather than a full implementation of the specification, which keeps the messages readable when something has gone wrong at two in
          the morning.
        </p>
      </Panel>
    </ToolShell>
  );
}