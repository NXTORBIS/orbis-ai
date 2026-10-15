import { useMemo, useState } from 'react';
import { Braces } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const SAMPLE = `Hi {{first_name|there}},

Thanks for your enquiry about {{product|our service}}. Your reference is {{ref}} and I have booked {{appointment_date}} at {{appointment_time}}.

{{if:urgent}}Please call me directly on {{phone}}. {{endif}}Otherwise reply here and I will come back to you within one working day.

Best regards,
{{my_name}}
{{company}}`;

const today = () => new Date().toISOString().slice(0, 10);

export default function TextExpander() {
  const [template, setTemplate] = useState(SAMPLE);
  const [values, setValues] = useState({});
  const [includeBuiltins, setIncludeBuiltins] = useState(true);
  const [trimEmpty, setTrimEmpty] = useState(true);

  const tokens = useMemo(() => {
    const found = [];
    const pattern = /\{\{\s*([a-zA-Z0-9_.-]+)(?:\s*\|\s*([^}]*))?\s*\}\}/g;
    let match;
    while ((match = pattern.exec(String(template))) !== null) {
      const name = match[1];
      if (['if', 'endif'].includes(name.toLowerCase())) continue;
      if (!found.some((entry) => entry.name === name)) {
        found.push({ name, fallback: (match[2] || '').trim() });
      }
    }
    return found;
  }, [template]);

  const conditions = useMemo(() => {
    const found = [];
    const pattern = /\{\{\s*if:([a-zA-Z0-9_.-]+)\s*\}\}/g;
    let match;
    while ((match = pattern.exec(String(template))) !== null) {
      if (!found.includes(match[1])) found.push(match[1]);
    }
    return found;
  }, [template]);

  const builtins = useMemo(() => ({
    date: today(),
    today: today(),
    time: new Date().toTimeString().slice(0, 5),
    year: String(new Date().getFullYear()),
    timestamp: new Date().toISOString(),
  }), []);

  const output = useMemo(() => {
    let text = String(template);

    conditions.forEach((condition) => {
      const flag = values[condition];
      const enabled = flag === true || (typeof flag === 'string' && flag.trim() !== '' && flag !== 'no' && flag !== 'false');
      const pattern = new RegExp('\\{\\{\\s*if:' + condition + '\\s*\\}\\}([\\s\\S]*?)\\{\\{\\s*endif\\s*\\}\\}', 'g');
      text = text.replace(pattern, (unusedMatch, body) => (enabled ? body : ''));
    });

    tokens.forEach((token) => {
      const value = values[token.name];
      const resolved = value !== undefined && String(value).trim() !== ''
        ? String(value)
        : includeBuiltins && builtins[token.name] !== undefined
          ? builtins[token.name]
          : token.fallback;
      const escaped = token.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp('\\{\\{\\s*' + escaped + '(?:\\s*\\|[^}]*)?\\s*\\}\\}', 'g');
      text = text.replace(pattern, resolved);
    });

    if (trimEmpty) {
      const lines = text.split('\n').map((line) => line.replace(/\s+([.,;:!?])/g, '$1').trimEnd());
      text = lines.filter((line, index) => !(line === '' && lines[index - 1] === '')).join('\n');
    }

    return text;
  }, [template, values, tokens, conditions, builtins, includeBuiltins, trimEmpty]);

  const stats = useMemo(() => {
    const words = output.split(/\s+/).filter(Boolean).length;
    const remaining = (output.match(/\{\{/g) || []).length;
    const filled = tokens.filter((token) => values[token.name] !== undefined && String(values[token.name]).trim() !== '').length;
    const unfilled = tokens.filter((token) => !(values[token.name] !== undefined && String(values[token.name]).trim() !== '')
      && !(includeBuiltins && builtins[token.name] !== undefined)
      && !token.fallback);
    return {
      words, characters: output.length, remaining, filled, unfilled,
      completion: tokens.length ? (filled / tokens.length) * 100 : 100,
    };
  }, [output, tokens, values, includeBuiltins, builtins]);

  const report = useMemo(() => [
    'Generated from a template with ' + tokens.length + ' fields and ' + conditions.length + ' conditions',
    '',
    output,
    '',
    'Fields: ' + tokens.map((token) => token.name + (values[token.name] ? ' = ' + values[token.name] : token.fallback ? ' = (default ' + token.fallback + ')' : ' = (empty)')).join(' · '),
  ].join('\n'), [output, tokens, conditions, values]);

  return (
    <ToolShell
      toolId="text-expander"
      icon={Braces}
      title="Template & Snippet Filler"
      desc="Paste a template with fields, fill them once and get the finished text — with default values, conditional blocks, automatic date tokens and a clean copy for email, contracts or release notes."
      state={{ template, values, includeBuiltins, trimEmpty }}
      onRestore={(restored) => {
        if (typeof restored.template === 'string') setTemplate(restored.template);
        if (restored.values && typeof restored.values === 'object') setValues(restored.values);
        if (typeof restored.includeBuiltins === 'boolean') setIncludeBuiltins(restored.includeBuiltins);
        if (typeof restored.trimEmpty === 'boolean') setTrimEmpty(restored.trimEmpty);
      }}
      exportText={report}
      exportName="filled-template.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Template</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{tokens.length} fields · {conditions.length} conditions</span>
          </div>
          <Area value={template} onChange={setTemplate} rows={14} mono placeholder={'Hello {{first_name}},\n\nYour booking is on {{appointment_date}}.'} />
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <p>· Write a field in double braces, optionally with a default after a pipe: <span className="font-mono-j">{'{{name}}'}</span> or <span className="font-mono-j">{'{{name|friend}}'}</span>.</p>
            <p>· Wrap optional text in <span className="font-mono-j">{'{{if:urgent}}'}</span> and <span className="font-mono-j">{'{{endif}}'}</span>. The block appears only when that field has a value.</p>
            <p>· <span className="font-mono-j">date</span>, <span className="font-mono-j">time</span>, <span className="font-mono-j">year</span> and <span className="font-mono-j">timestamp</span> fill themselves.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Fill in the fields</div>
          {tokens.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Add a field in double braces to the template and it will appear here.</p>
          ) : (
            <div className="space-y-2">
              {tokens.map((token) => {
                const isBuiltin = includeBuiltins && builtins[token.name] !== undefined;
                return (
                  <div key={token.name} className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
                    <div className="flex h-9 flex-wrap items-center gap-2">
                      <span className="font-mono-j text-[11px] text-cyan-j">{token.name}</span>
                      {token.fallback && <span className="text-[10px] text-muted-foreground">default {token.fallback}</span>}
                      {isBuiltin && <span className="text-[10px] text-emerald-300">automatic</span>}
                    </div>
                    <input
                      value={values[token.name] || ''}
                      onChange={(e) => setValues((current) => ({ ...current, [token.name]: e.target.value }))}
                      placeholder={isBuiltin ? builtins[token.name] : token.fallback || 'value'}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                  </div>
                );
              })}
            </div>
          )}
          {conditions.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
              <div className="text-[11px] font-medium">Conditional blocks</div>
              {conditions.map((condition) => (
                <div key={condition} className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
                  <div className="flex h-9 items-center font-mono-j text-[11px] text-cyan-j">if:{condition}</div>
                  <input
                    value={values[condition] || ''}
                    onChange={(e) => setValues((current) => ({ ...current, [condition]: e.target.value }))}
                    placeholder="type anything to include the block"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Fill date and time automatically" checked={includeBuiltins} onChange={setIncludeBuiltins} />
        <ToggleRow label="Tidy the spacing as it fills" checked={trimEmpty} onChange={setTrimEmpty} />
        <Field label="Ready state">
          <div className="flex h-9 items-center font-mono-j text-[11px]">
            {stats.unfilled.length ? <span className="text-amber-300">{stats.unfilled.length} field{stats.unfilled.length === 1 ? '' : 's'} still empty</span> : <span className="text-emerald-300">every field resolved</span>}
          </div>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Finished text"
          value={String(stats.words)}
          unit="words"
          sub={'That is ' + stats.characters.toLocaleString() + ' characters from a template with ' + tokens.length + ' field' + (tokens.length === 1 ? '' : 's') + ' and ' + conditions.length + ' conditional block' + (conditions.length === 1 ? '' : 's') + '. ' + (stats.remaining ? stats.remaining + ' placeholder' + (stats.remaining === 1 ? ' is' : 's are') + ' still unresolved.' : 'Every placeholder resolved cleanly.')}
        />
        <Ring
          value={stats.completion}
          max={100}
          tone={stats.unfilled.length ? 'amber' : 'emerald'}
          label="Fields filled by hand"
          sub={stats.filled + ' of ' + tokens.length + ' entered by hand, with the rest coming from defaults or the date'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Output</span>
          <CopyBtn value={output} label="Copy the finished text" />
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border/50 bg-card/40 p-3 text-[12px] leading-relaxed">{output || 'The finished text appears here as you fill the fields.'}</pre>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Fields" value={String(tokens.length)} mono sub={conditions.length + ' conditions'} />
        <Stat label="Words" value={String(stats.words)} mono sub={stats.characters + ' characters'} />
        <Stat label="Unresolved" value={String(stats.remaining)} mono sub="remaining placeholders" />
        <Stat label="Completion" value={stats.completion.toFixed(0) + '%'} mono sub={stats.unfilled.length + ' still empty'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Templates worth keeping</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Client replies and quotations: name, reference, dates and a conditional block for the urgent path.</p>
            <p>· Job offers and references, where the same structure is repeated with different details every time.</p>
            <p>· Release notes and changelogs, with the version and date filled automatically.</p>
            <p>· Incident updates: status, next update time, and a conditional block for the resolution notice.</p>
            <p>· Feedback requests and follow-ups, where three of the four paragraphs are always identical.</p>
            <p>· Any email you have written more than three times. That is the reliable signal that it should become a template.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Writing a template that does not embarrass you</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Give every field a default where a sensible one exists, so a missed value reads as ordinary prose rather than a broken placeholder.</p>
            <p>· Keep conditional blocks small. A template that branches in six places is harder to maintain than three separate templates.</p>
            <p>· Read the output aloud before sending. Templates drift into slightly stiff phrasing nobody notices while writing them.</p>
            <p>· Never send a template to somebody who will receive the same one twice. The second copy undoes the first.</p>
            <p>· Keep templates where you will find them. This tool remembers the template and the values from last time, so the repeat case is one copy away.</p>
            <p>· {stats.unfilled.length ? 'Fields still empty: ' + stats.unfilled.map((token) => token.name).join(', ') + '. They render as blank rather than as failures, which is deliberate.' : 'Nothing is left unresolved, so this output is ready to paste straight into a message.'}</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Fields', value: String(tokens.length) },
                { label: 'Blocks', value: String(conditions.length) },
                { label: 'Ready', value: stats.unfilled.length ? 'not yet' : 'yes' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the expansion works</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>fields are found with a pattern for double-brace names, optionally followed by a default after a pipe</p>
          <p>conditional blocks are matched first, then kept or removed depending on whether the flag has a value</p>
          <p>a field resolves in order: the value you typed, then an automatic token, then the default</p>
          <p>tidying removes spaces before punctuation and collapses repeated blank lines</p>
          <p className="text-cyan-j">Check: {tokens.length} fields and {conditions.length} conditions produced {stats.words} words.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Everything happens in this page, so nothing pasted here is sent anywhere. That matters for templates containing client names, references or any other personal detail.
        </p>
      </Panel>
    </ToolShell>
  );
}